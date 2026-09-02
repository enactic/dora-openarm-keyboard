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

import { GripFollower } from "../../src/dora_openarm_keyboard/static/ipad/grip.js";
import { FakeClock } from "./helpers/fake-timers.mjs";

// Records every drive() call with the clock time; `preset` is a mutable box
// so a test can change it mid-move.
function harness({ preset = 1, speed = 2 } = {}) {
  const clock = new FakeClock();
  const drives = [];
  const updates = [];
  const box = { preset };
  const follower = new GripFollower({
    keys: { open: "c", close: "x" },
    speed,
    drive: (keys, duty) => drives.push([clock.now, [...keys], duty]),
    preset: () => box.preset,
    onUpdate: (estimate, target) => updates.push([clock.now, estimate, target]),
    period: 20,
    now: () => clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  });
  return { clock, drives, updates, box, follower };
}

test("a mid-range target drives the close key until the estimate arrives, then stops", () => {
  const { clock, drives, follower } = harness();
  follower.setTarget(0.5);
  assert.deepEqual(drives[0], [0, ["x"], 1]);
  clock.advance(1000);
  const last = drives[drives.length - 1];
  assert.deepEqual(last.slice(1), [[], 0]);
  // 0.5 at 2/s is 250 ms; the estimate arrives within one 20 ms step.
  assert.ok(last[0] >= 240 && last[0] <= 260, `stopped at ${last[0]} ms`);
  assert.ok(Math.abs(follower.estimate - 0.5) <= 0.02 + 1e-9, `estimate ${follower.estimate}`);
  assert.equal(follower.target, 0.5);
  assert.equal(clock.pending(), 0);
});

test("a target below the estimate drives the open key", () => {
  const { clock, drives, follower } = harness();
  follower.setTarget(0.5);
  clock.advance(1000);
  follower.setTarget(0.25);
  assert.deepEqual(drives[drives.length - 1].slice(1), [["c"], 1]);
  clock.advance(1000);
  assert.ok(Math.abs(follower.estimate - 0.25) <= 0.02 + 1e-9, `estimate ${follower.estimate}`);
  assert.deepEqual(drives[drives.length - 1].slice(1), [[], 0]);
});

test("an end target overshoots the estimate so the node's clamp resyncs, then snaps to the end", () => {
  const { clock, drives, follower } = harness();
  follower.setTarget(1);
  clock.advance(2000);
  const last = drives[drives.length - 1];
  // 1.15 at 2/s is 575 ms, well past the 500 ms the bare travel would take.
  assert.ok(last[0] >= 560 && last[0] <= 600, `stopped at ${last[0]} ms`);
  assert.equal(follower.estimate, 1);
  assert.equal(follower.target, 1);
  follower.setTarget(0);
  clock.advance(2000);
  assert.equal(follower.estimate, 0);
  assert.deepEqual(drives[drives.length - 1].slice(1), [[], 0]);
});

test("the preset scales the drive duty and the estimate's rate", () => {
  const { clock, drives, follower } = harness({ preset: 0.25 });
  follower.setTarget(0.5);
  assert.deepEqual(drives[0], [0, ["x"], 0.25]);
  clock.advance(3000);
  const last = drives[drives.length - 1];
  assert.ok(last[0] >= 940 && last[0] <= 1000, `stopped at ${last[0]} ms`);
});

test("a preset change mid-move is picked up on the next tick", () => {
  const { clock, drives, box, follower } = harness({ preset: 1 });
  follower.setTarget(1);
  clock.advance(100);
  box.preset = 0.5;
  clock.advance(20);
  assert.deepEqual(drives[drives.length - 1].slice(1), [["x"], 0.5]);
});

test("reversing the target mid-move switches keys at once", () => {
  const { clock, drives, follower } = harness();
  follower.setTarget(0.8);
  clock.advance(100); // estimate 0.2
  follower.setTarget(0.1);
  assert.deepEqual(drives[drives.length - 1].slice(1), [["c"], 1]);
});

test("stop halts the drive, freezes the target at the estimate and clears the ticker", () => {
  const { clock, drives, follower } = harness();
  follower.setTarget(1);
  clock.advance(100); // estimate 0.2
  follower.stop();
  assert.deepEqual(drives[drives.length - 1].slice(1), [[], 0]);
  assert.ok(Math.abs(follower.estimate - 0.2) < 1e-9);
  assert.equal(follower.target, follower.estimate);
  assert.equal(clock.pending(), 0);
  clock.advance(1000);
  assert.deepEqual(drives[drives.length - 1].slice(1), [[], 0]);
});

test("targets within epsilon of an end snap to it, and onUpdate reports clamped estimates", () => {
  const { clock, updates, follower } = harness();
  follower.setTarget(0.99);
  assert.equal(follower.target, 1);
  clock.advance(2000);
  for (const [, estimate] of updates) {
    assert.ok(estimate >= 0 && estimate <= 1, `estimate ${estimate} out of range`);
  }
});

test("a slow drag still drives the gripper: the estimate is never snapped to the target", () => {
  const { clock, drives, follower } = harness({ preset: 0.5 });
  // 100 pointer moves of 0.01, one per 20 ms tick, then let it settle.
  for (let i = 1; i <= 100; i++) {
    follower.setTarget(i / 100);
    clock.advance(20);
  }
  clock.advance(1500);
  let held = 0;
  let downSince = null;
  for (const [at, keys] of drives) {
    if (keys.length && downSince === null) downSince = at;
    if (!keys.length && downSince !== null) {
      held += at - downSince;
      downSince = null;
    }
  }
  // 1.15 of travel at 1/s (speed 2 × preset 0.5) needs 1150 ms on the wire.
  assert.ok(held >= 1100, `key held only ${held} ms`);
  assert.equal(follower.estimate, 1);
  assert.deepEqual(drives[drives.length - 1].slice(1), [[], 0]);
});

test("a late tick credits the whole time the key was down", () => {
  const { clock, drives, follower } = harness();
  follower.setTarget(0.5);
  // The ticker fires late, as a throttled page would: 300 ms in one jump.
  clock._timers.forEach((timer) => { timer.at += 280; });
  clock.advance(300);
  assert.ok(follower.estimate >= 0.5 - 1e-9, `estimate ${follower.estimate}`);
  assert.deepEqual(drives[drives.length - 1].slice(1), [[], 0]);
});

test("setTarget ignores a non-finite value", () => {
  const { drives, follower } = harness();
  follower.setTarget(Number.NaN);
  assert.equal(drives.length, 0);
  assert.equal(follower.target, 0);
});
