import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt from node:crypto, so no native dependency. N=2^15 costs about 50 ms
// and 32 MB per hash, which slows guessing without stalling a login.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...options, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** `scrypt$N$r$p$salt$hash`. The parameters travel with the hash, so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Checked against when the email has no account, so a miss takes as long as a
// wrong password and doesn't reveal which emails exist.
let dummyHash: Promise<string> | null = null;
export function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword("not a real password");
  return dummyHash.then((stored) => verifyPassword(password, stored));
}
