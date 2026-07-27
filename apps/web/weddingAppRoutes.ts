/**
 * /wedding/* 로 노출되는 앱 라우트 목록.
 *
 * next.config.ts의 rewrite가 이 목록만 `/wedding/<route>/:path*` → `/<route>/:path*`로
 * 넘긴다. 여기 빠진 페이지는 앱 안에서 링크를 눌러도 404가 난다
 * (2026-07-26 실측: `saved` 누락으로 저장 공간 전체가 404였다).
 *
 * src/app/(app) 아래 라우트가 늘면 여기도 늘어야 하고, 그 정합은
 * src/lib/__tests__/weddingAppRoutes.test.ts가 강제한다.
 *
 * 반대로 **대상 없는 이름을 남겨 두지도 않는다.** 리라이트만 있고 페이지가 없으면
 * `/wedding/<이름>`과 `/<이름>` 둘 다 404인데 링크는 살아 있는 것처럼 보인다.
 * (2026-07-26 가족 조율 페이지를 지운 뒤 `etiquette`가 그렇게 남아 있었다.)
 */
export const WEDDING_APP_ROUTES = [
  "lounge",
  "chat",
  "saved",
  "budget",
  "schedule",
  "settings",
  "bookings",
  "money",
  "vendors",
  "market-prices",
  "favorites",
  "onboarding",
] as const;
