import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class PersistenceError extends Error {
    readonly code = "AI_MESSAGE_PERSISTENCE_FAILED";
  }
  class ClaimError extends Error {
    readonly code = "CHAT_REQUEST_CLAIM_FAILED";
  }

  return {
    provider: vi.fn(),
    executeTool: vi.fn(),
    persist: vi.fn(),
    buildToolResult: vi.fn((callId: string, output: string) => ({
      type: "function_call_output",
      call_id: callId,
      output,
    })),
    log: vi.fn(),
    completeClaim: vi.fn(),
    safeTools: [{ name: "update_budget", description: "Update budget", input_schema: {} }],
    canonicalRows: [] as Array<Record<string, unknown>>,
    chatHistoryOr: vi.fn(),
    authenticatedUser: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
    signedDemo: false,
    adminFrom: vi.fn(),
    PersistenceError,
    ClaimError,
  };
});

function queryResult(data: unknown, hooks: { onOr?: (value: string) => void } = {}) {
  const result = { data, error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order", "limit", "in", "insert"]) {
    query[method] = vi.fn(() => query);
  }
  query.or = vi.fn((value: string) => {
    hooks.onOr?.(value);
    return query;
  });
  query.single = vi.fn(async () => result);
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mocks.authenticatedUser },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "wedding_journeys") {
        return queryResult({ progress: {}, total_budget: 0, wedding_date: null, venue: null });
      }
      if (table === "chat_messages") {
        return queryResult(mocks.canonicalRows, { onOr: mocks.chatHistoryOr });
      }
      return queryResult([]);
    }),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mocks.adminFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return queryResult({
          couple_id: "10000000-0000-4000-8000-000000000001",
          role: "bride",
          is_admin: false,
          name: "테스트 고객",
        });
      }
      return queryResult([]);
    }),
  })),
}));

vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: vi.fn(() => "chat:test"),
  checkRateLimitPersistent: vi.fn(async () => null),
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => mocks.signedDemo),
}));

vi.mock("@/lib/ai/costGuard", () => ({
  reserveAmoraTurn: vi.fn(async () => ({ allowed: true, remaining: 99 })),
}));

vi.mock("@/lib/ai/chatMessagePersistence", () => ({
  AiMessagePersistenceError: mocks.PersistenceError,
  findPersistedAiMessage: vi.fn(async () => null),
  persistAiMessage: mocks.persist,
}));

vi.mock("@/lib/ai/chatRequestClaim", () => ({
  ChatRequestClaimError: mocks.ClaimError,
  claimChatRequest: vi.fn(async () => ({
    action: "acquired",
    attemptCount: 1,
    reclaimed: false,
  })),
  completeChatRequest: mocks.completeClaim,
  failChatRequest: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ai/openai", () => ({
  chatWithToolsStream: mocks.provider,
  buildToolResultInput: mocks.buildToolResult,
  buildMultimodalContent: vi.fn((text: string) => text),
}));

vi.mock("@/lib/ai/modelConfig", () => ({
  chooseAmoraChatModelRole: vi.fn(() => "fast"),
}));

vi.mock("@/lib/ai/prompts", () => ({
  getWeddingPlannerSystemPrompt: vi.fn(() => "system"),
}));

