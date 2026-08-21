import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPreviewStubDeployment } from "./previewStubConfig";
import { assertVendorDisclosureProductionBuild } from "./vendorDisclosureProductionBuildFence";
import { WEDDING_APP_ROUTES } from "./weddingAppRoutes";

assertPreviewStubDeployment();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

assertVendorDisclosureProductionBuild({ repoRoot });

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://*.posthog.com https://us.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://api.dicebear.com https://hanbang.ai https://*.pstatic.net",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in wss://*.supabase.in https://challenges.cloudflare.com https://*.posthog.com https://us.i.posthog.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "frame-src https://challenges.cloudflare.com",
  "upgrade-insecure-requests",
].join("; ");

const saiContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in",
  "upgrade-insecure-requests",
].join("; ");

const localResearchContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "worker-src 'none'",
  "manifest-src 'none'",
].join("; ");

const weddingAppRoutes = [...WEDDING_APP_ROUTES];

const nextConfig: NextConfig = {
  devIndicators: process.env.WEDDING_CODE_RESEARCH_PREVIEW === "true" ? false : undefined,

  turbopack: {
    root: repoRoot,
  },

  // 정적 생성 워커 수 제한: 1,100+ 페이지가 카탈로그를 동시 조회하면
  // 단일 빌드 IP의 요청 버스트가 Supabase 게이트웨이에서 스로틀된다.
  experimental: {
    cpus: 8,
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
      // 레거시 예절 가이드 → 예절 안내.
      //
      // 2026-08-19에 `/etiquette` 25편을 `/manners/<slug>`로 이관했다. 옛 주소는
      // `?part=N` 쿼리로 25편을 한 URL에 담고 있었는데, 그 형태로는 검색에 주제별로
      // 잡히지 않는다. 이제 주제마다 고유 주소를 갖는다.
      //
      // 개별 파트로 정확히 보내려면 쿼리를 slug로 옮겨야 하지만, 옛 주소가 색인된
      // 적이 없어(사이트맵 0건) 목록으로 보내는 편이 단순하고 안전하다.
      {
        source: "/etiquette",
        destination: "/wedding/manners",
        permanent: true,
      },
      {
        source: "/wedding/etiquette",
        destination: "/wedding/manners",
        permanent: true,
      },
      // 루트(`/`)는 여기서 보내지 않는다. 2026-08-20부터 루트는 **앱의 문**이라
      // 세션에 따라 로그인과 라운지로 갈리는데, 엣지 리다이렉트는 세션을 볼 수 없다.
      // 판정은 `src/app/page.tsx`가 한다 — 이유는 그 파일 주석에 있다.
      // 서비스를 설명하는 랜딩은 `/landing`에 그대로 있고 sitemap·canonical도 그쪽이다.
      // 유통 테스트 착지 A — 비로그인 견적·추가금 진단 (UTM 쿼리는 자동 보존됨)
      {
        source: "/check",
        destination: "/wedding/community/quote-check",
        permanent: false,
      },
      // 시세표는 공시 가격 허브(/price)로 통합됐다. 페이지 안의 redirect()는 정적
      // 프리렌더에서 meta refresh(흰 화면 번쩍)로 나가므로 엣지에서 한 번에 보낸다.
      {
        source: "/market-prices",
        destination: "/price",
        permanent: false,
      },
      // DB 카테고리명(venue)으로 들어와도 404가 아니라 웨딩홀 목록으로 보낸다.
      {
        source: "/price/venue",
        destination: "/price/hall",
        permanent: false,
      },
      {
        source: "/wedding/market-prices",
        destination: "/price",
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
      {
        source: "/vendors/:id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})",
        destination: "/price/vendor-id/:id",
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
        source: "/sai",
        destination: "https://sai-mu-nine.vercel.app",
      },
      {
        source: "/sai/:path*",
        destination: "https://sai-mu-nine.vercel.app/:path*",
      },
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
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
      {
        source: "/sai",
        headers: [
          { key: "Content-Security-Policy", value: saiContentSecurityPolicy },
        ],
      },
      {
        source: "/internal/wedding-code-research",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
          { key: "Content-Security-Policy", value: localResearchContentSecurityPolicy },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
      {
        source: "/sai/:path*",
        headers: [
          { key: "Content-Security-Policy", value: saiContentSecurityPolicy },
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
