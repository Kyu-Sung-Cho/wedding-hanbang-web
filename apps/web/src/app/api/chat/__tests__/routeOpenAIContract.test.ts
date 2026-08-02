import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => {
  class PersistenceError extends Error {
    readonly code = "AI_MESSAGE_PERSISTENCE_FAILED";
  }
  class ClaimError extends Error {
    readonly code = "CHAT_REQUEST_CLAIM_FAILED";
  }
  class CostGuardError extends Error {
    readonly code: string;

    constructor(readonly result: {
      allowed: boolean;
      reason?: string;
      message?: string;
    }) {
      super(result.message ?? "AMORA_COST_GUARD_BLOCKED");
      this.name = "AmoraCostGuardError";
      this.code = result.reason === "couple_quota"
        ? "COST_GUARD_COUPLE_QUOTA"
        : result.reason === "global_daily"
          ? "COST_GUARD_GLOBAL_DAILY"
          : result.reason === "global_budget"
            ? "COST_GUARD_GLOBAL_BUDGET"
            : "COST_GUARD_UNAVAILABLE";
    }
  }
  const reserve = vi.fn();
  const atomicResponses: Array<{
    content: string;
    metadata: Record<string, unknown>;
  }> = [];
  const journal: Array<Record<string, unknown>> = [];
  const loadJournal = vi.fn(async () => journal);
  const buildJournalCheckpoint = vi.fn((callIndex: number, result: {
    toolCalls: unknown[];
    outputItems: unknown[];
  }) => ({
    version: 1,
    callIndex,
    phase: "tool_round",
    toolCalls: result.toolCalls,
    outputItems: result.outputItems,
  }));
  const providerLedger = vi.fn(async (context: {
    userId: string | null;
    coupleId: string | null;
    callIndex: number;
    phase: "tool_round" | "final_no_tool";
    modelRole: string;
    requestKey: string;
    costGuard: Record<string, unknown>;
    onCostReserved?: (result: unknown) => void;
  }, call: (
    beforeGeneration: () => Promise<void>,
    reserveBeforeSideEffect: () => Promise<void>,
  ) => Promise<unknown>, options?: {
    buildAtomicChatResponse?: (result: unknown) => null | {
      content: string;
      metadata: Record<string, unknown>;
      stageTag: string | null;
      specialistType: string | null;
      visibility: "shared" | "bride_private" | "groom_private";
    };
    onAtomicChatResponseFinalized?: (result: unknown) => void;
    buildToolRoundCheckpoint?: (result: unknown) => unknown;
  }) => {
    let reservationPromise: Promise<void> | null = null;
    const beforeGeneration = async () => {
      reservationPromise ??= (async () => {
        const reservation = await reserve({}, context.costGuard);
        if (!reservation.allowed) throw new CostGuardError(reservation);
        context.onCostReserved?.(reservation);
      })();
      await reservationPromise;
    };
    const result = await call(beforeGeneration, beforeGeneration);
    const atomic = options?.buildAtomicChatResponse?.(result) ?? null;
    options?.buildToolRoundCheckpoint?.(result);
    if (atomic) {
      atomicResponses.push({
        content: atomic.content,
        metadata: atomic.metadata,
      });
      options?.onAtomicChatResponseFinalized?.({
        outcome: "persisted",
        message: {
          id: "20000000-0000-4000-8000-000000000001",
          createdAt: "2026-07-15T00:00:00.000Z",
          content: atomic.content,
          metadata: atomic.metadata,
          stageTag: atomic.stageTag,
          specialistType: atomic.specialistType,
          visibility: atomic.visibility,
          reused: false,
        },
      });
    }
    return result;
  });

  return {
    provider: vi.fn(),
    mammothExtract: vi.fn(),
    providerLedger,
    executeTool: vi.fn(),
    persist: vi.fn(),
    findPersisted: vi.fn(),
    reconcile: vi.fn(),
    chooseModelRole: vi.fn(() => "fast"),
    buildToolResult: vi.fn((callId: string, output: string) => ({
      type: "function_call_output",
      call_id: callId,
      output,
    })),
    log: vi.fn(),
    completeClaim: vi.fn(),
    claim: vi.fn(),
    failClaim: vi.fn(),
    safeTools: [
      {
        name: "update_budget",
        description: "Update budget",
        input_schema: {
          type: "object",
          properties: { total_budget: { type: "number" } },
          required: ["total_budget"],
        },
      },
      {
        name: "add_schedule_event",
        description: "Add schedule",
        input_schema: {
          type: "object",
          properties: {
            date: { type: "string" },
            title: { type: "string" },
          },
          required: ["date", "title"],
        },
      },
      { name: "get_wedding_info", description: "Read wedding info", input_schema: {} },
      { name: "analyze_quote", description: "Analyze quote", input_schema: {} },
    ],
    canonicalRows: [] as Array<Record<string, unknown>>,
    profileProjectionRows: [] as Array<Record<string, unknown>>,
    profileProjectionError: null as { code: string } | null,
    journeyError: null as { code: string; message: string } | null,
    directoryError: null as { code: string; message: string } | null,
    bookingsError: null as { code: string; message: string } | null,
    summariesError: null as { code: string; message: string } | null,
    decisionsError: null as { code: string; message: string } | null,
    directoryRows: [] as Array<Record<string, unknown>>,
    memoryEnablement: {
      shared: false,
      bride_private: false,
      groom_private: false,
    },
    chatHistoryOr: vi.fn(),
    requestFrom: vi.fn(),
    profileSourceSelect: vi.fn(),
    authenticatedUser: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
    signedDemo: false,
    demoSessionToken: "signed-demo-test-token",
    demoSessionId: "demo-session-scope-1",
    demoDailyCostLedgerId: "50000000-0000-4000-8000-000000000001",
    reserve,
    atomicResponses,
    journal,
    loadJournal,
    buildJournalCheckpoint,
    rateLimit: vi.fn(),
    adminFrom: vi.fn(),
    storageFrom: vi.fn(),
    storageUpload: vi.fn(),
    storageRemove: vi.fn(),
    attachmentMessageUpdate: vi.fn(),
    buildMultimodal: vi.fn((text: string, attachments: unknown[]) => ({ text, attachments })),
    attachmentMessage: {
      id: "30000000-0000-4000-8000-000000000001",
      couple_id: "10000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      role: "user",
      visibility: "shared",
      metadata: null as Record<string, unknown> | null,
    },
    enqueueMemory: vi.fn(),
    PersistenceError,
    ClaimError,
    CostGuardError,
  };
});