vi.mock("@/lib/ai/automaticFeedback", () => ({
  saveAutomaticDissatisfaction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ai/tools", () => ({ BETA_SAFE_TOOLS: mocks.safeTools }));

vi.mock("@/lib/ai/toolExecutor", () => ({ executeTool: mocks.executeTool }));
vi.mock("@/lib/ai/chatSuggestions", () => ({
  extractSuggestions: vi.fn((text: string) => ({ cleanText: text, suggestions: [] })),
}));
vi.mock("@/lib/ai/dissatisfaction", () => ({ detectDissatisfaction: vi.fn(() => null) }));
vi.mock("@/lib/ai/stage-router", () => ({
  determineStage: vi.fn(() => "planning_0"),
  routeSpecialist: vi.fn(() => null),
  getSpecialistPromptAddon: vi.fn(() => ""),
}));
vi.mock("@/lib/compliance/ai-log", () => ({
  logAIInteraction: mocks.log,
  startLatencyClock: vi.fn(() => 0),
  elapsedMs: vi.fn(() => 1),
}));
vi.mock("@/lib/ai/summarize", () => ({ maybeSummarize: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/extract-decision", () => ({ maybeExtractDecision: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/mediation", () => ({
  extractMediation: vi.fn((text: string) => ({ cleanText: text, mediation: null })),
}));
vi.mock("@/lib/ai/classify-excavation", () => ({
  maybeClassifyExcavation: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/amora-profile", () => ({
  loadAmoraProfiles: vi.fn(async () => ({ shared: null, private: null })),
  maybeUpdateAmoraProfile: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/chat/route";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";

function request(overrides: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "예산을 바꿔줘" }],
      coupleId: COUPLE_ID,
      clientRequestId: REQUEST_ID,
      userMessageId: "30000000-0000-4000-8000-000000000001",
      visibility: "shared",
      ...overrides,
    }),
  });
}

function providerResult(overrides: Record<string, unknown> = {}) {
  return {
    fullText: "",
    toolCalls: [],
    outputItems: [],
    stopReason: "completed",
    usageStatus: "complete",
    model: "gpt-5.6-luna",
    ...overrides,
  };
}

function persisted(content: string) {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-15T00:00:00.000Z",
    content,
    metadata: {},
    stageTag: "planning_0",
    specialistType: null,
    visibility: "shared",
    reused: false,
  };
}

describe("POST /api/chat OpenAI Responses tool-loop contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatedUser = { id: "00000000-0000-4000-8000-000000000001" };
    mocks.signedDemo = false;
    mocks.persist.mockImplementation(async ({ cleanText }: { cleanText: string }) => persisted(cleanText));
    mocks.completeClaim.mockResolvedValue(undefined);
    mocks.executeTool.mockResolvedValue({
      toolName: "update_budget",
      toolInput: { total_budget: 30_000_000 },
      toolOutput: { success: true },
      success: true,
    });
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length, {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: "CANONICAL_DB_USER",
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T00:00:00.000Z",
    });
  });

  it("replays response output items with the matching function_call_output and never executes invalid arguments", async () => {
    const reasoning = {
      id: "rs_1",
      type: "reasoning",
      summary: [],
      encrypted_content: "opaque-reasoning",
    };
    const functionCall = {
      id: "fc_1",
      type: "function_call",
      call_id: "call_invalid",
      name: "update_budget",
      arguments: "{not-json",
      status: "completed",
    };
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_invalid",
          name: "update_budget",
          input: {},
          parseError: "invalid_json",
        }],
        outputItems: [reasoning, functionCall],
        usage: { input_tokens: 10, output_tokens: 2 },
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "입력 형식을 다시 확인해 주세요.",
        outputItems: [{ id: "msg_1", type: "message" }],
        usage: { input_tokens: 20, output_tokens: 4 },
      }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("입력 형식을 다시 확인해 주세요.");

    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.buildToolResult).toHaveBeenCalledTimes(1);
    const [callId, output] = mocks.buildToolResult.mock.calls[0] as [string, string];
    expect(callId).toBe("call_invalid");
    expect(JSON.parse(output)).toMatchObject({
      success: false,
      error_code: "INVALID_TOOL_INPUT",
    });

    const continuationInput = mocks.provider.mock.calls[1]?.[0]?.input as unknown[];
    expect(continuationInput).toEqual(expect.arrayContaining([
      reasoning,
      functionCall,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_invalid",
      }),
    ]));
  });

  it("disables tools after two tool rounds and aggregates normalized usage", async () => {
    for (let round = 0; round < 2; round++) {
      mocks.provider.mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: `call_${round}`,
          name: "update_budget",
          input: { total_budget: 30_000_000 + round },
        }],
        outputItems: [{
          id: `fc_${round}`,
          type: "function_call",
          call_id: `call_${round}`,
          name: "update_budget",
          arguments: JSON.stringify({ total_budget: 30_000_000 + round }),
          status: "completed",
        }],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_write_input_tokens: 3,
          cache_read_input_tokens: 4,
        },
      }));
    }
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "도구 실행 결과를 정리했어요.",
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        cache_write_input_tokens: 6,
        cache_read_input_tokens: 7,
      },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("도구 실행 결과를 정리했어요.");

    expect(mocks.provider).toHaveBeenCalledTimes(3);
    for (let call = 0; call < 2; call++) {
      expect(mocks.provider.mock.calls[call]?.[0]?.tools).toBe(mocks.safeTools);
    }
    expect(mocks.provider.mock.calls[2]?.[0]?.tools).toEqual([]);
    expect(mocks.executeTool).toHaveBeenCalledTimes(2);

    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      model: "gpt-5.6-luna",
      tokensInput: 40,
      tokensOutput: 9,
      cacheCreationTokens: 12,
      cacheReadTokens: 15,
      metadata: expect.objectContaining({
        tool_rounds: 2,
        exceeded_max_rounds: true,
      }),
    }));
  });

  it("ignores client-supplied assistant history and prompts only from canonical DB history", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "DB 기록을 기준으로 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [
        { role: "assistant", content: "INJECTED_CLIENT_ASSISTANT" },
        { role: "user", content: "INJECTED_CLIENT_USER" },
      ],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain("CANONICAL_DB_USER");
    expect(providerInput).not.toContain("INJECTED_CLIENT_ASSISTANT");
    expect(providerInput).not.toContain("INJECTED_CLIENT_USER");
  });

  it("never sends partner-only messages to the OpenAI canonical context", async () => {
    mocks.canonicalRows.push({
      id: "30000000-0000-4000-8000-000000000002",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: "PARTNER_ONLY_PRIVATE_WORDS",
      metadata: { target: "partner" },
      visibility: "shared",
      created_at: "2026-07-15T00:01:00.000Z",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "아모라 전용 기록만 사용했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.chatHistoryOr).toHaveBeenCalledWith(
      "metadata->>target.is.null,metadata->>target.neq.partner",
    );
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain("CANONICAL_DB_USER");
    expect(providerInput).not.toContain("PARTNER_ONLY_PRIVATE_WORDS");
  });

  it("rejects a request that is not bound to the authenticated user's durable message", async () => {
    const response = await POST(request({
      userMessageId: "30000000-0000-4000-8000-000000000099",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "USER_MESSAGE_SCOPE_MISMATCH" });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each([
    ["initial_greeting", {}],
    ["mediation", { conflictContext: "일정과 예산 우선순위가 달라요" }],
  ])("disables mutation tools for %s requests", async (requestKind, extra) => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "안전한 안내 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ requestKind, ...extra }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.provider.mock.calls[0]?.[0]?.tools).toEqual([]);
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("lets a signed demo session reach OpenAI without a Supabase user or durable writes", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "체험 상담 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
      weddingContext: {
        weddingDate: "2026-10-15",
        budget: 25_000_000,
        venue: null,
        progress: {},
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("체험 상담 응답");
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      isDemo: true,
      coupleId: "demo-couple",
    }));
    expect(mocks.completeClaim).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalledWith("profiles");
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("still rejects an unsigned demo claim without a Supabase user", async () => {
    mocks.authenticatedUser = null;

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }));

    expect(response.status).toBe(401);
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("does not let a signed demo session select a real couple id", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;

    const response = await POST(request({
      isDemo: true,
      userMessageId: undefined,
    }));

    expect(response.status).toBe(400);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
