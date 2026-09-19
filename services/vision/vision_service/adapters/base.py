from __future__ import annotations

from typing import Protocol

import numpy as np

from ..schemas import Detection, FaceDetection, VLMVerification


class ObjectDetector(Protocol):
    name: str
    model: str

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[Detection]: ...


class FaceDetector(Protocol):
    name: str

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[FaceDetection]: ...


class FaceEmbedder(Protocol):
    name: str
    model: str

    def embed(self, image: np.ndarray, face: FaceDetection) -> np.ndarray: ...


class VLMVerifier(Protocol):
    name: str
    model: str

    def verify(self, image_bytes: bytes, candidate_event_types: list[str]) -> VLMVerification: ...
