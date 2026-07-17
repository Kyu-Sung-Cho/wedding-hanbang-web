import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function resolvePricingPath() {
  const candidates = [
    resolve(process.cwd(), "config/amora-model-pricing.json"),
    resolve(process.cwd(), "../../config/amora-model-pricing.json"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Cannot locate config/amora-model-pricing.json");
  return found;
}

export const MODEL_PRICING_CATALOG = JSON.parse(
  readFileSync(resolvePricingPath(), "utf8"),
);

function isNonNegativeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function assertRate(rate, label) {
  for (const field of ["input", "output", "cacheWrite", "cacheRead"]) {
    if (!isNonNegativeFiniteNumber(rate?.[field])) {
      throw new Error(`Invalid ${label}.${field} in amora-model-pricing.json`);
    }
  }
}

function validateCatalog(catalog) {
  if (
    catalog?.schemaVersion !== 1
    || catalog?.currency !== "USD"
    || catalog?.unit !== "per_million_tokens"
    || !catalog.models
    || typeof catalog.models !== "object"
  ) {
    throw new Error("Invalid amora-model-pricing.json catalog header");
  }
  for (const [model, price] of Object.entries(catalog.models)) {
    if (price?.provider !== "openai" && price?.provider !== "anthropic") {
      throw new Error(`Invalid ${model}.provider in amora-model-pricing.json`);
    }
    assertRate(price, model);
    if (price.longContext !== undefined) {
      if (!Number.isSafeInteger(price.longContext.inputTokenThresholdExclusive)
        || price.longContext.inputTokenThresholdExclusive < 0) {
        throw new Error(`Invalid ${model}.longContext threshold in amora-model-pricing.json`);
      }
      assertRate(price.longContext, `${model}.longContext`);
    }
  }
}

validateCatalog(MODEL_PRICING_CATALOG);

export function findModelPricing(model) {
  if (typeof model !== "string" || model.length === 0) return null;
  const key = Object.keys(MODEL_PRICING_CATALOG.models)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => model.startsWith(candidate));
  return key ? { key, price: MODEL_PRICING_CATALOG.models[key] } : null;
}

export function calcModelCostUsd({
  model,
  tokensInput,
  tokensOutput,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
}) {
  if (!isNonNegativeFiniteNumber(tokensInput) || !isNonNegativeFiniteNumber(tokensOutput)) {
    return null;
  }
  const matched = findModelPricing(model);
  if (!matched) return null;
  const { price } = matched;
  const rate = price.longContext
    && tokensInput > price.longContext.inputTokenThresholdExclusive
    ? price.longContext
    : price;
  const cacheWrite = isNonNegativeFiniteNumber(cacheCreationTokens)
    ? cacheCreationTokens
    : 0;
  const cacheRead = isNonNegativeFiniteNumber(cacheReadTokens)
    ? cacheReadTokens
    : 0;

  if (price.provider === "openai") {
    const boundedRead = Math.min(cacheRead, tokensInput);
    const boundedWrite = Math.min(cacheWrite, Math.max(tokensInput - boundedRead, 0));
    const uncached = Math.max(tokensInput - boundedRead - boundedWrite, 0);
    return (
      uncached * rate.input
      + boundedWrite * rate.cacheWrite
      + boundedRead * rate.cacheRead
      + tokensOutput * rate.output
    ) / 1_000_000;
  }

  return (
    tokensInput * rate.input
    + tokensOutput * rate.output
    + cacheWrite * rate.cacheWrite
    + cacheRead * rate.cacheRead
  ) / 1_000_000;
}
