import type { Metadata, Viewport } from "next";
import { HeadsetView } from "./headset-view";

export const metadata: Metadata = {
  title: "Headset",
  appleWebApp: { capable: true, title: "Headset", statusBarStyle: "black-translucent" },
};

// No pinch zoom: it would throw off the eye calibration.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "black",
  colorScheme: "dark",
};

// The wearer's view: the phone's rear camera once per eye, with the HUD on top.
// See README "The headset: a phone in a printed shell".
export default function HeadsetPage() {
  return <HeadsetView />;
}
