import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone needs HTTPS for the camera, so it reaches `pnpm dev` through a
  // tunnel. `pnpm start --tunnel` uses a quick Cloudflare one, or localhost.run
  // where the network blocks cloudflared. Add your hostname if it is neither.
  allowedDevOrigins: ["*.trycloudflare.com", "*.lhr.life"],
  // The VR headset page became the chest page (ADR 0003). Old home screen
  // shortcuts still point at /headset.
  async redirects() {
    return [{ source: "/headset", destination: "/wear", permanent: false }];
  },
};

export default nextConfig;
