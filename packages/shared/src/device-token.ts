import { z } from "zod";

// Short-lived tokens that let a capture page talk to the perception service,
// and later let the glasses app call the API. Format: base64url(JSON claims),
// a dot, then base64url(HMAC-SHA256(secret, the first part)). The web app
// mints them with DEVICE_TOKEN_SECRET; services/perception/app/tokens.py
// verifies the same bytes. packages/shared/fixtures/device-token.json is the
// cross-language check.

const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/);

export const deviceTokenClaimsSchema = z
  .object({
    v: z.literal(1),
    /** The wearer. Every read and write the token allows is scoped to it. */
    pid: objectIdHex,
    /** The registered device, or null for a caregiver's signed-in page. */
    sub: objectIdHex.nullable(),
    scope: z.enum(["frames", "debug", "api"]),
    /** The device's tokenVersion at mint time. Revoking bumps it. */
    tv: z.number().int().nonnegative(),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export type DeviceTokenClaims = z.infer<typeof deviceTokenClaimsSchema>;

export type VerifiedToken =
  | { kind: "valid"; claims: DeviceTokenClaims }
  | { kind: "invalid"; reason: "malformed" | "bad_signature" | "expired" };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// No return annotation: Node's types declare CryptoKey as a value, the DOM's as a type.
async function hmacKey(secret: string, usage: "sign" | "verify") {
  if (secret.length < 32) throw new Error("DEVICE_TOKEN_SECRET must be at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signDeviceToken(claims: DeviceTokenClaims, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(deviceTokenClaimsSchema.parse(claims))));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Checks the signature before reading anything, then the expiry against `nowSeconds`. */
export async function verifyDeviceToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedToken> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return { kind: "invalid", reason: "malformed" };
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (!signatureBytes || !payloadBytes) return { kind: "invalid", reason: "malformed" };

  const key = await hmacKey(secret, "verify");
  if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payload)))) {
    return { kind: "invalid", reason: "bad_signature" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { kind: "invalid", reason: "malformed" };
  }
  const claims = deviceTokenClaimsSchema.safeParse(decoded);
  if (!claims.success) return { kind: "invalid", reason: "malformed" };
  if (claims.data.exp <= nowSeconds) return { kind: "invalid", reason: "expired" };
  return { kind: "valid", claims: claims.data };
}
