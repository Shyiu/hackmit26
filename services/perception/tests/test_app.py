"""The FastAPI app through its test client, against the same real MongoDB as the store tests."""

from __future__ import annotations

import asyncio
import json
import tempfile
import threading
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from bson import ObjectId
from conftest import TEST_URI, Database, Seed
from fastapi.testclient import TestClient
from PIL import Image
from pymongo import MongoClient
from pymongo.collection import Collection
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.detector import Detector, Prompts
from app.main import create_app
from app.protocol import (
    Detection,
    DetectionsMessage,
    ErrorMessage,
    FacesMessage,
    FrameHeader,
    SessionMessage,
    encode_frame,
    parse_server_message,
)
from app.safety.adapters.mock import MockDetector, MockFaceDetector, MockFaceEmbedder, MockVLM
from app.safety.adapters.registry import Adapters
from app.safety.models import BBox, FaceBox
from app.safety.models import Detection as SafetyDetection
from app.store import ObservationStore
from app.tokens import DeviceTokenClaims, sign_device_token

FIXTURE: dict[str, Any] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "packages" / "shared" / "fixtures" / "device-token.json"
    ).read_text()
)
SECRET: str = FIXTURE["secret"]
PATIENT = ObjectId(FIXTURE["claims"]["pid"])
DEVICE = ObjectId(FIXTURE["claims"]["sub"])
REVOKED_DEVICE = ObjectId("5eed00000000000000000d02")
OTHER_PATIENT = ObjectId("5eed00000000000000000002")
WRONG_SECRET = "another-secret-of-the-right-length-0123456789"
JPEG = b"\xff\xd8\xff\xe0" + bytes(60)


@pytest.fixture(scope="module")
async def wearer_db(db: Database) -> Database:
    # The wearer and chest phone the fixture token names.
    seed = Seed(db)
    await seed.patient(PATIENT)
    await seed.device(PATIENT, DEVICE)
    await seed.device(PATIENT, REVOKED_DEVICE, revoked=True)
    # A second household, so a token can name a real wearer that isn't the device's.
    await seed.patient(OTHER_PATIENT)
    return db


def _client(db_name: str, uri: str = TEST_URI, detector: Detector | None = None) -> TestClient:
    settings = Settings(
        mongodb_uri=uri,
        mongodb_db=db_name,
        device_token_secret=SECRET,
        # An opened sighting writes a keyframe file; give each client its own scratch directory.
        frame_image_dir=tempfile.mkdtemp(prefix="perception-frames-"),
    )
    # The fixture token was minted for a fixed moment, so the app reads that as now.
    return TestClient(create_app(settings, detector=detector, token_clock=lambda: FIXTURE["validAt"]))


class StubDetector:
    """Sees the wearer's first tracked item in every frame, and can be made slow."""

    name = "stub"

    def __init__(self) -> None:
        self.seen: list[tuple[int, Prompts]] = []
        self.release = threading.Event()
        self.release.set()

    def detect(self, jpeg: bytes, header: FrameHeader, prompts: Prompts) -> list[Detection] | None:
        self.release.wait(5.0)
        self.seen.append((header.seq, prompts))
        if not prompts:
            return []
        item = prompts[0]
        return [Detection(itemId=item.item_id, label=item.label, bbox=(0.4, 0.3, 0.2, 0.2), confidence=0.9)]


def _live_session(ws: WebSocketTestSession) -> str:
    ws.send_text(_hello(FIXTURE["token"]))
    opened = parse_server_message(ws.receive_text())
    assert isinstance(opened, SessionMessage)
    ws.send_text(_capture("live"))
    assert isinstance(parse_server_message(ws.receive_text()), SessionMessage)
    return opened.sessionId


@pytest.fixture
def client(wearer_db: Database) -> Iterator[TestClient]:
    with _client(wearer_db.name) as test_client:
        yield test_client


@pytest.fixture
def sessions(wearer_db: Database) -> Iterator[Collection[dict[str, Any]]]:
    # A plain client: the test client runs the app's event loop on another thread.
    mongo: MongoClient[dict[str, Any]] = MongoClient(TEST_URI, tz_aware=True)
    with mongo:
        yield mongo[wearer_db.name]["capture_sessions"]


