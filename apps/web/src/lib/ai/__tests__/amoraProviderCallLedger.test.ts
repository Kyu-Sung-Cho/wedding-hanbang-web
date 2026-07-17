import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calcCostUsd: vi.fn((
    _model: string | null | undefined,
    tokensIn: number | null | undefined,
    tokensOut: number | null | undefined,
  ) => tokensIn == null || tokensOut == null ? null : 0.00123),
  createAdminClient: vi.fn(),
  operationalError: vi.fn(),
}));

vi.mock("@/lib/compliance/ai-log", () => ({
  calcCostUsd: mocks.calcCostUsd,
  startLatencyClock: vi.fn(() => 1_000),
  elapsedMs: vi.fn(() => 25),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/log", () => ({
  log: {
    error: mocks.operationalError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { runAmoraProviderCallWithLedger } from "@/lib/ai/amoraProviderCallLedger";
import { buildAmoraToolRoundCheckpoint } from "@/lib/ai/amoraTurnJournal";
import { OpenAIProviderError } from "@/lib/ai/openai";

const RECEIPT_ID = "30000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "40000000-0000-4000-8000-000000000001";

const context = {
  userId: "10000000-0000-4000-8000-000000000001",
  coupleId: "20000000-0000-4000-8000-000000000001",
  sessionId: "session_123",
  requestKey: "request_123",
  source: "durable" as const,
  modelRole: "fast" as const,
  specialistType: "general" as const,
  callIndex: 1,
  phase: "tool_round" as const,
  stageTag: "exploring",
  costGuard: {
    coupleId: "20000000-0000-4000-8000-000000000001",
    isAdmin: false,
    quotaScope: "standard" as const,
    maxCostMicrousd: 84_800,
  },
};

type RpcResult = { data: unknown; error: { message: string } | null };

function makeAdmin(options: {
  prepare?: RpcResult;
  reserve?: RpcResult;
  finalize?: RpcResult[];
  toolRoundFinalize?: RpcResult[];
  conflictFinalize?: RpcResult[];
  chatResponseFinalize?: RpcResult[];
  events?: string[];
} = {}) {
  const events = options.events ?? [];
  let finalizeIndex = 0;
  const rpc = vi.fn(async (
    name: string,
    params?: unknown,
  ): Promise<RpcResult> => {
    void params;
    events.push(name);
    if (name === "prepare_amora_provider_call_receipt") {
      return options.prepare ?? {
        data: [{
          receipt_id: RECEIPT_ID,
          claim_token: CLAIM_TOKEN,
          claimed: true,
          receipt_status: "prepared",
        }],
        error: null,
      };
    }
    if (name === "reserve_amora_provider_call") {
      return options.reserve ?? {
        data: [{ allowed: true, reason: null, remaining: 99 }],
        error: null,
      };
    }
    if (name === "finalize_amora_provider_call_receipt") {
      const results = options.finalize ?? [{
        data: [{ finalized: true, receipt_status: "settled" }],
        error: null,
      }];
      const result = results[Math.min(finalizeIndex, results.length - 1)]!;
      finalizeIndex += 1;
      return result;
    }
    if (name === "finalize_amora_tool_round_receipt") {
      const results = options.toolRoundFinalize ?? [{
        data: [{
          finalized: true,
          receipt_status: "settled",
          checkpointed: true,
        }],
        error: null,
      }];
      const result = results[Math.min(finalizeIndex, results.length - 1)]!;
      finalizeIndex += 1;
      return result;
    }
    if (name === "finalize_amora_conflict_verify_receipt") {
      const results = options.conflictFinalize ?? [{
        data: [{
          finalized: true,
          receipt_status: "settled",
          checkpointed: true,
        }],
        error: null,
      }];
      const result = results[Math.min(finalizeIndex, results.length - 1)]!;
      finalizeIndex += 1;
      return result;
    }
    if (name === "finalize_amora_chat_response") {
      const results = options.chatResponseFinalize ?? [{
        data: [{
          finalized: true,
          receipt_status: "settled",
          outcome: "persisted",
          message_id: "60000000-0000-4000-8000-000000000001",
          message_created_at: "2026-07-17T00:00:00.000Z",
          message_content: "terminal answer",
          message_metadata: { suggestions: ["next"] },
          message_stage_tag: "exploring",
          message_specialist_type: "general",
          message_visibility: "shared",
          message_reused: false,
        }],
        error: null,
      }];
      const result = results[Math.min(finalizeIndex, results.length - 1)]!;
      finalizeIndex += 1;
      return result;
    }
    return { data: null, error: { message: `unexpected rpc: ${name}` } };
  });
  const admin = { rpc };
  mocks.createAdminClient.mockReturnValue(admin);
  return { admin, rpc, events };
}

function successResult() {
  return {
    model: "gpt-5.6-luna-2026-07-01",
    usage: {
      input_tokens: 1_200,
      output_tokens: 240,
      cache_write_input_tokens: 100,
      cache_read_input_tokens: 300,
    },
    usageStatus: "complete" as const,
    requestId: "req_123",
    responseId: "resp_123",
    inputCountRequestId: "count_123",
  };
}

describe("runAmoraProviderCallWithLedger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeAdmin();
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  it.each([
    ["database error", { data: null, error: { message: "database unavailable" } }],
    ["missing row", { data: null, error: null }],
    ["malformed id", {
      data: [{
        receipt_id: "not-a-uuid",
        claim_token: CLAIM_TOKEN,
        claimed: true,
        receipt_status: "prepared",
      }],
      error: null,
    }],
  ])("fails closed before provider work when receipt preparation has %s", async (_case, prepare) => {
    makeAdmin({ prepare });
    const provider = vi.fn(async () => successResult());

    await expect(
      runAmoraProviderCallWithLedger(context, provider),
    ).rejects.toThrow("prepared receipt");

    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects unsafe correlation data before any database or provider work", async () => {
    const { rpc } = makeAdmin();
    const provider = vi.fn(async () => successResult());

    await expect(
      runAmoraProviderCallWithLedger({ ...context, requestKey: "person@example.com" }, provider),
    ).rejects.toThrow("opaque correlation token");

    expect(rpc).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("blocks a retry when the request/call/phase receipt is already settled", async () => {
    const { rpc } = makeAdmin({
      prepare: {
        data: [{
          receipt_id: RECEIPT_ID,
          claim_token: CLAIM_TOKEN,
          claimed: false,
          receipt_status: "settled",
        }],
        error: null,
      },
    });
    const provider = vi.fn(async () => successResult());

    await expect(
      runAmoraProviderCallWithLedger(context, provider),
    ).rejects.toThrow(/receipt/i);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it("reserves once and settles the maximum reservation to actual usage", async () => {
    const events: string[] = [];
    const { rpc } = makeAdmin({ events });
    const result = successResult();

    await expect(
      runAmoraProviderCallWithLedger(context, async (beforeGeneration) => {
        events.push("callback");
        await beforeGeneration();
        await beforeGeneration();
        events.push("provider");
        return result;
      }),
    ).resolves.toBe(result);

    expect(events).toEqual([
      "prepare_amora_provider_call_receipt",
      "callback",
      "reserve_amora_provider_call",
      "provider",
      "finalize_amora_provider_call_receipt",
    ]);
    expect(rpc.mock.calls.filter(([name]) => name === "reserve_amora_provider_call"))
      .toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      "reserve_amora_provider_call",
      expect.objectContaining({
        p_receipt_id: RECEIPT_ID,
        p_claim_token: CLAIM_TOKEN,
        p_request_key: context.requestKey,
        p_reserve_cost_microusd: 84_800,
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_provider_call_receipt",
      expect.objectContaining({
        p_provider_attempted: true,
        p_usage_status: "complete",
        p_actual_cost_microusd: 1_230,
        p_tokens_input: 1_200,
        p_tokens_output: 240,
      }),
    );
  });

  it("atomically checkpoints a non-terminal tool round with its paid receipt", async () => {
    const { rpc } = makeAdmin();
    const checkpoint = buildAmoraToolRoundCheckpoint(1, {
      fullText: "",
      toolCalls: [{
        callId: "call_1",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
      }],
      outputItems: [{
        type: "function_call",
        call_id: "call_1",
        name: "update_budget",
        arguments: JSON.stringify({ total_budget: 30_000_000 }),
      }],
    });

    await runAmoraProviderCallWithLedger(
      context,
      async (beforeGeneration) => {
        await beforeGeneration();
        return successResult();
      },
      {
        buildAtomicChatResponse: () => null,
        buildToolRoundCheckpoint: () => ({
          coupleId: context.coupleId,
          requestKey: context.requestKey,
          claimAttemptCount: 1,
          checkpoint,
        }),
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_tool_round_receipt",
      expect.objectContaining({
        p_receipt_id: RECEIPT_ID,
        p_receipt_claim_token: CLAIM_TOKEN,
        p_chat_couple_id: context.coupleId,
        p_chat_request_key: context.requestKey,
        p_chat_claim_attempt_count: 1,
        p_checkpoint: checkpoint,
        p_actual_cost_microusd: 1_230,
      }),
    );
    expect(rpc.mock.calls.some(([name]) =>
      name === "finalize_amora_provider_call_receipt")).toBe(false);
  });

  it("atomically commits a terminal chat message and its request claim with the successful receipt", async () => {
    const { rpc } = makeAdmin();
    const result = successResult();
    const finalized = vi.fn();
    const chatRequestKey =
      "chat:10000000-0000-4000-8000-000000000001:70000000-0000-4000-8000-000000000001";

    await expect(runAmoraProviderCallWithLedger(
      { ...context, requestKey: chatRequestKey },
      async (beforeGeneration) => {
        await beforeGeneration();
        return result;
      },
      {
        buildAtomicChatResponse: () => ({
          coupleId: context.coupleId,
          userId: context.userId,
          requestKey: chatRequestKey,
          visibility: "shared",
          claimAttemptCount: 1,
          content: "terminal answer",
          metadata: { suggestions: ["next"] },
          stageTag: "exploring",
          specialistType: "general",
        }),
        onAtomicChatResponseFinalized: finalized,
      },
    )).resolves.toBe(result);

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_chat_response",
      expect.objectContaining({
        p_receipt_id: RECEIPT_ID,
        p_receipt_claim_token: CLAIM_TOKEN,
        p_chat_couple_id: context.coupleId,
        p_chat_user_id: context.userId,
        p_chat_request_key: chatRequestKey,
        p_chat_visibility: "shared",
        p_chat_claim_attempt_count: 1,
        p_message_content: "terminal answer",
        p_message_metadata: { suggestions: ["next"] },
        p_provider_attempted: true,
        p_actual_cost_microusd: 1_230,
      }),
    );
    expect(rpc.mock.calls.some(([name]) =>
      name === "finalize_amora_provider_call_receipt")).toBe(false);
    const atomicParams = rpc.mock.calls.find(([name]) =>
      name === "finalize_amora_chat_response")?.[1];
    expect(atomicParams).not.toHaveProperty("p_metadata");
    expect(atomicParams).toHaveProperty("p_receipt_metadata");
    expect(finalized).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "persisted",
      message: expect.objectContaining({
        id: "60000000-0000-4000-8000-000000000001",
        content: "terminal answer",
        reused: false,
      }),
    }));
  });

  it("retries the same token-fenced atomic terminal commit and never falls back to split settlement", async () => {
    const failure = { data: null, error: { message: "connection lost" } };
    const committed = {
      data: [{
        finalized: true,
        receipt_status: "settled",
        outcome: "persisted",
        message_id: "60000000-0000-4000-8000-000000000002",
        message_created_at: "2026-07-17T00:00:00.000Z",
        message_content: "retry-safe answer",
        message_metadata: {},
        message_stage_tag: null,
        message_specialist_type: "general",
        message_visibility: "shared",
        message_reused: true,
      }],
      error: null,
    };
    const { rpc } = makeAdmin({
      chatResponseFinalize: [failure, committed],
    });
    const finalized = vi.fn();
    const requestKey =
      "chat:10000000-0000-4000-8000-000000000001:70000000-0000-4000-8000-000000000002";

    await runAmoraProviderCallWithLedger(
      { ...context, requestKey },
      async (beforeGeneration) => {
        await beforeGeneration();
        return successResult();
      },
      {
        buildAtomicChatResponse: () => ({
          coupleId: context.coupleId,
          userId: context.userId,
          requestKey,
          visibility: "shared",
          claimAttemptCount: 2,
          content: "retry-safe answer",
          metadata: {},
          stageTag: null,
          specialistType: "general",
        }),
        onAtomicChatResponseFinalized: finalized,
      },
    );

    expect(rpc.mock.calls.filter(([name]) =>
      name === "finalize_amora_chat_response")).toHaveLength(2);
    expect(rpc.mock.calls.some(([name]) =>
      name === "finalize_amora_provider_call_receipt")).toBe(false);
    expect(finalized).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ reused: true }),
    }));
  });

  it("keeps the receipt reserved and fails closed when every atomic terminal commit attempt fails", async () => {
    const failure = { data: null, error: { message: "database unavailable" } };
    const { rpc } = makeAdmin({
      chatResponseFinalize: [failure, failure, failure],
    });
    const requestKey =
      "chat:10000000-0000-4000-8000-000000000001:70000000-0000-4000-8000-000000000003";

    await expect(runAmoraProviderCallWithLedger(
      { ...context, requestKey },
      async (beforeGeneration) => {
        await beforeGeneration();
        return successResult();
      },
      {
        buildAtomicChatResponse: () => ({
          coupleId: context.coupleId,
          userId: context.userId,
          requestKey,
          visibility: "shared",
          claimAttemptCount: 1,
          content: "must not be split-finalized",
          metadata: {},
          stageTag: null,
          specialistType: "general",
        }),
      },
    )).rejects.toThrow(/not committed/i);
    expect(rpc.mock.calls.filter(([name]) =>
      name === "finalize_amora_chat_response")).toHaveLength(3);
    expect(rpc.mock.calls.some(([name]) =>
      name === "finalize_amora_provider_call_receipt")).toBe(false);
  });

  it("fails closed before tool execution when a successful provider receipt cannot be finalized", async () => {
    const failure = { data: null, error: { message: "database unavailable" } };
    const { rpc } = makeAdmin({ finalize: [failure, failure, failure] });
    const result = successResult();

    await expect(
      runAmoraProviderCallWithLedger(context, async (beforeGeneration) => {
        await beforeGeneration();
        return result;
      }),
    ).rejects.toThrow(/receipt settlement was not confirmed/i);

    expect(rpc.mock.calls.filter(([name]) =>
      name === "finalize_amora_provider_call_receipt"))
      .toHaveLength(3);
    expect(mocks.operationalError).toHaveBeenCalledWith(
      expect.stringContaining("finalize"),
      expect.any(Error),
    );
  });

  it("rejects a contradictory released status for a successful provider call", async () => {
    const malformed = {
      data: [{ finalized: true, receipt_status: "released" }],
      error: null,
    };
    const { rpc } = makeAdmin({ finalize: [malformed, malformed, malformed] });

    await expect(
      runAmoraProviderCallWithLedger(context, async (beforeGeneration) => {
        await beforeGeneration();
        return successResult();
      }),
    ).rejects.toThrow(/receipt settlement was not confirmed/i);

    expect(rpc.mock.calls.filter(([name]) =>
      name === "finalize_amora_provider_call_receipt"))
      .toHaveLength(3);
  });

  it("retains the reservation for an interrupted paid attempt with unknown usage", async () => {
    const { rpc } = makeAdmin();
    const providerError = new OpenAIProviderError("stream interrupted", {
      category: "transport",
      model: "gpt-5.6-luna",
      requestId: "req_unknown",
      responseId: "resp_unknown",
      usageStatus: "unknown",
      providerCode: "stream_error",
    });

    await expect(
      runAmoraProviderCallWithLedger(context, async (beforeGeneration) => {
        await beforeGeneration();
        throw providerError;
      }),
    ).rejects.toBe(providerError);

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_provider_call_receipt",
      expect.objectContaining({
        p_provider_attempted: true,
        p_usage_status: "unknown",
        p_actual_cost_microusd: null,
        p_error_message: "openai_transport",
        p_metadata: expect.objectContaining({
          unknown_paid_attempt: true,
          provider_request_id: "req_unknown",
        }),
      }),
    );
  });

  it("conservatively retains the reservation for an unknown error after the provider boundary", async () => {
    const { rpc } = makeAdmin();
    const providerError = new Error("unknown transport failure");

    await expect(
      runAmoraProviderCallWithLedger(context, async (beforeGeneration) => {
        await beforeGeneration();
        throw providerError;
      }),
    ).rejects.toBe(providerError);

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_provider_call_receipt",
      expect.objectContaining({
        p_provider_attempted: true,
        p_usage_status: "unknown",
        p_actual_cost_microusd: null,
      }),
    );
  });

  it("releases a reservation when a pre-provider side effect fails", async () => {
    const { rpc } = makeAdmin();
    const sideEffectError = new Error("confirmed action failed");

    await expect(
      runAmoraProviderCallWithLedger(
        context,
        async (_beforeGeneration, reserveBeforeSideEffect) => {
          await reserveBeforeSideEffect();
          throw sideEffectError;
        },
      ),
    ).rejects.toBe(sideEffectError);

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_provider_call_receipt",
      expect.objectContaining({
        p_provider_attempted: false,
        p_usage_status: "complete",
        p_actual_cost_microusd: null,
      }),
    );
  });

  it("releases the reservation when provider configuration rejects before generation", async () => {
    const { rpc } = makeAdmin();
    const configError = new OpenAIProviderError("disabled", {
      category: "auth_config",
      model: "gpt-5.6-luna",
      usageStatus: "complete",
      providerCode: "openai_not_enabled",
    });

    await expect(
      runAmoraProviderCallWithLedger(context, async () => {
        throw configError;
      }),
    ).rejects.toBe(configError);

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_provider_call_receipt",
      expect.objectContaining({
        p_provider_attempted: false,
        p_usage_status: "complete",
        p_actual_cost_microusd: null,
        p_error_message: "openai_auth_config",
      }),
    );
  });

  it("records an input-count outage as pre-generation and keeps its request id separate", async () => {
    const { rpc } = makeAdmin();
    const countError = new OpenAIProviderError("count failed", {
      category: "provider_5xx",
      model: "gpt-5.6-luna",
      requestId: "req_count_503",
      requestStage: "input_count",
      usageStatus: "unknown",
      providerCode: "server_error",
    });

    await expect(
      runAmoraProviderCallWithLedger(context, async () => {
        throw countError;
      }),
    ).rejects.toBe(countError);

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_provider_call_receipt",
      expect.objectContaining({
        p_provider_attempted: false,
        p_metadata: expect.objectContaining({
          provider_request_id: null,
          input_count_request_id: "req_count_503",
          provider_request_stage: "input_count",
          unknown_paid_attempt: false,
        }),
      }),
    );
  });

  it("keeps demo/evaluation log FKs null while charging the synthetic cost ledger", async () => {
    const { rpc } = makeAdmin();
    const demoContext = {
      ...context,
      userId: null,
      coupleId: null,
      source: "demo" as const,
      costGuard: {
        ...context.costGuard,
        coupleId: "00000000-0000-4000-8000-000000000000",
        quotaScope: "demo" as const,
      },
    };

    await runAmoraProviderCallWithLedger(demoContext, async (beforeGeneration) => {
      await beforeGeneration();
      return successResult();
    });

    expect(rpc).toHaveBeenCalledWith(
      "prepare_amora_provider_call_receipt",
      expect.objectContaining({ p_user_id: null, p_log_couple_id: null }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "reserve_amora_provider_call",
      expect.objectContaining({
        p_cost_couple_id: "00000000-0000-4000-8000-000000000000",
      }),
    );
  });

  it("uses a dedicated endpoint and durable source/phase pair for conflict verification", async () => {
    const { rpc } = makeAdmin();
    const conflictContext = {
      ...context,
      requestKey: "conflict_123",
      source: "conflict_check" as const,
      phase: "conflict_verify" as const,
    };

    await runAmoraProviderCallWithLedger(
      conflictContext,
      async (beforeGeneration) => {
        await beforeGeneration();
        return successResult();
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      "prepare_amora_provider_call_receipt",
      expect.objectContaining({
        p_call_source: "conflict_check",
        p_call_phase: "conflict_verify",
        p_metadata: expect.objectContaining({
          endpoint: "chat_conflict_check",
          source: "conflict_check",
          provider_call_phase: "conflict_verify",
        }),
      }),
    );
  });

  it("atomically finalizes a conflict-verification receipt with its replay checkpoint", async () => {
    const { rpc } = makeAdmin();
    const messageDigest = "a".repeat(64);
    const conflictClaimToken = "50000000-0000-4000-8000-000000000001";
    const providerCheckpoint = {
      stage: "detection_complete" as const,
      triggered: false,
      score: 7,
      reason: "borderline score verified as conflict",
      conflictContext: "bounded conflict context",
      llmVerified: true,
    };

    await runAmoraProviderCallWithLedger(
      {
        ...context,
        requestKey: `conflict:${messageDigest}`,
        source: "conflict_check",
        phase: "conflict_verify",
        conflictCheckpointClaim: {
          coupleId: context.coupleId,
          messageDigest,
          claimToken: conflictClaimToken,
        },
      },
      async (beforeGeneration) => {
        await beforeGeneration();
        return { ...successResult(), providerCheckpoint };
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      "finalize_amora_conflict_verify_receipt",
      expect.objectContaining({
        p_receipt_id: RECEIPT_ID,
        p_receipt_claim_token: CLAIM_TOKEN,
        p_conflict_couple_id: context.coupleId,
        p_message_digest: messageDigest,
        p_conflict_claim_token: conflictClaimToken,
        p_checkpoint: providerCheckpoint,
        p_actual_cost_microusd: 1_230,
      }),
    );
    expect(rpc.mock.calls.some(([name]) =>
      name === "finalize_amora_provider_call_receipt")).toBe(false);
  });

  it("fails closed after generation when a requested atomic checkpoint has an invalid shape", async () => {
    const { rpc } = makeAdmin();
    const messageDigest = "b".repeat(64);

    await expect(runAmoraProviderCallWithLedger(
      {
        ...context,
        requestKey: `conflict:${messageDigest}`,
        source: "conflict_check",
        phase: "conflict_verify",
        conflictCheckpointClaim: {
          coupleId: context.coupleId,
          messageDigest,
          claimToken: "50000000-0000-4000-8000-000000000002",
        },
      },
      async (beforeGeneration) => {
        await beforeGeneration();
        return {
          ...successResult(),
          providerCheckpoint: {
            stage: "detection_complete",
            triggered: true,
            score: 7,
            reason: "verified",
            conflictContext: "bounded",
            llmVerified: true,
            leakedExtraKey: "must-not-persist",
          },
        };
      },
    )).rejects.toThrow(/checkpoint/i);

    expect(rpc.mock.calls.some(([name]) => name.startsWith("finalize_")))
      .toBe(false);
  });

  it("does not release a verified result when atomic receipt checkpointing is unconfirmed", async () => {
    const failure = { data: null, error: { message: "database unavailable" } };
    const { rpc } = makeAdmin({
      conflictFinalize: [failure, failure, failure],
    });
    const messageDigest = "c".repeat(64);

    await expect(runAmoraProviderCallWithLedger(
      {
        ...context,
        requestKey: `conflict:${messageDigest}`,
        source: "conflict_check",
        phase: "conflict_verify",
        conflictCheckpointClaim: {
          coupleId: context.coupleId,
          messageDigest,
          claimToken: "50000000-0000-4000-8000-000000000003",
        },
      },
      async (beforeGeneration) => {
        await beforeGeneration();
        return {
          ...successResult(),
          providerCheckpoint: {
            stage: "detection_complete" as const,
            triggered: true as const,
            score: 8,
            reason: "verified",
            conflictContext: "bounded",
            llmVerified: true,
          },
        };
      },
    )).rejects.toThrow(/not confirmed/i);

    expect(rpc.mock.calls.filter(([name]) =>
      name === "finalize_amora_conflict_verify_receipt")).toHaveLength(3);
    expect(rpc.mock.calls.some(([name]) =>
      name === "finalize_amora_provider_call_receipt")).toBe(false);
  });

  it("never sends conversation text or sensitive-looking provider metadata to receipt RPCs", async () => {
    const { rpc } = makeAdmin();
    const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
    const privateText = "private wedding conversation";

    await runAmoraProviderCallWithLedger(
      { ...context, stageTag: "person@example.com" },
      async (beforeGeneration) => {
        await beforeGeneration();
        return {
          ...successResult(),
          model: secret,
          fullText: privateText,
          requestId: "person@example.com",
          responseId: secret,
        };
      },
    );

    const persisted = JSON.stringify(rpc.mock.calls);
    expect(persisted).not.toContain(privateText);
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain("person@example.com");
  });
});
