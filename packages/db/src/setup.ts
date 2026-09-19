import { createHash } from "node:crypto";
import type { Db, Document } from "mongodb";
import { toMongoJsonSchema } from "./json-schema";
import {
  collection,
  collections,
  type ResolvedIndex,
  type SearchIndexOptions,
  type SearchIndexSpec,
} from "./registry";

/** Bump by hand when a change needs a data migration as well as a validator sync. */
export const SCHEMA_VERSION = 1;

const VALIDATION = { validationLevel: "strict", validationAction: "error" } as const;

export type CollectionPlan = {
  name: string;
  validator: { $jsonSchema: Document };
  indexes: readonly ResolvedIndex[];
};

export type SchemaPlan = { version: number; fingerprint: string; collections: CollectionPlan[] };

/** What the database should look like, derived from the registry. Pure; touches nothing. */
export function schemaPlan(): SchemaPlan {
  const planned = Object.values(collections).map((spec) => ({
    name: spec.name,
    validator: { $jsonSchema: toMongoJsonSchema(spec.schema) },
    indexes: spec.indexes,
  }));
  const fingerprint = createHash("sha256")
    .update(canonicalJson({ version: SCHEMA_VERSION, collections: planned }))
    .digest("hex");
  return { version: SCHEMA_VERSION, fingerprint, collections: planned };
}

export type SyncChange = {
  collection: string;
  action:
    | "created collection"
    | "updated validator"
    | "created index"
    | "rebuilt index"
    | "dropped index"
    | "undeclared index"
    | "created search index"
    | "updated search index"
    | "search indexes unavailable";
  name?: string;
  detail?: string;
};

export type SyncOptions = {
  /** Also create Atlas Search and Vector Search indexes. They're optional until after M3. */
  search?: SearchIndexOptions;
  /** Drop indexes the registry doesn't declare. Off by default, since they're only reported. */
  prune?: boolean;
};

/**
 * Brings a database in line with the registry: creates missing collections,
 * updates validators, and creates or rebuilds indexes by name. Safe to run
 * again and again; a second run reports no changes.
 */
export async function syncDatabase(db: Db, options: SyncOptions = {}): Promise<SyncChange[]> {
  const plan = schemaPlan();
  const changes: SyncChange[] = [];
  const existing = new Map(
    (await db.listCollections({}, { nameOnly: false }).toArray()).map((info) => [info.name, info]),
  );

  for (const planned of plan.collections) {
    const current = existing.get(planned.name);
    const stored: Document | undefined = current && "options" in current ? current.options : undefined;
    if (!current) {
      await db.createCollection(planned.name, { validator: planned.validator, ...VALIDATION });
      changes.push({ collection: planned.name, action: "created collection" });
    } else if (
      canonicalJson(stored?.validator) !== canonicalJson(planned.validator) ||
      stored?.validationLevel !== VALIDATION.validationLevel ||
      stored?.validationAction !== VALIDATION.validationAction
    ) {
      await db.command({ collMod: planned.name, validator: planned.validator, ...VALIDATION });
      changes.push({ collection: planned.name, action: "updated validator" });
    }
    changes.push(...(await syncIndexes(db, planned, options.prune ?? false)));
  }

  if (options.search) changes.push(...(await syncSearchIndexes(db, options.search)));

  await collection(db, "meta").updateOne(
    { _id: "schema" },
    { $set: { version: plan.version, fingerprint: plan.fingerprint, syncedAt: new Date() } },
    { upsert: true },
  );
  return changes;
}

export type SchemaStatus =
  | { kind: "current"; fingerprint: string }
  | { kind: "stale"; expected: string; found: string | null };

/** Whether `db:setup` has run since the schemas last changed. */
export async function schemaStatus(db: Db): Promise<SchemaStatus> {
  const expected = schemaPlan().fingerprint;
  const meta = await collection(db, "meta").findOne({ _id: "schema" });
  return meta?.fingerprint === expected
    ? { kind: "current", fingerprint: expected }
    : { kind: "stale", expected, found: meta?.fingerprint ?? null };
}

async function syncIndexes(db: Db, planned: CollectionPlan, prune: boolean): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  const target = db.collection(planned.name);
  const existing = await target.listIndexes().toArray();
  const byName = new Map(existing.map((index) => [String(index.name), index]));

  for (const index of planned.indexes) {
    const current = byName.get(index.name);
    if (current && sameIndex(current, index)) continue;
    if (current) await target.dropIndex(index.name);
    try {
      await target.createIndex(index.key, {
        name: index.name,
        unique: index.unique,
        ...(index.partialFilterExpression && { partialFilterExpression: index.partialFilterExpression }),
        ...(index.expireAfterSeconds !== undefined && { expireAfterSeconds: index.expireAfterSeconds }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Creating ${planned.name}.${index.name} failed: ${reason}`);
    }
    changes.push({
      collection: planned.name,
      action: current ? "rebuilt index" : "created index",
      name: index.name,
      detail: index.purpose,
    });
  }

  const declared = new Set(planned.indexes.map((index) => index.name));
  for (const index of existing) {
    const name = String(index.name);
    if (name === "_id_" || declared.has(name)) continue;
    if (prune) await target.dropIndex(name);
    changes.push({ collection: planned.name, action: prune ? "dropped index" : "undeclared index", name });
  }
  return changes;
}

function sameIndex(current: Document, wanted: ResolvedIndex): boolean {
  return (
    canonicalJson(Object.entries(current.key ?? {})) === canonicalJson(Object.entries(wanted.key)) &&
    Boolean(current.unique) === wanted.unique &&
    canonicalJson(current.partialFilterExpression) === canonicalJson(wanted.partialFilterExpression) &&
    current.expireAfterSeconds === wanted.expireAfterSeconds
  );
}

async function syncSearchIndexes(db: Db, options: SearchIndexOptions): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  for (const spec of Object.values(collections)) {
    const wanted: readonly SearchIndexSpec[] = spec.searchIndexes(options);
    if (wanted.length === 0) continue;
    const target = db.collection(spec.name);

    let existing: Document[];
    try {
      existing = await target.listSearchIndexes().toArray();
    } catch (error) {
      // A plain mongod has no search. Atlas and the atlas-local image do.
      const detail = error instanceof Error ? error.message : String(error);
      changes.push({ collection: spec.name, action: "search indexes unavailable", detail });
      continue;
    }

    for (const index of wanted) {
      const current = existing.find((candidate) => candidate.name === index.name);
      if (!current) {
        await target.createSearchIndex({ name: index.name, type: index.type, definition: index.definition });
        changes.push({ collection: spec.name, action: "created search index", name: index.name, detail: index.purpose });
      } else if (!containsJson(current.latestDefinition, index.definition)) {
        await target.updateSearchIndex(index.name, index.definition);
        changes.push({ collection: spec.name, action: "updated search index", name: index.name, detail: index.purpose });
      }
    }
  }
  return changes;
}

/** Atlas fills in defaults on stored search definitions, so compare only what we set. */
function containsJson(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry, i) => containsJson(actual[i], entry))
    );
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null) return false;
    const record: Record<string, unknown> = { ...actual };
    return Object.entries(expected).every(([key, value]) => containsJson(record[key], value));
  }
  return actual === expected;
}

/** JSON with object keys sorted, so two equal documents always serialize the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
}
