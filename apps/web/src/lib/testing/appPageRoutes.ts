// 테스트 전용 헬퍼 (node:fs 사용 — 런타임 코드에서 import하지 말 것).
//
// App Router의 라우트 그룹 `(...)`은 주소에 들어가지 않는다. 그래서 "이 라우트에
// 페이지가 있나?"를 `(app)/<route>`와 앱 루트만 보고 판단하면 `(auth)/onboarding`,
// `(community)/market-prices`처럼 다른 그룹에 있는 살아 있는 페이지를 "대상 없음"으로
// 오판한다. 2026-07-26에 만든 리라이트 회귀 테스트가 정확히 그 오판을 기대값으로
// 못 박아, 정작 가입 퍼널이 죽어도 통과하는 상태였다.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PAGE_FILES = ["page.tsx", "page.ts"] as const;

/**
 * `src/app` 아래에서 정적으로 열리는 URL 경로 전체.
 * 라우트 그룹은 주소에서 제외하고, `api`와 `_`로 시작하는 폴더는 건너뛴다.
 * 동적 세그먼트는 `[slug]` 문자열 그대로 들어간다(정적 조회용이므로 무해).
 */
export function staticPageRoutes(appDir: string): Set<string> {
  const routes = new Set<string>();

  const walk = (dir: string, urlPath: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { name } = entry;
      if (name === "api" || name.startsWith("_")) continue;

      const isRouteGroup = name.startsWith("(") && name.endsWith(")");
      const nextUrl = isRouteGroup ? urlPath : `${urlPath}/${name}`;
      const child = join(dir, name);

      if (PAGE_FILES.some((file) => existsSync(join(child, file)))) {
        routes.add(nextUrl);
      }
      walk(child, nextUrl);
    }
  };

  walk(appDir, "");
  return routes;
}
