import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
  type V31Rating,
  type V31Response,
} from "@/constants/weddingCodeV31";
import { createV31Draft, decodeV31, encodeV31 } from "@/lib/weddingCode/v31";
import { V31_CORE_RATING_IDS, V31_EXTRA_RATING_IDS } from "@/lib/weddingCode/v31Flow";
import {
  V31_STYLE_DIMENSIONS,
  V31_STYLE_NAME_FALLBACK,
  V31_STYLE_SUMMARY_VERSION,
  buildV31StatementScales,
  buildV31StyleSummary,
  formatV31RatingDots,
  getV31Rating,
  getV31StyleLetter,
  isV31StyleLetterBorderline,
  type V31StyleSummary,
} from "@/lib/weddingCode/v31StyleSummary";

const RATINGS = [1, 2, 3, 4, 5] as const;
const RESPONSES: readonly (V31Response | undefined)[] = [...RATINGS, "undecided", "not_applicable", "skipped", undefined];

function paired(first: V31Response | undefined, second: V31Response | undefined): V31Draft {
  return {
    ...createV31Draft(),
    answers: { B1: first, B3: second, T1: first, T2: second, F1: first, F2: second, H1: first, H2: second },
  };
}

/**
 * 2026-09-27 이전 판의 글자 규칙을 그대로 옮긴 기준. 그때는 1~5를 0·25·50·75·100으로 바꾼 뒤
 * 75 이상·25 이하로 나눴다. 점수로 바로 계산하도록 바꿔도 글자가 하나도 달라지면 안 된다.
 */
function legacyLetter(first: V31Response | undefined, second: V31Response | undefined, firstLetter: string, secondLetter: string): string {
  const percent = (value: V31Response | undefined) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? (value - 1) * 25 : null;
  const a = percent(first);
  const b = percent(second);
  if (a === null || b === null) return "?";
  if (a >= 75 && b >= 75) return "B";
  if (a >= 75) return firstLetter;
  if (b >= 75) return secondLetter;
  if (a <= 25 && b <= 25) return "N";
  return "M";
}

/** 글자 함수와 따로 만든 기준으로 한 칸 이웃을 훑는다. */
function legacyBorderline(first: V31Rating, second: V31Rating): boolean {
  const current = legacyLetter(first, second, "X", "Y");
  const moves: [number, number][] = [[first - 1, second], [first + 1, second], [first, second - 1], [first, second + 1]];
  return moves.filter(([a, b]) => a >= 1 && a <= 5 && b >= 1 && b <= 5)
    .some(([a, b]) => legacyLetter(a as V31Rating, b as V31Rating, "X", "Y") !== current);
}

