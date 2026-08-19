import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  successorHostedStagingEvidenceTestHooks,
} from "../lib/vendor-disclosure-successor-hosted-staging-evidence.mjs";
import {
  emitVendorDisclosureSuccessorRecoveryAssurance,
} from "../lib/vendor-disclosure-successor-recovery-assurance.mjs";
import {
  SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT,
  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  validateSuccessorRuntimeEvidence,
} from "../lib/supabase-successor-release-contract.mjs";

const RELEASE = "vendor-disclosure-v2-20260718";
const PROJECT_REF = "slrtobkksjmxgzatjyqb";
const STAGING_REF = "rgxdizztidbgwnsbadml";
const COMMIT = "a".repeat(40);
const ORIGIN = "https://github.com/example/hanbang.git";
const REMOTE_REF = "origin/codex/no-cost-recovery";
const NOW = new Date("2026-08-19T05:10:00.000Z");
const INPUT_CAPTURED_AT = "2026-08-19T05:00:00.000Z";
const INPUT_EXPIRES_AT = "2026-08-19T05:30:00.000Z";
const REQUIRED_REMOTE_HEAD = "20260727090000";
const VERSIONS = ["20260818100000", "20260819100000"];
const POSTCHECK_IDS = ["successor-semantic-postcheck"];
const TABLES = ["profiles", "wedding_journeys"];
const SHA = /^[a-f0-9]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function canonicalJsonSha256(value) {
  return sha256(`${canonicalJson(value)}\n`);
}

function listSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

async function writeJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, "utf8");
  return { text, sha256: sha256(text) };
}

function runtimeBinding(rollbackContract) {
  return {
    expectedMigrationHead: VERSIONS.at(-1),
    migrationCount: VERSIONS.length,
    migrationVersionsSha256: listSha256(VERSIONS),
    postApplyCheckIds: POSTCHECK_IDS,
    postApplyChecksSha256: listSha256(POSTCHECK_IDS),
    rollbackContractSha256: canonicalJsonSha256(rollbackContract),
  };
}

function standardReceipt({
  kind,
  rawFileName,
  rawSource,
  rawSha256,
  requiredChecks,
  observations,
  rollbackContract,
  maximumAgeMinutes,
}) {
  const binding = runtimeBinding(rollbackContract);
  return {
    receiptVersion: 1,
    kind,
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    capturedAt: INPUT_CAPTURED_AT,
    expiresAt: new Date(
      Date.parse(INPUT_CAPTURED_AT) + maximumAgeMinutes * 60_000,
    ).toISOString(),
    requiredRemoteHead: REQUIRED_REMOTE_HEAD,
    expectedMigrationHead: binding.expectedMigrationHead,
    migrationCount: binding.migrationCount,
    migrationVersionsSha256: binding.migrationVersionsSha256,
    observations,
    postApplyCheckIds: binding.postApplyCheckIds,
    postApplyChecksSha256: binding.postApplyChecksSha256,
    rollbackContractSha256: binding.rollbackContractSha256,
    checks: Object.fromEntries(requiredChecks.map((check) => [check, true])),
    rawProvenance: {
      fileName: rawFileName,
      sha256: rawSha256,
      capturedAt: INPUT_CAPTURED_AT,
      source: rawSource,
    },
    containsSecrets: false,
  };
}

