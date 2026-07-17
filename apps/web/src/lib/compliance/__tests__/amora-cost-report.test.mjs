import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { classifyUsageRow } from "../../../../../../scripts/amora-cost-report-logic.mjs";
import {
  calcModelCostUsd,
  MODEL_PRICING_CATALOG,
} from "../../../../../../scripts/amora-model-pricing.mjs";

const webRoot = existsSync(resolve(process.cwd(), "src/lib/compliance/ai-log.ts"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");
const repositoryRoot = resolve(webRoot, "../..");

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
      ledgerPrepared: false,
      reconciliationRequired: false,
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
      ledgerPrepared: false,
      reconciliationRequired: false,
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
      ledgerPrepared: false,
      reconciliationRequired: false,
      usageUnknown: false,
      unknownPriceEligible: true,
    });
  });
});

describe("Amora cost report pricing", () => {
  it("prices Luna and Terra from the shared catalog", () => {
    expect(calcModelCostUsd({
      model: "gpt-5.6-luna",
      tokensInput: 100_000,
      tokensOutput: 100_000,
    })).toBeCloseTo(0.7, 6);
    expect(calcModelCostUsd({
      model: "gpt-5.6-terra",
      tokensInput: 100_000,
      tokensOutput: 100_000,
    })).toBeCloseTo(1.75, 6);
  });

  it("tracks the verified GPT-5.6 long-context multiplier for both active models", () => {
    expect(MODEL_PRICING_CATALOG.sources.openai.checkedAt).toBe("2026-07-16");
    expect(MODEL_PRICING_CATALOG.sources.openai.url)
      .toBe("https://developers.openai.com/api/docs/pricing");
    expect(MODEL_PRICING_CATALOG.models["gpt-5.6-luna"].longContext)
      .toMatchObject({ inputTokenThresholdExclusive: 272_000, input: 2, output: 9 });
    expect(MODEL_PRICING_CATALOG.models["gpt-5.6-terra"].longContext)
      .toMatchObject({ inputTokenThresholdExclusive: 272_000, input: 5, output: 22.5 });
    expect(calcModelCostUsd({
      model: "gpt-5.6-terra",
      tokensInput: 300_000,
      tokensOutput: 100_000,
    })).toBeCloseTo(3.75, 6);
  });

  it("prints CLI help without credentials or network access", () => {
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/amora-cost-report.mjs"), "--", "--help"],
      { cwd: repositoryRoot, env, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: pnpm amora:costs");
    expect(result.stderr).toBe("");
  });

  it("keeps the web ledger and CLI on one versioned pricing catalog", () => {
    const webLedger = readFileSync(resolve(webRoot, "src/lib/compliance/ai-log.ts"), "utf8");
    const report = readFileSync(resolve(repositoryRoot, "scripts/amora-cost-report.mjs"), "utf8");

    expect(webLedger).toContain("amora-model-pricing.json");
    expect(report).toContain("amora-model-pricing.mjs");
    expect(webLedger).not.toMatch(/["']gpt-5\.6-(?:luna|terra)["']\s*:/);
    expect(report).not.toMatch(/["']gpt-5\.6-(?:luna|terra)["']\s*:/);
  });

  it("treats a durable prepared receipt as unknown exposure requiring reconciliation", () => {
    expect(classifyUsageRow({
      model: "gpt-5.6-luna",
      tokens_input: null,
      tokens_output: null,
      metadata: {
        ledger_status: "prepared",
        provider_attempted: false,
        usage_status: "unknown",
      },
    })).toEqual({
      providerModel: true,
      providerAttempted: false,
      ledgerPrepared: true,
      reconciliationRequired: true,
      usageUnknown: true,
      unknownPriceEligible: false,
    });
  });
});
