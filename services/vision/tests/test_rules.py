from vision_service.config import Settings
from vision_service.rules import evaluate_rules
from vision_service.schemas import BBox, Detection, DetectorResult, FaceObservation, FaceResult


def detector(label, confidence):
    return DetectorResult(
        adapter="mock",
        model="mock",
        detections=[
            Detection(
                label=label, confidence=confidence, bbox=BBox(x=0, y=0, w=1, h=1), source="mock"
            )
        ],
    )


def test_weapon_threshold():
    faces = FaceResult(adapter="mock")
    assert (
        evaluate_rules(detector("knife", 0.9), faces)[0].event_type == "unverified_weapon_visible"
    )
    assert evaluate_rules(detector("knife", 0.5), faces) == []


def test_weapon_and_unknown_face_are_independent():
    faces = FaceResult(
        adapter="mock",
        faces=[FaceObservation(bbox=BBox(x=0, y=0, w=1, h=1), confidence=0.9)],
    )
    events = evaluate_rules(detector("knife", 0.9), faces)
    assert {event.event_type for event in events} == {
        "unverified_weapon_visible",
        "unknown_face_detected",
    }


def test_matched_face_and_extra_hazard():
    faces = FaceResult(
        adapter="mock",
        faces=[
            FaceObservation(
                bbox=BBox(x=0, y=0, w=1, h=1),
                confidence=0.9,
                profile_id="profile",
                match_confidence=0.9,
            )
        ],
    )
    assert not any(
        event.category == "unknown_face" for event in evaluate_rules(detector("knife", 0.9), faces)
    )
    event = evaluate_rules(
        detector("tripwire", 0.9),
        FaceResult(adapter="mock"),
        Settings(HAZARD_LABELS_EXTRA="tripwire"),
    )[0]
    assert event.category == "hazard_object"
