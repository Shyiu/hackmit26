import { markPairingCodeRedeemedBy, redeemDevicePairingCode, tenantRepos } from "@memory-glasses/db";
import { pairDeviceRequestSchema } from "@memory-glasses/shared";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError, readBody } from "@/lib/server/api";
import { DEVICE_TOKEN_TTL_SECONDS, mintDeviceToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { setDeviceCookie } from "@/lib/server/session-cookie";

export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, pairDeviceRequestSchema);
    const db = getDb();
    const redeemed = await redeemDevicePairingCode(db, input.code);
    if (redeemed.kind === "invalid") {
      throw new HttpError(401, "That code didn't work. Ask the caregiver for a new one.");
    }
    const pairingCode = redeemed.pairingCode;
    const device = await tenantRepos(db, pairingCode.patientId).devices.register({
      kind: pairingCode.kind,
      label: input.label,
    });
    await markPairingCodeRedeemedBy(db, pairingCode._id, device._id);
    const minted = await mintDeviceToken({
      patientId: pairingCode.patientId,
      deviceId: device._id,
      tokenVersion: device.tokenVersion,
      scope: "api",
      ttlSeconds: DEVICE_TOKEN_TTL_SECONDS,
    });
    const response = NextResponse.json(
      {
        token: minted.token,
        expiresAt: minted.expiresAt,
        patientId: pairingCode.patientId.toHexString(),
        deviceId: device._id.toHexString(),
      },
      { status: 201 },
    );
    setDeviceCookie(response, minted.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
