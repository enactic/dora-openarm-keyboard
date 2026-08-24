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
    ANGULAR,
    ARM_SELECTION_KEYS,
    BOTH,
    GRIP,
    KEYMAP,
    LEFT,
    LIFTER,
    LINEAR,
    RIGHT,
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


def test_keymap_matches_shared_controls():
    assert ARM_SELECTION_KEYS == {"1": LEFT, "2": RIGHT, "3": BOTH}
    assert KEYMAP["w"] == (LINEAR, 0, +1)
    assert KEYMAP["k"] == (ANGULAR, 1, -1)
    assert KEYMAP["j"] == (ANGULAR, 2, +1)
    assert KEYMAP["u"] == (ANGULAR, 0, +1)
    assert KEYMAP["g"] == (GRIP, 0, +1)
    assert KEYMAP["q"] == (LIFTER, 0, +1)


def test_both_selection_applies_the_same_increment():
    state = make_state()

    assert state.selection == LEFT
    state.select("3")
    assert state.selection == BOTH
    state.step(1.0, {"w"})

    np.testing.assert_allclose(state.arms[LEFT].pos, [1.0, 0.0, 0.0])
    np.testing.assert_allclose(state.arms[RIGHT].pos, [1.0, 0.0, 0.0])


def test_initial_selection_moves_left_arm_only():
    state = make_state()

    state.step(1.0, {"w"})

    np.testing.assert_allclose(state.arms[LEFT].pos, [1.0, 0.0, 0.0])
    np.testing.assert_allclose(state.arms[RIGHT].pos, [0.0, 0.0, 0.0])


def test_arm_selection_only_moves_selected_arm():
    state = make_state()
    state.select("1")
    state.step(1.0, {"a"})

    np.testing.assert_allclose(state.arms[LEFT].pos, [0.0, 1.0, 0.0])
    np.testing.assert_allclose(state.arms[RIGHT].pos, [0.0, 0.0, 0.0])


def test_shift_is_a_momentary_precision_modifier():
    state = make_state()
    state.select("3")
    state.step(1.0, {"w", "shift"})

    np.testing.assert_allclose(state.arms[LEFT].pos[0], 0.25)
    np.testing.assert_allclose(state.arms[RIGHT].pos[0], 0.25)


def test_disable_stops_pose_and_lifter_motion():
    state = make_state()
    state.toggle_enabled()
    state.step(1.0, {"w"})

    np.testing.assert_allclose(state.arms[LEFT].pos, np.zeros(3))
    assert state.lifter_direction({"q"}, enabled=state.enabled) == 0


def test_lifter_direction_is_shared_and_cancels_when_both_keys_are_held():
    state = make_state()

    assert state.lifter_direction({"q"}) == 1
    assert state.lifter_direction({"e"}) == -1
    assert state.lifter_direction({"q", "e"}) == 0


def test_keyboard_teleop_emits_lifter_commands_and_clears_on_disable():
    teleop = KeyboardTeleop(make_state())

    teleop.enqueue("press", "q")
    teleop.step(0.0)
    assert teleop.take_command() == "lifter-up"

    teleop.enqueue("release", "q")
    teleop.step(0.0)
    assert teleop.take_command() == "lifter-stop"

    teleop.enqueue("press", "w")
    teleop.enqueue("press", "escape")
    teleop.step(1.0)
    assert not teleop.state.enabled
    np.testing.assert_allclose(teleop.state.arms[LEFT].pos, np.zeros(3))
    assert teleop.take_command() is None

    teleop.enqueue("release", "escape")
    teleop.enqueue("press", "escape")
    teleop.step(0.0)
    assert teleop.state.enabled
    teleop.step(1.0)
    np.testing.assert_allclose(teleop.state.arms[LEFT].pos, np.zeros(3))
