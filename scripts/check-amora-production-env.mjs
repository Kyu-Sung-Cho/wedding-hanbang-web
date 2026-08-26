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
  // AI 로그 파기는 이제 켤 수 있다. 다만 상태를 명시해야 배포된다
  // (accountDeletion*StateExplicit 와 같은 방식 — 의식적 설정 강제).
  //
  // 켤 수 있게 된 이유: 이 크론이 하는 일은 **삭제가 아니라 원문 마스킹**이다.
  // `redact_old_ai_interactions` (20260613120000_ai_log_retention_policy.sql) 는
  // 행을 지우지 않고 `user_input`/`ai_output` 을 `[redacted_after_retention]` 로
  // 바꾸고 `tool_input`/`tool_output` 을 비운다. 비용·토큰·감사 행은 그대로 남는다.
  //
  // 그리고 끄고 두는 쪽이 오히려 약속을 어긴다. 개인정보처리방침이 90일을 말하는데
  // 2026-08-26 운영 실측으로 90일 초과 1,028행이 원문을 들고 있었다(사용자 입력 432건,
  // 아모라 답변 1,025건, 가장 오래된 것 125일). 크론은 등록돼 있었지만
  // (`apps/web/vercel.json`, 매일 18:30 UTC) 꺼져 있으면 **200 OK 를 돌려주기 때문에**
  // Vercel 에는 성공으로 보였다.
  //
  // 운영에 RPC 가 실제로 존재하는 것도 확인했다(PostgREST 스펙, `p_retention` 파라미터).
  aiLogRetentionCronStateExplicit:
    env.AI_LOG_RETENTION_CRON_ENABLED === "true"
    || env.AI_LOG_RETENTION_CRON_ENABLED === "false",
  // 탈퇴 접수와 워커는 이제 켤 수 있다. 다만 상태를 명시해야 배포된다
  // (proactiveChatStateExplicit 와 같은 방식 — 의식적 설정 강제).
  //
  // 켤 수 있게 된 이유: public.events 의 append-only 트리거와
  // ON DELETE SET NULL FK 가 서로를 막아 계정 삭제 트랜잭션이 통째로
  // 롤백되던 결함을 20260821120000_events_append_only_allows_fk_detach.sql
  // 이 고쳤다. 그전에 켰다면 사용자는 탈퇴도 못 하고 업로드도 막힌 채
  // 갇혔고, 워커는 무한 재시도하며 아무 신호도 내지 않았다.
  accountDeletionIntakeStateExplicit:
    env.ACCOUNT_DELETION_INTAKE_ENABLED === "true"
    || env.ACCOUNT_DELETION_INTAKE_ENABLED === "false",
  accountDeletionWorkerStateExplicit:
    env.ACCOUNT_DELETION_CRON_ENABLED === "true"
    || env.ACCOUNT_DELETION_CRON_ENABLED === "false",
  // 접수만 켜고 워커를 꺼두면 요청은 받아 놓고 아무도 처리하지 않는다.
  // 사용자에게는 "처리 중"이라고 말한 채 영원히 처리되지 않는 상태다.
  // 그 조합만 따로 막는다.
  accountDeletionWorkerFollowsIntake:
    env.ACCOUNT_DELETION_INTAKE_ENABLED !== "true"
    || env.ACCOUNT_DELETION_CRON_ENABLED === "true",
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
