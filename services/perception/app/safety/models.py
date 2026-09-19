from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class BBox(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)


class Detection(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    label: str
    confidence: float = Field(ge=0, le=1)
    bbox: BBox
    source: str = "mock"


class FaceBox(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    bbox: BBox
    confidence: float = Field(ge=0, le=1)
    landmarks: list[list[float]] | None = None


class FaceObservation(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    bbox: BBox
    confidence: float = Field(ge=0, le=1)
    person_id: ObjectId | None = None
    match_confidence: float | None = Field(default=None, ge=0, le=1)


class VlmConfirmation(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    event_type: str
    confirmed: bool
    evidence: str


class VlmResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    caption: str = ""
    confirmations: list[VlmConfirmation] = Field(default_factory=list)
    confidence: float = Field(default=0, ge=0, le=1)
    observable_evidence: list[str] = Field(default_factory=list)
    model: str = "mock"
    status: str = "skipped"
    error: str | None = None


class Candidate(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    kind: str
    hazard_label: str | None
    severity: str
    confidence: float = Field(ge=0, le=1)
    bbox: BBox
    vlm_verify: bool
    detection: Detection | None = None
    verification: str = "unverified"
    vlm_confidence: float | None = None
    vlm_evidence: list[str] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class EnrolledPerson:
    person_id: ObjectId
    embeddings: tuple[np.ndarray, ...]
    embedding_model: str


@dataclass(slots=True)
class FrameAnalysis:
    width: int
    height: int
    detections: list[Detection] = field(default_factory=list)
    faces: list[FaceObservation] = field(default_factory=list)
    hazards: list[Detection] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)
    caption: str | None = None
    vlm: VlmResult = field(default_factory=VlmResult)
    processing_status: str = "complete"
    failed_stage: str | None = None
    error: str | None = None
    duration_ms: int = 0
    stage_timings_ms: dict[str, float] = field(default_factory=dict)
    detector_name: str = "mock"

    def to_observation_fields(self) -> dict[str, Any]:
        def detection_doc(item: Detection) -> dict[str, Any]:
            return {
                "label": item.label,
                "confidence": item.confidence,
                "bbox": [item.bbox.x, item.bbox.y, item.bbox.w, item.bbox.h],
            }

        return {
            "imageWidth": self.width,
            "imageHeight": self.height,
            "caption": self.caption,
            "detections": [detection_doc(item) for item in self.detections],
            "faces": [
                {
                    "bbox": [item.bbox.x, item.bbox.y, item.bbox.w, item.bbox.h],
                    "confidence": item.confidence,
                    "personId": item.person_id,
                    "matchConfidence": item.match_confidence,
                }
                for item in self.faces
            ],
            "hazards": [detection_doc(item) for item in self.hazards],
            "vlm": {
                "status": self.vlm.status,
                "model": self.vlm.model if self.vlm.status != "skipped" else None,
                "confidence": self.vlm.confidence if self.vlm.status != "skipped" else None,
                "observableEvidence": self.vlm.observable_evidence,
                "error": self.vlm.error,
            },
            "processing": {
                "status": self.processing_status,
                "failedStage": self.failed_stage,
                "error": self.error,
                "durationMs": self.duration_ms,
            },
            "detectorName": self.detector_name,
        }
