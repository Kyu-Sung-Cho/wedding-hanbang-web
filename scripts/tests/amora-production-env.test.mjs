import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT_REF = "abcdefghijklmnopqrst";

function validEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    AMORA_OPENAI_ENABLED: "true",
    OPENAI_API_KEY: `sk-${"a".repeat(40)}`,
    OPENAI_AMORA_PRIMARY_MODEL: "gpt-5.6-terra",
    OPENAI_AMORA_FAST_MODEL: "gpt-5.6-luna",
    OPENAI_AMORA_PRIMARY_REASONING_EFFORT: "none",
    OPENAI_AMORA_FAST_REASONING_EFFORT: "none",
    AMORA_COUPLE_QUOTA_ENABLED: "false",
    AMORA_COST_GUARD_ENABLED: "true",
    AMORA_GLOBAL_DAILY_MESSAGE_CAP: "300",
    AMORA_GLOBAL_DAILY_COST_CAP_USD: "20",
    AMORA_AUXILIARY_MEMORY_ENABLED: "false",
    AMORA_CARE_OUTBOUND_ENABLED: "false",
    AMORA_PROACTIVE_CHAT_ENABLED: "true",
    AMORA_COMMUNITY_AI_COMMENT_ENABLED: "false",
    AMORA_CONVERSATION_SEGMENT_READ_ENABLED: "false",
    AMORA_TODAY_ONE_ENABLED: "false",
    AI_LOG_RETENTION_CRON_ENABLED: "false",
    ACCOUNT_DELETION_INTAKE_ENABLED: "false",
    ACCOUNT_DELETION_CRON_ENABLED: "false",
    PRODUCTION_WRITE_FENCE_ENABLED: "false",
    AMORA_PROFILE_MEMORY_MODE: "conservative",
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"b".repeat(32)}`,
    SUPABASE_EXPECTED_URL: `https://${PROJECT_REF}.supabase.co`,
    SUPABASE_EXPECTED_PROJECT_REF: PROJECT_REF,
    SUPABASE_PRODUCTION_PROJECT_REF: PROJECT_REF,
    SUPABASE_PRODUCTION_WRITE_CONFIRM: `RUNTIME_WRITE:${PROJECT_REF}`,
    ADMIN_PASSWORD: "admin-bootstrap-secret-longer-than-thirty-two-chars",
    CRON_SECRET: "cron-secret-longer-than-thirty-two-characters",
    RATE_LIMIT_KEY_SECRET: "rate-limit-secret-longer-than-thirty-two-chars",
    SIGNUP_CONSENT_LEGACY_BEFORE: "2026-01-01T00:00:00.000Z",
    PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT: "2",
    PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256: "a".repeat(64),
    ...overrides,
  };
}

function runChecker(env) {
  return spawnSync(process.execPath, ["scripts/check-amora-production-env.mjs"], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
  });
}

function runBuildGate(env) {
  return spawnSync(process.execPath, ["scripts/check-amora-build-env.mjs"], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
  });
}

test("the production environment gate accepts only an explicit safe configuration", () => {
  const result = runChecker(validEnv());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.deepEqual(report.failed, []);
});

