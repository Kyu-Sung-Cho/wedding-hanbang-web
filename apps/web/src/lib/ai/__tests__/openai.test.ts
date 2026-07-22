import OpenAI, {
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMultimodalContent,
  chatWithToolsStream,
  OpenAIInputTokenLimitError,
  OpenAIProviderError,
  normalizeOpenAIProviderError,
} from "../openai";

const originalEnabled = process.env.AMORA_OPENAI_ENABLED;
const originalApiKey = process.env.OPENAI_API_KEY;

function apiResult<T>(data: T, requestId = "req_test") {
  return {
    withResponse: vi.fn().mockResolvedValue({
      data,
      response: new Response(),
      request_id: requestId,
    }),
  };
}

function streamOf(events: unknown[], terminalError?: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      if (terminalError) throw terminalError;
    },
  };
}

function fakeClient(events: unknown[], options?: { terminalError?: unknown }) {
  const stream = streamOf(events, options?.terminalError);
  const create = vi.fn().mockReturnValue(apiResult(stream));
  const count = vi.fn();
  return {
    client: { responses: { create, inputTokens: { count } } } as unknown as OpenAI,
    create,
    count,
  };
}

function completedResponse(output: unknown[], outputText = "최종 답변", usage: unknown = {
  input_tokens: 120,
  input_tokens_details: { cache_write_tokens: 10, cached_tokens: 20 },
  output_tokens: 30,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 150,
}) {
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
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: "completed",
    usage,
  };
}

