import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
  AMORA_POST_EXPAND_TABLES,
  AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  AMORA_RELEASE_MIGRATION_VERSIONS,
  POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
} from "../lib/amora-release-extended-contracts.mjs";
import {
  buildLogicalDataDigestContractFromPayload,
  buildHostedRestoreReadOnlyProbeSql,
  buildHostedRestoreReceiptWithProvenance,
  buildProductionFenceReadOnlyProbeSql,
  buildProductionCanaryReceiptWithProvenance,
  buildVercelDeploymentReceipt,
  collectHostedRestoreEvidence,
  collectProductionCanaryEvidence,
  collectVercelDeploymentEvidence,
  ExternalGateProvenanceError,
  externalGateSha256,
  HOSTED_RESTORE_READ_ONLY_PROBE_SQL,
  PRODUCTION_CANARY_REQUIRED_CHECKS,
  productionExternalGateProvenanceTestHooks,
  runProductionCanaryHttpEvidence,
  validateExternalGateProvenanceFiles,
  validateHostedRestoreDatabaseUrl,
  validateHostedRestoreReceiptProvenance,
  validateProductionCanaryReceiptProvenance,
  validateVercelDeploymentReceiptProvenance,
} from "../lib/production-external-gate-provenance.mjs";

const RELEASE = "amora-engine-v2-20260716";
const SOURCE_REF = "slrtobkksjmxgzatjyqb";
const TARGET_REF = "t".repeat(20);
const TARGET_NAME = "wedding-hanbang-restore-drill-20260717-a";
const COMMIT = "a".repeat(40);
const TEAM_ID = "team_XwMZqiJ4wXM2Ypvs99icXaQx";
const PROJECT_ID = "prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes";
const DEPLOYMENT_ID = "dpl_abcdefghijklmnopqrstuvwxyz";
const PRODUCTION_HOST = "hanbang.ai";
const DEPLOYMENT_HOST = "wedding-hanbang-web-abc123.vercel.app";
const CREATED_AT = Date.parse("2026-07-17T01:00:00.000Z");
const READY_AT = Date.parse("2026-07-17T01:02:00.000Z");
const VERIFIED_AT = "2026-07-17T01:03:00.000Z";
const DEPLOYMENT_RAW_FILE = "vercel-deployment.raw.json";
const PROJECT_RAW_FILE = "supabase-project.raw.json";
const DATABASE_RAW_FILE = "hosted-restore-database.raw.json";
const CANARY_RAW_FILE = "production-canary-http.raw.json";
const VERCEL_SERVER_ERROR_RAW_FILE = "vercel-server-errors.raw.json";
const DATABASE_SYSTEM_IDENTIFIER = "7581440907192989109";
const TARGET_DATABASE_SYSTEM_IDENTIFIER = "7000000000000000002";
const LIVE_SCHEMA_CONTRACT_SHA256 = "A".repeat(64);
const EMPTY_CANONICAL_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function logicalDataPayload() {
  return {
    tables: Object.fromEntries(
      AMORA_POST_EXPAND_TABLES.map((name) => [
        name,
        {
          row_count: 0,
          rows: [],
          canonical_sha256: EMPTY_CANONICAL_SHA256,
        },
      ]),
    ),
  };
}

const LOGICAL_DATA_CONTRACT =
  buildLogicalDataDigestContractFromPayload(logicalDataPayload());

function logicalDataPsqlOutput(payload = logicalDataPayload()) {
  const json = JSON.stringify(payload);
  return `${json}|${Buffer.byteLength(json, "utf8")}\n`;
}

function allHostedRestoreChecks() {
  return Object.fromEntries(
    POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS.map((check) => [check, true]),
  );
}

function authHealth(overrides = {}) {
  return {
    runner: "supabase-auth-health-v1",
    targetProjectRef: TARGET_REF,
    endpoint: `https://${TARGET_REF}.supabase.co/auth/v1/health`,
    status: 200,
    bodySha256: externalGateSha256('{"version":"ok"}'),
    checkedAt: VERIFIED_AT,
    ...overrides,
  };
}

