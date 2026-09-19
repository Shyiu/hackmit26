import { NextResponse } from "next/server";
import { requireEnv } from "./config";
import { readSessionCookie } from "./session";
import { verifyToken, type TokenScope } from "./tokens";

export type Principal = {
  patientId: string;
  scope: TokenScope;
  sub: string;
};

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return header.slice("bearer ".length).trim() || null;
}

// The tenant always comes from the session cookie or a signed device token,
// never from a body field or a query parameter.
export async function resolvePrincipal(request: Request): Promise<Principal | null> {
  const token = bearer(request);
  if (token) {
    const payload = await verifyToken(token, requireEnv("DEVICE_TOKEN_SECRET"));
    if (payload && payload.scope !== "session") {
      return { patientId: payload.patientId, scope: payload.scope, sub: payload.sub };
    }
    return null;
  }

  const session = await readSessionCookie();
  return session
    ? { patientId: session.patientId, scope: "session", sub: session.sub }
    : null;
}

export class Unauthorized extends Error {}

export async function requirePrincipal(
  request: Request,
  scopes: TokenScope[] = ["session", "device", "frames"]
): Promise<Principal> {
  const principal = await resolvePrincipal(request);
  if (!principal || !scopes.includes(principal.scope)) {
    throw new Unauthorized();
  }
  return principal;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

// Wraps a handler so an Unauthorized throw becomes a 401 instead of a 500.
export async function withPrincipal<T>(
  request: Request,
  scopes: TokenScope[],
  handler: (principal: Principal) => Promise<T>
): Promise<T | NextResponse> {
  try {
    return await handler(await requirePrincipal(request, scopes));
  } catch (error) {
    if (error instanceof Unauthorized) {
      return unauthorizedResponse();
    }
    throw error;
  }
}
