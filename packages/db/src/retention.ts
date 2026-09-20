import type { Db, Document, Filter } from "mongodb";
import type { ItemId, PatientId, SightingId } from "./ids";
import { collection, collections, type CollectionKey, type DocOf } from "./registry";
import { tenantRepos } from "./repos";

export type SweepOptions = {
  now?: Date;
  batchSize?: number;
  /** Report what would go without deleting anything. */
  dryRun?: boolean;
  /** One line per step, for the cron log. */
  log?: (line: string) => void;
  /**
   * Deletes keyframes, thumbnails, enrollment frames, and recording chunks from
   * object storage. Called before the documents that point at them go, so a
   * crash mid-sweep leaves the keys findable and the next run deletes them.
   */
  deleteObjects?: (keys: string[]) => Promise<void>;
};

export type SweepReport = {
  dryRun: boolean;
  deleted: Partial<Record<CollectionKey, number>>;
  clearedSnapshots: number;
  objectKeys: number;
  /** Items whose history-derived usual spots were recomputed after deletions. */
  recomputedUsualSpots: number;
};

type ExpiringKey = {
  [K in CollectionKey]: DocOf<K> extends { expiresAt: Date; patientId: PatientId } ? K : never;
}[CollectionKey];

/**
 * When each retained record happened, for the caregiver's current
 * `settings.retentionDays`. A document's `expiresAt` was stamped with the
 * window in force when it was written; shortening the window has to reach
 * records already stored, so the sweep also expires anything whose anchor is
 * older than the window now. Lengthening it never revives anything. A
 * collection without an anchor here is swept on `expiresAt` alone.
 */
const RETENTION_ANCHOR: Partial<Record<ExpiringKey, string>> = {
  sightings: "lastSeenAt",
  interactions: "askedAt",
  notifications: "createdAt",
  roomRefs: "createdAt",
  recordings: "startedAt",
  captureSessions: "startedAt",
  descriptionJobs: "createdAt",
};

const DAY_MS = 24 * 60 * 60 * 1000;

type Window = { patientId: PatientId; cutoff: Date };

async function retentionWindows(db: Db, now: Date): Promise<Window[]> {
  const patients = await collection(db, "patients")
    .find({}, { projection: { _id: 1, "settings.retentionDays": 1 } })
    .toArray();
  return patients.map((patient) => ({
    patientId: patient._id,
    cutoff: new Date(now.getTime() - patient.settings.retentionDays * DAY_MS),
  }));
}

function expiredFilter<K extends ExpiringKey>(key: K, now: Date, windows: Window[]): Filter<DocOf<K>> {
  const anchor = RETENTION_ANCHOR[key];
  const clauses: Document[] = [{ expiresAt: { $lte: now } }];
  if (anchor) {
    clauses.push(...windows.map(({ patientId, cutoff }) => ({ patientId, [anchor]: { $lte: cutoff } })));
  }
  return { $or: clauses } as Filter<DocOf<K>>;
}

/**
 * README "Privacy and safety": the retryable cleanup job. Deletes everything
 * past its retention window across all wearers, clears item snapshots that
 * point at deleted sightings, removes queued description work for them, and
 * drops their objects from storage. Reads already ignore expired records; this
 * reclaims the space and the images. Idempotent, so a cron can run it as
 * often as it likes; `dryRun` reports the same counts without writing.
 */
