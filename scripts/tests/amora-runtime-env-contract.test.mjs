import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

const runtimeVariables = [
  "AMORA_OPENAI_ENABLED",
  "AMORA_AUXILIARY_MEMORY_ENABLED",
  "AMORA_CARE_OUTBOUND_ENABLED",
  // 웨딩홀 문의 편지(2026-11-17). 켜면 승인된 편지가 운영자 대기열로 간다 — 바깥 행동이다.
  "HALL_INQUIRY_SENDING_ENABLED",
  "HALL_INQUIRY_DAILY_CAP",
  "HALL_INQUIRY_GLOBAL_DAILY_CAP",
  // 커플이 직접 보내기(D-83 1단계, 2026-11-18). 켜면 편지 응답·승인 거절·받은 답 붙여 넣기가 바뀐다.
  "HALL_INQUIRY_SELF_SEND_ENABLED",
  "AMORA_COMMUNITY_AI_COMMENT_ENABLED",
  "AMORA_CONVERSATION_SEGMENT_READ_ENABLED",
  "AMORA_TODAY_ONE_ENABLED",
  "AI_LOG_RETENTION_CRON_ENABLED",
  "ACCOUNT_DELETION_INTAKE_ENABLED",
  "ACCOUNT_DELETION_CRON_ENABLED",
  "PRODUCTION_WRITE_FENCE_ENABLED",
  // 처리방침 문단과 보태기 카드가 이 둘로 켜진다. 빌드 입력에서 빠지면 캐시된
  // 옛 판이 「받는다」 또는 「안 받는다」를 틀리게 말한다.
  "WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED",
  "WEDDING_CODE_RESEARCH_RECEIPT_SECRET",
  "PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT",
  "PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256",
  "AMORA_PROFILE_MEMORY_MODE",
  "AMORA_COST_GUARD_ENABLED",
  "AMORA_COUPLE_QUOTA_ENABLED",
  "AMORA_FREE_MESSAGES_PER_COUPLE",
  "AMORA_GLOBAL_DAILY_MESSAGE_CAP",
  "AMORA_GLOBAL_DAILY_COST_CAP_USD",
  "OPENAI_API_KEY",
  "OPENAI_AMORA_PRIMARY_MODEL",
  "OPENAI_AMORA_FAST_MODEL",
  "CRON_SECRET",
  "RATE_LIMIT_KEY_SECRET",
  "SIGNUP_CONSENT_LEGACY_BEFORE",
  "DEMO_SESSION_SECRET",
  "SUPABASE_EXPECTED_URL",
  "SUPABASE_EXPECTED_PROJECT_REF",
  "SUPABASE_PRODUCTION_PROJECT_REF",
  "SUPABASE_PRODUCTION_WRITE_CONFIRM",
];

test("Turborepo treats every safety- and cost-relevant runtime variable as a build input", async () => {
  const turbo = JSON.parse(await readFile(new URL("turbo.json", root), "utf8"));
  const globalEnv = new Set(turbo.globalEnv ?? []);
  const buildEnv = new Set(turbo.tasks?.build?.env ?? []);

  for (const variable of runtimeVariables) {
    assert.equal(globalEnv.has(variable), true, `${variable} missing from globalEnv`);
    assert.equal(buildEnv.has(variable), true, `${variable} missing from build.env`);
  }
});

test("the example environment keeps external Amora side effects fail-closed", async () => {
  const example = await readFile(new URL("apps/web/.env.example", root), "utf8");

  for (const line of [
    "AMORA_OPENAI_ENABLED=false",
    "AMORA_AUXILIARY_MEMORY_ENABLED=false",
    "AMORA_CARE_OUTBOUND_ENABLED=false",
    "HALL_INQUIRY_SENDING_ENABLED=false",
    "HALL_INQUIRY_SELF_SEND_ENABLED=false",
    "AMORA_COMMUNITY_AI_COMMENT_ENABLED=false",
    "AMORA_CONVERSATION_SEGMENT_READ_ENABLED=false",
    "AMORA_TODAY_ONE_ENABLED=false",
    "AI_LOG_RETENTION_CRON_ENABLED=false",
    "ACCOUNT_DELETION_INTAKE_ENABLED=false",
    "ACCOUNT_DELETION_CRON_ENABLED=false",
    "PRODUCTION_WRITE_FENCE_ENABLED=false",
    "WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED=false",
  ]) {
    assert.match(example, new RegExp(`^${line}$`, "m"));
  }

  assert.match(example, /^AMORA_COST_GUARD_ENABLED=true$/m);
  // 서비스 전체 문의 상한은 닫힌 채 시작한다(0 이면 아무것도 대기열에 넣지 않는다).
  assert.match(example, /^HALL_INQUIRY_GLOBAL_DAILY_CAP=0$/m);
  assert.match(example, /^AMORA_COUPLE_QUOTA_ENABLED=false$/m);
  assert.match(example, /^AMORA_GLOBAL_DAILY_COST_CAP_USD=20$/m);
  assert.match(example, /^RATE_LIMIT_KEY_SECRET=$/m);
  assert.match(example, /^SIGNUP_CONSENT_LEGACY_BEFORE=$/m);
  assert.match(example, /^WEDDING_CODE_RESEARCH_RECEIPT_SECRET=$/m);
});
