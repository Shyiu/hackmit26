"""The write path against a real MongoDB with the generated validators switched on.

Every write in these tests passes the collection validators, because the
fixture creates them with validationAction "error" and any failure would raise.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from conftest import Database, Seed
from pymongo.errors import WriteError

from app.store import (
    DescriptionJob,
    DescriptionResult,
    ObservationState,
    ObservationStore,
    OpenedSighting,
    snapshot_of,
    to_ms,
)

T0 = datetime.now(UTC).replace(microsecond=0)
BBOX = (0.4, 0.5, 0.1, 0.1)
RESULT = DescriptionResult(
    room="kitchen",
    surface="counter",
    relation="next to the coffee maker",
    state="resting",
    sentence="on the kitchen counter, next to the coffee maker",
    nearbyObjects=["coffee maker", "mug"],
)


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


@dataclass
class Scene:
    """One wearer with one item and a capture session, plus shortcuts for the common writes."""

    db: Database
    store: ObservationStore
    patient_id: ObjectId
    item_id: ObjectId
    session_id: ObjectId

    async def sight(
        self, event_id: str, seconds: float, *, state: ObservationState = "unknown", seq: int = 1
    ) -> OpenedSighting:
        observed_at = at(seconds)
        return await self.store.open_sighting(
            patient_id=self.patient_id,
            item_id=self.item_id,
            label="keys",
            session_id=self.session_id,
            device_id=None,
            source="simulator",
            event_id=event_id,
            first_seen_at=observed_at - timedelta(seconds=1),
            observed_at=observed_at,
            first_seq=max(seq - 2, 0),
            seq=seq,
            bbox=BBOX,
            frame_size=(1280, 720),
            confidence=0.8,
            state=state,
        )

    async def enqueue(
        self, opened: OpenedSighting, key: str = "kf/1.jpg", seconds: float = 0
    ) -> DescriptionJob:
        job = await self.store.enqueue_description(
            self.patient_id,
            self.item_id,
            opened.sighting_id,
            opened.observation_version,
            key,
            BBOX,
            at(seconds),
        )
        assert job is not None
        return job

    async def item(self) -> dict[str, Any]:
        doc = await self.db["items"].find_one({"_id": self.item_id})
        assert doc is not None
        return doc

    async def sighting(self, sighting_id: ObjectId) -> dict[str, Any]:
        doc = await self.db["sightings"].find_one({"_id": sighting_id})
        assert doc is not None
        return doc

    async def job(self, job_id: ObjectId) -> dict[str, Any]:
        doc = await self.db["description_jobs"].find_one({"_id": job_id})
        assert doc is not None
        return doc


SceneFactory = Callable[[], Awaitable[Scene]]


@pytest.fixture
async def make_scene(db: Database, seed: Seed) -> SceneFactory:
    # The claim and the sweeps serve every wearer, so each test starts without
    # anyone else's jobs or open sightings in the shared module database.
    await db["description_jobs"].delete_many({})
    await db["sightings"].delete_many({})
    store = ObservationStore(db, clock=lambda: T0)

    async def make() -> Scene:
        patient_id = await seed.patient()
        item_id = await seed.item(patient_id)
        session_id = await store.open_capture_session(patient_id, None, "simulator")
        return Scene(db, store, patient_id, item_id, session_id)

    return make


@pytest.fixture
async def scene(make_scene: SceneFactory) -> Scene:
    return await make_scene()


async def test_validators_are_enforced(db: Database) -> None:
    # The guarantee every other test leans on: a write the schema rejects raises.
    with pytest.raises(WriteError) as caught:
        await db["sightings"].insert_one({"_id": ObjectId(), "status": "open"})
    assert caught.value.code == 121


async def test_capture_session_counts_frames_and_ends(scene: Scene) -> None:
    store, patient, session_id = scene.store, scene.patient_id, scene.session_id
    session = await scene.db["capture_sessions"].find_one({"_id": session_id})
    assert session is not None
    assert (session["state"], session["framesReceived"], session["lastSeq"]) == ("paused", 0, 0)
    assert session["expiresAt"] == T0 + timedelta(days=30)

    assert await store.set_capture_state(patient, session_id, "live")
    await store.record_frame(patient, session_id, 5, at(1), dropped=False)
    await store.record_frame(patient, session_id, 7, at(2), dropped=True)
    await store.record_frame(patient, session_id, 6, at(1.5), dropped=False)
    session = await scene.db["capture_sessions"].find_one({"_id": session_id})
    assert session is not None
    assert (session["framesReceived"], session["framesDropped"]) == (2, 1)
    # A late write can't move the high-water marks back.
    assert (session["lastSeq"], session["lastFrameAt"]) == (7, at(2))

    assert await store.set_capture_state(patient, session_id, "ended")
    assert not await store.set_capture_state(patient, session_id, "live")
    session = await scene.db["capture_sessions"].find_one({"_id": session_id})
    assert session is not None
    assert (session["state"], session["endedAt"]) == ("ended", T0)


async def test_opening_installs_the_snapshot_and_bumps_the_version(scene: Scene) -> None:
    opened = await scene.sight("e1", 1)
    assert (opened.created, opened.installed, opened.observation_version) == (True, True, 1)

    sighting = await scene.sighting(opened.sighting_id)
    item = await scene.item()
    assert item["observationVersion"] == 1
    assert sighting["observationVersion"] == 1
    assert item["lastSighting"] == snapshot_of(sighting)
    assert item["lastSighting"]["lastSeenAt"] == at(1)
    assert sighting["expiresAt"] == T0 + timedelta(days=30)
    # An unknown state isn't a resting place.
    assert item["lastRestingSighting"] is None


async def test_replaying_an_event_changes_nothing(scene: Scene) -> None:
    first = await scene.sight("e1", 1)
    item_before = await scene.item()
    sighting_before = await scene.sighting(first.sighting_id)

    replay = await scene.sight("e1", 5, state="resting", seq=9)
    assert replay == OpenedSighting(first.sighting_id, created=False, installed=False, observation_version=1)
    assert await scene.item() == item_before
    assert await scene.sighting(first.sighting_id) == sighting_before
    assert await scene.db["sightings"].count_documents({"patientId": scene.patient_id, "eventId": "e1"}) == 1


async def test_a_replay_finishes_an_install_a_crash_interrupted(scene: Scene) -> None:
    opened = await scene.sight("e1", 1)
    # Put things back as if the process died between the sighting upsert and the item write.
    await scene.db["items"].update_one(
        {"_id": scene.item_id}, {"$set": {"observationVersion": 0, "lastSighting": None}}
    )
    await scene.db["sightings"].update_one({"_id": opened.sighting_id}, {"$set": {"observationVersion": 0}})

    replay = await scene.sight("e1", 1)
    assert (replay.created, replay.installed, replay.observation_version) == (False, True, 1)
    item = await scene.item()
    assert item["lastSighting"] == snapshot_of(await scene.sighting(opened.sighting_id))


async def test_an_older_sighting_does_not_replace_a_newer_one(scene: Scene) -> None:
    newer = await scene.sight("e-new", 10)
    older = await scene.sight("e-old", 5)
    assert (older.created, older.installed, older.observation_version) == (True, False, 0)

    item = await scene.item()
    assert item["observationVersion"] == 1
    assert item["lastSighting"]["sightingId"] == newer.sighting_id
    assert (await scene.sighting(older.sighting_id))["observationVersion"] == 0


async def test_an_archived_item_keeps_the_sighting_as_history(scene: Scene) -> None:
    await scene.db["items"].update_one({"_id": scene.item_id}, {"$set": {"active": False}})
    opened = await scene.sight("e1", 1)
    assert (opened.created, opened.installed) == (True, False)
    assert (await scene.item())["lastSighting"] is None


async def test_refresh_extends_last_seen_and_ignores_out_of_order_frames(scene: Scene) -> None:
    store = scene.store
    opened = await scene.sight("e1", 0, state="resting", seq=3)
    moved = (0.41, 0.5, 0.1, 0.1)
    assert await store.refresh_sighting(
        scene.patient_id, opened.sighting_id, scene.item_id, at(1), 5, moved, 0.9
    )

    sighting = await scene.sighting(opened.sighting_id)
    assert (sighting["lastSeenAt"], sighting["lastSeq"], sighting["bbox"], sighting["confidence"]) == (
        at(1),
        5,
        list(moved),
        0.9,
    )
    item = await scene.item()
    assert item["lastSighting"]["lastSeenAt"] == at(1)
    assert item["lastRestingSighting"]["lastSeenAt"] == at(1)
    assert item["observationVersion"] == 1

    # Frame 4 finished processing after frame 5. It must not move anything.
    stale = (0.9, 0.9, 0.05, 0.05)
    assert not await store.refresh_sighting(
        scene.patient_id, opened.sighting_id, scene.item_id, at(2), 4, stale, 0.1
    )
    assert await scene.sighting(opened.sighting_id) == sighting
    assert await scene.item() == item


async def test_refresh_leaves_a_snapshot_of_another_sighting_alone(scene: Scene) -> None:
    first = await scene.sight("e-first", 0, seq=1)
    await scene.sight("e-second", 5, seq=2)
    item_before = await scene.item()

    assert await scene.store.refresh_sighting(
        scene.patient_id, first.sighting_id, scene.item_id, at(6), 3, BBOX, 0.8
    )
    assert (await scene.sighting(first.sighting_id))["lastSeenAt"] == at(6)
    assert await scene.item() == item_before


async def test_idle_sightings_close_at_their_own_last_seen_time(scene: Scene) -> None:
    store = scene.store
    stale = await scene.sight("e-stale", 0, seq=1)
    fresh = await scene.sight("e-fresh", 5, seq=2)

    assert await store.close_idle_sightings(at(4)) == 1
    closed = await scene.sighting(stale.sighting_id)
    assert (closed["status"], closed["closedAt"]) == ("closed", at(0))
    assert (await scene.sighting(fresh.sighting_id))["status"] == "open"
    # A closed sighting stays closed.
    assert not await store.refresh_sighting(
        scene.patient_id, stale.sighting_id, scene.item_id, at(6), 9, BBOX, 0.8
    )

    assert await store.close_sighting(scene.patient_id, fresh.sighting_id)
    assert not await store.close_sighting(scene.patient_id, fresh.sighting_id)
    closed = await scene.sighting(fresh.sighting_id)
    assert (closed["status"], closed["closedAt"]) == ("closed", at(5))


async def test_the_idle_sweep_uses_the_open_sightings_index(db: Database) -> None:
    explained = await db.command(
        "explain",
        {"find": "sightings", "filter": {"status": "open", "lastSeenAt": {"$lte": T0}}},
        verbosity="queryPlanner",
    )
    assert "open_by_last_seen" in json.dumps(explained["queryPlanner"]["winningPlan"], default=str)


async def test_another_wearer_cannot_touch_the_sighting(scene: Scene, make_scene: SceneFactory) -> None:
    opened = await scene.sight("e1", 0)
    sighting_before = await scene.sighting(opened.sighting_id)
    other = await make_scene()
    store = scene.store

    assert not await store.refresh_sighting(
        other.patient_id, opened.sighting_id, scene.item_id, at(1), 5, BBOX, 0.9
    )
    assert not await store.close_sighting(other.patient_id, opened.sighting_id)
    job = await store.enqueue_description(
        other.patient_id, scene.item_id, opened.sighting_id, 1, "kf/x.jpg", BBOX, T0
    )
    assert job is None
    assert await scene.sighting(opened.sighting_id) == sighting_before


def test_description_results_normalize_what_the_model_says() -> None:
    result = DescriptionResult.model_validate(
        {"room": "Unknown", "surface": "  ", "relation": None, "state": "held", "sentence": " in a hand "}
    )
    assert (result.room, result.surface, result.relation, result.sentence) == (None, None, None, "in a hand")
    assert result.nearbyObjects == []
    many = DescriptionResult(
        state="resting", sentence="on a shelf", nearbyObjects=[f"thing {i}" for i in range(30)]
    )
    assert len(many.nearbyObjects) == 20


def test_times_are_truncated_to_what_bson_keeps() -> None:
    assert to_ms(datetime(2026, 9, 19, 12, 0, 0, 123456, tzinfo=UTC)).microsecond == 123000
    with pytest.raises(ValueError):
        to_ms(datetime(2026, 9, 19, 12, 0, 0))  # noqa: DTZ001  the naive time is the point


async def test_a_description_applies_when_versions_match(scene: Scene) -> None:
    opened = await scene.sight("e1", 0)
    job = await scene.enqueue(opened)
    claimed = await scene.store.claim_job("w1", T0)
    assert claimed is not None
    assert (claimed.id, claimed.attempts, claimed.lease_owner) == (job.id, 1, "w1")

    assert await scene.store.complete_job(claimed, "w1", RESULT, at(2)) == "applied"
    sighting = await scene.sighting(opened.sighting_id)
    assert sighting["descriptionStatus"] == "ready"
    assert sighting["room"] == {"id": None, "name": "kitchen", "confidence": None}
    assert (sighting["surface"], sighting["relation"], sighting["state"]) == (
        "counter",
        "next to the coffee maker",
        "resting",
    )
    assert sighting["nearbyObjects"] == ["coffee maker", "mug"]
    item = await scene.item()
    # The merged snapshot is exactly what snapshotOf() makes of the described sighting.
    assert item["lastSighting"] == snapshot_of(sighting)
    assert item["lastRestingSighting"] == item["lastSighting"]
    assert item["observationVersion"] == 1
    done = await scene.job(job.id)
    assert (done["status"], done["finishedAt"]) == ("succeeded", at(2))


async def test_a_late_description_only_enriches_the_old_sighting(scene: Scene) -> None:
    old = await scene.sight("e-old", 0)
    await scene.enqueue(old)
    claimed = await scene.store.claim_job("w1", T0)
    assert claimed is not None
    await scene.sight("e-new", 10, state="held")
    item_before = await scene.item()

    assert await scene.store.complete_job(claimed, "w1", RESULT, at(12)) == "history_only"
    assert await scene.item() == item_before
    enriched = await scene.sighting(old.sighting_id)
    assert (enriched["descriptionStatus"], enriched["sentence"]) == ("ready", RESULT.sentence)
    assert (await scene.job(claimed.id))["status"] == "succeeded"


async def test_a_late_description_fills_in_the_last_resting_spot(scene: Scene) -> None:
    resting = await scene.sight("e-rest", 0, state="resting")
    await scene.enqueue(resting)
    claimed = await scene.store.claim_job("w1", T0)
    assert claimed is not None
    held = await scene.sight("e-held", 10, state="held")

    assert await scene.store.complete_job(claimed, "w1", RESULT, at(12)) == "history_only"
    item = await scene.item()
    assert item["lastSighting"]["sightingId"] == held.sighting_id
    spot = item["lastRestingSighting"]
    assert (spot["sightingId"], spot["keyframeRevision"]) == (resting.sighting_id, 1)
    assert (spot["descriptionStatus"], spot["sentence"]) == ("ready", RESULT.sentence)


async def test_a_new_sighting_leaves_the_items_updated_at_alone(scene: Scene) -> None:
    # updatedAt marks caregiver edits; the web side refuses a save when it moved.
    before = (await scene.item())["updatedAt"]
    await scene.sight("e1", 0, state="resting")
    assert (await scene.item())["updatedAt"] == before


async def test_a_newer_keyframe_supersedes_a_queued_one(scene: Scene) -> None:
    opened = await scene.sight("e1", 0)
    first = await scene.enqueue(opened, "kf/1.jpg")
    second = await scene.enqueue(opened, "kf/2.jpg", seconds=1)
    assert (first.keyframe_revision, second.keyframe_revision) == (1, 2)

    superseded = await scene.job(first.id)
    assert (superseded["status"], superseded["finishedAt"]) == ("superseded", at(1))
    queued = await scene.job(second.id)
    assert queued["status"] == "queued"
    assert (await scene.item())["lastSighting"]["keyframeRevision"] == 2
    sighting = await scene.sighting(opened.sighting_id)
    assert sighting["keyframeKey"] == "kf/2.jpg"
    # The retention sweep deletes a sighting's jobs with it, so a job can't expire first.
    assert queued["expiresAt"] == sighting["expiresAt"]


async def test_a_description_for_a_superseded_keyframe_writes_nothing(scene: Scene) -> None:
    opened = await scene.sight("e1", 0)
    await scene.enqueue(opened, "kf/1.jpg")
    claimed = await scene.store.claim_job("w1", T0)
    assert claimed is not None
    # A better keyframe arrives while the first one is at the vision model.
    newer = await scene.enqueue(opened, "kf/2.jpg", seconds=1)
    sighting_before = await scene.sighting(opened.sighting_id)
    item_before = await scene.item()

    assert await scene.store.complete_job(claimed, "w1", RESULT, at(2)) == "superseded"
    assert await scene.sighting(opened.sighting_id) == sighting_before
    assert await scene.item() == item_before
    assert (await scene.job(claimed.id))["status"] == "superseded"
    assert (await scene.job(newer.id))["status"] == "queued"


async def test_held_evidence_after_resting_keeps_the_resting_snapshot(scene: Scene) -> None:
    resting = await scene.sight("e-rest", 0, state="resting")
    resting_snapshot = (await scene.item())["lastRestingSighting"]
    assert resting_snapshot["sightingId"] == resting.sighting_id

    held = await scene.sight("e-held", 10, state="held")
    item = await scene.item()
    assert (item["lastSighting"]["sightingId"], item["lastSighting"]["state"]) == (held.sighting_id, "held")
    assert item["lastRestingSighting"] == resting_snapshot

    # Describing the held sighting doesn't touch the resting one either.
    await scene.enqueue(held)
    claimed = await scene.store.claim_job("w1", at(11))
    assert claimed is not None
    in_hand = DescriptionResult(room="kitchen", state="held", sentence="in your hand")
    assert await scene.store.complete_job(claimed, "w1", in_hand, at(12)) == "applied"
    item = await scene.item()
    assert (item["lastSighting"]["state"], item["lastSighting"]["sentence"]) == ("held", "in your hand")
    assert item["lastRestingSighting"] == resting_snapshot


async def test_an_expired_lease_lets_a_second_worker_claim(scene: Scene) -> None:
    store = scene.store
    opened = await scene.sight("e1", 0)
    await scene.enqueue(opened)
    first = await store.claim_job("w1", T0)
    assert first is not None
    assert await store.claim_job("w2", at(10)) is None

    second = await store.claim_job("w2", at(31))
    assert second is not None
    assert (second.id, second.attempts, second.lease_owner) == (first.id, 2, "w2")

    # The first worker comes back from a long stall. Its writes are fenced off.
    assert await store.complete_job(first, "w1", RESULT, at(32)) == "lost_lease"
    assert await store.fail_job(first, "w1", "stalled", at(32)) == "lost_lease"
    running = await scene.job(first.id)
    assert (running["status"], running["leaseOwner"], running["attempts"]) == ("running", "w2", 2)

    assert await store.complete_job(second, "w2", RESULT, at(33)) == "applied"
    assert (await scene.job(first.id))["status"] == "succeeded"


async def test_retries_back_off_then_exhaustion_marks_the_sighting_and_snapshot_failed(scene: Scene) -> None:
    store = scene.store
    opened = await scene.sight("e1", 0)
    job = await scene.enqueue(opened)

    claimed = await store.claim_job("w1", T0)
    assert claimed is not None
    assert await store.fail_job(claimed, "w1", "vision timeout", T0) == "retry"
    queued = await scene.job(job.id)
    assert (queued["status"], queued["runAfter"], queued["lastError"], queued["leaseOwner"]) == (
        "queued",
        at(2),
        "vision timeout",
        None,
    )
    assert await store.claim_job("w1", at(1)) is None

    claimed = await store.claim_job("w1", at(2))
    assert claimed is not None and claimed.attempts == 2
    assert await store.fail_job(claimed, "w1", "vision timeout", at(2)) == "retry"
    assert (await scene.job(job.id))["runAfter"] == at(6)
    assert await store.claim_job("w1", at(5)) is None

    claimed = await store.claim_job("w1", at(6))
    assert claimed is not None and claimed.attempts == 3
    assert await store.fail_job(claimed, "w1", "vision timeout", at(6)) == "failed"
    failed = await scene.job(job.id)
    assert (failed["status"], failed["finishedAt"]) == ("failed", at(6))
    assert (await scene.sighting(opened.sighting_id))["descriptionStatus"] == "failed"
    assert (await scene.item())["lastSighting"]["descriptionStatus"] == "failed"
    assert await store.claim_job("w1", at(3600)) is None


async def test_a_worker_that_dies_on_the_last_attempt_is_failed_by_the_lease_sweep(scene: Scene) -> None:
    store = scene.store
    opened = await scene.sight("e1", 0)
    job = await scene.enqueue(opened)
    for attempt in range(3):
        claimed = await store.claim_job(f"w{attempt}", at(attempt * 31))
        assert claimed is not None and claimed.attempts == attempt + 1
    # The third lease runs until 92 s. Nobody may claim a fourth attempt.
    assert await store.claim_job("w9", at(93)) is None
    assert await store.fail_exhausted_leases(at(91)) == 0
    assert await store.fail_exhausted_leases(at(93)) == 1

    failed = await scene.job(job.id)
    assert (failed["status"], failed["finishedAt"]) == ("failed", at(93))
    assert (await scene.sighting(opened.sighting_id))["descriptionStatus"] == "failed"
    assert (await scene.item())["lastSighting"]["descriptionStatus"] == "failed"


async def test_a_failed_retake_keeps_an_earlier_description(scene: Scene) -> None:
    store = scene.store
    opened = await scene.sight("e1", 0)
    await scene.enqueue(opened, "kf/1.jpg")
    claimed = await store.claim_job("w1", T0)
    assert claimed is not None
    assert await store.complete_job(claimed, "w1", RESULT, at(1)) == "applied"

    await scene.enqueue(opened, "kf/2.jpg", seconds=2)
    now = at(2)
    for _ in range(3):
        claimed = await store.claim_job("w1", now)
        assert claimed is not None
        await store.fail_job(claimed, "w1", "vision timeout", now)
        now += timedelta(seconds=60)
    assert (await scene.job(claimed.id))["status"] == "failed"
    sighting = await scene.sighting(opened.sighting_id)
    assert (sighting["descriptionStatus"], sighting["sentence"]) == ("ready", RESULT.sentence)
    assert (await scene.item())["lastSighting"]["descriptionStatus"] == "ready"


async def test_pausing_cancels_the_wearers_queued_jobs(scene: Scene, make_scene: SceneFactory) -> None:
    store = scene.store
    first = await scene.enqueue(await scene.sight("e-a", 0))
    second = await scene.enqueue(await scene.sight("e-b", 1), seconds=1)
    running = await store.claim_job("w1", at(2))
    assert running is not None and running.id == first.id
    other = await make_scene()
    others = await other.enqueue(await other.sight("x", 0))

    assert await store.set_capture_state(scene.patient_id, scene.session_id, "live")
    assert (await scene.job(second.id))["status"] == "queued"
    assert await store.set_capture_state(scene.patient_id, scene.session_id, "paused")

    cancelled = await scene.job(second.id)
    assert (cancelled["status"], cancelled["finishedAt"]) == ("cancelled", T0)
    # The keyframe already went out, so the running job finishes.
    assert (await scene.job(first.id))["status"] == "running"
    assert (await scene.job(others.id))["status"] == "queued"


async def test_the_queue_is_bounded_per_wearer(scene: Scene, make_scene: SceneFactory) -> None:
    sightings = [await scene.sight(f"e{i}", i, seq=i + 1) for i in range(21)]
    for opened in sightings[:20]:
        await scene.enqueue(opened)
    refused = await scene.store.enqueue_description(
        scene.patient_id, scene.item_id, sightings[20].sighting_id, 0, "kf/1.jpg", BBOX, T0
    )
    assert refused is None
    # Refusing leaves the sighting alone, so a later keyframe starts from revision 1.
    assert (await scene.sighting(sightings[20].sighting_id))["keyframeRevision"] == 0
    queued = {"patientId": scene.patient_id, "status": "queued"}
    assert await scene.db["description_jobs"].count_documents(queued) == 20

    # A retake of a queued sighting replaces its job instead of being refused.
    retake = await scene.enqueue(sightings[0], "kf/retake.jpg", seconds=30)
    assert retake.keyframe_revision == 2
    assert await scene.db["description_jobs"].count_documents(queued) == 20

    other = await make_scene()
    await other.enqueue(await other.sight("x", 0))


async def test_a_sentence_with_a_dollar_sign_survives(scene: Scene) -> None:
    opened = await scene.sight("e1", 0)
    await scene.enqueue(opened)
    claimed = await scene.store.claim_job("w1", T0)
    assert claimed is not None
    tricky = DescriptionResult(
        room="$$ROOT",
        surface="$surface",
        relation="under the $lastSighting",
        state="resting",
        sentence="next to the $5 bill",
    )
    assert await scene.store.complete_job(claimed, "w1", tricky, at(1)) == "applied"

    sighting = await scene.sighting(opened.sighting_id)
    assert (sighting["room"]["name"], sighting["surface"], sighting["relation"], sighting["sentence"]) == (
        "$$ROOT",
        "$surface",
        "under the $lastSighting",
        "next to the $5 bill",
    )
    item = await scene.item()
    assert (item["lastSighting"]["sentence"], item["lastSighting"]["room"]) == (
        "next to the $5 bill",
        "$$ROOT",
    )
    assert item["lastRestingSighting"]["sentence"] == "next to the $5 bill"
