import { describe, expect, it } from "vitest";
import { buildAmoraLifecyclePlan } from "../lifecycle";

describe("아모라 lifecycle 근거 경계", () => {
  it("legacy cost만으로 실제 지출과 예산 초과를 단정하지 않는다", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-06-15",
      totalBudget: 50_000_000,
      progress: {
        venue: {
          status: "not_started",
          cost: 60_000_000,
        },
      },
      now: new Date("2026-06-15T03:00:00Z"),
    });

    expect(plan.spentBudget).toBe(0);
    expect(plan.guardrails.some((guardrail) => guardrail.id === "budget_over_limit")).toBe(false);
  });

  it("명시적으로 입력한 실제 지출이 예산을 넘으면 근거 범위를 함께 알린다", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-06-15",
      totalBudget: 50_000_000,
      progress: {
        venue: {
          status: "in_progress",
          spent: 60_000_000,
        },
      },
      now: new Date("2026-06-15T03:00:00Z"),
    });

    const guardrail = plan.guardrails.find((item) => item.id === "budget_over_limit");
    expect(plan.spentBudget).toBe(60_000_000);
    expect(guardrail?.title).toBe("기록 지출 합계가 전체 예산보다 커요");
    expect(guardrail?.body).toContain("결제 완료 여부와는 별도");
    expect(guardrail?.title).not.toContain("이미");
  });

  it("서버 시간대와 무관하게 한국 날짜 기준으로 결혼식 당일을 판정한다", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-06-16",
      totalBudget: 50_000_000,
      progress: {},
      // 2026-06-16 01:30 KST
      now: new Date("2026-06-15T16:30:00Z"),
    });

    expect(plan.dday).toBe(0);
    expect(plan.stage).toBe("wedding_day");
  });

  it("does not turn unseen v2 checklist categories into urgent guardrails", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-08-20",
      totalBudget: 50_000_000,
      progress: {},
      now: new Date("2026-08-19T03:00:00Z"),
    });

    expect(plan.guardrails.some((guardrail) =>
      ["foundation", "contracts", "guests", "ceremony", "home_admin", "health_admin", "aftercare", "special_cases"]
        .includes(guardrail.categoryKey ?? ""),
    )).toBe(false);
  });
});
