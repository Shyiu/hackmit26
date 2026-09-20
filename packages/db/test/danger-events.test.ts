import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDangerEvent } from "../src/observations";
import { fixedClock, newTenant, openTestDb } from "./helpers";

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * 60 * MINUTE;

describe("danger events", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("lists newest first and filters by status", async () => {
    const tenant = await newTenant(env.db);
    const now = Date.now();
    const older = await seedDangerEvent(env.db, {
      patientId: tenant.patientId,
      kind: "hot_surface_visible",
      lastSeenAt: new Date(now - 10 * MINUTE),
    });
    const newer = await seedDangerEvent(env.db, {
      patientId: tenant.patientId,
      kind: "unknown_face",
      status: "dismissed",
      lastSeenAt: new Date(now - MINUTE),
    });

    const all = await tenant.dangerEvents.listRecent();
    expect(all.map((event) => event._id.toHexString())).toEqual([newer._id.toHexString(), older._id.toHexString()]);
    const open = await tenant.dangerEvents.listRecent({ status: "open" });
    expect(open.map((event) => event._id.toHexString())).toEqual([older._id.toHexString()]);
    expect(await tenant.dangerEvents.countOpen()).toBe(1);
    expect((await tenant.dangerEvents.get(older._id))?.kind).toBe("hot_surface_visible");
  });

  it("acknowledges an open event once", async () => {
    const clock = fixedClock(new Date("2026-09-01T12:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now });
    const event = await seedDangerEvent(env.db, {
      patientId: tenant.patientId,
      kind: "weapon_visible",
      lastSeenAt: new Date("2026-09-01T11:58:00Z"),
    });

    const acknowledged = await tenant.dangerEvents.acknowledge(event._id, { by: "caregiver-1" });
    expect(acknowledged?.status).toBe("acknowledged");
    expect(acknowledged?.acknowledgedBy).toBe("caregiver-1");
    expect(acknowledged?.acknowledgedAt?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(acknowledged?.updatedAt?.toISOString()).toBe("2026-09-01T12:00:00.000Z");

    expect(await tenant.dangerEvents.acknowledge(event._id, { by: "caregiver-2" })).toBeNull();
    expect((await tenant.dangerEvents.get(event._id))?.acknowledgedBy).toBe("caregiver-1");
    expect(await tenant.dangerEvents.countOpen()).toBe(0);
  });

  it("won't acknowledge a dismissed or closed event", async () => {
    const tenant = await newTenant(env.db);
    for (const status of ["dismissed", "escalated", "closed"] as const) {
      const event = await seedDangerEvent(env.db, {
        patientId: tenant.patientId,
        kind: "hazard_visible",
        status,
        lastSeenAt: new Date(),
      });
      expect(await tenant.dangerEvents.acknowledge(event._id, { by: "caregiver" })).toBeNull();
      expect((await tenant.dangerEvents.get(event._id))?.status).toBe(status);
    }
  });

  it("hides expired events from the list", async () => {
    const clock = fixedClock(new Date("2026-09-01T12:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now });
    await seedDangerEvent(env.db, {
      patientId: tenant.patientId,
      kind: "hazard_visible",
      lastSeenAt: new Date("2026-09-01T11:00:00Z"),
      retentionDays: 1,
    });
    expect(await tenant.dangerEvents.listRecent()).toHaveLength(1);
    clock.advance(2 * DAY_MS);
    expect(await tenant.dangerEvents.listRecent()).toEqual([]);
  });
});
