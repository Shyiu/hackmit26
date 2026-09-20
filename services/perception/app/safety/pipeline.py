from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image

from ..config import Settings
from .adapters.registry import Adapters
from .models import EnrolledPerson, FaceBox, FaceObservation, FrameAnalysis, Gallery
from .rules import evaluate_rules

# A match has to beat the next person by this much, so a lookalike pair names nobody.
MATCH_MARGIN = 0.05


def _match_person(
    embedding: np.ndarray, gallery: Gallery, threshold: float
) -> tuple[EnrolledPerson | None, float | None]:
    if not gallery.people:
        return None, None
    norm = float(np.linalg.norm(embedding))
    if not norm or embedding.shape[0] != gallery.matrix.shape[1]:
        return None, None
    # Each person scores as their best reference photo.
    scores = np.full(len(gallery.people), -1.0, dtype=np.float32)
    np.maximum.at(scores, gallery.owners, gallery.matrix @ (embedding / norm))
    order = np.argsort(scores)[::-1]
    # Clamped: float32 rounding puts an identical vector a hair over 1, which the model rejects.
    best_score = float(min(max(scores[order[0]], 0.0), 1.0))
    runner_up = float(scores[order[1]]) if len(order) > 1 else 0.0
    if best_score < threshold or (len(order) > 1 and best_score - runner_up < MATCH_MARGIN):
        return None, best_score
    return gallery.people[int(order[0])], best_score


def detect_and_embed(
    adapters: Adapters, image: np.ndarray, *, filename: str = ""
) -> list[tuple[FaceBox, np.ndarray]]:
    """One model pass when a single adapter does both jobs, as InsightFace does."""
    analyze = getattr(adapters.face_detector, "analyze", None)
    if analyze is not None and adapters.face_detector is adapters.face_embedder:
        return list(analyze(image, filename=filename))
    faces = adapters.face_detector.detect(image, filename=filename)
    embeddings = adapters.face_embedder.embed(image, faces) if faces else []
    return list(zip(faces, embeddings, strict=True))


@dataclass(slots=True)
class _Work:
    """A frame between the two halves of its analysis."""

    analysis: FrameAnalysis
    jpeg: bytes
    filename: str
    started: float
    array: np.ndarray | None = None


def _fail(work: _Work, stage: str, exc: Exception) -> None:
    work.analysis.processing_status = "failed"
    work.analysis.failed_stage = stage
    work.analysis.error = str(exc)
    work.analysis.duration_ms = round((time.perf_counter() - work.started) * 1000)


def match_faces(
    jpeg: bytes, *, adapters: Adapters, settings: Settings, gallery: Gallery, filename: str = ""
) -> _Work:
    """The first half: decode, then find and name faces. A name is the one result the wearer is
    waiting on, so it's ready before the hazard detector and the VLM have started."""
    started = time.perf_counter()
    analysis = FrameAnalysis(width=0, height=0, detector_name=adapters.detector.name)
    work = _Work(analysis, jpeg, filename, started)
    current_stage = "decode"
    try:
        image = Image.open(BytesIO(jpeg)).convert("RGB")
        array = np.asarray(image)
        analysis.width, analysis.height = image.size
        analysis.stage_timings_ms["decode"] = (time.perf_counter() - started) * 1000

        current_stage = "faces"
        stage_started = time.perf_counter()
        for face, embedding in detect_and_embed(adapters, array, filename=filename):
            person, score = _match_person(embedding, gallery, settings.face_match_threshold)
            analysis.faces.append(
                FaceObservation(
                    bbox=face.bbox,
                    confidence=face.confidence,
                    person_id=person.person_id if person else None,
                    match_confidence=score,
                    name=person.name if person else None,
                    relation=person.relation if person else None,
                )
            )
        analysis.stage_timings_ms["faces"] = (time.perf_counter() - stage_started) * 1000
        work.array = array
    except Exception as exc:
        analysis.faces = []
        _fail(work, current_stage, exc)
    return work


def find_hazards(work: _Work, *, adapters: Adapters, settings: Settings) -> FrameAnalysis:
    """The second half: hazard detection, the rules, and one VLM check of what they flagged."""
    analysis, jpeg = work.analysis, work.jpeg
    if work.array is None:
        return analysis
    current_stage = "detect"
    try:
        stage_started = time.perf_counter()
        detections = adapters.detector.detect(work.array, filename=work.filename)
        analysis.detections = detections
        analysis.hazards = detections
        analysis.stage_timings_ms["detect"] = (time.perf_counter() - stage_started) * 1000

        current_stage = "evaluate_rules"
        stage_started = time.perf_counter()
        analysis.candidates = evaluate_rules(analysis.detections, analysis.faces, settings)
        analysis.stage_timings_ms["evaluate_rules"] = (time.perf_counter() - stage_started) * 1000

        vlm_candidates = [candidate for candidate in analysis.candidates if candidate.vlm_verify]
        if vlm_candidates and adapters.vlm is not None:
            try:
                result = adapters.vlm.verify(jpeg, [item.kind for item in vlm_candidates])
                analysis.vlm = result
                confirmations = {item.event_type: item for item in result.confirmations}
                for candidate in vlm_candidates:
                    confirmation = confirmations.get(candidate.kind)
                    if confirmation is None:
                        continue
                    candidate.verification = "model_confirmed" if confirmation.confirmed else "model_rejected"
                    candidate.vlm_confidence = result.confidence
                    candidate.vlm_evidence = [confirmation.evidence]
                analysis.caption = result.caption or None
            except Exception as exc:
                analysis.vlm.status = "failed"
                analysis.vlm.error = str(exc)
                for candidate in vlm_candidates:
                    candidate.verification = "unverified"
        analysis.duration_ms = round((time.perf_counter() - work.started) * 1000)
    except Exception as exc:
        _fail(work, current_stage, exc)
    return analysis


def analyze_frame(
    jpeg: bytes,
    *,
    adapters: Adapters,
    settings: Settings,
    enrolled_people: tuple[EnrolledPerson, ...] | Gallery = (),
    filename: str = "",
    on_faces: Callable[[list[FaceObservation]], None] | None = None,
) -> FrameAnalysis:
    """Both halves in one call. `on_faces` fires between them."""
    gallery = (
        enrolled_people
        if isinstance(enrolled_people, Gallery)
        else Gallery.build(enrolled_people, adapters.face_embedder.model)
    )
    work = match_faces(jpeg, adapters=adapters, settings=settings, gallery=gallery, filename=filename)
    if on_faces is not None and work.array is not None:
        on_faces(list(work.analysis.faces))
    return find_hazards(work, adapters=adapters, settings=settings)
