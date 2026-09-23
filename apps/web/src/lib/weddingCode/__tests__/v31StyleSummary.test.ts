import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
  type V31Response,
} from "@/constants/weddingCodeV31";
import { createV31Draft, decodeV31, encodeV31 } from "@/lib/weddingCode/v31";
import { V31_CORE_RATING_IDS, V31_EXTRA_RATING_IDS } from "@/lib/weddingCode/v31Flow";
import {
  V31_STYLE_DIMENSIONS,
  V31_STYLE_SUMMARY_VERSION,
  buildV31StatementScales,
  buildV31StyleSummary,
  getV31StatementPercent,
} from "@/lib/weddingCode/v31StyleSummary";

function paired(first: V31Response, second: V31Response): V31Draft {
  return {
    ...createV31Draft(),
    answers: { B1: first, B3: second, T1: first, T2: second, F1: first, F2: second, H1: first, H2: second },
  };
}

describe("v3.1 네 글자 응답 요약", () => {
  it("고정된 네 주제와 기본 질문 여덟 개만 코드에 사용한다", () => {
    expect(V31_STYLE_SUMMARY_VERSION).toBe("response-summary-1");
    expect(V31_STYLE_DIMENSIONS.map(item => [item.key, item.first.id, item.first.letter, item.second.id, item.second.letter])).toEqual([
      ["budget", "B1", "K", "B3", "R"],
      ["teamwork", "T1", "T", "T2", "D"],
      ["family", "F1", "F", "F2", "C"],
      ["support", "H1", "L", "H2", "A"],
    ]);
    const core = new Set<string>(V31_CORE_RATING_IDS);
    for (const item of V31_STYLE_DIMENSIONS) {
      expect(core.has(item.first.id)).toBe(true);
      expect(core.has(item.second.id)).toBe(true);
    }
  });

  it("1~5의 모든 조합에서 공존·한쪽 긍정·중간·둘 다 낮음을 구분한다", () => {
    const expected = [
      ["N", "N", "M", "second", "second"],
      ["N", "N", "M", "second", "second"],
      ["M", "M", "M", "second", "second"],
      ["first", "first", "first", "B", "B"],
      ["first", "first", "first", "B", "B"],
    ];
    const ratings = [1, 2, 3, 4, 5] as const;
    for (const first of ratings) for (const second of ratings) {
      const summary = buildV31StyleSummary(paired(first, second));
      const pattern = expected[first - 1][second - 1];
      expect(summary.code).toBe(pattern === "first" ? "KTFL" : pattern === "second" ? "RDCA" : pattern.repeat(4));
      expect(summary.hasIncomplete).toBe(false);
      expect(summary.dimensions.every(item => item.ratedCount === 2)).toBe(true);
    }
  });

  it.each([
    [5, 5, "BBBB", 100, 100],
    [4, 5, "BBBB", 75, 100],
    [5, 4, "BBBB", 100, 75],
    [3, 3, "MMMM", 50, 50],
    [1, 1, "NNNN", 0, 0],
    [5, 3, "KTFL", 100, 50],
    [3, 5, "RDCA", 50, 100],
  ] as const)("%i와 %i는 %s이며 두 퍼센트가 독립적이다", (first, second, code, firstPercent, secondPercent) => {
    const summary = buildV31StyleSummary(paired(first, second));
    expect(summary.code).toBe(code);
    for (const item of summary.dimensions) expect(item.items.map(evidence => evidence.percent)).toEqual([firstPercent, secondPercent]);
  });

  it("모름·비해당·건너뜀·미노출 하나라도 있으면 글자를 보류하고 다른 답은 보존한다", () => {
    const cases = [
      { value: "undecided", label: "아직 모르겠어요" },
      { value: "not_applicable", label: "이번 계획에는 없어요" },
      { value: "skipped", label: "지금 답하지 않을게요" },
      { value: undefined, label: "아직 보지 않은 문장이에요" },
    ] as const;
    for (const { value, label } of cases) for (const position of [0, 1]) {
      const draft = paired(5, 5);
      const id = position === 0 ? "B1" : "B3";
      if (value === undefined) delete draft.answers[id];
      else draft.answers[id] = value;
      const summary = buildV31StyleSummary(draft);
      const budget = summary.dimensions[0];
      expect(summary.code).toBe("?BBB");
      expect(summary.hasIncomplete).toBe(true);
      expect(budget.label).toBe("요약 보류");
      expect(budget.ratedCount).toBe(1);
      expect(budget.items[position]).toMatchObject({ response: value, responseLabel: label, percent: null });
      expect(budget.items[position === 0 ? 1 : 0].percent).toBe(100);
      expect(budget.basis).toContain("1/2개");
    }
    const empty = buildV31StyleSummary(createV31Draft());
    expect(empty.code).toBe("????");
    expect(empty.dimensions.every(item => item.ratedCount === 0)).toBe(true);
    expect(empty.headline).toBe("이번 답을 문장별로 살펴봐요");
    expect(empty.name).toBe("문장별로 살펴볼 준비 방식");
  });

  it("중간·낮은 답만 있는 경우 긍정적 유형이나 반대 취향을 만들지 않는다", () => {
    for (const [first, second] of [[1, 2], [2, 3], [3, 3]] as const) {
      const summary = buildV31StyleSummary(paired(first, second));
      expect(summary.headline).toBe("이번 답을 문장별로 살펴봐요");
      expect(summary.dimensions.every(item => item.letter === "N" || item.letter === "M")).toBe(true);
      expect(summary.dimensions.map(item => item.basis).join(" ")).not.toMatch(/독립적인|유연한|가족을 배제|혼자 결정|즉흥적인|균형형|궁합|정확도/);
    }
    expect(buildV31StyleSummary(paired(3, 3)).dimensions[0].basis).toContain("아직 모른다는 답과는 달라요");
    expect(buildV31StyleSummary(paired(1, 1)).dimensions[0].basis).toContain("반대 방식을 원한다는 뜻은 아니에요");
  });

  it("대표 제목은 실제 긍정한 내용만 쓰고 계약·추가 결제·경청 순서를 보존한다", () => {
    expect(buildV31StyleSummary(paired(5, 1)).headline).toBe("업체는 시간을 맞춰 함께 찾아보고 싶어요");
    expect(buildV31StyleSummary(paired(5, 1)).name).toBe("함께 찾는 스타일");
    expect(buildV31StyleSummary(paired(1, 5)).headline).toContain("계약·추가 결제 없는 세부 선택");
    expect(buildV31StyleSummary(paired(1, 5)).name).toBe("세부 선택은 맡겨도 되는 스타일");
    expect(buildV31StyleSummary(paired(5, 5)).headline).toContain("업체는 함께 찾고");
    expect(buildV31StyleSummary(paired(5, 5)).headline).toContain("계약·추가 결제 없는");
    const budget = createV31Draft();
    budget.answers = { B1: 2, B3: 5 };
    expect(buildV31StyleSummary(budget).headline).toBe("전체 예산을 늘릴지도 다시 의논하고 싶어요");
    const family = createV31Draft();
    family.answers = { F1: 5, F2: 5 };
    expect(buildV31StyleSummary(family).headline).toBe("가족의 바람을 초반에 듣고, 마지막 선택은 둘이 하고 싶어요");
    const support = createV31Draft();
    support.answers = { H1: 5, H2: 1 };
    expect(buildV31StyleSummary(support).headline).toBe("힘들 때 해결책보다 이야기를 먼저 들어주면 좋겠어요");
    support.answers.H2 = 5;
    expect(buildV31StyleSummary(support).headline).toContain("몰린 일의 일부도 맡아주면");
    const together = buildV31StyleSummary(paired(5, 5));
    expect(together.dimensions[1].label).toContain("계약·추가 결제 없는 세부 선택은 맡겨도 괜찮아요");
    expect(together.dimensions[1].basis).not.toContain("두 바람");
    expect(together.dimensions[3].label).toContain("일 일부도 맡아주길");
  });

  it("선택 질문·다른 기본 답·직접 취향·우선순위를 추가해도 코드와 근거를 바꾸지 않는다", () => {
    const draft = paired(5, 1);
    const original = buildV31StyleSummary(draft);
    const expanded: V31Draft = { ...draft, answers: { ...draft.answers }, tastes: { venue: { status: "answered", values: ["outdoor"] } }, spending: { status: "answered", values: ["photo"] }, avoidances: { status: "answered", values: ["loud_music"] }, priorities: { status: "answered", values: ["taste.venue"] } };
    for (const id of V31_EXTRA_RATING_IDS) expanded.answers[id] = 5;
    expanded.answers.B2 = 5;
    expanded.answers.D2 = 5;
    expanded.answers.G1 = 1;
    expanded.answers.G3 = 3;
    expanded.answers.R4 = "undecided";
    expanded.answers.D1 = 2;
    expanded.answers.T3 = "not_applicable";
    expanded.answers.F4 = "skipped";
    expanded.answers.H4 = 5;
    expect(buildV31StyleSummary(expanded)).toEqual(original);
    expect(buildV31StatementScales(expanded).flatMap(group => group.items)).toHaveLength(25);
    expect(buildV31StatementScales(draft).flatMap(group => group.items)).toHaveLength(8);
    expanded.answers.T2 = 5;
    expect(buildV31StyleSummary(expanded).code).toBe("KBFL");
    expect(buildV31StyleSummary(draft).code).toBe("KTFL");
  });

  it("원래 답과 공유값을 바꾸지 않고 같은 답에서 같은 요약을 만든다", () => {
    const draft = paired(4, 3);
    draft.answers.G1 = "not_applicable";
    draft.tastes.photo = { status: "answered", values: ["both_styles"] };
    const before = encodeV31(draft);
    const original = buildV31StyleSummary(draft);
    const decoded = decodeV31(before)!;
    expect(buildV31StyleSummary(decoded)).toEqual(original);
    expect(encodeV31(draft)).toBe(before);
    expect(encodeV31(decoded)).toBe(before);
    expect(Object.keys(decoded)).toEqual(Object.keys(draft));
    const otherPerson = paired(1, 5);
    expect(buildV31StyleSummary(otherPerson).code).toBe("RDCA");
    expect(buildV31StyleSummary(draft)).toEqual(original);
  });

  it("v3.1 이외의 원응답 버전을 이 요약으로 읽지 않는다", () => {
    const draft = paired(5, 5);
    Reflect.set(draft, "version", "v3.0-preferences");
    expect(() => buildV31StyleSummary(draft)).toThrow("v3.1");
    expect(() => buildV31StatementScales(draft)).toThrow("v3.1");
  });
});

