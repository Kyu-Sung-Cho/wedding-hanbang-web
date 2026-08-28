import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./landingSource";

/**
 * 랜딩 제목이 루트 폴백과 같은 문자열이다.
 *
 * ## 이 파일이 왜 새로 생겼나
 *
 * 2026-08-27까지 `app/page.tsx`와 `app/landing/page.tsx`가 **둘 다** 주석으로
 * "`landingFunnelInstrumentation`이 이 동일성을 검사한다"고 적고 있었다.
 * 그런 테스트는 저장소에 없다 — 두 파일이 서로를 가리키는데 실제로 검사하는 것은
 * 아무것도 없었다. 없는 가드를 있다고 적어 두면, 다음 사람이 한쪽만 고치고
 * "테스트가 잡아 줄 것"이라고 믿는다.
 *
 * ## 왜 같아야 하나
 *
 * 루트는 로그아웃이면 `/landing`으로 307한다. 리다이렉트가 걸리지 않는 환경
 * (미들웨어가 통과시키는 설정 누락 환경)에서는 `app/page.tsx`의 폴백이 그대로
 * 문서가 되므로, 유입 경로마다 다른 제목이 검색 결과에 잡힌다.
 */

const WEB_ROOT = process.cwd();

/**
 * 주석을 걷고 읽는다.
 *
 * 안 걷으면 **주석 안의 예시가 진짜 제목 대신 읽힌다.** 2026-08-27 에 실제로 그랬다 —
 * `landing/page.tsx` 주석에 `const title = "…"` 을 예시로 적었더니 이 추출기가
 * 그 `…` 을 제목으로 집었다. 정본 테스트
 * (`components/community/__tests__/landingFunnelInstrumentation.test.ts`)는
 * 처음부터 주석을 걷고 있었고, 그래서 그쪽만 통과했다.
 */
function read(relativePath: string): string {
  return stripComments(readFileSync(path.join(WEB_ROOT, relativePath), "utf8"));
}

/** `title: "…"` 또는 `const LANDING_TITLE = "…"` 에서 문자열만 꺼낸다. */
function titleOf(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  expect(match, "제목을 찾지 못했습니다").not.toBeNull();
  return match![1];
}

describe("랜딩과 루트 폴백의 제목", () => {
  it("글자까지 같다", () => {
    const rootTitle = titleOf(
      read("src/app/page.tsx"),
      /^\s*title:\s*"([^"]+)"/mu,
    );
    const landingTitle = titleOf(
      read("src/app/landing/page.tsx"),
      /generateMetadata[\s\S]*?const title = "([^"]+)"/u,
    );

    expect(landingTitle).toBe(rootTitle);
  });

  it("제목이 서비스 이름으로 시작한다", () => {
    // 검색 결과에서 우리를 알아볼 수 있어야 한다.
    const landingTitle = titleOf(
      read("src/app/landing/page.tsx"),
      /generateMetadata[\s\S]*?const title = "([^"]+)"/u,
    );
    expect(landingTitle.startsWith("웨딩한방")).toBe(true);
  });

  it("설명이 두 곳 모두에 있고 비어 있지 않다", () => {
    // 설명이 없으면 검색 결과의 두 줄을 검색엔진이 본문에서 임의로 뽑는다.
    //
    // ⚠️ **첫 문자열 리터럴의 길이로 재지 마라.** 옛 검사는
    // `/description:\s*\n?\s*"[^"]{40,}/` 였는데, 설명이 여러 줄로 이어 붙는
    // 형태(`"…" + "…" + "…"`)가 되자 **첫 조각만** 보고 39자라 실패했다 —
    // 실제 설명은 90자가 넘는데도(2026-08-28). 길이를 재려면 이어 붙인 것을
    // 다 모아야 한다.
    // 선언 뒤부터 `"…" + "…" + "…"` 를 이어 붙는 동안만 따라가며 모은다.
    // `+` 가 끊기면 멈추므로 뒤따르는 다른 필드를 삼키지 않는다.
    const fullDescription = (source: string, anchor: RegExp): string => {
      const found = anchor.exec(source);
      expect(found, `설명 선언을 찾지 못했다: ${anchor}`).toBeTruthy();
      let rest = source.slice((found?.index ?? 0) + (found?.[0].length ?? 0));
      const parts: string[] = [];
      for (;;) {
        const literal = /^\s*"((?:[^"\\]|\\.)*)"/u.exec(rest);
        if (!literal) break;
        parts.push(literal[1]);
        rest = rest.slice(literal[0].length);
        const plus = /^\s*\+/u.exec(rest);
        if (!plus) break;
        rest = rest.slice(plus[0].length);
      }
      return parts.join("");
    };

    // 앵커는 여는 따옴표 **앞에서** 끝난다 — 리터럴 스캐너가 그것부터 읽는다.
    const rootDescription = fullDescription(read("src/app/page.tsx"), /description:/u);
    const landingDescription = fullDescription(
      read("src/app/landing/page.tsx"),
      /const description =/u,
    );
    expect(rootDescription.length, `루트 설명이 짧다: ${rootDescription}`).toBeGreaterThanOrEqual(40);
    expect(landingDescription.length, `랜딩 설명이 짧다: ${landingDescription}`).toBeGreaterThanOrEqual(40);
    // 두 곳이 같아야 한다. 제목만 맞추고 설명이 갈리면 유입 경로마다 다른 소개가 나간다.
    expect(rootDescription, "루트와 랜딩의 설명이 다르다").toBe(landingDescription);
  });

  it("canonical 과 sitemap 이 랜딩을 가리킨다", () => {
    // 루트가 307로 보내는 곳과 색인 주소가 갈리면 색인 자리가 쪼개진다.
    expect(read("src/app/landing/page.tsx")).toContain('canonical: "/landing"');
    expect(read("src/app/sitemap.ts")).toContain("${BASE_URL}/landing");
  });
});
