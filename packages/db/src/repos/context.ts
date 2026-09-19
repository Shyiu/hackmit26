import type { Db } from "mongodb";
import type { PatientId } from "../ids";
import { collection, type CollectionKey, type DocOf } from "../registry";
import { TenantCollection } from "../tenant-collection";

export type RepoContext = {
  db: Db;
  patientId: PatientId;
  /** The wearer's `settings.retentionDays`. New retained records expire this far out. */
  retentionDays: number;
  now: () => Date;
};

/** Collections whose documents belong to one wearer. */
export type TenantKey = {
  [K in CollectionKey]: DocOf<K> extends { patientId: PatientId } ? K : never;
}[CollectionKey];

export function tenantCollection<K extends TenantKey>(ctx: RepoContext, key: K) {
  return new TenantCollection<DocOf<K>>(collection(ctx.db, key), ctx.patientId);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function expiresAt(ctx: RepoContext, from: Date): Date {
  return new Date(from.getTime() + ctx.retentionDays * DAY_MS);
}

/** Tells caches keyed on `configVersion`, like perception's prompt list, to reload. */
export async function bumpConfigVersion(ctx: RepoContext): Promise<void> {
  await collection(ctx.db, "patients").updateOne(
    { _id: ctx.patientId },
    { $inc: { configVersion: 1 }, $set: { updatedAt: ctx.now() } },
  );
}
