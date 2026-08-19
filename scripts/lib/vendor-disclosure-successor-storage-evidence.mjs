import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { resolvePinnedWindowsProductionToolchain } from "./production-windows-toolchain.mjs";
import {
  getStorageDrainReceiptPaths,
  validateCompletedStorageDrainEvidence,
} from "./storage-signed-upload-drain-evidence.mjs";
import {
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  validateSuccessorReleaseContract,
} from "./supabase-successor-release-contract.mjs";
import {
  writeDurableExclusiveEvidencePair,
} from "./vendor-disclosure-successor-hosted-staging-evidence.mjs";
import {
  SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_KIND,
  verifyVendorDisclosureSuccessorStorageOriginalBytesBackup,
} from "./vendor-disclosure-successor-storage-original-bytes.mjs";
import {
  validateVendorDisclosureSuccessorStorageEvidenceProvenance,
} from "./vendor-disclosure-successor-storage-evidence-provenance.mjs";

export { SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_KIND };

const MAX_INPUT_JSON_BYTES = 256 * 1024;
const MAX_RAW_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_RUNTIME_RECEIPT_BYTES = 64 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const MIGRATION = /^\d{14}$/;
const SAFE_FILE = /^[a-z0-9][a-z0-9_.-]{2,160}\.json$/;
const SAFE_CHECK_ID = /^[a-z][a-z0-9-]{2,63}$/;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REMOTE_REF = /^origin\/([A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?)$/;

const WRITE_FENCE_RECEIPT_KEYS = Object.freeze([
  "backupManifestSha256",
  "backupSetId",
  "containsSensitiveValues",
  "controls",
  "forwardOnlySecurityOperations",
  "operations",
  "projectRef",
  "providerPhysicalBackup",
  "receiptVersion",
  "release",
  "releaseCommit",
  "storageSignedUploadDrain",
  "verifiedAt",
]);

export class SuccessorStorageEvidenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SuccessorStorageEvidenceError";
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new SuccessorStorageEvidenceError(code, message);
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

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

function sameFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readBoundedRegularFile(path, maximumBytes, code) {
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()
      || before.size < 2 || before.size > maximumBytes) {
    fail(code);
  }
  let handle;
  try {
    handle = await open(path, "r");
    const opened = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    if (!opened.isFile() || !linked?.isFile() || linked.isSymbolicLink()
        || !sameFile(before, opened) || !sameFile(opened, linked)) {
      fail(code);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const linkedAfter = await lstat(path).catch(() => null);
    if (!linkedAfter?.isFile() || linkedAfter.isSymbolicLink()
        || !sameFile(opened, after) || !sameFile(after, linkedAfter)
        || bytes.length !== after.size) {
      fail(code);
    }
    return bytes;
  } catch (error) {
    if (error instanceof SuccessorStorageEvidenceError) throw error;
    fail(code);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readBoundedJson(path, code) {
  const bytes = await readBoundedRegularFile(path, MAX_INPUT_JSON_BYTES, code);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    fail(code);
  }
}

async function defaultRunCommand(command, args, { cwd, timeoutMs = 30_000 } = {}) {
  return await new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ ...result, timedOut });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length <= MAX_INPUT_JSON_BYTES) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length + chunk.length <= MAX_INPUT_JSON_BYTES) stderr += chunk;
    });
    child.on("error", (error) => finish({ status: null, stdout, stderr, error }));
    child.on("close", (status) => finish({ status, stdout, stderr }));
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
  });
}

async function requireCommand(runCommand, command, args, cwd, code) {
  const result = await runCommand(command, args, { cwd });
  if (result?.status !== 0 || result.timedOut === true) fail(code);
  return String(result.stdout ?? "");
}

