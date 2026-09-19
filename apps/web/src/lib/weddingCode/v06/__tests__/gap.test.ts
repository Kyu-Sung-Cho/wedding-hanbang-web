import { describe, expect, it } from "vitest";

import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  type WeddingCodeV06OptionValue,
  type WeddingCodeV06QuestionKey,
} from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V12_AXES, WEDDING_CODE_V12_QUESTIONS } from "@/constants/weddingCodeV12";
import {
  answeredCount,
  buildWeddingCodeV06GapMap,
  describeGap,
  ownAnswerQuotes,
  topGapsForDisplay,
  type WeddingCodeV06Answers,
} from "../gap";

function answersFrom(
  pick: (key: WeddingCodeV06QuestionKey, index: number) => WeddingCodeV06OptionValue,
): WeddingCodeV06Answers {
  const out: WeddingCodeV06Answers = {};
  WEDDING_CODE_V06_QUESTIONS.forEach((question, index) => {
    out[question.key] = pick(question.key, index);
  });
  return out;
}

/** 각 문항에서 축 왼쪽/오른쪽에 실린 선택지 값. */
function sideValues(key: WeddingCodeV06QuestionKey): {
  left: WeddingCodeV06OptionValue[];
  right: WeddingCodeV06OptionValue[];
} {
  const question = WEDDING_CODE_V06_QUESTIONS.find((item) => item.key === key)!;
  const axis = WEDDING_CODE_V06_AXES.find((item) => item.key === question.axis)!;
  const leftConstructs = axis.left.constructs as readonly string[];
  const left: WeddingCodeV06OptionValue[] = [];
  const right: WeddingCodeV06OptionValue[] = [];
  for (const option of question.options) {
    if (option.weights.some((w) => leftConstructs.includes(w.construct))) left.push(option.value);
    else right.push(option.value);
  }
  return { left, right };
}

const ALL_LEFT = answersFrom((key) => sideValues(key).left[0]);
const ALL_RIGHT = answersFrom((key) => sideValues(key).right[0]);

