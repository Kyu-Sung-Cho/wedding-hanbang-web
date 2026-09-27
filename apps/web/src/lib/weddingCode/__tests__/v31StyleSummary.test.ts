import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V31_OPTIONS,
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
  type V31Rating,
  type V31Response,
} from "@/constants/weddingCodeV31";
import { createV31Draft, decodeV31, encodeV31 } from "@/lib/weddingCode/v31";
import { V31_CORE_RATING_IDS, V31_EXTRA_RATING_IDS } from "@/lib/weddingCode/v31Flow";
import * as summaryModule from "@/lib/weddingCode/v31StyleSummary";
import {
  V31_STYLE_CHANGE_NOTICE,
  V31_STYLE_DIMENSIONS,
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

/**
 * 2026-09-27 파운더 결정 이전의 아슬 기준(두 답 중 하나를 ±1 옮겨 글자가 바뀌면 아슬). 새 기준과 견주는 데만 쓴다.
 * 글자 함수와 따로 만든 기준으로 한 칸 이웃을 훑는다.
 */
function legacyBorderline(first: V31Rating, second: V31Rating): boolean {
  const current = legacyLetter(first, second, "X", "Y");
  const moves: [number, number][] = [[first - 1, second], [first + 1, second], [first, second - 1], [first, second + 1]];
  return moves.filter(([a, b]) => a >= 1 && a <= 5 && b >= 1 && b <= 5)
    .some(([a, b]) => legacyLetter(a as V31Rating, b as V31Rating, "X", "Y") !== current);
}

function screenStrings(summary: V31StyleSummary): string[] {
  return [
    summary.borderlineNotice ?? "", summary.changeNotice ?? "", summary.pendingNotice ?? "",
    ...summary.dimensions.flatMap(item => [item.label, item.basis ?? "", item.englishLabel ?? ""]),
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
      // 2026-09-27: ‘?’ 자리는 라벨 한 줄만 두고 근거 줄을 비운다. 답 줄이 고른 답을 이미 보여준다.
      expect(budget.basis).toBeNull();
      if (pending === "not_in_plan") {
        expect(budget.label).toBe("한 문장이 이번 계획에 없어서 ‘?’를 뒀어요");
        // 한 문장만 계획에 없다고 답했으면 주제 전체를 계획에 없다고 답했다고 적지 않는다.
        expect(summary.pendingNotice).toBe("‘예산’ 주제는 한 문장에 ‘이번 계획에는 없어요’로 답해서 ‘?’로 적었어요.");
        expect(summary.pendingNotice).not.toContain("이번 계획에 없다고 답해서");
        expect(summary.pendingNotice).not.toContain("글자가 생겨요");
      } else {
        expect(budget.label).toBe("아직 글자가 없어요");
        expect(summary.pendingNotice).toBe("‘예산’ 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 그 문장에 동의하는 정도를 고르면 글자가 생겨요.");
      }
    }
    const both = paired("not_applicable", "not_applicable");
    expect(buildV31StyleSummary(both).dimensions.every(item => item.label === "이번 계획에 없어서 글자 대신 ‘?’를 뒀어요" && item.pending === "not_in_plan" && item.basis === null)).toBe(true);
    expect(buildV31StyleSummary(both).pendingNotice).toBe("‘예산’, ‘일 나누기’, ‘가족과 상의’, ‘받고 싶은 도움’ 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.");
    const stillPlanned = paired("not_applicable", "undecided");
    expect(buildV31StyleSummary(stillPlanned).dimensions[0].pending).toBe("not_in_plan");
    const mixed = paired(5, 5);
    mixed.answers.B1 = "not_applicable";
    mixed.answers.F1 = "skipped";
    mixed.answers.H2 = "undecided";
    const mixedSummary = buildV31StyleSummary(mixed);
    expect(mixedSummary.code).toBe("?B??");
    expect(mixedSummary.pendingNotice).toBe("‘가족과 상의’, ‘받고 싶은 도움’ 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 그 문장에 동의하는 정도를 고르면 글자가 생겨요. ‘예산’ 주제는 한 문장에 ‘이번 계획에는 없어요’로 답해서 ‘?’로 적었어요.");
    expect(buildV31StyleSummary(paired(5, 1)).pendingNotice).toBeNull();

    const empty = buildV31StyleSummary(createV31Draft());
    expect(empty.code).toBe("????");
    expect(empty.dimensions.every(item => item.ratedCount === 0 && item.pending === "open")).toBe(true);
    expect(empty.borderlineNotice).toBeNull();
    expect(empty.changeNotice).toBeNull();
  });

  it("중간·낮은 답만 있는 경우 긍정적 뜻이나 반대 취향을 만들지 않는다", () => {
    for (const [first, second] of [[1, 2], [2, 3], [3, 3]] as const) {
      const summary = buildV31StyleSummary(paired(first, second));
      expect(summary.dimensions.every(item => item.letter === "N" || item.letter === "M")).toBe(true);
      const copy = summary.dimensions.flatMap(item => [item.label, item.basis ?? ""]).join(" ");
      expect(copy).not.toMatch(/독립적인|유연한|가족을 배제|혼자 결정|즉흥적인|균형형|궁합|정확도/);
      expect(copy).not.toMatch(/반대|싫어|원하지 않/);
    }
    // 2026-09-27: M·N 자리는 라벨 한 줄만 둔다. 근거 줄이 라벨과 답 줄을 되풀이했다.
    expect(buildV31StyleSummary(paired(3, 3)).dimensions[0]).toMatchObject({ label: "중간으로 답한 문장이 있어요", basis: null });
    expect(buildV31StyleSummary(paired(1, 1)).dimensions[0]).toMatchObject({ label: "두 문장 모두 낮게 답했어요", basis: null });
  });

  it("글자 뜻 줄은 실제 긍정한 문장만 쓰고 계약·추가 결제·경청 순서를 보존한다", () => {
    const first = buildV31StyleSummary(paired(5, 1));
    expect(first.dimensions.map(item => item.label)).toEqual(V31_STYLE_DIMENSIONS.map(item => item.first.label));
    const second = buildV31StyleSummary(paired(1, 5));
    expect(second.dimensions[1].label).toBe("계약·추가 결제 없는 세부 선택 맡기기");
    const together = buildV31StyleSummary(paired(5, 5));
    expect(together.dimensions[1].label).toBe("함께 찾고, 계약·추가 결제 없는 세부 선택은 맡겨도 괜찮아요");
    expect(together.dimensions[1].basis).not.toContain("두 바람");
    expect(together.dimensions[2].label).toBe("가족의 바람은 초반에 듣고, 마지막 선택은 둘이 하고 싶어요");
    expect(together.dimensions[3].label).toBe("이야기를 먼저 들어주고, 몰린 일 일부도 맡아주길 바라요");
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

/**
 * 2026-09-27 파운더 결정(「아슬한 글자 기준도 바꿔줘」)의 판정표. 행은 첫 문장 답(1~5), 열은 둘째 문장 답(1~5).
 * 아슬한 칸은 한 문장만 ‘그런 편’ 이상인 한쪽 글자가 정확히 한 칸 차이로 정해진 (4,3)·(3,4) 두 칸뿐이다.
 * 표를 손으로 적어 둔다. 함수를 다시 돌려 만든 기대값은 함수가 틀리면 같이 틀린다.
 */
const BORDERLINE_TABLE = [
  // 둘째: 1  2  3  4  5
  /* 1 */ [0, 0, 0, 0, 0],
  /* 2 */ [0, 0, 0, 0, 0],
  /* 3 */ [0, 0, 0, 1, 0],
  /* 4 */ [0, 0, 1, 0, 0],
  /* 5 */ [0, 0, 0, 0, 0],
];

describe("v3.1 아슬한 글자 (한쪽 글자의 한 칸 차이)", () => {
  it("25조합 판정표: 네 주제 모두 아슬한 칸은 4 대 3 과 3 대 4 두 칸뿐이다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) {
      const table = RATINGS.map(first => RATINGS.map(second => isV31StyleLetterBorderline(definition.key, first, second) ? 1 : 0));
      expect(table, definition.key).toEqual(BORDERLINE_TABLE);
      expect(table.flat().filter(Boolean)).toHaveLength(2);
      // 안내가 말하는 사실(한 답은 정확히 ‘그런 편이에요’, 다른 답은 정확히 ‘어느 쪽도 아니에요’)과 판정이 같다.
      for (const first of RATINGS) for (const second of RATINGS) {
        const labels = [first, second].map(value => WEDDING_CODE_V31_OPTIONS.find(option => option.value === value)!.label).sort();
        const fact = labels.join("|") === ["그런 편이에요", "어느 쪽도 아니에요"].sort().join("|");
        expect(isV31StyleLetterBorderline(definition.key, first, second), `${definition.key} ${first}/${second}`).toBe(fact);
      }
      // 두 칸은 각각 첫 문장·둘째 문장 쪽 한쪽 글자다.
      expect(getV31StyleLetter(definition.key, 4, 3)).toBe(definition.first.letter);
      expect(getV31StyleLetter(definition.key, 3, 4)).toBe(definition.second.letter);
    }
  });

  it("B·M·N·‘?’는 아슬하지 않고, 한쪽 글자도 두 칸 이상 차이면 아슬하지 않다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) {
      // 4 대 4 는 B, 5 대 4 도 B, 3 대 3·2 대 3 은 M, 2 대 2 는 N. 예전 기준에서는 모두 아슬했다.
      for (const [first, second] of [[4, 4], [5, 4], [4, 5], [3, 3], [2, 3], [3, 2], [2, 2], [1, 2]] as const) {
        expect(["B", "M", "N"]).toContain(getV31StyleLetter(definition.key, first, second));
        expect(isV31StyleLetterBorderline(definition.key, first, second), `${definition.key} ${first}/${second}`).toBe(false);
        expect(legacyBorderline(first, second), `${first}/${second} 예전 기준`).toBe(true);
      }
      // 한쪽 글자지만 두 칸 이상 차이.
      for (const [first, second] of [[4, 2], [2, 4], [5, 3], [3, 5], [4, 1], [5, 1]] as const) {
        expect([definition.first.letter, definition.second.letter]).toContain(getV31StyleLetter(definition.key, first, second));
        expect(isV31StyleLetterBorderline(definition.key, first, second), `${definition.key} ${first}/${second}`).toBe(false);
      }
    }
  });

  it("모든 답 조합에서 ‘한쪽 글자이고 두 답이 정확히 한 칸 차이’일 때만 아슬하다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) for (const first of RESPONSES) for (const second of RESPONSES) {
      const letter = getV31StyleLetter(definition.key, first, second);
      const a = getV31Rating(first);
      const b = getV31Rating(second);
      const oneSided = letter === definition.first.letter || letter === definition.second.letter;
      const expected = oneSided && a !== null && b !== null && Math.abs(a - b) === 1;
      expect(isV31StyleLetterBorderline(definition.key, first, second), `${definition.key} ${String(first)}/${String(second)}`).toBe(expected);
      if (letter === "B" || letter === "M" || letter === "N" || letter === "?") expect(isV31StyleLetterBorderline(definition.key, first, second)).toBe(false);
    }
  });

  it("새 기준의 아슬한 칸은 예전 ±1 기준(19칸)의 일부이고, 실제로 한 칸 이웃에서 글자가 바뀐다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) {
      let now = 0;
      let before = 0;
      for (const first of RATINGS) for (const second of RATINGS) {
        const borderline = isV31StyleLetterBorderline(definition.key, first, second);
        if (legacyBorderline(first, second)) before += 1;
        if (!borderline) continue;
        now += 1;
        expect(legacyBorderline(first, second), `${definition.key} ${first}/${second}`).toBe(true);
        const current = getV31StyleLetter(definition.key, first, second);
        const neighbors = [[first - 1, second], [first + 1, second], [first, second - 1], [first, second + 1]]
          .map(([a, b]) => getV31StyleLetter(definition.key, a as V31Rating, b as V31Rating));
        expect(neighbors.some(letter => letter !== current)).toBe(true);
      }
      expect([now, before]).toEqual([2, 19]);
    }
  });

  it("모름·계획 없음·건너뜀·안 본 문장이 있는 ‘?’ 자리는 아슬한 글자로 세지 않는다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) for (const first of RESPONSES) for (const second of RESPONSES) {
      if (getV31Rating(first) !== null && getV31Rating(second) !== null) continue;
      expect(isV31StyleLetterBorderline(definition.key, first, second)).toBe(false);
    }
  });

  it("코드보다 먼저 보여줄 한 줄은 한 칸 차이로 갈린 글자의 주제를 적고, 다시 답하면 달라질 수 있다는 말은 따로 한 줄이다", () => {
    expect(V31_STYLE_CHANGE_NOTICE).toBe("다시 답하면 글자가 달라질 수 있어요.");
    const steady = buildV31StyleSummary(paired(5, 5));
    expect(steady.borderlineCount).toBe(0);
    expect(steady.borderlineNotice).toBeNull();
    // 아슬한 글자가 없어도 다시 답하면 코드가 바뀔 수 있다는 말은 남긴다(PRINCIPLES.md 5절).
    expect(steady.changeNotice).toBe(V31_STYLE_CHANGE_NOTICE);
    // 4 대 4 는 B 라 아슬하지 않다. 그래도 4를 한 칸 내리면 글자가 바뀌므로 「한 칸 옮겨도 그대로」라고 쓰면 거짓이다.
    const both = buildV31StyleSummary(paired(4, 4));
    expect(both.code).toBe("BBBB");
    expect(both.borderlineCount).toBe(0);
    expect(both.borderlineNotice).toBeNull();
    expect(both.changeNotice).toBe(V31_STYLE_CHANGE_NOTICE);
    expect(getV31StyleLetter("budget", 3, 4)).not.toBe("B");
    const shaky = buildV31StyleSummary(paired(4, 3));
    expect(shaky.code).toBe("KTFL");
    expect(shaky.borderlineCount).toBe(4);
    expect(shaky.borderlineNotice).toBe("네 글자 모두 두 문장의 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 한 칸 차이예요.");
    const mixed = createV31Draft();
    mixed.answers = { B1: 5, B3: 5, T1: 4, T2: 3, F1: 3, F2: 4, H1: 3, H2: 3 };
    const mixedSummary = buildV31StyleSummary(mixed);
    expect(mixedSummary.code).toBe("BTCM");
    expect(mixedSummary.dimensions.map(item => item.borderline)).toEqual([false, true, true, false]);
    expect(mixedSummary.borderlineCount).toBe(2);
    // 어느 글자인지 주제 이름으로 적는다. 밑줄처럼 눈으로만 보이는 표시를 가리키지 않는다.
    expect(mixedSummary.borderlineNotice).toBe("‘일 나누기’, ‘가족과 상의’ 글자는 두 문장의 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 한 칸 차이예요.");
    expect(mixedSummary.changeNotice).toBe(V31_STYLE_CHANGE_NOTICE);
    const partial = paired(5, 5);
    partial.answers.B1 = "undecided";
    expect(buildV31StyleSummary(partial).borderlineNotice).toBeNull();
    expect(buildV31StyleSummary(partial).changeNotice).toBe(V31_STYLE_CHANGE_NOTICE);
    // 글자가 하나도 정해지지 않았으면 ‘?’ 안내가 글자가 생기는 길을 말하므로 두 줄 모두 없다.
    for (const empty of [createV31Draft(), paired("not_applicable", "not_applicable"), paired("undecided", 5)]) {
      expect(buildV31StyleSummary(empty).borderlineNotice).toBeNull();
      expect(buildV31StyleSummary(empty).changeNotice).toBeNull();
    }
    for (const first of RESPONSES) for (const second of RESPONSES) {
      const summary = buildV31StyleSummary(paired(first, second));
      expect(summary.borderlineCount).toBe(summary.dimensions.filter(item => item.borderline).length);
      // 예전 기준의 문장은 새 기준에서 거짓이라 어느 답에서도 나오지 않는다.
      for (const text of screenStrings(summary)) expect(text, text).not.toMatch(/한 칸 옮겨도 그대로|한 칸 달라져도 바뀌어요|다른 글자도 다시 답하면/);
    }
  });
});

