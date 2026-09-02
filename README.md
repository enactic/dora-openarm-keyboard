# dora-openarm-keyboard

A [dora-rs](https://dora-rs.ai/) node that teleoperates OpenArm from
the keyboard in a Web browser.

The node serves a web page (default `http://127.0.0.1:8080/`) that does
both halves of teleoperation in one browser tab:

- **Keys in**: the page captures the key bindings below and sends them
  over a WebRTC data channel. They only work while the tab has focus,
  and losing focus (or closing the tab, or losing the network) releases
  every held key — an unwatched browser can never keep the robot moving.
- **Video out**: JPEG frames arriving on the node's optional `image`
  input are streamed to the page as WebRTC video. Wire it to a
  `camera_*` output of `dora-openarm-mujoco --render` to watch the
  simulation from the browser.

It publishes end-effector pose targets with the same output contract
as
[`dora-openarm-webxr`](https://github.com/enactic/dora-openarm-webxr),
so it can be dropped into a dataflow wherever the WebXR node would
normally sit and feed
[`dora-openarm-ik`](https://github.com/enactic/dora-openarm-kinematics)
unchanged.

## Key bindings

Each arm has its own keys, so both can be driven at the same time with no arm
to select first. Holding <kbd>Shift</kbd> turns the same keys into rotation.

| Category | Keys | Alone | With <kbd>Shift</kbd> |
|---|---|---|---|
| Left arm | <kbd>W</kbd> / <kbd>S</kbd> | ±X | ±Pitch |
|  | <kbd>A</kbd> / <kbd>D</kbd> | ±Y | ±Roll |
|  | <kbd>R</kbd> / <kbd>F</kbd> | ±Z | ±Yaw |
| Right arm | <kbd>I</kbd> / <kbd>K</kbd> | ±X | ±Pitch |
|  | <kbd>J</kbd> / <kbd>L</kbd> | ±Y | ±Roll |
|  | <kbd>Y</kbd> / <kbd>H</kbd> | ±Z | ±Yaw |
| Left gripper | <kbd>C</kbd> / <kbd>X</kbd> | Open / close | |
| Right gripper | <kbd>N</kbd> / <kbd>M</kbd> | Open / close | |
| Control | <kbd>0</kbd> | Return both arms to their home pose | |
|  | <kbd>Esc</kbd> | Quit teleoperation | |

Motion keys are **hold to move**: the target advances while the key is down and
stops the moment it is released. Shift is momentary in the same way — the keys
rotate only while it is down, and releasing it always returns to translation.
Rotation is integrated in the **tool frame**, so roll, pitch and yaw stay
relative to the gripper rather than the world.

`0` walks both targets back to their home pose at the same `--linear-speed` and
`--angular-speed` manual control uses, so the arms return at a speed the
operator has already accepted rather than snapping back. Any motion key or
gripper key cancels the return and hands control straight back. The grippers
are left alone, so an arm carries what it is holding home instead of dropping
it on the way.

Esc quits. Every held control stops immediately — a home return too, so the
arms stay where they are — and the node shuts down, sending `lifter-stop` and
then `quit` on the way out; wired into a `dora-openarm-quitter` tick node's
`command` input (as in the example dataflows), the `quit` stops the timers so
the whole dataflow comes down. Keys only reach the robot while the browser
page has focus, and losing focus releases everything held.

By default the page is only reachable from the node's own machine. To operate
from another machine, pass `--host 0.0.0.0` and open `http://<node-host>:8080/`
(browsers allow WebRTC on plain HTTP; camera/mic-free pages like this one need
no HTTPS).

## Touch HUD for iPad and iPhone

The node also serves a thumb-driven touch HUD at `/tablet/`, for a tablet or
phone held in both hands. It is a second client of the same key protocol —
a stick dragged up sends the same `w` keydown a keyboard would — so it drives
the same node and the same dataflows with nothing else running.

The device is on the LAN, so start the node with `--host 0.0.0.0` (in a
dataflow, `args: "--host 0.0.0.0"` or `env: {HOST: 0.0.0.0}` on the keyboard
node), then open `http://<node-host>:8080/tablet/` in Safari and rotate to
landscape; portrait shows a rotate prompt. Adding the page to the home screen
gives a full-screen HUD.

Each thumb owns one arm: a stick in the corner, a Z rocker above it, the
gripper slider inboard and a ROT toggle diagonally up. HOME and QUIT sit in
the strip at the top, outside thumb reach on purpose, so they cost a free
hand.

| Control | Alone | With ROT on |
|---|---|---|
| Stick (per arm) | ±X / ±Y, hold to move | ±Pitch / ±Roll |
| Z ▲ / Z ▼ (per arm) | ±Z, hold to move | ±Yaw |
| OPEN / CLOSE slider (per arm) | Gripper follows the knob; fully up = open, fully down = closed | (unchanged) |
| ROT (either side) | Tap to enter rotation mode, tap again to leave it | |
| 25 / 50 / 100 | Speed preset for every control; 50 % on each load | |
| HOME | Hold 0.5 s: <kbd>0</kbd>, both arms return home | |
| QUIT | Hold 1.2 s: <kbd>Esc</kbd>, quits teleoperation | |

**Speed.** The node moves at its fixed speed for as long as a key is down, so
the HUD *pulses* motion keys inside a 40 ms period — the 25 % preset holds a
key for 10 ms of every 40 — and the effective speed follows the preset with
no speed control in the node. ROT (<kbd>Shift</kbd>), HOME and QUIT are never
pulsed.

**Gripper.** The slider is position control on a node that only moves and
reports nothing back: the HUD estimates where the gripper is from the keys it
has sent (the thin mark on the slider) and drives toward the knob. Pushing
the knob all the way open or closed lets the node's own clamp make the
estimate exact again — do that whenever the mark looks wrong. The HUD assumes
the default `--grip-speed 2.0`; change `GRIP_SPEED` in `static/tablet/ui.js` if
the node runs with another.

Every motion control is hold to move, and the HUD lets go of everything —
keys, pulses and ROT — the moment the page loses focus, is backgrounded or
turns to portrait, so an unwatched device can never keep the robot moving.
The `?` pill shows the key bindings the node sends over its `help` channel
and the reason for a failed link; tapping the status pill reconnects a
dropped link.

## When the keys do nothing

Check the page: is it open, does its header say *connected* (the touch HUD's
status pill says *Online*), and does the tab actually have focus (click the
page once)? If Esc was pressed, the node has quit and the dataflow must be
started again.

## Interface

| | |
|---|---|
| **Inputs** | `tick` — keep-alive only, any rate works (the node integrates and publishes at its own 500 Hz pace); `image` (optional) — JPEG frame to stream to the browser, e.g. a `camera_*` output of `dora-openarm-mujoco --render` |
| **Outputs** | `pose_right`, `pose_left` `[{"pose": float32[8]}]` — `[px, py, pz, qw, qx, qy, qz, gripper_angle]` in the scene's `arm_origin` frame; `command` `string[1]` — sent at shutdown: `lifter-stop` so a physical lifter in the dataflow never keeps moving, then `quit` so `dora-openarm-quitter` tick nodes exit and the dataflow can finish; `status` `string[1]` |

```
--linear-speed   translation speed, m/s        (default: 0.05)
--angular-speed  rotation speed, rad/s         (default: 0.5)
--grip-speed     gripper speed, fraction/s     (default: 2.0)
--home-right     right arm home position X Y Z (default: 0.216 -0.1535 -0.22)
--home-left      left arm home position X Y Z  (default: 0.216 0.1535 -0.22)
--home-rpy       home orientation in degrees   (default: 0 -90 0)
--pos-min        lower workspace bound X Y Z   (default: -0.8 -0.8 -0.8)
--pos-max        upper workspace bound X Y Z   (default: 0.8 0.8 0.8)
--host           web server bind address       (default: 127.0.0.1)
--port           web server port               (default: 8080)
--offer          SDP offer (WebRTC-only mode; see below)
--answer-host    host to write the SDP answer to (WebRTC-only mode)
--answer-port    port to write the SDP answer to (WebRTC-only mode)
--connect-timeout  seconds to wait for the browser to connect (default: 60)
```

The `--host` and `--port` defaults can also be overridden with the `HOST`
and `PORT` environment variables; explicit `--host`/`--port` still win.

The home pose defaults are the end-effector poses of the scene's `home`
keyframe, expressed in its `arm_origin` frame. The IK and MuJoCo nodes start
from that same keyframe, so publishing anything else would make IK drag both
arms across the workspace on the first tick. After changing scene or keyframe,
we need to follow the changes.

## WebRTC-only mode

By default the node hosts the page itself. Pass `--offer` (or set `OFFER`) to
run it as a pure WebRTC peer instead, with **no HTTP server**: another service
hosts `index.html`/`teleop.js` and brokers signaling, and this node only runs
the robot side of the connection.

- `--offer` / `OFFER` — the browser's SDP offer, handed in at startup. Just the
  bare SDP; the type is always `offer`.
- `--answer-host` / `ANSWER_HOST` (default `127.0.0.1`) and `--answer-port` /
  `ANSWER_PORT` — the TCP host and port this node connects to and writes the
  answer SDP to (then closes). The service listening there wraps it back into
  an `answer` and relays it to the browser.

This is a **one-shot** connection: the offer is fixed at startup, so the node
runs that single peer for its whole life; reconnecting means restarting the
node. When the browser disconnects — tab closed, network drop — the node exits,
since no other browser can ever take its place. `--host`/`--port` are ignored
in this mode.

After the answer is sent, the node waits up to `--connect-timeout` /
`CONNECT_TIMEOUT` seconds (default 60) for the browser to connect. If the
connection never comes up — nobody applied the answer, or the media path
failed — the node exits instead of holding a dead peer, so a supervisor can
restart it for a fresh offer.

## Quick start

[`example/dataflow-mujoco.yaml`](example/dataflow-mujoco.yaml) drives both arms
in MuJoCo through IK, with no VR headset and no real OpenArm, and streams
MuJoCo's ceiling camera back to the browser:

```bash
uv run dora build example/dataflow-mujoco.yaml --uv
uv run dora run example/dataflow-mujoco.yaml --uv
```

Then open <http://127.0.0.1:8080/> and click the page, then hold a motion key.
The arms hold their startup pose until you press a key. If a physical lifter is
in the dataflow, connect the keyboard node's `command` output to its `command`
input so it is stopped when the node exits.

To record what you teleoperate, use `dataflow-keyboard-mujoco.yaml` in
[`dora-openarm-data-collection`](https://github.com/enactic/dora-openarm-data-collection)
— the same graph with the collection UI and dataset recorder attached.

## Development

```bash
uv sync
uv run pytest tests
node --test 'tests/js/**/*.test.mjs'
```

The pose integrator in `teleop.py` imports neither `dora` nor the WebRTC
stack, so the whole state machine is tested without a dataflow or a browser;
`tests/test_web.py` exercises the WebRTC server end to end in-process; and
`tests/js/` covers the touch HUD's stick mapping, pulser timing, gripper
follower and pointer widgets under Node's test runner.

To work on either page without a dataflow, `uv run python dev/fake_node.py`
runs the real `WebTeleopServer` with no dora attached; see
[`dev/README.md`](dev/README.md).

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

Copyright 2026 Enactic, Inc.

## Code of Conduct

All participation in the OpenArm project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
