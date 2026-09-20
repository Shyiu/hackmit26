"""The description worker's claim -> vision call -> complete/fail loop, against real MongoDB."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from conftest import Database, Seed

from app.description_worker import DescriptionWorker
from app.keyframes import GridFSKeyframeStore
from app.store import BBox, DescriptionResult, ObservationStore
from app.vision import MockDescriptionVLM

T0 = datetime.now(UTC).replace(microsecond=0)
BBOX: BBox = (0.4, 0.5, 0.1, 0.1)


class FakeVLM:
    def __init__(self, result: DescriptionResult | None = None, error: Exception | None = None) -> None:
        self.result = result or DescriptionResult(room="kitchen", state="resting", sentence="on the counter")
        self.error = error
        self.calls: list[tuple[bytes, BBox, str | None]] = []

    def describe(self, image: bytes, bbox: BBox, label: str | None) -> DescriptionResult:
        self.calls.append((image, bbox, label))
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
async def job_scene(db: Database, seed: Seed):
    await db["description_jobs"].delete_many({})
    await db["sightings"].delete_many({})
    store = ObservationStore(db, clock=lambda: T0)
    keyframes = GridFSKeyframeStore(db)
    patient_id = await seed.patient()
    item_id = await seed.item(patient_id)
    session_id = await store.open_capture_session(patient_id, None, "simulator")
    opened = await store.open_sighting(
        patient_id=patient_id,
        item_id=item_id,
        label="keys",
        session_id=session_id,
        device_id=None,
        source="simulator",
        event_id="worker-test:1",
        first_seen_at=T0 - timedelta(seconds=1),
        observed_at=T0,
        first_seq=1,
        seq=1,
        bbox=BBOX,
        frame_size=(1280, 720),
        confidence=0.8,
    )
    key = f"{patient_id}/{opened.sighting_id}/1.jpg"
    await keyframes.put(key, b"\xff\xd8\xff fake jpeg", "image/jpeg")
    job = await store.enqueue_description(
        patient_id, item_id, opened.sighting_id, opened.observation_version, key, BBOX, T0
    )
    assert job is not None
    return store, keyframes, patient_id, item_id, opened.sighting_id


async def test_process_one_completes_a_queued_job(db: Database, job_scene):
    store, keyframes, patient_id, item_id, sighting_id = job_scene
    vlm = MockDescriptionVLM()
    worker = DescriptionWorker(store, keyframes, vlm, "worker-1", clock=lambda: T0)

    assert await worker.process_one() is True

    sighting = await db["sightings"].find_one({"_id": sighting_id})
    assert sighting["descriptionStatus"] == "ready"
    assert "keys" in sighting["sentence"]
    item = await db["items"].find_one({"_id": item_id})
    assert item["lastSighting"]["descriptionStatus"] == "ready"
    assert "keys" in item["lastSighting"]["sentence"]

    assert await worker.process_one() is False


async def test_process_one_retries_on_vlm_failure(db: Database, job_scene):
    store, keyframes, _patient_id, _item_id, sighting_id = job_scene
    vlm = FakeVLM(error=RuntimeError("vision timeout"))
    worker = DescriptionWorker(store, keyframes, vlm, "worker-1", clock=lambda: T0)

    assert await worker.process_one() is True
    job = await db["description_jobs"].find_one({"sightingId": sighting_id})
    assert job["status"] == "queued"
    assert job["lastError"] == "vision timeout"

    sighting = await db["sightings"].find_one({"_id": sighting_id})
    assert sighting["descriptionStatus"] != "ready"


async def test_run_forever_stops_cleanly_on_cancel(job_scene):
    store, keyframes, *_ = job_scene
    worker = DescriptionWorker(store, keyframes, FakeVLM(), "worker-1", poll_interval=0.01, clock=lambda: T0)
    task = asyncio.create_task(worker.run_forever())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_failed_job_retries_then_marks_sighting_failed(db: Database, job_scene):
    store, keyframes, _patient_id, _item_id, sighting_id = job_scene
    worker = DescriptionWorker(
        store, keyframes, FakeVLM(error=RuntimeError("vision timeout")), "worker-1", clock=lambda: T0
    )

    for attempt in range(3):
        assert await worker.process_one() is True
        job = await db["description_jobs"].find_one({"sightingId": sighting_id})
        if attempt < 2:
            assert job["status"] == "queued"
            assert job["runAfter"] > T0
            await db["description_jobs"].update_one({"_id": job["_id"]}, {"$set": {"runAfter": T0}})
        else:
            assert job["status"] == "failed"

    sighting = await db["sightings"].find_one({"_id": sighting_id})
    assert sighting["descriptionStatus"] == "failed"


async def test_superseded_job_is_not_claimed(db: Database, job_scene):
    store, keyframes, patient_id, item_id, sighting_id = job_scene
    newer_key = f"{patient_id}/{sighting_id}/2.jpg"
    await keyframes.put(newer_key, b"new image", "image/jpeg")
    newer = await store.enqueue_description(
        patient_id,
        item_id,
        sighting_id,
        1,
        newer_key,
        BBOX,
        T0 + timedelta(seconds=1),
    )
    assert newer is not None
    old = await db["description_jobs"].find_one(
        {"sightingId": sighting_id, "keyframeKey": {"$ne": newer_key}}
    )
    assert old["status"] == "superseded"

    vlm = FakeVLM()
    worker = DescriptionWorker(store, keyframes, vlm, "worker-1", clock=lambda: T0 + timedelta(seconds=1))
    assert await worker.process_one() is True
    assert vlm.calls == [(b"new image", BBOX, "keys")]
