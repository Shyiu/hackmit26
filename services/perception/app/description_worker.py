"""Drains the description-job queue against the vision model. README "Description job".

Runs as a background task in the same process as the frame socket, per README
"From detections to sightings": "the existing perception worker can process it
without another queue service." `ObservationStore` already bounds queue size,
coalesces superseded keyframes, and fences a completion against newer evidence,
so this worker only has to claim a job, call the model, and report back.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from .safety.images import LocalFrameStore
from .store import ObservationStore
from .vision import DescriptionVLM

log = logging.getLogger("perception.description")


class DescriptionWorker:
    def __init__(
        self,
        store: ObservationStore,
        frame_store: LocalFrameStore,
        vlm: DescriptionVLM,
        worker_id: str,
        *,
        poll_interval: float = 1.0,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._store = store
        self._frame_store = frame_store
        self._vlm = vlm
        self._worker_id = worker_id
        self._poll_interval = poll_interval
        self._clock = clock

    async def run_forever(self) -> None:
        while True:
            try:
                processed = await self.process_one()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Description worker iteration failed")
                processed = False
            if not processed:
                await self._store.fail_exhausted_leases(self._clock())
                await asyncio.sleep(self._poll_interval)

    async def process_one(self) -> bool:
        """Claims and finishes one job. False if the queue had nothing due."""
        job = await self._store.claim_job(self._worker_id, self._clock())
        if job is None:
            return False
        try:
            image = await asyncio.to_thread(self._frame_store.get, job.keyframe_key)
            result = await asyncio.to_thread(self._vlm.describe, image, job.bbox)
        except Exception as error:
            outcome = await self._store.fail_job(job, self._worker_id, str(error), self._clock())
            log.warning("Description job %s failed: %s (%s)", job.id, error, outcome)
            return True
        outcome = await self._store.complete_job(job, self._worker_id, result, self._clock())
        log.info("Description job %s %s", job.id, outcome)
        return True
