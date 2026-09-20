import type { Collection, Db, Document, IndexDirection, ObjectId } from "mongodb";
import type { z } from "zod";
import { interactionDocSchema } from "./schema/interactions";
import { itemDocSchema } from "./schema/items";
import { metaDocSchema } from "./schema/meta";
import { notificationDocSchema } from "./schema/notifications";
import { captureSessionDocSchema, descriptionJobDocSchema } from "./schema/perception";
import { recordingDocSchema } from "./schema/recordings";
import { roomDocSchema, roomRefDocSchema } from "./schema/rooms";
import { dangerEventDocSchema, frameObservationDocSchema, personDocSchema } from "./schema/safety";
import { scanPinDocSchema } from "./schema/scan";
import { sightingDocSchema } from "./schema/sightings";
import {
  caregiverDocSchema,
  caregiverPairingCodeDocSchema,
  deviceDocSchema,
  patientDocSchema,
  pairingCodeDocSchema,
} from "./schema/tenancy";

type Leaf = string | number | boolean | null | undefined | Date | ObjectId;
type Shallower = [never, 0, 1, 2, 3];

/** Every dot path into a document, through arrays too, so index keys are checked. */
export type DocPath<T, Depth extends number = 4> = [Depth] extends [never]
  ? never
  : T extends Leaf
    ? never
    : T extends readonly (infer Element)[]
      ? DocPath<Element, Depth>
      : {
          [K in keyof T & string]-?: NonNullable<T[K]> extends Leaf
            ? K
            : NonNullable<T[K]> extends readonly (infer Element)[]
              ? NonNullable<Element> extends Leaf
                ? K
                : K | `${K}.${DocPath<NonNullable<Element>, Shallower[Depth]>}`
              : K | `${K}.${DocPath<NonNullable<T[K]>, Shallower[Depth]>}`;
        }[keyof T & string];

export type IndexSpec<TDoc> = {
  /** `db:setup` matches indexes by name and rebuilds one whose definition changed. */
  name: string;
  /** Field order matters, as in createIndex. */
  key: { readonly [Path in DocPath<TDoc>]?: 1 | -1 };
  unique?: boolean;
  partialFilterExpression?: Document;
  expireAfterSeconds?: number;
  /** Why it exists, printed by `db:setup`. An index nobody can explain gets dropped. */
  purpose: string;
};

export type SearchIndexOptions = {
  textEmbeddingDimensions: number;
  roomEmbeddingDimensions: number;
};

export type SearchIndexSpec = {
  name: string;
  type: "search" | "vectorSearch";
  definition: Document;
  purpose: string;
};

export type ResolvedIndex = {
  name: string;
  key: Readonly<Record<string, IndexDirection>>;
  unique: boolean;
  partialFilterExpression?: Document;
  expireAfterSeconds?: number;
  purpose: string;
};

type Writer = "web" | "perception";

type CollectionInput<TSchema extends z.ZodObject> = {
  name: string;
  schema: TSchema;
  /** Who writes it. Perception owns sightings and snapshots, web owns configuration. */
  writers: readonly Writer[];
  indexes: readonly IndexSpec<NoInfer<z.output<TSchema>>>[];
  searchIndexes?: (options: SearchIndexOptions) => readonly SearchIndexSpec[];
};

export type CollectionSpec<TSchema extends z.ZodObject> = {
  name: string;
  schema: TSchema;
  writers: readonly Writer[];
  /** True when documents carry `expiresAt` and the retention sweep owns their deletion. */
  expires: boolean;
  indexes: readonly ResolvedIndex[];
  searchIndexes: (options: SearchIndexOptions) => readonly SearchIndexSpec[];
};

/**
 * TTL indexes are the backstop, not the cleanup path. The retention sweep deletes
 * expired records first and repairs the item snapshots that point at them; the TTL
 * monitor removes whatever the sweep missed a day later.
 */
export const RETENTION_TTL_GRACE_SECONDS = 24 * 60 * 60;

