"""The perception write path: capture sessions, sightings, item snapshots, and the description queue.

Perception owns sightings and the latest-observation fields on items. Every
write here has to pass the validators generated from packages/db/src/registry.ts,
and every tenant-owned filter carries patientId. The idle sweep, the job claim
and the lease sweep are system jobs that serve every wearer.

Three rules keep a late or replayed write from undoing newer evidence:
- An item's snapshot only moves forward in capture time, through a
  compare-and-set on the item's observationVersion.
- A description reaches the item only while the item still shows the version,
  sighting and keyframe the job was queued for.
- A worker can only finish the attempt it claimed. `attempts` is the fencing token.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

CaptureSource = Literal["headset", "simulator", "glasses"]
CaptureState = Literal["paused", "live", "ended"]
ObservationState = Literal["resting", "held", "moving", "in_use", "unknown"]
BBox = tuple[float, float, float, float]
Document = dict[str, Any]

MAX_QUEUED_JOBS_PER_WEARER = 20
MAX_JOB_ATTEMPTS = 3
MAX_BACKOFF_SECONDS = 60
DEFAULT_LEASE = timedelta(seconds=30)
DEFAULT_IDLE = timedelta(seconds=3)
SNAPSHOT_RETRIES = 5
RETENTION_CACHE_SECONDS = 60.0


class UnknownPatientError(LookupError):
    """No wearer with that id. A token for a deleted wearer ends up here."""


class SnapshotContentionError(RuntimeError):
    """The item's version kept moving under the compare-and-set. Replaying the event finishes the install."""


def to_ms(moment: datetime) -> datetime:
    """Truncates to milliseconds, the precision BSON dates keep.

    Doing it before every write keeps Python's comparisons and the database's in
    agreement about which of two times is later.
    """
    if moment.tzinfo is None:
        raise ValueError("Naive datetime; the store only takes aware ones, like datetime.now(UTC)")
    return moment.replace(microsecond=moment.microsecond - moment.microsecond % 1000)


def snapshot_of(sighting: Mapping[str, Any]) -> Document:
    """The copy of a sighting an item carries. Mirrors snapshotOf() in packages/db/src/observations.ts."""
    room = sighting["room"]
    return {
        "sightingId": sighting["_id"],
        "observationVersion": sighting["observationVersion"],
        "keyframeRevision": sighting["keyframeRevision"],
        "state": sighting["state"],
        "descriptionStatus": sighting["descriptionStatus"],
        "sentence": sighting["sentence"],
        "room": room["name"] if room else None,
        "lastSeenAt": sighting["lastSeenAt"],
        "expiresAt": sighting["expiresAt"],
        "thumbKey": sighting["thumbKey"],
        "source": sighting["source"],
    }


def _snapshot_update(fields: Mapping[str, Any]) -> list[Document]:
    """Merges `fields` into lastSighting, then copies it to lastRestingSighting if it's resting.

    Every value goes in through $literal. In a pipeline a string that starts
    with "$" is a field path, so a sentence like "next to the $5 bill" would
    otherwise be read as one.
    """
    literals = {field: {"$literal": value} for field, value in fields.items()}
    return [
        {"$set": {"lastSighting": {"$mergeObjects": ["$lastSighting", literals]}}},
        {
            "$set": {
                "lastRestingSighting": {
                    "$cond": [
                        {"$eq": ["$lastSighting.state", "resting"]},
                        "$lastSighting",
                        "$lastRestingSighting",
                    ]
                }
            }
        },
    ]


