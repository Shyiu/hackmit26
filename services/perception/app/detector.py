"""The detector seam. YOLOE-26 and the tracker plug in here in M1."""

from __future__ import annotations

from typing import Protocol

from .protocol import Detection, FrameHeader


class Detector(Protocol):
    name: str

    def detect(self, jpeg: bytes, header: FrameHeader) -> list[Detection]:
        """Tracked items in one frame. Runs on a worker thread, so it may block."""
        ...


class NullDetector:
    """Finds nothing. Lets the socket, the HUD and the store run end to end before the model exists."""

    name = "null"

    def detect(self, jpeg: bytes, header: FrameHeader) -> list[Detection]:
        return []
