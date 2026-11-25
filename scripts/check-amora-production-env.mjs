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

function isConfiguredConsentCutover(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString() === value
    && timestamp <= Date.now();
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
  // 보조 기억("조건 저장")은 이제 켤 수 있다. 다만 상태를 명시해야 배포된다
  // (`proactiveChatStateExplicit`·AI 로그 파기와 같은 방식 — 의식적 설정 강제).
  //
  // 열기 전에 확인한 것(2026-08-30):
  //
  //  - **길이 예산.** 기억 블록이 필수 영역에 들어가 최대 +16,617자를 밀어 넣는데,
  //    읽기 도구셋 기준 여유가 599자뿐이라 계약 섹션부터 조용히 사라졌다(헤딩 21→8,
  //    계약 2/11). `PRODUCT_SAFETY_HEADINGS` 에 계약 아홉을 넣어 11/11 로 만들고
  //    `promptContractsSurviveTruncation.test.ts` 로 고정했다. 이게 켜기의 전제였다.
  //  - **동의 관문.** 플래그를 켜도 커플별 동의 없이는 잡이 cancelled 된다. 공유
  //    기억은 두 사람, 개인 기억은 한 사람. 즉 플래그만으로는 아무 커플의 기억도
  //    저장되지 않는다.
  //  - **최초 활성화의 파괴적 동작.** 그 범위의 자동 기억·대화 요약·프로필을
  //    되돌릴 수 없게 지운다. 웹·모바일 모두 켜기 직전에 삭제량을 숫자로 보여주고
  //    확인을 받는다(운영 실측: 대상 커플 5쌍, 최대 기억 99 + 요약 1).
  //
  // 켠 뒤에 다듬을 것으로 남긴 것: 기억 **한 건** 삭제는 그 사실이 적힌 대화 요약을
  // 지우지 않는다(전체 삭제 `clear_amora_memory_scope` 는 지운다). 범위 요약을 한
  // 건 때문에 통째로 지우면 무관한 내용까지 파괴되므로 자명한 정답이 아니다.
  auxiliaryMemoryStateExplicit:
    env.AMORA_AUXILIARY_MEMORY_ENABLED === "true"
    || env.AMORA_AUXILIARY_MEMORY_ENABLED === "false",
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
  // 찾아보기(2026-11-20, D-85). 비어 있거나 false 면 꺼짐이라 통과한다 — 이 칸 때문에 다음 배포가
  // 죽지 않게 한다. true 면 검색어가 네이버로 나가므로 열쇠가 있어야 통과한다. 켜는 것은 파운더 승인 뒤다.
  webSearchSwitchSafe:
    env.AMORA_WEB_SEARCH_ENABLED === undefined
    || env.AMORA_WEB_SEARCH_ENABLED === ""
    || env.AMORA_WEB_SEARCH_ENABLED === "false"
    || (env.AMORA_WEB_SEARCH_ENABLED === "true"
      && Boolean(env.NAVER_API_HUB_CLIENT_ID?.trim())
      && Boolean(env.NAVER_API_HUB_CLIENT_SECRET?.trim())),
  // 부를 네이버 상품 목록. 비었으면 지역만이라 통과한다. 적었다면 코드가 다룰 줄 아는 local·webkr 만
  // 통과한다(blog·오타·대문자는 코드가 조용히 빼므로, 적은 사람이 그렇게 될 줄 모르고 넘어가지 않게 막는다).
  webSearchNaverProductsKnown:
    env.AMORA_WEB_SEARCH_NAVER_PRODUCTS === undefined
    || env.AMORA_WEB_SEARCH_NAVER_PRODUCTS.trim() === ""
    || env.AMORA_WEB_SEARCH_NAVER_PRODUCTS.split(",")
      .map((token) => token.trim())
      .filter((token) => token !== "")
      .every((token) => token === "local" || token === "webkr"),
  supabaseUrlPresent: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseServiceRolePresent: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  supabaseDestinationPinned: hasPinnedSupabaseDestination(),
  adminBootstrapSecretConfigured: isPlausibleSecret(env.ADMIN_PASSWORD),
  cronSecretConfigured: isPlausibleSecret(env.CRON_SECRET),
  rateLimitSecretConfigured: isPlausibleSecret(env.RATE_LIMIT_KEY_SECRET),
  // 실제 쓰기 차단 이후 확정한 전환 시각만 사용한다. 미래 시각은 신규 계정의
  // 편집 가능한 구 metadata를 기존 동의로 인정할 수 있으므로 거절한다.
  signupConsentCutoverConfigured:
    isConfiguredConsentCutover(env.SIGNUP_CONSENT_LEGACY_BEFORE),
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
