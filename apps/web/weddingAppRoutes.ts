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
 * (2026-07-26 가족 조율 페이지를 지운 뒤 `etiquette`가 그렇게 남아 있었다. 2026-08-19에
 * 잠시 되살렸다가, 25편을 `manners`로 이관하면서 다시 뺐다 — 지금은 next.config의
 * 리다이렉트가 `/wedding/etiquette`를 `/wedding/manners`로 넘긴다.)
 */
export const WEDDING_APP_ROUTES = [
  "lounge",
  "preparation-style",
  "chat",
  // 2026-11-17 파운더 디자인 아티팩트의 준비 순서·웨딩홀 비교(편지·상담 확정은 그 아래 주소).
  "journey",
  "halls",
  // 아모라가 맡은 일의 결과 화면(`amora-tasks/[id]`). 홈 카드와 대화 카드의 진행 보기가 연다.
  "amora-tasks",
  "saved",
  "budget",
  "checklist",
  "schedule",
  "settings",
  "bookings",
  "money",
  "vendors",
  "market-prices",
  "favorites",
  "onboarding",
  // 예절 안내는 `src/app/manners`(라우트 그룹 밖)에 있고 로그인이 필요 없다.
  // 목록에 넣는 이유는 앱 안에서 `/wedding/manners`로 링크하기 위해서다 —
  // 리라이트가 없으면 사이드바·주차 카드의 링크가 그대로 404가 된다.
  "manners",
] as const;
