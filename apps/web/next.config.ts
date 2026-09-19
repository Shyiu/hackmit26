import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone needs HTTPS for the camera, so it reaches `pnpm dev` through a
  // tunnel. Add your tunnel's hostname here if it isn't a quick Cloudflare one.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
