import { HttpError, withTenant } from "@/lib/server/api";
import { optionalEnv, requireEnv } from "@/lib/server/env";

// Long enough to open the socket; Deepgram only checks it on connect.
const TOKEN_TTL_SECONDS = 60;
const DEFAULT_MODEL = "nova-3";

type GrantResponse = { access_token: string; expires_in: number };

// Mints a short-lived Deepgram token so the page streams mic audio to Deepgram
// directly and skips a hop. The API key never leaves the server. Without
// DEEPGRAM_API_KEY this is a 503 and the page falls back to the browser's own
// speech recognition.
export const GET = withTenant("any", async () => {
  const key = requireEnv("DEEPGRAM_API_KEY");
  const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("Deepgram token grant failed", response.status, await response.text().catch(() => ""));
    throw new HttpError(502, "Speech to text is unavailable");
  }
  const grant = (await response.json()) as GrantResponse;
  return Response.json({
    token: grant.access_token,
    expiresAt: new Date(Date.now() + grant.expires_in * 1000).toISOString(),
    model: optionalEnv("DEEPGRAM_STT_MODEL") ?? DEFAULT_MODEL,
  });
});
