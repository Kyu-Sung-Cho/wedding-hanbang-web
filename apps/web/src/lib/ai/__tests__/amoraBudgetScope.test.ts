import { describe, expect, it } from "vitest";
import { getWeddingPlannerSystemPrompt } from "../prompts";
import { WEDDING_TOOLS } from "../tools";
import {
  BUDGET_SCOPE_ITEMS,
  normalizeBudgetScope,
  type NormalizedBudgetScope,
} from "../amoraWeddingContext";

// 사용자가 "예산 3천만원"이라고 말했을 때, 그 3천만원이 결혼식만인지 신혼집까지인지에
// 따라 이후 모든 계산과 조언이 달라진다. 프롬프트는 이미 "금액 크기로 포함 여부를
// 추정하지 마세요"와 "모호하면 한 문장으로 확인하세요"를 지시한다(`prompts.ts:918`).
//
// 그런데 확인한 답이 어디에도 저장되지 않아, 다음 턴의 모델은 그 3천만원이 무엇을
// 포함하는지 다시 알 수 없다. 결과는 둘 중 하나다: 같은 질문을 또 하거나(§2.1 "이미
// 말한 것을 불필요하게 다시 묻지 않는다" 위반), 확인하지 않은 채 가정하고 계산한다.
//
// 이 파일은 확인된 포함 범위를 구조화해 보존하고, 확인하지 않은 항목은 "미확인"으로
// 모델에게 정직하게 전달하는 계약을 고정한다. 원문이 아니라 열거값만 저장하므로
// `intake_summary`를 남기지 않는 기존 개인정보 결정과 충돌하지 않는다.
//
// 근거: docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md §5.2(facts/unknowns),
// §5.4(Evidence 상태), §6.1(금액 상태), §14.1("확인 필요"를 사실과 구분).

const baseContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "민이",
  scheduleEvents: [],
  chatSummaries: [],
  bookings: [],
};

function scopeOf(progress: Record<string, unknown>): NormalizedBudgetScope {
  return normalizeBudgetScope(progress);
}

describe("the budget tool must not contradict the prompt about scope", () => {
  const applyBudgetPlan = WEDDING_TOOLS.find(
    (tool) => tool.name === "apply_budget_plan",
  );
  const totalBudgetDescription = String(
    (applyBudgetPlan?.input_schema as {
      properties?: { total_budget?: { description?: unknown } };
    })?.properties?.total_budget?.description ?? "",
  );

  it("exposes the tool under test", () => {
    expect(applyBudgetPlan).toBeDefined();
    expect(totalBudgetDescription.length).toBeGreaterThan(0);
  });

  // `prompts.ts`는 "금액 크기로 포함 여부를 추정하지 마세요"와 "모호하면 한 문장으로
  // 확인합니다"를 지시한다. 도구 설명이 같은 금액을 "신혼집 포함"으로 단정하면 모델은
  // 서로 반대되는 두 지시를 동시에 받는다. 도구 설명도 모델이 읽는 문맥이다.
  it("does not declare what the total already covers", () => {
    for (const claim of ["신혼집 포함", "신혼여행·결혼반지·신혼집 포함"]) {
      expect(
        totalBudgetDescription,
        `apply_budget_plan.total_budget이 포함 범위를 단정한다: "${claim}"`,
      ).not.toContain(claim);
    }
  });

  it("tells the model to confirm the scope instead of inferring it", () => {
    expect(totalBudgetDescription).toMatch(/추정하지|확인/u);
  });
});

