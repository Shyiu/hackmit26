import {
  attachDeviceToPairingCode,
  collection,
  redeemPairingCode,
  tenantRepos,
} from "@memory-glasses/db";
import { pairDeviceRequestSchema } from "@memory-glasses/shared";
import { errorResponse, HttpError, readBody } from "@/lib/server/api";
import { DEVICE_API_TOKEN_TTL_SECONDS, mintDeviceToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export async function POST(request: Request) {
  try {
    const body = await readBody(request, pairDeviceRequestSchema);
    const result = await redeemPairingCode(getDb(), body.code);
    if (result.kind === "invalid") {
      throw new HttpError(401, "That code didn't work. Ask the caregiver for a new one.");
    }
    const patient = await collection(getDb(), "patients").findOne({ _id: result.pairingCode.patientId });
    if (!patient) throw new HttpError(403, "That wearer no longer exists");
    const tenant = tenantRepos(getDb(), patient._id, { retentionDays: patient.settings.retentionDays });
    const device = await tenant.devices.register({ kind: body.kind, label: body.name });
    await attachDeviceToPairingCode(getDb(), result.pairingCode._id, device._id);
    const token = await mintDeviceToken({
      patientId: patient._id,
      deviceId: device._id,
      tokenVersion: device.tokenVersion,
      scope: "api",
      ttlSeconds: DEVICE_API_TOKEN_TTL_SECONDS,
    });
    return Response.json({ deviceId: device._id.toHexString(), ...token }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
