import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type CaregiverId } from "../src/ids";
import { fixedClock, newTenant, openTestDb } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

function subscription(endpoint: string) {
  return {
    caregiverId: newId<CaregiverId>(),
    endpoint,
    keys: { p256dh: "BP256dhKey", auth: "authKey" },
    userAgent: "Chrome",
  };
}

describe("push subscriptions", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("upserts by endpoint and lists a wearer's subscriptions", async () => {
    const tenant = await newTenant(env.db);
    const first = await tenant.pushSubscriptions.upsertByEndpoint(subscription("https://push.example/a"));
    const again = await tenant.pushSubscriptions.upsertByEndpoint({
      ...subscription("https://push.example/a"),
      keys: { p256dh: "newer", auth: "newer" },
    });
    await tenant.pushSubscriptions.upsertByEndpoint(subscription("https://push.example/b"));

    expect(again._id.equals(first._id)).toBe(true);
    expect(again.keys.p256dh).toBe("newer");
    const listed = await tenant.pushSubscriptions.listForPatient();
    expect(listed.map((s) => s.endpoint).sort()).toEqual(["https://push.example/a", "https://push.example/b"]);
  });

  it("moves an endpoint that re-subscribes for another wearer", async () => {
    const a = await newTenant(env.db);
    const b = await newTenant(env.db);
    await a.pushSubscriptions.upsertByEndpoint(subscription("https://push.example/shared"));
    await b.pushSubscriptions.upsertByEndpoint(subscription("https://push.example/shared"));

    expect(await a.pushSubscriptions.listForPatient()).toEqual([]);
    expect((await b.pushSubscriptions.listForPatient()).map((s) => s.endpoint)).toEqual(["https://push.example/shared"]);
  });

  it("deletes by endpoint only within the wearer", async () => {
    const a = await newTenant(env.db);
    const b = await newTenant(env.db);
    await a.pushSubscriptions.upsertByEndpoint(subscription("https://push.example/only-a"));

    expect(await b.pushSubscriptions.deleteByEndpoint("https://push.example/only-a")).toBe(false);
    expect(await a.pushSubscriptions.listForPatient()).toHaveLength(1);
    expect(await a.pushSubscriptions.deleteByEndpoint("https://push.example/only-a")).toBe(true);
    expect(await a.pushSubscriptions.listForPatient()).toEqual([]);
  });

  it("marks a subscription used and hides ones past their expiry", async () => {
    const clock = fixedClock(new Date("2026-09-01T12:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now });
    const sub = await tenant.pushSubscriptions.upsertByEndpoint(subscription("https://push.example/old"));
    expect(sub.lastUsedAt).toBeNull();

    clock.advance(100 * DAY_MS);
    await tenant.pushSubscriptions.markUsed(sub._id);
    expect((await tenant.pushSubscriptions.listForPatient())[0]?.lastUsedAt).toEqual(clock.now());

    clock.advance(181 * DAY_MS);
    expect(await tenant.pushSubscriptions.listForPatient()).toEqual([]);
  });
});
