"""The perception service: the /ws/frames socket, health, and the stubs M1 fills in.

Run it with `uv run uvicorn app.main:app --port 8000`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError
from starlette.requests import HTTPConnection

from .config import Settings
from .detector import Detector, NullDetector
from .protocol import (
    CaptureCommand,
    Frame,
    FrameError,
    HelloMessage,
    capture_time,
    detections_message,
    error_message,
    parse_client_message,
    parse_frame,
    session_message,
)
from .store import CaptureSource, ObservationStore, UnknownPatientError
from .tokens import DeviceTokenClaims, InvalidTokenError, Scope, verify_device_token

log = logging.getLogger("perception")

# Close codes 4000 to 4999 belong to the application. 4401 reads as HTTP 401.
UNAUTHORIZED = 4401
HELLO_TIMEOUT_SECONDS = 10.0
HEALTH_TIMEOUT_SECONDS = 2.0

_TOKEN_PROBLEMS = {
    "malformed": "Token is malformed",
    "bad_signature": "Token signature doesn't match",
    "expired": "Token expired",
}


@dataclass(frozen=True, slots=True)
class Services:
    settings: Settings
    store: ObservationStore
    detector: Detector
    token_clock: Callable[[], float]


def _services(connection: HTTPConnection) -> Services:
    services: Services = connection.app.state.services
    return services


def create_app(
    settings: Settings | None = None,
    *,
    detector: Detector | None = None,
    token_clock: Callable[[], float] = time.time,
) -> FastAPI:
    """Settings default to the environment. Tests pass their own, and a clock for token expiry."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        resolved = settings or Settings()  # type: ignore[call-arg]  # values come from the environment
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(
            resolved.mongodb_uri,
            tz_aware=True,
            appname="memory-glasses-perception",
            serverSelectionTimeoutMS=5_000,
        )
        store = ObservationStore(client[resolved.mongodb_db])
        app.state.services = Services(resolved, store, detector or NullDetector(), token_clock)
        try:
            yield
        finally:
            await client.close()

    app = FastAPI(title="memory glasses perception", lifespan=lifespan)
    app.include_router(router)
    return app


router = APIRouter()


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    services = _services(request)
    db: Literal["ok", "unreachable"] = "ok"
    queue_depth: int | None = None
    try:
        async with asyncio.timeout(HEALTH_TIMEOUT_SECONDS):
            await services.store.ping()
            queue_depth = await services.store.queue_depth()
    except (PyMongoError, TimeoutError):
        db = "unreachable"
    ok = db == "ok"
    body = {"ok": ok, "detector": services.detector.name, "db": db, "queueDepth": queue_depth}
    # 503 lets a tunnel or load balancer health check see that the database is gone.
    return JSONResponse(body, status_code=200 if ok else 503)


@router.post("/config/classes")
async def reload_classes() -> JSONResponse:
    # M1: reload the detector's prompt list after a caregiver edits items. It
    # needs a credential from the web app before it can do anything.
    return JSONResponse({"error": "not implemented"}, status_code=501)


@router.websocket("/ws/debug")
async def debug_socket(ws: WebSocket) -> None:
    await ws.accept()
    if await _hello(ws, "debug") is None:
        return
    # Not built yet. The dashboard live view will get detections and annotated
    # frames here: opt-in, transient, and silent while capture is paused.
    await ws.close(code=1000)


@router.websocket("/ws/frames")
async def frames_socket(ws: WebSocket) -> None:
    await ws.accept()
    claims = await _hello(ws, "frames")
    if claims is None:
        return
    services = _services(ws)
    patient_id = ObjectId(claims.pid)
    device_id = ObjectId(claims.sub) if claims.sub else None
    try:
        # A signed-in page without a registered device. The token doesn't say
        # which page it is, so it counts as the simulator.
        source: CaptureSource | None = "simulator"
        if device_id is not None:
            source = await services.store.device_source(patient_id, device_id, claims.tv)
        if source is None:
            await _refuse(ws, "Device is unknown or was revoked")
            return
        session_id = await services.store.open_capture_session(patient_id, device_id, source)
    except UnknownPatientError:
        await _refuse(ws, "Unknown wearer")
        return
    except PyMongoError:
        log.exception("Couldn't open a capture session")
        await ws.send_text(error_message("server_error", "Storage is unavailable").model_dump_json())
        await ws.close(code=1011)
        return
    await FrameConnection(ws, services, patient_id, session_id).run()


async def _hello(ws: WebSocket, scope: Scope) -> DeviceTokenClaims | None:
    """Reads the token from the first message. A browser can't set headers on a WebSocket."""
    try:
        async with asyncio.timeout(HELLO_TIMEOUT_SECONDS):
            message = await ws.receive()
    except TimeoutError:
        await _refuse(ws, "Send hello first")
        return None
    if message["type"] == "websocket.disconnect":
        return None
    try:
        hello = parse_client_message(message.get("text") or message.get("bytes") or "")
    except ValueError:
        hello = None
    if not isinstance(hello, HelloMessage):
        await _refuse(ws, "Send hello first")
        return None
    services = _services(ws)
    try:
        claims = verify_device_token(
            hello.token, services.settings.device_token_secret, services.token_clock()
        )
    except InvalidTokenError as error:
        await _refuse(ws, _TOKEN_PROBLEMS[error.reason])
        return None
    if claims.scope != scope:
        await _refuse(ws, f"This socket needs a {scope} token")
        return None
    return claims


