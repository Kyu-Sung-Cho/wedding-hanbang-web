import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIInteractionAuditPersistenceError,
  createOpenAIResponseWithAudit,
  createOpenAIStructuredResponseWithAudit,
} from "../auditedOpenAI";
import {
  OpenAIInputTokenLimitError,
  OpenAIProviderError,
  OpenAIRefusalError,
  normalizeOpenAIProviderError,
} from "../openai";
import { logAIInteraction } from "@/lib/compliance/ai-log";

vi.mock("@/lib/compliance/ai-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/compliance/ai-log")>(
    "@/lib/compliance/ai-log"
  );
  return {
    ...actual,
    logAIInteraction: vi.fn().mockResolvedValue(true),
  };
});

const logSpy = vi.mocked(logAIInteraction);

function apiResult<T>(data: T, requestId = "req_audit") {
  return {
    withResponse: vi.fn().mockResolvedValue({
      data,
      response: new Response(),
      request_id: requestId,
    }),
  };
}

function response(options?: { output?: unknown[]; outputText?: string; status?: string }) {
  return {
    id: "resp_audit",
    created_at: 0,
    output_text: options?.outputText ?? "안녕하세요",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "gpt-5.6-luna",
    object: "response",
    output: options?.output ?? [],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: options?.status ?? "completed",
    usage: {
      input_tokens: 20,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 25,
    },
  };
}

function fakeClient(result: unknown, inputTokens = 20) {
  const count = vi.fn().mockReturnValue(apiResult({
    input_tokens: inputTokens,
    object: "response.input_tokens",
  }, "req_input_count"));
  const create = vi.fn().mockReturnValue(apiResult(result));
  return {
    client: { responses: { create, inputTokens: { count } } } as unknown as OpenAI,
    count,
    create,
  };
}

