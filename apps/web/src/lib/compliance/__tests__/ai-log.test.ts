import { describe, expect, it } from "vitest";
import { calcCostUsd, sanitizeAIErrorCode } from "../ai-log";

describe("calcCostUsd", () => {
  it("prices OpenAI cached input without double charging total input tokens", () => {
    const cost = calcCostUsd(
      "gpt-5.4-mini-2026-03-17",
      1_000_000,
      1_000_000,
      0,
      400_000
    );

    expect(cost).toBeCloseTo(4.98, 6);
  });

  it("matches the longest OpenAI model prefix", () => {
    const mini = calcCostUsd("gpt-5.4-mini-2026-03-17", 1_000_000, 1_000_000);
    const full = calcCostUsd("gpt-5.4-2026-03-05", 1_000_000, 1_000_000);

    expect(mini).toBeCloseTo(5.25, 6);
    expect(full).toBeCloseTo(27.5, 6);
  });

  it("keeps historical Claude pricing for existing audit rows", () => {
    const historical = calcCostUsd(
      "claude-haiku-4-5-20251001",
      1_000_000,
      1_000_000,
      1_000_000,
      1_000_000
    );

    expect(historical).toBeCloseTo(7.35, 6);
  });

  it("prices Terra cache writes and reads without double charging input", () => {
    const cost = calcCostUsd(
      "gpt-5.6-terra",
      200_000,
      100_000,
      40_000,
      80_000
    );

    expect(cost).toBeCloseTo(1.845, 6);
  });

  it("uses Luna long-context pricing for inputs over 272K tokens", () => {
    const cost = calcCostUsd("gpt-5.6-luna", 300_000, 100_000);

    expect(cost).toBeCloseTo(1.5, 6);
  });

  it("returns null when the model is not priced", () => {
    expect(calcCostUsd("deterministic-price-benchmark-v1", 1_000, 1_000)).toBeNull();
  });
});

describe("sanitizeAIErrorCode", () => {
  it("keeps reviewed categories but never persists free-text provider or user data", () => {
    expect(
      sanitizeAIErrorCode("provider_request_failed:name_APIError:status_429")
    ).toBe("provider_request_failed");
    expect(sanitizeAIErrorCode("empty_response")).toBe("empty_response");
    expect(
      sanitizeAIErrorCode("victim@example.com Failing row contains (private payload)")
    ).toBe("ai_interaction_failed");
  });
});
