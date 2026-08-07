// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "지금 가입 없이 되는 것" 섹션의 계약.
 *
 * 이 섹션은 랜딩에서 유일하게 **오늘 쓸 수 있는 것**을 약속한다. 그래서 여기 실린
 * 경로가 로그인 뒤로 숨거나 사라지면 그 즉시 거짓말이 된다. 소스 텍스트로 막을 수
 * 있는 것만 여기서 막고, "실제로 로그인 없이 200이 나오는가"는 브라우저 QA
 * (`scripts/landing-a11y-qa.mjs`와 같은 계열)로 확인한다 — 정적 검사로는 증명할 수
 * 없는 성질이다.
 *
 * 전수 조사(2026-08-06)에서 아모라 도구 36개 중 상당수가 기능 플래그·게이트로
 * 막혀 있었고, 검증기가 97건 중 31건의 가용성 주장을 정정했다. 코드에 있다는 것과
 * 오늘 쓸 수 있다는 것은 다르다.
 */

const appRoot = resolve(process.cwd());
const read = (p: string) => readFileSync(resolve(appRoot, p), "utf8");

const content = read("src/components/landing/redesign/landingContent.ts");
const section = read("src/components/landing/redesign/AvailableNowSection.tsx");
const page = read("src/app/landing/page.tsx");

/** availableNow 블록만 잘라 본다 — 같은 파일의 다른 목록도 `note:`를 쓴다.
 *  `availableNowLead`가 이 접두사로 시작하므로 대표 카드도 함께 검사된다(의도). */
const availableNowBlock = content.slice(
  content.indexOf("export const availableNow"),
  content.indexOf("export const preparationRecords"),
);

/** 주석은 벗긴다. 왜 안 쓰는지 설명하려면 그 이름을 적어야 하는데,
 *  자기 설명에 걸려 넘어지는 가드는 가드가 아니다. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[\t ]*\/\/.*$/gmu, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "");

/** 게이트로 막혀 있어 랜딩에 실으면 안 되는 영역(2026-08-06 조사). */
const GATED_SURFACES = [
  "/vendors",
  "/money",
  "/bookings",
  "/community/cohort",
  "/wedding-court",
];

describe("landing available-now section", () => {
  it("renders on the landing before the account-beta sections", () => {
    expect(page).toContain("<AvailableNowSection />");
    expect(
      page.indexOf("<AvailableNowSection />"),
      "지금 되는 것이 계정 베타 설명보다 뒤에 오면 처음 온 사람이 빈손으로 읽는다",
    ).toBeLessThan(page.indexOf("<PreparationResult />"));
  });

  it("lists only paths that were verified to open without login", () => {
    const hrefs = [...availableNowBlock.matchAll(/href:\s*"([^"]+)"/gu)].map((m) => m[1]);
    expect(hrefs.length, "availableNow 항목이 없다").toBeGreaterThanOrEqual(4);

    for (const href of hrefs) {
      expect(href, "외부 링크는 이 섹션에 넣지 않는다").toMatch(/^\//u);
      for (const gated of GATED_SURFACES) {
        expect(href, `${href}는 게이트로 막힌 영역이다`).not.toContain(gated);
      }
    }

    // /community/quote-check는 307로 /wedding/... 으로 넘어간다. 리다이렉트를
    // 한 홉 태우면 첫 클릭이 느려지고 UTM도 흔들리므로 정식 경로를 쓴다.
    expect(hrefs, "리다이렉트되는 별칭 대신 정식 경로를 쓴다").not.toContain(
      "/community/quote-check",
    );
  });

  it("states an availability or storage fact on every card", () => {
    const notes = [...availableNowBlock.matchAll(/note:\s*"([^"]+)"/gu)].map((m) => m[1]);
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (const note of notes) {
      expect(
        // "이용 전에 알아야 할 사실"의 범위: 저장 여부·데이터 출처·판정 안 함·
        // 무료 한도. 대표 카드는 "준비 기록에 남지 않아요 / 무료 이용에는 한도가
        // 있어요"로 말하므로 기록·한도·무료도 유효한 고지다.
        /저장|서버|출처|자료|점수|등급|판정|기록|한도|무료/u.test(note),
        `이용 전에 알아야 할 사실이 없는 카드가 있다: "${note}"`,
      ).toBe(true);
    }
  });

  it("never routes these cards through the Amora start tracker", () => {
    // TrackedLandingLink는 landing_amora_start_click을 쏘고 날짜 handoff를 지운다.
    // 이 넷은 아모라를 열지 않으므로 둘 다 틀린 동작이 된다.
    expect(withoutComments(section)).not.toContain("TrackedLandingLink");
    expect(section, "보조 링크는 공유 레시피를 쓴다").toContain("${secondaryLink}");
  });

  it("keeps unverified claims out of every landing surface, not just this section", () => {
    // 이 검사는 `availableNow` 블록만 보고 있었다. 그래서 카드에서는 "후기"를
    // 피해 놓고 바로 옆 커뮤니티 섹션 본문에는 그대로 쓴 것이 통과해 **라이브까지
    // 나갔다**. 금지어의 이유는 카드가 아니라 랜딩 전체에 적용된다 — 랜딩에서
    // "후기"는 우리 제품에 대한 사회적 증거로 읽힌다.
    //
    // 파일 이름을 손으로 적지 않고 디렉터리를 통째로 읽는다. 새 섹션이 생길 때마다
    // 목록에 추가하는 걸 잊으면 같은 구멍이 다시 난다.
    const redesignDir = resolve(appRoot, "src/components/landing/redesign");
    const everySurface = readdirSync(redesignDir)
      .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
      .map((f) => read(`src/components/landing/redesign/${f}`))
      .concat(page);

    // 주석은 렌더되지 않으므로 카피가 아니다. 벗기지 않으면 "왜 이 단어를 피했는지"
    // 적은 설명이 스스로 걸린다(이 저장소에서 네 번 반복됐다).
    const copyOnly = withoutComments(everySurface.join("\n"));
    const banned = ["후기", "만족도", "성공률", "1위", "최고", "보장", "절감"];
    for (const word of banned) {
      expect(copyOnly, `검증되지 않은 주장 "${word}"`).not.toContain(word);
    }
  });
});
