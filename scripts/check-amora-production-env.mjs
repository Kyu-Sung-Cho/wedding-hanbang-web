#!/usr/bin/env node

/**
 * Prints only release-gate booleans. Never print environment variable values.
 * This must run in the actual Vercel Production builder/runtime; local
 * `vercel env run` output is not accepted as production-environment evidence.
 */

import { verifySupabaseServiceDestinationFromEnv } from "./lib/supabase-service-destination.mjs";

const env = process.env;

function hasPinnedSupabaseDestination() {
  try {
    verifySupabaseServiceDestinationFromEnv({ env, access: "runtime" });
    return true;
  } catch {
    return false;
  }
}

function isPlausibleOpenAIKey(value) {
  return (
    typeof value === "string"
    && value.startsWith("sk-")
    && value.length >= 20
    && !/(?:placeholder|example|test-only|replace-with|not-a-real)/i.test(value)
  );
}

function isPositiveInteger(value) {
  return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
}

function isPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isPlausibleSecret(value) {
  return (
    typeof value === "string"
    && value.length >= 32
    && !/(?:placeholder|example|test-only|replace-with|not-a-real)/i.test(value)
  );
}

const checks = {
  openaiEnabledFlagPresent: Boolean(env.AMORA_OPENAI_ENABLED),
  openaiEnabled: env.AMORA_OPENAI_ENABLED === "true",
  openaiKeyPresent: Boolean(env.OPENAI_API_KEY),
  openaiKeyConfigured: isPlausibleOpenAIKey(env.OPENAI_API_KEY),
  primaryModelExact: env.OPENAI_AMORA_PRIMARY_MODEL === "gpt-5.6-terra",
  fastModelExact: env.OPENAI_AMORA_FAST_MODEL === "gpt-5.6-luna",
  primaryReasoningNone: env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT === "none",
  fastReasoningNone: env.OPENAI_AMORA_FAST_REASONING_EFFORT === "none",
  coupleQuotaDisabled: env.AMORA_COUPLE_QUOTA_ENABLED === "false",
  costGuardEnabled: env.AMORA_COST_GUARD_ENABLED === "true",
  globalMessageCapConfigured:
    isPositiveInteger(env.AMORA_GLOBAL_DAILY_MESSAGE_CAP),
  globalCostCapConfigured:
    isPositiveNumber(env.AMORA_GLOBAL_DAILY_COST_CAP_USD),
  auxiliaryMemoryDisabledForExpandDeploy:
    env.AMORA_AUXILIARY_MEMORY_ENABLED === "false",
  careOutboundDisabledForExpandDeploy:
    env.AMORA_CARE_OUTBOUND_ENABLED === "false",
  communityAiDisabledByDefault:
    env.AMORA_COMMUNITY_AI_COMMENT_ENABLED === "false",
  aiLogRetentionCronDisabledForExpandDeploy:
    env.AI_LOG_RETENTION_CRON_ENABLED === "false",
  accountDeletionIntakeDisabledForExpandDeploy:
    env.ACCOUNT_DELETION_INTAKE_ENABLED === "false",
  accountDeletionWorkerDisabledForExpandDeploy:
    env.ACCOUNT_DELETION_CRON_ENABLED === "false",
  productionWriteFenceStateExplicit:
    env.PRODUCTION_WRITE_FENCE_ENABLED === "true"
    || env.PRODUCTION_WRITE_FENCE_ENABLED === "false",
  profileMemoryConservative:
    env.AMORA_PROFILE_MEMORY_MODE === "conservative",
  supabaseUrlPresent: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseServiceRolePresent: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  supabaseDestinationPinned: hasPinnedSupabaseDestination(),
  adminBootstrapSecretConfigured: isPlausibleSecret(env.ADMIN_PASSWORD),
  cronSecretConfigured: isPlausibleSecret(env.CRON_SECRET),
  rateLimitSecretConfigured: isPlausibleSecret(env.RATE_LIMIT_KEY_SECRET),
  priceCatalogMinimumConfigured:
    isPositiveInteger(env.PRICE_CATALOG_MIN_PUBLISHED_VENDORS),
};

const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

console.log(JSON.stringify({ checks, failed, pass: failed.length === 0 }, null, 2));
process.exitCode = failed.length === 0 ? 0 : 1;
