"""A real MongoDB with the validators and indexes packages/db generates.

Every collection gets its $jsonSchema validator with validationAction "error",
so any write the store makes that the web side's schema wouldn't accept fails
the test that made it.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import PyMongoError

REPO = Path(__file__).resolve().parents[3]
SCHEMA: dict[str, Any] = json.loads(
    (REPO / "packages" / "db" / "generated" / "mongo-schema.json").read_text()
)
# Settings also reads the developer's .env, where the real models may be switched on. The
# environment wins over that file, so the tests always get the mocks.
os.environ.update(
    {
        "SAFETY_DETECTOR": "mock",
        "FACE_DETECTOR": "mock",
        "FACE_EMBEDDER": "mock",
        "VLM": "mock",
        "DETECTOR": "auto",
    }
)

TEST_URI = os.environ.get("MONGODB_TEST_URI", "mongodb://127.0.0.1:27017/?directConnection=true")

Database = AsyncDatabase[dict[str, Any]]


async def apply_schema(db: Database) -> None:
    """Creates every collection with its validator and indexes, the way `pnpm db:setup` does."""
    for name, spec in SCHEMA["collections"].items():
        await db.create_collection(
            name, validator=spec["validator"], validationLevel="strict", validationAction="error"
        )
        for index in spec["indexes"]:
            options: dict[str, Any] = {"name": index["name"], "unique": index.get("unique", False)}
            for option in ("partialFilterExpression", "expireAfterSeconds"):
                if option in index:
                    options[option] = index[option]
            # Pairs, not a dict, because a compound index depends on key order.
            await db[name].create_index(list(index["key"].items()), **options)


@pytest.fixture(scope="session")
async def mongo() -> AsyncIterator[AsyncMongoClient[dict[str, Any]]]:
    client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(
        TEST_URI, tz_aware=True, serverSelectionTimeoutMS=3_000
    )
    problem: str | None = None
    try:
        await client.admin.command("ping")
    except PyMongoError as error:
        problem = str(error)[:200]
    if problem is not None:
        # Fail rather than skip: a green run must mean the write path was tested.
        await client.close()
        pytest.fail(
            f"The store tests need MongoDB at {TEST_URI}. "
            f"Run `pnpm db:up` or set MONGODB_TEST_URI. ({problem})",
            pytrace=False,
        )
    yield client
    await client.close()


@pytest.fixture(scope="module")
async def db(mongo: AsyncMongoClient[dict[str, Any]]) -> AsyncIterator[Database]:
    """A fresh database per test module, dropped afterwards."""
    database = mongo[f"mg_perception_test_{uuid4().hex[:8]}"]
    await apply_schema(database)
    yield database
    await mongo.drop_database(database.name)


class Seed:
    """Writes the web-owned documents the store reads: wearers, items, devices."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def patient(self, patient_id: ObjectId | None = None, retention_days: int = 30) -> ObjectId:
        now = datetime.now(UTC)
        result = await self.db["patients"].insert_one(
            {
                "_id": patient_id or ObjectId(),
                "displayName": "Test wearer",
                "settings": {
                    "timezone": "America/New_York",
                    "ttsProvider": "elevenlabs",
                    "voiceId": None,
                    "speakingRate": 0.9,
                    "hudLevel": "everything",
                    "recordingAllowed": False,
                    "retentionDays": retention_days,
                    "staleAfterMinutes": 15,
                    "geofence": None,
                    "locationStaleAfterMinutes": 15,
                    "wakeWordEnabled": False,
                    "wakeWordSensitivity": 0.5,
                },
                "configVersion": 0,
                "createdAt": now,
                "updatedAt": now,
            }
        )
        inserted: ObjectId = result.inserted_id
        return inserted

    async def item(self, patient_id: ObjectId, name: str = "keys", *, active: bool = True) -> ObjectId:
        now = datetime.now(UTC)
        result = await self.db["items"].insert_one(
            {
                "_id": ObjectId(),
                "patientId": patient_id,
                "name": name,
                "plural": name.endswith("s"),
                "aliases": [],
                "lookupKeys": [name.lower()],
                "detectorPrompts": [name],
                "referenceImageKeys": [],
                "active": active,
                "observationVersion": 0,
                "lastSighting": None,
                "lastRestingSighting": None,
                "usualSpots": [],
                "createdAt": now,
                "updatedAt": now,
            }
        )
        inserted: ObjectId = result.inserted_id
        return inserted

    async def device(
        self,
        patient_id: ObjectId,
        device_id: ObjectId | None = None,
        *,
        token_version: int = 0,
        revoked: bool = False,
    ) -> ObjectId:
        now = datetime.now(UTC)
        result = await self.db["devices"].insert_one(
            {
                "_id": device_id or ObjectId(),
                "patientId": patient_id,
                "kind": "headset",
                "label": "Test headset",
                "tokenVersion": token_version,
                "lastSeenAt": None,
                "revokedAt": now if revoked else None,
                "createdAt": now,
                "updatedAt": now,
            }
        )
        inserted: ObjectId = result.inserted_id
        return inserted


@pytest.fixture
def seed(db: Database) -> Seed:
    return Seed(db)
