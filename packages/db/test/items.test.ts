import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError, InvalidInputError } from "../src/errors";
import { newId, type ItemId } from "../src/ids";
import { seedObservation } from "../src/observations";
import { collection } from "../src/registry";
import { locationStatus } from "../src/snapshot";
import { newTenant, openTestDb } from "./helpers";

describe("items", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("normalizes names into lookup keys and fills defaults", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: " Car Keys ", aliases: ["house-keys", "car keys", "Key ring"] });

    expect(keys.name).toBe("Car Keys");
    expect(keys.aliases).toEqual(["house-keys", "Key ring"]);
    expect(keys.lookupKeys).toEqual(["car keys", "house keys", "key ring"]);
    expect(keys.detectorPrompts).toEqual(["Car Keys"]);
    expect(keys.plural).toBe(true);
    expect(locationStatus(keys.lastSighting)).toBe("unseen");
  });

  it("bumps configVersion on every config write", async () => {
    const tenant = await newTenant(env.db);
    const before = (await tenant.patient.get())?.configVersion ?? -1;
    const wallet = await tenant.items.create({ name: "wallet" });
    await tenant.items.update(wallet._id, { aliases: ["billfold"] });
    expect((await tenant.patient.get())?.configVersion).toBe(before + 2);
  });

  it("replaces detector prompts, and an empty list resets to the item's name", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    expect((await tenant.items.get(keys._id))?.detectorPrompts).toEqual(["keys"]);

    await tenant.items.update(keys._id, { detectorPrompts: ["a small metal keychain"] });
    expect((await tenant.items.get(keys._id))?.detectorPrompts).toEqual(["a small metal keychain"]);

    // The stored schema requires at least one prompt, so [] resets to the name.
    await tenant.items.update(keys._id, { detectorPrompts: [] });
    expect((await tenant.items.get(keys._id))?.detectorPrompts).toEqual(["keys"]);
  });

  it("refuses a spoken name another active item already has", async () => {
    const tenant = await newTenant(env.db);
    await tenant.items.create({ name: "keys", aliases: ["key ring"] });

    await expect(tenant.items.create({ name: "house keys", aliases: ["Keys"] })).rejects.toThrow(ConflictError);
    await expect(tenant.items.create({ name: "Key-Ring" })).rejects.toThrow(/"key ring" already names another item/);
  });

  it("frees an archived item's names, and won't unarchive into a clash", async () => {
    const tenant = await newTenant(env.db);
    const oldKeys = await tenant.items.create({ name: "keys" });
    await tenant.items.setActive(oldKeys._id, false);
    await tenant.items.create({ name: "keys", aliases: ["new keys"] });

    await expect(tenant.items.setActive(oldKeys._id, true)).rejects.toThrow(ConflictError);
    expect((await tenant.items.list()).map((item) => item.name)).toEqual(["keys"]);
    expect(await tenant.items.list({ includeArchived: true })).toHaveLength(2);
  });

  it("refuses a save from a form loaded before someone else's save", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const loadedAt = keys.updatedAt;
    await tenant.items.update(keys._id, { aliases: ["house keys"], expectedUpdatedAt: loadedAt });

    await expect(
      tenant.items.update(keys._id, { aliases: ["key ring"], expectedUpdatedAt: loadedAt }),
    ).rejects.toThrow(/Someone else changed this item/);
    expect((await tenant.items.get(keys._id))?.aliases).toEqual(["house keys"]);
  });

  it("rejects names that can't be matched", async () => {
    const tenant = await newTenant(env.db);
    await expect(tenant.items.create({ name: "???" })).rejects.toThrow(InvalidInputError);
    await expect(tenant.items.create({ name: "the blue and white striped mug" })).rejects.toThrow(/longer than 4 words/);
  });

  describe("resolve", () => {
    it("finds an item by name or alias anywhere in the question", async () => {
      const tenant = await newTenant(env.db);
      const glasses = await tenant.items.create({ name: "glasses", aliases: ["reading glasses", "specs"] });

      const result = await tenant.items.resolve("Hey, where did I put my SPECS?");
      expect(result).toMatchObject({ kind: "match", matchedKey: "specs" });
      expect(result.kind === "match" && result.item._id.equals(glasses._id)).toBe(true);
    });

    it("prefers the longest match", async () => {
      const tenant = await newTenant(env.db);
      await tenant.items.create({ name: "keys" });
      await tenant.items.create({ name: "car keys" });

      const result = await tenant.items.resolve("where are my car keys");
      expect(result).toMatchObject({ kind: "match", matchedKey: "car keys" });
    });

    it("calls two equally good matches ambiguous", async () => {
      const tenant = await newTenant(env.db);
      await tenant.items.create({ name: "keys" });
      await tenant.items.create({ name: "wallet" });

      const result = await tenant.items.resolve("where are my keys and my wallet");
      expect(result.kind).toBe("ambiguous");
      expect(result.kind === "ambiguous" && result.items.map((item) => item.name).sort()).toEqual(["keys", "wallet"]);
    });

    it("finds nothing for unknown and archived items", async () => {
      const tenant = await newTenant(env.db);
      const mug = await tenant.items.create({ name: "mug" });
      await tenant.items.setActive(mug._id, false);

      expect(await tenant.items.resolve("where is my mug")).toEqual({ kind: "none", candidate: "mug" });
      expect(await tenant.items.resolve("where is my umbrella")).toEqual({ kind: "none", candidate: "umbrella" });
    });
  });

  it("never shows one wearer's items to another", async () => {
    const alice = await newTenant(env.db);
    const bob = await newTenant(env.db);
    const alicesKeys = await alice.items.create({ name: "keys" });

    // The same spoken name is fine across wearers.
    await bob.items.create({ name: "keys" });
    expect(await bob.items.get(alicesKeys._id)).toBeNull();
    expect(await bob.items.update(alicesKeys._id, { name: "stolen" })).toBeNull();
    const bobsView = await bob.items.resolve("where are my keys");
    expect(bobsView.kind === "match" && bobsView.item.patientId.equals(bob.patientId)).toBe(true);
  });

  it("hides snapshots whose sighting is past retention", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    await seedObservation(env.db, {
      patientId: tenant.patientId,
      itemId: keys._id,
      label: "keys",
      lastSeenAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      state: "resting",
      description: { status: "ready", sentence: "on the kitchen counter", room: "kitchen" },
      retentionDays: 30,
    });

    const stored = await collection(env.db, "items").findOne({ _id: keys._id });
    expect(stored?.lastSighting).not.toBeNull();
    expect((await tenant.items.get(keys._id))?.lastSighting).toBeNull();
  });

  it("recomputes history-derived usualSpots on demand", async () => {
    const tenant = await newTenant(env.db);
    const keys = await tenant.items.create({ name: "keys" });
    const base = { patientId: tenant.patientId, itemId: keys._id, label: "keys" };
    const kitchen = {
      status: "ready" as const,
      sentence: "on the kitchen counter, next to the coffee maker",
      room: "kitchen",
      surface: "counter",
      relation: "next to the coffee maker",
    };
    const now = Date.now();
    // An hour apart: past the merge gap, so each is its own placement.
    await seedObservation(env.db, { ...base, lastSeenAt: new Date(now - 3 * 3_600_000), state: "resting", description: kitchen });
    await seedObservation(env.db, { ...base, lastSeenAt: new Date(now - 2 * 3_600_000), state: "resting", description: kitchen });
    await seedObservation(env.db, {
      ...base,
      lastSeenAt: new Date(now - 3_600_000),
      state: "resting",
      description: { status: "ready", sentence: "on the hallway table", room: "hallway", surface: "table" },
    });

    const item = await tenant.items.recomputeUsualSpots(keys._id);
    expect(item?.usualSpots[0]).toEqual({
      sentence: kitchen.sentence,
      share: expect.closeTo(2 / 3),
      samples: 2,
      source: "history",
    });
    expect(item?.usualSpots[1]).toMatchObject({ sentence: "on the hallway table", samples: 1 });
    // A snapshot-like write: updatedAt doesn't move and no config bump.
    expect(item?.updatedAt.getTime()).toBe(keys.updatedAt.getTime());
    expect(await tenant.items.recomputeUsualSpots(newId<ItemId>())).toBeNull();
  });

  it("doesn't let another wearer's history into an item's usualSpots", async () => {
    const a = await newTenant(env.db);
    const b = await newTenant(env.db);
    const aKeys = await a.items.create({ name: "a-keys-" + randomUUID().slice(0, 6) });
    const bKeys = await b.items.create({ name: "b-keys-" + randomUUID().slice(0, 6) });
    const kitchen = { status: "ready" as const, sentence: "on the counter", room: "kitchen", surface: "counter" };
    for (let i = 3; i >= 1; i--) {
      await seedObservation(env.db, {
        patientId: b.patientId,
        itemId: bKeys._id,
        label: "keys",
        lastSeenAt: new Date(Date.now() - i * 3_600_000),
        state: "resting",
        description: kitchen,
      });
    }

    // A's item has no history of its own: B's sightings must not leak in.
    expect((await a.items.recomputeUsualSpots(aKeys._id))?.usualSpots).toEqual([]);
    expect((await b.items.recomputeUsualSpots(bKeys._id))?.usualSpots[0]?.samples).toBe(3);
    // B can't recompute (or read) A's item by guessing its id.
    expect(await b.items.recomputeUsualSpots(aKeys._id)).toBeNull();
  });

  it("reports held and pending evidence honestly", async () => {
    const tenant = await newTenant(env.db);
    const wallet = await tenant.items.create({ name: "wallet" });
    const base = { patientId: tenant.patientId, itemId: wallet._id, label: "wallet" };

    await seedObservation(env.db, {
      ...base,
      lastSeenAt: new Date(Date.now() - 60_000),
      state: "resting",
      description: { status: "ready", sentence: "on the hallway table", room: "hallway" },
    });
    await seedObservation(env.db, { ...base, lastSeenAt: new Date(), state: "held", description: { status: "pending" } });

    const item = await tenant.items.get(wallet._id);
    expect(item?.observationVersion).toBe(2);
    expect(locationStatus(item?.lastSighting ?? null)).toBe("held");
    expect(item?.lastRestingSighting?.sentence).toBe("on the hallway table");
  });
});
