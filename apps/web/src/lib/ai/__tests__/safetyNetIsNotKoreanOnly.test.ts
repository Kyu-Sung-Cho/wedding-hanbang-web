import { describe, expect, it } from "vitest";

import { classifyAmoraCrisis } from "@/lib/ai/amoraCrisisSafety";

/**
 * 안전망이 한국어 정규식 전용이라 같은 위기를 영어로 말하면 아무것도 걸리지 않았다.
 *
 * ## 실측 (2026-08-27)
 *
 * 같은 뜻 12쌍을 넣었더니 **한국어 8건 · 영어 0건**이었다. "I want to kill myself"
 * 도, "My husband hits me" 도, "I'm on the roof about to jump" 도 전부 `null` 이다.
 * `route.ts` 의 위기 관문은 이 함수 하나만 보고(모델 호출 0건) `null` 이면 그냥
 * 통과시키므로, 위기를 영어로 적은 사람은 **평범한 결혼 준비 답변**을 받았다.
 *
 * ## 분모
 *
 * 운영 사용자 메시지 696건 중 순수 영문은 2건(0.29%)이다. 드물다. 그래도 고치는
 * 이유는 빈도가 아니라 결과의 성격이다 — 다른 결함은 사용자가 다시 물어보면 되지만
 * 이건 그렇지 않다.
 *
 * ## 이 파일이 재는 것
 *
 * 재현율만 재면 안 된다. 위기 낱말을 쓰는 결혼 준비 영어 관용구가 널려 있어서
 * ("my feet are killing me", "that dress is to die for", "I want to die my hair"),
 * 오탐이 늘면 멀쩡한 대화가 위기 응답으로 끊긴다. **둘을 함께** 잰다.
 *
 * ## 반례를 두 번 고쳐 썼다
 *
 * 처음 만든 반례 31개로는 **오탐 0** 이 나왔다. 어려운 것 28개를 더 넣자
 * 오탐 8건이 드러났다 — die/dye 오타("I want to die my hair"), 비유
 * ("financial suicide"), 고유명사("Suicide Squad"), 관용구("hit me up",
 * "beat me at cards"). 내가 고른 반례가 쉬우면 통과는 아무것도 뜻하지 않는다.
 */

const ENGLISH_CRISIS = [
  "I want to kill myself",
  "I don't want to live anymore",
  "I've been thinking about suicide a lot lately",
  "I want to die",
  "I wish I was dead",
  "I've been cutting myself again",
  "I took a bunch of pills last night",
  "Everyone would be better off without me",
  "I'm on the roof and I want to jump",
  "There's no reason to live",
  "I'm suicidal",
  "I've been hurting myself",
  "My friend said she wants to die",
  "My sister keeps saying she wants to kill herself",
  "My husband hits me",
  "My fiance threatened to kill me",
  "He raped me",
  "He threatened me with a knife",
  "He locks me in the house",
  "I'm scared he will hurt me",
  "He won't let me leave",
  "My partner is physically abusive",
] as const;

/**
 * 위기 낱말을 담고 있지만 위기가 아닌 실제 결혼 준비 영어.
 * 아래 절반은 처음 코퍼스에 없었고, 넣자마자 오탐을 드러냈다.
 */
const WEDDING_ENGLISH = [
  // — 첫 코퍼스 (전부 통과했다) —
  "My feet are killing me after the venue tour",
  "I'm dying to see the dress",
  "That centerpiece is to die for",
  "My mom is going to kill me when she sees the budget",
  "We killed it at the tasting",
  "It was a killer deal on the photographer",
  "She looked like a knockout in that gown",
  "Can you give me a shot list for the ceremony?",
  "That's a great shot of the venue",
  "We're doing an engagement photo shoot next week",
  "Let me take a stab at the seating chart",
  "When do we cut the cake?",
  "We need to cut costs somewhere",
  "Where should we hang the lights?",
  "I'm dead serious about the June date",
  "The deadline for the deposit is Friday",
  "She's drop dead gorgeous in that veil",
  "I was scared to death during the speech",
  "I'd kill for a good caterer in Busan",
  "This wedding planning is killing me",
  "I could die of embarrassment, I forgot the rings",
  "I'm dead tired from the dress fitting",
  "We're shooting at the beach at sunset",
  "Let's beat the traffic to the venue",
  "The heat was murder at the outdoor ceremony",
  "I'm not suicidal, I just feel overwhelmed",
  "I used to self-harm years ago but I'm okay now",
  "In the movie the character kills himself, is that too dark for the reading?",
  "I would never hurt myself, don't worry",
  "What's a good budget for flowers?",
  "Can you help me pick a venue in Seoul?",
  // — 어렵게 다시 만든 것 (여기서 오탐 8건이 나왔다) —
  "I want to die my hair before the wedding",
  "I'm dying my hair chestnut next week",
  "My sister wants to die her dress navy",
  "Booking that venue would be financial suicide",
  "That's career suicide for a wedding planner",
  "Can we do a Suicide Squad themed bachelor party?",
  "I'd rather die than wear that dress",
  "I'm dead broke after the deposit",
  "My mother-in-law is killing me with these demands",
  "The DJ killed the vibe at the reception",
  "He hits the gym every morning before the fitting",
  "He locked me out of the shared spreadsheet",
  "We had a knockout of a first dance",
  "Let's do a shot of soju at the after party",
  "The hairstylist is going to kill me for being late",
  "My budget is dead on arrival",
  "Should I cut my hair before the ceremony?",
  "The photographer shot us at golden hour",
  "I'm hurting for cash after the venue deposit",
  "It killed me to cut my cousin from the list",
  "He beat me at cards last night",
  "She hit me up about the venue tour",
  "That news hit me hard",
  "He hit me with a huge quote for the flowers",
  "He hits the gym every morning",
  "My maid of honor slapped me on the back and laughed",
  "I'm scared she'll hurt my feelings if I say no",
  "Cutting the guest list is killing our families",
] as const;

