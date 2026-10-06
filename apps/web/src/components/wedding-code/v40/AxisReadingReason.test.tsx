import { describe, expect, it } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import { buildResult } from "@/lib/weddingCode/v40/score";
import { stateChar } from "@/lib/weddingCode/v40/states";
import { itemValue, selfChoice } from "@/lib/weddingCode/v40/value";
import type { AxisResult, ResponseValue, Responses, ScoredItem, Side } from "@/lib/weddingCode/v40/types";
import { V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V42_BANK } from "@/lib/weddingCode/v42/bank";
import { answerPercent } from "./AnswerEvidence";
import { axisReadingReasons } from "./AxisReadingReason";

const bank = WEDDING_CODE_V42_BANK;
type Wanted = number | "skip" | "na";

function stateForValue(item: ScoredItem, wanted: number): string {
  for (let index = 0; index < V40_STATE_COUNTS[item.fmt]; index += 1) {
    const state = stateChar(index);
    if (itemValue(item, state) === wanted) return state;
  }
  throw new Error(`${item.id} 문항은 값 ${wanted}를 낼 수 없어요.`);
}

function selfState(side: Side, level: 1 | 2 | 3): string {
  const item = bank.byId.get("self.money");
  if (!item || item.fmt !== "self") throw new Error("돈 주제 자기 선택 문항이 없어요.");
  for (let index = 0; index < V40_STATE_COUNTS.self; index += 1) {
    const state = stateChar(index);
    const choice = selfChoice(item, state);
    if (choice?.side === side && choice.level === level) return state;
  }
  throw new Error(`${side} ${level}단계 자기 선택 상태가 없어요.`);
}

function moneyResponses(values: Readonly<Record<string, Wanted>>, self?: { readonly side: Side; readonly level: 1 | 2 | 3 }): Responses {
  const responses: Record<string, ResponseValue> = {};
  for (const [shortId, wanted] of Object.entries(values)) {
    const id = `money.${shortId}`;
    const item = bank.byId.get(id);
    if (!item || item.fmt === "self") throw new Error(`채점 문항이 없어요: ${id}`);
    responses[id] = wanted === "skip" || wanted === "na" ? wanted : stateForValue(item, wanted);
  }
  if (self) responses["self.money"] = selfState(self.side, self.level);
  return responses;
}

function moneyAxis(values: Readonly<Record<string, Wanted>>, self?: { readonly side: Side; readonly level: 1 | 2 | 3 }): AxisResult {
  return buildResult(bank, 0, moneyResponses(values, self)).axes[0];
}

function positiveState(item: ScoredItem): string {
  const positive = Array.from({ length: V40_STATE_COUNTS[item.fmt] }, (_, index) => stateChar(index))
    .find((state) => (itemValue(item, state) ?? 0) > 0);
  if (!positive) throw new Error(`앞 방향 답 상태가 없어요: ${item.id}`);
  return positive;
}

/** 다른 주제에 확정 글자를 만들어, 임시·미결정 돈 주제도 실제 열린 결과 화면에서 읽을 수 있게 한다. */
function withConfirmedProcess(responses: Responses): Responses {
  const complete: Record<string, ResponseValue> = { ...responses };
  for (const item of bank.scoredByAxis.process) complete[item.id] = positiveState(item);
  return complete;
}

const TIE_ONE = {
  "limit.1": -2, "limit.2": -3, "limit.3": 2, "limit.4": -2,
  "check.1": 0, "check.2": 2, "check.3": -2, "check.4": 2,
  "worth.1": -2, "worth.2": 2, "worth.3": -2, "worth.4": 3,
  "moment.1": 2, "moment.2": -2, "moment.3": 0, "moment.4": 2,
} as const;

const TIE_FOUR = {
  "limit.1": 2, "limit.2": 0, "limit.3": 2, "limit.4": -2,
  "check.1": 0, "check.2": -2, "check.3": 2, "check.4": -2,
  "worth.1": 2, "worth.2": 2, "worth.3": -4, "worth.4": 0,
  "moment.1": 0, "moment.2": 2, "moment.3": 0, "moment.4": -2,
} as const;