describe("v3.1 문장별 표시 척도", () => {
  it("다섯 응답을 0·25·50·75·100에만 대응하고 모든 상태는 null로 보존한다", () => {
    expect(([1, 2, 3, 4, 5] as const).map(getV31StatementPercent)).toEqual([0, 25, 50, 75, 100]);
    for (const value of ["undecided", "not_applicable", "skipped", undefined] as const) expect(getV31StatementPercent(value)).toBeNull();
  });

  it("실제로 답한 문장만 정본 순서·원문·응답명으로 묶고 직접 선택은 수치화하지 않는다", () => {
    const draft: V31Draft = {
      version: WEDDING_CODE_V31_VERSION,
      answers: { H4: "skipped", B4: "undecided", V1: 1, G1: "not_applicable", T3: 5 },
      tastes: { venue: { status: "answered", values: ["outdoor"] } },
      spending: { status: "answered", values: ["photo"] },
      priorities: { status: "answered", values: ["T3"] },
      avoidances: { status: "answered", values: ["crowded_space"] },
    };
    const groups = buildV31StatementScales(draft);
    expect(groups.map(group => group.key)).toEqual(["vision", "guests", "budget", "teamwork", "support"]);
    const items = groups.flatMap(group => group.items);
    expect(items.map(item => item.id)).toEqual(["V1", "G1", "B4", "T3", "H4"]);
    expect(items.map(item => item.percent)).toEqual([0, null, null, 100, null]);
    expect(items.map(item => item.responseLabel)).toEqual(["전혀 그렇지 않아요", "이번 계획에는 없어요", "아직 모르겠어요", "매우 그래요", "지금 답하지 않을게요"]);
    for (const item of items) {
      const source = WEDDING_CODE_V31_QUESTIONS.find(question => question.id === item.id)!;
      expect(item.statement).toBe(source.statement);
      expect(item.shortLabel).toBe(source.shortLabel);
      expect(item.response).toBe(draft.answers[item.id]);
    }
    expect(buildV31StatementScales(createV31Draft())).toEqual([]);
  });
});
