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
  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
} from "../lib/supabase-successor-release-contract.mjs";
import {
  computeSuccessorReleaseCheckpointBindingSha256,
} from "../lib/production-release-checkpoint-binding.mjs";
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
const successorSourceSql = join(
  sourceRepoRoot,
  "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql",
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

test("successor renderer binds recovery assurance and lowercase live backup digests without a hosted-restore claim", async () => {
  const template = await readFile(successorSourceSql, "utf8");
  const postExpandBackupContract = {
    expectedTableContractSha256:
      "ddf672a17f28e99fd20646a3376cee696430b8b599e10979f6d2c7fd23e5482f",
    expectedReleaseMigrationContractSha256:
      "807cacbc3a0df7f488908c3cd619879d389dd277bda37f97032d06fb960a44bf",
  };
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
    recoveryAssuranceReceiptSha256: "3".repeat(64),
    postExpandBackupSetId: BACKUP_SET_ID,
    postExpandBackupManifestSha256: "a".repeat(64),
    postExpandTableContractSha256:
      postExpandBackupContract.expectedTableContractSha256,
    postExpandMigrationContractSha256:
      postExpandBackupContract.expectedReleaseMigrationContractSha256,
    postExpandLiveSchemaContractSha256: "b".repeat(64),
    postExpandLogicalDataContractSha256: "c".repeat(64),
    canaryVerifiedAt: "2026-07-17T03:15:00.000Z",
    canaryExpiresAt: "2026-07-17T03:30:00.000Z",
  };
  const rendered = renderProductionWriteFenceFinalizerSql(
    template,
    evidence,
    postExpandBackupContract,
  );
  assert.match(rendered, /recovery_assurance_receipt_sha256/gu);
  assert.doesNotMatch(rendered, /hosted_restore/gu);
  assert.throws(
    () => renderProductionWriteFenceFinalizerSql(template, {
      ...evidence,
      postExpandHostedRestoreReceiptSha256: "4".repeat(64),
    }, postExpandBackupContract),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "FINALIZER_EVIDENCE_INVALID",
  );
});

