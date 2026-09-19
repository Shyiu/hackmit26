"""Device tokens verify here exactly as in packages/shared/src/device-token.ts."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from pathlib import Path
from typing import Any

import pytest

from app.tokens import DeviceTokenClaims, InvalidTokenError, sign_device_token, verify_device_token

FIXTURE: dict[str, Any] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "packages" / "shared" / "fixtures" / "device-token.json"
    ).read_text()
)
TOKEN: str = FIXTURE["token"]
SECRET: str = FIXTURE["secret"]


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _signed(payload_json: str, secret: str = SECRET) -> str:
    payload = _b64(payload_json.encode())
    return f"{payload}.{_b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())}"


def _reason(token: str, secret: str = SECRET, now: float = FIXTURE["validAt"]) -> str:
    with pytest.raises(InvalidTokenError) as caught:
        verify_device_token(token, secret, now)
    return caught.value.reason


def test_fixture_token_verifies_to_the_fixture_claims() -> None:
    claims = verify_device_token(TOKEN, SECRET, FIXTURE["validAt"])
    assert claims.model_dump() == FIXTURE["claims"]


def test_signing_reproduces_the_fixture_byte_for_byte() -> None:
    assert sign_device_token(DeviceTokenClaims.model_validate(FIXTURE["claims"]), SECRET) == TOKEN


def test_token_is_expired_at_exp() -> None:
    assert _reason(TOKEN, now=FIXTURE["expiredAt"]) == "expired"


def test_tampered_payload_fails_the_signature() -> None:
    _, signature = TOKEN.split(".")
    forged = _b64(json.dumps(FIXTURE["claims"] | {"pid": "5eed00000000000000000002"}).encode())
    assert _reason(f"{forged}.{signature}") == "bad_signature"


def test_a_different_secret_fails_the_signature() -> None:
    assert _reason(TOKEN, secret=f"{SECRET}-other") == "bad_signature"


@pytest.mark.parametrize(
    "token",
    [
        TOKEN.split(".")[0],
        f".{TOKEN.split('.')[1]}",
        f"{TOKEN.split('.')[0]}.",
        f"{TOKEN}.extra",
        "a+b.c/d",
        "",
    ],
    ids=["payload-only", "signature-only", "empty-signature", "three-parts", "not-base64url", "empty"],
)
def test_a_missing_or_extra_part_is_malformed(token: str) -> None:
    assert _reason(token) == "malformed"


@pytest.mark.parametrize(
    "claims",
    [
        FIXTURE["claims"] | {"extra": 1},
        FIXTURE["claims"] | {"scope": "admin"},
        FIXTURE["claims"] | {"tv": "0"},
        {key: value for key, value in FIXTURE["claims"].items() if key != "sub"},
    ],
    ids=["unknown-field", "unknown-scope", "string-number", "missing-sub"],
)
def test_signed_claims_that_fail_the_schema_are_malformed(claims: dict[str, Any]) -> None:
    assert _reason(_signed(json.dumps(claims))) == "malformed"


def test_a_short_secret_is_refused() -> None:
    with pytest.raises(ValueError, match="at least 32"):
        verify_device_token(TOKEN, "short", FIXTURE["validAt"])
