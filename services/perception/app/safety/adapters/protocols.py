from __future__ import annotations

from typing import Protocol

import numpy as np

from ..models import FaceBox


class FaceDetector(Protocol):
    name: str

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[FaceBox]: ...


class FaceEmbedder(Protocol):
    name: str
    model: str

    def embed(self, image: np.ndarray, faces: list[FaceBox]) -> list[np.ndarray]: ...
