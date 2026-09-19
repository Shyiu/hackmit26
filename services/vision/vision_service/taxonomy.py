from __future__ import annotations

import re
from dataclasses import dataclass


def normalize_label(label: str) -> str:
    return re.sub(r"\s+", " ", label.strip().lower().replace("_", " "))


LABEL_CATEGORIES = {
    "knife": "weapon",
    "kitchen knife": "weapon",
    "firearm": "weapon",
    "gun": "weapon",
    "pistol": "weapon",
    "rifle": "weapon",
    "handgun": "weapon",
    "pill bottle": "medication_or_chemical",
    "medication": "medication_or_chemical",
    "medicine": "medication_or_chemical",
    "pill organizer": "medication_or_chemical",
    "chemical container": "medication_or_chemical",
    "bleach": "medication_or_chemical",
    "detergent": "medication_or_chemical",
    "stove": "hot_surface",
    "hot surface": "hot_surface",
    "burner": "hot_surface",
    "oven": "hot_surface",
    "kettle": "hot_surface",
}


@dataclass(frozen=True)
class AlertRule:
    event_type: str
    verified_event_type: str | None
    category: str
    min_confidence: float
    severity: str
    vlm_verify: bool


RULES = [
    AlertRule("unverified_weapon_visible", "weapon_visible", "weapon", 0.75, "high", True),
    AlertRule(
        "unverified_medication_or_chemical_visible",
        "medication_or_chemical_visible",
        "medication_or_chemical",
        0.6,
        "medium",
        True,
    ),
    AlertRule(
        "unverified_hot_surface_visible", "hot_surface_visible", "hot_surface", 0.6, "medium", True
    ),
    AlertRule(
        "unverified_hazard_object_visible",
        "hazard_object_visible",
        "hazard_object",
        0.6,
        "medium",
        True,
    ),
    AlertRule("unknown_face_detected", None, "unknown_face", 0.6, "low", False),
]


def categories(extra: str = "") -> dict[str, str]:
    result = dict(LABEL_CATEGORIES)
    for label in extra.split(","):
        label = normalize_label(label)
        if label:
            result[label] = "hazard_object"
    return result


def category_for_label(label: str, extra: str = "") -> str | None:
    return categories(extra).get(normalize_label(label))
