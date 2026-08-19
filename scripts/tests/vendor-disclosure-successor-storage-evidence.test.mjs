import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  emitVendorDisclosureSuccessorStorageEvidence,
} from "../lib/vendor-disclosure-successor-storage-evidence.mjs";
import {
  reverifyVendorDisclosureSuccessorStorageOriginalBytesFiles,
  validateVendorDisclosureSuccessorStorageEvidenceProvenance,
} from "../lib/vendor-disclosure-successor-storage-evidence-provenance.mjs";
import {
  writeDurableExclusiveEvidencePair,
} from "../lib/vendor-disclosure-successor-hosted-staging-evidence.mjs";
import {
  captureVendorDisclosureSuccessorStorageOriginalBytesBackup,
} from "../lib/vendor-disclosure-successor-storage-original-bytes.mjs";

const RELEASE = "vendor-disclosure-v2-20260718";
const PROJECT_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "a".repeat(40);
const ORIGIN = "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git";
const REMOTE_REF = "origin/codex/amora-release-hardening-20260811";
const REQUIRED_REMOTE_HEAD = "20260716117000";
const VERSIONS = ["20260730100000", "20260819100000"];
const POSTCHECK_IDS = ["successor-semantic-postcheck"];
const NOW = new Date("2026-08-19T05:30:00.000Z");
const FREEZE_AT = "2026-08-19T03:00:00.000Z";
const FIRST_AT = "2026-08-19T05:10:00.000Z";
const SECOND_AT = "2026-08-19T05:15:00.000Z";
const INVENTORY_SHA256 = "A".repeat(64);
const OBJECT_COUNT = 37;
const BACKUP_SET_ID = "12345678-1234-4234-8234-123456789abc";
const OPERATION_ID = "storage-global-write-freeze-20260716108000";
const OPERATION_SHA256 = "b".repeat(64);
const WRITE_FENCE_FILE = `${RELEASE}-production-write-fence.json`;
const DRAIN_FILE = `${RELEASE}-storage-drain.json`;
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

