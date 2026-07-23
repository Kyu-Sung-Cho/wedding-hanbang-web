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

test("the production environment gate blocks a missing rate-limit HMAC secret", () => {
  const result = runChecker(validEnv({ RATE_LIMIT_KEY_SECRET: "" }));
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(report.failed, ["rateLimitSecretConfigured"]);
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

test("the expand deployment keeps destructive AI-log retention disabled", () => {
  for (const unsafe of ["", "true", "TRUE"]) {
    const result = runChecker(validEnv({
      AI_LOG_RETENTION_CRON_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["aiLogRetentionCronDisabledForExpandDeploy"],
    );
  }
});

test("the expand deployment keeps account deletion progression disabled", () => {
  for (const unsafe of ["", "true", "FALSE"]) {
    const result = runChecker(validEnv({
      ACCOUNT_DELETION_CRON_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["accountDeletionWorkerDisabledForExpandDeploy"],
    );
  }
});

test("the expand deployment keeps account deletion intake disabled", () => {
  for (const unsafe of ["", "true", "TRUE"]) {
    const result = runChecker(validEnv({
      ACCOUNT_DELETION_INTAKE_ENABLED: unsafe,
    }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      JSON.parse(result.stdout).failed,
      ["accountDeletionIntakeDisabledForExpandDeploy"],
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
