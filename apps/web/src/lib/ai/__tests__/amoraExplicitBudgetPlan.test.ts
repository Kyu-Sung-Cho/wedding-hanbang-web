import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { parseExplicitBudgetPlanRequest } from "@/lib/ai/amoraExplicitBudgetPlan";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { applyAmoraAtomicToolResultToContext, buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const ORIGINAL = "항목별 금액을 다시 줄게. 결혼식장·식사 900, 신혼여행 1000, 사진 500, 드레스·정장 300, 헤어·메이크업 200, 반지·선물 250, 초대장·꽃·하객선물 150, 예비비 200만 원이야. 이대로 실제 예산에 반영해줘.";
const NATURAL_TOTAL = "총 결혼 예산은 3500만 원이야. 항목별 금액을 줄게. 결혼식장·식사 900, 신혼여행 1000, 사진 500, 드레스·정장 300, 헤어·메이크업 200, 반지·선물 250, 초대장·꽃·하객선물 150, 예비비 200만 원이야. 이대로 실제 예산에 반영해줘.";
const EXPLICIT_UPDATE = "기존 예산의 초대장·꽃·하객선물은 새 항목을 만들지 말고 같은 이름의 금액을 150만 원에서 160만 원으로 바꿔줘. 총액은 3500만원으로 유지하고 예비비만 200만원에서 190만원으로 줄일게. 최종 배분은 결혼식장·식사 900, 신혼여행 1000, 사진 500, 드레스·정장 300, 헤어·메이크업 200, 반지·선물 250, 초대장·꽃·하객선물 160, 예비비 190만 원이야. 이대로 실제 예산에 반영해줘.";

function budgetContext(progress: ToolExecutionContext["weddingContext"]["progress"]): ToolExecutionContext {
  return { coupleId: "10000000-0000-4000-8000-000000000001", requestKey: "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001", requestAttemptCount: 1, providerCallIndex: 1, weddingContext: { weddingDate: null, venue: null, budget: 0, progress } };
}

function existingPlanContext(): ToolExecutionContext {
  const input = parseExplicitBudgetPlanRequest(ORIGINAL);
  if (!input) throw new Error("Existing complete plan fixture must parse");
  const context = budgetContext({});
  const operation = buildAmoraAtomicToolOperation("apply_budget_plan", input, context);
  expect(operation.result.success).toBe(true);
  applyAmoraAtomicToolResultToContext(operation.result, context);
  return context;
}

describe("explicit current-turn budget plan", () => {
  it("preserves the complete explicit update request and reuses its existing item before approval", () => {
    const context = existingPlanContext();
    const existing = Object.entries(context.weddingContext.progress)
      .find(([, value]) => "label" in value && value.label === "초대장·꽃·하객선물");
    if (!existing) throw new Error("Existing named budget fixture is missing");
    const [key, value] = existing;
    Object.assign(value, { spent: 700_000, payer: "groom", status: "completed", vendor: "그대로", checklist: [{ id: "owned_1", done: true }] });
    const before = structuredClone(context.weddingContext);
    const input = parseExplicitBudgetPlanRequest(EXPLICIT_UPDATE, context.weddingContext.progress, context.weddingContext.budget);
    expect(input?.total_budget).toBe(35_000_000);
    expect(input?.allocations).toHaveLength(8);
    expect(input?.allocations).toContainEqual({ category: "custom", label: "초대장·꽃·하객선물", budget: 1_600_000 });
    expect(input?.allocations).toContainEqual({ category: "reserve", budget: 1_900_000 });
    if (!input) throw new Error("Explicit existing budget update must produce a proposal");
    const operation = buildAmoraAtomicToolOperation("apply_budget_plan", input, context);
    expect(operation.result.success).toBe(true);
    expect(context.weddingContext).toEqual(before);
    applyAmoraAtomicToolResultToContext(operation.result, context);
    expect(context.weddingContext.budget).toBe(before.budget);
    expect(context.weddingContext.progress).toEqual({
      ...before.progress,
      [key]: { ...before.progress[key], budget: 1_600_000 },
      reserve: { ...before.progress.reserve, budget: 1_900_000 },
    });
    expect(buildAmoraAtomicToolOperation("apply_budget_plan", input, context).result.toolOutput.error).toBe("no_change");
    expect(parseExplicitBudgetPlanRequest(EXPLICIT_UPDATE, context.weddingContext.progress, context.weddingContext.budget)).toBeNull();
  });

  it.each([
    { label: "이동 비용", category: "custom_existing", particle: "은", before: 200000, after: 100000, reserveBefore: 300000, reserveAfter: 400000, direction: "늘릴게요", verb: "변경해주세요" },
    { label: "헤어·메이크업", category: "makeup", particle: "은", before: 200000, after: 300000, reserveBefore: 400000, reserveAfter: 300000, direction: "줄일게", verb: "수정해줘" },
    { label: "신혼여행", category: "honeymoon", particle: "은", before: 200000, after: 100000, reserveBefore: 300000, reserveAfter: 400000, direction: "바꿀게", verb: "바꿔주세요" },
    { label: "예복 대여료", category: "custom_existing", particle: "는", before: 200000, after: 500000, reserveBefore: 300000, reserveAfter: 0, direction: "줄일게", verb: "바꿔줘" },
  ])("supports explicit balanced existing-item updates for $label without relying on the eight-row fixture", ({ label, category, particle, before, after, reserveBefore, reserveAfter, direction, verb }) => {
    const total = before + reserveBefore;
    const progress = {
      [category]: { category, ...(category.startsWith("custom_") ? { label } : {}), budget: before, spent: 25000, payer: "bride", status: "completed" },
      reserve: { category: "reserve", budget: reserveBefore, status: "not_started" },
    };
    const request = `기존 예산의 ${label}${particle} 새 항목을 추가하지 말고 같은 이름의 금액을 ${before}원에서 ${after}원으로 ${verb}. 총액은 ${total}원으로 유지하고 예비비만 ${reserveBefore}원에서 ${reserveAfter}원으로 ${direction}. 최종 배분은 ${label} ${after}원, 예비비 ${reserveAfter}원. 실제 예산에 저장해주세요.`;
    const input = parseExplicitBudgetPlanRequest(request, progress, total);
    expect(input?.total_budget).toBe(total);
    expect(input?.allocations).toEqual([
      { category: category.startsWith("custom_") ? "custom" : category, ...(category.startsWith("custom_") ? { label } : {}), budget: after },
      { category: "reserve", budget: reserveAfter },
    ]);
  });

  it.each([
    ["no canonical total", undefined], ["different canonical total", 36000000],
    ["invalid canonical total", Number.NaN], ["infinite canonical total", Infinity],
  ])("rejects a maintained total without matching canonical evidence: %s", (_name, total) => {
    const context = existingPlanContext();
    expect(parseExplicitBudgetPlanRequest(EXPLICIT_UPDATE, context.weddingContext.progress, total)).toBeNull();
  });

  it.each([null, "35000000", true])("rejects an untyped canonical total at the runtime boundary: %s", (total) => {
    const context = existingPlanContext();
    expect(Reflect.apply(parseExplicitBudgetPlanRequest, undefined, [EXPLICIT_UPDATE, context.weddingContext.progress, total])).toBeNull();
  });

  it.each([
    ["stale named budget", (progress: Record<string, unknown>) => { for (const value of Object.values(progress)) if (value && typeof value === "object" && "label" in value && value.label === "초대장·꽃·하객선물") Object.assign(value, { budget: 1400000 }); }],
    ["duplicate normalized named budget", (progress: Record<string, unknown>) => { progress.custom_other = { label: " 초대장·꽃·하객선물 ", budget: 1500000 }; }],
    ["stale reserve", (progress: Record<string, unknown>) => { progress.reserve = { category: "reserve", budget: 1900000 }; }],
    ["missing reserve", (progress: Record<string, unknown>) => { delete progress.reserve; }],
    ["invalid named row", (progress: Record<string, unknown>) => { for (const [key, value] of Object.entries(progress)) if (value && typeof value === "object" && "label" in value && value.label === "초대장·꽃·하객선물") progress[key] = { label: value.label, budget: "1500000" }; }],
    ["missing named row", (progress: Record<string, unknown>) => { for (const [key, value] of Object.entries(progress)) if (value && typeof value === "object" && "label" in value && value.label === "초대장·꽃·하객선물") delete progress[key]; }],
    ["unlisted positive allocation", (progress: Record<string, unknown>) => { progress.custom_unlisted = { label: "이동 비용", budget: 1 }; }],
    ["hidden targeted allocation", (progress: Record<string, unknown>) => { progress.__hidden = ["reserve"]; }],
  ])("rejects conflicting current progress: %s", (_name, mutate) => {
    const context = existingPlanContext();
    const progress: Record<string, unknown> = structuredClone(context.weddingContext.progress);
    mutate(progress);
    const before = structuredClone(progress);
    expect(parseExplicitBudgetPlanRequest(EXPLICIT_UPDATE, progress, context.weddingContext.budget)).toBeNull();
    expect(progress).toEqual(before);
  });

  it("preserves same-label legacy custom priority and omitted zero-valued fields in an explicit update", () => {
    const context = existingPlanContext();
    const progress = {
      ...context.weddingContext.progress,
      makeup: { category: "makeup", status: "completed", budget: 0, spent: 100000, payer: "bride" },
      custom_legacy_makeup: { category: "custom_legacy_makeup", label: "헤어·메이크업", status: "completed", budget: 2000000, spent: 700000, payer: "groom" },
      venue: { category: "venue", budget: 0, spent: 400000, status: "completed" },
    };
    context.weddingContext.progress = progress;
    const before = structuredClone(context.weddingContext);
    const input = parseExplicitBudgetPlanRequest(EXPLICIT_UPDATE, context.weddingContext.progress, context.weddingContext.budget);
    expect(input?.allocations).toContainEqual({ category: "custom", label: "헤어·메이크업", budget: 2000000 });
    expect(input?.allocations.some(row => row.category === "makeup")).toBe(false);
    if (!input) throw new Error("Existing custom priority must remain usable");
    const result = buildAmoraAtomicToolOperation("apply_budget_plan", input, context).result;
    expect(result.success).toBe(true);
    applyAmoraAtomicToolResultToContext(result, context);
    expect(context.weddingContext.progress.makeup).toEqual(before.progress.makeup);
    expect(context.weddingContext.progress.venue).toEqual(before.progress.venue);
    expect(context.weddingContext.progress.custom_legacy_makeup).toEqual(before.progress.custom_legacy_makeup);
  });

  it.each([
    EXPLICIT_UPDATE.replace("150만 원에서", "140만 원에서"),
    EXPLICIT_UPDATE.replace("160만 원으로", "170만 원으로"),
    EXPLICIT_UPDATE.replace("200만원에서", "210만원에서"),
    EXPLICIT_UPDATE.replace("190만원으로", "180만원으로"),
    EXPLICIT_UPDATE.replace("3500만원으로", "3600만원으로"),
    EXPLICIT_UPDATE.replace("줄일게", "늘릴게"),
    EXPLICIT_UPDATE.replace("최종 배분은 결혼식장·식사 900", "최종 배분은 교통 0, 결혼식장·식사 900"),
    EXPLICIT_UPDATE.replace("사진 500", "새 사진 500"),
    EXPLICIT_UPDATE.replace("사진 500", "사진 510").replace("신혼여행 1000", "신혼여행 990"),
    EXPLICIT_UPDATE.replace("초대장·꽃·하객선물 160", "초대장·꽃·하객선물 170").replace("예비비 190만", "예비비 180만"),
    EXPLICIT_UPDATE.replace("사진 500, ", "").replace("신혼여행 1000", "신혼여행 1500"),
    EXPLICIT_UPDATE.replace("바꿔줘.", "바꾸지 마."),
    EXPLICIT_UPDATE.replace("반영해줘.", "반영하지 마."),
    EXPLICIT_UPDATE.replace("최종 배분은", "다른 항목은 지워줘. 최종 배분은"),
    EXPLICIT_UPDATE.replace("최종 배분은", "예시일 뿐이야. 최종 배분은"),
    EXPLICIT_UPDATE.replace("최종 배분은", "내일 확인한 뒤에만 반영해줘. 최종 배분은"),
    `예시야. ${EXPLICIT_UPDATE}`,
    `${EXPLICIT_UPDATE} 기존 항목은 삭제해줘.`,
    EXPLICIT_UPDATE.replace("최종 배분은", "최종 배분은 예비비 0원, "),
  ])("does not discard refusal, contradiction, or unconsumed instructions: %s", (text) => {
    const context = existingPlanContext();
    expect(parseExplicitBudgetPlanRequest(text, context.weddingContext.progress, context.weddingContext.budget)).toBeNull();
  });

  it.each([
    ORIGINAL,
    NATURAL_TOTAL,
    NATURAL_TOTAL.replace("3500만 원이야.", "35,000,000원입니다."),
    NATURAL_TOTAL.replace("3500만 원이야.", "3500만 원이에요."),
  ])("turns the exact reported eight amounts into a schema-valid atomic proposal without splitting names: %s", text => {
    const input = parseExplicitBudgetPlanRequest(text);
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
    NATURAL_TOTAL.replace("3500만 원이야.", "3400만 원이야."),
    NATURAL_TOTAL.replace("3500만 원이야.", "미정이야."),
    NATURAL_TOTAL.replace("3500만 원이야.", "약 3500만 원이야."),
    NATURAL_TOTAL.replace("3500만 원이야.", "3500~4000만 원이야."),
    NATURAL_TOTAL.replace("3500만 원이야.", "3500만 원이면."),
    NATURAL_TOTAL.replace("항목별 금액을 줄게.", "집 보증금도 이 총액에 포함해줘. 항목별 금액을 줄게."),
    NATURAL_TOTAL.replace("이대로 실제 예산에 반영해줘.", "부모님 지원금 500만원도 더해서 이대로 실제 예산에 반영해줘."),
    NATURAL_TOTAL.replace("반영해줘", "반영하지 마"),
    `가정이야. ${NATURAL_TOTAL}`,
    `"${NATURAL_TOTAL}"`,
    `${NATURAL_TOTAL} 취소할게.`,
    "총 결혼 예산은 3500만 원이야. 실제 예산에 반영해줘.",
  ])("does not consume additional conditions or uncertain totals from a natural declaration: %s", text => {
    expect(parseExplicitBudgetPlanRequest(text)).toBeNull();
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
