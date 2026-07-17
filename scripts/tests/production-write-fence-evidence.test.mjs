import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureProductionWriteFenceEvidence } from "../lib/production-write-fence-evidence.mjs";
import {
  AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
  AMORA_POST_EXPAND_TABLES,
  AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  AMORA_RELEASE_MIGRATION_VERSIONS,
  FINALIZER_EXTERNAL_EVIDENCE_CONTRACT,
  FINALIZER_REQUIRED_CANARY_CHECKS,
  POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
} from "../lib/amora-release-extended-contracts.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const COMMIT = "a".repeat(40);
const BACKUP_SET_ID = "12345678-1234-4234-8234-123456789abc";
const MANIFEST_SHA = "B".repeat(64);
const APPLY_SHA = "c".repeat(64);
const NOW = new Date("2026-07-17T03:00:00.000Z");

async function rawFileSha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
}

function canonicalSha256(content) {
  return createHash("sha256")
    .update(content.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "write-fence-evidence-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "write-fence-evidence-receipts-"));
  const forwardInventory = "BEGIN TRANSACTION READ ONLY;\nselect 1;\nROLLBACK;\n";
  const forwardApply = "BEGIN;\nselect 1;\nCOMMIT;\n";
  const forwardVerify = "BEGIN TRANSACTION READ ONLY;\nselect 1;\nROLLBACK;\n";
  const manifest = {
    release: "test-release",
    projectRef: PROJECT_REF,
    manualPlatformOperations: [{
      id: "storage-global-write-freeze-20260716108000",
      phase: "pre-backup",
      verificationCheckId: "public-database-write-fence-pre",
      file: "supabase/platform-operations/security/write-fence-apply.sql",
      sha256: APPLY_SHA,
    }],
    manualControlEvidence: {
      receiptFileName: "test-release-production-write-fence.json",
      storageDrainReceiptFileName: "test-release-storage-signed-upload-drain.json",
      maximumAgeMinutes: 30,
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
    forwardOnlySecurityOperations: [{
      id: "ai-log-retention-exact-acl-20260717141000",
      phase: "pre-backup",
      verificationCheckId: "public-database-write-fence-pre",
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
        sha256: canonicalSha256(forwardInventory),
      },
      apply: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
        sha256: canonicalSha256(forwardApply),
      },
      verify: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
        sha256: canonicalSha256(forwardVerify),
        expectedEvidence: { ai_log_retention_exact_acl_verified: 1 },
      },
    }],
    postExpandBackupContract: {
      id: "post-amora-engine-v2-27-table-backup",
      version: 1,
      phase: "post-push-pre-deployment-canary",
      verificationReceiptFileName:
        "test-release-post-expand-backup-verification.json",
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
      capture: { file: "scripts/amora-db-backup.ps1", sha256: "1".repeat(64) },
      verifier: { file: "scripts/amora-db-verify-backup.ps1", sha256: "2".repeat(64) },
      hostedRestoreEvidence: {
        receiptFileName:
          "test-release-post-expand-hosted-restore-evidence.json",
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
        sha256: "3".repeat(64),
      },
      requiredLeasePhase: "deployment-canary",
      canaryMaximumAgeMinutes: 15,
      deploymentMaximumAgeMinutes: 1440,
      requiredCanaryChecks: [...FINALIZER_REQUIRED_CANARY_CHECKS],
      externalEvidence: structuredClone(FINALIZER_EXTERNAL_EVIDENCE_CONTRACT),
      confirmationIncludesCanarySha256: true,
    },
    backupContract: {
      providerPhysicalBackup: {
        maximumAgeHours: 26,
        requiredStatus: "COMPLETED",
        requirePhysicalBackup: true,
        restoreCapability: "completed-physical-backup",
      },
    },
  };
  await mkdir(join(repoRoot, "supabase/release-manifests"), { recursive: true });
  await writeFile(
    join(repoRoot, "supabase/release-manifests/amora-engine-v2-20260716.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  for (const [path, content] of [
    ["20260717141000_ai_log_retention_exact_acl_inventory.sql", forwardInventory],
    ["20260717141000_ai_log_retention_exact_acl_apply.sql", forwardApply],
    ["20260717141000_ai_log_retention_exact_acl_verify.sql", forwardVerify],
  ]) {
    const absolute = join(
      repoRoot,
      "supabase/platform-operations/security",
      path,
    );
    await mkdir(join(repoRoot, "supabase/platform-operations/security"), {
      recursive: true,
    });
    await writeFile(absolute, content, "utf8");
  }
  const backupReceiptPath = join(receiptRoot, "backup.json");
  const operation = {
    operationId: "storage-global-write-freeze-20260716108000",
    verificationCheckId: "public-database-write-fence-pre",
    applyArtifactSha256: APPLY_SHA,
  };
  const stem = manifest.manualControlEvidence.storageDrainReceiptFileName.slice(0, -5);
  const startPath = join(receiptRoot, `${stem}.start.json`);
  const firstPath = join(receiptRoot, `${stem}.snapshot-1.json`);
  const finalPath = join(receiptRoot, manifest.manualControlEvidence.storageDrainReceiptFileName);
  await writeFile(startPath, `${JSON.stringify({
    receiptVersion: 1,
    stage: "freeze-start",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    operation,
    controls: {
      vercelProductionWriteFenceEnabled: true,
      vercelDeploymentCommit: COMMIT,
      supabaseAuthSignupDisabled: true,
    },
    databaseWriteFence: {
      publicTableCount: 73,
      triggerCount: 73,
      guardFunctionCount: 1,
      attachFunctionCount: 1,
      liveSchemaContractFunctionCount: 1,
      eventTriggerCount: 2,
    },
    observedAt: "2026-07-17T00:40:00.000Z",
    totalObjectCount: 49,
    objectInventorySha256: "D".repeat(64),
    mutationPolicyCount: 0,
    containsSensitiveValues: false,
  }, null, 2)}\n`, "utf8");
  const startReceiptSha256 = await rawFileSha256(startPath);
  await writeFile(firstPath, `${JSON.stringify({
    receiptVersion: 1,
    stage: "stable-snapshot-1",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    operation,
    startReceiptSha256,
    databaseWriteFence: {
      publicTableCount: 73,
      triggerCount: 73,
      guardFunctionCount: 1,
      attachFunctionCount: 1,
      liveSchemaContractFunctionCount: 1,
      eventTriggerCount: 2,
    },
    observedAt: "2026-07-17T02:50:00.000Z",
    totalObjectCount: 49,
    objectInventorySha256: "E".repeat(64),
    mutationPolicyCount: 0,
    containsSensitiveValues: false,
  }, null, 2)}\n`, "utf8");
  const firstSnapshotReceiptSha256 = await rawFileSha256(firstPath);
  await writeFile(finalPath, `${JSON.stringify({
    receiptVersion: 1,
    stage: "verified",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    operation,
    startReceiptSha256,
    firstSnapshotReceiptSha256,
    freezeVerifiedAt: "2026-07-17T00:40:00.000Z",
    firstStableSnapshotAt: "2026-07-17T02:50:00.000Z",
    secondStableSnapshotAt: "2026-07-17T02:55:00.000Z",
    signedUploadTokenTtlMinutes: 120,
    signedUploadGraceMinutes: 10,
    storageStabilityWindowMinutes: 5,
    totalObjectCount: 49,
    objectInventorySha256: "E".repeat(64),
    mutationPolicyCount: 0,
    containsSensitiveValues: false,
  }, null, 2)}\n`, "utf8");
  await writeFile(backupReceiptPath, JSON.stringify({
    Verified: true,
    BackupSetId: BACKUP_SET_ID,
    ManifestSha256: MANIFEST_SHA,
    GitCommit: COMMIT,
    SourceCapturedAt: "2026-07-17T02:56:00.000Z",
    CreatedAtUtc: "2026-07-17T02:57:00.000Z",
  }), "utf8");
  return {
    repoRoot,
    receiptRoot,
    backupReceiptPath,
    receiptOut: join(receiptRoot, manifest.manualControlEvidence.receiptFileName),
  };
}

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("captures only exact read-only Auth and side-effect-free deployed-web evidence", async () => {
  const fixture = await createFixture();
  const calls = [];
  const accessToken = "must-never-enter-the-receipt";
  try {
    const result = await captureProductionWriteFenceEvidence({
      repoRoot: fixture.repoRoot,
      expectedCommit: COMMIT,
      backupReceiptPath: fixture.backupReceiptPath,
      receiptOut: fixture.receiptOut,
      siteUrl: "https://hanbang.ai",
      env: { SUPABASE_ACCESS_TOKEN: accessToken },
      now: () => NOW,
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/database/backups")) {
          return response(200, {
            backups: [{
              is_physical_backup: true,
              status: "COMPLETED",
              inserted_at: "2026-07-17T02:00:00.000Z",
            }],
            physical_backup_data: { latest_physical_backup_date_unix: 1784253600 },
          });
        }
        if (String(url).startsWith("https://api.supabase.com/")) {
          return response(200, { disable_signup: true, smtp_pass: "ignored" });
        }
        return response(
          503,
          { error: "production_write_fence_enabled" },
          {
            "Cache-Control": "no-store",
            "X-Hanbang-Deployment-Commit": COMMIT,
          },
        );
      },
    });

    assert.equal(result.status, "write_fence_evidence_captured");
    assert.equal(result.operationCount, 1);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(accessToken));
    const receipt = JSON.parse(await readFile(fixture.receiptOut, "utf8"));
    assert.deepEqual(receipt.controls, {
      vercelProductionWriteFenceEnabled: true,
      vercelDeploymentCommit: COMMIT,
      supabaseAuthSignupDisabled: true,
    });
    assert.equal(receipt.backupSetId, BACKUP_SET_ID);
    assert.deepEqual(receipt.operations, [{
      operationId: "storage-global-write-freeze-20260716108000",
      verificationCheckId: "public-database-write-fence-pre",
      applyArtifactSha256: APPLY_SHA,
      verified: true,
    }]);
    assert.deepEqual(receipt.storageSignedUploadDrain, {
      receiptSha256: await rawFileSha256(join(
        fixture.receiptRoot,
        "test-release-storage-signed-upload-drain.json",
      )),
      startReceiptSha256: await rawFileSha256(join(
        fixture.receiptRoot,
        "test-release-storage-signed-upload-drain.start.json",
      )),
      freezeVerifiedAt: "2026-07-17T00:40:00.000Z",
      preBackupControls: {
        vercelProductionWriteFenceEnabled: true,
        vercelDeploymentCommit: COMMIT,
        supabaseAuthSignupDisabled: true,
      },
      databaseWriteFence: {
        publicTableCount: 73,
        triggerCount: 73,
        guardFunctionCount: 1,
        attachFunctionCount: 1,
        liveSchemaContractFunctionCount: 1,
        eventTriggerCount: 2,
      },
      firstStableSnapshotAt: "2026-07-17T02:50:00.000Z",
      secondStableSnapshotAt: "2026-07-17T02:55:00.000Z",
      totalObjectCount: 49,
      objectInventorySha256: "E".repeat(64),
      mutationPolicyCount: 0,
    });
    assert.doesNotMatch(JSON.stringify(receipt), new RegExp(accessToken));
    assert.deepEqual(receipt.providerPhysicalBackup, {
      status: "COMPLETED",
      isPhysicalBackup: true,
      insertedAt: "2026-07-17T02:00:00.000Z",
      latestPhysicalBackupDateUnix: 1784253600,
      ageSeconds: 3600,
      restoreCandidateAvailable: true,
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[1].options.method, "GET");
    assert.equal(calls[2].options.method, "POST");
  } finally {
    await rm(fixture.repoRoot, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("fails closed without writing when Auth signup or the deployed web fence is open", async () => {
  for (const scenario of ["auth-open", "web-open", "commit-mismatch"]) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        captureProductionWriteFenceEvidence({
          repoRoot: fixture.repoRoot,
          expectedCommit: COMMIT,
          backupReceiptPath: fixture.backupReceiptPath,
          receiptOut: fixture.receiptOut,
          siteUrl: "https://hanbang.ai",
          env: { SUPABASE_ACCESS_TOKEN: "private-token-long-enough-for-read-only-check" },
          now: () => NOW,
          fetchImpl: async (url) => {
            if (String(url).endsWith("/database/backups")) {
              return response(200, {
                backups: [{
                  is_physical_backup: true,
                  status: "COMPLETED",
                  inserted_at: "2026-07-17T02:00:00.000Z",
                }],
                physical_backup_data: { latest_physical_backup_date_unix: 1784253600 },
              });
            }
            if (String(url).startsWith("https://api.supabase.com/")) {
              return response(200, {
                disable_signup: scenario !== "auth-open",
              });
            }
            if (scenario === "web-open") {
              return response(409, { error: "production_write_fence_not_active" });
            }
            return response(
              503,
              { error: "production_write_fence_enabled" },
              {
                "Cache-Control": "no-store",
                "X-Hanbang-Deployment-Commit": scenario === "commit-mismatch"
                  ? "d".repeat(40)
                  : COMMIT,
              },
            );
          },
        }),
        /WRITE_FENCE_EVIDENCE_(AUTH|WEB)_NOT_VERIFIED/,
      );
      await assert.rejects(readFile(fixture.receiptOut, "utf8"), /ENOENT/);
    } finally {
      await rm(fixture.repoRoot, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("fails closed when no fresh completed provider physical restore candidate exists", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      captureProductionWriteFenceEvidence({
        repoRoot: fixture.repoRoot,
        expectedCommit: COMMIT,
        backupReceiptPath: fixture.backupReceiptPath,
        receiptOut: fixture.receiptOut,
        siteUrl: "https://hanbang.ai",
        env: { SUPABASE_ACCESS_TOKEN: "private-token-long-enough-for-backup-check" },
        now: () => NOW,
        fetchImpl: async (url) => {
          if (String(url).endsWith("/database/backups")) {
            return response(200, {
              backups: [{
                is_physical_backup: true,
                status: "COMPLETED",
                inserted_at: "2026-07-15T00:00:00.000Z",
              }],
              physical_backup_data: { latest_physical_backup_date_unix: 1784073600 },
            });
          }
          throw new Error("later gates must not run");
        },
      }),
      /WRITE_FENCE_EVIDENCE_PROVIDER_BACKUP_NOT_VERIFIED/,
    );
    await assert.rejects(readFile(fixture.receiptOut, "utf8"), /ENOENT/);
  } finally {
    await rm(fixture.repoRoot, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});