function canonicalJsonSha256(value) {
  const canonical = (candidate) => {
    if (candidate === null || typeof candidate !== "object") {
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) return `[${candidate.map(canonical).join(",")}]`;
    return `{${Object.keys(candidate).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(candidate[key])}`,
    ).join(",")}}`;
  };
  return sha256(`${canonical(value)}\n`);
}

function databaseWriteFence() {
  return {
    publicTableCount: 61,
    triggerCount: 61,
    guardFunctionCount: 1,
    attachFunctionCount: 1,
    liveSchemaContractFunctionCount: 1,
    eventTriggerCount: 2,
  };
}

function controls() {
  return {
    vercelProductionWriteFenceEnabled: true,
    vercelDeploymentCommit: COMMIT,
    supabaseAuthSignupDisabled: true,
  };
}

function operationBinding() {
  return {
    operationId: OPERATION_ID,
    verificationCheckId: "storage-global-write-freeze-held",
    applyArtifactSha256: OPERATION_SHA256,
  };
}

function controllerState() {
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${RELEASE}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: { AMORA_OPENAI_ENABLED: "false" },
    requiredChecks: ["databaseWriteFenceHeld"],
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
    deploymentEvidence: {
      storage: {
        kind: "successor-release-storage-evidence-v1",
        maximumAgeMinutes: 30,
        rawEvidenceFileName: `${RELEASE}-storage-raw.json`,
        rawEvidenceSource: "storage-freeze-and-object-stability",
        receiptFileName: `${RELEASE}-storage-evidence.json`,
        requiredChecks: [
          "databaseWriteFenceHeld",
          "storageMutationPoliciesZero",
          "signedUploadTtlDrained",
          "objectInventoryStable",
          "storageOriginalBytesBackedUp",
        ],
      },
    },
  };
  return {
    controllerReady: true,
    manifest,
    controllerManifest: {
      ...manifest,
      backupContract: { expectedOrigin: ORIGIN },
      manualControlEvidence: {
        maximumAgeMinutes: 30,
        receiptFileName: WRITE_FENCE_FILE,
        storageDrainReceiptFileName: DRAIN_FILE,
        signedUploadTokenTtlMinutes: 120,
        signedUploadGraceMinutes: 10,
        storageStabilityWindowMinutes: 5,
      },
      manualPlatformOperations: [{
        id: OPERATION_ID,
        phase: "pre-backup",
        verificationCheckId: "storage-global-write-freeze-held",
        sha256: OPERATION_SHA256,
      }],
      postApplyChecks: POSTCHECK_IDS.map((id) => ({ id })),
      rollbackContract,
    },
  };
}

function commandRunner({ dirty = false, remoteCommit = COMMIT } = {}) {
  return async (_command, args) => {
    const key = args.join(" ");
    if (key === "status --porcelain=v1 --untracked-files=all") {
      return { status: 0, stdout: dirty ? "?? private.txt\n" : "", stderr: "" };
    }
    if (key === "rev-parse HEAD") return { status: 0, stdout: `${COMMIT}\n`, stderr: "" };
    if (key === "remote get-url origin") return { status: 0, stdout: `${ORIGIN}\n`, stderr: "" };
    if (key === "ls-remote --exit-code origin refs/heads/codex/amora-release-hardening-20260811") {
      return {
        status: 0,
        stdout: `${remoteCommit}\trefs/heads/codex/amora-release-hardening-20260811\n`,
        stderr: "",
      };
    }
    return { status: 1, stdout: "", stderr: "unexpected command" };
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "successor-storage-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-storage-receipts-"));
  const inputRoot = await mkdtemp(join(tmpdir(), "successor-storage-input-"));
  const stem = DRAIN_FILE.slice(0, -5);
  const startPath = join(receiptRoot, `${stem}.start.json`);
  const firstPath = join(receiptRoot, `${stem}.snapshot-1.json`);
  const finalPath = join(receiptRoot, DRAIN_FILE);
  const start = {
    receiptVersion: 1,
    stage: "freeze-start",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    operation: operationBinding(),
    observedAt: FREEZE_AT,
    totalObjectCount: OBJECT_COUNT,
    objectInventorySha256: INVENTORY_SHA256,
    mutationPolicyCount: 0,
    databaseWriteFence: databaseWriteFence(),
    controls: controls(),
    containsSensitiveValues: false,
  };
  await writeJson(startPath, start);
  const startSha256 = sha256(await readFile(startPath));
  const first = {
    receiptVersion: 1,
    stage: "stable-snapshot-1",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    operation: operationBinding(),
    startReceiptSha256: startSha256.toUpperCase(),
    observedAt: FIRST_AT,
    totalObjectCount: OBJECT_COUNT,
    objectInventorySha256: INVENTORY_SHA256,
    mutationPolicyCount: 0,
    databaseWriteFence: databaseWriteFence(),
    containsSensitiveValues: false,
  };
  await writeJson(firstPath, first);
  const firstSha256 = sha256(await readFile(firstPath));
  const final = {
    receiptVersion: 1,
    stage: "verified",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    operation: operationBinding(),
    startReceiptSha256: startSha256.toUpperCase(),
    firstSnapshotReceiptSha256: firstSha256.toUpperCase(),
    freezeVerifiedAt: FREEZE_AT,
    firstStableSnapshotAt: FIRST_AT,
    secondStableSnapshotAt: SECOND_AT,
    signedUploadTokenTtlMinutes: 120,
    signedUploadGraceMinutes: 10,
    storageStabilityWindowMinutes: 5,
    totalObjectCount: OBJECT_COUNT,
    objectInventorySha256: INVENTORY_SHA256,
    mutationPolicyCount: 0,
    containsSensitiveValues: false,
  };
  await writeJson(finalPath, final);
  const finalSha256 = sha256(await readFile(finalPath)).toUpperCase();

  const writeFenceReceiptPath = join(receiptRoot, WRITE_FENCE_FILE);
  await writeJson(writeFenceReceiptPath, {
    receiptVersion: 1,
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    backupSetId: BACKUP_SET_ID,
    backupManifestSha256: "D".repeat(64),
    verifiedAt: "2026-08-19T05:20:00.000Z",
    controls: controls(),
    providerPhysicalBackup: {
      status: "COMPLETED",
      isPhysicalBackup: true,
      insertedAt: "2026-08-19T05:00:00.000Z",
      latestPhysicalBackupDateUnix: 1787115600,
      ageSeconds: 1200,
      restoreCandidateAvailable: true,
    },
    storageSignedUploadDrain: {
      receiptSha256: finalSha256,
      startReceiptSha256: startSha256.toUpperCase(),
      freezeVerifiedAt: FREEZE_AT,
      preBackupControls: controls(),
      databaseWriteFence: databaseWriteFence(),
      firstStableSnapshotAt: FIRST_AT,
      secondStableSnapshotAt: SECOND_AT,
      totalObjectCount: OBJECT_COUNT,
      objectInventorySha256: INVENTORY_SHA256,
      mutationPolicyCount: 0,
    },
    operations: [{ ...operationBinding(), verified: true }],
    forwardOnlySecurityOperations: [],
    containsSensitiveValues: false,
  });

  const originalObjects = Array.from({ length: OBJECT_COUNT }, (_, index) => ({
    bucketId: "community-images",
    objectId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `private/member-${index + 1}.webp`,
  }));
  let backupClockIndex = 0;
  const backupClock = [
    new Date("2026-08-19T05:16:00.000Z"),
    new Date("2026-08-19T05:19:00.000Z"),
  ];
  const originalBackup = await captureVendorDisclosureSuccessorStorageOriginalBytesBackup({
    repoRoot,
    artifactRoot: inputRoot,
    expectedCommit: COMMIT,
    controllerManifest: { release: RELEASE, projectRef: PROJECT_REF },
    drain: {
      secondStableSnapshotAt: SECOND_AT,
      totalObjectCount: OBJECT_COUNT,
      objectInventorySha256: INVENTORY_SHA256,
    },
    encryptionKey: ENCRYPTION_KEY,
    backupSetId: "87654321-4321-4321-8321-cba987654321",
    now: () => backupClock[Math.min(backupClockIndex++, 1)],
    inventoryReader: async () => ({
      observedAt: SECOND_AT,
      objectInventorySha256: INVENTORY_SHA256,
      objects: originalObjects,
    }),
    downloadObject: async ({ objectId }) => Readable.from([
      Buffer.from(`original:${objectId}`, "utf8"),
    ]),
  });
  const originalBytesBackupReceiptPath = originalBackup.receiptPath;
  return {
    repoRoot,
    receiptRoot,
    inputRoot,
    startPath,
    firstPath,
    finalPath,
    writeFenceReceiptPath,
    originalBytesBackupReceiptPath,
    state: controllerState(),
  };
}

async function cleanup(fixture) {
  await Promise.all([
    rm(fixture.repoRoot, { recursive: true, force: true }),
    rm(fixture.receiptRoot, { recursive: true, force: true }),
    rm(fixture.inputRoot, { recursive: true, force: true }),
  ]);
}

async function assertRuntimeOutputsAbsent(fixture) {
  for (const fileName of [
    `${RELEASE}-storage-raw.json`,
    `${RELEASE}-storage-evidence.json`,
  ]) {
    await assert.rejects(readFile(join(fixture.receiptRoot, fileName)), /ENOENT/);
  }
}

test("emits storage evidence only from exact external fence, drain, inventory and original-byte receipts", async () => {
  const fixture = await createFixture();
  try {
    const result = await emitVendorDisclosureSuccessorStorageEvidence({
      repoRoot: fixture.repoRoot,
      receiptRoot: fixture.receiptRoot,
      expectedCommit: COMMIT,
      remoteRef: REMOTE_REF,
      storageDrainReceiptDirectory: fixture.receiptRoot,
      writeFenceReceiptPath: fixture.writeFenceReceiptPath,
      originalBytesBackupReceiptPath: fixture.originalBytesBackupReceiptPath,
      originalBytesBackupEncryptionKey: ENCRYPTION_KEY,
      now: () => NOW,
      runCommand: commandRunner(),
      releaseLoader: () => fixture.state,
    });

    assert.equal(result.status, "successor_storage_evidence_emitted");
    const rawText = await readFile(join(fixture.receiptRoot, `${RELEASE}-storage-raw.json`), "utf8");
    const receiptText = await readFile(
      join(fixture.receiptRoot, `${RELEASE}-storage-evidence.json`),
      "utf8",
    );
    const raw = JSON.parse(rawText);
    const receipt = JSON.parse(receiptText);
    assert.equal(raw.signedUploadDrain.mutationPolicyCount, 0);
    assert.deepEqual(raw.signedUploadDrain.stableInventories.map((entry) => ({
      observedAt: entry.observedAt,
      totalObjectCount: entry.totalObjectCount,
      objectInventorySha256: entry.objectInventorySha256,
    })), [FIRST_AT, SECOND_AT].map((observedAt) => ({
      observedAt,
      totalObjectCount: OBJECT_COUNT,
      objectInventorySha256: INVENTORY_SHA256,
    })));
    assert.equal(raw.originalBytesBackup.originalByteDigestsVerified, true);
    assert.equal(receipt.rawProvenance.sha256, sha256(rawText));
    assert.deepEqual(receipt.observations, {
      encryptedBackupArtifactSha256:
        raw.originalBytesBackup.encryptedBackupArtifactSha256,
      encryptedBackupArtifactSize:
        raw.originalBytesBackup.encryptedArtifactSize,
      objectCount: raw.originalBytesBackup.objectCount,
      objectInventorySha256:
        raw.originalBytesBackup.objectInventorySha256,
      originalBytesBackupReceiptSha256:
        raw.originalBytesBackup.receiptSha256,
      originalBytesBackupSetId: raw.originalBytesBackup.backupSetId,
      originalBytesManifestSha256:
        raw.originalBytesBackup.originalBytesManifestSha256,
      originalBytesPrivateRawSha256:
        raw.originalBytesBackup.privateRawSha256,
      requiredMutationPolicyCount: 0,
      signedUploadGraceMinutes: 10,
      signedUploadTokenTtlMinutes: 120,
      storageDrainFinalInventoryReceiptSha256:
        raw.signedUploadDrain.stableInventories[1].receiptSha256,
      storageDrainFirstInventoryReceiptSha256:
        raw.signedUploadDrain.stableInventories[0].receiptSha256,
      storageDrainStartReceiptSha256:
        raw.signedUploadDrain.startReceiptSha256,
      storageStabilityWindowMinutes: 5,
      totalOriginalBytes: raw.originalBytesBackup.totalOriginalBytes,
      writeFenceReceiptFileName: WRITE_FENCE_FILE,
      writeFenceReceiptSha256: raw.writeFence.receiptSha256,
    });
    assert.equal(receipt.migrationVersionsSha256, textListSha256(VERSIONS));
    assert.equal(receipt.postApplyChecksSha256, textListSha256(POSTCHECK_IDS));
    assert.equal(
      receipt.rollbackContractSha256,
      canonicalJsonSha256(fixture.state.controllerManifest.rollbackContract),
    );
    assert.deepEqual(receipt.checks, Object.fromEntries(
      fixture.state.manifest.deploymentEvidence.storage.requiredChecks.map(
        (check) => [check, true],
      ),
    ));
    assert.equal(receipt.containsSecrets, false);
    assert.equal(result.rawEvidenceSha256, sha256(rawText));
    assert.equal(result.receiptSha256, sha256(receiptText));
  } finally {
    await cleanup(fixture);
  }
});

test("rejects missing or self-asserted original-byte evidence and emits nothing", async () => {
  for (const scenario of [
    {
      name: "missing receipt",
      mutate: async (fixture) => {
        fixture.originalBytesBackupReceiptPath = join(fixture.inputRoot, "missing.json");
      },
    },
    {
      name: "unverified original bytes",
      mutate: async (fixture) => {
        const receipt = JSON.parse(await readFile(
          fixture.originalBytesBackupReceiptPath,
          "utf8",
        ));
        receipt.encryptedArtifact.sha256 = "0".repeat(64);
        await writeJson(fixture.originalBytesBackupReceiptPath, receipt);
      },
    },
  ]) {
    const fixture = await createFixture();
    try {
      await scenario.mutate(fixture);
      await assert.rejects(
        emitVendorDisclosureSuccessorStorageEvidence({
          repoRoot: fixture.repoRoot,
          receiptRoot: fixture.receiptRoot,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          storageDrainReceiptDirectory: fixture.receiptRoot,
          writeFenceReceiptPath: fixture.writeFenceReceiptPath,
          originalBytesBackupReceiptPath: fixture.originalBytesBackupReceiptPath,
          originalBytesBackupEncryptionKey: ENCRYPTION_KEY,
          now: () => NOW,
          runCommand: commandRunner(),
          releaseLoader: () => fixture.state,
        }),
        (error) => error?.code === "SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_INVALID",
        scenario.name,
      );
      await assertRuntimeOutputsAbsent(fixture);
    } finally {
      await cleanup(fixture);
    }
  }
});

test("finalizer provenance reopens the exact original-byte receipt, manifest and archive", async () => {
  const fixture = await createFixture();
  try {
    await emitVendorDisclosureSuccessorStorageEvidence({
      repoRoot: fixture.repoRoot,
      receiptRoot: fixture.receiptRoot,
      expectedCommit: COMMIT,
      remoteRef: REMOTE_REF,
      storageDrainReceiptDirectory: fixture.receiptRoot,
      writeFenceReceiptPath: fixture.writeFenceReceiptPath,
      originalBytesBackupReceiptPath: fixture.originalBytesBackupReceiptPath,
      originalBytesBackupEncryptionKey: ENCRYPTION_KEY,
      now: () => NOW,
      runCommand: commandRunner(),
      releaseLoader: () => fixture.state,
    });
    const raw = JSON.parse(await readFile(
      join(fixture.receiptRoot, `${RELEASE}-storage-raw.json`),
      "utf8",
    ));
    const receipt = JSON.parse(await readFile(
      join(fixture.receiptRoot, `${RELEASE}-storage-evidence.json`),
      "utf8",
    ));
    const provenance =
      validateVendorDisclosureSuccessorStorageEvidenceProvenance({
        receipt,
        raw,
        manifest: fixture.state.manifest,
        controllerManifest: fixture.state.controllerManifest,
        expectedCommit: COMMIT,
      });
    const verified =
      await reverifyVendorDisclosureSuccessorStorageOriginalBytesFiles({
        repoRoot: fixture.repoRoot,
        receiptPath: fixture.originalBytesBackupReceiptPath,
        provenance,
        manifest: fixture.state.manifest,
        expectedCommit: COMMIT,
      });
    assert.equal(
      verified.encryptedBackupArtifactSha256,
      raw.originalBytesBackup.encryptedBackupArtifactSha256,
    );

    const originalReceipt = JSON.parse(await readFile(
      fixture.originalBytesBackupReceiptPath,
      "utf8",
    ));
    await writeFile(
      join(
        dirname(fixture.originalBytesBackupReceiptPath),
        originalReceipt.encryptedArtifact.fileName,
      ),
      "tampered archive",
      "utf8",
    );
    await assert.rejects(
      reverifyVendorDisclosureSuccessorStorageOriginalBytesFiles({
        repoRoot: fixture.repoRoot,
        receiptPath: fixture.originalBytesBackupReceiptPath,
        provenance,
        manifest: fixture.state.manifest,
        expectedCommit: COMMIT,
      }),
      (error) => error?.code === "SUCCESSOR_STORAGE_PROVENANCE_INVALID",
    );
  } finally {
    await cleanup(fixture);
  }
});

test("requires a clean checkout and the exact pushed controller-ready commit", async () => {
  for (const scenario of [
    {
      name: "dirty checkout",
      runner: commandRunner({ dirty: true }),
      code: "SUCCESSOR_STORAGE_WORKTREE_DIRTY",
    },
    {
      name: "remote commit drift",
      runner: commandRunner({ remoteCommit: "9".repeat(40) }),
      code: "SUCCESSOR_STORAGE_REMOTE_COMMIT_MISMATCH",
    },
  ]) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        emitVendorDisclosureSuccessorStorageEvidence({
          repoRoot: fixture.repoRoot,
          receiptRoot: fixture.receiptRoot,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          storageDrainReceiptDirectory: fixture.receiptRoot,
          writeFenceReceiptPath: fixture.writeFenceReceiptPath,
          originalBytesBackupReceiptPath: fixture.originalBytesBackupReceiptPath,
          originalBytesBackupEncryptionKey: ENCRYPTION_KEY,
          now: () => NOW,
          runCommand: scenario.runner,
          releaseLoader: () => fixture.state,
        }),
        (error) => error?.code === scenario.code,
        scenario.name,
      );
      await assertRuntimeOutputsAbsent(fixture);
    } finally {
      await cleanup(fixture);
    }
  }
});

test("fails closed on every storage fence, drain, stability and controller invariant", async () => {
  const scenarios = [
    {
      name: "storage mutation policy remains",
      code: "SUCCESSOR_STORAGE_DRAIN_INVALID",
      mutate: async (fixture) => {
        const final = JSON.parse(await readFile(fixture.finalPath, "utf8"));
        final.mutationPolicyCount = 1;
        await writeJson(fixture.finalPath, final);
      },
    },
    {
      name: "signed upload TTL plus grace has not drained",
      code: "SUCCESSOR_STORAGE_DRAIN_INVALID",
      mutate: async (fixture) => {
        const first = JSON.parse(await readFile(fixture.firstPath, "utf8"));
        first.observedAt = "2026-08-19T05:09:59.000Z";
        await writeJson(fixture.firstPath, first);
      },
    },
    {
      name: "second inventory changes",
      code: "SUCCESSOR_STORAGE_DRAIN_INVALID",
      mutate: async (fixture) => {
        const final = JSON.parse(await readFile(fixture.finalPath, "utf8"));
        final.objectInventorySha256 = "B".repeat(64);
        await writeJson(fixture.finalPath, final);
      },
    },
    {
      name: "current web write fence is down",
      code: "SUCCESSOR_STORAGE_WRITE_FENCE_INVALID",
      mutate: async (fixture) => {
        const receipt = JSON.parse(await readFile(fixture.writeFenceReceiptPath, "utf8"));
        receipt.controls.vercelProductionWriteFenceEnabled = false;
        await writeJson(fixture.writeFenceReceiptPath, receipt);
      },
    },
    {
      name: "manifest is not controller ready",
      code: "SUCCESSOR_STORAGE_RELEASE_CONTRACT_INVALID",
      mutate: async (fixture) => {
        fixture.state.manifest.status = "deployment_blocked";
      },
    },
  ];
  for (const scenario of scenarios) {
    const fixture = await createFixture();
    try {
      await scenario.mutate(fixture);
      await assert.rejects(
        emitVendorDisclosureSuccessorStorageEvidence({
          repoRoot: fixture.repoRoot,
          receiptRoot: fixture.receiptRoot,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          storageDrainReceiptDirectory: fixture.receiptRoot,
          writeFenceReceiptPath: fixture.writeFenceReceiptPath,
          originalBytesBackupReceiptPath: fixture.originalBytesBackupReceiptPath,
          originalBytesBackupEncryptionKey: ENCRYPTION_KEY,
          now: () => NOW,
          runCommand: commandRunner(),
          releaseLoader: () => fixture.state,
        }),
        (error) => error?.code === scenario.code,
        scenario.name,
      );
      await assertRuntimeOutputsAbsent(fixture);
    } finally {
      await cleanup(fixture);
    }
  }
});

test("CLI fails closed when its complete external evidence argument set is absent", () => {
  const cliPath = fileURLToPath(new URL(
    "../vendor-disclosure-successor-storage-evidence.mjs",
    import.meta.url,
  ));
  const result = spawnSync(process.execPath, [cliPath], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "SUCCESSOR_STORAGE_ARGUMENT_INVALID");
});

test("storage emission cleans both outputs on durable setup, sync, or close failure", async () => {
  for (const failureStage of ["setup", "receipt-sync", "parent-sync", "parent-close"]) {
    const fixture = await createFixture();
    try {
      let parentSyncCalls = 0;
      const io = {
        unlink,
        async open(path, flags, mode) {
          const isParent = flags === "r";
          if (failureStage === "setup" && isParent) throw new Error("setup failed");
          const handle = await open(path, flags, mode);
          return {
            writeFile: (...arguments_) => handle.writeFile(...arguments_),
            async sync() {
              if (failureStage === "receipt-sync"
                  && String(path).endsWith(`${RELEASE}-storage-evidence.json`)) {
                throw new Error("receipt sync failed");
              }
              if (failureStage === "parent-sync" && isParent
                  && parentSyncCalls++ === 0) {
                throw new Error("parent sync failed");
              }
              if (isParent) return;
              return await handle.sync();
            },
            async close() {
              await handle.close();
              if (failureStage === "parent-close" && isParent) {
                throw new Error("parent close failed");
              }
            },
          };
        },
      };
      await assert.rejects(
        emitVendorDisclosureSuccessorStorageEvidence({
          repoRoot: fixture.repoRoot,
          receiptRoot: fixture.receiptRoot,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          storageDrainReceiptDirectory: fixture.receiptRoot,
          writeFenceReceiptPath: fixture.writeFenceReceiptPath,
          originalBytesBackupReceiptPath: fixture.originalBytesBackupReceiptPath,
          originalBytesBackupEncryptionKey: ENCRYPTION_KEY,
          now: () => NOW,
          runCommand: commandRunner(),
          releaseLoader: () => fixture.state,
          durableWriter: (input) => writeDurableExclusiveEvidencePair({
            ...input,
            platform: "linux",
            io,
          }),
        }),
        (error) => error?.code === "SUCCESSOR_STORAGE_OUTPUT_FAILED",
        failureStage,
      );
      await assertRuntimeOutputsAbsent(fixture);
    } finally {
      await cleanup(fixture);
    }
  }
});
