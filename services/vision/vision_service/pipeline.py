from __future__ import annotations

import io
import logging
import mimetypes
import time
from datetime import datetime

import numpy as np
from PIL import Image

from .adapters.registry import Adapters
from .config import Settings
from .crypto import decrypt_embedding
from .repositories import AlertsRepo, FaceProfilesRepo, ObservationsRepo, new_id
from .rules import evaluate_rules
from .schemas import (
    Alert,
    DetectorResult,
    Evidence,
    FaceObservation,
    FaceResult,
    ImageInfo,
    Notification,
    Observation,
    ProcessingInfo,
    ProcessingState,
    Verification,
)
from .storage import ImageStore

logger = logging.getLogger(__name__)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom else 0.0


def process_image(
    image_bytes: bytes,
    *,
    filename: str,
    device_id: str,
    captured_at: datetime,
    adapters: Adapters,
    repos: tuple[ObservationsRepo, FaceProfilesRepo, AlertsRepo],
    image_store: ImageStore,
    settings: Settings,
) -> Observation:
    observations, profiles, alerts = repos
    received_at = datetime.utcnow()
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    stored = image_store.put(image_bytes, content_type=content_type, suggested_name=filename)
    observation = Observation(
        _id=new_id(),
        device_id=device_id,
        captured_at=captured_at,
        received_at=received_at,
        image=ImageInfo(
            url=stored.url,
            store=stored.store,
            key=stored.key,
            sha256=stored.sha256,
            width=0,
            height=0,
            content_type=content_type,
            bytes=stored.bytes,
        ),
        processing=ProcessingInfo(state=ProcessingState.processing),
        created_at=received_at,
        updated_at=received_at,
    )
    stage = "store_image"
    try:
        stage_started = time.perf_counter()
        raw = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image = np.asarray(raw)
        observation.image.width, observation.image.height = raw.size
        observation.processing.stage_timings_ms["decode"] = (
            time.perf_counter() - stage_started
        ) * 1000
        stage = "detect_objects"
        stage_started = time.perf_counter()
        detections = adapters.detector.detect(image, filename=filename)
        detector_latency = (time.perf_counter() - stage_started) * 1000
        observation.detector = DetectorResult(
            adapter=adapters.detector.name,
            model=adapters.detector.model,
            detections=detections,
            latency_ms=detector_latency,
        )
        observation.processing.stage_timings_ms[stage] = detector_latency
        stage = "detect_faces"
        stage_started = time.perf_counter()
        detected_faces = adapters.face_detector.detect(image, filename=filename)
        observation.processing.stage_timings_ms[stage] = (
            time.perf_counter() - stage_started
        ) * 1000
        stage = "embed_and_match"
        stage_started = time.perf_counter()
        fernet = settings.fernet()
        face_observations = []
        stored_profiles = profiles.list()
        for face in detected_faces:
            embedding = adapters.face_embedder.embed(image, face)
            best_id, best_score = None, 0.0
            for profile in stored_profiles:
                score = _cosine(
                    embedding,
                    decrypt_embedding(profile.embedding_encrypted, fernet, profile.embedding_dim),
                )
                if score > best_score:
                    best_id, best_score = profile.id, score
            if best_score < settings.FACE_MATCH_THRESHOLD:
                best_id = None
            face_observations.append(
                FaceObservation(
                    bbox=face.bbox,
                    confidence=face.confidence,
                    profile_id=best_id,
                    match_confidence=best_score if best_id else None,
                )
            )
        observation.faces = FaceResult(
            adapter=adapters.face_detector.name,
            faces=face_observations,
            latency_ms=(time.perf_counter() - stage_started) * 1000,
        )
        observation.processing.stage_timings_ms[stage] = observation.faces.latency_ms
        observation.processing.stage_timings_ms["evaluate_rules"] = 0
        observations.insert(observation)
        candidates = evaluate_rules(observation.detector, observation.faces, settings)
        observation.processing.stage_timings_ms["evaluate_rules"] = 0
        stage = "create_alerts"
        vlm_candidates = []
        created_alerts = []
        for candidate in candidates:
            alert = Alert(
                _id=new_id(),
                event_type=candidate.event_type,
                severity=candidate.severity,
                confidence=candidate.confidence,
                verification=Verification(),
                observation_ids=[observation.id],
                evidence=Evidence(detections=candidate.detections, face_count=candidate.face_count),
                notification=Notification(),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            alerts.insert(alert)
            created_alerts.append(alert)
            if candidate.vlm_verify:
                vlm_candidates.append(candidate)
        if vlm_candidates and settings.VLM != "off" and adapters.vlm:
            stage = "vlm_verify"
            event_types = [candidate.event_type for candidate in vlm_candidates]
            try:
                verification = adapters.vlm.verify(image_bytes, event_types)
                observation.caption = verification.caption or None
                for candidate, alert in zip(vlm_candidates, created_alerts, strict=False):
                    confirmation = next(
                        (
                            item
                            for item in verification.confirmations
                            if item.event_type == candidate.event_type
                        ),
                        None,
                    )
                    alert.verification.vlm_confidence = verification.confidence
                    alert.verification.evidence = (
                        [confirmation.evidence] if confirmation and confirmation.evidence else []
                    )
                    alert.verification.verified_at = datetime.utcnow()
                    if confirmation and confirmation.confirmed and candidate.verified_event_type:
                        alert.event_type = candidate.verified_event_type
                        alert.verification.state = "model_confirmed"
                        alert.verification.method = "vlm"
                    else:
                        alert.verification.state = "model_rejected"
                        alert.verification.method = "vlm"
                    alerts.update(alert)
            except Exception as exc:
                logger.exception(
                    "vlm verification failed", extra={"observation_id": observation.id}
                )
                for alert in created_alerts:
                    if alert.verification.state == "unverified":
                        alert.verification.state = "model_error"
                        alert.verification.method = "vlm"
                        alert.verification.evidence = [str(exc)]
                        alerts.update(alert)
        observation.alert_ids = [alert.id for alert in created_alerts]
        observation.processing.state = ProcessingState.completed
        observation.updated_at = datetime.utcnow()
        observations.update(observation)
        return observation
    except Exception as exc:
        observation.processing.state = ProcessingState.failed
        observation.processing.failed_stage = stage
        observation.processing.error = str(exc)
        observation.updated_at = datetime.utcnow()
        observations.update(observation)
        logger.exception(
            "image processing failed", extra={"observation_id": observation.id, "stage": stage}
        )
        return observation
