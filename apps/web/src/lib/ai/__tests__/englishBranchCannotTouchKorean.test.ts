import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assessEnglishCrisisSignals } from "@hanbang/shared/amora-crisis-english";

/**
 * **영어 갈래가 한국어 판정을 건드릴 수 없다는 것을 증명한다.**
 *
 * ## 왜 이 파일이 필요한가
 *
 * 영어 위기 판정을 붙이면서 나는 "영어 패턴은 한국어 문장에 새 오탐을 만들 수
 * 없다" 고 **주장했다.** 그 주장은 틀렸고, 적대적 검토가 한국어 문장 13개를
 * 무너뜨렸다 — "축가 후보인 팝송 제목이 Suicide Blonde 인데" 가 self_harm 이었다.
 * 관문이 "라틴 낱말이 있는가" 였기 때문이다.
 *
 * 관문을 "한글이 없는가" 로 바꿔 고쳤다. 그런데 **고친 뒤에도 그것은 여전히
 * 주장이다.** 주장을 검사로 바꾸는 것이 이 파일의 전부다.
 *
 * ## 무엇이 증명되면 충분한가
 *
 * `classifyAmoraCrisis` 안에서 영어 갈래가 결과에 닿는 통로는 정확히 셋뿐이다:
 *
 *     let selfHarm            = english.selfHarm;
 *     let thirdPartySelfHarm  = english.thirdPartySelfHarm;
 *     let interpersonalDanger = english.interpersonalDanger || <기존 판정>;
 *     if (!englishFound && <기존 조기 반환 조건>) return null;
 *
 * 셋 다 영어 값이 `false` 이면 변경 전과 **문자 그대로 같은 식**이 된다
 * (`false` 로 시작, `false || x === x`, `!false && c === c`).
 *
 * 따라서 **한글이 있는 입력에 대해 세 값이 모두 false** 임을 보이면, 한국어
 * 문장의 판정이 바뀔 수 없다는 것이 증명된다. 아래 두 describe 가 각각
 * 그 값과 그 배선 모양을 지킨다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");

const NOTHING = { selfHarm: false, thirdPartySelfHarm: false, interpersonalDanger: false };

/**
 * 한글이 섞인 입력. **일부러 영어 위기 표현을 함께 넣었다** — 관문이 없으면
 * 전부 위기로 판정되는 문장들이다. 적대적 검토가 실제로 무너뜨린 것들과
 * 한국 결혼 준비에서 흔한 외래어를 섞었다.
 */
const KOREAN_INPUTS = [
  "축가 후보인 팝송 제목이 Suicide Blonde 인데 괜찮을까요?",
  "뉴스에서 domestic violence 기사 봤는데 남편이랑 이 얘기 꺼내도 될까요?",
  "친구가 손목을 그었어요. self-harm 이라고 하죠?",
  "게임에서 캐릭터가 죽는 장면인데 suicide 표현이 들어가요",
  "심리상담 받는 중인데 상담사가 suicidal ideation 은 없다고 했어요",
  "https://www.who.int/suicide-prevention 이 링크 보고 왔는데 예식 준비 상담도 되나요?",
  "self-harm 예방 캠페인 문구 참고해서 청첩장 카피 써도 되나요?",
  "예식 전날 카페인 overdose 해서 밤새웠어요",
  // 관문이 없으면 걸릴 영어 위기 표현을 한글 한 글자와 함께 둔다.
  "I want to kill myself 요",
  "My husband hits me 라고 쓰면 되나요",
  "he raped me 가 무슨 뜻이에요?",
  "I don't want to live anymore 를 번역해 주세요",
  // 평범한 결혼 준비 한국어
  "예산이 얼마나 필요할까요?",
  "드레스 투어 하느라 죽겠어요",
  "죽고 싶어요",
  "남편이 저를 때려요",
  "자해했어요",
  "ㅋㅋㅋ",
  "ㅠㅠ",
  "신랑이 studio 촬영 shot list 뽑아달래요",
] as const;

