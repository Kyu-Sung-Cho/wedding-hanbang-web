import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn(() => ({ insert }));
  return { from, insert };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: db.from }),
}));

import { logAIInteraction } from "../ai-log";

describe("logAIInteraction privacy boundary", () => {
  beforeEach(() => {
    db.from.mockClear();
    db.insert.mockReset();
    db.insert.mockResolvedValue({ error: null });
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
});
