import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAIResponseWithAudit as rawCreateOpenAIResponseWithAudit,
  createOpenAIStructuredResponseWithAudit as rawCreateOpenAIStructuredResponseWithAudit,
} from "../auditedOpenAI";
import { buildMultimodalContent, OpenAIRefusalError, type ImageAttachment } from "../openai";
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
    const { client, count, create } = fakeClient(response(), 64_001);
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
    // 측정은 성공했고 그 판정이 막은 것이다 — 다시 재지 않는다.
    expect(count).toHaveBeenCalledTimes(1);
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

  // 측정 *호출* 자체가 죽으면 한 번 다시 재고, 그래도 안 되면 로컬 추정으로 앱
  // 상한을 지킨 채 생성으로 간다. 2026-07-25 운영에서 count 만 죽고 create 는
  // 멀쩡했는데 "안녕" 한 마디까지 "입력 분량을 확인하는 중 문제가 생겼어요"로
  // 죽었다. 그때 넣은 폴백(673ff6c5)은 상한 없이 진행해 9-07(b2d2fa1c)에 빠졌다.
  it("retries the count once and then answers when the pre-count stays unavailable", async () => {
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
      input: "안녕",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    });

    expect(result.text).toBe("안녕하세요");
    expect(count).toHaveBeenCalledTimes(2);
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

  it("recovers when the retried count succeeds and audits a normal turn", async () => {
    const { client, count, create } = fakeClient(response());
    count.mockReturnValueOnce({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count service unavailable"), {
        status: 503,
        request_id: "req_count_503",
        code: "server_error",
      })),
    });

    const result = await createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "안녕",
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration: vi.fn(),
      client,
      audit: { interactionType: "chat_turn" },
    });

    expect(result.text).toBe("안녕하세요");
    expect(count).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      metadata: expect.objectContaining({
        input_count_unavailable: null,
        input_count_request_id: "req_input_count",
      }),
    }));
  });

  it("keeps the input cap on a local estimate when the count is down", async () => {
    // b2d2fa1c 가 폴백을 뺀 이유: 측정 없이 진행하면 앱 상한(64k)이 아니라
    // 제공자의 더 큰 context 한도까지 유료 생성이 나간다. 상한은 계속 지킨다.
    const count = vi.fn().mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count service unavailable"), {
        status: 503,
        request_id: "req_count_503",
        code: "server_error",
      })),
    });
    const create = vi.fn().mockReturnValue(apiResult(response()));
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;
    const beforeGeneration = vi.fn();

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: "가".repeat(300_000),
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toMatchObject({ providerCode: "input_token_limit", requestStage: "input_count" });

    expect(count).toHaveBeenCalledTimes(2);
    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      metadata: expect.objectContaining({
        provider_attempted: false,
        unknown_paid_attempt: false,
        provider_request_stage: "input_count",
      }),
    }));
  });

  // 첨부(사진·PDF)는 로컬로 잴 수 없다 — PDF 는 추출 텍스트 + 쪽당 이미지 1장(최대
  // 100쪽)으로 청구된다. 첨부 턴은 폴백 없이 이전처럼 측정 단계에서 끝내고, 원장에는
  // 유료 시도가 없었다는 사실만 남는다.
  it.each<[string, ImageAttachment[]]>([
    ["an image", [{ base64: "A".repeat(2_000), mediaType: "image/jpeg" }]],
    ["a PDF", [{ base64: "B".repeat(2_000), mediaType: "application/pdf", fileName: "quote.pdf" }]],
  ])("still fails at input_count without generating when the count is down on a turn with %s", async (
    _label,
    attachments,
  ) => {
    const count = vi.fn().mockReturnValue({
      withResponse: vi.fn().mockRejectedValue(Object.assign(new Error("count service unavailable"), {
        status: 503,
        request_id: "req_count_503",
        code: "server_error",
      })),
    });
    const create = vi.fn().mockReturnValue(apiResult(response()));
    const client = { responses: { create, inputTokens: { count } } } as unknown as OpenAI;
    const beforeGeneration = vi.fn();

    await expect(createOpenAIResponseWithAudit({
      modelRole: "fast",
      instructions: "system",
      input: [{ role: "user", content: buildMultimodalContent("이 견적서 봐줘", attachments) }],
      maxInputTokens: 64_000,
      maxOutputTokens: 100,
      beforeGeneration,
      client,
      audit: { interactionType: "chat_turn" },
    })).rejects.toMatchObject({ requestStage: "input_count", providerCode: "server_error" });

    expect(count).toHaveBeenCalledTimes(2);
    expect(beforeGeneration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: "openai_provider_5xx",
      tokensInput: null,
      metadata: expect.objectContaining({
        provider_attempted: false,
        unknown_paid_attempt: false,
        provider_request_stage: "input_count",
        input_count_request_id: "req_count_503",
        // 추정으로 건너뛴 턴이 아니다 — 측정 장애로 끝난 턴이다.
        input_count_unavailable: null,
      }),
    }));
  });

  it.each([-1, NaN, Infinity, 2.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid input count %s and audits no paid attempt", async (inputTokens) => {
      const { client, count, create } = fakeClient(response(), inputTokens);
      const beforeGeneration = vi.fn();
      await expect(createOpenAIResponseWithAudit({
        modelRole: "fast", instructions: "system", input: "input",
        maxInputTokens: 64_000, maxOutputTokens: 100, beforeGeneration, client,
        audit: { interactionType: "chat_turn" },
      })).rejects.toMatchObject({ requestStage: "input_count", providerCode: "invalid_input_token_count" });
      expect(beforeGeneration).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      // 잘못된 측정 응답은 판정이지 전송 장애가 아니다 — 다시 재지 않는다.
      expect(count).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        metadata: expect.objectContaining({ provider_attempted: false, unknown_paid_attempt: false }),
      }));
    },
  );

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
