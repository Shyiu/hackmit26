import { newId, type PatientId, type RoutineDoc, type RoutineId } from "@memory-glasses/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getNotifications } from "@/app/api/notifications/route";
import { POST as postRoutine } from "@/app/api/routines/route";
import { call, deviceToken, newHousehold, openRouteDb, apiClaims } from "./helpers";
import { dueRoutines, localClock } from "@/lib/server/routines";

function routine(overrides: Partial<RoutineDoc> = {}): RoutineDoc {
  const now = new Date("2026-09-20T15:00:00Z");
  return {
    _id: newId<RoutineId>(),
    patientId: newId<PatientId>(),
    active: true,
    name: "Routine",
    trigger: { kind: "time", at: "10:00" },
    text: "Take medication.",
    lastFiredAt: null,
    cooldownMinutes: 120,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("routine evaluator", () => {
  it("computes local clock values and due time routines", () => {
    const now = new Date("2026-09-20T15:00:00Z");
    expect(localClock(now, "UTC")).toEqual({ dayKey: "2026-09-20", minutes: 900 });
    expect(dueRoutines([routine()], now, "UTC")).toHaveLength(1);
    expect(dueRoutines([routine({ trigger: { kind: "time", at: "16:00" } })], now, "UTC")).toHaveLength(0);
    expect(
      dueRoutines([routine({ lastFiredAt: new Date("2026-09-20T14:00:00Z") })], now, "UTC"),
    ).toHaveLength(0);
    expect(
      dueRoutines([routine({ lastFiredAt: new Date("2026-09-19T14:00:00Z") })], now, "UTC"),
    ).toHaveLength(1);
    expect(
      dueRoutines(
        [routine({ trigger: { kind: "time", at: "00:05" }, lastFiredAt: new Date("2026-09-19T23:58:00Z") })],
        new Date("2026-09-20T00:10:00Z"),
        "UTC",
      ),
    ).toHaveLength(0);
    expect(
      dueRoutines(
        [routine({ trigger: { kind: "time", at: "00:05" }, lastFiredAt: new Date("2026-09-19T23:58:00Z"), cooldownMinutes: 0 })],
        new Date("2026-09-20T00:10:00Z"),
        "UTC",
      ),
    ).toHaveLength(1);
    expect(dueRoutines([routine({ active: false })], now, "UTC")).toHaveLength(0);
    expect(
      dueRoutines([routine({ trigger: { kind: "leaving", itemName: "keys", windowMinutes: 10 } })], now, "UTC"),
    ).toHaveLength(0);
    const zoneNow = new Date("2026-09-20T01:30:00Z");
    expect(dueRoutines([routine({ trigger: { kind: "time", at: "21:00" } })], zoneNow, "America/New_York")).toHaveLength(1);
    expect(dueRoutines([routine({ trigger: { kind: "time", at: "21:00" } })], zoneNow, "UTC")).toHaveLength(0);
  });
});

describe("routine routes", () => {
  let env: Awaited<ReturnType<typeof openRouteDb>>;
  let household: Awaited<ReturnType<typeof newHousehold>>;

  beforeAll(async () => {
    env = await openRouteDb();
    household = await newHousehold(env.db);
  });

  afterAll(() => env.close());

  it("fires a routine once for a device poll, including concurrent polls", async () => {
    const at = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(Date.now() - 60_000));
    const first = await call(postRoutine, {
      path: "/api/routines",
      body: { name: "Test routine", trigger: { kind: "time", at }, text: "A routine message." },
      auth: { cookie: household.cookie },
    });
    expect(first.status).toBe(201);

    const token = await deviceToken(apiClaims({ patientId: household.patient._id, deviceId: household.device._id }));
    const auth = { bearer: token };
    const firstPoll = await call(getNotifications, { path: "/api/notifications", auth });
    expect(firstPoll.status).toBe(200);
    expect((await firstPoll.json()).notification.kind).toBe("proactive_reminder");
    expect((await household.repos.routines.list())[0].lastFiredAt).toBeInstanceOf(Date);
    expect((await household.repos.notifications.listRecent()).filter((item) => item.kind === "proactive_reminder")).toHaveLength(1);
    const secondPoll = await call(getNotifications, { path: "/api/notifications", auth });
    expect((await secondPoll.json()).notification.kind).toBe("proactive_reminder");
    expect((await household.repos.notifications.listRecent()).filter((item) => item.kind === "proactive_reminder")).toHaveLength(1);

    const second = await household.repos.routines.create({
      name: "Concurrent routine",
      trigger: { kind: "time", at },
      text: "Only once.",
    });
    expect(second.active).toBe(true);
    await Promise.all([
      call(getNotifications, { path: "/api/notifications", auth }),
      call(getNotifications, { path: "/api/notifications", auth }),
    ]);
    expect((await household.repos.notifications.listRecent()).filter((item) => item.kind === "proactive_reminder")).toHaveLength(2);
  });
});
