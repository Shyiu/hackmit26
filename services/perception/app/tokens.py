"""Device tokens, verified the same way as packages/shared/src/device-token.ts.

Format: base64url(JSON claims), a dot, then base64url(HMAC-SHA256(secret, the
first part)). The web app mints them with DEVICE_TOKEN_SECRET. The fixture in
packages/shared/fixtures/device-token.json is the cross-language check.

`uv run python -m app.tokens --patient <id>` mints one for local testing,
until GET /api/perception/token does it for real.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import re
import time
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .protocol import Int, ObjectIdHex, Version

MIN_SECRET_LENGTH = 32
_BASE64URL = re.compile(r"[A-Za-z0-9_-]*")

Scope = Literal["frames", "api"]
InvalidReason = Literal["malformed", "bad_signature", "expired"]


class DeviceTokenClaims(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    v: Version
    # The wearer. Every read and write the token allows is scoped to it.
    pid: ObjectIdHex
    # The registered device, or None for a caregiver's signed-in page.
    sub: ObjectIdHex | None
    scope: Scope
    # The device's tokenVersion at mint time. Revoking a device bumps it.
    tv: Annotated[Int, Field(ge=0)]
    iat: Int
    exp: Int


class InvalidTokenError(Exception):
    def __init__(self, reason: InvalidReason) -> None:
        super().__init__(reason)
        self.reason: InvalidReason = reason


def _key(secret: str) -> bytes:
    if len(secret) < MIN_SECRET_LENGTH:
        raise ValueError(f"DEVICE_TOKEN_SECRET must be at least {MIN_SECRET_LENGTH} characters")
    return secret.encode("utf-8")


def _encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _decode(text: str) -> bytes | None:
    if not _BASE64URL.fullmatch(text):
        return None
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError):
        return None


def _sign(key: bytes, payload: str) -> bytes:
    return hmac.new(key, payload.encode("ascii"), hashlib.sha256).digest()


def sign_device_token(claims: DeviceTokenClaims, secret: str) -> str:
    # Compact JSON in field order: the same bytes JSON.stringify writes on the web side.
    payload = _encode(claims.model_dump_json().encode("utf-8"))
    return f"{payload}.{_encode(_sign(_key(secret), payload))}"


def verify_device_token(token: str, secret: str, now: float | None = None) -> DeviceTokenClaims:
    """Checks the signature before reading anything, then the expiry against `now` in epoch seconds.

    Raises InvalidTokenError with the same reasons the TypeScript verifier returns.
    """
    key = _key(secret)
    parts = token.split(".")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise InvalidTokenError("malformed")
    payload, signature = parts
    payload_bytes = _decode(payload)
    signature_bytes = _decode(signature)
    if payload_bytes is None or signature_bytes is None:
        raise InvalidTokenError("malformed")
    if not hmac.compare_digest(_sign(key, payload), signature_bytes):
        raise InvalidTokenError("bad_signature")
    try:
        claims = DeviceTokenClaims.model_validate_json(payload_bytes)
    except ValidationError:
        raise InvalidTokenError("malformed") from None
    if claims.exp <= (time.time() if now is None else now):
        raise InvalidTokenError("expired")
    return claims


def _main() -> None:
    parser = argparse.ArgumentParser(description="Mint a short-lived device token for local testing.")
    parser.add_argument("--patient", required=True, help="the wearer's _id, 24 hex characters")
    parser.add_argument("--device", default=None, help="a registered device's _id; omit for a signed-in page")
    parser.add_argument("--token-version", type=int, default=0, help="the device's tokenVersion")
    parser.add_argument("--scope", choices=["frames", "api"], default="frames")
    parser.add_argument("--minutes", type=int, default=15)
    args = parser.parse_args()

    from .config import TokenSettings

    now = int(time.time())
    claims = DeviceTokenClaims(
        v=1,
        pid=args.patient,
        sub=args.device,
        scope=args.scope,
        tv=args.token_version,
        iat=now,
        exp=now + args.minutes * 60,
    )
    secret = TokenSettings().device_token_secret  # type: ignore[call-arg]  # read from the environment
    print(sign_device_token(claims, secret))


if __name__ == "__main__":
    _main()
