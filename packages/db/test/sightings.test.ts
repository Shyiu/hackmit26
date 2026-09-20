import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedObservation } from "../src/observations";
import { newTenant, openTestDb } from "./helpers";

const HOUR_MS = 60 * 60 * 1000;

describe("sightings.lastDescribed", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("skips a newer sighting the vision model hasn't described yet", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });

    const { sighting: described } = await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: keys._id,
      label: "keys",
      lastSeenAt: new Date(Date.now() - 2 * HOUR_MS),
      state: "resting",
      description: { status: "ready", sentence: "on the kitchen counter", room: "kitchen" },
    });
    await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: keys._id,
      label: "keys",
      lastSeenAt: new Date(),
      state: "resting",
      description: { status: "pending" },
    });

    const result = await tenant.sightings.lastDescribed(keys._id);
    expect(result?._id.equals(described._id)).toBe(true);
    expect(result?.sentence).toBe("on the kitchen counter");
  });

  it("returns the newer described sighting once it's the latest one described", async () => {
    const tenant = await newTenant(env.db);
    const wallet = await tenant.items.create({ name: "wallet" });

    await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: wallet._id,
      label: "wallet",
      lastSeenAt: new Date(Date.now() - 2 * HOUR_MS),
      state: "resting",
      description: { status: "ready", sentence: "on the hallway table", room: "hallway" },
    });
    const { sighting: newest } = await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: wallet._id,
      label: "wallet",
      lastSeenAt: new Date(),
      state: "resting",
      description: { status: "ready", sentence: "on the kitchen counter", room: "kitchen" },
    });

    const result = await tenant.sightings.lastDescribed(wallet._id);
    expect(result?._id.equals(newest._id)).toBe(true);
    expect(result?.sentence).toBe("on the kitchen counter");
  });

  it("returns null when nothing has ever been described", async () => {
    const tenant = await newTenant(env.db);
    const glasses = await tenant.items.create({ name: "glasses" });
    await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: glasses._id,
      label: "glasses",
      lastSeenAt: new Date(),
      state: "resting",
      description: { status: "failed" },
    });

    expect(await tenant.sightings.lastDescribed(glasses._id)).toBeNull();
  });
});
