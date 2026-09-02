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

// The HUD: pointer events in, virtual key events out.
//
// Two ideas carry this file. Every motion control feeds the Pulser rather
// than the chord directly, so the SPEED preset turns into a duty ratio the
// node experiences as speed. And every control
// registers a reset, so the page-level safety hooks can let go of everything
// — pulses, chord and ROT — in one call.

import { KEYMAP, KeyChord, stickVector } from "./controls.js";
import { Pulser } from "./pulser.js";
import { GripFollower } from "./grip.js";
import { bindHold, bindHoldToConfirm, bindSlider, bindStick, bindTap } from "./widgets.js";
import { connect } from "./app.js";

// Keep in sync with --hold on #home / #quit in style.css: the bar and the
// timer must finish together or the button lies about when it fires.
const HOME_HOLD_MS = 500;
const QUIT_HOLD_MS = 1200;

// How far the cap may slide, as a fraction of the ring radius.
const CAP_TRAVEL = 0.8;

// Every page load starts here; the preset is deliberately not remembered.
const DEFAULT_PRESET = 0.5;

// The node's gripper speed in fraction/s at full duty. Must match the
// node's --grip-speed (dora-openarm-keyboard's DEFAULT_GRIP_SPEED is 2.0);
// the follower's estimate drifts by the ratio otherwise, until the next full
// open or close resyncs it.
const GRIP_SPEED = 2.0;

const STATUS = {
  connecting: "Connecting…",
  online: "Online",
  lost: "Link lost — tap to reconnect",
  failed: "Link failed — tap to reconnect",
};

// States the operator can tap their way out of. From the home screen there
// is no browser chrome, so the status pill is the only route back.
const RECOVERABLE = new Set(["lost", "failed"]);

const dom = {
  video: document.getElementById("video"),
  feedEmpty: document.getElementById("feed-empty"),
  feedNote: document.getElementById("feed-note"),
  link: document.getElementById("link"),
  status: document.getElementById("status"),
  statusDetail: document.getElementById("status-detail"),
  mode: document.getElementById("mode"),
  speed: document.getElementById("speed"),
  info: document.getElementById("info"),
  infoToggle: document.getElementById("info-toggle"),
  help: document.getElementById("help"),
  home: document.getElementById("home"),
  quit: document.getElementById("quit"),
  rotButtons: [
    document.getElementById("rot-left"),
    document.getElementById("rot-right"),
  ],
  stickLabels: document.querySelectorAll(".stick__label"),
  zLabels: document.querySelectorAll(".rocker--z .key__text"),
};

// Filled in once the link exists; until then every control is inert but the
// HUD still responds, so a page loaded before the node is up stays usable.
let link = null;
let preset = DEFAULT_PRESET;
let rotating = false;

// Everything that has to be let go of when the page loses the operator.
const resets = [];
// Controls that re-apply their duty when the preset changes under them.
const refreshers = [];

function send(type, key) {
  if (link) link.send(type, key);
}

const chord = new KeyChord(send);
const pulser = new Pulser(chord);

function releaseEverything() {
  for (const reset of resets) reset();
  pulser.releaseAll();
  setRotate(false);
}

// HOME and QUIT are edge-triggered in the node: it acts on the press, so the
// release follows immediately rather than being held.
function pulse(key) {
  send("keydown", key);
  send("keyup", key);
}

// Every hold button wears the key it sends, the way the stick's ticks do:
// the HUD is its own legend and cannot drift from the keymap.
function badge(element, text) {
  const span = document.createElement("span");
  span.className = "key__badge";
  span.textContent = text;
  element.appendChild(span);
}

// --- HUD state ------------------------------------------------------------

function setLink(state, detail = "") {
  dom.status.textContent = STATUS[state];
  dom.link.dataset.state = state;
  dom.statusDetail.textContent = detail;
  dom.statusDetail.hidden = !detail;
  document.body.classList.toggle("is-offline", state !== "online");
  // The pill only takes a tap when there is something to recover from, so a
  // stray touch cannot stack a second attempt onto one already in flight.
  dom.link.disabled = !RECOVERABLE.has(state);
}

