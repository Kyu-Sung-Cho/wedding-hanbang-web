// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseExplicitBudgetPlanRequest } from "@/lib/ai/amoraExplicitBudgetPlan";
import { assessAmoraBudgetChange } from "@/lib/ai/amoraBudgetChangeAssessment";
import { applyAmoraAtomicToolResultToContext, buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const REQUEST = "신혼여행 예산은 8,001,000원, 예비비·사용처 미정은 1,999,000원으로 배분해줘. 두 항목만 바꾸고 기존 총예산, 나머지 항목, 기록 지출과 분담은 유지해줘. 아직 적용하지 말고 변경 확인 카드를 먼저 보여줘.";
const PREVIOUS_LIVE_REQUEST = "신혼여행 예산은 801만 원, 예비비·사용처 미정은 200만 원으로 배분해줘. 두 항목만 반영하고 기존 총예산, 나머지 항목, 기록 지출과 분담은 유지해줘. 적용할 변경 내용을 먼저 보여줘.";

function fixture() {
  const progress = {
    honeymoon: { category: "honeymoon", status: "in_progress", budget: 8_000_000, spent: 0, payer: "couple", memo: "기존 여행 메모" },
    reserve: { category: "reserve", status: "not_started", budget: 2_000_000, spent: 0, payer: "couple" },
    venue: { category: "venue", status: "completed", budget: 24_000_000, spent: 123_000, payer: "both_parents", checklist: [{ id: "venue_1", done: true }] },
  };
  const context: ToolExecutionContext = {
    coupleId: "10000000-0000-4000-8000-000000000001",
    weddingContext: { weddingDate: null, venue: null, budget: 35_000_000, progress },
  };
  return { progress, context };
}

describe("explicit allocation confirmation-only request", () => {
  it("parses the exact live two-category request as a proposal and preserves the untouched ledger", () => {
    const { progress, context } = fixture();
    const before = structuredClone(context);
    const input = parseExplicitBudgetPlanRequest(REQUEST, progress, context.weddingContext.budget);
    expect(input).toMatchObject({ total_budget: 35_000_000, allocations: [
      { category: "honeymoon", budget: 8_001_000 },
      { category: "reserve", budget: 1_999_000 },
    ] });
    if (!input) throw new Error("The complete confirmation-only allocation must produce a proposal");
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", { ...input, allocation_mode: "explicit" }, context);
    expect(operation.result.success).toBe(true);
    expect(operation.domainMutation).toMatchObject({ kind: "journey_budget_plan_cas", expectedBudget: 35_000_000, valueBudget: 35_000_000 });
    expect(context).toEqual(before);
    applyAmoraAtomicToolResultToContext(operation.result, context);
    expect(context.weddingContext.progress.honeymoon).toEqual({ ...progress.honeymoon, budget: 8_001_000 });
    expect(context.weddingContext.progress.reserve).toEqual({ ...progress.reserve, budget: 1_999_000 });
    expect(context.weddingContext.progress.venue).toEqual(before.weddingContext.progress.venue);
    expect(buildAmoraAtomicToolOperation("apply_budget_plan", { ...input, allocation_mode: "explicit" }, context).result.toolOutput.error).toBe("no_change");
  });

  it("also handles the earlier live failure without changing its requested amounts", () => {
    const { progress, context } = fixture();
    expect(parseExplicitBudgetPlanRequest(PREVIOUS_LIVE_REQUEST, progress, context.weddingContext.budget))
      .toMatchObject({ total_budget: 35_000_000, allocations: [
        { category: "honeymoon", budget: 8_010_000 }, { category: "reserve", budget: 2_000_000 },
      ] });
  });

  it.each([
    REQUEST.replace("신혼여행 예산은", "신혼여행").replace("예비비·사용처 미정은", "예비비"),
    REQUEST.replace("8,001,000원, ", "8001000원\n").replace("1,999,000원", "1999000원"),
    REQUEST.replace("두 항목만 바꾸고", "2 항목만 변경하고"),
    REQUEST.replace("두 항목만 바꾸고", "명시한 항목만 조정하고").replace("배분해줘", "배정해주세요"),
    REQUEST.replace("기존 총예산, 나머지 항목, 기록 지출과 분담은 유지해줘.", "기록한 지출 및 분담 비율, 다른 항목과 총액은 그대로 유지해주세요."),
    REQUEST.replace("기존 총예산, 나머지 항목, 기록 지출과 분담은 유지해줘.", "기존 총예산은 유지해줘. 나머지 항목은 그대로 둬. 기록 지출과 분담은 유지해줘."),
    REQUEST.replace("기존 총예산, 나머지 항목, 기록 지출과 분담은 유지해줘. 아직 적용하지 말고 변경 확인 카드를 먼저 보여줘.", "총예산과 다른 항목, 기록 지출, 분담은 그대로 두고 변경 확인 카드만 먼저 보여주세요. 아직 저장하지 마세요."),
    REQUEST.replace("아직 적용하지 말고 변경 확인 카드를 먼저 보여줘.", "확인 카드를 먼저 보여줘."),
  ])("fully consumes natural wording variants without loosening the proposal boundary: %s", text => {
    const { progress, context } = fixture();
    expect(parseExplicitBudgetPlanRequest(text, progress, context.weddingContext.budget))
      .toMatchObject({ total_budget: 35_000_000, allocations: [
        { category: "honeymoon", budget: 8_001_000 }, { category: "reserve", budget: 1_999_000 },
      ] });
  });

  it.each([
    `"${REQUEST}"라고 말해도 돼?`,
    `예시야. ${REQUEST}`,
    `내 개인 상담에만 답해줘. ${REQUEST}`,
    REQUEST + " 내일만 적용해줘.",
    REQUEST + " 지금 바로 적용해줘.",
    REQUEST + " 아니 취소해줘.",
    REQUEST.replace("두 항목만", "세 항목만"),
    REQUEST.replace("두 항목만 바꾸고", "두 항목을 삭제하고"),
    REQUEST.replace("분담은 유지해줘", "분담은 반반으로 바꿔줘"),
    REQUEST.replace("분담은", "constructor는"),
    REQUEST.replace("분담은", "toString는"),
    REQUEST.replace("분담은", "__proto__는"),
    REQUEST.replace("기록 지출과 ", ""),
    REQUEST.replace("총예산,", "총예산은 4000만원으로 바꾸고,"),
    REQUEST.replace("나머지 항목,", "총예산,"),
    REQUEST.replace("8,001,000원", "8,001,000원이나 8,002,000원"),
    REQUEST.replace("8,001,000원", "8,001,000원 이하"),
    REQUEST.replace("8,001,000원", "-8,001,000원"),
    REQUEST.replace("8,001,000원", "8,001,000.5원"),
    REQUEST.replace("8,001,000원", "8,00,1000원"),
    REQUEST.replace("8,001,000원", "8001000"),
    REQUEST.replace("8,001,000원", "9007199254740992원"),
    REQUEST.replace("배분해줘.", "배분해줘. 상대가 동의하면"),
    REQUEST.replace("변경 확인 카드를 먼저 보여줘", "변경 확인 카드도 만들지 마"),
    REQUEST.replace("아직 적용하지 말고 변경 확인 카드를 먼저 보여줘.", "바로 예산에 적용해줘."),
    REQUEST.replace("1,999,000원으로", "1,999,000원, 으로"),
    REQUEST.replace("예비비·사용처 미정은", "신혼여행은"),
    REQUEST.replace("신혼여행 예산은", "새로운 여행비는"),
  ])("does not discard extra conditions, refusals, unknown labels, or malformed amounts: %s", text => {
    const { progress, context } = fixture();
    const before = structuredClone(progress);
    expect(parseExplicitBudgetPlanRequest(text, progress, context.weddingContext.budget)).toBeNull();
    expect(progress).toEqual(before);
  });

  it.each([undefined, 0, -1, NaN, Infinity])("does not infer a preserved total from unavailable current data: %s", total => {
    expect(parseExplicitBudgetPlanRequest(REQUEST, fixture().progress, total)).toBeNull();
  });

  it("rejects hidden, missing and ambiguous current targets", () => {
    const { progress } = fixture();
    expect(parseExplicitBudgetPlanRequest(REQUEST, { ...progress, __hidden: ["honeymoon"] }, 35_000_000)).toBeNull();
    expect(parseExplicitBudgetPlanRequest(REQUEST, { ...progress, __hidden: "honeymoon" }, 35_000_000)).toBeNull();
    expect(parseExplicitBudgetPlanRequest(REQUEST, { venue: progress.venue, reserve: progress.reserve }, 35_000_000)).toBeNull();
    expect(parseExplicitBudgetPlanRequest(REQUEST, {
      ...progress, custom_duplicate: { ...progress.honeymoon, category: "custom_duplicate", label: "신혼여행" },
    }, 35_000_000)).toBeNull();
  });

  it("does not create a new custom row or move an existing exact custom label", () => {
    const { progress, context } = fixture();
    const named = { ...progress.honeymoon, category: "custom_travel", label: "여행 교통비" };
    const customProgress = { venue: progress.venue, reserve: progress.reserve, custom_travel: named };
    context.weddingContext.progress = customProgress;
    const input = parseExplicitBudgetPlanRequest(REQUEST.replace("신혼여행 예산은", "여행 교통비는"), customProgress, 35_000_000);
    expect(input?.allocations[0]).toEqual({ category: "custom", label: "여행 교통비", budget: 8_001_000 });
    if (!input) throw new Error("An existing unambiguous custom label must produce a proposal");
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", { ...input, allocation_mode: "explicit" }, context);
    expect(operation.result.success).toBe(true);
    expect(context.weddingContext.progress).toEqual(customProgress);
    applyAmoraAtomicToolResultToContext(operation.result, context);
    expect(context.weddingContext.progress.custom_travel).toEqual({ ...named, budget: 8_001_000 });
    expect(Object.keys(context.weddingContext.progress)).toEqual(expect.arrayContaining(["venue", "reserve", "custom_travel"]));
    expect(Object.keys(context.weddingContext.progress).filter(key => key.startsWith("custom_"))).toEqual(["custom_travel"]);
    expect(context.weddingContext.progress.honeymoon).toBeUndefined();
  });

  it("does not interpret a budget suffix as permission to pick between two real labels", () => {
    const { progress } = fixture();
    expect(parseExplicitBudgetPlanRequest(REQUEST, {
      ...progress, custom_named: { ...progress.honeymoon, category: "custom_named", label: "신혼여행 예산" },
    }, 35_000_000)).toBeNull();
  });

  it("keeps an over-total proposal behind the existing atomic rejection", () => {
    const { progress, context } = fixture();
    const before = structuredClone(context);
    const input = parseExplicitBudgetPlanRequest(REQUEST.replace("8,001,000원", "40,001,000원"), progress, 35_000_000);
    expect(input?.total_budget).toBe(35_000_000);
    if (!input) throw new Error("Explicit amounts must reach the existing ledger guard");
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", { ...input, allocation_mode: "explicit" }, context);
    expect(operation.result).toMatchObject({ success: false, toolOutput: { error: "budget_allocations_exceed_total" } });
    expect(operation.domainMutation).toEqual({ kind: "none" });
    expect(context).toEqual(before);
  });

  it("leaves the single-category assessment outside this multi-category request", () => {
    const { context } = fixture();
    expect(assessAmoraBudgetChange({ userText: REQUEST, context, sourceRevision: 12 })).toBeNull();
  });

  it("already resolves the current reserve display label in the existing complete-list path", () => {
    const { progress } = fixture();
    expect(parseExplicitBudgetPlanRequest("신혼여행 8,001,000원, 예비비·사용처 미정 1,999,000원. 예산에 반영해줘.", progress, 35_000_000)?.allocations)
      .toEqual([{ category: "honeymoon", budget: 8_001_000 }, { category: "reserve", budget: 1_999_000 }]);
  });
});
