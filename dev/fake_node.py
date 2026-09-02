# Copyright 2026 Enactic, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Run the real WebRTC teleop server without dora, for page work.

WebTeleopServer is exactly what the node runs in production; its own tests
drive it in-process the same way.  Both pages are served — the keyboard page
at / and the touch HUD at /tablet/ — received key events are printed, and a
synthetic test-card JPEG is pushed as video so the video path is exercised
too.

Usage: uv run python dev/fake_node.py [--host 0.0.0.0] [--port 8080]
"""

import argparse
import asyncio
import time

import av
import numpy as np
from dora_openarm_keyboard.web import WebTeleopServer

WIDTH, HEIGHT = 320, 240
FPS = 10

# TV-style vertical color bars, with a marker swept across them below so
# motion is visible even though nothing is actually being teleoperated.
_BAR_COLORS = np.array(
    [
        (255, 255, 255),
        (255, 255, 0),
        (0, 255, 255),
        (0, 255, 0),
        (255, 0, 255),
        (255, 0, 0),
        (0, 0, 255),
    ],
    dtype=np.uint8,
)


def _bars() -> np.ndarray:
    bar_width = WIDTH // len(_BAR_COLORS)
    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    for i, color in enumerate(_BAR_COLORS):
        frame[:, i * bar_width : (i + 1) * bar_width] = color
    return frame


_BARS = _bars()


def make_test_card(tick: int) -> np.ndarray:
    """Color bars with a square sweeping left-right across them."""
    frame = _BARS.copy()
    size = 20
    x = int((np.sin(tick / 20) * 0.5 + 0.5) * (WIDTH - size))
    frame[HEIGHT // 2 - size : HEIGHT // 2 + size, x : x + size] = (0, 0, 0)
    return frame


def encode_jpeg(codec: av.codec.CodecContext, image: np.ndarray) -> bytes:
    """Encode one RGB frame as a JPEG packet."""
    frame = av.VideoFrame.from_ndarray(image, format="rgb24")
    (packet,) = codec.encode(frame)
    return bytes(packet)


def print_event(action: str, name: str) -> None:
    """Print a normalized key event the way the node's on_key receives it."""
    # WebTeleopServer normalizes browser key events to ("press"|"release", name)
    # before calling this, matching what the real dora node's on_key sees.
    print(f"{time.time():.3f} {action} {name}", flush=True)


async def push_frames(server: WebTeleopServer) -> None:
    """Push the test card to the server at FPS forever."""
    codec = av.CodecContext.create("mjpeg", "w")
    codec.width = WIDTH
    codec.height = HEIGHT
    codec.pix_fmt = "yuvj420p"
    tick = 0
    while True:
        server.push_jpeg(encode_jpeg(codec, make_test_card(tick)))
        tick += 1
        await asyncio.sleep(1 / FPS)


async def run(host: str, port: int) -> None:
    """Serve until interrupted."""
    server = WebTeleopServer(on_key=print_event, host=host, port=port)
    await server.start()
    print(
        f"fake node listening on http://{host}:{port}/ (keyboard) "
        f"and http://{host}:{port}/tablet/ (touch HUD)",
        flush=True,
    )
    try:
        await push_frames(server)
    finally:
        await server.stop()


def main() -> None:
    """Parse the command line and run the fake node."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    try:
        asyncio.run(run(args.host, args.port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
