import { ObjectId } from "mongodb";
import { z } from "zod";

/**
 * An ObjectId tagged with the collection it points into. Passing an ItemId where
 * a PatientId is expected is a compile error, and the brand exists only in types.
 */
export type Id<TBrand extends string> = ObjectId & { readonly __brand: TBrand };

export type PatientId = Id<"PatientId">;
export type CaregiverId = Id<"CaregiverId">;
export type DeviceId = Id<"DeviceId">;
export type ItemId = Id<"ItemId">;
export type SightingId = Id<"SightingId">;
export type RoomId = Id<"RoomId">;
export type RoomRefId = Id<"RoomRefId">;
export type InteractionId = Id<"InteractionId">;
export type NotificationId = Id<"NotificationId">;
export type RecordingId = Id<"RecordingId">;
export type CaptureSessionId = Id<"CaptureSessionId">;
export type DescriptionJobId = Id<"DescriptionJobId">;
export type PersonId = Id<"PersonId">;
export type FrameObservationId = Id<"FrameObservationId">;
export type CaregiverPairingCodeId = Id<"CaregiverPairingCodeId">;
export type PairingCodeId = Id<"PairingCodeId">;
export type ScanPinId = Id<"ScanPinId">;

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** Schema for a stored reference. `bsonType` carries through to the MongoDB validator. */
export function idSchema<TId extends Id<string>>() {
  return z
    .custom<TId>((value) => value instanceof ObjectId, { error: "Expected an ObjectId" })
    .meta({ bsonType: "objectId" });
}

export function newId<TId extends Id<string>>(): TId {
  // The one place an ObjectId becomes a branded id without a check: it was just minted.
  return new ObjectId() as TId;
}

/** Parses a 24-character hex string from a URL or request body. Returns null on garbage. */
export function parseId<TId extends Id<string>>(value: string): TId | null {
  return OBJECT_ID_HEX.test(value) ? (new ObjectId(value.toLowerCase()) as TId) : null;
}
