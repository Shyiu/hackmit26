import numpy as np
import pytest

from vision_service.adapters.mock import MockDetector, MockFaceEmbedder
from vision_service.adapters.registry import build_adapters
from vision_service.config import Settings
from vision_service.schemas import BBox, Detection, FaceDetection


def test_mock_detector_filename_and_explicit():
    image = np.zeros((4, 4, 3), dtype=np.uint8)
    assert MockDetector().detect(image, filename="knife_01.jpg")[0].label == "knife"
    explicit = [Detection(label="gun", confidence=0.9, bbox=BBox(x=0, y=0, w=1, h=1), source="x")]
    assert MockDetector(explicit).detect(image)[0].label == "gun"


def test_mock_face_embedding_is_deterministic_and_distinct():
    embedder = MockFaceEmbedder()
    face = FaceDetection(bbox=BBox(x=0, y=0, w=1, h=1), confidence=1)
    first = embedder.embed(np.zeros((4, 4, 3), dtype=np.uint8), face)
    same = embedder.embed(np.zeros((4, 4, 3), dtype=np.uint8), face)
    other = embedder.embed(np.ones((4, 4, 3), dtype=np.uint8), face)
    assert np.allclose(first, same)
    assert not np.allclose(first, other)


def test_registry_builds_mocks():
    adapters = build_adapters(Settings())
    assert adapters.detector.name == "mock"
    assert adapters.vlm.name == "mock"


def test_dfine_missing_dependency_has_extra_hint(monkeypatch):
    monkeypatch.setitem(__import__("sys").modules, "transformers", None)
    with pytest.raises(ImportError, match=r"\[dfine\]"):
        build_adapters(Settings(DETECTOR="dfine"))
