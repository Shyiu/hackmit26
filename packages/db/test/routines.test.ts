import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newTenant, openTestDb } from "./helpers";

describe("routines", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;

  beforeAll(async () => {
    env = await openTestDb();
  });

  afterAll(() => env.close());

  it("creates, lists, and updates routines", async () => {
    const tenant = await newTenant(env.db);
    const routine = await tenant.routines.create({
      name: "Morning",
      trigger: { kind: "time", at: "08:00" },
      text: "Good morning.",
    });
    expect((await tenant.routines.list()).map(({ name }) => name)).toEqual(["Morning"]);
    expect((await tenant.routines.get(routine._id))?._id.equals(routine._id)).toBe(true);

    const updated = await tenant.routines.update(routine._id, {
      active: false,
      trigger: { kind: "leaving", itemName: "keys", windowMinutes: 10 },
    });
    expect(updated?.active).toBe(false);
    expect(updated?.trigger).toEqual({ kind: "leaving", itemName: "keys", windowMinutes: 10 });
  });

  it("marks a routine fired conditionally", async () => {
    const tenant = await newTenant(env.db);
    const routine = await tenant.routines.create({
      name: "Medication",
      trigger: { kind: "time", at: "21:00" },
      text: "Take medication.",
    });

    const first = await tenant.routines.markFired(routine._id, null);
    expect(first?.lastFiredAt).toBeInstanceOf(Date);
    expect(await tenant.routines.markFired(routine._id, null)).toBeNull();
    expect(await tenant.routines.markFired(routine._id, first?.lastFiredAt ?? null)).not.toBeNull();

    await tenant.routines.update(routine._id, { active: false });
    const latest = await tenant.routines.get(routine._id);
    expect(latest?.lastFiredAt).not.toBeNull();
    expect(await tenant.routines.markFired(routine._id, latest?.lastFiredAt ?? null)).toBeNull();
  });
});
