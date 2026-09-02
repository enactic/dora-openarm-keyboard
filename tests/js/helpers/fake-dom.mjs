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

// Just enough of an Element for the widget binders: listeners, pointer
// capture, classList, and a configurable bounding rect.
class FakeClassList {
  constructor() {
    this._set = new Set();
  }
  add(...names) {
    for (const name of names) this._set.add(name);
  }
  remove(...names) {
    for (const name of names) this._set.delete(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : force;
    if (on) this._set.add(name);
    else this._set.delete(name);
    return on;
  }
  contains(name) {
    return this._set.has(name);
  }
}

export class FakeElement {
  constructor({ rect = { left: 0, top: 0, width: 100, height: 100 } } = {}) {
    this.rect = rect;
    this.classList = new FakeClassList();
    this.captured = new Set();
    this._listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  setPointerCapture(pointerId) {
    this.captured.add(pointerId);
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  // Dispatches a synthetic event to this element's listeners. clientX/Y
  // default to the element's centre so "inside" checks pass unless a test
  // says otherwise.
  fire(type, { pointerId = 1, clientX, clientY } = {}) {
    const rect = this.getBoundingClientRect();
    const event = {
      type,
      pointerId,
      clientX: clientX ?? rect.left + rect.width / 2,
      clientY: clientY ?? rect.top + rect.height / 2,
      preventDefault() {},
    };
    for (const handler of this._listeners.get(type) ?? []) handler(event);
    return event;
  }
}
