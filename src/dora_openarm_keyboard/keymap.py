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

"""Key bindings for keyboard teleoperation.

The number keys select which arm receives the shared motion controls.  The
``3`` selection applies the same increment to both arms, keeping them
synchronized.
"""

LINEAR = "linear"
ANGULAR = "angular"
GRIP = "grip"
LIFTER = "lifter"

RIGHT = "right"
LEFT = "left"
BOTH = "both"

# Axis indices shared by LINEAR (x, y, z) and ANGULAR (roll, pitch, yaw).
X = ROLL = 0
Y = PITCH = 1
Z = YAW = 2

# key -> (kind, axis, sign).  For GRIP, sign +1 closes and -1 opens.  For
# LIFTER, sign +1 moves up and -1 moves down.
KEYMAP: dict[str, tuple[str, int, int]] = {
    # translation
    "w": (LINEAR, X, +1),
    "s": (LINEAR, X, -1),
    "a": (LINEAR, Y, +1),
    "d": (LINEAR, Y, -1),
    "r": (LINEAR, Z, +1),
    "f": (LINEAR, Z, -1),
    # rotation
    "i": (ANGULAR, PITCH, +1),
    "k": (ANGULAR, PITCH, -1),
    "j": (ANGULAR, YAW, +1),
    "l": (ANGULAR, YAW, -1),
    "u": (ANGULAR, ROLL, +1),
    "o": (ANGULAR, ROLL, -1),
    # gripper
    "g": (GRIP, 0, +1),
    "h": (GRIP, 0, -1),
    # shared lifter
    "q": (LIFTER, 0, +1),
    "e": (LIFTER, 0, -1),
}

# Edge-triggered arm and teleoperation controls.
ARM_SELECTION_KEYS = {
    "1": LEFT,
    "2": RIGHT,
    "3": BOTH,
}
PRECISION_KEY = "shift"
TOGGLE_KEY = "escape"

# Kept as compatibility controls for existing users.  They are not needed
# for the new mapping, but Backspace and +/- remain useful in the web UI.
RESET_KEY = "backspace"
SPEED_UP_KEYS = ("+", "=")
SPEED_DOWN_KEYS = ("-", "_")

LIFTER_COMMANDS = {-1: "lifter-down", 0: "lifter-stop", +1: "lifter-up"}

HELP_TEXT = """\
Arm selection (number keys)
  1          Left arm
  2          Right arm
  3          Both arms (synchronized)

Translation
  W / S      +/- X
  A / D      +/- Y
  R / F      +/- Z

Rotation
  I / K      +/- Pitch
  J / L      +/- Yaw
  U / O      +/- Roll

Gripper
  G          Close
  H          Open

Lifter
  Q          Up
  E          Down

Control
  Shift      Slow / precision while held
  Esc        Disable / enable teleoperation

Compatibility controls
  Backspace  reset both arms to their home pose
  + / -      speed scale up / down\
"""
