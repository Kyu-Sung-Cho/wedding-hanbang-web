import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mobileChatSource = readFileSync(
  join(process.cwd(), "../mobile/app/(tabs)/chat.tsx"),
  "utf8"
);
const webChatRouteSource = readFileSync(
  join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);

describe("mobile Amora delivery contract", () => {
  it("limits the query before restoring chronological display order", () => {
    expect(mobileChatSource).toMatch(/\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(200\)/);
    expect(mobileChatSource).toContain("(history ?? []).slice().reverse()");
  });

  it("applies the server chat clear timestamps before restoring mobile history", () => {
    expect(mobileChatSource).toContain("readMySafeProfile()");
    expect(mobileChatSource).toContain("readMyChatViewState()");
    expect(mobileChatSource).toContain("chatView.shared_chat_cleared_at");
    expect(mobileChatSource).toContain("chatView.private_chat_cleared_at");
    expect(mobileChatSource).toContain("isMessageAfterChatClear(");
  });

  it("sends only the persisted current message id and leaves transcript reconstruction to the server", () => {
    expect(mobileChatSource).toContain("currentUserMessageId: userMsg.id");
    expect(mobileChatSource).not.toContain("recentContext");
    expect(mobileChatSource).not.toContain("isMessageAllowedInAiContext");
  });

  it("streams when a response reader exists and retains a text fallback", () => {
    expect(mobileChatSource).toContain("body.getReader()");
    expect(mobileChatSource).toContain("parseChatSse(await response.text())");
    expect(mobileChatSource).toContain("clientCapabilities: { toolCards: false, incrementalSse: true }");
  });

  it("keeps failed input retryable and disables an unavailable partner tab", () => {
    expect(mobileChatSource).toContain("입력한 내용은 그대로 두었어요.");
    expect(mobileChatSource).toContain("disabled={!partnerName || targetLocked}");
    expect(mobileChatSource).toContain("pendingAiRequest ? retrySend : handleSend");
  });

  it("replays the same claim before rotating only an explicitly failed request id", () => {
    expect(webChatRouteSource).toContain("{ error: error.message, code: error.code }");
    expect(mobileChatSource).toContain('sendIssue.claimCode !== "request_failed"');
    expect(mobileChatSource).toContain("await requestAiReply(previous)");
    expect(mobileChatSource).toContain('const retryRequestId = `mobile:retry:${Date.now().toString(36)}`');
    expect(mobileChatSource).toContain("clientRequestId: retryRequestId");
    expect(mobileChatSource).not.toContain("void requestAiReply(pendingAiRequest)");
  });
});
