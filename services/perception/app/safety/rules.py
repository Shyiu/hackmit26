from __future__ import annotations

from ..config import Settings
from .models import Candidate, Detection, FaceObservation
from .taxonomy import category_for_label

RULES = {
    "weapon": ("weapon_visible", "high", 0.75, True),
    "medication_or_chemical": ("medication_or_chemical_visible", "medium", 0.6, True),
    "hot_surface": ("hot_surface_visible", "medium", 0.6, True),
    "hazard_object": ("hazard_visible", "low", 0.6, True),
}


def evaluate_rules(
    detections: list[Detection], faces: list[FaceObservation], settings: Settings
) -> list[Candidate]:
    candidates: list[Candidate] = []
    for category, (kind, severity, threshold, vlm_verify) in RULES.items():
        matches = [
            detection
            for detection in detections
            if category_for_label(detection.label, settings.safety_hazard_labels_extra) == category
            and detection.confidence >= threshold
        ]
        if matches:
            best = max(matches, key=lambda item: item.confidence)
            candidates.append(
                Candidate(
                    kind=kind,
                    hazard_label=best.label,
                    severity=severity,
                    confidence=best.confidence,
                    bbox=best.bbox,
                    vlm_verify=vlm_verify,
                    detection=best,
                )
            )
    candidates.extend(
        Candidate(
            kind="unknown_face",
            hazard_label=None,
            severity="low",
            confidence=face.confidence,
            bbox=face.bbox,
            vlm_verify=False,
        )
        for face in faces
        if face.person_id is None and face.confidence >= settings.face_min_confidence
    )
    return candidates
