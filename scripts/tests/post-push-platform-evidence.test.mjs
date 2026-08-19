import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  capturePostPushPlatformEvidence,
  postPushPlatformEvidenceTestHooks,
} from "../lib/post-push-platform-evidence.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const COMMIT = "a".repeat(40);
const BACKUP_SET_ID = "12345678-1234-4234-8234-123456789abc";
const MANIFEST_SHA = "B".repeat(64);
const OPERATION_ID = "strict-chat-storage-finalize";
const OPERATION_SQL = "select 'post-push operation';\n";
const OPERATION_SHA = createHash("sha256").update(OPERATION_SQL).digest("hex");

test("successor post-push evidence accepts only the exact pinned Storage operation JSON", () => {
  assert.equal(postPushPlatformEvidenceTestHooks.validOperationFile({
    id: "vendor-disclosure-successor-storage-final-convergence-v1",
    file: "supabase/platform-operations/storage/20260819102000_vendor_disclosure_successor_storage_final_convergence.operation.json",
  }, true), true);
  assert.equal(postPushPlatformEvidenceTestHooks.validOperationFile({
    id: "vendor-disclosure-successor-storage-final-convergence-v1",
    file: "supabase/platform-operations/storage/unpinned.operation.json",
  }, true), false);
  assert.equal(postPushPlatformEvidenceTestHooks.validOperationFile({
    id: "unexpected-operation",
    file: "supabase/platform-operations/storage/20260819102000_vendor_disclosure_successor_storage_final_convergence.operation.json",
  }, true), false);
});

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "post-push-evidence-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "post-push-evidence-receipts-"));
  const operationFile = "supabase/platform-operations/storage/finalize.sql";
  const manifest = {
    release: "test-release",
    projectRef: PROJECT_REF,
    manualPlatformOperations: [{
      id: OPERATION_ID,
      phase: "post-push-pre-deploy",
      verificationCheckId: "strict-chat-storage-finalize-verify",
      file: operationFile,
      sha256: OPERATION_SHA,
    }],
    manualControlEvidence: {
      receiptFileName: "test-release-production-write-fence.json",
      postPushReceiptFileName: "test-release-post-push-platform.json",
      maximumAgeMinutes: 30,
      storageDrainReceiptFileName: "test-release-storage-drain.json",
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
  };
  await write(
    repoRoot,
    "supabase/release-manifests/amora-engine-v2-20260716.json",
    JSON.stringify(manifest),
  );
  await write(repoRoot, operationFile, OPERATION_SQL);
  const backupReceiptPath = join(receiptRoot, "backup.json");
  await writeFile(backupReceiptPath, JSON.stringify({
    Verified: true,
    BackupSetId: BACKUP_SET_ID,
    ManifestSha256: MANIFEST_SHA,
    GitCommit: COMMIT,
  }), "utf8");
  const awaitingOutcomePath = join(receiptRoot, "outcome.json");
  await writeFile(awaitingOutcomePath, JSON.stringify({
    receiptVersion: 1,
    status: "awaiting_manual_post_push_operations",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    backupSetId: BACKUP_SET_ID,
    backupManifestSha256: MANIFEST_SHA,
    pendingManualOperationIds: [OPERATION_ID],
    pendingManualOperationCount: 1,
    rerunProhibited: true,
    containsSecrets: false,
  }), "utf8");
  return {
    repoRoot,
    receiptRoot,
    operationFile,
    backupReceiptPath,
    awaitingOutcomePath,
    receiptOut: join(receiptRoot, manifest.manualControlEvidence.postPushReceiptFileName),
  };
}

async function fenceFetch(url) {
  if (String(url).includes("/config/auth")) {
    return new Response(JSON.stringify({ disable_signup: true }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: "production_write_fence_enabled" }), {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "x-hanbang-deployment-commit": COMMIT,
    },
  });
}

test("captures a hash-bound operator receipt for the exact post-push operation", async () => {
  const fixture = await createFixture();
  try {
    const result = await capturePostPushPlatformEvidence({
      repoRoot: fixture.repoRoot,
      expectedCommit: COMMIT,
      backupReceiptPath: fixture.backupReceiptPath,
      awaitingOutcomePath: fixture.awaitingOutcomePath,
      receiptOut: fixture.receiptOut,
      confirmOperations: OPERATION_ID,
      siteUrl: "https://wedding.example",
      env: { SUPABASE_ACCESS_TOKEN: "x".repeat(24) },
      fetchImpl: fenceFetch,
      now: () => new Date("2026-07-17T04:00:00.000Z"),
    });

    assert.equal(result.status, "post_push_platform_evidence_captured");
    assert.deepEqual(result.operationIds, [OPERATION_ID]);
    const receipt = JSON.parse(await readFile(fixture.receiptOut, "utf8"));
    assert.equal(receipt.releaseCommit, COMMIT);
    assert.equal(receipt.backupSetId, BACKUP_SET_ID);
    assert.match(receipt.awaitingOutcomeReceiptSha256, /^[A-F0-9]{64}$/);
    assert.deepEqual(receipt.operations, [{
      operationId: OPERATION_ID,
      verificationCheckId: "strict-chat-storage-finalize-verify",
      applyArtifactSha256: OPERATION_SHA,
      verified: true,
    }]);
    assert.deepEqual(receipt.controls, {
      vercelProductionWriteFenceEnabled: true,
      vercelDeploymentCommit: COMMIT,
      supabaseAuthSignupDisabled: true,
    });
    assert.equal(receipt.containsSensitiveValues, false);
  } finally {
    await rm(fixture.repoRoot, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("fails without output on confirmation, checkpoint or operation-artifact drift", async () => {
  for (const scenario of ["confirmation", "checkpoint", "artifact"]) {
    const fixture = await createFixture();
    try {
      if (scenario === "checkpoint") {
        const outcome = JSON.parse(await readFile(fixture.awaitingOutcomePath, "utf8"));
        outcome.backupSetId = "87654321-4321-4321-8321-cba987654321";
        await writeFile(fixture.awaitingOutcomePath, JSON.stringify(outcome), "utf8");
      }
      if (scenario === "artifact") {
        await write(fixture.repoRoot, fixture.operationFile, "tampered\n");
      }
      await assert.rejects(
        capturePostPushPlatformEvidence({
          repoRoot: fixture.repoRoot,
          expectedCommit: COMMIT,
          backupReceiptPath: fixture.backupReceiptPath,
          awaitingOutcomePath: fixture.awaitingOutcomePath,
          receiptOut: fixture.receiptOut,
          confirmOperations: scenario === "confirmation" ? "wrong-operation" : OPERATION_ID,
          siteUrl: "https://wedding.example",
          env: { SUPABASE_ACCESS_TOKEN: "x".repeat(24) },
          fetchImpl: fenceFetch,
        }),
        /POST_PUSH_EVIDENCE_(CONFIRMATION_MISMATCH|AWAITING_OUTCOME_INVALID|ARTIFACT_INVALID)/,
      );
      await assert.rejects(readFile(fixture.receiptOut, "utf8"), /ENOENT/);
    } finally {
      await rm(fixture.repoRoot, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});