test("the web search switch stays off unless it is exactly true with a NAVER key (2026-11-20 D-85)", () => {
  // 비어 있거나 false 면 꺼짐이라 통과한다. 이 칸 때문에 다음 배포가 죽으면 안 된다.
  for (const value of [undefined, "", "false"]) {
    const env = validEnv(value === undefined ? {} : { AMORA_WEB_SEARCH_ENABLED: value });
    assert.deepEqual(JSON.parse(runChecker(env).stdout).failed, [], `AMORA_WEB_SEARCH_ENABLED=${value}`);
  }
  // 켰는데 열쇠가 없으면 막는다. 대문자·오타도 막는다(켜는 값은 정확히 true 하나다).
  for (const overrides of [
    { AMORA_WEB_SEARCH_ENABLED: "true" },
    { AMORA_WEB_SEARCH_ENABLED: "true", NAVER_API_HUB_CLIENT_ID: "id-only" },
    // prove-guard 가 찾은 빈틈(2026-11-20): 비밀값만 있고 ID 가 없는 경우가 없어 ID 검사를 빼도 초록이었다.
    { AMORA_WEB_SEARCH_ENABLED: "true", NAVER_API_HUB_CLIENT_SECRET: "secret-only" },
    { AMORA_WEB_SEARCH_ENABLED: "TRUE", NAVER_API_HUB_CLIENT_ID: "id", NAVER_API_HUB_CLIENT_SECRET: "secret" },
    { AMORA_WEB_SEARCH_ENABLED: "yes", NAVER_API_HUB_CLIENT_ID: "id", NAVER_API_HUB_CLIENT_SECRET: "secret" },
  ]) {
    const result = runChecker(validEnv(overrides));
    assert.equal(result.status, 1, JSON.stringify(overrides));
    assert.deepEqual(JSON.parse(result.stdout).failed, ["webSearchSwitchSafe"], JSON.stringify(overrides));
  }
  const enabled = runChecker(validEnv({
    AMORA_WEB_SEARCH_ENABLED: "true",
    NAVER_API_HUB_CLIENT_ID: "client-id",
    NAVER_API_HUB_CLIENT_SECRET: "client-secret",
  }));
  assert.equal(enabled.status, 0, enabled.stderr || enabled.stdout);
  // 값은 찍지 않는다. 불리언만 나온다.
  assert.doesNotMatch(enabled.stdout, /client-secret|client-id/);
});

test("the NAVER product list only accepts products the code handles (2026-11-20)", () => {
  // 비었으면 지역만이다. 적었다면 local·webkr 만 통과한다.
  // 빈 칸(쉼표 두 개)은 런타임(`naverWebLookupProducts`)처럼 무시한다.
  for (const value of [undefined, "", "local", "local,webkr", " webkr , local ", "local,,webkr"]) {
    const env = validEnv(value === undefined ? {} : { AMORA_WEB_SEARCH_NAVER_PRODUCTS: value });
    assert.deepEqual(JSON.parse(runChecker(env).stdout).failed, [], `AMORA_WEB_SEARCH_NAVER_PRODUCTS=${value}`);
  }
  // 블로그(다루는 코드 없음)·대문자·오타는 막는다.
  for (const value of ["blog", "local,blog", "LOCAL", "lokal"]) {
    const result = runChecker(validEnv({ AMORA_WEB_SEARCH_NAVER_PRODUCTS: value }));
    assert.equal(result.status, 1, value);
    assert.deepEqual(JSON.parse(result.stdout).failed, ["webSearchNaverProductsKnown"], value);
  }
});

test("the production environment gate blocks a missing rate-limit HMAC secret", () => {
  const result = runChecker(validEnv({ RATE_LIMIT_KEY_SECRET: "" }));
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(report.failed, ["rateLimitSecretConfigured"]);
});

test("the consent rollout gate requires a real UTC cutoff, never a future or normalized date", () => {
  for (const unsafe of [
    "", "2026-01-01", "2026-01-01T00:00:00Z",
    "2026-01-01T09:00:00.000+09:00", "2026-02-30T00:00:00.000Z",
    "2026-13-01T00:00:00.000Z", "not-a-date",
    new Date(Date.now() + 86_400_000).toISOString(),
  ]) {
    const result = runChecker(validEnv({ SIGNUP_CONSENT_LEGACY_BEFORE: unsafe }));
    assert.equal(result.status, 1, unsafe);
    assert.deepEqual(JSON.parse(result.stdout).failed, ["signupConsentCutoverConfigured"], unsafe);
  }
});

test("the production builder blocks an omitted consent cutoff before producing an artifact", () => {
  const result = runBuildGate(validEnv({
    VERCEL_ENV: "production",
    SIGNUP_CONSENT_LEGACY_BEFORE: "",
  }));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout).failed, ["signupConsentCutoverConfigured"]);
});

