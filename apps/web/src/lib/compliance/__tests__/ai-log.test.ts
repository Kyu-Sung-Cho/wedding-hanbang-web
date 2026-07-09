import { describe, expect, it } from "vitest";
import { calcCostUsd } from "../ai-log";

describe("calcCostUsd", () => {
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
