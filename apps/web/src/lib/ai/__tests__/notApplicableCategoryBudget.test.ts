// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  applyAmoraAtomicToolResultToContext,
  buildAmoraAtomicToolOperation,
} from "@/lib/ai/amoraAtomicToolOperation";
import { assessAmoraBudgetChange } from "@/lib/ai/amoraBudgetChangeAssessment";
import {
  buildAmoraBudgetImpactPreview,
  findAmoraBudgetProposalRefusal,
} from "@/lib/ai/amoraBudgetImpactPreview";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * "안 해요"(not_applicable)로 끈 분야에도 예산은 잡을 수 있다.
 *
 * 2026-09-15 운영 재현: progress 가 {hanbok: 안 해요, yedan: 안 해요} 인 커플이
 * "총예산 3,500만 원으로 올리고 한복은 150만 원, 예단은 200만 원으로 잡아줘" 라고 한 뒤
 * 카드를 누르자 "현재 예산 데이터에 확인이 필요한 상태가 있어 예산안을 적용하지 않았어요."
 * 가 나왔다. 순수 연산의 상태 목록에 not_applicable 이 없었다.
 *
 * 계약(DB 와 공유): 예산 쓰기는 이 상태를 받아 그대로 보존한다. 체크리스트 항목 체크는
 * 계속 거절한다 — 체크하면 사용자가 끈 분야가 말없이 켜진다.
 */

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const LIVE_PLAN = {
  total_budget: 35_000_000,
  allocation_mode: "explicit",
  allocations: [
    { category: "hanbok", budget: 1_500_000 },
    { category: "yedan", budget: 2_000_000 },
  ],
};