describe("차이 지도", () => {
  it.each(["first", "second"] as const)("%s에 없는 보기가 하나라도 있으면 일부 비교·인용도 만들지 않는다", side => {
    const valid = { A1: "A", D1: "B" } as const;
    const invalid = { A1: "A", D1: "D" } as const;
    const config = { questions: WEDDING_CODE_V12_QUESTIONS, axes: WEDDING_CODE_V12_AXES };
    expect(() => buildWeddingCodeV06GapMap(side === "first" ? invalid : valid, side === "second" ? invalid : valid, config))
      .toThrow("INVALID_WEDDING_CODE_SCENE_ANSWER");
    expect(() => ownAnswerQuotes(invalid, 3, config.questions)).toThrow("INVALID_WEDDING_CODE_SCENE_ANSWER");
    expect(answeredCount(invalid, config.questions)).toBe(1);
  });

  it("다른 사람이 건너뛴 질문의 없는 보기도 미응답으로 바꿔 비교하지 않는다", () => {
    expect(() => buildWeddingCodeV06GapMap({ A1: "A", B1: "D" }, { A1: "B" }, {
      questions: WEDDING_CODE_V12_QUESTIONS, axes: WEDDING_CODE_V12_AXES,
    })).toThrow("INVALID_WEDDING_CODE_SCENE_ANSWER");
  });

  it("완전히 반대로 답하면 16문항 전부 갈린 지점이 된다", () => {
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_RIGHT);
    expect(map.splits).toHaveLength(16);
    expect(map.shared).toHaveLength(0);
    expect(map.identical).toHaveLength(0);
    expect(map.missing).toBe(0);
  });

  it("똑같이 답하면 갈린 지점이 하나도 없다", () => {
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_LEFT);
    expect(map.splits).toHaveLength(0);
    expect(map.identical).toHaveLength(16);
  });

  /**
   * 이게 v0.5가 못 하던 것. 문장이 달라도 방향이 같으면 「갈렸다」가 아니다 —
   * 같은 축 같은 편의 두 선택지를 갈등으로 보여주면 없는 싸움을 만든다.
   */
  it("문장이 달라도 방향이 같으면 갈린 지점이 아니다", () => {
    const secondLeft = answersFrom((key) => sideValues(key).left[1]);
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, secondLeft);
    expect(map.splits).toHaveLength(0);
    expect(map.identical).toHaveLength(0);
    expect(map.shared).toHaveLength(16);
    // 같은 편이어도 두 사람이 고른 문장은 그대로 남아 있어야 한다.
    for (const gap of map.shared) {
      expect(gap.firstLabel).not.toBe(gap.secondLabel);
    }
  });

  /**
   * 이 제품의 약속: 두 사람이 **실제로 고른 문장**을 그대로 보여준다.
   * 라벨이 뒤바뀌거나 상대 문장이 섞이면 거짓말이 된다.
   */
  it("인용 문장이 각자 실제로 고른 선택지와 정확히 일치한다", () => {
    const first = answersFrom((key) => sideValues(key).left[0]);
    const second = answersFrom((key) => sideValues(key).right[1]);
    const map = buildWeddingCodeV06GapMap(first, second);

    for (const gap of [...map.splits, ...map.shared, ...map.identical]) {
      const question = WEDDING_CODE_V06_QUESTIONS.find((item) => item.key === gap.key)!;
      const expectedFirst = question.options.find((o) => o.value === first[gap.key])!.label;
      const expectedSecond = question.options.find((o) => o.value === second[gap.key])!.label;
      expect(gap.firstLabel, gap.key).toBe(expectedFirst);
      expect(gap.secondLabel, gap.key).toBe(expectedSecond);
      expect(gap.firstLabel, `${gap.key}: 상대 문장이 내 자리에 왔다`).not.toBe(expectedSecond);
    }
  });

  it("한쪽이 덜 답하면 그만큼 missing으로 잡히고 비교에서 빠진다", () => {
    const partial: WeddingCodeV06Answers = { ...ALL_RIGHT };
    delete partial.A1;
    delete partial.D4;
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, partial);
    expect(map.missing).toBe(2);
    expect(map.splits).toHaveLength(14);
    expect(map.splits.map((gap) => gap.key)).not.toContain("A1");
    expect(map.splits.map((gap) => gap.key)).not.toContain("D4");
  });

  /** 같은 응답 쌍이면 언제 열어도 같은 순서로 보여야 한다. */
  it("정렬이 결정적이다", () => {
    const a = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_RIGHT);
    const b = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_RIGHT);
    expect(a.splits.map((gap) => gap.key)).toEqual(b.splits.map((gap) => gap.key));
  });

  /**
   * 축 하나에서만 갈린 커플과 네 축 전부에서 갈린 커플이 있을 때,
   * 반복해서 나타나는 차이가 위로 와야 한다 — 그게 실제로 더 자주 부딪히는 지점이다.
   */
  it("여러 번 갈린 축이 위로 온다", () => {
    // supportOrder(D1~D4)만 전부 갈리고, decisionCriteria는 A1 하나만 갈리게 만든다.
    const first: WeddingCodeV06Answers = { ...ALL_LEFT };
    const second: WeddingCodeV06Answers = { ...ALL_LEFT };
    for (const key of ["D1", "D2", "D3", "D4"] as const) {
      second[key] = sideValues(key).right[0];
    }
    second.A1 = sideValues("A1").right[0];

    const map = buildWeddingCodeV06GapMap(first, second);
    expect(map.splits).toHaveLength(5);
    expect(map.splits.slice(0, 4).map((gap) => gap.axis)).toEqual([
      "supportOrder",
      "supportOrder",
      "supportOrder",
      "supportOrder",
    ]);
    expect(map.splits[4].key).toBe("A1");
  });
});

