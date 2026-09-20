from __future__ import annotations

from io import BytesIO

from bson import ObjectId
from conftest import Database, Seed
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app
from app.tokens import DeviceTokenClaims, sign_device_token


def _jpeg() -> bytes:
    output = BytesIO()
    Image.new("RGB", (16, 16), "white").save(output, format="JPEG")
    return output.getvalue()


async def _patient(db: Database) -> tuple[ObjectId, str]:
    patient_id = await Seed(db).patient()
    token = sign_device_token(
        DeviceTokenClaims(
            v=1,
            sub=None,
            pid=str(patient_id),
            scope="api",
            iat=1_000_000,
            exp=4_000_000_000,
            tv=0,
        ),
        "x" * 32,
    )
    return patient_id, token


async def _device(db: Database, patient_id: ObjectId) -> ObjectId:
    return await Seed(db).device(patient_id)


async def test_safety_api_enrolls_and_records_a_real_mongo_frame(db: Database, tmp_path) -> None:
    patient_id, token = await _patient(db)
    await _device(db, patient_id)
    settings = Settings(
        mongodb_uri="mongodb://127.0.0.1:27017/?directConnection=true",
        mongodb_db=db.name,
        device_token_secret="x" * 32,
        frame_image_dir=str(tmp_path),
    )
    with TestClient(create_app(settings)) as client:
        enrollment = client.post(
            "/people",
            headers={"Authorization": f"Bearer {token}"},
            files={"photos": ("face.jpg", _jpeg(), "image/jpeg")},
            data={"name": "Alex", "consentedBy": "caregiver"},
        )
        assert enrollment.status_code == 201, enrollment.text
        assert "faceEmbeddings" not in enrollment.json()

        frame_token = sign_device_token(
            DeviceTokenClaims(
                v=1,
                sub=None,
                pid=str(patient_id),
                scope="frames",
                iat=1_000_000,
                exp=4_000_000_000,
                tv=0,
            ),
            "x" * 32,
        )
        frame = client.post(
            "/frames",
            headers={"Authorization": f"Bearer {frame_token}"},
            files={"file": ("knife_face.jpg", _jpeg(), "image/jpeg")},
        )
        assert frame.status_code == 201, frame.text
        assert frame.json()["faces"][0]["personId"] == enrollment.json()["_id"]
        assert frame.json()["dangerEventIds"]

        events = client.get(
            "/danger-events",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert events.status_code == 200
        assert events.json()[0]["kind"] == "weapon_visible"
        event_id = events.json()[0]["_id"]
        acknowledged = client.patch(
            f"/danger-events/{event_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"status": "acknowledged", "acknowledgedBy": "caregiver"},
        )
        assert acknowledged.status_code == 200
        assert acknowledged.json()["acknowledgedBy"] == "caregiver"
        assert acknowledged.json()["acknowledgedAt"] is not None


async def _token(patient_id: ObjectId, scope: str, sub: ObjectId | None = None, tv: int = 0) -> str:
    return sign_device_token(
        DeviceTokenClaims(
            v=1,
            sub=str(sub) if sub else None,
            pid=str(patient_id),
            scope=scope,
            iat=1_000_000,
            exp=4_000_000_000,
            tv=tv,
        ),
        "x" * 32,
    )


async def test_safety_api_auth_and_local_path_guards(db: Database, tmp_path) -> None:
    patient_id, api_token = await _patient(db)
    revoked = await Seed(db).device(patient_id, revoked=True)
    frames_token = await _token(patient_id, "frames")
    revoked_token = await _token(patient_id, "frames", revoked)
    config = Settings(
        mongodb_uri="mongodb://127.0.0.1:27017/?directConnection=true",
        mongodb_db=db.name,
        device_token_secret="x" * 32,
        frame_image_dir=str(tmp_path),
    )
    with TestClient(create_app(config)) as client:
        assert client.get("/people").status_code == 401
        assert client.get("/people", headers={"Authorization": f"Bearer {frames_token}"}).status_code == 403
        assert (
            client.post(
                "/frames",
                headers={"Authorization": f"Bearer {revoked_token}"},
                files={"file": ("frame.jpg", _jpeg(), "image/jpeg")},
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/frames",
                headers={"Authorization": f"Bearer {frames_token}"},
                files={"file": ("frame.jpg", _jpeg(), "image/jpeg")},
                data={"capturedAt": "string"},
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/frames",
                headers={"Authorization": f"Bearer {api_token}"},
                json={"path": str(tmp_path / "frame.jpg")},
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/danger-events",
                headers={"Authorization": f"Bearer {await _token(ObjectId(), 'api')}"},
            ).json()
            == []
        )