async function assertExactPushedCommit({
  repoRoot,
  expectedCommit,
  expectedOrigin,
  remoteRef,
  runCommand,
}) {
  let git = "git";
  if (runCommand === defaultRunCommand) {
    try {
      git = (await resolvePinnedWindowsProductionToolchain()).git;
    } catch {
      fail("SUCCESSOR_STORAGE_TOOLCHAIN_INVALID");
    }
  }
  const status = await requireCommand(
    runCommand,
    git,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repoRoot,
    "SUCCESSOR_STORAGE_GIT_STATUS_FAILED",
  );
  if (status.trim()) fail("SUCCESSOR_STORAGE_WORKTREE_DIRTY");
  const head = await requireCommand(
    runCommand,
    git,
    ["rev-parse", "HEAD"],
    repoRoot,
    "SUCCESSOR_STORAGE_GIT_HEAD_FAILED",
  );
  if (head.trim() !== expectedCommit) fail("SUCCESSOR_STORAGE_GIT_HEAD_MISMATCH");
  const origin = await requireCommand(
    runCommand,
    git,
    ["remote", "get-url", "origin"],
    repoRoot,
    "SUCCESSOR_STORAGE_GIT_ORIGIN_FAILED",
  );
  if (origin.trim() !== expectedOrigin) fail("SUCCESSOR_STORAGE_GIT_ORIGIN_MISMATCH");
  const match = remoteRef.match(REMOTE_REF);
  if (!match || match[1].includes("..") || match[1].includes("//")) {
    fail("SUCCESSOR_STORAGE_REMOTE_REF_INVALID");
  }
  const branchRef = `refs/heads/${match[1]}`;
  const remote = await requireCommand(
    runCommand,
    git,
    ["ls-remote", "--exit-code", "origin", branchRef],
    repoRoot,
    "SUCCESSOR_STORAGE_REMOTE_REF_FAILED",
  );
  const lines = remote.trim().split(/\r?\n/).filter(Boolean);
  const [remoteCommit, returnedRef] = lines.length === 1
    ? lines[0].trim().split(/\s+/)
    : [];
  if (remoteCommit !== expectedCommit || returnedRef !== branchRef) {
    fail("SUCCESSOR_STORAGE_REMOTE_COMMIT_MISMATCH");
  }
}

function validateEvidenceContract(manifest) {
  const actual = manifest?.deploymentEvidence?.storage;
  const expected = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.storage;
  if (!exactKeys(actual, [
    "kind",
    "maximumAgeMinutes",
    "rawEvidenceFileName",
    "rawEvidenceSource",
    "receiptFileName",
    "requiredChecks",
  ])
      || actual.kind !== expected.kind
      || actual.maximumAgeMinutes !== expected.maximumAgeMinutes
      || actual.rawEvidenceSource !== expected.rawEvidenceSource
      || !exactArray(actual.requiredChecks, expected.requiredChecks)
      || !SAFE_FILE.test(actual.rawEvidenceFileName ?? "")
      || !SAFE_FILE.test(actual.receiptFileName ?? "")
      || actual.rawEvidenceFileName === actual.receiptFileName
      || !actual.rawEvidenceFileName.startsWith(`${manifest.release}-`)
      || !actual.receiptFileName.startsWith(`${manifest.release}-`)) {
    fail("SUCCESSOR_STORAGE_EVIDENCE_CONTRACT_INVALID");
  }
  return actual;
}

async function validateReleaseState({ repoRoot, releaseLoader }) {
  let state;
  try {
    state = await releaseLoader({ repoRoot });
  } catch {
    fail("SUCCESSOR_STORAGE_RELEASE_CONTRACT_INVALID");
  }
  const { manifest, controllerManifest } = state ?? {};
  const control = controllerManifest?.manualControlEvidence;
  const expectedOrigin = controllerManifest?.backupContract?.expectedOrigin;
  if (state?.controllerReady !== true
      || manifest?.status !== "controller_ready"
      || manifest?.release !== controllerManifest?.release
      || manifest?.projectRef !== controllerManifest?.projectRef
      || !PROJECT_REF.test(manifest?.projectRef ?? "")
      || !MIGRATION.test(manifest?.requiredRemoteHead ?? "")
      || typeof expectedOrigin !== "string"
      || expectedOrigin.length < 8
      || !SAFE_FILE.test(control?.receiptFileName ?? "")
      || !SAFE_FILE.test(control?.storageDrainReceiptFileName ?? "")
      || !control.receiptFileName.startsWith(`${manifest.release}-`)
      || !control.storageDrainReceiptFileName.startsWith(`${manifest.release}-`)
      || control?.maximumAgeMinutes
        !== SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.storage.maximumAgeMinutes
      || control?.signedUploadTokenTtlMinutes !== 120
      || control?.signedUploadGraceMinutes !== 10
      || control?.storageStabilityWindowMinutes !== 5
      || !Array.isArray(controllerManifest?.manualPlatformOperations)
      || controllerManifest.manualPlatformOperations.length < 1
      || !Array.isArray(manifest?.expandMigrations)
      || manifest.expandMigrations.length < 1
      || !Array.isArray(controllerManifest?.postApplyChecks)
      || controllerManifest.postApplyChecks.length < 1
      || !controllerManifest?.rollbackContract
      || typeof controllerManifest.rollbackContract !== "object"
      || Array.isArray(controllerManifest.rollbackContract)) {
    fail("SUCCESSOR_STORAGE_RELEASE_CONTRACT_INVALID");
  }
  return {
    manifest,
    controllerManifest,
    control,
    evidence: validateEvidenceContract(manifest),
    expectedOrigin,
  };
}

