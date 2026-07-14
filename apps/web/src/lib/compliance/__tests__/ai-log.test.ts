import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import { calcCostUsd, logAIInteraction, sanitizeAIErrorCode } from "../ai-log";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ insert: mocks.insert });
});

describe("calcCostUsd", () => {
  it("prices OpenAI cached input without double charging total input tokens", () => {
    const cost = calcCostUsd(
      "gpt-5.4-mini-2026-03-17",
      1_000_000,
      1_000_000,
      0,
      400_000
    );

    expect(cost).toBeCloseTo(4.98, 6);
  });

  it("matches the longest OpenAI model prefix", () => {
    const mini = calcCostUsd("gpt-5.4-mini-2026-03-17", 1_000_000, 1_000_000);
    const full = calcCostUsd("gpt-5.4-2026-03-05", 1_000_000, 1_000_000);

    expect(mini).toBeCloseTo(5.25, 6);
    expect(full).toBeCloseTo(27.5, 6);
  });

  it("keeps historical Claude pricing for existing audit rows", () => {
    const historical = calcCostUsd(
      "claude-haiku-4-5-20251001",
      1_000_000,
      1_000_000,
      1_000_000,
      1_000_000
    );

    expect(historical).toBeCloseTo(7.35, 6);
  });

  it("prices Terra cache writes and reads without double charging input", () => {
    const cost = calcCostUsd(
      "gpt-5.6-terra",
      200_000,
      100_000,
      40_000,
      80_000
    );

    expect(cost).toBeCloseTo(1.845, 6);
  });

  it("uses Luna long-context pricing for inputs over 272K tokens", () => {
    const cost = calcCostUsd("gpt-5.6-luna", 300_000, 100_000);

    expect(cost).toBeCloseTo(1.5, 6);
  });

  it("returns null when the model is not priced", () => {
    expect(calcCostUsd("deterministic-price-benchmark-v1", 1_000, 1_000)).toBeNull();
  });
});

describe("sanitizeAIErrorCode", () => {
  it("keeps reviewed categories but never persists free-text provider or user data", () => {
    expect(
      sanitizeAIErrorCode("provider_request_failed:name_APIError:status_429")
    ).toBe("provider_request_failed");
    expect(sanitizeAIErrorCode("empty_response")).toBe("empty_response");
    expect(
      sanitizeAIErrorCode("victim@example.com Failing row contains (private payload)")
    ).toBe("ai_interaction_failed");
  });
});

describe("logAIInteraction idempotency", () => {
  const key = "b".repeat(64);
  const input = {
    interactionType: "couple_court_verdict" as const,
    userId: "00000000-0000-4000-8000-000000000001",
    coupleId: "00000000-0000-4000-8000-000000000002",
    userInput: null,
    aiOutput: null,
    success: true,
    model: "gpt-5.6-terra",
    tokensInput: 100,
    tokensOutput: 20,
    cacheWriteTokens: 3,
    cacheReadTokens: 7,
    metadata: {
      source: "couple_court_judge",
      input_hash: "c".repeat(64),
      prompt_version: "court-verdict-2026-07-13.4",
      schema_version: "1.0",
    },
    idempotencyKey: key,
    required: true,
  };

  it("uses the atomic database ledger for a lost-ack-safe required audit", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        audit_log_id: "00000000-0000-4000-8000-000000000003",
        reused: true,
        subject_deleted: false,
      },
      error: null,
    });

    await expect(logAIInteraction(input)).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("write_court_provider_audit", expect.objectContaining({
      p_request_key: key,
      p_audit_identity: expect.objectContaining({
        interaction_type: "couple_court_verdict",
        user_input: null,
        ai_output: null,
        model: "gpt-5.6-terra",
        tokens_input: 100,
        tokens_output: 20,
      }),
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fails closed when the database rejects a conflicting audit identity", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000" } });

    await expect(logAIInteraction(input)).rejects.toThrow("AI_LOG_REQUIRED_INSERT_FAILED");
  });

  it("fails closed when the database returns a malformed success contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { reused: false }, error: null });

    await expect(logAIInteraction(input)).rejects.toThrow("AI_LOG_REQUIRED_CONTRACT_INVALID");
  });

  it("fails closed when a deleted-subject audit is routed to the live writer", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        audit_log_id: "00000000-0000-4000-8000-000000000003",
        reused: false,
        subject_deleted: false,
      },
      error: null,
    });

    await expect(logAIInteraction({
      ...input,
      expectedSubjectDeleted: true,
    })).rejects.toThrow("AI_LOG_REQUIRED_CONTRACT_INVALID");
  });

  it("rejects malformed idempotency keys before touching the audit table", async () => {
    await expect(logAIInteraction({ ...input, idempotencyKey: "not-a-digest" }))
      .rejects.toThrow("AI_LOG_IDEMPOTENCY_KEY_INVALID");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a deleted-subject expectation outside the required writer", async () => {
    await expect(logAIInteraction({
      ...input,
      idempotencyKey: null,
      expectedSubjectDeleted: true,
    })).rejects.toThrow("AI_LOG_SUBJECT_EXPECTATION_SCOPE_INVALID");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
