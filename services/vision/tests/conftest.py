from __future__ import annotations

import io

import numpy as np
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from PIL import Image

from vision_service.adapters.mock import MockDetector, MockFaceDetector, MockFaceEmbedder, MockVLM
from vision_service.adapters.registry import Adapters
from vision_service.api import create_app
from vision_service.config import Settings


@pytest.fixture
def settings(tmp_path):
    return Settings(
        MONGODB_URI="mongomock://",
        IMAGE_DIR=str(tmp_path / "images"),
        FACE_EMBEDDING_KEY=Fernet.generate_key().decode(),
    )


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def png_bytes():
    output = io.BytesIO()
    Image.fromarray(np.full((32, 32, 3), 120, dtype=np.uint8)).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def mock_adapters():
    return Adapters(MockDetector(), MockFaceDetector(), MockFaceEmbedder(), MockVLM())
