import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAIResponseWithAudit as rawCreateOpenAIResponseWithAudit,
  createOpenAIStructuredResponseWithAudit as rawCreateOpenAIStructuredResponseWithAudit,
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

type AuditOptions = Parameters<typeof rawCreateOpenAIResponseWithAudit>[0];
type StructuredAuditOptions<T> = Parameters<
  typeof rawCreateOpenAIStructuredResponseWithAudit<T>
>[0];

// 이 파일의 관심사는 count/hook/create 순서와 감사 행 계약이다. P0-5 egress
// gate는 providerEgressGate.test.ts와 providerEgressCallerContract.test.ts가
// 고정하므로 여기서는 통과하는 gate를 기본값으로 채운다.
function createOpenAIResponseWithAudit(
  options: Omit<AuditOptions, "beforeProviderEgress"> & {
    beforeProviderEgress?: AuditOptions["beforeProviderEgress"];
  },
) {
  return rawCreateOpenAIResponseWithAudit({
    beforeProviderEgress: () => {},
    ...options,
  });
}

function createOpenAIStructuredResponseWithAudit<T>(
  options: Omit<StructuredAuditOptions<T>, "beforeProviderEgress"> & {
    beforeProviderEgress?: StructuredAuditOptions<T>["beforeProviderEgress"];
  },
) {
  return rawCreateOpenAIStructuredResponseWithAudit<T>({
    beforeProviderEgress: () => {},
    ...options,
  });
}

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
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
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

  // 사전 토큰 계산은 과대 입력을 미리 걸러내는 선택적 가드레일이다. 그 측정이
  // 불가능해졌다고 대화를 죽이면 가드레일 하나가 서비스 전체를 멈춘다 —
  // 2026-07-25 운영에서 실제로 count 호출이 계속 실패하며 "안녕" 한 마디까지
  // 전부 AMORA_INPUT_COUNT_UNAVAILABLE로 죽었다. 과대 입력은 제공자가 스스로
  // 거부하고 그 경로는 아래 "blocks an oversized counted input" 테스트가 지킨다.
  it("proceeds with generation when the input pre-count is unavailable", async () => {
    const count = vi.fn().mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count network"), {
        request_id: "req_count_failed",
      })),
    });
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
    expect(beforeGeneration).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      metadata: expect.objectContaining({
        provider_attempted: true,
        // 가드레일이 꺼진 채 나간 턴이라는 사실은 원장에 남아야 한다.
        input_count_unavailable: "transport",
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
});
