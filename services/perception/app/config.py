"""Settings, read from the environment or from services/perception/.env."""

from __future__ import annotations

import os
import socket
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DetectorKind = Literal["auto", "null", "yoloe"]


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

    # The detector. "auto" runs YOLOE when ultralytics and the checkpoint are on
    # this machine and falls back to NullDetector otherwise, so the service boots anywhere.
    detector: DetectorKind = "auto"
    # A path, or an Ultralytics asset name that "yoloe" (not "auto") may download.
    yoloe_model: str = "yoloe-26s-seg.pt"
    yoloe_image_size: int = Field(default=640, ge=320, le=1920)
    # A torch device like "cpu", "cuda:0" or "mps". None lets Ultralytics choose.
    yoloe_device: str | None = None
    detector_confidence: float = Field(default=0.25, ge=0.0, le=1.0)
    # Frames below this Laplacian variance are blurry and count as unusable. 0 turns the check off.
    blur_threshold: float = Field(default=40.0, ge=0.0)
    # Run the detector on every Nth live frame. The rest are dropped and counted as such.
    frame_stride: int = Field(default=1, ge=1)
    # How long the wearer's item prompt list is kept before it's re-read from the database.
    prompt_refresh_seconds: float = Field(default=30.0, gt=0.0)

    # From detections to sightings. README "From detections to sightings".
    confirm_frames: int = Field(default=3, ge=1)
    confirm_window_seconds: float = Field(default=2.0, gt=0.0)
    refresh_interval_ms: int = Field(default=500, ge=0)
    track_lost_seconds: float = Field(default=3.0, gt=0.0)
    track_match_iou: float = Field(default=0.3, gt=0.0, le=1.0)
