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

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KEYMAP,
  KeyChord,
  stickKeys,
  stickVector,
} from "../../src/dora_openarm_keyboard/static/ipad/controls.js";

test("deadzone yields no keys", () => {
  assert.deepEqual(stickKeys(0.1, -0.1, KEYMAP.leftStick), new Set());
});

test("pure up holds only the up key", () => {
  assert.deepEqual(stickKeys(0, -1, KEYMAP.leftStick), new Set(["w"]));
});

test("diagonal up-left holds both axes", () => {
  assert.deepEqual(
    stickKeys(-0.7, -0.7, KEYMAP.leftStick),
    new Set(["w", "a"]),
  );
});

test("near-axis push stays single-key", () => {
  // 10 degrees off vertical is inside the 22.5-degree sector.
  const dx = Math.sin((10 * Math.PI) / 180);
  const dy = -Math.cos((10 * Math.PI) / 180);
  assert.deepEqual(stickKeys(dx, dy, KEYMAP.rightStick), new Set(["i"]));
});

test("KeyChord emits only changes and unions sources", () => {
  const events = [];
  const chord = new KeyChord((type, key) => events.push([type, key]));
  chord.set("stick", ["w", "a"]);
  chord.set("rot", ["Shift"]);
  chord.set("stick", ["w"]);
  assert.deepEqual(events, [
    ["keydown", "w"],
    ["keydown", "a"],
    ["keydown", "Shift"],
    ["keyup", "a"],
  ]);
  assert.deepEqual(chord.held(), new Set(["w", "Shift"]));
});

test("a key held by two sources survives one source dropping it", () => {
  const events = [];
  const chord = new KeyChord((type, key) => events.push([type, key]));
  chord.set("a", ["w"]);
  chord.set("b", ["w"]);
  chord.set("a", []);
  assert.deepEqual(events, [["keydown", "w"]]);
});

test("releaseAll releases everything and clears sources", () => {
  const events = [];
  const chord = new KeyChord((type, key) => events.push([type, key]));
  chord.set("stick", ["w", "a"]);
  chord.releaseAll();
  assert.deepEqual(events.slice(2).sort(), [
    ["keyup", "a"],
    ["keyup", "w"],
  ]);
  assert.deepEqual(chord.held(), new Set());
});

test("stickVector: inside the deadzone there are no keys and zero magnitude", () => {
  assert.deepEqual(stickVector(0.1, -0.1, KEYMAP.leftStick), {
    keys: new Set(),
    magnitude: 0,
  });
});

test("stickVector: magnitude runs 0→1 across the band past the deadzone", () => {
  // Deadzone 0.2, so 0.6 is halfway across the remaining 0.8.
  const half = stickVector(0, -0.6, KEYMAP.leftStick);
  assert.deepEqual(half.keys, new Set(["w"]));
  assert.ok(Math.abs(half.magnitude - 0.5) < 1e-9);
  const full = stickVector(0, -1, KEYMAP.leftStick);
  assert.equal(full.magnitude, 1);
});

test("stickVector: past the ring the magnitude clamps at 1", () => {
  assert.equal(stickVector(0, 1.7, KEYMAP.rightStick).magnitude, 1);
});

test("stickVector: diagonals hold both keys", () => {
  assert.deepEqual(
    stickVector(-0.7, -0.7, KEYMAP.leftStick).keys,
    new Set(["w", "a"]),
  );
});

test("stickVector: honours a custom deadzone", () => {
  assert.deepEqual(
    stickVector(0.3, 0, KEYMAP.leftStick, { deadzone: 0.35 }).keys,
    new Set(),
  );
});

test("reset forgets held keys without sending their release", () => {
  const events = [];
  const chord = new KeyChord((type, key) => events.push([type, key]));
  chord.set("z", ["r"]);
  chord.reset();
  chord.set("z", []);
  chord.releaseAll();
  assert.deepEqual(events, [["keydown", "r"]]);
  assert.deepEqual(chord.held(), new Set());
});
