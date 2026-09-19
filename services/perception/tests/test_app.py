"""The FastAPI app through its test client, against the same real MongoDB as the store tests."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from bson import ObjectId
from conftest import TEST_URI, Database, Seed
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.collection import Collection
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.main import create_app
from app.protocol import (
    DetectionsMessage,
    ErrorMessage,
    FrameHeader,
    SessionMessage,
    encode_frame,
    parse_server_message,
)
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
    # The wearer and headset the fixture token names.
    seed = Seed(db)
    await seed.patient(PATIENT)
    await seed.device(PATIENT, DEVICE)
    await seed.device(PATIENT, REVOKED_DEVICE, revoked=True)
    # A second household, so a token can name a real wearer that isn't the device's.
    await seed.patient(OTHER_PATIENT)
    return db


def _client(db_name: str, uri: str = TEST_URI) -> TestClient:
    settings = Settings(mongodb_uri=uri, mongodb_db=db_name, device_token_secret=SECRET)
    # The fixture token was minted for a fixed moment, so the app reads that as now.
    return TestClient(create_app(settings, token_clock=lambda: FIXTURE["validAt"]))


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
    assert response.json() == {"ok": True, "detector": "null", "db": "ok", "queueDepth": 0}


def test_health_says_when_the_database_is_unreachable(wearer_db: Database) -> None:
    with _client(wearer_db.name, uri="mongodb://127.0.0.1:1/?directConnection=true") as client:
        response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"ok": False, "detector": "null", "db": "unreachable", "queueDepth": None}


def test_config_classes_is_not_built_yet(client: TestClient) -> None:
    assert client.post("/config/classes").status_code == 501


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

    assert (session["patientId"], session["deviceId"], session["source"]) == (PATIENT, DEVICE, "headset")
    assert (session["framesReceived"], session["framesDropped"], session["lastSeq"]) == (1, 1, 2)
    assert session["endedAt"] is not None


def test_debug_socket_checks_the_scope_and_closes(client: TestClient) -> None:
    with client.websocket_connect("/ws/debug") as ws:
        ws.send_text(_hello(FIXTURE["token"]))
        assert "needs a debug token" in _refusal(ws)

    with client.websocket_connect("/ws/debug") as ws:
        ws.send_text(_hello(_token(scope="debug")))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1000
