// @vitest-environment node

/**
 * 세션을 읽는 서버 페이지가 빌드를 죽이지 않게 한다.
 *
 * 2026-08-22, `/consent` 를 추가하면서 이 선언을 빠뜨려 **Preview 빌드가
 * 통째로 죽었다.** Next 가 그 페이지를 정적 생성하려 들고, 빌드 시점에는
 * Supabase 환경변수가 없어서 이렇게 끝난다.
 *
 *   Error occurred prerendering page "/consent"
 *   Error: Your project's URL and Key are required to create a Supabase client!
 *   Export encountered an error on /consent/page, exiting the build.
 *
 * 웹 테스트 6,883건이 전부 통과한 상태에서 벌어진 일이다 — 테스트는 페이지를
 * 렌더하지만 **프리렌더 조건(환경변수 없음)을 재현하지 않는다.** 그래서
 * 소스 수준에서 규칙을 고정한다.
 *
 * 프로덕션에서도 똑같이 죽는다. 그리고 프로덕션 빌드가 죽으면 **직전 빌드가
 * 계속 서비스돼 겉보기엔 멀쩡하다** — 배포한 줄 알고 넘어가기 쉽다.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = resolve(process.cwd(), "src/app");

/**
 * 프리렌더돼도 안전하다고 **의식적으로** 판단한 페이지.
 *
 * 선언 대신 다른 방법으로 안전을 확보한 경우만 여기 온다. 새 페이지를
 * 여기 넣으려면 그 이유를 적어야 한다 — 빌드가 죽는 것보다 이 목록이 길어지는
 * 편이 낫지만, 이유 없이 길어지면 가드가 아니라 장식이 된다.
 */
const PRERENDER_SAFE_WITHOUT_DECLARATION: ReadonlyMap<string, string> = new Map([
  [
    "page.tsx",
    "루트 폴백. createClient() 를 try/catch 로 감싸고 실패하면 로그인으로 보낸다"
      + "(설정이 없는 환경을 명시적으로 다룬다).",
  ],
]);

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      pageFiles(full, out);
    } else if (entry === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

type ServerPage = { route: string; source: string };

/** 서버 컴포넌트이면서 서버용 Supabase 클라이언트를 만드는 페이지만 본다. */
function sessionReadingServerPages(): ServerPage[] {
  return pageFiles(APP_DIR)
    .map((file) => ({
      route: relative(APP_DIR, file).split(sep).join("/"),
      source: readFileSync(file, "utf8"),
    }))
    .filter(({ source }) => {
      // "use client" 는 브라우저에서 돈다 — 빌드 때 Supabase 를 만들지 않는다.
      if (/^\s*["']use client["']/m.test(source)) return false;
      return source.includes("@/lib/supabase/server");
    });
}

function hasRenderModeDeclaration(source: string): boolean {
  return /export const dynamic\s*=/.test(source)
    || /export const revalidate\s*=/.test(source);
}

describe("세션을 읽는 서버 페이지는 정적 생성 대상이 아니다", () => {
  it("측정기가 살아 있다", () => {
    // 스캔이 비면 아래 단언이 **조용히 통과**한다. 그쪽을 먼저 막는다.
    const pages = sessionReadingServerPages();
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.map((p) => p.route)).toContain("consent/page.tsx");
  });

  it("렌더 모드를 선언하거나, 안전하다고 명시한 목록에 있어야 한다", () => {
    const missing = sessionReadingServerPages()
      .filter(({ route, source }) =>
        !hasRenderModeDeclaration(source)
        && !PRERENDER_SAFE_WITHOUT_DECLARATION.has(route))
      .map(({ route }) => route);

    expect(
      missing,
      `이 페이지들이 빌드 때 프리렌더되어 "Your project's URL and Key are required" 로 `
        + `빌드를 죽인다: ${missing.join(", ")}. `
        + `\`export const dynamic = "force-dynamic"\` 를 넣거나, `
        + `프리렌더돼도 안전한 이유를 PRERENDER_SAFE_WITHOUT_DECLARATION 에 적으세요.`,
    ).toEqual([]);
  });

  it("동의 화면은 캐시되면 안 되므로 force-dynamic 이어야 한다", () => {
    // revalidate 로는 부족하다 — 남의 동의 상태가 담긴 화면이 캐시된다.
    const consent = sessionReadingServerPages()
      .find(({ route }) => route === "consent/page.tsx");
    expect(consent).toBeDefined();
    expect(consent?.source).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
  });

  it("안전 목록의 항목에는 이유가 적혀 있다", () => {
    for (const [route, reason] of PRERENDER_SAFE_WITHOUT_DECLARATION) {
      expect(reason.length, `${route} 의 이유가 비었다`).toBeGreaterThan(20);
    }
  });
});