describe("audited OpenAI Responses", () => {
  beforeEach(() => {
    logSpy.mockClear();
    logSpy.mockResolvedValue(true);
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = ["sk", "unit-fixture-not-a-secret-0000000000000000"].join("-");
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  it("counts the exact provider input before the reservation hook and generation", async () => {
    const order: string[] = [];
    const { client, count, create } = fakeClient(response());
    count.mockImplementation(() => {
      order.push("count");
      return apiResult({ input_tokens: 20, object: "response.input_tokens" }, "req_input_count");
    });
    create.mockImplementation(() => {
      order.push("create");
      return apiResult(response());
    });
    const beforeGeneration = vi.fn(async () => {
      order.push("hook");
    });

    await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    });

    expect(order).toEqual(["count", "hook", "create"]);
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      instructions: "system",
      input: "input",
      reasoning: { effort: "none" },
      text: { verbosity: "low" },
    }), undefined);
  });

  it("does not write a duplicate row when a durable provider receipt owns the audit", async () => {
    const { client } = fakeClient(response());

    await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: async () => undefined,
      auditPersistence: "external_provider_receipt",
      client,
      audit: { interactionType: "amora_director" },
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does not return a provider result when the required audit row is missing", async () => {
    const { client } = fakeClient(response());
    logSpy.mockResolvedValueOnce(false);

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: async () => undefined,
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toBeInstanceOf(AIInteractionAuditPersistenceError);

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("blocks an oversized counted input before the hook or paid generation", async () => {
    const { client, create } = fakeClient(response(), 64_001);
    const beforeGeneration = vi.fn();

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toMatchObject({
      providerCode: "input_token_limit",
      requestStage: "input_count",
    });

    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      tokensInput: null,
      tokensOutput: null,
      metadata: expect.objectContaining({
        provider_attempted: false,
        unknown_paid_attempt: false,
        provider_request_id: null,
        input_count_request_id: "req_input_count",
        provider_request_stage: "input_count",
      }),
    }));
  });

  it("fails before reservation and generation when both count attempts fail", async () => {
    const count = vi.fn().mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(new OpenAIProviderError("count network", {
        category: "transport",
        requestId: "req_count_failed",
        usageStatus: "unknown",
      })),
    });
    const create = vi.fn().mockReturnValue(apiResult(response()));
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;
    const beforeGeneration = vi.fn();

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toMatchObject({
      category: "transport",
      requestStage: "input_count",
    });

    expect(count).toHaveBeenCalledTimes(2);
    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      metadata: expect.objectContaining({
        provider_attempted: false,
        unknown_paid_attempt: false,
        provider_request_stage: "input_count",
        input_count_request_id: "req_count_failed",
        input_count_attempt_count: 2,
        input_count_attempts: [
          "1:failure:transport:req_count_failed",
          "2:failure:transport:req_count_failed",
        ],
      }),
    }));
  });

  it("retries one transient count failure before allowing generation", async () => {
    const count = vi.fn()
      .mockReturnValueOnce({
        withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count 503"), {
          status: 503,
        })),
      })
      .mockReturnValue(apiResult(
        { input_tokens: 12, object: "response.input_tokens" },
        "req_input_count_retry",
      ));
    const create = vi.fn().mockReturnValue(apiResult(response()));
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;
    const beforeGeneration = vi.fn();

    const result = await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    });

    expect(result.text).toBe("안녕하세요");
    expect(result.inputCountAttempts).toEqual([
      {
        attempt: 1,
        outcome: "failure",
        category: "provider_5xx",
        requestId: null,
      },
      {
        attempt: 2,
        outcome: "success",
        category: null,
        requestId: "req_input_count_retry",
      },
    ]);
    expect(count).toHaveBeenCalledTimes(2);
    expect(beforeGeneration).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      metadata: expect.objectContaining({
        input_count_attempt_count: 2,
        input_count_attempts: [
          "1:failure:provider_5xx:none",
          "2:success:none:req_input_count_retry",
        ],
      }),
    }));
  });

  it("keeps both count attempts when a retry succeeds above the hard limit", async () => {
    const count = vi.fn()
      .mockReturnValueOnce({
        withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count 503"), {
          status: 503,
          requestID: "req_count_first",
        })),
      })
      .mockReturnValue(apiResult(
        { input_tokens: 64_001, object: "response.input_tokens" },
        "req_count_limit",
      ));
    const create = vi.fn().mockReturnValue(apiResult(response()));
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;
    const beforeGeneration = vi.fn();

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toBeInstanceOf(OpenAIInputTokenLimitError);

    expect(count).toHaveBeenCalledTimes(2);
    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      metadata: expect.objectContaining({
        provider_attempted: false,
        input_count_request_id: "req_count_limit",
        input_count_attempt_count: 2,
        input_count_attempts: [
          "1:failure:provider_5xx:req_count_first",
          "2:success:none:req_count_limit",
        ],
      }),
    }));
  });

  it("does not start generation when the final reservation hook rejects", async () => {
    const { client, create } = fakeClient(response());
    const reservationError = new Error("reservation rejected");

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: async () => {
        throw reservationError;
      },
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toBe(reservationError);

    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      metadata: expect.objectContaining({
        provider_attempted: false,
        unknown_paid_attempt: false,
        input_count_request_id: "req_input_count",
      }),
    }));
  });

  it("preserves exact-count attempts for an external receipt when reservation rejects", async () => {
    const { client, create } = fakeClient(response());
    const reservationError = new Error("external reservation rejected");
    let thrown: unknown;

    try {
      await createOpenAIResponseWithAudit({
        modelRole: "fast",
        instructions: "system",
        input: "input",
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeGeneration: async () => {
          throw reservationError;
        },
        auditPersistence: "external_provider_receipt",
        client,
        audit: { interactionType: "amora_director" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(reservationError);
    expect(normalizeOpenAIProviderError(thrown).inputCountAttempts).toEqual([{
      attempt: 1,
      outcome: "success",
      category: null,
      requestId: "req_input_count",
    }]);
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("checks cancellation again after exact counting and before the hook", async () => {
    const abortController = new AbortController();
    const { client, count, create } = fakeClient(response());
    count.mockImplementation(() => {
      abortController.abort();
      return apiResult({ input_tokens: 20, object: "response.input_tokens" }, "req_input_count");
    });
    const beforeGeneration = vi.fn();

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      signal: abortController.signal,
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toBeInstanceOf(Error);

    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      metadata: expect.objectContaining({
        provider_attempted: false,
        unknown_paid_attempt: false,
        input_count_request_id: "req_input_count",
      }),
    }));
  });

  it("does not call an injected client while the production kill switch is off", async () => {
    const { client, create } = fakeClient(response());
    process.env.AMORA_OPENAI_ENABLED = "false";

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: vi.fn(),
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toMatchObject({
      category: "auth_config",
      providerCode: "openai_not_enabled",
      usageStatus: "complete",
    });
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      tokensInput: null,
      tokensOutput: null,
      metadata: expect.objectContaining({
        usage_status: "complete",
        unknown_paid_attempt: false,
        provider_attempted: false,
      }),
    }));
  });

  it("logs usage and provider ids without copying conversation content", async () => {
    const { client, create } = fakeClient(response());
    const result = await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system secret",
      input: "user secret",
      maxInputTokens: 64_000,
      maxOutputTokens: 200,
      beforeGeneration: vi.fn(),
      client,
      audit: {
        userId: "user-id",
        interactionType: "chat_turn",
        userInput: "must not persist",
        metadata: { endpoint: "test" },
      },
    });

    expect(result).toMatchObject({
      text: "안녕하세요",
      requestId: "req_audit",
      responseId: "resp_audit",
      usageStatus: "complete",
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      store: false,
      prompt_cache_options: { mode: "explicit" },
      reasoning: { effort: "none" },
    }), undefined);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      userInput: null,
      aiOutput: null,
      tokensInput: 20,
      tokensOutput: 5,
      metadata: expect.objectContaining({
        ai_provider: "openai",
        provider_request_id: "req_audit",
        provider_response_id: "resp_audit",
        usage_status: "complete",
        provider_attempted: true,
      }),
    }));
  });

  it("classifies a completed refusal separately and preserves billed usage", async () => {
    const refusal = response({
      outputText: "",
      output: [{
        id: "msg_refusal",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "refusal", refusal: "도와드릴 수 없어요." }],
      }],
    });
    const { client } = fakeClient(refusal);

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "unsafe",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: vi.fn(),
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toBeInstanceOf(OpenAIRefusalError);

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: "openai_refusal",
      tokensInput: 20,
      tokensOutput: 5,
      metadata: expect.objectContaining({ usage_status: "complete" }),
    }));
  });

  it("validates structured JSON after the provider schema contract", async () => {
    const { client, count, create } = fakeClient(response({ outputText: '{"ok":true}' }));
    const result = await createOpenAIStructuredResponseWithAudit({
      modelRole: "fast",
      instructions: "json",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: vi.fn(),
      client,
      audit: { interactionType: "chat_turn" },
      responseFormat: {
        name: "test_result",
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
      validate: (value) => {
        if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) {
          throw new Error("invalid");
        }
        return value as { ok: true };
      },
    });

    expect(result.data).toEqual({ ok: true });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      instructions: "json",
      input: "input",
      text: expect.objectContaining({
        verbosity: "low",
        format: expect.objectContaining({
          type: "json_schema",
          name: "test_result",
          strict: true,
        }),
      }),
    }), undefined);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.objectContaining({
        format: expect.objectContaining({ type: "json_schema", strict: true }),
      }),
    }), undefined);
  });

  it("keeps transport failures as unknown paid attempts", async () => {
    const count = vi.fn().mockReturnValue(apiResult({
      input_tokens: 20,
      object: "response.input_tokens",
    }, "req_input_count"));
    const create = vi.fn().mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("network"), {
        request_id: "req_failed",
      })),
    });
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: vi.fn(),
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toMatchObject({ usageStatus: "unknown" });

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      tokensInput: null,
      tokensOutput: null,
      metadata: expect.objectContaining({
        provider_request_id: "req_failed",
        usage_status: "unknown",
        unknown_paid_attempt: true,
        provider_attempted: true,
      }),
    }));
  });

  it("preserves exact-count attempts on external generation failures", async () => {
    const count = vi.fn().mockReturnValue(apiResult({
      input_tokens: 20,
      object: "response.input_tokens",
    }, "req_input_count"));
    const create = vi.fn().mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("network"), {
        request_id: "req_failed_external",
      })),
    });
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;
    let thrown: unknown;

    try {
      await createOpenAIResponseWithAudit({
        modelRole: "fast",
        instructions: "system",
        input: "input",
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeGeneration: vi.fn(),
        auditPersistence: "external_provider_receipt",
        client,
        audit: { interactionType: "amora_director" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(normalizeOpenAIProviderError(thrown)).toMatchObject({
      requestId: "req_failed_external",
      inputCountAttempts: [{
        attempt: 1,
        outcome: "success",
        category: null,
        requestId: "req_input_count",
      }],
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("preserves exact-count attempts on external structured-output failures", async () => {
    const { client } = fakeClient(response({ outputText: "not-json" }));
    let thrown: unknown;

    try {
      await createOpenAIStructuredResponseWithAudit({
        modelRole: "fast",
        instructions: "json",
        input: "input",
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeGeneration: vi.fn(),
        auditPersistence: "external_provider_receipt",
        client,
        audit: { interactionType: "amora_director" },
        responseFormat: {
          name: "external_result",
          schema: { type: "object", additionalProperties: true },
        },
        validate: (value): Record<string, unknown> => value as Record<string, unknown>,
      });
    } catch (error) {
      thrown = error;
    }

    expect(normalizeOpenAIProviderError(thrown).inputCountAttempts).toEqual([{
      attempt: 1,
      outcome: "success",
      category: null,
      requestId: "req_input_count",
    }]);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
