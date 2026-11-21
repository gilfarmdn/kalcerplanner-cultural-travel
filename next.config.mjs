// CSP dibuat per permintaan (dengan nonce) di src/middleware.ts via src/lib/csp.ts.

const securityHeaders = [
  // Peramban hanya menerapkan HSTS lewat HTTPS (situs publik di Tailscale Funnel); di http://localhost diabaikan.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    instrumentationHook: true,          
  },
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack: (config, { dev }) => {
    // Cache disk webpack butuh banyak memori; di dev kita matikan agar tidak crash.
    if (dev) config.cache = false;
    return config;
  },
};

export default nextConfig;
