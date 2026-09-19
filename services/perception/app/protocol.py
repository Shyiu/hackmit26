"""The /ws/frames protocol, mirroring packages/shared/src/schemas/perception.ts and detection.ts.

The fixtures in packages/shared/fixtures/perception/ must parse the same way
here as in zod; tests/test_contract.py runs them through this module.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, TypeAdapter

PROTOCOL_VERSION = 1


def _json_number(value: object) -> object:
    # zod's z.number() takes JSON numbers and nothing else. Pydantic's lax mode
    # would also read "5" and true as numbers, which the TypeScript side rejects.
    if isinstance(value, bool) or not isinstance(value, int | float):
        # ValueError, not TypeError: pydantic turns only ValueError into a validation error.
        raise ValueError("expected a number")
    return value


Number = Annotated[float, BeforeValidator(_json_number)]
# 5.0 passes and 1.5 fails, like z.number().int() on a parsed JSON number.
Int = Annotated[int, BeforeValidator(_json_number)]
Version = Annotated[Literal[1], BeforeValidator(_json_number)]
ObjectIdHex = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{24}$")]
CaptureState = Literal["paused", "live", "ended"]
ErrorCode = Literal["unauthorized", "bad_message", "bad_frame", "rate_limited", "server_error"]


class _Strict(BaseModel):
    # zod's .strict(): an unknown field is an error, not something to drop.
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)


class HelloMessage(_Strict):
    type: Literal["hello"]
    v: Version
    token: Annotated[str, StringConstraints(min_length=1, max_length=2048)]


class CaptureCommand(_Strict):
    type: Literal["capture"]
    v: Version
    state: Literal["live", "paused"]


ClientMessage = Annotated[HelloMessage | CaptureCommand, Field(discriminator="type")]

MAX_FRAME_BYTES = 2_000_000


class FrameHeader(_Strict):
    v: Version
    sessionId: ObjectIdHex
    seq: Annotated[Int, Field(ge=0)]
    # performance.now() on the page when the frame was grabbed and when it was
    # sent. Only the difference is used, so a wrong phone clock can't skew
    # capture times.
    capturedAtMs: Annotated[Number, Field(ge=0)]
    sentAtMs: Annotated[Number, Field(ge=0)]
    width: Annotated[Int, Field(gt=0, le=4096)]
    height: Annotated[Int, Field(gt=0, le=4096)]
    bytes: Annotated[Int, Field(gt=0, le=MAX_FRAME_BYTES)]


class SessionMessage(_Strict):
    type: Literal["session"]
    v: Version
    sessionId: ObjectIdHex
    state: CaptureState


class Detection(BaseModel):
    # Not .strict() in zod either, so unknown keys are dropped rather than rejected.
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False, frozen=True)

    itemId: str
    label: str
    # [x, y, w, h] normalized to the frame, the convention the HUD draws with.
    bbox: tuple[Number, Number, Number, Number]
    confidence: Annotated[Number, Field(ge=0, le=1)]


class DetectionsMessage(_Strict):
    type: Literal["detections"]
    v: Version
    seq: Annotated[Int, Field(ge=0)]
    detections: list[Detection]


class ErrorMessage(_Strict):
    type: Literal["error"]
    v: Version
    code: ErrorCode
    message: Annotated[str, StringConstraints(max_length=500)]


ServerMessage = Annotated[SessionMessage | DetectionsMessage | ErrorMessage, Field(discriminator="type")]

_client_messages: TypeAdapter[HelloMessage | CaptureCommand] = TypeAdapter(ClientMessage)
_server_messages: TypeAdapter[SessionMessage | DetectionsMessage | ErrorMessage] = TypeAdapter(ServerMessage)


def _reject_constant(name: str) -> float:
    raise ValueError(f"{name} is not valid JSON")


def _loads(data: str | bytes) -> object:
    # Python's json module accepts NaN and Infinity. JSON.parse doesn't, so neither do we.
    return json.loads(data, parse_constant=_reject_constant)


def parse_client_message(data: str | bytes) -> HelloMessage | CaptureCommand:
    """Raises ValueError, which covers bad JSON and pydantic's ValidationError."""
    return _client_messages.validate_python(_loads(data))


def parse_server_message(data: str | bytes) -> SessionMessage | DetectionsMessage | ErrorMessage:
    return _server_messages.validate_python(_loads(data))


def parse_frame_header(data: str | bytes) -> FrameHeader:
    return FrameHeader.model_validate(_loads(data))


def session_message(session_id: str, state: CaptureState) -> SessionMessage:
    return SessionMessage(type="session", v=1, sessionId=session_id, state=state)


def detections_message(seq: int, detections: list[Detection]) -> DetectionsMessage:
    return DetectionsMessage(type="detections", v=1, seq=seq, detections=detections)


def error_message(code: ErrorCode, message: str) -> ErrorMessage:
    return ErrorMessage(type="error", v=1, code=code, message=message[:500])


# The binary envelope: a 4-byte big-endian header length, the FrameHeader as
# UTF-8 JSON, then exactly header.bytes of JPEG.
_HEADER_LENGTH = struct.Struct(">I")
MAX_HEADER_BYTES = 1024
MAX_MESSAGE_BYTES = _HEADER_LENGTH.size + MAX_HEADER_BYTES + MAX_FRAME_BYTES
_JPEG_START = b"\xff\xd8\xff"


class FrameError(ValueError):
    """A binary message that isn't a well-formed frame. The socket answers bad_frame."""


@dataclass(frozen=True, slots=True)
class Frame:
    header: FrameHeader
    jpeg: bytes


def parse_frame(data: bytes) -> Frame:
    if len(data) > MAX_MESSAGE_BYTES:
        raise FrameError(f"Frame is {len(data)} bytes, over the {MAX_MESSAGE_BYTES} byte limit")
    if len(data) < _HEADER_LENGTH.size:
        raise FrameError("Frame is shorter than its length prefix")
    (header_length,) = _HEADER_LENGTH.unpack_from(data)
    if not 0 < header_length <= MAX_HEADER_BYTES:
        raise FrameError(f"Header length {header_length} is outside 1 to {MAX_HEADER_BYTES}")
    body_start = _HEADER_LENGTH.size + header_length
    if len(data) < body_start:
        raise FrameError("Frame is truncated inside its header")
    try:
        header = parse_frame_header(data[_HEADER_LENGTH.size : body_start].decode("utf-8"))
    except ValueError as error:
        raise FrameError(f"Bad frame header: {error}") from error
    jpeg = data[body_start:]
    if len(jpeg) != header.bytes:
        raise FrameError(f"Header says {header.bytes} JPEG bytes, frame carries {len(jpeg)}")
    if not jpeg.startswith(_JPEG_START):
        raise FrameError("Frame payload is not a JPEG")
    return Frame(header=header, jpeg=jpeg)


def encode_frame(header: FrameHeader, jpeg: bytes) -> bytes:
    raw = header.model_dump_json().encode("utf-8")
    return _HEADER_LENGTH.pack(len(raw)) + raw + jpeg


def capture_time(received_at: datetime, header: FrameHeader) -> datetime:
    """Server-normalized capture time: receipt time minus the frame's age on the page.

    A negative age means a confused client. It's clamped to zero, because a
    frame can't have been captured after it arrived.
    """
    age_ms = max(0.0, header.sentAtMs - header.capturedAtMs)
    return received_at - timedelta(milliseconds=age_ms)
