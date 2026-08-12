import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatWithToolsStream as rawChatWithToolsStream,
  OpenAIInputTokenLimitError,
} from "../openai";
import {
  createOpenAIResponseWithAudit,
  createOpenAIStructuredResponseWithAudit,
} from "../auditedOpenAI";
import { logAIInteraction } from "@/lib/compliance/ai-log";

// P0-5: `responses.inputTokens.count` sends the full instructions and input to
// OpenAI, so it is a content-bearing egress exactly like `responses.create`.
// Every provider request must therefore happen after the application privacy /
// audit gate, not between it and the paid call. See
// docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md §8 P0-5
// and docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md §10.2.
//
// 이 파일은 실제 사용자 원문 대신 synthetic marker만 사용한다. marker가 어떤
// provider 인자에도 나타나지 않아야 한다.

vi.mock("@/lib/compliance/ai-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/compliance/ai-log")>(
    "@/lib/compliance/ai-log",
  );
  return {
    ...actual,
    logAIInteraction: vi.fn().mockResolvedValue(undefined),
  };
});

const logSpy = vi.mocked(logAIInteraction);

/** 실제 상담 원문 대신 쓰는 합성 표식. 어떤 provider 인자에도 없어야 한다. */
const SYNTHETIC_PRIVATE_MARKER = "SYNTHETIC-P05-PRIVATE-MARKER-DO-NOT-EGRESS";
const SYNTHETIC_SYSTEM_MARKER = "SYNTHETIC-P05-SYSTEM-MARKER-DO-NOT-EGRESS";

type ChatWithToolsOptions = Parameters<typeof rawChatWithToolsStream>[0];

function chatWithToolsStream(
  options: Omit<ChatWithToolsOptions, "maxInputTokens" | "systemPrompt" | "input"> & {
    maxInputTokens?: number;
    systemPrompt?: string;
    input?: ChatWithToolsOptions["input"];
  },
) {
  return rawChatWithToolsStream({
    maxInputTokens: 64_000,
    systemPrompt: SYNTHETIC_SYSTEM_MARKER,
    input: SYNTHETIC_PRIVATE_MARKER,
    ...options,
  });
}

const originalEnabled = process.env.AMORA_OPENAI_ENABLED;
const originalApiKey = process.env.OPENAI_API_KEY;

type ProviderMethod = "responses.inputTokens.count" | "responses.create";

interface ProviderCallRecord {
  method: ProviderMethod;
  serializedArgs: string;
}

function serializeArgs(args: unknown[]): string {
  try {
    return JSON.stringify(args, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ) ?? "";
  } catch {
    return args.map((arg) => String(arg)).join("|");
  }
}

function apiResult<T>(data: T, requestId: string) {
  return {
    withResponse: vi.fn().mockResolvedValue({
      data,
      response: new Response(),
      request_id: requestId,
    }),
  };
}

