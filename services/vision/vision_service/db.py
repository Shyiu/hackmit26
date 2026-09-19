from __future__ import annotations

from typing import Any

from .config import Settings


def get_client(settings: Settings):
    if settings.MONGODB_URI.startswith("mongomock://"):
        import mongomock

        return mongomock.MongoClient()
    from pymongo import MongoClient

    return MongoClient(settings.MONGODB_URI)


def get_db(client: Any, settings: Settings):
    return client[settings.MONGODB_DB]


def ensure_indexes(db: Any) -> dict[str, list[str]]:
    created = {
        "observations": [
            db.observations.create_index([("device_id", 1), ("captured_at", -1)]),
            db.observations.create_index([("processing.state", 1), ("created_at", -1)]),
            db.observations.create_index([("created_at", -1)]),
        ],
        "alerts": [
            db.alerts.create_index([("status", 1), ("created_at", -1)]),
            db.alerts.create_index([("event_type", 1), ("created_at", -1)]),
            db.alerts.create_index([("observation_ids", 1)]),
        ],
        "faceProfiles": [
            db.faceProfiles.create_index([("name", 1)]),
            db.faceProfiles.create_index([("_id", 1)], unique=True),
        ],
    }
    return created
