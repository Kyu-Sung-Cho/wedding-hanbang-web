import { describe, expect, it } from "vitest";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { describeUnconfirmedAmoraPendingAction, extractAmoraPendingAction, resolveAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const NOW = 1_789_000_000_000;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const tools = WEDDING_TOOLS.filter(tool => tool.name === "apply_budget_plan");
const input = { total_budget: 35_000_000, intake_summary: "명시한 배정만",
  allocations: [{ category: "studio", budget: 2_999_000 }, { category: "dress", budget: 3_001_000 }] };
function context(progress: Record<string, unknown> = {}): ToolExecutionContext {
  return { coupleId: "10000000-0000-4000-8000-000000000001",
    weddingContext: { weddingDate: null, venue: null, budget: 35_000_000,
      progress: progress as ToolExecutionContext["weddingContext"]["progress"] } };
}
function plan(value: Record<string, unknown>, progress: Record<string, unknown> = {}) {
  return buildAmoraAtomicToolOperation("apply_budget_plan", value, context(progress),
    getAmoraToolOperationIdentity("apply_budget_plan", value).operationKey);
}
function extract(value: Record<string, unknown>) {
  return extractAmoraPendingAction({
    text: "[pending_action]" + JSON.stringify({tool:"apply_budget_plan",input:value}) + "[/pending_action]",
    allowedTools: tools, now: NOW, createActionId: () => ACTION_ID,
  }).pendingAction;
}

describe("explicit budget allocation approval contract", () => {
  it.each([undefined, "legacy", null, "explicit"])("server owns new proposal mode even when model supplies %s", mode => {
    const pending = extract({...input, ...(mode === undefined ? {} : {allocation_mode:mode})});
    expect(pending?.input).toEqual({...input, allocation_mode:"explicit"});
    const identity = getAmoraToolOperationIdentity("apply_budget_plan", {...input,allocation_mode:"explicit"});
    expect(pending).toMatchObject({inputDigest:identity.inputDigest,operationKey:identity.operationKey});
    expect(pending?.confirmation).not.toMatch(/allocation_mode|explicit/);
    expect(resolveAmoraPendingAction({value:pending,confirmedActionId:ACTION_ID,allowedTools:tools,now:NOW+1})).toEqual(pending);
  });

  // 옛 계약(잔액→예비비) 카드가 실제로 발급될 때의 문장. 그때는 모든 예산안이 필드 목록이었다.
  // 새 예산안 문장("말하지 않은 항목의 배정은 그대로 둬요")은 옛 계약에서 사실이 아니라 붙이지 않는다.
  const LEGACY_FIELD_LIST_CONFIRMATION = [
    "다음 변경을 적용할까요?",
    "- 변경: 예산 배분안 적용",
    "- 총 예산: 3,500만 원",
    "- 카테고리별 배분: 1) 카테고리: 웨딩 사진 촬영, 예산: 2,999,000원 / 2) 카테고리: 드레스·예식 정장, 예산: 3,001,000원",
    '- 배분 근거: "명시한 배정만"',
  ].join("\n");

  it("preserves the already issued legacy approval without silently changing its digest or effects", () => {
    const explicit = extract(input);
    expect(explicit).not.toBeNull();
    const identity = getAmoraToolOperationIdentity("apply_budget_plan",input);
    const legacy = {...explicit!, input, inputDigest:identity.inputDigest,operationKey:identity.operationKey,
      confirmation: LEGACY_FIELD_LIST_CONFIRMATION};
    // 새 명시 배분 문장을 옛 계약 입력에 붙인 카드는 서버가 발급한 적이 없다.
    expect(resolveAmoraPendingAction({value:{...legacy,confirmation:explicit!.confirmation},confirmedActionId:ACTION_ID,allowedTools:tools,now:NOW+1})).toBeNull();
    const resolved = resolveAmoraPendingAction({value:legacy,confirmedActionId:ACTION_ID,allowedTools:tools,now:NOW+1});
    expect(resolved).toEqual(legacy);
    expect(resolved?.inputDigest).not.toBe(explicit?.inputDigest);
    expect(plan(legacy.input).result.toolOutput).toMatchObject({remainder_to_reserve:29_000_000,applied_count:3});
    expect(plan(explicit!.input).result.toolOutput).toMatchObject({remainder_to_reserve:0,applied_count:2});
    expect(resolveAmoraPendingAction({value:{...explicit,input},confirmedActionId:ACTION_ID,allowedTools:tools,now:NOW+1})).toBeNull();
    expect(resolveAmoraPendingAction({value:legacy,confirmedActionId:ACTION_ID,allowedTools:tools,now:legacy.expiresAt})).toBeNull();
  });

  it("does not offer a legacy allocation again as the current unconfirmed card", () => {
    const explicit = extract(input)!;
    const { inputDigest, operationKey } = getAmoraToolOperationIdentity("apply_budget_plan", input);
    const legacy = { ...explicit, input, inputDigest, operationKey, confirmation: LEGACY_FIELD_LIST_CONFIRMATION };
    const original = structuredClone(legacy);
    expect(describeUnconfirmedAmoraPendingAction({ value: legacy, allowedTools: tools, now: NOW + 1 })).toBeNull();
    expect(describeUnconfirmedAmoraPendingAction({ value: explicit, allowedTools: tools, now: NOW + 1 })).toEqual(explicit);
    expect(resolveAmoraPendingAction({ value: legacy, confirmedActionId: ACTION_ID, allowedTools: tools, now: NOW + 1 })).toEqual(original);
    expect(legacy).toEqual(original);
  });

  it("leaves the unallocated remainder untouched even on a first complete proposal", () => {
    const result = plan({...input,allocation_mode:"explicit"}).result;
    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({allocations:input.allocations,applied_count:2,remainder_to_reserve:0});
  });

  it.each([0, 1_000_000])("honors an explicitly requested reserve %s exactly", budget => {
    const value={...input,allocation_mode:"explicit",allocations:[...input.allocations,{category:"reserve",budget}]};
    expect(plan(value,{reserve:{category:"reserve",budget:2_000_000,status:"completed",spent:123_000}}).result.toolOutput)
      .toMatchObject({allocations:value.allocations,applied_count:3,remainder_to_reserve:0});
  });

  it("rejects the entire plan when retained reserve would put it over the total", () => {
    const result=plan({...input,allocation_mode:"explicit",total_budget:7_000_000},
      {reserve:{category:"reserve",budget:2_000_000,status:"completed"}}).result;
    expect(result.success).toBe(false);
    expect(result.toolOutput.error).toBe("budget_allocations_exceed_total");
  });

  it("does not resurrect hidden reserve or erase its other fields", () => {
    const original={reserve:{category:"reserve",budget:34_000_000,status:"completed",spent:123},__hidden:["reserve"]};
    const operation=plan({...input,allocation_mode:"explicit"},original);
    expect(operation.result.success).toBe(true);
    expect(operation.domainMutation).toMatchObject({expectedReserveBudget:0});
    expect(operation.result.toolOutput.allocations).toEqual(input.allocations);
    expect(original.reserve.budget).toBe(34_000_000);
  });

  it.each([null, "unknown", 1])("rejects a direct executor unknown mode %s instead of falling back to legacy", allocation_mode => {
    expect(plan({...input,allocation_mode}).result.success).toBe(false);
  });

  it.each([null, "2000000", -1, 1.5])("rejects malformed visible reserve amount %s", budget => {
    expect(plan({...input,allocation_mode:"explicit"},{reserve:{budget}}).result)
      .toMatchObject({success:false,toolOutput:{error:"progress_state_invalid"}});
  });
});
