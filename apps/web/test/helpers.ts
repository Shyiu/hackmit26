import { randomUUID } from "node:crypto";
import {
  createCaregiver,
  createPatient,
  syncDatabase,
  tenantRepos,
  type Db,
  type DeviceId,
  type PatientId,
} from "@memory-glasses/db";
import { signDeviceToken, type DeviceTokenClaims } from "@memory-glasses/shared";
import { NextRequest } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export type RouteHandler<TParams extends Record<string, string>> = (
  request: NextRequest,
  context: { params: Promise<TParams> },
) => Promise<Response>;

/** The database the routes will use, synced so validators and indexes are in place. */
export async function openRouteDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const db = getDb();
  await syncDatabase(db);
  return {
    db,
    close: async () => {
      await db.dropDatabase();
      await globalThis.__memoryGlassesMongo?.close();
      globalThis.__memoryGlassesMongo = undefined;
    },
  };
}

/** A wearer, a caregiver signed in for them, and a registered device with an API token. */
export async function newHousehold(db: Db) {
  const patient = await createPatient(db, { displayName: `Wearer ${randomUUID().slice(0, 4)}` });
  const caregiver = await createCaregiver(db, {
    email: `${randomUUID().slice(0, 8)}@example.com`,
    name: "Caregiver",
    patientIds: [patient._id],
  });
  const repos = tenantRepos(db, patient._id);
  const device = await repos.devices.register({ kind: "headset", label: "Phone" });
  const cookie = await createSessionToken(caregiver);
  return { patient, caregiver, device, repos, cookie };
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function apiClaims(input: {
  patientId: PatientId;
  deviceId: DeviceId | null;
  tokenVersion?: number;
  scope?: DeviceTokenClaims["scope"];
  iat?: number;
  exp?: number;
}): DeviceTokenClaims {
  const iat = input.iat ?? nowSeconds();
  return {
    v: 1,
    pid: input.patientId.toHexString(),
    sub: input.deviceId?.toHexString() ?? null,
    scope: input.scope ?? "api",
    tv: input.tokenVersion ?? 0,
    iat,
    exp: input.exp ?? iat + 600,
  };
}

export function deviceToken(claims: DeviceTokenClaims, secret = process.env.DEVICE_TOKEN_SECRET ?? "") {
  return signDeviceToken(claims, secret);
}

type Auth = { cookie?: string; bearer?: string; patientHeader?: string };

export function call<TParams extends Record<string, string>>(
  handler: RouteHandler<TParams>,
  input: { method?: string; path: string; params?: TParams; body?: unknown; auth?: Auth },
): Promise<Response> {
  const headers = new Headers();
  if (input.body !== undefined) headers.set("content-type", "application/json");
  if (input.auth?.cookie) headers.set("cookie", `${SESSION_COOKIE}=${input.auth.cookie}`);
  if (input.auth?.bearer) headers.set("authorization", `Bearer ${input.auth.bearer}`);
  if (input.auth?.patientHeader) headers.set("x-patient-id", input.auth.patientHeader);
  const request = new NextRequest(new URL(input.path, "http://localhost"), {
    method: input.method ?? (input.body === undefined ? "GET" : "POST"),
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return handler(request, { params: Promise.resolve((input.params ?? {}) as TParams) });
}
