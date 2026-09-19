import { createHash } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";
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
    | "updated index"
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
  let existing = await target.listIndexes().toArray();

  for (const index of planned.indexes) {
    const current = existing.find((candidate) => candidate.name === index.name);
    if (current && sameIndex(current, index)) continue;

    if (current && onlyTtlDiffers(current, index)) {
      await db.command({
        collMod: planned.name,
        index: { name: index.name, expireAfterSeconds: index.expireAfterSeconds },
      });
      changes.push({ collection: planned.name, action: "updated index", name: index.name, detail: "TTL changed in place" });
      continue;
    }

    // Anything in the way: this name with an older definition, or this key
    // pattern under another name, like the default names `db:indexes` used.
    // MongoDB won't hold two indexes on one key pattern, so these go first.
    const inTheWay = existing.filter(
      (candidate) => candidate.name !== "_id_" && (candidate.name === index.name || sameKey(candidate, index)),
    );
    // Check before dropping anything, so existing duplicates can't cost the old index.
    if (index.unique) await assertUnique(target, planned.name, index);
    for (const old of inTheWay) await target.dropIndex(String(old.name));
    try {
      await target.createIndex(index.key, creationOptions(index));
    } catch (error) {
      // A writer can slip a duplicate in while no index guards it. Put the old
      // indexes back, so a failed rebuild never leaves the collection with neither.
      for (const old of inTheWay) await target.createIndex(old.key, restoreOptions(old)).catch(() => undefined);
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Creating ${planned.name}.${index.name} failed; the previous indexes are back. ${reason}`);
    }
    changes.push({
      collection: planned.name,
      action: inTheWay.length > 0 ? "rebuilt index" : "created index",
      name: index.name,
      detail: inTheWay.length > 0 ? `replaced ${inTheWay.map((old) => old.name).join(", ")}` : index.purpose,
    });
    existing = await target.listIndexes().toArray();
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

function sameKey(current: Document, wanted: ResolvedIndex): boolean {
  return canonicalJson(Object.entries(current.key ?? {})) === canonicalJson(Object.entries(wanted.key));
}

function sameIndex(current: Document, wanted: ResolvedIndex): boolean {
  return (
    sameKey(current, wanted) &&
    Boolean(current.unique) === wanted.unique &&
    canonicalJson(current.partialFilterExpression) === canonicalJson(wanted.partialFilterExpression) &&
    current.expireAfterSeconds === wanted.expireAfterSeconds
  );
}

function onlyTtlDiffers(current: Document, wanted: ResolvedIndex): boolean {
  return (
    typeof current.expireAfterSeconds === "number" &&
    wanted.expireAfterSeconds !== undefined &&
    sameIndex({ ...current, expireAfterSeconds: wanted.expireAfterSeconds }, wanted)
  );
}

function creationOptions(index: ResolvedIndex) {
  return {
    name: index.name,
    unique: index.unique,
    ...(index.partialFilterExpression && { partialFilterExpression: index.partialFilterExpression }),
    ...(index.expireAfterSeconds !== undefined && { expireAfterSeconds: index.expireAfterSeconds }),
  };
}

function restoreOptions(old: Document) {
  return {
    name: String(old.name),
    unique: Boolean(old.unique),
    ...(old.sparse && { sparse: true }),
    ...(old.partialFilterExpression && { partialFilterExpression: old.partialFilterExpression }),
    ...(typeof old.expireAfterSeconds === "number" && { expireAfterSeconds: old.expireAfterSeconds }),
  };
}

/**
 * Fails with the offending values if the data already breaks a unique index.
 * Array fields count per element, the way a multikey unique index does, and
 * repeats inside one document don't count.
 */
async function assertUnique(target: Collection, collectionName: string, index: ResolvedIndex): Promise<void> {
  const paths = Object.keys(index.key);
  const pipeline: Document[] = [
    ...(index.partialFilterExpression ? [{ $match: index.partialFilterExpression }] : []),
    ...paths.map((path) => ({ $unwind: { path: `$${path}`, preserveNullAndEmptyArrays: true } })),
    {
      $group: {
        _id: Object.fromEntries(paths.map((path, i) => [`k${i}`, `$${path}`])),
        ids: { $addToSet: "$_id" },
      },
    },
    { $match: { "ids.1": { $exists: true } } },
    { $limit: 3 },
  ];
  const clashes = await target.aggregate(pipeline).toArray();
  if (clashes.length === 0) return;
  const examples = clashes.map((clash) => JSON.stringify(Object.values(clash._id ?? {}))).join(", ");
  throw new Error(
    `Can't make ${collectionName}.${index.name} unique: documents already share ${paths.join(" + ")} ` +
      `(${examples}). Fix those documents and rerun; the existing indexes are untouched.`,
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