/** 2026-09-27 파운더 결정 「스타일 이름은 빼고」. 코드 옆에는 코드와 주제별 줄(글자, 글자 뜻 한 줄, 두 문장의 실제 답)만 있다. */
describe("v3.1 네 글자 요약에 이름이 없다", () => {
  const SUMMARY_KEYS = ["borderlineCount", "borderlineNotice", "changeNotice", "code", "dimensions", "hasIncomplete", "pendingNotice", "version"];
  const DIMENSION_KEYS = ["basis", "englishLabel", "items", "key", "label", "letter", "letterFrom", "borderline", "pending", "ratedCount", "title", "topicName"].sort();
  const NAME_WORDS = /스타일|이름은|이름을 붙이|이름도 바뀌|따왔어요|따와서|따와요/;

  it("요약 데이터에 이름·이름 출처·헤드라인 칸이 없고, 어떤 문장에도 이름 말이 없다", () => {
    const drafts = [...RESPONSES.flatMap(first => RESPONSES.map(second => paired(first, second))), ...sampledDrafts(500)];
    for (const draft of drafts) {
      const summary = buildV31StyleSummary(draft);
      expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS);
      for (const item of summary.dimensions) expect(Object.keys(item).sort()).toEqual(DIMENSION_KEYS);
      expect(JSON.stringify(summary), summary.code).not.toMatch(NAME_WORDS);
    }
  });

  it("모듈이 이름·헤드라인 목록을 내보내지 않는다", () => {
    expect(Object.keys(summaryModule)).not.toContain("V31_STYLE_NAME_FALLBACK");
    for (const [key, value] of Object.entries(summaryModule)) {
      if (typeof value === "function") continue;
      expect(JSON.stringify(value), key).not.toMatch(NAME_WORDS);
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

/**
 * 2026-09-27 v3.1 결과 검토에서 고친 요약 문장들.
 * 결정적인 의사 난수로 답을 넓게 만들어(칸 답과 모름·계획 없음·건너뜀·안 본 문장을 섞어) 문장이 실제 글자와 맞는지 본다.
 */
function sampledDrafts(count: number): V31Draft[] {
  let seed = 20260927;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = () => RESPONSES[Math.floor(next() * RESPONSES.length)];
  return Array.from({ length: count }, () => {
    const draft = createV31Draft();
    for (const definition of V31_STYLE_DIMENSIONS) {
      const first = pick(); const second = pick();
      if (first !== undefined) draft.answers[definition.first.id] = first;
      if (second !== undefined) draft.answers[definition.second.id] = second;
    }
    return draft;
  });
}
const quoted = (summary: V31StyleSummary, keys: readonly string[]) =>
  summary.dimensions.filter(item => keys.includes(item.key)).map(item => `‘${item.topicName}’`).join(", ");

/** 네 주제 중 고른 주제만 4 대 3(아슬), 나머지는 5 대 5(B)인 답. 아슬한 글자 수 0~4를 모두 만든다. */
function borderlineSubsets(): V31Draft[] {
  return Array.from({ length: 16 }, (_, mask) => {
    const draft = createV31Draft();
    V31_STYLE_DIMENSIONS.forEach((definition, index) => {
      const shaky = (mask >> index) & 1;
      draft.answers[definition.first.id] = shaky ? 4 : 5;
      draft.answers[definition.second.id] = shaky ? 3 : 5;
    });
    return draft;
  });
}

describe("v3.1 요약 문장이 실제 글자와 맞는다 (2026-09-27)", () => {
  it("아슬한 글자 안내는 한 칸 차이로 갈린 글자의 주제 이름만 적고, 다시 답하면 달라질 수 있다는 말은 정해진 글자가 있으면 늘 붙는다", () => {
    const seen = new Set<number>();
    for (const draft of [...sampledDrafts(3000), ...RATINGS.flatMap(a => RATINGS.map(b => paired(a, b))), ...borderlineSubsets()]) {
      const summary = buildV31StyleSummary(draft);
      const borderline = summary.dimensions.filter(item => item.borderline);
      seen.add(borderline.length);
      // 아슬한 글자는 한쪽 글자이고 두 답이 정확히 한 칸 차이다.
      for (const item of borderline) {
        const definition = V31_STYLE_DIMENSIONS.find(entry => entry.key === item.key)!;
        expect([definition.first.letter, definition.second.letter], summary.code).toContain(item.letter);
        expect(Math.abs(item.items[0].rating! - item.items[1].rating!), summary.code).toBe(1);
      }
      expect(summary.changeNotice, summary.code).toBe(summary.dimensions.some(item => item.letter !== "?") ? V31_STYLE_CHANGE_NOTICE : null);
      const notice = summary.borderlineNotice;
      if (!borderline.length) { expect(notice, summary.code).toBeNull(); continue; }
      expect(notice, summary.code).not.toMatch(/밑줄|\d|다시 답하면/);
      // 실제로 고른 두 보기 이름을 ‘’ 안에 인용한다. 인용 밖에는 판정 고지처럼 읽히는 「아니에요」가 없다.
      for (const value of [4, 3]) expect(notice, summary.code).toContain(`‘${WEDDING_CODE_V31_OPTIONS.find(option => option.value === value)!.label}’`);
      expect(notice!.replace(/‘[^’]*’/g, ""), summary.code).not.toMatch(/아니에요|아니라/);
      if (borderline.length === 4) expect(notice).toBe("네 글자 모두 두 문장의 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 한 칸 차이예요.");
      else {
        expect(notice, summary.code).toBe(`${quoted(summary, borderline.map(item => item.key))} 글자는 두 문장의 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 한 칸 차이예요.`);
        // 안내에 적힌 주제는 아슬한 글자뿐이다.
        for (const item of summary.dimensions) expect(notice!.includes(`‘${item.topicName}’`), `${summary.code} ${item.key}`).toBe(item.borderline);
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("한 문장만 계획에 없는 주제와 두 문장 모두 계획에 없는 주제를 나눠 적고, 계획 없음 쪽은 다시 답하라고 하지 않는다", () => {
    const both = createV31Draft();
    both.answers = { B1: 5, B3: 5, T1: 5, T2: 5, F1: "not_applicable", F2: "not_applicable", H1: 5, H2: 5 };
    expect(buildV31StyleSummary(both).pendingNotice).toBe("‘가족과 상의’ 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.");
    const oneRated = createV31Draft();
    oneRated.answers = { B1: "not_applicable", B3: 5, T1: 5, T2: 5, F1: 5, F2: 5, H1: 5, H2: 5 };
    expect(buildV31StyleSummary(oneRated).pendingNotice).toBe("‘예산’ 주제는 한 문장에 ‘이번 계획에는 없어요’로 답해서 ‘?’로 적었어요.");
    const oneUndecided = createV31Draft();
    oneUndecided.answers = { B1: "not_applicable", B3: "undecided", T1: 5, T2: 5, F1: 5, F2: 5, H1: 5, H2: 5 };
    const undecidedSummary = buildV31StyleSummary(oneUndecided);
    expect(undecidedSummary.dimensions[0].pending).toBe("not_in_plan");
    // 남은 문장을 다시 답해도 계획 없음 때문에 글자가 생기지 않으므로 글자가 생긴다고 말하지 않는다.
    expect(undecidedSummary.pendingNotice).toBe("‘예산’ 주제는 한 문장에 ‘이번 계획에는 없어요’로 답해서 ‘?’로 적었어요.");
    const mixed = createV31Draft();
    mixed.answers = { B1: "not_applicable", B3: 4, T1: 5, T2: 5, F1: "not_applicable", F2: "not_applicable", H1: "skipped", H2: 5 };
    expect(buildV31StyleSummary(mixed).pendingNotice).toBe("‘받고 싶은 도움’ 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 그 문장에 동의하는 정도를 고르면 글자가 생겨요. ‘가족과 상의’ 주제는 이번 계획에 없다고 답했고, ‘예산’ 주제는 한 문장에 ‘이번 계획에는 없어요’로 답해서 ‘?’로 적었어요.");
    for (const draft of sampledDrafts(2000)) {
      const summary = buildV31StyleSummary(draft);
      for (const item of summary.dimensions.filter(entry => entry.pending === "not_in_plan")) {
        const allNa = item.items.every(entry => entry.response === "not_applicable");
        // 주제 전체가 계획에 없다는 문장에는 두 문장 모두 계획에 없다고 답한 주제만 들어간다.
        const wholeTopic = summary.pendingNotice!.match(/(‘[^.]*?) 주제는 이번 계획에 없다고 답/)?.[1] ?? "";
        expect(wholeTopic.includes(`‘${item.topicName}’`), `${summary.code} ${item.key}`).toBe(allNa);
      }
    }
  });

  it("한 문장에서 나온 글자는 그 문장을 출처로 들고, 두 문장이나 ‘?’·M·N 자리는 출처 문장이 없다", () => {
    for (const definition of V31_STYLE_DIMENSIONS) for (const first of RESPONSES) for (const second of RESPONSES) {
      const draft = createV31Draft();
      draft.answers = { [definition.first.id]: first, [definition.second.id]: second };
      const item = buildV31StyleSummary(draft).dimensions.find(entry => entry.key === definition.key)!;
      const expected = item.letter === definition.first.letter ? definition.first.id : item.letter === definition.second.letter ? definition.second.id : null;
      expect(item.letterFrom, `${definition.key} ${String(first)}/${String(second)}`).toBe(expected);
      expect(item.englishLabel === null).toBe(expected === null);
      // 근거 줄은 글자가 정해졌을 때(왜 다른 글자가 아닌지)만 남는다.
      expect(item.basis === null, `${definition.key} ${String(first)}/${String(second)}`).toBe(["?", "M", "N"].includes(item.letter));
    }
  });
});
