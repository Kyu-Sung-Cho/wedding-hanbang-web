import assert from "node:assert/strict";
import test from "node:test";

import {
  coupleCourtPageProbePlan,
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
    "--couple-court-private=closed",
    "--couple-court-ai=closed",
    "--couple-court-public=closed",
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

test("Couple Court release switches reject unsafe deployment combinations", () => {
  assert.throws(
    () => remoteOptions(["--couple-court-ai=open"]),
    /cannot be open while the private feature is closed/,
  );
  assert.throws(
    () => remoteOptions(["--couple-court-public=open"]),
    /cannot be open while the private feature is closed/,
  );
  assert.throws(
    () => remoteOptions(["--couple-court-private=invalid"]),
    /--couple-court-private must be closed or open/,
  );
  assert.throws(
    () => remoteOptions([
      "--launch-mode=coming_soon",
      "--couple-court-private=open",
    ]),
    /must remain fully closed in coming_soon/,
  );

  const degradedProvider = remoteOptions([
    "--couple-court-private=open",
    "--couple-court-ai=closed",
    "--couple-court-public=open",
  ]);
  assert.equal(degradedProvider.coupleCourtPublic, "open");
});

test("Couple Court live probes use raw pages and never mutation-capable APIs", () => {
  const plan = coupleCourtPageProbePlan(remoteOptions());
  assert.deepEqual(plan, [
    {
      capability: "private",
      path: "/wedding/couple-court/invite",
      expectedStatus: 404,
    },
    {
      capability: "public",
      path: "/wedding/couple-court/public",
      expectedStatus: 404,
    },
  ]);
  assert.equal(plan.some(({ path }) => path.startsWith("/api/")), false);
  assert.equal(plan.some(({ path }) => path.includes("judge")), false);

  const openPlan = coupleCourtPageProbePlan(remoteOptions([
    "--couple-court-private=open",
    "--couple-court-public=open",
  ]));
  assert.deepEqual(openPlan.map(({ expectedStatus }) => expectedStatus), [200, 200]);
});

test("release health fails closed on stale SHA, wrong project, or weak secret", () => {
  const options = remoteOptions();
  const baseBody = {
    deployment: SHA,
    supabaseProjectRef: PROJECT_REF,
    rateLimitKeySecretConfigured: true,
    turnstileCredentialsConfigured: true,
    turnstileCanonicalHostnameConfigured: true,
    turnstileConfigured: true,
    maintenance: false,
    maintenanceStartedAt: null,
    researchCohortApplicationsEnabled: false,
    accountDeletionCronEnabled: false,
    coupleCourtEnabled: false,
    coupleCourtAiEnabled: false,
    coupleCourtPublicEnabled: false,
    coupleCourtMockEnabled: false,
    coupleCourtProviderConfigured: false,
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

  const aiOpenOptions = remoteOptions([
    "--couple-court-private=open",
    "--couple-court-ai=open",
  ]);
  const aiOpenBody = {
    ...baseBody,
    coupleCourtEnabled: true,
    coupleCourtAiEnabled: true,
  };
  assert.match(
    releaseHealthFailures(
      { status: 200, body: aiOpenBody, cacheControl: "no-store" },
      aiOpenOptions,
    ).join("\n"),
    /Terra provider configuration/,
  );
  assert.deepEqual(
    releaseHealthFailures(
      {
        status: 200,
        body: { ...aiOpenBody, coupleCourtProviderConfigured: true },
        cacheControl: "no-store",
      },
      aiOpenOptions,
    ),
    [],
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
        rateLimitKeySecretConfigured: true,
        turnstileCredentialsConfigured: true,
        turnstileCanonicalHostnameConfigured: false,
        turnstileConfigured: false,
        maintenance: true,
        maintenanceStartedAt: "2026-07-12T00:00:00Z",
        researchCohortApplicationsEnabled: true,
        accountDeletionCronEnabled: true,
        coupleCourtEnabled: true,
        coupleCourtAiEnabled: true,
        coupleCourtPublicEnabled: true,
        coupleCourtMockEnabled: true,
        coupleCourtProviderConfigured: false,
      },
    },
    remoteOptions(),
  ).join("\n");
  assert.match(failures, /disable caching/);
  assert.match(failures, /Turnstile credentials/);
  assert.match(failures, /maintenance mode off/);
  assert.match(failures, /research intake closed/);
  assert.match(failures, /account-deletion cron closed/);
  assert.match(failures, /Couple Court private closed/);
  assert.match(failures, /Couple Court AI closed/);
  assert.match(failures, /Couple Court public closed/);
  assert.match(failures, /provider mock closed/);
});