test("the production environment gate requires an exact positive published-vendor count", () => {
  for (const unsafe of ["", "0", "-1", "1.5"]) {
    const result = runChecker(validEnv({
      PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_COUNT: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["priceCatalogExpectedCountConfigured"],
    );
  }
});

test("the production environment gate requires a lowercase SHA-256 catalog digest", () => {
  for (const unsafe of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
    const result = runChecker(validEnv({
      PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_SLUGS_SHA256: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["priceCatalogExpectedSlugDigestConfigured"],
    );
  }
});

test("the production environment gate blocks a weak admin bootstrap secret", () => {
  const result = runChecker(validEnv({ ADMIN_PASSWORD: "too-short" }));
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.failed, ["adminBootstrapSecretConfigured"]);
});

// 예전에는 이 값이 "false" 여야만 배포됐다("keeps destructive AI-log retention
// disabled"). 그런데 이 크론이 하는 일은 삭제가 아니라 **원문 마스킹**이고
// (`redact_old_ai_interactions` 는 행을 남기고 텍스트만 바꾼다), 끄고 두는 쪽이
// 개인정보처리방침의 90일 약속을 어긴다 — 2026-08-26 운영 실측 90일 초과 1,028행.
// 그래서 탈퇴 플래그와 같은 "명시해야 배포된다" 규칙으로 바꾼다.
test("AI-log retention must state true or false, never blank or mis-cased", () => {
  for (const unsafe of ["", "TRUE", "False", "yes", "1"]) {
    const result = runChecker(validEnv({
      AI_LOG_RETENTION_CRON_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["aiLogRetentionCronStateExplicit"],
    );
  }
});

test("AI-log retention may be switched on", () => {
  // 켜는 것이 배포를 막지 않아야 한다. 이 단언이 없으면 게이트를 되돌려도 아무도 모른다.
  const result = runChecker(validEnv({ AI_LOG_RETENTION_CRON_ENABLED: "true" }));
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).failed, []);
});

test("account deletion flags must state true or false, never blank or mis-cased", () => {
  for (const unsafe of ["", "FALSE", "TRUE", "yes", "1"]) {
    assert.deepEqual(
      JSON.parse(runChecker(validEnv({
        ACCOUNT_DELETION_CRON_ENABLED: unsafe,
      })).stdout).failed,
      ["accountDeletionWorkerStateExplicit"],
      `worker=${JSON.stringify(unsafe)}`,
    );
    assert.deepEqual(
      JSON.parse(runChecker(validEnv({
        ACCOUNT_DELETION_INTAKE_ENABLED: unsafe,
      })).stdout).failed,
      ["accountDeletionIntakeStateExplicit"],
      `intake=${JSON.stringify(unsafe)}`,
    );
  }
});

// 접수만 켜고 워커를 꺼두면 요청은 쌓이는데 아무도 처리하지 않는다.
// 사용자에게는 "안전하게 처리 중"이라고 말해 놓고 영원히 처리되지 않는다.
test("intake cannot be enabled while the deletion worker stays off", () => {
  const result = runChecker(validEnv({
    ACCOUNT_DELETION_INTAKE_ENABLED: "true",
    ACCOUNT_DELETION_CRON_ENABLED: "false",
  }));
  assert.equal(result.status, 1);
  assert.deepEqual(
    JSON.parse(result.stdout).failed,
    ["accountDeletionWorkerFollowsIntake"],
  );
});

test("both account deletion flags on together is a valid production state", () => {
  const result = runChecker(validEnv({
    ACCOUNT_DELETION_INTAKE_ENABLED: "true",
    ACCOUNT_DELETION_CRON_ENABLED: "true",
  }));
  assert.equal(result.status, 0, result.stdout);
});

// 워커만 켜는 것은 막지 않는다 — 접수가 꺼져 있으면 새 작업이 생기지 않고,
// 이미 쌓인 작업을 처리해 비우는 정당한 상태다.
test("the worker may run while intake is closed to drain existing jobs", () => {
  const result = runChecker(validEnv({
    ACCOUNT_DELETION_INTAKE_ENABLED: "false",
    ACCOUNT_DELETION_CRON_ENABLED: "true",
  }));
  assert.equal(result.status, 0, result.stdout);
});

test("the expand deployment keeps conversation-segment reads disabled", () => {
  for (const unsafe of ["", "true", "FALSE"]) {
    const result = runChecker(validEnv({
      AMORA_CONVERSATION_SEGMENT_READ_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["conversationSegmentReadDisabledForExpandDeploy"],
    );
  }
});

test("the production deployment requires an explicit auxiliary-memory state", () => {
  // 이 게이트에는 **이 플래그를 지키는 검사가 하나도 없었다.** 2026-08-30 에
  // 확인했다 — `auxiliaryMemoryDisabledForExpandDeploy` 를 통째로 지우거나
  // `true,` 로 바꿔도 node 18/18 · vitest 14/14 가 그대로 초록이었다. 같은 파일의
  // conversation-segment · TodayOne · AI 로그는 전용 검사가 있는데 보조 기억만
  // 없어서, 실수로 느슨해져도 아무도 잡지 못하는 상태였다.
  //
  // 이제 "false 여야 한다"가 아니라 "명시해야 한다"이므로, 지켜야 할 것은
  // **미설정·오타를 막는 것**이다. 값을 안 정한 채 배포되면 런타임이 조용히
  // 꺼진 쪽으로 가고, 켠 줄 알았던 사람이 그것을 모른다.
  for (const unsafe of ["", "TRUE", "True", "1", "yes", "off"]) {
    const result = runChecker(validEnv({
      AMORA_AUXILIARY_MEMORY_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["auxiliaryMemoryStateExplicit"],
    );
  }
});

test("the production deployment accepts auxiliary memory on or off", () => {
  // 켤 수 있다는 것이 이 변경의 요지다. 두 값 모두 통과해야 한다.
  for (const explicit of ["true", "false"]) {
    const result = runChecker(validEnv({
      AMORA_AUXILIARY_MEMORY_ENABLED: explicit,
    }));
    assert.equal(result.status, 0, `${explicit} 에서 실패: ${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout).failed, []);
  }
});

test("the expand deployment keeps TodayOne disabled", () => {
  for (const unsafe of ["", "true", "FALSE"]) {
    const result = runChecker(validEnv({
      AMORA_TODAY_ONE_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["todayOneDisabledForExpandDeploy"],
    );
  }
});

test("the production deployment requires an explicit write-fence state", () => {
  for (const unsafe of ["", "TRUE", "1"]) {
    const result = runChecker(validEnv({
      PRODUCTION_WRITE_FENCE_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["productionWriteFenceStateExplicit"],
    );
  }

  assert.equal(
    runChecker(validEnv({ PRODUCTION_WRITE_FENCE_ENABLED: "true" })).status,
    0,
  );
});

test("the gate requires only code-backed secrets and never prints their values", async () => {
  const source = await readFile(resolve(REPO_ROOT, "scripts/check-amora-production-env.mjs"), "utf8");
  assert.doesNotMatch(source, /AMORA_IDEMPOTENCY_SECRET|AMORA_COST_GUARD_FAIL_OPEN/);

  const sentinel = "never-print-this-rate-limit-secret-1234567890";
  const result = runChecker(validEnv({ RATE_LIMIT_KEY_SECRET: sentinel }));
  assert.equal(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(sentinel));
});

test("the Vercel build gate skips preview but enforces the production environment", async () => {
  const preview = runBuildGate({
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    VERCEL_ENV: "preview",
  });
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.match(preview.stdout, /skipped for preview/);

  const production = runBuildGate(validEnv({ VERCEL_ENV: "production" }));
  assert.equal(production.status, 0, production.stderr || production.stdout);
  assert.match(production.stdout, /"pass": true/);

  const webPackage = JSON.parse(
    await readFile(resolve(REPO_ROOT, "apps/web/package.json"), "utf8"),
  );
  assert.equal(
    webPackage.scripts.build,
    "node ../../scripts/build-web-safely.mjs",
  );

  const safeBuildSource = await readFile(
    resolve(REPO_ROOT, "scripts/build-web-safely.mjs"),
    "utf8",
  );
  const amoraGateIndex = safeBuildSource.indexOf("check-amora-build-env.mjs");
  const nextBuildIndex = safeBuildSource.indexOf('await runNode(nextCli, ["build"])');
  assert.ok(amoraGateIndex >= 0, "safe build wrapper must invoke the Amora environment gate");
  assert.ok(nextBuildIndex >= 0, "safe build wrapper must invoke Next.js production build");
  assert.ok(
    amoraGateIndex < nextBuildIndex,
    "Amora environment gate must run before the Next.js production build",
  );
});
