import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Native deps used only on the server (Railway has no openssh binary).
  serverExternalPackages: ["ssh2", "cpu-features", "ssh2-streams"],
  experimental: {
    // Allow one-shot SQLite import for owner cabinet restore.
    serverActions: {
      bodySizeLimit: "25mb",
    },
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