test("successor outcome evidence summary binds all five private receipt and raw hashes", () => {
  const records = [
    "backup",
    "finalizer",
    "hostedStaging",
    "recoveryAssurance",
    "storage",
  ].map((name, index) => ({
    name,
    receiptSha256: ["1", "2", "3", "4", "5"][index].repeat(64),
    rawEvidenceSha256: ["6", "7", "8", "9", "a"][index].repeat(64),
    verifiedAt: name === "recoveryAssurance"
      ? "2026-07-31T00:10:00Z"
      : "2026-07-31T00:00:00Z",
    expiresAt: name === "recoveryAssurance"
      ? "2026-07-31T00:30:00Z"
      : "2026-07-31T00:06:00Z",
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
    completedAt: "2026-07-31T00:15:00.000Z",
    successorReleaseAssurance: structuredClone(
      SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
    ),
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

test("successor finalizer recomputes the checkpoint binding while predecessor locks stay path-bound", () => {
  const path = join(tmpdir(), "successor-checkpoint-outcome.json");
  const outcomeReceiptPathSha256 = sha256Text(resolve(path));
  const startedAt = "2026-08-19T12:20:00.000Z";
  const preApplyRecords = ["backup", "finalizer", "hostedStaging", "storage"]
    .map((name, index) => ({
      name,
      receiptSha256: String(index + 1).repeat(64),
      rawEvidenceSha256: String(index + 5).repeat(64),
      verifiedAt: "2026-08-19T12:10:00.000Z",
      expiresAt: "2026-08-19T12:30:00.000Z",
    }));
  const recoveryRecord = {
    name: "recoveryAssurance",
    receiptSha256: "9".repeat(64),
    rawEvidenceSha256: "a".repeat(64),
    verifiedAt: "2026-08-19T12:21:00.000Z",
    expiresAt: "2026-08-19T12:40:00.000Z",
  };
  const runtimeRecords = [...preApplyRecords, recoveryRecord]
    .sort((left, right) => left.name.localeCompare(right.name));
  const summarize = (records) => sha256Text(
    `${records.map((record) => [
      record.name,
      record.receiptSha256,
      record.rawEvidenceSha256,
      record.verifiedAt,
      record.expiresAt,
    ].join(":")).join("\n")}\n`,
  );
  const preApplySuccessorRuntimeEvidenceSetSha256 = summarize(preApplyRecords);
  const bindingComponents = {
    version: 1,
    release: "successor-release",
    projectRef: PROJECT_REF,
    expectedCommit: COMMIT,
    outcomeReceiptPathSha256,
    backupReceiptSha256: "b".repeat(64),
    backupDirectoryPathSha256: "c".repeat(64),
    backupArtifactSetSha256: "d".repeat(64),
    backupSourceCapturedAt: "2026-08-19T12:00:00.000Z",
    startedAt,
    writeFenceEvidenceSha256: "e".repeat(64),
    preApplySuccessorRuntimeEvidenceSetSha256,
  };
  const bindingSha256 =
    computeSuccessorReleaseCheckpointBindingSha256(bindingComponents);
  const manifest = {
    status: "controller_ready",
    release: bindingComponents.release,
    projectRef: PROJECT_REF,
    backupContract: {
      supabaseCli: { version: "2.106.0", binarySha256: CLI_SHA },
    },
    postPushChecks: [],
    postApplyChecks: [{
      id: "successor-post-apply",
      expectedEvidence: { successor_contract_count: 1 },
    }],
  };
  const lock = {
    version: 2,
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    outcomeReceiptPathSha256,
    remoteReleaseLeaseOwnerId: OWNER,
    startedAt,
    rerunProhibitedUntilAdjudicated: true,
    successorCheckpointBindingVersion: 1,
    remoteReleaseLeaseCheckpointBindingSha256: bindingSha256,
  };
  const receipt = {
    receiptVersion: 1,
    status: "database_expand_verified_lease_held",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    remoteRef: REMOTE_REF,
    remoteReleaseLeaseOwnerId: OWNER,
    remoteReleaseLeaseOutcomePathSha256: bindingSha256,
    remoteReleaseLeaseCheckpointBindingSha256: bindingSha256,
    remoteReleaseLeasePhase: "deployment-canary",
    outcomeReceiptPathSha256,
    successorCheckpointBindingVersion: 1,
    backupReceiptSha256: bindingComponents.backupReceiptSha256,
    backupDirectoryPathSha256: bindingComponents.backupDirectoryPathSha256,
    backupArtifactSetSha256: bindingComponents.backupArtifactSetSha256,
    backupSourceCapturedAt: bindingComponents.backupSourceCapturedAt,
    writeFenceEvidenceSha256: bindingComponents.writeFenceEvidenceSha256,
    preApplySuccessorRuntimeEvidenceSetSha256,
    postPendingCount: 0,
    postPushCheckIds: [],
    postPushCheckCount: 0,
    postPushCheckEvidence: [],
    postApplyCheckIds: ["successor-post-apply"],
    postApplyCheckCount: 1,
    postApplyCheckEvidence: [{
      id: "successor-post-apply",
      evidence: { successor_contract_count: 1 },
    }],
    postconditionsPassed: 1,
    startedAt,
    completedAt: "2026-08-19T12:25:00.000Z",
    successorReleaseAssurance: structuredClone(
      SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
    ),
    successorRuntimeEvidence: runtimeRecords,
    successorRuntimeEvidenceSetSha256: summarize(runtimeRecords),
    supabaseCliVersion: "2.106.0",
    supabaseCliBinarySha256: CLI_SHA,
    rerunProhibited: true,
    containsSecrets: false,
  };
  const releaseLock = productionWriteFenceFinalizerTestHooks
    .validateReleaseLock(lock, path, manifest, COMMIT);
  assert.equal(
    productionWriteFenceFinalizerTestHooks.validateOutcomeReceipt({
      receipt,
      sha256: "f".repeat(64),
      path,
      manifest,
      expectedCommit: COMMIT,
      remoteRef: REMOTE_REF,
      releaseLock,
    }).outcomePathSha256,
    bindingSha256,
  );
  assert.throws(
    () => productionWriteFenceFinalizerTestHooks.validateOutcomeReceipt({
      receipt: { ...receipt, backupReceiptSha256: "0".repeat(64) },
      sha256: "f".repeat(64),
      path,
      manifest,
      expectedCommit: COMMIT,
      remoteRef: REMOTE_REF,
      releaseLock,
    }),
    (error) => error?.code === "RELEASE_OUTCOME_INVALID",
  );
});

test("successor finalizer revalidates the complete no-cost evidence set and cross-binds the live post-expand backup", async () => {
  const receiptRoot = await mkdtemp(
    join(tmpdir(), "successor-finalizer-recovery-assurance-"),
  );
  const recoveryFileName = `${RELEASE}-recovery-assurance-evidence.json`;
  const recoveryReceiptPath = join(receiptRoot, recoveryFileName);
  const names = [
    "backup",
    "finalizer",
    "hostedStaging",
    "recoveryAssurance",
    "storage",
  ];
  const records = Object.fromEntries(names.map((name, index) => [name, {
    receiptPath: name === "recoveryAssurance"
      ? recoveryReceiptPath
      : join(receiptRoot, `${name}.json`),
    receiptSha256: String(index + 1).repeat(64),
    rawEvidenceSha256: ["6", "7", "8", "9", "a"][index].repeat(64),
    verifiedAt: name === "recoveryAssurance"
      ? "2026-07-17T03:10:00.000Z"
      : "2026-07-17T02:50:00.000Z",
    expiresAt: name === "recoveryAssurance"
      ? "2026-07-17T03:40:00.000Z"
      : "2026-07-17T03:20:00.000Z",
  }]));
  const backupReceiptSha256 = "b".repeat(64);
  const backupManifestSha256 = "c".repeat(64);
  const artifactReverificationSha256 = "d".repeat(64);
  const liveSchemaContractSha256 = "e".repeat(64);
  const logicalDataContractSha256 = "f".repeat(64);
  records.recoveryAssurance.releaseAssurance = structuredClone(
    SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  );
  records.recoveryAssurance.observations = {
    backupContractId: "pre-successor-backup",
    postExpandBackupContractId: "post-successor-backup",
    postExpandBackupReceiptSha256: backupReceiptSha256,
    postExpandBackupManifestSha256: backupManifestSha256,
    postExpandBackupReverificationSha256: artifactReverificationSha256,
    postExpandLiveSchemaContractSha256: liveSchemaContractSha256,
    postExpandLogicalDataContractSha256: logicalDataContractSha256,
    postExpandEncryptedArtifactsVerified: true,
    postExpandPGliteJsonbRoundTripVerified: true,
    providerPhysicalBackupStatus: "COMPLETED",
  };
  records.storage.storageProvenance = {
    originalBytesBackupReceiptFileName: "storage-original-bytes.json",
    originalBytesBackupReceiptSha256: "1".repeat(64),
  };
  const retained = names.map((name) => ({
    name,
    receiptSha256: records[name].receiptSha256,
    rawEvidenceSha256: records[name].rawEvidenceSha256,
    verifiedAt: records[name].verifiedAt,
    expiresAt: records[name].expiresAt,
  }));
  const outcomeReceipt = {
    successorRuntimeEvidence: retained,
    successorRuntimeEvidenceSetSha256: sha256Text(
      `${retained.map((record) => [
        record.name,
        record.receiptSha256,
        record.rawEvidenceSha256,
        record.verifiedAt,
        record.expiresAt,
      ].join(":")).join("\n")}\n`,
    ),
    successorReleaseAssurance: structuredClone(
      SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
    ),
  };
  const input = {
    repoRoot: resolve(receiptRoot, "repo"),
    receiptRoot,
    recoveryReceiptPath,
    recoveryReceiptSha256: records.recoveryAssurance.receiptSha256,
    sourceManifest: {
      deploymentEvidence: {
        recoveryAssurance: { receiptFileName: recoveryFileName },
      },
    },
    controllerManifest: {
      backupContract: {
        id: "pre-successor-backup",
        providerPhysicalBackup: { requiredStatus: "COMPLETED" },
      },
      postExpandBackupContract: { id: "post-successor-backup" },
    },
    expectedCommit: COMMIT,
    outcomeReceipt,
    postExpandBackup: {
      manifestSha256: backupManifestSha256,
      artifactReverificationSha256,
      liveSchemaContractSha256,
      logicalDataContractSha256,
    },
    postExpandBackupReceiptSha256: backupReceiptSha256,
    storageOriginalBytesBackupReceiptPath:
      join(receiptRoot, "storage-original-bytes.json"),
    now: () => NOW,
  };
  const storageFiles = {
    receiptSha256: "1".repeat(64),
    privateRawSha256: "2".repeat(64),
    encryptedBackupArtifactSha256: "3".repeat(64),
    originalBytesManifestSha256: "4".repeat(64),
  };
  let validationCalls = 0;
  try {
    const result = await productionWriteFenceFinalizerTestHooks
      .validateSuccessorRecoveryAssuranceEvidence({
        ...input,
        validateRuntimeEvidence: (request) => {
          validationCalls += 1;
          assert.equal(request.phase, "complete");
          assert.equal(request.receiptRoot, receiptRoot);
          return records;
        },
        reverifyStorageOriginalBytes: async () => storageFiles,
      });
    assert.equal(validationCalls, 1);
    assert.equal(result.sha256, records.recoveryAssurance.receiptSha256);
    assert.equal(result.rawSha256, records.recoveryAssurance.rawEvidenceSha256);
    assert.equal(result.releaseAssurance.hostedRestorePerformed, false);

    await assert.rejects(
      productionWriteFenceFinalizerTestHooks
        .validateSuccessorRecoveryAssuranceEvidence({
          ...input,
          validateRuntimeEvidence: () => ({
            ...records,
            recoveryAssurance: {
              ...records.recoveryAssurance,
              observations: {
                ...records.recoveryAssurance.observations,
                postExpandBackupReceiptSha256: "0".repeat(64),
              },
            },
          }),
          reverifyStorageOriginalBytes: async () => storageFiles,
        }),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
    );
  } finally {
    await rm(receiptRoot, { recursive: true, force: true });
  }
});

test("successor finalizer reopens and hashes the exact five encrypted 139-table backup artifacts before no-cost recovery provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "successor-finalizer-backup-"));
  const backupDirectory = join(
    root,
    "post-expand-20260819-000000-12345678123442348234123456789abc",
  );
  const backupSetId = "22345678-1234-4234-8234-123456789abc";
  const tables = Array.from({ length: 139 }, (_, index) =>
    `table_${String(index).padStart(3, "0")}`);
  const versions = Array.from({ length: 113 }, (_, index) =>
    String(20260718120000 + index));
  const digests = {
    liveSchemaContractSha256: "1".repeat(64),
    logicalDataContractSha256: "2".repeat(64),
    authSchemaContractSha256: "3".repeat(64),
    authUsersContractSha256: "4".repeat(64),
    storageMetadataContractSha256: "5".repeat(64),
    storageObjectInventorySha256: "6".repeat(64),
  };
  const artifactSpecs = {
    schema_inventory: {
      artifact: "schema-inventory.json.hbam2",
      key: "schema-inventory.json.key.dpapi",
    },
    logical_data: {
      artifact: "logical-data.json.hbam2",
      key: "logical-data.json.key.dpapi",
    },
  };
  try {
    await mkdir(backupDirectory);
    for (const [index, spec] of Object.values(artifactSpecs).entries()) {
      await writeFile(join(backupDirectory, spec.artifact), `cipher-${index}\n`, "utf8");
      await writeFile(join(backupDirectory, spec.key), `key-${index}\n`, "utf8");
    }
    const artifacts = {};
    for (const [name, spec] of Object.entries(artifactSpecs)) {
      const artifactBytes = await readFile(join(backupDirectory, spec.artifact));
      const keyBytes = await readFile(join(backupDirectory, spec.key));
      artifacts[name] = {
        backup_set_id: backupSetId,
        artifact: spec.artifact,
        key: spec.key,
        plaintext_sha256: "7".repeat(64),
        encrypted_sha256: createHash("sha256").update(artifactBytes).digest("hex"),
        key_sha256: createHash("sha256").update(keyBytes).digest("hex"),
        plaintext_bytes: 10,
        encrypted_bytes: artifactBytes.length,
      };
    }
    const contract = {
      id: "post-test-release-backup",
      version: 2,
      maximumAgeMinutes: 1_440,
      expectedTableCount: tables.length,
      expectedTables: tables,
      expectedTableContractSha256: sha256Text(`${tables.join("\n")}\n`),
      expectedReleaseMigrationHead: versions.at(-1),
      expectedReleaseMigrationVersions: versions,
      expectedReleaseMigrationContractSha256:
        sha256Text(`${versions.join("\n")}\n`),
    };
    const backupManifest = {
      status: "complete",
      format: "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser",
      format_version: 2,
      backup_type: "vendor-disclosure-successor-post-expand-logical-snapshot-v2",
      backup_set_id: backupSetId,
      release: RELEASE,
      backup_contract_id: contract.id,
      backup_contract_version: 2,
      created_at_utc: "2026-07-17T03:05:00.000Z",
      source_captured_at: "2026-07-17T03:00:00.000Z",
      source_project_ref: PROJECT_REF,
      source_database_identity: {
        database_oid: "16384",
        system_identifier: DATABASE_SYSTEM_IDENTIFIER,
      },
      source_migration_head: "20260819100000",
      source_migration_count: 228,
      release_migration_count: versions.length,
      release_migration_versions_sha256:
        contract.expectedReleaseMigrationContractSha256,
      expected_tables: tables,
      table_count: tables.length,
      table_contract_sha256: contract.expectedTableContractSha256,
      live_schema_contract_sha256: digests.liveSchemaContractSha256,
      logical_data_contract_sha256: digests.logicalDataContractSha256,
      auth_schema_contract_sha256: digests.authSchemaContractSha256,
      auth_users_contract_sha256: digests.authUsersContractSha256,
      storage_metadata_contract_sha256: digests.storageMetadataContractSha256,
      storage_object_inventory_sha256: digests.storageObjectInventorySha256,
      git_commit: COMMIT,
      git_origin: ORIGIN,
      git_remote_ref: REMOTE_REF,
      supabase_cli: {
        version: "2.106.0",
        invocation_relative_path: "bin/supabase.exe",
        files: { "bin/supabase.exe": CLI_SHA },
      },
      plaintext_written_to_disk: false,
      contains_secrets: false,
      tables: Object.fromEntries(tables.map((name) => [name, 0])),
      artifacts,
    };
    const manifestPath = join(backupDirectory, "manifest.json");
    await writeJson(manifestPath, backupManifest);
    const receipt = {
      receiptVersion: 2,
      kind: "successor-post-expand-backup-verification-v2",
      release: RELEASE,
      projectRef: PROJECT_REF,
      releaseCommit: COMMIT,
      backupContractId: contract.id,
      backupContractVersion: 2,
      backupSetId,
      backupManifestSha256: await sha256File(manifestPath),
      sourceDatabaseOid: "16384",
      sourceDatabaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
      expectedMigrationHead: versions.at(-1),
      migrationVersionsSha256: contract.expectedReleaseMigrationContractSha256,
      expectedTableCount: tables.length,
      expectedTables: tables,
      expectedTableContractSha256: contract.expectedTableContractSha256,
      ...digests,
      capturedAt: "2026-07-17T03:00:00.000Z",
      verifiedAt: "2026-07-17T03:10:00.000Z",
      checks: {
        authDataDigestsVerified: true,
        encryptedArtifactsVerified: true,
        exactTableContractVerified: true,
        liveSchemaDigestVerified: true,
        logicalDataDigestsVerified: true,
        plaintextWrittenToDisk: false,
        storageDataDigestsVerified: true,
      },
      containsSecrets: false,
    };
    const verified = await productionWriteFenceFinalizerTestHooks
      .validateSuccessorPostExpandBackupReceipt({
        receipt,
        sha256: "8".repeat(64),
        backupDirectory,
        repoRoot: sourceRepoRoot,
        sourceManifest: { release: RELEASE, projectRef: PROJECT_REF },
        controllerManifest: {
          backupContract: {
            expectedOrigin: ORIGIN,
            supabaseCli: { version: "2.106.0", binarySha256: CLI_SHA },
          },
        },
        contract,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        nowMs: Date.parse("2026-07-17T03:20:00.000Z"),
      });
    assert.equal(verified.backupSetId, backupSetId);
    assert.equal(verified.tableCount, 139);
    assert.equal(verified.releaseMigrationCount, 113);
    assert.equal(verified.liveSchemaContractSha256,
      digests.liveSchemaContractSha256);

    await writeFile(
      join(backupDirectory, artifactSpecs.logical_data.artifact),
      "tampered\n",
      "utf8",
    );
    await assert.rejects(
      () => productionWriteFenceFinalizerTestHooks
        .validateSuccessorPostExpandBackupReceipt({
          receipt,
          sha256: "8".repeat(64),
          backupDirectory,
          repoRoot: sourceRepoRoot,
          sourceManifest: { release: RELEASE, projectRef: PROJECT_REF },
          controllerManifest: {
            backupContract: {
              expectedOrigin: ORIGIN,
              supabaseCli: { version: "2.106.0", binarySha256: CLI_SHA },
            },
          },
          contract,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          nowMs: Date.parse("2026-07-17T03:20:00.000Z"),
        }),
      (error) => error instanceof ProductionWriteFenceFinalizerError
        && error.code === "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer CLI arguments are exact by predecessor versus successor status", () => {
  const sharedArgv = [
    `--expected-commit=${COMMIT}`,
    `--remote-ref=${REMOTE_REF}`,
    "--release-outcome=C:\\private\\outcome.json",
    "--deployment-receipt=C:\\private\\deployment.json",
    "--post-expand-backup-receipt=C:\\private\\backup.json",
    "--post-expand-hosted-restore-receipt=C:\\private\\restore.json",
    "--canary-receipt=C:\\private\\canary.json",
    "--receipt-out=C:\\private\\final.json",
    "--confirm-production=FINALIZE:fixture",
  ];
  const predecessorArgs = productionWriteFenceFinalizerTestHooks.parseArgs(
    sharedArgv,
  );
  assert.doesNotThrow(() => productionWriteFenceFinalizerTestHooks
    .validateStatusSpecificArguments(predecessorArgs, false));
  assert.throws(
    () => productionWriteFenceFinalizerTestHooks
      .validateStatusSpecificArguments(predecessorArgs, true),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "ARGUMENT_REQUIRED",
  );
  assert.throws(
    () => productionWriteFenceFinalizerTestHooks
      .validateStatusSpecificArguments({
        ...predecessorArgs,
        postExpandBackupDirectory:
          "C:\\private\\post-expand-20260819-000000-12345678123442348234123456789abc",
        recoveryAssuranceReceipt: "C:\\private\\recovery.json",
        storageOriginalBytesBackupReceipt:
          "C:\\private\\storage-original-bytes.json",
      }, true),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "ARGUMENT_UNKNOWN",
  );
  const successorArgs = productionWriteFenceFinalizerTestHooks.parseArgs([
    ...sharedArgv.filter(
      (argument) => !argument.startsWith(
        "--post-expand-hosted-restore-receipt=",
      ),
    ),
    "--recovery-assurance-receipt=C:\\private\\recovery.json",
    "--storage-original-bytes-backup-receipt=C:\\private\\storage-original-bytes.json",
    "--post-expand-backup-directory=C:\\private\\post-expand-20260819-000000-12345678123442348234123456789abc",
  ]);
  assert.doesNotThrow(() => productionWriteFenceFinalizerTestHooks
    .validateStatusSpecificArguments(successorArgs, true));
  assert.throws(
    () => productionWriteFenceFinalizerTestHooks
      .validateStatusSpecificArguments(successorArgs, false),
    (error) => error instanceof ProductionWriteFenceFinalizerError
      && error.code === "ARGUMENT_UNKNOWN",
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

test("the current 117-migration successor keeps finalization blocked through the invite-expiry message tail", async () => {
  const manifest = JSON.parse(await readFile(
    join(
      sourceRepoRoot,
      "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
    ),
    "utf8",
  ));
  assert.equal(manifest.expandMigrations.length, 117);
  assert.deepEqual(
    manifest.expandMigrations.slice(-15),
    [
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
      {
        file: "20260819100000_amora_preparation_action_receipt_binding_read.sql",
        sha256: "5141c65448b0e454c7fc6545f3705c7342cd95685f3f5f9f30bcf4dff56e64a6",
      },
      {
        file: "20260820120000_neutral_join_reports_legacy_space.sql",
        sha256: "8f9b23e179194eb63d3934996e10a0f383a4c031aec9ff950033e59f1d4f6f80",
      },
      {
        file: "20260820130000_legacy_join_blocks_neutral_space.sql",
        sha256: "6e0668148b9773f27b00b30b59b36d221ed876056b23f636bb9608ab8db6e3c0",
      },
      {
        file: "20260820140000_neutral_schedule_assignee_label.sql",
        sha256: "457d14d4f641a1f6896143410dd2812848b07b3737a8b78eb5c36b5f8ca97d23",
      },
      {
        file: "20260820150000_invite_expiry_is_not_a_typo.sql",
        sha256: "e803d23f36a2d0918ed30fc8f75b6f1e54873291000f66ac9731cca190eaa4b5",
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
