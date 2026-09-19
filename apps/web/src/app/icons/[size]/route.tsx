import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/app-icon";

const SIZES = { "192": 192, "512": 512, maskable: 512 } as const;

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

// PNG icons for the web app manifest. The maskable one keeps the mark inside
// the safe zone, since Android crops it to a circle or squircle.
export async function GET(_request: Request, { params }: RouteContext<"/icons/[size]">) {
  const { size: key } = await params;
  if (!(key in SIZES)) return new Response("Not found", { status: 404 });
  const size = SIZES[key as keyof typeof SIZES];
  const padding = key === "maskable" ? size * 0.1 : 0;
  return new ImageResponse(<AppIcon size={size} padding={padding} />, { width: size, height: size });
}
