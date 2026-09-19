"""The confirmation rule and track lifecycle, with no model and no database."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.protocol import Detection
from app.tracker import SightingClosed, SightingOpened, SightingRefreshed, SightingTracker

T0 = datetime(2026, 9, 19, 12, 0, tzinfo=UTC)
KEYS = "5eed0000000000000000a001"
WALLET = "5eed0000000000000000a002"


def _keys(confidence: float = 0.8, x: float = 0.2) -> Detection:
    return Detection(itemId=KEYS, label="keys", bbox=(x, 0.3, 0.2, 0.2), confidence=confidence)


def _at(ms: int) -> datetime:
    return T0 + timedelta(milliseconds=ms)


def _feed(tracker: SightingTracker, frames: list[tuple[int, list[Detection]]]) -> list[object]:
    events: list[object] = []
    for seq, (ms, detections) in enumerate(frames, start=1):
        events.extend(tracker.observe(detections, _at(ms), seq))
    return events


def test_three_usable_frames_within_two_seconds_open_a_sighting() -> None:
    tracker = SightingTracker()
    events = _feed(tracker, [(0, [_keys()]), (333, [_keys()])])
    assert events == []

    events = _feed_more(tracker, 3, 666, [_keys(0.9, x=0.22)])
    assert len(events) == 1
    opened = events[0]
    assert isinstance(opened, SightingOpened)
    assert (opened.item_id, opened.label, opened.first_seq, opened.seq) == (KEYS, "keys", 1, 3)
    assert (opened.first_seen_at, opened.observed_at) == (_at(0), _at(666))
    # The snapshot is the latest box, not the first.
    assert opened.bbox[0] == 0.22 and opened.confidence == 0.9


def test_a_single_noisy_frame_does_not_move_an_item() -> None:
    tracker = SightingTracker()
    events = _feed(tracker, [(0, [_keys(0.95)]), (333, []), (666, []), (1000, [])])
    assert events == []
    assert tracker.open_track_ids == []


def test_frames_spread_over_more_than_two_seconds_do_not_confirm() -> None:
    tracker = SightingTracker()
    # Three hits, but 2.5 s apart end to end: never three within the window.
    events = _feed(tracker, [(0, [_keys()]), (1250, [_keys()]), (2500, [_keys()])])
    assert events == []
    # 1250, 2500, 3300 still spans over two seconds; 2500, 3300, 3600 doesn't.
    assert _feed_more(tracker, 4, 3300, [_keys()]) == []
    events = _feed_more(tracker, 5, 3600, [_keys()])
    assert [type(e) for e in events] == [SightingOpened]


def test_faint_detections_keep_a_track_alive_but_never_start_one() -> None:
    tracker = SightingTracker()
    assert _feed(tracker, [(0, [_keys(0.2)]), (333, [_keys(0.2)]), (666, [_keys(0.2)])]) == []
    # A confident start, then two faint frames on the same box still confirm.
    tracker = SightingTracker()
    events = _feed(tracker, [(0, [_keys(0.7)]), (333, [_keys(0.2)]), (666, [_keys(0.3)])])
    assert [type(e) for e in events] == [SightingOpened]


def test_refresh_is_rate_limited_to_the_interval() -> None:
    tracker = SightingTracker()
    _feed(tracker, [(0, [_keys()]), (333, [_keys()]), (666, [_keys()])])
    # 333 ms after the open is inside the 500 ms interval, 1000 ms is past it.
    assert _feed_more(tracker, 4, 1000, [_keys()]) == []
    events = _feed_more(tracker, 5, 1333, [_keys()])
    assert len(events) == 1 and isinstance(events[0], SightingRefreshed) and events[0].seq == 5


def test_a_track_closes_three_seconds_after_its_last_usable_observation() -> None:
    tracker = SightingTracker()
    _feed(tracker, [(0, [_keys()]), (333, [_keys()]), (666, [_keys()])])
    (track_id,) = tracker.open_track_ids
    assert _feed_more(tracker, 4, 1000, []) == []
    assert _feed_more(tracker, 5, 3500, []) == []
    events = _feed_more(tracker, 6, 4000, [])
    assert events == [SightingClosed(track_id, KEYS)]
    assert tracker.open_track_ids == []


def test_tracks_are_per_item_and_per_place() -> None:
    tracker = SightingTracker()
    wallet = Detection(itemId=WALLET, label="wallet", bbox=(0.2, 0.3, 0.2, 0.2), confidence=0.9)
    far_keys = _keys(x=0.7)
    frame = [_keys(), wallet, far_keys]
    events = _feed(tracker, [(0, frame), (333, frame), (666, frame)])
    opened = [e for e in events if isinstance(e, SightingOpened)]
    assert sorted((e.item_id, e.bbox[0]) for e in opened) == [(KEYS, 0.2), (KEYS, 0.7), (WALLET, 0.2)]
    assert len({e.track_id for e in opened}) == 3


def test_ending_the_session_closes_every_open_track() -> None:
    tracker = SightingTracker()
    _feed(tracker, [(0, [_keys()]), (333, [_keys()]), (666, [_keys()])])
    assert [type(e) for e in tracker.close_all()] == [SightingClosed]
    assert tracker.close_all() == []


def _feed_more(tracker: SightingTracker, seq: int, ms: int, detections: list[Detection]) -> list[object]:
    return list(tracker.observe(detections, _at(ms), seq))
