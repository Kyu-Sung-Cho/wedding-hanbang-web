import { describe, expect, it } from "vitest";
import { calcCostUsd } from "../ai-log";

describe("calcCostUsd", () => {
  it("uses current GPT-5.6 Luna and Terra standard pricing", () => {
    expect(calcCostUsd("gpt-5.6-luna", 100_000, 100_000)).toBeCloseTo(0.14, 6);
    expect(calcCostUsd("gpt-5.6-terra", 100_000, 100_000)).toBeCloseTo(1.4, 6);
  });

  it("does not double-charge OpenAI cached tokens already included in input_tokens", () => {
    const cost = calcCostUsd(
      "gpt-5.6-luna",
      200_000,
      100_000,
      10_000,
      20_000
    );
    expect(cost).toBeCloseTo(0.1569, 6);
  });

  it("applies GPT-5.6 request-wide long-context pricing above 272K input tokens", () => {
    expect(calcCostUsd("gpt-5.6-luna", 300_000, 100_000)).toBeCloseTo(0.3, 6);
  });

  it.each([
    ["gpt-5.6-luna", 272_000, 0.1744],
    ["gpt-5.6-luna", 272_001, 0.2888004],
    ["gpt-5.6-terra", 272_000, 1.744],
    ["gpt-5.6-terra", 272_001, 2.888004],
  ] as const)("preserves the request-wide threshold for %s at %i input tokens", (model, input, expected) => {
    expect(calcCostUsd(model, input, 100_000)).toBeCloseTo(expected, 9);
  });

  it.each([
    ["gpt-5.6-luna", 0.00122, 0.0014, 0.2938],
    ["gpt-5.6-terra", 0.0122, 0.014, 2.938],
  ] as const)("keeps cache counts bounded and priced once for %s", (model, allRead, uncached, longMixed) => {
    expect(calcCostUsd(model, 1_000, 1_000, 2_000, 2_000)).toBeCloseTo(allRead, 9);
    expect(calcCostUsd(model, 1_000, 1_000, -1_000, -1_000)).toBeCloseTo(uncached, 9);
    expect(calcCostUsd(model, 300_000, 100_000, 10_000, 20_000)).toBeCloseTo(longMixed, 9);
  });

  it("uses current Haiku 4.5 pricing including prompt cache tokens", () => {
    const cost = calcCostUsd(
      "claude-haiku-4-5-20251001",
      1_000_000,
      1_000_000,
      1_000_000,
      1_000_000
    );

    expect(cost).toBeCloseTo(7.35, 6);
  });

  it("uses current Opus 4.7 pricing instead of legacy Opus 4.1 pricing", () => {
    const opus47 = calcCostUsd("claude-opus-4-7", 1_000_000, 1_000_000);
    const opus41 = calcCostUsd("claude-opus-4-1", 1_000_000, 1_000_000);

    expect(opus47).toBeCloseTo(30, 6);
    expect(opus41).toBeCloseTo(90, 6);
  });

  it("returns null when the model is not priced", () => {
    expect(calcCostUsd("deterministic-price-benchmark-v1", 1_000, 1_000)).toBeNull();
  });
});
