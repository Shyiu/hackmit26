import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock, newTenant, openTestDb } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("notifications", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("shows one due notification at a time and marks it shown once", async () => {
    const tenant = await newTenant(env.db);
    const first = await tenant.notifications.create({ kind: "caregiver_message", text: "Lunch is at noon." });
    await tenant.notifications.create({ kind: "reminder", text: "Call Sam.", showAt: new Date(Date.now() + DAY_MS) });

    expect((await tenant.notifications.nextDue())?._id.equals(first._id)).toBe(true);
    expect((await tenant.notifications.markShown(first._id))?.status).toBe("shown");
    expect(await tenant.notifications.markShown(first._id)).toBeNull();
    expect(await tenant.notifications.nextDue()).toBeNull();
  });

  it("keeps a reminder dated in the past instead of creating it expired", async () => {
    const tenant = await newTenant(env.db, { retentionDays: 30 });
    const reminder = await tenant.notifications.create({
      kind: "reminder",
      text: "Take the umbrella.",
      showAt: new Date("1970-01-01T00:00:00Z"),
    });
    expect(reminder.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await tenant.notifications.nextDue())?._id.equals(reminder._id)).toBe(true);
  });

  it("won't mark an expired notification shown", async () => {
    const clock = fixedClock(new Date("2026-09-01T12:00:00Z"));
    const tenant = await newTenant(env.db, { now: clock.now, retentionDays: 1 });
    const message = await tenant.notifications.create({ kind: "caregiver_message", text: "Hello." });
    clock.advance(2 * DAY_MS);
    expect(await tenant.notifications.markShown(message._id)).toBeNull();
  });

  it("does not return lost alerts to the wearer", async () => {
    const tenant = await newTenant(env.db);
    await tenant.notifications.create({ kind: "lost_alert", text: "Outside the area.", createdBy: null });
    const message = await tenant.notifications.create({ kind: "caregiver_message", text: "Dinner at six." });

    expect((await tenant.notifications.nextDue())?._id.equals(message._id)).toBe(true);
  });
});
