"""The description worker's claim -> vision call -> complete/fail loop, against real MongoDB."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from conftest import Database, Seed

from app.description_worker import DescriptionWorker
from app.safety.images import LocalFrameStore
from app.store import BBox, DescriptionResult, ObservationStore

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
async def job_scene(db: Database, seed: Seed, tmp_path: Path):
    await db["description_jobs"].delete_many({})
    await db["sightings"].delete_many({})
    store = ObservationStore(db, clock=lambda: T0)
    frame_store = LocalFrameStore(str(tmp_path))
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
    stored = frame_store.put(patient_id, b"\xff\xd8\xff fake jpeg", T0)
    job = await store.enqueue_description(
        patient_id, item_id, opened.sighting_id, opened.observation_version, stored.key, BBOX, T0
    )
    assert job is not None
    return store, frame_store, patient_id, item_id, opened.sighting_id


async def test_process_one_completes_a_queued_job(db: Database, job_scene):
    store, frame_store, patient_id, item_id, sighting_id = job_scene
    vlm = FakeVLM()
    worker = DescriptionWorker(store, frame_store, vlm, "worker-1", clock=lambda: T0)

    assert await worker.process_one() is True
    assert vlm.calls == [(b"\xff\xd8\xff fake jpeg", BBOX, "keys")]

    sighting = await db["sightings"].find_one({"_id": sighting_id})
    assert sighting["descriptionStatus"] == "ready"
    assert sighting["room"] == {"id": None, "name": "kitchen", "confidence": None}
    item = await db["items"].find_one({"_id": item_id})
    assert item["lastSighting"]["sentence"] == "on the counter"

    assert await worker.process_one() is False


async def test_process_one_retries_on_vlm_failure(db: Database, job_scene):
    store, frame_store, _patient_id, _item_id, sighting_id = job_scene
    vlm = FakeVLM(error=RuntimeError("vision timeout"))
    worker = DescriptionWorker(store, frame_store, vlm, "worker-1", clock=lambda: T0)

    assert await worker.process_one() is True
    job = await db["description_jobs"].find_one({"sightingId": sighting_id})
    assert job["status"] == "queued"
    assert job["lastError"] == "vision timeout"

    sighting = await db["sightings"].find_one({"_id": sighting_id})
    assert sighting["descriptionStatus"] != "ready"


async def test_run_forever_stops_cleanly_on_cancel(job_scene):
    store, frame_store, *_ = job_scene
    worker = DescriptionWorker(
        store, frame_store, FakeVLM(), "worker-1", poll_interval=0.01, clock=lambda: T0
    )
    task = asyncio.create_task(worker.run_forever())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
