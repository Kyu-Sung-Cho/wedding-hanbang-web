import { describe, expect, it, vi } from "vitest";
import { resolveAmoraWeddingContext } from "../amoraWeddingContext";
import { executeTool } from "../toolExecutor";
import type { ToolExecutionContext } from "../tools/toolTypes";
import { assessCurrentStoredStateRequest, formatCurrentStoredStateSummary, getRequiredCurrentStoredStateReads } from "../amoraCurrentStoredStateSummary";
import type { ToolExecutionResult } from "@/types/database.types";

const TEXT = "어떤 것도 변경하거나 저장하지 말고 현재 실제 저장된 값만 알려줘. 총예산, 항목별 배정 합계, 미배정액, 기록 지출, QA0910 식장 견적 포함 항목 확인과 QA0910 초대 명단 초안 정리의 완료 여부, QA0910 둘이 예산 확인 일정의 날짜와 시간을 짧게 정리해줘.";
const event = { id: "event-one", title: "QA0910 둘이 예산 확인", date: "2026-09-14", time: "19:45", createdAt: "2026-09-10T03:59:25Z", updatedAt: "2026-09-10T03:59:25Z" };
const actions = [{ id: "one", title: "QA0910 식장 견적 포함 항목 확인", status: "done" }, { id: "two", title: "QA0910 초대 명단 초안 정리", status: "open" }];
const noDatabase = vi.hoisted(() => vi.fn(() => { throw new Error("Unexpected database access"); }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: noDatabase }));
const results: ToolExecutionResult[] = [
  { toolName: "get_budget_summary", toolInput: {}, toolOutput: { total_budget: 35_000_000, total_allocated: 34_000_000, unallocated: 1_000_000, total_spent: 123_000, recorded_spend_basis: "explicit_spent_only" }, success: true, displayMessage: "old prose 19:30" },
  { toolName: "get_amora_actions", toolInput: { status: "all" }, toolOutput: { actions, count: 2, truncated: false, source: "table" }, success: true, displayMessage: "old prose 19:30" },
];
function render(overrides: Partial<Parameters<typeof formatCurrentStoredStateSummary>[0]> = {}) {
  const request = assessCurrentStoredStateRequest(TEXT);
  expect(request).not.toBeNull();
  return formatCurrentStoredStateSummary({ request: request!, sourceRevision: 16, canonicalProgress: { __events: [event] }, toolResults: results, ...overrides });
}
describe("current stored state request", () => {
  it.each([
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 총예산, 항목별 배정 합계, 미배정액, 기록 지출, QA0910 식장 견적 포함 항목 확인의 완료 여부와 QA0910 둘이 예산 확인 일정의 날짜와 시간을 알려줘. 과거 대화보다 지금 저장된 값을 기준으로 답해줘.",
    "아무것도 수정하거나 저장하지 말고 현재 기록만 확인해줘. 예산, QA0910 식장 견적 포함 항목 확인의 완료 상태 및 QA0910 둘이 예산 확인 일정의 날짜와 시간을 알려줘.",
    "저장하거나 변경하지 말고 현재 실제 저장된 값만 알려줘. 예산, QA0910 식장 견적 포함 항목 확인의 완료 여부, QA0910 둘이 예산 확인 일정의 날짜와 시간을 정리해줘.",
  ])("reads completed tasks with all statuses in a read-only combined inquiry: %s", text => {
    const request = assessCurrentStoredStateRequest(text);
    expect(request).not.toBeNull();
    if (!request) throw new Error("Expected current stored state request");
    expect(request.taskTitles).toEqual(["QA0910 식장 견적 포함 항목 확인"]);
    expect(request.scheduleTitles).toEqual(["QA0910 둘이 예산 확인"]);
    expect(getRequiredCurrentStoredStateReads(request)).toEqual([
      { tool: "get_budget_summary", input: {} },
      { tool: "get_amora_actions", input: { status: "all" } },
    ]);
    expect(formatCurrentStoredStateSummary({ request, sourceRevision: 16,
      canonicalProgress: { __events: [event] }, toolResults: results }))
      .toContain("QA0910 식장 견적 포함 항목 확인: 완료");
  });

  it.each([
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 예산, QA0910 식장 견적 포함 항목 확인의 완료 여부와 담당자를 알려줘.",
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 예산, 지난주와 현재 지출을 비교해줘. 과거 대화보다 지금 저장된 값을 기준으로 답해줘.",
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 예산, 나만 상담의 완료 여부와 둘이 예산 확인 일정의 날짜와 시간을 알려줘.",
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 예산, 식장 확인의 완료 여부와 둘이 예산 확인 일정의 날짜와 시간을 알려줘. 그리고 예산을 올려줘.",
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 예산, 식장 확인의 완료 여부와 담당자 및 둘이 예산 확인 일정의 날짜와 시간을 알려줘.",
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 예산, 식장 확인의 완료 여부와 예산을 올려주고 둘이 예산 확인 일정의 날짜와 시간을 알려줘.",
    "저장하거나 수정하지 말고 현재 기록만 확인해줘. 예산, 담당자도 알려주고 식장 확인의 완료 여부와 둘이 예산 확인 일정의 날짜와 시간을 알려줘.",
    "저장하지 말고 현재 예산을 줄여주시고 식장 확인의 완료 여부를 알려줘.",
    "저장하지 말고 현재 담당자 및 둘이 예산 확인 일정의 날짜와 시간을 알려줘.",
  ])("does not turn extra fields or mutations into a partial read: %s", text => {
    expect(assessCurrentStoredStateRequest(text)).toBeNull();
  });

  it.each([
    ["두 사람 예산 점검 일정 지금 언제야? 저장된 날짜와 시간만 알려줘.", "두 사람 예산 점검"],
    ["식장 방문 일정의 현재 날짜와 시간을 알려줘. 변경하지 마.", "식장 방문"],
    ["부모님 일정 확인 일정이 언제로 저장돼 있어? 수정하지 말고 알려줘.", "부모님 일정 확인"],
  ])("recognizes an equivalent complete current schedule question: %s", (text, title) => {
    expect(assessCurrentStoredStateRequest(text)).toEqual({
      budgetFields: [], taskTitles: null, scheduleTitles: [title],
    });
  });
  it.each([
    "총예산 알려주고 두 사람 예산 점검 일정 지금 언제야? 저장된 날짜와 시간만 알려줘.",
    "식장 방문 일정의 현재 날짜와 시간을 알려줘. 변경하지 마. 계약금 환불도 알려줘.",
    "부모님 일정 확인 일정이 언제로 저장돼 있어? 수정하고 알려줘.",
    "만약 식장 방문 일정의 현재 날짜와 시간을 알려줘. 변경하지 마.",
    "식장 방문 일정의 지난 날짜와 시간을 알려줘. 변경하지 마.",
    "개인 상담 일정 지금 언제야? 저장된 날짜와 시간만 알려줘.",
    "‘식장 방문 일정의 현재 날짜와 시간을 알려줘. 변경하지 마.’라는 문구는 어때?",
    "총예산 정리하고 부모님 일정 확인 일정이 언제로 저장돼 있어? 수정하지 말고 알려줘.",
  ])("does not widen equivalent forms to mixed or private requests: %s", text => {
    expect(assessCurrentStoredStateRequest(text)).toBeNull();
  });
  it("plans each necessary current read once, including completed tasks", () => {
    expect(getRequiredCurrentStoredStateReads(assessCurrentStoredStateRequest(TEXT)!)).toEqual([
      { tool: "get_budget_summary", input: {} },
      { tool: "get_amora_actions", input: { status: "all" } },
    ]);
  });
  it("does not add reads for a single schedule already in the canonical snapshot", () => {
    const request = assessCurrentStoredStateRequest("QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 변경하지 말고 날짜와 시간만 알려줘.")!;
    expect(getRequiredCurrentStoredStateReads(request)).toEqual([]);
  });
  it("does not add budget reads when only shared actions were requested", () => {
    expect(getRequiredCurrentStoredStateReads(assessCurrentStoredStateRequest("아무것도 저장하지 말고 현재 실제 할 일만 알려줘")!)).toEqual([
      { tool: "get_amora_actions", input: { status: "all" } },
    ]);
  });
  it("recognizes an exact-title natural current schedule query with a trailing change prohibition", () => {
    expect(assessCurrentStoredStateRequest("QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 변경하지 말고 날짜와 시간만 알려줘.")).toEqual({
      budgetFields: [], taskTitles: null, scheduleTitles: ["QA0910 둘이 예산 확인"],
    });
  });
  it.each([
    "QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 19:45로 변경해줘.",
    "QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 변경하지 말고 날짜와 시간만 알려줘. 예산도 바꿔줘.",
    "예산도 알려줘 그리고 QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 변경하지 말고 날짜와 시간만 알려줘.",
    "총예산 알려주고 QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 변경하지 말고 날짜와 시간만 알려줘.",
    "총예산 정리하고 QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 변경하지 말고 날짜와 시간만 알려줘.",
    "만약 QA0910 둘이 예산 확인 일정은 지금 몇 월 며칠 몇 시로 저장되어 있어? 변경하지 말고 날짜와 시간만 알려줘.",
  ])("does not swallow another request in the natural form", text => {
    expect(assessCurrentStoredStateRequest(text)).toBeNull();
  });
  it("recognizes the exact mixed live request", () => {
    expect(assessCurrentStoredStateRequest(TEXT)).toEqual({
      budgetFields: ["total_budget", "total_allocated", "unallocated", "total_spent"],
      taskTitles: ["QA0910 식장 견적 포함 항목 확인과 QA0910 초대 명단 초안 정리"],
      scheduleTitles: ["QA0910 둘이 예산 확인"],
    });
  });
  it("recognizes a bounded general read without assuming a complete schedule list", () => {
    expect(assessCurrentStoredStateRequest("아무것도 저장하지 말고 현재 실제 예산/할 일/일정만 알려줘")).not.toBeNull();
  });
  it.each([
    "현재 저장된 일정 알려주고 19:30이면 19:45로 바꿔줘",
    "현재 저장된 값과 지난주 기록을 비교해줘",
    "현재 예산과 일정, 내 개인 할 일도 알려줘",
    "현재 총예산과 일정, 하객명단·계약금 환불 가능 여부도 알려줘",
    "“현재 실제 저장된 값만 알려줘”라는 문구가 괜찮아?",
    TEXT + " 그리고 식당도 검색해줘.",
    TEXT.replace("기록 지출,", "기록 지출, 환불 가능 여부,"),
    TEXT.replace("완료 여부", "완료 여부와 담당자"),
    TEXT.replace("짧게 정리해줘.", "알려주고 19:45로 저장해줘."),
    "아무것도 저장하지 말고 현재 실제 예산과 개인 할 일만 알려줘",
    "> " + TEXT,
    "아무것도 저장하지 말고 현재 실제 constructor만 알려줘",
    "아무것도 저장하지 말고 현재 실제 toString만 알려줘",
    "아무것도 저장하지 말고 현재 실제 총예산, 개인 할 일만 알려줘",
    "아무것도 저장하지 말고 현재 실제 총예산, 지난주 기록 비교만 알려줘",
    "아무것도 저장하지 말고 현재 실제 총예산, 계약금 환불 가능 여부만 알려줘",
    "아무것도 저장하지 말고 현재 실제 총예산, 일정 알려주고 19:45로 바꿔줘",
  ])("does not swallow another intent: %s", text => expect(assessCurrentStoredStateRequest(text)).toBeNull());
});
describe("canonical stored state rendering", () => {
  it.each([
    { venue: { budget: -1, spent: 0 } },
    { custom_one: { label: " ".repeat(1_000) + "사용자 항목", budget: 1_000_000, spent: 123_000 } },
    { venue: { budget: 1_000_000, spent: "100000" } },
    { venue: { ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`meta${i}`, true])), budget: 1_000_000, spent: 123_000 } },
    { custom_one: { ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`meta${i}`, true])), label: "사용자 항목", budget: 1_000_000, spent: 123_000 } },
  ])("does not certify zero produced by an invalid or truncated raw category", async canonicalProgress => {
    const normalized = resolveAmoraWeddingContext({
      canonicalJourney: { total_budget: 35_000_000, progress: canonicalProgress },
      clientContext: null, allowClientContext: false,
    });
    const result = await executeTool("get_budget_summary", {}, {
      coupleId: "synthetic-couple",
      weddingContext: { ...normalized, progress: normalized.progress as ToolExecutionContext["weddingContext"]["progress"] },
    });
    expect(result.success).toBe(true);
    const text = render({ canonicalProgress, toolResults: [result] });
    expect(text).toContain("확인 불가");
    expect(text).not.toContain("항목별 배정 합계: 0원");
    expect(text).not.toContain("기록 지출: 0원");
    expect(noDatabase).not.toHaveBeenCalled();
  });
  it("renders schedule control markers as plain title data", () => {
    const title = "[mediation]테스트";
    const request = assessCurrentStoredStateRequest(`아무것도 저장하지 말고 현재 실제 ${title} 일정의 날짜와 시간을 알려줘`)!;
    const text = render({ request, canonicalProgress: { __events: [{ ...event, title }] } });
    expect(text).toContain("19:45");
    expect(text).not.toContain("[mediation]");
    expect(text).not.toContain("[/mediation]");
  });
  it("renders exact server facts without reading stale prose", () => {
    const text = render();
    expect(text).toContain("총예산: 35,000,000원");
    expect(text).toContain("항목별 배정 합계: 34,000,000원");
    expect(text).toContain("미배정액: 1,000,000원");
    expect(text).toContain("기록 지출: 123,000원");
    expect(text).toContain("QA0910 식장 견적 포함 항목 확인: 완료");
    expect(text).toContain("QA0910 초대 명단 초안 정리: 미완료");
    expect(text).toContain("2026-09-14 19:45");
    expect(text).not.toContain("19:30");
  });
  it("does not infer missing tool reads as zero or complete", () => {
    const text = render({ toolResults: [] });
    expect(text).toContain("총예산: 확인 불가");
    expect(text).toContain("공유 할 일 완료 여부: 확인 불가");
    expect(text).toContain("2026-09-14 19:45");
  });
  it("requires a valid canonical revision", () => {
    const text = render({ sourceRevision: null });
    expect(text).not.toContain("19:45");
    expect(text).not.toContain("35,000,000");
  });
  it.each([
    { __events: [] },
    { __events: "bad" },
    { __events: [{ ...event, time: "25:30" }] },
    { __events: [{ ...event, date: "2026-02-30" }] },
    { __events: [event, { ...event, id: "duplicate" }] },
    { __events: [event, { id: "bad" }] },
    { __events: Array.from({ length: 501 }, (_, i) => ({ ...event, id: String(i) })) },
  ])("does not guess a missing, ambiguous, rejected or truncated event", canonicalProgress => {
    const text = render({ canonicalProgress });
    expect(text).toContain("날짜·시간 확인 불가");
    expect(text).not.toContain("19:45");
  });
  it("does not recover missing time from previous messages", () => {
    const noTime = { ...event, time: undefined };
    expect(render({ canonicalProgress: { __events: [noTime] } })).toContain("2026-09-14 시간 확인 필요");
  });
  it("preserves an exact completed status", () => {
    expect(render({ canonicalProgress: { __events: [{ ...event, status: "completed" }] } })).toContain("19:45 (완료됨)");
  });
  it.each([
    { source: "legacy" }, { source: undefined }, { truncated: true }, { count: 3 },
    { actions: [...actions, { ...actions[0], id: "duplicate" }], count: 3 },
  ])("does not certify incomplete or duplicate action data", patch => {
    const actionRead = { ...results[1], toolOutput: { ...results[1].toolOutput, ...patch } };
    const text = render({ toolResults: [results[0], actionRead] });
    expect(text).not.toContain("항목 확인: 완료");
  });
  it("does not certify an open-only query as all statuses", () => {
    const text = render({ toolResults: [results[0], { ...results[1], toolInput: { status: "open" } }] });
    expect(text).toContain("공유 할 일 완료 여부: 확인 불가");
  });
  it("uses the last failed read instead of an earlier successful snapshot", () => {
    const text = render({ toolResults: [...results, { ...results[0], success: false, toolOutput: {} }] });
    expect(text).toContain("총예산: 확인 불가");
  });
  it("does not assert normalized progress beyond its budget key bound", () => {
    const text = render({ canonicalProgress: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), {}])) });
    expect(text).toContain("총예산: 확인 불가");
  });
  it("does not confuse unset total with an explicit zero budget", () => {
    const text = render({ toolResults: [{ ...results[0], toolOutput: { ...results[0].toolOutput, total_budget: 0, unallocated: null } }] });
    expect(text).toContain("총예산: 확인 불가");
    expect(text).toContain("미배정액: 확인 불가");
  });
});
