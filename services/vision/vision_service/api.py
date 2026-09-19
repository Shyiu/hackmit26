from __future__ import annotations

import io
import logging
import mimetypes
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from .adapters.registry import build_adapters
from .config import Settings
from .crypto import encrypt_embedding
from .db import ensure_indexes, get_client, get_db
from .logging import configure
from .pipeline import process_image
from .repositories import AlertsRepo, FaceProfilesRepo, ObservationsRepo, new_id
from .schemas import Consent, FaceProfile
from .storage.images import GridFSImageStore, LocalDiskImageStore

logger = logging.getLogger(__name__)


class AlertPatch(BaseModel):
    status: str = Field(pattern="^(open|acknowledged|dismissed|escalated)$")


def _dependencies(settings: Settings):
    client = get_client(settings)
    db = get_db(client, settings)
    ensure_indexes(db)
    adapters = build_adapters(settings)
    image_store = (
        GridFSImageStore(db, settings.IMAGE_PUBLIC_BASE_URL)
        if settings.IMAGE_STORE == "gridfs"
        else LocalDiskImageStore(settings.IMAGE_DIR, settings.IMAGE_PUBLIC_BASE_URL)
    )
    return {
        "settings": settings,
        "client": client,
        "db": db,
        "adapters": adapters,
        "image_store": image_store,
        "repos": (ObservationsRepo(db), FaceProfilesRepo(db), AlertsRepo(db)),
    }


