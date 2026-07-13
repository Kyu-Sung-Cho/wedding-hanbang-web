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

import {
  createOpenAIResponseWithAudit,
  createOpenAIStructuredResponseWithAudit,
} from "@/lib/ai/auditedOpenAI";

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
      audit: {
        interactionType: "chat_turn",
        userId: "user-1",
        userInput: "비용 장부에 복제하면 안 되는 대화",
      },
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
      userInput: null,
      aiOutput: null,
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
      errorMessage: "openai_response_error",
      tokensInput: 70,
      tokensOutput: 9,
      cacheWriteTokens: 7,
      cacheReadTokens: 11,
    }));
  });

  it("audits a completed empty response once and then fails closed", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "   ",
      model: "gpt-5.6-luna",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 25,
        input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
        output_tokens: 0,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "summary",
      input: "conversation",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
    })).rejects.toThrow("no output text");

    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: "empty_response",
      tokensInput: 25,
      tokensOutput: 0,
      userInput: null,
      aiOutput: null,
    }));
  });

  it("stores bounded provider codes instead of reflected SDK error messages", async () => {
    const providerError = Object.assign(
      new Error("request failed while echoing private input: wedding date 2027-01-02"),
      { name: "RateLimitError", status: 429, code: "rate_limit_exceeded" }
    );
    const create = vi.fn().mockRejectedValue(providerError);
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "summary",
      input: "private input",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
    })).rejects.toBe(providerError);

    const audit = mocks.logAIInteraction.mock.calls[0]?.[0];
    expect(audit.errorMessage).toBe(
      "provider_request_failed:name_RateLimitError:status_429:code_rate_limit_exceeded"
    );
    expect(audit.errorMessage).not.toContain("wedding date");
    expect(audit.userInput).toBeNull();
    expect(audit.aiOutput).toBeNull();
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

  it("forwards a bounded idempotency key without persisting it in audit metadata", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "ok",
      model: "gpt-5.6-luna",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: null,
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const idempotencyKey = "a".repeat(64);

    await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "summary",
      input: "conversation",
      maxOutputTokens: 100,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
      idempotencyKey,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
    expect(JSON.stringify(mocks.logAIInteraction.mock.calls)).not.toContain(idempotencyKey);
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

  it("rejects auxiliary requests above the shared 800-token output ceiling", async () => {
    const create = vi.fn();
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "summary",
      input: "conversation",
      maxOutputTokens: 801,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      client,
    })).rejects.toThrow("between 1 and 800");

    expect(create).not.toHaveBeenCalled();
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      userInput: null,
      aiOutput: null,
      errorMessage: "provider_request_failed:name_Error",
    }));
  });

  it("requests strict JSON schema output and audits only the validated result", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{"answer":"ok"}',
      model: "gpt-5.6-terra",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 30,
        input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
        output_tokens: 7,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;

    const result = await createOpenAIStructuredResponseWithAudit({
      modelRole: "primary",
      instructions: "Return JSON.",
      input: "bounded input",
      maxOutputTokens: 80,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      responseFormat: {
        name: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: { answer: { type: "string" } },
        },
      },
      validate(value) {
        if (!value || typeof value !== "object" || (value as { answer?: unknown }).answer !== "ok") {
          throw new Error("invalid answer");
        }
        return value as { answer: "ok" };
      },
      client,
    });

    expect(result.data).toEqual({ answer: "ok" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-terra",
      store: false,
      text: expect.objectContaining({
        format: expect.objectContaining({
          type: "json_schema",
          name: "test_schema",
          strict: true,
        }),
      }),
    }));
    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      userInput: null,
      aiOutput: null,
      metadata: expect.objectContaining({
        audit_wrapper: "createOpenAIStructuredResponseWithAudit",
        schema_name: "test_schema",
        structured_output: true,
      }),
    }));
  });

  it("durably stages validated structured data before a required success audit can fail", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{"answer":"ok"}',
      model: "gpt-5.6-terra",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 31,
        input_tokens_details: { cache_write_tokens: 2, cached_tokens: 3 },
        output_tokens: 8,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const staged = vi.fn().mockResolvedValue(undefined);
    mocks.logAIInteraction.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(createOpenAIStructuredResponseWithAudit({
      modelRole: "primary",
      instructions: "Return JSON.",
      input: "bounded input",
      maxOutputTokens: 80,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      responseFormat: {
        name: "stage_test_schema",
        schema: { type: "object", additionalProperties: false },
      },
      validate: (value) => value as { answer: string },
      onValidated: staged,
      client,
    })).rejects.toThrow("audit unavailable");

    expect(staged).toHaveBeenCalledWith(
      { answer: "ok" },
      {
        model: "gpt-5.6-terra",
        usage: {
          input_tokens: 31,
          output_tokens: 8,
          cache_write_input_tokens: 2,
          cached_input_tokens: 3,
        },
      },
    );
    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
  });

  it("records one keyed provider success before rethrowing a validated callback failure", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{"answer":"ok"}',
      model: "gpt-5.6-terra",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 31,
        input_tokens_details: { cache_write_tokens: 2, cached_tokens: 3 },
        output_tokens: 8,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const callbackError = new Error("stage acknowledgement lost");
    const stage = vi.fn().mockRejectedValue(callbackError);
    const auditKey = "d".repeat(64);

    await expect(createOpenAIStructuredResponseWithAudit({
      modelRole: "primary",
      instructions: "Return JSON.",
      input: "bounded input",
      maxOutputTokens: 80,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      responseFormat: {
        name: "callback_failure_schema",
        schema: { type: "object", additionalProperties: false },
      },
      validate: (value) => value as { answer: string },
      onValidated: stage,
      successAuditIdempotencyKey: auditKey,
      client,
    })).rejects.toBe(callbackError);

    expect(stage).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      required: true,
      success: true,
      idempotencyKey: auditKey,
      tokensInput: 31,
      tokensOutput: 8,
    }));
  });

  it("fails closed and audits invalid structured JSON without storing it", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{"private":"unterminated"',
      model: "gpt-5.6-terra",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 30,
        input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
        output_tokens: 7,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIStructuredResponseWithAudit({
      modelRole: "primary",
      instructions: "Return JSON.",
      input: "private statement",
      maxOutputTokens: 80,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      responseFormat: {
        name: "test_schema",
        schema: { type: "object", additionalProperties: false },
      },
      validate: (value) => value,
      client,
    })).rejects.toMatchObject({ code: "invalid_json" });

    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: "structured_output_invalid",
      userInput: null,
      aiOutput: null,
    }));
    expect(JSON.stringify(mocks.logAIInteraction.mock.calls)).not.toContain("unterminated");
  });

  it("classifies a completed empty structured response as known invalid", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "   ",
      model: "gpt-5.6-terra",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: { input_tokens: 20, input_tokens_details: {}, output_tokens: 0 },
    });
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIStructuredResponseWithAudit({
      modelRole: "primary",
      instructions: "Return JSON.",
      input: "bounded input",
      maxOutputTokens: 80,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      responseFormat: {
        name: "empty_structured_schema",
        schema: { type: "object", additionalProperties: false },
      },
      validate: (value) => value,
      client,
    })).rejects.toMatchObject({ code: "invalid_json" });

    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: "empty_response",
      tokensInput: 20,
      tokensOutput: 0,
    }));
  });

  it("audits a schema-validator rejection as a structured failure", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{"answer":"private value"}',
      model: "gpt-5.6-terra",
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: null,
    });
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIStructuredResponseWithAudit({
      modelRole: "primary",
      instructions: "Return JSON.",
      input: "private statement",
      maxOutputTokens: 80,
      audit: { interactionType: "chat_turn", userId: "user-1" },
      responseFormat: {
        name: "test_schema",
        schema: { type: "object", additionalProperties: false },
      },
      validate() {
        throw new Error("domain invariant failed");
      },
      client,
    })).rejects.toMatchObject({ code: "schema_validation_failed" });

    expect(mocks.logAIInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.logAIInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: "structured_output_invalid",
      userInput: null,
      aiOutput: null,
    }));
    expect(JSON.stringify(mocks.logAIInteraction.mock.calls)).not.toContain("private value");
    expect(JSON.stringify(mocks.logAIInteraction.mock.calls)).not.toContain("domain invariant");
  });
});
