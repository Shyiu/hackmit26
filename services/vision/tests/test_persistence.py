from vision_service.crypto import decrypt_embedding


def test_profile_enrollment_and_matching(client, png_bytes, settings):
    response = client.post(
        "/face-profiles",
        files={"file": ("face.png", png_bytes, "image/png")},
        data={"name": "Alice", "consent_granted_by": "caregiver"},
    )
    assert response.status_code == 200
    assert "embedding_encrypted" not in response.json()
    profile = client.app.state.deps["repos"][1].list()[0]
    assert isinstance(profile.embedding_encrypted, bytes)
    assert decrypt_embedding(profile.embedding_encrypted, settings.fernet(), 512).shape == (512,)
    ingest = client.post("/ingest", files={"file": ("face.png", png_bytes, "image/png")})
    assert ingest.status_code == 200
    assert ingest.json()["faces"]["faces"][0]["profile_id"] == profile.id


def test_alert_patch_validation_and_missing(client, png_bytes):
    observation = client.post(
        "/ingest", files={"file": ("knife.png", png_bytes, "image/png")}
    ).json()
    alert_id = observation["alert_ids"][0]
    assert client.patch(f"/alerts/{alert_id}", json={"status": "acknowledged"}).status_code == 200
    assert client.patch(f"/alerts/{alert_id}", json={"status": "bad"}).status_code == 422
    assert client.patch("/alerts/missing", json={"status": "open"}).status_code == 404


def test_detector_failure_persists_failed_observation(client, app, png_bytes):
    class RaisingDetector:
        name = "raising"
        model = "raising"

        def detect(self, image, *, filename=""):
            raise RuntimeError("detector boom")

    deps = app.state.deps
    deps["adapters"].detector = RaisingDetector()
    response = client.post("/ingest", files={"file": ("x.png", png_bytes, "image/png")})
    assert response.status_code == 200
    assert response.json()["processing"]["state"] == "failed"
    assert response.json()["processing"]["failed_stage"] == "detect_objects"
