from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from io import BytesIO

import numpy as np
from bson import ObjectId
from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import Settings
from .adapters.registry import Adapters
from .images import LocalFrameStore
from .models import FaceObservation, FrameAnalysis
from .pipeline import detect_and_embed, find_hazards, match_faces
from .store import SafetyStore


class SafetyService:
    def __init__(
        self,
        settings: Settings,
        store: SafetyStore,
        adapters: Adapters,
        frame_store: LocalFrameStore,
    ):
        self.settings = settings
        self.store = store
        self.adapters = adapters
        self.frame_store = frame_store

    async def analyze(
        self,
        patient_id: ObjectId,
        jpeg: bytes,
        *,
        filename: str = "",
        on_faces: Callable[[list[FaceObservation]], Awaitable[None]] | None = None,
    ) -> FrameAnalysis:
        """The model work, with nothing written. `on_faces` is awaited the moment faces are
        matched, before the hazard detector and the VLM start."""
        gallery = await self.store.gallery(patient_id, self.adapters.face_embedder.model)
        work = await asyncio.to_thread(
            match_faces,
            jpeg,
            adapters=self.adapters,
            settings=self.settings,
            gallery=gallery,
            filename=filename,
        )
        if on_faces is not None and work.array is not None:
            await on_faces(list(work.analysis.faces))
        return await asyncio.to_thread(find_hazards, work, adapters=self.adapters, settings=self.settings)

    async def persist(
        self,
        patient_id: ObjectId,
        device_id: ObjectId | None,
        session_id: ObjectId | None,
        jpeg: bytes,
        captured_at: datetime,
        analysis: FrameAnalysis,
    ) -> dict:
        stored = await asyncio.to_thread(self.frame_store.put, patient_id, jpeg, captured_at)
        frame_id = await self.store.record_frame_observation(
            patient_id, device_id, session_id, captured_at, stored.key, analysis
        )
        event_ids = await self.store.upsert_danger_events(
            patient_id, frame_id, stored.key, captured_at, analysis
        )
        return {
            "_id": frame_id,
            "patientId": patient_id,
            "deviceId": device_id,
            "captureSessionId": session_id,
            "capturedAt": captured_at,
            "imageKey": stored.key,
            **analysis.to_observation_fields(),
            "dangerEventIds": event_ids,
        }

    async def process(
        self,
        patient_id: ObjectId,
        device_id: ObjectId | None,
        session_id: ObjectId | None,
        jpeg: bytes,
        captured_at: datetime,
        *,
        filename: str = "",
    ) -> dict:
        analysis = await self.analyze(patient_id, jpeg, filename=filename)
        return await self.persist(patient_id, device_id, session_id, jpeg, captured_at, analysis)

    async def enroll(
        self,
        patient_id: ObjectId,
        name: str,
        relation: str | None,
        consented_by: str,
        photos: list[bytes | tuple[str, bytes]],
    ) -> dict:
        embeddings = []
        keys = []
        now = datetime.now(UTC)
        for item in photos:
            filename, photo = item if isinstance(item, tuple) else ("", item)
            try:
                # A phone photo is stored sideways with an EXIF flag, and a sideways face isn't found.
                image = ImageOps.exif_transpose(Image.open(BytesIO(photo))).convert("RGB")
            except (UnidentifiedImageError, OSError):
                raise ValueError("each photo must be an image") from None
            array = np.asarray(image)
            found = await asyncio.to_thread(detect_and_embed, self.adapters, array, filename=filename)
            if len(found) != 1:
                raise ValueError("each photo must contain exactly one face")
            embeddings.append(found[0][1])
            keys.append(await asyncio.to_thread(self.frame_store.put_reference, patient_id, photo, now))
        return await self.store.enroll_person(
            patient_id,
            name,
            relation,
            consented_by,
            keys,
            embeddings,
            self.adapters.face_embedder.model,
        )
