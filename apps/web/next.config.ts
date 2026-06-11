import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const weddingAppRoutes = [
  "lounge",
  "chat",
  "budget",
  "schedule",
  "etiquette",
  "settings",
  "bookings",
  "money",
  "vendors",
  "market-prices",
  "favorites",
  "onboarding",
];

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
  },

  // gzip/brotli 압축 활성화
  compress: true,

  // 이미지 최적화
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30일 — Supabase Storage 이미지 장기 캐시
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.supabase.in" },
      { protocol: "https", hostname: "api.dicebear.com" },
    ],
  },

  async redirects() {
    return [
      {
        source: "/",
        destination: "/wedding",
        permanent: false,
      },
      // 유통 테스트 착지 A — 비로그인 견적·추가금 진단 (UTM 쿼리는 자동 보존됨)
      {
        source: "/check",
        destination: "/wedding/community/quote-check",
        permanent: false,
      },
      {
        source: "/dashboard/:path*",
        destination: "/wedding/lounge/:path*",
        permanent: false,
      },
      {
        source: "/community/chat",
        destination: "/wedding/chat",
        permanent: false,
      },
      {
        source: "/community/schedule",
        destination: "/wedding/schedule",
        permanent: false,
      },
      {
        source: "/community/budget",
        destination: "/wedding/budget",
        permanent: false,
      },
      {
        source: "/community",
        destination: "/wedding",
        permanent: false,
      },
      {
        source: "/community/:path*",
        destination: "/wedding/community/:path*",
        permanent: false,
      },
      {
        source: "/wedding/dashboard/:path*",
        destination: "/wedding/lounge/:path*",
        permanent: false,
      },
      {
        source: "/wedding/wedding",
        destination: "/wedding",
        permanent: false,
      },
      {
        source: "/wedding/wedding/:path*",
        destination: "/wedding/:path*",
        permanent: false,
      },
      {
        source: "/wedding/community",
        destination: "/wedding",
        permanent: false,
      },
      {
        source: "/wedding/community/chat",
        destination: "/wedding/chat",
        permanent: false,
      },
      {
        source: "/wedding/community/schedule",
        destination: "/wedding/schedule",
        permanent: false,
      },
      {
        source: "/wedding/community/budget",
        destination: "/wedding/budget",
        permanent: false,
      },
      ...weddingAppRoutes.map((route) => ({
        source: `/${route}/:path*`,
        destination: `/wedding/${route}/:path*`,
        permanent: false,
      })),
    ];
  },

  async rewrites() {
    return [
      {
        source: "/wedding",
        destination: "/community",
      },
      {
        source: "/wedding/community/:path*",
        destination: "/community/:path*",
      },
      ...weddingAppRoutes.map((route) => ({
        source: `/wedding/${route}/:path*`,
        destination: `/${route}/:path*`,
      })),
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // 정적 에셋 장기 캐시
      {
        source: "/images/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/fonts/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