def _token(secret: str = SECRET, **changes: Any) -> str:
    return sign_device_token(DeviceTokenClaims.model_validate(FIXTURE["claims"] | changes), secret)


def _hello(token: str) -> str:
    return json.dumps({"type": "hello", "v": 1, "token": token})


def _capture(state: str) -> str:
    return json.dumps({"type": "capture", "v": 1, "state": state})


def _frame(session_id: str, seq: int) -> bytes:
    header = FrameHeader(
        v=1,
        sessionId=session_id,
        seq=seq,
        capturedAtMs=1000.0 * seq,
        sentAtMs=1000.0 * seq + 40,
        width=64,
        height=48,
        bytes=len(JPEG),
    )
    return encode_frame(header, JPEG)


def _frame_with_jpeg(session_id: str, seq: int, jpeg: bytes) -> bytes:
    return encode_frame(
        FrameHeader(
            v=1,
            sessionId=session_id,
            seq=seq,
            capturedAtMs=1000.0 * seq,
            sentAtMs=1000.0 * seq + 40,
            width=16,
            height=16,
            bytes=len(jpeg),
        ),
        jpeg,
    )


def _valid_jpeg() -> bytes:
    output = BytesIO()
    Image.new("RGB", (16, 16), "white").save(output, format="JPEG")
    return output.getvalue()


def _refusal(ws: WebSocketTestSession) -> str:
    message = parse_server_message(ws.receive_text())
    assert isinstance(message, ErrorMessage) and message.code == "unauthorized"
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_text()
    assert closed.value.code == 4401
    return message.message


def _wait_for[T](find: Callable[[], T | None], timeout: float = 5.0) -> T:
    deadline = time.monotonic() + timeout
    while (found := find()) is None:
        assert time.monotonic() < deadline, "timed out waiting for the database"
        time.sleep(0.02)
    return found


def test_health_reports_the_database_and_the_queue(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "detector": "null",
        "db": "ok",
        "queueDepth": 0,
        "classes": {},
        "safety": {
            "detector": "mock",
            "faceDetector": "mock",
            "faceEmbedder": "mock",
            "vlm": "mock",
        },
    }


def test_health_says_when_the_database_is_unreachable(wearer_db: Database) -> None:
    with _client(wearer_db.name, uri="mongodb://127.0.0.1:1/?directConnection=true") as client:
        response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {
        "ok": False,
        "detector": "null",
        "db": "unreachable",
        "queueDepth": None,
        "classes": {},
        "safety": {
            "detector": "mock",
            "faceDetector": "mock",
            "faceEmbedder": "mock",
            "vlm": "mock",
        },
    }


def test_config_classes_requires_an_api_token(client: TestClient) -> None:
    assert client.post("/config/classes").status_code == 401
    assert (
        client.post(
            "/config/classes",
            headers={"Authorization": f"Bearer {_token(scope='frames')}"},
        ).status_code
        == 403
    )


