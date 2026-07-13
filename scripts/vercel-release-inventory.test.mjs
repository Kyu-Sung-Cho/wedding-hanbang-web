import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createReleaseInventorySummary } from "./vercel-release-inventory.mjs";

const SCRIPT = resolve("scripts/vercel-release-inventory.mjs");
const SHA_A = "57e03914aaf96f59ad6bee64155da4af50e4010e";
const SHA_B = "e7bf0e98cc107620fdb8b6a77169ad6aeb23f042";

function secretFixture(label) {
  return createHash("sha256").update(`vercel-inventory-${label}`).digest("base64url");
}

function spawnCli(args = [], input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: resolve("."),
    encoding: "utf8",
    input,
    shell: false,
    timeout: 10_000,
  });
}

function runCli(input, args = []) {
  const withPagination = (value, rowsKey) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || !Array.isArray(value[rowsKey]) || Object.hasOwn(value, "pagination")) {
      return value;
    }
    return {
      ...value,
      pagination: { count: value[rowsKey].length, next: null, prev: null },
    };
  };
  return spawnCli(args, JSON.stringify({
    ...input,
    env: withPagination(input?.env, "envs"),
    deployments: withPagination(input?.deployments, "deployments"),
  }));
}

test("emits only the allowlisted release inventory while counting bypass configuration", () => {
  const bypassSecret = secretFixture("bypass-map-key");
  const envSecret = secretFixture("turnstile-secret");
  const providerToken = secretFixture("provider-token");
  const providerMessage = `provider rejected ${secretFixture("provider-message")}`;
  const input = {
    project: {
      name: "wedding-hanbang-web",
      rootDirectory: "apps/web",
      framework: "nextjs",
      nodeVersion: "24.x",
      link: { productionBranch: "main" },
      gitProviderOptions: { createDeployments: "disabled" },
      ssoProtection: { deploymentType: "all_except_custom_domains" },
      protectionBypass: {
        [bypassSecret]: {
          scope: "automation-bypass",
          token: providerToken,
          nested: { secret: secretFixture("nested-bypass") },
        },
      },
      providerMessage,
    },
    env: {
      envs: [
        {
          key: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
          target: ["production"],
          type: "sensitive",
          updatedAt: 1_783_834_200_000,
          value: envSecret,
          token: providerToken,
          comment: providerMessage,
        },
        {
          key: "TURNSTILE_SECRET_KEY",
          target: ["production"],
          type: "sensitive",
          updatedAt: 1_783_834_260_000,
          value: secretFixture("server-secret"),
        },
      ],
      provider: { message: providerMessage, token: providerToken },
    },
    deployments: {
      deployments: [
        {
          target: "production",
          state: "READY",
          createdAt: 1_783_834_320_000,
          meta: {
            githubCommitSha: SHA_A,
            githubCommitMessage: providerMessage,
            token: providerToken,
          },
        },
        {
          target: null,
          state: "READY",
          createdAt: 1_783_834_380_000,
          meta: { githubCommitSha: SHA_B, providerMessage },
        },
      ],
      token: providerToken,
    },
  };

  const result = runCli(input, [
    "--require-env=NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "--require-env=TURNSTILE_SECRET_KEY",
    "--require-env=APPLE_TEAM_ID",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(summary), [
    "schemaVersion",
    "evaluationMode",
    "sourceAttestationVerified",
    "productionProof",
    "releaseEligible",
    "project",
    "deployments",
    "environment",
    "protection",
    "summaryDigest",
  ]);
  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.evaluationMode, "offline-local-artifacts");
  assert.equal(summary.sourceAttestationVerified, false);
  assert.equal(summary.productionProof, false);
  assert.equal(summary.releaseEligible, false);
  assert.deepEqual(summary.project, {
    name: "wedding-hanbang-web",
    projectId: null,
    accountId: null,
    rootDirectory: "apps/web",
    framework: "nextjs",
    nodeVersion: "24.x",
    productionBranch: "main",
    gitDeployments: "disabled",
  });
  assert.equal(summary.deployments.total, 2);
  assert.deepEqual(Object.keys(summary.deployments), [
    "total",
    "pagination",
    "withSha",
    "withoutSha",
    "byTarget",
    "byState",
    "shaMetadata",
  ]);
  assert.deepEqual(summary.deployments.byTarget, {
    production: 1,
    preview: 1,
    other: 0,
  });
  assert.deepEqual(
    summary.deployments.shaMetadata.map(({ sha }) => sha),
    [SHA_A, SHA_B].sort(),
  );
  for (const metadata of summary.deployments.shaMetadata) {
    assert.deepEqual(Object.keys(metadata), [
      "sha",
      "deploymentCount",
      "byTarget",
      "states",
      "latestCreatedAt",
    ]);
  }
  assert.equal(summary.environment.count, 2);
  assert.deepEqual(Object.keys(summary.environment), [
    "count", "pagination", "required", "variables",
  ]);
  for (const variable of summary.environment.variables) {
    assert.deepEqual(
      Object.keys(variable),
      ["name", "targets", "type", "updatedAt", "scope"],
    );
  }
  assert.deepEqual(summary.environment.required, [
    { name: "APPLE_TEAM_ID", present: false, targets: [], scopedOnly: false },
    {
      name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      present: true,
      targets: ["production"],
      scopedOnly: false,
    },
    {
      name: "TURNSTILE_SECRET_KEY",
      present: true,
      targets: ["production"],
      scopedOnly: false,
    },
  ]);
  assert.deepEqual(summary.protection, {
    mode: "all_except_custom_domains",
    automationBypassFieldObserved: true,
    automationBypassConfigured: true,
    automationBypassCount: 1,
  });
  assert.match(summary.summaryDigest, /^[0-9a-f]{64}$/);

  const observableSnapshot = `${result.stdout}\n${result.stderr}\n${JSON.stringify(summary)}`;
  for (const secret of [
    bypassSecret,
    envSecret,
    providerToken,
    providerMessage,
    secretFixture("nested-bypass"),
    secretFixture("server-secret"),
  ]) {
    assert.equal(observableSnapshot.includes(secret), false);
  }
  assert.equal(observableSnapshot.includes("protectionBypass"), false);
  assert.equal(observableSnapshot.includes("providerMessage"), false);
  assert.equal(observableSnapshot.includes('"value"'), false);
  assert.equal(observableSnapshot.includes('"token"'), false);
});

