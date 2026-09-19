from __future__ import annotations

import logging
import warnings

from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    MONGODB_URI: str = "mongomock://"
    MONGODB_DB: str = "memory_glasses"
    IMAGE_STORE: str = "local"
    IMAGE_DIR: str = "./data/images"
    IMAGE_PUBLIC_BASE_URL: str | None = None
    FACE_EMBEDDING_KEY: str | None = None
    DETECTOR: str = "mock"
    DFINE_MODEL_ID: str = "ustc-community/dfine-medium-obj365"
    YOLOE_MODEL: str = "yoloe-26s-seg.pt"
    DETECTOR_DEVICE: str = "cpu"
    FACE_DETECTOR: str = "mock"
    FACE_EMBEDDER: str = "mock"
    INSIGHTFACE_MODEL: str = "buffalo_l"
    FACE_MATCH_THRESHOLD: float = 0.45
    FACE_MIN_CONFIDENCE: float = 0.6
    VLM: str = "mock"
    VLM_MODEL: str = "gpt-5.6-luna"
    VLM_BASE_URL: str = "https://api.openai.com/v1"
    VLM_API_KEY: str | None = None
    VLM_REASONING_EFFORT: str = "none"
    VLM_TIMEOUT_S: float = 20
    HAZARD_LABELS_EXTRA: str = ""
    LOG_LEVEL: str = "INFO"
    ALLOW_LOCAL_PATH_INGEST: bool = True
    INGEST_ALLOWED_DIR: str | None = None

    def fernet(self) -> Fernet:
        if self.FACE_EMBEDDING_KEY:
            return Fernet(self.FACE_EMBEDDING_KEY.encode())
        warnings.warn(
            "ephemeral key — enrolled embeddings will not survive restart",
            UserWarning,
            stacklevel=2,
        )
        logging.getLogger("vision_service").warning(
            "ephemeral key — enrolled embeddings will not survive restart"
        )
        return Fernet(Fernet.generate_key())
