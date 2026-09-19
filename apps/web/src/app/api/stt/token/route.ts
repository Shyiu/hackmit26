import { NextRequest, NextResponse } from "next/server";
import { STT_TOKEN_TTL_SECONDS, requireEnv } from "@/lib/auth/config";
import { withPrincipal } from "@/lib/auth/tenant";

// Mints a short-lived Deepgram key so the client streams audio directly and skips a hop.
// POST /v1/auth/grant returns a JWT with usage::write and a ttl we choose.
export async function GET(request: NextRequest) {
  return withPrincipal(request, ["session", "device"], async () => {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${requireEnv("DEEPGRAM_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: STT_TOKEN_TTL_SECONDS }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "deepgram grant failed", status: response.status },
        { status: 502 }
      );
    }

    const grant = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };

    return NextResponse.json({
      token: grant.access_token,
      expiresIn: grant.expires_in ?? STT_TOKEN_TTL_SECONDS,
      model: process.env.DEEPGRAM_STT_MODEL ?? "nova-3",
    });
  });
}
