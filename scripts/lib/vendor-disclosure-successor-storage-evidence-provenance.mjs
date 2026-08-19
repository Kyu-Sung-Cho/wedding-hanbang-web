const SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_FILE = /^[a-z0-9][a-z0-9_.-]{2,160}\.json$/;
const SAFE_ARTIFACT_FILE = /^[a-z0-9][a-z0-9_.-]{2,160}\.hbsb$/;

export const SUCCESSOR_STORAGE_OBSERVATION_KEYS = Object.freeze([
  "encryptedBackupArtifactSha256",
  "encryptedBackupArtifactSize",
  "objectCount",
  "objectInventorySha256",
  "originalBytesBackupReceiptSha256",
  "originalBytesBackupSetId",
  "originalBytesManifestSha256",
  "originalBytesPrivateRawSha256",
  "requiredMutationPolicyCount",
  "signedUploadGraceMinutes",
  "signedUploadTokenTtlMinutes",
  "storageDrainFinalInventoryReceiptSha256",
  "storageDrainFirstInventoryReceiptSha256",
  "storageDrainStartReceiptSha256",
  "storageStabilityWindowMinutes",
  "totalOriginalBytes",
  "writeFenceReceiptFileName",
  "writeFenceReceiptSha256",
]);

export class SuccessorStorageEvidenceProvenanceError extends Error {
  constructor(code = "SUCCESSOR_STORAGE_PROVENANCE_INVALID") {
    super(code);
    this.name = "SuccessorStorageEvidenceProvenanceError";
    this.code = code;
  }
}

function fail() {
  throw new SuccessorStorageEvidenceProvenanceError();
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function validNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

async function readStableFile(path, maximumBytes, expectedBinding) {
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()
      || before.size < 1 || before.size > maximumBytes) fail();
  const handle = await open(path, "r").catch(() => null);
  if (!handle) fail();
  try {
    const opened = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    if (!linked?.isFile() || linked.isSymbolicLink()
        || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.size !== before.size || linked.dev !== opened.dev
        || linked.ino !== opened.ino || linked.size !== opened.size
        || (expectedBinding && (
          String(opened.dev) !== expectedBinding.dev
          || String(opened.ino) !== expectedBinding.ino
          || opened.size !== expectedBinding.size
        ))) fail();
    const digest = createHash("sha256");
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(256 * 1024);
    while (total < opened.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, opened.size - total),
        total,
      );
      if (bytesRead < 1) fail();
      const bytes = Buffer.from(buffer.subarray(0, bytesRead));
      digest.update(bytes);
      if (opened.size <= 4 * 1024 * 1024) chunks.push(bytes);
      total += bytesRead;
    }
    const after = await handle.stat();
    const linkedAfter = await lstat(path).catch(() => null);
    if (!linkedAfter?.isFile() || linkedAfter.isSymbolicLink()
        || after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || linkedAfter.dev !== opened.dev
        || linkedAfter.ino !== opened.ino || linkedAfter.size !== opened.size
        || total !== opened.size) fail();
    return {
      bytes: chunks.length ? Buffer.concat(chunks) : null,
      sha256: digest.digest("hex"),
      size: total,
      dev: String(opened.dev),
      ino: String(opened.ino),
    };
  } finally {
    await handle.close().catch(() => {});
  }
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
    && value.triggerCount === value.publicTableCount
    && value.guardFunctionCount === 1
    && value.attachFunctionCount === 1
    && value.liveSchemaContractFunctionCount === 1
    && value.eventTriggerCount === 2;
}

function validStableInventory(value) {
  return exactKeys(value, [
    "objectInventorySha256",
    "observedAt",
    "receiptFileName",
    "receiptSha256",
    "totalObjectCount",
  ])
    && SAFE_FILE.test(value.receiptFileName ?? "")
    && SHA256.test(value.receiptSha256 ?? "")
    && Number.isFinite(Date.parse(value.observedAt ?? ""))
    && validNonnegativeInteger(value.totalObjectCount)
    && UPPER_SHA256.test(value.objectInventorySha256 ?? "");
}

/**
 * Revalidate the exact non-secret Storage producer transcript. This is kept in
 * a dependency-free module so both the synchronous central fence and the
 * async producer/finalizer can use the same schema and cross-bindings.
 */
