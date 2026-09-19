import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The home screen icon on iPhone. iOS rounds the corners itself.
export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} />, size);
}