describe("AxisReadingReason: 실제 v4.2 문항과 채점 결과", () => {
  it("앞 방향 답이 9개로 더 많아도 강도 합이 뒤쪽이면 그 차이를 먼저 알린다", () => {
    const axis = moneyAxis({
      "limit.1": 2, "limit.2": 3, "limit.3": 2, "limit.4": -6,
      "check.1": 3, "check.2": 2, "check.3": 1, "check.4": -6,
      "worth.1": 2, "worth.2": -6, "worth.3": 2, "worth.4": -6,
      "moment.1": 1, "moment.2": -6, "moment.3": -6, "moment.4": -6,
    });
    expect(axis).toMatchObject({ answered: 16, frontCount: 9, backCount: 7, neutralCount: 0, letter: "S", weighted: -72, tieLevel: 0 });
    const reasons = axisReadingReasons(axis);
    expect(reasons[0]).toContain("V 조건 먼저 쪽이 더 많아요");
    expect(reasons[1]).toContain("S 장면 먼저 쪽으로 나왔어요");
    expect(reasons.join(" ")).not.toMatch(/성향 확률|궁합|\d+%/u);
  });

  it("계산 자체가 약한 반반과 응답 힌트로 낮춘 반반을 구별한다", () => {
    const trueEven = moneyAxis({
      "limit.1": -6, "limit.2": -6, "limit.3": -6, "limit.4": -6,
      "check.1": 0, "check.2": 2, "check.3": 0, "check.4": -2,
      "worth.1": 2, "worth.2": 2, "worth.3": -4, "worth.4": 0,
      "moment.1": 1, "moment.2": 2, "moment.3": 0, "moment.4": -2,
    });
    expect(trueEven).toMatchObject({ weighted: -69, band: "even", shownBand: "even", tieLevel: 0 });
    expect(axisReadingReasons(trueEven)).toContain(V40_COPY.evidence.evenReason);
    expect(axisReadingReasons(trueEven)).not.toContain(V40_COPY.evidence.demotedReason);

    const fixture = fixtureByName("rhythm-hint");
    if (!fixture) throw new Error("반복 응답 표본이 없어요.");
    const result = buildResult(bank, fixture.formBit, fixture.responses);
    const demoted = result.axes.find((each) => each.band !== null && each.band !== each.shownBand);
    if (!demoted) throw new Error("실제 응답에서 세기가 낮아진 주제가 없어요.");
    expect(result.notes.demoted).toBe(true);
    expect(axisReadingReasons(demoted)).toContain(V40_COPY.evidence.demotedReason);
    expect(axisReadingReasons(demoted)).not.toContain(V40_COPY.evidence.evenReason);
  });

  it("동점 1단계는 실제 recall·instant를 합친 고르기 문항이라고 말한다", () => {
    const axis = moneyAxis(TIE_ONE);
    expect(axis).toMatchObject({ answered: 16, frontCount: 7, backCount: 7, neutralCount: 2, weighted: 0, tieLevel: 1, letter: "V", band: "even" });
    const reasons = axisReadingReasons(axis).join(" ");
    expect(reasons).toContain("고르기 문항");
    expect(reasons).not.toContain("두 가지 중 고르기");
    expect(reasons).not.toContain("평균 선택 강도를 같은 비중으로 더한 결과");
  });

  it("동점 4단계는 점수 방향을 주장하지 않고 마지막 직접 선택을 밝힌다", () => {
    const axis = moneyAxis(TIE_FOUR, { side: "back", level: 2 });
    expect(axis).toMatchObject({ weighted: 0, tieLevel: 4, letter: "S", shownBand: "even", provisional: false });
    const reasons = axisReadingReasons(axis).join(" ");
    expect(reasons).toContain("마지막에 직접 고른 S 글자");
    expect(reasons).not.toContain("평균 선택 강도를 같은 비중으로 더한 결과");
  });

  it("동점 5단계의 앞 글자는 확정 성향이 아닌 임시 표기라고 밝힌다", () => {
    const result = buildResult(bank, 0, withConfirmedProcess(moneyResponses(TIE_FOUR)));
    const axis = result.axes[0];
    expect(result.gate.closed).toBe(false);
    expect(axis).toMatchObject({ weighted: 0, tieLevel: 5, letter: "V", shownBand: "even", provisional: true });
    const reasons = axisReadingReasons(axis).join(" ");
    expect(reasons).toContain("임시로 적었어요");
    expect(reasons).not.toContain("평균 선택 강도를 같은 비중으로 더한 결과");
  });

  it("한 방향 11개 중 11개라도 답 수가 부족하면 글자를 만들지 않는다", () => {
    const responses: Record<string, ResponseValue> = {};
    for (const item of bank.scoredByAxis.money.slice(0, 11)) responses[item.id] = positiveState(item);
    const result = buildResult(bank, 0, withConfirmedProcess(responses));
    const axis = result.axes[0];
    expect(result.gate.closed).toBe(false);
    expect(axis).toMatchObject({ answered: 11, frontCount: 11, backCount: 0, unusable: true, letter: null });
    expect(answerPercent(axis.frontCount, axis.answered)).toBe(100);
    expect(axisReadingReasons(axis)).toEqual([V40_COPY.evidence.unsetReason]);
  });

  it("한 장면에 답이 하나뿐이면 방향 비율에 들지만 글자 평균에서는 빼고 설명한다", () => {
    const axis = moneyAxis({
      "limit.1": 6, "limit.2": "skip", "limit.3": "skip", "limit.4": "skip",
      "check.1": 3, "check.2": 2, "check.3": 1, "check.4": 2,
      "worth.1": 2, "worth.2": -2, "worth.3": 2, "worth.4": 0,
      "moment.1": -2, "moment.2": 2, "moment.3": 0, "moment.4": -2,
    });
    expect(axis).toMatchObject({ answered: 13, countedFacets: 3, letter: "V" });
    expect(axis.facets[0]).toMatchObject({ answered: 1, frontCount: 1, counted: false });
    expect(axisReadingReasons(axis).join(" ")).toContain("3개 장면 묶음");
  });
});
