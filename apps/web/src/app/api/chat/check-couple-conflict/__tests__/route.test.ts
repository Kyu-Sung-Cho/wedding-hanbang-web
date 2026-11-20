import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auditedResponse: vi.fn(),
  claimChat: vi.fn(),
  claimConflictCheck: vi.fn(),
  checkpointConflictCheck: vi.fn(),
  completeClaim: vi.fn(),
  completeConflictCheck: vi.fn(),
  failClaim: vi.fn(),
  failConflictCheck: vi.fn(),
  from: vi.fn(),
  pastConflictRows: [] as Array<Record<string, unknown>>,
  persistentLimit: vi.fn(),
  providerLedger: vi.fn(),
  atomicOutcome: "persisted" as
    | "persisted"
    | "cooldown_race_lost"
    | "privacy_context_changed",
  atomicResponses: [] as Array<Record<string, unknown>>,
  providerGeneration: vi.fn(),
  rawMessages: [] as Array<Record<string, unknown>>,
  reserveTurn: vi.fn(),
  rpc: vi.fn(),
  userRpc: vi.fn(),
  structuredResponse: vi.fn(),
  tableCallCounts: new Map<string, number>(),
  CostGuardError: class AmoraCostGuardError extends Error {},
}));

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-07-16T04:00:00.000Z";

const automaticMemoryKeyDecision = {
  category: "venue",
  decision_type: "decided",
  title: "AUTO_MEMORY_KEY_SECRET",
  chosen_value: { value: "AUTO_MEMORY_KEY_VALUE" },
  reasoning: "automatically extracted",
  confidence: 0.9,
  source: "chat",
  visibility: "shared",
  created_at: NOW,
  memory_key: "venue:secret_area",
  superseded_at: null,
  metadata: null,
};

const automaticMetadataDecision = {
  category: "style",
  decision_type: "decided",
  title: "AUTO_EXTRACTED_SECRET",
  chosen_value: { value: "AUTO_EXTRACTED_VALUE" },
  reasoning: "automatically extracted",
  confidence: 0.9,
  source: "chat",
  visibility: "shared",
  created_at: NOW,
  memory_key: null,
  superseded_at: null,
  metadata: { extracted_by: "openai_luna" },
};

const explicitDecision = {
  category: "budget",
  decision_type: "decided",
  title: "EXPLICIT_SHARED_DECISION",
  chosen_value: { value: "EXPLICIT_SHARED_VALUE" },
  reasoning: "confirmed by the couple",
  confidence: 1,
  source: "manual",
  visibility: "shared",
  created_at: NOW,
  memory_key: null,
  superseded_at: null,
  metadata: null,
};

const automaticConflict = {
  category: "conflict_resolution",
  decision_type: "decided",
  title: "AUTO_CONFLICT_SECRET",
  chosen_value: { value: "AUTO_CONFLICT_VALUE" },
  reasoning: "automatically extracted conflict",
  confidence: 0.8,
  source: "chat",
  visibility: "shared",
  created_at: NOW,
  memory_key: "conflict:secret_resolution",
  superseded_at: null,
  metadata: { extracted_by: "openai_luna" },
  stage_tag: "planning_0",
};

const explicitConflict = {
  category: "conflict_resolution",
  decision_type: "decided",
  title: "EXPLICIT_CONFLICT_DECISION",
  chosen_value: { value: "EXPLICIT_CONFLICT_VALUE" },
  reasoning: "both people accepted it",
  confidence: 1,
  source: "manual",
  visibility: "shared",
  created_at: NOW,
  memory_key: null,
  superseded_at: null,
  metadata: null,
  stage_tag: "planning_0",
};

