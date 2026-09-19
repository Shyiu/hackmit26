import { NextRequest, NextResponse } from "next/server";
import { createRecordingChunkSchema } from "@memory-glasses/shared";

// Returns a signed upload URL for one chunk of a registered recording.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = createRecordingChunkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ error: "not implemented", id }, { status: 501 });
}