function vercelRaw(overrides = {}) {
  return `${JSON.stringify({
    id: DEPLOYMENT_ID,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    target: "production",
    readyState: "READY",
    url: DEPLOYMENT_HOST,
    alias: [PRODUCTION_HOST, `www.${PRODUCTION_HOST}`],
    createdAt: CREATED_AT,
    ready: READY_AT,
    meta: { githubCommitSha: COMMIT },
    ...overrides,
  })}\n`;
}

function buildDeployment(rawText = vercelRaw()) {
  return buildVercelDeploymentReceipt({
    rawText,
    rawEvidenceFileName: DEPLOYMENT_RAW_FILE,
    release: RELEASE,
    projectRef: SOURCE_REF,
    releaseCommit: COMMIT,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    deploymentId: DEPLOYMENT_ID,
    productionHost: PRODUCTION_HOST,
    verifiedAt: VERIFIED_AT,
  });
}

function projectRaw(overrides = {}) {
  return `${JSON.stringify({
    id: TARGET_REF,
    name: TARGET_NAME,
    status: "ACTIVE_HEALTHY",
    region: "ap-northeast-2",
    customEnvironment: null,
    ...overrides,
  })}\n`;
}

function databaseProbeRaw(overrides = {}) {
  return `${JSON.stringify({
    probeVersion: 1,
    transactionReadOnly: true,
    databaseName: "postgres",
    databaseSystemIdentifier: TARGET_DATABASE_SYSTEM_IDENTIFIER,
    targetTables: [...AMORA_POST_EXPAND_TABLES],
    targetReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
    leaseTableCount: 1,
    liveSchemaContractSha256: LIVE_SCHEMA_CONTRACT_SHA256,
    logicalDataContract: LOGICAL_DATA_CONTRACT.contract,
    logicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    authHealth: authHealth(),
    checks: allHostedRestoreChecks(),
    checkedAt: VERIFIED_AT,
    ...overrides,
  })}\n`;
}

function databaseCoreProbeRaw(overrides = {}) {
  return `${JSON.stringify({
    probeVersion: 1,
    transactionReadOnly: true,
    databaseName: "postgres",
    databaseSystemIdentifier: TARGET_DATABASE_SYSTEM_IDENTIFIER,
    targetTables: [...AMORA_POST_EXPAND_TABLES],
    targetReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
    leaseTableCount: 1,
    liveSchemaContractSha256: LIVE_SCHEMA_CONTRACT_SHA256,
    checkedAt: VERIFIED_AT,
    ...overrides,
  })}\n`;
}

function hostedBaseReceipt() {
  return {
    receiptVersion: 1,
    kind: "post-expand-hosted-restore-evidence",
    release: RELEASE,
    releaseCommit: COMMIT,
    sourceProjectRef: SOURCE_REF,
    targetProjectRef: TARGET_REF,
    targetTables: [...AMORA_POST_EXPAND_TABLES],
    targetReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
    targetTableContractSha256: AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
    targetReleaseMigrationContractSha256:
      AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
    sourceLiveSchemaContractSha256: LIVE_SCHEMA_CONTRACT_SHA256,
    targetLiveSchemaContractSha256: LIVE_SCHEMA_CONTRACT_SHA256,
    sourceLogicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    targetLogicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    checks: allHostedRestoreChecks(),
    verifiedAt: VERIFIED_AT,
  };
}

function buildHostedRestore(
  rawProject = projectRaw(),
  rawDatabase = databaseProbeRaw(),
  baseReceipt = hostedBaseReceipt(),
) {
  return buildHostedRestoreReceiptWithProvenance({
    baseReceipt,
    projectRawText: rawProject,
    projectRawEvidenceFileName: PROJECT_RAW_FILE,
    databaseProbeRawText: rawDatabase,
    databaseProbeRawEvidenceFileName: DATABASE_RAW_FILE,
    databaseHost: `db.${TARGET_REF}.supabase.co`,
    targetProjectName: TARGET_NAME,
  });
}

