"""Plays a directory of JPEG frames into the perception service's /ws/frames socket.

Run it from services/perception, whose environment has the websockets package:

    uv run python ../../scripts/replay.py frames/ --token "$TOKEN" --fps 3

Cut frames from a phone recording with ffmpeg, 1280 px wide like the page sends:

    ffmpeg -i kitchen.mp4 -vf fps=3,scale=1280:-2 frames/%05d.jpg

and mint a token with `uv run python -m app.tokens --patient <wearer id>`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import struct
import sys
import time
from pathlib import Path
from typing import Any

from websockets.asyncio.client import ClientConnection, connect


def jpeg_size(data: bytes) -> tuple[int, int]:
    """Width and height from the JPEG's start-of-frame segment, so no image library is needed."""
    if not data.startswith(b"\xff\xd8"):
        raise ValueError("not a JPEG")
    i = 2
    while i + 9 <= len(data):
        if data[i] != 0xFF:
            raise ValueError("corrupt JPEG segment")
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte
            i += 1
            continue
        (length,) = struct.unpack(">H", data[i + 2 : i + 4])
        # SOF0 to SOF15 carry the size. C4, C8 and CC share the range but aren't frames.
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", data[i + 5 : i + 9])
            return width, height
        i += 2 + length
    raise ValueError("no frame size in JPEG")


def envelope(header: dict[str, Any], jpeg: bytes) -> bytes:
    """A 4-byte big-endian header length, the header as UTF-8 JSON, then the JPEG."""
    raw = json.dumps(header, separators=(",", ":")).encode()
    return struct.pack(">I", len(raw)) + raw + jpeg


async def next_session(ws: ClientConnection) -> dict[str, Any]:
    message: dict[str, Any] = json.loads(await ws.recv())
    if message["type"] != "session":
        sys.exit(f"Refused: {message}")
    return message


async def print_replies(ws: ClientConnection) -> None:
    async for raw in ws:
        message = json.loads(raw)
        if message["type"] == "detections":
            labels = ", ".join(d["label"] for d in message["detections"]) or "nothing"
            print(f"seq {message['seq']}: {labels}")
        else:
            print(message)


async def replay(url: str, token: str, frames: list[Path], fps: float) -> None:
    started = time.monotonic()

    def page_clock_ms() -> float:
        # Stands in for performance.now() on the page. Only differences matter to the service.
        return (time.monotonic() - started) * 1000

    async with connect(url) as ws:
        await ws.send(json.dumps({"type": "hello", "v": 1, "token": token}))
        session = await next_session(ws)
        await ws.send(json.dumps({"type": "capture", "v": 1, "state": "live"}))
        await next_session(ws)
        replies = asyncio.create_task(print_replies(ws))

        due = time.monotonic()
        for seq, path in enumerate(frames, start=1):
            captured = page_clock_ms()
            jpeg = path.read_bytes()
            width, height = jpeg_size(jpeg)
            header = {
                "v": 1,
                "sessionId": session["sessionId"],
                "seq": seq,
                "capturedAtMs": captured,
                "sentAtMs": page_clock_ms(),
                "width": width,
                "height": height,
                "bytes": len(jpeg),
            }
            await ws.send(envelope(header, jpeg))
            due += 1 / fps
            await asyncio.sleep(max(0.0, due - time.monotonic()))

        await ws.send(json.dumps({"type": "capture", "v": 1, "state": "paused"}))
        await asyncio.sleep(1)  # let the last replies arrive
        replies.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay JPEG frames into /ws/frames.")
    parser.add_argument("frames", type=Path, help="a directory of .jpg files, sent in name order")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws/frames")
    parser.add_argument("--token", default=os.environ.get("PERCEPTION_TOKEN"), help="or set PERCEPTION_TOKEN")
    parser.add_argument("--fps", type=float, default=3.0)
    args = parser.parse_args()
    if not args.token:
        parser.error("pass --token or set PERCEPTION_TOKEN")
    frames = sorted(p for p in args.frames.iterdir() if p.suffix.lower() in {".jpg", ".jpeg"})
    if not frames:
        parser.error(f"no JPEG files in {args.frames}")
    asyncio.run(replay(args.url, args.token, frames, args.fps))


if __name__ == "__main__":
    main()