describe("normalizeBudgetScope", () => {
  it("treats an absent record as every item unconfirmed", () => {
    const scope = scopeOf({});
    expect(scope.included).toEqual([]);
    expect(scope.excluded).toEqual([]);
    expect(scope.unknown).toEqual([...BUDGET_SCOPE_ITEMS]);
    expect(scope.confirmedAt).toBeNull();
  });

  it("splits confirmed inclusions and exclusions, leaving the rest unconfirmed", () => {
    const scope = scopeOf({
      __budgetScope: {
        wedding: "included",
        honeymoon: "included",
        housing: "excluded",
      },
    });

    expect(scope.included).toEqual(["wedding", "honeymoon"]);
    expect(scope.excluded).toEqual(["housing"]);
    // 나머지는 조용히 포함으로 추정하지 않는다.
    expect(scope.unknown).toEqual(["studio", "rings", "appliances"]);
  });

  it("ignores unknown keys and invalid states instead of guessing", () => {
    const scope = scopeOf({
      __budgetScope: {
        wedding: "included",
        // 알 수 없는 항목과 상태는 버린다. 추정하지 않는다.
        yacht: "included",
        housing: "maybe",
        rings: 42,
      },
    });

    expect(scope.included).toEqual(["wedding"]);
    expect(scope.excluded).toEqual([]);
    expect(scope.unknown).toEqual(["studio", "rings", "honeymoon", "appliances", "housing"]);
  });

  it("keeps a valid confirmation date and drops a malformed one", () => {
    expect(scopeOf({ __budgetScope: { confirmedAt: "2026-08-05" } }).confirmedAt)
      .toBe("2026-08-05");
    expect(scopeOf({ __budgetScope: { confirmedAt: "어제" } }).confirmedAt)
      .toBeNull();
  });

  it("survives hostile shapes without throwing", () => {
    for (const hostile of [null, 42, "scope", [], { __budgetScope: "nope" }]) {
      const progress = hostile && typeof hostile === "object" && !Array.isArray(hostile)
        ? hostile as Record<string, unknown>
        : { __budgetScope: hostile };
      expect(() => normalizeBudgetScope(progress)).not.toThrow();
    }
  });
});

/**
 * 예산 줄만 떼어낸다. "미확인"은 프롬프트의 다른 고정 지침에도 정당하게 쓰이므로
 * 문서 전체를 검사하면 관계없는 문장을 잡는다.
 */
function budgetLineOf(prompt: string): string {
  return prompt.match(/(?:총 예산|예산): [^|\n]*/u)?.[0]?.trim() ?? "";
}

describe("budget scope reaches the model instead of a bare number", () => {
  it("marks every item unconfirmed when a total exists but its scope was never confirmed", () => {
    const line = budgetLineOf(getWeddingPlannerSystemPrompt({
      ...baseContext,
      budget: 30_000_000,
    }));

    // 금액만 주면 모델은 그 3천만원이 무엇을 덮는지 알 수 없다.
    expect(line).toContain("포함 범위 미확인");
    expect(line).toContain("신혼집");
  });

  it("states the confirmed inclusions and exclusions", () => {
    const line = budgetLineOf(getWeddingPlannerSystemPrompt({
      ...baseContext,
      budget: 30_000_000,
      progress: {
        __budgetScope: {
          wedding: "included",
          studio: "included",
          housing: "excluded",
        },
      },
    }));

    expect(line).toContain("포함: 결혼식·스드메");
    expect(line).toContain("제외: 신혼집");
    // 확인하지 않은 나머지는 확인된 것처럼 보이지 않아야 한다.
    expect(line).toContain("미확인: 예물·신혼여행·가전");
  });

  it("does not claim a scope when there is no budget at all", () => {
    const line = budgetLineOf(getWeddingPlannerSystemPrompt({
      ...baseContext,
      budget: 0,
    }));
    expect(line).toBe("예산: 미설정");
  });

  it("says nothing is unconfirmed once every item is decided", () => {
    const line = budgetLineOf(getWeddingPlannerSystemPrompt({
      ...baseContext,
      budget: 30_000_000,
      progress: {
        __budgetScope: {
          wedding: "included",
          studio: "included",
          rings: "included",
          honeymoon: "included",
          appliances: "excluded",
          housing: "excluded",
        },
      },
    }));

    expect(line).not.toContain("미확인");
    expect(line).toContain("포함: 결혼식·스드메·예물·신혼여행");
    expect(line).toContain("제외: 가전·신혼집");
  });
});
