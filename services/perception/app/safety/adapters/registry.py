from __future__ import annotations

from dataclasses import dataclass

from ...config import Settings
from .mock import MockFaceDetector, MockFaceEmbedder
from .protocols import FaceDetector, FaceEmbedder


@dataclass
class Adapters:
    face_detector: FaceDetector
    face_embedder: FaceEmbedder


def build_adapters(settings: Settings) -> Adapters:
    if settings.face_detector == "mock" and settings.face_embedder == "mock":
        face_detector, face_embedder = MockFaceDetector(settings=settings), MockFaceEmbedder()
    elif settings.face_detector == "insightface" or settings.face_embedder == "insightface":
        if not settings.face_embedding_key:
            # Without a persisted key, every enrolled face's embedding is encrypted
            # under a fresh random Fernet key generated this boot, so every
            # enrollment becomes undecryptable — and every enrolled person
            # unrecognizable — the moment the process restarts. Refuse to boot
            # with real face recognition on rather than silently losing enrollments.
            raise ValueError(
                "FACE_EMBEDDING_KEY is not set. Real face recognition needs a stable key so "
                "enrolled embeddings survive a restart — set it in services/perception/.env "
                "(pnpm start fills this in automatically and keeps it stable across reruns)."
            )
        from .insightface import InsightFaceAdapter

        # One instance for both jobs, so the pipeline can detect and embed in a single pass.
        shared = InsightFaceAdapter(
            settings.insightface_model,
            providers=settings.face_providers,
            det_size=settings.face_det_size,
            max_faces=settings.face_max_per_frame,
        )
        face_detector = shared
        face_embedder = shared
    else:
        raise ValueError("unsupported face adapter configuration")

    return Adapters(face_detector=face_detector, face_embedder=face_embedder)
