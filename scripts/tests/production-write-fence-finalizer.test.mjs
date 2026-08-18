import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  ProductionWriteFenceFinalizerError,
  productionWriteFenceFinalizerTestHooks,
  renderProductionWriteFenceFinalizerSql,
  runProductionWriteFenceFinalizer,
} from "../lib/production-write-fence-finalizer.mjs";
import {
  AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
  AMORA_POST_EXPAND_TABLES,
  AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  AMORA_RELEASE_MIGRATION_VERSIONS,
  FINALIZER_EXTERNAL_EVIDENCE_CONTRACT,
  POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
} from "../lib/amora-release-extended-contracts.mjs";
import {
  buildHostedRestoreReceiptWithProvenance,
  buildLogicalDataDigestContractFromPayload,
  buildProductionCanaryReceiptWithProvenance,
  buildProductionFenceReadOnlyProbeSql,
  buildVercelDeploymentReceipt,
  externalGateSha256,
  runProductionCanaryHttpEvidence,
} from "../lib/production-external-gate-provenance.mjs";
import {
  attachSuccessorRemoteBaselineFixture,
  SUCCESSOR_REMOTE_BASELINE_FIXTURE_PATH,
} from "./helpers/successor-remote-baseline-fixture.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const RELEASE = "test-release";
const COMMIT = "a".repeat(40);
const OWNER = "12345678-1234-4234-8234-123456789abc";
const OUTCOME_PATH_SHA = "b".repeat(64);
const CLI_SHA = "C".repeat(64);
const ORIGIN = "https://github.com/example/wedding-hanbang.git";
const REMOTE_REF = "origin/release-finalizer";
const DEPLOYMENT_ID = "dpl_1234567890abcdefghijklmn";
const DEPLOYMENT_URL = "https://wedding-hanbang.vercel.app";
const NOW = new Date("2026-07-17T03:20:00.000Z");
const BACKUP_SET_ID = "22345678-1234-4234-8234-123456789abc";
const INVENTORY_SHA = "D".repeat(64);
const RELATION_SHA = "E".repeat(64);
const LIVE_SCHEMA_SHA = "A".repeat(64);
const EMPTY_CANONICAL_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const DATABASE_SYSTEM_IDENTIFIER = "7000000000000000001";
const TARGET_DATABASE_SYSTEM_IDENTIFIER = "7000000000000000002";
const TARGET_PROJECT_REF = "bcdefghijklmnopqrstu";
const TARGET_PROJECT_NAME = "wedding-hanbang-restore-drill-20260717-test";
const DEPLOYMENT_RAW_FILE = "vercel-deployment.raw.json";
const HOSTED_PROJECT_RAW_FILE = "supabase-project.raw.json";
const HOSTED_DATABASE_RAW_FILE = "hosted-restore-database.raw.json";
const CANARY_RAW_FILE = "production-canary-http.raw.json";
const VERCEL_SERVER_ERROR_RAW_FILE = "vercel-server-errors.raw.json";
const logicalDataPayload = {
  tables: Object.fromEntries(
    AMORA_POST_EXPAND_TABLES.map((name) => [name, {
      row_count: 0,
      rows: [],
      canonical_sha256: EMPTY_CANONICAL_SHA256,
    }]),
  ),
};
const LOGICAL_DATA_CONTRACT =
  buildLogicalDataDigestContractFromPayload(logicalDataPayload);
