import type { z } from "zod";

// A compact signed token: base64url(JSON claims), a dot, then
// base64url(HMAC-SHA256(secret, the first part)). The claims schema decides
// what's inside; every token carries `exp` in unix seconds. Device tokens and
// the caregiver session cookie both use it.

export type VerifiedToken<TClaims> =
  | { kind: "valid"; claims: TClaims }
  | { kind: "invalid"; reason: "malformed" | "bad_signature" | "expired" };

type ClaimsSchema = z.ZodType<{ exp: number }, z.ZodTypeDef, unknown>;

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
  if (secret.length < 32) throw new Error("Token secrets must be at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signToken<TSchema extends ClaimsSchema>(
  schema: TSchema,
  claims: z.input<TSchema>,
  secret: string,
): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(schema.parse(claims))));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Checks the signature before reading anything, then the claims, then `exp` against `nowSeconds`. */
export async function verifyToken<TSchema extends ClaimsSchema>(
  schema: TSchema,
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedToken<z.output<TSchema>>> {
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
  const claims = schema.safeParse(decoded);
  if (!claims.success) return { kind: "invalid", reason: "malformed" };
  if (claims.data.exp <= nowSeconds) return { kind: "invalid", reason: "expired" };
  return { kind: "valid", claims: claims.data };
}
