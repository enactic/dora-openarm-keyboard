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

// DOM behaviours for the HUD's controls: pointer events in, callbacks out.
//
// Every control here is a hold of some kind, and the node keeps moving for
// as long as a key is down, so what matters most is that every press is
// guaranteed a release. Pointer capture per pointerId keeps a finger's events
// coming to the control it started on even after it slides off; the release
// set below covers every way capture can end. Each binder pushes a reset onto
// the caller's list so the page can let go of everything at once.

// Capture throws if the pointer is already gone, which must not abort the
// rest of the handler: an engaged control that never registered would never
// let go.
function capture(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer already lifted; the release path still runs.
  }
}

// pointerup and pointercancel are the finger lifting; lostpointercapture is
// capture ending for any other reason — the HUD being display:none'd by an
// orientation flip is the one that bites. Handlers are idempotent because a
// normal pointerup is followed by lostpointercapture for the same pointer.
function bindRelease(element, handler) {
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    element.addEventListener(type, handler);
  }
}

function inside(element, event) {
  const rect = element.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

// A hold button. Several fingers may land on one button (or one finger may
// roll across two); it stays engaged until the last of them lifts.
export function bindHold(element, { onEngage, onRelease, resets }) {
  const pointers = new Set();

  const disengage = () => {
    if (pointers.size === 0) return;
    pointers.clear();
    element.classList.remove("is-on");
    onRelease();
  };

  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    capture(element, event.pointerId);
    const wasIdle = pointers.size === 0;
    pointers.add(event.pointerId);
    if (wasIdle) {
      element.classList.add("is-on");
      onEngage();
    }
  });

  bindRelease(element, (event) => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size === 0) {
      element.classList.remove("is-on");
      onRelease();
    }
  });

  resets.push(disengage);
}

// Tap: fires on release, and only if the finger is still on the control —
// sliding off cancels, the way a panel button does not commit until you do.
export function bindTap(element, { onTap, resets }) {
  let pointerId = null;

  const cancel = () => {
    pointerId = null;
    element.classList.remove("is-on");
  };

  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    capture(element, pointerId);
    element.classList.add("is-on");
  });

  bindRelease(element, (event) => {
    if (event.pointerId !== pointerId) return;
    const committed = event.type === "pointerup" && inside(element, event);
    cancel();
    if (committed) onTap();
  });

  resets.push(cancel);
}

// Hold-to-confirm: HOME and QUIT cost a deliberate hold. Letting go early or
// sliding off cancels; the CSS bar shows the progress over the same span.
export function bindHoldToConfirm(
  element,
  {
    holdMs,
    onFire,
    resets,
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout,
  },
) {
  let pointerId = null;
  let timer = null;

  const disarm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pointerId = null;
    element.classList.remove("is-arming");
  };

  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    capture(element, pointerId);
    element.classList.add("is-arming");
    timer = setTimeout(() => {
      timer = null;
      element.classList.remove("is-arming");
      element.classList.add("is-fired");
      onFire();
      setTimeout(() => element.classList.remove("is-fired"), 900);
    }, holdMs);
  });

  // Sliding off cancels, the same way a tap does: capture keeps the moves
  // coming, so the button can notice the finger leaving it.
  element.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    if (!inside(element, event)) disarm();
  });

  bindRelease(element, (event) => {
    if (event.pointerId !== pointerId) return;
    disarm();
  });

  resets.push(disarm);
}

// Fixed stick: the ring never moves, so the vector is simply the touch point
// measured from the ring centre in ring radii. A thumb landing off-centre
// deflects the stick at once, which is why ui.js keeps a deadzone.
export function bindStick(hit, ring, { onChange, onRelease, resets }) {
  let pointerId = null;

  const vector = (event) => {
    const rect = ring.getBoundingClientRect();
    const radius = rect.width / 2;
    const centreX = rect.left + radius;
    const centreY = rect.top + rect.height / 2;
    return {
      dx: (event.clientX - centreX) / radius,
      dy: (event.clientY - centreY) / radius,
      radius,
    };
  };

  const clear = () => {
    if (pointerId === null) return;
    pointerId = null;
    hit.classList.remove("is-on");
    onRelease();
  };

  hit.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (pointerId !== null) return; // one thumb per stick
    // The hit box is wider than the ring so a thumb at the rim still lands,
    // but a touch outside the ring itself is not a stick input: taking it
    // would start the arm at full deflection from a stray brush.
    const first = vector(event);
    if (Math.hypot(first.dx, first.dy) > 1) return;
    pointerId = event.pointerId;
    capture(hit, pointerId);
    hit.classList.add("is-on");
    onChange(first);
  });

  hit.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    onChange(vector(event));
  });

  bindRelease(hit, (event) => {
    if (event.pointerId !== pointerId) return;
    clear();
  });

  resets.push(clear);
}

// Vertical slider: the value is where the thumb is along the track, 0 at the
// top and 1 at the bottom, reported on every touch and move. Release reports
// nothing — the value stays where the thumb left it, which is the point of
// a slider over a hold button. The touch target (`element`) may be larger
// than the visible track it is measured against — a thin track is too small
// a thing to ask a thumb to hit.
export function bindSlider(element, { onChange, resets, track = element }) {
  let pointerId = null;

  const value = (event) => {
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  };

  const clear = () => {
    if (pointerId === null) return;
    pointerId = null;
    element.classList.remove("is-on");
  };

  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    capture(element, pointerId);
    element.classList.add("is-on");
    onChange(value(event));
  });

  element.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    onChange(value(event));
  });

  bindRelease(element, (event) => {
    if (event.pointerId !== pointerId) return;
    clear();
  });

  resets.push(clear);
}