export function validateVendorDisclosureSuccessorStorageEvidenceProvenance({
  receipt,
  raw,
  manifest,
  controllerManifest,
  expectedCommit,
}) {
  const observations = receipt?.observations;
  const control = controllerManifest?.manualControlEvidence;
  const writeFence = raw?.writeFence;
  const drain = raw?.signedUploadDrain;
  const original = raw?.originalBytesBackup;
  const inventories = drain?.stableInventories;
  if (!exactKeys(raw, [
    "capturedAt",
    "containsSecrets",
    "kind",
    "originalBytesBackup",
    "projectRef",
    "rawEvidenceVersion",
    "release",
    "releaseCommit",
    "signedUploadDrain",
    "writeFence",
  ])
      || raw.rawEvidenceVersion !== 1
      || raw.kind !== "vendor-disclosure-successor-storage-raw-v1"
      || raw.release !== manifest?.release
      || raw.projectRef !== manifest?.projectRef
      || raw.releaseCommit !== expectedCommit
      || raw.capturedAt !== receipt?.capturedAt
      || raw.containsSecrets !== false
      || !exactKeys(writeFence, [
        "controls",
        "databaseWriteFence",
        "receiptFileName",
        "receiptSha256",
        "verifiedAt",
      ])
      || writeFence.receiptFileName !== control?.receiptFileName
      || !SAFE_FILE.test(writeFence.receiptFileName ?? "")
      || !SHA256.test(writeFence.receiptSha256 ?? "")
      || !Number.isFinite(Date.parse(writeFence.verifiedAt ?? ""))
      || !validControls(writeFence.controls, expectedCommit)
      || !validDatabaseWriteFence(writeFence.databaseWriteFence)
      || !exactKeys(drain, [
        "freezeVerifiedAt",
        "mutationPolicyCount",
        "signedUploadGraceMinutes",
        "signedUploadTokenTtlMinutes",
        "stableInventories",
        "startReceiptFileName",
        "startReceiptSha256",
        "storageStabilityWindowMinutes",
      ])
      || !SAFE_FILE.test(drain.startReceiptFileName ?? "")
      || !SHA256.test(drain.startReceiptSha256 ?? "")
      || !Number.isFinite(Date.parse(drain.freezeVerifiedAt ?? ""))
      || drain.mutationPolicyCount !== 0
      || drain.signedUploadTokenTtlMinutes !== control?.signedUploadTokenTtlMinutes
      || drain.signedUploadGraceMinutes !== control?.signedUploadGraceMinutes
      || drain.storageStabilityWindowMinutes !== control?.storageStabilityWindowMinutes
      || !Array.isArray(inventories)
      || inventories.length !== 2
      || !inventories.every(validStableInventory)
      || inventories[0].observedAt >= inventories[1].observedAt
      || inventories[0].totalObjectCount !== inventories[1].totalObjectCount
      || inventories[0].objectInventorySha256
        !== inventories[1].objectInventorySha256
      || !exactKeys(original, [
        "backupSetId",
        "bucketCount",
        "capturedAt",
        "encryptedArtifactDev",
        "encryptedArtifactIno",
        "encryptedArtifactSize",
        "encryptedArtifactVerified",
        "encryptedBackupArtifactSha256",
        "everyInventoryObjectIncluded",
        "objectCount",
        "objectInventorySha256",
        "originalByteDigestsVerified",
        "originalBytesManifestSha256",
        "plaintextWrittenToDisk",
        "privateRawSha256",
        "receiptFileName",
        "receiptSha256",
        "restoreCandidateAvailable",
        "sourceInventoryCapturedAt",
        "totalOriginalBytes",
        "verifiedAt",
      ])
      || !UUID.test(original.backupSetId ?? "")
      || !SAFE_FILE.test(original.receiptFileName ?? "")
      || ![
        original.receiptSha256,
        original.objectInventorySha256,
        original.originalBytesManifestSha256,
        original.encryptedBackupArtifactSha256,
        original.privateRawSha256,
      ].every((value, index) => (index === 1 ? UPPER_SHA256 : SHA256).test(value ?? ""))
      || !Number.isFinite(Date.parse(original.sourceInventoryCapturedAt ?? ""))
      || !Number.isFinite(Date.parse(original.capturedAt ?? ""))
      || !Number.isFinite(Date.parse(original.verifiedAt ?? ""))
      || original.sourceInventoryCapturedAt !== inventories[1].observedAt
      || original.objectInventorySha256 !== inventories[1].objectInventorySha256
      || original.objectCount !== inventories[1].totalObjectCount
      || !validNonnegativeInteger(original.bucketCount)
      || !validNonnegativeInteger(original.objectCount)
      || !validNonnegativeInteger(original.totalOriginalBytes)
      || !Number.isSafeInteger(original.encryptedArtifactSize)
      || original.encryptedArtifactSize < 1
      || typeof original.encryptedArtifactDev !== "string"
      || typeof original.encryptedArtifactIno !== "string"
      || original.everyInventoryObjectIncluded !== true
      || original.originalByteDigestsVerified !== true
      || original.encryptedArtifactVerified !== true
      || original.restoreCandidateAvailable !== true
      || original.plaintextWrittenToDisk !== false
      || !exactKeys(observations, SUCCESSOR_STORAGE_OBSERVATION_KEYS)
      || observations.requiredMutationPolicyCount !== 0
      || observations.signedUploadTokenTtlMinutes !== drain.signedUploadTokenTtlMinutes
      || observations.signedUploadGraceMinutes !== drain.signedUploadGraceMinutes
      || observations.storageStabilityWindowMinutes !== drain.storageStabilityWindowMinutes
      || observations.writeFenceReceiptFileName !== writeFence.receiptFileName
      || observations.writeFenceReceiptSha256 !== writeFence.receiptSha256
      || observations.storageDrainStartReceiptSha256 !== drain.startReceiptSha256
      || observations.storageDrainFirstInventoryReceiptSha256
        !== inventories[0].receiptSha256
      || observations.storageDrainFinalInventoryReceiptSha256
        !== inventories[1].receiptSha256
      || observations.originalBytesBackupReceiptSha256 !== original.receiptSha256
      || observations.originalBytesBackupSetId !== original.backupSetId
      || observations.objectInventorySha256 !== original.objectInventorySha256
      || observations.originalBytesManifestSha256
        !== original.originalBytesManifestSha256
      || observations.encryptedBackupArtifactSha256
        !== original.encryptedBackupArtifactSha256
      || observations.originalBytesPrivateRawSha256 !== original.privateRawSha256
      || observations.encryptedBackupArtifactSize !== original.encryptedArtifactSize
      || observations.objectCount !== original.objectCount
      || observations.totalOriginalBytes !== original.totalOriginalBytes) {
    fail();
  }
  return Object.freeze({
    writeFenceReceiptSha256: writeFence.receiptSha256,
    originalBytesBackupReceiptFileName: original.receiptFileName,
    originalBytesBackupReceiptSha256: original.receiptSha256,
    originalBytesBackupSetId: original.backupSetId,
    originalBytesManifestSha256: original.originalBytesManifestSha256,
    objectInventorySha256: original.objectInventorySha256,
    encryptedBackupArtifactSha256: original.encryptedBackupArtifactSha256,
    encryptedBackupArtifactSize: original.encryptedArtifactSize,
    originalBytesPrivateRawSha256: original.privateRawSha256,
    objectCount: original.objectCount,
    totalOriginalBytes: original.totalOriginalBytes,
  });
}