function releaseRuntimeBinding(manifest, controllerManifest) {
  const versions = manifest.expandMigrations.map((entry) => {
    const version = typeof entry?.file === "string" ? entry.file.slice(0, 14) : "";
    return /^\d{14}_[a-z0-9_.-]+\.sql$/.test(entry?.file ?? "") ? version : "";
  });
  if (versions.some((version, index) => !MIGRATION.test(version)
      || (index > 0 && version <= versions[index - 1]))) {
    fail("SUCCESSOR_STORAGE_RELEASE_CONTRACT_INVALID");
  }
  const postApplyCheckIds = controllerManifest.postApplyChecks.map((check) => check?.id);
  if (postApplyCheckIds.some((id) => !SAFE_CHECK_ID.test(id ?? ""))
      || new Set(postApplyCheckIds).size !== postApplyCheckIds.length) {
    fail("SUCCESSOR_STORAGE_RELEASE_CONTRACT_INVALID");
  }
  return {
    expectedMigrationHead: versions.at(-1),
    migrationCount: versions.length,
    migrationVersionsSha256: textListSha256(versions),
    postApplyCheckIds,
    postApplyChecksSha256: textListSha256(postApplyCheckIds),
    rollbackContractSha256: canonicalJsonSha256(controllerManifest.rollbackContract),
  };
}

function validControls(value, expectedCommit) {
  return exactKeys(value, [
    "supabaseAuthSignupDisabled",
    "vercelDeploymentCommit",
    "vercelProductionWriteFenceEnabled",
  ])
    && value.supabaseAuthSignupDisabled === true
    && value.vercelDeploymentCommit === expectedCommit
    && value.vercelProductionWriteFenceEnabled === true;
}

