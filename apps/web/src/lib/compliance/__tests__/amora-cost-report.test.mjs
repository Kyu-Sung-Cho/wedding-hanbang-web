import { describe, expect, it } from "vitest";
import { classifyUsageRow } from "../../../../../../scripts/amora-cost-report-logic.mjs";

describe("Amora cost report usage classification", () => {
  it("does not report deterministic or non-provider rows as unknown paid attempts", () => {
    expect(classifyUsageRow({
      model: "deterministic-price-benchmark-v1",
      tokens_input: null,
      tokens_output: null,
      metadata: {},
    })).toEqual({
      providerModel: false,
      providerAttempted: false,
      usageUnknown: false,
      unknownPriceEligible: false,
    });
  });

  it("reports provider attempts with missing or explicit unknown usage", () => {
    expect(classifyUsageRow({
      model: "gpt-5.6-luna",
      tokens_input: null,
      tokens_output: null,
      metadata: {},
    }).usageUnknown).toBe(true);
    expect(classifyUsageRow({
      model: "gpt-5.6-terra",
      tokens_input: 100,
      tokens_output: 20,
      metadata: { usage_status: "unknown" },
    }).usageUnknown).toBe(true);
  });

  it("does not turn a pre-provider kill-switch rejection into a paid attempt", () => {
    expect(classifyUsageRow({
      model: "gpt-5.6-luna",
      tokens_input: null,
      tokens_output: null,
      metadata: {
        provider_attempted: false,
        usage_status: "complete",
        unknown_paid_attempt: false,
      },
    })).toEqual({
      providerModel: true,
      providerAttempted: false,
      usageUnknown: false,
      unknownPriceEligible: false,
    });
  });

  it("allows a complete provider row to enter known-cost pricing", () => {
    expect(classifyUsageRow({
      model: "gpt-5.6-luna",
      tokens_input: 100,
      tokens_output: 20,
      metadata: { usage_status: "complete" },
    })).toEqual({
      providerModel: true,
      providerAttempted: true,
      usageUnknown: false,
      unknownPriceEligible: true,
    });
  });
});
