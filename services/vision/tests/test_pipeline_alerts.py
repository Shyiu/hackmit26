from datetime import datetime

from vision_service.adapters.mock import MockDetector, MockFaceDetector, MockFaceEmbedder, MockVLM
from vision_service.adapters.registry import Adapters
from vision_service.pipeline import process_image


def run_pipeline(app, png_bytes, settings, vlm):
    deps = app.state.deps
    deps["adapters"] = Adapters(MockDetector(), MockFaceDetector(), MockFaceEmbedder(), vlm)
    return process_image(
        png_bytes,
        filename="knife.png",
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