function setRotate(on) {
  rotating = on;
  // Shift is held, never pulsed: cycling it would flip the meaning of the
  // motion keys mid-stroke.
  pulser.set("rot", on ? [KEYMAP.rotate] : [], on ? 1 : 0);
  document.body.classList.toggle("is-rotate", on);
  for (const button of dom.rotButtons) {
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  }
  dom.mode.textContent = on ? "Rotate" : "Translate";
  // The sticks and rockers keep sending the same keys; what changes is what
  // the node does with them, so the legends say so.
  for (const label of dom.stickLabels) {
    label.textContent = on ? "Pitch · Roll" : "X · Y";
  }
  for (const label of dom.zLabels) {
    label.textContent = `${on ? "Yaw" : "Z"} ${label.dataset.arrow}`;
  }
}

function setPreset(value) {
  preset = value;
  for (const button of dom.speed.querySelectorAll("button")) {
    const checked = Number(button.dataset.preset) === value;
    button.setAttribute("aria-checked", String(checked));
  }
  for (const refresh of refreshers) refresh();
}

// A stream whose peer is gone keeps painting its last frame, which is the
// one thing on screen big enough to convince an operator the robot is still
// there. Drop it and say what is actually going on.
function clearVideo(note) {
  dom.video.srcObject = null;
  dom.feedNote.textContent = note;
  dom.feedEmpty.hidden = false;
}

// --- controls -------------------------------------------------------------

function wireStick(side, stickMap) {
  const stick = document.getElementById(`stick-${side}`);
  const ring = stick.querySelector(".stick__ring");
  const cap = stick.querySelector(".stick__cap");
  const ticks = {
    up: stick.querySelector(".stick__tick--up"),
    down: stick.querySelector(".stick__tick--down"),
    left: stick.querySelector(".stick__tick--left"),
    right: stick.querySelector(".stick__tick--right"),
  };
  for (const direction of Object.keys(ticks)) {
    ticks[direction].textContent = stickMap[direction].toUpperCase();
  }
  const source = `stick-${side}`;
  let last = { dx: 0, dy: 0, radius: 0 };

  function draw(dx, dy, radius, keys, duty) {
    const length = Math.hypot(dx, dy);
    const scale = length > CAP_TRAVEL ? CAP_TRAVEL / length : 1;
    cap.style.setProperty("--cx", `${dx * scale * radius}px`);
    cap.style.setProperty("--cy", `${dy * scale * radius}px`);
    cap.style.setProperty("--duty", String(duty));
    for (const direction of Object.keys(ticks)) {
      ticks[direction].classList.toggle("is-on", keys.has(stickMap[direction]));
    }
  }

  function apply() {
    // Digital past the deadzone, like the rockers: the preset alone sets the
    // speed. A proportional response was tried and felt unnatural.
    const { keys } = stickVector(last.dx, last.dy, stickMap);
    const duty = keys.size ? preset : 0;
    pulser.set(source, keys, duty);
    draw(last.dx, last.dy, last.radius, keys, duty);
  }

  bindStick(stick, ring, {
    resets,
    onChange: (vector) => {
      last = vector;
      apply();
    },
    onRelease: () => {
      last = { dx: 0, dy: 0, radius: 0 };
      pulser.set(source, [], 0);
      draw(0, 0, 0, new Set(), 0);
    },
  });
  refreshers.push(() => {
    if (last.radius > 0) apply();
  });
}

// Both segments of a rocker share one source: a rocker cannot be pushed two
// ways at once, so the later press wins and either release stops the axis.
function wireHold(id, source, key) {
  const element = document.getElementById(id);
  badge(element, key.toUpperCase());
  let held = false;

  const apply = () => pulser.set(source, held ? [key] : [], held ? preset : 0);

  bindHold(element, {
    resets,
    onEngage: () => {
      held = true;
      apply();
    },
    onRelease: () => {
      held = false;
      apply();
    },
  });
  refreshers.push(() => {
    if (held) apply();
  });
}

// The gripper slider: the thumb sets a target, the follower drives the
// node's open/close key until its estimate gets there. The whole slider is
// the touch target; the position is measured against the track inside it.
function wireGrip(side, gripMap) {
  const slider = document.getElementById(`grip-${side}`);
  const track = slider.querySelector(".slider__track");
  badge(slider.querySelector(".slider__end--open"), gripMap.open.toUpperCase());
  badge(slider.querySelector(".slider__end--close"), gripMap.close.toUpperCase());
  const source = `grip-${side}`;

  const follower = new GripFollower({
    keys: gripMap,
    speed: GRIP_SPEED,
    drive: (keys, duty) => pulser.set(source, keys, duty),
    preset: () => preset,
    onUpdate: (estimate, target) => {
      track.style.setProperty("--estimate", String(estimate));
      track.style.setProperty("--target", String(target));
    },
  });

  bindSlider(slider, {
    resets,
    onChange: (value) => follower.setTarget(value),
    track,
  });
  resets.push(() => follower.stop());
}