function context(progress: Record<string, unknown>, budget = 30_000_000): ToolExecutionContext {
  return {
    coupleId: COUPLE_ID,
    weddingContext: {
      weddingDate: "2027-05-01",
      budget,
      venue: null,
      progress: progress as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

function liveContext(): ToolExecutionContext {
  return context({
    hanbok: { status: "not_applicable" },
    yedan: { status: "not_applicable" },
  });
}

function entryValues(mutation: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const entries = mutation.entries as Array<{ key: string; value: Record<string, unknown> }>;
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}

describe("안 해요로 끈 분야의 예산 쓰기", () => {
  it("운영 재현 예산안이 적용되고 두 분야의 '안 해요' 상태를 그대로 둔다", () => {
    const ctx = liveContext();
    const before = structuredClone(ctx);
    const op = buildAmoraAtomicToolOperation("apply_budget_plan", LIVE_PLAN, ctx, "a".repeat(64));

    expect(op.result.success).toBe(true);
    expect(op.domainMutation.kind).toBe("journey_budget_plan_cas");
    const values = entryValues(op.domainMutation);
    expect(values.hanbok).toEqual({ status: "not_applicable", category: "hanbok", budget: 1_500_000 });
    expect(values.yedan).toEqual({ status: "not_applicable", category: "yedan", budget: 2_000_000 });
    expect(op.result.displayMessage).toBe(
      // 영수증은 사용자가 읽으므로 예산 화면 이름을 쓴다(yedan = 두 가족에게 드릴 선물).
      "총예산 3,500만원 기준으로 2개 항목의 배분을 적용했어요. 한복·두 가족에게 드릴 선물은 '안 해요'로 표시된 분야라 진행률에는 계속 빠져 있어요.",
    );
    // 연산은 원본 문맥을 바꾸지 않는다.
    expect(ctx).toEqual(before);

    applyAmoraAtomicToolResultToContext(op.result, ctx);
    expect(ctx.weddingContext.progress.hanbok).toMatchObject({ status: "not_applicable", budget: 1_500_000 });
    expect(ctx.weddingContext.budget).toBe(35_000_000);
  });

  it("같은 예산안의 변경 미리보기도 만들어진다(카드에 영향 표가 붙는다)", () => {
    const ctx = liveContext();
    const identity = getAmoraToolOperationIdentity("apply_budget_plan", LIVE_PLAN);
    const preview = buildAmoraBudgetImpactPreview({
      action: { tool: "apply_budget_plan", input: LIVE_PLAN, inputDigest: identity.inputDigest },
      sourceRevision: 3,
      context: ctx,
    });
    expect(preview).toMatchObject({
      current: { totalBudget: 30_000_000, allocatedBudget: 0 },
      proposed: { totalBudget: 35_000_000, allocatedBudget: 3_500_000 },
    });
    expect(findAmoraBudgetProposalRefusal({ action: { tool: "apply_budget_plan", input: LIVE_PLAN }, context: ctx }))
      .toBeNull();
  });

  it("update_category_budget 도 적용하고 상태를 보존하며 영수증에 그 사실을 적는다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "not_applicable", memo: "간소화" } });
    const op = buildAmoraAtomicToolOperation(
      "update_category_budget",
      { category: "hanbok", budget: 1_500_000 },
      ctx,
      "b".repeat(64),
    );
    expect(op.result.success).toBe(true);
    expect(op.domainMutation).toMatchObject({
      kind: "journey_progress_entry_cas",
      key: "hanbok",
      value: { category: "hanbok", status: "not_applicable", memo: "간소화", budget: 1_500_000 },
    });
    expect(op.result.displayMessage).toBe(
      "한복 예산 정보를 변경했어요. 한복은 '안 해요'로 표시된 분야라 진행률에는 계속 빠져 있어요.",
    );
  });

  it("맞춤 항목도 상태를 보존한다", () => {
    const key = "custom_0123456789abcdef01234567";
    const ctx = context({ [key]: { category: key, label: "하객 버스", status: "not_applicable" } });
    const op = buildAmoraAtomicToolOperation(
      "add_custom_category",
      { label: "하객 버스", budget: 400_000 },
      ctx,
      "c".repeat(64),
    );
    expect(op.result.success).toBe(true);
    expect(op.domainMutation).toMatchObject({ value: { status: "not_applicable", budget: 400_000 } });
    expect(op.result.displayMessage).toBe(
      "기존 예산 항목 \"하객 버스\"을 업데이트했어요. 하객 버스는 '안 해요'로 표시된 분야라 진행률에는 계속 빠져 있어요.",
    );
  });

  it("평범한 분야의 영수증에는 안내를 붙이지 않는다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "in_progress" } });
    const op = buildAmoraAtomicToolOperation(
      "update_category_budget",
      { category: "hanbok", budget: 1_500_000 },
      ctx,
      "d".repeat(64),
    );
    expect(op.result.displayMessage).toBe("한복 예산 정보를 변경했어요.");
  });
});

describe("안 해요로 끈 분야의 체크리스트", () => {
  it("항목 체크는 계속 거절하고, 어느 분야인지와 되돌리는 길을 말한다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "not_applicable" } });
    const op = buildAmoraAtomicToolOperation(
      "toggle_checklist_item",
      { category: "hanbok", item_id: "hanbok_03", done: true },
      ctx,
      "e".repeat(64),
    );
    expect(op.domainMutation).toEqual({ kind: "none" });
    expect(op.result.success).toBe(false);
    expect(op.result.displayMessage).toBe(
      "한복은 '안 해요'로 표시한 분야라 항목을 체크하지 않았어요. 다시 준비하려면 체크리스트에서 상태를 바꿔 주세요.",
    );
  });
});

