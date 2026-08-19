import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  runExternalGateCollectorCli,
} from "../collect-production-external-gate-evidence.mjs";
import {
  renderSuccessorControllerArtifacts,
  validateRenderedSuccessorControllerArtifacts,
} from "../generate-vendor-disclosure-successor-controller.mjs";
import { buildVercelDeploymentReceipt } from
  "../lib/production-external-gate-provenance.mjs";
import {
  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
} from "../lib/supabase-successor-release-contract.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const RELEASE_COMMIT = "1".repeat(40);
const DEPLOYMENT_ID = `dpl_${"a".repeat(24)}`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJsonSha256(value) {
  const canonicalJson = (candidate) => {
    if (candidate === null || typeof candidate !== "object") {
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) {
      return `[${candidate.map(canonicalJson).join(",")}]`;
    }
    return `{${Object.keys(candidate).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(candidate[key])}`,
    ).join(",")}}`;
  };
  return sha256(`${canonicalJson(value)}\n`);
}

async function writeJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, "utf8");
  return { path, receipt: value, sha256: sha256(text) };
}

function runtimeRecord(name, verifiedAt, expiresAt) {
  return {
    name,
    receiptSha256: sha256(`receipt:${name}`),
    rawEvidenceSha256: sha256(`raw:${name}`),
    verifiedAt,
    expiresAt,
  };
}

async function createSuccessorCanaryFixture(t) {
  const repoRoot = await mkdtemp(join(tmpdir(), "hanbang-gate-successor-repo-"));
  const receiptRoot = await mkdtemp(
    join(tmpdir(), "hanbang-gate-successor-receipts-"),
  );
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  });
  const markerPath = join(repoRoot, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, "{}\n", "utf8");

  const artifacts = renderSuccessorControllerArtifacts({ repoRoot: REPO_ROOT });
  // The collector receives what `validateSuccessorReleaseContract` really
  // returns, not the freshly rendered overlay: the validated controller
  // manifest carries `status: "controller_ready"` plus the migration blocks
  // that the central extended-contract validators read.
  const validated = validateRenderedSuccessorControllerArtifacts({
    repoRoot: REPO_ROOT,
    artifacts,
  });
  const sourceManifest = validated.manifest;
  const controllerManifest = validated.controllerManifest;
  const now = new Date("2026-08-19T06:00:00.000Z");
  const external = controllerManifest.finalizationContract.externalEvidence;
  const deploymentRawText = `${JSON.stringify({
    id: DEPLOYMENT_ID,
    teamId: external.vercel.teamId,
    projectId: external.vercel.projectId,
    target: "production",
    readyState: "READY",
    url: "wedding-hanbang-successor.vercel.app",
    alias: [external.vercel.productionHost],
    createdAt: now.getTime() - 10 * 60_000,
    ready: now.getTime() - 9 * 60_000,
    meta: { githubCommitSha: RELEASE_COMMIT },
  })}\n`;
  const deploymentReceipt = buildVercelDeploymentReceipt({
    rawText: deploymentRawText,
    rawEvidenceFileName: "successor-vercel-deployment.raw.json",
    release: sourceManifest.release,
    projectRef: sourceManifest.projectRef,
    releaseCommit: RELEASE_COMMIT,
    teamId: external.vercel.teamId,
    projectId: external.vercel.projectId,
    deploymentId: DEPLOYMENT_ID,
    productionHost: external.vercel.productionHost,
    verifiedAt: new Date(now.getTime() - 8 * 60_000).toISOString(),
  });
  const deployment = await writeJson(
    join(receiptRoot, "deployment.json"),
    deploymentReceipt,
  );

  const postExpandContract = controllerManifest.postExpandBackupContract;
  const backupReceipt = {
    receiptVersion: 2,
    kind: "successor-post-expand-backup-verification-v2",
    release: sourceManifest.release,
    projectRef: sourceManifest.projectRef,
    releaseCommit: RELEASE_COMMIT,
    backupContractId: postExpandContract.id,
    backupContractVersion: postExpandContract.version,
    backupSetId: "12345678-1234-4234-8234-123456789abc",
    backupManifestSha256: sha256("post-expand-manifest"),
    sourceDatabaseOid: "16384",
    sourceDatabaseSystemIdentifier: "12345678901234567890",
    expectedMigrationHead: postExpandContract.expectedReleaseMigrationHead,
    migrationVersionsSha256:
      postExpandContract.expectedReleaseMigrationContractSha256,
    expectedTableCount: postExpandContract.expectedTableCount,
    expectedTables: [...postExpandContract.expectedTables],
    expectedTableContractSha256: postExpandContract.expectedTableContractSha256,
    liveSchemaContractSha256: sha256("post-expand-live-schema"),
    logicalDataContractSha256: sha256("post-expand-logical-data"),
    authSchemaContractSha256: sha256("post-expand-auth-schema"),
    authUsersContractSha256: sha256("post-expand-auth-users"),
    storageMetadataContractSha256: sha256("post-expand-storage-metadata"),
    storageObjectInventorySha256: sha256("post-expand-storage-inventory"),
    capturedAt: new Date(now.getTime() - 3 * 60_000).toISOString(),
    verifiedAt: new Date(now.getTime() - 2 * 60_000).toISOString(),
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
  const backup = await writeJson(
    join(receiptRoot, "post-expand-backup.json"),
    backupReceipt,
  );

  const preApplyVerifiedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
  const preApplyExpiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const preApplyRecords = ["backup", "finalizer", "hostedStaging", "storage"]
    .map((name) => runtimeRecord(name, preApplyVerifiedAt, preApplyExpiresAt));
  const recordByName = Object.fromEntries(
    preApplyRecords.map((record) => [record.name, record]),
  );
  const recoveryContract = sourceManifest.deploymentEvidence.recoveryAssurance;
  const recoveryCapturedAt = new Date(now.getTime() - 60_000);
  const recoveryExpiresAt = new Date(
    recoveryCapturedAt.getTime() + recoveryContract.maximumAgeMinutes * 60_000,
  );
  const recoveryRawText = `${JSON.stringify({
    evidenceVersion: 1,
    kind: "successor-no-cost-recovery-assurance-provenance",
  })}\n`;
  await writeFile(
    join(receiptRoot, recoveryContract.rawEvidenceFileName),
    recoveryRawText,
    "utf8",
  );
  const migrationVersions = sourceManifest.expandMigrations.map(
    (entry) => entry.file.slice(0, 14),
  );
  const postApplyCheckIds = controllerManifest.postApplyChecks.map(
    (check) => check.id,
  );
  const recoveryReceipt = {
    receiptVersion: 1,
    kind: recoveryContract.kind,
    release: sourceManifest.release,
    projectRef: sourceManifest.projectRef,
    releaseCommit: RELEASE_COMMIT,
    requiredRemoteHead: sourceManifest.requiredRemoteHead,
    expectedMigrationHead: migrationVersions.at(-1),
    migrationCount: migrationVersions.length,
    migrationVersionsSha256: sha256(`${migrationVersions.join("\n")}\n`),
    postApplyCheckIds,
    postApplyChecksSha256: sha256(`${postApplyCheckIds.join("\n")}\n`),
    rollbackContractSha256: canonicalJsonSha256(
      controllerManifest.rollbackContract,
    ),
    capturedAt: recoveryCapturedAt.toISOString(),
    expiresAt: recoveryExpiresAt.toISOString(),
    checks: Object.fromEntries(
      recoveryContract.requiredChecks.map((check) => [check, true]),
    ),
    observations: {
      backupContractId: controllerManifest.backupContract.id,
      hostedStagingRawEvidenceSha256:
        recordByName.hostedStaging.rawEvidenceSha256,
      hostedStagingReceiptSha256: recordByName.hostedStaging.receiptSha256,
      postExpandBackupContractId: postExpandContract.id,
      postExpandBackupManifestSha256: backupReceipt.backupManifestSha256,
      postExpandBackupReceiptSha256: backup.sha256,
      postExpandBackupReverificationSha256: sha256("post-expand-reverification"),
      postExpandEncryptedArtifactsVerified: true,
      postExpandLiveSchemaContractSha256:
        backupReceipt.liveSchemaContractSha256,
      postExpandLogicalDataContractSha256:
        backupReceipt.logicalDataContractSha256,
      postExpandPGliteJsonbRoundTripVerified: true,
      preApplyBackupRawEvidenceSha256: recordByName.backup.rawEvidenceSha256,
      preApplyBackupReceiptSha256: recordByName.backup.receiptSha256,
      providerPhysicalBackupStatus:
        controllerManifest.backupContract.providerPhysicalBackup.requiredStatus,
    },
    rawProvenance: {
      capturedAt: recoveryCapturedAt.toISOString(),
      fileName: recoveryContract.rawEvidenceFileName,
      sha256: sha256(recoveryRawText),
      source: recoveryContract.rawEvidenceSource,
    },
    releaseAssurance: structuredClone(
      SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
    ),
    containsSecrets: false,
  };
  const recovery = await writeJson(
    join(receiptRoot, recoveryContract.receiptFileName),
    recoveryReceipt,
  );
  const recoveryRecord = {
    name: "recoveryAssurance",
    receiptSha256: recovery.sha256,
    rawEvidenceSha256: sha256(recoveryRawText),
    verifiedAt: recoveryReceipt.capturedAt,
    expiresAt: recoveryReceipt.expiresAt,
  };
  const runtimeNames = Object.keys(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).sort();
  const runtimeRecords = runtimeNames.map((name) => (
    name === "recoveryAssurance" ? recoveryRecord : recordByName[name]
  ));
  const runtimeSetSha256 = sha256(
    `${runtimeRecords.map((record) => [
      record.name,
      record.receiptSha256,
      record.rawEvidenceSha256,
      record.verifiedAt,
      record.expiresAt,
    ].join(":")).join("\n")}\n`,
  );
  const outcome = await writeJson(join(receiptRoot, "outcome.json"), {
    release: sourceManifest.release,
    projectRef: sourceManifest.projectRef,
    releaseCommit: RELEASE_COMMIT,
    startedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
    completedAt: now.toISOString(),
    successorRuntimeEvidence: runtimeRecords,
    successorRuntimeEvidenceSetSha256: runtimeSetSha256,
    successorReleaseAssurance: structuredClone(
      SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
    ),
  });

  const browserExecutable = join(receiptRoot, "chromium.exe");
  const psql = join(receiptRoot, "psql.exe");
  await writeFile(browserExecutable, "fixture browser\n", "utf8");
  await writeFile(psql, "fixture psql\n", "utf8");
  return {
    controllerManifest,
    sourceManifest,
    backup,
    browserExecutable,
    deployment,
    now,
    outcome,
    psql,
    receiptRoot,
    recovery,
    repoRoot,
  };
}

test("controller-ready canary revalidates no-cost recovery assurance and emits its exact finalizer hash", async (t) => {
  const fixture = await createSuccessorCanaryFixture(t);
  let collectorInput;
  const result = await runExternalGateCollectorCli({
    repoRoot: fixture.repoRoot,
    argv: [
      "--mode=canary",
      `--expected-commit=${RELEASE_COMMIT}`,
      `--deployment-receipt=${fixture.deployment.path}`,
      `--release-outcome=${fixture.outcome.path}`,
      `--backup-receipt=${fixture.backup.path}`,
      `--recovery-assurance-receipt=${fixture.recovery.path}`,
      `--browser-executable=${fixture.browserExecutable}`,
      `--psql=${fixture.psql}`,
      `--raw-out=${join(fixture.receiptRoot, "canary.raw.json")}`,
      `--vercel-server-errors-raw-out=${join(fixture.receiptRoot, "vercel-errors.raw.json")}`,
      `--receipt-out=${join(fixture.receiptRoot, "canary.json")}`,
    ],
    environment: {
      VERCEL_TOKEN: "vercel-fixture-token",
      HANBANG_CANARY_SUPABASE_ANON_KEY: "anon-fixture-key",
      HANBANG_CANARY_TEST_EMAIL: "canary@example.com",
      HANBANG_CANARY_TEST_PASSWORD: "fixture-password",
      HANBANG_PRODUCTION_DATABASE_URL: "postgres://fixture.invalid/postgres",
    },
    now: () => fixture.now,
    validateSuccessorContract: () => ({
      manifest: fixture.sourceManifest,
      controllerManifest: fixture.controllerManifest,
      deploymentBlocked: false,
    }),
    collectCanaryEvidence: async (input) => {
      collectorInput = input;
      return input.baseReceipt;
    },
  });

  assert.equal(
    result.recoveryAssuranceReceiptSha256,
    fixture.recovery.sha256,
  );
  assert.equal(
    Object.hasOwn(result, "postExpandHostedRestoreReceiptSha256"),
    false,
  );
  assert.equal(result.postExpandBackupReceiptSha256, fixture.backup.sha256);
  assert.equal(result.deploymentReceiptSha256, fixture.deployment.sha256);
  assert.equal(result.releaseOutcomeReceiptSha256, fixture.outcome.sha256);
  assert.equal(result.release, fixture.sourceManifest.release);
  assert.equal(result.projectRef, fixture.sourceManifest.projectRef);
  assert.equal(collectorInput.baseReceipt, result);
});
