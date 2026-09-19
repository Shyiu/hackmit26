import { z } from "zod";

// Compact HMAC-SHA256 tokens: base64url(payload).base64url(signature).
// Web Crypto only, so the same helpers work in the Node and edge runtimes.

export const tokenScopeSchema = z.enum(["session", "device", "frames"]);

export const tokenPayloadSchema = z.object({
  scope: tokenScopeSchema,
  patientId: z.string().min(1),
  sub: z.string().min(1),
  exp: z.number().int(),
});

export type TokenScope = z.infer<typeof tokenScopeSchema>;
export type TokenPayload = z.infer<typeof tokenPayloadSchema>;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signToken(
  payload: Omit<TokenPayload, "exp">,
  secret: string,
  ttlSeconds: number
): Promise<{ token: string; expiresAt: Date }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, exp })));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return {
    token: `${body}.${toBase64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(exp * 1000),
  };
}

export async function verifyToken(
  token: string,
  secret: string
): Promise<TokenPayload | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signature),
    encoder.encode(body)
  );
  if (!valid) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }

  const parsed = tokenPayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.exp * 1000 <= Date.now()) {
    return null;
  }
  return parsed.data;
}
