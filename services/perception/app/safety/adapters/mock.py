from __future__ import annotations

import hashlib

import numpy as np

from ..models import BBox, FaceBox


class MockFaceDetector:
    name = "mock"

    def __init__(self, faces: int | None = None, *, settings=None, filename_hints: bool = True):
        self.faces = faces
        self.settings = settings
        self.filename_hints = filename_hints

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[FaceBox]:
        count = self.faces
        if count is None:
            count = int(getattr(self.settings, "safety_mock_faces", 0))
            if self.filename_hints and "face" in filename.lower():
                count = max(count, 1)
        return [FaceBox(bbox=BBox(x=0.25, y=0.25, w=0.5, h=0.5), confidence=0.95) for _ in range(count)]


class MockFaceEmbedder:
    name = "mock"
    model = "mock-512"

    def embed(self, image: np.ndarray, faces: list[FaceBox]) -> list[np.ndarray]:
        digest = hashlib.sha256(np.asarray(image).tobytes()).digest()
        seed = int.from_bytes(digest[:8], "big") % (2**32)
        rng = np.random.default_rng(seed)
        result = rng.normal(size=512).astype(np.float32)
        result /= np.linalg.norm(result)
        return [result.copy() for _ in faces]
