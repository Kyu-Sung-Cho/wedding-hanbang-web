import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const STORAGE_ROOT = resolve(ROOT, "supabase/platform-operations/storage");
const FILES = {
  baseline: "20260819100000_vendor_disclosure_successor_storage_baseline_inventory.sql",
  freeze: "20260819101000_vendor_disclosure_successor_storage_frozen_verify.sql",
  target: "20260819102000_vendor_disclosure_successor_storage_target_verify.sql",
  freezeOperation:
    "20260819100000_vendor_disclosure_successor_storage_write_freeze.operation.json",
  freezeRecovery:
    "20260819100000_vendor_disclosure_successor_storage_write_freeze.forward-recovery.json",
  finalOperation:
    "20260819102000_vendor_disclosure_successor_storage_final_convergence.operation.json",
  finalCompensation:
    "20260819102000_vendor_disclosure_successor_storage_final_convergence.compensation.json",
  frozenReleaseCheck: "vendor-disclosure-successor-storage-frozen.sql",
  targetReleaseCheck: "vendor-disclosure-successor-storage-target.sql",
};

function sha256(text) {
  return createHash("sha256").update(text.replace(/\r\n?/gu, "\n"), "utf8").digest("hex");
}

test("pins the exact 12/23 to 12/5 to 13/5 successor Storage transition", async () => {
  const [baseline, freeze, target, freezeOperation, freezeRecovery,
    finalOperation, finalCompensation, frozenReleaseCheck, targetReleaseCheck] = await Promise.all([
    readFile(resolve(STORAGE_ROOT, FILES.baseline), "utf8"),
    readFile(resolve(STORAGE_ROOT, FILES.freeze), "utf8"),
    readFile(resolve(STORAGE_ROOT, FILES.target), "utf8"),
    readFile(resolve(STORAGE_ROOT, FILES.freezeOperation), "utf8").then(JSON.parse),
    readFile(resolve(STORAGE_ROOT, FILES.freezeRecovery), "utf8").then(JSON.parse),
    readFile(resolve(STORAGE_ROOT, FILES.finalOperation), "utf8").then(JSON.parse),
    readFile(resolve(STORAGE_ROOT, FILES.finalCompensation), "utf8").then(JSON.parse),
    readFile(resolve(ROOT, "supabase/release-checks", FILES.frozenReleaseCheck), "utf8"),
    readFile(resolve(ROOT, "supabase/release-checks", FILES.targetReleaseCheck), "utf8"),
  ]);

  for (const sql of [baseline, freeze, target]) {
    assert.match(sql, /BEGIN TRANSACTION READ ONLY;/u);
    assert.match(sql, /ROLLBACK;/u);
    assert.doesNotMatch(sql, /\b(?:CREATE|DROP|ALTER)\s+POLICY\b|\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?storage\./iu);
  }

  assert.deepEqual(freezeOperation.transition, {
    from: { bucketCount: 12, policyCount: 23 },
    to: { bucketCount: 12, policyCount: 5, mutationPolicyCount: 0 },
  });
  assert.equal(freezeOperation.requiredStorageObjectMutationCount, 0);
  assert.equal(freezeOperation.removedPolicySemanticIdentities.length, 18);
  assert.equal(freezeOperation.remainingPolicySemanticIdentities.length, 5);
  assert.equal(freezeOperation.verifiers.baseline.sha256, sha256(baseline));
  assert.equal(freezeOperation.verifiers.postcondition.sha256, sha256(freeze));
  assert.equal(freezeOperation.releaseCheck.sha256, sha256(frozenReleaseCheck));
  assert.deepEqual(freezeOperation.releaseCheck.expectedEvidence, {
    successor_storage_frozen_verified_count: 1,
  });
  assert.equal(freezeOperation.execution.policyMutation.channel, "supabase-dashboard-storage-policies");
  assert.equal(freezeOperation.execution.directSqlMutationAllowed, false);

  assert.deepEqual(finalOperation.transition, {
    from: { bucketCount: 12, policyCount: 5, mutationPolicyCount: 0 },
    to: { bucketCount: 13, policyCount: 5 },
  });
  assert.equal(finalOperation.requiredStorageObjectMutationCount, 0);
  assert.equal(finalOperation.targetPolicySemanticIdentities.length, 5);
  assert.equal(finalOperation.verifiers.precondition.sha256, sha256(freeze));
  assert.equal(finalOperation.verifiers.postcondition.sha256, sha256(target));
  assert.equal(finalOperation.releaseCheck.sha256, sha256(targetReleaseCheck));
  assert.deepEqual(finalOperation.releaseCheck.expectedEvidence, {
    successor_storage_target_verified_count: 1,
  });
  assert.equal(finalOperation.execution.bucketMutation.channel, "supabase-storage-api");
  assert.equal(finalOperation.execution.policyMutation.channel, "supabase-dashboard-storage-policies");
  assert.equal(finalOperation.execution.directSqlMutationAllowed, false);

  for (const recovery of [freezeRecovery, finalCompensation]) {
    assert.equal(recovery.directSqlMutationAllowed, false);
    assert.equal(recovery.requiredStorageObjectMutationCount, 0);
    assert.match(recovery.strategy, /forward-fix|compensation/u);
  }
  for (const releaseCheck of [frozenReleaseCheck, targetReleaseCheck]) {
    assert.match(releaseCheck, /BEGIN TRANSACTION READ ONLY;/u);
    assert.match(releaseCheck, /SELECT true AS verified,/u);
    assert.match(releaseCheck, /ROLLBACK;/u);
    assert.doesNotMatch(releaseCheck, /\b(?:CREATE|DROP|ALTER)\s+POLICY\b|\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?storage\./iu);
  }
  const serialized = JSON.stringify([
    freezeOperation,
    freezeRecovery,
    finalOperation,
    finalCompensation,
  ]);
  assert.match(serialized, /20260716108000_storage_global_write_freeze_apply\.sql/u);
  assert.match(serialized, /20260716108000_community_upload_service_fence_apply\.sql/u);
  assert.match(serialized, /forbiddenPredecessorArtifacts/u);
});
