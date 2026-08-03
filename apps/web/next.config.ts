import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPreviewStubDeployment } from "./previewStubConfig";
import { assertPrivacyProductionBuild } from "./privacyProductionBuildFence";
import { assertVendorDisclosureProductionBuild } from "./vendorDisclosureProductionBuildFence";
import { WEDDING_APP_ROUTES } from "./weddingAppRoutes";

assertPreviewStubDeployment();

const previewStubMode = process.env.NEXT_PUBLIC_PREVIEW_STUB_MODE === "true";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

assertPrivacyProductionBuild();
assertVendorDisclosureProductionBuild({ repoRoot });

function configuredSupabaseEndpoint(): { hostname: string; httpsOrigin: string; wssOrigin: string } | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
      || !/^[a-z0-9][a-z0-9-]{3,62}\.supabase\.co$/.test(url.hostname)
    ) {
      return null;
    }
    return {
      hostname: url.hostname,
      httpsOrigin: url.origin,
      wssOrigin: `wss://${url.hostname}`,
    };
  } catch {
    return null;
  }
}

const supabaseEndpoint = previewStubMode ? null : configuredSupabaseEndpoint();

function configuredSentryBrowserOrigin(): string | null {
  const rawDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!rawDsn) return null;

  try {
    const url = new URL(rawDsn);
    if (
      url.protocol !== "https:"
      || !url.username
      || url.password
      || url.search
      || url.hash
      || !/^o[0-9]+\.ingest(?:\.us)?\.sentry\.io$/u.test(url.hostname)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

const sentryBrowserOrigin = previewStubMode ? null : configuredSentryBrowserOrigin();
const postHogBrowserOrigin = !previewStubMode
  && process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "true"
  ? "https://us.i.posthog.com"
  : null;
const turnstileBrowserOrigin = previewStubMode
  ? null
  : "https://challenges.cloudflare.com";
const remoteImageOrigins = previewStubMode
  ? ""
  : " https://hanbang.ai https://*.pstatic.net";

// Next.js Fast Refresh needs eval-backed source maps during local development.
// Production bundles do not, so do not weaken the production CSP for that tool.
const developmentUnsafeEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${developmentUnsafeEval}${turnstileBrowserOrigin ? ` ${turnstileBrowserOrigin}` : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseEndpoint ? ` ${supabaseEndpoint.httpsOrigin}` : ""}${remoteImageOrigins}`,
  "font-src 'self' data:",
  `connect-src 'self'${supabaseEndpoint ? ` ${supabaseEndpoint.httpsOrigin} ${supabaseEndpoint.wssOrigin}` : ""}${turnstileBrowserOrigin ? ` ${turnstileBrowserOrigin}` : ""}${postHogBrowserOrigin ? ` ${postHogBrowserOrigin}` : ""}${sentryBrowserOrigin ? ` ${sentryBrowserOrigin}` : ""}`,
  turnstileBrowserOrigin ? `frame-src ${turnstileBrowserOrigin}` : "frame-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const localResearchContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  `script-src 'self' 'unsafe-inline'${developmentUnsafeEval}`,
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
      ...(supabaseEndpoint
        ? [{ protocol: "https" as const, hostname: supabaseEndpoint.hostname }]
        : []),
    ],
  },

  async redirects() {
    return [
      // SAI는 별도 배포다. 외부 rewrite는 hanbang.ai의 Cookie/Authorization을
      // upstream으로 넘기고, 외부 HTML/JS를 메인 origin 권한으로 실행시킨다.
      // 브라우저가 별도 origin으로 직접 이동해야 두 신뢰 경계가 분리된다.
      {
        source: "/sai",
        destination: "https://sai-mu-nine.vercel.app",
        permanent: false,
      },
      {
        source: "/sai/:path*",
        destination: "https://sai-mu-nine.vercel.app/:path*",
        permanent: false,
      },
      // 루트는 **서비스를 설명하는 랜딩**으로 보낸다(2026-07-29).
      // 그전에는 커뮤니티 피드로 바로 떨어졌는데, 피드는 이 서비스를 이미 아는
      // 사람에게나 쓸모 있는 화면이라 첫 방문자는 "여기가 뭐 하는 곳인지" 알 수
      // 없었다. 앱으로 들어가는 문(`/wedding`)은 랜딩 안에서 링크로 연다.
      {
        source: "/",
        destination: "/landing",
        permanent: false,
      },
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
          // Legacy browser XSS auditors can be abused to alter otherwise safe
          // pages. Modern browsers rely on CSP; OWASP recommends explicitly
          // disabling this retired filter instead of enabling block mode.
          { key: "X-XSS-Protection", value: "0" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
      {
        source: "/reset-password",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        ],
      },
      {
        source: "/auth/mobile-callback",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        ],
      },
      {
        source: "/login",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        ],
      },
      {
        source: "/demo/login",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
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
