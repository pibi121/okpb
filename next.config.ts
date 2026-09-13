import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Native deps used only on the server (Railway has no openssh binary).
  serverExternalPackages: [
    "ssh2",
    "cpu-features",
    "ssh2-streams",
    "ffmpeg-static",
    "ffprobe-static",
  ],
  experimental: {
    // Allow one-shot SQLite import for owner cabinet restore.
    serverActions: {
      bodySizeLimit: "25mb",
    },
    proxyClientMaxBodySize: "25mb",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent the app from being embedded in iframes (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Stop browsers from MIME-sniffing the content type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak the full referrer URL to third parties.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Restrict access to browser features we don't use.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Force HTTPS for 2 years (only meaningful when served over HTTPS).
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Basic XSS protection header (legacy browsers).
          { key: "X-XSS-Protection", value: "1; mode=block" },
        ],
      },
    ];
  },
};

export default nextConfig;