function validDatabaseWriteFence(value) {
  return exactKeys(value, [
    "attachFunctionCount",
    "eventTriggerCount",
    "guardFunctionCount",
    "liveSchemaContractFunctionCount",
    "publicTableCount",
    "triggerCount",
  ])
    && Number.isSafeInteger(value.publicTableCount)
    && value.publicTableCount >= 1
    && value.publicTableCount <= 1_000_000
    && value.triggerCount === value.publicTableCount
    && value.guardFunctionCount === 1
    && value.attachFunctionCount === 1
    && value.liveSchemaContractFunctionCount === 1
    && value.eventTriggerCount === 2;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateWriteFenceReceipt({
  value,
  manifest,
  control,
  expectedCommit,
  drain,
  nowMs,
}) {
  const verifiedMs = Date.parse(value?.verifiedAt ?? "");
  const maximumAgeMs = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.storage.maximumAgeMinutes
    * 60_000;
  const storage = value?.storageSignedUploadDrain;
  const operationValid = Array.isArray(value?.operations)
    && value.operations.length >= 1
    && value.operations.every((operation) => exactKeys(operation, [
      "applyArtifactSha256",
      "operationId",
      "verificationCheckId",
      "verified",
    ])
      && SAFE_CHECK_ID.test(operation.operationId ?? "")
      && SAFE_CHECK_ID.test(operation.verificationCheckId ?? "")
      && SHA256.test(operation.applyArtifactSha256 ?? "")
      && operation.verified === true);
  if (!exactKeys(value, WRITE_FENCE_RECEIPT_KEYS)
      || value.receiptVersion !== 1
      || value.release !== manifest.release
      || value.projectRef !== manifest.projectRef
      || value.releaseCommit !== expectedCommit
      || !UUID_V4.test(value.backupSetId ?? "")
      || !UPPER_SHA256.test(value.backupManifestSha256 ?? "")
      || !Number.isFinite(verifiedMs)
      || verifiedMs < Date.parse(drain.secondStableSnapshotAt)
      || verifiedMs > nowMs + 60_000
      || nowMs - verifiedMs > maximumAgeMs
      || !validControls(value.controls, expectedCommit)
      || !exactKeys(value.providerPhysicalBackup, [
        "ageSeconds",
        "insertedAt",
        "isPhysicalBackup",
        "latestPhysicalBackupDateUnix",
        "restoreCandidateAvailable",
        "status",
      ])
      || value.providerPhysicalBackup.status !== "COMPLETED"
      || value.providerPhysicalBackup.isPhysicalBackup !== true
      || value.providerPhysicalBackup.restoreCandidateAvailable !== true
      || !Number.isFinite(Date.parse(value.providerPhysicalBackup.insertedAt ?? ""))
      || !Number.isSafeInteger(value.providerPhysicalBackup.latestPhysicalBackupDateUnix)
      || !Number.isSafeInteger(value.providerPhysicalBackup.ageSeconds)
      || value.providerPhysicalBackup.ageSeconds < 0
      || !exactKeys(storage, [
        "databaseWriteFence",
        "firstStableSnapshotAt",
        "freezeVerifiedAt",
        "mutationPolicyCount",
        "objectInventorySha256",
        "preBackupControls",
        "receiptSha256",
        "secondStableSnapshotAt",
        "startReceiptSha256",
        "totalObjectCount",
      ])
      || storage.receiptSha256 !== drain.sha256
      || storage.startReceiptSha256 !== drain.startReceiptSha256
      || storage.freezeVerifiedAt !== drain.freezeVerifiedAt
      || storage.firstStableSnapshotAt !== drain.firstStableSnapshotAt
      || storage.secondStableSnapshotAt !== drain.secondStableSnapshotAt
      || storage.totalObjectCount !== drain.totalObjectCount
      || storage.objectInventorySha256 !== drain.objectInventorySha256
      || storage.mutationPolicyCount !== 0
      || !validControls(storage.preBackupControls, expectedCommit)
      || !sameJson(storage.preBackupControls, drain.controls)
      || !validDatabaseWriteFence(storage.databaseWriteFence)
      || !sameJson(storage.databaseWriteFence, drain.databaseWriteFence)
      || !operationValid
      || !Array.isArray(value.forwardOnlySecurityOperations)
      || value.containsSensitiveValues !== false
      || basename(control.receiptFileName) !== control.receiptFileName) {
    fail("SUCCESSOR_STORAGE_WRITE_FENCE_INVALID");
  }
  return { verifiedAt: new Date(verifiedMs).toISOString(), value };
}

async function assertExternalDirectory(repoRoot, path, code) {
  if (!isAbsolute(path) || inside(repoRoot, path)) fail(code);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) fail(code);
  const [canonicalRepo, canonicalPath] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(path).catch(() => null),
  ]);
  if (!canonicalRepo || !canonicalPath || inside(canonicalRepo, canonicalPath)) fail(code);
  return canonicalPath;
}

async function canonicalExternalFile(repoRoot, path, code) {
  if (!isAbsolute(path) || inside(repoRoot, path)) fail(code);
  const [canonicalRepo, canonicalPath] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(path).catch(() => null),
  ]);
  if (!canonicalRepo || !canonicalPath || inside(canonicalRepo, canonicalPath)) fail(code);
  return canonicalPath;
}

