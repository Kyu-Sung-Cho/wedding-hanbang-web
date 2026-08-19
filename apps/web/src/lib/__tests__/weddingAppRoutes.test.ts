// @vitest-environment node

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { WEDDING_APP_ROUTES } from "../../../weddingAppRoutes";
import { staticPageRoutes } from "../testing/appPageRoutes";

const APP_DIR = resolve(process.cwd(), "src", "app");
const APP_GROUP_DIR = join(APP_DIR, "(app)");
const PAGE_FILES = ["page.tsx", "page.ts"] as const;

/**
 * `/wedding/<이름>`은 리라이트로 `/<이름>`을 연다. 그 주소를 실제로 여는 페이지가
 * 어느 라우트 그룹에 있든(`(app)`·`(auth)`·`(community)`·최상위) 상관없다.
 * 예전 구현은 `(app)`과 최상위만 봐서 살아 있는 페이지를 orphan으로 오판했다.
 */
const APP_PAGE_ROUTES = staticPageRoutes(APP_DIR);

function hasPage(route: string): boolean {
  return APP_PAGE_ROUTES.has(`/${route}`);
}

function appGroupPages(): string[] {
  return readdirSync(APP_GROUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // 라우트 그룹((...))과 동적 세그먼트([...])는 고정 주소를 만들지 않는다.
    .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("["))
    .filter((entry) => PAGE_FILES.some((file) => existsSync(join(APP_GROUP_DIR, entry.name, file))))
    .map((entry) => entry.name)
    .sort();
}

// dashboard는 목록에 없는 게 맞다 — next.config가 /wedding/dashboard를 lounge로
// 리다이렉트하므로 rewrite 대상이 아니다.
const REDIRECTED_AWAY = new Set(["dashboard"]);

describe("wedding app route rewrites", () => {
  // 2026-07-26 회귀: 저장 공간 페이지를 만들고 목록에 안 넣어서 /wedding/saved가
  // 통째로 404였다. 링크는 멀쩡해 보여서 눌러 보기 전에는 몰랐다.
  it("exposes every (app) page under /wedding", () => {
    const missing = appGroupPages()
      .filter((segment) => !REDIRECTED_AWAY.has(segment))
      .filter((segment) => !WEDDING_APP_ROUTES.includes(segment as never));

    expect(
      missing,
      `WEDDING_APP_ROUTES 누락: ${missing.join(", ")} — /wedding/<이름>이 404가 된다`,
    ).toEqual([]);
  });

  // 반대 방향. 예전에는 orphan 기대값에 etiquette·market-prices·onboarding을
  // 못 박아 뒀는데, 뒤 두 개는 다른 라우트 그룹에 살아 있는 페이지를 오판한 것이었고
  // (특히 onboarding은 가입 퍼널이다), 그 때문에 실제로 페이지가 사라져도 이 테스트가
  // 통과했다. 이제 예외 없이 "목록의 모든 라우트는 열려야 한다"를 요구한다.
  it("keeps every listed route pointing at a real page", () => {
    const orphans = WEDDING_APP_ROUTES.filter((route) => !hasPage(route));

    expect(
      orphans,
      `대상 없는 리라이트: ${orphans.join(", ")} — 목록에서 빼거나 페이지를 만들 것`,
    ).toEqual([]);
  });

  it("루트 그룹 밖에 있는 페이지도 대상으로 인정한다", () => {
    // 오판의 원인이 된 두 경로를 명시적으로 고정한다.
    expect(hasPage("onboarding")).toBe(true); // (auth)/onboarding
    expect(hasPage("market-prices")).toBe(true); // (community)/market-prices
    // 2026-08-19에 잠시 되살렸다가 25편을 manners로 이관하면서 다시 지웠다. 지금은
    // next.config의 리다이렉트가 `/wedding/etiquette`를 `/wedding/manners`로 넘긴다.
    expect(hasPage("etiquette")).toBe(false);
  });
});
