import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";
import { parseDocument } from "./errors";
import { type DeviceId, type PairingCodeId, newId } from "./ids";
import { collection } from "./registry";
import {
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_MAX_ATTEMPTS,
  pairingCodeDocSchema,
  type PairingCodeDoc,
} from "./schema/tenancy";

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generatePairingCode(): string {
  return randomInt(0, 10 ** PAIRING_CODE_LENGTH).toString().padStart(PAIRING_CODE_LENGTH, "0");
}

export type RedeemResult = { kind: "redeemed"; pairingCode: PairingCodeDoc } | { kind: "invalid" };

/**
 * Compares a guess against every live code before claiming a matching one.
 * Wrong guesses burn all outstanding codes after the maximum number of tries.
 */
export async function redeemPairingCode(db: Db, code: string, now = new Date()): Promise<RedeemResult> {
  const live = await collection(db, "pairingCodes")
    .find({ redeemedAt: null, expiresAt: { $gt: now }, attempts: { $lt: PAIRING_CODE_MAX_ATTEMPTS } })
    .toArray();
  const guessHash = Buffer.from(hashPairingCode(code), "hex");
  const matches: PairingCodeId[] = [];
  for (const pairingCode of live) {
    const storedHash = Buffer.from(pairingCode.codeHash, "hex");
    if (timingSafeEqual(guessHash, storedHash)) matches.push(pairingCode._id);
  }
  if (matches.length === 0) {
    await collection(db, "pairingCodes").updateMany(
      { redeemedAt: null, expiresAt: { $gt: now }, attempts: { $lt: PAIRING_CODE_MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } },
    );
    return { kind: "invalid" };
  }
  for (const id of matches) {
    const claimed = await collection(db, "pairingCodes").findOneAndUpdate(
      { _id: id, redeemedAt: null, expiresAt: { $gt: now }, attempts: { $lt: PAIRING_CODE_MAX_ATTEMPTS } },
      { $set: { redeemedAt: now } },
      { returnDocument: "after" },
    );
    if (claimed) return { kind: "redeemed", pairingCode: claimed };
  }
  return { kind: "invalid" };
}

export async function attachDeviceToPairingCode(
  db: Db,
  id: PairingCodeId,
  deviceId: DeviceId,
): Promise<void> {
  await collection(db, "pairingCodes").updateOne({ _id: id }, { $set: { deviceId } });
}