describe("OpenAI Responses adapter", () => {
  beforeEach(() => {
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.AMORA_OPENAI_ENABLED;
    else process.env.AMORA_OPENAI_ENABLED = originalEnabled;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("never lets an injected client bypass the production kill switch", async () => {
    const { client, create } = fakeClient([]);
    process.env.AMORA_OPENAI_ENABLED = "false";

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      client,
    })).rejects.toMatchObject({
      category: "auth_config",
      providerCode: "openai_not_enabled",
      usageStatus: "complete",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("streams text, validates one tool call, and preserves replayable reasoning", async () => {
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
      { type: "response.created", sequence_number: 0, response },
      { type: "response.output_text.delta", delta: "예산을 ", item_id: "msg_1" },
      { type: "response.output_text.delta", delta: "확인할게요.", item_id: "msg_1" },
      { type: "response.completed", sequence_number: 3, response },
    ]);
    const deltas: string[] = [];

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "예산 변경" }],
      tools: [{
        name: "update_budget",
        description: "예산 변경",
        input_schema: {
          type: "object",
          properties: { total_budget: { type: "number" } },
          required: ["total_budget"],
        },
      }],
      onTextDelta: (delta) => deltas.push(delta),
      safetyIdentifierScope: "raw-user-id-123",
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
    expect(result.requestId).toBe("req_test");
    expect(result.responseId).toBe("resp_1");
    expect(result.usageStatus).toBe("complete");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      store: false,
      include: ["reasoning.encrypted_content"],
      safety_identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      service_tier: "default",
      prompt_cache_options: { mode: "explicit" },
      reasoning: { effort: "none" },
      max_output_tokens: 800,
      parallel_tool_calls: false,
      tools: [expect.objectContaining({
        type: "function",
        name: "update_budget",
        strict: false,
      })],
    }), undefined);
    expect(create.mock.calls[0]?.[0]?.safety_identifier).not.toContain("raw-user-id");
  });

  it("marks malformed or schema-invalid tool arguments without executing trust", async () => {
    const response = completedResponse([{
      id: "fc_1",
      type: "function_call",
      call_id: "call_1",
      name: "update_budget",
      arguments: '{"total_budget":"삼천만원"}',
      status: "completed",
    }], "");
    const { client } = fakeClient([{ type: "response.completed", response }]);

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: "예산 변경",
      tools: [{
        name: "update_budget",
        input_schema: {
          type: "object",
          properties: { total_budget: { type: "number" } },
          required: ["total_budget"],
        },
      }],
      client,
    });

    expect(result.toolCalls[0]?.parseError).toBe("schema_validation");
  });

  it("forwards an explicit function choice for deterministic read-only search", async () => {
    const response = completedResponse([], "검색을 시작할게요.");
    const { client, create } = fakeClient([{ type: "response.completed", response }]);
    const searchTool = {
      name: "search_nearby_places",
      input_schema: {
        type: "object" as const,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    };

    await chatWithToolsStream({
      systemPrompt: "system",
      input: "강남 상견례 식당 찾아줘",
      tools: [searchTool],
      toolChoice: { type: "function", name: "search_nearby_places" },
      client,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      tool_choice: { type: "function", name: "search_nearby_places" },
    }), undefined);
  });

  it("rejects a forced function that is not in the offered tool set", async () => {
    const { client, create } = fakeClient([]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "강남 상견례 식당 찾아줘",
      tools: [],
      toolChoice: { type: "function", name: "search_nearby_places" },
      client,
    })).rejects.toMatchObject({
      category: "invalid_request",
      providerCode: "forced_tool_unavailable",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a completed refusal as a refusal stop reason with usage", async () => {
    const response = completedResponse([{
      id: "msg_1",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "refusal", refusal: "도와드릴 수 없는 요청이에요." }],
    }], "");
    const { client } = fakeClient([{ type: "response.completed", response }]);

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: "unsafe",
      tools: [],
      client,
    });

    expect(result.stopReason).toBe("refusal");
    expect(result.fullText).toContain("도와드릴 수 없는");
    expect(result.usageStatus).toBe("complete");
  });

  it("records interrupted streams as unknown usage instead of zero cost", async () => {
    const response = completedResponse([], "", null);
    const { client } = fakeClient([
      { type: "response.created", sequence_number: 0, response },
      { type: "response.output_text.delta", delta: "부분", item_id: "msg_1" },
    ], { terminalError: new Error("socket lost") });

    const promise = chatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      client,
    });
    await expect(promise).rejects.toMatchObject({
      category: "transport",
      usageStatus: "unknown",
      requestId: "req_test",
      responseId: "resp_1",
    });
  });

  it("uses exact counting to block an oversized request before generation", async () => {
    const { client, create, count } = fakeClient([]);
    count.mockReturnValue(apiResult({
      object: "response.input_tokens",
      input_tokens: 100_001,
    }, "req_count"));

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "긴 문서",
      tools: [],
      maxInputTokens: 100_000,
      client,
    })).rejects.toBeInstanceOf(OpenAIInputTokenLimitError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects prompt-cache breakpoints before any provider request", async () => {
    const { client, create } = fakeClient([]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [{
        role: "user",
        content: "비밀 정보",
        prompt_cache_breakpoint: { type: "default" },
      }] as never,
      tools: [],
      client,
    })).rejects.toMatchObject({
      category: "invalid_request",
      providerCode: "prompt_cache_disabled",
      usageStatus: "complete",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects invalid tool contracts before any provider request", async () => {
    const { client, create } = fakeClient([]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "도구 실행",
      tools: [{
        name: "duplicate name with spaces",
        input_schema: { type: "object" },
      }],
      client,
    })).rejects.toMatchObject({
      category: "invalid_request",
      providerCode: "invalid_tool_name",
      usageStatus: "complete",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("forwards AbortSignal and does not auto-retry generation", async () => {
    const response = completedResponse([], "완료");
    const { client, create } = fakeClient([{ type: "response.completed", response }]);
    const controller = new AbortController();

    await chatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      signal: controller.signal,
      client,
    });
    expect(create).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("uses low-detail images and data URLs for bounded multimodal input", () => {
    expect(buildMultimodalContent("봐줘", [{
      base64: "aGVsbG8=",
      mediaType: "image/png",
    }])).toEqual([
      {
        type: "input_image",
        detail: "low",
        image_url: "data:image/png;base64,aGVsbG8=",
      },
      { type: "input_text", text: "봐줘" },
    ]);
  });

  it("uses low-detail PDF rendering to bound document input cost", () => {
    expect(buildMultimodalContent("계약서 검토", [{
      base64: "JVBERi0xLjQ=",
      mediaType: "application/pdf",
      fileName: "contract.pdf",
    }])).toEqual([
      {
        type: "input_file",
        detail: "low",
        filename: "contract.pdf",
        file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
      },
      { type: "input_text", text: "계약서 검토" },
    ]);
  });

  it("exposes a typed provider error contract", () => {
    const error = new OpenAIProviderError("safe", {
      category: "rate_limit",
      usageStatus: "unknown",
    });
    expect(error.category).toBe("rate_limit");
    expect(error.usageStatus).toBe("unknown");
  });

  it("preserves the OpenAI SDK requestID on provider failures", () => {
    const normalized = normalizeOpenAIProviderError(Object.assign(
      new Error("rate limited"),
      { status: 429, requestID: "req_sdk_429", code: "rate_limit_exceeded" }
    ));

    expect(normalized).toMatchObject({
      category: "rate_limit",
      requestId: "req_sdk_429",
      providerCode: "rate_limit_exceeded",
      usageStatus: "unknown",
    });
  });

  it("classifies the OpenAI SDK abort and timeout error classes", () => {
    expect(normalizeOpenAIProviderError(new APIUserAbortError()).category).toBe("aborted");
    expect(
      normalizeOpenAIProviderError(new APIConnectionTimeoutError()).category
    ).toBe("timeout");
  });

  it("preserves known usage and provider ids when replay output is unsupported", async () => {
    const response = completedResponse([{
      id: "ws_1",
      type: "web_search_call",
      status: "completed",
    }]);
    const { client } = fakeClient([{ type: "response.completed", response }]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "검색하지 마",
      tools: [],
      client,
    })).rejects.toMatchObject({
      category: "response_invalid",
      providerCode: "unsupported_web_search_call",
      usageStatus: "complete",
      usage: { input_tokens: 120, output_tokens: 30 },
      requestId: "req_test",
      responseId: "resp_1",
    });
  });
});