export function defineCollection<TSchema extends z.ZodObject>(
  input: CollectionInput<TSchema>,
): CollectionSpec<TSchema> {
  const expires = "expiresAt" in input.schema.shape;
  const indexes: ResolvedIndex[] = input.indexes.map((index) => ({
    name: index.name,
    key: Object.fromEntries(
      Object.entries(index.key).filter((entry): entry is [string, 1 | -1] => entry[1] !== undefined),
    ),
    unique: index.unique ?? false,
    partialFilterExpression: index.partialFilterExpression,
    expireAfterSeconds: index.expireAfterSeconds,
    purpose: index.purpose,
  }));
  if (expires) {
    indexes.push({
      name: "expires_at_ttl",
      key: { expiresAt: 1 },
      unique: false,
      expireAfterSeconds: RETENTION_TTL_GRACE_SECONDS,
      purpose: "retention sweep range scan, and the TTL backstop a day after expiry",
    });
  }
  return {
    name: input.name,
    schema: input.schema,
    writers: input.writers,
    expires,
    indexes,
    searchIndexes: input.searchIndexes ?? (() => []),
  };
}

/**
 * Every collection, its validator schema, and its indexes. `pnpm db:setup` syncs
 * the database to this object. README "Data model" > "Indexes" explains the list.
 */