describe("알아볼 수 없는 상태 값은 여전히 막되 분야 이름을 말한다", () => {
  const broken = () => context({
    hanbok: { category: "hanbok", status: "archived" },
    yedan: { category: "yedan", status: "paused" },
  });

  it("update_category_budget", () => {
    const op = buildAmoraAtomicToolOperation(
      "update_category_budget",
      { category: "hanbok", budget: 1_500_000 },
      broken(),
      "f".repeat(64),
    );
    expect(op.result).toMatchObject({ success: false, toolOutput: { error: "progress_state_invalid" } });
    expect(op.result.displayMessage).toBe(
      "한복의 준비 상태 값을 알아볼 수 없어 예산을 변경하지 않았어요. 체크리스트에서 그 분야의 상태를 다시 골라 주세요.",
    );
  });

  it("apply_budget_plan 은 막힌 분야를 한 번에 모두 부른다", () => {
    const op = buildAmoraAtomicToolOperation("apply_budget_plan", LIVE_PLAN, broken(), "0".repeat(64));
    expect(op.result).toMatchObject({ success: false, toolOutput: { error: "progress_state_invalid" } });
    expect(op.result.displayMessage).toBe(
      "한복·두 가족에게 드릴 선물의 준비 상태 값을 알아볼 수 없어 예산안을 적용하지 않았어요. 체크리스트에서 그 분야의 상태를 다시 골라 주세요.",
    );
  });

  it("toggle_checklist_item", () => {
    const op = buildAmoraAtomicToolOperation(
      "toggle_checklist_item",
      { category: "hanbok", item_id: "hanbok_03", done: true },
      broken(),
      "1".repeat(64),
    );
    expect(op.result.success).toBe(false);
    expect(op.result.displayMessage).toContain("한복의 준비 상태 값을 알아볼 수 없어");
  });

  it("맞춤 항목에는 없는 화면 경로를 안내하지 않는다", () => {
    const key = "custom_0123456789abcdef01234567";
    const op = buildAmoraAtomicToolOperation(
      "add_custom_category",
      { label: "하객 버스", budget: 400_000 },
      context({ [key]: { category: key, label: "하객 버스", status: "archived" } }),
      "2".repeat(64),
    );
    expect(op.result.displayMessage).toBe("\"하객 버스\" 항목의 준비 상태 값을 알아볼 수 없어 예산을 변경하지 않았어요.");
  });
});

describe("누르면 거절될 예산 카드는 미리 알아본다", () => {
  it("연산이 거절하는 예산안이면 그 거절 문장을 돌려준다", () => {
    const ctx = context({
      hanbok: { category: "hanbok", status: "archived" },
      yedan: { category: "yedan", status: "not_applicable" },
    });
    expect(findAmoraBudgetProposalRefusal({ action: { tool: "apply_budget_plan", input: LIVE_PLAN }, context: ctx }))
      .toEqual({
        error: "progress_state_invalid",
        text: "한복의 준비 상태 값을 알아볼 수 없어 예산안을 적용하지 않았어요. 체크리스트에서 그 분야의 상태를 다시 골라 주세요.",
      });
  });

  it("예산 화면에서 뺀 분야도 같은 이유로 거른다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "not_started" }, __hidden: ["hanbok"] });
    const refusal = findAmoraBudgetProposalRefusal({
      action: { tool: "update_category_budget", input: { category: "hanbok", budget: 1_500_000 } },
      context: ctx,
    });
    expect(refusal).toMatchObject({ error: "category_hidden_by_user" });
    expect(refusal?.text).toContain("한복");
  });

  it("'않았어요' 없이 끝나는 거절에는 반영하지 않았다는 말을 덧붙인다", () => {
    const refusal = findAmoraBudgetProposalRefusal({
      action: { tool: "update_category_budget", input: { category: "not_a_category", budget: 1 } },
      context: liveContext(),
    });
    expect(refusal).toEqual({
      error: "invalid_category_budget",
      text: "예산 항목과 금액을 다시 확인해 주세요. 아직 반영하지 않았어요.",
    });
  });

  it("같은 값이라 바뀔 게 없는 경우, 게이트 밖 도구, 적용 가능한 경우는 거르지 않는다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "not_applicable", budget: 1_500_000 } });
    expect(findAmoraBudgetProposalRefusal({
      action: { tool: "update_category_budget", input: { category: "hanbok", budget: 1_500_000 } },
      context: ctx,
    })).toBeNull();
    // '안 해요' 분야의 체크리스트 체크는 이제 카드 발급 전에 거른다(리뷰 [2],
    // amoraProposalRefusalGate.test.ts). 순수 연산이 판정 전권을 갖지 않는 도구는 그대로 둔다.
    expect(findAmoraBudgetProposalRefusal({
      action: { tool: "update_task_status", input: { category: "hanbok", status: "completed" } },
      context: ctx,
    })).toBeNull();
    expect(findAmoraBudgetProposalRefusal({
      action: { tool: "update_category_budget", input: { category: "hanbok", budget: 1_600_000 } },
      context: ctx,
    })).toBeNull();
  });

  it("미리 돌려 봐도 원본 문맥과 입력은 그대로다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "archived" } });
    const input = structuredClone(LIVE_PLAN);
    const before = structuredClone({ ctx, input });
    findAmoraBudgetProposalRefusal({ action: { tool: "apply_budget_plan", input }, context: ctx });
    expect({ ctx, input }).toEqual(before);
  });
});

