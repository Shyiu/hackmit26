# Vision safety pipeline

This service processes one wearable-camera frame at a time (the MVP target is one
frame per second), stores the selected image in local disk or GridFS, and writes
detector, face-match, and alert records to MongoDB.

```text
image -> store -> decode -> object/face detection -> encrypted face match
       -> declarative safety rules -> optional one-call VLM visibility check
       -> observation + alerts in MongoDB
```

## Quickstart

```bash
cd services/vision
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
uvicorn vision_service.api:app --reload
```

With defaults, no model weights or external services are needed: MongoDB is
`mongomock://`, detectors and VLM are mocks, and images are stored in `data/images`.
Copy `.env.example` to `.env` to document local choices.

## MongoDB and adapters

Set `MONGODB_URI=mongodb://...` and `MONGODB_DB` for a real MongoDB deployment.
`python scripts/create_indexes.py` is idempotent. Select real adapters with
`DETECTOR=dfine|yoloe`, `FACE_DETECTOR=insightface`, `FACE_EMBEDDER=insightface`,
and `VLM=openai`; install the matching extras:

```bash
uv pip install -e ".[dfine]"   # torch + transformers (D-FINE, Apache-2.0)
uv pip install -e ".[yoloe]"   # ultralytics (YOLOE)
uv pip install -e ".[faces]"   # insightface + onnxruntime
```

D-FINE is the default-path real detector and is Apache-2.0. RF-DETR is also
Apache-2.0 and remains a possible future adapter. InsightFace code is MIT, but
its model packages are for non-commercial research use. YOLOE/Ultralytics is
AGPL-3.0: that license reaches the whole network-served application unless an
Ultralytics enterprise license is purchased. It is off by default and intended
for this hackathon only. Download model weights separately and keep them out of
the repository.

## API

```bash
# Health
curl http://localhost:8000/health
# Multipart ingest
curl -F file=@knife.png -F device_id=demo http://localhost:8000/ingest
# Local path ingest (dev setting only)
curl -H 'content-type: application/json' -d '{"path":"./knife.png"}' http://localhost:8000/ingest
# Enroll a consenting face
curl -F file=@face.png -F name='Caregiver' -F consent_granted_by='caregiver' \
  http://localhost:8000/face-profiles
curl http://localhost:8000/face-profiles
curl -X DELETE http://localhost:8000/face-profiles/PROFILE_ID
# Observations
curl 'http://localhost:8000/observations?device_id=demo&limit=50'
curl http://localhost:8000/observations/OBSERVATION_ID
# Alerts
curl 'http://localhost:8000/alerts?status=open'
curl http://localhost:8000/alerts/ALERT_ID
curl -X PATCH http://localhost:8000/alerts/ALERT_ID \
  -H 'content-type: application/json' -d '{"status":"acknowledged"}'
```

## Data model and alert semantics

The three MongoDB collections are `observations`, `faceProfiles`, and `alerts`.
Embeddings exist only in `faceProfiles`, encrypted with Fernet; API responses
never expose them. Observations retain profile IDs and match confidence, not
embeddings. Images are outside MongoDB in local storage or GridFS.

Alerts are single-frame observations and start `unverified`. A VLM may confirm
only that a listed object/event is visibly present; it cannot infer intent,
emotion, or an emergency. `single_frame` and `unverified` are intentionally
prominent: an alert is never proof that someone did something, and a pill
organizer sighting is not proof medication was taken.

## Privacy and security

Obtain informed consent before enrolling a face and protect `FACE_EMBEDDING_KEY`
with a secret manager. Without it, startup generates an ephemeral key and
enrolled embeddings will not survive a restart. Keep raw images out of logs,
set a retention/deletion policy for images and embeddings, and use encrypted
transport/storage. Do not expose this API publicly without authentication,
authorization, rate limits, and tenant isolation. The upstream product plan
calls for an approved demo area, visible capture state, and explicit pause.

## Evaluation and roadmap

```bash
python scripts/evaluate.py tests/fixtures/eval_sample \
  --labels tests/fixtures/eval_sample/labels.json --detector mock
```

The script reports per-category and overall precision/recall, false positives,
and average/P50/P95 processing time. Future temporal confirmation, pose, and
video action adapters can be added through `extensions` and new adapter
Protocols without restructuring top-level documents.
