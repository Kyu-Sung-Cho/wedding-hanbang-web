import { describe, expect, it } from "vitest";
import { readStoredBudgetSummary } from "./budgetSummaryDisplay";

function snapshot() {
  return {
    total_budget: 35_000_000, total_spent: 123_003,
    recorded_spend_basis: "explicit_spent_only", custom_categories_omitted: 0,
    categories: [
      { key: "venue", allocated: null, allocated_is_set: false, spent: 1 },
      { key: "studio", allocated: 0, allocated_is_set: true, spent: 2 },
      { key: "custom_gifts", allocated: 1_500_000, allocated_is_set: true, spent: 123_000 },
    ],
  };
}

describe("저장된 예산 조회 presentation parser", () => {
  it("명시 0원·미입력·custom과 원 단위를 구별하고 원문을 변경하지 않는다", () => {
    const raw = snapshot(), before = structuredClone(raw);
    const parsed = readStoredBudgetSummary(raw);
    expect(parsed).toEqual({ totalBudget: 35_000_000, totalSpent: 123_003, categories: [
      { key: "venue", budget: null, spent: 1 }, { key: "studio", budget: 0, spent: 2 },
      { key: "custom_gifts", budget: 1_500_000, spent: 123_000 },
    ] });
    expect(raw).toEqual(before);
  });

  it("생략된 custom이 있으면 부분 목록으로 전체 지출을 덮지 않는다", () => {
    const raw = { ...snapshot(), total_spent: 999_999, custom_categories_omitted: 2 };
    expect(readStoredBudgetSummary(raw)?.totalSpent).toBe(999_999);
  });

  it.each([
    { total_spent: 123_002 }, { total_spent: 123_004 },
    { recorded_spend_basis: undefined }, { custom_categories_omitted: undefined },
    { custom_categories_omitted: -1 }, { custom_categories_omitted: 0.5 },
    { categories: [] }, { categories: {} },
  ])("불완전하거나 서로 모순인 조회 %j는 통째로 거절한다", (patch) => {
    expect(readStoredBudgetSummary({ ...snapshot(), ...patch })).toBeNull();
  });

  it.each([
    { allocated: -1 }, { allocated: 1.5 }, { allocated: Number.MAX_SAFE_INTEGER + 1 },
    { allocated: 0, allocated_is_set: false }, { allocated: null, allocated_is_set: true },
    { spent: -1 }, { spent: Infinity }, { spent: NaN }, { key: " " },
  ])("invalid 분야 %j를 현재값이나 0으로 채우지 않는다", (patch) => {
    const raw = snapshot(); raw.categories[0] = { ...raw.categories[0], ...patch };
    expect(readStoredBudgetSummary(raw)).toBeNull();
  });

  it("중복 category와 합산 overflow를 거절한다", () => {
    const raw = snapshot(); raw.categories.push({ ...raw.categories[0] });
    expect(readStoredBudgetSummary(raw)).toBeNull();
    expect(readStoredBudgetSummary({
      ...snapshot(), total_spent: Number.MAX_SAFE_INTEGER, custom_categories_omitted: 1,
      categories: [
        { key: "venue", allocated: null, allocated_is_set: false, spent: Number.MAX_SAFE_INTEGER },
        { key: "studio", allocated: null, allocated_is_set: false, spent: 1 },
      ],
    })).toBeNull();
  });
});