describe("측정기가 살아 있다", () => {
  it("관문을 통과하는 입력에서는 실제로 신호가 나온다 — 아니면 아래가 전부 공허하다", () => {
    // 같은 문장에서 한글만 빼면 걸려야 한다. 안 걸리면 이 파일은 아무것도 안 지킨다.
    expect(assessEnglishCrisisSignals("I want to kill myself").selfHarm).toBe(true);
    expect(assessEnglishCrisisSignals("My husband hits me").interpersonalDanger).toBe(true);
  });
});

describe("한글이 있으면 영어 갈래는 아무 값도 내지 않는다", () => {
  it.each(KOREAN_INPUTS)("%s", (text) => {
    expect(
      assessEnglishCrisisSignals(text),
      "영어 갈래가 한국어 문장에 값을 냈다 — 한국어 판정이 바뀔 수 있다",
    ).toEqual(NOTHING);
  });

  it("한글 한 글자만 붙여도 즉시 꺼진다", () => {
    const englishCrisis = "I want to kill myself and my husband hits me";
    expect(assessEnglishCrisisSignals(englishCrisis).selfHarm, "전제 확인").toBe(true);
    for (const syllable of ["가", "힣", "ㄱ", "ㅏ", "각", "뷁"]) {
      expect(
        assessEnglishCrisisSignals(`${englishCrisis}${syllable}`),
        `"${syllable}" 를 붙였는데 영어 갈래가 계속 돌았다`,
      ).toEqual(NOTHING);
    }
  });

  it("한글 음절 전 영역을 훑어도 뚫리지 않는다", () => {
    // 가(0xAC00) ~ 힣(0xD7A3) 를 일정 간격으로 훑는다. 손으로 고른 몇 글자가
    // 우연히 통과하는 것을 막기 위해서다.
    const leaks: string[] = [];
    for (let code = 0xac00; code <= 0xd7a3; code += 37) {
      const ch = String.fromCharCode(code);
      const r = assessEnglishCrisisSignals(`${ch} I want to kill myself`);
      if (r.selfHarm || r.thirdPartySelfHarm || r.interpersonalDanger) leaks.push(ch);
    }
    expect(leaks, "이 음절들이 관문을 통과했다").toEqual([]);
  });
});

describe("배선이 영어 값을 false 로 흘려보내는 모양 그대로다", () => {
  /**
   * 위 값 증명은 **배선이 지금 모양일 때만** 성립한다. 누가
   * `english.selfHarm || <기존>` 을 `english.selfHarm ? ... : ...` 처럼 바꾸거나
   * 영어 값을 조기 반환에 쓰면 false 여도 결과가 달라질 수 있다.
   */
  const wiring = readFileSync(
    join(REPO_ROOT, "packages", "shared", "src", "safety", "amoraCrisisSafety.ts"),
    "utf8",
  );

  it("세 값이 false 일 때 변경 전과 같은 식이 되는 형태다", () => {
    expect(wiring, "선언 형태가 바뀌었다").toContain("let selfHarm = english.selfHarm;");
    expect(wiring).toContain("let thirdPartySelfHarm = english.thirdPartySelfHarm;");
    expect(wiring, "OR 가 아니면 false 가 결과를 바꿀 수 있다")
      .toMatch(/interpersonalDanger\s*=\s*\n?\s*english\.interpersonalDanger\s*\|\|/u);
    expect(wiring, "조기 반환이 englishFound 를 부정으로만 쓰는 형태가 아니다")
      .toMatch(/!englishFound\s*\n\s*&&\s*\(/u);
  });

  it("영어 갈래를 부르는 곳이 classifyAmoraCrisis 한 곳뿐이다", () => {
    const calls = wiring.match(/assessEnglishCrisisSignals\s*\(/gu) ?? [];
    expect(calls.length, "호출 지점이 늘었다 — 이 파일의 증명 범위를 벗어난다").toBe(1);
  });

  it("관문이 함수의 첫 줄에 있다", () => {
    const english = readFileSync(
      join(REPO_ROOT, "packages", "shared", "src", "safety", "amoraCrisisEnglish.ts"),
      "utf8",
    );
    const body = english.slice(english.indexOf("export function assessEnglishCrisisSignals"));
    const firstStatement = body.split("\n").find((l) => l.trim().startsWith("if ("));
    expect(firstStatement ?? "", "한글 관문보다 먼저 도는 코드가 생겼다")
      .toContain("HANGUL.test(value)");
  });
});
