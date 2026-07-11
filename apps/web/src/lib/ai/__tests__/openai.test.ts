import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMultimodalContent,
  chatWithToolsStream,
  OpenAIInputTokenLimitError,
} from "@/lib/ai/openai";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

function fakeClient(events: unknown[]) {
  const create = vi.fn().mockResolvedValue({
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  });
  return {
    client: { responses: { create } } as unknown as OpenAI,
    create,
  };
}

function completedResponse(output: unknown[], outputText = "최종 답변") {
  return {
    id: "resp_1",
    created_at: 0,
    output_text: outputText,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "gpt-5.6-luna",
    object: "response",
    output,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: "completed",
    usage: {
      input_tokens: 120,
      input_tokens_details: { cache_write_tokens: 10, cached_tokens: 20 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 150,
    },
  };
}

describe("OpenAI chat adapter", () => {
  beforeEach(() => {
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  it("normalizes text streaming, usage, tools, and replayable reasoning items", async () => {
    const output = [
      { id: "rs_1", type: "reasoning", summary: [], encrypted_content: "opaque" },
      {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "update_budget",
        arguments: '{"total_budget":30000000}',
        status: "completed",
      },
    ];
    const response = completedResponse(output, "예산을 확인할게요.");
    const { client, create } = fakeClient([
      { type: "response.output_text.delta", delta: "예산을 ", item_id: "msg_1" },
      { type: "response.output_text.delta", delta: "확인할게요.", item_id: "msg_1" },
      { type: "response.completed", response },
    ]);
    const deltas: string[] = [];

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "예산 변경" }],
      tools: [{
        name: "update_budget",
        description: "예산 변경",
        input_schema: { type: "object", properties: { total_budget: { type: "number" } } },
      }],
      onTextDelta: (delta) => deltas.push(delta),
      safetyIdentifier: "a".repeat(64),
      client,
    });

    expect(deltas.join("")).toBe("예산을 확인할게요.");
    expect(result.toolCalls).toEqual([{
      callId: "call_1",
      name: "update_budget",
      input: { total_budget: 30_000_000 },
      parseError: undefined,
    }]);
    expect(result.outputItems).toHaveLength(2);
    expect(result.usage).toEqual({
      input_tokens: 120,
      output_tokens: 30,
      cache_write_input_tokens: 10,
      cache_read_input_tokens: 20,
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      store: false,
      include: ["reasoning.encrypted_content"],
      safety_identifier: "a".repeat(64),
      service_tier: "default",
      prompt_cache_options: { mode: "explicit" },
      reasoning: { effort: "none" },
      parallel_tool_calls: false,
      tools: [expect.objectContaining({
        type: "function",
        name: "update_budget",
        strict: false,
      })],
    }));
  });

  it("forwards the caller AbortSignal to the Responses request", async () => {
    const response = completedResponse([], "완료");
    const { client, create } = fakeClient([{ type: "response.completed", response }]);
    const abortController = new AbortController();

    await chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "안녕" }],
      tools: [],
      signal: abortController.signal,
      client,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      { signal: abortController.signal }
    );
  });

  it("counts exact input tokens before reservation and blocks over-limit generation", async () => {
    const create = vi.fn();
    const count = vi.fn().mockResolvedValue({
      object: "response.input_tokens",
      input_tokens: 100_001,
    });
    const beforeCreate = vi.fn();
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "긴 문서" }],
      tools: [],
      maxInputTokens: 100_000,
      beforeCreate,
      client,
    })).rejects.toBeInstanceOf(OpenAIInputTokenLimitError);

    expect(count).toHaveBeenCalledOnce();
    expect(beforeCreate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rechecks authorization before sending raw input to the token counter", async () => {
    const create = vi.fn();
    const count = vi.fn();
    const beforeInputCount = vi.fn().mockRejectedValue(new Error("account deleting"));
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "비공개 원문" }],
      tools: [],
      maxInputTokens: 100_000,
      beforeInputCount,
      client,
    })).rejects.toThrow("account deleting");

    expect(beforeInputCount).toHaveBeenCalledOnce();
    expect(count).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not start a paid request when already aborted", async () => {
    const { client, create } = fakeClient([]);
    const abortController = new AbortController();
    abortController.abort();

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "안녕" }],
      tools: [],
      signal: abortController.signal,
      client,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns invalid tool arguments to the caller without executing them", async () => {
    const response = completedResponse([{
      id: "fc_1",
      type: "function_call",
      call_id: "call_bad",
      name: "update_budget",
      arguments: "{bad json",
      status: "completed",
    }], "");
    const { client } = fakeClient([{ type: "response.completed", response }]);

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "예산 변경" }],
      tools: [],
      client,
    });

    expect(result.toolCalls[0]).toMatchObject({
      callId: "call_bad",
      input: {},
      parseError: "invalid_json",
    });
  });

  it("rejects non-finite numbers produced by otherwise valid JSON", async () => {
    const response = completedResponse([{
      id: "fc_2",
      type: "function_call",
      call_id: "call_infinite",
      name: "update_budget",
      arguments: '{"total_budget":1e309}',
      status: "completed",
    }], "");
    const { client } = fakeClient([{ type: "response.completed", response }]);
    const tools: AiToolDefinition[] = [{
      name: "update_budget",
      description: "예산 변경",
      input_schema: {
        type: "object",
        properties: { total_budget: { type: "number" } },
        required: ["total_budget"],
      },
    }];

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "예산 변경" }],
      tools,
      client,
    });

    expect(result.toolCalls[0]).toMatchObject({
      callId: "call_infinite",
      parseError: "schema_validation",
    });
  });

  it("maps images and PDFs to Responses input content", () => {
    expect(buildMultimodalContent("분석", [
      { base64: "abc", mediaType: "image/png" },
      { base64: "def", mediaType: "application/pdf", fileName: "quote.pdf" },
    ])).toEqual([
      { type: "input_image", detail: "low", image_url: "data:image/png;base64,abc" },
      { type: "input_file", filename: "quote.pdf", file_data: "data:application/pdf;base64,def" },
      { type: "input_text", text: "분석" },
    ]);
  });

  it("preserves billed usage when a completed response has no usable output", async () => {
    const response = completedResponse([], "");
    const { client } = fakeClient([{ type: "response.completed", response }]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "안녕" }],
      tools: [],
      client,
    })).rejects.toMatchObject({
      message: expect.stringContaining("텍스트 또는 도구 호출이 없는"),
      usage: expect.objectContaining({ input_tokens: 120, output_tokens: 30 }),
    });
  });

  it("streams a valid model refusal instead of reporting an outage", async () => {
    const response = completedResponse([{
      id: "msg_refusal",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "refusal", refusal: "이 요청은 도와드릴 수 없어요." }],
    }], "");
    const { client } = fakeClient([
      {
        type: "response.refusal.delta",
        delta: "이 요청은 도와드릴 수 없어요.",
        item_id: "msg_refusal",
      },
      { type: "response.completed", response },
    ]);
    const deltas: string[] = [];

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "요청" }],
      tools: [],
      onTextDelta: (delta) => deltas.push(delta),
      client,
    });

    expect(result.fullText).toBe("이 요청은 도와드릴 수 없어요.");
    expect(result.stopReason).toBe("refusal");
    expect(deltas.join("")).toBe(result.fullText);
  });

  it("fails closed on incomplete responses", async () => {
    const response = {
      ...completedResponse([], ""),
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    const { client } = fakeClient([{ type: "response.incomplete", response }]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "안녕" }],
      tools: [],
      client,
    })).rejects.toMatchObject({
      message: expect.stringContaining("max_output_tokens"),
      model: "gpt-5.6-luna",
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        cache_write_input_tokens: 10,
        cache_read_input_tokens: 20,
      },
    });
  });
});
