import { describe, expect, it } from "vitest";
import { START_COPY } from "@hanbang/shared/invitation";
import { WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_OPTIONS, WEDDING_CODE_V31_TASTES, WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_DEFAULT_VERSION } from "@/app/wedding-code/entry";

import { CONTENT_PATH, everyLandingComponent, rendered } from "./landingSource";

/**
 * 랜딩이 **웨딩코드에 대해 말하는 것**은 실제 화면과 같은 것이어야 한다.
 *
 * ## 왜 생겼나
 *
 * 2026-08-27 에 랜딩이 이렇게 보여 주고 있었다:
 *
 *   장면 07
 *   둘 다 마음에 든 결혼식장이 정해둔 예산보다 300만원 비쌌어요.
 *   그날 밤 속으로 든 생각은?
 *     · 그래도 여기서 하고 싶다. 다른 데서 줄이자.
 *     · 300만원이면 다른 데 쓰는 게 낫다.
 *
 * 실제 `/wedding-code` 의 A2 는 **선택지가 네 개**이고 문장도 다르다(끝이 "비쌌다").
 * 번호 "장면 07" 도 지어낸 것이었다(A2 는 두 번째 문항이다).
 *
 * 누르고 들어간 사람이 랜딩에서 본 것과 다른 화면을 만난다. 타입체크·린트·
 * 전체 테스트가 전부 통과하는 종류의 거짓이라 여기서 따로 막는다.
 *
 * ## 2026-08-29 개편에서 옮긴 것
 *
 * 랜딩이 정본 시안(`docs/landing/NotebookBest.html`)으로 다시 지어지면서
 * **장면 견본을 통째로 보여 주던 `ScenesSection` 과 `scenes` 카피 블록이 없어졌다.**
 * 웨딩코드는 이제 부가 도구 카드 한 장(`availableNow.cards[1]`)으로만 나온다:
 *
 *   "스무 장면에 각자 답하면 두 사람이 고른 문장을 그대로 나란히 놓아드려요."
 *
 * 견본이 사라졌다고 **계약이 사라진 것은 아니다.** 위 사고는 "랜딩이 웨딩코드
 * 화면의 내용을 제 마음대로 지어냈다" 는 사고였고, 그 사고는 견본이 없는 지금도
 * 똑같이 일어날 수 있다. 그래서 세 갈래로 나눠 지킨다:
 *
 * 1. **장면 수** — 랜딩이 여러 곳에서 "스무 장면" 이라고 말한다. 라이브 문항 수와
 *    다르면 실패한다. (`scenes` 블록 하나가 아니라 **랜딩 표면 전체**를 본다.
 *    옛 검사는 `landingContent.ts` 만 봤는데, 이제 같은 문장이 컴포넌트에도 있을
 *    수 있다.)
 * 2. **문항 번호** — "장면 07" 처럼 번호를 박지 않는다. 옛 검사는 없어진
 *    `ScenesSection.tsx` 한 파일만 봤다. 이제 랜딩 표면 전체를 본다.
 * 3. **인용** — 랜딩이 라이브 문장을 인용하면 **글자까지 같아야 한다.** 오늘은
 *    인용이 0건이라 이 단언은 조건부다(견본이 없으니 걸릴 것도 없다). 다시 견본을
 *    넣는 순간 살아난다 — 실제 사고가 정확히 "다시 넣으면서 끝을 바꾼" 것이었다.
 *
 * ## 2026-11-17 — 시작 화면
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩은 시작 화면 한 장이
 * 됐다. 웨딩코드는 이제 바닥글의 링크 이름("웨딩코드")으로만 나온다. 세 갈래는 그대로 둔다 —
 * 웨딩코드를 다시 소개하는 순간 살아난다.
 */

/**
 * 랜딩이 사용자에게 실제로 내보내는 텍스트 전부(`[파일, 주석 벗긴 소스]`).
 *
 * 목록을 손으로 적지 않는다 — 손으로 적으면 새로 생긴 컴포넌트를 놓친다.
 * 주석은 벗긴다: 주석에 남은 옛 문장이 대신 대답하면 검사가 조용히 무의미해진다
 * (2026-08-27 에 실제로 그 갈래로 8개가 빠져나갔다).
 */
function landingSurface(): Array<[string, string]> {
  return [
    [CONTENT_PATH, rendered(CONTENT_PATH)],
    ["src/app/landing/page.tsx", rendered("src/app/landing/page.tsx")],
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 첫 화면 글자는 앱과 같은
    // 정본 `START_COPY` 에서 온다. 랜딩 소스에는 없으므로 따로 더한다.
    ["START_COPY", Object.values(START_COPY).flat().join("\n")],
    ...everyLandingComponent(),
  ];
}

