import { NextRequest, NextResponse } from "next/server";
import { createItemSchema } from "@memory-glasses/shared";

// GET: list items for a patient. POST: create an item and push the prompt list
// to the perception service. See README "Data model" and "API sketch".
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
