import type { MetadataRoute } from "next";

// One installable app for both people who use it. The landing page sends the
// wearer's phone to /wear and the caregiver to the dashboard. Installed from
// the home screen it runs without browser chrome, which /wear needs on iPhone:
// Safari has no element fullscreen, and wake lock works in home screen apps
// from iOS 18.4.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Memior",
    short_name: "Memior",
    description: "A wearable camera that remembers where things are, for people living with dementia.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#c65d3b",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
