import { NextRequest, NextResponse } from "next/server";
import { DEVICE_TOKEN_TTL_SECONDS, requireEnv } from "@/lib/auth/config";
import { withPrincipal } from "@/lib/auth/tenant";
import { signToken } from "@/lib/auth/tokens";

// The caregiver signs in on the phone once and /headset or /sim trades that
// session for a short-lived device token it sends as a bearer header.
export async function GET(request: NextRequest) {
  return withPrincipal(request, ["session"], async (principal) => {
    const { token, expiresAt } = await signToken(
      { scope: "device", patientId: principal.patientId, sub: principal.sub },
      requireEnv("DEVICE_TOKEN_SECRET"),
      DEVICE_TOKEN_TTL_SECONDS
    );
    return NextResponse.json({ token, expiresAt: expiresAt.toISOString() });
  });
}
