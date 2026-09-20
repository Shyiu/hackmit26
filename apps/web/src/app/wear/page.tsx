import type { Metadata, Viewport } from "next";
import { WearView } from "./wear-view";

export const metadata: Metadata = {
  title: "Wear",
  appleWebApp: { capable: true, title: "Memoir", statusBarStyle: "black-translucent" },
};

// No pinch zoom: a tap anywhere is the ask button.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "black",
  colorScheme: "dark",
};

// The chest page: the rear camera streams frames, a tap asks a question, and
// the answer is spoken and shown as a caption. PLAN.md "What the page has to do".
export default function WearPage() {
  return <WearView />;
}
