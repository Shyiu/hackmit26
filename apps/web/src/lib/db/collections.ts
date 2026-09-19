import type { Collection, ObjectId } from "mongodb";
import type {
  DescriptionStatus,
  Interaction,
  InteractionStatus,
  InteractionTimings,
  Item,
  ObservationState,
  Sighting,
  SightingSummary,
  UsualSpot,
} from "@memory-glasses/shared";
import { getDb } from "@/lib/mongodb";

// Stored shapes. They match the shared zod schemas except that ids are ObjectIds
// in Mongo and strings on the wire; serialize.ts does that conversion.

export type ItemDoc = {
  _id: ObjectId;
  patientId: string;
  name: string;
  aliases: string[];
  detectorPrompts: string[];
  referenceImages: string[];
  lastSighting?: SightingSummary;
  lastRestingSighting?: SightingSummary;
  locationStatus?: Item["locationStatus"];
  usualSpots: UsualSpot[];
};

export type SightingDoc = Omit<Sighting, "_id" | "itemId"> & {
  _id: ObjectId;
  itemId: ObjectId;
};

export type InteractionDoc = Omit<Interaction, "_id" | "itemId"> & {
  _id: ObjectId;
  itemId?: ObjectId;
};

export type {
  DescriptionStatus,
  InteractionStatus,
  InteractionTimings,
  ObservationState,
};

export async function items(): Promise<Collection<ItemDoc>> {
  return (await getDb()).collection<ItemDoc>("items");
}

export async function sightings(): Promise<Collection<SightingDoc>> {
  return (await getDb()).collection<SightingDoc>("sightings");
}

export async function interactions(): Promise<Collection<InteractionDoc>> {
  return (await getDb()).collection<InteractionDoc>("interactions");
}

// Expired documents are excluded at read time. The TTL index is only a backstop,
// and Mongo deletes on its own schedule. See README "Privacy and safety".
export function unexpired(now: Date = new Date()) {
  return { expiresAt: { $gt: now } };
}
