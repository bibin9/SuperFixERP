import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Files up to 5 MB are accepted (saveAttachment); the form around them needs a little more (FILE-01).
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
