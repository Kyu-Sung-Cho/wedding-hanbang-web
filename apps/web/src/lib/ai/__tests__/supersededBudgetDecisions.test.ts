import { describe, expect, it } from "vitest";
import {
  isSupersededDecision,
  type CurrentJourneyFacts,
} from "@/lib/ai/supersededDecisions";

/**
 * 파운더가 지적한 상황(2026-08-22):
 *
 *   "2달 전에 총예산을 3000만원으로 잡았는데 나중에 5000만원으로 바꾸고 싶어서
 *    아모라랑 이야기해서 바꿨는데 3000만원이 계속 나오는 경우도 있을 수 있잖아"
 *
 * 실재하는 구멍이었다. `isSupersededDecision` 은 **예식장**과 **일정 영수증**만 보고
 * 예산은 보지 않았다. 그래서 `wedding_journeys.total_budget` 이 5,000만 원으로 바뀌어도
 * "총 예산 3000만원" 결정 영수증이 살아남아 `pastDecisions` 로 프롬프트에 들어갔고,
 * 프롬프트는 그것을 "혹시 아직도…" 톤으로 회상하라고 시킨다.
 *
 * 원칙은 이 모듈이 이미 정해 뒀다: **어긋남을 증명할 수 있을 때만 지운다.**
 * 그래서 아래 "지우면 안 되는" 묶음이 "지워야 하는" 묶음만큼 중요하다 — 카테고리
 * 예산(스튜디오 300만원)을 총예산과 비교해 지우면 사용자가 실제로 한 결정을 잃는다.
 */

function facts(overrides: Partial<CurrentJourneyFacts> = {}): CurrentJourneyFacts {
  return { venue: null, events: [], totalBudgetKrw: null, ...overrides };
}

function budgetDecision(value: string, title = "총 예산 결정") {
  return { category: "budget", title, chosenValue: { value } };
}

describe("바뀐 총예산은 옛 값을 현재처럼 보여주지 않는다", () => {
  it("파운더가 말한 그 상황 — 3000만원 결정, 지금은 5000만원", () => {
    const stale = budgetDecision("총 예산 3000만원");
    expect(isSupersededDecision(stale, facts({ totalBudgetKrw: 50_000_000 }))).toBe(true);
  });

  it.each([
    "총 예산 3000만원",
    "총예산 3,000만 원",
    "총 예산을 3000만원으로 정함",
    "전체 예산 3000만원",
    "총 예산 30,000,000원",
    "총 예산 30000000",
  ])("표기가 달라도 같은 금액으로 읽는다: %s", (value) => {
    expect(isSupersededDecision(budgetDecision(value), facts({ totalBudgetKrw: 50_000_000 })))
      .toBe(true);
  });

  it("현재 값과 같으면 남긴다 — 사용자가 실제로 한 결정이다", () => {
    expect(isSupersededDecision(
      budgetDecision("총 예산 5000만원"),
      facts({ totalBudgetKrw: 50_000_000 }),
    )).toBe(false);
  });

  it("제목에만 총예산이 적혀 있어도 읽는다", () => {
    expect(isSupersededDecision(
      { category: "budget", title: "총 예산 3000만원으로 결정", chosenValue: { value: "확정" } },
      facts({ totalBudgetKrw: 50_000_000 }),
    )).toBe(true);
  });
});

describe("증명할 수 없으면 지우지 않는다", () => {
  it("카테고리 예산은 총예산과 비교하지 않는다", () => {
    // 스튜디오 300만원은 총예산 5000만원과 어긋나는 값이 아니다.
    for (const value of [
      "스튜디오 예산 300만원",
      "드레스 200만원",
      "예식장 예산 2000만원",
    ]) {
      expect(isSupersededDecision(budgetDecision(value, "카테고리 예산"), facts({ totalBudgetKrw: 50_000_000 })), value)
        .toBe(false);
    }
  });

  it("현재 총예산을 모르면 지우지 않는다", () => {
    for (const current of [null, 0]) {
      expect(isSupersededDecision(
        budgetDecision("총 예산 3000만원"),
        facts({ totalBudgetKrw: current }),
      )).toBe(false);
    }
  });

  it("금액을 못 읽으면 지우지 않는다", () => {
    for (const value of [
      "총 예산은 아직 고민 중",
      "총 예산을 좀 더 늘리고 싶어요",
      "예산 이야기를 나눴다",
    ]) {
      expect(isSupersededDecision(budgetDecision(value), facts({ totalBudgetKrw: 50_000_000 })), value)
        .toBe(false);
    }
  });

  it("예산이 아닌 결정은 총예산으로 판단하지 않는다", () => {
    expect(isSupersededDecision(
      { category: "studio", title: "촬영 3000만원 견적 받음", chosenValue: { value: "3000만원" } },
      facts({ totalBudgetKrw: 50_000_000 }),
    )).toBe(false);
  });

  it("기존 예식장·일정 판정은 그대로다", () => {
    expect(isSupersededDecision(
      { category: "venue", title: "A홀", chosenValue: null },
      facts({ venue: "B홀", totalBudgetKrw: 50_000_000 }),
    )).toBe(true);
    expect(isSupersededDecision(
      { category: "venue", title: "B홀", chosenValue: null },
      facts({ venue: "B홀", totalBudgetKrw: 50_000_000 }),
    )).toBe(false);
  });
});
