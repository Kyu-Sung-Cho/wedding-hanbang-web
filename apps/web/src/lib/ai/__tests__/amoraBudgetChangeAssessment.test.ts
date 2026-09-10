// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessAmoraBudgetChange } from "@/lib/ai/amoraBudgetChangeAssessment";
import { applyAmoraAtomicToolResultToContext, buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const CUSTOM = "custom_19324031db47e6ee6f64cb6a";
const LABEL = "초대장·꽃·하객선물";
const REQUEST = `${LABEL} 예산을 150만원에서 1,000만원으로 올려서 반영해줘. 총예산은 3,500만원 그대로 두고 나머지 항목은 하나도 줄이지 마. 총액을 넘으면 저장하지 말고 먼저 부족한 금액을 알려줘.`;

function context(otherBudget = 32_500_000): ToolExecutionContext {
  return {
    coupleId: "10000000-0000-4000-8000-000000000001",
    weddingContext: {
      weddingDate: "2027-05-01", budget: 35_000_000, venue: null,
      progress: {
        venue: { category: "venue", status: "in_progress", budget: otherBudget, spent: 123_000, payer: "bride", memo: "기존 메모", cost: 999_000 },
        [CUSTOM]: { category: CUSTOM, status: "not_started", label: LABEL, budget: 1_500_000, spent: 0, payer: "couple", memo: "사용자 항목 메모" },
      } as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

function assess(ctx = context(), userText = REQUEST, sourceRevision: number | null = 8) {
  return assessAmoraBudgetChange({ userText, context: ctx, sourceRevision });
}

describe("conditional Amora single-category budget assessment", () => {
  it("uses allocated 3400, not total 3500, for the live over-budget refusal without mutating the ledger", () => {
    const ctx = context();
    const before = structuredClone(ctx);
    const result = assess(ctx);
    expect(result?.kind).toBe("blocked");
    if (result?.kind !== "blocked") throw new Error("Expected deterministic refusal");
    expect(result.preview.current).toEqual({ totalBudget: 35_000_000, allocatedBudget: 34_000_000, recordedSpend: 123_000, unallocatedBudget: 1_000_000 });
    expect(result.preview.proposed).toEqual({ totalBudget: 35_000_000, allocatedBudget: 42_500_000, recordedSpend: 123_000, unallocatedBudget: -7_500_000 });
    expect(result.preview.delta).toEqual({ totalBudget: 0, allocatedBudget: 8_500_000, recordedSpend: 0, unallocatedBudget: -8_500_000 });
    expect(result.text).toContain("4,250만원");
    expect(result.text).toContain("750만원");
    expect(result.text).not.toContain("4,350만원");
    expect(result).not.toHaveProperty("action");
    expect(ctx).toEqual(before);
  });

  it("returns only the exact existing category budget proposal when the unchanged total can cover it", () => {
    const ctx = context(24_500_000);
    const before = structuredClone(ctx);
    const result = assess(ctx);
    expect(result?.kind).toBe("ready");
    if (result?.kind !== "ready") throw new Error("Expected approval proposal");
    expect(result.action).toEqual({ tool: "add_custom_category", input: { label: LABEL, budget: 10_000_000 } });
    expect(result.preview.proposed).toEqual({ totalBudget: 35_000_000, allocatedBudget: 34_500_000, recordedSpend: 123_000, unallocatedBudget: 500_000 });
    expect(result.preview.categories).toHaveLength(1);
    expect(result.preview.categories[0].key).toBe(CUSTOM);
    expect(ctx).toEqual(before);
  });

  it("replays a ready proposal through the real pure operation with nonzero spend, payer and memo preserved", () => {
    const ctx = context(24_500_000);
    const row = ctx.weddingContext.progress[CUSTOM] as unknown as Record<string, unknown>;
    row.spent = 456_789;
    row.payment_date = "2026-09-09";
    row.notes = { reference: "보존할 추가 정보" };
    const before = structuredClone(ctx);
    const result = assess(ctx);
    if (result?.kind !== "ready") throw new Error("Expected approval proposal");
    const operation = buildAmoraAtomicToolOperation(result.action.tool, result.action.input, ctx);
    expect(operation.result.success).toBe(true);
    expect(ctx).toEqual(before);
    const applied = structuredClone(ctx);
    applyAmoraAtomicToolResultToContext(operation.result, applied);
    expect(applied.weddingContext.progress).toEqual({
      ...before.weddingContext.progress,
      [CUSTOM]: { ...before.weddingContext.progress[CUSTOM], budget: 10_000_000 },
    });
    expect(applied.weddingContext.budget).toBe(before.weddingContext.budget);
    expect(result.preview.proposed.recordedSpend).toBe(579_789);
  });

  it("does not invent a current state revision", () => {
    expect(assess(context(), REQUEST, null)).toMatchObject({ kind: "needs_confirmation", reason: "budget_unavailable" });
  });

  it("does not assess an unrelated budget lookup", () => {
    expect(assess(context(), "현재 총예산, 배정 합계, 미배정 금액을 알려줘.")).toBeNull();
  });

  it("rejects a stale stated category amount rather than trusting the old conversation", () => {
    expect(assess(context(), REQUEST.replace("150만원에서", "200만원에서"))).toMatchObject({ kind: "needs_confirmation", reason: "amount_changed" });
  });

  it("handles explicit shared arrow units and an unchanged canonical total without inventing the total", () => {
    const request = `${LABEL}예산을150→1000만원으로올려반영.총예산그대로나머지줄이지마.총액넘으면저장하지말고부족액알려줘`;
    expect(assess(context(), request)).toMatchObject({ kind: "blocked", preview: { proposed: { allocatedBudget: 42_500_000, unallocatedBudget: -7_500_000 } } });
  });

  it.each([
    [33_500_000, "blocked", 43_500_000, -8_500_000],
    [25_000_000, "ready", 35_000_000, 0],
    [0, "ready", 10_000_000, 25_000_000],
  ])("uses all actual allocations at boundary %i", (otherBudget, kind, allocatedBudget, unallocatedBudget) => {
    expect(assess(context(otherBudget))).toMatchObject({ kind, preview: { proposed: { allocatedBudget, unallocatedBudget } } });
  });

  it("preserves exact won precision for a fixed category and ignores legacy cost", () => {
    const ctx = context(15_001);
    ctx.weddingContext.budget = 2_000_000;
    const request = "결혼식장 예산을 15,001원에서 20,003원으로 올려서 반영해줘. 총예산은 200만원 그대로 두고 나머지 항목은 줄이지 마. 총액을 넘으면 저장하지 말고 부족액을 알려줘.";
    expect(assess(ctx, request)).toMatchObject({ kind: "ready", action: { tool: "update_category_budget", input: { category: "venue", budget: 20_003 } }, preview: { delta: { allocatedBudget: 5_002, recordedSpend: 0 }, proposed: { allocatedBudget: 1_520_003, recordedSpend: 123_000 } } });
  });

  it("computes a reduction that still exceeds the total without claiming a positive increase", () => {
    const request = REQUEST.replace("1,000만원으로 올려서", "100만원으로 줄여서");
    const result = assess(context(35_000_000), request);
    expect(result).toMatchObject({ kind: "blocked", preview: { proposed: { allocatedBudget: 36_000_000, unallocatedBudget: -1_000_000 }, delta: { allocatedBudget: -500_000 } } });
    if (result?.kind !== "blocked") throw new Error("Expected refusal");
    expect(result.text).toContain("100만원");
    expect(result.text).not.toContain("더하면");
  });

  it.each([
    ["unstated money unit", REQUEST.replace("3,500만원", "3500")],
    ["ambiguous old unit without arrow", REQUEST.replace("150만원에서", "150에서")],
    ["extra reallocation", REQUEST + " 예비비는 50만원 줄여줘."],
    ["second target", REQUEST.replace(". 총예산", ", 결혼식장도 100만원 올려줘. 총예산")],
    ["conflicting total increase", REQUEST + " 총예산도 4,000만원으로 올려줘."],
    ["contradictory direction", REQUEST.replace("올려서", "줄여서")],
    ["decimal amount", REQUEST.replace("150만원에서", "150.5만원에서")],
    ["negative amount", REQUEST.replace("150만원에서", "-150만원에서")],
    ["overflow amount", REQUEST.replace("1,000만원으로", "9007199254740992원으로")],
    ["quoted example", `예시: “${REQUEST}”`],
    ["hypothetical", `가정해보자. ${REQUEST}`],
    ["cancelled request", REQUEST + " 방금 요청은 취소해."],
    ["only report and do not propose", REQUEST + " 계산만 하고 승인 카드는 만들지 마."],
  ])("does not drop unsupported instructions: %s", (_name, request) => {
    const ctx = context(0);
    const before = structuredClone(ctx);
    const result = assess(ctx, request);
    expect(result).toMatchObject({ kind: "needs_confirmation", reason: "request_unclear" });
    expect(result).not.toHaveProperty("action");
    expect(result).not.toHaveProperty("preview");
    expect(ctx).toEqual(before);
  });

  it("rejects a declared total that changed since the previous chat", () => {
    const ctx = context();
    ctx.weddingContext.budget = 36_000_000;
    expect(assess(ctx)).toMatchObject({ kind: "needs_confirmation", reason: "total_changed" });
  });

  it.each([null, -1, Number.NaN, 1.5])("requires a valid current revision (%s)", revision => {
    expect(assess(context(), REQUEST, revision)).toMatchObject({ kind: "needs_confirmation", reason: "budget_unavailable" });
  });

  it("does not interpret an unset total as an approved zero cap", () => {
    const ctx = context();
    ctx.weddingContext.budget = 0;
    expect(assess(ctx)).toMatchObject({ kind: "needs_confirmation", reason: "budget_unavailable" });
  });

  it.each([
    ["duplicate custom label", "category_ambiguous", (p: Record<string, unknown>) => { p.custom_second = { ...(p[CUSTOM] as object), label: ` ${LABEL} ` }; }],
    ["fixed and custom label collision", "category_ambiguous", (p: Record<string, unknown>) => { (p[CUSTOM] as Record<string, unknown>).label = "결혼식장"; }],
    ["fuzzy label", "category_ambiguous", (p: Record<string, unknown>) => { (p[CUSTOM] as Record<string, unknown>).label = "초대장·꽃·하객선물 추가"; }],
    ["missing previous budget", "amount_changed", (p: Record<string, unknown>) => { delete (p[CUSTOM] as Record<string, unknown>).budget; }],
    ["non-finite other amount", "invalid_budget_state", (p: Record<string, unknown>) => { (p.venue as Record<string, unknown>).budget = Number.NaN; }],
    ["unknown allocated row", "invalid_budget_state", (p: Record<string, unknown>) => { p.unknown = { budget: 5_000_000 }; }],
    ["invalid custom name", "invalid_budget_state", (p: Record<string, unknown>) => { p.custom_broken = { budget: 5_000_000, label: "" }; }],
    ["invalid hidden field", "invalid_budget_state", (p: Record<string, unknown>) => { p.__hidden = "venue"; }],
  ] as const)("fails closed on %s", (_name, reason, mutate) => {
    const ctx = context();
    mutate(ctx.weddingContext.progress);
    const before = structuredClone(ctx);
    const request = _name === "fixed and custom label collision" ? REQUEST.replace(LABEL, "결혼식장") : REQUEST;
    expect(assess(ctx, request)).toMatchObject({ kind: "needs_confirmation", reason });
    expect(ctx).toEqual(before);
  });

  it("excludes hidden fixed rows from allocation while retaining named custom categories", () => {
    const ctx = context();
    const p = ctx.weddingContext.progress as Record<string, unknown>;
    p.__hidden = ["venue", CUSTOM];
    expect(assess(ctx)).toMatchObject({ kind: "ready", preview: { current: { allocatedBudget: 1_500_000 }, proposed: { allocatedBudget: 10_000_000 } } });
    expect(assess(ctx, REQUEST.replace(LABEL, "결혼식장"))).toMatchObject({ kind: "needs_confirmation", reason: "category_hidden" });
  });

  it("does not intercept ordinary changes without a total-cap condition", () => {
    expect(assess(context(), `${LABEL} 예산을 1000만원으로 올려줘.`)).toBeNull();
  });
});
