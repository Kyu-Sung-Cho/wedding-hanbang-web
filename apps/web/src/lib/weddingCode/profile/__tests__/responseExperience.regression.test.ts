import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V06_QUESTIONS, WEDDING_CODE_V06_VERSION } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_SELF_READING } from "@/constants/weddingCodeSelfReading";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG as config,
  WEDDING_CODE_V08_SCENE_CONFIG as v08,
} from "@/lib/weddingCode/scene/config";
import { buildWeddingCodeSelfProfile, describeSelfAxisAbsence, describeSelfAxisReading } from "@/lib/weddingCode/scene/selfProfile";
import { buildWeddingCodeShareUrl, decodeWeddingCodeShareHash } from "@/lib/weddingCode/scene/link";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import { buildWeddingCodeV06GapMap, type WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { buildWeddingCodeAmoraProposals, buildWeddingCodeCoupleCombination } from "../amoraBridge";
import { buildWeddingCodeLetters, parseWeddingCodeString } from "../letters";

const profileOf = (answers: WeddingCodeV06Answers) => buildWeddingCodeSelfProfile(answers, config);
/** v0.8 링크는 지금도 열린다(그 판 문항으로). 그 판의 솔직한 답에 붙인 한정 안내도 계속 지켜야 한다. */
const v08ProfileOf = (answers: WeddingCodeV06Answers) => buildWeddingCodeSelfProfile(answers, v08);

const CHECK_NOTE = "이 주제의 답에는 겪은 일, 바랐던 일, 내가 한 일이 섞여 있어요. 숫자만 보지 말고 고른 답도 같이 봐 주세요.";

describe("장면의 경험을 다른 행동이나 현재 희망으로 바꾸지 않는다", () => {
  /**
   * 현재 판(v0.9)의 솔직한 답 26개와 그 한 답만 골랐을 때의 코드.
   * `weddingCodeV09.ts` 에서 스크립트로 뽑았다(손으로 옮겨 적지 않았다). 판이 바뀌면
   * 첫 테스트가 빨개지고, 그때 다시 뽑아 검토한다.
   */
  const reviewedCandidAnswers = [
    ["A1", "A", "V···"], ["A1", "C", "M···"], ["A2", "A", "V···"], ["A2", "B", "M···"],
    ["A3", "B", "M···"], ["A4", "A", "M···"], ["A5", "A", "V···"],
    ["B1", "D", "·O··"], ["B2", "B", "·T··"], ["B2", "C", "·O··"], ["B3", "D", "·T··"],
    ["B4", "D", "·O··"], ["B5", "A", "·T··"],
    ["C1", "A", "··U·"], ["C2", "B", "··F·"], ["C2", "D", "··F·"], ["C3", "A", "··F·"],
    ["C3", "D", "··U·"], ["C4", "B", "··U·"], ["C5", "B", "··F·"],
    ["D1", "A", "···H"], ["D2", "C", "···A"], ["D2", "D", "···H"], ["D3", "D", "···H"],
    ["D4", "D", "···A"], ["D5", "B", "···A"],
  ] as const;

  it("검토한 솔직한 경험 선택지 목록이 현재 20장면과 일치한다", () => {
    const actual = config.questions.flatMap(question => question.options
      .filter(option => option.candid).map(option => `${question.key}:${option.value}`));
    expect(actual).toEqual(reviewedCandidAnswers.map(([key, value]) => `${key}:${value}`));
  });

  it.each(reviewedCandidAnswers)("%s:%s의 %s 집계와 실제 인용은 바꾸지 않는다", (key, value, code) => {
    const question = config.questions.find(item => item.key === key)!;
    const option = question.options.find(item => item.value === value)!;
    const profile = profileOf({ [key]: value });
    const reading = profile.axes.find(axis => axis.axis === question.axis)!;
    expect(buildWeddingCodeLetters(profile).code).toBe(code);
    expect(reading.leftCount + reading.rightCount).toBe(1);
    expect(reading.evidence).toEqual([{ scene: question.scene, label: option.label }]);
    // 한정 안내는 카드 문구에 섞지 않는다 — 「정할 때 챙길 것」은 그 방향의 카드 문구 그대로다.
    expect(reading.watchOut).toBe(WEDDING_CODE_SELF_READING[question.axis][reading.lean].watchOut);
  });

  it("서둘러 끝내자는 답을 할 일 정리로 인증하지 않고 A 집계와 원문은 보존한다", () => {
    const profile = profileOf({ D4: "D" });
    const reading = profile.axes[3];
    const letters = buildWeddingCodeLetters(profile);
    expect(letters.code).toBe("···A");
    expect(letters.complete).toBe(false);
    expect(reading).toMatchObject({ leftCount: 0, rightCount: 1, answered: 1 });
    expect(reading.evidence[0].label).toBe("'고민 그만하고 오늘 끝내자'고 했다");
    expect(letters.slots[3].meaning).toBe("할 일과 결정 쪽 답을 더 많이 골랐어요");
    expect(reading.title).toBe("이번엔 ‘할 일 먼저’ 쪽 답이 더 많았어요");
    expect(describeSelfAxisReading(reading)).toBe(`답한 1장면은 A(할 일 먼저) 쪽이었어요. ${CHECK_NOTE}`);
    expect(reading.qualifiers).toEqual(["할 일을 차분히 나눴다기보다 빨리 끝내려던 답이에요."]);
    expect(reading.watchOut).not.toContain("서둘러 끝내려 한 것");
    expect(profile.repeated).toEqual([{ construct: "executionSupport", phrase: "할 일 먼저", count: 1 }]);
    expect(describeSelfAxisAbsence(reading)).toBe(
      "“마음 먼저” 쪽 답은 한 번도 고르지 않았어요.",
    );
  });

  it("v0.8 링크의 계약할 뻔한 답도 할 일 정리로 인증하지 않는다", () => {
    const profile = v08ProfileOf({ D4: "D" });
    const reading = profile.axes[3];
    expect(buildWeddingCodeLetters(profile).code).toBe("···A");
    expect(reading.evidence[0].label).toBe("깎아준다는 말에 그 자리에서 계약할 뻔했다");
    expect(reading.qualifiers).toEqual(["계약할 뻔한 경험과 할 일을 정리한 경험은 달라요."]);
    expect(describeSelfAxisReading(reading)).toContain(CHECK_NOTE);
    expect(describeSelfAxisAbsence(reading)).not.toContain("먼저 보는 답");
  });

  it.each([
    { answers: { D1: "B" } as const, quote: "더 말해도 안 통할 것 같아 그만뒀다", note: "말을 멈춘 경험만으로 듣는 도움을 원했다고 단정하지 않아요" },
    { answers: { D3: "D" } as const, quote: "뭘 물어야 할지 몰라 옆에 있어 주기만 했다", note: "곁에 있어 준 경험과 마음을 물어본 행동은 달라요" },
  ])("v0.8 대화 중단·곁에 있었던 경험을 마음을 들은 행동으로 바꾸지 않는다: $quote", ({ answers, quote, note }) => {
    const profile = v08ProfileOf(answers);
    expect(buildWeddingCodeLetters(profile).code).toBe("···H");
    expect(buildWeddingCodeLetters(profile).slots[3].meaning).toBe("마음과 대화 쪽 답을 더 많이 골랐어요");
    expect(profile.axes[3].title).toBe("이번엔 ‘마음 먼저’ 쪽 답이 더 많았어요");
    expect(profile.axes[3].evidence[0].label).toBe(quote);
    expect(profile.axes[3].qualifiers.join(" ")).toContain(note);
    expect(profile.axes[3].watchOut).not.toContain(note);
    expect(profile.repeated[0].phrase).toBe("마음 먼저");
  });

  it.each([
    { answers: { D1: "A" } as const, quote: "고맙다고만 보내고 속으로는 조금 서운했다", note: "서운했다고 해서 꼭 얘기를 들어주길 바랐던 건 아닐 수 있어요" },
    { answers: { D3: "D" } as const, quote: "뭘 짚어야 할지 몰라 옆에서 등만 토닥였다", note: "뭘 해야 할지 몰라서 곁에 있었던 거라, 마음부터 챙긴 것과는 조금 달라요" },
    { answers: { D2: "D" } as const, quote: "준비 얘기는 꺼내지 않고 산책만 하고 들어왔다", note: "준비 얘기를 하루 쉰 것만으로 마음부터 챙겼다고 하긴 어려워요" },
  ])("서운함·곁에 있었던 경험·미룬 날을 마음을 챙긴 행동으로 바꾸지 않는다: $quote", ({ answers, quote, note }) => {
    const profile = profileOf(answers);
    expect(buildWeddingCodeLetters(profile).code).toBe("···H");
    expect(profile.axes[3].evidence[0].label).toBe(quote);
    expect(profile.axes[3].qualifiers.join(" ")).toContain(note);
    expect(profile.axes[3].watchOut).not.toContain(note);
  });

  it.each([
    { answers: { A3: "B" } as const, note: "영상이 예뻐서 고른 답이지만, 그 자리에서 바로 정한 답이기도 해요" },
    { answers: { A4: "A" } as const, note: "사진 때문이라기보다 마감이 내일이라 서둘러 보낸 걸 수도 있어요" },
  ])("서둘러 정한 경험을 분위기 취향으로 확정하지 않는다: $answers", ({ answers, note }) => {
    const profile = profileOf(answers);
    expect(buildWeddingCodeLetters(profile).code).toBe("M···");
    expect(buildWeddingCodeLetters(profile).slots[0].meaning).toBe(
      "사진과 분위기, 결혼식 날에 거는 기대나 받은 인상부터 보는 답을 더 많이 골랐어요",
    );
    expect(profile.axes[0].qualifiers.join(" ")).toContain(note);
    expect(profile.repeated[0].phrase).toBe("사진·분위기");
  });

  it.each([
    { answers: { A3: "B" } as const, note: "다른 사람도 한다는 생각과 내가 원하는 분위기는 달라요" },
    { answers: { A4: "C" } as const, note: "성의 있는 응대에 마음이 놓인 경험을 결혼식의 의미로 해석하지 않아요" },
  ])("v0.8 남의 선택·업체 응대 경험을 나의 취향이나 의미로 확정하지 않는다: $answers", ({ answers, note }) => {
    const profile = v08ProfileOf(answers);
    expect(buildWeddingCodeLetters(profile).code).toBe("M···");
    expect(profile.axes[0].qualifiers.join(" ")).toContain(note);
    expect(profile.repeated[0].phrase).not.toMatch(/우리가 원하는 느낌|우리에게 어떤 의미/);
  });

  it.each([
    { answers: { D1: "A", D2: "A", D3: "A", D4: "D", D5: "B" } as const, code: "···A", left: 1, right: 4 },
    { answers: { D1: "A", D2: "B", D3: "C", D4: "D", D5: "A" } as const, code: "···H", left: 4, right: 1 },
    { answers: { D1: "C", D2: "D", D3: "A", D4: "D", D5: "C" } as const, code: "···a", left: 2, right: 3 },
    { answers: { D1: "A", D2: "B", D3: "A", D4: "D" } as const, code: "····", left: 2, right: 2 },
  ])("혼합·다수·동점에도 실제 선택한 끝내자는 경험의 한계를 남긴다: $code", ({ answers, code, left, right }) => {
    const profile = profileOf(answers);
    const reading = profile.axes[3];
    expect(buildWeddingCodeLetters(profile).code).toBe(code);
    expect(reading).toMatchObject({ leftCount: left, rightCount: right, answered: left + right });
    expect(reading.qualifiers).toContain("할 일을 차분히 나눴다기보다 빨리 끝내려던 답이에요.");
    expect(reading.title).not.toMatch(/할 일을 정하는 쪽|마음을 듣는 쪽|듣기와 할 일 정리/);
    if (left === right) expect(describeSelfAxisAbsence(reading)).toBeNull();
  });

  it("표시 인용에서 빠진 경험도 한정 안내에서 빠지지 않는다", () => {
    // D4-D 는 세 번째 A 답이라 인용 두 개(다수 쪽 첫 답 + 소수 쪽 첫 답) 밖에 있다.
    const reading = profileOf({ D1: "C", D2: "A", D3: "B", D4: "D", D5: "C" }).axes[3];
    expect(reading.evidence).toHaveLength(2);
    expect(reading.evidence.some(quote => quote.label.includes("고민 그만하고"))).toBe(false);
    expect(reading.qualifiers).toContain("할 일을 차분히 나눴다기보다 빨리 끝내려던 답이에요.");
  });

  it("선택하지 않은 경험은 경고로 만들어내지 않는다", () => {
    const normal = profileOf({ A3: "A", A4: "B", B5: "C", D1: "C", D3: "C", D4: "B" });
    for (const axis of normal.axes) {
      expect(axis.qualifiers, axis.axis).toEqual([]);
      if (axis.answered > 0) expect(axis.watchOut).toBe(WEDDING_CODE_SELF_READING[axis.axis][axis.lean].watchOut);
    }
    const legacy = v08ProfileOf({ A3: "A", A4: "B", B5: "C", D1: "A", D3: "C", D4: "B" });
    expect(legacy.axes.flatMap(axis => axis.qualifiers)).toEqual([]);
    expect(profileOf({}).axes.every(axis => axis.evidence.length === 0 && axis.qualifiers.length === 0)).toBe(true);
  });

  it("공유 후에도 양쪽 원문과 집계·설명이 같고 아모라 도움을 미리 선택하지 않는다", () => {
    const first = { D4: "D", D1: "A", A3: "B" } as const;
    const second = { D4: "B", D1: "C", A4: "B" } as const;
    const link = new URL(buildWeddingCodeShareUrl({ origin: "https://hanbang.ai", version: config.version,
      firstCode: encodeWeddingCodeV06(first, config.questions), secondCode: encodeWeddingCodeV06(second, config.questions) }));
    const decoded = decodeWeddingCodeShareHash(link.hash);
    expect(link.search).toBe("");
    expect(decoded?.version).toBe(config.version);
    expect(decoded?.bothCodes).toEqual({ first, second });
    expect(profileOf(decoded!.bothCodes!.first)).toEqual(profileOf(first));
    const comparison = buildWeddingCodeCoupleCombination(profileOf(first), profileOf(second), buildWeddingCodeV06GapMap(first, second, config));
    expect(comparison[0]).toMatchObject({ axis: "supportOrder", state: "different", compared: 2, identical: 0 });
    expect(comparison[0].firstTitle).not.toContain("듣기와 할 일 정리");
    for (const answers of [first, second]) {
      for (const proposal of buildWeddingCodeAmoraProposals(profileOf(answers))) {
        expect(proposal).not.toHaveProperty("value");
        expect(proposal).not.toHaveProperty("confidence");
      }
    }
  });

  it("답 없는 코드 해설도 듣기·정리를 실제로 한 것으로 단정하지 않는다", () => {
    const parsed = parseWeddingCodeString("MTUA");
    expect(parsed).not.toBeNull();
    expect(parsed![3]).toMatchObject({
      letter: "A",
      short: "할 일 먼저",
      meaning: "할 일과 결정 쪽 답을 더 많이 골랐어요",
      opposite: "H",
      oppositeShort: "마음 먼저",
      oppositeMeaning: "마음과 대화 쪽 답을 더 많이 골랐어요",
      side: "right",
    });
  });

  it("이전 16장면의 같은 D4-D 번호에 나중 판의 경험 안내를 붙이지 않는다", () => {
    const answers = { D4: "D" } as const;
    const link = new URL(buildWeddingCodeShareUrl({ origin: "https://hanbang.ai", version: WEDDING_CODE_V06_VERSION,
      firstCode: encodeWeddingCodeV06(answers, WEDDING_CODE_V06_QUESTIONS) }));
    const decoded = decodeWeddingCodeShareHash(link.hash);
    expect(decoded?.version).toBe("v0.6-scene");
    expect(decoded?.partnerAnswers).toEqual(answers);
    const legacyProfile = buildWeddingCodeSelfProfile(decoded!.partnerAnswers!);
    expect(buildWeddingCodeLetters(legacyProfile).code).toBe("···H");
    expect(legacyProfile.axes[3].evidence[0].label).toBe("둘 다 급해진 게 느껴져서 손을 잡았다");
    expect(legacyProfile.axes[3].qualifiers).toEqual([]);
  });
});
