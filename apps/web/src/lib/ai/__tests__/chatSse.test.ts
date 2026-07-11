import { describe, expect, it } from "vitest";
import { parseChatSse } from "@hanbang/shared";

describe("parseChatSse", () => {
  it("uses done.fullContent as the authoritative final response", () => {
    const parsed = parseChatSse([
      'data: {"type":"text_delta","content":"초안"}',
      'data: {"type":"done","fullContent":"최종 답변"}',
      "",
    ].join("\n"));

    expect(parsed).toEqual({ content: "최종 답변", completed: true });
  });

  it("clears intermediate text before a tool-result follow-up", () => {
    const parsed = parseChatSse([
      'data: {"type":"text_delta","content":"잠시만요"}',
      'data: {"type":"text_clear"}',
      'data: {"type":"text_delta","content":"확인했어요"}',
      'data: {"type":"done","fullContent":"확인했어요"}',
    ].join("\n"));

    expect(parsed.content).toBe("확인했어요");
    expect(parsed.completed).toBe(true);
  });

  it("does not expose malformed SSE payloads as chat text", () => {
    const parsed = parseChatSse("data: not-json\n\ndata: {\"type\":\"error\",\"message\":\"실패\"}\n");

    expect(parsed).toEqual({ content: "", completed: false, error: "실패" });
  });

  it("preserves tool results, suggestions, quota, and completion metadata", () => {
    const parsed = parseChatSse([
      'data: {"type":"tool_result","result":{"toolName":"get_budget_summary","success":true,"displayMessage":"예산을 확인했어요."}}',
      'data: {"type":"suggestions","suggestions":["예산 다시 보기",7,"  "]}',
      'data: {"type":"quota","remaining":4.9}',
      'data: {"type":"metadata","metadata":{"delivery":"incremental"}}',
      'data: {"type":"done","fullContent":"확인했어요.","metadata":{"serverMessageId":"message-1","stageTag":"budget"}}',
      "",
    ].join("\n"));

    expect(parsed).toMatchObject({
      content: "확인했어요.",
      completed: true,
      toolResults: [{
        toolName: "get_budget_summary",
        success: true,
        displayMessage: "예산을 확인했어요.",
      }],
      suggestions: ["예산 다시 보기"],
      quotaRemaining: 4,
      metadata: { delivery: "incremental", serverMessageId: "message-1", stageTag: "budget" },
    });
  });
});
