import { NextRequest, NextResponse } from "next/server";
import { askRequestSchema } from "@memory-glasses/shared";

// Fast path: alias lookup -> single Mongo read -> template sentence -> TTS stream.
// Responds with an X-Interaction-Id header before the audio body starts; the
// client polls GET /api/interactions/:id for text and final timings.
// Slow path (optional, post-MVP): OpenAI tool-calling fallback.
// See README "What happens when the wearer asks a question".
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
