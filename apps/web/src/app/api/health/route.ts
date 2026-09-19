import { schemaStatus } from "@memory-glasses/db";
import { getDb } from "@/lib/server/db";

// Unauthenticated, so it reports states and never data. `schema: "stale"` means
// someone changed packages/db without running `pnpm db:setup`.
export async function GET() {
  try {
    const status = await schemaStatus(getDb());
    return Response.json({ ok: status.kind === "current", db: "ok", schema: status.kind });
  } catch {
    return Response.json({ ok: false, db: "unreachable", schema: "unknown" }, { status: 503 });
  }
}
