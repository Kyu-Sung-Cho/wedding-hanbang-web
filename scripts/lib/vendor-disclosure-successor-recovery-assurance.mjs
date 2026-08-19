import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import {
  SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT,
  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  validateSuccessorNoAdditionalCostReleaseAssurance,
  validateSuccessorReleaseContract,
} from "./supabase-successor-release-contract.mjs";
import {
  validateVendorDisclosureSuccessorHostedStagingEvidenceProvenance,
  writeDurableExclusiveEvidencePair,
} from "./vendor-disclosure-successor-hosted-staging-evidence.mjs";

const execFileAsync = promisify(execFile);
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MIGRATION = /^\d{14}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const SAFE_TABLE = /^[a-z][a-z0-9_]{1,62}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REMOTE_REF = /^origin\/([A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?)$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_RUNTIME_RECEIPT_BYTES = 64 * 1024;
const MAX_RAW_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_IMPLEMENTATION_BYTES = 16 * 1024 * 1024;
const MAX_ENCRYPTED_ARTIFACT_BYTES = 32 * 1024 * 1024 + 1024;
const MAX_DPAPI_KEY_BYTES = 4 * 1024;
const APPROVED_STAGING_PROJECT_REF = "rgxdizztidbgwnsbadml";

const STANDARD_RECEIPT_KEYS = Object.freeze([
  "capturedAt",
  "checks",
  "containsSecrets",
  "expectedMigrationHead",
  "expiresAt",
  "kind",
  "migrationCount",
  "migrationVersionsSha256",
  "observations",
  "postApplyCheckIds",
  "postApplyChecksSha256",
  "projectRef",
  "rawProvenance",
  "receiptVersion",
  "release",
  "releaseCommit",
  "requiredRemoteHead",
  "rollbackContractSha256",
]);
const POST_EXPAND_RECEIPT_KEYS = Object.freeze([
  "authSchemaContractSha256",
  "authUsersContractSha256",
  "backupContractId",
  "backupContractVersion",
  "backupManifestSha256",
  "backupSetId",
  "capturedAt",
  "checks",
  "containsSecrets",
  "expectedMigrationHead",
  "expectedTableContractSha256",
  "expectedTableCount",
  "expectedTables",
  "kind",
  "liveSchemaContractSha256",
  "logicalDataContractSha256",
  "migrationVersionsSha256",
  "projectRef",
  "receiptVersion",
  "release",
  "releaseCommit",
  "sourceDatabaseOid",
  "sourceDatabaseSystemIdentifier",
  "storageMetadataContractSha256",
  "storageObjectInventorySha256",
  "verifiedAt",
]);
const POST_EXPAND_CHECK_KEYS = Object.freeze([
  "authDataDigestsVerified",
  "encryptedArtifactsVerified",
  "exactTableContractVerified",
  "liveSchemaDigestVerified",
  "logicalDataDigestsVerified",
  "plaintextWrittenToDisk",
  "storageDataDigestsVerified",
]);
const POST_EXPAND_FILES = Object.freeze([
  "logical-data.json.hbam2",
  "logical-data.json.key.dpapi",
  "manifest.json",
  "schema-inventory.json.hbam2",
  "schema-inventory.json.key.dpapi",
]);
const POST_EXPAND_IMPLEMENTATION_PATHS = Object.freeze([
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
]);

export class SuccessorRecoveryAssuranceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SuccessorRecoveryAssuranceError";
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new SuccessorRecoveryAssuranceError(code, message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
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

function canonicalTextSha256(value) {
  return sha256(value.replace(/\r\n?/g, "\n"));
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
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

function parseInstant(value, code) {
  if (!ISO_INSTANT.test(value ?? "")) fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(code);
  }
  return milliseconds;
}

function sameFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readStableFile(path, maximumBytes, code) {
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
    return Object.freeze({
      path,
      bytes,
      byteLength: bytes.length,
      sha256: sha256(bytes),
    });
  } catch (error) {
    if (error instanceof SuccessorRecoveryAssuranceError) throw error;
    fail(code);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readStableJson(path, maximumBytes, code) {
  const result = await readStableFile(path, maximumBytes, code);
  try {
    return Object.freeze({ ...result, value: JSON.parse(result.bytes.toString("utf8")) });
  } catch {
    fail(code);
  }
}

async function assertExternalDirectory(repoRoot, path, code) {
  if (!isAbsolute(path ?? "") || inside(repoRoot, path)) fail(code);
  const metadata = await lstat(path).catch(() => null);
  const [canonicalRepo, canonicalPath] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(path).catch(() => null),
  ]);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()
      || !canonicalRepo || !canonicalPath || inside(canonicalRepo, canonicalPath)) {
    fail(code);
  }
  return canonicalPath;
}

async function canonicalExternalFile(repoRoot, path, code) {
  if (!isAbsolute(path ?? "") || inside(repoRoot, path)) fail(code);
  const metadata = await lstat(path).catch(() => null);
  const [canonicalRepo, canonicalPath] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(path).catch(() => null),
  ]);
  if (!metadata?.isFile() || metadata.isSymbolicLink()
      || !canonicalRepo || !canonicalPath || inside(canonicalRepo, canonicalPath)) {
    fail(code);
  }
  return canonicalPath;
}

function containsSecretMaterial(value) {
  let invalid = false;
  const visit = (candidate) => {
    if (invalid || candidate === null || candidate === undefined) return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (typeof candidate === "object") {
      for (const [key, nested] of Object.entries(candidate)) {
        if (!["containsSecrets", "contains_secrets"].includes(key)
            && /(?:password|service[_-]?role|api[_-]?key|access[_-]?token|refresh[_-]?token|management[_-]?token|client[_-]?secret)/i.test(key)) {
          invalid = true;
          return;
        }
        visit(nested);
      }
      return;
    }
    if (typeof candidate === "string"
        && /(?:postgres(?:ql)?:\/\/|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|SUPABASE_SERVICE_ROLE_KEY)/i.test(candidate)) {
      invalid = true;
    }
  };
  visit(value);
  return invalid;
}

async function defaultRunGit(repoRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  });
  return stdout;
}

