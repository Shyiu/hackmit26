import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  demoPatientId,
  requireEnv,
} from "./config";
import { signToken, verifyToken, type TokenPayload } from "./tokens";

export type CaregiverSession = {
  patientId: string;
  caregiverId: string;
};

export async function createSession(caregiverId: string): Promise<void> {
  const { token, expiresAt } = await signToken(
    { scope: "session", patientId: demoPatientId(), sub: caregiverId },
    requireEnv("AUTH_SECRET"),
    SESSION_TTL_SECONDS
  );

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function readSessionCookie(): Promise<TokenPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const payload = await verifyToken(token, requireEnv("AUTH_SECRET"));
  return payload?.scope === "session" ? payload : null;
}

export async function getSession(): Promise<CaregiverSession | null> {
  const payload = await readSessionCookie();
  return payload
    ? { patientId: payload.patientId, caregiverId: payload.sub }
    : null;
}
