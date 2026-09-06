import { describe, expect, it, vi } from "vitest";
import { classifyAmoraQuestionScope } from "../amoraQuestionScope";
import { PERSONAL_ACTION_CONVERSATION_TOOLS, personalActionConversationConsent, personalActionConversationMetadata, selectPersonalActionConversationTools } from "../amoraPersonalActionConversation";
import { executeTool } from "../toolExecutor";
import { getPersistableToolResults } from "../placeSearchResultPolicy";
import { buildAmoraSystemPrompt } from "../amoraPromptComposer";
import type { ToolExecutionContext } from "../tools/toolTypes";

const admin = vi.hoisted(() => vi.fn(() => { throw new Error("Personal conversation must not use service role"); }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));
const readCount = vi.fn(async () => 2);
const draft = { title: "예식 준비 질문 정리", description: "내가 확인할 두 가지", dueDate: null };
const context = (text: string): ToolExecutionContext => ({ coupleId: "33333333-3333-4333-8333-333333333333", actorProfileId: "11111111-1111-4111-8111-111111111111", currentUserText: text,
  personalActions: { visibility: "bride_private", readCount }, weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} } });
function offered(text: string, visibility = "bride_private", durable = true, requestKind = "chat") {
  return selectPersonalActionConversationTools({ tools: PERSONAL_ACTION_CONVERSATION_TOOLS, userText: text, visibility, durable, requestKind, scope: classifyAmoraQuestionScope({ userText: text }) });
}