test("rejects a non-record deployment row without reflecting provider messages", () => {
  const providerMessage = `upstream ${secretFixture("non-record-provider-message")}`;
  const result = runCli({
    project: {
      name: "wedding-hanbang-web",
      rootDirectory: "apps/web",
      framework: "nextjs",
      nodeVersion: "24.x",
      link: { productionBranch: "main" },
      gitProviderOptions: { createDeployments: "disabled" },
    },
    env: { envs: [] },
    deployments: {
      deployments: [
        providerMessage,
        null,
        {
          target: "production",
          state: "READY",
          createdAt: 1_783_834_320_000,
          meta: { githubCommitSha: SHA_A },
        },
      ],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(providerMessage), false);
});

test("rejects a non-record environment row without reflecting provider messages", () => {
  const providerMessage = `upstream ${secretFixture("non-record-env-message")}`;
  const result = runCli({
    project: {},
    env: {
      envs: [
        {
          key: "OPENAI_API_KEY",
          target: ["production"],
          type: "sensitive",
        },
        providerMessage,
      ],
    },
    deployments: { deployments: [] },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(providerMessage), false);
});

test("rejects an invalid environment key instead of silently dropping its row", () => {
  const invalidKeyFragment = secretFixture("invalid-env-key");
  const result = runCli({
    project: {},
    env: {
      envs: [{
        key: `OPENAI-${invalidKeyFragment}`,
        target: ["production"],
        type: "sensitive",
      }],
    },
    deployments: { deployments: [] },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(invalidKeyFragment), false);
});

test("rejects an unknown environment type instead of normalizing it to unknown", () => {
  const invalidType = `provider-${secretFixture("invalid-env-type")}`;
  const result = runCli({
    project: {},
    env: {
      envs: [{
        key: "OPENAI_API_KEY",
        target: ["production"],
        type: invalidType,
      }],
    },
    deployments: { deployments: [] },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(invalidType), false);
});

test("rejects a malformed environment target instead of treating it as no targets", () => {
  const targetSecret = secretFixture("invalid-env-target");
  const result = runCli({
    project: {},
    env: {
      envs: [{
        key: "OPENAI_API_KEY",
        target: { production: targetSecret },
        type: "sensitive",
      }],
    },
    deployments: { deployments: [] },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(targetSecret), false);
});

test("rejects a malformed environment timestamp instead of erasing it", () => {
  const timestampSecret = secretFixture("invalid-env-timestamp");
  const result = runCli({
    project: {},
    env: {
      envs: [{
        key: "OPENAI_API_KEY",
        target: ["production"],
        type: "sensitive",
        updatedAt: `not-a-date-${timestampSecret}`,
      }],
    },
    deployments: { deployments: [] },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(timestampSecret), false);
});

test("rejects a malformed deployment target instead of counting it as other", () => {
  const targetSecret = secretFixture("invalid-deployment-target");
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: { custom: targetSecret },
        state: "READY",
        createdAt: 1_783_834_320_000,
      }],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(targetSecret), false);
});

test("classifies a valid custom environment deployment as other and rejects malformed metadata", () => {
  const valid = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        customEnvironment: { slug: "staging-eu" },
        state: "READY",
        createdAt: 1_783_834_320_000,
        meta: { githubCommitSha: SHA_A },
      }],
    },
  });
  assert.equal(valid.status, 0, valid.stderr);
  const validSummary = JSON.parse(valid.stdout).deployments;
  assert.deepEqual(validSummary.byTarget, {
    production: 0,
    preview: 0,
    other: 1,
  });
  assert.deepEqual(validSummary.shaMetadata[0].byTarget, {
    production: 0,
    preview: 0,
    other: 1,
  });
  assert.equal(valid.stdout.includes("staging-eu"), false);

  for (const customEnvironment of [
    {},
    { slug: "invalid custom environment" },
    { slug: null },
    "staging-eu",
  ]) {
    const malformed = runCli({
      project: {},
      env: { envs: [] },
      deployments: {
        deployments: [{
          target: "production",
          customEnvironment,
          state: "READY",
          createdAt: 1_783_834_320_000,
        }],
      },
    });
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout, "");
    assert.equal(
      malformed.stderr,
      "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
    );
  }
});

