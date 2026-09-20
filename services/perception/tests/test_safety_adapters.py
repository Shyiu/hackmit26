import sys

import numpy as np
from test_safety import settings

from app.safety.adapters.mock import MockFaceEmbedder
from app.safety.adapters.registry import build_adapters
from app.safety.models import BBox, FaceBox


def test_default_adapters_are_lazy_mocks():
    for module in ("torch", "transformers", "ultralytics", "insightface"):
        sys.modules.pop(module, None)
    adapters = build_adapters(settings())
    assert adapters.face_detector.name == "mock"
    assert adapters.face_embedder.name == "mock"
    assert all(
        module not in sys.modules for module in ("torch", "transformers", "ultralytics", "insightface")
    )


def test_mock_face_embedder_is_deterministic():
    embedder = MockFaceEmbedder()
    faces = [FaceBox(bbox=BBox(x=0, y=0, w=1, h=1), confidence=1)]
    first = np.zeros((4, 4, 3), dtype=np.uint8)
    second = np.ones((4, 4, 3), dtype=np.uint8)
    first_embedding = embedder.embed(first, faces)[0]
    same_embedding = embedder.embed(first.copy(), faces)[0]
    different_embedding = embedder.embed(second, faces)[0]
    assert np.array_equal(first_embedding, same_embedding)
    assert not np.array_equal(first_embedding, different_embedding)