def _public_profile(profile: FaceProfile) -> dict:
    return profile.model_dump(by_alias=True, exclude={"embedding_encrypted"})


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()
    configure(app_settings.LOG_LEVEL)
    app = FastAPI(title="Vision safety pipeline")

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if not hasattr(_app.state, "deps"):
            _app.state.deps = _dependencies(app_settings)
        logger.info(
            "vision service started", extra={"adapters": app.state.deps["adapters"].__dict__}
        )
        yield

    app.router.lifespan_context = lifespan

    def get_deps(request: Request):
        if not hasattr(request.app.state, "deps"):
            request.app.state.deps = _dependencies(app_settings)
        return request.app.state.deps

    app.state.get_deps = get_deps

    @app.get("/health")
    def health(deps=Depends(get_deps)):  # noqa: B008
        settings = deps["settings"]
        return {
            "status": "ok",
            "adapters": {
                "detector": deps["adapters"].detector.name,
                "face_detector": deps["adapters"].face_detector.name,
                "face_embedder": deps["adapters"].face_embedder.name,
                "vlm": deps["adapters"].vlm.name if deps["adapters"].vlm else "off",
            },
            "mongo": "mongomock" if settings.MONGODB_URI.startswith("mongomock://") else "mongodb",
        }

    @app.post("/ingest")
    async def ingest(
        request: Request,
        file: UploadFile | None = File(default=None),  # noqa: B008
        device_id: str = Form(default="local-device"),  # noqa: B008
        captured_at: str | None = Form(default=None),  # noqa: B008
        deps=Depends(get_deps),  # noqa: B008
    ):
        content_type = request.headers.get("content-type", "")
        filename = "image.jpg"
        if file is not None:
            if not file.content_type or not file.content_type.startswith("image/"):
                raise HTTPException(status_code=415, detail="an image upload is required")
            data = await file.read()
            filename = file.filename or filename
            if captured_at is None:
                captured_at = request.query_params.get("captured_at")
        else:
            if "application/json" not in content_type:
                raise HTTPException(status_code=415, detail="an image upload is required")
            payload = await request.json()
            path = Path(payload.get("path", ""))
            settings = deps["settings"]
            if not settings.ALLOW_LOCAL_PATH_INGEST:
                raise HTTPException(status_code=403, detail="local path ingest is disabled")
            if settings.INGEST_ALLOWED_DIR and settings.INGEST_ALLOWED_DIR not in str(
                path.resolve()
            ):
                raise HTTPException(status_code=403, detail="path is outside the allowed directory")
            if not path.is_file() or not (mimetypes.guess_type(path.name)[0] or "").startswith(
                "image/"
            ):
                raise HTTPException(status_code=415, detail="an image path is required")
            data = path.read_bytes()
            filename = path.name
            device_id = payload.get("device_id", "local-device")
            captured_at = payload.get("captured_at")
        when = datetime.fromisoformat(captured_at) if captured_at else datetime.utcnow()
        observation = process_image(
            data,
            filename=filename,
            device_id=device_id,
            captured_at=when,
            adapters=deps["adapters"],
            repos=deps["repos"],
            image_store=deps["image_store"],
            settings=deps["settings"],
        )
        return observation.model_dump(by_alias=True)

    @app.post("/face-profiles")
    async def enroll(
        file: UploadFile = File(...),  # noqa: B008
        name: str = Form(...),  # noqa: B008
        consent_granted_by: str = Form(...),  # noqa: B008
        deps=Depends(get_deps),  # noqa: B008
    ):
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=415, detail="an image upload is required")
        data = await file.read()
        import numpy as np
        from PIL import Image

        image = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
        faces = deps["adapters"].face_detector.detect(image, filename=file.filename or "")
        if len(faces) != 1:
            raise HTTPException(status_code=400, detail="exactly one face is required")
        embedding = deps["adapters"].face_embedder.embed(image, faces[0])
        stored = deps["image_store"].put(
            data, content_type=file.content_type, suggested_name=file.filename or "face.jpg"
        )
        settings = deps["settings"]
        profile = FaceProfile(
            _id=new_id(),
            name=name,
            consent=Consent(
                granted=True, granted_at=datetime.utcnow(), granted_by=consent_granted_by
            ),
            embedding_encrypted=encrypt_embedding(embedding, settings.fernet()),
            embedding_model=deps["adapters"].face_embedder.model,
            embedding_dim=len(embedding),
            enrolled_from_image_key=stored.key,
            created_at=datetime.utcnow(),
        )
        deps["repos"][1].insert(profile)
        return _public_profile(profile)

    @app.get("/face-profiles")
    def list_profiles(deps=Depends(get_deps)):  # noqa: B008
        return [_public_profile(profile) for profile in deps["repos"][1].list()]

    @app.delete("/face-profiles/{profile_id}")
    def delete_profile(profile_id: str, deps=Depends(get_deps)):  # noqa: B008
        if not deps["repos"][1].delete(profile_id):
            raise HTTPException(status_code=404, detail="face profile not found")
        return {"deleted": True}

    @app.get("/observations")
    def list_observations(
        device_id: str | None = None,
        state: str | None = None,
        limit: int = Query(default=50, ge=1, le=100),
        before: datetime | None = None,
        deps=Depends(get_deps),  # noqa: B008
    ):
        return [
            item.model_dump(by_alias=True)
            for item in deps["repos"][0].list(
                device_id=device_id, state=state, limit=limit, before=before
            )
        ]

    @app.get("/observations/{observation_id}")
    def get_observation(observation_id: str, deps=Depends(get_deps)):  # noqa: B008
        result = deps["repos"][0].get(observation_id)
        if not result:
            raise HTTPException(status_code=404, detail="observation not found")
        return result.model_dump(by_alias=True)

    @app.get("/alerts")
    def list_alerts(
        status: str | None = None,
        event_type: str | None = None,
        limit: int = Query(default=50, ge=1, le=100),
        deps=Depends(get_deps),  # noqa: B008
    ):
        return [
            item.model_dump(by_alias=True)
            for item in deps["repos"][2].list(status, event_type, limit)
        ]

    @app.get("/alerts/{alert_id}")
    def get_alert(alert_id: str, deps=Depends(get_deps)):  # noqa: B008
        result = deps["repos"][2].get(alert_id)
        if not result:
            raise HTTPException(status_code=404, detail="alert not found")
        return result.model_dump(by_alias=True)

    @app.patch("/alerts/{alert_id}")
    def patch_alert(alert_id: str, patch: AlertPatch, deps=Depends(get_deps)):  # noqa: B008
        result = deps["repos"][2].get(alert_id)
        if not result:
            raise HTTPException(status_code=404, detail="alert not found")
        result.status = patch.status
        result.updated_at = datetime.utcnow()
        deps["repos"][2].update(result)
        return result.model_dump(by_alias=True)

    return app


app = create_app()
