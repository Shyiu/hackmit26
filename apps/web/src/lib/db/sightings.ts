import type { Filter } from "mongodb";
import type { Sighting } from "@memory-glasses/shared";
import { sightings, unexpired, type SightingDoc } from "./collections";
import { toObjectId, toSighting } from "./serialize";

export type SightingQuery = {
  itemId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};

export async function listSightings(
  patientId: string,
  query: SightingQuery = {}
): Promise<Sighting[]> {
  const filter: Filter<SightingDoc> = { patientId, ...unexpired() };

  if (query.itemId) {
    const itemId = toObjectId(query.itemId);
    if (!itemId) {
      return [];
    }
    filter.itemId = itemId;
  }

  if (query.since || query.until) {
    filter.lastSeenAt = {
      ...(query.since ? { $gte: query.since } : {}),
      ...(query.until ? { $lte: query.until } : {}),
    };
  }

  const docs = await (await sightings())
    .find(filter)
    .sort({ lastSeenAt: -1 })
    .limit(Math.min(query.limit ?? 100, 500))
    .toArray();
  return docs.map(toSighting);
}
