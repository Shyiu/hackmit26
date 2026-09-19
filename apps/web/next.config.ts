import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone needs HTTPS for the camera, so it reaches `pnpm dev` through a
  // tunnel. Add your tunnel's hostname here if it isn't a quick Cloudflare one.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // The VR headset page became the chest page (ADR 0003). Old home screen
  // shortcuts still point at /headset.
  async redirects() {
    return [{ source: "/headset", destination: "/wear", permanent: false }];
  },
};

export default nextConfig;
