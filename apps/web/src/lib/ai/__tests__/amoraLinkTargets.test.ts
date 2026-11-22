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

/**
 * 견적 확인의 옛 주소. 2026-11-22 커뮤니티를 닫으면서 화면을 커뮤니티 밖(`/wedding/quote-check`)으로
 * 옮겼고, next.config 가 이 옛 주소를 새 주소로 보낸다. 아모라 할 일 카드는 DB 저장 함수가 `quote`
 * 기본 링크를 이 옛 주소로 대조하므로 옛 주소를 그대로 저장한다(`amoraAtomicToolOperation.ts`).
 * 아래 첫 테스트가 그 리다이렉트가 실제로 next.config 에 있는지도 본다.
 */
const LEGACY_QUOTE_CHECK_PATH = "/wedding/community/quote-check";
const QUOTE_CHECK_REDIRECT_RULE =
  /source:\s*"\/wedding\/community\/quote-check"\s*,\s*destination:\s*"\/wedding\/quote-check"/u;

/**
 * next.config.ts 의 리다이렉트·리라이트를 따라 실제 페이지 주소로 바꾼다.
 *
 * 2026-11-22 전에는 `/wedding` 이 커뮤니티 피드(`/community`)였고 `/wedding/community/**` 가
 * `/community/**` 로 리라이트됐다. 지금 `/wedding` 은 `app/wedding/page.tsx` 문이고, 커뮤니티 주소는
 * '닫았어요' 화면이라 실제 페이지로 셈하지 않는다(아모라가 그리로 보내면 죽은 경로로 잡힌다).
 */
function resolveWeddingPath(path: string): string {
  if (path === LEGACY_QUOTE_CHECK_PATH) return resolveWeddingPath("/wedding/quote-check");
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
    // 옛 견적 주소를 새 주소로 따라가는 것은 next.config 에 그 리다이렉트가 있을 때만 맞다.
    expect(
      readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8"),
      "옛 견적 확인 주소를 새 주소로 보내는 리다이렉트가 없다",
    ).toMatch(QUOTE_CHECK_REDIRECT_RULE);
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