function screenStrings(summary: V31StyleSummary): string[] {
  return [
    summary.name, summary.nameSource, summary.headline, summary.borderlineNotice ?? "", summary.pendingNotice ?? "",
    ...summary.dimensions.flatMap(item => [item.label, item.basis, item.englishLabel ?? ""]),
  ];
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
    for (const first of RATINGS) for (const second of RATINGS) {
      const summary = buildV31StyleSummary(paired(first, second));
      const pattern = expected[first - 1][second - 1];
      expect(summary.code).toBe(pattern === "first" ? "KTFL" : pattern === "second" ? "RDCA" : pattern.repeat(4));
      expect(summary.hasIncomplete).toBe(false);
      expect(summary.dimensions.every(item => item.ratedCount === 2 && item.pending === null)).toBe(true);
    }
  });

  it("점수로 바로 계산해도 예전 퍼센트 규칙과 모든 답 조합에서 같은 글자를 낸다", () => {
    let compared = 0;
    for (const definition of V31_STYLE_DIMENSIONS) for (const first of RESPONSES) for (const second of RESPONSES) {
      const expected = legacyLetter(first, second, definition.first.letter, definition.second.letter);
      expect(getV31StyleLetter(definition.key, first, second), `${definition.key} ${String(first)}/${String(second)}`).toBe(expected);
      const draft = createV31Draft();
      draft.answers = { [definition.first.id]: first, [definition.second.id]: second };
      expect(buildV31StyleSummary(draft).dimensions.find(item => item.key === definition.key)?.letter).toBe(expected);
      compared += 1;
    }
    expect(compared).toBe(4 * RESPONSES.length * RESPONSES.length);
  });

  it.each([
    [5, 5, "BBBB"],
    [4, 5, "BBBB"],
    [5, 4, "BBBB"],
    [3, 3, "MMMM"],
    [1, 1, "NNNN"],
    [5, 3, "KTFL"],
    [3, 5, "RDCA"],
  ] as const)("%i와 %i는 %s이며 두 문장의 칸을 따로 남긴다", (first, second, code) => {
    const summary = buildV31StyleSummary(paired(first, second));
    expect(summary.code).toBe(code);
    for (const item of summary.dimensions) expect(item.items.map(evidence => evidence.rating)).toEqual([first, second]);
  });

  it("모름·건너뜀·안 본 문장은 다시 볼 자리로, 이번 계획에 없다는 답은 끝난 답으로 알린다", () => {
    const cases = [
      { value: "undecided", label: "아직 모르겠어요", pending: "open" },
      { value: "not_applicable", label: "이번 계획에는 없어요", pending: "not_in_plan" },
      { value: "skipped", label: "지금 답하지 않을게요", pending: "open" },
      { value: undefined, label: "아직 보지 않은 문장이에요", pending: "open" },
    ] as const;
    for (const { value, label, pending } of cases) for (const position of [0, 1]) {
      const draft = paired(5, 5);
      const id = position === 0 ? "B1" : "B3";
      if (value === undefined) delete draft.answers[id];
      else draft.answers[id] = value;
      const summary = buildV31StyleSummary(draft);
      const budget = summary.dimensions[0];
      expect(summary.code).toBe("?BBB");
      expect(summary.hasIncomplete).toBe(true);
      expect(budget.pending).toBe(pending);
      expect(budget.ratedCount).toBe(1);
      expect(budget.borderline).toBe(false);
      expect(budget.items[position]).toMatchObject({ response: value, responseLabel: label, rating: null });
      expect(budget.items[position === 0 ? 1 : 0].rating).toBe(5);
      if (pending === "not_in_plan") {
        expect(budget.label).toBe("한 문장은 이번 계획에 없어요");
        expect(summary.pendingNotice).toBe("‘예산’ 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.");
        expect(summary.pendingNotice).not.toContain("다시 볼 수 있어요");
      } else {
        expect(budget.label).toBe("아직 글자를 붙이지 않았어요");
        expect(budget.basis).toContain("두 문장 모두 동의하는 정도를 고르면 글자가 생겨요.");
        expect(summary.pendingNotice).toBe("‘예산’ 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 아래에서 그 답을 다시 볼 수 있어요.");
      }
    }
    const undecided = paired(5, 5); undecided.answers.B1 = "undecided";
    expect(buildV31StyleSummary(undecided).dimensions[0].basis).toBe("‘아직 모르겠어요’로 남긴 문장이 있어요. 두 문장 모두 동의하는 정도를 고르면 글자가 생겨요.");
    const skipped = paired(5, 5); skipped.answers.B3 = "skipped";
    expect(buildV31StyleSummary(skipped).dimensions[0].basis).toBe("‘지금 답하지 않을게요’로 남긴 문장이 있어요. 두 문장 모두 동의하는 정도를 고르면 글자가 생겨요.");
    const both = paired("not_applicable", "not_applicable");
    expect(buildV31StyleSummary(both).dimensions.every(item => item.label === "이번 계획에 없어요" && item.pending === "not_in_plan")).toBe(true);
    const stillPlanned = paired("not_applicable", "undecided");
    expect(buildV31StyleSummary(stillPlanned).dimensions[0].pending).toBe("not_in_plan");
    const mixed = paired(5, 5);
    mixed.answers.B1 = "not_applicable";
    mixed.answers.F1 = "skipped";
    mixed.answers.H2 = "undecided";
    const mixedSummary = buildV31StyleSummary(mixed);
    expect(mixedSummary.code).toBe("?B??");
    expect(mixedSummary.pendingNotice).toBe("‘가족과 상의’, ‘받고 싶은 도움’ 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 아래에서 그 답을 다시 볼 수 있어요. ‘예산’ 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.");
    expect(buildV31StyleSummary(paired(5, 1)).pendingNotice).toBeNull();

    const empty = buildV31StyleSummary(createV31Draft());
    expect(empty.code).toBe("????");
    expect(empty.dimensions.every(item => item.ratedCount === 0 && item.pending === "open")).toBe(true);
    expect(empty.name).toBe(V31_STYLE_NAME_FALLBACK.name);
    expect(empty.headline).toBe(V31_STYLE_NAME_FALLBACK.headline);
    expect(empty.nameFrom).toBeNull();
    expect(empty.borderlineNotice).toBeNull();
  });

  it("중간·낮은 답만 있는 경우 긍정적 이름이나 반대 취향을 만들지 않는다", () => {
    for (const [first, second] of [[1, 2], [2, 3], [3, 3]] as const) {
      const summary = buildV31StyleSummary(paired(first, second));
      expect(summary.name).toBe(V31_STYLE_NAME_FALLBACK.name);
      expect(summary.headline).toBe(V31_STYLE_NAME_FALLBACK.headline);
      expect(summary.nameFrom).toBeNull();
      expect(summary.dimensions.every(item => item.letter === "N" || item.letter === "M")).toBe(true);
      const copy = summary.dimensions.flatMap(item => [item.label, item.basis]).join(" ");
      expect(copy).not.toMatch(/독립적인|유연한|가족을 배제|혼자 결정|즉흥적인|균형형|궁합|정확도/);
      expect(copy).not.toMatch(/반대|싫어|원하지 않/);
    }
    expect(buildV31StyleSummary(paired(3, 3)).dimensions[0].basis).toBe("‘그런 편’ 이상인 답은 없고, ‘어느 쪽도 아니에요’로 답한 문장이 있어요.");
    expect(buildV31StyleSummary(paired(1, 1)).dimensions[0].basis).toBe("둘 다 ‘그렇지 않은 편’ 이하로 답했어요.");
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

  it("이름은 어느 주제의 답에서 따왔는지 함께 알려주고, 그 주제가 실제로 이름을 낸 주제다", () => {
    const teamwork = buildV31StyleSummary(paired(5, 1));
    expect(teamwork.nameFrom).toBe("teamwork");
    expect(teamwork.nameSource).toBe("이름은 ‘일 나누기’ 답에서 따왔어요");
    const cases = [
      [{ B1: 2, B3: 5 }, "budget", "이름은 ‘예산’ 답에서 따왔어요", "예산을 다시 의논하는 스타일"],
      [{ T1: 3, T2: 3, B1: 5, B3: 1, F1: 5, F2: 5 }, "budget", "이름은 ‘예산’ 답에서 따왔어요", "예산을 지키는 스타일"],
      [{ T1: 1, T2: 2, B1: "undecided", B3: 5, F1: 5, F2: 5 }, "family", "이름은 ‘가족과 상의’ 답에서 따왔어요", "가족에게 듣고, 선택은 둘이 하는 스타일"],
      [{ T1: 5, B1: 3, B3: 3, F1: "not_applicable", F2: 5, H1: 4, H2: 2 }, "support", "이름은 ‘받고 싶은 도움’ 답에서 따왔어요", "이야기를 먼저 들어주길 바라는 스타일"],
    ] as const;
    for (const [answers, key, source, name] of cases) {
      const draft = createV31Draft();
      draft.answers = { ...answers };
      const summary = buildV31StyleSummary(draft);
      expect(summary.nameFrom).toBe(key);
      expect(summary.nameSource).toBe(source);
      expect(summary.name).toBe(name);
      const origin = summary.dimensions.find(item => item.key === key)!;
      expect(["M", "N", "?"]).not.toContain(origin.letter);
      expect(summary.nameSource).toContain(origin.topicName);
    }
    for (const first of RESPONSES) for (const second of RESPONSES) {
      const summary = buildV31StyleSummary(paired(first, second));
      if (summary.nameFrom === null) {
        expect(summary.nameSource).toBe(V31_STYLE_NAME_FALLBACK.nameSource);
        expect(summary.dimensions.every(item => ["M", "N", "?"].includes(item.letter))).toBe(true);
      } else {
        const origin = summary.dimensions.find(item => item.key === summary.nameFrom)!;
        expect(["M", "N", "?"]).not.toContain(origin.letter);
        expect(summary.nameSource).toBe(`이름은 ‘${origin.topicName}’ 답에서 따왔어요`);
      }
    }
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

describe("v3.1 아슬한 글자", () => {
  it("25조합 중 답 하나를 한 칸 옮겨도 그대로인 6조합만 아슬하지 않다", () => {
    const stable = new Set(["1,1", "1,5", "2,5", "5,1", "5,2", "5,5"]);
    for (const definition of V31_STYLE_DIMENSIONS) {
      let count = 0;
      for (const first of RATINGS) for (const second of RATINGS) {
        const borderline = isV31StyleLetterBorderline(definition.key, first, second);
        expect(borderline, `${definition.key} ${first}/${second}`).toBe(!stable.has(`${first},${second}`));
        expect(borderline, `${definition.key} ${first}/${second} 기준`).toBe(legacyBorderline(first, second));
        if (borderline) count += 1;
      }
      expect(count).toBe(19);
    }
  });

  it("아슬하다고 한 글자는 실제로 한 칸 이웃에서 글자가 바뀌고, 아니라고 한 글자는 어느 이웃에서도 그대로다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) for (const first of RATINGS) for (const second of RATINGS) {
      const current = getV31StyleLetter(definition.key, first, second);
      const neighbors = [[first - 1, second], [first + 1, second], [first, second - 1], [first, second + 1]]
        .filter(([a, b]) => a >= 1 && a <= 5 && b >= 1 && b <= 5)
        .map(([a, b]) => getV31StyleLetter(definition.key, a as V31Rating, b as V31Rating));
      expect(isV31StyleLetterBorderline(definition.key, first, second)).toBe(neighbors.some(letter => letter !== current));
    }
  });

  it("모름·계획 없음·건너뜀·안 본 문장이 있는 ‘?’ 자리는 아슬한 글자로 세지 않는다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) for (const first of RESPONSES) for (const second of RESPONSES) {
      if (getV31Rating(first) !== null && getV31Rating(second) !== null) continue;
      expect(isV31StyleLetterBorderline(definition.key, first, second)).toBe(false);
    }
  });

  it("코드보다 먼저 보여줄 한 줄에 아슬한 글자 수를 사실대로 적는다", () => {
    const steady = buildV31StyleSummary(paired(5, 5));
    expect(steady.borderlineCount).toBe(0);
    expect(steady.borderlineNotice).toBe("지금 글자는 어느 답을 한 칸 옮겨도 그대로예요.");
    const shaky = buildV31StyleSummary(paired(4, 4));
    expect(shaky.borderlineCount).toBe(4);
    expect(shaky.borderlineNotice).toBe("네 글자 모두 답 하나만 한 칸 달라져도 바뀌어요. 다시 답하면 달라질 수 있어요.");
    const mixed = createV31Draft();
    mixed.answers = { B1: 5, B3: 5, T1: 4, T2: 4, F1: 5, F2: 1, H1: 3, H2: 3 };
    const mixedSummary = buildV31StyleSummary(mixed);
    expect(mixedSummary.code).toBe("BBFM");
    expect(mixedSummary.dimensions.map(item => item.borderline)).toEqual([false, true, false, true]);
    expect(mixedSummary.borderlineCount).toBe(2);
    expect(mixedSummary.borderlineNotice).toBe("네 글자 중 밑줄 친 2개는 답 하나만 한 칸 달라져도 바뀌어요. 다시 답하면 달라질 수 있어요.");
    const partial = paired(5, 5);
    partial.answers.B1 = "undecided";
    expect(buildV31StyleSummary(partial).borderlineNotice).toBe("지금 글자는 어느 답을 한 칸 옮겨도 그대로예요.");
    for (const first of RESPONSES) for (const second of RESPONSES) {
      const summary = buildV31StyleSummary(paired(first, second));
      expect(summary.borderlineCount).toBe(summary.dimensions.filter(item => item.borderline).length);
    }
  });
});