function streamOf(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

function completedResponse(outputText = "합성 응답") {
  return {
    id: "resp_egress",
    created_at: 0,
    output_text: outputText,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "gpt-5.6-luna",
    object: "response",
    output: [],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: "completed",
    usage: {
      input_tokens: 11,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 3,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 14,
    },
  };
}

/**
 * A network sink stand-in: every provider method records that it was reached
 * and exactly which bytes it was handed. A passing egress gate contract keeps
 * this list empty, which is the only assertion that survives refactoring of
 * the individual call sites.
 */
function recordingClient(options?: {
  inputTokens?: number;
  countError?: unknown;
  streamEvents?: unknown[];
  nonStreamResponse?: unknown;
}) {
  const calls: ProviderCallRecord[] = [];
  const count = vi.fn((...args: unknown[]) => {
    calls.push({
      method: "responses.inputTokens.count",
      serializedArgs: serializeArgs(args),
    });
    if (options?.countError !== undefined) {
      return { withResponse: vi.fn().mockRejectedValue(options.countError) };
    }
    return apiResult(
      {
        object: "response.input_tokens",
        input_tokens: options?.inputTokens ?? 11,
      },
      "req_egress_count",
    );
  });
  const create = vi.fn((...args: unknown[]) => {
    calls.push({
      method: "responses.create",
      serializedArgs: serializeArgs(args),
    });
    if (options?.nonStreamResponse !== undefined) {
      return apiResult(options.nonStreamResponse, "req_egress_create");
    }
    return apiResult(
      streamOf(
        options?.streamEvents ?? [
          { type: "response.completed", response: completedResponse() },
        ],
      ),
      "req_egress_create",
    );
  });
  return {
    client: {
      responses: { create, inputTokens: { count } },
    } as unknown as OpenAI,
    calls,
    count,
    create,
  };
}

function expectNoSyntheticMarkerReachedProvider(calls: ProviderCallRecord[]): void {
  for (const call of calls) {
    expect(call.serializedArgs).not.toContain(SYNTHETIC_PRIVATE_MARKER);
    expect(call.serializedArgs).not.toContain(SYNTHETIC_SYSTEM_MARKER);
  }
}

/** microtask와 macrotask를 함께 비워 대기 중인 gate 상태를 관찰한다. */
function flushPendingWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class SyntheticEgressGateError extends Error {
  constructor() {
    super("[synthetic] provider egress gate denied");
    this.name = "SyntheticEgressGateError";
  }
}

describe("provider all-egress gate (P0-5)", () => {
  beforeEach(() => {
    logSpy.mockClear();
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.AMORA_OPENAI_ENABLED;
    else process.env.AMORA_OPENAI_ENABLED = originalEnabled;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  describe("chatWithToolsStream", () => {
    it("never counts input tokens when the provider egress gate fails", async () => {
      const { client, count } = recordingClient();
      const beforeProviderEgress = vi.fn().mockRejectedValue(
        new SyntheticEgressGateError(),
      );

      await expect(chatWithToolsStream({
        tools: [],
        beforeProviderEgress,
        beforeGeneration: vi.fn(),
        client,
      })).rejects.toBeInstanceOf(SyntheticEgressGateError);

      expect(beforeProviderEgress).toHaveBeenCalledTimes(1);
      expect(count).not.toHaveBeenCalled();
    });

    it("never starts generation when the provider egress gate fails", async () => {
      const { client, create } = recordingClient();
      const beforeGeneration = vi.fn();

      await expect(chatWithToolsStream({
        tools: [],
        beforeProviderEgress: vi.fn().mockRejectedValue(new SyntheticEgressGateError()),
        beforeGeneration,
        client,
      })).rejects.toBeInstanceOf(SyntheticEgressGateError);

      expect(create).not.toHaveBeenCalled();
      // 유료 생성 게이트는 egress가 막힌 턴에서 예약을 소비하지 않는다.
      expect(beforeGeneration).not.toHaveBeenCalled();
    });

    it("hands no synthetic marker to any provider method when the gate fails", async () => {
      const { client, calls } = recordingClient();

      await expect(chatWithToolsStream({
        tools: [],
        beforeProviderEgress: vi.fn().mockRejectedValue(new SyntheticEgressGateError()),
        beforeGeneration: vi.fn(),
        client,
      })).rejects.toBeInstanceOf(SyntheticEgressGateError);

      expect(calls).toEqual([]);
      expectNoSyntheticMarkerReachedProvider(calls);
    });

    it("fails closed with the gate's own error instead of a silent fallback", async () => {
      const { client } = recordingClient();
      const denial = new SyntheticEgressGateError();

      await expect(chatWithToolsStream({
        tools: [],
        beforeProviderEgress: vi.fn().mockRejectedValue(denial),
        beforeGeneration: vi.fn(),
        client,
      })).rejects.toBe(denial);
    });

    it("runs the egress gate before counting and keeps the quota gate immediately before create", async () => {
      const order: string[] = [];
      const { client, count, create } = recordingClient();
      count.mockImplementation(() => {
        order.push("count");
        return apiResult(
          { object: "response.input_tokens", input_tokens: 11 },
          "req_egress_count",
        );
      });
      create.mockImplementation(() => {
        order.push("create");
        return apiResult(
          streamOf([{ type: "response.completed", response: completedResponse() }]),
          "req_egress_create",
        );
      });

      await chatWithToolsStream({
        tools: [],
        beforeProviderEgress: vi.fn(async () => {
          order.push("egress_gate");
        }),
        beforeGeneration: vi.fn(async () => {
          order.push("before_generation");
        }),
        client,
      });

      expect(order).toEqual([
        "egress_gate",
        "count",
        "before_generation",
        "egress_gate",
        "create",
      ]);
    });

    it("awaits a pending egress gate before issuing any provider request", async () => {
      const { client, count, create } = recordingClient();
      let releaseGate: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      const pending = chatWithToolsStream({
        tools: [],
        beforeProviderEgress: vi.fn(() => gate),
        beforeGeneration: vi.fn(),
        client,
      });

      await flushPendingWork();
      expect(count).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();

      releaseGate?.();
      await pending;
      expect(count).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("does not reach the egress gate or the provider when the signal is already aborted", async () => {
      const { client, calls } = recordingClient();
      const controller = new AbortController();
      controller.abort();
      const beforeProviderEgress = vi.fn();

      await expect(chatWithToolsStream({
        tools: [],
        signal: controller.signal,
        beforeProviderEgress,
        beforeGeneration: vi.fn(),
        client,
      })).rejects.toMatchObject({ name: "AbortError" });

      expect(beforeProviderEgress).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    // 2026-08-05 계약 변경: egress gate는 optional이 아니라 필수다. 이전에는
    // "gate를 안 넘기면 기존 count → beforeGeneration → create 순서가 유지된다"가
    // 계약이었지만, 그 계약이 곧 P0-5의 구멍이었다 — 넘기지 않은 gate는 열린
    // gate와 같다. 아래 두 테스트가 그 두 역할을 분리해 고정한다.
    //   1) egress gate: 개인정보·kill-switch. 모든 provider 요청보다 앞선다.
    //   2) beforeGeneration: 유료 생성 직전의 원자적 quota 예약. count 뒤에 남는다.
    it("fails closed with zero provider requests when no egress gate is supplied", async () => {
      const { client, calls } = recordingClient();
      const beforeGeneration = vi.fn();

      await expect(
        rawChatWithToolsStream({
          maxInputTokens: 64_000,
          systemPrompt: SYNTHETIC_SYSTEM_MARKER,
          input: SYNTHETIC_PRIVATE_MARKER,
          tools: [],
          beforeGeneration,
          client,
        } as unknown as Parameters<typeof rawChatWithToolsStream>[0]),
      ).rejects.toThrow(/beforeProviderEgress/u);

      expect(calls).toEqual([]);
      expectNoSyntheticMarkerReachedProvider(calls);
      expect(beforeGeneration).not.toHaveBeenCalled();
    });

    it("keeps beforeGeneration between count and create once the egress gate passes", async () => {
      const order: string[] = [];
      const { client, count, create } = recordingClient();
      count.mockImplementation(() => {
        order.push("count");
        return apiResult(
          { object: "response.input_tokens", input_tokens: 11 },
          "req_egress_count",
        );
      });
      create.mockImplementation(() => {
        order.push("create");
        return apiResult(
          streamOf([{ type: "response.completed", response: completedResponse() }]),
          "req_egress_create",
        );
      });

      await chatWithToolsStream({
        tools: [],
        beforeProviderEgress: vi.fn(),
        beforeGeneration: vi.fn(async () => {
          order.push("before_generation");
        }),
        client,
      });

      expect(order).toEqual(["count", "before_generation", "create"]);
    });

    it("still blocks an oversized counted input after the egress gate passes", async () => {
      const { client, create } = recordingClient({ inputTokens: 100_001 });
      const beforeGeneration = vi.fn();
      const beforeProviderEgress = vi.fn();

      await expect(chatWithToolsStream({
        tools: [],
        maxInputTokens: 100_000,
        beforeProviderEgress,
        beforeGeneration,
        client,
      })).rejects.toBeInstanceOf(OpenAIInputTokenLimitError);

      expect(beforeProviderEgress).toHaveBeenCalledTimes(1);
      expect(beforeGeneration).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("still proceeds when the input pre-count is unavailable after the egress gate passes", async () => {
      const countError = Object.assign(new Error("count service unavailable"), {
        status: 503,
        requestID: "req_egress_count_503",
        code: "server_error",
      });
      const { client, create } = recordingClient({ countError });
      const beforeProviderEgress = vi.fn();
      const beforeGeneration = vi.fn();

      const result = await chatWithToolsStream({
        tools: [],
        beforeProviderEgress,
        beforeGeneration,
        client,
      });

      expect(beforeProviderEgress).toHaveBeenCalledTimes(2);
      expect(beforeGeneration).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(result.inputCountUnavailableReason).toBe("server_error");
    });

    it("still blocks generation when the quota gate fails after the egress gate passes", async () => {
      const quotaError = new Error("quota reservation unavailable");
      const { client, create } = recordingClient();
      const beforeProviderEgress = vi.fn();

      await expect(chatWithToolsStream({
        tools: [],
        beforeProviderEgress,
        beforeGeneration: vi.fn().mockRejectedValue(quotaError),
        client,
      })).rejects.toBe(quotaError);

      expect(beforeProviderEgress).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    });

    it("revalidates privacy after input counting and blocks generation when revocation wins", async () => {
      const { client, count, create } = recordingClient();
      const revocation = new SyntheticEgressGateError();
      const beforeProviderEgress = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(revocation);

      await expect(chatWithToolsStream({
        tools: [],
        beforeProviderEgress,
        beforeGeneration: vi.fn(),
        client,
      })).rejects.toBe(revocation);

      expect(count).toHaveBeenCalledTimes(1);
      expect(beforeProviderEgress).toHaveBeenCalledTimes(2);
      expect(create).not.toHaveBeenCalled();
    });

    it("binds each streaming authorization to its exact provider operation and content", async () => {
      const { client } = recordingClient();
      const beforeProviderEgress = vi.fn();

      await chatWithToolsStream({
        tools: [],
        beforeProviderEgress,
        beforeGeneration: vi.fn(),
        client,
      });

      expect(beforeProviderEgress.mock.calls).toEqual([
        [{
          operation: "responses.input_tokens.count",
          contentBinding: expect.stringMatching(/^[0-9a-f]{64}$/),
        }],
        [{
          operation: "responses.create",
          contentBinding: expect.stringMatching(/^[0-9a-f]{64}$/),
        }],
      ]);
      expect(beforeProviderEgress.mock.calls[0]?.[0]?.contentBinding).not.toBe(
        beforeProviderEgress.mock.calls[1]?.[0]?.contentBinding,
      );
      expect(JSON.stringify(beforeProviderEgress.mock.calls)).not.toContain(
        SYNTHETIC_PRIVATE_MARKER,
      );
    });
  });

  describe("createOpenAIResponseWithAudit", () => {
    it("never counts input tokens or starts generation when the egress gate fails", async () => {
      const { client, calls } = recordingClient({
        nonStreamResponse: completedResponse(),
      });
      const beforeGeneration = vi.fn();
      const denial = new SyntheticEgressGateError();

      await expect(createOpenAIResponseWithAudit({
        modelRole: "fast",
        instructions: SYNTHETIC_SYSTEM_MARKER,
        input: SYNTHETIC_PRIVATE_MARKER,
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeProviderEgress: vi.fn().mockRejectedValue(denial),
        beforeGeneration,
        client,
        audit: { interactionType: "chat_turn" },
      })).rejects.toBe(denial);

      expect(calls).toEqual([]);
      expectNoSyntheticMarkerReachedProvider(calls);
      expect(beforeGeneration).not.toHaveBeenCalled();
    });

    it("writes a content-free audit row proving no provider request was attempted", async () => {
      const { client } = recordingClient({ nonStreamResponse: completedResponse() });

      await expect(createOpenAIResponseWithAudit({
        modelRole: "fast",
        instructions: SYNTHETIC_SYSTEM_MARKER,
        input: SYNTHETIC_PRIVATE_MARKER,
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeProviderEgress: vi.fn().mockRejectedValue(new SyntheticEgressGateError()),
        beforeGeneration: vi.fn(),
        client,
        audit: { interactionType: "chat_turn" },
      })).rejects.toBeInstanceOf(SyntheticEgressGateError);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        errorMessage: "provider_egress_gate_failed",
        userInput: null,
        aiOutput: null,
        toolInput: null,
        toolOutput: null,
        tokensInput: null,
        tokensOutput: null,
        metadata: expect.objectContaining({
          provider_attempted: false,
          unknown_paid_attempt: false,
          provider_request_id: null,
          // count 자체가 일어나지 않았으므로 count receipt도 없어야 한다.
          input_count_request_id: null,
        }),
      }));
    });

    it("runs egress gate → count → reservation hook → create when the gate passes", async () => {
      const order: string[] = [];
      const { client, count, create } = recordingClient({
        nonStreamResponse: completedResponse(),
      });
      count.mockImplementation(() => {
        order.push("count");
        return apiResult(
          { object: "response.input_tokens", input_tokens: 11 },
          "req_egress_count",
        );
      });
      create.mockImplementation(() => {
        order.push("create");
        return apiResult(completedResponse(), "req_egress_create");
      });

      await createOpenAIResponseWithAudit({
        modelRole: "fast",
        instructions: SYNTHETIC_SYSTEM_MARKER,
        input: SYNTHETIC_PRIVATE_MARKER,
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeProviderEgress: vi.fn(async () => {
          order.push("egress_gate");
        }),
        beforeGeneration: vi.fn(async () => {
          order.push("hook");
        }),
        client,
        audit: { interactionType: "chat_turn" },
      });

      expect(order).toEqual([
        "egress_gate",
        "count",
        "hook",
        "egress_gate",
        "create",
      ]);
    });

    it("fails closed with zero provider requests when no egress gate is supplied", async () => {
      const { client, calls } = recordingClient({
        nonStreamResponse: completedResponse(),
      });
      const beforeGeneration = vi.fn();

      await expect(
        createOpenAIResponseWithAudit({
          modelRole: "fast",
          instructions: SYNTHETIC_SYSTEM_MARKER,
          input: SYNTHETIC_PRIVATE_MARKER,
          maxInputTokens: 64_000,
          maxOutputTokens: 100,
          beforeGeneration,
          client,
          audit: { interactionType: "chat_turn" },
        } as unknown as Parameters<typeof createOpenAIResponseWithAudit>[0]),
      ).rejects.toThrow(/beforeProviderEgress/u);

      expect(calls).toEqual([]);
      expectNoSyntheticMarkerReachedProvider(calls);
      expect(beforeGeneration).not.toHaveBeenCalled();
    });

    it("keeps the reservation hook between count and create once the egress gate passes", async () => {
      const order: string[] = [];
      const { client, count, create } = recordingClient({
        nonStreamResponse: completedResponse(),
      });
      count.mockImplementation(() => {
        order.push("count");
        return apiResult(
          { object: "response.input_tokens", input_tokens: 11 },
          "req_egress_count",
        );
      });
      create.mockImplementation(() => {
        order.push("create");
        return apiResult(completedResponse(), "req_egress_create");
      });

      await createOpenAIResponseWithAudit({
        modelRole: "fast",
        instructions: SYNTHETIC_SYSTEM_MARKER,
        input: SYNTHETIC_PRIVATE_MARKER,
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeProviderEgress: vi.fn(),
        beforeGeneration: vi.fn(async () => {
          order.push("hook");
        }),
        client,
        audit: { interactionType: "chat_turn" },
      });

      expect(order).toEqual(["count", "hook", "create"]);
    });

    it("gates the structured-output path on the same provider egress gate", async () => {
      const { client, calls } = recordingClient({
        nonStreamResponse: completedResponse('{"ok":true}'),
      });
      const denial = new SyntheticEgressGateError();

      await expect(createOpenAIStructuredResponseWithAudit({
        modelRole: "fast",
        instructions: SYNTHETIC_SYSTEM_MARKER,
        input: SYNTHETIC_PRIVATE_MARKER,
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeProviderEgress: vi.fn().mockRejectedValue(denial),
        beforeGeneration: vi.fn(),
        client,
        audit: { interactionType: "chat_turn" },
        responseFormat: {
          name: "egress_gate_probe",
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
        validate: (value) => value as { ok: boolean },
      })).rejects.toBe(denial);

      expect(calls).toEqual([]);
      expectNoSyntheticMarkerReachedProvider(calls);
    });

    it("revalidates an audited generation after counting and blocks it when revocation wins", async () => {
      const { client, count, create } = recordingClient({
        nonStreamResponse: completedResponse(),
      });
      const revocation = new SyntheticEgressGateError();
      const beforeProviderEgress = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(revocation);

      await expect(createOpenAIResponseWithAudit({
        modelRole: "fast",
        instructions: SYNTHETIC_SYSTEM_MARKER,
        input: SYNTHETIC_PRIVATE_MARKER,
        maxInputTokens: 64_000,
        maxOutputTokens: 100,
        beforeProviderEgress,
        beforeGeneration: vi.fn(),
        client,
        audit: { interactionType: "chat_turn" },
      })).rejects.toBe(revocation);

      expect(count).toHaveBeenCalledTimes(1);
      expect(beforeProviderEgress).toHaveBeenCalledTimes(2);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
