from bson import ObjectId
from test_safety import settings

from app.safety.models import BBox, Detection, FaceObservation
from app.safety.rules import evaluate_rules


def detection(label: str, confidence: float) -> Detection:
    return Detection(label=label, confidence=confidence, bbox=BBox(x=0, y=0, w=1, h=1))


def face(person_id=None) -> FaceObservation:
    return FaceObservation(bbox=BBox(x=0, y=0, w=1, h=1), confidence=0.95, person_id=person_id)


def test_weapon_threshold_and_unknown_face_rules():
    assert evaluate_rules([detection("knife", 0.74)], [], settings()) == []
    candidates = evaluate_rules([detection("knife", 0.75)], [], settings())
    assert {candidate.kind for candidate in candidates} == {"weapon_visible"}
    candidates = evaluate_rules([detection("knife", 0.9)], [face()], settings())
    assert {candidate.kind for candidate in candidates} == {"weapon_visible", "unknown_face"}


def test_matched_face_does_not_create_unknown_face():
    assert evaluate_rules([], [face(ObjectId())], settings()) == []


def test_extra_hazard_label():
    candidates = evaluate_rules([detection("ladder", 0.9)], [], settings(safety_hazard_labels_extra="ladder"))
    assert [candidate.kind for candidate in candidates] == ["hazard_visible"]
