import hashlib


def test_ingest_and_observation_queries(client, png_bytes, settings):
    response = client.post("/ingest", files={"file": ("knife.png", png_bytes, "image/png")})
    assert response.status_code == 200
    observation = response.json()
    assert observation["processing"]["state"] == "completed"
    assert observation["image"]["sha256"] == hashlib.sha256(png_bytes).hexdigest()
    assert settings.IMAGE_DIR in observation["image"]["url"]
    assert client.get("/observations").json()[0]["_id"] == observation["_id"]
    assert client.get(f"/observations/{observation['_id']}").status_code == 200


def test_non_image_rejected(client):
    assert client.post("/ingest", files={"file": ("x.txt", b"no", "text/plain")}).status_code == 415


def test_invalid_captured_at_rejected(client, png_bytes):
    response = client.post(
        "/ingest",
        files={"file": ("image.png", png_bytes, "image/png")},
        data={"captured_at": "string"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "captured_at must be an ISO 8601 timestamp"


def test_valid_captured_at_is_persisted(client, png_bytes):
    captured_at = "2026-09-19T12:34:56+00:00"
    response = client.post(
        "/ingest",
        files={"file": ("image.png", png_bytes, "image/png")},
        data={"captured_at": captured_at},
    )
    assert response.status_code == 200
    assert response.json()["captured_at"] == captured_at


def test_local_path_ingest(client, tmp_path, png_bytes):
    path = tmp_path / "person.png"
    path.write_bytes(png_bytes)
    response = client.post("/ingest", json={"path": str(path), "device_id": "path-device"})
    assert response.status_code == 200
    assert response.json()["device_id"] == "path-device"
