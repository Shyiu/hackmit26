import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Collection, Db, Document, Filter, ObjectId } from "mongodb";
import {
  newId,
  type CaregiverId,
  type CaregiverPairingCodeId,
  type DeviceId,
  type PairingCodeId,
  type PatientId,
} from "./ids";
import { parseDocument } from "./errors";
import { collection } from "./registry";
import type { CaptureSource } from "./schema/common";
import {
  CAREGIVER_PAIRING_CODE_LENGTH,
  CAREGIVER_PAIRING_CODE_MAX_ATTEMPTS,
  caregiverPairingCodeDocSchema,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_MAX_ATTEMPTS,
  pairingCodeDocSchema,
  type CaregiverDoc,
  type CaregiverPairingCodeDoc,
  type PairingCodeDoc,
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
const DEVICE_PAIRING_CODE_TTL_SECONDS = 600;

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

export function generateDevicePairingCode(): string {
  return randomInt(0, 10 ** PAIRING_CODE_LENGTH)
    .toString()
    .padStart(PAIRING_CODE_LENGTH, "0");
}

export async function createDevicePairingCode(
  db: Db,
  patientId: PatientId,
  kind: CaptureSource,
  now = new Date(),
): Promise<{ code: string; pairingCode: PairingCodeDoc }> {
  const code = generateDevicePairingCode();
  const doc = parseDocument(pairingCodeDocSchema, {
    _id: newId<PairingCodeId>(),
    patientId,
    codeHash: hashCaregiverPairingCode(code),
    attempts: 0,
    expiresAt: new Date(now.getTime() + DEVICE_PAIRING_CODE_TTL_SECONDS * 1000),
    redeemedAt: null,
    redeemedBy: null,
    kind,
    createdAt: now,
  });
  await collection(db, "pairingCodes").insertOne(doc);
  return { code, pairingCode: doc };
}

type RedeemablePairingCode = {
  _id: ObjectId;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  redeemedAt: Date | null;
};

async function redeemPairingCode<TCode extends RedeemablePairingCode>(
  codes: Collection<TCode>,
  code: string,
  maxAttempts: number,
  now: Date,
): Promise<TCode | null> {
  const liveFilter = {
      redeemedAt: null,
      expiresAt: { $gt: now },
      attempts: { $lt: maxAttempts },
    } as Filter<TCode>;
  const live = await codes.find(liveFilter).toArray();
  const guessHash = Buffer.from(hashCaregiverPairingCode(code), "hex");
  const matches: ObjectId[] = [];
  for (const pairingCode of live) {
    const storedHash = Buffer.from(pairingCode.codeHash, "hex");
    if (timingSafeEqual(guessHash, storedHash)) matches.push(pairingCode._id);
  }
  if (matches.length === 0) {
    await codes.updateMany(
      liveFilter,
      { $inc: { attempts: 1 } } as Document,
    );
    return null;
  }
  for (const id of matches) {
    const claimed = await codes.findOneAndUpdate(
      {
        _id: id,
        redeemedAt: null,
        expiresAt: { $gt: now },
        attempts: { $lt: maxAttempts },
      } as Filter<TCode>,
      { $set: { redeemedAt: now } } as Document,
      { returnDocument: "after" },
    );
    if (claimed) return claimed as TCode;
  }
  return null;
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
  const pairingCode = await redeemPairingCode(
    collection(db, "caregiverPairingCodes"),
    code,
    CAREGIVER_PAIRING_CODE_MAX_ATTEMPTS,
    now,
  );
  return pairingCode ? { kind: "redeemed", pairingCode } : { kind: "invalid" };
}

export async function redeemDevicePairingCode(
  db: Db,
  code: string,
  now = new Date(),
): Promise<{ kind: "redeemed"; pairingCode: PairingCodeDoc } | { kind: "invalid" }> {
  const pairingCode = await redeemPairingCode(collection(db, "pairingCodes"), code, PAIRING_CODE_MAX_ATTEMPTS, now);
  return pairingCode ? { kind: "redeemed", pairingCode } : { kind: "invalid" };
}

export async function markPairingCodeRedeemedBy(
  db: Db,
  codeId: PairingCodeId,
  deviceId: DeviceId,
): Promise<void> {
  await collection(db, "pairingCodes").updateOne({ _id: codeId }, { $set: { redeemedBy: deviceId } });
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
