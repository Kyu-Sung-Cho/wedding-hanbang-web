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
      // 2026-08-29 파운더 결정으로 베타를 하지 않게 되면서 `/beta` 를 없앴다.
      // 옛 링크·북마크·검색 결과가 404 로 떨어지지 않게 랜딩으로 보낸다.
      // 되돌릴 결정이 아니므로 permanent 다.
      {
        source: "/beta",
        destination: "/landing",
        permanent: true,
      },
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
      // 루트(`/`)는 여기서 보내지 않는다. 루트는 **앱의 문**이라 세션에 따라
      // 랜딩과 라운지로 갈리는데, 엣지 리다이렉트는 세션을 볼 수 없다.
      //
      // 로그아웃이면 어차피 `/landing` 이니 여기서 보내도 같아 보이지만 아니다 —
      // 엣지에서 가로채면 **로그인한 사람도** 랜딩을 지나 다시 앱으로 들어가야 한다.
      // 2026-08-20에 실제로 그랬고 그게 그때 루트를 바꾼 이유였다.
      // 판정은 `lib/supabase/middleware.ts`가 하고 `src/app/page.tsx`가 폴백이다.
      // `__tests__/rootIsTheAppDoor.test.ts`가 이 리다이렉트의 부활을 막는다.
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
      // 2026-08-29 운영 실측: `/dashboard` 가 `Location: /wedding/lounge/` 를 내
      // 슬래시를 떼는 308 이 한 홉 더 붙었다. `:path*` 가 0개에도 걸리기 때문이다.
      {
        source: "/dashboard",
        destination: "/wedding/lounge",
        permanent: false,
      },
      {
        source: "/dashboard/:path+",
        destination: "/wedding/lounge/:path+",
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
      // 위의 `/community` 정확 규칙이 0개 경우를 먼저 잡으므로 오늘은 증상이 없다.
      // 그래도 `:path+` 로 좁힌다 — 앞 규칙이 언제 사라질지에 안전을 걸지 않는다.
      {
        source: "/community/:path+",
        destination: "/wedding/community/:path+",
        permanent: false,
      },
      {
        source: "/wedding/dashboard",
        destination: "/wedding/lounge",
        permanent: false,
      },
      {
        source: "/wedding/dashboard/:path+",
        destination: "/wedding/lounge/:path+",
        permanent: false,
      },
      {
        source: "/wedding/wedding",
        destination: "/wedding",
        permanent: false,
      },
      {
        source: "/wedding/wedding/:path+",
        destination: "/wedding/:path+",
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
      // 빈 경로와 하위 경로를 **따로** 잡는다. `:path*`는 0개 세그먼트에도 걸려서
      // `/manners` → `/wedding/manners/`처럼 목적지에 빈 꼬리 슬래시를 남긴다.
      // 그러면 한 번 더 308로 슬래시를 떼야 해 왕복이 늘고, 리라이트 쪽에서는
      // 500까지 났다(아래 rewrites 주석). `:path+`는 1개 이상만 매치한다.
      ...weddingAppRoutes.flatMap((route) => [
        {
          source: `/${route}`,
          destination: `/wedding/${route}`,
          permanent: false,
        },
        {
          source: `/${route}/:path+`,
          destination: `/wedding/${route}/:path+`,
          permanent: false,
        },
      ]),
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
      // 이건 manners·vendors 와 **같은 등급의 위험**이었다 — 목적지 `/community` 아래에
      // `[category]` 자식이 있어서, 0개 세그먼트로 닿으면 `/community/.rsc` 가 빈
      // category 로 읽혀 500 이 난다. 오늘 안 터진 이유는 위쪽 `/wedding/community`
      // 정확 리다이렉트가 먼저 가로채기 때문이지 이 규칙이 안전해서가 아니다.
      {
        source: "/wedding/community/:path+",
        destination: "/community/:path+",
      },
      // `:path*`는 0개 세그먼트에도 걸린다. `/wedding/manners`가 목적지 `/manners/`로
      // 넘어가고, RSC 요청은 거기에 `.rsc`를 붙여 `/manners/.rsc`를 만든다. 그 경로는
      // 빈 슬러그를 가진 `/manners/[slug]`로 읽혀 서버가 500으로 죽었다(운영 로그:
      // "Failed to handle /manners/.rsc … Could not resolve param value for segment: slug").
      // 문서 요청은 `/manners`로 정규화돼 200이라 화면으로는 안 보였고, 프리페치만
      // 조용히 실패했다. `:path+`는 1개 이상만 매치하므로 빈 꼬리 슬래시가 생기지
      // 않는다. 빈 경로는 아래에서 정확히 잡는다.
      //
      // **터지는 조건은 하나다 — 목적지 아래에 동적 세그먼트 자식이 있는가.**
      // 프리렌더 여부는 상관없다. 2026-08-29 운영 실측(14개 라우트 전수, demo_mode
      // 쿠키로 인증 게이트 뒤까지):
      //   500  manners (`manners/[slug]`) · vendors (`vendors/[id]`)
      //   200  나머지 12개 — 동적 자식이 없어 빈 슬래시가 그냥 부모로 정규화된다
      // 익명 사용자에게는 `/manners`만 보인다. `/wedding/vendors`는 미들웨어의
      // CUSTOMER_PATHS에 있어 로그아웃이면 307로 먼저 잘리지만, **로그인·체험
      // 사용자에게는 똑같이 500이었다.** 처음에 "manners 하나뿐"이라고 적었던 것은
      // 로그아웃 상태만 재고 내린 오판이다.
      ...weddingAppRoutes.flatMap((route) => [
        {
          source: `/wedding/${route}`,
          destination: `/${route}`,
        },
        {
          source: `/wedding/${route}/:path+`,
          destination: `/${route}/:path+`,
        },
      ]),
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
