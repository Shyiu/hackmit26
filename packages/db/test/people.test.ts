import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedFrameObservation, seedPerson } from "../src/observations";
import { fixedClock, newTenant, openTestDb } from "./helpers";

const MINUTE = 60_000;

describe("people", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("lists newest first without embeddings", async () => {
    const tenant = await newTenant(env.db);
    const older = await seedPerson(env.db, { patientId: tenant.patientId, name: "Maria", createdAt: new Date(1_000) });
    const newer = await seedPerson(env.db, { patientId: tenant.patientId, name: "Sam", createdAt: new Date(2_000) });

    const people = await tenant.people.list();
    expect(people.map((person) => person._id.toHexString())).toEqual([newer._id.toHexString(), older._id.toHexString()]);
    expect(people.every((person) => !("faceEmbeddings" in person))).toBe(true);
    expect((await tenant.people.get(older._id))?.name).toBe("Maria");
  });

  it("renames, clears the relation, and removes", async () => {
    const tenant = await newTenant(env.db);
    const person = await seedPerson(env.db, { patientId: tenant.patientId, name: "Maria", relation: "daughter" });

    const renamed = await tenant.people.update(person._id, { name: "Marie" });
    expect(renamed?.name).toBe("Marie");
    expect(renamed?.relation).toBe("daughter");
    expect(renamed && "faceEmbeddings" in renamed).toBe(false);
    expect((await tenant.people.update(person._id, { relation: null }))?.relation).toBeNull();
    expect((await tenant.people.update(person._id, {}))?.name).toBe("Marie");

    expect(await tenant.people.remove(person._id)).toBe(true);
    expect(await tenant.people.remove(person._id)).toBe(false);
    expect(await tenant.people.get(person._id)).toBeNull();
  });

  it("never touches another wearer's people", async () => {
    const mine = await newTenant(env.db);
    const theirs = await newTenant(env.db);
    const person = await seedPerson(env.db, { patientId: theirs.patientId, name: "Maria" });

    expect(await mine.people.get(person._id)).toBeNull();
    expect(await mine.people.update(person._id, { name: "Nope" })).toBeNull();
    expect(await mine.people.remove(person._id)).toBe(false);
    expect((await theirs.people.get(person._id))?.name).toBe("Maria");
  });

  it("finds the most recently recognized person within the window", async () => {
    const clock = fixedClock(new Date("2026-09-01T12:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now });
    const maria = await seedPerson(env.db, { patientId: tenant.patientId, name: "Maria", relation: "daughter" });
    const sam = await seedPerson(env.db, { patientId: tenant.patientId, name: "Sam" });
    const now = clock.now().getTime();
    await seedFrameObservation(env.db, {
      patientId: tenant.patientId,
      capturedAt: new Date(now - 5 * MINUTE),
      faces: [{ personId: sam._id, matchConfidence: 0.7 }],
    });
    await seedFrameObservation(env.db, {
      patientId: tenant.patientId,
      capturedAt: new Date(now - 2 * MINUTE),
      faces: [{ personId: null, matchConfidence: null }, { personId: maria._id, matchConfidence: 0.61 }],
    });
    await seedFrameObservation(env.db, { patientId: tenant.patientId, capturedAt: new Date(now - MINUTE), faces: [] });

    const seen = await tenant.people.latestRecognized(10 * MINUTE);
    expect(seen).toEqual({ name: "Maria", relation: "daughter", seenAt: new Date(now - 2 * MINUTE) });
    expect(await tenant.people.latestRecognized(MINUTE)).toBeNull();

    const frames = await tenant.people.recentFramesWithFaces();
    expect(frames.map((frame) => frame.capturedAt.getTime())).toEqual([now - 2 * MINUTE, now - 5 * MINUTE]);
  });
});
