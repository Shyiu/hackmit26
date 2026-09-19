import type { Db } from "mongodb";
import type { SightingId } from "./ids";
import { collection, collections, type CollectionKey } from "./registry";

export type SweepOptions = {
  now?: Date;
  batchSize?: number;
  /**
   * Deletes keyframes, thumbnails, enrollment frames, and recording chunks from
   * object storage. Called before the documents that point at them go, so a
   * crash mid-sweep leaves the keys findable and the next run deletes them.
   */
  deleteObjects?: (keys: string[]) => Promise<void>;
};

export type SweepReport = {
  deleted: Partial<Record<CollectionKey, number>>;
  clearedSnapshots: number;
  objectKeys: number;
};

/**
 * README "Privacy and safety": the retryable cleanup job. Deletes everything
 * past `expiresAt` across all wearers, clears item snapshots that point at
 * deleted sightings, and removes queued description work for them. Reads
 * already ignore expired records; this reclaims the space and the images.
 * Idempotent, so a cron can run it as often as it likes.
 */
export async function sweepExpired(db: Db, options: SweepOptions = {}): Promise<SweepReport> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 500;
  const report: SweepReport = { deleted: {}, clearedSnapshots: 0, objectKeys: 0 };
  const count = (key: CollectionKey, n: number) => {
    report.deleted[key] = (report.deleted[key] ?? 0) + n;
  };
  const dropObjects = async (keys: (string | null | undefined)[]) => {
    const present = [...new Set(keys.filter((key): key is string => Boolean(key)))];
    if (present.length === 0) return;
    await options.deleteObjects?.(present);
    report.objectKeys += present.length;
  };

  // Sightings first, in batches, because items and jobs point at them.
  const sightings = collection(db, "sightings");
  const items = collection(db, "items");
  for (;;) {
    const batch = await sightings
      .find({ expiresAt: { $lte: now } }, { projection: { _id: 1, keyframeKey: 1, thumbKey: 1 } })
      .limit(batchSize)
      .toArray();
    if (batch.length === 0) break;
    const ids: SightingId[] = batch.map((sighting) => sighting._id);

    const latest = await items.updateMany(
      { "lastSighting.sightingId": { $in: ids } },
      { $set: { lastSighting: null } },
    );
    const resting = await items.updateMany(
      { "lastRestingSighting.sightingId": { $in: ids } },
      { $set: { lastRestingSighting: null } },
    );
    report.clearedSnapshots += latest.modifiedCount + resting.modifiedCount;

    // A sighting's jobs point at every keyframe it ever had, including ones a
    // sharper frame replaced, so their keys go with it.
    const descriptionJobs = collection(db, "descriptionJobs");
    const jobs = await descriptionJobs
      .find({ sightingId: { $in: ids } }, { projection: { keyframeKey: 1 } })
      .toArray();
    await dropObjects([
      ...batch.flatMap((sighting) => [sighting.keyframeKey, sighting.thumbKey]),
      ...jobs.map((job) => job.keyframeKey),
    ]);
    const deletedJobs = await descriptionJobs.deleteMany({ sightingId: { $in: ids } });
    count("descriptionJobs", deletedJobs.deletedCount);
    const deleted = await sightings.deleteMany({ _id: { $in: ids } });
    count("sightings", deleted.deletedCount);
    // TODO(M6): recompute history-based usualSpots for the affected items once they exist.
  }

  const roomRefs = await collection(db, "roomRefs")
    .find({ expiresAt: { $lte: now } }, { projection: { imageKey: 1 } })
    .toArray();
  await dropObjects(roomRefs.map((ref) => ref.imageKey));

  const recordings = await collection(db, "recordings")
    .find({ expiresAt: { $lte: now } }, { projection: { chunks: 1 } })
    .toArray();
  await dropObjects(recordings.flatMap((recording) => recording.chunks.map((chunk) => chunk.key)));

  // Everything else that expires is a plain delete. New expiring collections
  // join this loop by having an `expiresAt` field; no list to keep in sync.
  for (const key of Object.keys(collections) as CollectionKey[]) {
    if (key === "sightings" || !collections[key].expires) continue;
    const result = await db.collection(collections[key].name).deleteMany({ expiresAt: { $lte: now } });
    count(key, result.deletedCount);
  }
  return report;
}
