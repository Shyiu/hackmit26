import { MongoServerError, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { idSchema, newId, type ItemId, type PatientId } from "../src/ids";
import { toMongoJsonSchema } from "../src/json-schema";
import { collection } from "../src/registry";
import { schemaPlan, schemaStatus, syncDatabase } from "../src/setup";
import { DEFAULT_PATIENT_SETTINGS, patientSettingsSchema } from "../src/schema/tenancy";
import { openTestDb } from "./helpers";

function keywordsIn(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((entry) => keywordsIn(entry, found));
  else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      found.add(key === "type" && value === "integer" ? "type:integer" : key);
      keywordsIn(value, found);
    }
  }
  return found;
}

describe("toMongoJsonSchema", () => {
  it("emits only keywords MongoDB accepts", () => {
    for (const planned of schemaPlan().collections) {
      const keywords = keywordsIn(planned.validator);
      for (const banned of ["$schema", "format", "default", "const", "$ref", "type:integer"]) {
        expect(keywords.has(banned), `${planned.name} has ${banned}`).toBe(false);
      }
    }
  });

  it("maps dates, ids, and integers to BSON types", () => {
    const schema = toMongoJsonSchema(
      z.strictObject({ _id: idSchema<ItemId>(), at: z.date(), n: z.int().nonnegative() }),
    );
    expect(schema.properties).toEqual({
      _id: { bsonType: "objectId" },
      at: { bsonType: "date" },
      n: { minimum: 0, bsonType: ["int", "long", "double"], multipleOf: 1 },
    });
  });

  it("refuses a custom type with no bsonType", () => {
    const schema = z.strictObject({ blob: z.custom<Buffer>((value) => Buffer.isBuffer(value)) });
    expect(() => toMongoJsonSchema(schema)).toThrow(/No validation rule for \$\.blob/);
  });
});

describe("patient settings", () => {
  it("round-trips an approved area", () => {
    const settings = patientSettingsSchema.parse({
      ...DEFAULT_PATIENT_SETTINGS,
      geofence: { lat: 42.36, lng: -71.06, radiusMeters: 200 },
      locationStaleAfterMinutes: 20,
    });
    expect(settings.geofence).toEqual({ lat: 42.36, lng: -71.06, radiusMeters: 200 });
    expect(settings.locationStaleAfterMinutes).toBe(20);
  });
});