test("rejects a malformed deployment state instead of counting it as unknown", () => {
  const stateSecret = secretFixture("invalid-deployment-state");
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: { providerState: stateSecret },
        createdAt: 1_783_834_320_000,
      }],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(stateSecret), false);
});

test("rejects a deployment state outside the current Vercel enum", () => {
  const unknownState = `PROVIDER_${secretFixture("unknown-deployment-state")}`;
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: unknownState,
        createdAt: 1_783_834_320_000,
      }],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(unknownState), false);
});

test("classifies only null or omitted deployment state as unknown and honors a valid peer", () => {
  const missing = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "preview",
        createdAt: 1_783_834_320_000,
      }],
    },
  });
  const nullWithPeer = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: null,
        readyState: "READY",
        createdAt: 1_783_834_320_000,
      }],
    },
  });

  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(missing.stderr, "");
  assert.equal(JSON.parse(missing.stdout).deployments.byState.unknown, 1);
  assert.equal(nullWithPeer.status, 0, nullWithPeer.stderr);
  assert.equal(nullWithPeer.stderr, "");
  const peerSummary = JSON.parse(nullWithPeer.stdout);
  assert.equal(peerSummary.deployments.byState.ready, 1);
  assert.equal(peerSummary.deployments.byState.unknown, 0);
});

test("accepts documented null and optional row fields without inventing metadata", () => {
  const result = runCli({
    project: {},
    env: {
      envs: [{
        key: "CUSTOM_ENV_ONLY",
        target: null,
        type: "sensitive",
        updatedAt: null,
        customEnvironmentIds: ["env_custom_fixture"],
      }],
    },
    deployments: {
      deployments: [{
        target: null,
        state: null,
        created: 1_783_834_320_000,
        meta: { providerOpaqueMetadata: "provider-opaque-metadata" },
      }],
    },
  }, ["--require-env=CUSTOM_ENV_ONLY"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary.environment.variables, [{
    name: "CUSTOM_ENV_ONLY",
    targets: [],
    type: "sensitive",
    updatedAt: null,
    scope: {
      branchScoped: false,
      customEnvironmentScoped: true,
      customEnvironmentCount: 1,
      configurationSourceObserved: false,
    },
  }]);
  assert.deepEqual(summary.environment.required, [{
    name: "CUSTOM_ENV_ONLY",
    present: true,
    targets: [],
    scopedOnly: true,
  }]);
  assert.equal(summary.deployments.byTarget.preview, 1);
  assert.equal(summary.deployments.byState.unknown, 1);
  assert.equal(summary.deployments.withoutSha, 1);
});

test("rejects a malformed deployment timestamp instead of erasing it", () => {
  const timestampSecret = secretFixture("invalid-deployment-timestamp");
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: "READY",
        createdAt: `not-a-date-${timestampSecret}`,
      }],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(timestampSecret), false);
});

test("rejects a malformed deployment commit SHA instead of counting it as absent", () => {
  const shaSecret = secretFixture("invalid-deployment-sha");
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: "READY",
        createdAt: 1_783_834_320_000,
        meta: { githubCommitSha: shaSecret },
      }],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(shaSecret), false);
});

test("preserves Vercel's documented BLOCKED deployment state", () => {
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "preview",
        readyState: "BLOCKED",
        created: 1_783_834_320_000,
      }],
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.deployments.byState.blocked, 1);
  assert.equal(summary.deployments.byState.unknown, 0);
});

test("accepts documented environment key and scalar-target variants", () => {
  const result = runCli({
    project: {},
    env: {
      envs: [{
        key: "mixed_CASE_9",
        target: "production",
        type: "system",
        updatedAt: 1_783_834_320_000,
      }],
    },
    deployments: { deployments: [] },
  }, ["--require-env=mixed_CASE_9"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout).environment, {
    count: 1,
    pagination: {
      fieldObserved: true,
      count: 1,
      nextCursorPresent: false,
      previousCursorPresent: false,
      singlePageComplete: true,
    },
    required: [{
      name: "mixed_CASE_9",
      present: true,
      targets: ["production"],
      scopedOnly: false,
    }],
    variables: [{
      name: "mixed_CASE_9",
      targets: ["production"],
      type: "system",
      updatedAt: "2026-07-12T05:32:00.000Z",
      scope: null,
    }],
  });
});

test("accepts the epoch-string timestamp variant emitted in Vercel deployment examples", () => {
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: "READY",
        created: "1783834320000",
        sha: SHA_A,
      }],
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(
    JSON.parse(result.stdout).deployments.shaMetadata[0].latestCreatedAt,
    "2026-07-12T05:32:00.000Z",
  );
});

