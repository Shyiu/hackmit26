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
from fastapi import APIRouter, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError
from starlette.requests import HTTPConnection

from .config import Settings
from .detector import Detector, Prompt, Prompts, build_detector
from .protocol import (
    CaptureCommand,
    Face,
    Frame,
    FrameError,
    HelloMessage,
    capture_time,
    detections_message,
    error_message,
    faces_message,
    parse_client_message,
    parse_frame,
    session_message,
)
from .safety.adapters.registry import Adapters, build_adapters
from .safety.images import LocalFrameStore
from .safety.models import FaceObservation
from .safety.routes import router as safety_router
from .safety.service import SafetyService
from .safety.store import SafetyStore
from .store import CaptureSource, ItemPrompts, ObservationStore, UnknownPatientError
from .tokens import DeviceTokenClaims, InvalidTokenError, Scope, verify_device_token
from .tracker import SightingTracker, SightingWriter, TrackerConfig

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
    safety: SafetyService | None = None


def _services(connection: HTTPConnection) -> Services:
    services: Services = connection.app.state.services
    return services


def create_app(
    settings: Settings | None = None,
    *,
    detector: Detector | None = None,
    safety_adapters: Adapters | None = None,
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
        db = client[resolved.mongodb_db]
        store = ObservationStore(db)
        safety = None
        if resolved.safety_enabled:
            safety = SafetyService(
                resolved,
                SafetyStore(db, store, resolved),
                safety_adapters or build_adapters(resolved),
                LocalFrameStore(resolved.frame_image_dir),
            )
            log.info(
                "safety adapters configured",
                extra={
                    "safety_detector": safety.adapters.detector.name,
                    "safety_face_detector": safety.adapters.face_detector.name,
                    "safety_face_embedder": safety.adapters.face_embedder.name,
                    "safety_vlm": safety.adapters.vlm.name if safety.adapters.vlm else None,
                },
            )
        app.state.services = Services(
            resolved, store, detector or build_detector(resolved), token_clock, safety
        )
        try:
            yield
        finally:
            await client.close()

    app = FastAPI(title="memory glasses perception", lifespan=lifespan)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict) and "code" in exc.detail:
            return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    app.include_router(router)
    app.include_router(safety_router)
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
    safety = services.safety
    safety_names = (
        {
            "detector": safety.adapters.detector.name,
            "faceDetector": safety.adapters.face_detector.name,
            "faceEmbedder": safety.adapters.face_embedder.name,
            "vlm": safety.adapters.vlm.name if safety.adapters.vlm else None,
        }
        if safety
        else None
    )
    body = {
        "ok": ok,
        "detector": services.detector.name,
        "db": db,
        "queueDepth": queue_depth,
        "safety": safety_names,
    }
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
        prompts = await services.store.active_items(patient_id)
    except UnknownPatientError:
        await _refuse(ws, "Unknown wearer")
        return
    except PyMongoError:
        log.exception("Couldn't open a capture session")
        await ws.send_text(error_message("server_error", "Storage is unavailable").model_dump_json())
        await ws.close(code=1011)
        return
    connection = FrameConnection(ws, services, patient_id, device_id, session_id)
    connection.writer = SightingWriter(
        services.store, patient_id=patient_id, session_id=session_id, device_id=device_id, source=source
    )
    connection.set_prompts(prompts)
    await connection.run()


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
    The safety pass has a worker and a newest-frame slot of its own, so a face
    is named without waiting for the item detector, and the other way round.
    """

    def __init__(
        self,
        ws: WebSocket,
        services: Services,
        patient_id: ObjectId,
        device_id: ObjectId | None,
        session_id: ObjectId,
    ) -> None:
        self.ws = ws
        self.store = services.store
        self.detector = services.detector
        self.settings = services.settings
        self.services_safety = services.safety
        self.patient_id = patient_id
        self.device_id = device_id
        self.session_id = session_id
        self.live = False
        self.last_seq = -1
        self.live_frames = 0
        self.pending: _Pending | None = None
        self.wake = asyncio.Event()
        self.safety_pending: _Pending | None = None
        self.safety_wake = asyncio.Event()
        self.safety_persisted_seq: int | None = None
        self.faces_in_view = False
        self.send_lock = asyncio.Lock()
        self.prompts: Prompts = ()
        self.prompts_loaded_at = time.monotonic()
        self.tracker = SightingTracker(TrackerConfig.from_settings(services.settings))
        # None until the socket has a device and source to write sightings for.
        self.writer: SightingWriter | None = None

    def set_prompts(self, items: list[ItemPrompts]) -> None:
        self.prompts = tuple(
            Prompt(str(item.item_id), item.name, text) for item in items for text in item.prompts
        )
        self.prompts_loaded_at = time.monotonic()

    async def run(self) -> None:
        worker = asyncio.create_task(self._work())
        safety_worker = asyncio.create_task(self._safety_work()) if self.services_safety else None
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
            if safety_worker is not None:
                # Not waited for. It writes nothing the cleanup below depends on, and a storage
                # call it's in the middle of can take a while to give up.
                safety_worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
            try:
                if self.writer is not None:
                    await self.writer.apply(self.tracker.close_all())
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
            self.safety_pending = None
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
        self.live_frames += 1
        if self.services_safety is not None:
            # Every live frame is offered, stride or not. The worker takes whichever is newest.
            self.safety_pending = _Pending(frame, received_at, capture_time(received_at, header))
            self.safety_wake.set()
        if (self.live_frames - 1) % self.settings.frame_stride:
            # Between strides. Skipped on purpose, but still a frame the session saw.
            await self.store.record_frame(
                self.patient_id, self.session_id, header.seq, received_at, dropped=True
            )
            return
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
                await self._refresh_prompts()
                detections = await asyncio.to_thread(
                    self.detector.detect, pending.frame.jpeg, header, self.prompts
                )
                await self._send(detections_message(header.seq, detections or []))
                await self.store.record_frame(
                    self.patient_id, self.session_id, header.seq, pending.received_at, dropped=False
                )
                if detections is not None and self.writer is not None:
                    # A blurry frame is no evidence either way, so it doesn't reach the tracker.
                    events = self.tracker.observe(
                        detections, pending.observed_at, header.seq, (header.width, header.height)
                    )
                    # A write can reach MongoDB before apply() records its sighting ID.
                    # Finish that bookkeeping before disconnect cleanup closes the tracks.
                    write = asyncio.create_task(self.writer.apply(events))
                    try:
                        await asyncio.shield(write)
                    except asyncio.CancelledError:
                        await write
                        raise
            except WebSocketDisconnect:
                return
            except Exception:
                log.exception("Frame %s of capture session %s failed", header.seq, self.session_id)

    async def _safety_work(self) -> None:
        safety = self.services_safety
        assert safety is not None
        every = safety.settings.safety_sample_every_n_frames
        while True:
            await self.safety_wake.wait()
            self.safety_wake.clear()
            pending, self.safety_pending = self.safety_pending, None
            if pending is None:
                continue
            header = pending.frame.header
            jpeg = pending.frame.jpeg

            async def report(faces: list[FaceObservation], seq: int = header.seq) -> None:
                await self._send_faces(seq, faces)

            try:
                analysis = await safety.analyze(self.patient_id, jpeg, on_faces=report)
                # Faces are already on their way to the page. Storage is sampled, except that a
                # frame behind a danger event, or one that failed, is always kept.
                last = self.safety_persisted_seq
                due = last is None or header.seq - last >= every
                if not analysis.width:
                    # It never decoded, so there is no image to keep and nothing to say about it.
                    continue
                if due or analysis.candidates or analysis.processing_status != "complete":
                    self.safety_persisted_seq = header.seq
                    await safety.persist(
                        self.patient_id,
                        self.device_id,
                        self.session_id,
                        jpeg,
                        pending.observed_at,
                        analysis,
                    )
            except (WebSocketDisconnect, RuntimeError):
                return
            except Exception:
                log.exception("Safety processing failed for frame %s", header.seq)

    async def _send_faces(self, seq: int, faces: list[FaceObservation]) -> None:
        # Silent while nobody is in view, apart from the one empty list that says they left.
        if not faces and not self.faces_in_view:
            return
        self.faces_in_view = bool(faces)
        await self._send(
            faces_message(
                seq,
                [
                    Face(
                        personId=str(face.person_id) if face.person_id else None,
                        name=face.name,
                        relation=face.relation,
                        bbox=(face.bbox.x, face.bbox.y, face.bbox.w, face.bbox.h),
                        confidence=face.confidence,
                        matchConfidence=face.match_confidence,
                    )
                    for face in faces
                ],
            )
        )

    async def _refresh_prompts(self) -> None:
        # A caregiver edit to the item list reaches the detector within this long.
        if time.monotonic() - self.prompts_loaded_at >= self.settings.prompt_refresh_seconds:
            self.set_prompts(await self.store.active_items(self.patient_id))

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