describe("결정적 단일 항목 경로도 같은 판정을 쓴다", () => {
  const request = "한복 예산을 100만원에서 150만원으로 변경해 주세요. 총예산, 다른 항목, 기록 지출, 분담은 그대로 두고 변경 확인 카드를 먼저 보여주세요. 아직 저장하지 마세요.";

  it("'안 해요' 분야는 카드가 준비된다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "not_applicable", budget: 1_000_000 } });
    expect(assessAmoraBudgetChange({ userText: request, context: ctx, sourceRevision: 4 })).toMatchObject({
      kind: "ready",
      action: { tool: "update_category_budget", input: { category: "hanbok", budget: 1_500_000 } },
    });
  });

  it("연산이 거절하는 상태면 막연한 안내 대신 그 이유를 말한다", () => {
    const ctx = context({ hanbok: { category: "hanbok", status: "archived", budget: 1_000_000 } });
    expect(assessAmoraBudgetChange({ userText: request, context: ctx, sourceRevision: 4 })).toEqual({
      kind: "needs_confirmation",
      reason: "operation_refused",
      text: "한복의 준비 상태 값을 알아볼 수 없어 예산을 변경하지 않았어요. 체크리스트에서 그 분야의 상태를 다시 골라 주세요.",
    });
  });
});

describe("프롬프트는 끈 분야를 '예정'으로 부르지 않는다", () => {
  function prompt(progress: Record<string, unknown>) {
    return getWeddingPlannerSystemPrompt({
      weddingDate: "2027-05-15",
      budget: 35_000_000,
      venue: null,
      progress: progress as never,
      preparationStatus: null,
      brideName: "신부",
      groomName: "신랑",
      bookings: [],
      scheduleEvents: [],
      chatSummaries: [],
      pastConflicts: [],
      pastDecisions: [],
    } as never);
  }

  it("고정 분야와 맞춤 항목 모두 '안 해요(진행률 제외)'로 싣는다", () => {
    const key = "custom_0123456789abcdef01234567";
    const text = prompt({
      hanbok: { category: "hanbok", status: "not_applicable" },
      [key]: { category: key, label: "하객 버스", status: "not_applicable", budget: 400_000 },
    });
    expect(text).toContain("한복(hanbok): 안 해요(진행률 제외)");
    expect(text).toContain(`(${key}): 안 해요(진행률 제외)`);
    expect(text).not.toContain("한복(hanbok): ⬜예정");
  });

  it("진행률 분모에서도 끈 분야를 뺀다", () => {
    const withSkipped = prompt({ hanbok: { status: "not_applicable" }, yedan: { status: "not_applicable" } });
    const withoutSkipped = prompt({});
    const total = Number(/진행률: 0\/(\d+)/.exec(withoutSkipped)?.[1]);
    expect(total).toBeGreaterThan(2);
    expect(withSkipped).toContain(`진행률: 0/${total - 2}`);
  });
});
