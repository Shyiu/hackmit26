"""From detections to sightings. README "From detections to sightings".

`SightingTracker` follows one capture session's detections across frames with
ByteTrack's two-stage association: high-confidence detections are matched to
tracks by IoU first, then low-confidence ones get a second chance to keep an
existing track alive. Track IDs are local to the session.

A track becomes a sighting only after the confirmation rule holds, initially
three usable frames within two seconds, so a single noisy frame never moves an
item. The tracker itself writes nothing: `observe()` returns events, and
`SightingWriter` turns them into store calls, so the rule is testable without a
database.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from bson import ObjectId

from .config import Settings
from .keyframes import KeyframeStore, make_thumb, thumb_key
from .protocol import Detection
from .store import BBox, CaptureSource, ObservationStore

HIGH_CONFIDENCE = 0.5
LOW_CONFIDENCE = 0.1
log = logging.getLogger("perception.tracker")


@dataclass(frozen=True, slots=True)
class TrackerConfig:
    confirm_frames: int = 3
    confirm_window: timedelta = timedelta(seconds=2)
    refresh_interval: timedelta = timedelta(milliseconds=500)
    lost_after: timedelta = timedelta(seconds=3)
    match_iou: float = 0.3

    @classmethod
    def from_settings(cls, settings: Settings) -> TrackerConfig:
        return cls(
            confirm_frames=settings.confirm_frames,
            confirm_window=timedelta(seconds=settings.confirm_window_seconds),
            refresh_interval=timedelta(milliseconds=settings.refresh_interval_ms),
            lost_after=timedelta(seconds=settings.track_lost_seconds),
            match_iou=settings.track_match_iou,
        )


@dataclass(frozen=True, slots=True)
class SightingOpened:
    track_id: int
    item_id: str
    label: str
    first_seen_at: datetime
    observed_at: datetime
    first_seq: int
    seq: int
    bbox: BBox
    frame_size: tuple[int, int]
    confidence: float


@dataclass(frozen=True, slots=True)
class SightingRefreshed:
    track_id: int
    item_id: str
    observed_at: datetime
    seq: int
    bbox: BBox
    confidence: float


@dataclass(frozen=True, slots=True)
class SightingClosed:
    track_id: int
    item_id: str


SightingEvent = SightingOpened | SightingRefreshed | SightingClosed


def iou(a: BBox, b: BBox) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    inter_w = min(ax + aw, bx + bw) - max(ax, bx)
    inter_h = min(ay + ah, by + bh) - max(ay, by)
    if inter_w <= 0 or inter_h <= 0:
        return 0.0
    inter = inter_w * inter_h
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


@dataclass(slots=True)
class _Track:
    id: int
    item_id: str
    label: str
    bbox: BBox
    confidence: float
    first_seen_at: datetime
    first_seq: int
    last_seen_at: datetime
    last_seq: int
    # When the last confirm_frames usable frames saw this track.
    hits: deque[datetime]
    confirmed: bool = False
    refreshed_at: datetime | None = None
    lost_since: datetime | None = None

    def hit(self, detection: Detection, observed_at: datetime, seq: int) -> None:
        self.bbox = detection.bbox
        self.confidence = detection.confidence
        self.last_seen_at = observed_at
        self.last_seq = seq
        self.lost_since = None
        self.hits.append(observed_at)


@dataclass(slots=True)
class SightingTracker:
    """One capture session's tracks. Feed it every usable frame's detections, in seq order."""

    config: TrackerConfig = field(default_factory=TrackerConfig)
    _tracks: list[_Track] = field(default_factory=list)
    _next_id: int = 1

    @property
    def open_track_ids(self) -> list[int]:
        return [track.id for track in self._tracks if track.confirmed]

    def observe(
        self,
        detections: list[Detection],
        observed_at: datetime,
        seq: int,
        frame_size: tuple[int, int] = (1280, 720),
    ) -> list[SightingEvent]:
        events: list[SightingEvent] = []
        unmatched = self._associate(detections, observed_at, seq)
        for detection in unmatched:
            if detection.confidence >= HIGH_CONFIDENCE:
                self._tracks.append(self._start(detection, observed_at, seq))
        for track in self._tracks:
            if track.last_seq != seq:
                if track.lost_since is None:
                    track.lost_since = observed_at
                continue
            if not track.confirmed:
                if self._confirmed(track):
                    track.confirmed = True
                    track.refreshed_at = observed_at
                    events.append(
                        SightingOpened(
                            track.id,
                            track.item_id,
                            track.label,
                            track.first_seen_at,
                            observed_at,
                            track.first_seq,
                            seq,
                            track.bbox,
                            frame_size,
                            track.confidence,
                        )
                    )
            elif (
                track.refreshed_at is None or observed_at - track.refreshed_at >= self.config.refresh_interval
            ):
                track.refreshed_at = observed_at
                events.append(
                    SightingRefreshed(track.id, track.item_id, observed_at, seq, track.bbox, track.confidence)
                )
        events.extend(self._expire(observed_at))
        return events

    def close_all(self) -> list[SightingEvent]:
        """The session ended. Every confirmed track closes."""
        events: list[SightingEvent] = [
            SightingClosed(track.id, track.item_id) for track in self._tracks if track.confirmed
        ]
        self._tracks.clear()
        return events

    def _associate(self, detections: list[Detection], observed_at: datetime, seq: int) -> list[Detection]:
        high = [d for d in detections if d.confidence >= HIGH_CONFIDENCE]
        low = [d for d in detections if LOW_CONFIDENCE <= d.confidence < HIGH_CONFIDENCE]
        free = list(self._tracks)
        # Stage one: tracks against confident detections. Stage two: what's
        # left of the tracks against the faint ones, which keeps a track alive
        # through a partly hidden or badly lit frame without starting new ones.
        leftover_high = self._match(free, high, observed_at, seq)
        self._match(free, low, observed_at, seq)
        return leftover_high

    def _match(
        self, free: list[_Track], detections: list[Detection], observed_at: datetime, seq: int
    ) -> list[Detection]:
        pairs = sorted(
            (
                (iou(track.bbox, detection.bbox), t, d)
                for t, track in enumerate(free)
                for d, detection in enumerate(detections)
                if track.item_id == detection.itemId
            ),
            key=lambda pair: pair[0],
            reverse=True,
        )
        used_tracks: set[int] = set()
        used_detections: set[int] = set()
        for overlap, t, d in pairs:
            if overlap < self.config.match_iou:
                break
            if t in used_tracks or d in used_detections:
                continue
            used_tracks.add(t)
            used_detections.add(d)
            free[t].hit(detections[d], observed_at, seq)
        for t in sorted(used_tracks, reverse=True):
            del free[t]
        return [detection for d, detection in enumerate(detections) if d not in used_detections]

    def _start(self, detection: Detection, observed_at: datetime, seq: int) -> _Track:
        track = _Track(
            id=self._next_id,
            item_id=detection.itemId,
            label=detection.label,
            bbox=detection.bbox,
            confidence=detection.confidence,
            first_seen_at=observed_at,
            first_seq=seq,
            last_seen_at=observed_at,
            last_seq=seq,
            hits=deque([observed_at], maxlen=self.config.confirm_frames),
        )
        self._next_id += 1
        return track

    def _confirmed(self, track: _Track) -> bool:
        hits = track.hits
        return len(hits) >= self.config.confirm_frames and hits[-1] - hits[0] <= self.config.confirm_window

    def _expire(self, now: datetime) -> list[SightingEvent]:
        events: list[SightingEvent] = []
        kept: list[_Track] = []
        for track in self._tracks:
            if track.lost_since is not None and now - track.lost_since >= self.config.lost_after:
                if track.confirmed:
                    events.append(SightingClosed(track.id, track.item_id))
                continue
            kept.append(track)
        self._tracks = kept
        return events


class SightingWriter:
    """Applies tracker events to the store for one capture session."""

    def __init__(
        self,
        store: ObservationStore,
        *,
        patient_id: ObjectId,
        session_id: ObjectId,
        device_id: ObjectId | None,
        source: CaptureSource,
        keyframe_store: KeyframeStore | None = None,
        keyframe_interval: timedelta = timedelta(seconds=10),
    ) -> None:
        self._store = store
        self._patient_id = patient_id
        self._session_id = session_id
        self._device_id = device_id
        self._source = source
        self._keyframe_store = keyframe_store
        self._keyframe_interval = keyframe_interval
        self._sightings: dict[int, ObjectId] = {}
        self._observation_versions: dict[int, int] = {}
        self._last_keyframe: dict[int, datetime] = {}
        self._background: set[asyncio.Task[None]] = set()

    def event_id(self, track_id: int) -> str:
        # Stable per track, so a replayed open changes nothing.
        return f"{self._session_id}:{track_id}"

    async def apply(self, events: list[SightingEvent], frame_jpeg: bytes | None = None) -> None:
        for event in events:
            match event:
                case SightingOpened():
                    opened = await self._store.open_sighting(
                        patient_id=self._patient_id,
                        item_id=ObjectId(event.item_id),
                        label=event.label,
                        session_id=self._session_id,
                        device_id=self._device_id,
                        source=self._source,
                        event_id=self.event_id(event.track_id),
                        first_seen_at=event.first_seen_at,
                        observed_at=event.observed_at,
                        first_seq=event.first_seq,
                        seq=event.seq,
                        bbox=event.bbox,
                        frame_size=event.frame_size,
                        confidence=event.confidence,
                    )
                    self._sightings[event.track_id] = opened.sighting_id
                    self._observation_versions[event.track_id] = opened.observation_version
                    if frame_jpeg is not None and opened.created and self._keyframe_store is not None:
                        # A replayed open reuses the earlier keyframe; only a genuinely
                        # new sighting needs one enqueued for the vision model.
                        self._schedule_keyframe(
                            event, opened.sighting_id, opened.observation_version, frame_jpeg
                        )
                case SightingRefreshed():
                    sighting_id = self._sightings.get(event.track_id)
                    if sighting_id is not None:
                        await self._store.refresh_sighting(
                            self._patient_id,
                            sighting_id,
                            ObjectId(event.item_id),
                            event.observed_at,
                            event.seq,
                            event.bbox,
                            event.confidence,
                        )
                        last_keyframe = self._last_keyframe.get(event.track_id)
                        if (
                            frame_jpeg is not None
                            and self._keyframe_store is not None
                            and (
                                last_keyframe is None
                                or event.observed_at - last_keyframe >= self._keyframe_interval
                            )
                        ):
                            self._last_keyframe[event.track_id] = event.observed_at
                            self._schedule_keyframe(
                                event,
                                sighting_id,
                                self._observation_versions[event.track_id],
                                frame_jpeg,
                            )
                case SightingClosed():
                    sighting_id = self._sightings.pop(event.track_id, None)
                    self._observation_versions.pop(event.track_id, None)
                    self._last_keyframe.pop(event.track_id, None)
                    if sighting_id is not None:
                        await self._store.close_sighting(self._patient_id, sighting_id)

    def _schedule_keyframe(
        self,
        event: SightingOpened | SightingRefreshed,
        sighting_id: ObjectId,
        observation_version: int,
        frame_jpeg: bytes,
    ) -> None:
        self._last_keyframe[event.track_id] = event.observed_at
        task = asyncio.create_task(
            self._store_and_enqueue(
                event,
                sighting_id,
                observation_version,
                frame_jpeg,
            )
        )
        self._background.add(task)
        task.add_done_callback(self._background_done)

    def _background_done(self, task: asyncio.Task[None]) -> None:
        self._background.discard(task)
        if not task.cancelled() and (error := task.exception()) is not None:
            log.error(
                "Keyframe task failed",
                exc_info=(type(error), error, error.__traceback__),
            )

    async def _store_and_enqueue(
        self,
        event: SightingOpened | SightingRefreshed,
        sighting_id: ObjectId,
        observation_version: int,
        frame_jpeg: bytes,
    ) -> None:
        assert self._keyframe_store is not None
        # The DB revision is assigned inside enqueue_description; the key carries observed time instead.
        key = f"{self._patient_id}/{sighting_id}/{int(event.observed_at.timestamp() * 1000)}.jpg"
        thumb = await asyncio.to_thread(make_thumb, frame_jpeg)
        await self._keyframe_store.put(key, frame_jpeg, "image/jpeg")
        await self._keyframe_store.put(thumb_key(key), thumb, "image/jpeg")
        await self._store.enqueue_description(
            self._patient_id,
            ObjectId(event.item_id),
            sighting_id,
            observation_version,
            key,
            event.bbox,
            event.observed_at,
            thumb_key=thumb_key(key),
        )

    async def drain(self) -> None:
        while self._background:
            await asyncio.gather(*tuple(self._background), return_exceptions=True)
