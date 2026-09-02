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

// Duty-cycled key holds on top of KeyChord.
//
// The node moves at full speed for as long as a key is down and integrates
// every 2 ms, so holding a key for a quarter of each 40 ms period makes the
// arm move at a quarter of the speed. Each source (a stick, a rocker, ROT)
// hands this class its key set and a duty ratio; a single ticker shared by
// all sources puts every pulsed key down at the period start and schedules
// its release, so both arms' pulses stay phase-aligned.
//
// Timers are injected so tests can drive a fake clock; the browser passes
// nothing and gets the globals.

export class Pulser {
  constructor(
    chord,
    {
      period = 40,
      setTimeout = globalThis.setTimeout,
      clearTimeout = globalThis.clearTimeout,
      setInterval = globalThis.setInterval,
      clearInterval = globalThis.clearInterval,
    } = {},
  ) {
    this._chord = chord;
    this._period = period;
    // Plain calls, never `this._timers.setTimeout(...)`: a browser's native
    // timer functions throw "Illegal invocation" when called as a method of
    // any object but the window, and Node's silently accept it — the one
    // difference the test runner cannot catch on its own.
    this._timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    };
    // source -> { keys, duty, offTimer }. Entries are mutated in place, never
    // replaced: a pending key-up's timer id lives on the entry, and
    // _cancelOff has to find that same object to cancel it.
    this._sources = new Map();
    this._ticker = null;
  }

  set(source, keys, duty) {
    const wanted = new Set(keys);
    // !(duty > 0) also catches NaN, which would otherwise fall through every
    // branch and silently never press.
    if (wanted.size === 0 || !(duty > 0)) {
      this._drop(source);
      return;
    }
    let entry = this._sources.get(source);
    if (!entry) {
      entry = { keys: wanted, duty, offTimer: null };
      this._sources.set(source, entry);
    }
    entry.keys = wanted;
    entry.duty = duty;
    if (duty >= 1) {
      // Held, not pulsed: identical to a plain chord hold.
      this._cancelOff(entry);
      this._chord.set(source, wanted);
    } else if (entry.offTimer !== null) {
      // Mid on-phase: the new key set goes out now; the duty change waits
      // for the next period start (the pending key-up keeps the old duty).
      this._chord.set(source, wanted);
    }
    this._reconcileTicker();
  }

  releaseAll() {
    for (const entry of this._sources.values()) this._cancelOff(entry);
    this._sources.clear();
    this._stopTicker();
    this._chord.releaseAll();
  }

  _drop(source) {
    const entry = this._sources.get(source);
    if (!entry) return;
    this._cancelOff(entry);
    this._sources.delete(source);
    this._chord.set(source, []);
    this._reconcileTicker();
  }

  _cancelOff(entry) {
    if (entry.offTimer === null) return;
    this._timers.clearTimeout(entry.offTimer);
    entry.offTimer = null;
  }

  _tick() {
    for (const [source, entry] of this._sources) {
      if (entry.duty >= 1) continue;
      this._cancelOff(entry);
      this._chord.set(source, entry.keys);
      entry.offTimer = this._timers.setTimeout(() => {
        entry.offTimer = null;
        this._chord.set(source, []);
      }, entry.duty * this._period);
    }
  }

  _reconcileTicker() {
    let pulsing = false;
    for (const entry of this._sources.values()) {
      if (entry.duty < 1) pulsing = true;
    }
    if (pulsing && this._ticker === null) {
      // The first pulse starts now; later sources join at the next boundary.
      this._ticker = this._timers.setInterval(() => this._tick(), this._period);
      this._tick();
    } else if (!pulsing) {
      this._stopTicker();
    }
  }

  _stopTicker() {
    if (this._ticker === null) return;
    this._timers.clearInterval(this._ticker);
    this._ticker = null;
  }
}