function allCanaryChecks() {
  return Object.fromEntries(
    PRODUCTION_CANARY_REQUIRED_CHECKS.map((check) => [check, true]),
  );
}

function makeCanaryHarness({
  wrongCommit = false,
  publicStatus = 200,
  publicUrl = `https://${PRODUCTION_HOST}/wedding`,
} = {}) {
  const start = Date.parse("2026-07-17T01:10:00.000Z");
  let phase = "start";
  let tick = 0;
  return {
    now() {
      const phaseOffset = phase === "finish" ? 300_000 : 0;
      return new Date(start + phaseOffset + tick++);
    },
    async wait(milliseconds) {
      assert.equal(milliseconds, 300_000);
      phase = "finish";
      tick = 0;
    },
    async fetch(url, options) {
      const parsed = new URL(url);
      if (parsed.pathname === "/wedding") {
        return response({
          status: publicStatus,
          url: publicUrl,
          body: "<html>웨딩한방</html>",
          headers: { "cache-control": "public, max-age=0" },
        });
      }
      assert.equal(options.method, "POST");
      return response({
        status: 503,
        url,
        body: JSON.stringify({ error: "production_write_fence_enabled" }),
        headers: {
          "cache-control": "private, no-store",
          "x-hanbang-deployment-commit": wrongCommit ? "b".repeat(40) : COMMIT,
        },
      });
    },
    async browserRunner(context) {
      const startedAt = context.now();
      const completedAt = context.now();
      return {
        evidenceVersion: 1,
        runner: "playwright-core-public-v1",
        expectedHost: PRODUCTION_HOST,
        pagePath: "/wedding",
        finalUrl: `https://${PRODUCTION_HOST}/wedding`,
        status: 200,
        consoleErrorHashes: [],
        pageErrorHashes: [],
        requestFailureHashes: [],
        navigationDurationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        containsSecrets: false,
      };
    },
    async authenticatedSessionRunner(context) {
      const startedAt = context.now();
      const completedAt = context.now();
      return {
        evidenceVersion: 1,
        runner: "supabase-auth-rest-v1",
        projectRef: SOURCE_REF,
        userIdSha256: "c".repeat(64),
        loginStatus: 200,
        authenticatedReadStatus: 200,
        authenticatedReadRowCount: 1,
        logoutStatus: 204,
        refreshAfterLogoutStatus: 400,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        containsSecrets: false,
      };
    },
    async databaseFenceRunner(context) {
      const checkedAt = context.now().toISOString();
      return {
        probeVersion: 1,
        transactionReadOnly: true,
        databaseName: "postgres",
        projectRef: SOURCE_REF,
        databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
        productionWriteFenceVerifiedCount: 1,
        checkedAt,
        probeSqlSha256: externalGateSha256(
          buildProductionFenceReadOnlyProbeSql({ projectRef: SOURCE_REF }),
        ),
      };
    },
    async vercelServerErrorRunner() {
      return "[]\n";
    },
  };
}

function response({ status, url, body, headers = {} }) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    status,
    url,
    headers: {
      get(name) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    async text() {
      return body;
    },
  };
}

function auxiliaryRunnerArguments(harness) {
  return {
    projectRef: SOURCE_REF,
    databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
    deploymentReady: true,
    browserRunner: harness.browserRunner,
    authenticatedSessionRunner: harness.authenticatedSessionRunner,
    databaseFenceRunner: harness.databaseFenceRunner,
    vercelServerErrorRunner: harness.vercelServerErrorRunner,
  };
}

