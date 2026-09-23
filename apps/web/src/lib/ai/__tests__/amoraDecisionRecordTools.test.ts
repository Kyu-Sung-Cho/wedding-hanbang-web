import { describe, expect, it } from "vitest";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { selectAmoraPendingProposalTools, selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { buildAmoraPendingActionPrompt, extractAmoraPendingAction, resolveAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { describeAmoraChange, getAmoraActionApprovalPolicy } from "@hanbang/shared";
import { buildAmoraAtomicToolOperation, applyAmoraAtomicToolResultToContext } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const NOW = Date.parse("2026-09-20T00:00:00Z");
const ACTION_ID = "10000000-0000-4000-8000-000000000001";
const record = {
  title: "2028년 가을, 하객 80명 안팎의 식사 중심 예식 검토",
  status: "considering",
  memo: "서울/부산/대구 미정",
  category_key: "general",
};

function extractRecord(input: Record<string, unknown>) {
  return extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool: "add_decision_record", input })}[/pending_action]`,
    allowedTools: BETA_SAFE_TOOLS, now: NOW, createActionId: () => ACTION_ID,
  });
}
function emptyContext(): ToolExecutionContext {
  return { coupleId: ACTION_ID, weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} } };
}

describe("decision board record tools", () => {
  it("offers only a decision-record confirmation for an explicit unsettled board record", () => {
    const userText = "2028년 가을, 하객 80명 안팎의 식사 중심 예식 검토. 장소는 서울/부산/대구 미정이야. 결정 보드에 논의 중으로 기록해줘";
    const input = { availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" as const };
    expect(selectAmoraPendingProposalTools(input).map(tool => tool.name)).toEqual(["add_decision_record"]);
    expect(selectAmoraTools(input).filter(tool => isMutatingTool(tool.name)).map(tool => tool.name))
      .toEqual(["add_decision_record"]);
  });

  it("issues a bound Korean confirmation for shared storage without claiming joint agreement", () => {
    const extracted = extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify({ tool: "add_decision_record", input: record })}[/pending_action]`,
      allowedTools: BETA_SAFE_TOOLS,
      now: NOW,
      createActionId: () => ACTION_ID,
    });
    expect(extracted.pendingAction).not.toBeNull();
    expect(extracted.pendingAction?.confirmation).toContain("결정 기록 추가");
    expect(extracted.pendingAction?.confirmation).toContain("상태: 논의 중");
    expect(extracted.pendingAction?.confirmation).toContain("상대에게도 보이는 공유 기록");
    expect(extracted.pendingAction?.confirmation).toContain("두 사람의 합의를 뜻하지 않아요");
    expect(extracted.pendingAction?.confirmation).toContain(record.memo);
    expect(getAmoraActionApprovalPolicy("add_decision_record", record)).toBe("single");
    expect(resolveAmoraPendingAction({ value: extracted.pendingAction, confirmedActionId: ACTION_ID, allowedTools: BETA_SAFE_TOOLS, now: NOW + 1000 })?.input).toEqual(record);
    expect(resolveAmoraPendingAction({ value: extracted.pendingAction, confirmedActionId: "20000000-0000-4000-8000-000000000002", allowedTools: BETA_SAFE_TOOLS, now: NOW + 1000 })).toBeNull();
  });

  it("builds only the approved decision fields without changing wedding facts or claiming DB verification", () => {
    const context: ToolExecutionContext = {
      coupleId: ACTION_ID,
      requestKey: `chat:${ACTION_ID}:${ACTION_ID}`,
      pendingActionId: ACTION_ID,
      weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
    };
    const before = structuredClone(context.weddingContext);
    const operation = buildAmoraAtomicToolOperation("add_decision_record", record, context);
    expect(operation.result.success).toBe(true);
    expect(operation.domainMutation).toEqual({ kind: "decision_record_insert", record: {
      title: record.title, decision_type: "considering", reasoning: record.memo, category: "general",
    } });
    expect(operation.result.toolOutput.verified).not.toBe(true);
    expect(operation.result.toolOutput.decision).toBeUndefined();
    applyAmoraAtomicToolResultToContext(operation.result, context);
    expect(context.weddingContext).toEqual(before);
  });

  it("opens a real decision read for board questions without relabelling shared tasks as decisions", () => {
    const selected = selectAmoraTools({ availableTools: BETA_SAFE_TOOLS, userText: "결정 보드에 어떤 결정 기록이 있어?", specialistType: "general" });
    const read = selected.find(tool => tool.name === "get_decision_records");
    expect(read).toBeDefined();
    expect(read?.input_schema.properties).toMatchObject({ decision_id: { type: "string" } });
    expect(selected.filter(tool => isMutatingTool(tool.name))).toEqual([]);
  });

  it("describes record-only effects and requires a real marker instead of a plaintext preview", () => {
    expect(describeAmoraChange("add_decision_record", null)).toEqual({
      category: "결정 기록",
      effect: "확인한 제목·상태·메모를 공유 결정 보드에 기록해요. 일정·예산은 바꾸지 않고, 두 사람의 합의를 뜻하지 않아요.",
    });
    const prompt = buildAmoraPendingActionPrompt(BETA_SAFE_TOOLS.filter(tool => tool.name === "add_decision_record"));
    expect(prompt).toContain('"tool":"add_decision_record"');
    expect(prompt).toContain("미정·논의 중을 확정으로 바꾸지 마세요");
    expect(prompt).toContain("미리보기만 쓰고 끝내지 마세요");
  });

  it("refuses sensitive data before a shared confirmation or atomic write is offered", () => {
    const input = { ...record, memo: "주민번호 900101-1234567" };
    const extracted = extractAmoraPendingAction({ text: `[pending_action]${JSON.stringify({ tool: "add_decision_record", input })}[/pending_action]`, allowedTools: BETA_SAFE_TOOLS, now: NOW, createActionId: () => ACTION_ID });
    expect(extracted.pendingAction).toBeNull();
    const context: ToolExecutionContext = { coupleId: ACTION_ID, weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} } };
    const operation = buildAmoraAtomicToolOperation("add_decision_record", input, context);
    expect(operation.result.success).toBe(false);
    expect(operation.domainMutation).toEqual({ kind: "none" });
  });

  it("checks multiline sensitive semantics before JSON escaping can hide line boundaries", () => {
    const input = { ...record, memo: "identity:passport\nAB1234567" };
    expect(extractRecord(input).pendingAction).toBeNull();
    expect(buildAmoraAtomicToolOperation("add_decision_record", input, emptyContext()).domainMutation).toEqual({ kind: "none" });
  });

  it.each([
    "계좌 123456789012", "비밀번호 secret-value", "당뇨 치료 중", "연락처 010-1234-5678",
    "메일 hello@example.com", "주민번호 ９００１０１－１２３４５６７", "임 신 12주차",
  ])("applies the existing storage DLP to both title and memo: %s", (sensitive) => {
    for (const field of ["title", "memo"]) {
      const input = { ...record, [field]: sensitive };
      expect(extractRecord(input).pendingAction).toBeNull();
      expect(buildAmoraAtomicToolOperation("add_decision_record", input, emptyContext()).result.success).toBe(false);
    }
  });

  it.each([
    { title: "" }, { title: "   " }, { title: "가".repeat(161) }, { status: undefined },
    { status: "completed" }, { status: "논의 중" }, { memo: "가".repeat(1001) }, { memo: 7 },
    { category_key: "not_a_category" }, { title: "제목\u202e숨김" }, { memo: "메모\u0000숨김" },
  ])("refuses malformed record input at proposal and mutation boundaries: %j", (changes) => {
    const input = { ...record, ...changes };
    expect(extractRecord(input).pendingAction).toBeNull();
    expect(buildAmoraAtomicToolOperation("add_decision_record", input, emptyContext()).domainMutation).toEqual({ kind: "none" });
  });

  it.each(["exploring", "considering", "decided"]) ("preserves the user-confirmed %s state and bounded memo, without inferred date or budget", (status) => {
    const input = { title: "가".repeat(160), status, memo: "나".repeat(1000) };
    const pending = extractRecord(input).pendingAction;
    expect(pending?.input).toEqual(input);
    expect(buildAmoraAtomicToolOperation("add_decision_record", input, emptyContext()).domainMutation).toEqual({ kind: "decision_record_insert", record: {
      title: input.title, decision_type: status, reasoning: input.memo, category: "general",
    } });
  });

  it("rejects extra mutation fields even if an internal caller bypasses marker validation", () => {
    expect(buildAmoraAtomicToolOperation("add_decision_record", { ...record, wedding_date: "2028-09-01" }, emptyContext()).domainMutation).toEqual({ kind: "none" });
  });

  it.each([
    "서울/부산/대구 미정이야", "결정 보드에 뭐가 있어?", "결정 보드에 저장하지 마", "결정 보드에 기록해줘라고 친구에게 보낼 메시지야",
    "결정 보드에 기록해줘. 아니 아까 말한 거 취소", "친구가 결정 보드에 기록해 달라고 했대",
  ])("does not infer a record write from advice, refusal, hearsay or another recipient: %s", (userText) => {
    expect(selectAmoraPendingProposalTools({ availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" }).map(tool => tool.name)).not.toContain("add_decision_record");
  });

  it.each([
    "결정 보드에 기록해줘도 되는 거야?", "결정 보드에 기록해줘라고 말하면 돼?",
    "결정 보드에 기록해줘. 아니 저장하지 마",
  ])("does not turn a quoted request or retracted suffix into a live proposal: %s", (userText) => {
    expect(selectAmoraPendingProposalTools({ availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" }).map(tool => tool.name)).not.toContain("add_decision_record");
  });

  it("never turns a plaintext preview, expired card or tampered status into approval authority", () => {
    expect(extractAmoraPendingAction({ text: "결정 보드 미리보기\n문구: 식사 중심 예식 검토\n상태: 논의 중\n저장할까요?", allowedTools: BETA_SAFE_TOOLS, now: NOW, createActionId: () => ACTION_ID }).pendingAction).toBeNull();
    const pending = extractRecord(record).pendingAction;
    expect(pending).not.toBeNull();
    expect(resolveAmoraPendingAction({ value: pending, confirmedActionId: ACTION_ID, allowedTools: BETA_SAFE_TOOLS, now: NOW + 86_400_001 })).toBeNull();
    expect(resolveAmoraPendingAction({ value: { ...pending, input: { ...record, status: "decided" } }, confirmedActionId: ACTION_ID, allowedTools: BETA_SAFE_TOOLS, now: NOW + 1 })).toBeNull();
  });

  it("offers the same record-only proposal for structured current-user fields after a save request", () => {
    const userText = "결정 보드에 저장해줘\n문구: 2028년 가을 식사 중심 예식 검토\n상태: 논의 중\n메모: 서울/부산/대구 미정";
    const input = { availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" as const };
    expect(selectAmoraPendingProposalTools(input).map(tool => tool.name)).toEqual(["add_decision_record"]);
    expect(selectAmoraTools(input).filter(tool => isMutatingTool(tool.name)).map(tool => tool.name)).toEqual(["add_decision_record"]);
  });

  it("can issue a fresh confirmation after an old plaintext preview when save is followed only by a bounded verification request", () => {
    const userText = '응. 미리보기 그대로 “논의 중”으로 실제 저장해줘. 저장 후 결정보드에 반영됐는지 확인해서 알려줘.';
    const input = { availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" as const };
    expect(selectAmoraPendingProposalTools(input).map(tool => tool.name)).toEqual(["add_decision_record"]);
    expect(selectAmoraTools(input).filter(tool => isMutatingTool(tool.name)).map(tool => tool.name)).toEqual(["add_decision_record"]);
  });

  it.each([
    '응. 미리보기 그대로 “논의 중”으로 실제 저장해줘. 저장 후 결정보드에 반영됐는지 확인해서 알려줘. 하지만 취소해줘',
    '응. 미리보기 그대로 “논의 중”으로 실제 저장해줘. 대신 예산 3000만원으로 바꿔. 저장 후 결정보드에 반영됐는지 확인해서 알려줘.',
    '응. 미리보기 그대로 “논의 중”으로 실제 저장해줘. 하지 마. 저장 후 결정보드에 반영됐는지 확인해서 알려줘.',
    '응. 미리보기 그대로 “논의 중”으로 실제 저장해줘? 저장 후 결정보드에 반영됐는지 확인해서 알려줘.',
    '저장 후 결정보드에 반영됐는지 확인해서 알려줘.',
  ])("does not strip an extra instruction, retraction or question into a new record proposal: %s", (userText) => {
    expect(selectAmoraPendingProposalTools({ availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" }).map(tool => tool.name)).not.toContain("add_decision_record");
  });
});
