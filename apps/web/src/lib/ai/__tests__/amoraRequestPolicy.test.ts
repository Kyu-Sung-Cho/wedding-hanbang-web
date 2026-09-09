import { describe, expect, it } from "vitest";
import {
  AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
  AMORA_MAX_OUTPUT_TOKENS_PER_PROVIDER_CALL,
  AMORA_MAX_PROVIDER_CALLS_PER_TURN,
  AMORA_TOTAL_REQUEST_DEADLINE_MS,
  AMORA_MAX_TEXT_ATTACHMENT_CHARS,
  AMORA_MAX_CONVERSATION_CHARS,
  AMORA_MAX_TOOL_RESULT_CHARS,
  OPENAI_LONG_CONTEXT_SURCHARGE_THRESHOLD,
  boundAmoraTextAttachments,
  boundAmoraToolResultJson,
  takeRecentAmoraConversation,
  getAmoraProviderRequestPolicy,
  getAmoraProviderCallCostReservationMicrousd,
  getAmoraTurnCostReservationMicrousd,
  blockLegacyAuxiliaryProviderGeneration,
} from "@/lib/ai/amoraRequestPolicy";
import { calcCostUsd } from "@/lib/compliance/ai-log";

describe("Amora provider request envelope", () => {
  it("requires exact counting at 64K for every one of at most three generations", () => {
    expect(AMORA_MAX_PROVIDER_CALLS_PER_TURN).toBe(3);
    expect(AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL).toBe(64_000);
    expect(AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL)
      .toBeLessThan(OPENAI_LONG_CONTEXT_SURCHARGE_THRESHOLD);
    expect(AMORA_TOTAL_REQUEST_DEADLINE_MS).toBeLessThan(180_000);
    for (let index = 1; index <= AMORA_MAX_PROVIDER_CALLS_PER_TURN; index += 1) {
      expect(getAmoraProviderRequestPolicy(index)).toEqual({
        maxInputTokens: 64_000,
        maxOutputTokens: 1_400,
        exactInputCountRequired: true,
      });
    }
  });

  it("keeps a contiguous recent conversation within the local recovery budget", () => {
    const messages = [
      { role: "user" as const, content: "old:" + "a".repeat(20_000) },
      { role: "assistant" as const, content: "middle:" + "b".repeat(20_000) },
      { role: "user" as const, content: "latest:" + "c".repeat(10_000) },
    ];

    const bounded = takeRecentAmoraConversation(messages);

    expect(bounded.at(-1)).toEqual(messages.at(-1));
    expect(bounded.reduce((sum, message) => sum + message.content.length, 0))
      .toBeLessThanOrEqual(AMORA_MAX_CONVERSATION_CHARS);
    expect(bounded.some((message) => message.content.startsWith("old:"))).toBe(false);
  });

  it("keeps the beginning and fine-print ending of long extracted documents", () => {
    const bounded = boundAmoraTextAttachments([
      "BEGIN-" + "x".repeat(40_000) + "-END",
    ]);

    expect(bounded.length).toBeLessThanOrEqual(AMORA_MAX_TEXT_ATTACHMENT_CHARS);
    expect(bounded).toContain("BEGIN-");
    expect(bounded).toContain("-END");
    expect(bounded).toContain("중간 일부 생략");
  });

  it("rejects a fourth provider generation instead of silently widening cost", () => {
    expect(() => getAmoraProviderRequestPolicy(4)).toThrow(/between 1 and 3/);
  });

  it("keeps disconnected legacy AI writers behind a paid-generation kill gate", () => {
    expect(() => blockLegacyAuxiliaryProviderGeneration())
      .toThrow(/LEGACY_AUXILIARY_PROVIDER_DISABLED/);
  });

  it("keeps oversized tool feedback valid JSON and within the provider budget", () => {
    const bounded = boundAmoraToolResultJson({
      secretLikeContent: "x".repeat(AMORA_MAX_TOOL_RESULT_CHARS * 2),
      ending: "fine-print",
    });

    expect(bounded.length).toBeLessThanOrEqual(AMORA_MAX_TOOL_RESULT_CHARS);
    expect(() => JSON.parse(bounded)).not.toThrow();
    expect(JSON.parse(bounded)).toMatchObject({ truncated: true });
    expect(bounded).toContain("fine-print");
  });

  it("fails safely when a tool result cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(JSON.parse(boundAmoraToolResultJson(circular))).toEqual({
      error_code: "TOOL_RESULT_NOT_SERIALIZABLE",
    });
  });

  it("bounds worst-case three-call cache-write cost with the versioned catalog", () => {
    const lunaPerCall = calcCostUsd(
      "gpt-5.6-luna",
      AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
      AMORA_MAX_OUTPUT_TOKENS_PER_PROVIDER_CALL,
      AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
      0,
    );
    const terraPerCall = calcCostUsd(
      "gpt-5.6-terra",
      AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
      AMORA_MAX_OUTPUT_TOKENS_PER_PROVIDER_CALL,
      AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
      0,
    );

    expect((lunaPerCall ?? 0) * AMORA_MAX_PROVIDER_CALLS_PER_TURN).toBeCloseTo(0.05304, 8);
    expect((terraPerCall ?? 0) * AMORA_MAX_PROVIDER_CALLS_PER_TURN).toBeCloseTo(0.5304, 8);
    expect(getAmoraProviderCallCostReservationMicrousd("fast")).toBe(
      Math.round((lunaPerCall ?? 0) * 1_000_000),
    );
    expect(getAmoraProviderCallCostReservationMicrousd("primary")).toBe(
      Math.round((terraPerCall ?? 0) * 1_000_000),
    );
    expect(getAmoraTurnCostReservationMicrousd("fast")).toBe(
      Math.round((lunaPerCall ?? 0) * AMORA_MAX_PROVIDER_CALLS_PER_TURN * 1_000_000),
    );
    expect(getAmoraTurnCostReservationMicrousd("primary")).toBe(
      Math.round((terraPerCall ?? 0) * AMORA_MAX_PROVIDER_CALLS_PER_TURN * 1_000_000),
    );
  });
});
