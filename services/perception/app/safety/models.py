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


class FaceBox(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    bbox: BBox
    confidence: float = Field(ge=0, le=1)
    landmarks: list[list[float]] | None = None


class FaceMatchCandidate(BaseModel):
    """One enrolled person's raw similarity to a detected face, whether or not it won.

    Debug-only, like name/relation below: carried to the live capture page so a
    caregiver can see why a face did or didn't get named, never stored.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)
    person_id: ObjectId
    name: str
    relation: str | None = None
    similarity: float = Field(ge=0, le=1)


class FaceObservation(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    bbox: BBox
    confidence: float = Field(ge=0, le=1)
    person_id: ObjectId | None = None
    match_confidence: float | None = Field(default=None, ge=0, le=1)
    # Carried for the wearer's page, which has no people list of its own. Never stored.
    name: str | None = None
    relation: str | None = None
    # Every enrolled person's similarity to this face, best first. Also never stored.
    candidates: tuple[FaceMatchCandidate, ...] = ()


@dataclass(frozen=True, slots=True)
class EnrolledPerson:
    person_id: ObjectId
    embeddings: tuple[np.ndarray, ...]
    embedding_model: str
    name: str = ""
    relation: str | None = None


@dataclass(frozen=True, slots=True)
class Gallery:
    """One wearer's enrolled faces, stacked so a frame's face is scored in a single matmul."""

    people: tuple[EnrolledPerson, ...]
    # One unit-length row per reference photo, and the index into `people` that owns each row.
    matrix: np.ndarray
    owners: np.ndarray

    @classmethod
    def build(cls, people: tuple[EnrolledPerson, ...], embedding_model: str | None = None) -> Gallery:
        """Vectors from another model share no space with this one, so those people are left out."""
        kept = tuple(
            person
            for person in people
            if person.embeddings and (embedding_model is None or person.embedding_model == embedding_model)
        )
        rows = [np.asarray(item, dtype=np.float32) for person in kept for item in person.embeddings]
        owners = [index for index, person in enumerate(kept) for _ in person.embeddings]
        if not rows:
            return cls(kept, np.zeros((0, 0), dtype=np.float32), np.zeros(0, dtype=np.intp))
        matrix = np.stack(rows)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        return cls(kept, matrix / np.where(norms == 0, 1, norms), np.asarray(owners, dtype=np.intp))


@dataclass(slots=True)
class FrameAnalysis:
    width: int
    height: int
    faces: list[FaceObservation] = field(default_factory=list)
    processing_status: str = "complete"
    failed_stage: str | None = None
    error: str | None = None
    duration_ms: int = 0
    stage_timings_ms: dict[str, float] = field(default_factory=dict)

    def to_observation_fields(self) -> dict[str, Any]:
        return {
            "imageWidth": self.width,
            "imageHeight": self.height,
            "faces": [
                {
                    "bbox": [item.bbox.x, item.bbox.y, item.bbox.w, item.bbox.h],
                    "confidence": item.confidence,
                    "personId": item.person_id,
                    "matchConfidence": item.match_confidence,
                }
                for item in self.faces
            ],
            "processing": {
                "status": self.processing_status,
                "failedStage": self.failed_stage,
                "error": self.error,
                "durationMs": self.duration_ms,
            },
        }
