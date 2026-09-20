import { parseDocument } from "../errors";
import { hashPairingCode, generatePairingCode } from "../pairing";
import { newId, type CaregiverId, type PairingCodeId } from "../ids";
import { PAIRING_CODE_MAX_ATTEMPTS, pairingCodeDocSchema, type PairingCodeDoc } from "../schema/tenancy";
import { tenantCollection, type RepoContext } from "./context";

export const PAIRING_CODE_TTL_SECONDS = 10 * 60;

export function pairingCodesRepo(ctx: RepoContext) {
  const pairingCodes = tenantCollection(ctx, "pairingCodes");

  return {
    /** Mints a code. The plain code is returned once here and only its hash is stored. */
    async create(input: { createdBy: CaregiverId }): Promise<{ pairingCode: PairingCodeDoc; code: string }> {
      const code = generatePairingCode();
      const now = ctx.now();
      const pairingCode = parseDocument(pairingCodeDocSchema, {
        _id: newId<PairingCodeId>(),
        patientId: ctx.patientId,
        createdBy: input.createdBy,
        codeHash: hashPairingCode(code),
        attempts: 0,
        expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_SECONDS * 1000),
        redeemedAt: null,
        deviceId: null,
        createdAt: now,
      });
      await pairingCodes.insertOne(pairingCode);
      return { pairingCode, code };
    },

    listLive(): Promise<PairingCodeDoc[]> {
      return pairingCodes
        .find({ redeemedAt: null, expiresAt: { $gt: ctx.now() }, attempts: { $lt: PAIRING_CODE_MAX_ATTEMPTS } })
        .sort({ createdAt: -1 })
        .toArray();
    },
  };
}

export type PairingCodesRepo = ReturnType<typeof pairingCodesRepo>;