test("rejects a malformed official deployment field even when its fallback peer is valid", () => {
  const stateSecret = secretFixture("invalid-ready-state-peer");
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: "READY",
        readyState: { providerState: stateSecret },
        createdAt: 1_783_834_320_000,
      }],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(stateSecret), false);
});

test("rejects a malformed official deployment timestamp peer", () => {
  const timestampSecret = secretFixture("invalid-created-peer");
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [{
        target: "production",
        state: "READY",
        createdAt: 1_783_834_320_000,
        created: `not-a-date-${timestampSecret}`,
      }],
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(timestampSecret), false);
});

test("reads explicitly named local fixture streams without exposing their secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vercel-release-inventory-"));
  const projectFile = join(directory, "project.json");
  const envFile = join(directory, "env.json");
  const deploymentsFile = join(directory, "deployments.json");
  const bypassSecret = secretFixture("file-bypass");
  const envSecret = secretFixture("file-env");
  try {
    await Promise.all([
      writeFile(projectFile, JSON.stringify({
        name: "wedding-hanbang-web",
        rootDirectory: "apps/web",
        framework: "nextjs",
        nodeVersion: "24.x",
        link: { productionBranch: "main" },
        gitProviderOptions: { createDeployments: "disabled" },
        ssoProtection: { deploymentType: "all_except_custom_domains" },
        protectionBypass: { [bypassSecret]: { scope: "automation-bypass" } },
      })),
      writeFile(envFile, JSON.stringify({
        envs: [{
          key: "OPENAI_API_KEY",
          target: ["production"],
          type: "sensitive",
          updatedAt: "2026-07-12T13:00:00Z",
          value: envSecret,
        }],
        pagination: { count: 1, next: null, prev: null },
      })),
      writeFile(deploymentsFile, JSON.stringify({
        deployments: [{
          target: "production",
          readyState: "READY",
          createdAt: "2026-07-12T13:10:00Z",
          meta: { githubCommitSha: SHA_A },
        }],
        pagination: { count: 1, next: null, prev: null },
      })),
    ]);

    const result = spawnCli([
      "--project-file", projectFile,
      "--env-file", envFile,
      "--deployments-file", deploymentsFile,
      "--require-env", "OPENAI_API_KEY",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.protection.automationBypassCount, 1);
    assert.deepEqual(summary.environment.required, [{
      name: "OPENAI_API_KEY",
      present: true,
      targets: ["production"],
      scopedOnly: false,
    }]);
    const observableSnapshot = `${result.stdout}${result.stderr}`;
    assert.equal(observableSnapshot.includes(bypassSecret), false);
    assert.equal(observableSnapshot.includes(envSecret), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects unexpected secret-bearing top-level input without reflecting it", () => {
  const topLevelToken = secretFixture("unexpected-top-level-token");
  const providerMessage = `provider says ${secretFixture("unexpected-provider-message")}`;
  const result = runCli({
    project: {},
    env: { envs: [] },
    deployments: { deployments: [] },
    apiToken: topLevelToken,
    providerMessage,
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "vercel-release-inventory: INPUT_TOP_LEVEL_REJECTED\n",
  );
  const observableSnapshot = `${result.stdout}${result.stderr}`;
  assert.equal(observableSnapshot.includes(topLevelToken), false);
  assert.equal(observableSnapshot.includes(providerMessage), false);
  assert.equal(observableSnapshot.includes("apiToken"), false);
});

test("computes the same redacted digest when only secrets and provider messages change", () => {
  function digestInput(label) {
    const secret = secretFixture(`digest-${label}`);
    return {
      project: {
        name: "wedding-hanbang-web",
        rootDirectory: "apps/web",
        framework: "nextjs",
        nodeVersion: "24.x",
        link: { productionBranch: "main" },
        gitProviderOptions: { createDeployments: "disabled" },
        ssoProtection: { deploymentType: "all_except_custom_domains" },
        protectionBypass: { [secret]: { token: secret, message: `provider ${secret}` } },
      },
      env: {
        envs: [{
          key: "OPENAI_API_KEY",
          target: ["production"],
          type: "sensitive",
          updatedAt: "2026-07-12T13:00:00Z",
          value: secret,
          nested: { token: secret },
        }],
      },
      deployments: {
        deployments: [{
          target: "production",
          state: "READY",
          createdAt: "2026-07-12T13:10:00Z",
          meta: { githubCommitSha: SHA_A, githubCommitMessage: `provider ${secret}` },
        }],
      },
    };
  }

  const firstSecret = secretFixture("digest-first");
  const secondSecret = secretFixture("digest-second");
  const first = runCli(digestInput("first"));
  const second = runCli(digestInput("second"));

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(first.stdout).summaryDigest, JSON.parse(second.stdout).summaryDigest);
  assert.equal(first.stdout, second.stdout);
  const observableSnapshot = `${first.stdout}${first.stderr}${second.stdout}${second.stderr}`;
  assert.equal(observableSnapshot.includes(firstSecret), false);
  assert.equal(observableSnapshot.includes(secondSecret), false);
});

test("does not reflect malformed JSON or an invalid bypass payload in errors", () => {
  const malformedSecret = secretFixture("malformed-json");
  const malformed = spawnCli([], `{"project":"${malformedSecret}"`);
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stdout, "");
  assert.equal(
    malformed.stderr,
    "vercel-release-inventory: INPUT_JSON_INVALID\n",
  );
  assert.equal(`${malformed.stdout}${malformed.stderr}`.includes(malformedSecret), false);

  const bypassSecret = secretFixture("invalid-bypass-payload");
  const invalidBypass = runCli({
    project: { protectionBypass: bypassSecret },
    env: { envs: [] },
    deployments: { deployments: [] },
  });
  assert.equal(invalidBypass.status, 1);
  assert.equal(invalidBypass.stdout, "");
  assert.equal(
    invalidBypass.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );
  assert.equal(
    `${invalidBypass.stdout}${invalidBypass.stderr}`.includes(bypassSecret),
    false,
  );
});

