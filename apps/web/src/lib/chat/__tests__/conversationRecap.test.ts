import { describe, expect, it } from "vitest";
import { buildAmoraConversationRecap, type RecapMessage, type RecapAction } from "@hanbang/shared";

const userId = "11111111-1111-4111-8111-111111111111";
const coupleId = "22222222-2222-4222-8222-222222222222";
const nowMs = Date.parse("2026-09-07T00:00:00Z");
function message(index: number, changes: Partial<RecapMessage> = {}): RecapMessage {
  return { id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, couple_id: coupleId,
    sender_id: userId, sender_role: "bride", visibility: "shared", content: "예산을 어떻게 나눌까요?",
    created_at: new Date(nowMs - 100_000 + index * 1000).toISOString(), metadata: {}, ...changes };
}
const action: RecapAction = { actionId: "44444444-4444-4444-8444-444444444444", tool: "update_budget", confirmation: "총예산을 변경할까요?", expiresAt: nowMs + 1000 };
function recap(messages: RecapMessage[], readPending: (m: RecapMessage) => RecapAction | null = () => null,
  changes: Partial<Parameters<typeof buildAmoraConversationRecap>[0]> = {}) {
  return buildAmoraConversationRecap({ messages, coupleId, userId, role: "bride", visibility: "shared", clearedAt: null, nowMs, readPending, ...changes });
}
function proposal(index = 2) { return message(index, { sender_id: null, sender_role: "ai", content: "아직 반영하지 않았어요.", metadata: { in_reply_to_user_message_id: message(1).id } }); }
describe("저장된 현재 범위 대화의 재개 정리", () => {
  it("한국 날짜와 마지막 본인 질문을 순서에 상관없이 복원한다", () => {
    const result = recap([proposal(), message(1)]);
    expect(result.day).toBe("2026-09-07");
    expect(result.lastQuestion?.messageId).toBe(message(1).id);
    expect(result.messageCount).toBe(2);
  });
  it("공동 정리에서 개인·다른 커플·상대에게 보낸 메시지·임시 행을 제외한다", () => {
    const rows = [message(1), message(3, { visibility: "bride_private", content: "PRIVATE" }),
      message(4, { couple_id: "other", content: "OTHER" }), message(5, { metadata: { target: "partner" }, content: "PARTNER" }),
      message(6, { id: "temp_1", content: "TEMP" })];
    const result = recap(rows);
    expect(result.messageCount).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|OTHER|PARTNER|TEMP/);
  });
  it("본인이 아닌 비공개 범위를 요청하면 아무 내용도 반환하지 않는다", () => {
    expect(recap([message(1, { visibility: "groom_private" })], undefined, { visibility: "groom_private" }).messageCount).toBe(0);
  });
  it("개인 답변은 현재 본인의 원문과 연결된 것만 포함한다", () => {
    const own = message(1, { visibility: "bride_private" });
    const reply = { ...proposal(), visibility: "bride_private" };
    const stale = message(3, { visibility: "bride_private", sender_id: null, sender_role: "ai", content: "STALE", metadata: {} });
    expect(recap([own, reply, stale], undefined, { visibility: "bride_private" }).messageCount).toBe(2);
  });
  it("화면 정리 이후만 보며 잘못된 커서는 닫힌 상태로 끝난다", () => {
    expect(recap([message(1)], undefined, { clearedAt: message(1).created_at }).messageCount).toBe(0);
    expect(recap([message(1)], undefined, { clearedAt: "broken" }).messageCount).toBe(0);
  });
  it("AI의 저장 주장과 다른 도구 성공을 예산 반영으로 세지 않는다", () => {
    const confirm = message(3, { metadata: { confirmed_amora_action_id: action.actionId } });
    const result = message(4, { sender_id: null, sender_role: "ai", content: "예산을 저장했어요", metadata: { in_reply_to_user_message_id: confirm.id, toolResults: [{ toolName: "get_budget_summary", success: true }] } });
    expect(recap([message(1), proposal(), confirm, result], m => m.id === proposal().id ? action : null).actions[0]?.state).toBe("failed");
  });
  it("현재 범위의 정확한 승인과 같은 도구 성공을 연결해야 반영으로 표시한다", () => {
    const confirm = message(3, { metadata: { confirmed_amora_action_id: action.actionId } });
    const result = message(4, { sender_id: null, sender_role: "ai", metadata: { in_reply_to_user_message_id: confirm.id, toolResults: [{ toolName: action.tool, success: true }] } });
    expect(recap([message(1), proposal(), confirm, result], m => m.id === proposal().id ? action : null).actions[0]?.state).toBe("applied");
    expect(recap([message(1), proposal(), confirm, { ...result, visibility: "bride_private" }], m => m.id === proposal().id ? action : null).actions[0]?.state).toBe("awaiting_result");
  });
  it("이월은 최신 한 건으로 합치고 만료/대체 제안을 구분한다", () => {
    expect(recap([message(1), proposal(2), proposal(3)], () => action).actions).toHaveLength(1);
    expect(recap([message(1), proposal()], () => ({ ...action, expiresAt: nowMs })).actions[0]?.state).toBe("expired");
    expect(recap([message(1), proposal(), message(4)], m => m.sender_role === "ai" ? action : null).actions[0]?.state).toBe("superseded");
  });
  it("안전 카드 원문과 다른 사람의 질문을 재개 문장으로 복사하지 않는다", () => {
    const result = recap([message(1), message(2, { sender_id: "partner", sender_role: "groom" }),
      message(3, { metadata: { response_origin: "client_deterministic_crisis_preflight" }, content: "SAFETY" })]);
    expect(result.lastQuestion?.messageId).toBe(message(1).id);
    expect(JSON.stringify(result)).not.toContain("SAFETY");
  });
  it("긴 질문은 생략을 표시하고 화면 정리의 마이크로초 경계는 보존한다", () => {
    const long = message(1, { content: "질문".repeat(400), created_at: "2026-09-06T23:00:00.000002Z" });
    expect(recap([long]).lastQuestion?.text).toHaveLength(601);
    expect(recap([long]).lastQuestion?.text.endsWith("…")).toBe(true);
    expect(recap([long], undefined, { clearedAt: "2026-09-06T23:00:00.000001Z" }).messageCount).toBe(1);
    expect(recap([long], undefined, { clearedAt: "2026-09-06T23:00:00.000003Z" }).messageCount).toBe(0);
  });
});