function queryResult(
  data: unknown,
  error: unknown = null,
  options: { filterVisibilityEq?: boolean } = {},
) {
  let visibility: unknown;
  const result = () => ({
    data:
      options.filterVisibilityEq && Array.isArray(data) && visibility !== undefined
        ? data.filter((row) =>
            typeof row === "object"
            && row !== null
            && (row as Record<string, unknown>).visibility === visibility)
        : data,
    error,
  });
  const query: Record<string, unknown> = {};
  for (const method of [
    "select",
    "gte",
    "in",
    "is",
    "or",
    "order",
    "limit",
    "insert",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.eq = vi.fn((column: string, value: unknown) => {
    if (column === "visibility") visibility = value;
    return query;
  });
  query.single = vi.fn(async () => result());
  query.then = (
    resolve: (value: ReturnType<typeof result>) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result()).then(resolve, reject);
  return query;
}

function nextTableResult(table: string) {
  const call = mocks.tableCallCounts.get(table) ?? 0;
  mocks.tableCallCounts.set(table, call + 1);

  if (table === "profiles") {
    return call === 0
      ? queryResult({
          couple_id: COUPLE_ID,
          role: "bride",
          name: "테스트 신부",
          is_admin: false,
        })
      : queryResult([
          { id: USER_ID, role: "bride", name: "테스트 신부" },
          {
            id: "00000000-0000-4000-8000-000000000002",
            role: "groom",
            name: "테스트 신랑",
          },
        ]);
  }

  if (table === "chat_messages") {
    if (call === 0) return queryResult([]);
    if (call === 1) return queryResult(mocks.rawMessages);
    if (call === 2) return queryResult([]);
    return queryResult({ id: "40000000-0000-4000-8000-000000000001" });
  }

  if (table === "decision_nodes") {
    if (call === 0) {
      return queryResult(mocks.pastConflictRows, null, { filterVisibilityEq: true });
    }
    if (call === 1) {
      return queryResult([
        automaticMemoryKeyDecision,
        automaticMetadataDecision,
        explicitDecision,
        automaticConflict,
        explicitConflict,
      ]);
    }
    return queryResult([automaticConflict, explicitConflict]);
  }

  if (table === "chat_summaries") {
    return queryResult([
      { summary: "SHARED_SUMMARY_SECRET", summary_type: null },
      { summary: "CURSOR_TYPE_SECRET", summary_type: "cursor" },
      { summary: "[AMORA_MEMORY_CURSOR_ONLY]", summary_type: null },
    ]);
  }

  if (table === "wedding_journeys") {
    return queryResult({
      wedding_date: null,
      venue: null,
      total_budget: 0,
      progress: {},
    });
  }

  return queryResult([]);
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: mocks.from,
    rpc: mocks.rpc,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    rpc: mocks.userRpc,
  })),
}));

vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: vi.fn(() => "conflict-check:test"),
  checkRateLimitPersistent: mocks.persistentLimit,
}));

vi.mock("@/lib/ai/costGuard", () => ({
  AmoraCostGuardError: mocks.CostGuardError,
  checkAmoraCostGuard: vi.fn(async () => ({ allowed: true })),
  reserveAmoraTurn: mocks.reserveTurn,
}));

vi.mock("@/lib/ai/amoraProviderCallLedger", () => ({
  runAmoraProviderCallWithLedger: mocks.providerLedger,
}));

vi.mock("@/lib/ai/chatRequestClaim", () => ({
  claimChatRequest: mocks.claimChat,
  completeChatRequest: mocks.completeClaim,
  failChatRequest: mocks.failClaim,
}));

vi.mock("@/lib/ai/amoraConflictCheckClaim", () => ({
  createAmoraConflictMessageDigest: vi.fn(() => "a".repeat(64)),
  claimAmoraConflictCheck: mocks.claimConflictCheck,
  checkpointAmoraConflictCheck: mocks.checkpointConflictCheck,
  completeAmoraConflictCheck: mocks.completeConflictCheck,
  failAmoraConflictCheck: mocks.failConflictCheck,
}));

vi.mock("@/lib/ai/auditedOpenAI", () => ({
  createOpenAIResponseWithAudit: mocks.auditedResponse,
  createOpenAIStructuredResponseWithAudit: mocks.structuredResponse,
}));

vi.mock("@/lib/ai/modelConfig", () => ({
  hasOpenAIConfig: vi.fn(() => true),
}));

import { POST } from "@/app/api/chat/check-couple-conflict/route";
import { buildAmoraGatekeeperReplyMetadata } from "@/lib/ai/amoraGatekeeperContract";

function request() {
  return new NextRequest("http://localhost/api/chat/check-couple-conflict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ coupleId: COUPLE_ID }),
  });
}

function requestWithRawBody(body: string) {
  return new NextRequest("http://localhost/api/chat/check-couple-conflict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
    },
    body,
  });
}

