import type { Filter } from "mongodb";
import type { ItemId, SightingId } from "../ids";
import type { SightingDoc } from "../schema/sightings";
import { tenantCollection, type RepoContext } from "./context";

export type SightingQuery = {
  itemId?: ItemId;
  since?: Date;
  /** Exclusive upper bound on `lastSeenAt`. Pass the last result's `lastSeenAt` to page. */
  before?: Date;
  limit?: number;
};

/** Read side only. Perception writes sightings; see services/perception/app/store.py. */
export function sightingsRepo(ctx: RepoContext) {
  const sightings = tenantCollection(ctx, "sightings");

  return {
    list({ itemId, since, before, limit = 50 }: SightingQuery = {}): Promise<SightingDoc[]> {
      const now = ctx.now();
      const filter: Filter<SightingDoc> = {
        lastSeenAt: { $lt: before ?? now, ...(since && { $gte: since }) },
        expiresAt: { $gt: now },
        ...(itemId && { itemId }),
      };
      return sightings
        .find(filter)
        .sort({ lastSeenAt: -1 })
        .limit(Math.min(limit, 200))
        .toArray();
    },

    get(id: SightingId): Promise<SightingDoc | null> {
      return sightings.findOne({ _id: id, expiresAt: { $gt: ctx.now() } });
    },
  };
}

export type SightingsRepo = ReturnType<typeof sightingsRepo>;
