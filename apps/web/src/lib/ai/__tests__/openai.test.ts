import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMultimodalContent,
  chatWithToolsStream as rawChatWithToolsStream,
  estimateInputTokensLocally,
  getSafeOpenAIErrorMetadata,
  hasInputAttachments,
  OpenAIInputTokenLimitError,
  OpenAIProviderError,
  normalizeOpenAIProviderError,
  type ImageAttachment,
} from "../openai";

type ChatWithToolsOptions = Parameters<typeof rawChatWithToolsStream>[0];

function chatWithToolsStream(
  options: Omit<ChatWithToolsOptions, "maxInputTokens" | "beforeProviderEgress"> & {
    maxInputTokens?: number;
    beforeProviderEgress?: ChatWithToolsOptions["beforeProviderEgress"];
  },
) {
  return rawChatWithToolsStream({
    maxInputTokens: 64_000,
    // 이 파일의 관심사는 count/limit/quota/스트림 계약이다. P0-5 egress gate는
    // providerEgressGate.test.ts와 providerEgressCallerContract.test.ts가 고정한다.
    beforeProviderEgress: () => {},
    ...options,
  });
}

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
  const count = vi.fn().mockReturnValue(apiResult({
    object: "response.input_tokens",
    input_tokens: 1,
  }, "req_count_default"));
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

