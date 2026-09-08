import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn(() => ({ insert }));
  return { from, insert };
});

const observability = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: db.from }),
}));

vi.mock("@/utils/log", () => ({
  log: {
    error: observability.error,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logAIInteraction } from "../ai-log";

describe("logAIInteraction privacy boundary", () => {
  beforeEach(() => {
    db.from.mockClear();
    db.insert.mockReset();
    db.insert.mockResolvedValue({ error: null });
    observability.error.mockClear();
  });

  it("never persists prompt, response, or tool payload content", async () => {
    await logAIInteraction({
      interactionType: "chat_turn",
      userInput: "private wedding budget and family details",
      aiOutput: "private personalized recommendation",
      toolInput: { secret: "raw tool input" },
      toolOutput: { secret: "raw tool output" },
      errorMessage: "provider returned a private response body",
      model: "gpt-5.6-luna",
      tokensInput: 120,
      tokensOutput: 45,
      metadata: {
        usage_status: "complete",
        content_logging: "enabled",
        raw_prompt: "private wedding budget",
        nested: { raw_response: "private recommendation" },
      },
    });

    expect(db.from).toHaveBeenCalledWith("ai_interactions_log");
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_input: null,
        ai_output: null,
        tool_input: null,
        tool_output: null,
        error_message: "redacted_error",
        metadata: expect.objectContaining({
          content_logging: "disabled",
          user_input_chars: 41,
          ai_output_chars: 35,
          usage_status: "complete",
        }),
      })
    );
    const inserted = db.insert.mock.calls[0]?.[0];
    expect(JSON.stringify(inserted?.metadata)).not.toContain("private");
    expect(inserted?.metadata).not.toHaveProperty("raw_prompt");
    expect(inserted?.metadata).not.toHaveProperty("nested");
  });

  it("keeps only bounded machine-readable error codes", async () => {
    await logAIInteraction({
      interactionType: "chat_turn",
      errorMessage: "provider_timeout",
    });

    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ error_message: "provider_timeout" })
    );
  });

  it.each([0, 0.7])("preserves an explicitly supplied historical cost of %s USD", async (costUsd) => {
    await logAIInteraction({
      interactionType: "chat_turn",
      model: "gpt-5.6-luna",
      tokensInput: 100_000,
      tokensOutput: 100_000,
      costUsd,
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ cost_usd: costUsd }));
  });

  it("redacts secret-looking tokens even when they match the code character set", async () => {
    await logAIInteraction({
      interactionType: "chat_turn",
      errorMessage: "sk-proj-this-is-not-safe-to-store-1234567890",
      metadata: {
        endpoint: "operator@example.com",
        source: "unit_test",
      },
    });

    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "redacted_error",
      metadata: expect.objectContaining({ source: "unit_test" }),
    }));
    const inserted = db.insert.mock.calls[0]?.[0];
    expect(inserted?.metadata).not.toHaveProperty("endpoint");
  });

  it("round-trips only the six exact server-issued Amora question scopes", async () => {
    const scopes = [
      "W0_wedding_core",
      "W1_wedding_adjacent",
      "W2_high_risk_adjacent",
      "W3_social_care",
      "W4_out_of_scope",
      "W5_safety_override",
    ] as const;

    for (const questionScope of scopes) {
      await logAIInteraction({
        interactionType: "chat_turn",
        metadata: { question_scope: questionScope },
      });
    }

    expect(db.insert).toHaveBeenCalledTimes(scopes.length);
    expect(db.insert.mock.calls.map(([inserted]) => (
      inserted?.metadata?.question_scope
    ))).toEqual(scopes);
  });

  it("drops malformed question-scope strings and structured payloads", async () => {
    const malformedScopes = [
      "W2_high_risk_adjacent user text",
      "w2_high_risk_adjacent",
      "W9_unknown",
      { scope: "W0_wedding_core" },
      ["W0_wedding_core"],
      null,
    ];
    for (const questionScope of malformedScopes) {
      await logAIInteraction({
        interactionType: "chat_turn",
        metadata: { question_scope: questionScope },
      });
    }

    expect(db.insert).toHaveBeenCalledTimes(malformedScopes.length);
    for (const [inserted] of db.insert.mock.calls) {
      expect(inserted?.metadata).not.toHaveProperty("question_scope");
    }
  });

  it("returns false and emits an operational signal when the durable row is missing", async () => {
    db.insert.mockResolvedValue({ error: { message: "database unavailable" } });

    await expect(logAIInteraction({
      interactionType: "amora_director",
      model: "gpt-5.6-luna",
      tokensInput: 10,
      tokensOutput: 2,
    })).resolves.toBe(false);

    expect(observability.error).toHaveBeenCalledWith(
      expect.stringContaining("provider ledger row may be missing"),
      expect.any(Error),
    );
  });
});
