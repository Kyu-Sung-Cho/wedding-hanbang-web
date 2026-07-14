import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAIResponseWithAudit,
  createOpenAIStructuredResponseWithAudit,
} from "../auditedOpenAI";
import { OpenAIRefusalError } from "../openai";
import { logAIInteraction } from "@/lib/compliance/ai-log";

vi.mock("@/lib/compliance/ai-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/compliance/ai-log")>(
    "@/lib/compliance/ai-log"
  );
  return {
    ...actual,
    logAIInteraction: vi.fn().mockResolvedValue(undefined),
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

function fakeClient(result: unknown) {
  const create = vi.fn().mockReturnValue(apiResult(result));
  return {
    client: { responses: { create } } as unknown as OpenAI,
    create,
  };
}

describe("audited OpenAI Responses", () => {
  beforeEach(() => {
    logSpy.mockClear();
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  it("does not call an injected client while the production kill switch is off", async () => {
    const { client, create } = fakeClient(response());
    process.env.AMORA_OPENAI_ENABLED = "false";

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxOutputTokens: 100,
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
      maxOutputTokens: 200,
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
      maxOutputTokens: 100,
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
    const { client, create } = fakeClient(response({ outputText: '{"ok":true}' }));
    const result = await createOpenAIStructuredResponseWithAudit({
      modelRole: "fast",
      instructions: "json",
      input: "input",
      maxOutputTokens: 100,
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
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.objectContaining({
        format: expect.objectContaining({ type: "json_schema", strict: true }),
      }),
    }), undefined);
  });

  it("keeps transport failures as unknown paid attempts", async () => {
    const create = vi.fn().mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("network"), {
        request_id: "req_failed",
      })),
    });
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "input",
      maxOutputTokens: 100,
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
});
