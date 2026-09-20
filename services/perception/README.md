# Perception service

Takes JPEG frames from the headset page over a WebSocket, runs tracked-item and face adapters, and writes capture sessions, sightings, and frame observations to MongoDB. The design is in the root README under "Perception pipeline".

## Status

The frame socket, device tokens, capture sessions, the YOLOE-26 detector, the tracker that turns detections into sightings, and the MongoDB write path in `app/store.py` work and are tested. Without the model assets the service boots with `NullDetector`, which finds nothing. The vision model that describes keyframes is M1. `WS /ws/debug` is a stub. `POST /config/classes` (api-scope token) re-reads the wearer's active items and swaps in the new class prompts for every open frame socket of that wearer; `/health` lists the loaded class-list version per wearer. Face enrollment and matching run behind mock adapters by default; their real models are optional extras, loaded lazily.

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

## The YOLOE-26 detector

`uv sync` alone installs no model stack, and `DETECTOR=auto` (the default) runs `NullDetector` unless both Ultralytics and the checkpoint are present. Before a demo, install the extra and fetch the two assets while you still have network. The checkpoint is about 30 MB; the MobileCLIP2 text encoder that `set_classes` runs is about 250 MB, and Ultralytics also pulls its CLIP fork from GitHub the first time:

```bash
cd services/perception
uv sync --extra yoloe                        # ultralytics 8.4.145 and torch; on a CPU box first
                                             # `uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`
uv run python -c '
from ultralytics import YOLOE
model = YOLOE("yoloe-26s-seg.pt")           # downloads the checkpoint into the working directory
model.set_classes(["keys", "wallet"])        # downloads the CLIP fork and mobileclip2_b.ts
'
uv run uvicorn app.main:app --port 8000      # /health says "detector": "yoloe"
```

Both files land in the working directory, next to `YOLOE_MODEL`. Keep them there or point `YOLOE_MODEL` at the checkpoint; `DETECTOR=yoloe` fails to start rather than falling back, so a demo box can't silently run the null detector. Use the `-seg.pt` checkpoints, not `-seg-pf.pt`: the prompt-free ones can't take the wearer's item names.

The class names are each active item's `detectorPrompts` (falling back to its name), read when the socket opens and re-read every `PROMPT_REFRESH_SECONDS`. Setting classes runs the text encoder once per distinct prompt list, about 1.5 s on CPU. Frames whose Laplacian variance is under `BLUR_THRESHOLD` are unusable: they get an empty `detections` reply and don't count toward confirming a sighting.

Measured on this repo's dev box, 8 vCPU Intel Xeon Platinum 8559C, no GPU, `yoloe-26s-seg.pt`, 15 prompts, 1280x720 JPEG in, torch 2.14 CPU, 20 frames after warm-up: median 66 ms at `YOLOE_IMAGE_SIZE=640` (15 fps), 94 ms at 960 (10.7 fps). Either is faster than the 3 fps the phone sends, so `FRAME_STRIDE=1` and the newest-frame-wins queue drops nothing under normal load.

## Test

```bash
pnpm db:up                  # from the repo root: MongoDB on 127.0.0.1:27017
uv run pytest -q
```

The store and app tests run against a real MongoDB. Each test module gets a fresh database with every validator (`validationAction: "error"`) and index from `packages/db/generated/mongo-schema.json`, so a write the web side's schema would reject fails the test. The database is dropped afterwards. If MongoDB isn't reachable those tests fail and say to run `pnpm db:up`. They don't skip.

## Safety pipeline

Safety analysis runs in a worker thread, on a worker task of its own, so neither the frame socket nor the item detector waits for it. Every live frame is offered to it and it takes the newest one. Faces go first: the frame is decoded, faces are found and matched against the wearer's own encrypted enrollments, and a `faces` message goes back on the socket. Every `SAFETY_SAMPLE_EVERY_N_FRAMES`th frame is persisted as a `frame_observations` document, and so is any frame whose analysis failed.

The default mock path needs no model weights. Configure the service with lowercase settings fields through uppercase environment variables:

| Adapter | Default | Optional installation |
|---|---|---|
| Face detector/embedder | `FACE_DETECTOR=mock`, `FACE_EMBEDDER=mock` | `uv sync --extra faces` for InsightFace/ONNX |
| YOLOE | off | `uv sync --extra yoloe`; Ultralytics is AGPL-3.0 |

