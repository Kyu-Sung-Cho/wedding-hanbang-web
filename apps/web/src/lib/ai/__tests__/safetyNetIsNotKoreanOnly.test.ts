import { describe, expect, it } from "vitest";

import { buildAmoraCrisisResponse, classifyAmoraCrisis } from "@/lib/ai/amoraCrisisSafety";

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

describe("절을 쪼갠 뒤 다시 잇지 않는다", () => {
  /**
   * 부정된 절을 덜어내는 코드는 **지울 절이 없으면 원문을 그대로** 넘긴다.
   * 그 분기를 없애고 항상 재조립하게 만드는 변형이 처음에는 **아무 검사도
   * 깨뜨리지 못했다** — 방어 코드를 쓰고 주석까지 달아 놓고 검사를 안 만든 것이다.
   *
   * 게다가 그때 주석에 적은 예시("My sister, who is getting married, keeps
   * saying she wants to kill herself")는 **원문에서도 안 걸린다** — 주어와
   * 서술 사이가 51자라 패턴의 50자 한계를 넘는다. 근거로 든 문장이 근거가
   * 아니었다. 아래 셋은 원문에서 걸리고 재조립하면 안 걸리는 것을 실제로 확인했다.
   */
  it.each([
    "My sister, who is 28, is suicidal",
    "My friend, my maid of honor, wants to die",
    "My husband, after the fight, said he wants to kill himself",
  ])("쉼표를 낀 3인칭 고백을 놓치지 않는다: %s", (text) => {
    expect(classifyAmoraCrisis(text)?.kind, "절을 다시 이어 붙여 주어가 끊겼다")
      .toBe("third_party_self_harm");
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

/**
 * 적대적 검토(2026-08-27, 5개 렌즈 · 46 에이전트)가 찾은 것들.
 *
 * **첫 판은 여기서 무너졌다.** 재현 22/22 · 오탐 0/59 로 통과시켰던 코드가
 * 이 코퍼스에서는 오탐 17건 · 미탐 20건이었다. 무너뜨린 것 셋:
 *
 * 1. **부정 억제기가 문장 전체를 삼켰다.** "I'm not okay, I want to kill myself"
 *    처럼 부정이 다른 것에 걸린 정상 어법이 통째로 무효화됐다. 한국어 갈래는
 *    처음부터 절 단위로 봤는데 영어 갈래에만 그 분절이 없었다.
 * 2. **"영어 패턴은 한국어 문장에 오탐을 못 만든다"는 내 주장이 틀렸다.**
 *    한국 사용자는 영어 낱말을 섞어 쓴다 — "팝송 제목이 Suicide Blonde 인데",
 *    "뉴스에서 domestic violence 기사". 라틴 낱말 하나가 한국어 판정기의
 *    픽션·메타·부정 관문을 전부 우회했다.
 * 3. **내가 만든 관용구 제외가 진짜 폭력을 지웠다.** `hit me with a *` 가
 *    "hit me with a belt" 를, `beat the *` 가 "beat the hell out of me" 를 지웠다.
 *
 * ## 받아들인 예외 4건 (여기 없다)
 *
 * - `My bridesmaid said she wants to die, the invitations are so cute`
 *   — 진짜 애매하다. 좁히면 "My bridesmaid said she wants to die" 라는 진짜
 *     고백을 놓친다. 오탐 쪽 피해(따뜻한 응답 한 번)가 더 작다.
 * - `남편이 자꾸 abuse해요` — 한글이 있으면 영어 갈래를 안 돌리는 **설계상 결과**.
 * - `He checks my phone every night and won't let me have my own bank card`
 *   — 위기 미만(강압적 통제) 층은 영어에 아직 없다. `assessAmoraSafetyText` 가
 *     한국어 전용이라 `non_immediate_safety` 갈래가 영어에는 비어 있다.
 * - `I'm going to kill him before the wedding` — 신고자가 가해자인 종류
 *   (`interpersonal_danger_reporter_aggressor`)로 다른 처리가 필요하다.
 */
const ADVERSARIAL_CRISIS = [
  "I'm not okay, I want to kill myself",
  "He's not abusive, he just hits me when he's drunk",
  "I keep wondering if I should just kill myself",
  "My husband said he wants to kill himself",
  "i just wanna die",
  "My husband hit me with a belt last night",
  "He said he would kill me last night",
  "I'm going to hang myself tonight",
  "I was raped last night and I don't know what to do",
  "My husband pushed me down the stairs and kicked me",
  "I used to self-harm in college. I cut myself again yesterday.",
  "He's not abusive, he just hits me when he drinks",
  "My husband hit me with a bottle last night",
  "He hit me hard in the face again",
  "I'm scared he's going to kill me",
  "I cut my wrists last night",
  "I don't know what to do, my husband is abusive and I'm scared",
  "I don’t want to live anymore",
  "He's not abusive, but he punched me last night",
  "He is choking me right now",
  "He beat the hell out of me last night",
  "I'm going to hang myself after the wedding",
] as const;

const ADVERSARIAL_WEDDING = [
  "I don't want to live with my in-laws after the wedding",
  "I don't want to wake up at 5am for hair and makeup",
  "The studio won't let me see my original photo files unless I pay extra",
  "The deposit locks me in for the September date",
  "I've been killing myself trying to get the guest list under 200",
  "There's no point in living in Gangnam with these hall prices",
  "I hurt myself lifting the centerpiece boxes yesterday",
  "I want to jump on that venue before someone else books it",
  "Booking a Saturday in May is basically suicide for our budget",
  "My in-laws hit me with another 30 guests two weeks before the wedding",
  "I want to die it a shade darker before the hanbok fitting",
  "The venue won't let me leave before 11pm",
  "Booking a December wedding in Seoul is suicide",
  "They shoved me into the group photo",
  "My friend works at a suicide prevention hotline, should I invite her to the wedding?",
  "They slapped me with a huge cancellation fee",
] as const;

/** 한글이 섞이면 영어 갈래는 아예 안 돈다. 한국어 판정기가 온전히 책임진다. */
const KOREAN_WITH_ENGLISH_WORDS = [
  "뉴스에서 domestic violence 기사 봤는데 남편이랑 이 얘기 꺼내도 될까요?",
  "드라마에서 나온 그 장면이 suicide 다루는 내용이라 좀 무서웠어요",
  "제가 suicidal 하지는 않아요, 그냥 결혼 준비가 너무 벅차요",
  "친구가 손목을 그었어요. self-harm 이라고 하죠?",
  "케이크 커팅용 칼을 신랑이 들고 있는 사진 찍고 싶은데 studio 소품 대여 되나요? 팝송 가사에 suicide 나오는 건 별개고요",
  "https://www.who.int/suicide-prevention 이 링크 보고 왔는데 예식 준비 스트레스 상담도 되나요?",
  "심리상담 받는 중인데 상담사가 suicidal ideation 은 없다고 했어요",
  "게임에서 캐릭터가 죽는 장면인데 suicide 표현이 들어가요",
  "언니가 자해했어요. self harm 검색해봤는데 어떻게 도와야 할지 모르겠어요",
  "예식 전날 카페인 overdose 해서 밤새웠어요",
  "축가 후보인 팝송 제목이 Suicide Blonde 인데 괜찮을까요?",
  "결혼 준비 카페에서 본 글인데 어떤 분이 suicide 언급해서 걱정돼요",
  "self-harm 예방 캠페인 문구 참고해서 청첩장 카피 써도 되나요?",
] as const;

describe("적대적 검토가 무너뜨린 자리", () => {
  it.each(ADVERSARIAL_CRISIS)("위기로 잡는다: %s", (text) => {
    expect(classifyAmoraCrisis(text), "적대적 검토가 찾은 미탐이 되살아났다").not.toBeNull();
  });

  it.each(ADVERSARIAL_WEDDING)("평범한 말로 둔다: %s", (text) => {
    const r = classifyAmoraCrisis(text);
    expect(r === null ? null : `${r.kind} 로 오판`, "평범한 대화가 위기로 끊긴다").toBeNull();
  });

  it.each(KOREAN_WITH_ENGLISH_WORDS)("영어 낱말이 한국어 판정을 뒤집지 않는다: %s", (text) => {
    const expected = ({"친구가 손목을 그었어요. self-harm 이라고 하죠?": "third_party_self_harm", "언니가 자해했어요. self harm 검색해봤는데 어떻게 도와야 할지 모르겠어요": "third_party_self_harm"} as Record<string, string>)[text] ?? null;
    expect(classifyAmoraCrisis(text)?.kind ?? null).toBe(expected);
  });
});

describe("영어로 물어본 사람이 읽을 수 있는 안내를 받는다", () => {
  /**
   * 응답문은 전부 한국어였다. 영어 갈래를 붙여 위기를 **잡기만** 하고 한국어
   * 벽을 돌려주면, 정작 그 사람은 안내를 못 읽는다 — 목적이 절반만 달성된다.
   *
   * 연락처는 한국어 응답과 같은 값이다(112·119·109·1366). 번역일 뿐
   * 새 사실이 아니므로 `AMORA_CRISIS_CONTACT_POLICY_VERSION` 은 그대로 둔다.
   */
  const enResponse = (text: string) => {
    const c = classifyAmoraCrisis(text);
    expect(c, "전제 확인 — 위기로 잡히지 않으면 아래가 무의미하다").not.toBeNull();
    return buildAmoraCrisisResponse(c!.kind, c!.language);
  };

  it("영어 위기에는 영어 안내가 먼저 온다", () => {
    const r = enResponse("I want to kill myself");
    expect(r, "영어 안내가 없다").toMatch(/immediate danger|Amora is not a crisis service/u);
    expect(r.indexOf("Amora is not a crisis service"), "한국어가 먼저 온다")
      .toBeLessThan(r.indexOf("아모라는 위기 상담기관이 아니"));
  });

  it("긴급 번호가 한국어 응답과 같다", () => {
    const r = enResponse("My husband hits me");
    for (const number of ["112", "119", "109", "1366"]) {
      expect(r, `${number} 가 영어 안내에 없다`).toContain(number);
    }
  });

  it("한국어 본문도 함께 남는다 — 옆 사람이 한국어만 읽을 수 있다", () => {
    expect(enResponse("I want to kill myself")).toContain("자살예방상담전화 109");
  });

  it("제3자·대인 위험은 첫 문장이 다르다", () => {
    expect(enResponse("My friend said she wants to die"))
      .toContain("Thank you for telling someone");
    expect(enResponse("My husband hits me")).toContain("Your safety comes first");
  });

  it("**한국어 위기에는 영어가 한 글자도 붙지 않는다**", () => {
    for (const text of ["죽고 싶어요", "남편이 칼로 협박했어요", "친구가 죽고 싶다고 해요"]) {
      const c = classifyAmoraCrisis(text);
      expect(c, text).not.toBeNull();
      expect(c!.language, "한국어인데 영어로 표시됐다").toBeUndefined();
      expect(
        buildAmoraCrisisResponse(c!.kind, c!.language),
        "한국어 사용자에게 영어가 섞여 나간다",
      ).not.toMatch(/Amora is not a crisis service/u);
    }
  });
});

describe("웹 클라이언트가 쓰는 경로에서도 읽을 수 있다", () => {
  /**
   * `ChatContent.tsx:1480` 은 서버를 기다리지 않고 `planAmoraCrisisDelivery` 로
   * 위기 안내를 **먼저 화면에 띄운다.** 그 경로가 언어를 안 넘기면 영어 사용자는
   * 서버 응답이 오기 전까지 한국어 벽만 본다 — 가장 급한 순간이다.
   *
   * 변형 검사에서 그 호출부의 언어를 지웠을 때 **아무 검사도 안 깨졌다.**
   */
  it("영어 위기에 영어 안내가 즉시 뜬다", async () => {
    const { planAmoraCrisisDelivery } = await import("@hanbang/shared/amora-crisis-delivery");
    const plan = planAmoraCrisisDelivery({
      userText: "I want to kill myself",
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
    });
    expect(plan.disposition, "위기로 잡히지 않았다").toBe("local_safety_hold");
    expect(plan.response ?? "", "클라이언트 즉시 안내가 한국어뿐이다")
      .toContain("Amora is not a crisis service");
  });

  it("한국어 위기에는 영어가 안 붙는다", async () => {
    const { planAmoraCrisisDelivery } = await import("@hanbang/shared/amora-crisis-delivery");
    const plan = planAmoraCrisisDelivery({
      userText: "죽고 싶어요",
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
    });
    expect(plan.disposition).toBe("local_safety_hold");
    expect(plan.response ?? "").not.toMatch(/Amora is not a crisis service/u);
  });
});
