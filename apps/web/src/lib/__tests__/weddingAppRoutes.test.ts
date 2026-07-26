// @vitest-environment node

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { WEDDING_APP_ROUTES } from "../../../weddingAppRoutes";

const APP_DIR = resolve(process.cwd(), "src", "app");
const APP_GROUP_DIR = join(APP_DIR, "(app)");

/** /wedding/<이름>은 (app) 그룹과 최상위 두 곳 어디에 있든 같은 주소로 열린다. */
function hasPage(route: string): boolean {
  return ["page.tsx", "page.ts"].some((file) => (
    existsSync(join(APP_GROUP_DIR, route, file)) || existsSync(join(APP_DIR, route, file))
  ));
}

function appGroupPages(): string[] {
  return readdirSync(APP_GROUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // 라우트 그룹((...))과 동적 세그먼트([...])는 고정 주소를 만들지 않는다.
    .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("["))
    .filter((entry) => hasPage(entry.name))
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

  it("keeps every listed route pointing at a real page", () => {
    const orphans = WEDDING_APP_ROUTES.filter((route) => !hasPage(route));

    // etiquette는 페이지를 지웠고, market-prices·onboarding은 다른 경로로 옮겨졌다.
    // 리라이트만 남아 대상이 없다 — 새로 늘지 않도록 현재 상태를 못 박는다.
    expect(orphans).toEqual(["etiquette", "market-prices", "onboarding"]);
  });
});