InsightFace code is MIT, while its model packages are intended for non-commercial research use. YOLOE/Ultralytics is AGPL-3.0; a network-served application using it must satisfy the AGPL or use an Ultralytics enterprise licence. Keep it off for the hackathon unless licensing is reviewed.

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
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{}' http://localhost:8000/config/classes
```

### Face recognition

```bash
uv sync --extra faces      # InsightFace and onnxruntime; the first boot downloads buffalo_l, about 280 MB
# in .env: FACE_DETECTOR=insightface, FACE_EMBEDDER=insightface, and a FACE_EMBEDDING_KEY
uv run python scripts/enroll_face.py --name Maria --relation daughter --consented-by Maria a.jpg b.jpg
uv run python scripts/enroll_face.py --list
uv run python scripts/bench_faces.py me.jpg    # time the face pass across models, sizes, providers
```

A plain `uv sync` uninstalls the extra again; `pnpm start` syncs with `--inexact` so it survives. The mock adapters find no face in a camera frame and can't match a person, so nothing is recognized until both switches say `insightface`.

While a face is in view, each analyzed frame answers with `{"type":"faces","v":1,"seq":…,"faces":[…]}`, and one empty list follows when the last face leaves. Each face has `personId`, `name`, and `relation` (all null for someone not enrolled), a normalized `bbox`, the detector's `confidence`, and `matchConfidence`. The schema is `facesMessageSchema` in `packages/shared`. The message can land before or after the same frame's `detections`. A face is named when its best cosine similarity to a person's reference photos reaches `FACE_MATCH_THRESHOLD` and beats the next person by 0.05. People are only scored against embeddings made by the model that is running, so switching `INSIGHTFACE_MODEL` means enrolling again.

What keeps it fast: detection and embedding share one InsightFace pass, and the pack's landmark and age models are never loaded. `FACE_PROVIDERS=auto` runs on CoreML or CUDA when onnxruntime has one. The wearer's decrypted gallery is cached in the process, dropped on every enroll and delete, and scored in one matrix product. On an M-series Mac, `buffalo_l` at 640 takes about 14 ms for a 640 px frame with four faces (94 ms on CPU alone), and a 1280 px frame sent over the socket comes back named in 35 to 50 ms. `FACE_DET_SIZE=320` and `INSIGHTFACE_MODEL=buffalo_s` are the next steps down if the host has no accelerator.

Enroll people with `POST /people` and multipart fields `name`, `consentedBy`, optional `relation`, and one or more `photos`. Each photo must contain exactly one face. Face embeddings are encrypted at rest and are never returned by the API. Raw images stay under `FRAME_IMAGE_DIR`; only object keys are stored in MongoDB. Phone photos are turned upright from their EXIF flag first. Obtain explicit consent before enrollment and apply the configured retention window. Set a durable `FACE_EMBEDDING_KEY`: without one the key lasts as long as the process, and a person enrolled under another key is skipped with a warning until they are enrolled again. The route needs a device token with `api` scope; the web app mints one with `mintDeviceToken({ scope: "api" })`, and `scripts/enroll_face.py` signs its own.

## Extension points

The mock adapters are deterministic and need no model weights. Add new face providers as lazy adapters behind the existing protocols; do not merge the safety adapter seam into `app.detector.Detector`.

`tests/test_contract.py` and `tests/test_tokens.py` run the shared fixtures in `packages/shared/fixtures/`, the same files the zod tests use.

## Environment

| Variable | Default | What it's for |
|---|---|---|
| `MONGODB_URI` | required | |
| `MONGODB_DB` | `memory_glasses` | |
| `DEVICE_TOKEN_SECRET` | required | Verifies frame socket tokens. The web app's value, 32 characters or more |
| `OPENAI_API_KEY` | none | The description worker. Unused until M1 |
| `WORKER_ID` | hostname and pid | Lease owner on claimed description jobs |
| `DETECTOR` | `auto` | `auto`, `null` or `yoloe`. `auto` runs YOLOE only when its assets are already on disk |
| `YOLOE_MODEL` | `yoloe-26s-seg.pt` | Checkpoint path |
| `YOLOE_IMAGE_SIZE` | `640` | Inference size. 960 is slower and finds smaller things |
| `YOLOE_DEVICE` | Ultralytics' choice | `cpu`, `cuda:0`, `mps` |
| `DETECTOR_CONFIDENCE` | `0.25` | Boxes below this never leave the detector |
| `BLUR_THRESHOLD` | `40` | Laplacian variance under which a frame is unusable. `0` turns it off |
| `FRAME_STRIDE` | `1` | Run the detector on every Nth live frame |
| `PROMPT_REFRESH_SECONDS` | `30` | How often a live socket re-reads the wearer's items |
| `CONFIRM_FRAMES`, `CONFIRM_WINDOW_SECONDS` | `3`, `2` | Usable frames within a window before a sighting opens |
| `REFRESH_INTERVAL_MS`, `TRACK_LOST_SECONDS` | `500`, `3` | Snapshot refresh rate; how long unseen before a track closes |
| `TRACK_MATCH_IOU` | `0.3` | Minimum overlap to keep a track on a detection |
| `MONGODB_TEST_URI` | `mongodb://127.0.0.1:27017/?directConnection=true` | Tests only |
| `SAFETY_ENABLED` | `true` | Enables safety processing |
| `SAFETY_SAMPLE_EVERY_N_FRAMES` | `3` | How often an analyzed frame is stored. Every live frame is analyzed |
| `FACE_DETECTOR`, `FACE_EMBEDDER` | `mock` | Face adapter switches |
| `FACE_EMBEDDING_KEY` | none | Durable Fernet key; a process-local key is used otherwise |
| `INSIGHTFACE_MODEL` | `buffalo_l` | The model pack. `buffalo_s` is smaller and faster |
| `FACE_PROVIDERS` | `auto` | onnxruntime providers, comma separated. `auto` takes CUDA or CoreML, else CPU |
| `FACE_DET_SIZE`, `FACE_MAX_PER_FRAME` | `640`, `4` | Detector input size; how many of the largest faces are embedded |
| `FACE_MATCH_THRESHOLD`, `FACE_MIN_CONFIDENCE` | `0.45`, `0.6` | Similarity needed to name a face; detector confidence before an unknown face is flagged |
| `FACE_GALLERY_TTL_S` | `60` | How long a wearer's decrypted gallery is cached |
| `FRAME_IMAGE_DIR` | `./data/frames` | Local image root |
| `ALLOW_LOCAL_PATH_INGEST` | `false` | Enables development-only JSON path ingestion |