async function buildCanary(deploymentRawSha256) {
  const harness = makeCanaryHarness();
  const evidence = await runProductionCanaryHttpEvidence({
    fetchImpl: harness.fetch,
    expectedHost: PRODUCTION_HOST,
    expectedCommit: COMMIT,
    deploymentRawEvidenceSha256: deploymentRawSha256,
    projectRef: SOURCE_REF,
    databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
    deploymentReady: true,
    browserRunner: harness.browserRunner,
    authenticatedSessionRunner: harness.authenticatedSessionRunner,
    databaseFenceRunner: harness.databaseFenceRunner,
    vercelServerErrorRunner: harness.vercelServerErrorRunner,
    now: harness.now,
    wait: harness.wait,
  });
  const baseReceipt = {
    receiptVersion: 1,
    kind: "production-write-fenced-canary",
    release: RELEASE,
    projectRef: SOURCE_REF,
    releaseCommit: COMMIT,
    observationStartedAt: evidence.raw.observationStartedAt,
    verifiedAt: evidence.raw.verifiedAt,
    expiresAt: new Date(
      Date.parse(evidence.raw.verifiedAt) + 15 * 60_000,
    ).toISOString(),
    observationWindowSeconds: 300,
    checks: allCanaryChecks(),
    containsSecrets: false,
  };
  return {
    evidence,
    receipt: buildProductionCanaryReceiptWithProvenance({
      baseReceipt,
      rawText: evidence.rawText,
      rawEvidenceFileName: CANARY_RAW_FILE,
      vercelServerErrorRawText: evidence.vercelServerErrorRawText,
      vercelServerErrorRawEvidenceFileName: VERCEL_SERVER_ERROR_RAW_FILE,
      expectedHost: PRODUCTION_HOST,
      expectedCommit: COMMIT,
      deploymentRawEvidenceSha256: deploymentRawSha256,
      databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
    }),
  };
}

function isBlocked(code) {
  return (error) => {
    assert.ok(error instanceof ExternalGateProvenanceError);
    assert.equal(error.code, code);
    return true;
  };
}

test("Vercel evidence binds the exact team, project, production alias and commit", () => {
  const rawText = vercelRaw();
  const receipt = buildDeployment(rawText);
  const evidence = validateVercelDeploymentReceiptProvenance({
    receipt,
    rawText,
    expected: {
      releaseCommit: COMMIT,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      productionHost: PRODUCTION_HOST,
    },
  });
  assert.equal(evidence.rawSha256, externalGateSha256(rawText));
  assert.equal(receipt.provenance.productionHost, PRODUCTION_HOST);
  assert.equal(receipt.deploymentUrl, `https://${DEPLOYMENT_HOST}`);
});

test("Vercel validator fails closed on provider, target and secret-bearing mutations", () => {
  for (const rawText of [
    vercelRaw({ teamId: `team_${"z".repeat(20)}` }),
    vercelRaw({ projectId: `prj_${"z".repeat(20)}` }),
    vercelRaw({ target: "preview" }),
    vercelRaw({ readyState: "ERROR" }),
    vercelRaw({ alias: [`www.${PRODUCTION_HOST}`] }),
    vercelRaw({ meta: { githubCommitSha: "b".repeat(40) } }),
    vercelRaw({ env: { OPENAI_API_KEY: "redacted" } }),
  ]) {
    assert.throws(() => buildDeployment(rawText), ExternalGateProvenanceError);
  }
  const rawText = vercelRaw();
  const receipt = buildDeployment(rawText);
  receipt.provenance.rawEvidenceSha256 = "f".repeat(64);
  assert.throws(
    () => validateVercelDeploymentReceiptProvenance({
      receipt,
      rawText,
      expected: {
        releaseCommit: COMMIT,
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        productionHost: PRODUCTION_HOST,
      },
    }),
    isBlocked("VERCEL_RECEIPT_PROVENANCE_INVALID"),
  );
});

