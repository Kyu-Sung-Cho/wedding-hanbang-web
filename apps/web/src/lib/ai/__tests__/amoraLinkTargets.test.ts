// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { WEDDING_APP_ROUTES } from "../../../../weddingAppRoutes";
import { staticPageRoutes as collectStaticPageRoutes } from "../../testing/appPageRoutes";
import { stripComments } from "../../testing/sourceText";

/**
 * 아모라가 사용자에게 건네는 경로는 실제로 열려야 한다.
 *
 * 행동 카드의 `href`는 사용자가 누르는 링크가 된다. 그런데 검증은
 * `startsWith("/")`와 길이만 보므로(`amoraAtomicToolOperation.ts`), 없는 경로도
 * 그대로 저장된다. 2026-07-26에 가족 조율 페이지를 지우면서
 * `defaultActionHref`는 우회시켰지만 도구 스키마의 예시에는
 * `/wedding/etiquette`가 남아 모델이 복사할 수 있는 상태였다.
 * 죽은 링크는 감사에서 세 번이나 치명으로 분류한 항목이라 테스트로 잠근다.
 */
const APP_DIR = resolve(process.cwd(), "src", "app");

/** 라우트 존재 판정은 리라이트 회귀 테스트와 같은 헬퍼를 쓴다(판정이 갈리면 안 된다). */
const staticPageRoutes = (): Set<string> => collectStaticPageRoutes(APP_DIR);

/** next.config.ts의 `/wedding/*` 리라이트를 따라 실제 페이지 주소로 바꾼다. */
function resolveWeddingPath(path: string): string {
  if (path === "/wedding") return "/community";
  const communityPrefix = "/wedding/community/";
  if (path.startsWith(communityPrefix)) {
    return `/community/${path.slice(communityPrefix.length)}`;
  }
  const match = /^\/wedding\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return path;
  const [, segment, rest = ""] = match;
  return WEDDING_APP_ROUTES.includes(segment as never)
    ? `/${segment}${rest}`
    : path;
}

// 모델이 실제로 받는 문자열만 검사한다 — 주석에 "예전에 여기 /wedding/etiquette가
// 있었다"는 설명을 남길 수 있어야 하므로 stripComments를 통과시킨다.
const AI_SOURCES = ["tools.ts", "prompts.ts"] as const;

describe("아모라가 안내하는 앱 경로", () => {
  it("도구 스키마·프롬프트에 적힌 /wedding 경로가 모두 실제로 열린다", () => {
    const routes = staticPageRoutes();
    const dead: string[] = [];

    for (const file of AI_SOURCES) {
      const source = stripComments(
        readFileSync(resolve(process.cwd(), "src", "lib", "ai", file), "utf8"),
      );
      const mentioned = new Set(
        [...source.matchAll(/\/wedding(?:\/[a-z0-9-]+)*/g)].map((match) => match[0]),
      );
      for (const path of mentioned) {
        const resolved = resolveWeddingPath(path);
        if (!routes.has(resolved)) {
          dead.push(`${file}: ${path} → ${resolved}`);
        }
      }
    }

    expect(
      dead,
      `아모라가 안내하는 죽은 경로: ${dead.join(" | ")} — 사용자가 누르면 404다`,
    ).toEqual([]);
  });

  it("행동 카드 기본 경로도 모두 실제로 열린다", () => {
    const routes = staticPageRoutes();
    const source = stripComments(
      readFileSync(
        resolve(process.cwd(), "src", "lib", "ai", "amoraAtomicToolOperation.ts"),
        "utf8",
      ),
    );
    const mentioned = new Set(
      [...source.matchAll(/"(\/wedding(?:\/[a-z0-9-]+)*)"/g)].map((match) => match[1]),
    );

    expect(mentioned.size).toBeGreaterThan(0);
    const dead = [...mentioned]
      .map((path) => [path, resolveWeddingPath(path)] as const)
      .filter(([, resolved]) => !routes.has(resolved))
      .map(([path, resolved]) => `${path} → ${resolved}`);

    expect(dead, `defaultActionHref의 죽은 경로: ${dead.join(" | ")}`).toEqual([]);
  });
});