def test_config_classes_reloads_items_and_is_tenant_scoped(
    client: TestClient, keys_item: ObjectId, wearer_db: Database
) -> None:
    api_headers = {"Authorization": f"Bearer {_token(scope='api')}"}
    first = client.post("/config/classes", headers=api_headers)
    assert first.status_code == 200
    assert first.json() == {"patientId": str(PATIENT), "classes": ["keys"], "version": 1}

    now = datetime.now(UTC)
    inserted_item: ObjectId
    mongo = MongoClient(TEST_URI, tz_aware=True)
    with mongo:
        inserted_item = (
            mongo[wearer_db.name]["items"]
            .insert_one(
                {
                    "_id": ObjectId(),
                    "patientId": PATIENT,
                    "name": "reading glasses",
                    "plural": False,
                    "aliases": ["specs"],
                    "lookupKeys": ["reading glasses", "specs"],
                    "detectorPrompts": ["glasses"],
                    "referenceImageKeys": [],
                    "active": True,
                    "observationVersion": 0,
                    "lastSighting": None,
                    "lastRestingSighting": None,
                    "usualSpots": [],
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
            .inserted_id
        )
    second = client.post("/config/classes", headers=api_headers)
    assert second.status_code == 200
    assert second.json() == {
        "patientId": str(PATIENT),
        "classes": ["keys", "glasses"],
        "version": 2,
    }
    assert client.get("/health").json()["classes"][str(PATIENT)] == 2

    other = client.post(
        "/config/classes",
        headers={"Authorization": f"Bearer {_token(pid=str(OTHER_PATIENT), scope='api')}"},
    )
    assert other.status_code == 200
    assert other.json() == {"patientId": str(OTHER_PATIENT), "classes": [], "version": 1}
    assert client.get("/health").json()["classes"][str(PATIENT)] == 2
    mongo = MongoClient(TEST_URI, tz_aware=True)
    with mongo:
        assert mongo[wearer_db.name]["items"].delete_one({"_id": inserted_item}).deleted_count == 1


def test_config_classes_accepts_requested_version_and_rejects_invalid_version(
    client: TestClient, keys_item: ObjectId
) -> None:
    headers = {"Authorization": f"Bearer {_token(scope='api')}"}
    response = client.post("/config/classes", headers=headers, json={"version": 7})
    assert response.status_code == 200
    assert response.json()["version"] == 7
    assert client.post("/config/classes", headers=headers, json={"version": "x"}).status_code == 422


@pytest.mark.parametrize(
    ("hello", "problem"),
    [
        (_hello("not.a-token"), "signature"),
        (_hello(FIXTURE["token"].replace(".", "..")), "malformed"),
        (_hello(FIXTURE["token"].split(".")[0]), "malformed"),
        # An empty token isn't a hello at all; the socket still closes with 4401.
        (_hello(""), "hello first"),
        # Signed correctly, but by someone without the shared secret.
        (_hello(_token(secret=WRONG_SECRET)), "signature"),
        # Valid until one second before the clock the app reads.
        (_hello(_token(exp=FIXTURE["validAt"] - 1)), "expired"),
        (_hello(_token(exp=FIXTURE["validAt"])), "expired"),
        (_hello(_token(scope="debug")), "needs a frames token"),
        (_hello(_token(scope="api")), "needs a frames token"),
        (_hello(_token(sub=str(REVOKED_DEVICE))), "revoked"),
        # Minted before the device's tokenVersion was bumped, which is how revoking reaches live tokens.
        (_hello(_token(tv=1)), "revoked"),
        (_hello(_token(sub="5eed00000000000000000dff")), "unknown"),
        (_hello(_token(pid="5eed000000000000000000ff", sub=None)), "Unknown wearer"),
        # Another wearer's pid with this device's sub: the device isn't in that household.
        (_hello(_token(pid=str(OTHER_PATIENT))), "unknown or was revoked"),
        (_capture("live"), "hello first"),
    ],
    ids=[
        "bad-signature",
        "malformed",
        "malformed-one-part",
        "malformed-empty",
        "wrong-secret",
        "expired",
        "expired-at-exp",
        "wrong-scope",
        "api-scope",
        "revoked-device",
        "stale-token-version",
        "unknown-device",
        "unknown-wearer",
        "other-wearers-token",
        "no-hello",
    ],
)
def test_frames_socket_refuses_without_a_good_hello(client: TestClient, hello: str, problem: str) -> None:
    with client.websocket_connect("/ws/frames") as ws:
        ws.send_text(hello)
        assert problem in _refusal(ws)


def test_frames_socket_runs_a_capture_session(
    client: TestClient, sessions: Collection[dict[str, Any]]
) -> None:
    with client.websocket_connect("/ws/frames") as ws:
        ws.send_text(_hello(FIXTURE["token"]))
        opened = parse_server_message(ws.receive_text())
        assert isinstance(opened, SessionMessage) and opened.state == "paused"
        session_id = opened.sessionId

        # Sent before the wearer resumed, so it's dropped unread.
        ws.send_bytes(_frame(session_id, 1))
        ws.send_text(_capture("live"))
        assert parse_server_message(ws.receive_text()) == SessionMessage(
            type="session", v=1, sessionId=session_id, state="live"
        )

        ws.send_bytes(_frame(session_id, 2))
        assert parse_server_message(ws.receive_text()) == DetectionsMessage(
            type="detections", v=1, seq=2, detections=[]
        )

        # A replayed seq, another session's frame, and a truncated one.
        for bad in (_frame(session_id, 2), _frame(str(ObjectId()), 3), b"\x00\x00"):
            ws.send_bytes(bad)
            rejected = parse_server_message(ws.receive_text())
            assert isinstance(rejected, ErrorMessage) and rejected.code == "bad_frame"

        ws.send_text(_capture("paused"))
        assert parse_server_message(ws.receive_text()) == SessionMessage(
            type="session", v=1, sessionId=session_id, state="paused"
        )

        ws.close()
        session = _wait_for(lambda: sessions.find_one({"_id": ObjectId(session_id), "state": "ended"}))

    assert (session["patientId"], session["deviceId"], session["source"]) == (PATIENT, DEVICE, "chest")
    assert (session["framesReceived"], session["framesDropped"], session["lastSeq"]) == (1, 1, 2)
    assert session["endedAt"] is not None


class _DarkFrameFaces:
    """Finds one face in a dark frame and none in a bright one."""

    name = "dark-frames"

    def detect(self, image, *, filename: str = "") -> list[FaceBox]:
        if image.mean() > 128:
            return []
        return [FaceBox(bbox=BBox(x=0.25, y=0.25, w=0.5, h=0.5), confidence=0.95)]


def _jpeg_of(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (16, 16), color).save(output, format="JPEG")
    return output.getvalue()


def _next_faces(ws: WebSocketTestSession) -> FacesMessage:
    # The face worker and the item worker answer in whichever order they finish.
    while True:
        message = parse_server_message(ws.receive_text())
        if isinstance(message, FacesMessage):
            return message
        assert isinstance(message, DetectionsMessage)


def test_live_frames_name_an_enrolled_face_and_say_when_it_leaves(
    wearer_db: Database, tmp_path: Path
) -> None:
    settings = Settings(
        mongodb_uri=TEST_URI,
        mongodb_db=wearer_db.name,
        device_token_secret=SECRET,
        frame_image_dir=str(tmp_path),
    )
    safety_adapters = Adapters(
        detector=MockDetector([]),
        face_detector=_DarkFrameFaces(),
        face_embedder=MockFaceEmbedder(),
        vlm=None,
    )
    api_token = sign_device_token(
        DeviceTokenClaims.model_validate({**FIXTURE["claims"], "sub": None, "scope": "api"}), SECRET
    )
    with TestClient(
        create_app(settings, safety_adapters=safety_adapters, token_clock=lambda: FIXTURE["validAt"])
    ) as app_client:
        with app_client.websocket_connect("/ws/frames") as ws:
            ws.send_text(_hello(FIXTURE["token"]))
            opened = parse_server_message(ws.receive_text())
            assert isinstance(opened, SessionMessage)
            ws.send_text(_capture("live"))
            parse_server_message(ws.receive_text())

            # A stranger first, which also fills the gallery cache with nobody in it.
            ws.send_bytes(_frame_with_jpeg(opened.sessionId, 1, _jpeg_of("black")))
            stranger = _next_faces(ws)
            assert [(face.personId, face.name) for face in stranger.faces] == [(None, None)]

            # Enrolling mid-session has to reach the very next frame, cache or not.
            enrolled = app_client.post(
                "/people",
                headers={"Authorization": f"Bearer {api_token}"},
                files={"photos": ("alex.jpg", _jpeg_of("black"), "image/jpeg")},
                data={"name": "Alex", "relation": "son", "consentedBy": "caregiver"},
            )
            assert enrolled.status_code == 201, enrolled.text

            ws.send_bytes(_frame_with_jpeg(opened.sessionId, 2, _jpeg_of("black")))
            known = _next_faces(ws)
            assert known.seq == 2
            assert [(face.personId, face.name, face.relation) for face in known.faces] == [
                (enrolled.json()["_id"], "Alex", "son")
            ]
            assert known.faces[0].matchConfidence is not None and known.faces[0].matchConfidence > 0.99

            ws.send_bytes(_frame_with_jpeg(opened.sessionId, 3, _jpeg_of("white")))
            assert _next_faces(ws) == FacesMessage(type="faces", v=1, seq=3, faces=[])


def test_live_frame_runs_safety_after_detections(wearer_db: Database, tmp_path: Path) -> None:
    settings = Settings(
        mongodb_uri=TEST_URI,
        mongodb_db=wearer_db.name,
        device_token_secret=SECRET,
        safety_sample_every_n_frames=1,
        frame_image_dir=str(tmp_path),
    )
    safety_adapters = Adapters(
        detector=MockDetector(
            [SafetyDetection(label="knife", confidence=0.9, bbox=BBox(x=0, y=0, w=1, h=1))]
        ),
        face_detector=MockFaceDetector(faces=0),
        face_embedder=MockFaceEmbedder(),
        vlm=MockVLM(),
    )
    mongo = MongoClient(TEST_URI, tz_aware=True)
    with TestClient(
        create_app(
            settings,
            safety_adapters=safety_adapters,
            token_clock=lambda: FIXTURE["validAt"],
        )
    ) as app_client:
        with app_client.websocket_connect("/ws/frames") as ws:
            ws.send_text(_hello(FIXTURE["token"]))
            opened = parse_server_message(ws.receive_text())
            assert isinstance(opened, SessionMessage)
            ws.send_text(_capture("live"))
            assert parse_server_message(ws.receive_text()) == SessionMessage(
                type="session", v=1, sessionId=opened.sessionId, state="live"
            )
            ws.send_bytes(_frame_with_jpeg(opened.sessionId, 2, _valid_jpeg()))
            parse_server_message(ws.receive_text())
            found = _wait_for(
                lambda: mongo[wearer_db.name]["frame_observations"].find_one({"patientId": PATIENT})
            )
            assert found is not None
            event = _wait_for(
                lambda: mongo[wearer_db.name]["danger_events"].find_one(
                    {"patientId": PATIENT, "status": "open"}
                )
            )
            assert event is not None
    mongo.close()


def test_debug_socket_checks_the_scope_and_closes(client: TestClient) -> None:
    with client.websocket_connect("/ws/debug") as ws:
        ws.send_text(_hello(FIXTURE["token"]))
        assert "needs a debug token" in _refusal(ws)

    with client.websocket_connect("/ws/debug") as ws:
        ws.send_text(_hello(_token(scope="debug")))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1000


@pytest.fixture(scope="module")
async def keys_item(wearer_db: Database) -> ObjectId:
    seed = Seed(wearer_db)
    await seed.item(PATIENT, "wallet", active=False)
    return await seed.item(PATIENT, "keys")


@pytest.fixture
def wearer(wearer_db: Database) -> Iterator[Database]:
    # Sightings from one test would confirm again in the next; each starts clean.
    mongo: MongoClient[dict[str, Any]] = MongoClient(TEST_URI, tz_aware=True)
    with mongo:
        yield wearer_db
        mongo[wearer_db.name]["sightings"].delete_many({})
        mongo[wearer_db.name]["items"].update_many(
            {}, {"$set": {"lastSighting": None, "lastRestingSighting": None, "observationVersion": 0}}
        )


@pytest.mark.parametrize("disconnect_during_write", [False, True])
def test_detections_reach_the_socket_reply_and_a_sighting_opens_after_three_frames(
    wearer: Database,
    keys_item: ObjectId,
    sessions: Collection[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
    disconnect_during_write: bool,
) -> None:
    write_finished = threading.Event()
    release_write = threading.Event()
    original_open = ObservationStore.open_sighting

    async def delayed_open(self: ObservationStore, **kwargs: Any) -> Any:
        opened = await original_open(self, **kwargs)
        write_finished.set()
        # Hold the return after the DB writes, before SightingWriter records the ID.
        await asyncio.to_thread(release_write.wait, 5)
        return opened

    if disconnect_during_write:
        monkeypatch.setattr(ObservationStore, "open_sighting", delayed_open)
    detector = StubDetector()
    with _client(wearer.name, detector=detector) as client, client.websocket_connect("/ws/frames") as ws:
        session_id = _live_session(ws)
        for seq in (1, 2, 3):
            ws.send_bytes(_frame(session_id, seq))
            reply = parse_server_message(ws.receive_text())
            assert isinstance(reply, DetectionsMessage) and reply.seq == seq
            assert [(d.itemId, d.label, d.bbox) for d in reply.detections] == [
                (str(keys_item), "keys", (0.4, 0.3, 0.2, 0.2))
            ]
        db = sessions.database
        sighting = _wait_for(lambda: db["sightings"].find_one({"patientId": PATIENT, "status": "open"}))
        assert (sighting["itemId"], sighting["firstSeq"], sighting["lastSeq"]) == (keys_item, 1, 3)
        assert (sighting["sessionId"], sighting["source"]) == (ObjectId(session_id), "chest")
        assert sighting["eventId"] == f"{session_id}:1"
        # The snapshot is a second write, after the sighting itself.
        item = _wait_for(
            lambda: db["items"].find_one({"_id": keys_item, "lastSighting.sightingId": sighting["_id"]})
        )
        assert item is not None
        if disconnect_during_write:
            assert write_finished.wait(5)
        # The description worker in the same process may already be draining this job, so its
        # status isn't asserted here — only that a keyframe was queued and actually saved.
        job = _wait_for(
            lambda: db["description_jobs"].find_one({"patientId": PATIENT, "sightingId": sighting["_id"]})
        )
        assert job["bbox"] == [0.4, 0.3, 0.2, 0.2]
        assert Path(client.app.state.services.frame_store.directory / job["keyframeKey"]).is_file()
        ws.close()
        release_write.set()
        _wait_for(lambda: db["sightings"].find_one({"_id": sighting["_id"], "status": "closed"}))

    # Only the active item's prompts reached the detector.
    assert [[p.text for p in prompts] for _, prompts in detector.seen] == [["keys"]] * 3


def test_one_or_two_frames_write_nothing(wearer: Database, keys_item: ObjectId) -> None:
    detector = StubDetector()
    with _client(wearer.name, detector=detector) as client, client.websocket_connect("/ws/frames") as ws:
        session_id = _live_session(ws)
        for seq in (1, 2):
            ws.send_bytes(_frame(session_id, seq))
            assert isinstance(parse_server_message(ws.receive_text()), DetectionsMessage)
        ws.close()
    mongo: MongoClient[dict[str, Any]] = MongoClient(TEST_URI, tz_aware=True)
    with mongo:
        assert mongo[wearer.name]["sightings"].count_documents({"patientId": PATIENT}) == 0


def test_slow_inference_drops_frames_instead_of_queueing_them(
    wearer: Database, keys_item: ObjectId, sessions: Collection[dict[str, Any]]
) -> None:
    detector = StubDetector()
    detector.release.clear()
    with _client(wearer.name, detector=detector) as client, client.websocket_connect("/ws/frames") as ws:
        session_id = _live_session(ws)
        # The worker is stuck on frame 1. Frames 2 to 5 arrive meanwhile; only the newest may wait.
        for seq in (1, 2, 3, 4, 5):
            ws.send_bytes(_frame(session_id, seq))
        _wait_for(lambda: sessions.find_one({"_id": ObjectId(session_id), "framesDropped": 3}))
        detector.release.set()
        replies = [parse_server_message(ws.receive_text()) for _ in range(2)]
        assert [r.seq for r in replies if isinstance(r, DetectionsMessage)] == [1, 5]
        ws.close()
        session = _wait_for(lambda: sessions.find_one({"_id": ObjectId(session_id), "state": "ended"}))
    assert [seq for seq, _ in detector.seen] == [1, 5]
    assert (session["framesReceived"], session["framesDropped"], session["lastSeq"]) == (2, 3, 5)
