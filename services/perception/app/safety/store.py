from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..store import ObservationStore, to_ms
from .crypto import decrypt_embedding, encrypt_embedding
from .models import Candidate, EnrolledPerson, FrameAnalysis


class SafetyStore:
    def __init__(self, db: AsyncDatabase[dict[str, Any]], observations: ObservationStore, settings):
        self._db = db
        self._observations = observations
        self._settings = settings
        self._people = db["people"]
        self._frames = db["frame_observations"]
        self._events = db["danger_events"]
        self._notifications = db["notifications"]

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
        return result.deleted_count == 1

    async def enrolled_embeddings(self, patient_id: ObjectId) -> tuple[EnrolledPerson, ...]:
        people: list[EnrolledPerson] = []
        async for doc in self._people.find({"patientId": patient_id}):
            embeddings = tuple(
                decrypt_embedding(base64.b64decode(payload), self._settings.fernet())
                for payload in doc["faceEmbeddings"]
            )
            people.append(
                EnrolledPerson(
                    person_id=doc["_id"],
                    embeddings=embeddings,
                    embedding_model=doc["embeddingModel"],
                )
            )
        return tuple(people)

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

    async def upsert_danger_events(
        self,
        patient_id: ObjectId,
        frame_id: ObjectId,
        frame_key: str,
        captured_at: datetime,
        analysis: FrameAnalysis,
    ) -> list[ObjectId]:
        ids: list[ObjectId] = []
        for candidate in analysis.candidates:
            event = await self._upsert_event(
                patient_id, frame_id, frame_key, captured_at, analysis, candidate
            )
            ids.append(event)
        return ids

    async def _upsert_event(
        self,
        patient_id: ObjectId,
        frame_id: ObjectId,
        frame_key: str,
        captured_at: datetime,
        analysis: FrameAnalysis,
        candidate: Candidate,
    ) -> ObjectId:
        now = to_ms(datetime.now(UTC))
        seen = to_ms(captured_at)
        cutoff = seen - timedelta(seconds=self._settings.danger_event_merge_window_s)
        existing = await self._events.find_one(
            {
                "patientId": patient_id,
                "kind": candidate.kind,
                "hazardLabel": candidate.hazard_label,
                "status": "open",
                "lastSeenAt": {"$gte": cutoff},
            },
            sort=[("lastSeenAt", -1)],
        )
        verification = candidate.verification
        if existing is not None:
            if existing["verification"] == "model_confirmed":
                verification = "model_confirmed"
            await self._events.update_one(
                {"_id": existing["_id"], "patientId": patient_id},
                {
                    "$set": {
                        "lastSeenAt": seen,
                        "bbox": [
                            candidate.bbox.x,
                            candidate.bbox.y,
                            candidate.bbox.w,
                            candidate.bbox.h,
                        ],
                        "frameSize": [analysis.width, analysis.height],
                        "keyframeKey": frame_key,
                        "verification": verification,
                        "updatedAt": now,
                    },
                    "$max": {"confidence": candidate.confidence},
                    "$push": {"frameObservationIds": {"$each": [frame_id], "$slice": -200}},
                },
            )
            return existing["_id"]

        event_id = ObjectId()
        expires = to_ms(now + timedelta(days=await self._observations.retention_days(patient_id)))
        doc = {
            "_id": event_id,
            "patientId": patient_id,
            "kind": candidate.kind,
            "hazardLabel": candidate.hazard_label,
            "severity": candidate.severity,
            "confidence": candidate.confidence,
            "verification": verification,
            "evidenceScope": "single_frame",
            "status": "open",
            "firstSeenAt": seen,
            "lastSeenAt": seen,
            "bbox": [
                candidate.bbox.x,
                candidate.bbox.y,
                candidate.bbox.w,
                candidate.bbox.h,
            ],
            "frameSize": [analysis.width, analysis.height],
            "keyframeKey": frame_key,
            "frameObservationIds": [frame_id],
            "evidence": {
                "detectorName": analysis.detector_name,
                "detectorConfidence": candidate.confidence,
                "vlmModel": analysis.vlm.model if candidate.vlm_verify else None,
                "vlmConfidence": candidate.vlm_confidence,
                "observableEvidence": candidate.vlm_evidence,
            },
            "acknowledgedAt": None,
            "acknowledgedBy": None,
            "notification": {"status": "pending", "notificationId": None},
            "createdAt": now,
            "updatedAt": now,
            "expiresAt": expires,
        }
        await self._events.insert_one(doc)
        try:
            text_by_kind = {
                "weapon_visible": (
                    "Possible knife or firearm in view. Single frame, unverified — worth a look."
                ),
                "medication_or_chemical_visible": (
                    "Possible medication or chemical container in view. Single frame, unverified."
                ),
                "hot_surface_visible": "Possible hot surface or stove in view. Single frame, unverified.",
                "unknown_face": "Someone unfamiliar may be in view. Single frame, unverified.",
            }
            text = text_by_kind.get(
                candidate.kind,
                f"Possible {candidate.hazard_label or 'hazard'} in view. Single frame, unverified.",
            )
            notification = {
                "_id": ObjectId(),
                "patientId": patient_id,
                "kind": "danger_alert",
                "text": text[:200],
                "createdBy": None,
                "showAt": now,
                "status": "queued",
                "shownAt": None,
                "createdAt": now,
                "expiresAt": expires,
                "dangerEventId": event_id,
            }
            await self._notifications.insert_one(notification)
            await self._events.update_one(
                {"_id": event_id, "patientId": patient_id},
                {
                    "$set": {
                        "notification": {
                            "status": "queued",
                            "notificationId": notification["_id"],
                        }
                    }
                },
            )
        except Exception:
            await self._events.update_one(
                {"_id": event_id, "patientId": patient_id},
                {"$set": {"notification": {"status": "failed", "notificationId": None}}},
            )
        return event_id

    async def list_frame_observations(
        self, patient_id: ObjectId, limit: int = 50, before: datetime | None = None
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"patientId": patient_id}
        if before:
            query["capturedAt"] = {"$lt": before}
        return [doc async for doc in self._frames.find(query).sort("capturedAt", -1).limit(limit)]

    async def list_danger_events(
        self, patient_id: ObjectId, status: str = "open", limit: int = 50
    ) -> list[dict[str, Any]]:
        return [
            doc
            async for doc in self._events.find({"patientId": patient_id, "status": status})
            .sort("lastSeenAt", -1)
            .limit(limit)
        ]

    async def update_danger_event_status(
        self,
        patient_id: ObjectId,
        event_id: ObjectId,
        status: str,
        acknowledged_by: str | None = None,
    ) -> dict[str, Any] | None:
        update: dict[str, Any] = {"status": status, "updatedAt": to_ms(datetime.now(UTC))}
        if status == "acknowledged":
            update["acknowledgedAt"] = to_ms(datetime.now(UTC))
            update["acknowledgedBy"] = acknowledged_by
        return await self._events.find_one_and_update(
            {"_id": event_id, "patientId": patient_id},
            {"$set": update},
            return_document=ReturnDocument.AFTER,
        )
