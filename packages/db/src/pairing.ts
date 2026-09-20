import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";
import { newId, type CaregiverId, type CaregiverPairingCodeId, type PatientId } from "./ids";
import { parseDocument } from "./errors";
import { collection } from "./registry";
import {
  CAREGIVER_PAIRING_CODE_LENGTH,
  CAREGIVER_PAIRING_CODE_MAX_ATTEMPTS,
  caregiverPairingCodeDocSchema,
  type CaregiverDoc,
  type CaregiverPairingCodeDoc,
} from "./schema/tenancy";

// A caregiver joining an existing wearer. Same hash/timing-safe-compare/expiry
// shape as a device pairing code would use (see README "What /wear and /sim
// call on first run"), redeemed by a second caregiver's own account instead of
// minting a device token.

export function hashCaregiverPairingCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateCaregiverPairingCode(): string {
  return randomInt(0, 10 ** CAREGIVER_PAIRING_CODE_LENGTH)
    .toString()
    .padStart(CAREGIVER_PAIRING_CODE_LENGTH, "0");
}

const CAREGIVER_PAIRING_CODE_TTL_SECONDS = 600; // 10 minutes

export async function createCaregiverPairingCode(
  db: Db,
  patientId: PatientId,
  now = new Date(),
): Promise<{ code: string; pairingCode: CaregiverPairingCodeDoc }> {
  const code = generateCaregiverPairingCode();
  const doc = parseDocument(caregiverPairingCodeDocSchema, {
    _id: newId<CaregiverPairingCodeId>(),
    patientId,
    codeHash: hashCaregiverPairingCode(code),
    attempts: 0,
    expiresAt: new Date(now.getTime() + CAREGIVER_PAIRING_CODE_TTL_SECONDS * 1000),
    redeemedAt: null,
    redeemedBy: null,
    createdAt: now,
  });
  await collection(db, "caregiverPairingCodes").insertOne(doc);
  return { code, pairingCode: doc };
}

export type RedeemCaregiverCodeResult =
  | { kind: "redeemed"; pairingCode: CaregiverPairingCodeDoc }
  | { kind: "invalid" };

/**
 * Compares a guess against every live code before claiming a matching one.
 * Wrong guesses burn all outstanding codes after the maximum number of tries.
 * Mirrors the device-pairing redeem shape exactly (packages/db/src/pairing.ts
 * on origin/devin/1789876293-device-pairing), operating on caregiverPairingCodes
 * instead of pairingCodes, and setting redeemedBy instead of a deviceId.
 */
export async function redeemCaregiverPairingCode(
  db: Db,
  code: string,
  now = new Date(),
): Promise<RedeemCaregiverCodeResult> {
  const live = await collection(db, "caregiverPairingCodes")
    .find({
      redeemedAt: null,
      expiresAt: { $gt: now },
      attempts: { $lt: CAREGIVER_PAIRING_CODE_MAX_ATTEMPTS },
    })
    .toArray();
  const guessHash = Buffer.from(hashCaregiverPairingCode(code), "hex");
  const matches: CaregiverPairingCodeId[] = [];
  for (const pairingCode of live) {
    const storedHash = Buffer.from(pairingCode.codeHash, "hex");
    if (timingSafeEqual(guessHash, storedHash)) matches.push(pairingCode._id);
  }
  if (matches.length === 0) {
    await collection(db, "caregiverPairingCodes").updateMany(
      {
        redeemedAt: null,
        expiresAt: { $gt: now },
        attempts: { $lt: CAREGIVER_PAIRING_CODE_MAX_ATTEMPTS },
      },
      { $inc: { attempts: 1 } },
    );
    return { kind: "invalid" };
  }
  for (const id of matches) {
    const claimed = await collection(db, "caregiverPairingCodes").findOneAndUpdate(
      {
        _id: id,
        redeemedAt: null,
        expiresAt: { $gt: now },
        attempts: { $lt: CAREGIVER_PAIRING_CODE_MAX_ATTEMPTS },
      },
      { $set: { redeemedAt: now } },
      { returnDocument: "after" },
    );
    if (claimed) return { kind: "redeemed", pairingCode: claimed };
  }
  return { kind: "invalid" };
}

export type AttachPatientResult =
  | { kind: "attached"; caregiver: CaregiverDoc }
  | { kind: "full" }
  | { kind: "not_found" };

/** Adds patientId to an existing caregiver's patientIds (already-attached is a no-op
 * success). Returns the updated doc so the caller can re-mint the session cookie --
 * sessionClaimsSchema.pids is baked into the signed cookie at login time, so appending
 * here alone wouldn't be visible until the caregiver logged in again otherwise. */
export async function addPatientToCaregiver(
  db: Db,
  caregiverId: CaregiverId,
  patientId: PatientId,
): Promise<AttachPatientResult> {
  const caregiver = await collection(db, "caregivers").findOne({ _id: caregiverId });
  if (!caregiver) return { kind: "not_found" };
  if (caregiver.patientIds.some((id) => id.equals(patientId))) return { kind: "attached", caregiver };
  if (caregiver.patientIds.length >= 20) return { kind: "full" };
  const updated = await collection(db, "caregivers").findOneAndUpdate(
    { _id: caregiverId },
    { $addToSet: { patientIds: patientId } },
    { returnDocument: "after" },
  );
  if (!updated) return { kind: "not_found" };
  return { kind: "attached", caregiver: updated };
}