/** Safely reopen the pinned original-byte receipt, private manifest and archive. */
export async function reverifyVendorDisclosureSuccessorStorageOriginalBytesFiles({
  repoRoot,
  receiptPath,
  provenance,
  manifest,
  expectedCommit,
}) {
  if (!isAbsolute(receiptPath ?? "") || inside(repoRoot, receiptPath)) fail();
  const canonicalRepo = await realpath(repoRoot).catch(() => null);
  const root = await realpath(dirname(receiptPath)).catch(() => null);
  const canonicalReceipt = await realpath(receiptPath).catch(() => null);
  if (!canonicalRepo || !root || !canonicalReceipt
      || inside(canonicalRepo, root)
      || dirname(canonicalReceipt) !== root
      || basename(canonicalReceipt)
        !== provenance?.originalBytesBackupReceiptFileName) fail();
  const receiptInput = await readStableFile(canonicalReceipt, 64 * 1024);
  if (!receiptInput.bytes
      || receiptInput.sha256 !== provenance.originalBytesBackupReceiptSha256) fail();
  let receipt;
  try {
    receipt = JSON.parse(receiptInput.bytes.toString("utf8"));
  } catch {
    fail();
  }
  if (!exactKeys(receipt, [
    "backupSetId", "bucketCount", "capturedAt", "containsSecrets",
    "encryptedArtifact", "encryptedBackupArtifactSha256", "kind", "objectCount",
    "objectInventorySha256", "originalBytesManifestSha256", "privateRaw",
    "projectRef", "receiptVersion", "release", "releaseCommit", "restoreRehearsal",
    "sourceInventoryCapturedAt", "totalOriginalBytes", "verifiedAt",
  ])
      || receipt.receiptVersion !== 1
      || receipt.kind !== "successor-storage-original-bytes-backup-verification-v1"
      || receipt.release !== manifest?.release
      || receipt.projectRef !== manifest?.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.backupSetId !== provenance.originalBytesBackupSetId
      || receipt.objectInventorySha256 !== provenance.objectInventorySha256
      || receipt.originalBytesManifestSha256 !== provenance.originalBytesManifestSha256
      || receipt.encryptedBackupArtifactSha256
        !== provenance.encryptedBackupArtifactSha256
      || receipt.objectCount !== provenance.objectCount
      || receipt.totalOriginalBytes !== provenance.totalOriginalBytes
      || receipt.containsSecrets !== false
      || !exactKeys(receipt.encryptedArtifact, ["dev", "fileName", "ino", "sha256", "size"])
      || !exactKeys(receipt.privateRaw, ["dev", "fileName", "ino", "sha256", "size"])
      || !SAFE_ARTIFACT_FILE.test(receipt.encryptedArtifact.fileName ?? "")
      || !SAFE_FILE.test(receipt.privateRaw.fileName ?? "")
      || receipt.encryptedArtifact.sha256 !== provenance.encryptedBackupArtifactSha256
      || receipt.encryptedArtifact.size !== provenance.encryptedBackupArtifactSize
      || receipt.privateRaw.sha256 !== provenance.originalBytesPrivateRawSha256
      || !exactKeys(receipt.restoreRehearsal, [
        "objectCount", "originalBytesManifestSha256", "totalOriginalBytes", "verifiedAt",
      ])
      || receipt.restoreRehearsal.verifiedAt !== receipt.verifiedAt
      || receipt.restoreRehearsal.objectCount !== receipt.objectCount
      || receipt.restoreRehearsal.totalOriginalBytes !== receipt.totalOriginalBytes
      || receipt.restoreRehearsal.originalBytesManifestSha256
        !== receipt.originalBytesManifestSha256) fail();

  const rawPath = join(root, receipt.privateRaw.fileName);
  const artifactPath = join(root, receipt.encryptedArtifact.fileName);
  const [rawInput, artifactInput] = await Promise.all([
    readStableFile(rawPath, 4 * 1024 * 1024, receipt.privateRaw),
    readStableFile(artifactPath, 512 * 1024 * 1024, receipt.encryptedArtifact),
  ]);
  if (!rawInput.bytes
      || rawInput.sha256 !== receipt.privateRaw.sha256
      || artifactInput.sha256 !== receipt.encryptedArtifact.sha256) fail();
  let raw;
  try {
    raw = JSON.parse(rawInput.bytes.toString("utf8"));
  } catch {
    fail();
  }
  if (!exactKeys(raw, [
    "backupSetId", "capturedAt", "containsObjectBytes", "containsObjectIdentifiers",
    "containsObjectPaths", "containsSecrets", "encryptedArtifact", "entries", "kind",
    "objectInventorySha256", "originalBytesManifestSha256", "projectRef",
    "rawEvidenceVersion", "release", "releaseCommit", "sourceInventoryCapturedAt",
    "totalOriginalBytes", "verifiedAt",
  ])
      || raw.rawEvidenceVersion !== 1
      || raw.kind !== "vendor-disclosure-successor-storage-original-bytes-private-v1"
      || raw.release !== receipt.release || raw.projectRef !== receipt.projectRef
      || raw.releaseCommit !== receipt.releaseCommit || raw.backupSetId !== receipt.backupSetId
      || raw.objectInventorySha256 !== receipt.objectInventorySha256
      || raw.originalBytesManifestSha256 !== receipt.originalBytesManifestSha256
      || raw.totalOriginalBytes !== receipt.totalOriginalBytes
      || canonicalJson(raw.encryptedArtifact) !== canonicalJson(receipt.encryptedArtifact)
      || !Array.isArray(raw.entries) || raw.entries.length !== receipt.objectCount
      || raw.containsObjectIdentifiers !== true || raw.containsObjectPaths !== false
      || raw.containsObjectBytes !== false || raw.containsSecrets !== false
      || raw.entries.some((entry) => !exactKeys(entry, [
        "bucketId", "byteSha256", "objectId", "pathSha256", "size",
      ])
        || typeof entry.bucketId !== "string" || entry.bucketId.length < 1
        || !UUID.test(entry.objectId ?? "")
        || !SHA256.test(entry.pathSha256 ?? "")
        || !SHA256.test(entry.byteSha256 ?? "")
        || !validNonnegativeInteger(entry.size))
      || raw.entries.reduce((sum, entry) => sum + entry.size, 0)
        !== receipt.totalOriginalBytes
      || createHash("sha256").update(canonicalJson(raw.entries)).digest("hex")
        !== receipt.originalBytesManifestSha256) fail();
  return Object.freeze({
    receiptSha256: receiptInput.sha256,
    privateRawSha256: rawInput.sha256,
    encryptedBackupArtifactSha256: artifactInput.sha256,
    encryptedBackupArtifactSize: artifactInput.size,
    originalBytesManifestSha256: receipt.originalBytesManifestSha256,
    objectInventorySha256: receipt.objectInventorySha256,
    objectCount: receipt.objectCount,
    totalOriginalBytes: receipt.totalOriginalBytes,
  });
}
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
