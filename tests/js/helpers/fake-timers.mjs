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

// A deterministic stand-in for the browser timer functions. Timers fire in
// time order when advance() crosses them; an interval re-arms itself.
export class FakeClock {
  constructor() {
    this.now = 0;
    this._timers = new Map();
    this._nextId = 1;
    this.setTimeout = (fn, ms) => this._add(fn, ms, false);
    this.setInterval = (fn, ms) => this._add(fn, ms, true);
    this.clearTimeout = (id) => {
      this._timers.delete(id);
    };
    this.clearInterval = (id) => {
      this._timers.delete(id);
    };
  }

  pending() {
    return this._timers.size;
  }

  advance(ms) {
    const end = this.now + ms;
    for (;;) {
      let next = null;
      for (const [id, timer] of this._timers) {
        if (timer.at > end) continue;
        if (next === null || timer.at < next.timer.at) next = { id, timer };
      }
      if (next === null) break;
      this.now = next.timer.at;
      if (next.timer.repeat) {
        next.timer.at += next.timer.ms;
      } else {
        this._timers.delete(next.id);
      }
      next.timer.fn();
    }
    this.now = end;
  }

  _add(fn, ms, repeat) {
    const id = this._nextId;
    this._nextId += 1;
    this._timers.set(id, { fn, ms, repeat, at: this.now + ms });
    return id;
  }
}