test("hosted restore evidence is a different named target plus a read-only DB probe", () => {
  assert.match(HOSTED_RESTORE_READ_ONLY_PROBE_SQL, /^BEGIN TRANSACTION READ ONLY;/);
  assert.match(HOSTED_RESTORE_READ_ONLY_PROBE_SQL, /ROLLBACK;$/);
  assert.equal(
    buildHostedRestoreReadOnlyProbeSql(),
    HOSTED_RESTORE_READ_ONLY_PROBE_SQL,
  );
  const password = encodeURIComponent("correct-horse-battery-staple");
  const connection = validateHostedRestoreDatabaseUrl(
    `postgresql://postgres:${password}@db.${TARGET_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    TARGET_REF,
  );
  assert.equal(connection.host, `db.${TARGET_REF}.supabase.co`);
  assert.equal(connection.password, "correct-horse-battery-staple");
  const rawProject = projectRaw();
  const rawDatabase = databaseProbeRaw();
  const receipt = buildHostedRestore(rawProject, rawDatabase);
  const evidence = validateHostedRestoreReceiptProvenance({
    receipt,
    projectRawText: rawProject,
    databaseProbeRawText: rawDatabase,
    expected: {
      expectedTables: AMORA_POST_EXPAND_TABLES,
      expectedMigrationVersions: AMORA_RELEASE_MIGRATION_VERSIONS,
    },
  });
  assert.equal(evidence.raw.transactionReadOnly, true);
  assert.equal(receipt.provenance.targetProjectName, TARGET_NAME);
});

test("production canary DB probe pins the complete two-trigger fence contract", () => {
  const sql = buildProductionFenceReadOnlyProbeSql({ projectRef: SOURCE_REF });
  assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/);
  assert.match(sql, /ROLLBACK;$/);
  assert.match(sql, /9053c6d394854777b878bd219203b06a/);
  assert.match(sql, /96ee93c897faa81bae68c8c65e29610b/);
  assert.match(sql, /evt_production_write_fence_ddl_lock_20260717/);
  assert.match(sql, /evtfoid[\s\S]*\) = 2/);
});

test("hosted restore validator rejects source/pooler targets and forged probe results", () => {
  const password = "correct-horse-battery-staple";
  for (const databaseUrl of [
    `postgresql://postgres:${password}@db.${SOURCE_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    `postgresql://postgres:${password}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
    `postgresql://postgres:short@db.${TARGET_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    `postgresql://postgres:${password}@db.${TARGET_REF}.supabase.co:5432/postgres?sslmode=disable`,
  ]) {
    assert.throws(
      () => validateHostedRestoreDatabaseUrl(databaseUrl, TARGET_REF),
      ExternalGateProvenanceError,
    );
  }
  assert.throws(
    () => buildHostedRestore(
      projectRaw({ id: SOURCE_REF }),
      databaseProbeRaw(),
    ),
    ExternalGateProvenanceError,
  );
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw({ transactionReadOnly: false }),
    ),
    ExternalGateProvenanceError,
  );
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw({
        databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
      }),
    ),
    ExternalGateProvenanceError,
  );
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw({
        targetTables: AMORA_POST_EXPAND_TABLES.slice(1),
      }),
    ),
    ExternalGateProvenanceError,
  );
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw({
        liveSchemaContractSha256: "B".repeat(64),
      }),
    ),
    ExternalGateProvenanceError,
  );
  const forgedLogicalContract = structuredClone(LOGICAL_DATA_CONTRACT.contract);
  forgedLogicalContract[0].canonical_sha256 = "B".repeat(64);
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw({
        logicalDataContract: forgedLogicalContract,
        logicalDataContractSha256: externalGateSha256(
          JSON.stringify(forgedLogicalContract),
        ).toUpperCase(),
      }),
    ),
    ExternalGateProvenanceError,
  );
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw({ authHealth: authHealth({ status: 503 }) }),
    ),
    ExternalGateProvenanceError,
  );
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw({
        checks: {
          ...allHostedRestoreChecks(),
          authApiSmokeVerified: false,
        },
      }),
    ),
    ExternalGateProvenanceError,
  );
  assert.throws(
    () => buildHostedRestore(
      projectRaw(),
      databaseProbeRaw(),
      {
        ...hostedBaseReceipt(),
        checks: {
          ...allHostedRestoreChecks(),
          authApiSmokeVerified: false,
        },
      },
    ),
    ExternalGateProvenanceError,
  );
});