describe("화면에 띄울 갈림 고르기", () => {
  /**
   * 상위 N개를 그냥 자르면 가장 많이 갈린 축이 전부를 차지한다. 그러면 제목도 마무리
   * 문장도 똑같은 게 세 번 반복돼서, 결과가 복사·붙여넣기처럼 읽힌다.
   * 실측으로 그 상태를 확인하고 고친 자리다.
   */
  it("한 축이 화면을 독차지하지 않는다", () => {
    // supportOrder 4개 전부 + preparationMode 2개 + coordinationScope 1개를 갈리게 한다.
    const second: WeddingCodeV06Answers = { ...ALL_LEFT };
    for (const key of ["D1", "D2", "D3", "D4", "B1", "B2", "C1"] as const) {
      second[key] = sideValues(key).right[0];
    }
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, second);
    expect(map.splits).toHaveLength(7);
    // 자르기만 하면 네 개가 전부 supportOrder다.
    expect(new Set(map.splits.slice(0, 3).map((gap) => gap.axis)).size).toBe(1);

    const shown = topGapsForDisplay(map, 3);
    expect(shown).toHaveLength(3);
    expect(new Set(shown.map((gap) => gap.axis)).size, "축이 겹쳤다").toBe(3);
    // 축마다 다른 마무리 문장이 나와야 반복으로 안 읽힌다.
    expect(new Set(shown.map((gap) => describeGap(gap).nextScene)).size).toBe(3);
  });

  it("축 수보다 많이 요청하면 남은 갈림으로 채운다", () => {
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_RIGHT);
    const shown = topGapsForDisplay(map, 6);
    expect(shown).toHaveLength(6);
    expect(new Set(shown.map((gap) => gap.key)).size, "중복 출력").toBe(6);
    // 앞 네 개는 축이 전부 달라야 한다.
    expect(new Set(shown.slice(0, 4).map((gap) => gap.axis)).size).toBe(4);
  });

  it("갈림이 요청 수보다 적으면 있는 만큼만 준다", () => {
    const second: WeddingCodeV06Answers = { ...ALL_LEFT };
    second.A1 = sideValues("A1").right[0];
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, second);
    expect(topGapsForDisplay(map, 3)).toHaveLength(1);
    expect(topGapsForDisplay(buildWeddingCodeV06GapMap(ALL_LEFT, ALL_LEFT), 3)).toHaveLength(0);
  });
});

describe("차이 문장", () => {
  it("두 사람 문장을 그대로 인용하고 판정하지 않는다", () => {
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_RIGHT);
    const banned = /점수|등급|유형|궁합|맞|틀|옳|잘못|더 나은|바람직|위험|안전/;
    for (const gap of map.splits) {
      const described = describeGap(gap);
      expect(described.quotes[0]).toContain(gap.firstLabel);
      expect(described.quotes[1]).toContain(gap.secondLabel);
      expect(described.nextScene, gap.key).not.toMatch(banned);
      expect(described.headline, gap.key).not.toMatch(banned);
      expect(described.nextScene.length).toBeGreaterThan(20);
    }
  });

  it("이름을 넘기면 그 이름으로 인용한다", () => {
    const map = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_RIGHT);
    const described = describeGap(map.splits[0], { first: "지은", second: "현우" });
    expect(described.quotes[0].startsWith("지은:")).toBe(true);
    expect(described.quotes[1].startsWith("현우:")).toBe(true);
  });

  it("네 축 모두 다음 장면 문장을 가진다", () => {
    const seen = new Set<string>();
    for (const axis of WEDDING_CODE_V06_AXES) {
      const gap = buildWeddingCodeV06GapMap(ALL_LEFT, ALL_RIGHT).splits.find(
        (item) => item.axis === axis.key,
      )!;
      const text = describeGap(gap).nextScene;
      expect(text, axis.key).toBeTruthy();
      seen.add(text);
    }
    // 축마다 다른 문장이어야 한다 — 같으면 축을 구분한 의미가 없다.
    expect(seen.size).toBe(WEDDING_CODE_V06_AXES.length);
  });
});

describe("내 답 인용", () => {
  it("내가 고른 문장을 그대로 돌려준다", () => {
    const quotes = ownAnswerQuotes(ALL_LEFT, 3);
    expect(quotes).toHaveLength(3);
    for (const quote of quotes) {
      const question = WEDDING_CODE_V06_QUESTIONS.find((item) => item.scene === quote.scene)!;
      const chosen = question.options.find((o) => o.value === ALL_LEFT[question.key])!;
      expect(quote.label).toBe(chosen.label);
    }
  });

  it("답을 안 한 문항은 인용하지 않는다", () => {
    expect(ownAnswerQuotes({}, 3)).toHaveLength(0);
    expect(ownAnswerQuotes({ A1: "A" }, 3)).toHaveLength(1);
  });

  it("답한 개수를 센다", () => {
    expect(answeredCount(ALL_LEFT)).toBe(16);
    expect(answeredCount({ A1: "A", B2: "C" })).toBe(2);
  });
});
