import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

import { buildAmoraLifecyclePlan, LIFECYCLE_PHASE_KEYS } from "../lifecycle";

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

  describe("기록이 없는 커플에게 지연을 단정하지 않는다", () => {
    // 온보딩에서 예식일을 받기로 하면서 생긴 새 비용이다. 예식이 10개월 안이면
    // 상견례(D-300)·예식장(D-270) 마감이 이미 지난 것으로 계산되는데, 방금
    // 가입한 커플에게 그건 "안 했다"가 아니라 "모른다"다.
    const soonWedding = {
      weddingDate: "2027-01-15",
      totalBudget: 0,
      now: new Date("2026-08-21T03:00:00Z"),
    };

    it("아무것도 기록하지 않았으면 마감 지연 경고를 만들지 않는다", () => {
      const plan = buildAmoraLifecyclePlan({ ...soonWedding, progress: {} });

      const overdue = plan.guardrails.filter(
        (guardrail) => guardrail.severity === "critical" && guardrail.categoryKey,
      );
      expect(overdue).toHaveLength(0);
    });

    it("대신 상황을 물어보는 안내 하나를 준다", () => {
      const plan = buildAmoraLifecyclePlan({ ...soonWedding, progress: {} });

      const asked = plan.guardrails.find((guardrail) => guardrail.id === "progress_unknown");
      expect(asked).toBeDefined();
      expect(asked?.severity).toBe("warning");
      // 지연을 사실로 말하지 않는다
      expect(asked?.body).toContain("알 수 없");
    });

    it("한 번이라도 기록했으면 지연을 정상적으로 알린다", () => {
      const plan = buildAmoraLifecyclePlan({
        ...soonWedding,
        progress: { venue: { status: "completed" } },
      });

      const overdue = plan.guardrails.filter(
        (guardrail) => guardrail.severity === "critical" && guardrail.categoryKey,
      );
      expect(overdue.length).toBeGreaterThan(0);
      expect(plan.guardrails.some((g) => g.id === "progress_unknown")).toBe(false);
    });
  });
});

describe("아모라 lifecycle 단계 커버리지", () => {
  /**
   * 어느 단계에도 안 들어간 분야는 진행 계산에서 **통째로 사라지는데 화면에는 아무 표시도
   * 안 난다.** 2026-08-21에 분야를 둘 늘렸을 때 실제로 그렇게 됐다.
   *
   * 어느 분야가 어느 시기에 드는지는 사람이 정하는 것이라 유도할 수 없다. 대신
   * **빠짐없음만** 여기서 강제한다.
   */
  it("어느 단계에도 안 들어간 분야가 없다", () => {
    const missing = CATEGORY_CHECKLISTS
      .map((category) => category.key)
      .filter((key) => !LIFECYCLE_PHASE_KEYS.includes(key));
    expect(missing, `단계에 안 들어간 분야: ${missing.join(", ")}`).toEqual([]);
  });

  it("한 분야가 두 단계에 겹쳐 들어가지 않는다", () => {
    const seen = new Set<string>();
    const duplicated = LIFECYCLE_PHASE_KEYS.filter((key) => {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    expect(duplicated, `두 단계에 겹친 분야: ${duplicated.join(", ")}`).toEqual([]);
  });
});
