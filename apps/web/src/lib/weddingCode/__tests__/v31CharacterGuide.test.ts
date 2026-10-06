// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createV31Draft, encodeV31, decodeV31 } from "../v31";
import { buildV31StyleSummary, V31_STYLE_DIMENSIONS } from "../v31StyleSummary";
import { V31_CHARACTERS, v31Character, v31CoupleGuide, v31ExploreQuestion, v31PersonalGuide } from "../v31CharacterGuide";
import type { V31Draft } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";

function mixedNative() {
  const draft = native("KTFL");
  Object.assign(draft.answers, { B1: 3, B3: 3, T1: 5, T2: 5, F1: "undecided", F2: 5, H1: 1, H2: 1 });
  return draft;
}
describe("response-specific coordination with actual speaker direction", () => {
  const samples = [
    { name: "same-direction", first: () => native("KTFL"), second: () => { const value = native("KTFL"); value.answers.B1 = 4; value.answers.B3 = 2; return value; }, budget: "same-direction", support: "same-direction" },
    { name: "contrasting", first: () => native("KTFL"), second: () => native("RDCA"), budget: "different-directions", support: "different-directions" },
    { name: "MB?N", first: mixedNative, second: () => native("KTFL"), budget: "mixed", support: "neither" },
  ];
  for (const sample of samples) {
    it.each([false, true])(`${sample.name} preserves voices when reversed %s`, reverse => {
      const left = sample.first(); const right = sample.second(); const before = [encodeV31(left), encodeV31(right)];
      const baseline = v31CoupleGuide(left, right); const result = reverse ? v31CoupleGuide(right, left) : baseline;
      expect(result[0].coordination?.state).toBe(sample.budget); expect(result[3].coordination?.state).toBe(sample.support);
      for (const index of [0, 3]) {
        const row = result[index]; const original = baseline[index];
        expect(row.coordination?.firstSay).toBe(reverse ? original.coordination?.secondSay : original.coordination?.firstSay);
        expect(row.coordination?.secondSay).toBe(reverse ? original.coordination?.firstSay : original.coordination?.secondSay);
        expect(row.coordination?.agreement).toBe(original.coordination?.agreement);
        for (const item of row.first.items) expect(item.response).toBe((reverse ? right : left).answers[item.id]);
        for (const item of row.second.items) expect(item.response).toBe((reverse ? left : right).answers[item.id]);
      }
      if (sample.name === "same-direction") {
        expect(result[0].observation).toContain("성격의 강약으로 해석하지 않아요");
        expect(result[0].coordination?.agreement).toContain("포함·추가 비용");
        expect(result[0].coordination?.agreement).not.toContain("새 상한선");
      } else if (sample.name === "contrasting") {
        expect(baseline[0].coordination?.firstSay).toContain("예산 안의 선택");
        expect(baseline[0].coordination?.secondSay).toContain("금액 차이");
        expect(baseline[3].coordination?.firstSay).toContain("먼저 이야기를 들어줄래");
        expect(baseline[3].coordination?.secondSay).toContain("맡아줄 수 있는 일 하나");
        expect(result[3].observation).toContain("능력의 차이는 아니에요");
      } else {
        expect(baseline[3].coordination?.firstSay).toContain("둘 중 하나를 고르라고 하지 않아도 돼");
        expect(result[3].coordination?.agreement).toContain("어떤 도움도 바로 실행하지 않기로");
      }
      expect([encodeV31(left), encodeV31(right)]).toEqual(before);
    });
  }
  it("separates both, neither, middle and missing without forcing a character", () => {
    for (const [first, second, state] of [[5, 5, "both"], [1, 1, "neither"], [3, 3, "mixed"], ["undecided", 5, "pending"]] as const) {
      const draft = native("KTFL"); draft.answers.H1 = first; draft.answers.H2 = second;
      const result = v31CoupleGuide(draft, native("KTFL"))[3];
      expect(result.coordination?.state).toBe(state); expect(v31Character(draft)).toBeNull();
      if (state === "both") expect(result.coordination?.firstSay).toContain("두 도움 모두 필요할 수 있어");
      if (state === "pending") { expect(result.supported).toBe(false); expect(result.action).toBeNull(); expect(result.coordination?.firstSay).toContain("아직 어떤 도움이 필요한지 정하지 않았어"); }
    }
    const neither = native("KTFL"); neither.answers.H1 = 1; neither.answers.H2 = 1;
    expect(v31ExploreQuestion(buildV31StyleSummary(neither).dimensions[3])).toContain("둘 중 하나를 고를 필요는 없어요");
    const outsidePlan = native("KTFL"); outsidePlan.answers.H1 = "not_applicable"; outsidePlan.answers.H2 = "not_applicable";
    const notInPlan = v31CoupleGuide(outsidePlan, outsidePlan)[3];
    expect(notInPlan.supported).toBe(false); expect(notInPlan.action).toBeNull();
    expect(notInPlan.coordination?.agreement).toContain("지금은 이 대화를 건너뛰고");
    expect(notInPlan.coordination?.firstSay).toContain("이번 준비에는 해당하지 않아");
  });
});

