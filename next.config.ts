import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // SEC-04: lets a refused page answer 403 with app/forbidden.tsx instead of a 500 error.
    authInterrupts: true,
    // Files up to 5 MB are accepted (saveAttachment); the form around them needs a little more (FILE-01).
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        // PEN-06: scripts, styles, images and form posts only from this site; no plugins, no other site framing us.
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
        { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
        { key: "Referrer-Policy", value: "same-origin" },
        // HSTS: browsers stay on HTTPS for a year. Ignored on plain-HTTP localhost.
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }];
  },
};

export default nextConfig;
