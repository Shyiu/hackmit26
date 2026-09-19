import "server-only";
import {
  locationStatus,
  ObjectId,
  type InteractionDoc,
  type ItemDoc,
  type NotificationDoc,
  type RoomDoc,
  type SightingDoc,
} from "@memory-glasses/db";

/** A stored document as JSON: ObjectIds become hex strings and Dates ISO strings. */
export type Json<T> = T extends ObjectId
  ? string
  : T extends Date
    ? string
    : T extends readonly (infer Element)[]
      ? Json<Element>[]
      : T extends object
        ? { [K in keyof T]: Json<T[K]> }
        : T;

function convert(value: unknown): unknown {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(convert);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, convert(entry)]));
  }
  return value;
}

export function toJson<T>(value: T): Json<T> {
  // The recursion mirrors the Json<T> type exactly; TypeScript can't follow it.
  return convert(value) as Json<T>;
}

function without<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

// Views drop the tenant id, which the caller already knows, and fields that are
// internal or heavy, like embeddings.

export function itemView(item: ItemDoc) {
  return {
    ...toJson(without(item, ["patientId", "lookupKeys", "nameEmbedding", "embeddingModel"])),
    locationStatus: locationStatus(item.lastSighting),
  };
}

export function sightingView(sighting: SightingDoc) {
  return toJson(without(sighting, ["patientId", "searchText", "sentenceEmbedding", "embeddingModel"]));
}

export function interactionView(interaction: InteractionDoc) {
  return toJson(without(interaction, ["patientId"]));
}

export function roomView(room: RoomDoc) {
  return toJson(without(room, ["patientId", "normalizedName"]));
}

export function notificationView(notification: NotificationDoc) {
  return toJson(without(notification, ["patientId"]));
}

export type ItemView = ReturnType<typeof itemView>;
export type SightingView = ReturnType<typeof sightingView>;
export type InteractionView = ReturnType<typeof interactionView>;
export type RoomView = ReturnType<typeof roomView>;
export type NotificationView = ReturnType<typeof notificationView>;