# closedAt is the sighting's own lastSeenAt, so a sweep that runs late doesn't
# stretch the time the item was in view.
_CLOSE: list[Document] = [{"$set": {"status": "closed", "closedAt": "$lastSeenAt"}}]

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class DescriptionResult(BaseModel):
    """What the vision model returns for a keyframe. README "Description job"."""

    model_config = ConfigDict(str_strip_whitespace=True, frozen=True)

    room: str | None = Field(default=None, max_length=60)
    surface: str | None = Field(default=None, max_length=60)
    relation: str | None = Field(default=None, max_length=120)
    state: ObservationState
    sentence: str = Field(min_length=1, max_length=300)
    nearbyObjects: list[ShortText] = Field(default_factory=list, max_length=20)

    @field_validator("room", mode="before")
    @classmethod
    def _unknown_room(cls, value: object) -> object:
        # The model says "unknown" rather than guess. That's stored as no room at all.
        return None if isinstance(value, str) and value.strip().lower() == "unknown" else value

    @field_validator("room", "surface", "relation")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("nearbyObjects", mode="before")
    @classmethod
    def _cap_nearby(cls, value: object) -> object:
        # A cluttered shelf shouldn't fail the whole description.
        return value[:20] if isinstance(value, list) else value


@dataclass(frozen=True, slots=True)
class ItemPrompts:
    item_id: ObjectId
    name: str
    prompts: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class OpenedSighting:
    sighting_id: ObjectId
    # False when the eventId was a replay and the sighting already existed.
    created: bool
    # True when this call made the sighting the item's latest snapshot.
    installed: bool
    # The item version this sighting is the snapshot for, or 0 if it never was.
    observation_version: int


@dataclass(frozen=True, slots=True)
class DescriptionJob:
    id: ObjectId
    patient_id: ObjectId
    item_id: ObjectId
    sighting_id: ObjectId
    observation_version: int
    keyframe_revision: int
    keyframe_key: str
    bbox: BBox
    status: str
    attempts: int
    max_attempts: int
    run_after: datetime
    lease_owner: str | None
    last_error: str | None

    @classmethod
    def from_doc(cls, doc: Mapping[str, Any]) -> DescriptionJob:
        x, y, w, h = doc["bbox"]
        return cls(
            id=doc["_id"],
            patient_id=doc["patientId"],
            item_id=doc["itemId"],
            sighting_id=doc["sightingId"],
            observation_version=doc["observationVersion"],
            keyframe_revision=doc["keyframeRevision"],
            keyframe_key=doc["keyframeKey"],
            bbox=(x, y, w, h),
            status=doc["status"],
            attempts=doc["attempts"],
            max_attempts=doc["maxAttempts"],
            run_after=doc["runAfter"],
            lease_owner=doc["leaseOwner"],
            last_error=doc["lastError"],
        )


def _place_key(sighting: Mapping[str, Any]) -> str | None:
    """What makes two sightings "the same place". Mirrors placeKey() in packages/db/src/usual-spots.ts."""

    def norm(value: Any) -> str:
        return " ".join(str(value or "").split()).lower()

    room = norm((sighting.get("room") or {}).get("name"))
    surface = norm(sighting.get("surface"))
    relation = norm(sighting.get("relation"))
    if room or surface or relation:
        return f"{room}|{surface}|{relation}"
    return norm(sighting.get("sentence")) or None


def compute_usual_spots(
    sightings: list[Document],
    *,
    min_samples: int = 3,
    min_share: float = 0.2,
    merge_gap: timedelta = timedelta(minutes=5),
    maximum: int = 5,
) -> list[Document]:
    """Where the item keeps ending up, counted in placements not sightings.

    Mirrors computeUsualSpots() in packages/db/src/usual-spots.ts: a fragmented
    track merges into one placement, and history sparser than min_samples says
    nothing.
    """
    usable = [
        s
        for s in sightings
        if s.get("descriptionStatus") == "ready"
        and s.get("state") == "resting"
        and (s.get("sentence") or "").strip()
    ]
    usable.sort(key=lambda s: s["firstSeenAt"])

    placements: list[Document] = []
    for sighting in usable:
        key = _place_key(sighting)
        if key is None:
            continue
        prev = placements[-1] if placements else None
        if prev and prev["key"] == key and sighting["firstSeenAt"] - prev["lastSeenAt"] < merge_gap:
            if sighting["lastSeenAt"] > prev["lastSeenAt"]:
                prev["lastSeenAt"] = sighting["lastSeenAt"]
                prev["sentence"] = sighting["sentence"]
        else:
            placements.append(
                {"key": key, "lastSeenAt": sighting["lastSeenAt"], "sentence": sighting["sentence"]}
            )

    total = len(placements)
    if total < min_samples:
        return []

    groups: dict[str, Document] = {}
    for placement in placements:
        group = groups.setdefault(
            placement["key"],
            {"samples": 0, "sentence": placement["sentence"], "lastSeenAt": placement["lastSeenAt"]},
        )
        group["samples"] += 1
        if placement["lastSeenAt"] >= group["lastSeenAt"]:
            group["lastSeenAt"] = placement["lastSeenAt"]
            group["sentence"] = placement["sentence"]

    spots = [
        {
            "sentence": group["sentence"],
            "share": group["samples"] / total,
            "samples": group["samples"],
            "source": "history",
        }
        for group in groups.values()
        if group["samples"] / total >= min_share
    ]
    spots.sort(key=lambda s: (-s["share"], -s["samples"], s["sentence"]))
    return spots[:maximum]


