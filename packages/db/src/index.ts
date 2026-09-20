// The MongoDB layer for memory-glasses. Server-only: never import this from a
// client component. Seeding helpers live at "@memory-glasses/db/observations".

export { MongoServerSelectionError, ObjectId, type Db, type MongoClient } from "mongodb";

export * from "./ids";
export * from "./errors";
export * from "./lookup";
export * from "./snapshot";
export { createMongoClient, DEFAULT_DB_NAME } from "./client";
export { toMongoJsonSchema, type MongoJsonSchema } from "./json-schema";
export {
  collection,
  collections,
  RETENTION_TTL_GRACE_SECONDS,
  type CollectionKey,
  type DocOf,
  type SearchIndexOptions,
} from "./registry";
export {
  canonicalJson,
  schemaPlan,
  schemaStatus,
  syncDatabase,
  SCHEMA_VERSION,
  type SchemaPlan,
  type SchemaStatus,
  type SyncChange,
  type SyncOptions,
} from "./setup";
export { sweepExpired, type SweepOptions, type SweepReport } from "./retention";
export * from "./usual-spots";
export { TenantCollection } from "./tenant-collection";
export { createCaregiver, createPatient, findCaregiverByEmail, listPatientsByIds, recordLogin } from "./accounts";
export {
  addPatientToCaregiver,
  createCaregiverPairingCode,
  createDevicePairingCode,
  markPairingCodeRedeemedBy,
  redeemCaregiverPairingCode,
  redeemDevicePairingCode,
  type AttachPatientResult,
  type RedeemCaregiverCodeResult,
} from "./pairing";
export { tenantRepos, type TenantOptions, type TenantRepos } from "./repos";
export type { ItemPatch, ItemResolution, NewItem } from "./repos/items";
export type { InteractionOutcome, LatencyStats, StageStats } from "./repos/interactions";
export type { NewNotification } from "./repos/notifications";
export type { PersonPatch, PublicPerson, RecognizedPerson } from "./repos/people";
export type { SightingQuery } from "./repos/sightings";

export * from "./schema/common";
export * from "./schema/items";
export * from "./schema/sightings";
export * from "./schema/interactions";
export * from "./schema/rooms";
export * from "./schema/notifications";
export * from "./schema/recordings";
export * from "./schema/perception";
export * from "./schema/safety";
export * from "./schema/tenancy";
export * from "./schema/meta";
