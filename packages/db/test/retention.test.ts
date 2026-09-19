import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDocument } from "../src/errors";
import { newId, type DescriptionJobId } from "../src/ids";
import { seedObservation } from "../src/observations";
import { collection } from "../src/registry";
import { sweepExpired } from "../src/retention";
import { descriptionJobDocSchema } from "../src/schema/perception";
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
});
