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

// The touch HUD's link to the node: the same negotiation as teleop.js — a
// data channel "keys", a recvonly video transceiver, non-trickle ICE and a
// single POST to the offer endpoint — with the DOM kept out. ui.js owns
// every pixel; this module only reports what the link is doing through
// the callbacks it is handed.

const ICE_SERVERS = [{ urls: ["stun:stun.cloudflare.com:3478"] }];

// Peer-connection states that mean the robot is no longer reachable.
const DOWN_STATES = new Set(["disconnected", "failed", "closed"]);

const noop = () => {};

// onStatus(state, detail) receives "connecting" once and "failed" with a
// human-readable reason if negotiation never completes; the open/closed edges
// come through onOpen/onClose instead.
export function connect({
  onStatus = noop,
  onHelp = noop,
  onTrack = noop,
  onOpen = noop,
  onClose = noop,
} = {}) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel("keys");

  channel.onopen = () => onOpen();
  channel.onclose = () => onClose();

  // A node that dies without closing anything leaves SCTP none the wiser: the
  // data channel stays "open" against a peer that is gone, and the HUD would
  // go on promising an operator that the robot is listening. ICE is what
  // notices, so the connection's own view of the link has to be reported too.
  // iceConnectionState is watched alongside connectionState because older
  // iPadOS Safari drives the former more reliably; onClose is idempotent, so
  // both of them reporting the same loss is harmless.
  const checkTransport = () => {
    if (
      DOWN_STATES.has(pc.connectionState) ||
      DOWN_STATES.has(pc.iceConnectionState)
    ) {
      onClose();
    }
  };
  pc.onconnectionstatechange = checkTransport;
  pc.oniceconnectionstatechange = checkTransport;

  pc.ontrack = (event) => onTrack(event.streams[0]);
  pc.addTransceiver("video", { direction: "recvonly" });

  // The key bindings arrive over a "help" data channel the node opens, not
  // over HTTP: the help text lives in the node's keymap, and this page may
  // be served by a different host that has no copy of it.
  pc.ondatachannel = (event) => {
    if (event.channel.label !== "help") return;
    event.channel.onmessage = (message) => onHelp(message.data);
  };

  onStatus("connecting");
  negotiate(pc).catch((error) => onStatus("failed", error.message));

  return {
    // Silently drops events while the channel is down. A control that threw
    // here would strand its key as held; the status line is where a lost link
    // gets reported.
    send(type, key) {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify({ type, key }));
      }
    },

    // Reconnecting starts here: a dropped link may still be half-alive, and
    // it has to stop holding its ports and reporting through its callbacks
    // before a replacement is negotiated. Closing the peer connection fires
    // the channel's onclose, so callers need to expect that edge.
    close() {
      pc.close();
    },
  };
}

async function negotiate(pc) {
  await pc.setLocalDescription(await pc.createOffer());
  await iceGathered(pc);

  // The HUD lives in its own directory beside the node's /offer, so the
  // endpoint is one level up; relative like teleop.js, so the page can be
  // hosted under any prefix as long as offer sits next to the directory.
  const response = await fetch("../offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type,
    }),
  });
  if (!response.ok) throw new Error(await signalingError(response));
  await pc.setRemoteDescription(await response.json());
}

// Non-trickle ICE: signaling is a single POST to /offer, and the node only
// learns candidates from the SDP it receives — there is no endpoint to send
// candidates one by one afterwards. setLocalDescription() resolves before
// gathering finishes, so wait until every candidate has been added to
// localDescription.sdp before sending it. The browser has no promise-based
// API for this; bridge the icegatheringstatechange event into an awaitable,
// checking the current state first in case gathering already finished before
// the listener was attached.
function iceGathered(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
  });
}

async function signalingError(response) {
  // The node's own /offer only ever fails with a bare status code. A
  // signaling broker in front of it (WebRTC-only mode) may answer with
  // {"error": "..."} instead; that sentence is the one thing worth putting
  // on the HUD when it exists.
  try {
    const body = await response.json();
    if (body && body.error) return String(body.error);
  } catch {
    // Body was not JSON — fall through to the bare status code.
  }
  return `signaling failed: ${response.status}`;
}
