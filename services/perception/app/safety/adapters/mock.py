from __future__ import annotations

import hashlib

import numpy as np

from ..models import BBox, Detection, FaceBox, VlmConfirmation, VlmResult


class MockDetector:
    name = "mock"
    model = "mock"

    def __init__(
        self,
        scripted: list[Detection] | None = None,
        *,
        settings=None,
        filename_hints: bool = True,
    ):
        self.detections = scripted
        self.settings = settings
        self.filename_hints = filename_hints

    def detect(
        self, image: np.ndarray, prompts: list[str] | None = None, *, filename: str = ""
    ) -> list[Detection]:
        if self.detections is not None:
            return self.detections
        name = filename.lower()
        hints = [
            ("knife", "knife", 0.9),
            ("stove", "stove", 0.8),
            ("pills", "pill bottle", 0.8),
            ("person", "person", 0.9),
        ]
        labels = []
        if self.filename_hints:
            labels.extend((label, confidence) for hint, label, confidence in hints if hint in name)
        if self.settings is not None:
            labels.extend(
                (label.strip(), 0.9) for label in self.settings.safety_mock_labels.split(",") if label.strip()
            )
        return [
            Detection(
                label=label,
                confidence=confidence,
                bbox=BBox(x=0.2, y=0.2, w=0.6, h=0.6),
                source=self.name,
            )
            for label, confidence in labels
        ]


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


class MockVLM:
    name = "mock"
    model = "mock"

    def __init__(self, confirm: bool = True, raise_error: bool = False):
        self.confirm = confirm
        self.raise_error = raise_error
        self.calls = 0

    def verify(self, image_bytes: bytes, candidate_event_types: list[str]) -> VlmResult:
        self.calls += 1
        if self.raise_error:
            raise RuntimeError("mock VLM failure")
        labels = ", ".join(candidate_event_types)
        return VlmResult(
            caption=f"Mock caption: {labels}",
            confirmations=[
                VlmConfirmation(event_type=event, confirmed=self.confirm, evidence="Visible in the frame.")
                for event in candidate_event_types
            ],
            confidence=0.9 if self.confirm else 0.2,
            observable_evidence=["Candidate object is visible."] if self.confirm else [],
            model=self.model,
            status="confirmed" if self.confirm else "rejected",
        )