describe("POST /api/chat/check-couple-conflict memory consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AMORA_TEST_USER_IDS", "");
    vi.stubEnv("AMORA_AUTOMATIC_CONFLICT_MEDIATION_ENABLED", "true");
    mocks.tableCallCounts.clear();
    mocks.from.mockImplementation(nextTableResult);
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000002",
        content: "나도 화가 나. 난 절대 반대고 결혼 취소하고 싶어.",
        sender_type: "groom",
        sender_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        content: "대화가 안 돼. 너는 맨날 내 말을 안 들어줘. 진짜 답답해.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );
    mocks.pastConflictRows.splice(0, mocks.pastConflictRows.length);
    mocks.atomicOutcome = "persisted";
    mocks.atomicResponses.splice(0);
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "CONSENT_LOOKUP_FAILED" },
    });
    mocks.userRpc.mockResolvedValue({ data: 7, error: null });
    mocks.auditedResponse.mockImplementation(async (options) => {
      await options.beforeGeneration?.();
      mocks.providerGeneration("primary");
      return { text: "중재 답변" };
    });
    mocks.persistentLimit.mockResolvedValue(null);
    mocks.providerLedger.mockImplementation(async (_context, call, options) => {
      const result = await call(async () => undefined);
      const atomic = options?.buildAtomicChatResponse?.(result) ?? null;
      if (atomic) {
        mocks.atomicResponses.push(atomic);
        options?.onAtomicChatResponseFinalized?.(
          mocks.atomicOutcome === "cooldown_race_lost"
            ? { outcome: "cooldown_race_lost", message: null }
            : mocks.atomicOutcome === "privacy_context_changed"
              ? { outcome: "privacy_context_changed", message: null }
              : {
                outcome: "persisted",
                message: {
                  id: "40000000-0000-4000-8000-000000000001",
                  createdAt: NOW,
                  content: atomic.content,
                  metadata: atomic.metadata,
                  stageTag: atomic.stageTag,
                  specialistType: atomic.specialistType,
                  visibility: atomic.visibility,
                  reused: false,
                },
              },
        );
      }
      return result;
    });
    mocks.reserveTurn.mockResolvedValue({ allowed: true });
    mocks.structuredResponse.mockImplementation(async (options) => {
      await options.beforeGeneration?.();
      mocks.providerGeneration("fast");
      return { data: { conflict: false, reason: "현재 갈등 아님" } };
    });
    mocks.completeClaim.mockResolvedValue(undefined);
    mocks.claimChat.mockResolvedValue({
      action: "acquired",
      attemptCount: 1,
      reclaimed: false,
    });
    mocks.claimConflictCheck.mockResolvedValue({
      action: "acquired",
      attemptCount: 1,
      claimToken: "20000000-0000-4000-8000-000000000001",
      reclaimed: false,
    });
    mocks.completeConflictCheck.mockResolvedValue(undefined);
    mocks.checkpointConflictCheck.mockResolvedValue(undefined);
    mocks.failClaim.mockResolvedValue(undefined);
    mocks.failConflictCheck.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a chunked-size body that exceeds the real byte limit", async () => {
    const response = await POST(requestWithRawBody(JSON.stringify({
      coupleId: COUPLE_ID,
      padding: "x".repeat(5_000),
    })));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "request_too_large",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON instead of continuing with an empty body", async () => {
    const response = await POST(requestWithRawBody("{not-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "invalid_request_body",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps hidden automatic mediation disabled without reading chat data", async () => {
    vi.stubEnv("AMORA_AUTOMATIC_CONFLICT_MEDIATION_ENABLED", "false");

    const response = await POST(request());

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "explicit_mediation_required",
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
  });

  it("cannot enable hidden automatic mediation in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AMORA_TEST_USER_IDS", USER_ID);
    vi.stubEnv("AMORA_AUTOMATIC_CONFLICT_MEDIATION_ENABLED", "true");

    const response = await POST(request());

    expect(response.status).toBe(410);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("ignores a forged team quota exemption and allowlisted user ID in the request body", async () => {
    vi.stubEnv("AMORA_TEST_USER_IDS", "00000000-0000-4000-8000-000000000002");
    mocks.persistentLimit.mockResolvedValue(new Response("limited", { status: 429 }));

    const response = await POST(requestWithRawBody(JSON.stringify({
      coupleId: COUPLE_ID,
      userId: "00000000-0000-4000-8000-000000000002",
      isQuotaExempt: true,
    })));

    expect(response.status).toBe(429);
    expect(mocks.persistentLimit).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.providerGeneration).not.toHaveBeenCalled();
  });

  it("preserves partner privacy consent after bypassing an allowlisted team's rate limit", async () => {
    vi.stubEnv("AMORA_TEST_USER_IDS", USER_ID);
    mocks.persistentLimit.mockResolvedValue(new Response("limited", { status: 429 }));
    mocks.rawMessages[0] = {
      ...mocks.rawMessages[0],
      metadata: { target: "partner" },
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "privacy_consent_required",
    });
    expect(mocks.persistentLimit).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.providerGeneration).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", { data: false, error: null }],
    ["unavailable", { data: null, error: { code: "CONSENT_LOOKUP_FAILED" } }],
  ])("omits automatic shared memory at the provider boundary when consent is %s", async (
    _consentState,
    rpcResult,
  ) => {
    mocks.rpc.mockResolvedValue(rpcResult);
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ triggered: true });
    expect(mocks.rpc).toHaveBeenCalledWith("has_current_amora_memory_consent", {
      p_couple_id: COUPLE_ID,
      p_visibility: "shared",
    });
    expect(mocks.from).not.toHaveBeenCalledWith("chat_summaries");

    const instructions = mocks.auditedResponse.mock.calls[0]?.[0]?.instructions as string;
    expect(instructions).not.toContain("SHARED_SUMMARY_SECRET");
    expect(instructions).not.toContain("AUTO_MEMORY_KEY_SECRET");
    expect(instructions).not.toContain("AUTO_EXTRACTED_SECRET");
    expect(instructions).not.toContain("AUTO_CONFLICT_SECRET");
    expect(instructions).not.toContain("create_booking");
    expect(instructions).not.toContain("update_budget");
    expect(instructions).not.toContain("add_schedule_event");
    // Automatic mediation uses the current bounded shared-message window only.
    // Historical decisions can otherwise bias a new disagreement toward one
    // partner even when they were explicitly stored at the time.
    expect(instructions).not.toContain("EXPLICIT_SHARED_DECISION");
    expect(instructions).not.toContain("EXPLICIT_CONFLICT_DECISION");
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        callIndex: 1,
        phase: "conflict_mediation",
      }),
    );
    expect(mocks.providerLedger.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        buildAtomicChatResponse: expect.any(Function),
        onAtomicChatResponseFinalized: expect.any(Function),
      }),
    );
    expect(mocks.completeClaim).not.toHaveBeenCalled();
  });

  it("excludes all historical summaries from automatic mediation input", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ triggered: true });
    const instructions = mocks.auditedResponse.mock.calls[0]?.[0]?.instructions as string;
    expect(instructions).not.toContain("SHARED_SUMMARY_SECRET");
    expect(instructions).not.toContain("CURSOR_TYPE_SECRET");
    expect(instructions).not.toContain("[AMORA_MEMORY_CURSOR_ONLY]");
  });

  it("returns a harmless race result when the atomic Terra commit observes a newer mediation", async () => {
    mocks.atomicOutcome = "cooldown_race_lost";

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      reason: "race_lost",
    });
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.completeClaim).not.toHaveBeenCalled();
    expect(mocks.failClaim).not.toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "COOLDOWN_RACE_LOST" }),
      expect.anything(),
    );
  });

  it("discards automatic mediation when the atomic privacy epoch changed", async () => {
    mocks.atomicOutcome = "privacy_context_changed";

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "privacy_context_changed",
    });
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({ expectedPrivacyEpoch: 7 }),
    ]);
    expect(mocks.failClaim).not.toHaveBeenCalled();
  });

  it("fails the mediation claim when the roster epoch changes after generation", async () => {
    mocks.userRpc
      .mockResolvedValueOnce({ data: 7, error: null })
      .mockResolvedValueOnce({ data: 7, error: null })
      .mockResolvedValueOnce({ data: 8, error: null });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "privacy_context_changed",
    });
    expect(mocks.providerGeneration).toHaveBeenCalledWith("primary");
    expect(mocks.atomicResponses).toEqual([]);
    expect(mocks.failClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "AMORA_PRIVACY_CONTEXT_CHANGED",
      }),
      expect.anything(),
    );
  });

  it("does not ask the provider to upgrade one-sided conflict language", async () => {
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000012",
        content: "응 그래",
        sender_type: "groom",
        sender_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000011",
        content: "대화가 안 돼",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );
    mocks.pastConflictRows.splice(
      0,
      mocks.pastConflictRows.length,
      {
        title: "BRIDE_PRIVATE_CONFLICT_SECRET",
        created_at: new Date(now - 60_000).toISOString(),
        visibility: "bride_private",
        memory_key: null,
        superseded_at: null,
        metadata: null,
      },
      {
        title: "GROOM_PRIVATE_CONFLICT_SECRET",
        created_at: new Date(now - 120_000).toISOString(),
        visibility: "groom_private",
        memory_key: null,
        superseded_at: null,
        metadata: null,
      },
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ triggered: false });
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("requires conflict evidence from both roles before any provider call", async () => {
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000062",
        content: "진짜 화가 나. 결혼 취소하고 싶어.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000061",
        content: "너는 맨날 내 말을 안 들어. 대화가 안 돼.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      reason: expect.stringContaining("양측 발화 부족"),
    });
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("excludes current third-party complaints before any provider call", async () => {
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000072",
        content: "엄마가 그 업체는 절대 안 된다고 반대래.",
        sender_type: "groom",
        sender_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000071",
        content: "친구가 남자친구가 말을 안 들어서 너무 화가 났대.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      score: 0,
    });
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("never copies direct partner messages to either provider without consent", async () => {
    mocks.rawMessages[0] = {
      ...mocks.rawMessages[0],
      metadata: { target: "partner" },
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "privacy_consent_required",
    });
    expect(mocks.claimConflictCheck).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it.each([false, true])("settles separate durable receipts for borderline Luna and Terra with team quota exemption %s", async (isQuotaExempt) => {
    if (isQuotaExempt) {
      vi.stubEnv("AMORA_TEST_USER_IDS", USER_ID);
      mocks.persistentLimit.mockResolvedValue(new Response("limited", { status: 429 }));
    }
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000022",
        content: "난 절대 반대야.",
        sender_type: "groom",
        sender_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000021",
        content: "나는 너무 서운해.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );
    mocks.structuredResponse.mockImplementation(async (options) => {
      await options.beforeGeneration?.();
      mocks.providerGeneration("fast");
      return { data: { conflict: true, reason: "서로 다른 의견으로 감정이 상한 상태" } };
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: true,
      llmVerified: true,
    });
    expect(mocks.reserveTurn).not.toHaveBeenCalled();
    expect(mocks.persistentLimit).toHaveBeenCalledTimes(isQuotaExempt ? 0 : 1);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(2);
    expect(mocks.providerLedger.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      coupleId: COUPLE_ID,
      requestKey: `conflict:${"a".repeat(64)}`,
      source: "conflict_check",
      modelRole: "fast",
      callIndex: 1,
      phase: "conflict_verify",
      costGuard: {
        coupleId: COUPLE_ID,
        isAdmin: false,
        isQuotaExempt,
        quotaScope: "background",
        maxCostMicrousd: 17_680,
      },
    }));
    expect(mocks.providerLedger.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      coupleId: COUPLE_ID,
      requestKey: `conflict:${"a".repeat(64)}`,
      source: "conflict_check",
      modelRole: "primary",
      callIndex: 2,
      phase: "conflict_mediation",
      costGuard: {
        coupleId: COUPLE_ID,
        isAdmin: false,
        isQuotaExempt,
        quotaScope: "background",
        maxCostMicrousd: 176_800,
      },
    }));
    expect(mocks.structuredResponse).toHaveBeenCalledTimes(1);
    expect(mocks.auditedResponse).toHaveBeenCalledTimes(1);
    expect(mocks.structuredResponse.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.auditedResponse.mock.invocationCallOrder[0],
    );
    expect(mocks.structuredResponse.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      maxInputTokens: 64_000,
      beforeGeneration: expect.any(Function),
      auditPersistence: "external_provider_receipt",
    }));
    expect(mocks.auditedResponse.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      maxInputTokens: 64_000,
      beforeGeneration: expect.any(Function),
      auditPersistence: "external_provider_receipt",
    }));
    expect(mocks.providerGeneration.mock.calls.map(([role]) => role)).toEqual(["fast", "primary"]);
  });

  it("resumes Terra from the atomic Luna checkpoint after a transient mediation failure", async () => {
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000052",
        content: "난 절대 반대야.",
        sender_type: "groom",
        sender_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000051",
        content: "나는 너무 서운해.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );
    mocks.structuredResponse.mockImplementation(async (options) => {
      await options.beforeGeneration?.();
      return { data: { conflict: true, reason: "서로 다른 의견으로 감정이 상한 상태" } };
    });

    let persistedCheckpoint: Record<string, unknown> | undefined;
    mocks.providerLedger.mockImplementation(async (context, call, options) => {
      const result = await call(async () => undefined);
      if (context.phase === "conflict_verify") {
        persistedCheckpoint = result.providerCheckpoint as Record<string, unknown> | undefined;
      }
      const atomic = options?.buildAtomicChatResponse?.(result) ?? null;
      if (atomic) {
        options?.onAtomicChatResponseFinalized?.({
          outcome: "persisted",
          message: {
            id: "40000000-0000-4000-8000-000000000001",
            createdAt: NOW,
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
    mocks.auditedResponse
      .mockImplementationOnce(async (options) => {
        await options.beforeGeneration?.();
        throw new Error("transient mediation failure");
      })
      .mockImplementationOnce(async (options) => {
        await options.beforeGeneration?.();
        return { text: "중재 답변" };
      });

    const firstResponse = await POST(request());
    expect(firstResponse.status).toBe(500);
    expect(persistedCheckpoint).toEqual(expect.objectContaining({
      stage: "detection_complete",
      triggered: true,
      llmVerified: true,
    }));
    expect(mocks.providerLedger.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      phase: "conflict_verify",
      conflictCheckpointClaim: {
        coupleId: COUPLE_ID,
        messageDigest: "a".repeat(64),
        claimToken: "20000000-0000-4000-8000-000000000001",
      },
    }));

    mocks.tableCallCounts.clear();
    mocks.claimConflictCheck.mockResolvedValueOnce({
      action: "acquired",
      attemptCount: 2,
      claimToken: "20000000-0000-4000-8000-000000000002",
      checkpoint: persistedCheckpoint,
      reclaimed: true,
    });

    const retryResponse = await POST(request());
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      triggered: true,
      llmVerified: true,
    });
    expect(mocks.structuredResponse).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(3);
    expect(mocks.providerLedger.mock.calls[2]?.[0]).toEqual(expect.objectContaining({
      modelRole: "primary",
      callIndex: 2,
      phase: "conflict_mediation",
    }));
    expect(mocks.checkpointConflictCheck).not.toHaveBeenCalled();
  });

  it("fails closed with zero provider calls when the first lazy reservation is denied", async () => {
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000032",
        content: "난 절대 반대야.",
        sender_type: "groom",
        sender_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000031",
        content: "나는 너무 서운해.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );
    mocks.providerLedger.mockImplementationOnce(async (_context, call) =>
      call(async () => {
        throw new mocks.CostGuardError("cost guard rejected");
      }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      reason: "cost_guard",
    });
    expect(mocks.reserveTurn).not.toHaveBeenCalled();
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.structuredResponse).toHaveBeenCalledTimes(1);
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
    expect(mocks.providerGeneration).not.toHaveBeenCalled();
  });

  it("keeps a transient verification failure retryable instead of persisting false", async () => {
    const now = Date.now();
    mocks.rawMessages.splice(
      0,
      mocks.rawMessages.length,
      {
        id: "30000000-0000-4000-8000-000000000042",
        content: "난 절대 반대야.",
        sender_type: "groom",
        sender_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date(now - 10_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000041",
        content: "나는 너무 서운해.",
        sender_type: "bride",
        sender_id: USER_ID,
        created_at: new Date(now - 20_000).toISOString(),
        visibility: "shared",
        metadata: null,
      },
    );
    mocks.structuredResponse.mockImplementation(async (options) => {
      await options.beforeGeneration?.();
      throw new Error("provider unavailable");
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "provider_unavailable",
    });
    expect(mocks.completeConflictCheck).not.toHaveBeenCalled();
    expect(mocks.failConflictCheck).toHaveBeenCalledWith({
      coupleId: COUPLE_ID,
      messageDigest: "a".repeat(64),
      claimToken: "20000000-0000-4000-8000-000000000001",
      failureCode: "CONFLICT_VERIFICATION_PROVIDER_FAILED",
    }, expect.anything());
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("delegates crisis disclosures before rate limiting or either provider", async () => {
    mocks.rawMessages[0] = {
      ...mocks.rawMessages[0],
      content: "지금 죽고 싶어",
    };
    mocks.persistentLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limit_unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "crisis_safety_delegated",
    });
    expect(mocks.persistentLimit).not.toHaveBeenCalled();
    expect(mocks.reserveTurn).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("문지기(D-89)가 막은 턴이 창에 있으면 요청 제한·어느 모델보다 먼저 건너뛴다", async () => {
    mocks.rawMessages.splice(1, 0, {
      id: "30000000-0000-4000-8000-000000000009",
      content: "결혼 준비 이야기만 도와드릴 수 있어요.",
      sender_type: "ai",
      sender_id: null,
      created_at: new Date(Date.now() - 15_000).toISOString(),
      visibility: "shared",
      metadata: buildAmoraGatekeeperReplyMetadata({
        verdict: "out_of_scope",
        userMessageId: "30000000-0000-4000-8000-000000000001",
      }),
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "gatekeeper_turn_delegated",
    });
    expect(mocks.persistentLimit).not.toHaveBeenCalled();
    expect(mocks.reserveTurn).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("문지기 표식이 없는 아모라 답은 창을 막지 않는다(기준선)", async () => {
    mocks.rawMessages.splice(1, 0, {
      id: "30000000-0000-4000-8000-000000000009",
      content: "결혼 준비 이야기만 도와드릴 수 있어요.",
      sender_type: "ai",
      sender_id: null,
      created_at: new Date(Date.now() - 15_000).toISOString(),
      visibility: "shared",
      metadata: { in_reply_to_user_message_id: "30000000-0000-4000-8000-000000000001", question_scope: "W4_out_of_scope" },
    });

    const response = await POST(request());
    const body = await response.json() as { reason?: string };

    expect(body.reason).not.toBe("gatekeeper_turn_delegated");
    expect(mocks.persistentLimit).toHaveBeenCalled();
  });

  it("returns a persistent limiter outage after the deterministic crisis boundary", async () => {
    mocks.persistentLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limit_unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.persistentLimit).toHaveBeenCalledWith(
      "conflict-check:test",
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.from).toHaveBeenCalled();
    expect(mocks.reserveTurn).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("replays a completed shared-message check before memory or either provider is touched", async () => {
    const durableResult = {
      triggered: false,
      score: 2,
      reason: "low_score",
      llmVerified: false,
    };
    mocks.claimConflictCheck.mockResolvedValue({
      action: "completed",
      attemptCount: 1,
      result: durableResult,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(durableResult);
    expect(mocks.claimConflictCheck).toHaveBeenCalledWith({
      coupleId: COUPLE_ID,
      messageDigest: "a".repeat(64),
      requesterUserId: USER_ID,
    }, expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reserveTurn).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
    expect(mocks.completeConflictCheck).not.toHaveBeenCalled();
  });

  it("completes a recovered non-conflict checkpoint without paying for Luna again", async () => {
    const checkpoint = {
      stage: "detection_complete",
      triggered: false,
      score: 7,
      reason: "borderline 점수 7 → LLM: 현재 갈등 아님",
      conflictContext: "서운해 / 반대야",
      llmVerified: true,
    };
    mocks.claimConflictCheck.mockResolvedValue({
      action: "acquired",
      attemptCount: 2,
      claimToken: "20000000-0000-4000-8000-000000000002",
      checkpoint,
      reclaimed: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      score: 7,
      reason: checkpoint.reason,
      llmVerified: true,
    });
    expect(mocks.completeConflictCheck).toHaveBeenCalledWith({
      coupleId: COUPLE_ID,
      messageDigest: "a".repeat(64),
      claimToken: "20000000-0000-4000-8000-000000000002",
      result: {
        triggered: false,
        score: 7,
        reason: checkpoint.reason,
        llmVerified: true,
      },
    }, expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });

  it("returns a retryable response while the other partner owns the same check", async () => {
    mocks.claimConflictCheck.mockResolvedValue({
      action: "in_progress",
      attemptCount: 1,
      retryAfterMs: 2_000,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("2");
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: "in_progress",
      retryAfterMs: 2_000,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reserveTurn).not.toHaveBeenCalled();
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(mocks.auditedResponse).not.toHaveBeenCalled();
  });
});
