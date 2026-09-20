from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image

from ..config import Settings
from .adapters.registry import Adapters
from .models import EnrolledPerson, FaceBox, FaceMatchCandidate, FaceObservation, FrameAnalysis, Gallery

# A match has to beat the next person by this much, so a lookalike pair names nobody.
MATCH_MARGIN = 0.05


def _ranked_candidates(embedding: np.ndarray, gallery: Gallery) -> list[tuple[EnrolledPerson, float]]:
    """Every enrolled person's similarity to `embedding`, best first.

    Each person scores as their best reference photo. Empty if there's no
    gallery, or the embedding is zero or from a different model's space.
    """
    if not gallery.people:
        return []
    norm = float(np.linalg.norm(embedding))
    if not norm or embedding.shape[0] != gallery.matrix.shape[1]:
        return []
    scores = np.full(len(gallery.people), -1.0, dtype=np.float32)
    np.maximum.at(scores, gallery.owners, gallery.matrix @ (embedding / norm))
    order = np.argsort(scores)[::-1]
    # Clamped: float32 rounding puts an identical vector a hair over 1, which the model rejects.
    return [(gallery.people[int(i)], float(min(max(scores[i], 0.0), 1.0))) for i in order]


def _match_person(
    embedding: np.ndarray, gallery: Gallery, threshold: float
) -> tuple[EnrolledPerson | None, float | None, list[tuple[EnrolledPerson, float]]]:
    ranked = _ranked_candidates(embedding, gallery)
    if not ranked:
        return None, None, ranked
    best_person, best_score = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    if best_score < threshold or (len(ranked) > 1 and best_score - runner_up < MATCH_MARGIN):
        return None, best_score, ranked
    return best_person, best_score, ranked


def detect_and_embed(
    adapters: Adapters, image: np.ndarray, *, filename: str = "", for_enrollment: bool = False
) -> list[tuple[FaceBox, np.ndarray]]:
    """One model pass when a single adapter does both jobs, as InsightFace does.

    `for_enrollment` asks the adapter for its most reliable (not necessarily
    fastest) detection: enrollment is rare and its photos come in unpredictable
    framing, unlike the live frame path, which stays on the fast setting.
    """
    analyze = getattr(adapters.face_detector, "analyze", None)
    if analyze is not None and adapters.face_detector is adapters.face_embedder:
        return list(analyze(image, filename=filename, for_enrollment=for_enrollment))
    # The plain detect-then-embed path is the general FaceDetector/FaceEmbedder contract,
    # implemented by mocks and test doubles that know nothing about for_enrollment.
    faces = adapters.face_detector.detect(image, filename=filename)
    embeddings = adapters.face_embedder.embed(image, faces) if faces else []
    return list(zip(faces, embeddings, strict=True))


@dataclass(slots=True)
class _Work:
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
    """Decode, then find and name faces."""
    started = time.perf_counter()
    analysis = FrameAnalysis(width=0, height=0)
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
            person, score, ranked = _match_person(embedding, gallery, settings.face_match_threshold)
            analysis.faces.append(
                FaceObservation(
                    bbox=face.bbox,
                    confidence=face.confidence,
                    person_id=person.person_id if person else None,
                    match_confidence=score,
                    name=person.name if person else None,
                    relation=person.relation if person else None,
                    candidates=tuple(
                        FaceMatchCandidate(
                            person_id=candidate.person_id,
                            name=candidate.name,
                            relation=candidate.relation,
                            similarity=similarity,
                        )
                        for candidate, similarity in ranked
                    ),
                )
            )
        analysis.stage_timings_ms["faces"] = (time.perf_counter() - stage_started) * 1000
        work.array = array
        analysis.duration_ms = round((time.perf_counter() - started) * 1000)
    except Exception as exc:
        analysis.faces = []
        _fail(work, current_stage, exc)
    return work


def analyze_frame(
    jpeg: bytes,
    *,
    adapters: Adapters,
    settings: Settings,
    enrolled_people: tuple[EnrolledPerson, ...] | Gallery = (),
    filename: str = "",
    on_faces: Callable[[list[FaceObservation]], None] | None = None,
) -> FrameAnalysis:
    """`on_faces` fires once faces are matched."""
    gallery = (
        enrolled_people
        if isinstance(enrolled_people, Gallery)
        else Gallery.build(enrolled_people, adapters.face_embedder.model)
    )
    work = match_faces(jpeg, adapters=adapters, settings=settings, gallery=gallery, filename=filename)
    if on_faces is not None and work.array is not None:
        on_faces(list(work.analysis.faces))
    return work.analysis
