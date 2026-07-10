import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logAIInteraction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/compliance/ai-log", () => ({
  elapsedMs: () => 25,
  logAIInteraction: mocks.logAIInteraction,
  startLatencyClock: () => 100,
}));

import { createOpenAIResponseWithAudit } from "@/lib/ai/auditedOpenAI";

describe("createOpenAIResponseWithAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logAIInteraction.mockReset().mockResolvedValue(undefined);
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  it("does not misclassify a successful provider response when required audit fails", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "성공 응답",
      model: "gpt-5.6-luna",
      status: "completed",
      usage: {
        input_tokens: 77,
        output_tokens: 11,
        input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      },
    });
    mocks.logAIInteraction.mockRejectedValueOnce(new Error("audit unavailable"));
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "summary",
      input: "conversation",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
    })).rejects.toThrow("audit unavailable");

    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      model: "gpt-5.6-luna",
      tokensInput: 77,
      tokensOutput: 11,
    }));
  });

  it("normalizes output and records OpenAI cached usage", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "  요약 결과  ",
      model: "gpt-5.6-luna",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 50,
        input_tokens_details: { cache_write_tokens: 5, cached_tokens: 10 },
        output_tokens: 8,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;

    const result = await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "요약",
      input: "대화",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
    });

    expect(result.text).toBe("요약 결과");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
      prompt_cache_options: { mode: "explicit" },
      safety_identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      service_tier: "default",
      store: false,
    }));
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      model: "gpt-5.6-luna",
      tokensInput: 50,
      tokensOutput: 8,
      cacheWriteTokens: 5,
      cacheReadTokens: 10,
      metadata: expect.objectContaining({ ai_provider: "openai", model_role: "fast" }),
    }));
  });

  it("fails closed and audits an incomplete response", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "잘린 응답",
      model: "gpt-5.6-luna",
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
      usage: {
        input_tokens: 70,
        input_tokens_details: { cache_write_tokens: 7, cached_tokens: 11 },
        output_tokens: 9,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "요약",
      input: "대화",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
    })).rejects.toThrow("max_output_tokens");

    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: expect.stringContaining("max_output_tokens"),
      tokensInput: 70,
      tokensOutput: 9,
      cacheWriteTokens: 7,
      cacheReadTokens: 11,
    }));
  });

  it("forwards cancellation to the Responses API", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "ok",
      model: "gpt-5.6-luna",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: null,
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const controller = new AbortController();

    await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "summary",
      input: "conversation",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
      signal: controller.signal,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
      { signal: controller.signal }
    );
  });

  it("does not start a paid request when already aborted", async () => {
    const create = vi.fn();
    const client = { responses: { create } } as unknown as OpenAI;
    const controller = new AbortController();
    controller.abort();

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "summary",
      input: "conversation",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(create).not.toHaveBeenCalled();
  });
});