_USUAL_SPOT_SAMPLE = {
    "sentence": 1,
    "surface": 1,
    "relation": 1,
    "room": 1,
    "firstSeenAt": 1,
    "lastSeenAt": 1,
    "descriptionStatus": 1,
    "state": 1,
}


CompleteOutcome = Literal["applied", "history_only", "superseded", "lost_lease"]
FailOutcome = Literal["retry", "failed", "lost_lease"]


class ObservationStore:
    def __init__(
        self,
        db: AsyncDatabase[Document],
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not db.codec_options.tz_aware:
            # Stored dates would come back naive and fail every comparison with an aware one.
            raise ValueError("ObservationStore needs a client opened with tz_aware=True")
        self._db = db
        self._clock = clock
        self._patients = db["patients"]
        self._devices = db["devices"]
        self._items = db["items"]
        self._sightings = db["sightings"]
        self._sessions = db["capture_sessions"]
        self._jobs = db["description_jobs"]
        self._retention: dict[ObjectId, tuple[float, int]] = {}

    def _now(self) -> datetime:
        return to_ms(self._clock())

    async def retention_days(self, patient_id: ObjectId) -> int:
        """The wearer's settings.retentionDays, cached briefly so a sighting burst costs one read."""
        cached = self._retention.get(patient_id)
        if cached is not None and cached[0] > time.monotonic():
            return cached[1]
        patient = await self._patients.find_one({"_id": patient_id}, {"settings.retentionDays": 1})
        if patient is None:
            raise UnknownPatientError(f"No wearer {patient_id}")
        days = int(patient["settings"]["retentionDays"])
        self._retention[patient_id] = (time.monotonic() + RETENTION_CACHE_SECONDS, days)
        return days

    async def _expires_at(self, patient_id: ObjectId, start: datetime) -> datetime:
        return start + timedelta(days=await self.retention_days(patient_id))

    async def device_source(
        self, patient_id: ObjectId, device_id: ObjectId, token_version: int
    ) -> CaptureSource | None:
        """The device's kind. None if it isn't the wearer's, was revoked, or the token predates a revoke."""
        device = await self._devices.find_one(
            {"_id": device_id, "patientId": patient_id, "tokenVersion": token_version, "revokedAt": None},
            {"kind": 1},
        )
        return device["kind"] if device else None

    async def ping(self) -> None:
        await self._db.command("ping")

    async def active_items(self, patient_id: ObjectId) -> list[ItemPrompts]:
        """The wearer's active items with their detector prompts, the detector's class list."""
        cursor = self._items.find(
            {"patientId": patient_id, "active": True}, {"name": 1, "detectorPrompts": 1}
        )
        return [
            ItemPrompts(doc["_id"], doc["name"], tuple(doc.get("detectorPrompts") or [doc["name"]]))
            async for doc in cursor
        ]

    async def item_name(self, patient_id: ObjectId, item_id: ObjectId) -> str | None:
        item = await self._items.find_one({"_id": item_id, "patientId": patient_id}, {"name": 1})
        return item["name"] if item else None

    async def queue_depth(self) -> int:
        """Queued description jobs across every wearer, for /health."""
        return await self._jobs.count_documents({"status": "queued"})

    # Capture sessions

    async def open_capture_session(
        self, patient_id: ObjectId, device_id: ObjectId | None, source: CaptureSource
    ) -> ObjectId:
        now = self._now()
        session_id = ObjectId()
        await self._sessions.insert_one(
            {
                "_id": session_id,
                "patientId": patient_id,
                "deviceId": device_id,
                "source": source,
                # Capture starts paused and the wearer resumes it. README "Privacy and safety".
                "state": "paused",
                "startedAt": now,
                "updatedAt": now,
                "endedAt": None,
                "lastFrameAt": None,
                "lastSeq": 0,
                "framesReceived": 0,
                "framesDropped": 0,
                "expiresAt": await self._expires_at(patient_id, now),
            }
        )
        return session_id

    async def set_capture_state(
        self, patient_id: ObjectId, session_id: ObjectId, state: CaptureState
    ) -> bool:
        """Switches live, paused or ended. False if the session is unknown or already ended."""
        now = self._now()
        changes: Document = {"state": state, "updatedAt": now}
        if state == "ended":
            changes["endedAt"] = now
        result = await self._sessions.update_one(
            {"_id": session_id, "patientId": patient_id, "state": {"$ne": "ended"}}, {"$set": changes}
        )
        if state != "live":
            # Pause stops description work that hasn't started yet. It can't recall work already sent out.
            await self.cancel_queued_jobs(patient_id, now)
        return result.matched_count == 1

    async def record_frame(
        self, patient_id: ObjectId, session_id: ObjectId, seq: int, received_at: datetime, dropped: bool
    ) -> None:
        await self._sessions.update_one(
            {"_id": session_id, "patientId": patient_id},
            {
                "$inc": {"framesDropped" if dropped else "framesReceived": 1},
                "$max": {"lastSeq": seq, "lastFrameAt": to_ms(received_at)},
                "$set": {"updatedAt": self._now()},
            },
        )

    # Sightings and the item snapshot

    async def open_sighting(
        self,
        *,
        patient_id: ObjectId,
        item_id: ObjectId,
        label: str,
        session_id: ObjectId,
        device_id: ObjectId | None,
        source: CaptureSource,
        event_id: str,
        first_seen_at: datetime,
        observed_at: datetime,
        first_seq: int,
        seq: int,
        bbox: BBox,
        frame_size: tuple[int, int],
        confidence: float,
        state: ObservationState = "unknown",
    ) -> OpenedSighting:
        """Records a newly confirmed sighting and makes it the item's snapshot if it's the newest evidence.

        Idempotent on event_id. A replay changes nothing, except that it
        finishes an install a crash interrupted.
        """
        now = self._now()
        key = {"patientId": patient_id, "eventId": event_id}
        fresh_id = ObjectId()
        document: Document = {
            "_id": fresh_id,
            "itemId": item_id,
            "label": label,
            "status": "open",
            "sessionId": session_id,
            "deviceId": device_id,
            "source": source,
            "firstSeenAt": to_ms(first_seen_at),
            "lastSeenAt": to_ms(observed_at),
            "closedAt": None,
            "expiresAt": await self._expires_at(patient_id, now),
            "firstSeq": first_seq,
            "lastSeq": seq,
            "observationVersion": 0,
            "keyframeRevision": 0,
            "keyframeKey": None,
            "thumbKey": None,
            "confidence": confidence,
            "bbox": list(bbox),
            "frameSize": list(frame_size),
            "state": state,
            "descriptionStatus": "pending",
            "room": None,
            "surface": None,
            "relation": None,
            "sentence": None,
            "nearbyObjects": [],
        }
        try:
            # $setOnInsert and nothing else, so a replay matches the first sighting and leaves it alone.
            sighting = await self._sightings.find_one_and_update(
                key, {"$setOnInsert": document}, upsert=True, return_document=ReturnDocument.AFTER
            )
        except DuplicateKeyError:
            # Two upserts of one event raced on the unique index and this one lost.
            sighting = await self._sightings.find_one(key)
        if sighting is None:
            raise RuntimeError(f"Sighting for event {event_id!r} vanished right after its upsert")
        installed, version = await self._install_snapshot(patient_id, sighting)
        return OpenedSighting(sighting["_id"], sighting["_id"] == fresh_id, installed, version)

    async def _install_snapshot(self, patient_id: ObjectId, sighting: Mapping[str, Any]) -> tuple[bool, int]:
        item_id = sighting["itemId"]
        for _ in range(SNAPSHOT_RETRIES):
            item = await self._items.find_one(
                {"_id": item_id, "patientId": patient_id, "active": True},
                {"observationVersion": 1, "lastSighting": 1},
            )
            if item is None:
                # Unknown or archived item. The sighting stays as history.
                return False, sighting["observationVersion"]
            current = item["lastSighting"]
            if current is not None and current["sightingId"] == sighting["_id"]:
                # Already the snapshot: a replay. Repeat the $max in case a crash skipped it.
                await self._mark_installed(patient_id, sighting["_id"], current["observationVersion"])
                return False, current["observationVersion"]
            if current is not None and current["lastSeenAt"] >= sighting["lastSeenAt"]:
                # The item already shows newer evidence. This one arrived late.
                return False, sighting["observationVersion"]

            seen_version = item["observationVersion"]
            version = seen_version + 1
            snapshot = snapshot_of({**sighting, "observationVersion": version})
            # Not updatedAt: that marks caregiver edits, and the web side guards
            # item saves on it. A new sighting must not turn a save into a conflict.
            changes: Document = {"observationVersion": version, "lastSighting": snapshot}
            if sighting["state"] == "resting":
                changes["lastRestingSighting"] = snapshot
            result = await self._items.update_one(
                {"_id": item_id, "patientId": patient_id, "active": True, "observationVersion": seen_version},
                {"$set": changes},
            )
            if result.matched_count == 1:
                await self._mark_installed(patient_id, sighting["_id"], version)
                return True, version
            # Another sighting of this item won the race. Re-read and compare again.
        raise SnapshotContentionError(
            f"Item {item_id} kept changing while installing sighting {sighting['_id']}"
        )

    async def _mark_installed(self, patient_id: ObjectId, sighting_id: ObjectId, version: int) -> None:
        await self._sightings.update_one(
            {"_id": sighting_id, "patientId": patient_id}, {"$max": {"observationVersion": version}}
        )

    async def refresh_sighting(
        self,
        patient_id: ObjectId,
        sighting_id: ObjectId,
        item_id: ObjectId,
        seen_at: datetime,
        seq: int,
        bbox: BBox,
        confidence: float,
    ) -> bool:
        """Extends an open sighting while the item stays in view. False if the frame is stale or it closed."""
        seen_at = to_ms(seen_at)
        result = await self._sightings.update_one(
            # The lastSeq guard drops frames that arrive out of order.
            {
                "_id": sighting_id,
                "patientId": patient_id,
                "itemId": item_id,
                "status": "open",
                "lastSeq": {"$lt": seq},
            },
            {
                "$set": {"bbox": list(bbox), "confidence": confidence, "lastSeq": seq},
                "$max": {"lastSeenAt": seen_at},
            },
        )
        if result.matched_count == 0:
            return False
        # A later time doesn't change what the snapshot says, so observationVersion stays put.
        for field in ("lastSighting", "lastRestingSighting"):
            await self._items.update_one(
                {"_id": item_id, "patientId": patient_id, f"{field}.sightingId": sighting_id},
                {"$max": {f"{field}.lastSeenAt": seen_at}},
            )
        return True

    async def close_sighting(self, patient_id: ObjectId, sighting_id: ObjectId) -> bool:
        sighting = await self._sightings.find_one(
            {"_id": sighting_id, "patientId": patient_id, "status": "open"}, {"itemId": 1}
        )
        if sighting is None:
            return False
        result = await self._sightings.update_one(
            {"_id": sighting_id, "patientId": patient_id, "status": "open"}, _CLOSE
        )
        if result.modified_count != 1:
            return False
        await self.recompute_usual_spots(patient_id, sighting["itemId"])
        return True

    async def close_idle_sightings(self, now: datetime, idle: timedelta = DEFAULT_IDLE) -> int:
        """Closes sightings with no usable frame for `idle`, across every wearer.

        A system sweep, so no patientId. Filtering on status "open" lets it use
        the open_by_last_seen partial index.
        """
        idle_filter: Document = {"status": "open", "lastSeenAt": {"$lte": to_ms(now) - idle}}
        closing = await self._sightings.find(idle_filter, {"patientId": 1, "itemId": 1}).to_list()
        result = await self._sightings.update_many(idle_filter, _CLOSE)
        for patient_id, item_id in {(doc["patientId"], doc["itemId"]) for doc in closing}:
            await self.recompute_usual_spots(patient_id, item_id)
        return result.modified_count

    async def recompute_usual_spots(self, patient_id: ObjectId, item_id: ObjectId) -> list[Document]:
        """Recomputes the item's history-derived usualSpots.

        Same query and rules as items.recomputeUsualSpots() in
        packages/db/src/repos/items.ts: closed, described, resting sightings
        inside retention, newest first. Like a snapshot write, it leaves the
        item's updatedAt alone.
        """
        sightings = await self._sightings.find(
            {
                "patientId": patient_id,
                "itemId": item_id,
                "status": "closed",
                "state": "resting",
                "descriptionStatus": "ready",
                "expiresAt": {"$gt": self._now()},
            },
            _USUAL_SPOT_SAMPLE,
        ).sort("lastSeenAt", -1).limit(200).to_list()
        spots = compute_usual_spots(sightings)
        await self._items.update_one(
            {"_id": item_id, "patientId": patient_id}, {"$set": {"usualSpots": spots}}
        )
        return spots

    # The description queue

    async def enqueue_description(
        self,
        patient_id: ObjectId,
        item_id: ObjectId,
        sighting_id: ObjectId,
        observation_version: int,
        keyframe_key: str,
        bbox: BBox,
        now: datetime,
    ) -> DescriptionJob | None:
        """Queues a keyframe for the vision model. None if the wearer's queue is full or the sighting is gone.

        The new keyframe supersedes this sighting's older queued ones, so those
        don't count against the bound: coalescing never grows the queue.
        """
        now = to_ms(now)
        waiting = await self._jobs.count_documents(
            {"patientId": patient_id, "status": "queued", "sightingId": {"$ne": sighting_id}}
        )
        if waiting >= MAX_QUEUED_JOBS_PER_WEARER:
            # A cluttered room can't run up the vision bill or back answers up for minutes.
            return None
        sighting = await self._sightings.find_one_and_update(
            {"_id": sighting_id, "patientId": patient_id, "itemId": item_id},
            {"$inc": {"keyframeRevision": 1}, "$set": {"keyframeKey": keyframe_key}},
            projection={"keyframeRevision": 1, "expiresAt": 1},
            return_document=ReturnDocument.AFTER,
        )
        if sighting is None:
            return None
        revision: int = sighting["keyframeRevision"]
        # $max, so a slow enqueue of an older keyframe can't wind a snapshot back.
        for field in ("lastSighting", "lastRestingSighting"):
            await self._items.update_one(
                {"_id": item_id, "patientId": patient_id, f"{field}.sightingId": sighting_id},
                {"$max": {f"{field}.keyframeRevision": revision}},
            )
        await self._jobs.update_many(
            {
                "patientId": patient_id,
                "sightingId": sighting_id,
                "status": "queued",
                "keyframeRevision": {"$lt": revision},
            },
            {"$set": {"status": "superseded", "finishedAt": now, "updatedAt": now}},
        )
        job: Document = {
            "_id": ObjectId(),
            "patientId": patient_id,
            "itemId": item_id,
            "sightingId": sighting_id,
            "observationVersion": observation_version,
            "keyframeRevision": revision,
            "keyframeKey": keyframe_key,
            "bbox": list(bbox),
            "status": "queued",
            "attempts": 0,
            "maxAttempts": MAX_JOB_ATTEMPTS,
            "runAfter": now,
            "leaseOwner": None,
            "lastError": None,
            "createdAt": now,
            "updatedAt": now,
            "finishedAt": None,
            # Exactly as long as its sighting. The retention sweep deletes the two
            # together and reads keyframeKey to remove superseded keyframes from storage.
            "expiresAt": sighting["expiresAt"],
        }
        try:
            await self._jobs.insert_one(job)
        except DuplicateKeyError:
            existing = await self._jobs.find_one(
                {"patientId": patient_id, "sightingId": sighting_id, "keyframeRevision": revision}
            )
            return DescriptionJob.from_doc(existing) if existing else None
        return DescriptionJob.from_doc(job)

    async def claim_job(
        self, worker_id: str, now: datetime, lease: timedelta = DEFAULT_LEASE
    ) -> DescriptionJob | None:
        """Takes the oldest due job across every wearer, including a running one whose lease ran out.

        On a running job, runAfter is when the lease runs out. That's why one
        index, {status, runAfter}, serves both kinds of claim.
        """
        now = to_ms(now)
        doc = await self._jobs.find_one_and_update(
            {
                "status": {"$in": ["queued", "running"]},
                "runAfter": {"$lte": now},
                "$expr": {"$lt": ["$attempts", "$maxAttempts"]},
            },
            {
                "$set": {
                    "status": "running",
                    "leaseOwner": worker_id,
                    "runAfter": now + lease,
                    "updatedAt": now,
                },
                "$inc": {"attempts": 1},
            },
            sort=[("runAfter", 1)],
            return_document=ReturnDocument.AFTER,
        )
        return DescriptionJob.from_doc(doc) if doc else None

    async def fail_exhausted_leases(self, now: datetime) -> int:
        """Fails running jobs whose final attempt let its lease run out, as fail_job would have."""
        now = to_ms(now)
        failed = 0
        while True:
            doc = await self._jobs.find_one_and_update(
                {
                    "status": "running",
                    "runAfter": {"$lte": now},
                    "$expr": {"$gte": ["$attempts", "$maxAttempts"]},
                },
                {
                    "$set": {
                        "status": "failed",
                        "finishedAt": now,
                        "updatedAt": now,
                        "lastError": "Lease ran out on the last attempt",
                    }
                },
                return_document=ReturnDocument.AFTER,
            )
            if doc is None:
                return failed
            await self._mark_description_failed(DescriptionJob.from_doc(doc))
            failed += 1

    async def complete_job(
        self, job: DescriptionJob, worker_id: str, result: DescriptionResult, now: datetime
    ) -> CompleteOutcome:
        """Applies a description to its sighting, then to the item if it still shows that sighting.

        The job is marked done last, on purpose. A crash in between re-runs the
        job, and the guarded writes make the second run harmless.
        """
        now = to_ms(now)
        changes: Document = {
            "descriptionStatus": "ready",
            "sentence": result.sentence,
            "surface": result.surface,
            "relation": result.relation,
            "nearbyObjects": list(result.nearbyObjects),
            "room": {"id": None, "name": result.room, "confidence": None} if result.room else None,
        }
        snapshot: Document = {"descriptionStatus": "ready", "sentence": result.sentence, "room": result.room}
        if result.state != "unknown":
            # "unknown" means the still image couldn't tell, so the tracker's state stands.
            changes["state"] = result.state
            snapshot["state"] = result.state

        described = await self._sightings.update_one(
            {"_id": job.sighting_id, "patientId": job.patient_id, "keyframeRevision": job.keyframe_revision},
            {"$set": changes},
        )
        if described.matched_count == 0:
            # A newer keyframe replaced this one, and old text must not attach to the new frame.
            return "superseded" if await self._finish(job, worker_id, "superseded", now) else "lost_lease"

        item = await self._items.update_one(self._snapshot_guard(job), _snapshot_update(snapshot))
        if item.matched_count == 0 and snapshot.get("state", "resting") == "resting":
            # The item moved on, but its last resting spot can still be this
            # keyframe, waiting on this very description. Fill that copy in.
            await self._items.update_one(
                {
                    "_id": job.item_id,
                    "patientId": job.patient_id,
                    "lastRestingSighting.sightingId": job.sighting_id,
                    "lastRestingSighting.keyframeRevision": job.keyframe_revision,
                },
                {"$set": {f"lastRestingSighting.{field}": value for field, value in snapshot.items()}},
            )
        if not await self._finish(job, worker_id, "succeeded", now):
            return "lost_lease"
        # A fresh description may have made a spot "usual" (or stopped being it).
        await self.recompute_usual_spots(job.patient_id, job.item_id)
        # No match means the item has newer evidence, so the description only enriches history.
        return "applied" if item.matched_count == 1 else "history_only"

    async def fail_job(self, job: DescriptionJob, worker_id: str, error: str, now: datetime) -> FailOutcome:
        """Queues a retry with exponential backoff, or fails the job for good on its last attempt."""
        now = to_ms(now)
        error = error[:1000]
        if job.attempts < job.max_attempts:
            retry_at = now + timedelta(seconds=min(2**job.attempts, MAX_BACKOFF_SECONDS))
            retried = await self._jobs.update_one(
                self._lease_fence(job, worker_id),
                {
                    "$set": {
                        "status": "queued",
                        "runAfter": retry_at,
                        "leaseOwner": None,
                        "lastError": error,
                        "updatedAt": now,
                    }
                },
            )
            return "retry" if retried.matched_count == 1 else "lost_lease"
        failed = await self._jobs.update_one(
            self._lease_fence(job, worker_id),
            {"$set": {"status": "failed", "finishedAt": now, "lastError": error, "updatedAt": now}},
        )
        if failed.matched_count == 0:
            return "lost_lease"
        await self._mark_description_failed(job)
        return "failed"

    async def cancel_queued_jobs(self, patient_id: ObjectId, now: datetime) -> int:
        """Pause and disconnect call this. Running jobs finish, since their keyframe already left."""
        now = to_ms(now)
        result = await self._jobs.update_many(
            {"patientId": patient_id, "status": "queued"},
            {"$set": {"status": "cancelled", "finishedAt": now, "updatedAt": now}},
        )
        return result.modified_count

    async def _finish(
        self, job: DescriptionJob, worker_id: str, status: Literal["succeeded", "superseded"], now: datetime
    ) -> bool:
        result = await self._jobs.update_one(
            self._lease_fence(job, worker_id),
            {"$set": {"status": status, "finishedAt": now, "updatedAt": now}},
        )
        return result.matched_count == 1

    async def _mark_description_failed(self, job: DescriptionJob) -> None:
        # Guarded like a description, and never over one that already worked:
        # a failed retake of a sighting leaves its earlier sentence standing.
        await self._sightings.update_one(
            {
                "_id": job.sighting_id,
                "patientId": job.patient_id,
                "keyframeRevision": job.keyframe_revision,
                "descriptionStatus": {"$ne": "ready"},
            },
            {"$set": {"descriptionStatus": "failed"}},
        )
        await self._items.update_one(
            {**self._snapshot_guard(job), "lastSighting.descriptionStatus": {"$ne": "ready"}},
            _snapshot_update({"descriptionStatus": "failed"}),
        )

    @staticmethod
    def _lease_fence(job: DescriptionJob, worker_id: str) -> Document:
        # A worker whose lease ran out and was reclaimed holds a stale attempts
        # count, so it can't finish the attempt another worker now owns.
        return {
            "_id": job.id,
            "patientId": job.patient_id,
            "status": "running",
            "leaseOwner": worker_id,
            "attempts": job.attempts,
        }

    @staticmethod
    def _snapshot_guard(job: DescriptionJob) -> Document:
        # The item still shows exactly the evidence the job describes.
        return {
            "_id": job.item_id,
            "patientId": job.patient_id,
            "observationVersion": job.observation_version,
            "lastSighting.sightingId": job.sighting_id,
            "lastSighting.keyframeRevision": job.keyframe_revision,
        }
