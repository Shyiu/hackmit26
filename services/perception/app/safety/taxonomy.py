from __future__ import annotations

import re

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


def normalize_label(label: str) -> str:
    return re.sub(r"\s+", " ", label.strip().lower().replace("_", " "))


def category_for_label(label: str, extra: str = "") -> str | None:
    categories = dict(LABEL_CATEGORIES)
    for item in extra.split(","):
        normalized = normalize_label(item)
        if normalized:
            categories[normalized] = "hazard_object"
    return categories.get(normalize_label(label))