/**
 * 한국어는 손대지 않았다는 대조군. 영어 갈래는 별도 파일에 있고
 * 한국어 판정 코드는 한 줄도 바뀌지 않았다 — 그래도 값으로 확인한다.
 */
const KOREAN_CRISIS = [
  "죽고 싶어요",
  "살고 싶지 않아요",
  "수면제 20알 먹었어요",
  "남편이 죽이겠다고 협박해요",
  "친구가 죽고 싶다고 해요",
  "남편이 저를 가둬요",
  "남편이 칼로 협박했어요",
  "지금 옥상에서 뛰어내리려고요",
] as const;

const KOREAN_BENIGN = [
  "드레스 투어 하느라 죽겠어요",
  "결혼 준비 때문에 너무 힘들어 죽을 것 같아요",
  "케이크 커팅용 칼 준비해야 하나요?",
  "예산이 얼마나 필요할까요?",
] as const;

describe("측정기가 살아 있다", () => {
  it("한국어 위기는 예전처럼 잡힌다 — 아니면 아래 검사가 무엇을 지키는지 알 수 없다", () => {
    const missed = KOREAN_CRISIS.filter((text) => classifyAmoraCrisis(text) === null);
    expect(missed, "한국어 판정이 깨졌다").toEqual([]);
  });

  it("한국어 평범한 말은 위기가 아니다", () => {
    const wrong = KOREAN_BENIGN.filter((text) => classifyAmoraCrisis(text) !== null);
    expect(wrong, "한국어 오탐이 생겼다").toEqual([]);
  });
});

describe("영어로 말한 위기도 잡는다", () => {
  it.each(ENGLISH_CRISIS)("%s", (text) => {
    expect(
      classifyAmoraCrisis(text),
      "영어로 적은 위기가 평범한 답변으로 나간다",
    ).not.toBeNull();
  });

  it("자해와 대인 위험을 구분한다 — 응답 문구가 다르다", () => {
    expect(classifyAmoraCrisis("I want to kill myself")?.kind).toBe("self_harm");
    expect(classifyAmoraCrisis("My husband hits me")?.kind).toBe("interpersonal_danger");
    expect(classifyAmoraCrisis("My friend said she wants to die")?.kind)
      .toBe("third_party_self_harm");
    /**
     * **이 한 줄이 3인칭 구분을 실제로 재는 유일한 사례다.**
     *
     * 위의 "she wants to die" 로는 부족하다 — 1인칭 패턴은 `want\s+to\s+die` 라
     * "want**s**" 에 안 걸리고, 그래서 `!thirdParty` 를 지우는 변형이 그냥 통과했다.
     * `suicidal` 은 1인칭·3인칭 패턴에 **둘 다** 걸리므로, 구분이 깨지면
     * `multi_party_self_harm` 으로 값이 바뀐다. 응답 문구가 달라지는 자리다.
     */
    expect(
      classifyAmoraCrisis("My friend is suicidal")?.kind,
      "3인칭 고백이 본인 위기로 분류돼 엉뚱한 안내가 나간다",
    ).toBe("third_party_self_harm");
  });
});

describe("결혼 준비 영어를 위기로 오해하지 않는다", () => {
  it.each(WEDDING_ENGLISH)("%s", (text) => {
    const result = classifyAmoraCrisis(text);
    expect(
      result === null ? null : `${result.kind} 로 오판`,
      "평범한 대화가 위기 응답으로 끊긴다",
    ).toBeNull();
  });
});

describe("영어 위기가 나머지 안전 장치까지 켠다", () => {
  /**
   * `classifyAmoraQuestionScope` 가 `classifyAmoraCrisis` 를 부른다
   * (amoraQuestionScope.ts:261). 그래서 이 한 곳을 고치면 **범위 판정도 따라온다** —
   * W5 는 장기 기억 저장을 막고, `route.ts` 의 중재 관문이 이 값을 보고 공유 레인
   * 저장을 막는다. 그 연쇄가 실제로 이어지는지 값으로 확인한다. 안 이어지면
   * 영어로 적은 폭력 고백이 **배우자가 읽는 자리**에 저장된다.
   */
  it.each([
    "I want to kill myself",
    "My husband hits me",
    "He threatened me with a knife",
  ])("%s → W5", async (text) => {
    const { classifyAmoraQuestionScope } = await import("@/lib/ai/amoraQuestionScope");
    const scope = classifyAmoraQuestionScope({ userText: text, requestKind: "mediation" });
    expect(scope.scope, "영어 안전 고백이 공유 레인으로 갈 수 있다")
      .toBe("W5_safety_override");
    expect(scope.allowsLongTermMemory, "영어 위기 내용이 장기 기억에 남는다")
      .toBe(false);
  });
});

describe("한국어에 영어 낱말이 섞여도 안전하다", () => {
  it.each([
    "Vera Wang 드레스 어때요?",
    "studio 촬영 shot list 뽑아주세요",
    "wedding hall 예약했어요",
    "honeymoon 어디로 갈까요?",
    "mother-in-law가 자꾸 참견하셔서 스트레스예요",
    "본식 DJ가 killer였어요",
  ])("%s", (text) => {
    expect(classifyAmoraCrisis(text), "영어 낱말 때문에 한국어 대화가 끊긴다")
      .toBeNull();
  });
});