test("production canary runner makes exact start/finish HTTP observations", async () => {
  const deploymentRawSha256 = externalGateSha256(vercelRaw());
  const { evidence, receipt } = await buildCanary(deploymentRawSha256);
  assert.equal(evidence.raw.observations.length, 8);
  assert.deepEqual(
    evidence.raw.observations.map(({ id }) => id),
    ["start", "finish"].flatMap((phase) =>
      productionExternalGateProvenanceTestHooks.CANARY_HTTP_PROBES.map(
        (probe) => `${phase}:${probe.id}`,
      )),
  );
  const validated = validateProductionCanaryReceiptProvenance({
    receipt,
    rawText: evidence.rawText,
    expected: {
      expectedHost: PRODUCTION_HOST,
      expectedCommit: COMMIT,
      deploymentRawEvidenceSha256: deploymentRawSha256,
      requiredChecks: PRODUCTION_CANARY_REQUIRED_CHECKS,
      databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
      vercelServerErrorRawText: evidence.vercelServerErrorRawText,
    },
  });
  assert.equal(validated.rawSha256, evidence.rawSha256);
});

test("production canary fails on redirects, wrong commits and derived-check failures", async () => {
  const deploymentRawEvidenceSha256 = externalGateSha256(vercelRaw());
  for (const harness of [
    makeCanaryHarness({ publicStatus: 307 }),
    makeCanaryHarness({ publicUrl: "https://evil.example/wedding" }),
    makeCanaryHarness({ wrongCommit: true }),
  ]) {
    await assert.rejects(
      runProductionCanaryHttpEvidence({
        fetchImpl: harness.fetch,
        expectedHost: PRODUCTION_HOST,
        expectedCommit: COMMIT,
        deploymentRawEvidenceSha256,
        ...auxiliaryRunnerArguments(harness),
        now: harness.now,
        wait: harness.wait,
      }),
      ExternalGateProvenanceError,
    );
  }
  const harness = makeCanaryHarness();
  const dirtyBrowserRunner = async (context) => ({
    ...await harness.browserRunner(context),
    consoleErrorHashes: ["d".repeat(64)],
  });
  await assert.rejects(
    runProductionCanaryHttpEvidence({
      fetchImpl: harness.fetch,
      expectedHost: PRODUCTION_HOST,
      expectedCommit: COMMIT,
      deploymentRawEvidenceSha256,
      ...auxiliaryRunnerArguments(harness),
      browserRunner: dirtyBrowserRunner,
      now: harness.now,
      wait: harness.wait,
    }),
    ExternalGateProvenanceError,
  );
});

