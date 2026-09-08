import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { sumAllocatedBudget, sumRecordedSpend } from "@/lib/budgetTotals";
import { executeTool } from "@/lib/ai/toolExecutor";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import BudgetTab from "@/components/app/chat/panel/BudgetTab";
import ActionCard from "@/components/app/chat/ActionCard";
import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

const fixture = vi.hoisted(() => ({ journey: { total_budget: 50_000_000, progress: {} as Record<string, unknown> } }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => fixture }));

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
  custom_hidden_one: { category: "custom_hidden_one", label: "차량 장식", status: "in_progress", budget: 500_000, spent: 500_000 },
  __hidden: [HIDDEN, "custom_hidden_one"],
};

// 예산 화면(BudgetContent)이 세는 것과 같은 값:
//   고정 보이는 것: venue 1,000만
//   커스텀 보이는 것: 차량 이동 300만 + 차량 장식 50만
// __hidden 은 고정 분야만 숨긴다. 사용자 항목 삭제는 금액/키 제거로 저장된다.
const EXPECTED_SPENT = 13_500_000;
const EXPECTED_ALLOCATED = 21_700_000;

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

  it("고정 분야만 숨기고 저장된 사용자 항목은 오래된 숨김 표시가 있어도 센다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(PROGRESS));
    const out = result.toolOutput as { categories: { key: string }[] };
    expect(out.categories.some((c) => c.key === "custom_hidden_one")).toBe(true);
    expect(out.categories.some((c) => c.key === HIDDEN)).toBe(false);
    expect(sumRecordedSpend(PROGRESS, fixedKeys)).toBe(EXPECTED_SPENT);
  });

  it("같은 저장 데이터의 예산 패널·요약 도구·막대 카드·변경 미리보기가 일치한다", async () => {
    const before = structuredClone(PROGRESS);
    fixture.journey.progress = PROGRESS;
    const context = makeCtx(PROGRESS);
    const result = await executeTool("get_budget_summary", {}, context);
    const input = { total_budget: 51_000_000 };
    const identity = getAmoraToolOperationIdentity("update_budget", input);
    const preview = buildAmoraBudgetImpactPreview({
      action: { tool: "update_budget", input, inputDigest: identity.inputDigest },
      sourceRevision: 1,
      context,
    });
    const panel = document.createElement("div");
    panel.innerHTML = renderToStaticMarkup(createElement(BudgetTab));
    const card = document.createElement("div");
    card.innerHTML = renderToStaticMarkup(createElement(ActionCard, { result }));
    expect(panel.textContent).toContain("기록 지출1,350만원");
    expect(panel.textContent).toContain("차량 장식");
    expect(preview?.current).toMatchObject({
      allocatedBudget: EXPECTED_ALLOCATED,
      recordedSpend: EXPECTED_SPENT,
      unallocatedBudget: 28_300_000,
    });
    expect(result.toolOutput).toMatchObject({
      total_allocated: preview?.current.allocatedBudget,
      total_spent: preview?.current.recordedSpend,
      unallocated: preview?.current.unallocatedBudget,
    });
    expect(card.textContent).toContain("기록 지출 총 1,350만원 / 5,000만원");
    expect(PROGRESS).toEqual(before);
  });

  it("실제로 키를 삭제한 사용자 항목은 요약과 합계에서도 빠진다", async () => {
    const deleted = { ...PROGRESS };
    delete deleted.custom_hidden_one;
    const result = await executeTool("get_budget_summary", {}, makeCtx(deleted));
    expect(result.toolOutput).toMatchObject({ total_spent: 13_000_000, total_allocated: 21_200_000 });
    expect(sumRecordedSpend(deleted, fixedKeys)).toBe(13_000_000);
    expect(sumAllocatedBudget(deleted, fixedKeys)).toBe(21_200_000);
  });

  it("숨긴 고정 분야는 요약 문구뿐 아니라 카드의 항목별 막대에서도 빠진다", async () => {
    const progress: Record<string, unknown> = { ...PROGRESS, __hidden: [...PROGRESS.__hidden as string[], "venue"] };
    fixture.journey.progress = progress;
    const result = await executeTool("get_budget_summary", {}, makeCtx(progress));
    const card = document.createElement("div");
    card.innerHTML = renderToStaticMarkup(createElement(ActionCard, { result }));
    expect(result.toolOutput).toMatchObject({ total_allocated: 1_700_000, total_spent: 3_500_000 });
    expect(card.textContent).toContain("기록 지출 총 350만원 / 5,000만원");
    expect(card.textContent).not.toContain(CATEGORY_LABELS.venue);
    expect(progress.venue).toEqual(PROGRESS.venue);
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
