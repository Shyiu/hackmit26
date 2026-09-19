# Perception service

Takes JPEG frames from the headset page over a WebSocket, runs tracked-item and safety adapters, and writes capture sessions, sightings, frame observations, and conservative danger events to MongoDB. The design is in the root README under "Perception pipeline".

## Status

The frame socket, device tokens, capture sessions, tracked-item seam, and MongoDB write path are tested. Safety face enrollment, matching, single-frame hazard rules, VLM confirmation, and danger-event persistence are available behind mock adapters by default. Heavy model adapters are optional and lazy-loaded. `WS /ws/debug` and `POST /config/classes` remain stubs.

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

## Safety pipeline

Safety analysis is synchronous and runs in a worker thread so the frame socket stays responsive. Every sampled frame is decoded, passed through an object detector and face detector, matched against tenant-scoped encrypted enrollments, evaluated by declarative hazard rules, optionally confirmed once by a VLM, and persisted as a `frame_observations` document. A candidate creates or refreshes a `danger_events` record and a `danger_alert` notification. Events are single-frame “worth checking” signals, never proof that someone did something dangerous and never an emergency classifier.

The default mock path needs no model weights. Configure the service with lowercase settings fields through uppercase environment variables:

| Adapter | Default | Optional installation |
|---|---|---|
| Object detector | `DETECTOR=mock` | `uv sync --extra dfine` for D-FINE (Apache-2.0) |
| Face detector/embedder | `FACE_DETECTOR=mock`, `FACE_EMBEDDER=mock` | `uv sync --extra faces` for InsightFace/ONNX |
| VLM | `VLM=mock` | `VLM=openai` with `VLM_API_KEY` |
| YOLOE | off | `uv sync --extra yoloe`; Ultralytics is AGPL-3.0 |

D-FINE and its default path are Apache-2.0. InsightFace code is MIT, while its model packages are intended for non-commercial research use. YOLOE/Ultralytics is AGPL-3.0; a network-served application using it must satisfy the AGPL or use an Ultralytics enterprise licence. Keep it off for the hackathon unless licensing is reviewed.

## HTTP API

Safety routes use a bearer device token. `/frames` requires `frames` scope; all other safety routes require `api` scope. Tenant identity always comes from the token `pid` claim.

```bash
TOKEN="$(uv run python -m app.tokens --patient <patient-id> --scope api)"
FRAME_TOKEN="$(uv run python -m app.tokens --patient <patient-id> --scope frames)"
curl -H "Authorization: Bearer $FRAME_TOKEN" \
  -F file=@frame.jpg -F capturedAt=2026-09-19T18:00:00Z \
  http://localhost:8000/frames
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/people
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:8000/frame-observations?limit=50'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:8000/danger-events?status=open'
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"acknowledged","acknowledgedBy":"caregiver"}' \
  http://localhost:8000/danger-events/<event-id>
```

Enroll people with `POST /people` and multipart fields `name`, `consentedBy`, optional `relation`, and one or more `photos`. Each photo must contain exactly one face. Face embeddings are encrypted at rest and are never returned by the API. Raw images stay under `FRAME_IMAGE_DIR`; only object keys are stored in MongoDB. Obtain explicit consent before enrollment, set a durable `FACE_EMBEDDING_KEY` outside local development, and apply the configured retention window.

## Evaluation

Run the mock evaluation fixture or another labeled image directory:

```bash
uv run python scripts/evaluate.py tests/fixtures/eval_sample \
  --labels tests/fixtures/eval_sample/labels.json
```

`labels.json` maps each image filename to a list of expected categories, for example
`{"knife_01.png": ["weapon"], "plain.png": []}`. The report includes per-category and overall
precision, recall, false-positive count, and average, P50, and P95 processing time in milliseconds.

## Extension points

The mock adapters support deterministic filename/label hints and are intended for offline evaluation. Keep evaluation fixtures and adapter contracts stable while measuring category precision/recall and latency. Add temporal confirmation, pose, action classification, or additional detector providers as new lazy adapters and fields under the existing observation/event evidence shape; do not merge the safety adapter seam into `app.detector.Detector`.

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
| `SAFETY_ENABLED` | `true` | Enables safety processing |
| `SAFETY_SAMPLE_EVERY_N_FRAMES` | `3` | Socket sampling interval |
| `DETECTOR`, `FACE_DETECTOR`, `FACE_EMBEDDER`, `VLM` | `mock` | Adapter switches |
| `FACE_EMBEDDING_KEY` | none | Durable Fernet key; a process-local key is used otherwise |
| `FRAME_IMAGE_DIR` | `./data/frames` | Local image root |
| `ALLOW_LOCAL_PATH_INGEST` | `false` | Enables development-only JSON path ingestion |

## Layout

```text
app/protocol.py   /ws/frames messages and the binary frame envelope, mirroring packages/shared
app/tokens.py     device token verification, mirroring packages/shared/src/device-token.ts
app/store.py      the write path: sessions, sightings, snapshots, the description job queue
app/detector.py   the Detector protocol and NullDetector
app/safety/       face enrollment, safety adapters, rules, VLM, persistence, and routes
app/main.py       the FastAPI app: sockets, health, and safety HTTP routes
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