export async function emitVendorDisclosureSuccessorStorageEvidence({
  repoRoot,
  receiptRoot,
  expectedCommit,
  remoteRef,
  storageDrainReceiptDirectory,
  writeFenceReceiptPath,
  originalBytesBackupReceiptPath,
  originalBytesBackupEncryptionKey = process.env.STORAGE_BACKUP_ENCRYPTION_KEY,
  now = () => new Date(),
  runCommand = defaultRunCommand,
  releaseLoader = validateSuccessorReleaseContract,
  durableWriter = writeDurableExclusiveEvidencePair,
}) {
  const root = resolve(repoRoot);
  if (!COMMIT.test(expectedCommit ?? "")
      || typeof remoteRef !== "string"
      || !isAbsolute(storageDrainReceiptDirectory)
      || !isAbsolute(writeFenceReceiptPath)
      || !isAbsolute(originalBytesBackupReceiptPath)
      || typeof runCommand !== "function"
      || typeof releaseLoader !== "function"
      || typeof durableWriter !== "function") {
    fail("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
  }
  const capturedAt = now();
  const nowMs = capturedAt instanceof Date ? capturedAt.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) fail("SUCCESSOR_STORAGE_CLOCK_INVALID");

  const {
    manifest,
    controllerManifest,
    control,
    evidence,
    expectedOrigin,
  } = await validateReleaseState({ repoRoot: root, releaseLoader });
  const [outputRoot, drainRoot, canonicalWriteFence, canonicalOriginalBackup] =
    await Promise.all([
      assertExternalDirectory(root, receiptRoot, "SUCCESSOR_STORAGE_OUTPUT_ROOT_INVALID"),
      assertExternalDirectory(
        root,
        storageDrainReceiptDirectory,
        "SUCCESSOR_STORAGE_DRAIN_ROOT_INVALID",
      ),
      canonicalExternalFile(
        root,
        writeFenceReceiptPath,
        "SUCCESSOR_STORAGE_WRITE_FENCE_INVALID",
      ),
      canonicalExternalFile(
        root,
        originalBytesBackupReceiptPath,
        "SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_INVALID",
      ),
    ]);
  if (basename(canonicalWriteFence) !== control.receiptFileName) {
    fail("SUCCESSOR_STORAGE_WRITE_FENCE_INVALID");
  }
  if (!SAFE_FILE.test(basename(canonicalOriginalBackup))) {
    fail("SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_INVALID");
  }
  const rawPath = resolve(outputRoot, evidence.rawEvidenceFileName);
  const receiptPath = resolve(outputRoot, evidence.receiptFileName);
  if (dirname(rawPath) !== outputRoot || dirname(receiptPath) !== outputRoot
      || await lstat(rawPath).catch(() => null)
      || await lstat(receiptPath).catch(() => null)) {
    fail("SUCCESSOR_STORAGE_OUTPUT_COLLISION");
  }

  await assertExactPushedCommit({
    repoRoot: root,
    expectedCommit,
    expectedOrigin,
    remoteRef,
    runCommand,
  });
  let drain;
  try {
    drain = await validateCompletedStorageDrainEvidence({
      repoRoot: root,
      receiptDirectory: drainRoot,
      manifest: controllerManifest,
      expectedCommit,
      now: () => capturedAt,
    });
  } catch {
    fail("SUCCESSOR_STORAGE_DRAIN_INVALID");
  }
  const drainPaths = getStorageDrainReceiptPaths(
    drainRoot,
    control.storageDrainReceiptFileName,
  );
  const [startInput, firstInput, finalInput, writeFenceInput] =
    await Promise.all([
      readBoundedJson(drainPaths.start, "SUCCESSOR_STORAGE_DRAIN_INVALID"),
      readBoundedJson(drainPaths.first, "SUCCESSOR_STORAGE_DRAIN_INVALID"),
      readBoundedJson(drainPaths.final, "SUCCESSOR_STORAGE_DRAIN_INVALID"),
      readBoundedJson(canonicalWriteFence, "SUCCESSOR_STORAGE_WRITE_FENCE_INVALID"),
    ]);
  if (sha256(startInput.bytes).toUpperCase() !== drain.startReceiptSha256
      || sha256(firstInput.bytes).toUpperCase()
        !== finalInput.value?.firstSnapshotReceiptSha256
      || sha256(finalInput.bytes).toUpperCase() !== drain.sha256) {
    fail("SUCCESSOR_STORAGE_DRAIN_INVALID");
  }
  const writeFence = validateWriteFenceReceipt({
    value: writeFenceInput.value,
    manifest,
    control,
    expectedCommit,
    drain,
    nowMs,
  });
  let originalBytesBackup;
  try {
    originalBytesBackup = await verifyVendorDisclosureSuccessorStorageOriginalBytesBackup({
      repoRoot: root,
      receiptPath: canonicalOriginalBackup,
      encryptionKey: originalBytesBackupEncryptionKey,
      expectedCommit,
      controllerManifest,
      expectedDrain: drain,
    });
  } catch {
    fail("SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_INVALID");
  }
  if (Date.parse(originalBytesBackup.verifiedAt) > Date.parse(writeFence.verifiedAt)
      || nowMs - Date.parse(originalBytesBackup.verifiedAt)
        > SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.storage.maximumAgeMinutes * 60_000) {
    fail("SUCCESSOR_STORAGE_ORIGINAL_BYTES_BACKUP_INVALID");
  }
  const originalBytesBackupReceipt = originalBytesBackup.receipt;
  const binding = releaseRuntimeBinding(manifest, controllerManifest);
  const capturedAtText = capturedAt.toISOString();
  const raw = {
    rawEvidenceVersion: 1,
    kind: "vendor-disclosure-successor-storage-raw-v1",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt: capturedAtText,
    writeFence: {
      receiptFileName: basename(canonicalWriteFence),
      receiptSha256: sha256(writeFenceInput.bytes),
      verifiedAt: writeFence.verifiedAt,
      controls: writeFence.value.controls,
      databaseWriteFence: drain.databaseWriteFence,
    },
    signedUploadDrain: {
      startReceiptFileName: basename(drainPaths.start),
      startReceiptSha256: sha256(startInput.bytes),
      freezeVerifiedAt: drain.freezeVerifiedAt,
      signedUploadTokenTtlMinutes: control.signedUploadTokenTtlMinutes,
      signedUploadGraceMinutes: control.signedUploadGraceMinutes,
      storageStabilityWindowMinutes: control.storageStabilityWindowMinutes,
      mutationPolicyCount: drain.mutationPolicyCount,
      stableInventories: [
        {
          receiptFileName: basename(drainPaths.first),
          receiptSha256: sha256(firstInput.bytes),
          observedAt: drain.firstStableSnapshotAt,
          totalObjectCount: drain.totalObjectCount,
          objectInventorySha256: drain.objectInventorySha256,
        },
        {
          receiptFileName: basename(drainPaths.final),
          receiptSha256: sha256(finalInput.bytes),
          observedAt: drain.secondStableSnapshotAt,
          totalObjectCount: drain.totalObjectCount,
          objectInventorySha256: drain.objectInventorySha256,
        },
      ],
    },
    originalBytesBackup: {
      receiptFileName: basename(canonicalOriginalBackup),
      receiptSha256: originalBytesBackup.receiptSha256,
      backupSetId: originalBytesBackupReceipt.backupSetId,
      sourceInventoryCapturedAt: originalBytesBackupReceipt.sourceInventoryCapturedAt,
      capturedAt: originalBytesBackupReceipt.capturedAt,
      verifiedAt: originalBytesBackup.verifiedAt,
      bucketCount: originalBytesBackupReceipt.bucketCount,
      objectCount: originalBytesBackup.objectCount,
      totalOriginalBytes: originalBytesBackup.totalOriginalBytes,
      objectInventorySha256: originalBytesBackupReceipt.objectInventorySha256,
      originalBytesManifestSha256: originalBytesBackup.originalBytesManifestSha256,
      encryptedBackupArtifactSha256:
        originalBytesBackup.encryptedBackupArtifactSha256,
      privateRawSha256: originalBytesBackup.privateRawSha256,
      encryptedArtifactSize: originalBytesBackupReceipt.encryptedArtifact.size,
      encryptedArtifactDev: originalBytesBackupReceipt.encryptedArtifact.dev,
      encryptedArtifactIno: originalBytesBackupReceipt.encryptedArtifact.ino,
      everyInventoryObjectIncluded: true,
      originalByteDigestsVerified: true,
      encryptedArtifactVerified: true,
      restoreCandidateAvailable: true,
      plaintextWrittenToDisk: false,
    },
    containsSecrets: false,
  };
  const rawText = `${JSON.stringify(raw, null, 2)}\n`;
  const receipt = {
    receiptVersion: 1,
    kind: evidence.kind,
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt: capturedAtText,
    expiresAt: new Date(nowMs + evidence.maximumAgeMinutes * 60_000).toISOString(),
    requiredRemoteHead: manifest.requiredRemoteHead,
    expectedMigrationHead: binding.expectedMigrationHead,
    migrationCount: binding.migrationCount,
    migrationVersionsSha256: binding.migrationVersionsSha256,
    observations: {
      requiredMutationPolicyCount: 0,
      signedUploadGraceMinutes: control.signedUploadGraceMinutes,
      signedUploadTokenTtlMinutes: control.signedUploadTokenTtlMinutes,
      storageStabilityWindowMinutes: control.storageStabilityWindowMinutes,
      writeFenceReceiptFileName: control.receiptFileName,
    },
    postApplyCheckIds: binding.postApplyCheckIds,
    postApplyChecksSha256: binding.postApplyChecksSha256,
    rollbackContractSha256: binding.rollbackContractSha256,
    checks: Object.fromEntries(evidence.requiredChecks.map((check) => [check, true])),
    rawProvenance: {
      fileName: evidence.rawEvidenceFileName,
      sha256: sha256(rawText),
      capturedAt: capturedAtText,
      source: evidence.rawEvidenceSource,
    },
    containsSecrets: false,
  };
  receipt.observations = {
    encryptedBackupArtifactSha256:
      originalBytesBackup.encryptedBackupArtifactSha256,
    encryptedBackupArtifactSize:
      originalBytesBackupReceipt.encryptedArtifact.size,
    objectCount: originalBytesBackup.objectCount,
    objectInventorySha256: originalBytesBackupReceipt.objectInventorySha256,
    originalBytesBackupReceiptSha256: originalBytesBackup.receiptSha256,
    originalBytesBackupSetId: originalBytesBackupReceipt.backupSetId,
    originalBytesManifestSha256:
      originalBytesBackup.originalBytesManifestSha256,
    originalBytesPrivateRawSha256: originalBytesBackup.privateRawSha256,
    requiredMutationPolicyCount: 0,
    signedUploadGraceMinutes: control.signedUploadGraceMinutes,
    signedUploadTokenTtlMinutes: control.signedUploadTokenTtlMinutes,
    storageDrainFinalInventoryReceiptSha256: sha256(finalInput.bytes),
    storageDrainFirstInventoryReceiptSha256: sha256(firstInput.bytes),
    storageDrainStartReceiptSha256: sha256(startInput.bytes),
    storageStabilityWindowMinutes: control.storageStabilityWindowMinutes,
    totalOriginalBytes: originalBytesBackup.totalOriginalBytes,
    writeFenceReceiptFileName: control.receiptFileName,
    writeFenceReceiptSha256: sha256(writeFenceInput.bytes),
  };
  try {
    validateVendorDisclosureSuccessorStorageEvidenceProvenance({
      receipt,
      raw,
      manifest,
      controllerManifest,
      expectedCommit,
    });
  } catch {
    fail("SUCCESSOR_STORAGE_OUTPUT_INVALID");
  }
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(rawText, "utf8") > MAX_RAW_EVIDENCE_BYTES
      || Buffer.byteLength(receiptText, "utf8") > MAX_RUNTIME_RECEIPT_BYTES) {
    fail("SUCCESSOR_STORAGE_OUTPUT_TOO_LARGE");
  }

  try {
    await durableWriter({ rawPath, rawText, receiptPath, receiptText });
  } catch {
    fail("SUCCESSOR_STORAGE_OUTPUT_FAILED");
  }

  return Object.freeze({
    status: "successor_storage_evidence_emitted",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    objectCount: drain.totalObjectCount,
    objectInventorySha256: drain.objectInventorySha256,
    originalBytesBackupSetId: originalBytesBackup.backupSetId,
    writeFenceVerifiedAt: writeFence.verifiedAt,
    secondStableSnapshotAt: drain.secondStableSnapshotAt,
    rawEvidencePath: rawPath,
    rawEvidenceSha256: receipt.rawProvenance.sha256,
    receiptPath,
    receiptSha256: sha256(receiptText),
    capturedAt: capturedAtText,
    expiresAt: receipt.expiresAt,
    containsSecrets: false,
  });
}
