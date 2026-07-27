// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../lib/testing/sourceText";

/**
 * 첫 화면의 `/price` 진입점은 전부 계측돼야 한다.
 *
 * 남은 최우선 과제가 유통 테스트 글 게시이고, 그 결과를 읽는 유일한 수단이 퍼널이다.
 * 그런데 2026-07-27 실측에서 첫 화면의 `/price` 링크 4개 중 **1차 CTA 하나만**
 * `price_hero_click`을 쏘고 있었다. 나머지 3개로 들어온 사람은 집계에 안 잡히므로
 * "어느 표면이 전환됐는지"를 사후에 알 방법이 없다 — 유통 테스트를 다시 돌려야 한다.
 */
const LANDING = resolve(
  process.cwd(),
  "src",
  "components",
  "community",
  "CommunityLandingClient.tsx",
);

/** 각 진입점을 구분하는 source 값. 새 진입점을 만들면 여기에도 추가한다. */
const PRICE_ENTRY_SOURCES = [
  "landing_hero", // 히어로 1차 CTA
  "landing_market_snapshot", // 시세 스냅샷 패널
  "landing_what_we_do", // "할 수 있는 것" 3블록
] as const;

describe("첫 화면 퍼널 계측", () => {
  const source = stripComments(readFileSync(LANDING, "utf8"));

  it("모든 /price 진입점이 구분 가능한 source로 계측된다", () => {
    const missing = PRICE_ENTRY_SOURCES.filter(
      (value) => !source.includes(`"${value}"`),
    );

    expect(
      missing,
      `계측 누락 source: ${missing.join(", ")} — 그 진입점 유입은 집계되지 않는다`,
    ).toEqual([]);
  });

  it("계측되지 않은 /price 링크가 남아 있지 않다", () => {
    // 리터럴 href="/price"의 개수가 price_hero_click 호출 수를 넘으면
    // 어딘가 링크를 추가하고 계측을 빼먹었다는 뜻이다.
    const literalLinks = [...source.matchAll(/href="\/price"/g)].length;
    const trackedClicks = [...source.matchAll(/captureEvent\("price_hero_click"/g)].length;

    expect(
      trackedClicks,
      `href="/price" ${literalLinks}개 vs price_hero_click ${trackedClicks}개`,
    ).toBeGreaterThanOrEqual(literalLinks);
  });

  it("3블록 중 어느 약속을 고르는지도 측정한다", () => {
    expect(source).toContain('captureEvent("what_we_do_click"');
  });
});

/**
 * 유통 글에서 넘어온 사람이 카톡 미리보기·검색 결과·브라우저 탭에서 보는 문구다.
 * 히어로는 위약금을 앞세우는데 제목은 "웨딩한방 커뮤니티 — 결혼 준비 경험과 질문을
 * 나눠요"였다(2026-07-27 라이브 실측). 무엇을 주는 곳인지 제목이 말하지 않으면
 * 클릭 전에 걸러진다.
 */
describe("첫 화면 메타데이터", () => {
  const files = [
    resolve(process.cwd(), "src", "app", "page.tsx"),
    resolve(process.cwd(), "src", "app", "(community)", "community", "page.tsx"),
  ];

  it.each(files)("%s 제목이 무엇을 주는 곳인지 말한다", (file) => {
    const text = stripComments(readFileSync(file, "utf8"));
    const title = /title:\s*"([^"]+)"/.exec(text)?.[1] ?? "";

    expect(title.length).toBeGreaterThan(0);
    expect(title, `제목에 차별점이 없다: ${title}`).toMatch(/공시가|공시 가격|위약금/);
  });

  it("두 진입 파일의 제목이 같다", () => {
    // `/`는 `/wedding`으로 리다이렉트되고 그게 다시 커뮤니티로 rewrite된다.
    // 두 곳이 갈리면 유입 경로마다 다른 제목이 보인다.
    const titles = files.map((file) => (
      /title:\s*"([^"]+)"/.exec(stripComments(readFileSync(file, "utf8")))?.[1] ?? ""
    ));
    expect(new Set(titles).size).toBe(1);
  });
});
