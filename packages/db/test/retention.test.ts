import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDocument } from "../src/errors";
import {
  newId,
  type CaptureSessionId,
  type DescriptionJobId,
  type PatientId,
  type RecordingId,
} from "../src/ids";
import { seedObservation } from "../src/observations";
import { collection, collections, type CollectionKey } from "../src/registry";
import { sweepExpired } from "../src/retention";
import { captureSessionDocSchema, descriptionJobDocSchema } from "../src/schema/perception";
import { recordingDocSchema } from "../src/schema/recordings";
import { newTenant, openTestDb } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sweepExpired", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("deletes expired records and repairs what pointed at them", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const wallet = await tenant.items.create({ name: "wallet" });
    const ready = { status: "ready" as const, sentence: "on the counter", room: "kitchen" };

    const { sighting: old } = await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: keys._id,
      label: "keys",
      lastSeenAt: new Date(Date.now() - 31 * DAY_MS),
      state: "resting",
      description: ready,
    });
    await collection(env.db, "sightings").updateOne(
      { _id: old._id },
      { $set: { keyframeKey: "keyframes/old.jpg", thumbKey: "thumbs/old.jpg" } },
    );
    await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: wallet._id,
      label: "wallet",
      lastSeenAt: new Date(),
      state: "resting",
      description: ready,
    });
    const now = new Date();
    const job = (keyframeRevision: number, keyframeKey: string, status: "queued" | "superseded") =>
      parseDocument(descriptionJobDocSchema, {
        _id: newId<DescriptionJobId>(),
        patientId: tenant.patientId,
        itemId: keys._id,
        sightingId: old._id,
        observationVersion: 1,
        keyframeRevision,
        keyframeKey,
        bbox: [0.1, 0.1, 0.1, 0.1],
        status,
        attempts: 0,
        maxAttempts: 3,
        runAfter: now,
        leaseOwner: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
        expiresAt: new Date(now.getTime() + DAY_MS),
      });
    // A sharper frame replaced revision 1; only the job still knows its key.
    await collection(env.db, "descriptionJobs").insertMany([
      job(1, "keyframes/old-rev1.jpg", "superseded"),
      job(2, "keyframes/old.jpg", "queued"),
    ]);
    const expiredQuestion = await tenant.interactions.begin({
      requestId: "old",
      transcript: "keys?",
      askedAt: new Date(Date.now() - 31 * DAY_MS),
    });

    const removedKeys: string[] = [];
    const report = await sweepExpired(env.db, {
      deleteObjects: async (objectKeys) => {
        removedKeys.push(...objectKeys);
      },
    });

    expect(report.deleted.sightings).toBe(1);
    expect(report.deleted.descriptionJobs).toBe(2);
    expect(report.deleted.interactions).toBe(1);
    expect(report.clearedSnapshots).toBe(2);
    expect(removedKeys.sort()).toEqual(["keyframes/old-rev1.jpg", "keyframes/old.jpg", "thumbs/old.jpg"]);

    const storedKeys = await collection(env.db, "items").findOne({ _id: keys._id });
    expect(storedKeys?.lastSighting).toBeNull();
    expect(storedKeys?.lastRestingSighting).toBeNull();
    expect((await tenant.items.get(wallet._id))?.lastSighting?.sentence).toBe("on the counter");
    expect(await tenant.interactions.get(expiredQuestion.interaction._id)).toBeNull();

    const again = await sweepExpired(env.db);
    expect(again.clearedSnapshots).toBe(0);
    expect(Object.values(again.deleted).every((n) => n === 0)).toBe(true);
  });

  it("dry run reports the same counts and writes nothing", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const { sighting } = await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: keys._id,
      label: "keys",
      lastSeenAt: new Date(Date.now() - 31 * DAY_MS),
      state: "resting",
      description: { status: "ready", sentence: "on the hook", room: "hall" },
    });
    await collection(env.db, "sightings").updateOne(
      { _id: sighting._id },
      { $set: { keyframeKey: "keyframes/dry.jpg" } },
    );
    await insertRecording(env.db, tenant.patientId, {
      startedAt: new Date(Date.now() - 40 * DAY_MS),
      expiresAt: new Date(Date.now() - 10 * DAY_MS),
      keys: ["recordings/dry-0.webm", "recordings/dry-1.webm"],
    });

    const removedKeys: string[] = [];
    const lines: string[] = [];
    const report = await sweepExpired(env.db, {
      dryRun: true,
      log: (line) => lines.push(line),
      deleteObjects: async (objectKeys) => {
        removedKeys.push(...objectKeys);
      },
    });

    expect(report.dryRun).toBe(true);
    expect(report.deleted.sightings).toBe(1);
    expect(report.deleted.recordings).toBe(1);
    expect(report.clearedSnapshots).toBe(1);
    expect(report.objectKeys).toBe(3);
    expect(removedKeys).toEqual([]);
    expect(lines.some((line) => line.includes("would be deleted"))).toBe(true);

    expect(await collection(env.db, "sightings").countDocuments({ patientId: tenant.patientId })).toBe(1);
    expect(await collection(env.db, "recordings").countDocuments({ patientId: tenant.patientId })).toBe(1);
    const stored = await collection(env.db, "items").findOne({ _id: keys._id });
    expect(stored?.lastSighting?.sentence).toBe("on the hook");

    const real = await sweepExpired(env.db);
    expect(real.deleted.sightings).toBe(1);
    expect(real.deleted.recordings).toBe(1);
    expect(real.objectKeys).toBe(3);
  });

  it("honours a retention window the caregiver shortened after the records were written", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    // Written under the 30-day default: due to expire in 20 days.
    const { sighting: recent } = await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: keys._id,
      label: "keys",
      lastSeenAt: new Date(Date.now() - 10 * DAY_MS),
      state: "resting",
      description: { status: "ready", sentence: "by the door", room: "hall" },
    });
    const { sighting: today } = await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: keys._id,
      label: "keys",
      lastSeenAt: new Date(),
      state: "moving",
      description: { status: "pending" },
    });
    const oldQuestion = await tenant.interactions.begin({
      requestId: "old",
      transcript: "keys?",
      askedAt: new Date(Date.now() - 10 * DAY_MS),
    });
    const newQuestion = await tenant.interactions.begin({ requestId: "new", transcript: "keys?" });
    const recording = await insertRecording(env.db, tenant.patientId, {
      startedAt: new Date(Date.now() - 10 * DAY_MS),
      expiresAt: new Date(Date.now() + 20 * DAY_MS),
      keys: ["recordings/shortened.webm"],
    });

    // Another wearer with the same-age data keeps the default window.
    const other = await newTenant(env.db);
    const otherKeys = await other.items.create({ name: "keys" });
    await seedObservation(env.db, {
      patientId: other.patientId,
      itemId: otherKeys._id,
      label: "keys",
      lastSeenAt: new Date(Date.now() - 10 * DAY_MS),
      state: "resting",
      description: { status: "ready", sentence: "in the bowl", room: "kitchen" },
    });

    await sweepExpired(env.db);
    expect(await collection(env.db, "sightings").findOne({ _id: recent._id })).not.toBeNull();

    await tenant.patient.updateSettings({ retentionDays: 7 });
    const removedKeys: string[] = [];
    const report = await sweepExpired(env.db, {
      deleteObjects: async (objectKeys) => {
        removedKeys.push(...objectKeys);
      },
    });

    expect(report.deleted.sightings).toBe(1);
    expect(report.deleted.interactions).toBe(1);
    expect(report.deleted.recordings).toBe(1);
    expect(removedKeys).toEqual(["recordings/shortened.webm"]);
    expect(await collection(env.db, "sightings").findOne({ _id: recent._id })).toBeNull();
    expect(await collection(env.db, "sightings").findOne({ _id: today._id })).not.toBeNull();
    expect(await collection(env.db, "recordings").findOne({ _id: recording })).toBeNull();
    expect(await tenant.interactions.get(oldQuestion.interaction._id)).toBeNull();
    expect(await tenant.interactions.get(newQuestion.interaction._id)).not.toBeNull();
    const stored = await tenant.items.get(keys._id);
    expect(stored?.lastRestingSighting).toBeNull();
    expect(stored?.lastSighting?.sightingId.equals(today._id)).toBe(true);
    expect((await other.items.get(otherKeys._id))?.lastSighting?.sentence).toBe("in the bowl");
  });

  it("sweeps every collection that carries expiresAt", async () => {
    const tenant = await newTenant(env.db);
    const now = new Date();
    const past = new Date(now.getTime() - DAY_MS);
    await tenant.notifications.create({ kind: "caregiver_message", text: "Dinner at six" });
    await collection(env.db, "notifications").updateMany({ patientId: tenant.patientId }, { $set: { expiresAt: past } });
    await collection(env.db, "captureSessions").insertOne(
      parseDocument(captureSessionDocSchema, {
        _id: newId<CaptureSessionId>(),
        patientId: tenant.patientId,
        deviceId: null,
        source: "simulator",
        state: "ended",
        startedAt: past,
        updatedAt: past,
        endedAt: past,
        lastFrameAt: null,
        lastSeq: 0,
        framesReceived: 0,
        framesDropped: 0,
        expiresAt: past,
      }),
    );

    const report = await sweepExpired(env.db);
    expect(report.deleted.notifications).toBe(1);
    expect(report.deleted.captureSessions).toBe(1);
    for (const key of Object.keys(collections) as CollectionKey[]) {
      if (collections[key].expires) expect(report.deleted[key]).toBeDefined();
    }
  });
});

async function insertRecording(
  db: Db,
  patientId: PatientId,
  input: { startedAt: Date; expiresAt: Date; keys: string[] },
): Promise<RecordingId> {
  const doc = parseDocument(recordingDocSchema, {
    _id: newId<RecordingId>(),
    patientId,
    deviceId: null,
    sessionId: "rec-1",
    startedAt: input.startedAt,
    endedAt: input.startedAt,
    expiresAt: input.expiresAt,
    mimeType: "video/webm",
    width: 1280,
    height: 720,
    hasAudio: false,
    chunks: input.keys.map((key, seq) => ({ seq, startedAt: input.startedAt, durationMs: 10_000, key, bytes: 1 })),
  });
  await collection(db, "recordings").insertOne(doc);
  return doc._id;
}
