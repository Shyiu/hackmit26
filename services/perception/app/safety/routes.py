from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Response

from ..tokens import InvalidTokenError, verify_device_token

router = APIRouter()


def _jsonable(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    return value


def _services(request: Request):
    return request.app.state.services


def _claims(request: Request, scope: str):
    services = _services(request)
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Bearer token required"})
    try:
        claims = verify_device_token(
            header[7:], services.settings.device_token_secret, services.token_clock()
        )
    except (InvalidTokenError, ValueError):
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Invalid token"}) from None
    if claims.scope != scope and not (scope != "frames" and claims.scope == "api"):
        raise HTTPException(403, detail={"code": "forbidden", "message": "Insufficient token scope"})
    return claims


def _captured_at(value: str | None) -> datetime:
    if not value:
        return datetime.now(UTC)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, "capturedAt must be an ISO 8601 timestamp") from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _object_id(raw: str) -> ObjectId:
    if not ObjectId.is_valid(raw):
        raise HTTPException(404, "Not found")
    return ObjectId(raw)


@router.post("/frames", status_code=201)
async def ingest_frame(request: Request):
    claims = _claims(request, "frames")
    patient_id = ObjectId(claims.pid)
    services = _services(request)
    device_id = ObjectId(claims.sub) if claims.sub else None
    if device_id is not None and await services.store.device_source(patient_id, device_id, claims.tv) is None:
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Unknown or revoked device"})
    content_type = request.headers.get("content-type", "")
    filename = ""
    captured = None
    data: bytes
    if content_type.startswith("multipart/"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(422, "file is required")
        data = await upload.read()
        filename = getattr(upload, "filename", "") or ""
        captured = form.get("capturedAt")
    else:
        body = await request.json()
        if not services.settings.allow_local_path_ingest:
            raise HTTPException(403, "local path ingest is disabled")
        path = Path(body.get("path", "")).resolve()
        if services.settings.ingest_allowed_dir and not path.is_relative_to(
            Path(services.settings.ingest_allowed_dir).resolve()
        ):
            raise HTTPException(403, "path is outside the ingest directory")
        data = path.read_bytes()
        filename = path.name
        captured = body.get("capturedAt")
    if not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(415, "JPEG upload required")
    captured_at = _captured_at(str(captured) if captured else None)
    result = await services.safety.process(patient_id, device_id, None, data, captured_at, filename=filename)
    return _jsonable(result)


@router.post("/people", status_code=201)
async def enroll_person(request: Request):
    patient_id = ObjectId(_claims(request, "api").pid)
    form = await request.form()
    photos = form.getlist("photos")
    if not photos:
        raise HTTPException(422, "one or more photos are required")
    data = [(getattr(photo, "filename", "") or "", await photo.read()) for photo in photos]
    try:
        person = await _services(request).safety.enroll(
            patient_id,
            str(form.get("name", "")),
            str(form["relation"]) if form.get("relation") else None,
            str(form.get("consentedBy", "")),
            data,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _jsonable(person)


@router.get("/people")
async def list_people(request: Request):
    patient_id = ObjectId(_claims(request, "api").pid)
    return _jsonable(await _services(request).safety.store.list_people(patient_id))


@router.delete("/people/{person_id}", status_code=204)
async def delete_person(person_id: str, request: Request):
    patient_id = ObjectId(_claims(request, "api").pid)
    if not await _services(request).safety.store.delete_person(patient_id, _object_id(person_id)):
        raise HTTPException(404, "Not found")
    return Response(status_code=204)


@router.get("/frame-observations")
async def list_frames(request: Request, limit: int = 50, before: str | None = None):
    patient_id = ObjectId(_claims(request, "api").pid)
    before_at = _captured_at(before) if before else None
    docs = await _services(request).safety.store.list_frame_observations(
        patient_id, min(limit, 100), before_at
    )
    return _jsonable(docs)


@router.get("/danger-events")
async def list_events(request: Request, status: str = "open", limit: int = 50):
    patient_id = ObjectId(_claims(request, "api").pid)
    docs = await _services(request).safety.store.list_danger_events(patient_id, status, min(limit, 100))
    return _jsonable(docs)


@router.patch("/danger-events/{event_id}")
async def update_event(event_id: str, request: Request):
    patient_id = ObjectId(_claims(request, "api").pid)
    body = await request.json()
    if body.get("status") not in {"open", "acknowledged", "dismissed", "escalated", "closed"}:
        raise HTTPException(422, "invalid status")
    doc = await _services(request).safety.store.update_danger_event_status(
        patient_id, _object_id(event_id), body["status"], body.get("acknowledgedBy")
    )
    if doc is None:
        raise HTTPException(404, "Not found")
    return _jsonable(doc)
