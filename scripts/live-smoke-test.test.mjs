import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
  releaseHealthFailures,
} from "./live-smoke-test.mjs";

const SHA = "3af4e666bb67bfff1dcee5647553d0473f2c309f";
const PROJECT_REF = "abcdefghijklmnopqrst";
const APPLE_TEAM_ID = "6RSK726532";
const PLAY_SIGNING_SHA256 =
  "85:25:B7:5F:66:FC:6A:85:0D:A7:57:A2:CA:D2:47:B9:F6:EB:C7:81:10:D3:2F:B7:2C:84:42:0D:AE:B6:40:0D";

function remoteOptions(extra = []) {
  return parseArgs([
    "--base-url=https://hanbang.ai",
    "--launch-mode=full",
    `--expected-sha=${SHA}`,
    `--expected-supabase-project-ref=${PROJECT_REF}`,
    `--apple-team-id=${APPLE_TEAM_ID}`,
    `--play-signing-sha256=${PLAY_SIGNING_SHA256}`,
    "--research-intake=closed",
    "--account-deletion-cron=closed",
    ...extra,
  ], {});
}

test("full release smoke requires exact deployment and database identities", () => {
  assert.throws(
    () => parseArgs([
      "--base-url=https://hanbang.ai",
      "--launch-mode=full",
      "--expected-sha=0123456789012345678901234567890123456789",
      `--expected-supabase-project-ref=${PROJECT_REF}`,
    ], {}),
    /expected-sha/,
  );
  assert.throws(
    () => parseArgs([
      "--base-url=https://hanbang.ai",
      "--launch-mode=full",
      `--expected-sha=${SHA}`,
    ], {}),
    /expected-supabase-project-ref/,
  );
  assert.equal(remoteOptions().expectedSha, SHA);
});

test("full remote smoke also requires signed mobile association identities", () => {
  assert.throws(
    () => parseArgs([
      "--base-url=https://hanbang.ai",
      "--launch-mode=full",
      `--expected-sha=${SHA}`,
      `--expected-supabase-project-ref=${PROJECT_REF}`,
    ], {}),
    /apple-team-id/,
  );
});

test("unbound mode is explicit and restricted to localhost", () => {
  assert.throws(
    () => parseArgs([
      "--base-url=https://hanbang.ai",
      "--allow-unbound-local",
    ], {}),
    /restricted to localhost/,
  );
  const local = parseArgs([
    "--base-url=http://127.0.0.1:3000",
    "--allow-unbound-local",
  ], {});
  assert.equal(local.allowUnboundLocal, true);
});

test("release health fails closed on stale SHA, wrong project, or weak secret", () => {
  const options = remoteOptions();
  const baseBody = {
    deployment: SHA,
    supabaseProjectRef: PROJECT_REF,
    amoraUsageLimitMode: "unlimited_test",
    rateLimitKeySecretConfigured: true,
    turnstileCredentialsConfigured: true,
    turnstileCanonicalHostnameConfigured: true,
    turnstileConfigured: true,
    maintenance: false,
    maintenanceStartedAt: null,
    researchCohortApplicationsEnabled: false,
    customerSurveyIntakeEnabled: false,
    accountDeletionCronEnabled: false,
  };

  assert.deepEqual(
    releaseHealthFailures(
      { status: 200, body: baseBody, cacheControl: "no-store, max-age=0" },
      options,
    ),
    [],
  );
  assert.match(
    releaseHealthFailures(
      {
        status: 200,
        body: { ...baseBody, deployment: "f".repeat(40) },
        cacheControl: "no-store",
      },
      options,
    ).join("\n"),
    /Expected health deployment/,
  );
  assert.match(
    releaseHealthFailures(
      {
        status: 200,
        body: { ...baseBody, supabaseProjectRef: "z".repeat(20) },
        cacheControl: "no-store",
      },
      options,
    ).join("\n"),
    /Expected Supabase project/,
  );
  assert.match(
    releaseHealthFailures(
      {
        status: 200,
        body: { ...baseBody, rateLimitKeySecretConfigured: false },
        cacheControl: "no-store",
      },
      options,
    ).join("\n"),
    /rate-limit key secret/,
  );
  assert.match(
    releaseHealthFailures(
      {
        status: 200,
        body: { ...baseBody, amoraUsageLimitMode: "limited" },
        cacheControl: "no-store",
      },
      options,
    ).join("\n"),
    /Amora usage-limit mode unlimited_test/,
  );
  assert.match(
    releaseHealthFailures(
      {
        status: 200,
        body: { ...baseBody, turnstileConfigured: false },
        cacheControl: "no-store",
      },
      options,
    ).join("\n"),
    /Turnstile credentials/,
  );
  assert.match(
    releaseHealthFailures(
      {
        status: 200,
        body: {
          ...baseBody,
          turnstileCanonicalHostnameConfigured: false,
          turnstileConfigured: false,
        },
        cacheControl: "no-store",
      },
      options,
    ).join("\n"),
    /exactly hanbang\.ai/,
  );
});

test("release health binds maintenance and feature switches", () => {
  const failures = releaseHealthFailures(
    {
      status: 200,
      cacheControl: "public, max-age=60",
      body: {
        deployment: SHA,
        supabaseProjectRef: PROJECT_REF,
        amoraUsageLimitMode: "limited",
        rateLimitKeySecretConfigured: true,
        turnstileCredentialsConfigured: true,
        turnstileCanonicalHostnameConfigured: false,
        turnstileConfigured: false,
        maintenance: true,
        maintenanceStartedAt: "2026-07-12T00:00:00Z",
        researchCohortApplicationsEnabled: true,
        customerSurveyIntakeEnabled: true,
        accountDeletionCronEnabled: true,
      },
    },
    remoteOptions(),
  ).join("\n");
  assert.match(failures, /disable caching/);
  assert.match(failures, /Turnstile credentials/);
  assert.match(failures, /Amora usage-limit mode unlimited_test/);
  assert.match(failures, /maintenance mode off/);
  assert.match(failures, /research intake closed/);
  assert.match(failures, /customer survey intake closed/);
  assert.match(failures, /account-deletion cron closed/);
});
