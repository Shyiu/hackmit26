"""Settings, read from the environment or from services/perception/.env."""

from __future__ import annotations

import os
import socket
from functools import cached_property
from typing import Literal

from cryptography.fernet import Fernet
from pydantic import Field, PrivateAttr
from pydantic_settings import BaseSettings, SettingsConfigDict


def default_worker_id() -> str:
    # Unique per process, so two workers on one host never share a job lease.
    return f"{socket.gethostname()}-{os.getpid()}"[:100]


class TokenSettings(BaseSettings):
    """The part minting a local token needs, without a database."""

    # An empty line in .env, like WORKER_ID=, means "use the default", not "use an empty string".
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    device_token_secret: str = Field(min_length=32, repr=False)


class Settings(TokenSettings):
    # Carries credentials on Atlas, so it stays out of reprs and logs.
    mongodb_uri: str = Field(repr=False)
    mongodb_db: str = "memory_glasses"
    # For the description worker. Unused until M1.
    openai_api_key: str | None = Field(default=None, repr=False)
    # The lease owner written on claimed description jobs. The schema caps it at 100 characters.
    worker_id: str = Field(default_factory=default_worker_id, min_length=1, max_length=100)
    safety_enabled: bool = True
    safety_sample_every_n_frames: int = Field(default=3, ge=1)
    detector: Literal["mock", "dfine", "yoloe"] = "mock"
    dfine_model_id: str = "ustc-community/dfine-medium-obj365"
    yoloe_model: str = "yoloe-26s-seg.pt"
    detector_device: str = "cpu"
    face_detector: Literal["mock", "insightface"] = "mock"
    face_embedder: Literal["mock", "insightface"] = "mock"
    insightface_model: str = "buffalo_l"
    face_match_threshold: float = Field(default=0.45, ge=0, le=1)
    face_min_confidence: float = Field(default=0.6, ge=0, le=1)
    face_embedding_key: str | None = Field(default=None, repr=False)
    vlm: Literal["mock", "openai", "off"] = "mock"
    vlm_model: str = "gpt-5.6-luna"
    vlm_base_url: str = "https://api.openai.com/v1"
    vlm_api_key: str | None = Field(default=None, repr=False)
    vlm_reasoning_effort: str = "none"
    vlm_timeout_s: float = Field(default=20, gt=0)
    safety_hazard_labels_extra: str = ""
    safety_mock_labels: str = ""
    safety_mock_faces: int = Field(default=0, ge=0)
    frame_image_dir: str = "./data/frames"
    allow_local_path_ingest: bool = False
    ingest_allowed_dir: str | None = None
    danger_event_merge_window_s: int = Field(default=30, ge=1)
    _ephemeral_warning_logged: bool = PrivateAttr(default=False)

    @cached_property
    def ephemeral_fernet(self) -> Fernet:
        if self.face_embedding_key:
            return Fernet(self.face_embedding_key.encode())
        return Fernet(Fernet.generate_key())

    def fernet(self) -> Fernet:
        if not self.face_embedding_key and not self._ephemeral_warning_logged:
            import logging

            logging.getLogger("perception.safety").warning(
                "ephemeral key — enrolled embeddings will not survive restart"
            )
            self._ephemeral_warning_logged = True
        return self.ephemeral_fernet

    @property
    def resolved_vlm_api_key(self) -> str | None:
        return self.vlm_api_key or self.openai_api_key
