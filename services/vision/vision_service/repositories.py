from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from .schemas import Alert, FaceProfile, Observation


def _dump(model: Any) -> dict[str, Any]:
    return model.model_dump(by_alias=True, exclude_none=False)


class ObservationsRepo:
    def __init__(self, db: Any):
        self.collection = db.observations

    def insert(self, observation: Observation) -> Observation:
        doc = _dump(observation)
        self.collection.replace_one({"_id": observation.id}, doc, upsert=True)
        return observation

    def update(self, observation: Observation) -> Observation:
        self.collection.replace_one({"_id": observation.id}, _dump(observation), upsert=True)
        return observation

    def get(self, observation_id: str) -> Observation | None:
        doc = self.collection.find_one({"_id": observation_id})
        return Observation.model_validate(doc) if doc else None

    def list(
        self, device_id: str | None = None, state: str | None = None, limit: int = 50, before=None
    ):
        query: dict[str, Any] = {}
        if device_id:
            query["device_id"] = device_id
        if state:
            query["processing.state"] = state
        if before:
            query["captured_at"] = {"$lt": before}
        return [
            Observation.model_validate(doc)
            for doc in self.collection.find(query).sort("created_at", -1).limit(limit)
        ]


class FaceProfilesRepo:
    def __init__(self, db: Any):
        self.collection = db.faceProfiles

    def insert(self, profile: FaceProfile) -> FaceProfile:
        self.collection.insert_one(_dump(profile))
        return profile

    def get(self, profile_id: str) -> FaceProfile | None:
        doc = self.collection.find_one({"_id": profile_id})
        return FaceProfile.model_validate(doc) if doc else None

    def list(self):
        return [
            FaceProfile.model_validate(doc) for doc in self.collection.find().sort("created_at", -1)
        ]

    def delete(self, profile_id: str) -> bool:
        return self.collection.delete_one({"_id": profile_id}).deleted_count == 1


class AlertsRepo:
    def __init__(self, db: Any):
        self.collection = db.alerts

    def insert(self, alert: Alert) -> Alert:
        self.collection.insert_one(_dump(alert))
        return alert

    def update(self, alert: Alert) -> Alert:
        self.collection.replace_one({"_id": alert.id}, _dump(alert), upsert=False)
        return alert

    def get(self, alert_id: str) -> Alert | None:
        doc = self.collection.find_one({"_id": alert_id})
        return Alert.model_validate(doc) if doc else None

    def list(self, status: str | None = None, event_type: str | None = None, limit: int = 50):
        query: dict[str, Any] = {}
        if status:
            query["status"] = status
        if event_type:
            query["event_type"] = event_type
        return [
            Alert.model_validate(doc)
            for doc in self.collection.find(query).sort("created_at", -1).limit(limit)
        ]


def new_id() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.utcnow()
