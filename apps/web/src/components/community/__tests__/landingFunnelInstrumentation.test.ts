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

/**
 * 각 진입점을 구분하는 source 값. 새 진입점을 만들면 여기에도 추가한다.
 *
 * `landing_what_we_do`는 뺐다 — 히어로 CTA와 증거 3줄이 모두 `/price`로 가는데
 * 바로 아래 3블록에서 또 권하면 한 목적지를 다섯 번 말하는 화면이 된다. 그래서
 * 3블록의 `/price` 카드를 없앴고, 그 자리에 히어로의 공시가 차이 행이 들어왔다.
 */
const PRICE_ENTRY_SOURCES = [
  "landing_hero", // 히어로 1차 CTA
  "landing_spread_row", // 히어로의 대행사 간 차액 행(카테고리별)
  "landing_market_snapshot", // 시세 스냅샷 패널
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
 *
 * 2026-07-29: 루트가 커뮤니티 피드가 아니라 **서비스 랜딩**으로 간다. 그래서 감시
 * 대상은 `app/page.tsx`(폴백 리다이렉트) · `app/landing/page.tsx`(실제 착지) ·
 * 커뮤니티 피드 셋이다. 제목이 **같아야 한다는 단정은 뺐다** — 이제 서로 다른
 * 페이지이고, 랜딩은 서비스 전체를, 피드는 커뮤니티를 설명하는 것이 맞다.
 * 2026-07-30 MVP 제품 계약부터 루트·랜딩은 아모라를, 커뮤니티는 실제 경험과
 * 질문을 각각 전면에 둔다. 공시가는 아모라 뒤에서 근거가 필요할 때 쓰는 보조
 * 기능이므로 모든 제목에 강제하지 않는다.
 */
describe("첫 화면 메타데이터", () => {
  const pages = [
    {
      name: "루트 폴백",
      file: resolve(process.cwd(), "src", "app", "page.tsx"),
      promise: /아모라|결혼 준비/,
    },
    {
      name: "서비스 랜딩",
      file: resolve(process.cwd(), "src", "app", "landing", "page.tsx"),
      promise: /아모라|결혼 준비/,
    },
    {
      name: "아모라 중심 웨딩 홈",
      file: resolve(process.cwd(), "src", "app", "(community)", "community", "page.tsx"),
      promise: /아모라|결혼 준비/,
    },
  ];

  // 선언 위치를 좁혀서 읽는다. 그냥 `title:\s*"..."`로 잡으면 페이지 본문의 다른
  // `title:` 키(문제 카드 목록 등)가 먼저 걸려 엉뚱한 문자열을 제목으로 읽는다 —
  // 실제로 이 테스트가 "비교할 기준 자체가 없다"를 제목으로 집어냈다.
  const readTitle = (file: string): string => {
    const text = stripComments(readFileSync(file, "utf8"));
    const fromGenerateMetadata = /generateMetadata[\s\S]*?const title\s*=\s*"([^"]+)"/.exec(text)?.[1];
    if (fromGenerateMetadata) return fromGenerateMetadata;
    return /export const metadata\s*=\s*\{[\s\S]*?title:\s*"([^"]+)"/.exec(text)?.[1] ?? "";
  };

  it.each(pages)("$name 제목이 무엇을 주는 곳인지 말한다", ({ file, promise }) => {
    const title = readTitle(file);

    expect(title.length).toBeGreaterThan(0);
    expect(title, `제목에 약속이 없다: ${title}`).toMatch(promise);
  });

  it("웨딩 홈 설명은 커뮤니티의 보조 역할도 말한다", () => {
    const source = stripComments(readFileSync(pages[2].file, "utf8"));
    const description =
      /export const metadata\s*=\s*\{[\s\S]*?description:\s*((?:"[^"]*"\s*\+?\s*)+)/.exec(
        source,
      )?.[1] ?? "";

    expect(description).toMatch(/실제 경험/);
    expect(description).toMatch(/커뮤니티/);
    expect(description).toMatch(/질문/);
  });

  it("루트 폴백과 실제 착지 랜딩의 제목이 같다", () => {
    // `/`는 엣지 리다이렉트로 `/landing`에 가지만, 리다이렉트가 걸리지 않는
    // 환경에서는 `app/page.tsx`가 폴백으로 돈다. 둘이 갈리면 유입 경로마다
    // 다른 제목이 보인다.
    const [root, landing] = [pages[0].file, pages[1].file].map(readTitle);
    expect(root).toBe(landing);
  });
});