test("accepts one UTF-8 BOM emitted by Windows PowerShell stdin", () => {
  const input = {
    project: {},
    env: { envs: [] },
    deployments: { deployments: [] },
  };
  const result = spawnCli([], `\uFEFF${JSON.stringify({
    ...input,
    env: { ...input.env, pagination: { count: 0, next: null, prev: null } },
    deployments: {
      ...input.deployments,
      pagination: { count: 0, next: null, prev: null },
    },
  })}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).environment.count, 0);
});

test("fails closed on malformed pagination and proves completeness only without either cursor", () => {
  const missingPagination = spawnCli([], JSON.stringify({
    project: {},
    env: { envs: [] },
    deployments: { deployments: [] },
  }));
  assert.equal(missingPagination.status, 1);
  assert.equal(
    missingPagination.stderr,
    "vercel-release-inventory: INPUT_SHAPE_INVALID\n",
  );

  const countMismatch = runCli({
    project: {},
    env: { envs: [], pagination: { count: 1, next: null, prev: null } },
    deployments: {
      deployments: [],
      pagination: { count: 0, next: null, prev: null },
    },
  });
  assert.equal(countMismatch.status, 1);

  for (const incompletePagination of [
    { count: 0, next: null },
    { count: 0, prev: null },
    { next: null, prev: null },
    { count: null, next: null, prev: null },
  ]) {
    const malformedDeployments = runCli({
      project: {},
      env: { envs: [] },
      deployments: { deployments: [], pagination: incompletePagination },
    });
    assert.equal(malformedDeployments.status, 1);

    const malformedEnvironment = runCli({
      project: {},
      env: { envs: [], pagination: incompletePagination },
      deployments: { deployments: [] },
    });
    assert.equal(malformedEnvironment.status, 1);
  }

  const paginated = runCli({
    project: {},
    env: { envs: [], pagination: { count: 0, next: null, prev: null } },
    deployments: {
      deployments: [],
      pagination: { count: 0, next: 1_783_834_320_000, prev: null },
    },
  });
  assert.equal(paginated.status, 0, paginated.stderr);
  assert.deepEqual(JSON.parse(paginated.stdout).deployments.pagination, {
    fieldObserved: true,
    count: 0,
    nextCursorPresent: true,
    previousCursorPresent: false,
    singlePageComplete: false,
  });

  const previousOnly = runCli({
    project: {},
    env: { envs: [] },
    deployments: {
      deployments: [],
      pagination: { count: 0, next: null, prev: "previous-page" },
    },
  });
  assert.equal(previousOnly.status, 0, previousOnly.stderr);
  assert.deepEqual(JSON.parse(previousOnly.stdout).deployments.pagination, {
    fieldObserved: true,
    count: 0,
    nextCursorPresent: false,
    previousCursorPresent: true,
    singlePageComplete: false,
  });

  const complete = runCli({
    project: {},
    env: { envs: [] },
    deployments: { deployments: [] },
  });
  assert.equal(complete.status, 0, complete.stderr);
  assert.deepEqual(JSON.parse(complete.stdout).deployments.pagination, {
    fieldObserved: true,
    count: 0,
    nextCursorPresent: false,
    previousCursorPresent: false,
    singlePageComplete: true,
  });
});

test("environment summaries are permutation-stable without locale-dependent sorting", () => {
  const rows = [
    {
      key: "CONFIG_ONLY",
      target: [],
      type: "sensitive",
      updatedAt: 1_783_834_200_000,
      configurationId: "icfg_reviewed",
    },
    {
      key: "CONFIG_ONLY",
      target: [],
      type: "sensitive",
      updatedAt: 1_783_834_200_000,
    },
  ];
  const makeInput = (envs) => ({
    project: {},
    env: { envs, pagination: { count: envs.length, next: null, prev: null } },
    deployments: {
      deployments: [],
      pagination: { count: 0, next: null, prev: null },
    },
  });
  const forward = createReleaseInventorySummary(makeInput(rows));
  const reverse = createReleaseInventorySummary(makeInput([...rows].reverse()));
  assert.deepEqual(forward, reverse);
  assert.equal(forward.summaryDigest, reverse.summaryDigest);
});

test("requires every branch-scoped variable to target exactly one preview scope", () => {
  const base = {
    project: {},
    deployments: { deployments: [] },
  };
  for (const targets of [
    ["production"],
    ["development"],
    [],
    ["preview", "development"],
    ["preview", "preview"],
  ]) {
    const branchScoped = runCli({
      ...base,
      env: {
        envs: [{
          key: "OPENAI_API_KEY",
          target: targets,
          type: "sensitive",
          gitBranch: "main",
        }],
      },
    });
    assert.equal(branchScoped.status, 1);
    assert.equal(branchScoped.stdout, "");
  }
});

test("rejects duplicate base, branch, and custom-environment owners", () => {
  const base = {
    project: {},
    deployments: { deployments: [] },
  };
  const duplicate = runCli({
    ...base,
    env: {
      envs: ["sensitive", "encrypted"].map((type) => ({
        key: "OPENAI_API_KEY",
        target: ["production"],
        type,
      })),
    },
  });
  assert.equal(duplicate.status, 1);

  const duplicateBranch = runCli({
    ...base,
    env: {
      envs: ["sensitive", "encrypted"].map((type) => ({
        key: "OPENAI_API_KEY",
        target: ["preview"],
        type,
        gitBranch: "feature/release-candidate",
      })),
    },
  });
  assert.equal(duplicateBranch.status, 1);

  const duplicateCustomEnvironment = runCli({
    ...base,
    env: {
      envs: ["sensitive", "encrypted"].map((type) => ({
        key: "OPENAI_API_KEY",
        target: [],
        type,
        customEnvironmentIds: ["env_custom_collision"],
      })),
    },
  });
  assert.equal(duplicateCustomEnvironment.status, 1);
});

test("allows a base preview, branch override, and production plus custom environment", () => {
  const branchIdentity = "feature/private-release-candidate";
  const customEnvironmentIdentity = "env_custom_private";
  const additionalScopes = runCli({
    project: {},
    deployments: { deployments: [] },
    env: {
      envs: [
        {
          key: "OPENAI_API_KEY",
          target: ["preview"],
          type: "sensitive",
        },
        {
          key: "OPENAI_API_KEY",
          target: ["preview"],
          type: "encrypted",
          gitBranch: branchIdentity,
        },
        {
          key: "OPENAI_API_KEY",
          target: ["production"],
          type: "sensitive",
          customEnvironmentIds: [customEnvironmentIdentity],
          configurationId: "icfg_fixture",
        },
      ],
    },
  }, ["--require-env=OPENAI_API_KEY"]);
  assert.equal(additionalScopes.status, 0, additionalScopes.stderr);
  const environment = JSON.parse(additionalScopes.stdout).environment;
  assert.deepEqual(environment.required, [{
    name: "OPENAI_API_KEY",
    present: true,
    targets: ["preview", "production"],
    scopedOnly: false,
  }]);
  const customEnvironmentVariable = environment.variables.find((variable) => {
    return variable.targets.includes("production");
  });
  assert.deepEqual(customEnvironmentVariable.scope, {
    branchScoped: false,
    customEnvironmentScoped: true,
    customEnvironmentCount: 1,
    configurationSourceObserved: true,
  });
  const branchVariable = environment.variables.find((variable) => {
    return variable.scope?.branchScoped === true;
  });
  assert.deepEqual(branchVariable.scope, {
    branchScoped: true,
    customEnvironmentScoped: false,
    customEnvironmentCount: 0,
    configurationSourceObserved: false,
  });
  assert.equal(additionalScopes.stdout.includes(branchIdentity), false);
  assert.equal(additionalScopes.stdout.includes(customEnvironmentIdentity), false);
});

test("reports branch-scoped preview variables without counting them as unscoped requirements", () => {
  const result = runCli({
    project: {},
    env: {
      envs: [{
        key: "PREVIEW_ONLY_KEY",
        target: ["preview"],
        type: "sensitive",
        gitBranch: "feature/preview",
      }],
    },
    deployments: { deployments: [] },
  }, ["--require-env=PREVIEW_ONLY_KEY"]);
  assert.equal(result.status, 0, result.stderr);
  const environment = JSON.parse(result.stdout).environment;
  assert.deepEqual(environment.required, [{
    name: "PREVIEW_ONLY_KEY",
    present: true,
    targets: [],
    scopedOnly: true,
  }]);
  assert.deepEqual(environment.variables[0].scope, {
    branchScoped: true,
    customEnvironmentScoped: false,
    customEnvironmentCount: 0,
    configurationSourceObserved: false,
  });
});

test("local fixtures reject symlinks and bind metadata checks to one open descriptor", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.match(source, /lstatLocalPathWithoutRedirects/);
  assert.match(source, /metadata\s*=\s*await lstat\(current\)/);
  assert.match(source, /metadata\.isSymbolicLink\(\)/);
  assert.match(source, /constants\.O_RDONLY \| constants\.O_NOFOLLOW/);
  assert.match(source, /handle\s*=\s*await open\(resolvedPath, openFlags\)/);
  assert.equal((source.match(/handle\s*=\s*await open\(/g) ?? []).length, 1);
  assert.match(source, /metadata\s*=\s*await handle\.stat\(\)/);
  assert.match(source, /data\s*=\s*await handle\.readFile\(\)/);
  assert.match(source, /finalMetadata\s*=\s*await handle\.stat\(\)/);
  for (const field of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) {
    assert.match(source, new RegExp(`left\\.${field} === right\\.${field}`));
  }
  assert.match(source, /data\.length !== metadata\.size/);
  assert.doesNotMatch(source, /await readFile\(resolvedPath\)/);
});

test("rejects a symlink or junction in a fixture ancestor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vercel-release-inventory-ancestor-"));
  const outside = join(directory, "outside");
  const redirected = join(directory, "redirected");
  try {
    await mkdir(outside);
    await writeFile(join(outside, "project.json"), JSON.stringify({}));
    await writeFile(join(outside, "env.json"), JSON.stringify({
      envs: [],
      pagination: { count: 0, next: null, prev: null },
    }));
    await writeFile(join(outside, "deployments.json"), JSON.stringify({
      deployments: [],
      pagination: { count: 0, next: null, prev: null },
    }));
    await symlink(outside, redirected, process.platform === "win32" ? "junction" : "dir");

    const result = spawnCli([
      "--project-file", join(redirected, "project.json"),
      "--env-file", join(redirected, "env.json"),
      "--deployments-file", join(redirected, "deployments.json"),
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "vercel-release-inventory: LOCAL_FIXTURE_READ_FAILED\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a final-component symlink fixture before parsing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vercel-release-inventory-symlink-"));
  const projectFile = join(directory, "project.json");
  const projectLink = join(directory, "project-link.json");
  const envFile = join(directory, "env.json");
  const deploymentsFile = join(directory, "deployments.json");
  try {
    if (process.platform === "win32") {
      const projectDirectory = join(directory, "project-directory");
      await mkdir(projectDirectory);
      await symlink(projectDirectory, projectLink, "junction");
    } else {
      await writeFile(projectFile, JSON.stringify({ name: "wedding-hanbang-web" }));
      await symlink(projectFile, projectLink, "file");
    }
    await writeFile(envFile, JSON.stringify({
      envs: [],
      pagination: { count: 0, next: null, prev: null },
    }));
    await writeFile(deploymentsFile, JSON.stringify({
      deployments: [],
      pagination: { count: 0, next: null, prev: null },
    }));

    const result = spawnCli([
      "--project-file", projectLink,
      "--env-file", envFile,
      "--deployments-file", deploymentsFile,
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "vercel-release-inventory: LOCAL_FIXTURE_READ_FAILED\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("distinguishes an unobserved bypass field from an explicitly empty map", () => {
  const baseInput = {
    env: { envs: [] },
    deployments: { deployments: [] },
  };
  const unobserved = runCli({ project: {}, ...baseInput });
  const explicitlyEmpty = runCli({
    project: { protectionBypass: {} },
    ...baseInput,
  });

  assert.equal(unobserved.status, 0, unobserved.stderr);
  assert.deepEqual(JSON.parse(unobserved.stdout).protection, {
    mode: "unknown",
    automationBypassFieldObserved: false,
    automationBypassConfigured: null,
    automationBypassCount: null,
  });
  assert.equal(explicitlyEmpty.status, 0, explicitlyEmpty.stderr);
  assert.deepEqual(JSON.parse(explicitlyEmpty.stdout).protection, {
    mode: "unknown",
    automationBypassFieldObserved: true,
    automationBypassConfigured: false,
    automationBypassCount: 0,
  });
});

test("includes validated project and account IDs to disambiguate same-name projects", () => {
  const projectId = `prj_${"Ab12".repeat(7)}`;
  const accountId = `team_${"Zy98".repeat(6)}`;
  const result = runCli({
    project: {
      id: projectId,
      accountId,
      name: "wedding-hanbang-web",
      protectionBypass: {},
    },
    env: { envs: [] },
    deployments: { deployments: [] },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    {
      projectId: JSON.parse(result.stdout).project.projectId,
      accountId: JSON.parse(result.stdout).project.accountId,
    },
    { projectId, accountId },
  );

  const invalidIdSecret = secretFixture("invalid-project-id");
  const invalid = runCli({
    project: {
      id: invalidIdSecret,
      accountId: `team_${invalidIdSecret}`,
      protectionBypass: {},
    },
    env: { envs: [] },
    deployments: { deployments: [] },
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /INPUT_SHAPE_INVALID/);
  assert.equal(`${invalid.stdout}${invalid.stderr}`.includes(invalidIdSecret), false);
});

test("rejects conflicting deployment state and timestamp aliases", () => {
  for (const deployment of [
    {
      target: "production",
      state: "READY",
      readyState: "ERROR",
      createdAt: 1_783_834_320_000,
    },
    {
      target: "production",
      state: "READY",
      createdAt: 1_783_834_320_000,
      created: 1_783_834_321_000,
    },
    {
      target: "production",
      state: "READY",
      createdAt: 1_783_834_320_000,
      created_at: 1_783_834_321_000,
    },
  ]) {
    const result = runCli({
      project: { protectionBypass: {} },
      env: { envs: [] },
      deployments: { deployments: [deployment] },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INPUT_SHAPE_INVALID/);
  }
});

test("rejects conflicting environment aliases instead of weakening production presence", () => {
  const baseline = {
    key: "OPENAI_API_KEY",
    type: "sensitive",
    target: ["production"],
    updatedAt: 1_783_834_320_000,
  };
  for (const row of [
    { ...baseline, name: "TURNSTILE_SECRET_KEY" },
    { ...baseline, targets: ["preview"] },
    { ...baseline, updated_at: 1_783_834_321_000 },
  ]) {
    const result = runCli({
      project: { protectionBypass: {} },
      env: { envs: [row] },
      deployments: { deployments: [] },
    }, ["--require-env=OPENAI_API_KEY"]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INPUT_SHAPE_INVALID/);
  }
});

test("rejects conflicting project, account, git, and protection aliases", () => {
  const projectIdA = `prj_${"Ab12".repeat(7)}`;
  const projectIdB = `prj_${"Cd34".repeat(7)}`;
  const accountIdA = `team_${"Zy98".repeat(6)}`;
  const accountIdB = `team_${"Xw76".repeat(6)}`;
  for (const project of [
    { id: projectIdA, projectId: projectIdB },
    { accountId: accountIdA, teamId: accountIdB },
    {
      gitProviderOptions: { createDeployments: "disabled" },
      git: { deploymentEnabled: true },
    },
    {
      ssoProtection: { deploymentType: "all_deployments" },
      protection: { mode: "none" },
    },
  ]) {
    const result = runCli({
      project: { ...project, protectionBypass: {} },
      env: { envs: [] },
      deployments: { deployments: [] },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INPUT_SHAPE_INVALID/);
  }
});

test("rejects invalid required-name and inherited-object library inputs", () => {
  const plainInput = {
    project: { protectionBypass: {} },
    env: { envs: [] },
    deployments: { deployments: [] },
  };
  assert.throws(
    () => createReleaseInventorySummary(plainInput, {
      requiredEnvNames: ["OPENAI_API_KEY", "not valid"],
    }),
    /INPUT_SHAPE_INVALID/,
  );

  const inheritedEnvelope = Object.create(plainInput);
  assert.throws(
    () => createReleaseInventorySummary(inheritedEnvelope),
    /INPUT_SHAPE_INVALID/,
  );

  const inheritedRow = Object.create({
    key: "OPENAI_API_KEY",
    type: "sensitive",
    target: ["production"],
  });
  assert.throws(
    () => createReleaseInventorySummary({
      ...plainInput,
      env: { envs: [inheritedRow] },
    }),
    /INPUT_SHAPE_INVALID/,
  );
});

test("rejects malformed nested provider records and ignores Object.prototype aliases", () => {
  for (const input of [
    {
      project: { link: "main", protectionBypass: {} },
      env: { envs: [] },
      deployments: { deployments: [] },
    },
    {
      project: { protectionBypass: {} },
      env: { envs: [] },
      deployments: {
        deployments: [{
          target: "production",
          state: "READY",
          createdAt: 1_783_834_320_000,
          meta: "provider-shape-drift",
        }],
      },
    },
  ]) {
    const result = runCli(input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INPUT_SHAPE_INVALID/);
    assert.equal(result.stderr.includes("provider-shape-drift"), false);
  }

  const descriptors = {
    name: Object.getOwnPropertyDescriptor(Object.prototype, "name"),
    type: Object.getOwnPropertyDescriptor(Object.prototype, "type"),
    deployments: Object.getOwnPropertyDescriptor(Object.prototype, "deployments"),
    meta: Object.getOwnPropertyDescriptor(Object.prototype, "meta"),
  };
  try {
    Object.defineProperties(Object.prototype, {
      name: { configurable: true, writable: true, value: "inherited-project" },
      type: { configurable: true, writable: true, value: "sensitive" },
      deployments: { configurable: true, writable: true, value: [] },
      meta: { configurable: true, writable: true, value: { githubCommitSha: SHA_A } },
    });
    const summary = createReleaseInventorySummary({
      project: { protectionBypass: {} },
      env: { envs: [] },
      deployments: { deployments: [] },
    });
    assert.equal(summary.project.name, null);
    assert.throws(
      () => createReleaseInventorySummary({
        project: { protectionBypass: {} },
        env: { envs: [{ key: "OPENAI_API_KEY", target: ["production"] }] },
        deployments: { deployments: [] },
      }),
      /INPUT_SHAPE_INVALID/,
    );
    const noInheritedMeta = createReleaseInventorySummary({
      project: { protectionBypass: {} },
      env: { envs: [] },
      deployments: {
        deployments: [{
          target: "preview",
          state: "READY",
          createdAt: 1_783_834_320_000,
        }],
      },
    });
    assert.equal(noInheritedMeta.deployments.withSha, 0);
    assert.throws(
      () => createReleaseInventorySummary({
        project: { protectionBypass: {} },
        env: { envs: [] },
        deployments: {},
      }),
      /INPUT_SHAPE_INVALID/,
    );
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
});
