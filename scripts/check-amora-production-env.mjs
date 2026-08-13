#!/usr/bin/env node

import { createHash } from "node:crypto";

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
    && !/(?:placeholder|example|test-only|replace-with|not-a-real)/i.test(value)
  );
}

function decodeJwtJson(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function isConfiguredSupabaseAnonKey(value) {
  if (typeof value !== "string" || value !== value.trim()) return false;
  if (/(?:placeholder|example|test-only|replace-with|not-a-real)/i.test(value)) {
    return false;
  }
  if (value === env.SUPABASE_SERVICE_ROLE_KEY || value.startsWith("sb_secret_")) {
    return false;
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{24,}$/.test(value)) {
    const parts = value.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) return false;
    if (!/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return false;
    const header = decodeJwtJson(parts[0]);
    const payload = decodeJwtJson(parts[1]);
    if (!header || !payload || header.alg !== "HS256") return false;
    if (header.typ !== undefined && header.typ !== "JWT") return false;
    if (payload.role !== "anon") return false;
    if (payload.ref !== env.SUPABASE_EXPECTED_PROJECT_REF) return false;
    const expectedUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const acceptedIssuers = new Set([
      "supabase",
      expectedUrl ? `${expectedUrl}/auth/v1` : "",
      expectedUrl ? `${expectedUrl}/auth/v1/` : "",
    ]);
    if (typeof payload.iss !== "string" || !acceptedIssuers.has(payload.iss)) {
      return false;
    }
    if (
      typeof payload.exp !== "number"
      || !Number.isSafeInteger(payload.exp)
      || payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
  }

  const expectedSha256 = env.SUPABASE_EXPECTED_ANON_KEY_SHA256;
  return (
    typeof expectedSha256 === "string"
    && /^[a-f0-9]{64}$/.test(expectedSha256)
    && createHash("sha256").update(value, "utf8").digest("hex") === expectedSha256
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
  // 인앱 선제 케어(채팅 진입 시 모멘트 발화)는 이메일 아웃바운드와 분리된
  // 스위치로, 상태를 명시해야 배포된다 (true/false 모두 허용 — 의식적 설정 강제).
  proactiveChatStateExplicit:
    env.AMORA_PROACTIVE_CHAT_ENABLED === "true"
    || env.AMORA_PROACTIVE_CHAT_ENABLED === "false",
  communityAiDisabledByDefault:
    env.AMORA_COMMUNITY_AI_COMMENT_ENABLED === "false",
  conversationSegmentReadDisabledForExpandDeploy:
    env.AMORA_CONVERSATION_SEGMENT_READ_ENABLED === "false",
  todayOneDisabledForExpandDeploy:
    env.AMORA_TODAY_ONE_ENABLED === "false",
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
  supabaseAnonKeyConfigured:
    isConfiguredSupabaseAnonKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseServiceRolePresent: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  supabaseDestinationPinned: hasPinnedSupabaseDestination(),
  adminBootstrapSecretConfigured: isPlausibleSecret(env.ADMIN_PASSWORD),
  cronSecretConfigured: isPlausibleSecret(env.CRON_SECRET),
  rateLimitSecretConfigured: isPlausibleSecret(env.RATE_LIMIT_KEY_SECRET),
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