const sourceRepoRoot = resolve(import.meta.dirname, "../..");
const sourceSql = join(
  sourceRepoRoot,
  "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
);

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function canonicalSqlSha(path) {
  return sha256Text((await readFile(path, "utf8")).replace(/\r\n?/g, "\n"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function createCanaryHarness() {
  const start = Date.parse("2026-07-17T03:05:00.000Z");
  let phase = "start";
  let tick = 0;
  const now = () => {
    const phaseOffset = phase === "finish" ? 300_000 : 0;
    return new Date(start + phaseOffset + tick++);
  };
  return {
    now,
    async wait(milliseconds) {
      assert.equal(milliseconds, 300_000);
      phase = "finish";
      tick = 0;
    },
    async fetch(url, options) {
      const parsed = new URL(url);
      if (parsed.pathname === "/wedding") {
        return response({
          status: 200,
          url,
          body: "<html>Wedding Hanbang</html>",
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
          "x-hanbang-deployment-commit": COMMIT,
        },
      });
    },
    async browserRunner(context) {
      const startedAt = context.now();
      const completedAt = context.now();
      return {
        evidenceVersion: 1,
        runner: "playwright-core-public-v1",
        expectedHost: "hanbang.ai",
        pagePath: "/wedding",
        finalUrl: "https://hanbang.ai/wedding",
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
        projectRef: PROJECT_REF,
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
      return {
        probeVersion: 1,
        transactionReadOnly: true,
        databaseName: "postgres",
        projectRef: PROJECT_REF,
        databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
        productionWriteFenceVerifiedCount: 1,
        checkedAt: context.now().toISOString(),
        probeSqlSha256: externalGateSha256(
          buildProductionFenceReadOnlyProbeSql({ projectRef: PROJECT_REF }),
        ),
      };
    },
    async vercelServerErrorRunner() {
      return "[]\n";
    },
  };
}

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "hanbang-finalizer-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "hanbang-finalizer-receipts-"));
  const sqlPath = join(
    repoRoot,
    "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
  );
  const manifestPath = join(
    repoRoot,
    "supabase/release-manifests/amora-engine-v2-20260716.json",
  );
  const tempRoot = join(repoRoot, "supabase/.temp");
  await mkdir(join(repoRoot, "supabase/platform-operations/security"), { recursive: true });
  await mkdir(join(repoRoot, "supabase/release-manifests"), { recursive: true });
  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await mkdir(tempRoot, { recursive: true });
  await copyFile(sourceSql, sqlPath);
  const postExpandCapturePath = join(repoRoot, "scripts/amora-db-backup.ps1");
  const postExpandVerifierPath = join(
    repoRoot,
    "scripts/amora-db-verify-backup.ps1",
  );
  await writeFile(postExpandCapturePath, "# pinned capture fixture\n", "utf8");
  await writeFile(postExpandVerifierPath, "# pinned verifier fixture\n", "utf8");
  const operationSha = await canonicalSqlSha(sqlPath);
  const postExpandCaptureSha = await canonicalSqlSha(postExpandCapturePath);
  const postExpandVerifierSha = await canonicalSqlSha(postExpandVerifierPath);
  const requiredCanaryChecks = [
    ...productionWriteFenceFinalizerTestHooks.requiredCanaryChecks,
  ];
  const manifest = {
    release: RELEASE,
    projectRef: PROJECT_REF,
    backupContract: {
      expectedOrigin: ORIGIN,
      supabaseCli: {
        version: "2.106.0",
        binarySha256: CLI_SHA,
      },
    },
    postPushChecks: [{
      id: "fixture-post-push-check",
      expectedEvidence: { storage_policy_count: 1 },
    }],
    postApplyChecks: [{
      id: "fixture-post-apply-check",
      expectedEvidence: { post_release_contract_verified_count: 1 },
    }],
    forwardOnlySecurityOperations: [{
      id: "ai-log-retention-exact-acl-20260717141000",
      phase: "pre-backup",
      verificationCheckId: "ai-log-retention-exact-acl",
      rollbackPolicy: "forward-fix-only-no-privilege-restoration",
      supersedes: {
        operationId: "ai-log-retention-acl-hotfix-20260717103000",
        forbiddenFiles: [
          "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_inventory.sql",
          "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_apply.sql",
          "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_verify.sql",
        ],
      },
      inventory: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_inventory.sql",
        sha256: "1".repeat(64),
      },
      apply: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
        sha256: "2".repeat(64),
      },
      verify: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
        sha256: "3".repeat(64),
        expectedEvidence: { ai_log_retention_exact_acl_verified: 1 },
      },
    }],
    postExpandBackupContract: {
      id: "post-amora-engine-v2-27-table-backup",
      version: 1,
      phase: "post-push-pre-deployment-canary",
      verificationReceiptFileName:
        `${RELEASE}-post-expand-backup-verification.json`,
      maximumAgeMinutes: 1440,
      expectedTableCount: AMORA_POST_EXPAND_TABLES.length,
      expectedTables: [...AMORA_POST_EXPAND_TABLES],
      expectedReleaseMigrationBaselineHead: "20260715210000",
      expectedReleaseMigrationHead: "20260716117000",
      expectedReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
      expectedTableContractSha256: AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
      expectedReleaseMigrationContractSha256:
        AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
      expectedCommitBinding: "release-expected-commit",
      requiredLedgerEvidence:
        "live-remote-ledger-and-encrypted-backup-contract",
      requiredReceiptValues: {
        Verified: true,
        SourceCanonicalDigestsVerified: true,
        PGliteJsonbRoundTripVerified: true,
        PlaintextWrittenToDisk: false,
      },
      capture: {
        file: "scripts/amora-db-backup.ps1",
        sha256: postExpandCaptureSha,
      },
      verifier: {
        file: "scripts/amora-db-verify-backup.ps1",
        sha256: postExpandVerifierSha,
      },
      hostedRestoreEvidence: {
        receiptFileName:
          `${RELEASE}-post-expand-hosted-restore-evidence.json`,
        maximumAgeMinutes: 1440,
        requiredTargetIsolation: "different-supabase-project",
        requiredChecks: [...POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS],
      },
    },
    finalizationContract: {
      id: "production-write-fence-exact-owner-finalizer",
      version: 1,
      operation: {
        id: "production-write-fence-finalize-20260717121000",
        file: "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
        sha256: operationSha,
      },
      requiredLeasePhase: "deployment-canary",
      canaryMaximumAgeMinutes: 15,
      deploymentMaximumAgeMinutes: 1440,
      requiredCanaryChecks,
      externalEvidence: structuredClone(FINALIZER_EXTERNAL_EVIDENCE_CONTRACT),
      confirmationIncludesCanarySha256: true,
    },
  };
  await writeJson(manifestPath, manifest);
  await writeFile(join(tempRoot, "project-ref"), `${PROJECT_REF}\n`, "utf8");

  const outcomePath = join(receiptRoot, "release-outcome.json");
  const deploymentPath = join(receiptRoot, "deployment.json");
  const postExpandBackupPath = join(
    receiptRoot,
    `${RELEASE}-post-expand-backup-verification.json`,
  );
  const postExpandHostedRestorePath = join(
    receiptRoot,
    `${RELEASE}-post-expand-hosted-restore-evidence.json`,
  );
  const canaryPath = join(receiptRoot, "canary.json");
  const receiptOut = join(receiptRoot, "finalization.json");
  const lockPath = join(tempRoot, "amora-production-release.lock");
  const outcomePathSha256 = sha256Text(resolve(outcomePath));
  const outcome = {
    receiptVersion: 1,
    status: "database_expand_verified_lease_held",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    remoteRef: REMOTE_REF,
    remoteReleaseLeaseOwnerId: OWNER,
    remoteReleaseLeaseOutcomePathSha256: outcomePathSha256,
    remoteReleaseLeasePhase: "deployment-canary",
    postPendingCount: 0,
    postPushCheckIds: ["fixture-post-push-check"],
    postPushCheckCount: 1,
    postPushCheckEvidence: [{
      id: "fixture-post-push-check",
      evidence: { storage_policy_count: 1 },
    }],
    postApplyCheckIds: ["fixture-post-apply-check"],
    postApplyCheckCount: 1,
    postApplyCheckEvidence: [{
      id: "fixture-post-apply-check",
      evidence: { post_release_contract_verified_count: 1 },
    }],
    postconditionsPassed: 2,
    completedAt: "2026-07-17T03:00:00.000Z",
    supabaseCliVersion: "2.106.0",
    supabaseCliBinarySha256: CLI_SHA,
    rerunProhibited: true,
    containsSecrets: false,
  };
  await writeJson(outcomePath, outcome);
  const outcomeSha = await sha256File(outcomePath);
  const deploymentRawText = `${JSON.stringify({
    id: DEPLOYMENT_ID,
    teamId: FINALIZER_EXTERNAL_EVIDENCE_CONTRACT.vercel.teamId,
    projectId: FINALIZER_EXTERNAL_EVIDENCE_CONTRACT.vercel.projectId,
    target: "production",
    readyState: "READY",
    url: new URL(DEPLOYMENT_URL).hostname,
    alias: ["hanbang.ai", "www.hanbang.ai"],
    createdAt: Date.parse("2026-07-17T02:50:00.000Z"),
    ready: Date.parse("2026-07-17T02:59:00.000Z"),
    meta: { githubCommitSha: COMMIT },
  })}\n`;
  const deployment = buildVercelDeploymentReceipt({
    rawText: deploymentRawText,
    rawEvidenceFileName: DEPLOYMENT_RAW_FILE,
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    teamId: FINALIZER_EXTERNAL_EVIDENCE_CONTRACT.vercel.teamId,
    projectId: FINALIZER_EXTERNAL_EVIDENCE_CONTRACT.vercel.projectId,
    deploymentId: DEPLOYMENT_ID,
    productionHost: "hanbang.ai",
    verifiedAt: "2026-07-17T03:00:00.000Z",
  });
  await writeFile(
    join(receiptRoot, DEPLOYMENT_RAW_FILE),
    deploymentRawText,
    "utf8",
  );
  await writeJson(deploymentPath, deployment);
  const deploymentSha = await sha256File(deploymentPath);

  const backupDirectory = join(receiptRoot, "post-expand-backup");
  await mkdir(backupDirectory);
  for (const file of [
    "logical-data.json.hbam2",
    "logical-data.json.key.dpapi",
    "schema-inventory.json.hbam2",
    "schema-inventory.json.key.dpapi",
  ]) {
    await writeFile(join(backupDirectory, file), `fixture:${file}\n`, "utf8");
  }
  const backupCreatedAt = "2026-07-17T02:30:00.0000000+00:00";
  const backupSourceCapturedAt = "2026-07-17T02:28:00.0000000+00:00";
  const backupInventoryCapturedAt = "2026-07-17T02:29:00.0000000+00:00";
  const backupManifest = {
    format: "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser",
    format_version: 2,
    backup_set_id: BACKUP_SET_ID,
    status: "complete",
    created_at_utc: backupCreatedAt,
    source_captured_at: backupSourceCapturedAt,
    inventory_captured_at: backupInventoryCapturedAt,
    inventory_contract_sha256: INVENTORY_SHA,
    source_relation_contract_sha256: RELATION_SHA,
    live_schema_contract_sha256: LIVE_SCHEMA_SHA,
    logical_data_contract_sha256: LOGICAL_DATA_CONTRACT.sha256,
    source_project_ref: PROJECT_REF,
    implementation: { git_commit: COMMIT },
    supabase_cli: {
      version: "2.106.0",
      invocation_relative_path: "bin/supabase.exe",
      files: { "bin/supabase.exe": CLI_SHA },
    },
    plaintext_written_to_disk: false,
    tables: Object.fromEntries(AMORA_POST_EXPAND_TABLES.map((table) => [table, 0])),
  };
  const backupManifestPath = join(backupDirectory, "manifest.json");
  await writeJson(backupManifestPath, backupManifest);
  const backupManifestSha = (await sha256File(backupManifestPath)).toUpperCase();
  const postExpandBackup = {
    Verified: true,
    BackupDirectory: backupDirectory,
    BackupSetId: BACKUP_SET_ID,
    ManifestSha256: backupManifestSha,
    InventoryContractSha256: INVENTORY_SHA,
    SourceRelationContractSha256: RELATION_SHA,
    LiveSchemaContractSha256: LIVE_SCHEMA_SHA,
    LogicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    GitCommit: COMMIT,
    SupabaseCliVersion: "2.106.0",
    SupabaseCliBinarySha256: CLI_SHA,
    NodeVersion: "v22.17.0",
    NodeSha256: "F".repeat(64),
    PGliteVersion: "0.3.10",
    PGliteTreeSha256: "A".repeat(64),
    CreatedAtUtc: backupCreatedAt,
    SourceCapturedAt: backupSourceCapturedAt,
    InventoryCapturedAt: backupInventoryCapturedAt,
    AgeSeconds: 3000,
    TableCount: AMORA_POST_EXPAND_TABLES.length,
    TotalRows: 0,
    SourceCanonicalDigestsVerified: true,
    PGliteJsonbRoundTripVerified: true,
    PrimaryConstraintsChecked: 27,
    ForeignKeysChecked: 0,
    ExternalForeignKeysSkipped: 0,
    PlaintextWrittenToDisk: false,
  };
  await writeJson(postExpandBackupPath, postExpandBackup);
  const postExpandBackupSha = await sha256File(postExpandBackupPath);
  const hostedChecks = Object.fromEntries(
    POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS.map((name) => [name, true]),
  );
  const hostedProjectRawText = `${JSON.stringify({
    id: TARGET_PROJECT_REF,
    name: TARGET_PROJECT_NAME,
    status: "ACTIVE_HEALTHY",
    region: "ap-northeast-2",
    customEnvironment: null,
  })}\n`;
  const hostedDatabaseRawText = `${JSON.stringify({
    probeVersion: 1,
    transactionReadOnly: true,
    databaseName: "postgres",
    databaseSystemIdentifier: TARGET_DATABASE_SYSTEM_IDENTIFIER,
    targetTables: [...AMORA_POST_EXPAND_TABLES],
    targetReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
    leaseTableCount: 1,
    liveSchemaContractSha256: LIVE_SCHEMA_SHA,
    logicalDataContract: LOGICAL_DATA_CONTRACT.contract,
    logicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    authHealth: {
      runner: "supabase-auth-health-v1",
      targetProjectRef: TARGET_PROJECT_REF,
      endpoint: `https://${TARGET_PROJECT_REF}.supabase.co/auth/v1/health`,
      status: 200,
      bodySha256: externalGateSha256('{"version":"ok"}'),
      checkedAt: "2026-07-17T02:45:00.000Z",
    },
    checks: hostedChecks,
    checkedAt: "2026-07-17T02:45:00.000Z",
  })}\n`;
  const postExpandHostedRestore = buildHostedRestoreReceiptWithProvenance({
    baseReceipt: {
    receiptVersion: 1,
    kind: "post-expand-hosted-restore-evidence",
    release: RELEASE,
    releaseCommit: COMMIT,
    sourceProjectRef: PROJECT_REF,
    targetProjectRef: TARGET_PROJECT_REF,
    backupSetId: BACKUP_SET_ID,
    backupManifestSha256: backupManifestSha,
    sourceSchemaContractSha256: INVENTORY_SHA,
    targetSchemaContractSha256: INVENTORY_SHA,
    sourceDataContractSha256: RELATION_SHA,
    targetDataContractSha256: RELATION_SHA,
    sourceLiveSchemaContractSha256: LIVE_SCHEMA_SHA,
    targetLiveSchemaContractSha256: LIVE_SCHEMA_SHA,
    sourceLogicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    targetLogicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    targetTables: [...AMORA_POST_EXPAND_TABLES],
    targetReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
    targetTableContractSha256: AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
    targetReleaseMigrationContractSha256:
      AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
    providerRestoreJobId: "restore_job_fixture_001",
    restoreCompletedAt: "2026-07-17T02:40:00.000Z",
    verifiedAt: "2026-07-17T02:45:00.000Z",
    checks: hostedChecks,
    containsSensitiveValues: false,
    },
    projectRawText: hostedProjectRawText,
    projectRawEvidenceFileName: HOSTED_PROJECT_RAW_FILE,
    databaseProbeRawText: hostedDatabaseRawText,
    databaseProbeRawEvidenceFileName: HOSTED_DATABASE_RAW_FILE,
    databaseHost: `db.${TARGET_PROJECT_REF}.supabase.co`,
    targetProjectName: TARGET_PROJECT_NAME,
    sourceDatabaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
  });
  await Promise.all([
    writeFile(
      join(receiptRoot, HOSTED_PROJECT_RAW_FILE),
      hostedProjectRawText,
      "utf8",
    ),
    writeFile(
      join(receiptRoot, HOSTED_DATABASE_RAW_FILE),
      hostedDatabaseRawText,
      "utf8",
    ),
  ]);
  await writeJson(postExpandHostedRestorePath, postExpandHostedRestore);
  const postExpandHostedRestoreSha = await sha256File(
    postExpandHostedRestorePath,
  );
  const checks = Object.fromEntries(requiredCanaryChecks.map((name) => [name, true]));
  const canaryHarness = createCanaryHarness();
  const canaryEvidence = await runProductionCanaryHttpEvidence({
    fetchImpl: canaryHarness.fetch,
    expectedHost: "hanbang.ai",
    expectedCommit: COMMIT,
    deploymentRawEvidenceSha256: externalGateSha256(deploymentRawText),
    projectRef: PROJECT_REF,
    databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
    deploymentReady: true,
    browserRunner: canaryHarness.browserRunner,
    authenticatedSessionRunner: canaryHarness.authenticatedSessionRunner,
    databaseFenceRunner: canaryHarness.databaseFenceRunner,
    vercelServerErrorRunner: canaryHarness.vercelServerErrorRunner,
    now: canaryHarness.now,
    wait: canaryHarness.wait,
  });
  const canary = buildProductionCanaryReceiptWithProvenance({
    baseReceipt: {
    receiptVersion: 1,
    kind: "production-write-fenced-canary",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    deploymentId: DEPLOYMENT_ID,
    deploymentUrlSha256: deployment.deploymentUrlSha256,
    deploymentReceiptSha256: deploymentSha,
    releaseOutcomeReceiptSha256: outcomeSha,
    postExpandBackupReceiptSha256: postExpandBackupSha,
    postExpandHostedRestoreReceiptSha256: postExpandHostedRestoreSha,
    observationStartedAt: canaryEvidence.raw.observationStartedAt,
    verifiedAt: canaryEvidence.raw.verifiedAt,
    expiresAt: new Date(
      Date.parse(canaryEvidence.raw.verifiedAt) + 15 * 60_000,
    ).toISOString(),
    observationWindowSeconds: 300,
    checks,
    containsSecrets: false,
    },
    rawText: canaryEvidence.rawText,
    rawEvidenceFileName: CANARY_RAW_FILE,
    vercelServerErrorRawText: canaryEvidence.vercelServerErrorRawText,
    vercelServerErrorRawEvidenceFileName: VERCEL_SERVER_ERROR_RAW_FILE,
    expectedHost: "hanbang.ai",
    expectedCommit: COMMIT,
    deploymentRawEvidenceSha256: externalGateSha256(deploymentRawText),
    databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
  });
  await Promise.all([
    writeFile(join(receiptRoot, CANARY_RAW_FILE), canaryEvidence.rawText, "utf8"),
    writeFile(
      join(receiptRoot, VERCEL_SERVER_ERROR_RAW_FILE),
      canaryEvidence.vercelServerErrorRawText,
      "utf8",
    ),
  ]);
  await writeJson(canaryPath, canary);
  const canarySha = await sha256File(canaryPath);
  await writeJson(lockPath, {
    version: 2,
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    outcomeReceiptPathSha256: outcomePathSha256,
    remoteReleaseLeaseOwnerId: OWNER,
    startedAt: "2026-07-17T02:00:00.000Z",
    rerunProhibitedUntilAdjudicated: true,
  });
  return {
    repoRoot,
    receiptRoot,
    sqlPath,
    manifestPath,
    lockPath,
    finalizerLockPath: `${lockPath}.finalize`,
    outcomePath,
    deploymentPath,
    postExpandBackupPath,
    postExpandHostedRestorePath,
    canaryPath,
    receiptOut,
    outcome,
    outcomeSha,
    deployment,
    deploymentSha,
    postExpandBackup,
    postExpandBackupSha,
    postExpandHostedRestore,
    postExpandHostedRestoreSha,
    postExpandBackupReverificationSha: sha256Text(
      JSON.stringify(postExpandBackup),
    ),
    canary,
    canarySha,
    operationSha,
  };
}

function argsFor(fixture, confirmationSha = fixture.canarySha) {
  return [
    `--expected-commit=${COMMIT}`,
    `--remote-ref=${REMOTE_REF}`,
    `--release-outcome=${fixture.outcomePath}`,
    `--deployment-receipt=${fixture.deploymentPath}`,
    `--post-expand-backup-receipt=${fixture.postExpandBackupPath}`,
    `--post-expand-hosted-restore-receipt=${fixture.postExpandHostedRestorePath}`,
    `--canary-receipt=${fixture.canaryPath}`,
    `--receipt-out=${fixture.receiptOut}`,
    `--confirm-production=FINALIZE:${PROJECT_REF}:${RELEASE}:${COMMIT}:${DEPLOYMENT_ID}:${confirmationSha}`,
  ];
}

function gitResult(stdout = "") {
  return {
    status: 0,
    signal: null,
    stdout,
    stderr: "",
    outputTruncated: false,
    timedOut: false,
  };
}

function expectedDatabaseEvidence(fixture) {
  return {
    production_write_fence_finalize_count: 1,
    target_project_ref: PROJECT_REF,
    target_database_system_identifier: "7000000000000000001",
    release_id: RELEASE,
    release_commit: COMMIT,
    lease_owner_id: OWNER,
    outcome_receipt_sha256: fixture.outcomeSha,
    deployment_id: DEPLOYMENT_ID,
    deployment_url_sha256: fixture.deployment.deploymentUrlSha256,
    deployment_receipt_sha256: fixture.deploymentSha,
    post_expand_backup_receipt_sha256: fixture.postExpandBackupSha,
    post_expand_backup_reverification_sha256:
      fixture.postExpandBackupReverificationSha,
    post_expand_hosted_restore_receipt_sha256:
      fixture.postExpandHostedRestoreSha,
    post_expand_backup_set_id: BACKUP_SET_ID,
    post_expand_backup_manifest_sha256:
      fixture.postExpandBackup.ManifestSha256,
    post_expand_table_contract_sha256:
      AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
    post_expand_migration_contract_sha256:
      AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
    post_expand_live_schema_contract_sha256: LIVE_SCHEMA_SHA,
    post_expand_logical_data_contract_sha256: LOGICAL_DATA_CONTRACT.sha256,
    canary_receipt_sha256: fixture.canarySha,
    canary_verified_at: fixture.canary.verifiedAt,
    canary_expires_at: fixture.canary.expiresAt,
    production_storage_writes_allowed_count: 1,
  };
}

function createRunCommand(
  fixture,
  { databaseRows, databaseResult, backupVerificationReceipt } = {},
) {
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === "git") {
      if (args[0] === "status") return gitResult("");
      if (args[0] === "rev-parse") return gitResult(`${COMMIT}\n`);
      if (args[0] === "remote") return gitResult(`${ORIGIN}\n`);
      if (args[0] === "ls-remote") {
        return gitResult(`${COMMIT}\trefs/heads/release-finalizer\n`);
      }
    }
    if (command.toLowerCase().endsWith("powershell.exe")) {
      return gitResult(JSON.stringify(
        backupVerificationReceipt ?? fixture.postExpandBackup,
      ));
    }
    if (command === "supabase-fixture") {
      assert.equal(args.includes("--file"), false);
      const sql = args[args.indexOf("--linked") + 1];
      assert.doesNotMatch(sql, /__HB_FINALIZER_[A-Z0-9_]+__/);
      assert.match(sql, new RegExp(fixture.canarySha));
      assert.match(sql, new RegExp(fixture.postExpandBackupSha));
      assert.match(sql, new RegExp(fixture.postExpandHostedRestoreSha));
      return databaseResult ?? gitResult(JSON.stringify(
        databaseRows ?? [expectedDatabaseEvidence(fixture)],
      ));
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, runCommand };
}

async function cleanupFixture(fixture) {
  await rm(fixture.repoRoot, { recursive: true, force: true });
  await rm(fixture.receiptRoot, { recursive: true, force: true });
}

test("finalizer binds exact receipts, executes one atomic query and consumes local locks", async () => {
  const fixture = await createFixture();
  const { calls, runCommand } = createRunCommand(fixture);
  try {
    const result = await runProductionWriteFenceFinalizer({
      repoRoot: fixture.repoRoot,
      argv: argsFor(fixture),
      runCommand,
      now: () => NOW,
      resolveSupabaseCli: async () => "supabase-fixture",
    });
    assert.equal(result.status, "verified_success");
    assert.deepEqual(result.databaseEvidence, expectedDatabaseEvidence(fixture));
    assert.equal(calls.filter((call) => call.command === "supabase-fixture").length, 1);
    await assert.rejects(stat(fixture.lockPath), /ENOENT/);
    await assert.rejects(stat(fixture.finalizerLockPath), /ENOENT/);
    const persisted = JSON.parse(await readFile(fixture.receiptOut, "utf8"));
    assert.equal(persisted.status, "verified_success");
    assert.equal(persisted.canaryReceiptSha256, fixture.canarySha);
    assert.equal(persisted.rerunProhibitedUntilAdjudicated, false);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("finalizer accepts the controller's post-push plus post-apply outcome and rejects count drift", async () => {
  for (const scenario of ["exact-controller-shape", "postconditions-count-drift"]) {
    const fixture = await createFixture();
    const { calls, runCommand } = createRunCommand(fixture);
    try {
      if (scenario === "postconditions-count-drift") {
        fixture.outcome.postconditionsPassed = 1;
        await writeJson(fixture.outcomePath, fixture.outcome);
      }
      const operation = runProductionWriteFenceFinalizer({
        repoRoot: fixture.repoRoot,
        argv: argsFor(fixture),
        runCommand,
        now: () => NOW,
        resolveSupabaseCli: async () => "supabase-fixture",
      });
      if (scenario === "exact-controller-shape") {
        assert.equal((await operation).status, "verified_success");
      } else {
        await assert.rejects(
          operation,
          (error) => error instanceof ProductionWriteFenceFinalizerError
            && error.code === "RELEASE_OUTCOME_INVALID",
        );
        assert.equal(calls.some((call) => call.command === "supabase-fixture"), false);
      }
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("finalizer refuses stale, altered and cross-bound receipts before any database query", async () => {
  for (const scenario of ["stale", "outcome-hash", "deployment-id"]) {
    const fixture = await createFixture();
    const { calls, runCommand } = createRunCommand(fixture);
    try {
      if (scenario === "stale") {
        fixture.canary.verifiedAt = "2026-07-17T02:00:00.000Z";
        fixture.canary.expiresAt = "2026-07-17T02:15:00.000Z";
        fixture.canary.observationStartedAt = "2026-07-17T01:50:00.000Z";
      } else if (scenario === "outcome-hash") {
        fixture.canary.releaseOutcomeReceiptSha256 = "9".repeat(64);
      } else {
        fixture.canary.deploymentId = "dpl_abcdefghijklmnopqrstuvwx";
      }
      await writeJson(fixture.canaryPath, fixture.canary);
      fixture.canarySha = await sha256File(fixture.canaryPath);
      await assert.rejects(
        runProductionWriteFenceFinalizer({
          repoRoot: fixture.repoRoot,
          argv: argsFor(fixture),
          runCommand,
          now: () => NOW,
          resolveSupabaseCli: async () => "supabase-fixture",
        }),
        (error) => error instanceof ProductionWriteFenceFinalizerError
          && error.code === "CANARY_RECEIPT_INVALID",
      );
      assert.equal(calls.some((call) => call.command === "supabase-fixture"), false);
      await stat(fixture.lockPath);
      await assert.rejects(stat(fixture.receiptOut), /ENOENT/);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("finalizer rejects altered post-expand backup, hosted restore and canary bindings", async () => {
  for (const scenario of ["backup", "hosted", "canary-post-hash"]) {
    const fixture = await createFixture();
    const { calls, runCommand } = createRunCommand(fixture);
    try {
      let expectedCode;
      if (scenario === "backup") {
        fixture.postExpandBackup.Verified = false;
        await writeJson(fixture.postExpandBackupPath, fixture.postExpandBackup);
        expectedCode = "POST_EXPAND_BACKUP_RECEIPT_INVALID";
      } else if (scenario === "hosted") {
        fixture.postExpandHostedRestore.targetTables = [
          ...AMORA_POST_EXPAND_TABLES.slice(0, -1),
        ];
        await writeJson(
          fixture.postExpandHostedRestorePath,
          fixture.postExpandHostedRestore,
        );
        expectedCode = "POST_EXPAND_HOSTED_RESTORE_RECEIPT_INVALID";
      } else {
        fixture.canary.postExpandBackupReceiptSha256 = "9".repeat(64);
        await writeJson(fixture.canaryPath, fixture.canary);
        fixture.canarySha = await sha256File(fixture.canaryPath);
        expectedCode = "CANARY_RECEIPT_INVALID";
      }
      await assert.rejects(
        runProductionWriteFenceFinalizer({
          repoRoot: fixture.repoRoot,
          argv: argsFor(fixture),
          runCommand,
          now: () => NOW,
          resolveSupabaseCli: async () => "supabase-fixture",
        }),
        (error) => error instanceof ProductionWriteFenceFinalizerError
          && error.code === expectedCode,
      );
      assert.equal(
        calls.some((call) => call.command === "supabase-fixture"),
        false,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("finalizer rejects post-receipt raw evidence tampering before commands", async () => {
  for (const fileName of [
    DEPLOYMENT_RAW_FILE,
    HOSTED_PROJECT_RAW_FILE,
    HOSTED_DATABASE_RAW_FILE,
    CANARY_RAW_FILE,
    VERCEL_SERVER_ERROR_RAW_FILE,
  ]) {
    const fixture = await createFixture();
    const { calls, runCommand } = createRunCommand(fixture);
    try {
      const path = join(fixture.receiptRoot, fileName);
      await writeFile(path, `${await readFile(path, "utf8")} `, "utf8");
      await assert.rejects(
        runProductionWriteFenceFinalizer({
          repoRoot: fixture.repoRoot,
          argv: argsFor(fixture),
          runCommand,
          now: () => NOW,
          resolveSupabaseCli: async () => "supabase-fixture",
        }),
        (error) => error instanceof ProductionWriteFenceFinalizerError
          && error.code === "EXTERNAL_GATE_PROVENANCE_INVALID",
      );
      assert.equal(calls.length, 0);
      await assert.rejects(stat(fixture.receiptOut), /ENOENT/);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("fresh pinned backup reverification must match every immutable receipt field", async () => {
  const fixture = await createFixture();
  const alteredFresh = {
    ...fixture.postExpandBackup,
    TotalRows: fixture.postExpandBackup.TotalRows + 1,
  };
  const { calls, runCommand } = createRunCommand(fixture, {
    backupVerificationReceipt: alteredFresh,
  });
  try {
    await assert.rejects(
      runProductionWriteFenceFinalizer({
        repoRoot: fixture.repoRoot,
        argv: argsFor(fixture),
        runCommand,
        now: () => NOW,
        resolveSupabaseCli: async () => "supabase-fixture",
      }),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "POST_EXPAND_BACKUP_REVERIFY_MISMATCH",
    );
    assert.equal(
      calls.filter((call) => call.command.toLowerCase().endsWith("powershell.exe"))
        .length,
      1,
    );
    assert.equal(calls.some((call) => call.command === "supabase-fixture"), false);
    await stat(fixture.lockPath);
    await assert.rejects(stat(fixture.receiptOut), /ENOENT/);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("finalizer confirmation includes the exact canary raw SHA-256", async () => {
  const fixture = await createFixture();
  const { calls, runCommand } = createRunCommand(fixture);
  try {
    await assert.rejects(
      runProductionWriteFenceFinalizer({
        repoRoot: fixture.repoRoot,
        argv: argsFor(fixture, "0".repeat(64)),
        runCommand,
        now: () => NOW,
        resolveSupabaseCli: async () => "supabase-fixture",
      }),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "PRODUCTION_CONFIRMATION_MISMATCH",
    );
    assert.equal(calls.length, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("ambiguous or extra database output preserves both locks and the started receipt", async () => {
  for (const scenario of ["extra-row-field", "timeout"]) {
    const fixture = await createFixture();
    const expected = expectedDatabaseEvidence(fixture);
    const databaseRows = scenario === "extra-row-field"
      ? [{ ...expected, unreviewed: 1 }]
      : undefined;
    const databaseResult = scenario === "timeout"
      ? {
        status: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
        outputTruncated: false,
        timedOut: true,
      }
      : undefined;
    const { runCommand } = createRunCommand(fixture, { databaseRows, databaseResult });
    try {
      await assert.rejects(
        runProductionWriteFenceFinalizer({
          repoRoot: fixture.repoRoot,
          argv: argsFor(fixture),
          runCommand,
          now: () => NOW,
          resolveSupabaseCli: async () => "supabase-fixture",
        }),
        (error) => error instanceof ProductionWriteFenceFinalizerError
          && error.code === "FINALIZER_OUTCOME_AMBIGUOUS",
      );
      await stat(fixture.lockPath);
      await stat(fixture.finalizerLockPath);
      const receipt = JSON.parse(await readFile(fixture.receiptOut, "utf8"));
      assert.equal(
        receipt.status,
        "finalization_started_outcome_ambiguous_until_verified",
      );
      assert.equal(receipt.rerunProhibitedUntilAdjudicated, true);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("replay fails before a second database query after the lease lock was consumed", async () => {
  const fixture = await createFixture();
  const first = createRunCommand(fixture);
  try {
    await runProductionWriteFenceFinalizer({
      repoRoot: fixture.repoRoot,
      argv: argsFor(fixture),
      runCommand: first.runCommand,
      now: () => NOW,
      resolveSupabaseCli: async () => "supabase-fixture",
    });
    const secondOut = join(fixture.receiptRoot, "second-finalization.json");
    const secondArgs = argsFor({ ...fixture, receiptOut: secondOut });
    const second = createRunCommand(fixture);
    await assert.rejects(
      runProductionWriteFenceFinalizer({
        repoRoot: fixture.repoRoot,
        argv: secondArgs,
        runCommand: second.runCommand,
        now: () => NOW,
        resolveSupabaseCli: async () => "supabase-fixture",
      }),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "RELEASE_LOCK_INVALID",
    );
    assert.equal(second.calls.length, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("renderer rejects injection and any missing or duplicated template token", async () => {
  const template = await readFile(sourceSql, "utf8");
  const evidence = {
    projectRef: PROJECT_REF,
    databaseSystemIdentifier: "7000000000000000001",
    release: RELEASE,
    releaseCommit: COMMIT,
    leaseOwnerId: OWNER,
    outcomePathSha256: OUTCOME_PATH_SHA,
    outcomeReceiptSha256: "c".repeat(64),
    deploymentId: DEPLOYMENT_ID,
    deploymentUrlSha256: "d".repeat(64),
    deploymentReceiptSha256: "e".repeat(64),
    canaryReceiptSha256: "f".repeat(64),
    postExpandBackupReceiptSha256: "1".repeat(64),
    postExpandBackupReverificationSha256: "2".repeat(64),
    postExpandHostedRestoreReceiptSha256: "3".repeat(64),
    postExpandBackupSetId: BACKUP_SET_ID,
    postExpandBackupManifestSha256: "A".repeat(64),
    postExpandTableContractSha256:
      AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
    postExpandMigrationContractSha256:
      AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
    postExpandLiveSchemaContractSha256: LIVE_SCHEMA_SHA,
    postExpandLogicalDataContractSha256: LOGICAL_DATA_CONTRACT.sha256,
    canaryVerifiedAt: "2026-07-17T03:15:00.000Z",
    canaryExpiresAt: "2026-07-17T03:30:00.000Z",
  };
  const rendered = renderProductionWriteFenceFinalizerSql(template, evidence);
  assert.match(rendered, new RegExp(OWNER));
  assert.ok(rendered.length < 28_000, `compacted SQL length=${rendered.length}`);
  const successorDigests = {
    expectedTableContractSha256: "4".repeat(64),
    expectedReleaseMigrationContractSha256: "5".repeat(64),
  };
  const successorEvidence = {
    ...evidence,
    postExpandTableContractSha256:
      successorDigests.expectedTableContractSha256,
    postExpandMigrationContractSha256:
      successorDigests.expectedReleaseMigrationContractSha256,
  };
  const successorRendered = renderProductionWriteFenceFinalizerSql(
    template,
    successorEvidence,
    successorDigests,
  );
  assert.match(
    successorRendered,
    new RegExp(successorDigests.expectedTableContractSha256),
  );
  assert.throws(
    () => renderProductionWriteFenceFinalizerSql(template, successorEvidence),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "FINALIZER_EVIDENCE_INVALID",
  );
  assert.throws(
    () => renderProductionWriteFenceFinalizerSql(template, {
      ...evidence,
      release: "test-release'; DROP TABLE public.users; --",
    }),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "FINALIZER_EVIDENCE_INVALID",
  );
  assert.throws(
    () => renderProductionWriteFenceFinalizerSql(
      template.replace("__HB_FINALIZER_PROJECT_REF__", PROJECT_REF),
      evidence,
    ),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "FINALIZER_TEMPLATE_INVALID",
  );
  assert.throws(
    () => renderProductionWriteFenceFinalizerSql(
      `${template}\n-- __HB_FINALIZER_PROJECT_REF__\n`,
      evidence,
    ),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "FINALIZER_TEMPLATE_INVALID",
  );
});

test("successor outcome evidence summary binds all five private receipt and raw hashes", () => {
  const records = [
    "backup",
    "finalizer",
    "hostedRestore",
    "hostedStaging",
    "storage",
  ].map((name, index) => ({
    name,
    receiptSha256: ["1", "2", "3", "4", "5"][index].repeat(64),
    rawEvidenceSha256: ["6", "7", "8", "9", "a"][index].repeat(64),
    verifiedAt: "2026-07-31T00:00:00Z",
    expiresAt: "2026-07-31T00:30:00Z",
  }));
  const successorRuntimeEvidenceSetSha256 = sha256Text(
    `${records.map((record) => [
      record.name,
      record.receiptSha256,
      record.rawEvidenceSha256,
      record.verifiedAt,
      record.expiresAt,
    ].join(":")).join("\n")}\n`,
  );
  const receipt = {
    startedAt: "2026-07-31T00:05:00.000Z",
    successorRuntimeEvidence: records,
    successorRuntimeEvidenceSetSha256,
  };
  assert.equal(
    productionWriteFenceFinalizerTestHooks
      .validateSuccessorRuntimeEvidenceSummary(receipt),
    true,
  );
  assert.equal(
    productionWriteFenceFinalizerTestHooks
      .validateSuccessorRuntimeEvidenceSummary({
        ...receipt,
        successorRuntimeEvidence: records.map((record, index) =>
          index === 0
            ? { ...record, rawEvidenceSha256: "f".repeat(64) }
            : record),
      }),
    false,
  );
  assert.equal(
    productionWriteFenceFinalizerTestHooks
      .validateSuccessorRuntimeEvidenceSummary({
        ...receipt,
        successorRuntimeEvidence: records.map((record, index) =>
          index === 0
            ? { ...record, expiresAt: receipt.startedAt }
            : record),
      }),
    false,
  );
});

test("finalizer SQL compactor preserves quoted data and executable semantics", async () => {
  const compact = productionWriteFenceFinalizerTestHooks.compactFinalizerSql;
  const sql = `
    BEGIN;
    /* outer comment /* nested comment */ remains code-safe */
    CREATE TEMP TABLE compact_quote(value text);
    INSERT INTO compact_quote(value) VALUES
      ('single  -- /* literal */'),
      ($data$dollar  -- /* literal */$data$); -- removed comment
    COMMIT;
  `;
  const compacted = compact(sql);
  assert.match(compacted, /'single  -- \/\* literal \*\/'/);
  assert.match(compacted, /\$data\$dollar  -- \/\* literal \*\/\$data\$/);
  assert.doesNotMatch(compacted, /removed comment|outer comment|nested comment/);

  const doBlock = compact(`
    DO $body$
    BEGIN
      -- removed from PL/pgSQL body
      RAISE NOTICE 'quoted  -- text';
    END
    $body$;
  `);
  assert.match(doBlock, /'quoted  -- text'/);
  assert.doesNotMatch(doBlock, /removed from PL\/pgSQL body/);

  const modulePath = pathToFileURL(join(
    sourceRepoRoot,
    "apps/web/node_modules/@electric-sql/pglite/dist/index.js",
  )).href;
  const { PGlite } = await import(modulePath);
  const database = new PGlite();
  try {
    await database.exec(compacted);
    const result = await database.query(
      "SELECT value FROM compact_quote ORDER BY value",
    );
    assert.deepEqual(
      result.rows.map((row) => row.value),
      ["dollar  -- /* literal */", "single  -- /* literal */"],
    );
  } finally {
    await database.close();
  }

  for (const invalid of ["SELECT 'unterminated", "SELECT 1 /* open"]) {
    assert.throws(
      () => compact(invalid),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "FINALIZER_TEMPLATE_INVALID",
    );
  }
});

test("manifest must pin the strict finalization contract before runtime can proceed", async () => {
  const fixture = await createFixture();
  const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
  delete manifest.finalizationContract;
  await writeJson(fixture.manifestPath, manifest);
  try {
    await assert.rejects(
      runProductionWriteFenceFinalizer({
        repoRoot: fixture.repoRoot,
        argv: argsFor(fixture),
        runCommand: async () => {
          throw new Error("must not execute");
        },
        now: () => NOW,
        resolveSupabaseCli: async () => "supabase-fixture",
      }),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "FINALIZATION_CONTRACT_INVALID",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("a deployment-blocked successor prevents predecessor finalizer selection", async () => {
  const fixture = await createFixture();
  try {
    const predecessorMigrationFile =
      "20260716090000_finalizer_predecessor_fixture.sql";
    const predecessorMigrationSql = "select 'predecessor';\n";
    await mkdir(join(fixture.repoRoot, "supabase/migrations"), {
      recursive: true,
    });
    await writeFile(
      join(fixture.repoRoot, "supabase/migrations", predecessorMigrationFile),
      predecessorMigrationSql,
      "utf8",
    );
    const predecessor = JSON.parse(
      await readFile(fixture.manifestPath, "utf8"),
    );
    predecessor.expandMigrations = [{
      file: predecessorMigrationFile,
      sha256: sha256Text(predecessorMigrationSql),
    }];
    await writeJson(fixture.manifestPath, predecessor);
    const predecessorText = await readFile(fixture.manifestPath, "utf8");

    const successorMigrationFile =
      "20260718120000_finalizer_successor_fixture.sql";
    const successorMigrationSql = "select 'successor';\n";
    await writeFile(
      join(fixture.repoRoot, "supabase/migrations", successorMigrationFile),
      successorMigrationSql,
      "utf8",
    );
    const successorBaseline = attachSuccessorRemoteBaselineFixture({
      release: "vendor-disclosure-v2-20260718",
      projectRef: PROJECT_REF,
      status: "deployment_blocked",
      predecessorManifest: {
        file:
          "supabase/release-manifests/amora-engine-v2-20260716.json",
        sha256: sha256Text(predecessorText),
      },
      requiredRemoteHead: "20260716090000",
      migrationFloor: "20260718120000",
      expandMigrations: [{
        file: successorMigrationFile,
        sha256: sha256Text(successorMigrationSql),
      }],
      deploymentEvidence: {
        backup: "missing",
        finalizer: "missing",
        hostedRestore: "missing",
        hostedStaging: "missing",
        storage: "missing",
      },
    });
    await writeJson(
      join(
        fixture.repoRoot,
        "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
      ),
      successorBaseline.manifest,
    );
    const baselinePath = join(
      fixture.repoRoot,
      SUCCESSOR_REMOTE_BASELINE_FIXTURE_PATH,
    );
    await mkdir(resolve(baselinePath, ".."), { recursive: true });
    await writeFile(baselinePath, successorBaseline.contractText, "utf8");

    await assert.rejects(
      productionWriteFenceFinalizerTestHooks.loadFinalizationManifest(
        fixture.repoRoot,
      ),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "SUCCESSOR_RELEASE_DEPLOYMENT_BLOCKED",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("the current 112-migration successor keeps finalization blocked through the decision-node clock trigger tail", async () => {
  const manifest = JSON.parse(await readFile(
    join(
      sourceRepoRoot,
      "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
    ),
    "utf8",
  ));
  assert.equal(manifest.expandMigrations.length, 112);
  assert.deepEqual(
    manifest.expandMigrations.slice(-14),
    [
      {
        file: "20260816150000_amora_provider_backed_add_action_application.sql",
        sha256: "1e7870be4051c4fd9017d6909b453739e8eda9fdd4100339d47d9a79d7777483",
      },
      {
        file: "20260816160000_amora_atomic_action_href_parity.sql",
        sha256: "afe0eabc7cc774d219715224906bfd328e0df011bb76f9caea69615a93a4af7c",
      },
      {
        file: "20260816170000_amora_booking_outcome_provenance.sql",
        sha256: "9b673303585070facadb062d042c1cd23342cafe368612037571597ff72f5457",
      },
      {
        file: "20260816180000_amora_neutral_preparation_space.sql",
        sha256: "ce00fb20715ce45d1b7edccb8ea28c1af35e2dee9c3692552696f892639c2867",
      },
      {
        file: "20260816190000_amora_preparation_catch_up.sql",
        sha256: "637d56cfba243e25f6488d1aaf08f1873b9d4aad30bb54f7cedc3870b1eb9cce",
      },
      {
        file: "20260818100000_restore_signup_profile_trigger.sql",
        sha256: "16fa1a4af7832c69e937faeaff7f88115699e377e1445f9c4cdc524b86f4a53a",
      },
      {
        file: "20260818110000_restore_couple_invite_nullable_contract.sql",
        sha256: "b4291e779566b74ee986e634bace40b986d5b03598b53691fb99538d50a94324",
      },
      {
        file: "20260818120000_amora_message_ref_http_conflicts.sql",
        sha256: "c3e269594e956cc96cb19b3c282c5c1865178baa6b468c944831de8d9b389358",
      },
      {
        file: "20260818130000_amora_preparation_notes_read.sql",
        sha256: "022707a3db67b6b7e7e06280011d210e184b2fd1d911947d416758a334a0f9d4",
      },
      {
        file: "20260818140000_amora_mediation_private_draft_boundary.sql",
        sha256: "6aa23631c3457355d2c4203c4b245598b8c5b88690c20b7275d018c0bf5596c8",
      },
      {
        file: "20260818150000_amora_topic_criterion_action_context.sql",
        sha256: "0018ec4033838f2f0bd09d7b141608e244f24149a502c8f3263eccfe72750f4b",
      },
      {
        file: "20260818160000_amora_shared_action_receipt_trigger.sql",
        sha256: "4046e4d2affd765d04bb002fd7a20e144a2f92e714e1aacf50d2adb47a5d5198",
      },
      {
        file: "20260818170000_amora_vendor_review_trigger_search_path.sql",
        sha256: "c797af2aa813ae8628bae6361a2ec60564104f2cd21626c5526f048eb906a84a",
      },
      {
        file: "20260818180000_amora_decision_node_updated_at_clock.sql",
        sha256: "d633a58e209ba46cae83566e81f1c9e0b2750b1593be7e8e5406d1bf0ddba4e6",
      },
    ],
  );
  await assert.rejects(
    productionWriteFenceFinalizerTestHooks.loadFinalizationManifest(
      sourceRepoRoot,
    ),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "SUCCESSOR_RELEASE_DEPLOYMENT_BLOCKED",
  );
});
