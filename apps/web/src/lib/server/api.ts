import "server-only";
import {
  collection,
  ConflictError,
  describeValidationFailure,
  InvalidInputError,
  MongoServerSelectionError,
  parseId,
  tenantRepos,
  type Id,
  type PatientId,
  type PatientSettings,
  type TenantRepos,
} from "@memory-glasses/db";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { DEVICE_COOKIE, principalFromRequest, SESSION_COOKIE, type Principal } from "./auth";
import { getDb } from "./db";
import { MissingEnvError } from "./env";

/** Thrown inside a handler to answer with a status other than 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function problem(status: number, message: string, details?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...details }, { status });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return problem(error.status, error.message, error.details);
  if (error instanceof InvalidInputError) return problem(400, error.message);
  if (error instanceof ConflictError) return problem(409, error.message, { field: error.field });
  if (error instanceof MissingEnvError) {
    return problem(503, process.env.NODE_ENV === "production" ? "The server is missing configuration" : error.message);
  }
  if (error instanceof MongoServerSelectionError) {
    return problem(503, "The database is unreachable. Check MONGODB_URI and that MongoDB is running.");
  }
  // A validator rejection means code wrote a shape the schema forbids; the details say where.
  console.error(describeValidationFailure(error) ?? error);
  return problem(500, "Something went wrong");
}

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}

export async function readBody<T>(request: Request, schema: Schema<T>): Promise<T> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new HttpError(400, "The body must be JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, describeIssues(parsed.error));
  return parsed.data;
}

export function readQuery<T>(request: NextRequest, schema: Schema<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new HttpError(400, describeIssues(parsed.error));
  return parsed.data;
}

/** An id from the URL. Garbage is a 404, the same as an id that isn't yours. */
export function readId<TId extends Id<string>>(value: string | undefined): TId {
  const id = value ? parseId<TId>(value) : null;
  if (!id) throw new HttpError(404, "Not found");
  return id;
}

// Settings change rarely and every request needs retentionDays, so each process
// keeps them for a few seconds instead of reading the patient on every call.
const SETTINGS_TTL_MS = 30_000;
const settingsCache = new Map<string, { settings: PatientSettings; loadedAt: number }>();

async function settingsFor(patientId: PatientId): Promise<PatientSettings | null> {
  const key = patientId.toHexString();
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.loadedAt < SETTINGS_TTL_MS) return cached.settings;
  const patient = await collection(getDb(), "patients").findOne({ _id: patientId });
  if (!patient) {
    settingsCache.delete(key);
    return null;
  }
  settingsCache.set(key, { settings: patient.settings, loadedAt: Date.now() });
  return patient.settings;
}

export function forgetSettings(patientId: PatientId) {
  settingsCache.delete(patientId.toHexString());
}

export type TenantRequest<TParams> = {
  request: NextRequest;
  params: TParams;
  principal: Principal;
  tenant: TenantRepos;
  settings: PatientSettings;
};

/**
 * Wraps a route handler: authenticates the caller, loads their wearer, and
 * hands over repositories already scoped to that wearer. Errors map to status
 * codes here, so handlers only write the success path.
 */
export function withTenant<TParams extends Record<string, string> = Record<string, never>>(
  access: "caregiver" | "device" | "any",
  handler: (request: TenantRequest<TParams>) => Promise<Response>,
) {
  return async (request: NextRequest, context: { params: Promise<TParams> }): Promise<Response> => {
    try {
      const principal = await principalFromRequest(request, {
        session: request.cookies.get(SESSION_COOKIE)?.value,
        device: request.cookies.get(DEVICE_COOKIE)?.value,
      });
      if (!principal) return problem(401, "Sign in first");
      if (access !== "any" && principal.kind !== access) return problem(403, `Only a ${access} can do this`);
      const settings = await settingsFor(principal.patientId);
      if (!settings) return problem(403, "That wearer no longer exists");
      const tenant = tenantRepos(getDb(), principal.patientId, { retentionDays: settings.retentionDays });
      if (principal.kind === "device") void tenant.devices.touch(principal.deviceId).catch(() => {});
      return await handler({ request, params: await context.params, principal, tenant, settings });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