describe("syncDatabase", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb();
  });
  afterAll(() => env.close());

  it("is a no-op the second time", async () => {
    expect(await syncDatabase(env.db)).toEqual([]);
    expect(await schemaStatus(env.db)).toMatchObject({ kind: "current" });
  });

  it("rebuilds an index whose definition drifted and reports undeclared ones", async () => {
    const items = env.db.collection("items");
    await items.dropIndex("patient_items_by_name");
    await items.createIndex({ patientId: 1, name: -1 }, { name: "patient_items_by_name" });
    await items.createIndex({ name: 1 }, { name: "someone_elses_index" });

    const changes = await syncDatabase(env.db);
    expect(changes).toContainEqual(expect.objectContaining({ action: "rebuilt index", name: "patient_items_by_name" }));
    expect(changes).toContainEqual(expect.objectContaining({ action: "undeclared index", name: "someone_elses_index" }));

    const pruned = await syncDatabase(env.db, { prune: true });
    expect(pruned).toContainEqual(expect.objectContaining({ action: "dropped index", name: "someone_elses_index" }));
  });

  it("puts a validator on every collection that rejects bad writes", async () => {
    const items = env.db.collection("items");
    const valid = {
      _id: newId<ItemId>(),
      patientId: newId<PatientId>(),
      name: "keys",
      plural: true,
      aliases: [],
      lookupKeys: ["keys"],
      detectorPrompts: ["keys"],
      referenceImageKeys: [],
      active: true,
      observationVersion: 0,
      lastSighting: null,
      lastRestingSighting: null,
      usualSpots: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await expect(items.insertOne(valid)).resolves.toBeTruthy();

    const invalid: Record<string, Record<string, unknown>> = {
      "string patientId": { patientId: "demo-patient" },
      "unknown field": { colour: "red" },
      "fractional version": { observationVersion: 1.5 },
      "empty lookup keys": { lookupKeys: [] },
      "string date": { createdAt: "2026-09-19" },
      "bad snapshot state": {
        lastSighting: { ...valid, state: "floating" },
      },
    };
    for (const [label, patch] of Object.entries(invalid)) {
      const attempt = items.insertOne({ ...valid, _id: new ObjectId(), ...patch });
      await expect(attempt, label).rejects.toSatisfy(
        (error: unknown) => error instanceof MongoServerError && error.code === 121,
      );
    }
  });

  it("records the schema fingerprint", async () => {
    const meta = await collection(env.db, "meta").findOne({ _id: "schema" });
    expect(meta?.fingerprint).toBe(schemaPlan().fingerprint);
  });

  it("keeps the old index when existing data can't satisfy a new unique one", async () => {
    const items = env.db.collection("items");
    await items.dropIndex("lookup_keys_unique");
    await items.createIndex({ patientId: 1, lookupKeys: 1 }, { name: "lookup_keys_unique" });
    const patientId = newId<PatientId>();
    const twin = (name: string) => ({
      _id: newId<ItemId>(),
      patientId,
      name,
      plural: true,
      aliases: [],
      lookupKeys: ["keys"],
      detectorPrompts: [name],
      referenceImageKeys: [],
      active: true,
      observationVersion: 0,
      lastSighting: null,
      lastRestingSighting: null,
      usualSpots: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await items.insertMany([twin("keys"), twin("house keys")]);

    await expect(syncDatabase(env.db)).rejects.toThrow(/Can't make items.lookup_keys_unique unique.*"keys"/);
    const kept = (await items.listIndexes().toArray()).find((index) => index.name === "lookup_keys_unique");
    expect(kept).toMatchObject({ key: { patientId: 1, lookupKeys: 1 } });
    expect(kept?.unique).toBeUndefined();

    await items.deleteMany({ patientId });
    expect(await syncDatabase(env.db)).toContainEqual(
      expect.objectContaining({ action: "rebuilt index", name: "lookup_keys_unique" }),
    );
  });

  it("changes a TTL in place instead of rebuilding", async () => {
    await env.db.command({ collMod: "sightings", index: { name: "expires_at_ttl", expireAfterSeconds: 60 } });
    expect(await syncDatabase(env.db)).toEqual([
      expect.objectContaining({ collection: "sightings", action: "updated index", name: "expires_at_ttl" }),
    ]);
  });
});

describe("syncDatabase on a database set up by the old db:indexes script", () => {
  let env: Awaited<ReturnType<typeof openTestDb>>;
  beforeAll(async () => {
    env = await openTestDb({ sync: false });
  });
  afterAll(() => env.close());

  it("replaces the default-named indexes and finishes", async () => {
    // What scripts/create-indexes.ts made before db:setup replaced it.
    const db = env.db;
    await db.collection("items").createIndex({ patientId: 1, name: 1 });
    await db.collection("sightings").createIndex({ patientId: 1, itemId: 1, lastSeenAt: -1 });
    await db.collection("sightings").createIndex({ patientId: 1, eventId: 1 }, { unique: true });
    await db.collection("interactions").createIndex({ patientId: 1, askedAt: -1 });
    await db.collection("interactions").createIndex({ patientId: 1, requestId: 1 }, { unique: true });
    for (const name of ["sightings", "interactions", "notifications", "recordings"]) {
      await db.collection(name).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    }

    const changes = await syncDatabase(db);
    expect(changes).toContainEqual(
      expect.objectContaining({ collection: "items", action: "rebuilt index", detail: "replaced patientId_1_name_1" }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ collection: "sightings", action: "rebuilt index", name: "expires_at_ttl" }),
    );
    expect(changes.filter((change) => change.action === "undeclared index")).toEqual([]);
    expect(await syncDatabase(db)).toEqual([]);
    expect(await schemaStatus(db)).toMatchObject({ kind: "current" });
  });
});
