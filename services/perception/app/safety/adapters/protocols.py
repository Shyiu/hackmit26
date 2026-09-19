from __future__ import annotations

from typing import Protocol

import numpy as np

from ..models import Detection, FaceBox, VlmResult


class ObjectDetector(Protocol):
    name: str
    model: str

    def detect(
        self, image: np.ndarray, prompts: list[str] | None = None, *, filename: str = ""
    ) -> list[Detection]: ...


class FaceDetector(Protocol):
    name: str

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[FaceBox]: ...


class FaceEmbedder(Protocol):
    name: str
    model: str

    def embed(self, image: np.ndarray, faces: list[FaceBox]) -> list[np.ndarray]: ...


class VLMVerifier(Protocol):
    name: str
    model: str

    def verify(self, image_bytes: bytes, candidate_event_types: list[str]) -> VlmResult: ...
