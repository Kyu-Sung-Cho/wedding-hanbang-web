import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { parseExplicitBudgetPlanRequest } from "@/lib/ai/amoraExplicitBudgetPlan";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { applyAmoraAtomicToolResultToContext, buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const ORIGINAL = "항목별 금액을 다시 줄게. 결혼식장·식사 900, 신혼여행 1000, 사진 500, 드레스·정장 300, 헤어·메이크업 200, 반지·선물 250, 초대장·꽃·하객선물 150, 예비비 200만 원이야. 이대로 실제 예산에 반영해줘.";

function budgetContext(progress: ToolExecutionContext["weddingContext"]["progress"]): ToolExecutionContext {
  return { coupleId: "10000000-0000-4000-8000-000000000001", requestKey: "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001", requestAttemptCount: 1, providerCallIndex: 1, weddingContext: { weddingDate: null, venue: null, budget: 0, progress } };
}

describe("explicit current-turn budget plan", () => {
  it("turns the exact reported eight amounts into a schema-valid atomic proposal without splitting names", () => {
    const input = parseExplicitBudgetPlanRequest(ORIGINAL);
    expect(input).not.toBeNull();
    expect(input?.total_budget).toBe(35_000_000);
    expect(input?.allocations).toEqual([
      { category: "custom", label: "결혼식장·식사", budget: 9_000_000 },
      { category: "honeymoon", budget: 10_000_000 },
      { category: "custom", label: "사진", budget: 5_000_000 },
      { category: "custom", label: "드레스·정장", budget: 3_000_000 },
      { category: "makeup", budget: 2_000_000 },
      { category: "custom", label: "반지·선물", budget: 2_500_000 },
      { category: "custom", label: "초대장·꽃·하객선물", budget: 1_500_000 },
      { category: "reserve", budget: 2_000_000 },
    ]);
    const schema = WEDDING_TOOLS.find(tool => tool.name === "apply_budget_plan")!.input_schema;
    const validate = new Ajv({ strict: false }).compile(schema);
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    const makeup = { category: "makeup", status: "completed", budget: 0, spent: 500_000, payer: "bride", checklist: [{ id: "makeup_1", done: true }] };
    const context = budgetContext({ makeup });
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", input!, context);
    expect(operation.result).toMatchObject({ success: true, toolOutput: { total_budget: 35_000_000, applied_count: 8 } });
    expect(operation.domainMutation).toMatchObject({ kind: "journey_budget_plan_cas", entries: expect.arrayContaining([
      { key: "makeup", expectedPresent: true, expected: makeup, value: { ...makeup, budget: 2_000_000 } },
    ]) });
    expect(context.weddingContext).toEqual({ weddingDate: null, venue: null, budget: 0, progress: { makeup } });
    applyAmoraAtomicToolResultToContext(operation.result, context);
    expect(context.weddingContext.progress.makeup).toEqual({ ...makeup, budget: 2_000_000 });
    expect(Object.keys(context.weddingContext.progress).filter(key => key.startsWith("custom_"))).toHaveLength(5);
    expect(buildAmoraAtomicToolOperation("apply_budget_plan", input!, context).result.toolOutput.error).toBe("no_change");
  });

  it.each([
    ["드레스·예식 정장", "dress"], ["헤어·메이크업", "makeup"],
    ["결혼반지·기념 선물", "ring"], ["가전·가구·생활용품", "houseware"],
    ["종이·모바일 초대장", "invitation"], ["결혼식 날 사진·영상", "snap"],
    ["손에 드는 꽃·꽃 장식", "bouquet"], ["결혼식 진행·축하 노래", "mc"],
  ])("uses the exact shared fixed label %s without guessing how to split it", (label, category) => {
    const input = parseExplicitBudgetPlanRequest(`${label} 200, 예비비 20만 원이야. 이대로 예산에 반영해줘.`);
    expect(input?.allocations).toEqual([{ category, budget: 2_000_000 }, { category: "reserve", budget: 200_000 }]);
  });

  it.each([["헤어·메이크업", "makeup"], ["신혼여행", "honeymoon"]])(
    "preserves an existing same-label custom key instead of moving %s into a fixed row",
    (label, fixedKey) => {
      const custom = { category: "custom_existing", label: ` ${label} `, budget: 1_000_000, spent: 700_000, payer: "groom", status: "completed", checklist: [{ id: "owned_1", done: true }], notes: "보존" };
      const fixed = { category: fixedKey, budget: 0, spent: 10_000, status: "in_progress", payer: "bride" };
      const progress = { custom_existing: custom, [fixedKey]: fixed, venue: { category: "venue", status: "completed", budget: 0, spent: 900_000 } };
      const context = budgetContext(progress);
      const text = `${label} 200, 예비비 20만 원이야. 이대로 예산에 반영해줘.`;
      const input = parseExplicitBudgetPlanRequest(text, progress);
      expect(input?.allocations[0]).toEqual({ category: "custom", label, budget: 2_000_000 });
      const operation = buildAmoraAtomicToolOperation("apply_budget_plan", input!, context);
      expect(operation.result.success).toBe(true);
      expect(operation.domainMutation).toMatchObject({ kind: "journey_budget_plan_cas", entries: expect.arrayContaining([
        { key: "custom_existing", expectedPresent: true, expected: custom, value: { ...custom, label, budget: 2_000_000 } },
      ]) });
      applyAmoraAtomicToolResultToContext(operation.result, context);
      expect(context.weddingContext.progress.custom_existing).toEqual({ ...custom, label, budget: 2_000_000 });
      expect(context.weddingContext.progress[fixedKey]).toEqual(fixed);
      expect(context.weddingContext.progress.venue).toEqual(progress.venue);
      expect(Object.keys(context.weddingContext.progress).filter(key => key.startsWith("custom_"))).toEqual(["custom_existing"]);
      const retry = parseExplicitBudgetPlanRequest(text, context.weddingContext.progress);
      expect(retry).toEqual(input);
      expect(buildAmoraAtomicToolOperation("apply_budget_plan", retry!, context).result.toolOutput.error).toBe("no_change");
    },
  );

  it("keeps duplicate custom labels behind the existing collision guard instead of bypassing it with a fixed key", () => {
    const progress = {
      custom_first: { category: "custom_first", status: "not_started", label: "헤어·메이크업", budget: 0 },
      custom_second: { category: "custom_second", status: "not_started", label: " 헤어·메이크업 ", budget: 0 },
    };
    const context = budgetContext(progress);
    const before = structuredClone(context.weddingContext);
    const input = parseExplicitBudgetPlanRequest("헤어·메이크업 200, 예비비 20만 원이야. 예산에 반영해줘.", progress);
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", input!, context);
    expect(operation.result).toMatchObject({ success: false, toolOutput: { error: "custom_category_collision" } });
    expect(operation.domainMutation).toEqual({ kind: "none" });
    expect(context.weddingContext).toEqual(before);
  });

  it.each([
    ["예산 배분: 사진 5,000,000원, 예비비 2,000,000원. 이대로 예산에 저장해주세요.", 7_000_000],
    ["총예산 700만 원. 사진 500만 원, 예비비 200만 원. 실제 예산에 반영해줘.", 7_000_000],
    ["사진 500\n예비비 0만 원. 예산에 적용해줘.", 5_000_000],
  ])("accepts only fully specified units and matching totals: %s", (text, total) => {
    expect(parseExplicitBudgetPlanRequest(text)?.total_budget).toBe(total);
  });

  it.each([
    ORIGINAL.replace("반영해줘", "반영하지 마"),
    ORIGINAL.replace("반영해줘", "반영하지 말아줘"),
    ORIGINAL.replace("반영해줘", "반영할까?"),
    `예시야. ${ORIGINAL}`,
    `"${ORIGINAL}"`,
    `지난 대화: ${ORIGINAL}`,
    ORIGINAL.replace("금액을 다시 줄게", "금액은 대략 줄게"),
    ORIGINAL.replace("900,", "900~1000,"),
    ORIGINAL.replace("900,", "900.5,"),
    ORIGINAL.replace("900,", "-900,"),
    ORIGINAL.replace("200만 원이야", "200이야"),
    ORIGINAL.replace("사진 500", "사진"),
    ORIGINAL.replace("사진 500", "사진 500원"),
    ORIGINAL.replace("사진 500", "신혼여행 500"),
    `총예산 3400만 원. ${ORIGINAL}`,
    ORIGINAL.replace("예비비 200만 원이야", "예비비 200000만 원이야"),
    `${ORIGINAL} 기존 항목은 모두 지워줘.`,
    ORIGINAL.replace("이대로 실제 예산에 반영해줘.", ""),
    "총예산 3500만 원으로 저장해줘.",
    "이전 금액대로 실제 예산에 반영해줘.",
    "사진 1,00원, 예비비 200원. 예산에 반영해줘.",
    "사진 500만원, 예비비 200만원, . 예산에 반영해줘.",
    "할 일 삭제 500만원, 예비비 200만원. 예산에 반영해줘.",
  ])("does not invent a proposal from ambiguous, quoted, incomplete, or refused input: %s", text => {
    expect(parseExplicitBudgetPlanRequest(text)).toBeNull();
  });

  it("requires custom labels while rejecting a label attached to a fixed category in the real tool schema", () => {
    const schema = WEDDING_TOOLS.find(tool => tool.name === "apply_budget_plan")!.input_schema;
    const validate = new Ajv({ strict: false }).compile(schema);
    const wrap = (allocation: unknown) => ({ total_budget: 1, intake_summary: "현재 명시한 배분", allocations: [allocation] });
    expect(validate(wrap({ category: "custom", label: "사진과 식사", budget: 1 }))).toBe(true);
    expect(validate(wrap({ category: "custom", budget: 1 }))).toBe(false);
    expect(validate(wrap({ category: "venue", label: "사진과 식사", budget: 1 }))).toBe(false);
    expect(validate(wrap({ category: "custom", label: "사진과 식사", budget: 1, spent: 1 }))).toBe(false);
  });
});