wireStick("left", KEYMAP.leftStick);
wireStick("right", KEYMAP.rightStick);

wireHold("z-left-up", "z-left", KEYMAP.leftZ.up);
wireHold("z-left-down", "z-left", KEYMAP.leftZ.down);
wireHold("z-right-up", "z-right", KEYMAP.rightZ.up);
wireHold("z-right-down", "z-right", KEYMAP.rightZ.down);

wireGrip("left", KEYMAP.leftGrip);
wireGrip("right", KEYMAP.rightGrip);

// ROT is a toggle mirrored on both sides: either thumb can flip it.
for (const button of dom.rotButtons) {
  badge(button, KEYMAP.rotate);
  bindTap(button, { resets, onTap: () => setRotate(!rotating) });
}

bindHoldToConfirm(dom.home, {
  holdMs: HOME_HOLD_MS,
  resets,
  onFire: () => pulse(KEYMAP.home),
});
bindHoldToConfirm(dom.quit, {
  holdMs: QUIT_HOLD_MS,
  resets,
  onFire: () => pulse(KEYMAP.quit),
});

for (const button of dom.speed.querySelectorAll("button")) {
  button.addEventListener("click", () => setPreset(Number(button.dataset.preset)));
}

dom.infoToggle.addEventListener("click", () => {
  const open = dom.info.hidden;
  dom.info.hidden = !open;
  dom.infoToggle.setAttribute("aria-expanded", String(open));
});

// --- safety hooks ---------------------------------------------------------

// An unwatched page must never keep the robot moving: losing focus or
// visibility loses the releases that would have stopped it.
window.addEventListener("blur", releaseEverything);
window.addEventListener("pagehide", releaseEverything);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseEverything();
});

// Turning the device to portrait hides the whole HUD behind the rotate gate.
// That fires neither blur nor visibilitychange, and it takes away the very
// control the operator would have to let go of, so drop everything here.
const portrait = window.matchMedia("(orientation: portrait)");
const onPortrait = (event) => {
  if (event.matches) releaseEverything();
};
if (portrait.addEventListener) {
  portrait.addEventListener("change", onPortrait);
} else {
  portrait.addListener(onPortrait); // Safari before 14
}

// --- link -----------------------------------------------------------------

// Each attempt stamps its own callbacks, so a connection being torn down
// cannot report through them afterwards — its onclose would otherwise land
// on the HUD as "link lost" moments after the replacement came up.
let attempt = 0;

function startLink() {
  attempt += 1;
  const mine = attempt;
  const current =
    (handler) =>
    (...args) => {
      if (mine === attempt) handler(...args);
    };

  if (link) link.close();
  link = null;
  releaseEverything();
  clearVideo("Camera feed hasn't arrived. Controls still work.");
  setLink("connecting");

  try {
    link = connect({
      onStatus: current(setLink),
      onOpen: current(() => {
        // A control held while the channel was down never had its keydown
        // sent. Forget those keys first — releasing them would send a keyup
        // the node never saw a keydown for — then let the controls go.
        chord.reset();
        releaseEverything();
        setLink("online");
      }),
      onClose: current(() => {
        releaseEverything();
        clearVideo("The link dropped. Tap the status pill to reconnect.");
        setLink("lost");
      }),
      onTrack: current((stream) => {
        dom.video.srcObject = stream;
        dom.feedEmpty.hidden = true;
        // Autoplay of a muted inline stream is allowed on iOS, but a
        // rejected play() must not take the controls down with it.
        dom.video.play().catch(() => {});
      }),
      onHelp: current((text) => {
        dom.help.textContent = text;
      }),
    });
  } catch (error) {
    // No WebRTC at all (an old or locked-down browser): the HUD stays up and
    // says why rather than dying on module load.
    setLink("failed", error.message);
  }
}

// Nothing here is one-shot: a failed attempt leaves the pill tappable, so
// the operator can keep trying while they bring the node back up.
dom.link.addEventListener("click", startLink);

setRotate(false);
setPreset(DEFAULT_PRESET);
startLink();
