// Copyright 2026 Enactic, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Pure control-mapping logic: no DOM, no WebRTC, so `node --test` can
// exercise it directly. ui.js turns pointer events into calls here; the
// resulting keydown/keyup events speak dora-openarm-keyboard's keymap.

export const KEYMAP = {
  leftStick: { up: "w", down: "s", left: "a", right: "d" },
  rightStick: { up: "i", down: "k", left: "j", right: "l" },
  leftZ: { up: "r", down: "f" },
  rightZ: { up: "y", down: "h" },
  leftGrip: { open: "c", close: "x" },
  rightGrip: { open: "n", close: "m" },
  rotate: "Shift",
  home: "0",
  quit: "Escape",
};

// A component within 22.5 degrees of an axis is that axis alone; past it,
// diagonals hold both keys — standard 8-way sectoring.
const AXIS_RATIO = Math.sin((22.5 * Math.PI) / 180);

// A stick vector is measured from the ring centre and normalised by the ring
// radius, so 1 is the rim. Inside the deadzone nothing is held; past it the
// 8-way sectoring picks the keys and the remaining band is stretched to a
// 0..1 magnitude, reported for drawing. Speed is not proportional to it: the
// HUD drives the pulser from the SPEED preset alone.
export function stickVector(dx, dy, stickMap, { deadzone = 0.2 } = {}) {
  const keys = new Set();
  const length = Math.hypot(dx, dy);
  if (length < deadzone) return { keys, magnitude: 0 };
  if (Math.abs(dy) >= length * AXIS_RATIO) {
    keys.add(dy < 0 ? stickMap.up : stickMap.down);
  }
  if (Math.abs(dx) >= length * AXIS_RATIO) {
    keys.add(dx < 0 ? stickMap.left : stickMap.right);
  }
  const magnitude = Math.min(1, (length - deadzone) / (1 - deadzone));
  return { keys, magnitude };
}

// Kept for the original 4-way tests; production goes through stickVector
// and its 0.2 deadzone, so this default matches nothing on the page.
export function stickKeys(dx, dy, stickMap, deadzone = 0.35) {
  return stickVector(dx, dy, stickMap, { deadzone }).keys;
}

export class KeyChord {
  constructor(send) {
    this._send = send;
    this._sources = new Map();
    this._held = new Set();
  }

  held() {
    return new Set(this._held);
  }

  // Forget everything without sending. For a link that has just come up: the
  // keys recorded while it was down were never delivered, so releasing them
  // now would send the node a keyup for a key it never saw pressed.
  reset() {
    this._sources.clear();
    this._held = new Set();
  }

  set(source, keys) {
    this._sources.set(source, new Set(keys));
    this._sync();
  }

  releaseAll() {
    this._sources.clear();
    this._sync();
  }

  _sync() {
    const wanted = new Set();
    for (const keys of this._sources.values()) {
      for (const key of keys) wanted.add(key);
    }
    for (const key of this._held) {
      if (!wanted.has(key)) this._send("keyup", key);
    }
    for (const key of wanted) {
      if (!this._held.has(key)) this._send("keydown", key);
    }
    this._held = wanted;
  }
}
