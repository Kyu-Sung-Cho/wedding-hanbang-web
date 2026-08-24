import { describe, expect, it, vi } from "vitest";

import { sumAllocatedBudget, sumRecordedSpend } from "@/lib/budgetTotals";
import { executeTool } from "@/lib/ai/toolExecutor";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: vi.fn(), from: vi.fn() })),
}));

/**
 * 표면마다 예산 합계를 따로 세면 한 화면 안에서 숫자가 갈린다.
 *
 * 2026-08-24: 아모라 쪽만 커스텀 항목을 포함하도록 고치자, **한 장의 예산 카드
 * 안에서** 본문(커스텀 포함)과 바로 아래 막대 위젯(고정 카테고리만)이 서로 다른
 * 기록 지출을 보여줬다. 사용자에게는 아모라가 자기 말을 뒤집는 것으로 보인다.
 *
 * 세는 규칙의 정본은 예산 화면이다 — 지운 항목은 빼고, 직접 추가한 항목은 넣는다.
 */

const HIDDEN = "hanbok";

const PROGRESS: Record<string, unknown> = {
  venue: { category: "venue", status: "in_progress", budget: 20_000_000, spent: 10_000_000 },
  [HIDDEN]: { category: HIDDEN, status: "in_progress", budget: 3_000_000, spent: 1_000_000 },
  custom_1773727842937: { category: "custom_1773727842937", label: "차량 이동", status: "in_progress", budget: 1_200_000, spent: 3_000_000 },
  custom_hidden_one: { category: "custom_hidden_one", label: "지운 항목", status: "in_progress", budget: 500_000, spent: 500_000 },
  __hidden: [HIDDEN, "custom_hidden_one"],
};

// 예산 화면(BudgetContent)이 세는 것과 같은 값:
//   고정 보이는 것: venue 1,000만
//   커스텀 보이는 것: 차량 이동 300만
const EXPECTED_SPENT = 13_000_000;
const EXPECTED_ALLOCATED = 21_200_000;

function makeCtx(progress: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    requestKey: "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
    requestAttemptCount: 1,
    currentUserText: "",
    weddingContext: {
      weddingDate: null,
      budget: 50_000_000,
      venue: null,
      progress: progress as never,
    },
  };
}

describe("예산 합계는 어느 표면에서 세도 같다", () => {
  const fixedKeys = Object.keys(CATEGORY_LABELS);

  it("공용 함수가 지운 항목을 빼고 직접 추가한 항목을 넣는다", () => {
    expect(sumRecordedSpend(PROGRESS, fixedKeys)).toBe(EXPECTED_SPENT);
    expect(sumAllocatedBudget(PROGRESS, fixedKeys)).toBe(EXPECTED_ALLOCATED);
  });

  it("아모라의 예산 요약이 같은 숫자를 말한다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(PROGRESS));
    const out = result.toolOutput as { total_spent: number; total_allocated: number };
    expect(out.total_spent).toBe(EXPECTED_SPENT);
    expect(out.total_allocated).toBe(EXPECTED_ALLOCATED);
  });

  it("지운 커스텀 항목은 어느 쪽에도 안 들어간다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(PROGRESS));
    const out = result.toolOutput as { categories: { key: string }[] };
    expect(out.categories.some((c) => c.key === "custom_hidden_one")).toBe(false);
    expect(sumRecordedSpend(PROGRESS, fixedKeys)).not.toBe(EXPECTED_SPENT + 500_000);
  });

  it("progress 가 배열이나 null 이어도 죽지 않는다", () => {
    for (const bad of [null, undefined, [], "x", 3]) {
      expect(sumRecordedSpend(bad, fixedKeys)).toBe(0);
      expect(sumAllocatedBudget(bad, fixedKeys)).toBe(0);
    }
  });

  it("금액이 숫자가 아니거나 음수면 0으로 센다", () => {
    const messy = {
      venue: { category: "venue", budget: "2000만원", spent: -5 },
      custom_x1: { category: "custom_x1", label: "이상", budget: 1.5, spent: Number.MAX_VALUE },
    };
    expect(sumRecordedSpend(messy, fixedKeys)).toBe(0);
    expect(sumAllocatedBudget(messy, fixedKeys)).toBe(0);
  });

  it("`custom_` 뿐인 키는 항목으로 세지 않는다", () => {
    const odd = { custom_: { category: "custom_", budget: 9_000_000 } };
    expect(sumAllocatedBudget(odd, fixedKeys)).toBe(0);
  });
});
