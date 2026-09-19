from datetime import datetime

from vision_service.adapters.mock import MockDetector, MockFaceDetector, MockFaceEmbedder, MockVLM
from vision_service.adapters.registry import Adapters
from vision_service.pipeline import process_image
from vision_service.schemas import VLMVerification


def run_pipeline(app, png_bytes, settings, vlm, filename="knife.png"):
    deps = app.state.deps
    deps["adapters"] = Adapters(MockDetector(), MockFaceDetector(), MockFaceEmbedder(), vlm)
    return process_image(
        png_bytes,
        filename=filename,
        device_id="test",
        captured_at=datetime.utcnow(),
        adapters=deps["adapters"],
        repos=deps["repos"],
        image_store=deps["image_store"],
        settings=settings,
    )


def test_vlm_confirmation_updates_alert(client, app, png_bytes, settings):
    obs = run_pipeline(app, png_bytes, settings, MockVLM())
    alert = app.state.deps["repos"][2].get(obs.alert_ids[0])
    assert alert.event_type == "weapon_visible"
    assert alert.verification.state == "model_confirmed"
    assert obs.caption


def test_vlm_rejection_and_error_complete(client, app, png_bytes, settings):
    rejected = run_pipeline(app, png_bytes, settings, MockVLM(confirm=False))
    assert (
        app.state.deps["repos"][2].get(rejected.alert_ids[0]).verification.state == "model_rejected"
    )
    failed = run_pipeline(app, png_bytes, settings, MockVLM(raise_error=True))
    assert failed.processing.state == "completed"
    assert app.state.deps["repos"][2].get(failed.alert_ids[0]).verification.state == "model_error"


def test_vlm_pairs_only_vlm_alerts_with_face_alert(client, app, png_bytes, settings):
    failed = run_pipeline(
        app, png_bytes, settings, MockVLM(raise_error=True), filename="knife_face.png"
    )
    failed_alerts = [app.state.deps["repos"][2].get(alert_id) for alert_id in failed.alert_ids]
    assert {alert.event_type: alert.verification.state for alert in failed_alerts} == {
        "unverified_weapon_visible": "model_error",
        "unknown_face_detected": "unverified",
    }

    confirmed = run_pipeline(app, png_bytes, settings, MockVLM(), filename="knife_face.png")
    confirmed_alerts = [
        app.state.deps["repos"][2].get(alert_id) for alert_id in confirmed.alert_ids
    ]
    assert {alert.event_type: alert.verification.state for alert in confirmed_alerts} == {
        "weapon_visible": "model_confirmed",
        "unknown_face_detected": "unverified",
    }


def test_missing_vlm_confirmation_stays_unverified(client, app, png_bytes, settings):
    class MissingConfirmationVLM:
        name = "mock"
        model = "mock"

        def verify(self, image_bytes, candidate_event_types):
            return VLMVerification(
                caption="No candidate was confirmed.",
                confirmations=[],
                confidence=0.2,
                observable_evidence=[],
            )

    observation = run_pipeline(app, png_bytes, settings, MissingConfirmationVLM())
    alert = app.state.deps["repos"][2].get(observation.alert_ids[0])
    assert alert.verification.state == "unverified"
    assert alert.verification.method == "none"
