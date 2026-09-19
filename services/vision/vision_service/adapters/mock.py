from __future__ import annotations

import hashlib

import numpy as np

from ..schemas import BBox, Detection, FaceDetection, VLMConfirmation, VLMVerification


class MockDetector:
    name = "mock"
    model = "mock"

    def __init__(self, detections: list[Detection] | None = None, *, filename_hints: bool = True):
        self.detections = detections
        self.filename_hints = filename_hints

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[Detection]:
        if self.detections is not None:
            return self.detections
        if not self.filename_hints:
            return []
        name = filename.lower()
        hints = [
            ("knife", "knife", 0.9),
            ("stove", "stove", 0.8),
            ("pills", "pill bottle", 0.8),
            ("person", "person", 0.9),
        ]
        for hint, label, confidence in hints:
            if hint in name:
                return [
                    Detection(
                        label=label,
                        confidence=confidence,
                        bbox=BBox(x=0.2, y=0.2, w=0.6, h=0.6),
                        source=self.name,
                    )
                ]
        return []


class MockFaceDetector:
    name = "mock"

    def __init__(self, faces: list[FaceDetection] | None = None, *, filename_hints: bool = True):
        self.faces = faces
        self.filename_hints = filename_hints

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[FaceDetection]:
        if self.faces is not None:
            return self.faces
        if self.filename_hints and "face" in filename.lower():
            return [FaceDetection(bbox=BBox(x=0.25, y=0.25, w=0.5, h=0.5), confidence=0.95)]
        return []


class MockFaceEmbedder:
    name = "mock"
    model = "mock-512"

    def embed(self, image: np.ndarray, face: FaceDetection) -> np.ndarray:
        digest = hashlib.sha256(np.asarray(image).tobytes()).digest()
        seed = int.from_bytes(digest[:8], "big") % (2**32)
        rng = np.random.default_rng(seed)
        result = rng.normal(size=512).astype(np.float32)
        return result / np.linalg.norm(result)


class MockVLM:
    name = "mock"
    model = "mock"

    def __init__(self, confirm: bool = True, raise_error: bool = False):
        self.confirm = confirm
        self.raise_error = raise_error
        self.calls = 0

    def verify(self, image_bytes: bytes, candidate_event_types: list[str]) -> VLMVerification:
        self.calls += 1
        if self.raise_error:
            raise RuntimeError("mock VLM failure")
        labels = ", ".join(candidate_event_types)
        return VLMVerification(
            caption=f"Mock caption: {labels}",
            confirmations=[
                VLMConfirmation(
                    event_type=event, confirmed=self.confirm, evidence="Visible in the frame."
                )
                for event in candidate_event_types
            ],
            confidence=0.9 if self.confirm else 0.2,
            observable_evidence=["Candidate object is visible."] if self.confirm else [],
            model=self.model,
        )