describe("personal action conversation capabilities", () => {
  it("makes a requested private draft through the real executor without a database mutation", async () => {
    const text = "내 개인 할 일로 예식 준비 질문을 저장할 초안을 만들어줘";
    expect(offered(text).map(tool => tool.name)).toContain("prepare_personal_action");
    const result = await executeTool("prepare_personal_action", draft, context(text));
    expect(result).toMatchObject({ success: true, toolOutput: { saved: false, requires_confirmation: true, draft } });
    expect(personalActionConversationMetadata([result], new Set(["prepare_personal_action"]))).toEqual({ personal_action_draft: draft });
    expect(getPersistableToolResults([result])).toEqual([]);
    expect(admin).not.toHaveBeenCalled();
  });
  it("reads counts without contents and preserves the classifier's actual result", async () => {
    const text = "내 개인 할 일 목록 보여줘";
    const scope = classifyAmoraQuestionScope({ userText: text });
    expect(scope).toMatchObject({ scope: "W0_wedding_core" });
    expect(offered(text).map(tool => tool.name)).toEqual(["get_personal_actions"]);
    const result = await executeTool("get_personal_actions", { status: "open" }, context(text));
    expect(result).toMatchObject({ success: true, toolOutput: { count: 2, status: "open", scope: "current_couple_private_sources", contents_read: false, href: "/chat/personal" } });
    expect(result.toolOutput).not.toHaveProperty("actions");
    expect(personalActionConversationMetadata([result], new Set(["get_personal_actions"]))).toEqual({ personal_actions_view: { status: "open" } });
    expect(getPersistableToolResults([result])).toEqual([]);
    const lowScope = { ...scope, scope: "W4_out_of_scope" as const, confidence: "low" as const, needsClarification: true, allowsLongTermMemory: false };
    expect(selectPersonalActionConversationTools({ tools: PERSONAL_ACTION_CONVERSATION_TOOLS, userText: text, visibility: "bride_private", requestKind: "chat", durable: true, scope: lowScope })).toEqual([]);
    const prompt = buildAmoraSystemPrompt({ weddingDate: null, budget: 0, venue: null, progress: {}, preparationStatus: null,
      brideName: "본인", groomName: "함께 준비하는 사람", senderName: "본인", bookings: [], scheduleEvents: [], chatSummaries: [], pastConflicts: [], pastDecisions: [] }, {
      enabledToolNames: ["get_personal_actions"], questionScope: scope, requestKind: "chat", persistenceMode: "durable",
    });
    expect(prompt).toContain("question_scope: W0_wedding_core");
    expect(prompt).toContain("제목·내용을 읽었다고 말하지 말고");
    expect(prompt).toContain("현재 커플의 개인 출처 건수");
    expect(prompt).toContain("개인 목록 전체 건수와는 다를 수");
    expect(prompt).toContain("초안은 저장이 아니며");
  });
  it.each(["shared", "groom_private_invalid"])("keeps %s outside the personal capability", async visibility => {
    const text = "내 개인 할 일 목록 보여줘. 저장 초안도 만들어줘";
    expect(offered(text, visibility)).toEqual([]);
    expect((await executeTool("get_personal_actions", { status: "all" }, { ...context(text), personalActions: undefined })).success).toBe(false);
  });
  it.each(["W2_high_risk_adjacent", "W3_social_care", "W5_safety_override", "W4_out_of_scope"] as const)("closes the %s/high scope even with an explicit personal request", scope => {
    expect(selectPersonalActionConversationTools({ tools: PERSONAL_ACTION_CONVERSATION_TOOLS, userText: "내 개인 할 일 목록 보여줘. 저장 초안을 만들어줘", visibility: "bride_private", requestKind: "chat", durable: true,
      scope: { scope, confidence: "high", allowsLongTermMemory: false, needsClarification: false } })).toEqual([]);
  });
  it.each(["내 개인 할 일은 읽지 말아줘", "상대방 개인 할 일 목록 보여줘", "내 개인 할 일 저장 금지", "친구의 개인 할 일을 추가해줘", "응 그렇게 해줘"])("does not infer consent from %s", async text => {
    expect(personalActionConversationConsent(text)).toEqual({ read: false, draft: false });
    expect((await executeTool("prepare_personal_action", draft, context(text))).success).toBe(false);
    expect((await executeTool("get_personal_actions", { status: "all" }, context(text))).success).toBe(false);
  });
  it.each(["내 개인 할 일 보여주지 마", "내 할 일은 읽지 마", "내 개인 할 일 저장하지 마", "내 할 일 말고 예산표 확인해", "내 개인 할 일은 제외하고 알려줘", "내 개인 할 일은 그대로 두고 공유 할 일 목록 보여줘", "내 개인 할 일 말고 상대의 할 일 보여줘", "내 할 일 추가하지 마세요", "내 개인 할 일 저장하지 말고 상담만 해줘"])("honors explicit refusal or a different target: %s", async text => {
    expect(personalActionConversationConsent(text)).toEqual({ read: false, draft: false });
    const read = vi.fn(async () => 1);
    expect((await executeTool("get_personal_actions", { status: "all" }, { ...context(text), personalActions: { visibility: "bride_private", readCount: read } })).success).toBe(false);
    expect((await executeTool("prepare_personal_action", draft, context(text))).success).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps an explicitly chosen personal target after excluding shared tasks", () => {
    expect(personalActionConversationConsent("공유 할 일 말고 내 개인 할 일로 저장할 초안을 만들어줘")).toEqual({ read: false, draft: true });
  });
  it("requires a current user message and ordinary chat, not a greeting/demo/mediation", () => {
    for (const requestKind of ["initial_greeting", "mediation"]) expect(offered("내 개인 할 일 목록 보여줘", "bride_private", true, requestKind)).toEqual([]);
    expect(offered("내 개인 할 일 목록 보여줘", "bride_private", false)).toEqual([]);
  });
  it.each([{ ...draft, dueDate: "2027-02-29" }, { ...draft, title: "😀".repeat(61) }, { ...draft, partnerId: "ignored?" }, { title: draft.title }, { ...draft, dueDate: "" }])("rejects malformed/unbounded drafts before metadata persistence", async input => {
    const result = await executeTool("prepare_personal_action", input, context("내 개인 할 일로 저장해줘"));
    expect(result.success).toBe(false);
    expect(personalActionConversationMetadata([result], new Set(["prepare_personal_action"]))).toEqual({});
  });
  it("reports a failed query as unavailable, not an empty personal list", async () => {
    readCount.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_DATABASE_DETAIL"));
    const result = await executeTool("get_personal_actions", { status: "all" }, context("내 개인 할 일 보여줘"));
    expect(result).toMatchObject({ success: false, toolOutput: { error_code: "PERSONAL_ACTION_READ_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_DATABASE_DETAIL");
    expect(personalActionConversationMetadata([result], new Set(["get_personal_actions"]))).toEqual({});
  });
});
