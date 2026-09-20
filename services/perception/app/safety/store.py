from __future__ import annotations

import base64
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId
from cryptography.fernet import InvalidToken
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..store import ObservationStore, to_ms
from .crypto import decrypt_embedding, encrypt_embedding
from .models import EnrolledPerson, FrameAnalysis, Gallery

log = logging.getLogger("perception.safety")


class _Unset:
    pass


_UNSET = _Unset()


class SafetyStore:
    def __init__(self, db: AsyncDatabase[dict[str, Any]], observations: ObservationStore, settings):
        self._db = db
        self._observations = observations
        self._settings = settings
        self._people = db["people"]
        self._frames = db["frame_observations"]
        self._notifications = db["notifications"]
        # Decrypted galleries by wearer and embedding model, so a frame costs no query and no
        # Fernet pass. In this process only, and dropped whenever that wearer's people change.
        self._galleries: dict[tuple[ObjectId, str], tuple[float, Gallery]] = {}

    async def enroll_person(
        self,
        patient_id: ObjectId,
        name: str,
        relation: str | None,
        consented_by: str,
        reference_image_keys: list[str],
        embeddings: list[Any],
        embedding_model: str,
    ) -> dict[str, Any]:
        now = to_ms(datetime.now(UTC))
        expires = to_ms(now + timedelta(days=await self._observations.retention_days(patient_id)))
        doc = {
            "_id": ObjectId(),
            "patientId": patient_id,
            "name": name,
            "relation": relation,
            "referenceImageKeys": reference_image_keys,
            "faceEmbeddings": [
                base64.b64encode(encrypt_embedding(embedding, self._settings.fernet())).decode()
                for embedding in embeddings
            ],
            "embeddingModel": embedding_model,
            "consentedAt": now,
            "consentedBy": consented_by,
            "createdAt": now,
            "expiresAt": expires,
        }
        await self._people.insert_one(doc)
        self.forget_gallery(patient_id)
        return self._public_person(doc)

    async def get_person(self, patient_id: ObjectId, person_id: ObjectId) -> dict[str, Any] | None:
        doc = await self._people.find_one({"_id": person_id, "patientId": patient_id})
        return self._public_person(doc) if doc is not None else None

    async def update_person(
        self,
        patient_id: ObjectId,
        person_id: ObjectId,
        *,
        name: str | None = None,
        relation: str | None | _Unset = _UNSET,
    ) -> dict[str, Any] | None:
        filter_ = {"_id": person_id, "patientId": patient_id}
        changes: dict[str, Any] = {}
        if name is not None:
            changes["name"] = name
        if not isinstance(relation, _Unset):
            changes["relation"] = relation
        if changes:
            doc = await self._people.find_one_and_update(
                filter_, {"$set": changes}, return_document=ReturnDocument.AFTER
            )
        else:
            doc = await self._people.find_one(filter_)
        if doc is None:
            return None
        self.forget_gallery(patient_id)
        return self._public_person(doc)

    async def add_person_photos(
        self,
        patient_id: ObjectId,
        person_id: ObjectId,
        reference_image_keys: list[str],
        embeddings: list[Any],
    ) -> dict[str, Any] | None:
        doc = await self._people.find_one({"_id": person_id, "patientId": patient_id})
        if doc is None:
            return None
        if len(doc["referenceImageKeys"]) + len(reference_image_keys) > 20:
            raise ValueError("a person can have at most 20 reference photos")
        doc = await self._people.find_one_and_update(
            {"_id": person_id, "patientId": patient_id},
            {
                "$push": {
                    "referenceImageKeys": {"$each": reference_image_keys},
                    "faceEmbeddings": {
                        "$each": [
                            base64.b64encode(encrypt_embedding(embedding, self._settings.fernet())).decode()
                            for embedding in embeddings
                        ]
                    },
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if doc is None:
            return None
        self.forget_gallery(patient_id)
        return self._public_person(doc)

    @staticmethod
    def _public_person(doc: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in doc.items() if key != "faceEmbeddings"}

    async def list_people(self, patient_id: ObjectId) -> list[dict[str, Any]]:
        return [
            self._public_person(doc)
            async for doc in self._people.find({"patientId": patient_id}).sort("createdAt", -1)
        ]

    async def delete_person(self, patient_id: ObjectId, person_id: ObjectId) -> bool:
        result = await self._people.delete_one({"_id": person_id, "patientId": patient_id})
        self.forget_gallery(patient_id)
        return result.deleted_count == 1

    def forget_gallery(self, patient_id: ObjectId) -> None:
        for key in [key for key in self._galleries if key[0] == patient_id]:
            del self._galleries[key]

    async def gallery(self, patient_id: ObjectId, embedding_model: str) -> Gallery:
        """The wearer's own enrolled set, never anyone else's. Rebuilt after the TTL, which is
        what picks up a retention sweep or a second service process."""
        key = (patient_id, embedding_model)
        cached = self._galleries.get(key)
        ttl = self._settings.face_gallery_ttl_s
        if cached is not None and time.monotonic() - cached[0] < ttl:
            return cached[1]
        gallery = Gallery.build(await self.enrolled_embeddings(patient_id), embedding_model)
        self._galleries[key] = (time.monotonic(), gallery)
        return gallery

    async def enrolled_embeddings(self, patient_id: ObjectId) -> tuple[EnrolledPerson, ...]:
        people: list[EnrolledPerson] = []
        async for doc in self._people.find({"patientId": patient_id}):
            try:
                embeddings = tuple(
                    decrypt_embedding(base64.b64decode(payload), self._settings.fernet())
                    for payload in doc["faceEmbeddings"]
                )
            except InvalidToken:
                # Enrolled under another FACE_EMBEDDING_KEY. One such person must not fail the
                # whole frame; they need enrolling again.
                log.warning("person %s can't be decrypted with this FACE_EMBEDDING_KEY", doc["_id"])
                continue
            people.append(
                EnrolledPerson(
                    person_id=doc["_id"],
                    embeddings=embeddings,
                    embedding_model=doc["embeddingModel"],
                    name=doc.get("name", ""),
                    relation=doc.get("relation"),
                )
            )
        return tuple(people)

    async def was_recently_announced(
        self, patient_id: ObjectId, person_id: ObjectId, now: datetime, cooldown_s: float
    ) -> bool:
        """Mongo-backed cooldown check, mirroring `_upsert_event`'s merge-window pattern
        below instead of a per-process dict: state that survives a restart, and the
        same clock every other piece of the cooldown/merge logic already uses.
        """
        cutoff = to_ms(now - timedelta(seconds=cooldown_s))
        existing = await self._notifications.find_one(
            {
                "patientId": patient_id,
                "personId": person_id,
                "kind": "person_recognized",
                "createdAt": {"$gte": cutoff},
            }
        )
        return existing is not None

    async def queue_person_recognized_notification(
        self, patient_id: ObjectId, person_id: ObjectId, name: str, relation: str | None
    ) -> ObjectId:
        """Tells the wearer who's with them, over the same poll/TTS channel a caregiver
        reminder uses. `personId` isn't part of the shared notification wire schema (this
        service writes straight to Mongo, not through packages/db's strict repo layer), but
        `was_recently_announced` above needs it to scope the cooldown per person.
        """
        now = to_ms(datetime.now(UTC))
        expires = to_ms(now + timedelta(days=await self._observations.retention_days(patient_id)))
        text = f"{name}, your {relation}, is with you." if relation else f"{name} is with you."
        notification = {
            "_id": ObjectId(),
            "patientId": patient_id,
            "personId": person_id,
            "kind": "person_recognized",
            "text": text[:200],
            "createdBy": None,
            "showAt": now,
            "status": "queued",
            "shownAt": None,
            "createdAt": now,
            "expiresAt": expires,
        }
        await self._notifications.insert_one(notification)
        return notification["_id"]

    async def record_frame_observation(
        self,
        patient_id: ObjectId,
        device_id: ObjectId | None,
        capture_session_id: ObjectId | None,
        captured_at: datetime,
        image_key: str,
        analysis: FrameAnalysis,
    ) -> ObjectId:
        now = to_ms(datetime.now(UTC))
        doc = {
            "_id": ObjectId(),
            "patientId": patient_id,
            "deviceId": device_id,
            "captureSessionId": capture_session_id,
            "capturedAt": to_ms(captured_at),
            **analysis.to_observation_fields(),
            "imageKey": image_key,
            "expiresAt": now + timedelta(days=await self._observations.retention_days(patient_id)),
        }
        await self._frames.insert_one(doc)
        return doc["_id"]

    async def list_frame_observations(
        self, patient_id: ObjectId, limit: int = 50, before: datetime | None = None
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"patientId": patient_id}
        if before:
            query["capturedAt"] = {"$lt": before}
        return [doc async for doc in self._frames.find(query).sort("capturedAt", -1).limit(limit)]

    async def latest_recognized_person(
        self, patient_id: ObjectId, now: datetime, within_s: float
    ) -> dict[str, Any] | None:
        """The most recently matched enrolled face, for "who is this" -- a question, not a
        proactive announcement, so it has its own recency window rather than reusing
        `face_announce_cooldown_s`. `personId`/`matchConfidence` are the only face fields
        `record_frame_observation` ever stores (models.py: name/relation are deliberately
        never written to a frame), so the person's name and relation have to be joined
        from `people` here.
        """
        cutoff = to_ms(now - timedelta(seconds=within_s))
        frame = await self._frames.find_one(
            # `$ne` on an array field only matches when no element is null, so a frame with
            # one stranger and one match would be skipped; `$elemMatch` asks for any match.
            {
                "patientId": patient_id,
                "faces": {"$elemMatch": {"personId": {"$ne": None}}},
                "capturedAt": {"$gte": cutoff},
            },
            sort=[("capturedAt", -1)],
        )
        if frame is None:
            return None
        face = next((f for f in frame.get("faces", []) if f.get("personId") is not None), None)
        if face is None:
            return None
        person = await self._people.find_one({"_id": face["personId"], "patientId": patient_id})
        if person is None:
            return None
        return {
            "name": person.get("name", ""),
            "relation": person.get("relation"),
            "seenAt": frame["capturedAt"],
        }
