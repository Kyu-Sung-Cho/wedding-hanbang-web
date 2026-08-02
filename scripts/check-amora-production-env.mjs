#!/usr/bin/env node

/**
 * Prints only release-gate booleans. Never print environment variable values.
 * This must run in the actual Vercel Production builder/runtime; local
 * `vercel env run` output is not accepted as production-environment evidence.
 */

import { verifySupabaseServiceDestinationFromEnv } from "./lib/supabase-service-destination.mjs";
import {
  isValidServerSecret,
  resolveAliasedServerSecret,
} from "../packages/shared/src/security/serverSecretPolicy.mjs";

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

function isPublishedVendorCount(value) {
  return /^[1-9][0-9]{0,5}$/.test(value);
}

function isSha256Hex(value) {
  return /^[a-f0-9]{64}$/.test(value);
}

function isPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isPlausibleSecret(value) {
  return (
    typeof value === "string"
    && value.length >= 32
    && value.length <= 512
    && !/[\s\u0000-\u001f\u007f]/u.test(value)
    && new Set(value).size >= 12
    && !/(?:placeholder|example|test-only|replace-with|not-a-real)/i.test(value)
  );
}

const internalApiToken = resolveAliasedServerSecret(
  env.INTERNAL_API_TOKEN,
  env.VENDOR_INTERNAL_TOKEN,
);
const internalApiTokenAliasesCompatible = !(
  env.INTERNAL_API_TOKEN
  && env.VENDOR_INTERNAL_TOKEN
  && env.INTERNAL_API_TOKEN !== env.VENDOR_INTERNAL_TOKEN
);

const checks = {
  openaiEnabledFlagPresent: Boolean(env.AMORA_OPENAI_ENABLED),
  openaiEnabled: env.AMORA_OPENAI_ENABLED === "true",
  openaiKeyPresent: Boolean(env.OPENAI_API_KEY),
  openaiKeyConfigured: isPlausibleOpenAIKey(env.OPENAI_API_KEY),
  primaryModelExact: env.OPENAI_AMORA_PRIMARY_MODEL === "gpt-5.6-terra",
  fastModelExact: env.OPENAI_AMORA_FAST_MODEL === "gpt-5.6-luna",
  primaryReasoningNone: env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT === "none",
  fastReasoningNone: env.OPENAI_AMORA_FAST_REASONING_EFFORT === "none",
  coupleQuotaEnabled: env.AMORA_COUPLE_QUOTA_ENABLED === "true",
  costGuardEnabled: env.AMORA_COST_GUARD_ENABLED === "true",
  demoMessageCapConfigured:
    isPositiveInteger(env.AMORA_DEMO_GLOBAL_DAILY_MESSAGE_CAP),
  globalMessageCapConfigured:
    isPositiveInteger(env.AMORA_GLOBAL_DAILY_MESSAGE_CAP),
  globalCostCapConfigured:
    isPositiveNumber(env.AMORA_GLOBAL_DAILY_COST_CAP_USD),
  auxiliaryMemoryDisabledForExpandDeploy:
    env.AMORA_AUXILIARY_MEMORY_ENABLED === "false",
  careOutboundDisabledForExpandDeploy:
    env.AMORA_CARE_OUTBOUND_ENABLED === "false",
  // 인앱 선제 케어(채팅 진입 시 모멘트 발화)는 이메일 아웃바운드와 분리된
  // 스위치로, 상태를 명시해야 배포된다 (true/false 모두 허용 — 의식적 설정 강제).
  proactiveChatStateExplicit:
    env.AMORA_PROACTIVE_CHAT_ENABLED === "true"
    || env.AMORA_PROACTIVE_CHAT_ENABLED === "false",
  communityAiDisabledByDefault:
    env.AMORA_COMMUNITY_AI_COMMENT_ENABLED === "false",
  naverPlaceSearchDisabledForExpandDeploy:
    env.NAVER_PLACE_SEARCH_ENABLED === "false",
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
  cronSecretConfigured: isValidServerSecret(env.CRON_SECRET),
  internalApiTokenConfigured: isValidServerSecret(internalApiToken),
  internalApiTokenAliasesCompatible,
  rateLimitSecretConfigured: isPlausibleSecret(env.RATE_LIMIT_KEY_SECRET),
  demoSessionSecretConfigured: isPlausibleSecret(env.DEMO_SESSION_SECRET),
  demoSessionSecretDistinct:
    !isPlausibleSecret(env.DEMO_SESSION_SECRET)
    || (
      env.DEMO_SESSION_SECRET !== env.RATE_LIMIT_KEY_SECRET
      && env.DEMO_SESSION_SECRET !== env.CRON_SECRET
      && env.DEMO_SESSION_SECRET !== env.ADMIN_PASSWORD
    ),
  evalSecretConfigured: isPlausibleSecret(env.AMORA_EVAL_SECRET),
  evalSecretDistinct:
    !isPlausibleSecret(env.AMORA_EVAL_SECRET)
    || (
      env.AMORA_EVAL_SECRET !== env.DEMO_SESSION_SECRET
      && env.AMORA_EVAL_SECRET !== env.RATE_LIMIT_KEY_SECRET
      && env.AMORA_EVAL_SECRET !== env.CRON_SECRET
      && env.AMORA_EVAL_SECRET !== env.ADMIN_PASSWORD
    ),
  priceCatalogExpectedCountConfigured:
    isPublishedVendorCount(env.PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT),
  priceCatalogExpectedSlugDigestConfigured:
    isSha256Hex(env.PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256),
};

const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

console.log(JSON.stringify({ checks, failed, pass: failed.length === 0 }, null, 2));
process.exitCode = failed.length === 0 ? 0 : 1;