function queryResult(data: unknown, hooks: {
  onOr?: (value: string) => void;
  onSelect?: (value: string) => unknown;
  onSelectError?: (value: string) => unknown;
  onUpdate?: (value: Record<string, unknown>) => unknown;
} = {}) {
  const result: { data: unknown; error: unknown } = { data, error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "neq", "order", "limit", "in", "is", "not", "insert"]) {
    query[method] = vi.fn(() => query);
  }
  query.select = vi.fn((value: string) => {
    const selected = hooks.onSelect?.(value);
    if (selected !== undefined) result.data = selected;
    const error = hooks.onSelectError?.(value);
    if (error !== undefined) result.error = error;
    return query;
  });
  query.or = vi.fn((value: string) => {
    hooks.onOr?.(value);
    return query;
  });
  query.update = vi.fn((value: Record<string, unknown>) => {
    const updated = hooks.onUpdate?.(value);
    if (updated !== undefined) result.data = updated;
    return query;
  });
  query.single = vi.fn(async () => result);
  query.maybeSingle = vi.fn(async () => ({
    data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
    error: result.error,
  }));
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
    from: mocks.requestFrom.mockImplementation((table: string) => {
      if (table === "wedding_journeys") {
        return queryResult(
          { progress: {}, total_budget: 0, wedding_date: null, venue: null },
          { onSelectError: () => mocks.journeyError },
        );
      }
      if (table === "chat_messages") {
        return queryResult(mocks.canonicalRows, { onOr: mocks.chatHistoryOr });
      }
      if (table === "couple_profile_directory") {
        return queryResult(mocks.directoryRows, {
          onSelectError: () => mocks.directoryError,
        });
      }
      if (table === "vendor_bookings") {
        return queryResult([], {
          onSelectError: () => mocks.bookingsError,
        });
      }
      if (table === "chat_summaries") {
        return queryResult([], {
          onSelectError: () => mocks.summariesError,
        });
      }
      if (table === "decision_nodes") {
        return queryResult([], {
          onSelect: (selection) => selection.includes("source_message:chat_messages")
            ? (mocks.profileSourceSelect(), mocks.profileProjectionRows)
            : [],
          onSelectError: (selection) => selection.includes("source_message:chat_messages")
            ? mocks.profileProjectionError
            : mocks.decisionsError,
        });
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
      if (table === "chat_messages") {
        return queryResult(mocks.attachmentMessage, {
          onUpdate: (value) => {
            mocks.attachmentMessageUpdate(value);
            mocks.attachmentMessage = {
              ...mocks.attachmentMessage,
              metadata: value.metadata as Record<string, unknown>,
            };
            return mocks.attachmentMessage;
          },
        });
      }
      return queryResult([]);
    }),
    storage: {
      from: mocks.storageFrom.mockImplementation(() => ({
        upload: mocks.storageUpload,
        remove: mocks.storageRemove,
      })),
    },
  })),
}));

vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: vi.fn(() => "chat:test"),
  rateLimitSubjectKey: vi.fn(() => "chat-demo-session:test"),
  checkRateLimitPersistent: mocks.rateLimit,
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => mocks.signedDemo),
  getCookieValue: vi.fn(() => mocks.demoSessionToken),
  getSignedDemoSessionFromCookieHeader: vi.fn(() => mocks.signedDemo
    ? {
        token: mocks.demoSessionToken,
        issuedAt: 1_786_003_200_000,
        sessionId: mocks.demoSessionId,
        dailyCostLedgerId: mocks.demoDailyCostLedgerId,
      }
    : null),
}));

vi.mock("@/lib/ai/costGuard", () => ({
  AmoraCostGuardError: mocks.CostGuardError,
  reserveAmoraProviderCall: mocks.reserve,
  reserveAmoraTurn: mocks.reserve,
}));

vi.mock("@/lib/ai/chatMessagePersistence", () => ({
  AiMessagePersistenceError: mocks.PersistenceError,
  findPersistedAiMessage: mocks.findPersisted,
  persistAiMessage: mocks.persist,
}));

vi.mock("@/lib/ai/chatRequestClaim", () => ({
  ChatRequestClaimError: mocks.ClaimError,
  claimChatRequest: mocks.claim,
  reconcileChatRequest: mocks.reconcile,
  completeChatRequest: mocks.completeClaim,
  failChatRequest: mocks.failClaim,
}));

vi.mock("@/lib/ai/openai", () => ({
  chatWithToolsStream: mocks.provider,
  buildToolResultInput: mocks.buildToolResult,
  buildMultimodalContent: mocks.buildMultimodal,
}));

vi.mock("@/lib/ai/modelConfig", () => ({
  chooseAmoraChatModelRole: mocks.chooseModelRole,
}));

vi.mock("@/lib/ai/prompts", () => ({
  getWeddingPlannerSystemPrompt: vi.fn((context: { amoraProfiles?: unknown }) =>
    `system\nprofiles=${JSON.stringify(context.amoraProfiles ?? null)}`
  ),
}));

vi.mock("@/lib/ai/automaticFeedback", () => ({
  saveAutomaticDissatisfaction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ai/tools", () => ({
  BETA_SAFE_TOOLS: mocks.safeTools,
  WEDDING_TOOLS: mocks.safeTools,
}));

vi.mock("@/lib/ai/amoraProviderCallLedger", () => ({
  runAmoraProviderCallWithLedger: mocks.providerLedger,
}));

vi.mock("@/lib/ai/amoraTurnJournal", () => ({
  loadAmoraToolRoundJournal: mocks.loadJournal,
  buildAmoraToolRoundCheckpoint: mocks.buildJournalCheckpoint,
}));

