# Perception service

Takes JPEG frames from the headset page over a WebSocket, runs a detector on them, answers each frame with detections for the HUD, and writes capture sessions, sightings and item snapshots to MongoDB. The design is in the root README under "Perception pipeline".

## Status

Skeleton. The frame socket, device tokens, capture sessions, and the MongoDB write path in `app/store.py` work and are tested. The detector finds nothing (`NullDetector`). YOLOE-26, the tracker that turns detections into sightings, and the vision model that describes keyframes are M1. `WS /ws/debug` and `POST /config/classes` are stubs.

## Run

```bash
cd services/perception
cp .env.example .env        # set DEVICE_TOKEN_SECRET to the web app's value
uv sync
uv run uvicorn app.main:app --port 8000
```

To send frames without a phone, cut a recording into JPEGs and replay them. The wearer has to exist in the database, which `pnpm db:seed` takes care of.

```bash
ffmpeg -i kitchen.mp4 -vf fps=3,scale=1280:-2 frames/%05d.jpg
TOKEN=$(uv run python -m app.tokens --patient <wearer id>)
uv run python ../../scripts/replay.py frames/ --token "$TOKEN" --fps 3
```

## Test

```bash
pnpm db:up                  # from the repo root: MongoDB on 127.0.0.1:27017
uv run pytest -q
```

The store and app tests run against a real MongoDB. Each test module gets a fresh database with every validator (`validationAction: "error"`) and index from `packages/db/generated/mongo-schema.json`, so a write the web side's schema would reject fails the test. The database is dropped afterwards. If MongoDB isn't reachable those tests fail and say to run `pnpm db:up`. They don't skip.

`tests/test_contract.py` and `tests/test_tokens.py` run the shared fixtures in `packages/shared/fixtures/`, the same files the zod tests use.

## Environment

| Variable | Default | What it's for |
|---|---|---|
| `MONGODB_URI` | required | |
| `MONGODB_DB` | `memory_glasses` | |
| `DEVICE_TOKEN_SECRET` | required | Verifies frame socket tokens. The web app's value, 32 characters or more |
| `OPENAI_API_KEY` | none | The description worker. Unused until M1 |
| `WORKER_ID` | hostname and pid | Lease owner on claimed description jobs |
| `MONGODB_TEST_URI` | `mongodb://127.0.0.1:27017/?directConnection=true` | Tests only |

## Layout

```text
app/protocol.py   /ws/frames messages and the binary frame envelope, mirroring packages/shared
app/tokens.py     device token verification, mirroring packages/shared/src/device-token.ts
app/store.py      the write path: sessions, sightings, snapshots, the description job queue
app/detector.py   the Detector protocol and NullDetector
app/main.py       the FastAPI app: /ws/frames, /ws/debug, /health, /config/classes
```

## The frame socket

1. The page opens `/ws/frames` and sends `hello` with a token of scope `frames`. A bad token gets an `unauthorized` error and close code 4401. A token naming a device is also refused once that device is revoked or its `tokenVersion` moves past the token's.
2. The service opens a capture session and answers `session`, paused.
3. `capture` switches between live and paused. Pausing cancels the wearer's queued description jobs, and frames that arrive while paused are dropped unread.
4. While live, each binary message is a frame: a 4-byte big-endian header length, the header as JSON, then the JPEG. The service keeps one pending frame per connection, newest wins, and answers `detections` with that frame's `seq`. A `seq` that doesn't increase is rejected.
5. On disconnect the session ends, which also cancels queued description jobs.

## How the write path keeps order

Late and replayed writes can't undo newer evidence:

- A sighting is upserted on its `eventId`, so a replay changes nothing.
- It becomes the item's snapshot only if it was seen later than the current one, through a compare-and-set on the item's `observationVersion`.
- A description reaches the item only while the item still shows the same version, sighting and keyframe revision. Otherwise it only enriches the old sighting, and the item's last resting spot if that is still the described keyframe.
- Snapshot writes leave the item's `updatedAt` alone. It marks caregiver edits, and the web app refuses a save when it moved.
- A worker finishes only the attempt it claimed. The job's `attempts` count is the fencing token, and `runAfter` doubles as the lease expiry.
