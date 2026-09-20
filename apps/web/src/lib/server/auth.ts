import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  collection,
  parseId,
  type CaregiverId,
  type DeviceId,
  type Id,
  type PatientId,
} from "@memory-glasses/db";
import {
  signDeviceToken,
  signToken,
  verifyDeviceToken,
  verifyToken,
  type DeviceTokenClaims,
} from "@memory-glasses/shared";
import { z } from "zod";
import { DEVICE_COOKIE, SESSION_COOKIE } from "../session-cookie";
import { getDb } from "./db";
import { requireEnv } from "./env";

// Two ways in, per README "Caregiver dashboard": a caregiver session cookie,
// which the /headset and /sim pages also ride on once the caregiver signs in
// on the phone, and a bearer device token for native clients later. Either
// way the wearer comes from a signed credential, never from a request body.

export { DEVICE_COOKIE, SESSION_COOKIE };
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEVICE_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;

const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/);

const sessionClaimsSchema = z
  .object({
    v: z.literal(1),
    cid: objectIdHex,
    pids: z.array(objectIdHex).min(1),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export type Principal =
  | { kind: "caregiver"; caregiverId: CaregiverId; patientId: PatientId }
  | { kind: "device"; deviceId: DeviceId; patientId: PatientId };

/** For hex that a signed credential already vouched for. */
function trustedId<TId extends Id<string>>(hex: string): TId {
  const id = parseId<TId>(hex);
  if (!id) throw new Error(`Signed credential carried a malformed id: ${hex}`);
  return id;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function createSessionToken(caregiver: { _id: CaregiverId; patientIds: PatientId[] }) {
  const iat = nowSeconds();
  return signToken(
    sessionClaimsSchema,
    {
      v: 1,
      cid: caregiver._id.toHexString(),
      pids: caregiver.patientIds.map((id) => id.toHexString()),
      iat,
      exp: iat + SESSION_TTL_SECONDS,
    },
    requireEnv("AUTH_SECRET"),
  );
}

/**
 * The caregiver behind a session cookie, acting for one of their wearers. A
 * caregiver with several wearers picks one with `requestedPatient`; the first
 * is the default. Null for a missing, forged, or expired cookie.
 */
export async function principalFromSession(
  cookie: string | undefined,
  requestedPatient?: string | null,
): Promise<Principal | null> {
  if (!cookie) return null;
  const session = await verifyToken(sessionClaimsSchema, cookie, requireEnv("AUTH_SECRET"));
  if (session.kind !== "valid") return null;
  const patient = requestedPatient ?? session.claims.pids[0];
  if (!patient || !session.claims.pids.includes(patient)) return null;
  return { kind: "caregiver", caregiverId: trustedId(session.claims.cid), patientId: trustedId(patient) };
}

export async function principalFromRequest(
  request: Request,
  cookies: { session: string | undefined; device: string | undefined },
): Promise<Principal | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return principalFromDeviceToken(authorization.slice("Bearer ".length));
  }
  if (cookies.device) {
    const principal = await principalFromDeviceToken(cookies.device);
    if (principal) return principal;
  }
  return principalFromSession(cookies.session, request.headers.get("x-patient-id"));
}

export async function principalFromDeviceToken(token: string): Promise<Principal | null> {
  const verified = await verifyDeviceToken(token, requireEnv("DEVICE_TOKEN_SECRET"));
  // API tokens must name a device, or revoking it couldn't cut them off.
  if (verified.kind !== "valid" || verified.claims.scope !== "api" || !verified.claims.sub) return null;
  const deviceId = trustedId<DeviceId>(verified.claims.sub);
  const patientId = trustedId<PatientId>(verified.claims.pid);
  const device = await collection(getDb(), "devices").findOne({ _id: deviceId, patientId, revokedAt: null });
  if (!device || device.tokenVersion !== verified.claims.tv) return null;
  return { kind: "device", deviceId, patientId };
}

export type MintedToken = { token: string; expiresAt: string };

/** A short-lived token for the frame socket or a native client, scoped to one wearer. */
export async function mintDeviceToken(input: {
  patientId: PatientId;
  deviceId: DeviceId | null;
  tokenVersion: number;
  scope: DeviceTokenClaims["scope"];
  ttlSeconds: number;
}): Promise<MintedToken> {
  const iat = nowSeconds();
  const exp = iat + input.ttlSeconds;
  const token = await signDeviceToken(
    {
      v: 1,
      pid: input.patientId.toHexString(),
      sub: input.deviceId?.toHexString() ?? null,
      scope: input.scope,
      tv: input.tokenVersion,
      iat,
      exp,
    },
    requireEnv("DEVICE_TOKEN_SECRET"),
  );
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * The one caregiver login from env, README open decision 7. Both comparisons
 * always run and take the same time whatever the input.
 */
export function credentialsMatch(email: string, password: string): boolean {
  const emailOk = timingSafeEqual(
    digest(email.trim().toLowerCase()),
    digest(requireEnv("CAREGIVER_EMAIL").trim().toLowerCase()),
  );
  const passwordOk = timingSafeEqual(digest(password), digest(requireEnv("CAREGIVER_PASSWORD")));
  return emailOk && passwordOk;
}
