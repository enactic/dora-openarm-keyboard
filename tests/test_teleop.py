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

import numpy as np
from scipy.spatial.transform import Rotation

from dora_openarm_keyboard.keymap import (
    GRIP_KEYS,
    LEFT,
    MOTION_KEYS,
    PITCH,
    RIGHT,
    ROLL,
    X,
    Y,
    YAW,
    Z,
)
from dora_openarm_keyboard.main import KeyboardTeleop
from dora_openarm_keyboard.teleop import TeleopState


def make_state(**kwargs) -> TeleopState:
    return TeleopState(
        home_right=np.zeros(3),
        home_left=np.zeros(3),
        home_rotation=Rotation.identity(),
        linear_speed=1.0,
        angular_speed=1.0,
        grip_speed=1.0,
        pos_min=np.full(3, -10.0),
        pos_max=np.full(3, 10.0),
        **kwargs,
    )


def test_motion_keys_are_per_arm():
    assert MOTION_KEYS["w"] == (RIGHT, X, PITCH, +1)
    assert MOTION_KEYS["s"] == (RIGHT, X, PITCH, -1)
    assert MOTION_KEYS["a"] == (RIGHT, Y, YAW, +1)
    assert MOTION_KEYS["f"] == (RIGHT, Z, ROLL, -1)
    assert MOTION_KEYS["i"] == (LEFT, X, PITCH, +1)
    assert MOTION_KEYS["j"] == (LEFT, Y, YAW, +1)
    assert MOTION_KEYS["y"] == (LEFT, Z, ROLL, +1)
    assert MOTION_KEYS["h"] == (LEFT, Z, ROLL, -1)


def test_grip_keys_are_per_arm():
    assert GRIP_KEYS == {
        "c": (RIGHT, -1),
        "x": (RIGHT, +1),
        "n": (LEFT, -1),
        "m": (LEFT, +1),
    }


def test_each_arm_moves_only_on_its_own_keys():
    state = make_state()

    state.step(1.0, {"w"})

    np.testing.assert_allclose(state.arms[RIGHT].pos, [1.0, 0.0, 0.0])
    np.testing.assert_allclose(state.arms[LEFT].pos, np.zeros(3))


def test_both_arms_move_at_the_same_time():
    state = make_state()

    state.step(1.0, {"w", "j", "y"})

    np.testing.assert_allclose(state.arms[RIGHT].pos, [1.0, 0.0, 0.0])
    np.testing.assert_allclose(state.arms[LEFT].pos, [0.0, 1.0, 1.0])


def test_opposite_keys_cancel():
    state = make_state()

    state.step(1.0, {"w", "s"})

    np.testing.assert_allclose(state.arms[RIGHT].pos, np.zeros(3))


def test_shift_switches_the_motion_keys_to_rotation():
    state = make_state()

    state.step(1.0, {"w", "shift"})

    np.testing.assert_allclose(state.arms[RIGHT].pos, np.zeros(3))
    np.testing.assert_allclose(state.arms[RIGHT].rot.as_rotvec(), [0.0, 1.0, 0.0])


def test_releasing_shift_returns_to_translation():
    state = make_state()

    state.step(1.0, {"a", "shift"})
    np.testing.assert_allclose(state.arms[RIGHT].rot.as_rotvec(), [0.0, 0.0, 1.0])

    state.step(1.0, {"a"})
    np.testing.assert_allclose(state.arms[RIGHT].pos, [0.0, 1.0, 0.0])


def test_gripper_keys_close_and_open_their_own_arm():
    state = make_state()

    state.step(1.0, {"x", "m"})
    assert state.arms[RIGHT].grip == 1.0
    assert state.arms[LEFT].grip == 1.0

    state.step(0.5, {"c"})
    assert state.arms[RIGHT].grip == 0.5
    assert state.arms[LEFT].grip == 1.0


def test_disable_stops_motion():
    state = make_state()
    state.toggle_enabled()

    state.step(1.0, {"w", "i"})

    np.testing.assert_allclose(state.arms[RIGHT].pos, np.zeros(3))
    np.testing.assert_allclose(state.arms[LEFT].pos, np.zeros(3))


def test_escape_toggles_teleop_and_drops_keys_held_while_disabled():
    teleop = KeyboardTeleop(make_state())

    teleop.enqueue("press", "w")
    teleop.enqueue("press", "escape")
    teleop.step(1.0)
    assert not teleop.state.enabled
    np.testing.assert_allclose(teleop.state.arms[RIGHT].pos, np.zeros(3))

    teleop.enqueue("release", "escape")
    teleop.enqueue("press", "escape")
    teleop.step(0.0)
    assert teleop.state.enabled
    # W was released server-side by the disable, so it must be pressed again.
    teleop.step(1.0)
    np.testing.assert_allclose(teleop.state.arms[RIGHT].pos, np.zeros(3))


def test_disable_stops_a_lifter_in_the_dataflow():
    teleop = KeyboardTeleop(make_state())

    assert teleop.take_command() is None

    teleop.disable()
    assert teleop.take_command() == "lifter-stop"
    assert teleop.take_command() is None