function nestedTextMessage(text: string) {
  return {
    id: "msg_nested", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function responseWithoutConvenience(output: unknown[]) {
  const response = completedResponse(output);
  Reflect.deleteProperty(response, "output_text");
  return response;
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
      beforeGeneration: vi.fn(),
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
      beforeGeneration: vi.fn(),
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
    // 프롬프트 캐싱을 다시 잠그면 비용이 약 4배로 돌아간다.
    //
    // 2026-08-23 실측: 호출당 입력 23,000토큰 / 출력 50토큰이라 비용의 99.8%가
    // 입력인데, `mode:"explicit"` 이 암묵 경계를 꺼서 cache_read_input_tokens 가
    // 전 호출 null 이었다. 시스템 프롬프트의 정적 접두부는 85~100%이고 서로 다른
    // 커플에 대해 글자 단위로 동일하다(441개 갈래 실측).
    //
    // 켜도 모델이 받는 프롬프트는 한 글자도 안 바뀐다 — 같은 토큰을 보내고
    // 청구만 달라진다. 그래서 답변 품질에 영향이 없다.
    const sentBody = create.mock.calls[0][0] as Record<string, unknown>;
    expect(
      (sentBody.prompt_cache_options as { mode?: string } | undefined)?.mode,
      "mode:'explicit' 은 암묵 경계를 꺼서 캐싱을 통째로 막는다",
    ).not.toBe("explicit");

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      store: false,
      include: ["reasoning.encrypted_content"],
      safety_identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      service_tier: "default",
      reasoning: { effort: "none" },
      max_output_tokens: 1_400,
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
      beforeGeneration: vi.fn(),
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
      beforeGeneration: vi.fn(),
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
      beforeGeneration: vi.fn(),
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
      beforeGeneration: vi.fn(),
      client,
    });

    expect(result.stopReason).toBe("refusal");
    expect(result.fullText).toContain("도와드릴 수 없는");
    expect(result.usageStatus).toBe("complete");
  });

  it.each([{ deltas: [] }, { deltas: ["완성된 "] }])("reads the completed nested body instead of only the streamed prefix: $deltas", async ({ deltas }) => {
    const output = [{
      id: "msg_nested", type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "완성된 답변입니다.", annotations: [] }],
    }];
    const response = { ...completedResponse(output), model: "gpt-5.6-terra" };
    // raw Responses 스트림은 SDK 편의 필드를 만들지 않는다.
    Reflect.deleteProperty(response, "output_text");
    const { client, create, count } = fakeClient([
      ...deltas.map(delta => ({ type: "response.output_text.delta", delta, item_id: "msg_nested" })),
      { type: "response.completed", response },
    ]);
    const beforeProviderEgress = vi.fn();
    const beforeGeneration = vi.fn();
    const onTextDelta = vi.fn();

    const result = await chatWithToolsStream({
      systemPrompt: "system", input: "의견을 확인해줘", tools: [], modelRole: "primary",
      beforeProviderEgress, beforeGeneration, onTextDelta, client,
    });

    expect(result.fullText).toBe("완성된 답변입니다.");
    expect(result.outputItems).toEqual(output);
    expect(result).toMatchObject({
      model: "gpt-5.6-terra", stopReason: "completed", usageStatus: "complete",
      requestId: "req_test", responseId: "resp_1", inputCountRequestId: "req_count_default",
      usage: { input_tokens: 120, output_tokens: 30 },
    });
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      model: "gpt-5.6-terra", reasoning: { effort: "none" }, max_output_tokens: 1_400,
      store: false, stream: true,
    }), undefined);
    expect(count).toHaveBeenCalledTimes(1);
    expect(beforeProviderEgress).toHaveBeenCalledTimes(1);
    expect(beforeGeneration).toHaveBeenCalledTimes(1);
    expect(onTextDelta.mock.calls.map(([delta]) => delta)).toEqual(deltas);
  });

  it("preserves completed message/content order and original whitespace", async () => {
    const first = nestedTextMessage(" 첫째 ");
    first.content.push({ type: "output_text", text: "\n둘째", annotations: [] });
    const output = [first, { ...nestedTextMessage("\n셋째  "), id: "msg_second" }];
    const { client } = fakeClient([{ type: "response.completed", response: responseWithoutConvenience(output) }]);
    const result = await chatWithToolsStream({
      systemPrompt: "system", input: "순서 확인", tools: [], beforeGeneration: vi.fn(), client,
    });
    expect(result.fullText).toBe(" 첫째 \n둘째\n셋째  ");
    expect(result.outputItems).toEqual(output);
  });

  it.each([
    { name: "number-only", badText: 35_000_000, mixed: false },
    { name: "object-only", badText: { value: "본문 아님" }, mixed: false },
    { name: "number-mixed", badText: 35_000_000, mixed: true },
    { name: "object-mixed", badText: { value: "본문 아님" }, mixed: true },
  ])("rejects the whole nested fallback for non-string text: $name", async ({ badText, mixed }) => {
    const malformed = {
      id: "msg_malformed", type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: badText, annotations: [] }],
    };
    const output = mixed ? [nestedTextMessage("완성본으로 오인하면 안 되는 일부"), malformed] : [malformed];
    const { client, create } = fakeClient([{ type: "response.completed", response: responseWithoutConvenience(output) }]);
    await expect(chatWithToolsStream({
      systemPrompt: "system", input: "확인", tools: [], beforeGeneration: vi.fn(), client,
    })).rejects.toMatchObject({ category: "response_invalid", providerCode: "empty_response" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each(["convenience", "refusal", "delta"])("keeps the existing %s path when nested text is malformed", async source => {
    const output = [{
      id: "msg_malformed", type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: { value: "본문 아님" } }],
    }];
    const response = source === "convenience"
      ? completedResponse(output, "기존 본문")
      : responseWithoutConvenience(source === "refusal" ? [...output, {
          id: "msg_refusal", type: "message", role: "assistant", status: "completed",
          content: [{ type: "refusal", refusal: "거절 안내" }],
        }] : output);
    const { client } = fakeClient([
      ...(source === "delta" ? [{ type: "response.output_text.delta", delta: "기존 delta", item_id: "msg_delta" }] : []),
      { type: "response.completed", response },
    ]);
    const result = await chatWithToolsStream({
      systemPrompt: "system", input: "확인", tools: [], beforeGeneration: vi.fn(), client,
    });
    expect(result.fullText).toBe(source === "convenience" ? "기존 본문" : source === "refusal" ? "거절 안내" : "기존 delta");
  });

  it.each([
    { source: "convenience", expected: "기존 최상위 본문", refusal: false },
    { source: "refusal", expected: "거절 안내", refusal: true },
  ])("preserves existing $source precedence over nested text", async ({ source, expected, refusal }) => {
    const output = [nestedTextMessage("새 nested 본문")];
    const response = refusal
      ? responseWithoutConvenience([...output, {
          id: "msg_refusal", type: "message", role: "assistant", status: "completed",
          content: [{ type: "refusal", refusal: expected }],
        }])
      : completedResponse(output, expected);
    const { client } = fakeClient([{ type: "response.completed", response }]);
    const result = await chatWithToolsStream({
      systemPrompt: "system", input: source, tools: [], beforeGeneration: vi.fn(), client,
    });
    expect(result.fullText).toBe(expected);
    expect(result.stopReason).toBe(refusal ? "refusal" : "completed");
  });

  it.each([
    { name: "in-progress message", output: [{ ...nestedTextMessage("미완성 본문"), status: "in_progress" }] },
    { name: "incomplete message", output: [{ ...nestedTextMessage("미완성 본문"), status: "incomplete" }] },
    { name: "non-assistant message", output: [{ ...nestedTextMessage("사용자 본문"), role: "user" }] },
    { name: "whitespace only", output: [nestedTextMessage(" \n\t ")] },
    { name: "actually empty", output: [] },
  ])("does not promote $name to a completed answer", async ({ output }) => {
    const { client, create } = fakeClient([{ type: "response.completed", response: responseWithoutConvenience(output) }]);
    await expect(chatWithToolsStream({
      systemPrompt: "system", input: "확인", tools: [], beforeGeneration: vi.fn(), client,
    })).rejects.toMatchObject({ category: "response_invalid", providerCode: "empty_response" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    { event: "response.failed", status: "failed", code: "server_error" },
    { event: "response.incomplete", status: "incomplete", code: "max_output_tokens" },
    { event: "response.completed", status: "failed", code: "empty_response" },
    { event: "response.completed", status: "completed", code: "empty_response" },
  ])("does not rescue an error response from nested text: $event/$status", async ({ event, status, code }) => {
    const response = {
      ...responseWithoutConvenience([nestedTextMessage("승격하면 안 되는 본문")]),
      status, error: status === "incomplete" ? null : { code: "server_error", message: "fixture failure" },
      incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
    };
    const { client, create } = fakeClient([{ type: event, response }]);
    await expect(chatWithToolsStream({
      systemPrompt: "system", input: "확인", tools: [], beforeGeneration: vi.fn(), client,
    })).rejects.toMatchObject({ providerCode: code });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing partial delta policy for an incomplete response", async () => {
    const response = {
      ...responseWithoutConvenience([nestedTextMessage("완료로 승격하면 안 되는 본문")]),
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
    };
    const { client } = fakeClient([
      { type: "response.output_text.delta", delta: "이미 받은 일부", item_id: "msg_nested" },
      { type: "response.incomplete", response },
    ]);
    const result = await chatWithToolsStream({
      systemPrompt: "system", input: "확인", tools: [], beforeGeneration: vi.fn(), client,
    });
    expect(result.fullText).toBe("이미 받은 일부");
    expect(result.stopReason).toBe("max_output_tokens");
  });

  it.each([false, true])("preserves validated tool calls and replay alongside nested text: %s", async withText => {
    const tool = {
      name: "read_example", description: "Read-only fixture",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    };
    const call = {
      id: "fc_nested", type: "function_call", status: "completed",
      call_id: "call_nested", name: tool.name, arguments: "{}",
    };
    const output = withText ? [nestedTextMessage("확인할게요."), call] : [call];
    const { client, create } = fakeClient([{ type: "response.completed", response: responseWithoutConvenience(output) }]);
    const result = await chatWithToolsStream({
      systemPrompt: "system", input: "확인", tools: [tool], beforeGeneration: vi.fn(), client,
    });
    expect(result.fullText).toBe(withText ? "확인할게요." : "");
    expect(result.toolCalls).toEqual([{ callId: "call_nested", name: tool.name, input: {}, parseError: undefined }]);
    expect(result.outputItems).toEqual(output);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("still rejects an unoffered function before releasing nested text", async () => {
    const output = [nestedTextMessage("확인할게요."), {
      id: "fc_nested", type: "function_call", status: "completed",
      call_id: "call_nested", name: "unoffered_function", arguments: "{}",
    }];
    const { client } = fakeClient([{ type: "response.completed", response: responseWithoutConvenience(output) }]);
    await expect(chatWithToolsStream({
      systemPrompt: "system", input: "확인", tools: [], beforeGeneration: vi.fn(), client,
    })).rejects.toMatchObject({ providerCode: "invalid_function_call_name" });
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
      beforeGeneration: vi.fn(),
      client,
    });
    await expect(promise).rejects.toMatchObject({
      category: "transport",
      usageStatus: "unknown",
      requestId: "req_test",
      responseId: "resp_1",
      requestStage: "generation",
    });
  });

  it("fails closed when a JavaScript caller omits the required exact-count ceiling", async () => {
    const { client, create, count } = fakeClient([]);

    await expect(rawChatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      maxInputTokens: undefined as never,
      beforeProviderEgress: vi.fn(),
      beforeGeneration: vi.fn(),
      client,
    })).rejects.toThrow("maxInputTokens must be a positive integer");
    expect(count).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves generation stage on a stage-less OpenAIProviderError from the stream", async () => {
    const { client } = fakeClient([], {
      terminalError: new OpenAIProviderError("stream failed", {
        category: "transport",
        usageStatus: "unknown",
      }),
    });

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      beforeGeneration: vi.fn(),
      client,
    })).rejects.toMatchObject({
      category: "transport",
      requestStage: "generation",
    });
  });

  it("uses exact counting to block an oversized request before generation", async () => {
    const { client, create, count } = fakeClient([]);
    const beforeGeneration = vi.fn();
    count.mockReturnValue(apiResult({
      object: "response.input_tokens",
      input_tokens: 100_001,
    }, "req_count"));

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "긴 문서",
      tools: [],
      maxInputTokens: 100_000,
      beforeGeneration,
      client,
    })).rejects.toBeInstanceOf(OpenAIInputTokenLimitError);
    expect(create).not.toHaveBeenCalled();
    expect(beforeGeneration).not.toHaveBeenCalled();
    // 측정은 성공했고 그 판정이 막은 것이다 — 다시 재지 않는다.
    expect(count).toHaveBeenCalledTimes(1);
  });

  // 측정 *호출* 자체가 죽은 경우(전송·5xx·429·타임아웃)는 한 번 다시 재고, 그래도
  // 안 되면 로컬 추정으로 앱 상한을 지킨 채 생성으로 간다. 2026-07-25 운영에서
  // /responses/input_tokens 만 죽고 /responses 는 멀쩡했는데 "안녕" 한 마디까지
  // 전부 "입력 분량을 확인하는 중 문제가 생겼어요"로 죽었다. 그때 넣은 폴백
  // (c19a9c61)은 상한 없이 진행해 9-07(b2d2fa1c)에 빠졌다 — 지금은 상한을
  // 로컬 추정으로 유지한다(아래 "keeps the input cap on a local estimate").
  it.each([
    ["503", Object.assign(new Error("count service unavailable"), {
      status: 503,
      requestID: "req_count_503",
      code: "server_error",
    }), "server_error"],
    ["502", Object.assign(new Error("bad gateway"), {
      status: 502,
      requestID: "req_count_502",
      code: "bad_gateway",
    }), "bad_gateway"],
    ["429", Object.assign(new Error("rate limited"), {
      status: 429,
      requestID: "req_count_429",
      code: "rate_limit_exceeded",
    }), "rate_limit_exceeded"],
    ["timeout", new APIConnectionTimeoutError(), "timeout"],
    ["network", new APIConnectionError({ message: "count socket closed" }), "transport"],
    ["socket abort without a caller signal", Object.assign(new Error("aborted"), {
      name: "AbortError",
    }), "aborted"],
  ])("retries the count once and then answers when the pre-count %s persists", async (
    _label,
    countError,
    expectedReason,
  ) => {
    const { client, create, count } = fakeClient([
      { type: "response.completed", response: completedResponse([], "안녕하세요") },
    ]);
    const beforeGeneration = vi.fn();
    count.mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(countError),
    });

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      client,
    });

    expect(result.fullText).toBe("안녕하세요");
    expect(count).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(beforeGeneration).toHaveBeenCalledTimes(1);
    // 가드레일이 꺼진 채 나간 턴이라는 사실은 호출부가 원장에 남길 수 있어야 한다.
    expect(result.inputCountUnavailableReason).toBe(expectedReason);
  });

  it("recovers when the retried count succeeds and keeps the exact verdict", async () => {
    const { client, create, count } = fakeClient([
      { type: "response.completed", response: completedResponse([], "안녕하세요") },
    ]);
    count
      .mockReturnValueOnce({
        withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count service unavailable"), {
          status: 503,
          requestID: "req_count_503",
          code: "server_error",
        })),
      })
      .mockReturnValueOnce(apiResult({
        object: "response.input_tokens",
        input_tokens: 12,
      }, "req_count_retry"));

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      beforeGeneration: vi.fn(),
      client,
    });

    expect(result.fullText).toBe("안녕하세요");
    expect(count).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.inputCountUnavailableReason).toBeNull();
    expect(result.inputCountRequestId).toBe("req_count_retry");
  });

  it("still stops the turn when the retried count says the input is too large", async () => {
    const { client, create, count } = fakeClient([]);
    const beforeGeneration = vi.fn();
    count
      .mockReturnValueOnce({
        withResponse: vi.fn().mockRejectedValue(new APIConnectionTimeoutError()),
      })
      .mockReturnValueOnce(apiResult({
        object: "response.input_tokens",
        input_tokens: 64_001,
      }, "req_count_retry"));

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "긴 문서",
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      client,
    })).rejects.toBeInstanceOf(OpenAIInputTokenLimitError);
    expect(count).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(beforeGeneration).not.toHaveBeenCalled();
  });

  it("keeps the input cap on a local estimate when the count is down", async () => {
    // b2d2fa1c 가 폴백을 뺀 이유: 측정 없이 진행하면 앱 상한(64k)이 아니라
    // 제공자의 더 큰 context 한도까지 유료 생성이 나간다. 상한은 계속 지킨다.
    const { client, create, count } = fakeClient([]);
    const beforeGeneration = vi.fn();
    count.mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count service unavailable"), {
        status: 503,
        requestID: "req_count_503",
        code: "server_error",
      })),
    });

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "가".repeat(300_000),
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      client,
    })).rejects.toMatchObject({ providerCode: "input_token_limit", requestStage: "input_count" });
    expect(count).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(beforeGeneration).not.toHaveBeenCalled();
  });

  // 첨부(사진·PDF)는 로컬로 잴 수 없다. PDF 는 추출 텍스트 + 쪽당 이미지 1장(최대
  // 100쪽)으로 청구돼, 건당 고정 몫으로는 10MB PDF 다섯 장(21,074)도 64,000 상한
  // 아래로 보인다(2026-09-14 실측). 첨부 턴은 폴백 없이 이전처럼 측정 단계에서
  // 끝낸다 — 예약도 생성도 없이.
  it.each<[string, ImageAttachment[]]>([
    ["an image", [{ base64: "A".repeat(2_000), mediaType: "image/jpeg" }]],
    ["a PDF", [{ base64: "B".repeat(2_000), mediaType: "application/pdf", fileName: "quote.pdf" }]],
    ["an image and a PDF", [
      { base64: "A".repeat(2_000), mediaType: "image/jpeg" },
      { base64: "B".repeat(2_000), mediaType: "application/pdf", fileName: "quote.pdf" },
    ]],
  ])("still fails at input_count without generating when the count is down on a turn with %s", async (
    _label,
    attachments,
  ) => {
    const { client, create, count } = fakeClient([
      { type: "response.completed", response: completedResponse([], "안녕하세요") },
    ]);
    const beforeGeneration = vi.fn();
    count.mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count service unavailable"), {
        status: 503,
        requestID: "req_count_503",
        code: "server_error",
      })),
    });

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [
        { role: "user", content: "안녕" },
        { role: "user", content: buildMultimodalContent("이 견적서 봐줘", attachments) },
      ],
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      client,
    })).rejects.toMatchObject({ requestStage: "input_count", providerCode: "server_error" });
    expect(count).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(beforeGeneration).not.toHaveBeenCalled();
  });

  it("keeps answering a text-only message list that merely talks about attachments", async () => {
    // 첨부 판정은 항목의 type·키로만 한다 — 본문에 든 낱말은 첨부가 아니다.
    const { client, create, count } = fakeClient([
      { type: "response.completed", response: completedResponse([], "안녕하세요") },
    ]);
    const beforeGeneration = vi.fn();
    count.mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count service unavailable"), {
        status: 503,
        requestID: "req_count_503",
        code: "server_error",
      })),
    });

    const result = await chatWithToolsStream({
      systemPrompt: "system",
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: "어제 보낸 사진이랑 견적서 PDF 다시 봐줄래? image_url file_data input_image input_file",
        }],
      }],
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      client,
    });

    expect(result.fullText).toBe("안녕하세요");
    expect(count).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(beforeGeneration).toHaveBeenCalledTimes(1);
    expect(result.inputCountUnavailableReason).toBe("server_error");
  });

  it("stops without retry or generation when the caller aborted during the count", async () => {
    const abortController = new AbortController();
    const { client, create, count } = fakeClient([]);
    const beforeGeneration = vi.fn();
    count.mockImplementation(() => {
      abortController.abort();
      return { withResponse: vi.fn().mockRejectedValue(new APIUserAbortError()) };
    });

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "안녕",
      tools: [],
      beforeGeneration,
      signal: abortController.signal,
      client,
    })).rejects.toMatchObject({ category: "aborted", requestStage: "input_count" });
    expect(count).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(beforeGeneration).not.toHaveBeenCalled();
  });

  it.each([-1, NaN, Infinity, 2.5, Number.MAX_SAFE_INTEGER + 1])(
    "blocks invalid input count %s before reservation and generation", async (inputTokens) => {
      const { client, create, count } = fakeClient([
        { type: "response.completed", response: completedResponse([]) },
      ]);
      const beforeGeneration = vi.fn();
      count.mockReturnValue(apiResult({ input_tokens: inputTokens }));
      await expect(chatWithToolsStream({
        systemPrompt: "system", input: "input", tools: [], beforeGeneration, client,
      })).rejects.toMatchObject({ requestStage: "input_count", providerCode: "invalid_input_token_count" });
      expect(create).not.toHaveBeenCalled();
      expect(beforeGeneration).not.toHaveBeenCalled();
      // 잘못된 측정 응답은 판정이지 전송 장애가 아니다 — 다시 재지 않는다.
      expect(count).toHaveBeenCalledTimes(1);
    },
  );

  describe("estimateInputTokensLocally", () => {
    it("over-counts Korean and ASCII text rather than under-counting it", () => {
      // 한글 1자 = 1토큰, ASCII 3자 = 1토큰으로 잰다(실측은 각각 ~0.5·~0.25).
      expect(estimateInputTokensLocally({ instructions: "", input: "가".repeat(3_000) }))
        .toBeGreaterThanOrEqual(3_000);
      expect(estimateInputTokensLocally({ instructions: "", input: "a".repeat(3_000) }))
        .toBeGreaterThanOrEqual(1_000);
    });

    it("does not block the worst production prompt during an outage", () => {
      // 운영 최악 커플의 시스템 프롬프트는 48,019자(실측 ~23,000토큰). 전부 한글이라
      // 가정해도 짧은 대화를 붙인 추정이 64,000 상한 아래여야 장애 중에도 답을 한다.
      expect(estimateInputTokensLocally({
        instructions: "가".repeat(48_019),
        input: [{ role: "user", content: "웨딩홀 예약금은 보통 얼마예요? ".repeat(100) }],
      })).toBeLessThan(64_000);
    });

    it("errs upward on attachment bytes instead of granting a flat allowance", () => {
      // 첨부 턴은 호출부가 추정 전에 걸러 측정 단계에서 끝낸다. 그래도 첨부가 여기까지
      // 오면 base64 를 바이트 그대로 세어 상한을 넘겨야지, 건당 고정 몫으로 상한
      // 아래로 보이면 안 된다(10MB PDF 다섯 장이 21,074 로 통과하던 구멍).
      const content = buildMultimodalContent("이 견적서 봐줘", [
        { base64: "A".repeat(2_000_000), mediaType: "image/jpeg" },
        { base64: "B".repeat(2_000_000), mediaType: "application/pdf", fileName: "quote.pdf" },
      ]);
      const estimate = estimateInputTokensLocally({
        instructions: "system",
        input: [{ role: "user", content }],
      });
      expect(estimate).toBeGreaterThan(64_000);
    });
  });

  describe("hasInputAttachments", () => {
    it.each([
      ["a plain string", "어제 보낸 사진이랑 견적서 PDF 다시 봐줄래?"],
      ["a text-only message list", [{ role: "user", content: "웨딩홀 예약금은 보통 얼마예요?" }]],
      ["input_text parts that merely spell the attachment words", [{
        role: "user",
        content: [{ type: "input_text", text: "image_url file_data input_image input_file" }],
      }]],
      ["a replayed tool round-trip", [
        { type: "function_call", call_id: "call_1", name: "get_budget", arguments: "{}" },
        { type: "function_call_output", call_id: "call_1", output: '{"file_data":"not an attachment, a string"}' },
      ]],
    ] as const)("is false for %s", (_label, input) => {
      expect(hasInputAttachments(input as Parameters<typeof hasInputAttachments>[0])).toBe(false);
    });

    it.each<[string, ImageAttachment[]]>([
      ["an image", [{ base64: "A".repeat(20), mediaType: "image/jpeg" }]],
      ["a PDF", [{ base64: "B".repeat(20), mediaType: "application/pdf", fileName: "quote.pdf" }]],
    ])("is true for a turn carrying %s", (_label, attachments) => {
      expect(hasInputAttachments([
        { role: "user", content: buildMultimodalContent("이 견적서 봐줘", attachments) },
      ])).toBe(true);
    });

    it("finds an attachment replayed deeper in the history, not only in the last turn", () => {
      expect(hasInputAttachments([
        { role: "user", content: buildMultimodalContent("이 견적서 봐줘", [
          { base64: "B".repeat(20), mediaType: "application/pdf", fileName: "quote.pdf" },
        ]) },
        { role: "assistant", content: "네, 봤어요." },
        { role: "user", content: "그럼 예약금은요?" },
      ])).toBe(true);
    });

    it("recognises provider-hosted file references by item type, not only inline data", () => {
      expect(hasInputAttachments([
        { role: "user", content: [{ type: "input_file", file_id: "file_abc" }] },
      ])).toBe(true);
      expect(hasInputAttachments([
        { role: "user", content: [{ type: "input_image", file_id: "file_img", detail: "low" }] },
      ])).toBe(true);
    });
  });

  it("awaits beforeGeneration exactly once after exact counting and immediately before create", async () => {
    const order: string[] = [];
    const response = completedResponse([], "완료");
    const { client, create, count } = fakeClient([]);
    count.mockImplementation(() => {
      order.push("count_start");
      return {
        withResponse: vi.fn(async () => {
          order.push("count_done");
          return {
            data: { object: "response.input_tokens", input_tokens: 123 },
            response: new Response(),
            request_id: "req_count",
          };
        }),
      };
    });
    create.mockImplementation(() => {
      order.push("create");
      return apiResult(streamOf([{ type: "response.completed", response }]));
    });
    const beforeGeneration = vi.fn(async () => {
      order.push("before_generation");
    });

    await chatWithToolsStream({
      systemPrompt: "system",
      input: "정확히 센 뒤 생성",
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      client,
    });

    expect(order).toEqual([
      "count_start",
      "count_done",
      "before_generation",
      "create",
    ]);
    expect(beforeGeneration).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not invoke beforeGeneration when the signal aborts after counting", async () => {
    const controller = new AbortController();
    const beforeGeneration = vi.fn();
    const { client, create, count } = fakeClient([]);
    count.mockReturnValue({
      withResponse: vi.fn(async () => {
        controller.abort();
        return {
          data: { object: "response.input_tokens", input_tokens: 123 },
          response: new Response(),
          request_id: "req_count",
        };
      }),
    });

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "중단",
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      signal: controller.signal,
      client,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create a generation when beforeGeneration fails", async () => {
    const hookError = new Error("quota reservation unavailable");
    const beforeGeneration = vi.fn().mockRejectedValue(hookError);
    const { client, create, count } = fakeClient([]);
    count.mockReturnValue(apiResult({
      object: "response.input_tokens",
      input_tokens: 123,
    }, "req_count"));

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "생성 금지",
      tools: [],
      maxInputTokens: 64_000,
      beforeGeneration,
      client,
    })).rejects.toBe(hookError);
    expect(beforeGeneration).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("marks a stage-less generation create error as generation", async () => {
    const { client, create } = fakeClient([]);
    create.mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(new OpenAIProviderError("create failed", {
        category: "transport",
        usageStatus: "unknown",
      })),
    });

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: "생성",
      tools: [],
      beforeGeneration: vi.fn(),
      client,
    })).rejects.toMatchObject({
      category: "transport",
      requestStage: "generation",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps count request ids separate from paid generation request metadata", () => {
    const metadata = getSafeOpenAIErrorMetadata(new OpenAIProviderError("count failed", {
      category: "provider_5xx",
      requestId: "req_count_only",
      requestStage: "input_count",
      usageStatus: "unknown",
      providerCode: "server_error",
    }));

    expect(metadata).toMatchObject({
      provider_request_id: null,
      input_count_request_id: "req_count_only",
      provider_request_stage: "input_count",
      unknown_paid_attempt: false,
    });
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
      beforeGeneration: vi.fn(),
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
      beforeGeneration: vi.fn(),
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
      beforeGeneration: vi.fn(),
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
      beforeGeneration: vi.fn(),
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
