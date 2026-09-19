from __future__ import annotations

from io import BytesIO

from PIL import Image

from app.config import Settings
from app.safety.adapters.mock import MockDetector, MockFaceDetector, MockFaceEmbedder, MockVLM
from app.safety.adapters.registry import Adapters
from app.safety.models import BBox, Detection
from app.safety.pipeline import analyze_frame
from app.safety.rules import evaluate_rules
from app.safety.vlm import validate_vlm_output


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


def test_rules_are_conservative_and_add_unknown_faces():
    config = settings()
    candidates = evaluate_rules(
        [Detection(label="knife", confidence=0.9, bbox=BBox(x=0, y=0, w=1, h=1))],
        [],
        config,
    )
    assert [item.kind for item in candidates] == ["weapon_visible"]


def test_vlm_drops_missing_confirmation_without_rejection():
    result = validate_vlm_output(
        '{"caption":"A frame.","confirmations":[],"confidence":0.9,"observable_evidence":[]}',
        ["weapon_visible"],
    )
    assert result.confirmations == []


def test_pipeline_calls_vlm_once_and_keeps_unknown_face_unverified():
    config = settings(safety_mock_faces=1)
    vlm = MockVLM()
    analysis = analyze_frame(
        jpeg(),
        adapters=Adapters(
            detector=MockDetector([Detection(label="knife", confidence=0.9, bbox=BBox(x=0, y=0, w=1, h=1))]),
            face_detector=MockFaceDetector(faces=1),
            face_embedder=MockFaceEmbedder(),
            vlm=vlm,
        ),
        settings=config,
    )
    assert vlm.calls == 1
    assert {item.kind: item.verification for item in analysis.candidates} == {
        "weapon_visible": "model_confirmed",
        "unknown_face": "unverified",
    }


def test_pipeline_vlm_failure_only_leaves_vlm_candidate_unverified():
    analysis = analyze_frame(
        jpeg(),
        adapters=Adapters(
            detector=MockDetector([Detection(label="knife", confidence=0.9, bbox=BBox(x=0, y=0, w=1, h=1))]),
            face_detector=MockFaceDetector(faces=1),
            face_embedder=MockFaceEmbedder(),
            vlm=MockVLM(raise_error=True),
        ),
        settings=settings(),
    )
    assert {item.kind: item.verification for item in analysis.candidates} == {
        "weapon_visible": "unverified",
        "unknown_face": "unverified",
    }
