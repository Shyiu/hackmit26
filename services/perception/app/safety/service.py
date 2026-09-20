from __future__ import annotations

import asyncio
import logging
import time
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

log = logging.getLogger("perception.safety")


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
        # Per-process, per-(patient, person) cooldown clock. Lost on restart,
        # which only costs one extra announcement.
        self._last_announced: dict[tuple[ObjectId, ObjectId], float] = {}

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
        if work.array is not None:
            await self._announce_recognized(patient_id, work.analysis.faces)
        return await asyncio.to_thread(find_hazards, work, adapters=self.adapters, settings=self.settings)

    async def _announce_recognized(self, patient_id: ObjectId, faces: list[FaceObservation]) -> None:
        """Speaks up the instant an enrolled face is matched, cooldown permitting.

        Queues a `reminder` notification -- the existing generic kind the
        wearer's page already polls and speaks -- so no new client code path
        is needed. Skips anyone announced within `face_announce_cooldown_s`.
        """
        now = time.monotonic()
        for face in faces:
            if face.person_id is None:
                continue
            key = (patient_id, face.person_id)
            last = self._last_announced.get(key)
            if last is not None and now - last < self.settings.face_announce_cooldown_s:
                continue
            self._last_announced[key] = now
            try:
                await self.store.queue_person_recognized_notification(
                    patient_id, face.name or "", face.relation
                )
            except Exception:
                log.exception("Failed to queue recognized-person notification for %s", face.person_id)

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
        keys, embeddings = await self._embed_photos(patient_id, photos)
        return await self.store.enroll_person(
            patient_id,
            name,
            relation,
            consented_by,
            keys,
            embeddings,
            self.adapters.face_embedder.model,
        )

    async def _embed_photos(
        self, patient_id: ObjectId, photos: list[bytes | tuple[str, bytes]]
    ) -> tuple[list[str], list]:
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
            found = await asyncio.to_thread(
                detect_and_embed, self.adapters, array, filename=filename, for_enrollment=True
            )
            # Save every photo even when detection misses. With multiple faces,
            # use the largest rather than enrolling several identities as one person.
            if found:
                face = max(found, key=lambda item: item[0].bbox.w * item[0].bbox.h)
                embeddings.append(face[1])
            keys.append(await asyncio.to_thread(self.frame_store.put_reference, patient_id, photo, now))
        return keys, embeddings

    async def add_photos(
        self,
        patient_id: ObjectId,
        person_id: ObjectId,
        photos: list[bytes | tuple[str, bytes]],
    ) -> dict | None:
        person = await self.store.get_person(patient_id, person_id)
        if person is None:
            return None
        if len(person["referenceImageKeys"]) + len(photos) > 20:
            raise ValueError("a person can have at most 20 reference photos")
        keys, embeddings = await self._embed_photos(patient_id, photos)
        return await self.store.add_person_photos(patient_id, person_id, keys, embeddings)