function native(code: string): V31Draft {
  const draft = createV31Draft();
  V31_STYLE_DIMENSIONS.forEach((axis, index) => {
    const first = code[index] === axis.first.letter;
    draft.answers[axis.first.id] = first ? 5 : 1;
    draft.answers[axis.second.id] = first ? 1 : 5;
  });
  return draft;
}
describe("native v3.1 response-grounded character guides", () => {
  it.each(V31_CHARACTERS.map(row => row[0]))("preserves native encoding and four distinct guides for %s", code => {
    const draft = native(code); const encoded = encodeV31(draft);
    const guides = buildV31StyleSummary(draft).dimensions.map(v31PersonalGuide);
    expect(v31Character(draft)?.code).toBe(code);
    expect(new Set(guides.map(guide => guide?.action)).size).toBe(4);
    expect(new Set(guides.map(guide => guide?.say)).size).toBe(4);
    expect(decodeV31(encoded)).toEqual(draft);
    expect(encodeV31(draft)).toBe(encoded);
  });
  it.each(V31_CHARACTERS.flatMap(first => V31_CHARACTERS.map(second => [first[0], second[0]] as const)))(
    "%s / %s couple guides retain actual answers and both native codes", (first, second) => {
      const a = native(first); const b = native(second);
      const before = [encodeV31(a), encodeV31(b)];
      const guides = v31CoupleGuide(a, b);
      const reversed = v31CoupleGuide(b, a);
      expect(guides).toHaveLength(4);
      for (const guide of guides) {
        expect(guide.supported).toBe(true);
        expect(guide.action).not.toBeNull();
        for (const item of guide.first.items) expect(item.response).toBe(a.answers[item.id]);
        for (const item of guide.second.items) expect(item.response).toBe(b.answers[item.id]);
        expect(guide).not.toHaveProperty("score");
        if (guide.coordination) {
          const other = reversed.find(row => row.key === guide.key)!;
          expect(guide.coordination.firstSay).toBe(other.coordination?.secondSay);
          expect(guide.coordination.secondSay).toBe(other.coordination?.firstSay);
          expect(guide.coordination.agreement).toBe(other.coordination?.agreement);
        }
      }
      expect([encodeV31(a), encodeV31(b)]).toEqual(before);
    },
  );
  it("never forces a character for any non-polar or missing paired response on any axis", () => {
    for (const axis of V31_STYLE_DIMENSIONS) {
      for (const [first, second] of [[3, 3], [5, 5], [1, 1], [4, 3], [3, 4], ["undecided", 5], [5, "not_applicable"], [undefined, 5]] as const) {
        const draft = native("KTFL");
        if (first === undefined) delete draft.answers[axis.first.id];
        else draft.answers[axis.first.id] = first;
        draft.answers[axis.second.id] = second;
        expect(v31Character(draft)).toBeNull();
        const dimension = buildV31StyleSummary(draft).dimensions.find(value => value.key === axis.key)!;
        expect(v31PersonalGuide(dimension)).toBeNull();
        expect(v31ExploreQuestion(dimension).length).toBeGreaterThan(20);
      }
    }
  });
  it.each(["KTFL", "RDCA"])("uses %s native responses without re-encoding or mapping to v4", code => {
    const draft = native(code); const before = encodeV31(draft);
    expect(v31Character(draft)?.code).toBe(code);
    expect(buildV31StyleSummary(draft).code).toBe(code);
    expect(buildV31StyleSummary(draft).dimensions.map(axis => v31PersonalGuide(axis))).not.toContain(null);
    expect(encodeV31(draft)).toBe(before);
    expect(decodeV31(before)).toEqual(draft);
  });
  it("does not turn MB?N into a polar animal and offers specific non-forcing exploration", () => {
    const draft = createV31Draft(); draft.answers = { B1: 3, B3: 3, T1: 5, T2: 5, F1: "undecided", F2: 5, H1: 1, H2: 1 };
    expect(buildV31StyleSummary(draft).code).toBe("MB?N");
    expect(v31Character(draft)).toBeNull();
    for (const axis of buildV31StyleSummary(draft).dimensions) {
      expect(v31PersonalGuide(axis)).toBeNull();
      expect(v31ExploreQuestion(axis)).toContain(axis.key === "support" ? "둘 중 하나를 고를 필요는 없어요" : "아직");
    }
    expect(v31ExploreQuestion(buildV31StyleSummary(draft).dimensions[2])).toContain("가족");
  });
  it("preserves not-applicable and borderline states without forcing an answer or nickname", () => {
    const draft = native("KTFL"); draft.answers.F1 = "not_applicable";
    expect(v31Character(draft)).toBeNull();
    expect(v31ExploreQuestion(buildV31StyleSummary(draft).dimensions[2])).toContain("그대로 두어도");
    draft.answers.F1 = 4; draft.answers.F2 = 3;
    expect(v31Character(draft)).toBeNull();
    expect(v31PersonalGuide(buildV31StyleSummary(draft).dimensions[2])).toBeNull();
  });
  it("compares actual paired statements even when both codes are the same", () => {
    const a = native("KTFL"); const b = native("KTFL"); b.answers.B3 = 2;
    expect(buildV31StyleSummary(a).code).toBe(buildV31StyleSummary(b).code);
    const budget = v31CoupleGuide(a, b)[0];
    expect(budget.observation).toContain("둘 다 처음 정한 전체 예산");
    expect(budget.first.items[1].response).toBe(1);
    expect(budget.second.items[1].response).toBe(2);
  });
  it("rejects another version instead of interpreting a stored v4 answer as KTFL", () => {
    expect(() => v31Character({ ...native("KTFL"), version: WEDDING_CODE_V40_VERSION } as unknown as V31Draft)).toThrow();
  });
  it("has 16 native codes, never interprets incomplete couple evidence and never emits compatibility scores", () => {
    expect(new Set(V31_CHARACTERS.map(row => row[0])).size).toBe(16);
    for (const row of V31_CHARACTERS) expect(v31Character(native(row[0]))?.animal).toBe(row[2]);
    const incomplete = native("KTFL"); incomplete.answers.H1 = "undecided";
    const support = v31CoupleGuide(native("RDCA"), incomplete)[3];
    expect(support.supported).toBe(false); expect(support.action).toBeNull(); expect(support.say).toBeNull();
    expect(support).not.toHaveProperty("score");
  });
});