describe("v3.1 요약 화면 문장", () => {
  const beginnerBanned = /스드메|예식장|본식|폐백|상견례|전통 인사|원판|헬퍼비|피팅|컨펌|워크인|혼주|부토니에|얼리스타트|양가|업체나 장소|이거|그거|저거|넘겼다/;
  const drafts = [
    ...RESPONSES.flatMap(first => RESPONSES.map(second => paired(first, second))),
    (() => { const draft = paired(5, 5); draft.answers.B1 = "not_applicable"; draft.answers.F1 = "skipped"; draft.answers.H2 = "undecided"; return draft; })(),
    (() => { const draft = createV31Draft(); draft.answers = { B1: 5, B3: 5, T1: 4, T2: 4, F1: 5, F2: 1, H1: 3, H2: 3 }; return draft; })(),
  ];

  it("퍼센트·줄표·시스템 말투·판정 언어·영문 뒤 조사·초보자 금지어를 쓰지 않는다", () => {
    for (const draft of drafts) {
      const summary = buildV31StyleSummary(draft);
      for (const text of screenStrings(summary)) {
        expect(text, text).not.toMatch(/%|[—–]/);
        expect(text, text).not.toMatch(/선택값|요약 보류|\d+\/\d+개|Both|Middle|Neither|Unassigned|확인해 주세요/);
        expect(text, text).not.toMatch(/유형|궁합|점수|등급|성격|당신은|예측|잘 맞/);
        expect(text, text).not.toMatch(/[A-Za-z][가-힣]/);
        expect(text, text).not.toMatch(beginnerBanned);
      }
      for (const item of summary.dimensions) {
        const positive = V31_STYLE_DIMENSIONS.find(definition => definition.key === item.key)!;
        expect(item.englishLabel).toBe(item.letter === positive.first.letter ? positive.first.englishLabel : item.letter === positive.second.letter ? positive.second.englishLabel : null);
      }
    }
  });
});

describe("v3.1 문장별 표시 척도", () => {
  it("다섯 응답만 1~5 칸으로 옮기고 다른 상태와 잘못된 값은 칸으로 바꾸지 않는다", () => {
    expect(RATINGS.map(getV31Rating)).toEqual([1, 2, 3, 4, 5]);
    for (const value of ["undecided", "not_applicable", "skipped", undefined] as const) expect(getV31Rating(value)).toBeNull();
    for (const value of [0, 6, 2.5]) expect(getV31Rating(value as V31Response)).toBeNull();
    expect(RATINGS.map(formatV31RatingDots)).toEqual(["●○○○○", "●●○○○", "●●●○○", "●●●●○", "●●●●●"]);
  });

  it("실제로 답한 문장만 정본 순서·원문·응답명으로 묶고 직접 선택은 칸으로 바꾸지 않는다", () => {
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
    expect(items.map(item => item.rating)).toEqual([1, null, null, 5, null]);
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