## Layout

```text
app/protocol.py   /ws/frames messages and the binary frame envelope, mirroring packages/shared
app/tokens.py     device token verification, mirroring packages/shared/src/device-token.ts
app/store.py      the write path: sessions, sightings, snapshots, the description job queue
app/detector.py   the Detector protocol, NullDetector, and YoloeDetector (Ultralytics YOLOE-26)
app/tracker.py    ByteTrack-style association per capture session, the confirmation rule, sighting writes
app/safety/       face enrollment, safety adapters, rules, VLM, persistence, and routes
app/main.py       the FastAPI app: /ws/frames, /ws/debug, /health, /config/classes, safety routes
```

## The frame socket

1. The page opens `/ws/frames` and sends `hello` with a token of scope `frames`. A bad token gets an `unauthorized` error and close code 4401. A token naming a device is also refused once that device is revoked or its `tokenVersion` moves past the token's.
2. The service opens a capture session and answers `session`, paused.
3. `capture` switches between live and paused. Pausing cancels the wearer's queued description jobs, and frames that arrive while paused are dropped unread.
4. While live, each binary message is a frame: a 4-byte big-endian header length, the header as JSON, then the JPEG. The service keeps one pending frame per connection, newest wins, and answers `detections` with that frame's `seq`. A frame that gets replaced before the worker takes it, or that falls between `FRAME_STRIDE` steps, counts as dropped and gets no reply. A `seq` that doesn't increase is rejected.
5. The detector runs in a worker thread, one frame per connection at a time, and its detections go back only on this socket. Nothing else sees the frames.
6. On disconnect the session ends, which closes the session's open sightings and cancels queued description jobs.

## From detections to sightings

`app/tracker.py` keeps one `SightingTracker` per connection, so track ids are local to the capture session. Each usable frame's detections are matched to tracks of the same item by IoU, ByteTrack style: confident boxes (≥ 0.5) first, then what's left of the tracks against faint boxes (0.1 to 0.5), which keeps a track alive through a badly lit frame but never starts one. An unmatched confident box starts a track.

- A track is confirmed, and a sighting opened through `ObservationStore.open_sighting`, once it has `CONFIRM_FRAMES` hits within `CONFIRM_WINDOW_SECONDS`. One noisy frame moves nothing. The sighting's `eventId` is `<sessionId>:<trackId>`, so a replayed open is a no-op.
- While it stays in view the sighting is refreshed at most every `REFRESH_INTERVAL_MS`, with the frame's normalized capture time and `seq`, which the store uses to ignore out-of-order frames.
- `TRACK_LOST_SECONDS` without a usable observation closes the track and its sighting. Ending the session closes them all.

## How the write path keeps order

Late and replayed writes can't undo newer evidence:

- A sighting is upserted on its `eventId`, so a replay changes nothing.
- It becomes the item's snapshot only if it was seen later than the current one, through a compare-and-set on the item's `observationVersion`.
- A description reaches the item only while the item still shows the same version, sighting and keyframe revision. Otherwise it only enriches the old sighting, and the item's last resting spot if that is still the described keyframe.
- Snapshot writes leave the item's `updatedAt` alone. It marks caregiver edits, and the web app refuses a save when it moved.
- A worker finishes only the attempt it claimed. The job's `attempts` count is the fencing token, and `runAfter` doubles as the lease expiry.

## Description worker

`app/description_worker.py` runs as a background task in the same process. It claims one due job at a time, loads the keyframe from `FRAME_IMAGE_DIR`, and sends it with the box and the item's name to the vision model (`app/vision.py`, `OPENAI_API_KEY` or `VLM_API_KEY`; without a key `MockDescriptionVLM` answers `unknown`). The model returns room, surface, relation, state, the location fragment, nearby objects, and `item_visible`. A box the model cannot confirm as the named item is recorded as state `unknown`, so the wearer hears "I could not tell where" rather than a description of the wrong object.
