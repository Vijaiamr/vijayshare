/** @type {import('next').NextConfig} */
const isSupabaseMode = process.env.NEXT_PUBLIC_DATA_MODE === "supabase";

const nextConfig = {
  output: "standalone",
  turbopack: {
    // Portable: resolves to the project root on any machine (local + Vercel)
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "8765" },
    ],
  },
  // Security headers — sensible defaults for a personal financial app.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  // In supabase mode there is no local FastAPI — disable the localhost rewrite.
  ...(!isSupabaseMode && {
    async rewrites() {
      return [
        {
          source: "/__api/:path*",
          destination: "http://localhost:8765/api/v1/:path*",
        },
      ];
    },
  }),
};

export default nextConfig;