export async function assertExactPushedRecoveryCommit({
  repoRoot,
  expectedCommit,
  expectedOrigin,
  remoteRef,
  runGit = defaultRunGit,
}) {
  const match = typeof remoteRef === "string" ? remoteRef.match(REMOTE_REF) : null;
  const branch = match?.[1];
  if (!COMMIT.test(expectedCommit ?? "")
      || typeof expectedOrigin !== "string"
      || expectedOrigin.length < 10
      || !branch || branch.includes("..") || branch.includes("//")
      || typeof runGit !== "function") {
    fail("SUCCESSOR_RECOVERY_GIT_INVALID");
  }
  let status;
  let head;
  let upstream;
  let upstreamName;
  let origin;
  let liveRemote;
  try {
    [status, head, upstream, upstreamName, origin, liveRemote] = await Promise.all([
      runGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
      runGit(repoRoot, ["rev-parse", "HEAD"]),
      runGit(repoRoot, ["rev-parse", "--verify", "@{upstream}"]),
      runGit(repoRoot, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
      runGit(repoRoot, ["remote", "get-url", "origin"]),
      runGit(repoRoot, [
        "ls-remote",
        "--exit-code",
        "origin",
        `refs/heads/${branch}`,
      ]),
    ]);
  } catch {
    fail("SUCCESSOR_RECOVERY_GIT_INVALID");
  }
  const remoteFields = String(liveRemote).trim().split(/\s+/);
  if (String(status) !== ""
      || String(head).trim() !== expectedCommit
      || String(upstream).trim() !== expectedCommit
      || String(upstreamName).trim() !== remoteRef
      || String(origin).trim() !== expectedOrigin
      || remoteFields.length !== 2
      || remoteFields[0] !== expectedCommit
      || remoteFields[1] !== `refs/heads/${branch}`) {
    fail("SUCCESSOR_RECOVERY_GIT_INVALID");
  }
  return Object.freeze({
    commit: expectedCommit,
    origin: expectedOrigin,
    remoteRef,
    branch,
    worktreeClean: true,
    upstreamPushed: true,
    liveRemoteVerified: true,
  });
}

function releaseRuntimeBinding(manifest, controllerManifest) {
  const versions = manifest.expandMigrations.map((entry) =>
    String(entry?.file ?? "").slice(0, 14));
  const postApplyCheckIds = controllerManifest.postApplyChecks.map(
    (check) => check?.id,
  );
  if (versions.length < 1
      || versions.some((version, index) => !MIGRATION.test(version)
        || (index > 0 && version <= versions[index - 1]))
      || postApplyCheckIds.length < 1
      || postApplyCheckIds.some((id) => !/^[a-z][a-z0-9-]{2,63}$/.test(id ?? ""))
      || new Set(postApplyCheckIds).size !== postApplyCheckIds.length
      || !controllerManifest.rollbackContract) {
    fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_INVALID");
  }
  return Object.freeze({
    expectedMigrationHead: versions.at(-1),
    migrationCount: versions.length,
    migrationVersionsSha256: textListSha256(versions),
    postApplyCheckIds,
    postApplyChecksSha256: textListSha256(postApplyCheckIds),
    rollbackContractSha256: canonicalJsonSha256(controllerManifest.rollbackContract),
  });
}

function validateEvidenceContract(manifest, name) {
  const expected = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS[name];
  const value = manifest.deploymentEvidence?.[name];
  const extra = name === "recoveryAssurance" ? ["releaseAssurance"] : [];
  if (!expected
      || !exactKeys(value, [
        "kind",
        "maximumAgeMinutes",
        "rawEvidenceFileName",
        "rawEvidenceSource",
        "receiptFileName",
        "requiredChecks",
        ...extra,
      ])
      || value.kind !== expected.kind
      || value.maximumAgeMinutes !== expected.maximumAgeMinutes
      || value.rawEvidenceSource !== expected.rawEvidenceSource
      || !exactArray(value.requiredChecks, expected.requiredChecks)
      || !/^[a-z0-9][a-z0-9_.-]{2,160}\.json$/.test(value.rawEvidenceFileName ?? "")
      || !/^[a-z0-9][a-z0-9_.-]{2,160}\.json$/.test(value.receiptFileName ?? "")
      || basename(value.rawEvidenceFileName) !== value.rawEvidenceFileName
      || basename(value.receiptFileName) !== value.receiptFileName
      || value.rawEvidenceFileName === value.receiptFileName
      || !value.rawEvidenceFileName.startsWith(`${manifest.release}-`)
      || !value.receiptFileName.startsWith(`${manifest.release}-`)) {
    fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_INVALID");
  }
  if (name === "recoveryAssurance") {
    try {
      validateSuccessorNoAdditionalCostReleaseAssurance(value.releaseAssurance);
    } catch {
      fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_INVALID");
    }
  }
  return value;
}

async function validateReleaseState({ repoRoot, releaseLoader }) {
  let state;
  try {
    state = await releaseLoader({ repoRoot });
  } catch {
    fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_INVALID");
  }
  const { manifest, controllerManifest } = state ?? {};
  if (state?.controllerReady !== true
      || state?.deploymentBlocked === true
      || manifest?.status !== "controller_ready"
      || manifest?.release !== controllerManifest?.release
      || manifest?.projectRef !== controllerManifest?.projectRef
      || !PROJECT_REF.test(manifest?.projectRef ?? "")
      || !MIGRATION.test(manifest?.requiredRemoteHead ?? "")
      || !Array.isArray(manifest?.expandMigrations)
      || !Array.isArray(controllerManifest?.postApplyChecks)
      || controllerManifest?.backupContract?.id
        !== `pre-${manifest?.release}-current-remote-backup`
      || controllerManifest?.backupContract?.version !== 2
      || controllerManifest?.backupContract?.format
        !== "hbam2-encrypted-current-user"
      || controllerManifest?.backupContract?.expectedMigrationHead
        !== manifest.requiredRemoteHead
      || typeof controllerManifest.backupContract.expectedOrigin !== "string"
      || controllerManifest?.postExpandBackupContract?.id
        !== `post-${manifest.release}-backup`
      || controllerManifest?.postExpandBackupContract?.version !== 2) {
    fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_INVALID");
  }
  const recoveryController = controllerManifest.recoveryAssuranceContract;
  if (!exactKeys(
    recoveryController,
    Object.keys(SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT),
  )
      || canonicalJsonSha256(recoveryController)
        !== canonicalJsonSha256(SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT)) {
    fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_INVALID");
  }
  const backup = controllerManifest.backupContract;
  const postExpand = controllerManifest.postExpandBackupContract;
  if (!Array.isArray(backup.expectedTables)
      || backup.expectedTables.length < 1
      || backup.expectedTables.some((table) => !SAFE_TABLE.test(table))
      || !exactArray(backup.expectedTables, [...backup.expectedTables].sort())
      || new Set(backup.expectedTables).size !== backup.expectedTables.length
      || backup.expectedTableCount !== backup.expectedTables.length
      || backup.expectedTableContractSha256 !== textListSha256(backup.expectedTables)
      || backup.providerPhysicalBackup?.requirePhysicalBackup !== true
      || backup.providerPhysicalBackup?.requiredStatus !== "COMPLETED"
      || backup.providerPhysicalBackup?.restoreCapability
        !== "completed-physical-backup"
      || !Number.isSafeInteger(backup.providerPhysicalBackup?.maximumAgeHours)
      || backup.providerPhysicalBackup.maximumAgeHours < 1
      || !exactArray(
        postExpand.expectedReleaseMigrationVersions,
        manifest.expandMigrations.map((entry) => entry.file.slice(0, 14)),
      )
      || postExpand.expectedReleaseMigrationHead
        !== postExpand.expectedReleaseMigrationVersions.at(-1)
      || postExpand.expectedReleaseMigrationContractSha256
        !== textListSha256(postExpand.expectedReleaseMigrationVersions)
      || !Array.isArray(postExpand.expectedTables)
      || !exactArray(postExpand.expectedTables, [...postExpand.expectedTables].sort())
      || postExpand.expectedTableCount !== postExpand.expectedTables.length
      || postExpand.expectedTableContractSha256
        !== textListSha256(postExpand.expectedTables)
      || !Number.isSafeInteger(postExpand.maximumAgeMinutes)
      || postExpand.maximumAgeMinutes < 1) {
    fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_INVALID");
  }
  const evidence = Object.freeze({
    backup: validateEvidenceContract(manifest, "backup"),
    hostedStaging: validateEvidenceContract(manifest, "hostedStaging"),
    recoveryAssurance: validateEvidenceContract(manifest, "recoveryAssurance"),
  });
  return Object.freeze({
    manifest,
    controllerManifest,
    backup,
    postExpand,
    evidence,
    binding: releaseRuntimeBinding(manifest, controllerManifest),
  });
}

function validateStandardReceipt({
  input,
  rawInput,
  contract,
  manifest,
  binding,
  expectedCommit,
  nowMs,
  code,
}) {
  const receipt = input.value;
  const capturedAtMs = parseInstant(receipt?.capturedAt, code);
  const expiresAtMs = parseInstant(receipt?.expiresAt, code);
  if (!exactKeys(receipt, STANDARD_RECEIPT_KEYS)
      || receipt.receiptVersion !== 1
      || receipt.kind !== contract.kind
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.requiredRemoteHead !== manifest.requiredRemoteHead
      || receipt.expectedMigrationHead !== binding.expectedMigrationHead
      || receipt.migrationCount !== binding.migrationCount
      || receipt.migrationVersionsSha256 !== binding.migrationVersionsSha256
      || !exactArray(receipt.postApplyCheckIds, binding.postApplyCheckIds)
      || receipt.postApplyChecksSha256 !== binding.postApplyChecksSha256
      || receipt.rollbackContractSha256 !== binding.rollbackContractSha256
      || receipt.containsSecrets !== false
      || capturedAtMs > nowMs + 60_000
      || expiresAtMs - capturedAtMs !== contract.maximumAgeMinutes * 60_000
      || !exactKeys(receipt.checks, contract.requiredChecks)
      || contract.requiredChecks.some((check) => receipt.checks[check] !== true)
      || !exactKeys(receipt.rawProvenance, [
        "capturedAt",
        "fileName",
        "sha256",
        "source",
      ])
      || receipt.rawProvenance.fileName !== contract.rawEvidenceFileName
      || receipt.rawProvenance.sha256 !== rawInput.sha256
      || receipt.rawProvenance.capturedAt !== receipt.capturedAt
      || receipt.rawProvenance.source !== contract.rawEvidenceSource
      || rawInput.value?.containsSecrets !== false
      || containsSecretMaterial(receipt)
      || containsSecretMaterial(rawInput.value)) {
    fail(code);
  }
  return Object.freeze({
    receipt,
    receiptSha256: input.sha256,
    raw: rawInput.value,
    rawSha256: rawInput.sha256,
    capturedAtMs,
    expiresAtMs,
  });
}

async function loadRuntimeEvidencePair({
  receiptRoot,
  contract,
  manifest,
  binding,
  expectedCommit,
  nowMs,
  code,
}) {
  const receiptPath = resolve(receiptRoot, contract.receiptFileName);
  const rawPath = resolve(receiptRoot, contract.rawEvidenceFileName);
  if (dirname(receiptPath) !== receiptRoot || dirname(rawPath) !== receiptRoot) {
    fail(code);
  }
  const [input, rawInput] = await Promise.all([
    readStableJson(receiptPath, MAX_RUNTIME_RECEIPT_BYTES, code),
    readStableJson(rawPath, MAX_RAW_EVIDENCE_BYTES, code),
  ]);
  return {
    ...validateStandardReceipt({
      input,
      rawInput,
      contract,
      manifest,
      binding,
      expectedCommit,
      nowMs,
      code,
    }),
    paths: Object.freeze([input, rawInput]),
  };
}

function validateBackupEvidence({ evidence, backup, manifest, expectedCommit, nowMs }) {
  const receipt = evidence.receipt;
  const raw = evidence.raw;
  const logical = raw?.logicalBackup;
  const provider = raw?.providerPhysicalBackup;
  const providerLatestMs = Number.isSafeInteger(provider?.latestPhysicalBackupDateUnix)
    ? provider.latestPhysicalBackupDateUnix * 1_000
    : Number.NaN;
  const providerInsertedAtMs = Date.parse(provider?.insertedAt ?? "");
  const providerAgeAtCapture = Math.floor(
    (evidence.capturedAtMs - providerLatestMs) / 1_000,
  );
  const providerAgeAtRecovery = Math.floor((nowMs - providerLatestMs) / 1_000);
  if (!exactKeys(receipt.observations, [
    "backupContractId",
    "backupContractVersion",
    "expectedMigrationHead",
    "expectedTableContractSha256",
    "expectedTableCount",
    "providerPhysicalBackupStatus",
    "restoreCandidateAvailable",
  ])
      || receipt.observations.backupContractId !== backup.id
      || receipt.observations.backupContractVersion !== backup.version
      || receipt.observations.expectedMigrationHead !== backup.expectedMigrationHead
      || receipt.observations.expectedTableContractSha256
        !== backup.expectedTableContractSha256
      || receipt.observations.expectedTableCount !== backup.expectedTableCount
      || receipt.observations.providerPhysicalBackupStatus
        !== backup.providerPhysicalBackup.requiredStatus
      || receipt.observations.restoreCandidateAvailable !== true
      || raw?.rawEvidenceVersion !== 1
      || raw?.kind !== "vendor-disclosure-successor-backup-raw-v1"
      || raw?.release !== manifest.release
      || raw?.projectRef !== manifest.projectRef
      || raw?.releaseCommit !== expectedCommit
      || raw?.capturedAt !== receipt.capturedAt
      || logical?.backupContractId !== backup.id
      || logical?.backupContractVersion !== backup.version
      || logical?.sourceMigrationHead !== backup.expectedMigrationHead
      || logical?.expectedTableCount !== backup.expectedTableCount
      || !exactArray(logical?.expectedTables, backup.expectedTables)
      || logical?.expectedTableContractSha256 !== backup.expectedTableContractSha256
      || !SHA256.test(logical?.liveSchemaContractSha256 ?? "")
      || !SHA256.test(logical?.logicalDataContractSha256 ?? "")
      || logical?.encryptedArtifactsVerified !== true
      || logical?.sourceCanonicalDigestsVerified !== true
      || logical?.pgliteJsonbRoundTripVerified !== true
      || logical?.plaintextWrittenToDisk !== false
      || provider?.status !== backup.providerPhysicalBackup.requiredStatus
      || provider?.isPhysicalBackup !== backup.providerPhysicalBackup.requirePhysicalBackup
      || provider?.restoreCapability !== backup.providerPhysicalBackup.restoreCapability
      || provider?.restoreCandidateAvailable !== true
      || !Number.isFinite(providerLatestMs)
      || !Number.isFinite(providerInsertedAtMs)
      || Math.abs(providerInsertedAtMs - providerLatestMs) > 15 * 60_000
      || provider?.ageSeconds !== providerAgeAtCapture
      || providerAgeAtCapture < 0
      || providerAgeAtRecovery < 0
      || providerAgeAtRecovery
        > backup.providerPhysicalBackup.maximumAgeHours * 60 * 60) {
    fail("SUCCESSOR_RECOVERY_BACKUP_EVIDENCE_INVALID");
  }
  return Object.freeze({
    ...evidence,
    backupContractId: backup.id,
    providerPhysicalBackupStatus: provider.status,
    providerLatestPhysicalBackupDateUnix: provider.latestPhysicalBackupDateUnix,
    providerAgeSecondsAtRecovery: providerAgeAtRecovery,
    liveSchemaContractSha256: logical.liveSchemaContractSha256,
    logicalDataContractSha256: logical.logicalDataContractSha256,
  });
}

async function validateHostedStagingEvidence({
  evidence,
  repoRoot,
  manifest,
  controllerManifest,
  binding,
  expectedCommit,
  remoteRef,
  nowMs,
}) {
  const receipt = evidence.receipt;
  const raw = evidence.raw;
  const observations = receipt.observations;
  const stagingContract = raw?.approvedStagingContract?.contract;
  if (!exactKeys(observations, [
    "expectedMigrationHead",
    "migrationCount",
    "migrationVersionsSha256",
    "requiredRemoteHead",
    "rollbackStrategy",
  ])
      || observations.expectedMigrationHead !== binding.expectedMigrationHead
      || observations.migrationCount !== binding.migrationCount
      || observations.migrationVersionsSha256 !== binding.migrationVersionsSha256
      || observations.requiredRemoteHead !== manifest.requiredRemoteHead
      || observations.rollbackStrategy !== controllerManifest.rollbackContract.strategy
      || raw?.rawEvidenceVersion !== 1
      || raw?.kind !== "vendor-disclosure-successor-hosted-staging-raw-v1"
      || raw?.release !== manifest.release
      || raw?.productionProjectRef !== manifest.projectRef
      || raw?.stagingProjectRef !== APPROVED_STAGING_PROJECT_REF
      || raw.stagingProjectRef === raw.productionProjectRef
      || raw?.releaseCommit !== expectedCommit
      || raw?.capturedAt !== receipt.capturedAt
      || raw?.gitBinding?.origin !== controllerManifest.backupContract.expectedOrigin
      || raw?.gitBinding?.remoteRef !== remoteRef
      || raw?.gitBinding?.commit !== expectedCommit
      || stagingContract?.productionProjectRef !== manifest.projectRef
      || stagingContract?.projectRef !== APPROVED_STAGING_PROJECT_REF
      || raw?.migrationContract?.expectedMigrationHead !== binding.expectedMigrationHead
      || raw?.migrationContract?.migrationCount !== binding.migrationCount
      || raw?.migrationContract?.migrationVersionsSha256
        !== binding.migrationVersionsSha256
      || raw?.migrationContract?.requiredRemoteHead !== manifest.requiredRemoteHead
      || !exactKeys(
        raw?.checkEvidence,
        SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.hostedStaging.requiredChecks,
      )) {
    fail("SUCCESSOR_RECOVERY_HOSTED_STAGING_EVIDENCE_INVALID");
  }
  try {
    await validateVendorDisclosureSuccessorHostedStagingEvidenceProvenance({
      repoRoot,
      receipt,
      raw,
      manifest,
      controllerManifest,
      expectedCommit,
      remoteRef,
      now: () => new Date(nowMs),
    });
  } catch {
    fail("SUCCESSOR_RECOVERY_HOSTED_STAGING_EVIDENCE_INVALID");
  }
  return Object.freeze({
    ...evidence,
    stagingProjectRef: raw.stagingProjectRef,
  });
}

async function validatePinnedPostExpandImplementation({
  repoRoot,
  backupManifest,
  contract,
  expectedCommit,
}) {
  const implementation = backupManifest.implementation;
  if (!exactKeys(implementation, ["files", "git_blobs", "git_commit"])
      || implementation.git_commit !== expectedCommit
      || !exactKeys(implementation.files, POST_EXPAND_IMPLEMENTATION_PATHS)
      || !exactKeys(implementation.git_blobs, POST_EXPAND_IMPLEMENTATION_PATHS)) {
    fail("SUCCESSOR_RECOVERY_POST_EXPAND_IMPLEMENTATION_INVALID");
  }
  const stableFiles = [];
  for (const relativePath of POST_EXPAND_IMPLEMENTATION_PATHS) {
    const path = resolve(repoRoot, relativePath);
    if (!inside(repoRoot, path)
        || inside(resolve(repoRoot, "scripts", "tests"), path)) {
      fail("SUCCESSOR_RECOVERY_POST_EXPAND_IMPLEMENTATION_INVALID");
    }
    const stable = await readStableFile(
      path,
      MAX_IMPLEMENTATION_BYTES,
      "SUCCESSOR_RECOVERY_POST_EXPAND_IMPLEMENTATION_INVALID",
    );
    if (stable.sha256 !== implementation.files[relativePath]
        || stable.sha256 !== implementation.git_blobs[relativePath]) {
      fail("SUCCESSOR_RECOVERY_POST_EXPAND_IMPLEMENTATION_INVALID");
    }
    stableFiles.push(stable);
  }
  for (const pin of [contract.common, contract.capture, contract.verifier]) {
    const stable = stableFiles.find((candidate) =>
      candidate.path === resolve(repoRoot, pin?.file ?? ""));
    if (!stable || !SHA256.test(pin?.sha256 ?? "")
        || canonicalTextSha256(stable.bytes.toString("utf8")) !== pin.sha256) {
      fail("SUCCESSOR_RECOVERY_POST_EXPAND_IMPLEMENTATION_INVALID");
    }
  }
  return stableFiles;
}

async function validatePostExpandBackup({
  repoRoot,
  receiptPath,
  backupDirectory,
  manifest,
  controllerManifest,
  contract,
  expectedCommit,
  remoteRef,
  nowMs,
}) {
  const canonicalReceipt = await canonicalExternalFile(
    repoRoot,
    receiptPath,
    "SUCCESSOR_RECOVERY_POST_EXPAND_RECEIPT_INVALID",
  );
  const receiptInput = await readStableJson(
    canonicalReceipt,
    MAX_RUNTIME_RECEIPT_BYTES,
    "SUCCESSOR_RECOVERY_POST_EXPAND_RECEIPT_INVALID",
  );
  const receipt = receiptInput.value;
  const capturedAtMs = parseInstant(
    receipt?.capturedAt,
    "SUCCESSOR_RECOVERY_POST_EXPAND_RECEIPT_INVALID",
  );
  const verifiedAtMs = parseInstant(
    receipt?.verifiedAt,
    "SUCCESSOR_RECOVERY_POST_EXPAND_RECEIPT_INVALID",
  );
  if (!exactKeys(receipt, POST_EXPAND_RECEIPT_KEYS)
      || receipt.receiptVersion !== 2
      || receipt.kind !== "successor-post-expand-backup-verification-v2"
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.backupContractId !== contract.id
      || receipt.backupContractVersion !== contract.version
      || !UUID.test(receipt.backupSetId ?? "")
      || basename(canonicalReceipt)
        !== `${receipt.backupSetId}-successor-post-expand-backup-verification-v2.json`
      || !SHA256.test(receipt.backupManifestSha256 ?? "")
      || !/^[1-9]\d{0,9}$/.test(receipt.sourceDatabaseOid ?? "")
      || !/^\d{10,32}$/.test(receipt.sourceDatabaseSystemIdentifier ?? "")
      || receipt.expectedMigrationHead !== contract.expectedReleaseMigrationHead
      || receipt.migrationVersionsSha256
        !== contract.expectedReleaseMigrationContractSha256
      || receipt.expectedTableCount !== contract.expectedTableCount
      || !exactArray(receipt.expectedTables, contract.expectedTables)
      || receipt.expectedTableContractSha256 !== contract.expectedTableContractSha256
      || ![
        receipt.liveSchemaContractSha256,
        receipt.logicalDataContractSha256,
        receipt.authSchemaContractSha256,
        receipt.authUsersContractSha256,
        receipt.storageMetadataContractSha256,
        receipt.storageObjectInventorySha256,
      ].every((digest) => SHA256.test(digest ?? ""))
      || !exactKeys(receipt.checks, POST_EXPAND_CHECK_KEYS)
      || POST_EXPAND_CHECK_KEYS.some((key) => (
        key === "plaintextWrittenToDisk"
          ? receipt.checks[key] !== false
          : receipt.checks[key] !== true
      ))
      || receipt.containsSecrets !== false
      || capturedAtMs > verifiedAtMs
      || verifiedAtMs > nowMs + 60_000
      || nowMs - verifiedAtMs > contract.maximumAgeMinutes * 60_000
      || containsSecretMaterial(receipt)) {
    fail("SUCCESSOR_RECOVERY_POST_EXPAND_RECEIPT_INVALID");
  }

  const canonicalDirectory = await assertExternalDirectory(
    repoRoot,
    backupDirectory,
    "SUCCESSOR_RECOVERY_POST_EXPAND_DIRECTORY_INVALID",
  );
  if (dirname(canonicalDirectory) !== dirname(canonicalReceipt)
      || !/^post-expand-\d{8}-\d{6}-[a-f0-9]{32}$/.test(
        basename(canonicalDirectory),
      )) {
    fail("SUCCESSOR_RECOVERY_POST_EXPAND_DIRECTORY_INVALID");
  }
  const entries = await readdir(canonicalDirectory, { withFileTypes: true })
    .catch(() => []);
  if (!exactArray(entries.map((entry) => entry.name).sort(), POST_EXPAND_FILES)
      || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail("SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID");
  }

  const manifestInput = await readStableJson(
    join(canonicalDirectory, "manifest.json"),
    MAX_MANIFEST_BYTES,
    "SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID",
  );
  const backupManifest = manifestInput.value;
  const sourceIdentity = backupManifest?.source_database_identity;
  const cliPath = backupManifest?.supabase_cli?.invocation_relative_path;
  const tableNames = backupManifest?.tables
    && typeof backupManifest.tables === "object"
    && !Array.isArray(backupManifest.tables)
    ? Object.keys(backupManifest.tables)
    : [];
  if (manifestInput.sha256 !== receipt.backupManifestSha256
      || backupManifest?.status !== "complete"
      || backupManifest?.format
        !== "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser"
      || backupManifest?.format_version !== 2
      || backupManifest?.backup_type
        !== "vendor-disclosure-successor-post-expand-logical-snapshot-v2"
      || backupManifest?.backup_set_id !== receipt.backupSetId
      || backupManifest?.release !== manifest.release
      || backupManifest?.backup_contract_id !== contract.id
      || backupManifest?.backup_contract_version !== contract.version
      || parseInstant(
        backupManifest?.created_at_utc,
        "SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID",
      ) < capturedAtMs
      || backupManifest?.source_captured_at !== receipt.capturedAt
      || backupManifest?.source_project_ref !== manifest.projectRef
      || sourceIdentity?.database_oid !== receipt.sourceDatabaseOid
      || sourceIdentity?.system_identifier !== receipt.sourceDatabaseSystemIdentifier
      || backupManifest?.source_migration_head
        !== contract.expectedReleaseMigrationHead
      || !Number.isSafeInteger(backupManifest?.source_migration_count)
      || backupManifest.source_migration_count
        < contract.expectedReleaseMigrationVersions.length
      || backupManifest?.release_migration_count
        !== contract.expectedReleaseMigrationVersions.length
      || backupManifest?.release_migration_versions_sha256
        !== contract.expectedReleaseMigrationContractSha256
      || backupManifest?.table_count !== contract.expectedTableCount
      || !exactArray(backupManifest?.expected_tables, contract.expectedTables)
      || !exactArray(tableNames, contract.expectedTables)
      || backupManifest?.table_contract_sha256
        !== receipt.expectedTableContractSha256
      || backupManifest?.live_schema_contract_sha256
        !== receipt.liveSchemaContractSha256
      || backupManifest?.logical_data_contract_sha256
        !== receipt.logicalDataContractSha256
      || backupManifest?.auth_schema_contract_sha256
        !== receipt.authSchemaContractSha256
      || backupManifest?.auth_users_contract_sha256
        !== receipt.authUsersContractSha256
      || backupManifest?.storage_metadata_contract_sha256
        !== receipt.storageMetadataContractSha256
      || backupManifest?.storage_object_inventory_sha256
        !== receipt.storageObjectInventorySha256
      || backupManifest?.git_commit !== expectedCommit
      || backupManifest?.git_origin !== controllerManifest.backupContract.expectedOrigin
      || backupManifest?.git_remote_ref !== remoteRef
      || backupManifest?.plaintext_written_to_disk !== false
      || backupManifest?.contains_secrets !== false
      || backupManifest?.supabase_cli?.version
        !== controllerManifest.backupContract.supabaseCli.version
      || typeof cliPath !== "string"
      || String(backupManifest?.supabase_cli?.files?.[cliPath] ?? "")
        .toUpperCase()
        !== controllerManifest.backupContract.supabaseCli.binarySha256
      || containsSecretMaterial(backupManifest)) {
    fail("SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID");
  }

  const implementationInputs = await validatePinnedPostExpandImplementation({
    repoRoot,
    backupManifest,
    contract,
    expectedCommit,
  });
  if (!exactKeys(backupManifest.artifacts, ["logical_data", "schema_inventory"])) {
    fail("SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID");
  }
  const reopenedInputs = [receiptInput, manifestInput, ...implementationInputs];
  const reopenEvidence = [];
  for (const [name, artifactFile, keyFile] of [
    ["logical_data", "logical-data.json.hbam2", "logical-data.json.key.dpapi"],
    ["schema_inventory", "schema-inventory.json.hbam2", "schema-inventory.json.key.dpapi"],
  ]) {
    const artifact = backupManifest.artifacts[name];
    if (!exactKeys(artifact, [
      "artifact",
      "backup_set_id",
      "encrypted_bytes",
      "encrypted_sha256",
      "key",
      "key_sha256",
      "plaintext_bytes",
      "plaintext_sha256",
    ])
        || artifact.backup_set_id !== receipt.backupSetId
        || artifact.artifact !== artifactFile
        || artifact.key !== keyFile
        || !SHA256.test(artifact.plaintext_sha256 ?? "")
        || !SHA256.test(artifact.encrypted_sha256 ?? "")
        || !SHA256.test(artifact.key_sha256 ?? "")
        || !Number.isSafeInteger(artifact.plaintext_bytes)
        || artifact.plaintext_bytes < 1
        || artifact.plaintext_bytes > MAX_ENCRYPTED_ARTIFACT_BYTES
        || !Number.isSafeInteger(artifact.encrypted_bytes)
        || artifact.encrypted_bytes < 1
        || artifact.encrypted_bytes > MAX_ENCRYPTED_ARTIFACT_BYTES) {
      fail("SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID");
    }
    const [artifactInput, keyInput] = await Promise.all([
      readStableFile(
        join(canonicalDirectory, artifactFile),
        MAX_ENCRYPTED_ARTIFACT_BYTES,
        "SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID",
      ),
      readStableFile(
        join(canonicalDirectory, keyFile),
        MAX_DPAPI_KEY_BYTES,
        "SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID",
      ),
    ]);
    if (artifactInput.sha256 !== artifact.encrypted_sha256
        || artifactInput.byteLength !== artifact.encrypted_bytes
        || keyInput.sha256 !== artifact.key_sha256) {
      fail("SUCCESSOR_RECOVERY_POST_EXPAND_ARTIFACT_INVALID");
    }
    reopenedInputs.push(artifactInput, keyInput);
    reopenEvidence.push(
      `${name}:${artifactInput.sha256}:${artifactInput.byteLength}:${keyInput.sha256}:${keyInput.byteLength}`,
    );
  }
  const artifactReverificationSha256 = sha256(
    `${[
      "successor-post-expand-backup-artifact-reopen-v1",
      receiptInput.sha256,
      manifestInput.sha256,
      ...reopenEvidence,
    ].join("\n")}\n`,
  );
  return Object.freeze({
    receipt,
    receiptPath: canonicalReceipt,
    receiptSha256: receiptInput.sha256,
    manifestSha256: manifestInput.sha256,
    artifactReverificationSha256,
    liveSchemaContractSha256: receipt.liveSchemaContractSha256,
    logicalDataContractSha256: receipt.logicalDataContractSha256,
    backupContractId: receipt.backupContractId,
    backupSetId: receipt.backupSetId,
    verifiedAt: receipt.verifiedAt,
    verifiedAtMs,
    encryptedArtifactsVerified: true,
    pgliteJsonbRoundTripVerified: true,
    reopenedInputs: Object.freeze(reopenedInputs),
  });
}

async function assertInputsUnchanged(inputs) {
  for (const expected of inputs) {
    const current = await readStableFile(
      expected.path,
      Math.max(expected.byteLength, 2),
      "SUCCESSOR_RECOVERY_INPUT_CHANGED",
    );
    if (current.sha256 !== expected.sha256
        || current.byteLength !== expected.byteLength) {
      fail("SUCCESSOR_RECOVERY_INPUT_CHANGED");
    }
  }
}

export async function emitVendorDisclosureSuccessorRecoveryAssurance({
  repoRoot,
  receiptRoot,
  expectedCommit,
  remoteRef,
  postExpandBackupReceiptPath,
  postExpandBackupDirectory,
  now = () => new Date(),
  runGit = defaultRunGit,
  releaseLoader = validateSuccessorReleaseContract,
  durableWriter = writeDurableExclusiveEvidencePair,
}) {
  if (typeof repoRoot !== "string" || typeof receiptRoot !== "string"
      || !COMMIT.test(expectedCommit ?? "")
      || typeof remoteRef !== "string"
      || typeof postExpandBackupReceiptPath !== "string"
      || typeof postExpandBackupDirectory !== "string"
      || typeof now !== "function" || typeof runGit !== "function"
      || typeof releaseLoader !== "function" || typeof durableWriter !== "function") {
    fail("SUCCESSOR_RECOVERY_ARGUMENT_INVALID");
  }
  const root = resolve(repoRoot);
  const capturedAt = now();
  const nowMs = capturedAt instanceof Date ? capturedAt.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) fail("SUCCESSOR_RECOVERY_CLOCK_INVALID");

  const state = await validateReleaseState({ repoRoot: root, releaseLoader });
  const releaseStateSha256 = canonicalJsonSha256({
    controllerManifest: state.controllerManifest,
    manifest: state.manifest,
  });
  const outputRoot = await assertExternalDirectory(
    root,
    receiptRoot,
    "SUCCESSOR_RECOVERY_OUTPUT_ROOT_INVALID",
  );
  const recoveryContract = state.evidence.recoveryAssurance;
  const rawPath = resolve(outputRoot, recoveryContract.rawEvidenceFileName);
  const receiptPath = resolve(outputRoot, recoveryContract.receiptFileName);
  if (dirname(rawPath) !== outputRoot || dirname(receiptPath) !== outputRoot
      || await lstat(rawPath).catch(() => null)
      || await lstat(receiptPath).catch(() => null)) {
    fail("SUCCESSOR_RECOVERY_OUTPUT_COLLISION");
  }

  const gitBinding = await assertExactPushedRecoveryCommit({
    repoRoot: root,
    expectedCommit,
    expectedOrigin: state.backup.expectedOrigin,
    remoteRef,
    runGit,
  });
  const [backupPair, hostedStagingPair] = await Promise.all([
    loadRuntimeEvidencePair({
      receiptRoot: outputRoot,
      contract: state.evidence.backup,
      manifest: state.manifest,
      binding: state.binding,
      expectedCommit,
      nowMs,
      code: "SUCCESSOR_RECOVERY_BACKUP_EVIDENCE_INVALID",
    }),
    loadRuntimeEvidencePair({
      receiptRoot: outputRoot,
      contract: state.evidence.hostedStaging,
      manifest: state.manifest,
      binding: state.binding,
      expectedCommit,
      nowMs,
      code: "SUCCESSOR_RECOVERY_HOSTED_STAGING_EVIDENCE_INVALID",
    }),
  ]);
  const backup = validateBackupEvidence({
    evidence: backupPair,
    backup: state.backup,
    manifest: state.manifest,
    expectedCommit,
    nowMs,
  });
  const hostedStaging = await validateHostedStagingEvidence({
    evidence: hostedStagingPair,
    repoRoot: root,
    manifest: state.manifest,
    controllerManifest: state.controllerManifest,
    binding: state.binding,
    expectedCommit,
    remoteRef,
    nowMs,
  });
  const postExpand = await validatePostExpandBackup({
    repoRoot: root,
    receiptPath: postExpandBackupReceiptPath,
    backupDirectory: postExpandBackupDirectory,
    manifest: state.manifest,
    controllerManifest: state.controllerManifest,
    contract: state.postExpand,
    expectedCommit,
    remoteRef,
    nowMs,
  });
  if (postExpand.verifiedAtMs < backup.capturedAtMs
      || postExpand.verifiedAtMs < hostedStaging.capturedAtMs) {
    fail("SUCCESSOR_RECOVERY_EVIDENCE_ORDER_INVALID");
  }

  const releaseAssurance = validateSuccessorNoAdditionalCostReleaseAssurance(
    SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  );
  const observations = {
    backupContractId: state.backup.id,
    hostedStagingRawEvidenceSha256: hostedStaging.rawSha256,
    hostedStagingReceiptSha256: hostedStaging.receiptSha256,
    postExpandBackupContractId: state.postExpand.id,
    postExpandBackupManifestSha256: postExpand.manifestSha256,
    postExpandBackupReceiptSha256: postExpand.receiptSha256,
    postExpandBackupReverificationSha256:
      postExpand.artifactReverificationSha256,
    postExpandEncryptedArtifactsVerified: true,
    postExpandLiveSchemaContractSha256:
      postExpand.liveSchemaContractSha256,
    postExpandLogicalDataContractSha256:
      postExpand.logicalDataContractSha256,
    postExpandPGliteJsonbRoundTripVerified: true,
    preApplyBackupRawEvidenceSha256: backup.rawSha256,
    preApplyBackupReceiptSha256: backup.receiptSha256,
    providerPhysicalBackupStatus: backup.providerPhysicalBackupStatus,
  };
  const capturedAtText = capturedAt.toISOString();
  const raw = {
    rawEvidenceVersion: 1,
    kind: "vendor-disclosure-successor-recovery-assurance-raw-v1",
    release: state.manifest.release,
    projectRef: state.manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt: capturedAtText,
    gitBinding,
    releaseAssurance,
    releaseContract: {
      releaseStateSha256,
      requiredRemoteHead: state.manifest.requiredRemoteHead,
      expectedMigrationHead: state.binding.expectedMigrationHead,
      migrationCount: state.binding.migrationCount,
      migrationVersionsSha256: state.binding.migrationVersionsSha256,
      postApplyCheckIds: state.binding.postApplyCheckIds,
      postApplyChecksSha256: state.binding.postApplyChecksSha256,
      rollbackContractSha256: state.binding.rollbackContractSha256,
    },
    preApplyBackup: {
      receiptFileName: state.evidence.backup.receiptFileName,
      receiptSha256: backup.receiptSha256,
      rawEvidenceFileName: state.evidence.backup.rawEvidenceFileName,
      rawEvidenceSha256: backup.rawSha256,
      backupContractId: backup.backupContractId,
      expectedTableCount: state.backup.expectedTableCount,
      expectedTableContractSha256: state.backup.expectedTableContractSha256,
      providerPhysicalBackupStatus: backup.providerPhysicalBackupStatus,
      providerLatestPhysicalBackupDateUnix:
        backup.providerLatestPhysicalBackupDateUnix,
      providerAgeSecondsAtRecovery: backup.providerAgeSecondsAtRecovery,
      liveSchemaContractSha256: backup.liveSchemaContractSha256,
      logicalDataContractSha256: backup.logicalDataContractSha256,
    },
    hostedStaging: {
      receiptFileName: state.evidence.hostedStaging.receiptFileName,
      receiptSha256: hostedStaging.receiptSha256,
      rawEvidenceFileName: state.evidence.hostedStaging.rawEvidenceFileName,
      rawEvidenceSha256: hostedStaging.rawSha256,
      stagingProjectRef: hostedStaging.stagingProjectRef,
      productionProjectRef: state.manifest.projectRef,
    },
    postExpandEncryptedBackup: {
      receiptFileName: basename(postExpand.receiptPath),
      receiptSha256: postExpand.receiptSha256,
      backupContractId: postExpand.backupContractId,
      backupSetIdSha256: sha256(postExpand.backupSetId),
      expectedMigrationHead: state.postExpand.expectedReleaseMigrationHead,
      expectedTableCount: state.postExpand.expectedTableCount,
      expectedTableContractSha256:
        state.postExpand.expectedTableContractSha256,
      manifestSha256: postExpand.manifestSha256,
      artifactReverificationSha256: postExpand.artifactReverificationSha256,
      liveSchemaContractSha256: postExpand.liveSchemaContractSha256,
      logicalDataContractSha256: postExpand.logicalDataContractSha256,
      encryptedArtifactsVerified: true,
      pgliteJsonbRoundTripVerified: true,
      pgliteClaimDerivation:
        "exact-pinned-successor-post-expand-v2-verifier-and-artifact-contract",
    },
    containsSecrets: false,
  };
  const rawText = `${JSON.stringify(raw, null, 2)}\n`;
  const receipt = {
    receiptVersion: 1,
    kind: recoveryContract.kind,
    release: state.manifest.release,
    projectRef: state.manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt: capturedAtText,
    expiresAt: new Date(
      nowMs + recoveryContract.maximumAgeMinutes * 60_000,
    ).toISOString(),
    requiredRemoteHead: state.manifest.requiredRemoteHead,
    expectedMigrationHead: state.binding.expectedMigrationHead,
    migrationCount: state.binding.migrationCount,
    migrationVersionsSha256: state.binding.migrationVersionsSha256,
    observations,
    postApplyCheckIds: state.binding.postApplyCheckIds,
    postApplyChecksSha256: state.binding.postApplyChecksSha256,
    rollbackContractSha256: state.binding.rollbackContractSha256,
    checks: Object.fromEntries(
      recoveryContract.requiredChecks.map((check) => [check, true]),
    ),
    rawProvenance: {
      fileName: recoveryContract.rawEvidenceFileName,
      sha256: sha256(rawText),
      capturedAt: capturedAtText,
      source: recoveryContract.rawEvidenceSource,
    },
    containsSecrets: false,
    releaseAssurance,
  };
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  if (containsSecretMaterial(raw) || containsSecretMaterial(receipt)
      || Buffer.byteLength(rawText, "utf8") > MAX_RAW_EVIDENCE_BYTES
      || Buffer.byteLength(receiptText, "utf8") > MAX_RUNTIME_RECEIPT_BYTES) {
    fail("SUCCESSOR_RECOVERY_OUTPUT_INVALID");
  }

  await assertExactPushedRecoveryCommit({
    repoRoot: root,
    expectedCommit,
    expectedOrigin: state.backup.expectedOrigin,
    remoteRef,
    runGit,
  });
  const reopenedState = await validateReleaseState({
    repoRoot: root,
    releaseLoader,
  });
  if (canonicalJsonSha256({
    controllerManifest: reopenedState.controllerManifest,
    manifest: reopenedState.manifest,
  }) !== releaseStateSha256) {
    fail("SUCCESSOR_RECOVERY_RELEASE_CONTRACT_CHANGED");
  }
  await assertInputsUnchanged([
    ...backup.paths,
    ...hostedStaging.paths,
    ...postExpand.reopenedInputs,
  ]);
  if (await realpath(receiptRoot).catch(() => null) !== outputRoot
      || (await lstat(receiptRoot).catch(() => null))?.isSymbolicLink()) {
    fail("SUCCESSOR_RECOVERY_OUTPUT_ROOT_INVALID");
  }
  try {
    await durableWriter({ rawPath, rawText, receiptPath, receiptText });
  } catch {
    fail("SUCCESSOR_RECOVERY_OUTPUT_FAILED");
  }

  return Object.freeze({
    status: "successor_recovery_assurance_emitted",
    release: state.manifest.release,
    projectRef: state.manifest.projectRef,
    releaseCommit: expectedCommit,
    rawEvidencePath: rawPath,
    rawEvidenceSha256: receipt.rawProvenance.sha256,
    receiptPath,
    receiptSha256: sha256(receiptText),
    capturedAt: capturedAtText,
    expiresAt: receipt.expiresAt,
    additionalProjectCreated: false,
    hostedRestorePerformed: false,
    additionalMonthlyCostUsd: 0,
    restoreValidationClaimed: false,
    containsSecrets: false,
  });
}

