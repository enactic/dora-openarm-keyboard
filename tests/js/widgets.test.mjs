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
  bindHold,
  bindHoldToConfirm,
  bindSlider,
  bindStick,
  bindTap,
} from "../../src/dora_openarm_keyboard/static/ipad/widgets.js";
import { FakeElement } from "./helpers/fake-dom.mjs";
import { FakeClock } from "./helpers/fake-timers.mjs";

test("bindHold engages on the first pointer and releases on the last", () => {
  const el = new FakeElement();
  const log = [];
  const resets = [];
  bindHold(el, {
    onEngage: () => log.push("engage"),
    onRelease: () => log.push("release"),
    resets,
  });
  el.fire("pointerdown", { pointerId: 1 });
  el.fire("pointerdown", { pointerId: 2 });
  assert.deepEqual(log, ["engage"]);
  assert.ok(el.classList.contains("is-on"));
  el.fire("pointerup", { pointerId: 1 });
  assert.deepEqual(log, ["engage"]);
  el.fire("pointerup", { pointerId: 2 });
  assert.deepEqual(log, ["engage", "release"]);
  assert.ok(!el.classList.contains("is-on"));
  assert.equal(resets.length, 1);
});

test("bindHold treats lostpointercapture as a release and captures the pointer", () => {
  const el = new FakeElement();
  const log = [];
  bindHold(el, {
    onEngage: () => log.push("engage"),
    onRelease: () => log.push("release"),
    resets: [],
  });
  el.fire("pointerdown", { pointerId: 7 });
  assert.ok(el.captured.has(7));
  el.fire("lostpointercapture", { pointerId: 7 });
  assert.deepEqual(log, ["engage", "release"]);
});

test("bindHold's reset releases an engaged control", () => {
  const el = new FakeElement();
  const log = [];
  const resets = [];
  bindHold(el, {
    onEngage: () => log.push("engage"),
    onRelease: () => log.push("release"),
    resets,
  });
  el.fire("pointerdown", { pointerId: 1 });
  resets[0]();
  assert.deepEqual(log, ["engage", "release"]);
  // The stale pointer must not release again later.
  el.fire("pointerup", { pointerId: 1 });
  assert.deepEqual(log, ["engage", "release"]);
});

test("bindTap fires on release inside and not when the finger slid off", () => {
  const el = new FakeElement();
  let taps = 0;
  bindTap(el, { onTap: () => taps++, resets: [] });
  el.fire("pointerdown");
  assert.ok(el.classList.contains("is-on"));
  el.fire("pointerup");
  assert.equal(taps, 1);
  el.fire("pointerdown");
  el.fire("pointerup", { clientX: 500, clientY: 500 });
  assert.equal(taps, 1);
  assert.ok(!el.classList.contains("is-on"));
});

