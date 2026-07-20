import { estimateExtractionCostUsd } from "./ledger.js";
import type { ExtractionModel } from "./extraction-contract.js";

export const MAX_FIXED_EIGHT_APPROVED_COST_USD = 20;
export const MAX_FIXED_EIGHT_ABSOLUTE_COST_NANO_USD = 20_000_000_000;
export const PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH = 4;
// Deliberately conservative cost-reservation bound: use the whole documented
// 1.05M context window as input even though the current Luna/Terra model pages
// document a lower 922k max input. This is not a literal provider input limit.
export const PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND = 1_050_000;
export const PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP = 16_000;
export const NANO_USD_PER_USD = 1_000_000_000;

function assertUsd(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("paid_extraction_cost_must_be_finite_and_nonnegative");
  }
}

export function costUsdToNanoUsdCeil(value: number): number {
  assertUsd(value);
  const nanoUsd = Math.ceil(value * NANO_USD_PER_USD);
  if (!Number.isSafeInteger(nanoUsd)) {
    throw new Error("paid_extraction_cost_exceeds_safe_nano_usd_range");
  }
  return nanoUsd;
}

export function limitUsdToNanoUsdFloor(value: number): number {
  assertUsd(value);
  const nanoUsd = Math.floor(value * NANO_USD_PER_USD);
  if (!Number.isSafeInteger(nanoUsd)) {
    throw new Error("paid_extraction_limit_exceeds_safe_nano_usd_range");
  }
  return nanoUsd;
}

export function nanoUsdToUsd(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("paid_extraction_nano_usd_must_be_a_nonnegative_safe_integer");
  }
  return value / NANO_USD_PER_USD;
}

export function providerBoundReservation(model: ExtractionModel): {
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumCostUsd: number;
  maximumCostNanoUsd: number;
} {
  const maximumCostUsd = estimateExtractionCostUsd(
    model,
    PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
    PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  );
  return {
    maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
    maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
    maximumCostUsd,
    maximumCostNanoUsd: costUsdToNanoUsdCeil(maximumCostUsd),
  };
}