vi.mock("@/lib/ai/toolExecutor", () => ({ executeTool: mocks.executeTool }));
vi.mock("mammoth", () => ({ extractRawText: mocks.mammothExtract }));
vi.mock("@/lib/ai/chatSuggestions", () => ({
  extractSuggestions: vi.fn((text: string) => ({ cleanText: text, suggestions: [] })),
}));
vi.mock("@/lib/ai/dissatisfaction", () => ({ detectDissatisfaction: vi.fn(() => null) }));
vi.mock("@/lib/ai/stage-router", () => ({
  determineStage: vi.fn(() => "planning_0"),
  routeSpecialist: vi.fn(() => "general"),
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
vi.mock("@/lib/ai/amoraMemoryQueue", () => ({
  getAmoraMemoryEnablement: vi.fn(async () => mocks.memoryEnablement),
  enqueueAmoraMemoryJob: mocks.enqueueMemory.mockResolvedValue("disabled"),
}));

import { POST } from "@/app/api/chat/route";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import {
  docxRequiredEntries,
  makeDocxZipFixture,
} from "@/lib/ai/__tests__/docxArchiveFixture";
import { createAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";

function request(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  url = "http://localhost/api/chat",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
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

function projectionRow({
  visibility = "shared",
  actor = "bride",
  memoryKey = "venue:preferred_area",
  value = "강남",
  sourceMessage = undefined,
}: {
  visibility?: "shared" | "bride_private" | "groom_private";
  actor?: "bride" | "groom";
  memoryKey?: string;
  value?: string;
  sourceMessage?: Record<string, unknown> | null;
} = {}) {
  const sourceMessageId = actor === "bride"
    ? "30000000-0000-4000-8000-000000000001"
    : "30000000-0000-4000-8000-000000000002";
  return {
    id: `${actor}-${visibility}-${memoryKey}`,
    couple_id: COUPLE_ID,
    visibility,
    memory_key: memoryKey,
    title: "명시한 맞춤 정보",
    chosen_value: { value },
    reasoning: null,
    confidence: 0.9,
    source_message_id: sourceMessageId,
    source_actor_role: actor,
    superseded_at: null,
    metadata: { memory_kind: "preference", explicit: true },
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
    source_message: sourceMessage === undefined
      ? {
          id: sourceMessageId,
          couple_id: COUPLE_ID,
          visibility,
          sender_id: actor === "bride"
            ? "00000000-0000-4000-8000-000000000001"
            : "00000000-0000-4000-8000-000000000002",
          sender_type: actor,
          role: "user",
          metadata: null,
        }
      : sourceMessage,
  };
}

function providerAfterPreGeneration(result: ReturnType<typeof providerResult>) {
  mocks.provider.mockImplementationOnce(async (options: {
    beforeGeneration?: () => Promise<void>;
  }) => {
    await options.beforeGeneration?.();
    return result;
  });
}

describe("POST /api/chat OpenAI Responses tool-loop contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatedUser = { id: "00000000-0000-4000-8000-000000000001" };
    mocks.signedDemo = false;
    mocks.demoSessionToken = "signed-demo-test-token";
    mocks.demoSessionId = "demo-session-scope-1";
    mocks.demoDailyCostLedgerId = "50000000-0000-4000-8000-000000000001";
    mocks.memoryEnablement = {
      shared: false,
      bride_private: false,
      groom_private: false,
    };
    mocks.profileProjectionRows.splice(0);
    mocks.atomicResponses.splice(0);
    mocks.journal.splice(0);
    mocks.profileProjectionError = null;
    mocks.journeyError = null;
    mocks.directoryError = null;
    mocks.bookingsError = null;
    mocks.summariesError = null;
    mocks.decisionsError = null;
    mocks.directoryRows.splice(0, mocks.directoryRows.length,
      { id: "00000000-0000-4000-8000-000000000001", name: "테스트 신부", role: "bride" },
      { id: "00000000-0000-4000-8000-000000000002", name: "테스트 신랑", role: "groom" },
    );
    mocks.reserve.mockResolvedValue({ allowed: true, remaining: 99 });
    mocks.mammothExtract.mockResolvedValue({ value: "정상 문서" });
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 1,
      reclaimed: false,
    });
    mocks.findPersisted.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(true);
    mocks.chooseModelRole.mockReturnValue("fast");
    mocks.failClaim.mockResolvedValue(undefined);
    mocks.rateLimit.mockResolvedValue(null);
    mocks.storageUpload.mockResolvedValue({ data: { path: "stored" }, error: null });
    mocks.storageRemove.mockResolvedValue({ data: [], error: null });
    mocks.buildMultimodal.mockImplementation((text: string, attachments: unknown[]) => ({
      text,
      attachments,
    }));
    mocks.attachmentMessage = {
      id: "30000000-0000-4000-8000-000000000001",
      couple_id: COUPLE_ID,
      sender_id: "00000000-0000-4000-8000-000000000001",
      role: "user",
      visibility: "shared",
      metadata: null,
    };
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
      content: "CANONICAL_DB_USER 총 예산을 4천만원으로 변경해줘",
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T00:00:00.000Z",
    });
  });

  it("charges the limiter before returning canonical crisis guidance without attachments, persistence, model, cost, tools, or memory", async () => {
    const disclosure = "지금 죽\u200B고 싶어요";
    const actionId = "11111111-1111-4111-8111-111111111111";
    const now = Date.now();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: disclosure,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-16T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 1,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now + 10 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-16T00:00:00.000Z",
      },
    );
    const response = await POST(request({
      // A forged benign client copy must not override the canonical DB row.
      messages: [{ role: "user", content: "예산 변경을 계속해줘" }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("자살예방상담전화 109");
    expect(body).toContain("경찰 112");
    expect(body).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(body).not.toContain(disclosure);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "chat:test",
      { maxRequests: 60, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.chooseModelRole).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("blocks crisis guidance before attachment work when the ordinary limiter is exhausted", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "자해할 생각이 들어",
    };
    mocks.rateLimit.mockResolvedValue(new Response("limited", { status: 429 }));

    const response = await POST(request({
      messages: [{ role: "user", content: "자해할 생각이 들어" }],
      attachments: [{ kind: "image", fileName: "remote.png", url: "https://example.test/private.png" }],
    }));

    expect(response.status).toBe(429);
    expect(await response.text()).toBe("limited");
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("returns fixed violence guidance without entering durable claim reconciliation", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "지금 배우자에게 맞았어",
    };
    mocks.reconcile.mockResolvedValue(false);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({
      messages: [{ role: "user", content: "지금 배우자에게 맞았어" }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("여성긴급전화 1366");
    expect(body).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("applies the same deterministic safety boundary to authenticated mediation", async () => {
    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext: "남편이 지금 제 목을 조르고 있어요",
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("경찰 112");
    expect(body).toContain("소방 119");
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("returns the same deterministic safety boundary in the signed demo without durable writes or paid work", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.persist.mockImplementation(async ({
      cleanText,
      metadata,
      visibility,
    }: {
      cleanText: string;
      metadata: Record<string, unknown>;
      visibility: "shared";
    }) => ({
      id: null,
      createdAt: null,
      content: cleanText,
      metadata,
      stageTag: null,
      specialistType: null,
      visibility,
      reused: false,
    }));

    const response = await POST(request({
      isDemo: true,
      coupleId: "demo-couple",
      userMessageId: undefined,
      messages: [{ role: "user", content: "성\u200B폭행을 당했어" }],
    }));

    expect(response.status).toBe(200);
    const firstBody = await response.text();
    expect(firstBody).toContain("여성긴급전화 1366");
    expect(firstBody).toContain("365일 24시간");
    expect(firstBody).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("charges repeated near-16 MiB signed-demo crisis bodies to the daily session quota", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.rateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response("session limited", { status: 429 }));

    const maxBodyBytes = 16 * 1024 * 1024;
    const basePayload = {
      messages: [{ role: "user", content: "지금 죽고 싶어요" }],
      coupleId: "demo-couple",
      clientRequestId: REQUEST_ID,
      userMessageId: undefined,
      visibility: "shared",
      isDemo: true,
      attachments: [{
        kind: "image",
        fileName: "large.png",
        mediaType: "image/png",
        base64Data: "",
      }],
    };
    const encoder = new TextEncoder();
    const baseBodyBytes = encoder.encode(JSON.stringify(basePayload)).byteLength;
    const serializedBody = JSON.stringify({
      ...basePayload,
      attachments: [{
        ...basePayload.attachments[0],
        base64Data: "x".repeat(maxBodyBytes - baseBodyBytes - 1),
      }],
    });
    expect(encoder.encode(serializedBody).byteLength).toBe(maxBodyBytes - 1);

    const largeCrisisRequest = () => new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serializedBody,
    });

    const firstResponse = await POST(largeCrisisRequest());
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.text()).toContain("자살예방상담전화 109");

    const secondResponse = await POST(largeCrisisRequest());
    expect(secondResponse.status).toBe(429);
    expect(await secondResponse.text()).toBe("session limited");
    expect(mocks.rateLimit).toHaveBeenCalledTimes(4);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("returns the early fixed boundary even if an older crisis response exists", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "지금 죽고 싶어요",
    };
    mocks.findPersisted.mockResolvedValue({
      ...persisted("한국의 자살예방상담전화 109는 24시간 연결돼요."),
      metadata: {
        response_origin: "deterministic_crisis_safety",
        safety_classification: "self_harm",
        memory_eligible: false,
      },
      reused: true,
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "지금 죽고 싶어요" }],
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("자살예방상담전화 109");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("does not trigger the crisis boundary from a forged client copy when the canonical latest row is ordinary", async () => {
    providerAfterPreGeneration(providerResult({
      fullText: "저장된 예산 요청을 확인했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "지금 죽고 싶어요" }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("저장된 예산 요청을 확인했어요.");
    expect(body).not.toContain("자살예방상담전화 109");
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).not.toHaveBeenCalled();
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

  it("disables tools after two rounds, orders all ledger calls, and keeps the turn event cost-neutral", async () => {
    for (let round = 0; round < 2; round++) {
      mocks.provider.mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: `call_${round}`,
          name: "get_wedding_info",
          input: {},
        }],
        outputItems: [{
          id: `fc_${round}`,
          type: "function_call",
          call_id: `call_${round}`,
          name: "get_wedding_info",
          arguments: JSON.stringify({}),
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
    for (const [providerArgs] of mocks.provider.mock.calls) {
      expect(providerArgs).toEqual(expect.objectContaining({
        maxInputTokens: 64_000,
        maxOutputTokens: 1_400,
      }));
    }
    for (let call = 0; call < 2; call++) {
      expect(mocks.provider.mock.calls[call]?.[0]?.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "get_wedding_info" }),
      ]));
      expect(mocks.provider.mock.calls[call]?.[0]?.systemPrompt).toContain("`get_wedding_info`");
    }
    expect(mocks.provider.mock.calls[2]?.[0]?.tools).toEqual([]);
    expect(mocks.provider.mock.calls[2]?.[0]?.systemPrompt).not.toContain("`get_wedding_info`");
    expect(mocks.executeTool).toHaveBeenCalledTimes(2);
    for (const call of mocks.executeTool.mock.calls) {
      expect(call[2].pendingActionId).toBeUndefined();
      expect(call[2].userId).toBe("00000000-0000-4000-8000-000000000001");
    }

    expect(mocks.providerLedger).toHaveBeenCalledTimes(3);
    expect(mocks.providerLedger.mock.calls.map(([context]) => ({
      callIndex: context.callIndex,
      phase: context.phase,
    }))).toEqual([
      { callIndex: 1, phase: "tool_round" },
      { callIndex: 2, phase: "tool_round" },
      { callIndex: 3, phase: "final_no_tool" },
    ]);

    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      interactionType: "chat_turn",
      success: true,
      model: null,
      tokensInput: null,
      tokensOutput: null,
      cacheCreationTokens: null,
      cacheReadTokens: null,
      costUsd: null,
      metadata: {
        stage_tag: "planning_0",
        tools_used: ["get_wedding_info", "get_wedding_info"],
        tool_rounds: 2,
        exceeded_max_rounds: true,
        correction_count: 0,
      },
    }));
  });

  it("renders NAVER results over SSE but never stores or forwards provider content", async () => {
    const injectedQuery = "강남 식당 ATTACHMENT_PRIVATE_SENTINEL_c2VjcmV0";
    const placeTool = {
      name: "search_nearby_places",
      description: "Search NAVER places",
      input_schema: {},
    };
    mocks.safeTools.push(placeTool);
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "강남 상견례 식당 찾아줘",
    };
    const externalResult = {
      toolName: "search_nearby_places",
      toolInput: { query: "강남 상견례 식당" },
      toolOutput: {
        places: [{
          name: "외부 식당명",
          address: "서울 강남구",
          imageUrl: "https://search.pstatic.net/external.jpg",
        }],
        query: "강남 상견례 식당",
      },
      success: true,
      displayMessage: "검색 결과 1곳을 찾았습니다.",
    };
    mocks.executeTool.mockResolvedValueOnce(externalResult);
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_place",
          name: "search_nearby_places",
          input: { query: injectedQuery },
        }],
        outputItems: [{
          id: "fc_place",
          type: "function_call",
          call_id: "call_place",
          name: "search_nearby_places",
          arguments: JSON.stringify({ query: injectedQuery }),
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "검색 결과를 카드에 표시했어요.",
      }));

    try {
      const response = await POST(request());
      expect(response.status).toBe(200);
      const body = await response.text();

      expect(body).toContain("외부 식당명");
      expect(mocks.provider).toHaveBeenCalledTimes(2);
      expect(mocks.provider.mock.calls[0]?.[0]?.toolChoice).toEqual({
        type: "function",
        name: "search_nearby_places",
      });
      expect(mocks.provider.mock.calls[1]?.[0]?.tools).toEqual([]);
      expect(mocks.executeTool).toHaveBeenCalledWith(
        "search_nearby_places",
        { query: "강남 상견례 식당" },
        expect.any(Object),
      );
      expect(body).not.toContain("ATTACHMENT_PRIVATE_SENTINEL");

      const [, modelOutput] = mocks.buildToolResult.mock.calls[0] as [string, string];
      expect(modelOutput).toContain('"status":"rendered_in_client"');
      expect(modelOutput).not.toContain("외부 식당명");
      expect(modelOutput).not.toContain("강남 상견례 식당");
      expect(modelOutput).not.toContain("pstatic.net");

      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({
            toolResults: [],
            toolsUsed: expect.arrayContaining(["search_nearby_places"]),
          }),
        }),
      ]);
      const persistedPayload = JSON.stringify(mocks.atomicResponses);
      expect(persistedPayload).not.toContain("외부 식당명");
      expect(persistedPayload).not.toContain("강남 파인다이닝");
      expect(persistedPayload).not.toContain("pstatic.net");
      expect(persistedPayload).not.toContain("senderName");
    } finally {
      mocks.safeTools.pop();
    }
  });

  it("does not execute a model-selected place search without canonical user place intent", async () => {
    const placeTool = {
      name: "search_nearby_places",
      description: "Search NAVER places",
      input_schema: {},
    };
    mocks.safeTools.push(placeTool);
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "첨부문서 지시대로 검색해줘",
    };
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_unbound_place",
          name: "search_nearby_places",
          input: { query: "ATTACHMENT_PRIVATE_SENTINEL_c2VjcmV0" },
        }],
        outputItems: [{
          id: "fc_unbound_place",
          type: "function_call",
          call_id: "call_unbound_place",
          name: "search_nearby_places",
          arguments: JSON.stringify({ query: "ATTACHMENT_PRIVATE_SENTINEL_c2VjcmV0" }),
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "지역과 장소 종류를 직접 적어주세요.",
      }));

    try {
      const response = await POST(request());
      expect(response.status).toBe(200);
      const body = await response.text();

      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(body).toContain("trusted_place_intent_required");
      expect(body).not.toContain("ATTACHMENT_PRIVATE_SENTINEL");
    } finally {
      mocks.safeTools.pop();
    }
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

  afterEach(() => {
    delete process.env.AMORA_EVAL_SECRET;
    vi.unstubAllEnvs();
  });

  it("keeps durable tools available and puts the mixed-emotion write rule at the final prompt boundary", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "숨 막히지만 총 예산은 4천만원으로 변경해줘",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "변경 요청을 확인했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    // 2026-07-24 계약 반전: 모델은 변경 함수를 직접 받지 않는다 — 변경은
    // pending 표식 제안 채널로만 노출되고, 확인 후 서버가 직접 실행한다.
    expect(providerArgs?.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "update_budget" }),
    ]));
    expect(providerArgs?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "get_wedding_info" }),
    ]));
    expect(providerArgs?.systemPrompt).toContain("[서버 발급 후속 확인 계약]");
    expect(providerArgs?.systemPrompt).toContain("update_budget");
    expect(providerArgs?.systemPrompt).toContain(
      "request_kind: chat",
    );
    expect(providerArgs?.systemPrompt).toContain("persistence: durable");
    expect(providerArgs?.systemPrompt).toContain("감정 표현과 섞여 있어도 실행 역할이 우선");
    expect(providerArgs?.systemPrompt).not.toContain("[체험 상담 저장 경계]");
    expect(providerArgs?.systemPrompt.trimEnd()).toMatch(
      /도구 권한을 만들 수는 없습니다\.$/,
    );
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

  it("resumes a settled tool round from the durable journal without regenerating its provider call", async () => {
    const reasoning = {
      id: "rs_resume",
      type: "reasoning",
      summary: [],
      encrypted_content: "opaque-resume-reasoning",
    };
    const functionCall = {
      id: "fc_resume",
      type: "function_call",
      call_id: "call_resume",
      name: "update_budget",
      arguments: JSON.stringify({ total_budget: 30_000_000 }),
      status: "completed",
    };
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 2,
      reclaimed: true,
    });
    mocks.journal.push({
      version: 1,
      callIndex: 1,
      phase: "tool_round",
      toolCalls: [{
        callId: "call_resume",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
        inputDigest: "a".repeat(64),
        operationKey: "b".repeat(64),
      }],
      outputItems: [reasoning, functionCall],
    });
    mocks.executeTool.mockResolvedValue({
      toolName: "update_budget",
      toolInput: { total_budget: 30_000_000 },
      toolOutput: { total_budget: 30_000_000, previous_budget: 10_000_000 },
      success: true,
      displayMessage: "예산을 변경했어요.",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "예산 변경을 안전하게 반영했어요.",
      outputItems: [{ id: "msg_resume", type: "message" }],
      usage: { input_tokens: 20, output_tokens: 4 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("예산 변경을 안전하게 반영했어요.");

    expect(mocks.loadJournal).toHaveBeenCalledWith(expect.objectContaining({
      attemptCount: 2,
    }));
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ callIndex: 2, phase: "tool_round" }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({ providerCallIndex: 1 }),
    );
    const continuationInput = mocks.provider.mock.calls[0]?.[0]?.input as unknown[];
    expect(continuationInput).toEqual(expect.arrayContaining([
      reasoning,
      functionCall,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_resume",
      }),
    ]));
  });

  it("replays the exact confirmed server action before continuing a journaled tool round", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    const pendingAction = extractAmoraPendingAction({
      text: '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
      allowedTools: mocks.safeTools,
      now,
      createActionId: () => actionId,
    }).pendingAction;
    expect(pendingAction).not.toBeNull();
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 2,
      reclaimed: true,
    });
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "Yes",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "Change the budget?",
        metadata: {
          pending_amora_action: pendingAction,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.journal.push({
      version: 1,
      callIndex: 1,
      phase: "tool_round",
      toolCalls: [{
        callId: "call_read",
        name: "get_wedding_info",
        input: {},
        inputDigest: "a".repeat(64),
        operationKey: "b".repeat(64),
      }],
      outputItems: [{
        id: "fc_read",
        type: "function_call",
        call_id: "call_read",
        name: "get_wedding_info",
        arguments: "{}",
        status: "completed",
      }],
    });
    mocks.executeTool.mockImplementation(async (toolName: string, toolInput: unknown) => ({
      toolName,
      toolInput,
      toolOutput: toolName === "update_budget"
        ? { total_budget: 30_000_000, previous_budget: 10_000_000 }
        : { total_budget: 30_000_000 },
      success: true,
      displayMessage: "Done.",
    }));
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "The confirmed change is complete.",
      outputItems: [{ id: "msg_terminal", type: "message" }],
      usage: { input_tokens: 20, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "Yes" }],
      confirmedActionId: actionId,
    }));
    const responseText = await response.text();
    expect(response.status, responseText).toBe(200);

    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({ pendingActionId: actionId }),
    );
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "get_wedding_info",
      {},
      expect.objectContaining({ providerCallIndex: 1 }),
    );
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input))
      .toContain("SERVER_CONFIRMED_ACTION_RESULT");
  });

  it("passes the durable normal-chat user message into the request claim", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "확인했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: COUPLE_ID,
      userId: "00000000-0000-4000-8000-000000000001",
      userMessageId: "30000000-0000-4000-8000-000000000001",
      visibility: "shared",
    }));
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
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).not.toContain("`update_budget`");
    expect(mocks.executeTool).not.toHaveBeenCalled();
    if (requestKind === "mediation") {
      expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
        "구조화 중재 최종 안전 계약",
      );
    }
  });

  it("keeps an authenticated user on the durable cost and data boundary despite a signed demo cookie and body flag", async () => {
    mocks.signedDemo = true;
    providerAfterPreGeneration(providerResult({
      fullText: "인증 사용자 상담 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ isDemo: true }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("인증 사용자 상담 응답");
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        coupleId: COUPLE_ID,
        quotaScope: "standard",
      }),
    );
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "00000000-0000-4000-8000-000000000001",
        coupleId: COUPLE_ID,
        source: "durable",
      }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.adminFrom).toHaveBeenCalledWith("profiles");
    expect(mocks.persist).not.toHaveBeenCalled();
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
    expect(mocks.provider.mock.calls[0]?.[0]?.tools).toEqual([]);
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
      "[체험 상담 저장 경계]",
    );
    expect(mocks.provider.mock.calls[0]?.[0]?.safetyIdentifierScope)
      .toMatch(/^demo:[a-f0-9]{64}$/);
    expect(mocks.provider.mock.calls[0]?.[0]?.safetyIdentifierScope)
      .not.toContain(mocks.demoSessionToken);
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      isDemo: true,
      coupleId: "demo-couple",
    }));
    expect(mocks.completeClaim).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalledWith("profiles");
    expect(mocks.requestFrom).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, coupleId: null }),
      expect.any(Function),
      expect.any(Object),
    );
    const demoLedgerContext = mocks.providerLedger.mock.calls[0]?.[0];
    expect(demoLedgerContext?.requestKey).toMatch(
      /^chat:amora-signed-demo-[a-f0-9]{24}:/,
    );
    expect(demoLedgerContext?.requestKey).not.toContain(mocks.demoSessionId);
    expect(demoLedgerContext?.requestKey).not.toContain(mocks.demoSessionToken);
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      "chat:test",
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(
      2,
      "chat-demo-session:test",
      { maxRequests: 20, windowMs: 24 * 60 * 60 * 1000 },
      { failClosed: true },
    );
  });

  it("blocks a signed demo session before data or provider work when its daily bucket is exhausted", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.rateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response("limited", { status: 429 }));

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }));

    expect(response.status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.requestFrom).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("bounds oversized tool feedback before it is sent into the next provider call", async () => {
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "update_budget",
      toolInput: { total_budget: 30_000_000 },
      toolOutput: { rows: "x".repeat(40_000), ending: "fine-print" },
      success: true,
      displayMessage: "updated",
    });
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_large",
          name: "update_budget",
          input: { total_budget: 30_000_000 },
        }],
        outputItems: [{ id: "fc_large", type: "function_call" }],
      }))
      .mockResolvedValueOnce(providerResult({ fullText: "예산을 반영했어요." }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const [, output] = mocks.buildToolResult.mock.calls[0] as [string, string];
    expect(output.length).toBeLessThanOrEqual(4_000);
    expect(JSON.parse(output)).toMatchObject({ truncated: true });
    expect(output).toContain("fine-print");
  });

  it("never executes more than eight model-requested tools in one user turn", async () => {
    const toolCalls = Array.from({ length: 10 }, (_, index) => ({
      callId: `call_limit_${index}`,
      name: "update_budget",
      input: { total_budget: 30_000_000 + index },
    }));
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls,
        outputItems: toolCalls.map((call) => ({
          id: `fc_${call.callId}`,
          type: "function_call",
        })),
      }))
      .mockResolvedValueOnce(providerResult({ fullText: "실행한 범위만 정리했어요." }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.executeTool).toHaveBeenCalledTimes(8);
    expect(mocks.buildToolResult).toHaveBeenCalledTimes(10);
    const overflowOutputs = mocks.buildToolResult.mock.calls
      .slice(8)
      .map(([, output]) => JSON.parse(String(output)));
    expect(overflowOutputs).toEqual([
      expect.objectContaining({ error_code: "TOOL_CALL_LIMIT_REACHED" }),
      expect.objectContaining({ error_code: "TOOL_CALL_LIMIT_REACHED" }),
    ]);
  });

  it("narrows beta-safe tools to the current durable request domain", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "예산 변경을 도와드릴게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const toolNames = mocks.provider.mock.calls[0]?.[0]?.tools
      .map((tool: { name: string }) => tool.name);
    // 변경 함수 제거 후: 직접 호출은 읽기 도구만, 변경은 제안 계약으로만.
    expect(toolNames).toEqual(["get_wedding_info"]);
    expect(toolNames).not.toContain("update_budget");
    expect(toolNames).not.toContain("add_schedule_event");
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .toContain("[서버 발급 후속 확인 계약]");
  });

  it("does not treat canonical assistant prose plus a generic approval as write authority", async () => {
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응, 그렇게 해줘",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총 예산을 4천만원으로 변경해드릴까요?",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "말씀하신 예산으로 변경할게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응, 그렇게 해줘" }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const toolNames = mocks.provider.mock.calls[0]?.[0]?.tools
      .map((tool: { name: string }) => tool.name);
    expect(toolNames).not.toContain("update_budget");
    expect(toolNames).not.toContain("add_schedule_event");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("does not treat a generic reply as authority even when the previous message has a pending action", async () => {
    const now = Date.now();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "다음 변경을 적용할까요?",
        metadata: {
          pending_amora_action: {
            version: 1,
            actionId: "11111111-1111-4111-8111-111111111111",
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 10 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "어떤 변경을 말씀하시는지 다시 알려주세요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("executes only the exact server-issued action after the immediate shared confirmation", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 1,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 10 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "총예산을 3,000만 원으로 반영했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({
        currentUserText: "응",
        pendingActionId: actionId,
      }),
    );
    expect(mocks.reserve.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.executeTool.mock.invocationCallOrder[0]!);
    expect(mocks.executeTool.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.provider.mock.invocationCallOrder[0]!);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "update_budget" }),
    ]));
    expect(providerArgs?.systemPrompt).toContain(actionId);
    expect(JSON.stringify(providerArgs?.input)).toContain("SERVER_CONFIRMED_ACTION_RESULT");
    expect(JSON.stringify(providerArgs?.input)).toContain("update_budget");
  });

  it("rejects a stale durable confirmation when newer Amora context already exists", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "날짜를 다시 확인한 뒤 새로 제안할게요.",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 1,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 10 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "USER_MESSAGE_NOT_LATEST" });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps a confirmation current when the only newer row is partner-only", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "40000000-0000-4000-8000-000000000010",
        sender_id: "00000000-0000-4000-8000-000000000002",
        sender_type: "groom",
        role: "user",
        content: "이건 우리끼리 이야기할게.",
        metadata: { target: "partner" },
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 1,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 10 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "총예산을 반영했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({ pendingActionId: actionId }),
    );
  });

  it("fails closed before provider or tools when the supplied action id is not the immediate proposal", async () => {
    const now = Date.now();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "다음 변경을 적용할까요?",
        metadata: {
          pending_amora_action: {
            version: 1,
            actionId: "11111111-1111-4111-8111-111111111111",
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 10 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "AMORA_PENDING_ACTION_CONFIRMATION_REJECTED",
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("overrides a misleading model proposal and persists only the server-owned truthful summary", async () => {
    const modelConfirmation = "일정만 가볍게 확인해볼까요?";
    const canonicalConfirmation =
      "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원";
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: `${modelConfirmation}\n[pending_action]{"tool":"update_budget","input":{"total_budget":30000000},"confirmation":"${modelConfirmation}"}[/pending_action]`,
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).not.toContain("[pending_action]");
    expect(body).toContain('"type":"text_clear"');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({
        content: canonicalConfirmation,
        metadata: expect.objectContaining({
        pending_amora_action: expect.objectContaining({
          version: 1,
          tool: "update_budget",
          input: { total_budget: 30_000_000 },
          confirmation: canonicalConfirmation,
        }),
      }),
      }),
    ]);
  });

  it("rejects remote attachments before a durable claim or quota reservation", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 첨부를 봐줘",
    };

    const response = await POST(request({
      messages: [{ role: "user", content: "이 첨부를 봐줘" }],
      attachments: [{
        mediaType: "image/png",
        url: "https://untrusted.example/photo.png",
        fileName: "photo.png",
      }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "REMOTE_URL_NOT_ALLOWED" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects malformed attachment entries instead of silently dropping them", async () => {
    const response = await POST(request({ attachments: [null] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_ATTACHMENT" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("stores and sends only the same server-reencoded metadata-free image", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 3,
        background: { r: 70, g: 90, b: 110 },
      },
    })
      .jpeg()
      .withExif({
        IFD0: { Artist: "private-chat-device" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1 33/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "126/1 58/1 0/1",
        },
      })
      .toBuffer();
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 이미지를 봐줘",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "이미지를 확인했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "이 이미지를 봐줘" }],
      attachments: [{
        mediaType: "image/jpeg",
        base64: source.toString("base64"),
        fileName: "photo.jpg",
      }],
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.storageFrom).toHaveBeenCalledWith("chat-image");
    expect(mocks.storageUpload).toHaveBeenCalledTimes(1);
    const [storedPath, storedBody, storedOptions] = mocks.storageUpload.mock.calls[0]!;
    const storedBytes = storedBody as Buffer;
    expect(Buffer.isBuffer(storedBytes)).toBe(true);
    expect(storedOptions).toEqual(expect.objectContaining({
      contentType: "image/jpeg",
      upsert: false,
    }));
    expect(storedPath).toMatch(new RegExp(
      `^${COUPLE_ID}/00000000-0000-4000-8000-000000000001/`
      + "[0-9a-f-]{36}\\.jpeg$",
    ));
    const storedMetadata = await sharp(storedBytes).metadata();
    expect(storedMetadata.exif).toBeUndefined();
    expect(storedMetadata.icc).toBeUndefined();
    expect(storedBytes.includes(Buffer.from("private-chat-device"))).toBe(false);
    expect(storedBytes.equals(source)).toBe(false);

    const providerAttachments = mocks.buildMultimodal.mock.calls[0]?.[1] as Array<{
      base64: string;
      mediaType: string;
    }>;
    expect(providerAttachments).toEqual([{
      base64: storedBytes.toString("base64"),
      mediaType: "image/jpeg",
    }]);
    expect(mocks.attachmentMessageUpdate).toHaveBeenCalledWith({
      metadata: { imagePaths: [storedPath] },
    });
    expect(body).toContain('"type":"attachment_paths"');
    expect(body).toContain(storedPath);
    expect(body).not.toContain(source.toString("base64"));
  });

  it("rejects malformed image bytes without logging or echoing their raw contents", async () => {
    const privateMarker = "gps=37.55,126.98;device=private-chat-phone";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await POST(request({
        attachments: [{
          mediaType: "image/png",
          base64: Buffer.from(privateMarker).toString("base64"),
          fileName: "photo.png",
        }],
      }));
      expect(response.status).toBe(422);
      expect(await response.text()).not.toContain(privateMarker);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateMarker);
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(privateMarker);
      expect(mocks.storageUpload).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("fails closed before provider transfer when sanitized storage upload fails", async () => {
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    }).png().toBuffer();
    mocks.storageUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "storage unavailable" },
    });

    const response = await POST(request({
      attachments: [{
        mediaType: "image/png",
        base64: source.toString("base64"),
        fileName: "photo.png",
      }],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "ATTACHMENT_STORAGE_FAILED" });
    expect(mocks.failClaim).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "ATTACHMENT_STORAGE_FAILED",
    }));
    expect(mocks.attachmentMessageUpdate).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("rejects an unsafe DOCX archive before a durable claim or quota reservation", async () => {
    const response = await POST(request({
      attachments: [{
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        base64: makeDocxZipFixture(docxRequiredEntries([{
          name: "word/bomb.bin",
          data: Buffer.from("x"),
          method: 8,
          uncompressedSize: 10 * 1024 * 1024,
        }])).toString("base64"),
        fileName: "bomb.docx",
      }],
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "UNSAFE_DOCX_ARCHIVE",
      error: expect.stringContaining("안전"),
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.mammothExtract).not.toHaveBeenCalled();
  });

  it("rejects excessive extracted DOCX text before a durable claim or quota reservation", async () => {
    mocks.mammothExtract.mockResolvedValueOnce({ value: "x".repeat(200_001) });
    const response = await POST(request({
      attachments: [{
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        base64: makeDocxZipFixture(docxRequiredEntries()).toString("base64"),
        fileName: "long.docx",
      }],
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "DOCX_TEXT_TOO_LARGE",
      error: expect.stringContaining("너무 길"),
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps a bounded normal DOCX compatible with document analysis", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 Word 문서를 봐줘",
    };
    mocks.mammothExtract.mockResolvedValueOnce({ value: "계약금은 300만원입니다." });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "문서 내용을 살펴봤어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "이 Word 문서를 봐줘" }],
      attachments: [{
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        base64: makeDocxZipFixture(docxRequiredEntries()).toString("base64"),
        fileName: "contract.docx",
      }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.mammothExtract).toHaveBeenCalledTimes(1);
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain("contract.docx");
    expect(providerInput).toContain("계약금은 300만원입니다.");
  });

  it("rejects PDF before storage, claim, quota, or provider transfer", async () => {
    const response = await POST(request({
      messages: [{ role: "user", content: "이 첨부를 봐줘" }],
      attachments: [{
        mediaType: "application/pdf",
        base64: "JVBERi0xLjQK",
        fileName: "quote.pdf",
      }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "PDF_NOT_SUPPORTED",
      error: expect.stringContaining("PDF"),
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("wraps each provider generation in the per-call ledger and applies the exact request envelope", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "예산 변경을 도와드릴게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        coupleId: COUPLE_ID,
        userId: "00000000-0000-4000-8000-000000000001",
        callIndex: 1,
        phase: "tool_round",
        modelRole: "fast",
      }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.provider).toHaveBeenCalledWith(expect.objectContaining({
      maxInputTokens: 64_000,
      maxOutputTokens: 1_400,
    }));
  });

  it("clears a streamed draft and emits no durable done event when the atomic terminal commit is unconfirmed", async () => {
    mocks.provider.mockImplementationOnce(async (options: {
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeGeneration?.();
      options.onTextDelta?.("아직 커밋되지 않은 초안");
      return providerResult({
        fullText: "아직 커밋되지 않은 초안",
        usage: { input_tokens: 10, output_tokens: 3 },
      });
    });
    mocks.providerLedger.mockImplementationOnce(async (_context, call, options) => {
      const result = await call(async () => undefined, async () => undefined);
      options?.buildAtomicChatResponse?.(result);
      throw new Error("[ai-ledger] terminal chat response was not committed");
    });

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("아직 커밋되지 않은 초안");
    expect(body.lastIndexOf('"type":"text_clear"')).toBeGreaterThan(
      body.indexOf("아직 커밋되지 않은 초안"),
    );
    expect(body).toContain('"type":"error"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.completeClaim).not.toHaveBeenCalled();
  });

  it("maps an oversized provider input to an actionable SSE error without leaking internals", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.provider.mockRejectedValueOnce(Object.assign(
      new Error("SECRET_PROVIDER_INPUT_DETAILS"),
      { providerCode: "input_token_limit", requestStage: "input_count" },
    ));

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain('"code":"AMORA_INPUT_TOO_LARGE"');
    expect(body).toContain("대화나 첨부파일 내용이 너무 길어요");
    expect(body).not.toContain("SECRET_PROVIDER_INPUT_DETAILS");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      interactionType: "chat_turn",
      success: false,
      model: null,
      tokensInput: null,
      tokensOutput: null,
      cacheCreationTokens: null,
      cacheReadTokens: null,
      costUsd: null,
    }));
    errorSpy.mockRestore();
  });

  it("distinguishes an input-count service failure from oversized input", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.provider.mockRejectedValueOnce(Object.assign(
      new Error("SECRET_COUNT_ENDPOINT_DETAILS"),
      { providerCode: "server_error", requestStage: "input_count" },
    ));

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"code":"AMORA_INPUT_COUNT_UNAVAILABLE"');
    expect(body).toContain("입력 분량을 확인하는 중 문제가 생겼어요");
    expect(body).not.toContain("SECRET_COUNT_ENDPOINT_DETAILS");
    expect(mocks.reserve).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores authenticated client wedding context and safely handles malformed nested fields", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "서버 정보를 기준으로 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      weddingContext: {
        weddingDate: "2030-01-01",
        budget: 999_999_999,
        venue: "CLIENT_WEDDING_CONTEXT_INJECTION",
        progress: {
          __events: "not-an-array",
          __preferences: { priorities: "not-an-array" },
        },
      },
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = JSON.stringify(mocks.provider.mock.calls[0]?.[0]);
    expect(providerArgs).not.toContain("CLIENT_WEDDING_CONTEXT_INJECTION");
    expect(providerArgs).not.toContain("999999999");
  });

  it("fails closed before cost reservation when canonical wedding context is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.journeyError = { code: "PGRST500", message: "database unavailable" };

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "WEDDING_CONTEXT_UNAVAILABLE" });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it.each([
    ["bookingsError", "BOOKINGS_CONTEXT_UNAVAILABLE"],
    ["directoryError", "COUPLE_DIRECTORY_UNAVAILABLE"],
    ["decisionsError", "DECISIONS_CONTEXT_UNAVAILABLE"],
  ] as const)(
    "fails closed when canonical %s lookup fails",
    async (errorKey, expectedCode) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks[errorKey] = { code: "PGRST500", message: "database unavailable" };

      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: expectedCode });
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.failClaim).toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it("fails closed on a consented memory-summary outage instead of pretending there is no history", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.summariesError = { code: "PGRST500", message: "database unavailable" };

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "MEMORY_CONTEXT_UNAVAILABLE" });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("projects source-validated V2 profile nodes into the prompt when consent is on", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push({
      id: "50000000-0000-4000-8000-000000000001",
      couple_id: COUPLE_ID,
      visibility: "shared",
      memory_key: "venue:preferred_area",
      title: "선호 지역",
      chosen_value: { value: "강남" },
      reasoning: null,
      confidence: 0.9,
      source_message_id: "30000000-0000-4000-8000-000000000001",
      source_actor_role: "bride",
      superseded_at: null,
      metadata: { memory_kind: "preference", explicit: true },
      created_at: "2026-07-15T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z",
      source_message: {
        id: "30000000-0000-4000-8000-000000000001",
        couple_id: COUPLE_ID,
        visibility: "shared",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        metadata: null,
      },
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "맞춤 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
      "신부 명시 · venue:preferred_area = 강남",
    );
  });

  it("does not expose projected profile nodes when memory consent is off", async () => {
    mocks.profileProjectionRows.push({
      id: "50000000-0000-4000-8000-000000000002",
      couple_id: COUPLE_ID,
      visibility: "shared",
      memory_key: "venue:preferred_area",
      title: "선호 지역",
      chosen_value: { value: "CONSENT_OFF_SECRET" },
      reasoning: null,
      confidence: 0.9,
      source_message_id: "30000000-0000-4000-8000-000000000001",
      source_actor_role: "bride",
      superseded_at: null,
      metadata: { memory_kind: "preference", explicit: true },
      created_at: "2026-07-15T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z",
      source_message: {
        id: "30000000-0000-4000-8000-000000000001",
        couple_id: COUPLE_ID,
        visibility: "shared",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        metadata: null,
      },
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).not.toContain(
      "CONSENT_OFF_SECRET",
    );
    expect(mocks.profileSourceSelect).not.toHaveBeenCalled();
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("chat_summaries");
  });

  it("does not query profile sources or summaries for a disabled private scope", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility: "bride_private",
    };
    mocks.profileProjectionRows.push(projectionRow({
      visibility: "bride_private",
      memoryKey: "style:private_secret",
      value: "PRIVATE_CONSENT_OFF_SECRET",
    }));
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 개인 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ visibility: "bride_private" }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.profileSourceSelect).not.toHaveBeenCalled();
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("chat_summaries");
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("PRIVATE_CONSENT_OFF_SECRET");
  });

  it("keeps private chat read-only even when the user asks for a shared-state change", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "총 예산을 4천만원으로 변경해줘",
      visibility: "bride_private",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "공유 대화에서 변경을 도와드릴게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ visibility: "bride_private" }));
    expect(response.status).toBe(200);
    await response.text();

    const toolNames = mocks.provider.mock.calls[0]?.[0]?.tools
      .map((tool: { name: string }) => tool.name);
    expect(toolNames).not.toContain("update_budget");
    expect(toolNames).toContain("get_wedding_info");
  });

  it("uses only the shared projection in a shared chat turn", async () => {
    mocks.memoryEnablement = {
      shared: true,
      bride_private: true,
      groom_private: true,
    };
    mocks.profileProjectionRows.push(
      projectionRow({ value: "SHARED_PROFILE" }),
      projectionRow({
        visibility: "bride_private",
        memoryKey: "style:bride_private",
        value: "BRIDE_PRIVATE_PROFILE",
      }),
      projectionRow({
        visibility: "groom_private",
        actor: "groom",
        memoryKey: "style:groom_private",
        value: "GROOM_PRIVATE_PROFILE",
      }),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "공유 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const prompt = mocks.provider.mock.calls[0]?.[0]?.systemPrompt;
    expect(prompt).toContain("SHARED_PROFILE");
    expect(prompt).not.toContain("BRIDE_PRIVATE_PROFILE");
    expect(prompt).not.toContain("GROOM_PRIVATE_PROFILE");
  });

  it("uses shared and bride-private projections only in a bride-private turn", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility: "bride_private",
    };
    mocks.memoryEnablement = {
      shared: true,
      bride_private: true,
      groom_private: true,
    };
    mocks.profileProjectionRows.push(
      projectionRow({ value: "SHARED_PROFILE" }),
      projectionRow({
        visibility: "bride_private",
        memoryKey: "style:bride_private",
        value: "BRIDE_PRIVATE_PROFILE",
      }),
      projectionRow({
        visibility: "groom_private",
        actor: "groom",
        memoryKey: "style:groom_private",
        value: "GROOM_PRIVATE_PROFILE",
      }),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "개인 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ visibility: "bride_private" }));
    expect(response.status).toBe(200);
    await response.text();

    const prompt = mocks.provider.mock.calls[0]?.[0]?.systemPrompt;
    expect(prompt).toContain("SHARED_PROFILE");
    expect(prompt).toContain("BRIDE_PRIVATE_PROFILE");
    expect(prompt).not.toContain("GROOM_PRIVATE_PROFILE");
  });

  it("fails profile projection closed when the bounded query returns 501 rows", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push(
      projectionRow({ value: "OVERFLOW_MUST_NOT_LEAK" }),
      ...Array.from({ length: 500 }, () => ({})),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("OVERFLOW_MUST_NOT_LEAK");
    expect(warning).toHaveBeenCalledWith(
      "[chat] profile projection failed closed",
      { code: "too_many_nodes" },
    );
    warning.mockRestore();
  });

  it("fails profile projection closed when the dedicated query errors", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push(projectionRow({ value: "QUERY_ERROR_SECRET" }));
    mocks.profileProjectionError = { code: "PGRST200" };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("QUERY_ERROR_SECRET");
    expect(warning).toHaveBeenCalledWith(
      "[chat] profile projection source query failed",
      { name: "UnknownError", code: "PGRST200", status: null },
    );
    warning.mockRestore();
  });

  it("fails all profile fields closed when a V2 source embed is incomplete", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push(
      projectionRow({ value: "OTHERWISE_VALID_SECRET" }),
      projectionRow({
        memoryKey: "style:incomplete_source",
        value: "INCOMPLETE_SOURCE_SECRET",
        sourceMessage: null,
      }),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const prompt = mocks.provider.mock.calls[0]?.[0]?.systemPrompt;
    expect(prompt).not.toContain("OTHERWISE_VALID_SECRET");
    expect(prompt).not.toContain("INCOMPLETE_SOURCE_SECRET");
    expect(warning).toHaveBeenCalledWith(
      "[chat] profile projection failed closed",
      { code: "invalid_source" },
    );
    warning.mockRestore();
  });

  it("adds a server-owned non-persistence notice when demo AI omits it", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    providerAfterPreGeneration(providerResult({
      fullText: "날짜가 정해지니 갑자기 현실로 다가와 숨 막힐 수 있어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
      messages: [{ role: "user", content: "결혼식은 내년 5월 3일로 정했는데 벌써 숨 막혀." }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("실제 일정에는 아직 저장되지 않았어요");
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      cleanText: expect.stringContaining("실제 일정에는 아직 저장되지 않았어요"),
    }));
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        coupleId: mocks.demoDailyCostLedgerId,
        quotaScope: "demo",
      }),
    );
  });

  it("uses a signed, request-bound release evaluation path without consuming demo quota", async () => {
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    providerAfterPreGeneration(providerResult({
      fullText: "평가 상담 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));
    const token = createAmoraEvalToken(process.env.AMORA_EVAL_SECRET, REQUEST_ID);

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": token }, "https://hanbang.ai/api/chat"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("평가 상담 응답");
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      {
        coupleId: "00000000-0000-4000-8000-000000000001",
        isAdmin: false,
        quotaScope: "release_eval",
        maxCostMicrousd: 88_400,
      },
    );
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "chat-eval:production",
      expect.objectContaining({ maxRequests: 12 }),
      { failClosed: true },
    );
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, coupleId: null }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("shares the production evaluation limit across immutable Vercel aliases", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "운영 고정 주소 평가 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));
    const token = createAmoraEvalToken(process.env.AMORA_EVAL_SECRET, REQUEST_ID);

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": token }, "https://wedding-hanbang-production-hanbang.vercel.app/api/chat"));

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "chat-eval:production",
      expect.objectContaining({ maxRequests: 12 }),
      { failClosed: true },
    );
  });

  it("fails a signed release evaluation before provider use when atomic cost reservation is unavailable", async () => {
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      reason: "guard_unavailable",
      message: "평가 사용량을 예약하지 못했습니다.",
    });
    providerAfterPreGeneration(providerResult({ fullText: "절대 생성되면 안 되는 응답" }));
    const token = createAmoraEvalToken(process.env.AMORA_EVAL_SECRET, REQUEST_ID);

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": token }, "https://hanbang.ai/api/chat"));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"code":"COST_GUARD_UNAVAILABLE"');
    expect(body).not.toContain("절대 생성되면 안 되는 응답");
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects an invalid release evaluation token instead of falling back to public demo", async () => {
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": "v1.1784067600000.invalid" }));

    expect(response.status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
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