test("bindHoldToConfirm fires after holdMs and cancels on early release", () => {
  const clock = new FakeClock();
  const el = new FakeElement();
  let fired = 0;
  bindHoldToConfirm(el, {
    holdMs: 500,
    onFire: () => fired++,
    resets: [],
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  el.fire("pointerdown");
  assert.ok(el.classList.contains("is-arming"));
  clock.advance(499);
  assert.equal(fired, 0);
  clock.advance(1);
  assert.equal(fired, 1);
  assert.ok(!el.classList.contains("is-arming"));
  assert.ok(el.classList.contains("is-fired"));
  clock.advance(900);
  assert.ok(!el.classList.contains("is-fired"));
  el.fire("pointerup");

  el.fire("pointerdown");
  clock.advance(200);
  el.fire("pointerup");
  clock.advance(1000);
  assert.equal(fired, 1);
  assert.ok(!el.classList.contains("is-arming"));
});

test("bindHoldToConfirm's reset disarms a pending hold", () => {
  const clock = new FakeClock();
  const el = new FakeElement();
  let fired = 0;
  const resets = [];
  bindHoldToConfirm(el, {
    holdMs: 500,
    onFire: () => fired++,
    resets,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  el.fire("pointerdown");
  resets[0]();
  clock.advance(1000);
  assert.equal(fired, 0);
  assert.equal(clock.pending(), 0);
});

test("bindStick reports the vector from the ring centre in ring radii", () => {
  const hit = new FakeElement({
    rect: { left: 0, top: 0, width: 280, height: 280 },
  });
  const ring = new FakeElement({
    rect: { left: 40, top: 40, width: 200, height: 200 },
  });
  const changes = [];
  let releases = 0;
  bindStick(hit, ring, {
    onChange: (v) => changes.push(v),
    onRelease: () => releases++,
    resets: [],
  });
  hit.fire("pointerdown", { pointerId: 1, clientX: 190, clientY: 140 });
  assert.deepEqual(changes, [{ dx: 0.5, dy: 0, radius: 100 }]);
  assert.ok(hit.classList.contains("is-on"));
  hit.fire("pointermove", { pointerId: 1, clientX: 140, clientY: 40 });
  assert.deepEqual(changes[1], { dx: 0, dy: -1, radius: 100 });
  hit.fire("pointerup", { pointerId: 1 });
  assert.equal(releases, 1);
  assert.ok(!hit.classList.contains("is-on"));
});

test("bindStick ignores a second pointer and releases on lostpointercapture", () => {
  const hit = new FakeElement({
    rect: { left: 0, top: 0, width: 280, height: 280 },
  });
  const ring = new FakeElement({
    rect: { left: 40, top: 40, width: 200, height: 200 },
  });
  const changes = [];
  let releases = 0;
  const resets = [];
  bindStick(hit, ring, {
    onChange: (v) => changes.push(v),
    onRelease: () => releases++,
    resets,
  });
  hit.fire("pointerdown", { pointerId: 1, clientX: 140, clientY: 140 });
  hit.fire("pointerdown", { pointerId: 2, clientX: 240, clientY: 140 });
  hit.fire("pointermove", { pointerId: 2, clientX: 240, clientY: 240 });
  assert.equal(changes.length, 1);
  hit.fire("lostpointercapture", { pointerId: 1 });
  assert.equal(releases, 1);
  resets[0]();
  assert.equal(releases, 1); // idle stick: reset is a no-op
});

test("bindStick's reset releases an engaged stick and forgets its pointer", () => {
  const hit = new FakeElement({
    rect: { left: 0, top: 0, width: 280, height: 280 },
  });
  const ring = new FakeElement({
    rect: { left: 40, top: 40, width: 200, height: 200 },
  });
  let releases = 0;
  const resets = [];
  bindStick(hit, ring, {
    onChange: () => {},
    onRelease: () => releases++,
    resets,
  });
  hit.fire("pointerdown", { pointerId: 1, clientX: 200, clientY: 140 });
  resets[0]();
  assert.equal(releases, 1);
  assert.ok(!hit.classList.contains("is-on"));
  hit.fire("pointerup", { pointerId: 1 });
  assert.equal(releases, 1);
});

test("bindHoldToConfirm cancels when the finger slides off the button", () => {
  const clock = new FakeClock();
  const el = new FakeElement();
  let fired = 0;
  bindHoldToConfirm(el, {
    holdMs: 500,
    onFire: () => fired++,
    resets: [],
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  el.fire("pointerdown");
  clock.advance(200);
  el.fire("pointermove", { clientX: 500, clientY: 500 });
  assert.ok(!el.classList.contains("is-arming"));
  clock.advance(1000);
  assert.equal(fired, 0);
  assert.equal(clock.pending(), 0);
  // The pointer is forgotten: its later lift is a no-op.
  el.fire("pointerup");
  assert.equal(fired, 0);
});

test("bindSlider reports the thumb's position along the track, clamped, on down and move", () => {
  const track = new FakeElement({
    rect: { left: 10, top: 100, width: 40, height: 200 },
  });
  const values = [];
  bindSlider(track, { onChange: (v) => values.push(v), resets: [] });
  track.fire("pointerdown", { pointerId: 1, clientX: 30, clientY: 150 });
  assert.deepEqual(values, [0.25]);
  assert.ok(track.classList.contains("is-on"));
  track.fire("pointermove", { pointerId: 1, clientX: 30, clientY: 400 });
  assert.deepEqual(values, [0.25, 1]);
  track.fire("pointermove", { pointerId: 1, clientX: 30, clientY: 0 });
  assert.deepEqual(values, [0.25, 1, 0]);
  track.fire("pointerup", { pointerId: 1 });
  assert.deepEqual(values, [0.25, 1, 0]); // release reports nothing
  assert.ok(!track.classList.contains("is-on"));
});

test("bindSlider ignores a second pointer and its reset only clears the pressed state", () => {
  const track = new FakeElement({
    rect: { left: 0, top: 0, width: 40, height: 100 },
  });
  const values = [];
  const resets = [];
  bindSlider(track, { onChange: (v) => values.push(v), resets });
  track.fire("pointerdown", { pointerId: 1, clientX: 20, clientY: 50 });
  track.fire("pointerdown", { pointerId: 2, clientX: 20, clientY: 90 });
  track.fire("pointermove", { pointerId: 2, clientX: 20, clientY: 10 });
  assert.deepEqual(values, [0.5]);
  resets[0]();
  assert.ok(!track.classList.contains("is-on"));
  track.fire("pointermove", { pointerId: 1, clientX: 20, clientY: 10 });
  assert.deepEqual(values, [0.5]); // forgotten pointer
});

test("bindSlider measures against a separate track when the touch target is larger", () => {
  const element = new FakeElement({
    rect: { left: 0, top: 0, width: 100, height: 300 },
  });
  const track = new FakeElement({
    rect: { left: 30, top: 50, width: 40, height: 200 },
  });
  const values = [];
  bindSlider(element, { onChange: (v) => values.push(v), resets: [], track });
  element.fire("pointerdown", { pointerId: 1, clientX: 50, clientY: 150 });
  assert.deepEqual(values, [0.5]);
});

test("bindStick ignores a touch that lands outside the ring, but keeps a thumb that slides out", () => {
  const hit = new FakeElement({
    rect: { left: 0, top: 0, width: 280, height: 280 },
  });
  const ring = new FakeElement({
    rect: { left: 40, top: 40, width: 200, height: 200 },
  });
  const changes = [];
  let releases = 0;
  bindStick(hit, ring, {
    onChange: (v) => changes.push(v),
    onRelease: () => releases++,
    resets: [],
  });
  // 1.2 radii from the centre: inside the hit box, outside the ring.
  hit.fire("pointerdown", { pointerId: 1, clientX: 260, clientY: 140 });
  assert.deepEqual(changes, []);
  assert.ok(!hit.classList.contains("is-on"));
  hit.fire("pointerup", { pointerId: 1 });
  assert.equal(releases, 0);
  // Landing inside and sliding out still reports the (clamped later) vector.
  hit.fire("pointerdown", { pointerId: 2, clientX: 190, clientY: 140 });
  hit.fire("pointermove", { pointerId: 2, clientX: 270, clientY: 140 });
  assert.deepEqual(changes[1], { dx: 1.3, dy: 0, radius: 100 });
  hit.fire("pointerup", { pointerId: 2 });
  assert.equal(releases, 1);
});
