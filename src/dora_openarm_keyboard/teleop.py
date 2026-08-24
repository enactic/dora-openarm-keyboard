# Copyright 2026 Enactic, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Pose integration for keyboard teleoperation.

This module holds the whole teleoperation state machine and deliberately
imports neither ``dora`` nor the WebRTC stack, so it can be exercised without
a dataflow or a browser.  ``main`` supplies the events and publishes the
results.

Held keys are read as velocities: each ``step`` advances the target pose by
``speed * scale * dt`` along every axis whose key is down.  Orientation is
integrated in the **tool frame** (``r_new = r_cur * delta``), which keeps roll,
pitch and yaw meaningful relative to the gripper rather than the world.
"""

import numpy as np
from scipy.spatial.transform import Rotation

from .keymap import (
    ANGULAR,
    ARM_SELECTION_KEYS,
    GRIP,
    KEYMAP,
    LEFT,
    LIFTER,
    LINEAR,
    PRECISION_KEY,
    RIGHT,
)

# End-effector pose of the scene's ``home`` keyframe, expressed in its
# ``arm_origin`` site frame.  The IK and MuJoCo nodes both start from that same
# keyframe, so starting anywhere else would make IK yank both arms across the
# workspace on the very first tick.  Regenerate with ``dev/home_pose.py``.
DEFAULT_HOME_RIGHT = np.array([0.216, -0.1535, -0.22], dtype=np.float64)
DEFAULT_HOME_LEFT = np.array([0.216, 0.1535, -0.22], dtype=np.float64)
DEFAULT_HOME_RPY = (0.0, -90.0, 0.0)

DEFAULT_LINEAR_SPEED = 0.05  # m/s
DEFAULT_ANGULAR_SPEED = 0.5  # rad/s
DEFAULT_GRIP_SPEED = 2.0  # fraction/s

DEFAULT_POS_MIN = np.array([-0.8, -0.8, -0.8], dtype=np.float64)
DEFAULT_POS_MAX = np.array([0.8, 0.8, 0.8], dtype=np.float64)

MIN_SPEED_SCALE = 0.1
MAX_SPEED_SCALE = 10.0

# Shift is a momentary precision modifier, rather than a persistent speed
# setting.  A quarter speed is slow enough for final placement while retaining
# useful control authority.
PRECISION_SCALE = 0.25

# Fully open gripper angle, mirrored between the arms.  Kept identical to
# dora-openarm-vr so a dataflow can swap one teleoperation source for the other.
_GRIPPER_OPEN_ANGLE = 1.57 / 2.0


def map_grip_to_angle(grip: float, side: str) -> float:
    """Map a grip fraction (0 open, 1 closed) to a gripper joint angle."""
    magnitude = _GRIPPER_OPEN_ANGLE * (1.0 - grip)
    return magnitude if side == LEFT else -magnitude


class KeyState:
    """Tracks which motion keys are down."""

    def __init__(self) -> None:
        """Start with nothing held."""
        self._held: set[str] = set()

    @property
    def held(self) -> set[str]:
        """Keys currently down, as a copy safe to iterate while events arrive."""
        return set(self._held)

    def press(self, key: str) -> None:
        """Mark a key down."""
        self._held.add(key)

    def release(self, key: str) -> None:
        """Mark a key up."""
        self._held.discard(key)

    def clear(self) -> None:
        """Release every key currently held."""
        self._held.clear()


class ArmState:
    """Target pose of a single arm."""

    def __init__(self, home_pos: np.ndarray, home_rot: Rotation) -> None:
        """Start the arm at its home pose with the gripper fully open."""
        self._home_pos = np.asarray(home_pos, dtype=np.float64).copy()
        self._home_rot = home_rot
        self.pos = self._home_pos.copy()
        self.rot = home_rot
        self.grip = 0.0

    def reset(self) -> None:
        """Return this arm to its home pose and open the gripper."""
        self.pos = self._home_pos.copy()
        self.rot = self._home_rot
        self.grip = 0.0


class TeleopState:
    """Integrates held keys into a pair of end-effector pose targets.

    The shared motion keys are applied to the arm selected by ``1`` or ``2``.
    The default selection is ``1`` (left arm); select ``3`` to move both arms
    together.
    """

    def __init__(
        self,
        home_right: np.ndarray | None = None,
        home_left: np.ndarray | None = None,
        home_rotation: Rotation | None = None,
        linear_speed: float = DEFAULT_LINEAR_SPEED,
        angular_speed: float = DEFAULT_ANGULAR_SPEED,
        grip_speed: float = DEFAULT_GRIP_SPEED,
        pos_min: np.ndarray | None = None,
        pos_max: np.ndarray | None = None,
    ) -> None:
        """Build both arms at their home poses."""
        if home_right is None:
            home_right = DEFAULT_HOME_RIGHT
        if home_left is None:
            home_left = DEFAULT_HOME_LEFT
        if home_rotation is None:
            home_rotation = Rotation.from_euler("xyz", DEFAULT_HOME_RPY, degrees=True)

        self.linear_speed = linear_speed
        self.angular_speed = angular_speed
        self.grip_speed = grip_speed
        self.pos_min = np.asarray(
            DEFAULT_POS_MIN if pos_min is None else pos_min, dtype=np.float64
        )
        self.pos_max = np.asarray(
            DEFAULT_POS_MAX if pos_max is None else pos_max, dtype=np.float64
        )

        self.arms = {
            RIGHT: ArmState(home_right, home_rotation),
            LEFT: ArmState(home_left, home_rotation),
        }
        self.speed_scale = 1.0
        self.selection = LEFT
        self.enabled = True

    def scale_speed(self, factor: float) -> float:
        """Multiply the speed scale, clamped, and return the new value."""
        self.speed_scale = float(
            np.clip(self.speed_scale * factor, MIN_SPEED_SCALE, MAX_SPEED_SCALE)
        )
        return self.speed_scale

    def reset(self) -> None:
        """Return both arms to their home poses."""
        for arm in self.arms.values():
            arm.reset()

    def select(self, key: str) -> str | None:
        """Select the arm named by an arm-selection key.

        Return the new selection, or ``None`` for a key that is not an arm
        selection key.
        """
        selection = ARM_SELECTION_KEYS.get(key)
        if selection is not None:
            self.selection = selection
        return selection

    def toggle_enabled(self) -> bool:
        """Toggle teleoperation and return the resulting enabled state."""
        self.enabled = not self.enabled
        return self.enabled

    def selected_sides(self) -> tuple[str, ...]:
        """Return the arm sides affected by the current selection."""
        if self.selection == LEFT:
            return (LEFT,)
        if self.selection == RIGHT:
            return (RIGHT,)
        return (LEFT, RIGHT)

    @staticmethod
    def lifter_direction(held_keys: set[str], enabled: bool = True) -> int:
        """Return the effective lifter direction from the held keys."""
        if not enabled:
            return 0
        direction = 0
        for key in held_keys:
            binding = KEYMAP.get(key)
            if binding is not None and binding[0] == LIFTER:
                direction += binding[2]
        return int(np.sign(direction))

    def step(self, dt: float, held_keys: set[str]) -> None:
        """Advance both targets by one timestep of the currently held keys."""
        if dt <= 0.0 or not self.enabled:
            return

        linear = np.zeros(3)
        angular = np.zeros(3)
        grip = 0.0

        for key in held_keys:
            binding = KEYMAP.get(key)
            if binding is None:
                continue
            kind, axis, sign = binding
            if kind == LINEAR:
                linear[axis] += sign
            elif kind == ANGULAR:
                angular[axis] += sign
            elif kind == GRIP:
                grip += sign

        precision = PRECISION_SCALE if PRECISION_KEY in held_keys else 1.0
        speed_scale = self.speed_scale * precision

        for side in self.selected_sides():
            arm = self.arms[side]
            arm.pos = np.clip(
                arm.pos + linear * self.linear_speed * speed_scale * dt,
                self.pos_min,
                self.pos_max,
            )
            rotvec = angular * self.angular_speed * speed_scale * dt
            if rotvec.any():
                arm.rot = arm.rot * Rotation.from_rotvec(rotvec)
            if grip:
                arm.grip = float(
                    np.clip(
                        arm.grip + grip * self.grip_speed * speed_scale * dt,
                        0.0,
                        1.0,
                    )
                )

    def pose(self, side: str) -> np.ndarray:
        """Return ``[px, py, pz, qw, qx, qy, qz, gripper_angle]`` as float32."""
        arm = self.arms[side]
        qx, qy, qz, qw = arm.rot.as_quat()
        return np.array(
            [
                arm.pos[0],
                arm.pos[1],
                arm.pos[2],
                qw,
                qx,
                qy,
                qz,
                map_grip_to_angle(arm.grip, side),
            ],
            dtype=np.float32,
        )

    def describe(self) -> str:
        """One-line summary of the current state, for status logging."""
        parts = [
            f"selection={self.selection}",
            f"enabled={self.enabled}",
            f"scale={self.speed_scale:.2f}",
        ]
        for side in (RIGHT, LEFT):
            arm = self.arms[side]
            roll, pitch, yaw = arm.rot.as_euler("xyz", degrees=True)
            parts.append(
                f"{side}: p=({arm.pos[0]:+.3f},{arm.pos[1]:+.3f},{arm.pos[2]:+.3f}) "
                f"rpy=({roll:+.0f},{pitch:+.0f},{yaw:+.0f}) grip={arm.grip:.2f}"
            )
        return " | ".join(parts)
