import type { MetadataRoute } from "next";

// "Add to Home Screen" opens the headset without browser chrome. iPhone Safari
// has no element fullscreen, so this is how the headset gets the whole screen there.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/headset",
    name: "Memory glasses headset",
    short_name: "Headset",
    description: "The wearer's view for the 3D-printed phone headset.",
    start_url: "/headset",
    scope: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
