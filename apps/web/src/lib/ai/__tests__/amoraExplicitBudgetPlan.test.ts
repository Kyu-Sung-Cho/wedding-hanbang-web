import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { parseExplicitBudgetPlanRequest } from "@/lib/ai/amoraExplicitBudgetPlan";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const ORIGINAL = "항목별 금액을 다시 줄게. 결혼식장·식사 900, 신혼여행 1000, 사진 500, 드레스·정장 300, 헤어·메이크업 200, 반지·선물 250, 초대장·꽃·하객선물 150, 예비비 200만 원이야. 이대로 실제 예산에 반영해줘.";

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
      { category: "custom", label: "헤어·메이크업", budget: 2_000_000 },
      { category: "custom", label: "반지·선물", budget: 2_500_000 },
      { category: "custom", label: "초대장·꽃·하객선물", budget: 1_500_000 },
      { category: "reserve", budget: 2_000_000 },
    ]);
    const schema = WEDDING_TOOLS.find(tool => tool.name === "apply_budget_plan")!.input_schema;
    const validate = new Ajv({ strict: false }).compile(schema);
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    const context = { coupleId: "10000000-0000-4000-8000-000000000001", requestKey: "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001", requestAttemptCount: 1, providerCallIndex: 1, weddingContext: { budget: 0, progress: {} } } as ToolExecutionContext;
    expect(buildAmoraAtomicToolOperation("apply_budget_plan", input!, context).result).toMatchObject({ success: true, toolOutput: { total_budget: 35_000_000, applied_count: 8 } });
    expect(context.weddingContext).toEqual({ budget: 0, progress: {} });
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