function parseArgs(argv) {
  const values = {};
  for (const argument of argv) {
    const match = String(argument).match(/^--([a-z][a-z0-9-]*)=(.+)$/);
    if (!match || Object.hasOwn(values, match[1])) {
      fail("SUCCESSOR_RECOVERY_ARGUMENT_INVALID");
    }
    values[match[1]] = match[2];
  }
  const required = [
    "expected-commit",
    "post-expand-backup-directory",
    "post-expand-backup-receipt",
    "receipt-root",
    "remote-ref",
  ];
  if (!exactKeys(values, required)) fail("SUCCESSOR_RECOVERY_ARGUMENT_INVALID");
  return values;
}

export async function runVendorDisclosureSuccessorRecoveryAssuranceCli({
  repoRoot = process.cwd(),
  argv = process.argv.slice(2),
  ...dependencies
} = {}) {
  const values = parseArgs(argv);
  return emitVendorDisclosureSuccessorRecoveryAssurance({
    repoRoot,
    receiptRoot: values["receipt-root"],
    expectedCommit: values["expected-commit"],
    remoteRef: values["remote-ref"],
    postExpandBackupReceiptPath: values["post-expand-backup-receipt"],
    postExpandBackupDirectory: values["post-expand-backup-directory"],
    ...dependencies,
  });
}

export const successorRecoveryAssuranceTestHooks = Object.freeze({
  APPROVED_STAGING_PROJECT_REF,
  POST_EXPAND_IMPLEMENTATION_PATHS,
  defaultRunGit,
  parseArgs,
  sha256,
});
