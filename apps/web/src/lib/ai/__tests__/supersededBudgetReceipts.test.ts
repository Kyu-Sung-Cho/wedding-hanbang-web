import { describe, expect, it } from "vitest";
import {
  dropSupersededDecisions,
  isSupersededDecision,
  type CurrentJourneyFacts,
  type DecisionForSupersessionCheck,
} from "@/lib/ai/supersededDecisions";

function receipt(amount: number, key = "custom_flowers"): DecisionForSupersessionCheck {
  return {
    category: "budget",
    source: "budget",
    metadata: { origin: "amora_shared_budget_action" },
    title: "항목 예산 변경",
    chosenValue: {
      value: `${amount}원으로 변경`,
      budgetDelta: {
        schemaVersion: 1,
        totalBudget: null,
        categories: [{ key, label: "시험 항목", beforeBudget: 1_500_000, afterBudget: amount }],
      },
    },
  };
}

function facts(progress?: Record<string, unknown>): CurrentJourneyFacts {
  return { venue: null, events: [], totalBudgetKrw: 35_000_000, budgetProgress: progress };
}

describe("승인 예산 이력과 현재 예산의 구분", () => {
  it("1,000원을 올린 뒤 원복하면 옛 이력만 AI 현재 문맥에서 제외한다", () => {
    const oldReceipt = receipt(1_501_000);
    const restoredReceipt = receipt(1_500_000);
    const history = [restoredReceipt, oldReceipt];
    const before = structuredClone(history);
    expect(dropSupersededDecisions(history, facts({ custom_flowers: { budget: 1_500_000 } })))
      .toEqual([restoredReceipt]);
    expect(history).toEqual(before);
  });

  it("다른 항목이나 일정만 바뀐 것으로 유효한 항목 이력을 지우지 않는다", () => {
    expect(isSupersededDecision(receipt(1_500_000), facts({
      custom_flowers: { budget: 1_500_000, spent: 123_000, payer: "both_parents" },
      venue: { budget: 12_000_000 },
      __events: [{ date: "2099-01-01" }],
    }))).toBe(false);
  });

  it.each([{}, { custom_flowers: {} }])("현재 명시 배정이 제거됐으면 옛 금액은 현재가 아니다", (progress) => {
    expect(isSupersededDecision(receipt(1_500_000), facts(progress))).toBe(true);
  });

  it("현재 항목 정보를 읽지 않은 상태를 삭제로 해석하지 않는다", () => {
    expect(isSupersededDecision(receipt(1_500_000), facts())).toBe(false);
  });

  it("명시적인 0원도 실제 현재 금액과 대조한다", () => {
    expect(isSupersededDecision(receipt(0), facts({ custom_flowers: { budget: 0 } }))).toBe(false);
    expect(isSupersededDecision(receipt(1_500_000), facts({ custom_flowers: { budget: 0 } }))).toBe(true);
  });

  it("기본 항목을 예산에서 숨겼으면 옛 배정을 현재처럼 회상하지 않는다", () => {
    expect(isSupersededDecision(receipt(1_500_000, "venue"), facts({
      venue: { budget: 1_500_000 }, __hidden: ["venue"],
    }))).toBe(true);
  });

  it("맞춤 항목에는 기본 항목 숨김 규칙을 잘못 적용하지 않는다", () => {
    expect(isSupersededDecision(receipt(1_500_000), facts({
      custom_flowers: { budget: 1_500_000 }, __hidden: ["custom_flowers"],
    }))).toBe(false);
  });

  it("여러 배분 항목 중 하나라도 달라지면 그 배분 당시 이력을 현재에서 제외한다", () => {
    const decision = receipt(1_500_000);
    const delta = decision.chosenValue!.budgetDelta as Record<string, unknown>;
    delta.categories = [
      { key: "custom_flowers", label: "시험 항목", beforeBudget: null, afterBudget: 1_500_000 },
      { key: "venue", label: "결혼식장", beforeBudget: 10_000_000, afterBudget: 12_000_000 },
    ];
    expect(isSupersededDecision(decision, facts({
      custom_flowers: { budget: 1_500_000 }, venue: { budget: 13_000_000 },
    }))).toBe(true);
    expect(isSupersededDecision(decision, facts({
      custom_flowers: { budget: 1_500_000 }, venue: { budget: 12_000_000 },
    }))).toBe(false);
  });

  it("정형 총예산의 최종 금액을 쓰고 제목에 먼저 나온 옛 금액을 쓰지 않는다", () => {
    const decision = receipt(1_500_000);
    decision.chosenValue!.budgetDelta = {
      schemaVersion: 1, totalBudget: { before: 30_000_000, after: 35_000_000 }, categories: [],
    };
    const titled = { ...decision, title: "총예산 30,000,000원에서 35,000,000원으로 변경" };
    expect(isSupersededDecision(titled, facts({}))).toBe(false);
    expect(isSupersededDecision(titled, { ...facts({}), totalBudgetKrw: 40_000_000 })).toBe(true);
  });

  it("새 정형 총예산은 0원과 미조회 null을 구분한다", () => {
    const decision = receipt(1_500_000);
    decision.chosenValue!.budgetDelta = {
      schemaVersion: 1, totalBudget: { before: 35_000_000, after: 0 }, categories: [],
    };
    expect(isSupersededDecision(decision, { ...facts({}), totalBudgetKrw: 0 })).toBe(false);
    expect(isSupersededDecision(decision, { ...facts({}), totalBudgetKrw: null })).toBe(false);
    expect(isSupersededDecision(decision, facts({}))).toBe(true);
  });

  it.each(["manual", undefined])("다른 종류의 기록에 정형 예산 영수증 규칙을 확대하지 않는다: %s", (origin) => {
    const decision = { ...receipt(1_501_000), metadata: origin ? { origin } : null };
    expect(isSupersededDecision(decision, facts({ custom_flowers: { budget: 1_500_000 } }))).toBe(false);
  });

  it.each([
    { schemaVersion: 2, totalBudget: null, categories: [] },
    { schemaVersion: 1, totalBudget: null, categories: [{ key: "custom_flowers", beforeBudget: null, afterBudget: -1 }] },
    { schemaVersion: 1, totalBudget: null, categories: [{ key: "__events", beforeBudget: null, afterBudget: 2 }] },
    { schemaVersion: 1, totalBudget: null, categories: [
      { key: "custom_flowers", beforeBudget: null, afterBudget: 1 },
      { key: "custom_flowers", beforeBudget: null, afterBudget: 2 },
    ] },
  ])("읽을 수 없는 정형 이력의 숫자를 추측하지 않는다", (budgetDelta) => {
    const decision = receipt(1_501_000);
    decision.chosenValue!.budgetDelta = budgetDelta;
    expect(isSupersededDecision(decision, facts({ custom_flowers: { budget: 1_500_000 } }))).toBe(false);
  });
});
