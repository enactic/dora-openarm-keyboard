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

// Position control for a gripper the node only knows how to move.
//
// The node opens or closes a gripper at a fixed speed for as long as its key
// is down, clamps at fully open (0) and fully closed (1), and reports nothing
// back. A slider wants a position. So this class keeps an estimate of where
// the gripper is, drives the open or close key through the pulser at the
// current preset until the estimate reaches the target, and — at either end —
// deliberately aims past the end so the node's clamp re-synchronises the
// estimate.
//
// The estimate only ever moves for two reasons: measured time spent driving
// a key, and the snap to an end after the overshoot. In particular it is
// never set to the target just because the follower stopped near it — that
// would let a slow drag, whose increments each sit inside the arrive band,
// walk the estimate across the slider while the gripper never moved.
//
// Time is measured, not assumed: a throttled page (a hidden tab, Low Power
// Mode) fires the ticker late, and the key was down the whole time.
//
// Timers and the clock are injected so tests can drive a fake clock.

// Close enough to count as arrived, in gripper fraction.
const EPSILON = 0.02;

// How far past an end the estimate aims, so the node is certainly clamped
// there by the time the follower stops.
const END_MARGIN = 0.15;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

export class GripFollower {
  constructor({
    keys,
    speed,
    drive,
    preset,
    onUpdate = () => {},
    period = 20,
    now = () => globalThis.performance.now(),
    setInterval = globalThis.setInterval,
    clearInterval = globalThis.clearInterval,
  }) {
    this._keys = keys;
    this._speed = speed;
    this._drive = drive;
    this._preset = preset;
    this._onUpdate = onUpdate;
    this._period = period;
    this._now = now;
    // Plain calls, never `this._timers.setInterval(...)` on a native: see
    // pulser.js for why.
    this._timers = {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    };
    this.estimate = 0; // fully open: the home keyframe's gripper
    this.target = 0;
    this._goal = 0;
    this._ticker = null;
    // What is on the wire right now, so a tick can credit the time since the
    // last one to the estimate.
    this._driving = false;
    this._direction = 0;
    this._duty = 0;
    this._lastTick = 0;
  }

  setTarget(value) {
    if (!Number.isFinite(value)) return;
    const wanted = clamp01(value);
    // Snap to the ends: a slider thumb rarely lands on exactly 0 or 1, and an
    // end is the one place the estimate can be made exact.
    this.target = wanted <= EPSILON ? 0 : wanted >= 1 - EPSILON ? 1 : wanted;
    if (this.target === 1) this._goal = 1 + END_MARGIN;
    else if (this.target === 0) this._goal = -END_MARGIN;
    else this._goal = this.target;
    if (this._ticker === null) {
      this._lastTick = this._now();
      this._ticker = this._timers.setInterval(() => this._tick(), this._period);
    }
    this._tick();
  }

  // The safety path: stop driving and accept wherever the gripper is as the
  // new target, so nothing keeps moving after the operator is gone.
  stop() {
    this._credit();
    this._halt();
    this.estimate = clamp01(this.estimate);
    this.target = this.estimate;
    this._goal = this.target;
    this._onUpdate(this.estimate, this.target);
  }

  // Credit the time since the last tick to the estimate, if a key was down.
  _credit() {
    const now = this._now();
    if (this._driving) {
      const seconds = (now - this._lastTick) / 1000;
      this.estimate += this._direction * this._speed * this._duty * seconds;
    }
    this._lastTick = now;
  }

  _tick() {
    // The error just before this tick's credit, under whatever goal is
    // current: if setTarget just changed the goal, this and the post-credit
    // error below are both against the new goal, so a legitimate reversal
    // never looks like a crossing. Only the credit step itself can move the
    // estimate, so a sign flip between the two can only mean the elapsed
    // time just applied — a late, throttled tick crediting far more than a
    // normal step — carried the estimate across the goal already.
    const before = this._goal - this.estimate;
    this._credit();
    const error = this._goal - this.estimate;
    const duty = this._preset();
    const step = this._speed * duty * (this._period / 1000);
    const threshold = Math.max(EPSILON, step / 2);
    // Arrive when driving one more tick would overshoot by more than it
    // gains (the residual is at most half a step or EPSILON), or when the
    // credit just applied already carried the estimate past the goal.
    // Reversing immediately would just repeat the same stale-credit problem
    // next tick; stop instead and let the next real target update correct
    // it.
    const crossed =
      this._driving &&
      Math.sign(before) !== 0 &&
      Math.sign(error) !== Math.sign(before);
    if (Math.abs(error) <= threshold || crossed) {
      this._arrive();
      return;
    }
    this._direction = Math.sign(error);
    this._duty = duty;
    this._driving = true;
    this._drive(
      [this._direction > 0 ? this._keys.close : this._keys.open],
      duty,
    );
    this._onUpdate(clamp01(this.estimate), this.target);
  }

  _arrive() {
    this._halt();
    // At an end the node has been clamped for END_MARGIN of travel, so the
    // end is exactly where the gripper is. Mid-range the estimate stays what
    // the drive time says it is; it is never moved to the target by fiat.
    if (this.target === 0 || this.target === 1) this.estimate = this.target;
    this._onUpdate(clamp01(this.estimate), this.target);
  }

  _halt() {
    if (this._ticker !== null) {
      this._timers.clearInterval(this._ticker);
      this._ticker = null;
    }
    if (this._driving) this._drive([], 0);
    this._driving = false;
  }
}
