from __future__ import annotations

from io import BytesIO

import numpy as np
from bson import ObjectId
from PIL import Image

from app.config import Settings
from app.safety.adapters.registry import Adapters
from app.safety.models import BBox, EnrolledPerson, FaceBox, Gallery
from app.safety.pipeline import _match_person, analyze_frame


def settings(**overrides) -> Settings:
    return Settings(
        mongodb_uri="mongodb://127.0.0.1:27017",
        device_token_secret="x" * 32,
        **overrides,
    )


def jpeg() -> bytes:
    output = BytesIO()
    Image.new("RGB", (16, 16), "white").save(output, format="JPEG")
    return output.getvalue()


def _unit(*values: float) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


def test_match_scores_each_person_by_their_best_photo():
    alex = EnrolledPerson(ObjectId(), (_unit(0, 1, 0), _unit(1, 0.1, 0)), "m", name="Alex")
    sam = EnrolledPerson(ObjectId(), (_unit(0, 0, 1),), "m", name="Sam")
    person, score, ranked = _match_person(_unit(1, 0, 0), Gallery.build((alex, sam), "m"), 0.45)
    assert person is alex
    assert score is not None and score > 0.99
    assert [candidate for candidate, _ in ranked] == [alex, sam]


def test_match_names_nobody_when_two_people_are_too_close():
    alex = EnrolledPerson(ObjectId(), (_unit(1, 0.02, 0),), "m")
    sam = EnrolledPerson(ObjectId(), (_unit(1, 0, 0.02),), "m")
    person, score, ranked = _match_person(_unit(1, 0, 0), Gallery.build((alex, sam), "m"), 0.45)
    assert person is None
    assert score is not None and score > 0.99
    assert len(ranked) == 2


def test_gallery_leaves_out_people_enrolled_by_another_model():
    mock = EnrolledPerson(ObjectId(), (_unit(1, 0, 0),), "mock-512")
    real = EnrolledPerson(ObjectId(), (_unit(0, 1, 0),), "insightface-buffalo_l")
    gallery = Gallery.build((mock, real), "insightface-buffalo_l")
    assert gallery.people == (real,)
    assert _match_person(_unit(1, 0, 0), gallery, 0.45)[0] is None
    assert _match_person(_unit(1, 0, 0), Gallery.build((), "m"), 0.45) == (None, None, [])


class _OnePassFaces:
    """Shaped like InsightFaceAdapter: one object, and an analyze() that does both jobs."""

    name = "one-pass"
    model = "one-pass"

    def __init__(self, events: list[str]):
        self.events = events

    def analyze(self, image, *, filename="", for_enrollment=False):
        self.events.append("analyze")
        return [(FaceBox(bbox=BBox(x=0.1, y=0.1, w=0.2, h=0.2), confidence=0.9), _unit(1, 0, 0))]

    def detect(self, image, *, filename=""):
        raise AssertionError("the single pass should have been used")

    def embed(self, image, faces):
        raise AssertionError("the single pass should have been used")


def test_faces_are_matched_in_one_pass_and_reported():
    events: list[str] = []
    faces = _OnePassFaces(events)
    alex = EnrolledPerson(ObjectId(), (_unit(1, 0, 0),), "one-pass", name="Alex", relation="son")
    analysis = analyze_frame(
        jpeg(),
        adapters=Adapters(face_detector=faces, face_embedder=faces),
        settings=settings(),
        enrolled_people=(alex,),
        on_faces=lambda found: events.append(f"reported {found[0].name}"),
    )
    assert events == ["analyze", "reported Alex"]
    assert analysis.faces[0].person_id == alex.person_id
    # The name rides to the wearer's page and stays out of the stored observation.
    assert set(analysis.to_observation_fields()["faces"][0]) == {
        "bbox",
        "confidence",
        "personId",
        "matchConfidence",
    }
