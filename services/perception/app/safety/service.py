from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image

from ..config import Settings
from .adapters.registry import Adapters
from .images import LocalFrameStore
from .pipeline import analyze_frame
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

    async def process(
        self,
        patient_id,
        device_id,
        session_id,
        jpeg: bytes,
        captured_at: datetime,
        *,
        filename: str = "",
    ) -> dict:
        people = await self.store.enrolled_embeddings(patient_id)
        analysis = await asyncio.to_thread(
            analyze_frame,
            jpeg,
            adapters=self.adapters,
            settings=self.settings,
            enrolled_people=people,
            filename=filename,
        )
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

    async def enroll(
        self,
        patient_id,
        name: str,
        relation: str | None,
        consented_by: str,
        photos: list[bytes | tuple[str, bytes]],
    ) -> dict:
        embeddings = []
        keys = []
        now = datetime.now(UTC)
        root = Path(self.settings.frame_image_dir)
        for item in photos:
            filename, photo = item if isinstance(item, tuple) else ("", item)
            image = Image.open(__import__("io").BytesIO(photo)).convert("RGB")
            array = np.asarray(image)
            faces = await asyncio.to_thread(self.adapters.face_detector.detect, array, filename=filename)
            if len(faces) != 1:
                raise ValueError("each photo must contain exactly one face")
            embedding = await asyncio.to_thread(self.adapters.face_embedder.embed, array, faces)
            embeddings.append(embedding[0])
            key = f"people/{patient_id}/{now:%Y/%m/%d}/{uuid4()}.jpg"
            path = root / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(photo)
            keys.append(key)
        return await self.store.enroll_person(
            patient_id,
            name,
            relation,
            consented_by,
            keys,
            embeddings,
            self.adapters.face_embedder.model,
        )
