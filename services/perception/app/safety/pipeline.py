from __future__ import annotations

import time
from io import BytesIO

import numpy as np
from PIL import Image

from ..config import Settings
from .adapters.registry import Adapters
from .models import EnrolledPerson, FaceObservation, FrameAnalysis
from .rules import evaluate_rules


def _cosine(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    return float(np.dot(left, right) / denominator) if denominator else 0


def _match_person(
    embedding: np.ndarray, people: tuple[EnrolledPerson, ...], threshold: float
) -> tuple[EnrolledPerson | None, float | None]:
    scored = [
        (person, max((_cosine(embedding, item) for item in person.embeddings), default=0))
        for person in people
    ]
    if not scored:
        return None, None
    scored.sort(key=lambda item: item[1], reverse=True)
    best_person, best_score = scored[0]
    runner_up = scored[1][1] if len(scored) > 1 else 0
    if best_score < threshold or (len(scored) > 1 and best_score - runner_up < 0.05):
        return None, best_score
    return best_person, best_score


def analyze_frame(
    jpeg: bytes,
    *,
    adapters: Adapters,
    settings: Settings,
    enrolled_people: tuple[EnrolledPerson, ...] = (),
    filename: str = "",
) -> FrameAnalysis:
    started = time.perf_counter()
    analysis = FrameAnalysis(width=0, height=0, detector_name=adapters.detector.name)
    current_stage = "decode"
    try:
        stage_started = time.perf_counter()
        image = Image.open(BytesIO(jpeg)).convert("RGB")
        array = np.asarray(image)
        analysis.width, analysis.height = image.size
        analysis.stage_timings_ms["decode"] = (time.perf_counter() - stage_started) * 1000

        current_stage = "detect"
        stage_started = time.perf_counter()
        detections = adapters.detector.detect(array, filename=filename)
        analysis.detections = detections
        analysis.hazards = detections
        analysis.stage_timings_ms["detect"] = (time.perf_counter() - stage_started) * 1000

        current_stage = "faces"
        stage_started = time.perf_counter()
        raw_faces = adapters.face_detector.detect(array, filename=filename)
        embeddings = adapters.face_embedder.embed(array, raw_faces) if raw_faces else []
        for face, embedding in zip(raw_faces, embeddings, strict=True):
            person, score = _match_person(embedding, enrolled_people, settings.face_match_threshold)
            analysis.faces.append(
                FaceObservation(
                    bbox=face.bbox,
                    confidence=face.confidence,
                    person_id=person.person_id if person else None,
                    match_confidence=score,
                )
            )
        analysis.stage_timings_ms["faces"] = (time.perf_counter() - stage_started) * 1000

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
        analysis.duration_ms = round((time.perf_counter() - started) * 1000)
        return analysis
    except Exception as exc:
        analysis.processing_status = "failed"
        analysis.failed_stage = current_stage
        analysis.error = str(exc)
        analysis.duration_ms = round((time.perf_counter() - started) * 1000)
        return analysis