describe("랜딩이 웨딩코드에 대해 말하는 것은 라이브다", () => {
  it("새 방문자는 현재 v3.1로 들어가고 연구판과 검증되지 않은 결과를 홍보하지 않는다", () => {
    expect(WEDDING_CODE_DEFAULT_VERSION).toBe(WEDDING_CODE_V31_VERSION);
    for (const [file, surface] of landingSurface()) {
      expect(surface, `${file}: 현재 홍보할 수 없는 연구판을 노출한다`)
        .not.toMatch(/v4\.0-tendency/u);
      expect(surface, `${file}: 사람 검증 없는 결과 주장을 추가했다`)
        .not.toMatch(/과학적으로\s*검증|검증된\s*심리|결혼\s*(?:성공|실패)\s*(?:률|예측)|궁합\s*(?:점수|확률)|성격\s*(?:유형|진단)|희귀도|정확도/u);
    }
  });

  it("랜딩이 말하는 문장 수가 새 질문판과 같다", () => {
    // 수를 명시한다면 새 기본판의 실제 문장 수와 같아야 한다.
    const wrong: string[] = [];
    for (const [file, text] of landingSurface()) {
      for (const match of text.matchAll(/(\d+)\s*개\s*문장/gu)) {
        if (Number(match[1]) !== WEDDING_CODE_V31_QUESTIONS.length) {
          wrong.push(`${file}: "${match[0]}"`);
        }
      }
    }
    expect([...new Set(wrong)], "랜딩이 새 질문판과 다른 문장 수를 말합니다").toEqual([]);
  });

  it("랜딩이 문항 번호를 지어내지 않는다", () => {
    // "장면 07" 처럼 번호를 박으면, 문항 순서가 바뀌는 순간 거짓이 된다.
    // 순서는 버전마다 바뀌고 랜딩은 그걸 따라갈 방법이 없다.
    //
    // 옛 검사는 `ScenesSection.tsx` 한 파일만 봤다. 그 파일이 없어졌으니 파일을
    // 지우기만 해도 통과하는 검사가 됐을 것이다 — 표면 전체로 옮긴다.
    const numbered = landingSurface()
      .filter(([, text]: [string, string]) => /장면\s*\d/u.test(text))
      .map(([file]: [string, string]) => file);
    expect(
      numbered,
      "랜딩이 장면 번호를 박아 두었습니다 — 순서가 바뀌면 거짓이 됩니다",
    ).toEqual([]);
  });

  it("랜딩이 라이브 문장을 인용하면 글자까지 같다", () => {
    // 사고의 본체는 "번호" 가 아니라 **끝을 바꾼 인용** 이었다:
    //   라이브 "…300만원 비쌌다"  →  랜딩 "…300만원 비쌌어요."
    // 앞부분이 그대로라 눈으로는 같아 보이고, 눌러 들어가면 다른 문장이 나온다.
    //
    // 그래서 "라이브 문장의 앞머리가 랜딩에 있으면, 그 문장은 통째로 있어야 한다"
    // 로 잰다. 앞머리부터 다시 쓴 완전한 창작은 이 방식으로 못 잡는다 — 그건
    // 견본 블록이 다시 생겼을 때 (`scene:`/`question:`/`options:` 키가 랜딩에
    // 나타났을 때) 아래 갈래가 잡는다.
    const PROBE = 12;
    const surface = landingSurface();

    const live: Array<{ what: string; text: string }> = [];
    for (const q of WEDDING_CODE_V31_QUESTIONS) {
      live.push({ what: `${q.id} 문장`, text: q.statement });
    }
    WEDDING_CODE_V31_OPTIONS.forEach(option => live.push({ what: `동의 정도 ${option.value}`, text: option.label }));
    WEDDING_CODE_V31_TASTES.forEach(taste => {
      live.push({ what: `${taste.key} 취향`, text: taste.question });
      taste.options.forEach(option => live.push({ what: `${taste.key} 선택지`, text: option.label }));
    });

    const misquoted: string[] = [];
    for (const { what, text } of live) {
      if (text.length < PROBE) continue;
      const probe = text.slice(0, PROBE);
      for (const [file, source] of surface) {
        if (!source.includes(probe)) continue;
        if (source.includes(text)) continue;
        misquoted.push(`${file}: [${what}] 인용이 라이브와 다릅니다 — 라이브: "${text}"`);
      }
    }
    expect(
      misquoted,
      "랜딩이 웨딩코드 문장을 옮겨 적다 바꿨습니다. 인용은 글자까지 같아야 합니다.",
    ).toEqual([]);

    // 견본 블록이 다시 생겼다면 — 그때는 **모든 문장**이 라이브에 있어야 한다.
    // 오늘 랜딩에는 이런 키가 0건이다(2026-08-29 실측). 다시 넣는 순간 살아난다.
    //
    // `label:` 은 여기서 보지 않는다 — 랜딩의 버튼·링크가 전부 `label:` 이라
    // 그걸 넣으면 웨딩코드와 무관한 문구가 "지어낸 견본" 으로 잡힌다.
    // 견본이 돌아오면 `scene:`/`question:` 은 반드시 같이 온다.
    const liveTexts = new Set(live.map((entry: { text: string }) => entry.text));
    const fabricated: string[] = [];
    for (const [file, source] of surface) {
      for (const m of source.matchAll(/\b(scene|question)\s*:\s*"([^"]{8,})"/gu)) {
        // 2026-11-17: FAQ 의 `question:` 을 건너뛰던 예외를 지웠다. 시작 화면 개편으로 FAQ 가
        // 랜딩에서 없어졌다 — 예외만 남으면 그 이름의 파일이 다시 생길 때 검사 없이 통과한다.
        if (!liveTexts.has(m[2])) {
          fabricated.push(`${file}: "${m[2]}"`);
        }
      }
    }
    expect(
      fabricated,
      "랜딩이 웨딩코드 문항처럼 생긴 문장을 갖고 있는데 라이브에 없습니다 — 지어낸 견본입니다",
    ).toEqual([]);
  });
});