export const collections = {
  patients: defineCollection({
    name: "patients",
    schema: patientDocSchema,
    writers: ["web"],
    indexes: [],
  }),

  caregivers: defineCollection({
    name: "caregivers",
    schema: caregiverDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "email_unique",
        key: { email: 1 },
        unique: true,
        purpose: "login lookup, one account per email",
      },
    ],
  }),

  devices: defineCollection({
    name: "devices",
    schema: deviceDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "patient_devices",
        key: { patientId: 1, createdAt: -1 },
        purpose: "a wearer's devices, newest first",
      },
    ],
  }),

  caregiverPairingCodes: defineCollection({
    name: "caregiverPairingCodes",
    schema: caregiverPairingCodeDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "patient_codes",
        key: { patientId: 1, createdAt: -1 },
        purpose: "a wearer's live codes, newest first",
      },
    ],
  }),

  pairingCodes: defineCollection({
    name: "pairingCodes",
    schema: pairingCodeDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "patient_codes",
        key: { patientId: 1, createdAt: -1 },
        purpose: "a wearer's live device codes, newest first",
      },
    ],
  }),

  items: defineCollection({
    name: "items",
    schema: itemDocSchema,
    writers: ["web", "perception"],
    indexes: [
      {
        name: "lookup_keys_unique",
        key: { patientId: 1, lookupKeys: 1 },
        unique: true,
        partialFilterExpression: { active: true },
        purpose: "fast path lookup; one spoken name maps to at most one active item",
      },
      {
        name: "patient_items_by_name",
        key: { patientId: 1, name: 1 },
        purpose: "item list and cards, archived items included",
      },
    ],
  }),

  sightings: defineCollection({
    name: "sightings",
    schema: sightingDocSchema,
    writers: ["perception"],
    indexes: [
      {
        name: "event_unique",
        key: { patientId: 1, eventId: 1 },
        unique: true,
        purpose: "idempotent ingestion; a replayed event can't open a second sighting",
      },
      {
        name: "item_timeline",
        key: { patientId: 1, itemId: 1, lastSeenAt: -1 },
        purpose: "one item's sightings, newest first",
      },
      {
        name: "patient_timeline",
        key: { patientId: 1, lastSeenAt: -1 },
        purpose: "recent sightings across items, room and time questions",
      },
      {
        name: "open_by_last_seen",
        key: { lastSeenAt: 1 },
        partialFilterExpression: { status: "open" },
        purpose: "perception closes sightings left open by a crash or disconnect",
      },
    ],
    searchIndexes: ({ textEmbeddingDimensions }) => [
      {
        name: "sightings_sentence_vector",
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "vector",
              path: "sentenceEmbedding",
              numDimensions: textEmbeddingDimensions,
              similarity: "cosine",
            },
            { type: "filter", path: "patientId" },
            { type: "filter", path: "itemId" },
            { type: "filter", path: "lastSeenAt" },
          ],
        },
        purpose: "semantic questions, optional after M3",
      },
      {
        name: "sightings_text",
        type: "search",
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              searchText: { type: "string", analyzer: "lucene.english" },
              patientId: { type: "objectId" },
              itemId: { type: "objectId" },
              lastSeenAt: { type: "date" },
            },
          },
        },
        purpose: "full-text half of $rankFusion hybrid search, optional after M3",
      },
    ],
  }),

  interactions: defineCollection({
    name: "interactions",
    schema: interactionDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "request_unique",
        key: { patientId: 1, requestId: 1 },
        unique: true,
        purpose: "a retried POST /api/ask finds the first interaction",
      },
      {
        name: "patient_questions",
        key: { patientId: 1, askedAt: -1 },
        purpose: "question log and latency percentiles",
      },
    ],
  }),

  rooms: defineCollection({
    name: "rooms",
    schema: roomDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "name_unique",
        key: { patientId: 1, normalizedName: 1 },
        unique: true,
        purpose: "room names are unique per wearer",
      },
    ],
  }),

  roomRefs: defineCollection({
    name: "room_refs",
    schema: roomRefDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "room_frames",
        key: { patientId: 1, roomId: 1 },
        purpose: "a room's reference frames, and deleting them with the room",
      },
    ],
    searchIndexes: ({ roomEmbeddingDimensions }) => [
      {
        name: "room_refs_embedding_vector",
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: roomEmbeddingDimensions,
              similarity: "cosine",
            },
            { type: "filter", path: "patientId" },
          ],
        },
        purpose: "room classification against enrolled frames, optional after M3",
      },
    ],
  }),

  notifications: defineCollection({
    name: "notifications",
    schema: notificationDocSchema,
    writers: ["web", "perception"],
    indexes: [
      {
        name: "due_for_hud",
        key: { patientId: 1, status: 1, showAt: 1 },
        purpose: "the HUD poll for the next queued message or due reminder",
      },
    ],
  }),

  people: defineCollection({
    name: "people",
    schema: personDocSchema,
    writers: ["web", "perception"],
    indexes: [
      {
        name: "patient_people_by_name",
        key: { patientId: 1, name: 1 },
        purpose: "face enrollment list",
      },
    ],
  }),

  frameObservations: defineCollection({
    name: "frame_observations",
    schema: frameObservationDocSchema,
    writers: ["perception"],
    indexes: [
      {
        name: "patient_frames",
        key: { patientId: 1, capturedAt: -1 },
        purpose: "recent frames for the dashboard",
      },
    ],
  }),

  dangerEvents: defineCollection({
    name: "danger_events",
    schema: dangerEventDocSchema,
    writers: ["perception"],
    indexes: [
      {
        name: "open_by_last_seen",
        key: { patientId: 1, status: 1, lastSeenAt: -1 },
        purpose: "open hazards, dashboard alert badge",
      },
    ],
  }),

  scanPins: defineCollection({
    name: "scanPins",
    schema: scanPinDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "item_scene_unique",
        key: { patientId: 1, itemId: 1, sceneId: 1 },
        unique: true,
        purpose: "one pin per item per scene, and an item's pins across scenes",
      },
      {
        name: "scene_pins",
        key: { patientId: 1, sceneId: 1 },
        purpose: "every pin the 3D viewer draws in one scene",
      },
    ],
  }),

  recordings: defineCollection({
    name: "recordings",
    schema: recordingDocSchema,
    writers: ["web"],
    indexes: [
      {
        name: "patient_recordings",
        key: { patientId: 1, startedAt: -1 },
        purpose: "recordings list, optional after M3",
      },
    ],
  }),

  captureSessions: defineCollection({
    name: "capture_sessions",
    schema: captureSessionDocSchema,
    writers: ["perception"],
    indexes: [
      {
        name: "patient_sessions",
        key: { patientId: 1, startedAt: -1 },
        purpose: "latest capture state for the dashboard badge",
      },
    ],
  }),

  descriptionJobs: defineCollection({
    name: "description_jobs",
    schema: descriptionJobDocSchema,
    writers: ["perception"],
    indexes: [
      {
        name: "claimable",
        key: { status: 1, runAfter: 1 },
        purpose: "worker claims the oldest due job, or a running one whose lease ran out",
      },
      {
        name: "sighting_keyframe_unique",
        key: { sightingId: 1, keyframeRevision: 1 },
        unique: true,
        purpose: "one job per keyframe; a newer revision supersedes older queued ones",
      },
      {
        name: "patient_queue",
        key: { patientId: 1, status: 1 },
        purpose: "per-wearer queue bound, and pause cancelling queued work",
      },
    ],
  }),

  meta: defineCollection({
    name: "meta",
    schema: metaDocSchema,
    writers: ["web"],
    indexes: [],
  }),
};

export type Collections = typeof collections;
export type CollectionKey = keyof Collections;
export type DocOf<K extends CollectionKey> = z.output<Collections[K]["schema"]>;

/** A typed handle on one collection. */
export function collection<K extends CollectionKey>(db: Db, key: K): Collection<DocOf<K>> {
  return db.collection<DocOf<K>>(collections[key].name);
}
