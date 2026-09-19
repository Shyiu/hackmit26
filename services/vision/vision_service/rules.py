from __future__ import annotations

from .config import Settings
from .schemas import CandidateAlert, DetectorResult, FaceResult
from .taxonomy import RULES, category_for_label


def evaluate_rules(
    detector_result: DetectorResult,
    face_result: FaceResult,
    settings: Settings | None = None,
) -> list[CandidateAlert]:
    settings = settings or Settings()
    grouped: dict[str, list] = {}
    for detection in detector_result.detections:
        category = category_for_label(detection.label, settings.HAZARD_LABELS_EXTRA)
        if category:
            grouped.setdefault(category, []).append(detection)
    candidates: list[CandidateAlert] = []
    for rule in RULES:
        if rule.category == "unknown_face":
            unknown = [
                face
                for face in face_result.faces
                if face.profile_id is None and face.confidence >= rule.min_confidence
            ]
            if unknown:
                candidates.append(
                    CandidateAlert(
                        event_type=rule.event_type,
                        severity=rule.severity,
                        confidence=max(face.confidence for face in unknown),
                        vlm_verify=False,
                        detections=[],
                        face_count=len(unknown),
                        category=rule.category,
                    )
                )
            continue
        detections = [
            detection
            for detection in grouped.get(rule.category, [])
            if detection.confidence >= rule.min_confidence
        ]
        if detections:
            candidates.append(
                CandidateAlert(
                    event_type=rule.event_type,
                    verified_event_type=rule.verified_event_type,
                    severity=rule.severity,
                    confidence=max(item.confidence for item in detections),
                    vlm_verify=rule.vlm_verify,
                    detections=detections,
                    face_count=0,
                    category=rule.category,
                )
            )
    return candidates
