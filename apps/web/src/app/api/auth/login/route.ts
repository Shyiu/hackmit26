import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEnv, secretsMatch } from "@/lib/auth/config";
import { createSession } from "@/lib/auth/session";

const loginSchema = z.object({ password: z.string().min(1) });

// v1 auth is one caregiver login against CAREGIVER_PASSWORD, mapped to the
// seeded wearer. See README "Caregiver dashboard".
export async function POST(request: NextRequest) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!secretsMatch(parsed.data.password, requireEnv("CAREGIVER_PASSWORD"))) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  await createSession(process.env.CAREGIVER_ID ?? "demo-caregiver");
  return NextResponse.json({ ok: true });
}
