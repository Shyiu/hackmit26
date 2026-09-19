"""The shared /ws/frames fixtures parse here exactly as they do in zod.

packages/shared/test/contract.test.ts runs the same files through the TypeScript schemas.
"""

from __future__ import annotations

import json
import struct
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from app.protocol import (
    MAX_FRAME_BYTES,
    MAX_HEADER_BYTES,
    FrameError,
    FrameHeader,
    capture_time,
    encode_frame,
    parse_client_message,
    parse_frame,
    parse_frame_header,
    parse_server_message,
)

FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "fixtures" / "perception"

PARSERS: dict[str, Callable[[str], BaseModel]] = {
    "clientMessages": parse_client_message,
    "frameHeaders": parse_frame_header,
    "serverMessages": parse_server_message,
}


def _cases(kind: str) -> list[Any]:
    groups: dict[str, list[Any]] = json.loads((FIXTURES / f"{kind}.json").read_text())
    # A new fixture group needs a parser here, or it would pass by never running.
    assert set(groups) == set(PARSERS), f"unexpected fixture groups in {kind}.json: {set(groups)}"
    return [
        pytest.param(group, example, id=f"{group}-{i}")
        for group, examples in groups.items()
        for i, example in enumerate(examples)
    ]


@pytest.mark.parametrize(("group", "example"), _cases("valid"))
def test_valid_fixture_parses_unchanged(group: str, example: dict[str, Any]) -> None:
    parsed = PARSERS[group](json.dumps(example))
    assert parsed.model_dump(mode="json") == example


@pytest.mark.parametrize(("group", "example"), _cases("invalid"))
def test_invalid_fixture_is_rejected(group: str, example: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        PARSERS[group](json.dumps(example))


# Inputs zod rejects that pydantic's lax mode would otherwise accept.
@pytest.mark.parametrize(
    "text",
    [
        '{"type": "capture", "v": true, "state": "live"}',
        '{"type": "capture", "v": "1", "state": "live"}',
        '{"type": "capture", "v": 1}',
        '{"v": 1, "state": "live"}',
        "not json",
    ],
)
def test_lax_coercions_are_rejected(text: str) -> None:
    with pytest.raises(ValueError):
        parse_client_message(text)


def _header(**changes: Any) -> dict[str, Any]:
    header = {
        "v": 1,
        "sessionId": "5eed00000000000000000c01",
        "seq": 7,
        "capturedAtMs": 1000.5,
        "sentAtMs": 1040.5,
        "width": 1280,
        "height": 720,
        "bytes": 10,
    }
    return header | changes


@pytest.mark.parametrize(
    "changes",
    [{"seq": "7"}, {"seq": True}, {"capturedAtMs": "1000"}, {"width": 4097}, {"bytes": MAX_FRAME_BYTES + 1}],
)
def test_header_rejects_what_zod_rejects(changes: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        parse_frame_header(json.dumps(_header(**changes)))


def test_header_rejects_nan() -> None:
    with pytest.raises(ValueError):
        parse_frame_header(json.dumps(_header()).replace("1000.5", "NaN"))


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 6


def _envelope(header: dict[str, Any], jpeg: bytes) -> bytes:
    raw = json.dumps(header).encode()
    return struct.pack(">I", len(raw)) + raw + jpeg


def test_binary_envelope_round_trips() -> None:
    header = FrameHeader.model_validate(_header())
    frame = parse_frame(encode_frame(header, JPEG))
    assert frame.header == header
    assert frame.jpeg == JPEG
    # A client that writes the header by hand, with spaces, parses the same.
    assert parse_frame(_envelope(_header(), JPEG)).header == header


@pytest.mark.parametrize(
    ("data", "problem"),
    [
        (b"\x00\x00", "shorter than its length prefix"),
        (struct.pack(">I", 0) + JPEG, "outside"),
        (struct.pack(">I", MAX_HEADER_BYTES + 1) + b"{}" + JPEG, "outside"),
        (struct.pack(">I", 500) + b'{"v": 1}', "truncated inside its header"),
        (_envelope(_header(), JPEG)[:-1], "carries 9"),
        (_envelope(_header(), JPEG + b"\x00"), "carries 11"),
        (_envelope(_header(), b"\x89PNG\r\n\x1a\n\x00\x00"), "not a JPEG"),
        (_envelope(_header(seq=-1), JPEG), "Bad frame header"),
        (struct.pack(">I", 2) + b"\xff\xfe" + JPEG, "Bad frame header"),
        (b"\x00" * (4 + MAX_HEADER_BYTES + MAX_FRAME_BYTES + 1), "over the"),
    ],
    ids=[
        "no-prefix",
        "empty-header",
        "huge-header",
        "cut-header",
        "short-jpeg",
        "long-jpeg",
        "png",
        "bad-seq",
        "bad-utf8",
        "oversized",
    ],
)
def test_malformed_frames_are_rejected(data: bytes, problem: str) -> None:
    with pytest.raises(FrameError, match=problem):
        parse_frame(data)


def test_capture_time_subtracts_the_frames_age_on_the_page() -> None:
    received = datetime(2026, 9, 19, 12, 0, 0, tzinfo=UTC)
    header = FrameHeader.model_validate(_header(capturedAtMs=1000.0, sentAtMs=1250.0))
    assert capture_time(received, header) == received - timedelta(milliseconds=250)


def test_capture_time_clamps_a_negative_age_to_zero() -> None:
    received = datetime(2026, 9, 19, 12, 0, 0, tzinfo=UTC)
    header = FrameHeader.model_validate(_header(capturedAtMs=2000.0, sentAtMs=1000.0))
    assert capture_time(received, header) == received
