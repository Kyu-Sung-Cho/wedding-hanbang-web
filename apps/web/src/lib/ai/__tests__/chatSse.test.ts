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
});
