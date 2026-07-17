import type OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildToolResultInput,
  chatWithToolsStream as rawChatWithToolsStream,
  normalizeResponseUsage,
} from "../openai";

type ChatWithToolsOptions = Parameters<typeof rawChatWithToolsStream>[0];

function chatWithToolsStream(
  options: Omit<ChatWithToolsOptions, "maxInputTokens"> & {
    maxInputTokens?: number;
  },
) {
  return rawChatWithToolsStream({
    maxInputTokens: 64_000,
    ...options,
  });
}

const originalEnabled = process.env.AMORA_OPENAI_ENABLED;
const originalApiKey = process.env.OPENAI_API_KEY;

const UPDATE_BUDGET_TOOL = {
  name: "update_budget",
  description: "Update the total budget",
  input_schema: {
    type: "object",
    properties: { total_budget: { type: "number" } },
    required: ["total_budget"],
  },
};

function completedResponse(output: unknown[]): OpenAIResponse {
  return {
    id: "resp_boundary",
    created_at: 0,
    output_text: "",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "gpt-5.6-luna",
    object: "response",
    output,
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: "completed",
    usage: {
      input_tokens: 10,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 12,
    },
  } as unknown as OpenAIResponse;
}

function clientFor(response: OpenAIResponse): OpenAI {
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield { type: "response.completed", sequence_number: 0, response };
    },
  };
  return {
    responses: {
      create: vi.fn(() => ({
        withResponse: vi.fn(async () => ({
          data: stream,
          response: new Response(),
          request_id: "req_boundary",
        })),
      })),
      inputTokens: {
        count: vi.fn(() => ({
          withResponse: vi.fn(async () => ({
            data: { object: "response.input_tokens", input_tokens: 1 },
            response: new Response(),
            request_id: "req_boundary_count",
          })),
        })),
      },
    },
  } as unknown as OpenAI;
}

function functionCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "fc_boundary",
    type: "function_call",
    call_id: "call_boundary",
    name: "update_budget",
    arguments: '{"total_budget":30000000}',
    status: "completed",
    ...overrides,
  };
}

describe("OpenAI Responses boundary helpers", () => {
  beforeEach(() => {
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-fixture.local-0123456789abcdef";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.AMORA_OPENAI_ENABLED;
    else process.env.AMORA_OPENAI_ENABLED = originalEnabled;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("maps billed input, output, cache-write, and cache-read usage fields", () => {
    const response = {
      usage: {
        input_tokens: 101,
        input_tokens_details: {
          cache_write_tokens: 23,
          cached_tokens: 45,
        },
        output_tokens: 67,
        output_tokens_details: { reasoning_tokens: 11 },
        total_tokens: 168,
      },
    } as OpenAIResponse;

    expect(normalizeResponseUsage(response)).toEqual({
      input_tokens: 101,
      output_tokens: 67,
      cache_write_input_tokens: 23,
      cache_read_input_tokens: 45,
    });
  });

  it("correlates a function result with the exact provider call_id", () => {
    expect(buildToolResultInput("call_123", JSON.stringify({ success: true }))).toEqual({
      type: "function_call_output",
      call_id: "call_123",
      output: '{"success":true}',
    });
  });

  it.each([
    ["non-completed status", { status: "in_progress" }, "invalid_function_call_status"],
    ["empty call id", { call_id: "" }, "invalid_function_call_id"],
    ["oversized call id", { call_id: "x".repeat(129) }, "invalid_function_call_id"],
    ["undeclared tool name", { name: "delete_everything" }, "invalid_function_call_name"],
  ])("fails closed on a function call with %s", async (_label, overrides, providerCode) => {
    const response = completedResponse([functionCall(overrides)]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [{ role: "user", content: "예산 변경" }],
      tools: [UPDATE_BUDGET_TOOL],
      beforeGeneration: vi.fn(),
      client: clientFor(response),
    })).rejects.toMatchObject({
      category: "response_invalid",
      providerCode,
      usageStatus: "complete",
      requestId: "req_boundary",
      responseId: "resp_boundary",
    });
  });

  it("rejects a provider call_id that was already completed in prior stateless input", async () => {
    const priorCall = functionCall({ id: "fc_prior", call_id: "call_reused" });
    const priorOutput = buildToolResultInput("call_reused", '{"success":true}');
    const response = completedResponse([
      functionCall({ id: "fc_current", call_id: "call_reused" }),
    ]);

    await expect(chatWithToolsStream({
      systemPrompt: "system",
      input: [priorCall, priorOutput] as never,
      tools: [UPDATE_BUDGET_TOOL],
      beforeGeneration: vi.fn(),
      client: clientFor(response),
    })).rejects.toMatchObject({
      category: "response_invalid",
      providerCode: "duplicate_function_call_id",
      usageStatus: "complete",
    });
  });
});