async def _refuse(ws: WebSocket, message: str) -> None:
    await ws.send_text(error_message("unauthorized", message).model_dump_json())
    await ws.close(code=UNAUTHORIZED)


@dataclass(frozen=True, slots=True)
class _Pending:
    frame: Frame
    received_at: datetime
    observed_at: datetime


class FrameConnection:
    """One capture page on /ws/frames.

    The receive loop never waits for the detector. A worker task runs it on the
    newest frame, and a frame that arrives while another is waiting replaces
    it, so a slow detector drops frames instead of answering with stale ones.
    """

    def __init__(self, ws: WebSocket, services: Services, patient_id: ObjectId, session_id: ObjectId) -> None:
        self.ws = ws
        self.store = services.store
        self.detector = services.detector
        self.patient_id = patient_id
        self.session_id = session_id
        self.live = False
        self.last_seq = -1
        self.pending: _Pending | None = None
        self.wake = asyncio.Event()
        self.send_lock = asyncio.Lock()

    async def run(self) -> None:
        worker = asyncio.create_task(self._work())
        try:
            await self._send(session_message(str(self.session_id), "paused"))
            while True:
                message = await self.ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    await self._on_frame(message["bytes"])
                elif message.get("text") is not None:
                    await self._on_text(message["text"])
        except WebSocketDisconnect:
            pass
        except PyMongoError:
            log.exception("Storage failed during capture session %s", self.session_id)
            with contextlib.suppress(WebSocketDisconnect, RuntimeError):
                await self._send(error_message("server_error", "Storage is unavailable"))
                await self.ws.close(code=1011)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
            try:
                # Ending cancels the wearer's queued description work, the same as a pause.
                await self.store.set_capture_state(self.patient_id, self.session_id, "ended")
            except PyMongoError:
                log.exception("Couldn't mark capture session %s ended", self.session_id)

    async def _on_text(self, text: str) -> None:
        try:
            command = parse_client_message(text)
        except ValueError as error:
            await self._send(error_message("bad_message", str(error)))
            return
        if not isinstance(command, CaptureCommand):
            await self._send(error_message("bad_message", "Already said hello"))
            return
        self.live = command.state == "live"
        if not self.live:
            await self._drop_pending()
        await self.store.set_capture_state(self.patient_id, self.session_id, command.state)
        await self._send(session_message(str(self.session_id), command.state))

    async def _on_frame(self, data: bytes) -> None:
        received_at = datetime.now(UTC)
        if not self.live:
            # Frames already in flight when the wearer paused. Nothing looks at them.
            await self.store.record_frame(
                self.patient_id, self.session_id, max(self.last_seq, 0), received_at, dropped=True
            )
            return
        try:
            frame = parse_frame(data)
        except FrameError as error:
            await self._send(error_message("bad_frame", str(error)))
            return
        header = frame.header
        if header.sessionId != str(self.session_id):
            await self._send(error_message("bad_frame", "Frame belongs to another session"))
            return
        if header.seq <= self.last_seq:
            # A duplicate or a reordered frame. A reconnect gets a new session
            # instead of replaying old buffers.
            await self._send(error_message("bad_frame", f"seq {header.seq} is not after {self.last_seq}"))
            return
        self.last_seq = header.seq
        replaced = self.pending
        self.pending = _Pending(frame, received_at, capture_time(received_at, header))
        self.wake.set()
        if replaced is not None:
            await self._record_drop(replaced)

    async def _work(self) -> None:
        while True:
            await self.wake.wait()
            self.wake.clear()
            pending, self.pending = self.pending, None
            if pending is None:
                continue
            header = pending.frame.header
            try:
                detections = await asyncio.to_thread(self.detector.detect, pending.frame.jpeg, header)
                # M1: the tracker takes these with pending.observed_at and header.seq,
                # and opens or refreshes sightings through the store.
                await self._send(detections_message(header.seq, detections))
                await self.store.record_frame(
                    self.patient_id, self.session_id, header.seq, pending.received_at, dropped=False
                )
            except WebSocketDisconnect:
                return
            except Exception:
                log.exception("Frame %s of capture session %s failed", header.seq, self.session_id)

    async def _drop_pending(self) -> None:
        dropped, self.pending = self.pending, None
        if dropped is not None:
            await self._record_drop(dropped)

    async def _record_drop(self, dropped: _Pending) -> None:
        await self.store.record_frame(
            self.patient_id, self.session_id, dropped.frame.header.seq, dropped.received_at, dropped=True
        )

    async def _send(self, message: BaseModel) -> None:
        # The receive loop and the worker both reply, so sends take turns.
        async with self.send_lock:
            await self.ws.send_text(message.model_dump_json())


app = create_app()
