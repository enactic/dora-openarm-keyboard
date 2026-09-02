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

import { KeyChord } from "../../src/dora_openarm_keyboard/static/ipad/controls.js";
import { Pulser } from "../../src/dora_openarm_keyboard/static/ipad/pulser.js";
import { FakeClock } from "./helpers/fake-timers.mjs";

// Every event is stamped with the fake clock's time so the tests assert on
// the timing, not just the order.
function harness() {
  const clock = new FakeClock();
  const events = [];
  const chord = new KeyChord((type, key) =>
    events.push([clock.now, type, key]),
  );
  const pulser = new Pulser(chord, { period: 40, ...clock });
  return { clock, events, pulser };
}

test("a pulsed key goes down at the period start and up after duty × period", () => {
  const { clock, events, pulser } = harness();
  pulser.set("z", ["r"], 0.25);
  clock.advance(100);
  assert.deepEqual(events, [
    [0, "keydown", "r"],
    [10, "keyup", "r"],
    [40, "keydown", "r"],
    [50, "keyup", "r"],
    [80, "keydown", "r"],
    [90, "keyup", "r"],
  ]);
});

test("duty 1 holds the key without pulsing", () => {
  const { clock, events, pulser } = harness();
  pulser.set("z", ["r"], 1);
  clock.advance(200);
  assert.deepEqual(events, [[0, "keydown", "r"]]);
  assert.equal(clock.pending(), 0);
});

test("duty 0 or an empty key set releases immediately", () => {
  const { clock, events, pulser } = harness();
  pulser.set("z", ["r"], 0.25);
  clock.advance(5);
  pulser.set("z", [], 0);
  clock.advance(100);
  assert.deepEqual(events, [
    [0, "keydown", "r"],
    [5, "keyup", "r"],
  ]);
  assert.equal(clock.pending(), 0);
});

test("a duty change applies from the next period start", () => {
  const { clock, events, pulser } = harness();
  pulser.set("z", ["r"], 0.25);
  clock.advance(5);
  pulser.set("z", ["r"], 0.75);
  clock.advance(70); // to t = 75: past the 70 ms key-up, before the 80 ms tick
  assert.deepEqual(events, [
    [0, "keydown", "r"],
    [10, "keyup", "r"],
    [40, "keydown", "r"],
    [70, "keyup", "r"],
  ]);
});

test("a key-set change during the on-phase applies immediately", () => {
  const { clock, events, pulser } = harness();
  pulser.set("stick", ["w"], 0.5);
  clock.advance(5);
  pulser.set("stick", ["w", "d"], 0.5);
  clock.advance(20);
  assert.deepEqual(events, [
    [0, "keydown", "w"],
    [5, "keydown", "d"],
    [20, "keyup", "w"],
    [20, "keyup", "d"],
  ]);
});

test("sources share one ticker, so a later source waits for the next boundary", () => {
  const { clock, events, pulser } = harness();
  pulser.set("a", ["w"], 0.25);
  clock.advance(15);
  pulser.set("b", ["i"], 0.25);
  clock.advance(40);
  assert.deepEqual(events, [
    [0, "keydown", "w"],
    [10, "keyup", "w"],
    [40, "keydown", "w"],
    [40, "keydown", "i"],
    [50, "keyup", "w"],
    [50, "keyup", "i"],
  ]);
});

test("releaseAll cancels pending key-ups, releases the chord and stops the ticker", () => {
  const { clock, events, pulser } = harness();
  pulser.set("z", ["r"], 0.5);
  pulser.set("rot", ["Shift"], 1);
  clock.advance(5);
  pulser.releaseAll();
  clock.advance(200);
  assert.deepEqual(events.slice(0, 2), [
    [0, "keydown", "r"],
    [0, "keydown", "Shift"],
  ]);
  assert.deepEqual(events.slice(2).sort(), [
    [5, "keyup", "Shift"],
    [5, "keyup", "r"],
  ]);
  assert.equal(clock.pending(), 0);
});

test("the ticker stops once no source is pulsing", () => {
  const { clock, pulser } = harness();
  pulser.set("z", ["r"], 0.5);
  clock.advance(5);
  pulser.set("z", ["r"], 1);
  clock.advance(100);
  assert.equal(clock.pending(), 0);
});

// Browsers throw "Illegal invocation" when a native timer function is called
// as a method of any object but the window. Node's timers don't care, so this
// stand-in enforces the browser rule on top of the fake clock.
function browserLikeTimers(clock) {
  const strict = (fn) =>
    function (...args) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return fn(...args);
    };
  return {
    setTimeout: strict(clock.setTimeout),
    clearTimeout: strict(clock.clearTimeout),
    setInterval: strict(clock.setInterval),
    clearInterval: strict(clock.clearInterval),
  };
}

test("a NaN duty releases instead of falling through", () => {
  const { clock, events, pulser } = harness();
  pulser.set("z", ["r"], 1);
  pulser.set("z", ["r"], Number.NaN);
  clock.advance(100);
  assert.deepEqual(events, [
    [0, "keydown", "r"],
    [0, "keyup", "r"],
  ]);
  assert.equal(clock.pending(), 0);
});

test("timer functions are called as plain functions, the way browsers require", () => {
  const clock = new FakeClock();
  const events = [];
  const chord = new KeyChord((type, key) =>
    events.push([clock.now, type, key]),
  );
  const pulser = new Pulser(chord, { period: 40, ...browserLikeTimers(clock) });
  pulser.set("z", ["r"], 0.25);
  clock.advance(45);
  pulser.set("z", ["r"], 1);
  pulser.releaseAll();
  assert.deepEqual(events, [
    [0, "keydown", "r"],
    [10, "keyup", "r"],
    [40, "keydown", "r"],
    [45, "keyup", "r"],
  ]);
  assert.equal(clock.pending(), 0);
});