const IMPLEMENTATION_PATHS = [
  "apps/web/package.json",
  "apps/web/scripts/vendor-disclosure-db-backup-roundtrip.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/amora-db-backup-common.ps1",
  "scripts/provenance/amora-verifier-runtime.json",
  "scripts/vendor-disclosure-db-current-baseline-common.ps1",
  "scripts/vendor-disclosure-db-backup-common.ps1",
  "scripts/vendor-disclosure-db-backup.ps1",
  "scripts/vendor-disclosure-db-verify-backup.ps1",
];

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "successor-recovery-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-recovery-private-"));
  const backupRoot = await mkdtemp(join(tmpdir(), "successor-post-expand-root-"));
  const backupDirectory = join(
    backupRoot,
    "post-expand-20260819-050500-0123456789abcdef0123456789abcdef",
  );
  await mkdir(backupDirectory);

  const implementationFiles = {};
  for (const [index, relativePath] of IMPLEMENTATION_PATHS.entries()) {
    const path = join(repoRoot, ...relativePath.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    const bytes = Buffer.from(`implementation-${index}\n`, "utf8");
    await writeFile(path, bytes);
    implementationFiles[relativePath] = sha256(bytes);
  }

  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${RELEASE}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: {
      AMORA_OPENAI_ENABLED: "false",
    },
    requiredChecks: ["databaseWriteFenceHeld"],
  };
  const binding = runtimeBinding(rollbackContract);
  const backupRequirement = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.backup;
  const stagingRequirement = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.hostedStaging;
  const recoveryRequirement =
    SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.recoveryAssurance;
  const deploymentEvidence = {
    backup: {
      ...backupRequirement,
      rawEvidenceFileName: `${RELEASE}-backup-raw.json`,
      receiptFileName: `${RELEASE}-backup-evidence.json`,
    },
    finalizer: {
      ...SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.finalizer,
      rawEvidenceFileName: `${RELEASE}-finalizer-raw.json`,
      receiptFileName: `${RELEASE}-finalizer-evidence.json`,
    },
    hostedStaging: {
      ...stagingRequirement,
      rawEvidenceFileName: `${RELEASE}-hosted-staging-raw.json`,
      receiptFileName: `${RELEASE}-hosted-staging-evidence.json`,
    },
    recoveryAssurance: {
      ...recoveryRequirement,
      releaseAssurance: structuredClone(
        SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
      ),
      rawEvidenceFileName: `${RELEASE}-recovery-assurance-raw.json`,
      receiptFileName: `${RELEASE}-recovery-assurance-evidence.json`,
    },
    storage: {
      ...SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.storage,
      rawEvidenceFileName: `${RELEASE}-storage-raw.json`,
      receiptFileName: `${RELEASE}-storage-evidence.json`,
    },
  };
  const backupContract = {
    id: `pre-${RELEASE}-current-remote-backup`,
    version: 2,
    format: "hbam2-encrypted-current-user",
    expectedMigrationHead: REQUIRED_REMOTE_HEAD,
    expectedTableCount: TABLES.length,
    expectedTables: TABLES,
    expectedTableContractSha256: listSha256(TABLES),
    expectedOrigin: ORIGIN,
    providerPhysicalBackup: {
      maximumAgeHours: 26,
      requirePhysicalBackup: true,
      requiredStatus: "COMPLETED",
      restoreCapability: "completed-physical-backup",
    },
    supabaseCli: {
      version: "2.54.11",
      binarySha256: "B".repeat(64),
    },
  };
  const postExpandBackupContract = {
    id: `post-${RELEASE}-backup`,
    version: 2,
    maximumAgeMinutes: 1_440,
    expectedReleaseMigrationHead: VERSIONS.at(-1),
    expectedReleaseMigrationVersions: VERSIONS,
    expectedReleaseMigrationContractSha256: listSha256(VERSIONS),
    expectedTableCount: TABLES.length,
    expectedTables: TABLES,
    expectedTableContractSha256: listSha256(TABLES),
    common: {
      file: "scripts/vendor-disclosure-db-backup-common.ps1",
      sha256: implementationFiles[
        "scripts/vendor-disclosure-db-backup-common.ps1"
      ],
    },
    capture: {
      file: "scripts/vendor-disclosure-db-backup.ps1",
      sha256: implementationFiles["scripts/vendor-disclosure-db-backup.ps1"],
    },
    verifier: {
      file: "scripts/vendor-disclosure-db-verify-backup.ps1",
      sha256: implementationFiles[
        "scripts/vendor-disclosure-db-verify-backup.ps1"
      ],
    },
  };
  const postcheckFile = "supabase/release-checks/successor-semantic-postcheck.sql";
  const postcheckSql = [
    "BEGIN TRANSACTION READ ONLY;",
    "SELECT 1 AS successor_semantic_postcheck_count;",
    "COMMIT;",
    "",
  ].join("\n");
  await mkdir(join(repoRoot, "supabase", "release-checks"), { recursive: true });
  await writeFile(join(repoRoot, ...postcheckFile.split("/")), postcheckSql, "utf8");
  const postcheckSha256 = sha256(postcheckSql);
  const approvedStagingContract = {
    contractVersion: 1,
    kind: "vendor-disclosure-hosted-staging-v2",
    release: RELEASE,
    productionProjectRef: PROJECT_REF,
    projectRef: STAGING_REF,
    status: "approved_for_hosted_rls_probe",
    approved: true,
    approvalEvidence:
      "codex-thread:user-approved-dedicated-free-staging-2026-07-22",
    publicViewDefinitionSha256: structuredClone(
      successorHostedStagingEvidenceTestHooks.APPROVED_PUBLIC_VIEW_SHA256,
    ),
  };
  const approvedStagingPath = join(
    repoRoot,
    "supabase",
    "release-contracts",
    "vendor-disclosure-hosted-staging-v2-20260718.json",
  );
  await mkdir(join(approvedStagingPath, ".."), { recursive: true });
  const approvedStagingWritten = await writeJson(
    approvedStagingPath,
    approvedStagingContract,
  );
  const controllerManifest = {
    release: RELEASE,
    projectRef: PROJECT_REF,
    backupContract,
    postExpandBackupContract,
    preApplyChecks: [{ id: "successor-precheck" }],
    postApplyChecks: [{
      id: POSTCHECK_IDS[0],
      type: "read-only-sql",
      file: postcheckFile,
      sha256: postcheckSha256,
      expectedEvidence: { successor_semantic_postcheck_count: 1 },
    }],
    rollbackContract,
    recoveryAssuranceContract: structuredClone(
      SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT,
    ),
  };
  const manifest = {
    release: RELEASE,
    projectRef: PROJECT_REF,
    status: "controller_ready",
    requiredRemoteHead: REQUIRED_REMOTE_HEAD,
    expandMigrations: VERSIONS.map((version) => ({
      file: `${version}_fixture.sql`,
      sha256: "c".repeat(64),
    })),
    deploymentEvidence,
  };

  const providerLatest = Math.floor(
    Date.parse("2026-08-19T04:00:00.000Z") / 1_000,
  );
  const backupRaw = {
    rawEvidenceVersion: 1,
    kind: "vendor-disclosure-successor-backup-raw-v1",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    capturedAt: INPUT_CAPTURED_AT,
    logicalBackup: {
      backupContractId: backupContract.id,
      backupContractVersion: backupContract.version,
      backupSetId: randomUUID(),
      manifestSha256: "d".repeat(64),
      sourceCapturedAt: "2026-08-19T04:59:00.000Z",
      verifiedAt: INPUT_CAPTURED_AT,
      sourceMigrationHead: backupContract.expectedMigrationHead,
      sourceMigrationCount: 147,
      expectedTableCount: backupContract.expectedTableCount,
      expectedTables: backupContract.expectedTables,
      expectedTableContractSha256: backupContract.expectedTableContractSha256,
      inventorySha256: "e".repeat(64),
      liveSchemaContractSha256: "1".repeat(64),
      logicalDataContractSha256: "2".repeat(64),
      authSchemaContractSha256: "3".repeat(64),
      authUsersCanonicalSha256: "4".repeat(64),
      authUsersContractSha256: "5".repeat(64),
      sourceProjectRefSha256: "6".repeat(64),
      sourceDatabaseIdentitySha256: "7".repeat(64),
      sourceDatabaseSystemIdentifierSha256: "8".repeat(64),
      sourceDatabaseNameSha256: "9".repeat(64),
      sourceDatabaseOidSha256: "a".repeat(64),
      sourceMigrationVersionsSha256: "b".repeat(64),
      sourceRelationContractSha256: "c".repeat(64),
      encryptedArtifacts: {
        LogicalDataCiphertextSha256: "d".repeat(64),
        LogicalDataProtectedKeySha256: "e".repeat(64),
        SchemaInventoryCiphertextSha256: "f".repeat(64),
        SchemaInventoryProtectedKeySha256: "0".repeat(64),
      },
      supabaseCli: {
        Version: backupContract.supabaseCli.version,
        BinarySha256: backupContract.supabaseCli.binarySha256,
      },
      verifier: { File: "fixture", Sha256: "1".repeat(64) },
      encryptedArtifactsVerified: true,
      sourceCanonicalDigestsVerified: true,
      pgliteJsonbRoundTripVerified: true,
      plaintextWrittenToDisk: false,
    },
    providerPhysicalBackup: {
      status: "COMPLETED",
      isPhysicalBackup: true,
      insertedAt: new Date(providerLatest * 1_000).toISOString(),
      latestPhysicalBackupDateUnix: providerLatest,
      ageSeconds: 3_600,
      restoreCapability: "completed-physical-backup",
      restoreCandidateAvailable: true,
      responseStatusCode: 200,
      responseBytes: 123,
      responseSha256: "2".repeat(64),
    },
    containsSecrets: false,
  };
  const backupRawWritten = await writeJson(
    join(receiptRoot, deploymentEvidence.backup.rawEvidenceFileName),
    backupRaw,
  );
  const backupReceipt = standardReceipt({
    kind: deploymentEvidence.backup.kind,
    rawFileName: deploymentEvidence.backup.rawEvidenceFileName,
    rawSource: deploymentEvidence.backup.rawEvidenceSource,
    rawSha256: backupRawWritten.sha256,
    requiredChecks: deploymentEvidence.backup.requiredChecks,
    observations: {
      backupContractId: backupContract.id,
      backupContractVersion: backupContract.version,
      expectedMigrationHead: backupContract.expectedMigrationHead,
      expectedTableContractSha256: backupContract.expectedTableContractSha256,
      expectedTableCount: backupContract.expectedTableCount,
      providerPhysicalBackupStatus: "COMPLETED",
      restoreCandidateAvailable: true,
    },
    rollbackContract,
    maximumAgeMinutes: deploymentEvidence.backup.maximumAgeMinutes,
  });
  const backupReceiptWritten = await writeJson(
    join(receiptRoot, deploymentEvidence.backup.receiptFileName),
    backupReceipt,
  );

  const probeResult = Object.fromEntries(Object.entries(
    successorHostedStagingEvidenceTestHooks.PROBE_SCENARIOS,
  ).map(([name, contract]) => [name, {
    scenario: contract.scenario,
    syntheticUserCount: contract.syntheticUserCount,
    ...(contract.providerEvidence === undefined ? {} : {
      providerEvidence: contract.providerEvidence,
    }),
    checks: Object.fromEntries(contract.checks.map((check) => [check, true])),
    residue: Object.fromEntries(contract.residue.map((key) => [key, 0])),
  }]));
  probeResult.preparationActionReceiptBindingContract = {
    preparationActionReceiptBindingReadRpcAclCount: 1,
  };
  const probeReceiptSha256 = "4".repeat(64);
  const postcheckReceiptSha256 = "5".repeat(64);
  const featureOffReceiptSha256 = "6".repeat(64);
  const rollbackReceiptSha256 = "7".repeat(64);
  const probeReceipt = {
    receiptVersion: 8,
    kind: "amora-successor-hosted-staging-probe",
    scope: successorHostedStagingEvidenceTestHooks.PROBE_SCOPE,
    projectRef: STAGING_REF,
    gitCommit: COMMIT,
    migrationLedger: {
      count: 228,
      head: binding.expectedMigrationHead,
    },
    startedAt: "2026-08-19T04:50:00.000Z",
    completedAt: "2026-08-19T04:52:00.000Z",
    result: probeResult,
  };
  const postcheckReceipt = {
    receiptVersion: 1,
    kind: "successor-read-only-postcheck-result-v1",
    release: RELEASE,
    projectRef: STAGING_REF,
    productionProjectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    checkId: POSTCHECK_IDS[0],
    source: "supabase-management-read-only-query",
    sqlFile: postcheckFile,
    sqlSha256: postcheckSha256,
    transactionReadOnly: true,
    productionMutationAttempted: false,
    executedAt: "2026-08-19T04:53:00.000Z",
    row: {
      verified: true,
      successor_semantic_postcheck_count: 1,
    },
    containsSecrets: false,
  };
  const featureOffReceipt = {
    receiptVersion: 1,
    kind: "successor-feature-off-rollback-rehearsal-v1",
    release: RELEASE,
    projectRef: STAGING_REF,
    releaseCommit: COMMIT,
    receiptFileName: rollbackContract.featureOffReceiptFileName,
    strategy: rollbackContract.strategy,
    migrationRollback: rollbackContract.migrationRollback,
    receiptMaximumAgeMinutes: rollbackContract.maximumAgeMinutes,
    requiredControls: rollbackContract.requiredControls,
    observedControls: rollbackContract.requiredControls,
    checks: Object.fromEntries(
      rollbackContract.requiredChecks.map((check) => [check, true]),
    ),
    environment: "isolated-non-production-rehearsal",
    source: "feature-off-rollback-rehearsal",
    productionMutationAttempted: false,
    verifiedAt: "2026-08-19T04:54:00.000Z",
    containsSecrets: false,
  };
  const rollbackRehearsalReceipt = {
    receiptVersion: 1,
    kind: "successor-forward-fix-rollback-rehearsal-v1",
    release: RELEASE,
    projectRef: STAGING_REF,
    productionProjectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    strategy: rollbackContract.strategy,
    migrationRollback: rollbackContract.migrationRollback,
    featureOffReceiptFileName: rollbackContract.featureOffReceiptFileName,
    featureOffReceiptSha256,
    rehearsalRunId: "12345678-1234-4123-8123-123456789abc",
    rehearsalMode: "isolated-staging-forward-fix-rehearsal",
    rehearsalPlanSha256:
      successorHostedStagingEvidenceTestHooks.forwardFixPlanSha256(
        rollbackContract,
      ),
    startedAt: "2026-08-19T04:55:00.000Z",
    completedAt: "2026-08-19T04:56:00.000Z",
    outcome: "passed",
    checks: Object.fromEntries(
      successorHostedStagingEvidenceTestHooks.FORWARD_FIX_CHECKS.map(
        (check) => [check, true],
      ),
    ),
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  const stagingRaw = {
    rawEvidenceVersion: 1,
    kind: "vendor-disclosure-successor-hosted-staging-raw-v1",
    release: RELEASE,
    productionProjectRef: PROJECT_REF,
    stagingProjectRef: STAGING_REF,
    releaseCommit: COMMIT,
    capturedAt: INPUT_CAPTURED_AT,
    approvedStagingContract: {
      file: "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
      sha256: approvedStagingWritten.sha256,
      contract: approvedStagingContract,
    },
    gitBinding: { origin: ORIGIN, remoteRef: REMOTE_REF, commit: COMMIT },
    migrationContract: {
      expectedMigrationHead: binding.expectedMigrationHead,
      migrationCount: binding.migrationCount,
      migrationVersionsSha256: binding.migrationVersionsSha256,
      hostedLedgerCount: 228,
      requiredRemoteHead: REQUIRED_REMOTE_HEAD,
    },
    checkEvidence: {
      exactMigrationSetApplied: {
        probeLedger: { count: 228, head: binding.expectedMigrationHead },
        expectedMigrationHead: binding.expectedMigrationHead,
        migrationCount: binding.migrationCount,
        migrationVersionsSha256: binding.migrationVersionsSha256,
      },
      preconditionsPassed: {
        approvedStagingContractSha256: approvedStagingWritten.sha256,
        stagingProjectRef: STAGING_REF,
        productionProjectRef: PROJECT_REF,
        cleanPushedCommit: COMMIT,
        controllerPreApplyCheckIds: ["successor-precheck"],
      },
      postconditionsPassed: {
        probeReceiptSha256,
        scenarioNames: Object.keys(
          successorHostedStagingEvidenceTestHooks.PROBE_SCENARIOS,
        ),
        zeroResidueVerified: true,
      },
      readOnlyPostchecksPassed: {
        postcheckReceiptSha256,
        sqlSha256: postcheckSha256,
        transactionReadOnly: true,
      },
      rollbackRehearsed: {
        rehearsalReceiptSha256: rollbackReceiptSha256,
        strategy: rollbackContract.strategy,
        migrationRollback: rollbackContract.migrationRollback,
      },
      featureFlagsOffVerified: {
        featureOffReceiptSha256,
        requiredControls: rollbackContract.requiredControls,
      },
    },
    probe: {
      fileName: "successor-hosted-probe.json",
      sha256: probeReceiptSha256,
      receipt: probeReceipt,
    },
    postcheck: {
      fileName: "successor-hosted-postcheck.json",
      sha256: postcheckReceiptSha256,
      sqlSha256: postcheckSha256,
      receipt: postcheckReceipt,
    },
    featureOffVerification: {
      fileName: "successor-feature-off.json",
      sha256: featureOffReceiptSha256,
      receipt: featureOffReceipt,
    },
    rollbackRehearsal: {
      fileName: "successor-forward-fix.json",
      sha256: rollbackReceiptSha256,
      completedAt: rollbackRehearsalReceipt.completedAt,
      receipt: rollbackRehearsalReceipt,
    },
    rehearsalProducerProvenance: {
      fileName: "successor-rehearsal-provenance.json",
      sha256: "8".repeat(64),
      isolatedStdoutSha256: "9".repeat(64),
      forwardFixStdoutSha256: "a".repeat(64),
      productionMutationCommandCount: 0,
      migrationRollbackCommandCount: 0,
    },
    containsSecrets: false,
  };
  const stagingRawWritten = await writeJson(
    join(receiptRoot, deploymentEvidence.hostedStaging.rawEvidenceFileName),
    stagingRaw,
  );
  const stagingReceipt = standardReceipt({
    kind: deploymentEvidence.hostedStaging.kind,
    rawFileName: deploymentEvidence.hostedStaging.rawEvidenceFileName,
    rawSource: deploymentEvidence.hostedStaging.rawEvidenceSource,
    rawSha256: stagingRawWritten.sha256,
    requiredChecks: deploymentEvidence.hostedStaging.requiredChecks,
    observations: {
      expectedMigrationHead: binding.expectedMigrationHead,
      migrationCount: binding.migrationCount,
      migrationVersionsSha256: binding.migrationVersionsSha256,
      requiredRemoteHead: REQUIRED_REMOTE_HEAD,
      rollbackStrategy: rollbackContract.strategy,
    },
    rollbackContract,
    maximumAgeMinutes: deploymentEvidence.hostedStaging.maximumAgeMinutes,
  });
  const stagingReceiptWritten = await writeJson(
    join(receiptRoot, deploymentEvidence.hostedStaging.receiptFileName),
    stagingReceipt,
  );

  const backupSetId = randomUUID();
  const artifacts = {};
  for (const [name, artifactFile, keyFile] of [
    ["logical_data", "logical-data.json.hbam2", "logical-data.json.key.dpapi"],
    ["schema_inventory", "schema-inventory.json.hbam2", "schema-inventory.json.key.dpapi"],
  ]) {
    const artifactBytes = Buffer.from(`${name}-ciphertext`, "utf8");
    const keyBytes = Buffer.from(`${name}-key`, "utf8");
    await writeFile(join(backupDirectory, artifactFile), artifactBytes);
    await writeFile(join(backupDirectory, keyFile), keyBytes);
    artifacts[name] = {
      artifact: artifactFile,
      backup_set_id: backupSetId,
      encrypted_bytes: artifactBytes.length,
      encrypted_sha256: sha256(artifactBytes),
      key: keyFile,
      key_sha256: sha256(keyBytes),
      plaintext_bytes: 100,
      plaintext_sha256: sha256(`${name}-plaintext`),
    };
  }
  const postDigests = {
    live: "1".repeat(64),
    logical: "2".repeat(64),
    authSchema: "3".repeat(64),
    authUsers: "4".repeat(64),
    storageMetadata: "5".repeat(64),
    storageObjects: "6".repeat(64),
  };
  const backupManifest = {
    status: "complete",
    format: "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser",
    format_version: 2,
    backup_type: "vendor-disclosure-successor-post-expand-logical-snapshot-v2",
    backup_set_id: backupSetId,
    release: RELEASE,
    backup_contract_id: postExpandBackupContract.id,
    backup_contract_version: 2,
    created_at_utc: "2026-08-19T05:06:00.000Z",
    source_captured_at: "2026-08-19T05:05:00.000Z",
    source_project_ref: PROJECT_REF,
    source_database_identity: {
      database_oid: "16384",
      system_identifier: "123456789012345678",
    },
    source_migration_head: VERSIONS.at(-1),
    source_migration_count: 228,
    release_migration_count: VERSIONS.length,
    release_migration_versions_sha256:
      postExpandBackupContract.expectedReleaseMigrationContractSha256,
    table_count: TABLES.length,
    expected_tables: TABLES,
    tables: Object.fromEntries(TABLES.map((name) => [name, { row_count: 0 }])),
    table_contract_sha256: postExpandBackupContract.expectedTableContractSha256,
    live_schema_contract_sha256: postDigests.live,
    logical_data_contract_sha256: postDigests.logical,
    auth_schema_contract_sha256: postDigests.authSchema,
    auth_users_contract_sha256: postDigests.authUsers,
    storage_metadata_contract_sha256: postDigests.storageMetadata,
    storage_object_inventory_sha256: postDigests.storageObjects,
    git_commit: COMMIT,
    git_origin: ORIGIN,
    git_remote_ref: REMOTE_REF,
    plaintext_written_to_disk: false,
    contains_secrets: false,
    implementation: {
      git_commit: COMMIT,
      files: implementationFiles,
      git_blobs: implementationFiles,
    },
    supabase_cli: {
      version: backupContract.supabaseCli.version,
      invocation_relative_path: "bin/supabase.exe",
      files: { "bin/supabase.exe": backupContract.supabaseCli.binarySha256 },
    },
    artifacts,
  };
  const backupManifestWritten = await writeJson(
    join(backupDirectory, "manifest.json"),
    backupManifest,
  );
  const postExpandBackupReceipt = {
    receiptVersion: 2,
    kind: "successor-post-expand-backup-verification-v2",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    backupContractId: postExpandBackupContract.id,
    backupContractVersion: 2,
    backupSetId,
    backupManifestSha256: backupManifestWritten.sha256,
    sourceDatabaseOid: backupManifest.source_database_identity.database_oid,
    sourceDatabaseSystemIdentifier:
      backupManifest.source_database_identity.system_identifier,
    expectedMigrationHead: VERSIONS.at(-1),
    migrationVersionsSha256:
      postExpandBackupContract.expectedReleaseMigrationContractSha256,
    expectedTableCount: TABLES.length,
    expectedTables: TABLES,
    expectedTableContractSha256:
      postExpandBackupContract.expectedTableContractSha256,
    liveSchemaContractSha256: postDigests.live,
    logicalDataContractSha256: postDigests.logical,
    authSchemaContractSha256: postDigests.authSchema,
    authUsersContractSha256: postDigests.authUsers,
    storageMetadataContractSha256: postDigests.storageMetadata,
    storageObjectInventorySha256: postDigests.storageObjects,
    capturedAt: backupManifest.source_captured_at,
    verifiedAt: "2026-08-19T05:07:00.000Z",
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
  const postExpandBackupReceiptPath = join(
    backupRoot,
    `${backupSetId}-successor-post-expand-backup-verification-v2.json`,
  );
  const postReceiptWritten = await writeJson(
    postExpandBackupReceiptPath,
    postExpandBackupReceipt,
  );

  const gitCalls = [];
  const runGit = async (_repoRoot, args) => {
    gitCalls.push(args.join(" "));
    const command = args.join(" ");
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
    if (command === "rev-parse HEAD") return `${COMMIT}\n`;
    if (command === "rev-parse --verify @{upstream}") return `${COMMIT}\n`;
    if (command === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") {
      return `${REMOTE_REF}\n`;
    }
    if (command === "remote get-url origin") return `${ORIGIN}\n`;
    if (command === "ls-remote --exit-code origin refs/heads/codex/no-cost-recovery") {
      return `${COMMIT}\trefs/heads/codex/no-cost-recovery\n`;
    }
    throw new Error(`unexpected git command ${command}`);
  };
  const releaseLoader = () => ({
    controllerReady: true,
    deploymentBlocked: false,
    manifest,
    controllerManifest,
  });

  return {
    repoRoot,
    receiptRoot,
    backupRoot,
    backupDirectory,
    postExpandBackupReceiptPath,
    manifest,
    controllerManifest,
    deploymentEvidence,
    backupRaw,
    backupReceipt,
    stagingRaw,
    stagingReceipt,
    backupManifest,
    postExpandBackupReceipt,
    postReceiptWritten,
    backupReceiptWritten,
    backupRawWritten,
    stagingReceiptWritten,
    stagingRawWritten,
    runGit,
    gitCalls,
    releaseLoader,
  };
}

async function cleanupFixture(fixture) {
  await Promise.all([
    rm(fixture.repoRoot, { recursive: true, force: true }),
    rm(fixture.receiptRoot, { recursive: true, force: true }),
    rm(fixture.backupRoot, { recursive: true, force: true }),
  ]);
}

test("the no-cost recovery assurance emitter is exposed through one deep public interface", () => {
  assert.equal(
    typeof emitVendorDisclosureSuccessorRecoveryAssurance,
    "function",
  );
});

test("emits a central-validator-ready no-cost receipt from reopened evidence and encrypted artifacts", async () => {
  const fixture = await createFixture();
  try {
    const result = await emitVendorDisclosureSuccessorRecoveryAssurance({
      repoRoot: fixture.repoRoot,
      receiptRoot: fixture.receiptRoot,
      expectedCommit: COMMIT,
      remoteRef: REMOTE_REF,
      postExpandBackupReceiptPath: fixture.postExpandBackupReceiptPath,
      postExpandBackupDirectory: fixture.backupDirectory,
      now: () => NOW,
      runGit: fixture.runGit,
      releaseLoader: fixture.releaseLoader,
    });
    const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
    const raw = JSON.parse(await readFile(result.rawEvidencePath, "utf8"));
    assert.deepEqual(
      receipt.releaseAssurance,
      SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
    );
    assert.equal(receipt.releaseAssurance.additionalProjectCreated, false);
    assert.equal(receipt.releaseAssurance.hostedRestorePerformed, false);
    assert.equal(receipt.releaseAssurance.additionalMonthlyCostUsd, 0);
    assert.equal(receipt.releaseAssurance.restoreValidationClaimed, false);
    assert.equal(receipt.observations.preApplyBackupReceiptSha256,
      fixture.backupReceiptWritten.sha256);
    assert.equal(receipt.observations.preApplyBackupRawEvidenceSha256,
      fixture.backupRawWritten.sha256);
    assert.equal(receipt.observations.hostedStagingReceiptSha256,
      fixture.stagingReceiptWritten.sha256);
    assert.equal(receipt.observations.hostedStagingRawEvidenceSha256,
      fixture.stagingRawWritten.sha256);
    assert.equal(receipt.observations.postExpandBackupReceiptSha256,
      fixture.postReceiptWritten.sha256);
    assert.equal(receipt.observations.postExpandBackupManifestSha256,
      fixture.postExpandBackupReceipt.backupManifestSha256);
    assert.match(
      receipt.observations.postExpandBackupReverificationSha256,
      SHA,
    );
    const expectedReverification = sha256(`${[
      "successor-post-expand-backup-artifact-reopen-v1",
      fixture.postReceiptWritten.sha256,
      fixture.postExpandBackupReceipt.backupManifestSha256,
      ...["logical_data", "schema_inventory"].map((name) => {
        const artifact = fixture.backupManifest.artifacts[name];
        return `${name}:${artifact.encrypted_sha256}:${artifact.encrypted_bytes}:${artifact.key_sha256}:${Buffer.byteLength(`${name}-key`, "utf8")}`;
      }),
    ].join("\n")}\n`);
    assert.equal(
      receipt.observations.postExpandBackupReverificationSha256,
      expectedReverification,
    );
    assert.equal(receipt.observations.postExpandEncryptedArtifactsVerified, true);
    assert.equal(
      receipt.observations.postExpandPGliteJsonbRoundTripVerified,
      true,
    );
    assert.equal(receipt.observations.providerPhysicalBackupStatus, "COMPLETED");
    assert.equal(raw.releaseAssurance.restoreValidationClaimed, false);
    assert.equal("hostedRestore" in raw, false);
    assert.equal(fixture.gitCalls.length, 12);

    const central = validateSuccessorRuntimeEvidence({
      repoRoot: fixture.repoRoot,
      receiptRoot: fixture.receiptRoot,
      manifest: fixture.manifest,
      controllerManifest: fixture.controllerManifest,
      expectedCommit: COMMIT,
      phase: "post-expand",
      now: () => NOW,
    });
    assert.equal(central.recoveryAssurance.receiptSha256, result.receiptSha256);
    assert.equal(
      basename(result.rawEvidencePath),
      fixture.deploymentEvidence.recoveryAssurance.rawEvidenceFileName,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("rejects a self-authored PGlite boolean even when the attacker rehashes the raw pair", async () => {
  const fixture = await createFixture();
  try {
    fixture.backupRaw.logicalBackup.pgliteJsonbRoundTripVerified = false;
    const rawWritten = await writeJson(
      join(
        fixture.receiptRoot,
        fixture.deploymentEvidence.backup.rawEvidenceFileName,
      ),
      fixture.backupRaw,
    );
    fixture.backupReceipt.rawProvenance.sha256 = rawWritten.sha256;
    await writeJson(
      join(
        fixture.receiptRoot,
        fixture.deploymentEvidence.backup.receiptFileName,
      ),
      fixture.backupReceipt,
    );
    await assert.rejects(
      emitVendorDisclosureSuccessorRecoveryAssurance({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        postExpandBackupReceiptPath: fixture.postExpandBackupReceiptPath,
        postExpandBackupDirectory: fixture.backupDirectory,
        now: () => NOW,
        runGit: fixture.runGit,
        releaseLoader: fixture.releaseLoader,
      }),
      (error) => error?.code === "SUCCESSOR_RECOVERY_BACKUP_EVIDENCE_INVALID",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("rejects rehashed hosted-Staging placeholders and contradictory nested facts", async () => {
  const fixture = await createFixture();
  try {
    fixture.stagingRaw.checkEvidence.readOnlyPostchecksPassed = {
      verified: true,
      transactionReadOnly: false,
    };
    const rawWritten = await writeJson(
      join(
        fixture.receiptRoot,
        fixture.deploymentEvidence.hostedStaging.rawEvidenceFileName,
      ),
      fixture.stagingRaw,
    );
    fixture.stagingReceipt.rawProvenance.sha256 = rawWritten.sha256;
    await writeJson(
      join(
        fixture.receiptRoot,
        fixture.deploymentEvidence.hostedStaging.receiptFileName,
      ),
      fixture.stagingReceipt,
    );
    await assert.rejects(
      emitVendorDisclosureSuccessorRecoveryAssurance({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        postExpandBackupReceiptPath: fixture.postExpandBackupReceiptPath,
        postExpandBackupDirectory: fixture.backupDirectory,
        now: () => NOW,
        runGit: fixture.runGit,
        releaseLoader: fixture.releaseLoader,
      }),
      (error) => error?.code
        === "SUCCESSOR_RECOVERY_HOSTED_STAGING_EVIDENCE_INVALID",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("does not emit if an encrypted artifact changes during the second live Git fence", async () => {
  const fixture = await createFixture();
  const rawOut = join(
    fixture.receiptRoot,
    fixture.deploymentEvidence.recoveryAssurance.rawEvidenceFileName,
  );
  const receiptOut = join(
    fixture.receiptRoot,
    fixture.deploymentEvidence.recoveryAssurance.receiptFileName,
  );
  let statusCalls = 0;
  const runGit = async (repoRoot, args) => {
    if (args.join(" ") === "status --porcelain=v1 --untracked-files=all") {
      statusCalls += 1;
      if (statusCalls === 2) {
        await writeFile(
          join(fixture.backupDirectory, "logical-data.json.hbam2"),
          "tampered-during-second-git-fence",
          "utf8",
        );
      }
    }
    return fixture.runGit(repoRoot, args);
  };
  try {
    await assert.rejects(
      emitVendorDisclosureSuccessorRecoveryAssurance({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        postExpandBackupReceiptPath: fixture.postExpandBackupReceiptPath,
        postExpandBackupDirectory: fixture.backupDirectory,
        now: () => NOW,
        runGit,
        releaseLoader: fixture.releaseLoader,
      }),
      (error) => error?.code === "SUCCESSOR_RECOVERY_INPUT_CHANGED",
    );
    await assert.rejects(readFile(rawOut), /ENOENT/);
    await assert.rejects(readFile(receiptOut), /ENOENT/);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("rejects an oversized private raw input before parsing it", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      join(
        fixture.receiptRoot,
        fixture.deploymentEvidence.backup.rawEvidenceFileName,
      ),
      Buffer.alloc(4 * 1024 * 1024 + 1, 0x20),
    );
    await assert.rejects(
      emitVendorDisclosureSuccessorRecoveryAssurance({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        postExpandBackupReceiptPath: fixture.postExpandBackupReceiptPath,
        postExpandBackupDirectory: fixture.backupDirectory,
        now: () => NOW,
        runGit: fixture.runGit,
        releaseLoader: fixture.releaseLoader,
      }),
      (error) => error?.code === "SUCCESSOR_RECOVERY_BACKUP_EVIDENCE_INVALID",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("recomputes provider physical-backup freshness instead of trusting COMPLETED", async () => {
  const fixture = await createFixture();
  try {
    const oldLatest = Math.floor(
      Date.parse("2026-08-17T00:00:00.000Z") / 1_000,
    );
    fixture.backupRaw.providerPhysicalBackup.latestPhysicalBackupDateUnix =
      oldLatest;
    fixture.backupRaw.providerPhysicalBackup.insertedAt =
      new Date(oldLatest * 1_000).toISOString();
    fixture.backupRaw.providerPhysicalBackup.ageSeconds = Math.floor(
      (Date.parse(INPUT_CAPTURED_AT) - oldLatest * 1_000) / 1_000,
    );
    const rawWritten = await writeJson(
      join(
        fixture.receiptRoot,
        fixture.deploymentEvidence.backup.rawEvidenceFileName,
      ),
      fixture.backupRaw,
    );
    fixture.backupReceipt.rawProvenance.sha256 = rawWritten.sha256;
    await writeJson(
      join(
        fixture.receiptRoot,
        fixture.deploymentEvidence.backup.receiptFileName,
      ),
      fixture.backupReceipt,
    );
    await assert.rejects(
      emitVendorDisclosureSuccessorRecoveryAssurance({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        postExpandBackupReceiptPath: fixture.postExpandBackupReceiptPath,
        postExpandBackupDirectory: fixture.backupDirectory,
        now: () => NOW,
        runGit: fixture.runGit,
        releaseLoader: fixture.releaseLoader,
      }),
      (error) => error?.code === "SUCCESSOR_RECOVERY_BACKUP_EVIDENCE_INVALID",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("requires the live origin branch to remain at the commit on the second fence", async () => {
  const fixture = await createFixture();
  const rawOut = join(
    fixture.receiptRoot,
    fixture.deploymentEvidence.recoveryAssurance.rawEvidenceFileName,
  );
  let liveCalls = 0;
  const runGit = async (repoRoot, args) => {
    if (args[0] === "ls-remote") {
      liveCalls += 1;
      if (liveCalls === 2) {
        return `${"f".repeat(40)}\trefs/heads/codex/no-cost-recovery\n`;
      }
    }
    return fixture.runGit(repoRoot, args);
  };
  try {
    await assert.rejects(
      emitVendorDisclosureSuccessorRecoveryAssurance({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        postExpandBackupReceiptPath: fixture.postExpandBackupReceiptPath,
        postExpandBackupDirectory: fixture.backupDirectory,
        now: () => NOW,
        runGit,
        releaseLoader: fixture.releaseLoader,
      }),
      (error) => error?.code === "SUCCESSOR_RECOVERY_GIT_INVALID",
    );
    await assert.rejects(readFile(rawOut), /ENOENT/);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("CLI rejects incomplete arguments without echoing environment secrets", () => {
  const secret = "no-cost-recovery-cli-secret-must-not-leak";
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(
      "../vendor-disclosure-successor-recovery-assurance.mjs",
      import.meta.url,
    ))],
    {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: secret },
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr.replace(/\r\n/g, "\n"),
    "SUCCESSOR_RECOVERY_ASSURANCE_BLOCKED [SUCCESSOR_RECOVERY_ARGUMENT_INVALID]\n",
  );
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});
