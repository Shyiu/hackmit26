import { NextRequest, NextResponse } from "next/server";
import { FRAMES_TOKEN_TTL_SECONDS, requireEnv } from "@/lib/auth/config";
import { withPrincipal } from "@/lib/auth/tenant";
import { signToken } from "@/lib/auth/tokens";

// Mints a short-lived token for the perception frame socket. A browser can't set
// headers on a WebSocket, so the headset page sends it as the first message.
export async function GET(request: NextRequest) {
  return withPrincipal(request, ["session", "device"], async (principal) => {
    const { token, expiresAt } = await signToken(
      { scope: "frames", patientId: principal.patientId, sub: principal.sub },
      requireEnv("DEVICE_TOKEN_SECRET"),
      FRAMES_TOKEN_TTL_SECONDS
    );
    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
      url: process.env.NEXT_PUBLIC_PERCEPTION_WS_URL ?? null,
    });
  });
}