test("canary raw validator rejects semantic tampering even when re-hashed", async () => {
  const deploymentRawEvidenceSha256 = externalGateSha256(vercelRaw());
  const { evidence, receipt } = await buildCanary(deploymentRawEvidenceSha256);
  const scenarios = [
    (raw) => { raw.expectedHost = "evil.example"; },
    (raw) => { raw.observations[0].finalUrl = "not-a-url"; },
    (raw) => { raw.observations[0].unexpected = true; },
    (raw) => { raw.observations[4].startedAt = raw.observationStartedAt; },
    (raw) => { raw.observations[1].deploymentCommit = "b".repeat(40); },
    (raw) => { delete raw.checks.browserConsoleClean; },
  ];
  for (const mutate of scenarios) {
    const raw = structuredClone(evidence.raw);
    mutate(raw);
    const rawText = `${JSON.stringify(raw, null, 2)}\n`;
    const alteredReceipt = structuredClone(receipt);
    alteredReceipt.provenance.rawHttpObservationsSha256 =
      externalGateSha256(rawText);
    assert.throws(
      () => validateProductionCanaryReceiptProvenance({
        receipt: alteredReceipt,
        rawText,
        expected: {
          expectedHost: PRODUCTION_HOST,
          expectedCommit: COMMIT,
          deploymentRawEvidenceSha256,
          requiredChecks: PRODUCTION_CANARY_REQUIRED_CHECKS,
          databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
          vercelServerErrorRawText: evidence.vercelServerErrorRawText,
        },
      }),
      ExternalGateProvenanceError,
    );
  }
});

