import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type ItemId } from "../src/ids";
import { collection } from "../src/registry";
import { fixedClock, newTenant, openTestDb } from "./helpers";

const SCENE = "room-demo";
const T0 = new Date("2026-09-20T12:00:00Z");
const MINUTE = 60_000;

describe("scan pins", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("places a pin by hand and moves it without making a second one", async () => {
    const clock = fixedClock(T0);
    const tenant = await newTenant(env.db, { now: clock.now });
    const keys = await tenant.items.create({ name: "keys" });

    const placed = await tenant.scanPins.setPosition({ itemId: keys._id, sceneId: SCENE, position: [1, 0.5, -2], source: "manual" });
    expect(placed).toMatchObject({ position: [1, 0.5, -2], observation: null, source: "manual", seenAt: T0, updatedAt: T0 });

    clock.advance(MINUTE);
    const moved = await tenant.scanPins.setPosition({ itemId: keys._id, sceneId: SCENE, position: [0, 0, 0], source: "manual" });
    expect(moved?._id.equals(placed!._id)).toBe(true);
    expect(moved).toMatchObject({ position: [0, 0, 0], seenAt: T0, updatedAt: clock.now() });
    expect(await tenant.scanPins.listByScene(SCENE)).toHaveLength(1);
  });

  it("records an observation, then takes a position only for that frame", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const at = { itemId: keys._id, sceneId: "live-1" };

    const seen = await tenant.scanPins.recordObservation({ ...at, frame: "s0/000012.jpg", u: 0.25, v: 1, seenAt: T0 });
    expect(seen).toMatchObject({ position: null, observation: { frame: "s0/000012.jpg", u: 0.25, v: 1 }, source: "slam", seenAt: T0 });

    expect(await tenant.scanPins.setPosition({ ...at, position: [9, 9, 9], source: "slam", frame: "s0/000011.jpg" })).toBeNull();
    const solved = await tenant.scanPins.setPosition({ ...at, position: [1, 2, 3], source: "slam", frame: "s0/000012.jpg" });
    expect(solved).toMatchObject({ position: [1, 2, 3], source: "slam" });

    // A solve for a frame on a pin that doesn't exist writes nothing.
    const wallet = await tenant.items.create({ name: "wallet" });
    expect(
      await tenant.scanPins.setPosition({ itemId: wallet._id, sceneId: "live-1", position: [1, 2, 3], source: "slam", frame: "s0/000012.jpg" }),
    ).toBeNull();
    expect(await tenant.scanPins.listByItem(wallet._id)).toEqual([]);
  });

  it("keeps the position when the same frame comes again and clears it on a new frame", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const at = { itemId: keys._id, sceneId: "live-1" };

    await tenant.scanPins.recordObservation({ ...at, frame: "s0/000012.jpg", u: 0.2, v: 0.2, seenAt: T0 });
    await tenant.scanPins.setPosition({ ...at, position: [1, 2, 3], source: "manual" });

    const again = await tenant.scanPins.recordObservation({ ...at, frame: "s0/000012.jpg", u: 0.3, v: 0.3, seenAt: T0 });
    expect(again).toMatchObject({ position: [1, 2, 3], source: "manual", observation: { u: 0.3 } });

    const later = new Date(T0.getTime() + MINUTE);
    const next = await tenant.scanPins.recordObservation({ ...at, frame: "s0/000020.jpg", u: 0.5, v: 0.5, seenAt: later });
    expect(next).toMatchObject({ position: null, source: "slam", observation: { frame: "s0/000020.jpg" }, seenAt: later });
    expect(await tenant.scanPins.setPosition({ ...at, position: [4, 5, 6], source: "slam", frame: "s0/000012.jpg" })).toBeNull();
  });

  it("ignores an observation older than the stored one", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const at = { itemId: keys._id, sceneId: "live-1" };
    await tenant.scanPins.recordObservation({ ...at, frame: "s0/000020.jpg", u: 0.5, v: 0.5, seenAt: T0 });

    const stale = await tenant.scanPins.recordObservation({
      ...at,
      frame: "s0/000003.jpg",
      u: 0.1,
      v: 0.1,
      seenAt: new Date(T0.getTime() - MINUTE),
    });
    expect(stale.observation?.frame).toBe("s0/000020.jpg");
    expect(await tenant.scanPins.listByItem(keys._id)).toHaveLength(1);
  });

  it("treats a frame name that starts with $ as text", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const pin = await tenant.scanPins.recordObservation({ itemId: keys._id, sceneId: "live-1", frame: "$patientId", u: 0, v: 0, seenAt: T0 });
    expect(pin.observation?.frame).toBe("$patientId");
  });

  it("makes one pin when first observations race", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const pins = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        tenant.scanPins.recordObservation({
          itemId: keys._id,
          sceneId: "live-1",
          frame: `s0/${String(i).padStart(6, "0")}.jpg`,
          u: 0.5,
          v: 0.5,
          seenAt: new Date(T0.getTime() + i),
        }),
      ),
    );
    expect(new Set(pins.map((pin) => pin._id.toHexString())).size).toBe(1);
    const [stored] = await tenant.scanPins.listByItem(keys._id);
    expect(stored?.observation?.frame).toBe("s0/000007.jpg");
  });

  it("lists by scene and by item, newest first", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const wallet = await tenant.items.create({ name: "wallet" });
    await tenant.scanPins.recordObservation({ itemId: keys._id, sceneId: "live-1", frame: "a.jpg", u: 0, v: 0, seenAt: T0 });
    await tenant.scanPins.recordObservation({
      itemId: wallet._id,
      sceneId: "live-1",
      frame: "b.jpg",
      u: 0,
      v: 0,
      seenAt: new Date(T0.getTime() + MINUTE),
    });
    await tenant.scanPins.setPosition({ itemId: keys._id, sceneId: SCENE, position: [0, 1, 0], source: "manual" });

    const live = await tenant.scanPins.listByScene("live-1");
    expect(live.map((pin) => pin.itemId.toHexString())).toEqual([wallet._id.toHexString(), keys._id.toHexString()]);
    expect((await tenant.scanPins.listByItem(keys._id)).map((pin) => pin.sceneId).sort()).toEqual(["live-1", SCENE]);
  });

  it("never reads or moves another wearer's pins", async () => {
    const mine = await newTenant(env.db);
    const theirs = await newTenant(env.db);
    const keys = await theirs.items.create({ name: "keys" });
    await theirs.scanPins.recordObservation({ itemId: keys._id, sceneId: "live-1", frame: "a.jpg", u: 0, v: 0, seenAt: T0 });

    expect(await mine.scanPins.listByScene("live-1")).toEqual([]);
    expect(await mine.scanPins.listByItem(keys._id)).toEqual([]);
    expect(await mine.scanPins.setPosition({ itemId: keys._id, sceneId: "live-1", position: [1, 1, 1], source: "slam", frame: "a.jpg" })).toBeNull();
    expect((await theirs.scanPins.listByScene("live-1"))[0]?.position).toBeNull();
  });

  it("rejects a bad position in code and a bad source at the database", async () => {
    const tenant = await newTenant(env.db);
    const itemId = newId<ItemId>();
    await expect(
      tenant.scanPins.setPosition({ itemId, sceneId: SCENE, position: [0, Number.NaN, 0], source: "manual" }),
    ).rejects.toThrow(/position/);
    await expect(
      collection(env.db, "scanPins").updateOne(
        { patientId: tenant.patientId, itemId, sceneId: SCENE },
        // @ts-expect-error the validator is what's under test
        { $set: { source: "guess" } },
        { upsert: true },
      ),
    ).rejects.toThrow(/validation/i);
  });
});
