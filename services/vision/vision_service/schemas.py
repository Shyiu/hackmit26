from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, use_enum_values=True)
    extensions: dict[str, Any] = Field(default_factory=dict)
    schema_version: int = 1


class BBox(Model):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)


class Detection(Model):
    label: str
    confidence: float = Field(ge=0, le=1)
    bbox: BBox
    source: str
    raw_label: str | None = None


class DetectorResult(Model):
    adapter: str
    model: str
    detections: list[Detection] = Field(default_factory=list)
    latency_ms: float = 0


class FaceDetection(Model):
    bbox: BBox
    confidence: float = Field(ge=0, le=1)
    landmarks: list[list[float]] | None = None


class FaceObservation(Model):
    bbox: BBox
    confidence: float = Field(ge=0, le=1)
    profile_id: str | None = None
    match_confidence: float | None = Field(default=None, ge=0, le=1)


class FaceResult(Model):
    adapter: str
    faces: list[FaceObservation] = Field(default_factory=list)
    latency_ms: float = 0


class VLMConfirmation(Model):
    event_type: str
    confirmed: bool
    evidence: str


class VLMVerification(Model):
    caption: str
    confirmations: list[VLMConfirmation] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    observable_evidence: list[str] = Field(default_factory=list)
    model: str = "mock"
    latency_ms: float = 0
    raw_error: str | None = None


class ProcessingState(str, Enum):
    received = "received"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class ImageInfo(Model):
    url: str
    store: str
    key: str
    sha256: str
    width: int
    height: int
    content_type: str
    bytes: int


class ProcessingInfo(Model):
    state: ProcessingState = ProcessingState.received
    failed_stage: str | None = None
    error: str | None = None
    stage_timings_ms: dict[str, float] = Field(default_factory=dict)


class Observation(Model):
    id: str = Field(default="", alias="_id")
    device_id: str
    captured_at: datetime
    received_at: datetime
    image: ImageInfo
    caption: str | None = None
    detector: DetectorResult | None = None
    faces: FaceResult | None = None
    alert_ids: list[str] = Field(default_factory=list)
    processing: ProcessingInfo = Field(default_factory=ProcessingInfo)
    frame_scope: str = "single_frame"
    created_at: datetime
    updated_at: datetime


class Consent(Model):
    granted: bool
    granted_at: datetime
    granted_by: str


class FaceProfile(Model):
    id: str = Field(default="", alias="_id")
    name: str
    consent: Consent
    embedding_encrypted: bytes
    embedding_model: str
    embedding_dim: int
    enrolled_from_image_key: str
    created_at: datetime


class Verification(Model):
    state: str = "unverified"
    method: str = "none"
    vlm_confidence: float | None = None
    evidence: list[str] = Field(default_factory=list)
    verified_at: datetime | None = None


class Notification(Model):
    state: str = "pending"
    channels: list[str] = Field(default_factory=list)
    sent_at: datetime | None = None


class Evidence(Model):
    detections: list[Detection] = Field(default_factory=list)
    face_count: int = 0


class Alert(Model):
    id: str = Field(default="", alias="_id")
    event_type: str
    severity: str
    confidence: float
    verification: Verification = Field(default_factory=Verification)
    frame_scope: str = "single_frame"
    status: str = "open"
    observation_ids: list[str] = Field(default_factory=list)
    evidence: Evidence = Field(default_factory=Evidence)
    notification: Notification = Field(default_factory=Notification)
    created_at: datetime
    updated_at: datetime


class CandidateAlert(Model):
    event_type: str
    verified_event_type: str | None = None
    severity: str
    confidence: float
    vlm_verify: bool
    detections: list[Detection] = Field(default_factory=list)
    face_count: int = 0
    category: str