test("collectors use injected provider/DB clients and write bounded external evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hanbang-external-gates-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  let vercelAuthorization;
  const deployment = await collectVercelDeploymentEvidence({
    repoRoot: process.cwd(),
    fetchImpl: async (_url, options) => {
      vercelAuthorization = options.headers.authorization;
      return response({ status: 200, url: "", body: vercelRaw() });
    },
    vercelToken: "v".repeat(32),
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    deploymentId: DEPLOYMENT_ID,
    productionHost: PRODUCTION_HOST,
    release: RELEASE,
    projectRef: SOURCE_REF,
    releaseCommit: COMMIT,
    rawEvidencePath: join(root, DEPLOYMENT_RAW_FILE),
    receiptPath: join(root, "deployment.receipt.json"),
    now: () => new Date(VERIFIED_AT),
  });
  assert.equal(vercelAuthorization, `Bearer ${"v".repeat(32)}`);
  assert.equal(deployment.provenance.rawEvidenceSha256, externalGateSha256(vercelRaw()));

  let observedConnection;
  const hosted = await collectHostedRestoreEvidence({
    repoRoot: process.cwd(),
    fetchImpl: async (url) => {
      if (url === `https://${TARGET_REF}.supabase.co/auth/v1/health`) {
        return response({
          status: 200,
          url,
          body: '{"version":"ok"}',
        });
      }
      assert.equal(
        url,
        `https://api.supabase.com/v1/projects/${TARGET_REF}`,
      );
      return response({ status: 200, url, body: projectRaw() });
    },
    runPsql: async ({ sql, connection }) => {
      observedConnection = connection;
      assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/i);
      return {
        status: 0,
        stdout: sql === HOSTED_RESTORE_READ_ONLY_PROBE_SQL
          ? databaseCoreProbeRaw()
          : logicalDataPsqlOutput(),
        stderrBytes: 0,
        outputTruncated: false,
      };
    },
    supabaseAccessToken: "u".repeat(32),
    databaseUrl:
      `postgresql://postgres:correct-horse-battery-staple@db.${TARGET_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    baseReceipt: hostedBaseReceipt(),
    targetProjectName: TARGET_NAME,
    projectRawEvidencePath: join(root, PROJECT_RAW_FILE),
    databaseProbeRawEvidencePath: join(root, DATABASE_RAW_FILE),
    receiptPath: join(root, "hosted.receipt.json"),
    now: () => new Date(VERIFIED_AT),
  });
  assert.equal(observedConnection.host, `db.${TARGET_REF}.supabase.co`);
  assert.equal(hosted.provenance.transactionReadOnly, true);

  const harness = makeCanaryHarness();
  const canary = await collectProductionCanaryEvidence({
    repoRoot: process.cwd(),
    rawEvidencePath: join(root, CANARY_RAW_FILE),
    vercelServerErrorRawEvidencePath: join(
      root,
      VERCEL_SERVER_ERROR_RAW_FILE,
    ),
    receiptPath: join(root, "canary.receipt.json"),
    baseReceipt: {
      receiptVersion: 1,
      kind: "production-write-fenced-canary",
      release: RELEASE,
      projectRef: SOURCE_REF,
      releaseCommit: COMMIT,
      containsSecrets: false,
    },
    deploymentReceipt: deployment,
    expectedHost: PRODUCTION_HOST,
    expectedCommit: COMMIT,
    browserRunner: harness.browserRunner,
    authenticatedSessionRunner: harness.authenticatedSessionRunner,
    databaseFenceRunner: harness.databaseFenceRunner,
    vercelServerErrorRunner: harness.vercelServerErrorRunner,
    fetchImpl: harness.fetch,
    now: harness.now,
    wait: harness.wait,
  });
  assert.equal(canary.provenance.expectedCommit, COMMIT);
});

test("aggregate validator follows only sibling raw files and detects post-receipt tampering", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hanbang-external-validation-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const deploymentRawText = vercelRaw();
  const deployment = buildDeployment(deploymentRawText);
  const projectRawText = projectRaw();
  const databaseRawText = databaseProbeRaw();
  const hostedRestore = buildHostedRestore(projectRawText, databaseRawText);
  const { evidence: canaryEvidence, receipt: canary } = await buildCanary(
    externalGateSha256(deploymentRawText),
  );
  const deploymentReceiptPath = join(root, "deployment.receipt.json");
  const hostedRestoreReceiptPath = join(root, "hosted.receipt.json");
  const canaryReceiptPath = join(root, "canary.receipt.json");
  await Promise.all([
    writeFile(join(root, DEPLOYMENT_RAW_FILE), deploymentRawText),
    writeFile(join(root, PROJECT_RAW_FILE), projectRawText),
    writeFile(join(root, DATABASE_RAW_FILE), databaseRawText),
    writeFile(join(root, CANARY_RAW_FILE), canaryEvidence.rawText),
    writeFile(
      join(root, VERCEL_SERVER_ERROR_RAW_FILE),
      canaryEvidence.vercelServerErrorRawText,
    ),
  ]);
  const expected = {
    releaseCommit: COMMIT,
    vercelTeamId: TEAM_ID,
    vercelProjectId: PROJECT_ID,
    productionHost: PRODUCTION_HOST,
    expectedTables: AMORA_POST_EXPAND_TABLES,
    expectedMigrationVersions: AMORA_RELEASE_MIGRATION_VERSIONS,
    requiredCanaryChecks: PRODUCTION_CANARY_REQUIRED_CHECKS,
  };
  const validated = await validateExternalGateProvenanceFiles({
    deploymentReceipt: deployment,
    deploymentReceiptPath,
    hostedRestoreReceipt: hostedRestore,
    hostedRestoreReceiptPath,
    canaryReceipt: canary,
    canaryReceiptPath,
    expected,
  });
  assert.equal(
    validated.canaryRawHttpObservationsSha256,
    canaryEvidence.rawSha256,
  );

  await writeFile(join(root, CANARY_RAW_FILE), `${canaryEvidence.rawText} `);
  await assert.rejects(
    validateExternalGateProvenanceFiles({
      deploymentReceipt: deployment,
      deploymentReceiptPath,
      hostedRestoreReceipt: hostedRestore,
      hostedRestoreReceiptPath,
      canaryReceipt: canary,
      canaryReceiptPath,
      expected,
    }),
    isBlocked("CANARY_RAW_EVIDENCE_FILE_INVALID"),
  );

  const traversal = structuredClone(deployment);
  traversal.provenance.rawEvidenceFileName = "../vercel-deployment.raw.json";
  await assert.rejects(
    validateExternalGateProvenanceFiles({
      deploymentReceipt: traversal,
      deploymentReceiptPath,
      hostedRestoreReceipt: hostedRestore,
      hostedRestoreReceiptPath,
      canaryReceipt: canary,
      canaryReceiptPath,
      expected,
    }),
    ExternalGateProvenanceError,
  );
});