export async function sweepExpired(db: Db, options: SweepOptions = {}): Promise<SweepReport> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 500;
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});
  const report: SweepReport = { dryRun, deleted: {}, clearedSnapshots: 0, objectKeys: 0, recomputedUsualSpots: 0 };
  for (const key of Object.keys(collections) as CollectionKey[]) {
    if (collections[key].expires) report.deleted[key] = 0;
  }
  const count = (key: CollectionKey, n: number) => {
    report.deleted[key] = (report.deleted[key] ?? 0) + n;
  };
  const dropObjects = async (keys: (string | null | undefined)[]) => {
    const present = [...new Set(keys.filter((key): key is string => Boolean(key)))];
    if (present.length === 0) return;
    if (!dryRun) await options.deleteObjects?.(present);
    report.objectKeys += present.length;
  };

  const windows = await retentionWindows(db, now);
  log(`${dryRun ? "dry run" : "sweep"} at ${now.toISOString()} across ${windows.length} wearer(s)`);

  // Sightings first, in batches, because items and jobs point at them.
  const sightings = collection(db, "sightings");
  const items = collection(db, "items");
  const descriptionJobs = collection(db, "descriptionJobs");
  // In a dry run nothing goes away, so later steps have to skip what an earlier one counted.
  const countedJobs = new Set<string>();
  const expiredSightings = sightings.find(expiredFilter("sightings", now, windows), {
    projection: { _id: 1, keyframeKey: 1, thumbKey: 1, patientId: 1, itemId: 1 },
  });
  // Deleting a sighting can retire a usual spot, so remember whose history shrank.
  const affectedItems = new Map<string, { patientId: PatientId; itemId: ItemId }>();
  for (;;) {
    const batch: {
      _id: SightingId;
      keyframeKey: string | null;
      thumbKey: string | null;
      patientId: PatientId;
      itemId: ItemId;
    }[] = [];
    while (batch.length < batchSize) {
      const next = await expiredSightings.tryNext();
      if (!next) break;
      batch.push(next);
    }
    if (batch.length === 0) break;
    const ids = batch.map((sighting) => sighting._id);
    for (const sighting of batch) {
      affectedItems.set(`${sighting.patientId.toHexString()}:${sighting.itemId.toHexString()}`, {
        patientId: sighting.patientId,
        itemId: sighting.itemId,
      });
    }

    if (dryRun) {
      report.clearedSnapshots += await items.countDocuments({
        $or: [{ "lastSighting.sightingId": { $in: ids } }, { "lastRestingSighting.sightingId": { $in: ids } }],
      });
    } else {
      const latest = await items.updateMany(
        { "lastSighting.sightingId": { $in: ids } },
        { $set: { lastSighting: null } },
      );
      const resting = await items.updateMany(
        { "lastRestingSighting.sightingId": { $in: ids } },
        { $set: { lastRestingSighting: null } },
      );
      report.clearedSnapshots += latest.modifiedCount + resting.modifiedCount;
    }

    // A sighting's jobs point at every keyframe it ever had, including ones a
    // sharper frame replaced, so their keys go with it.
    const jobs = await descriptionJobs
      .find({ sightingId: { $in: ids } }, { projection: { keyframeKey: 1 } })
      .toArray();
    await dropObjects([
      ...batch.flatMap((sighting) => [sighting.keyframeKey, sighting.thumbKey]),
      ...jobs.map((job) => job.keyframeKey),
    ]);
    if (dryRun) {
      for (const job of jobs) countedJobs.add(job._id.toHexString());
      count("descriptionJobs", jobs.length);
      count("sightings", ids.length);
    } else {
      const deletedJobs = await descriptionJobs.deleteMany({ sightingId: { $in: ids } });
      count("descriptionJobs", deletedJobs.deletedCount);
      const deleted = await sightings.deleteMany({ _id: { $in: ids } });
      count("sightings", deleted.deletedCount);
    }
  }
  await expiredSightings.close();

  if (!dryRun) {
    for (const { patientId, itemId } of affectedItems.values()) {
      if (await tenantRepos(db, patientId).items.recomputeUsualSpots(itemId)) {
        report.recomputedUsualSpots += 1;
      }
    }
    if (report.recomputedUsualSpots) {
      log(`usual spots recomputed for ${report.recomputedUsualSpots} item(s)`);
    }
  }

  const roomRefs = await collection(db, "roomRefs")
    .find(expiredFilter("roomRefs", now, windows), { projection: { imageKey: 1 } })
    .toArray();
  await dropObjects(roomRefs.map((ref) => ref.imageKey));

  // Jobs that outlived their window while their sighting hasn't yet.
  const staleJobs = (
    await descriptionJobs
      .find(expiredFilter("descriptionJobs", now, windows), { projection: { keyframeKey: 1 } })
      .toArray()
  ).filter((job) => !countedJobs.has(job._id.toHexString()));
  await dropObjects(staleJobs.map((job) => job.keyframeKey));

  const recordings = await collection(db, "recordings")
    .find(expiredFilter("recordings", now, windows), { projection: { chunks: 1 } })
    .toArray();
  await dropObjects(recordings.flatMap((recording) => (recording.chunks ?? []).map((chunk) => chunk.key)));

  // Everything else that expires is a plain delete. New expiring collections
  // join this loop by having `patientId` and `expiresAt`; no list to keep in sync.
  for (const key of Object.keys(collections) as CollectionKey[]) {
    if (key === "sightings" || !collections[key].expires) continue;
    const expiring = key as ExpiringKey;
    const filter = expiredFilter(expiring, now, windows);
    const target = collection(db, expiring);
    if (dryRun) {
      count(key, key === "descriptionJobs" ? staleJobs.length : await target.countDocuments(filter));
    } else {
      const result = await target.deleteMany(filter);
      count(key, result.deletedCount);
    }
  }

  for (const [key, n] of Object.entries(report.deleted)) {
    if (n) log(`${key}: ${n} ${dryRun ? "would be deleted" : "deleted"}`);
  }
  log(`item snapshots ${dryRun ? "to clear" : "cleared"}: ${report.clearedSnapshots}`);
  log(`object keys ${dryRun ? "to delete" : "deleted"}: ${report.objectKeys}`);
  return report;
}
