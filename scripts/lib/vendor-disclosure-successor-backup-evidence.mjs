import { spawn } from "node:child_process";
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
  relative,
  resolve,
  sep,
} from "node:path";

import { resolvePinnedWindowsProductionToolchain } from "./production-windows-toolchain.mjs";
import {
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  validateSuccessorReleaseContract,
} from "./supabase-successor-release-contract.mjs";
import {
  writeDurableExclusiveEvidencePair,
} from "./vendor-disclosure-successor-hosted-staging-evidence.mjs";

const CURRENT_PRODUCTION_BASELINE_HEAD = "20260727090000";
export const CURRENT_PRODUCTION_MIGRATION_COUNT = 147;
const CURRENT_PRODUCTION_MIGRATION_VERSIONS_SHA256 =
  "0ee207d75d2bd30e1a68d1f6d2f710f220cdd3dd8e1f681f9d2fa332852a0c23";
export const SUCCESSOR_LOGICAL_BACKUP_VERIFICATION_KIND =
  "vendor-disclosure-successor-current-baseline-backup-verification-v1";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_HBAM2_BYTES = 32 * 1024 * 1024 + 1024;
const MAX_DPAPI_KEY_BYTES = 4 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const LOWER_SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const MIGRATION = /^\d{14}$/;
const SAFE_FILE = /^[a-z0-9][a-z0-9_.-]{2,160}\.json$/;
const SAFE_TABLE = /^[a-z][a-z0-9_]{1,62}$/;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REMOTE_REF = /^origin\/([A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?)$/;
const BACKUP_DIRECTORY = /^\d{8}-\d{6}$/;
const HBAM2_FORMAT = "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser";
const HBAM2_MAGIC = Buffer.from("HBAM2", "ascii");
const HBAM2_VERSION = 2;
const BASELINE_CAPTURE_FILE = "scripts/vendor-disclosure-db-current-baseline.ps1";
const BASELINE_DEPENDENCY_FILES = Object.freeze([
  "scripts/vendor-disclosure-db-current-baseline-common.ps1",
  "scripts/amora-db-backup-common.ps1",
]);
const BASELINE_VERIFIER_FILE =
  "scripts/vendor-disclosure-db-current-baseline-verify.ps1";
const EXACT_BACKUP_FILES = Object.freeze([
  "logical-data.json.hbam2",
  "logical-data.json.key.dpapi",
  "manifest.json",
  "schema-inventory.json.hbam2",
  "schema-inventory.json.key.dpapi",
]);
const EXACT_ARTIFACT_METADATA_KEYS = Object.freeze([
  "artifact",
  "backup_set_id",
  "encrypted_bytes",
  "encrypted_sha256",
  "key",
  "key_sha256",
  "plaintext_bytes",
  "plaintext_sha256",
]);
const EXACT_MANIFEST_KEYS = Object.freeze([
  "artifacts",
  "auth_schema_contract_sha256",
  "auth_users_canonical_sha256",
  "auth_users_contract_sha256",
  "auth_users_row_count",
  "backup_contract_id",
  "backup_contract_version",
  "backup_set_id",
  "backup_type",
  "consistency",
  "contains_secrets",
  "created_at_utc",
  "expected_tables",
  "format",
  "format_version",
  "git_commit",
  "git_origin",
  "git_remote_ref",
  "implementation",
  "inventory_after_captured_at",
  "inventory_before_captured_at",
  "inventory_contract_sha256",
  "key_scope",
  "live_schema_contract_sha256",
  "logical_data_contract_sha256",
  "plaintext_written_to_disk",
  "preflight",
  "preflight_captured_at",
  "query_timeout_seconds",
  "release",
  "source_captured_at",
  "source_current_user",
  "source_database_identity",
  "source_database_identity_sha256",
  "source_fence",
  "source_migration_count",
  "source_migration_head",
  "source_migration_versions_sha256",
  "source_project_ref",
  "source_project_ref_sha256",
  "source_relation_contract_sha256",
  "source_role_bypasses_rls",
  "source_row_security",
  "source_session_user",
  "status",
  "supabase_cli",
  "table_contract_sha256",
  "table_count",
  "tables",
  "verifier",
  "verifier_runtime",
]);
const EXACT_LOGICAL_RECEIPT_KEYS = Object.freeze([
  "AuthSchemaContractSha256",
  "AuthUsersCanonicalSha256",
  "AuthUsersContractSha256",
  "BackupContractId",
  "BackupContractVersion",
  "BackupSetId",
  "ContainsSecrets",
  "EncryptedArtifacts",
  "EncryptedArtifactsVerified",
  "ExpectedTables",
  "GitCommit",
  "GitOrigin",
  "InventorySha256",
  "Kind",
  "LiveSchemaContractSha256",
  "LogicalDataContractSha256",
  "ManifestSha256",
  "PGliteJsonbRoundTripVerified",
  "PlaintextWrittenToDisk",
  "ProjectRef",
  "ReceiptVersion",
  "Release",
  "SourceCanonicalDigestsVerified",
  "SourceCapturedAt",
  "SourceMigrationCount",
  "SourceMigrationHead",
  "SupabaseCli",
  "TableContractSha256",
  "TableCount",
  "Verified",
  "VerifiedAtUtc",
  "Verifier",
]);

export class SuccessorBackupEvidenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SuccessorBackupEvidenceError";
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new SuccessorBackupEvidenceError(code, message);
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

function canonicalTextSha256(value) {
  return sha256(value.replace(/\r\n?/g, "\n"));
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

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

function parseJsonWithoutDuplicateKeys(text) {
  let offset = 0;
  let duplicate = false;
  const invalid = () => { throw new SyntaxError("invalid exact JSON"); };
  const whitespace = () => {
    while (offset < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[offset])) offset += 1;
  };
  const stringToken = () => {
    if (text[offset] !== "\"") invalid();
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      offset += 1;
      if (character === "\\") {
        if (offset >= text.length) invalid();
        offset += 1;
      } else if (character === "\"") {
        return JSON.parse(text.slice(start, offset));
      }
    }
    invalid();
  };
  const value = () => {
    whitespace();
    if (text[offset] === "{") {
      offset += 1;
      whitespace();
      const keys = new Set();
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) duplicate = true;
        keys.add(key);
        whitespace();
        if (text[offset] !== ":") invalid();
        offset += 1;
        value();
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") invalid();
        offset += 1;
      }
      invalid();
    }
    if (text[offset] === "[") {
      offset += 1;
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        value();
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") invalid();
        offset += 1;
      }
      invalid();
    }
    if (text[offset] === "\"") {
      stringToken();
      return;
    }
    const start = offset;
    while (offset < text.length && !/[\u0009\u000a\u000d\u0020,\]}]/.test(text[offset])) {
      offset += 1;
    }
    if (start === offset) invalid();
    JSON.parse(text.slice(start, offset));
  };
  value();
  whitespace();
  if (offset !== text.length || duplicate) invalid();
  return JSON.parse(text);
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
    if (error instanceof SuccessorBackupEvidenceError) throw error;
    fail(code);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readBoundedJsonFile(path, code) {
  const bytes = await readBoundedRegularFile(path, MAX_JSON_BYTES, code);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (containsSecretJsonText(text)) fail(code);
    return parseJsonWithoutDuplicateKeys(text);
  } catch {
    fail(code);
  } finally {
    bytes.fill(0);
  }
}

async function boundedResponseJson(response, code) {
  const body = response?.body;
  const contentLength = response?.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    const value = String(contentLength).trim();
    const length = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(length) || length < 2 || length > MAX_JSON_BYTES) {
      await body?.cancel?.().catch(() => {});
      fail(code);
    }
  }
  if (!body || typeof body.getReader !== "function") {
    await body?.cancel?.().catch(() => {});
    fail(code);
  }
  let reader;
  let cancelled = false;
  let complete = false;
  const chunks = [];
  let combined;
  let totalBytes = 0;
  const cancelReader = async () => {
    if (cancelled || complete || !reader) return;
    cancelled = true;
    await reader.cancel().catch(() => {});
  };
  try {
    reader = body.getReader();
    while (true) {
      const result = await reader.read();
      if (result?.done === true) {
        complete = true;
        break;
      }
      if (!(result?.value instanceof Uint8Array) || result.value.byteLength < 1) {
        fail(code);
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_JSON_BYTES) {
        await cancelReader();
        fail(code);
      }
      chunks.push(Buffer.from(result.value));
    }
    if (totalBytes < 2 || totalBytes > MAX_JSON_BYTES) fail(code);
    combined = Buffer.concat(chunks, totalBytes);
    return Object.freeze({
      value: parseJsonWithoutDuplicateKeys(
        new TextDecoder("utf-8", { fatal: true }).decode(combined),
      ),
      bytes: totalBytes,
      sha256: sha256(combined),
    });
  } catch (error) {
    await cancelReader();
    if (error instanceof SuccessorBackupEvidenceError) throw error;
    fail(code);
  } finally {
    reader?.releaseLock?.();
    combined?.fill(0);
    chunks.forEach((chunk) => chunk.fill(0));
  }
}

export async function writeDurableEvidencePair(options) {
  return await writeDurableExclusiveEvidencePair(options);
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
      if (stdout.length + chunk.length <= MAX_JSON_BYTES) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length + chunk.length <= MAX_JSON_BYTES) stderr += chunk;
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
      fail("SUCCESSOR_BACKUP_TOOLCHAIN_INVALID");
    }
  }
  const status = await requireCommand(
    runCommand,
    git,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repoRoot,
    "SUCCESSOR_BACKUP_GIT_STATUS_FAILED",
  );
  if (status.trim()) fail("SUCCESSOR_BACKUP_WORKTREE_DIRTY");
  const head = await requireCommand(
    runCommand,
    git,
    ["rev-parse", "HEAD"],
    repoRoot,
    "SUCCESSOR_BACKUP_GIT_HEAD_FAILED",
  );
  if (head.trim() !== expectedCommit) fail("SUCCESSOR_BACKUP_GIT_HEAD_MISMATCH");
  const origin = await requireCommand(
    runCommand,
    git,
    ["remote", "get-url", "origin"],
    repoRoot,
    "SUCCESSOR_BACKUP_GIT_ORIGIN_FAILED",
  );
  if (origin.trim() !== expectedOrigin) fail("SUCCESSOR_BACKUP_GIT_ORIGIN_MISMATCH");
  const match = remoteRef.match(REMOTE_REF);
  if (!match || match[1].includes("..") || match[1].includes("//")) {
    fail("SUCCESSOR_BACKUP_REMOTE_REF_INVALID");
  }
  const branchRef = `refs/heads/${match[1]}`;
  const remote = await requireCommand(
    runCommand,
    git,
    ["ls-remote", "--exit-code", "origin", branchRef],
    repoRoot,
    "SUCCESSOR_BACKUP_REMOTE_REF_FAILED",
  );
  const lines = remote.trim().split(/\r?\n/).filter(Boolean);
  const [remoteCommit, returnedRef] = lines.length === 1
    ? lines[0].trim().split(/\s+/)
    : [];
  if (remoteCommit !== expectedCommit || returnedRef !== branchRef) {
    fail("SUCCESSOR_BACKUP_REMOTE_COMMIT_MISMATCH");
  }
}

function validateEvidenceContract(manifest) {
  const actual = manifest?.deploymentEvidence?.backup;
  const expected = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.backup;
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
    fail("SUCCESSOR_BACKUP_EVIDENCE_CONTRACT_INVALID");
  }
  return actual;
}

async function validateReleaseState({ repoRoot, releaseLoader }) {
  let state;
  try {
    state = await releaseLoader({ repoRoot });
  } catch {
    fail("SUCCESSOR_BACKUP_RELEASE_CONTRACT_INVALID");
  }
  const { manifest, controllerManifest, remoteBaseline } = state ?? {};
  const backup = controllerManifest?.backupContract;
  if (state?.controllerReady !== true
      || manifest?.status !== "controller_ready"
      || manifest?.release !== controllerManifest?.release
      || manifest?.projectRef !== controllerManifest?.projectRef
      || !PROJECT_REF.test(manifest?.projectRef ?? "")
      || !MIGRATION.test(manifest?.requiredRemoteHead ?? "")
      || remoteBaseline?.observedRemoteHead !== CURRENT_PRODUCTION_BASELINE_HEAD
      || backup?.id !== `pre-${manifest?.release}-current-remote-backup`
      || backup?.version !== 2
      || backup?.format !== "hbam2-encrypted-current-user"
      || backup?.expectedMigrationHead !== CURRENT_PRODUCTION_BASELINE_HEAD
      || backup?.expectedCommitBinding !== "release-expected-commit"
      || typeof backup?.expectedOrigin !== "string"
      || !exactArray(backup?.expectedTables, [...(backup?.expectedTables ?? [])].sort())
      || !Array.isArray(backup?.expectedTables)
      || backup.expectedTables.length < 1
      || backup.expectedTables.some((table) => !SAFE_TABLE.test(table))
      || new Set(backup.expectedTables).size !== backup.expectedTables.length
      || backup.expectedTableCount !== backup.expectedTables.length
      || backup.expectedTableContractSha256 !== textListSha256(backup.expectedTables)
      || !exactKeys(backup?.capture, ["file", "sha256"])
      || backup.capture.file !== BASELINE_CAPTURE_FILE
      || !LOWER_SHA256.test(backup.capture.sha256 ?? "")
      || !Array.isArray(backup?.dependencies)
      || backup.dependencies.length !== BASELINE_DEPENDENCY_FILES.length
      || backup.dependencies.some((dependency, index) =>
        !exactKeys(dependency, ["file", "sha256"])
        || dependency.file !== BASELINE_DEPENDENCY_FILES[index]
        || !LOWER_SHA256.test(dependency.sha256 ?? ""))
      || backup?.verifier?.file !== BASELINE_VERIFIER_FILE
      || !LOWER_SHA256.test(backup?.verifier?.sha256 ?? "")
      || backup?.providerPhysicalBackup?.maximumAgeHours !== 26
      || backup.providerPhysicalBackup.requiredStatus !== "COMPLETED"
      || backup.providerPhysicalBackup.requirePhysicalBackup !== true
      || backup.providerPhysicalBackup.restoreCapability !== "completed-physical-backup"
      || !exactKeys(backup?.supabaseCli, ["binarySha256", "version"])
      || !UPPER_SHA256.test(backup.supabaseCli.binarySha256 ?? "")
      || typeof backup.supabaseCli.version !== "string"
      || !exactKeys(backup?.requiredReceiptValues, [
        "PGliteJsonbRoundTripVerified",
        "PlaintextWrittenToDisk",
        "SourceCanonicalDigestsVerified",
        "Verified",
      ])
      || backup.requiredReceiptValues.Verified !== true
      || backup.requiredReceiptValues.SourceCanonicalDigestsVerified !== true
      || backup.requiredReceiptValues.PGliteJsonbRoundTripVerified !== true
      || backup.requiredReceiptValues.PlaintextWrittenToDisk !== false
      || !Array.isArray(manifest.expandMigrations)
      || manifest.expandMigrations.length < 1
      || !Array.isArray(controllerManifest.postApplyChecks)
      || controllerManifest.postApplyChecks.length < 1
      || !controllerManifest.rollbackContract) {
    fail("SUCCESSOR_BACKUP_RELEASE_CONTRACT_INVALID");
  }
  const evidence = validateEvidenceContract(manifest);
  return { manifest, controllerManifest, backup, evidence };
}

async function validatePinnedBackupImplementation(repoRoot, backup) {
  const scriptsRoot = resolve(repoRoot, "scripts");
  const rawDigests = {};
  for (const [pin, code] of [
    [backup.capture, "SUCCESSOR_BACKUP_IMPLEMENTATION_INVALID"],
    ...backup.dependencies.map((dependency) => [
      dependency,
      "SUCCESSOR_BACKUP_IMPLEMENTATION_INVALID",
    ]),
    [backup.verifier, "SUCCESSOR_BACKUP_VERIFIER_INVALID"],
  ]) {
    const path = resolve(repoRoot, pin.file);
    if (!inside(scriptsRoot, path)
        || inside(resolve(repoRoot, "scripts", "tests"), path)) {
      fail(code);
    }
    const bytes = await readBoundedRegularFile(path, MAX_JSON_BYTES, code);
    if (canonicalTextSha256(bytes.toString("utf8")) !== pin.sha256) {
      fail(code);
    }
    rawDigests[pin.file] = sha256(bytes);
  }
  return Object.freeze(rawDigests);
}

function validateLogicalReceipt({ value, manifest, backup, expectedCommit, nowMs }) {
  const artifacts = value?.EncryptedArtifacts;
  const supabaseCli = value?.SupabaseCli;
  const verifier = value?.Verifier;
  const sourceMs = Date.parse(value?.SourceCapturedAt ?? "");
  const verifiedMs = Date.parse(value?.VerifiedAtUtc ?? "");
  if (!exactKeys(value, EXACT_LOGICAL_RECEIPT_KEYS)
      || value.ReceiptVersion !== 1
      || value.Kind !== SUCCESSOR_LOGICAL_BACKUP_VERIFICATION_KIND
      || value.Verified !== true
      || value.Release !== manifest.release
      || value.ProjectRef !== manifest.projectRef
      || value.GitCommit !== expectedCommit
      || value.GitOrigin !== backup.expectedOrigin
      || value.BackupContractId !== backup.id
      || value.BackupContractVersion !== backup.version
      || !UUID_V4.test(value.BackupSetId ?? "")
      || !LOWER_SHA256.test(value.ManifestSha256 ?? "")
      || !Number.isFinite(sourceMs)
      || !Number.isFinite(verifiedMs)
      || sourceMs > verifiedMs
      || verifiedMs > nowMs + 60_000
      || nowMs - sourceMs > SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.backup.maximumAgeMinutes * 60_000
      || value.SourceMigrationHead !== backup.expectedMigrationHead
      || value.SourceMigrationCount !== CURRENT_PRODUCTION_MIGRATION_COUNT
      || value.TableCount !== backup.expectedTableCount
      || !exactArray(value.ExpectedTables, backup.expectedTables)
      || value.TableContractSha256 !== backup.expectedTableContractSha256
      || !LOWER_SHA256.test(value.AuthSchemaContractSha256 ?? "")
      || !LOWER_SHA256.test(value.AuthUsersCanonicalSha256 ?? "")
      || !LOWER_SHA256.test(value.AuthUsersContractSha256 ?? "")
      || !LOWER_SHA256.test(value.InventorySha256 ?? "")
      || !LOWER_SHA256.test(value.LiveSchemaContractSha256 ?? "")
      || !LOWER_SHA256.test(value.LogicalDataContractSha256 ?? "")
      || !exactKeys(artifacts, [
        "LogicalDataCiphertextSha256",
        "LogicalDataProtectedKeySha256",
        "SchemaInventoryCiphertextSha256",
        "SchemaInventoryProtectedKeySha256",
      ])
      || Object.values(artifacts ?? {}).some((digest) => !LOWER_SHA256.test(digest ?? ""))
      || !exactKeys(supabaseCli, ["BinarySha256", "Version"])
      || supabaseCli.Version !== backup.supabaseCli.version
      || supabaseCli.BinarySha256 !== backup.supabaseCli.binarySha256
      || !exactKeys(verifier, ["File", "Sha256"])
      || verifier.File !== backup.verifier.file
      || verifier.Sha256 !== backup.verifier.sha256
      || value.EncryptedArtifactsVerified !== true
      || value.SourceCanonicalDigestsVerified !== true
      || value.PGliteJsonbRoundTripVerified !== true
      || value.PlaintextWrittenToDisk !== false
      || value.ContainsSecrets !== false) {
    fail("SUCCESSOR_BACKUP_LOGICAL_VERIFICATION_INVALID");
  }
  return value;
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
        if (key !== "contains_secrets"
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

function containsSecretJsonText(value) {
  return /"(?:password|service[_-]?role|api[_-]?key|access[_-]?token|refresh[_-]?token|management[_-]?token|client[_-]?secret)"\s*:/i.test(value)
    || /(?:postgres(?:ql)?:\/\/|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|SUPABASE_SERVICE_ROLE_KEY)/i.test(value);
}

function dotNetGuidBytes(value) {
  if (!UUID_V4.test(value ?? "")) fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  const [data1, data2, data3, data4, data5] = value.split("-");
  const byte = (pair) => Number.parseInt(pair, 16);
  return Buffer.from([
    byte(data1.slice(6, 8)), byte(data1.slice(4, 6)),
    byte(data1.slice(2, 4)), byte(data1.slice(0, 2)),
    byte(data2.slice(2, 4)), byte(data2.slice(0, 2)),
    byte(data3.slice(2, 4)), byte(data3.slice(0, 2)),
    byte(data4.slice(0, 2)), byte(data4.slice(2, 4)),
    byte(data5.slice(0, 2)), byte(data5.slice(2, 4)),
    byte(data5.slice(4, 6)), byte(data5.slice(6, 8)),
    byte(data5.slice(8, 10)), byte(data5.slice(10, 12)),
  ]);
}

function validTimestampOrder(manifest, nowMs) {
  const values = [
    manifest.preflight_captured_at,
    manifest.inventory_before_captured_at,
    manifest.source_captured_at,
    manifest.inventory_after_captured_at,
    manifest.created_at_utc,
  ].map((value) => Date.parse(value ?? ""));
  return values.every(Number.isFinite)
    && values.every((value, index) => index === 0 || value >= values[index - 1])
    && values.at(-1) <= nowMs + 60_000;
}

function validateManifestContract({
  value,
  logical,
  manifest,
  backup,
  implementationDigests,
  expectedCommit,
  remoteRef,
  nowMs,
}) {
  const identity = value?.source_database_identity;
  const artifacts = value?.artifacts;
  const tableCounts = value?.tables;
  const preflight = value?.preflight;
  const verifier = value?.verifier;
  const cli = value?.supabase_cli;
  const implementation = value?.implementation;
  const identitySha = identity && canonicalJsonSha256(identity);
  if (!exactKeys(value, EXACT_MANIFEST_KEYS)
      || containsSecretMaterial(value)
      || value.status !== "complete"
      || value.format !== HBAM2_FORMAT
      || value.format_version !== HBAM2_VERSION
      || value.backup_type !== "vendor-disclosure-successor-current-production-logical-snapshot"
      || value.backup_set_id !== logical.BackupSetId
      || value.release !== manifest.release
      || value.backup_contract_id !== backup.id
      || value.backup_contract_version !== backup.version
      || value.source_project_ref !== manifest.projectRef
      || value.source_project_ref_sha256 !== sha256(manifest.projectRef)
      || !exactKeys(identity, [
        "database_name", "database_oid", "server_version_num", "system_identifier",
      ])
      || !/^[1-9][0-9]{8,24}$/.test(identity?.system_identifier ?? "")
      || !/^[1-9][0-9]{0,9}$/.test(identity?.database_oid ?? "")
      || !/^[1-9][0-9]{4,7}$/.test(identity?.server_version_num ?? "")
      || typeof identity?.database_name !== "string"
      || identity.database_name.length < 1 || identity.database_name.length > 63
      || value.source_database_identity_sha256 !== identitySha
      || typeof value.source_current_user !== "string" || value.source_current_user.length < 1
      || typeof value.source_session_user !== "string" || value.source_session_user.length < 1
      || value.source_role_bypasses_rls !== true
      || value.source_row_security !== "off"
      || value.source_migration_head !== backup.expectedMigrationHead
      || value.source_migration_count !== CURRENT_PRODUCTION_MIGRATION_COUNT
      || value.source_migration_versions_sha256
        !== CURRENT_PRODUCTION_MIGRATION_VERSIONS_SHA256
      || !exactArray(value.expected_tables, backup.expectedTables)
      || value.table_count !== backup.expectedTableCount
      || value.table_contract_sha256 !== backup.expectedTableContractSha256
      || value.inventory_contract_sha256 !== logical.InventorySha256
      || !LOWER_SHA256.test(value.source_relation_contract_sha256 ?? "")
      || value.live_schema_contract_sha256 !== logical.LiveSchemaContractSha256
      || value.logical_data_contract_sha256 !== logical.LogicalDataContractSha256
      || value.auth_schema_contract_sha256 !== logical.AuthSchemaContractSha256
      || value.auth_users_canonical_sha256 !== logical.AuthUsersCanonicalSha256
      || value.auth_users_contract_sha256 !== logical.AuthUsersContractSha256
      || !Number.isSafeInteger(value.auth_users_row_count)
      || value.auth_users_row_count < 0 || value.auth_users_row_count > 500_000
      || value.git_commit !== expectedCommit
      || value.git_origin !== backup.expectedOrigin
      || value.git_remote_ref !== remoteRef
      || !exactKeys(implementation, ["files", "git_blobs", "git_commit"])
      || implementation.git_commit !== expectedCommit
      || implementation.files === null
      || typeof implementation.files !== "object"
      || Array.isArray(implementation.files)
      || implementation.git_blobs === null
      || typeof implementation.git_blobs !== "object"
      || Array.isArray(implementation.git_blobs)
      || Object.entries(implementationDigests).some(([file, digest]) =>
        implementation.files[file] !== digest
        || implementation.git_blobs[file] !== digest)
      || value.source_fence
        !== "exact-linked-production-ref-plus-clean-pushed-commit-plus-pinned-cli"
      || value.consistency !== "logical-data-single-statement-schema-before-after-fenced"
      || !Number.isSafeInteger(value.query_timeout_seconds)
      || value.query_timeout_seconds < 1 || value.query_timeout_seconds > 900
      || value.plaintext_written_to_disk !== false
      || value.contains_secrets !== false
      || value.key_scope !== "Windows DPAPI CurrentUser on the creating computer"
      || value.source_captured_at !== logical.SourceCapturedAt
      || !validTimestampOrder(value, nowMs)
      || !exactKeys(preflight, ["estimated_total_bytes", "estimated_total_rows"])
      || !Number.isSafeInteger(preflight?.estimated_total_bytes)
      || preflight.estimated_total_bytes < 0
      || !Number.isSafeInteger(preflight?.estimated_total_rows)
      || preflight.estimated_total_rows < 0
      || !exactKeys(tableCounts, backup.expectedTables)
      || Object.values(tableCounts ?? {}).some(
        (count) => !Number.isSafeInteger(count) || count < 0,
      )
      || !exactKeys(artifacts, ["logical_data", "schema_inventory"])
      || !exactKeys(verifier, ["file", "sha256"])
      || verifier.file !== backup.verifier.file
      || verifier.sha256 !== backup.verifier.sha256
      || cli === null || typeof cli !== "object" || Array.isArray(cli)
      || cli.version !== backup.supabaseCli.version
      || cli.files === null || typeof cli.files !== "object" || Array.isArray(cli.files)
      || !Object.values(cli.files).includes(backup.supabaseCli.binarySha256)
      || value.implementation === null || typeof value.implementation !== "object"
      || Array.isArray(value.implementation)
      || value.verifier_runtime === null || typeof value.verifier_runtime !== "object"
      || Array.isArray(value.verifier_runtime)) {
    fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  }
  return identitySha;
}

function validateArtifactMetadata({ metadata, artifactName, backupSetId }) {
  const artifact = `${artifactName}.hbam2`;
  const key = `${artifactName}.key.dpapi`;
  if (!exactKeys(metadata, EXACT_ARTIFACT_METADATA_KEYS)
      || metadata.backup_set_id !== backupSetId
      || metadata.artifact !== artifact
      || metadata.key !== key
      || !/^[a-fA-F0-9]{64}$/.test(metadata.plaintext_sha256 ?? "")
      || !/^[a-fA-F0-9]{64}$/.test(metadata.encrypted_sha256 ?? "")
      || !/^[a-fA-F0-9]{64}$/.test(metadata.key_sha256 ?? "")
      || !Number.isSafeInteger(metadata.plaintext_bytes)
      || metadata.plaintext_bytes < 1 || metadata.plaintext_bytes > 32 * 1024 * 1024
      || !Number.isSafeInteger(metadata.encrypted_bytes)
      || metadata.encrypted_bytes < 94 || metadata.encrypted_bytes > MAX_HBAM2_BYTES) {
    fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  }
  return { artifact, key };
}

function validateHbam2Envelope(bytes, { backupSetId, metadata }) {
  const plaintextLength = metadata.plaintext_bytes;
  const paddedLength = (Math.floor(plaintextLength / 16) + 1) * 16;
  const expectedLength = 46 + paddedLength + 32;
  if (bytes.length !== expectedLength
      || bytes.length !== metadata.encrypted_bytes
      || !bytes.subarray(0, HBAM2_MAGIC.length).equals(HBAM2_MAGIC)
      || bytes[5] !== HBAM2_VERSION
      || !bytes.subarray(6, 22).equals(dotNetGuidBytes(backupSetId))
      || bytes.readBigInt64LE(38) !== BigInt(plaintextLength)
      || bytes.length - 78 < 16
      || (bytes.length - 78) % 16 !== 0) {
    fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  }
}

async function validateEncryptedBackupArtifacts({
  repoRoot,
  logicalBackupDirectory,
  canonicalLogicalReceipt,
  logical,
  manifest,
  backup,
  implementationDigests,
  expectedCommit,
  remoteRef,
  nowMs,
}) {
  const before = await lstat(logicalBackupDirectory).catch(() => null);
  const [canonicalRepo, canonicalDirectory] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(logicalBackupDirectory).catch(() => null),
  ]);
  if (!before?.isDirectory() || before.isSymbolicLink()
      || !canonicalRepo || !canonicalDirectory
      || inside(canonicalRepo, canonicalDirectory)
      || !BACKUP_DIRECTORY.test(basename(canonicalDirectory))
      || dirname(canonicalDirectory) !== dirname(canonicalLogicalReceipt)
      || basename(canonicalLogicalReceipt)
        !== `${logical.BackupSetId}-successor-logical-verification.json`) {
    fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  }
  const entries = await readdir(canonicalDirectory, { withFileTypes: true }).catch(() => null);
  const names = entries?.map((entry) => entry.name).sort();
  if (!entries || !exactArray(names, EXACT_BACKUP_FILES)
      || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  }
  for (const name of EXACT_BACKUP_FILES) {
    const canonical = await realpath(resolve(canonicalDirectory, name)).catch(() => null);
    if (!canonical || dirname(canonical) !== canonicalDirectory || basename(canonical) !== name) {
      fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
    }
  }

  const manifestBytes = await readBoundedRegularFile(
    resolve(canonicalDirectory, "manifest.json"),
    MAX_JSON_BYTES,
    "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
  );
  let manifestValue;
  try {
    if (sha256(manifestBytes) !== logical.ManifestSha256) {
      fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
    }
    const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
    if (containsSecretJsonText(manifestText)) fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
    manifestValue = parseJsonWithoutDuplicateKeys(manifestText);
  } catch (error) {
    if (error instanceof SuccessorBackupEvidenceError) throw error;
    fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  } finally {
    manifestBytes.fill(0);
  }
  const sourceDatabaseIdentitySha256 = validateManifestContract({
    value: manifestValue,
    logical,
    manifest,
    backup,
    implementationDigests,
    expectedCommit,
    remoteRef,
    nowMs,
  });

  const expectedReceiptHashes = {
    "logical-data.json": {
      ciphertext: logical.EncryptedArtifacts.LogicalDataCiphertextSha256,
      key: logical.EncryptedArtifacts.LogicalDataProtectedKeySha256,
    },
    "schema-inventory.json": {
      ciphertext: logical.EncryptedArtifacts.SchemaInventoryCiphertextSha256,
      key: logical.EncryptedArtifacts.SchemaInventoryProtectedKeySha256,
    },
  };
  for (const [manifestKey, artifactName] of [
    ["logical_data", "logical-data.json"],
    ["schema_inventory", "schema-inventory.json"],
  ]) {
    const metadata = manifestValue.artifacts[manifestKey];
    const namesForArtifact = validateArtifactMetadata({
      metadata,
      artifactName,
      backupSetId: logical.BackupSetId,
    });
    const [ciphertext, protectedKey] = await Promise.all([
      readBoundedRegularFile(
        resolve(canonicalDirectory, namesForArtifact.artifact),
        MAX_HBAM2_BYTES,
        "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
      ),
      readBoundedRegularFile(
        resolve(canonicalDirectory, namesForArtifact.key),
        MAX_DPAPI_KEY_BYTES,
        "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
      ),
    ]);
    try {
      const ciphertextSha = sha256(ciphertext);
      const keySha = sha256(protectedKey);
      if (ciphertextSha !== metadata.encrypted_sha256.toLowerCase()
          || keySha !== metadata.key_sha256.toLowerCase()
          || ciphertextSha !== expectedReceiptHashes[artifactName].ciphertext
          || keySha !== expectedReceiptHashes[artifactName].key) {
        fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
      }
      validateHbam2Envelope(ciphertext, { backupSetId: logical.BackupSetId, metadata });
    } finally {
      ciphertext.fill(0);
      protectedKey.fill(0);
    }
  }
  const after = await lstat(canonicalDirectory).catch(() => null);
  if (!after?.isDirectory() || after.isSymbolicLink() || !sameFile(before, after)) {
    fail("SUCCESSOR_BACKUP_ARTIFACT_INVALID");
  }
  return Object.freeze({
    sourceDatabaseIdentitySha256,
    sourceDatabaseSystemIdentifierSha256: sha256(
      manifestValue.source_database_identity.system_identifier,
    ),
    sourceDatabaseNameSha256: sha256(manifestValue.source_database_identity.database_name),
    sourceDatabaseOidSha256: sha256(manifestValue.source_database_identity.database_oid),
    sourceProjectRefSha256: manifestValue.source_project_ref_sha256,
    sourceRelationContractSha256: manifestValue.source_relation_contract_sha256,
    sourceMigrationVersionsSha256: manifestValue.source_migration_versions_sha256,
  });
}

async function readProviderPhysicalBackup({
  projectRef,
  providerContract,
  accessToken,
  fetchImpl,
  nowMs,
}) {
  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/backups`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    fail("SUCCESSOR_BACKUP_PROVIDER_EVIDENCE_INVALID");
  }
  const observation = await boundedResponseJson(
    response,
    "SUCCESSOR_BACKUP_PROVIDER_EVIDENCE_INVALID",
  );
  const body = observation.value;
  const candidates = Array.isArray(body.backups)
    ? body.backups.filter((candidate) =>
      candidate?.is_physical_backup === providerContract.requirePhysicalBackup
      && candidate?.status === providerContract.requiredStatus
      && Number.isFinite(Date.parse(candidate?.inserted_at ?? "")))
      .sort((left, right) => Date.parse(right.inserted_at) - Date.parse(left.inserted_at))
    : [];
  const candidate = candidates[0];
  const latestUnix = body.physical_backup_data?.latest_physical_backup_date_unix;
  const insertedMs = Date.parse(candidate?.inserted_at ?? "");
  const latestMs = Number.isSafeInteger(latestUnix) ? latestUnix * 1000 : Number.NaN;
  const ageSeconds = Math.floor((nowMs - latestMs) / 1000);
  if (response.status !== 200
      || !candidate
      || !Number.isSafeInteger(latestUnix)
      || latestUnix < 1_500_000_000
      || latestUnix > 5_000_000_000
      || !Number.isFinite(insertedMs)
      || Math.abs(insertedMs - latestMs) > 15 * 60_000
      || !Number.isSafeInteger(ageSeconds)
      || ageSeconds < 0
      || ageSeconds > providerContract.maximumAgeHours * 3600) {
    fail("SUCCESSOR_BACKUP_PROVIDER_EVIDENCE_INVALID");
  }
  return Object.freeze({
    status: candidate.status,
    isPhysicalBackup: candidate.is_physical_backup,
    insertedAt: new Date(insertedMs).toISOString(),
    latestPhysicalBackupDateUnix: latestUnix,
    ageSeconds,
    restoreCapability: providerContract.restoreCapability,
    restoreCandidateAvailable: true,
    responseStatusCode: response.status,
    responseBytes: observation.bytes,
    responseSha256: observation.sha256,
  });
}

async function assertPrivateOutputRoot(repoRoot, receiptRoot) {
  if (!isAbsolute(receiptRoot) || inside(repoRoot, receiptRoot)) {
    fail("SUCCESSOR_BACKUP_OUTPUT_ROOT_INVALID");
  }
  const metadata = await lstat(receiptRoot).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    fail("SUCCESSOR_BACKUP_OUTPUT_ROOT_INVALID");
  }
  const [canonicalRepo, canonicalRoot] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(receiptRoot).catch(() => null),
  ]);
  if (!canonicalRepo || !canonicalRoot || inside(canonicalRepo, canonicalRoot)) {
    fail("SUCCESSOR_BACKUP_OUTPUT_ROOT_INVALID");
  }
  return canonicalRoot;
}

function releaseRuntimeBinding(manifest, controllerManifest) {
  const versions = manifest.expandMigrations.map((entry) => entry.file.slice(0, 14));
  if (versions.some((version, index) => !MIGRATION.test(version)
      || (index > 0 && version <= versions[index - 1]))) {
    fail("SUCCESSOR_BACKUP_RELEASE_CONTRACT_INVALID");
  }
  const postApplyCheckIds = controllerManifest.postApplyChecks.map((check) => check?.id);
  if (postApplyCheckIds.some((id) => !/^[a-z][a-z0-9-]{2,63}$/.test(id ?? ""))
      || new Set(postApplyCheckIds).size !== postApplyCheckIds.length) {
    fail("SUCCESSOR_BACKUP_RELEASE_CONTRACT_INVALID");
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

export async function emitVendorDisclosureSuccessorBackupEvidence({
  repoRoot,
  receiptRoot,
  expectedCommit,
  remoteRef,
  logicalBackupVerificationPath,
  logicalBackupDirectory,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  runCommand = defaultRunCommand,
  releaseLoader = validateSuccessorReleaseContract,
}) {
  const root = resolve(repoRoot);
  if (typeof logicalBackupVerificationPath !== "string"
      || typeof logicalBackupDirectory !== "string"
      || !isAbsolute(logicalBackupVerificationPath)
      || !isAbsolute(logicalBackupDirectory)
      || inside(root, logicalBackupVerificationPath)
      || inside(root, logicalBackupDirectory)
      || !COMMIT.test(expectedCommit ?? "")
      || typeof remoteRef !== "string"
      || typeof fetchImpl !== "function"
      || typeof runCommand !== "function"
      || typeof releaseLoader !== "function") {
    fail("SUCCESSOR_BACKUP_ARGUMENT_INVALID");
  }
  const accessToken = env.SUPABASE_ACCESS_TOKEN;
  if (typeof accessToken !== "string" || accessToken.length < 20) {
    fail("SUCCESSOR_BACKUP_ACCESS_TOKEN_REQUIRED");
  }
  const capturedAt = now();
  const nowMs = capturedAt instanceof Date ? capturedAt.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) fail("SUCCESSOR_BACKUP_CLOCK_INVALID");

  const { manifest, controllerManifest, backup, evidence } = await validateReleaseState({
    repoRoot: root,
    releaseLoader,
  });
  const [canonicalRepoRoot, canonicalLogicalReceipt] = await Promise.all([
    realpath(root).catch(() => null),
    realpath(logicalBackupVerificationPath).catch(() => null),
  ]);
  if (!canonicalRepoRoot || !canonicalLogicalReceipt
      || inside(canonicalRepoRoot, canonicalLogicalReceipt)) {
    fail("SUCCESSOR_BACKUP_ARGUMENT_INVALID");
  }
  const outputRoot = await assertPrivateOutputRoot(root, receiptRoot);
  const rawPath = resolve(outputRoot, evidence.rawEvidenceFileName);
  const receiptPath = resolve(outputRoot, evidence.receiptFileName);
  if (dirname(rawPath) !== outputRoot || dirname(receiptPath) !== outputRoot
      || await lstat(rawPath).catch(() => null)
      || await lstat(receiptPath).catch(() => null)) {
    fail("SUCCESSOR_BACKUP_OUTPUT_COLLISION");
  }

  await assertExactPushedCommit({
    repoRoot: root,
    expectedCommit,
    expectedOrigin: backup.expectedOrigin,
    remoteRef,
    runCommand,
  });
  const implementationDigests = await validatePinnedBackupImplementation(root, backup);
  const logical = validateLogicalReceipt({
    value: await readBoundedJsonFile(
      canonicalLogicalReceipt,
      "SUCCESSOR_BACKUP_LOGICAL_VERIFICATION_INVALID",
    ),
    manifest,
    backup,
    expectedCommit,
    nowMs,
  });
  const artifactProvenance = await validateEncryptedBackupArtifacts({
    repoRoot: root,
    logicalBackupDirectory,
    canonicalLogicalReceipt,
    logical,
    manifest,
    backup,
    implementationDigests,
    expectedCommit,
    remoteRef,
    nowMs,
  });
  const providerPhysicalBackup = await readProviderPhysicalBackup({
    projectRef: manifest.projectRef,
    providerContract: backup.providerPhysicalBackup,
    accessToken,
    fetchImpl,
    nowMs,
  });
  const binding = releaseRuntimeBinding(manifest, controllerManifest);
  const capturedAtText = capturedAt.toISOString();
  const raw = {
    rawEvidenceVersion: 1,
    kind: "vendor-disclosure-successor-backup-raw-v1",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt: capturedAtText,
    logicalBackup: {
      backupContractId: logical.BackupContractId,
      backupContractVersion: logical.BackupContractVersion,
      backupSetId: logical.BackupSetId,
      manifestSha256: logical.ManifestSha256,
      sourceCapturedAt: logical.SourceCapturedAt,
      verifiedAt: logical.VerifiedAtUtc,
      sourceMigrationHead: logical.SourceMigrationHead,
      sourceMigrationCount: logical.SourceMigrationCount,
      expectedTableCount: logical.TableCount,
      expectedTables: logical.ExpectedTables,
      expectedTableContractSha256: logical.TableContractSha256,
      inventorySha256: logical.InventorySha256,
      liveSchemaContractSha256: logical.LiveSchemaContractSha256,
      logicalDataContractSha256: logical.LogicalDataContractSha256,
      authSchemaContractSha256: logical.AuthSchemaContractSha256,
      authUsersCanonicalSha256: logical.AuthUsersCanonicalSha256,
      authUsersContractSha256: logical.AuthUsersContractSha256,
      sourceProjectRefSha256: artifactProvenance.sourceProjectRefSha256,
      sourceDatabaseIdentitySha256: artifactProvenance.sourceDatabaseIdentitySha256,
      sourceDatabaseSystemIdentifierSha256:
        artifactProvenance.sourceDatabaseSystemIdentifierSha256,
      sourceDatabaseNameSha256: artifactProvenance.sourceDatabaseNameSha256,
      sourceDatabaseOidSha256: artifactProvenance.sourceDatabaseOidSha256,
      sourceMigrationVersionsSha256: artifactProvenance.sourceMigrationVersionsSha256,
      sourceRelationContractSha256: artifactProvenance.sourceRelationContractSha256,
      encryptedArtifacts: logical.EncryptedArtifacts,
      supabaseCli: logical.SupabaseCli,
      verifier: logical.Verifier,
      encryptedArtifactsVerified: true,
      sourceCanonicalDigestsVerified: true,
      pgliteJsonbRoundTripVerified: true,
      plaintextWrittenToDisk: false,
    },
    providerPhysicalBackup,
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
      backupContractId: backup.id,
      backupContractVersion: backup.version,
      expectedMigrationHead: backup.expectedMigrationHead,
      expectedTableContractSha256: backup.expectedTableContractSha256,
      expectedTableCount: backup.expectedTableCount,
      providerPhysicalBackupStatus: providerPhysicalBackup.status,
      restoreCandidateAvailable: providerPhysicalBackup.restoreCandidateAvailable,
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
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  if (rawText.includes(accessToken) || receiptText.includes(accessToken)) {
    fail("SUCCESSOR_BACKUP_SECRET_REDACTION_FAILED");
  }

  try {
    await writeDurableEvidencePair({ rawPath, rawText, receiptPath, receiptText });
  } catch {
    fail("SUCCESSOR_BACKUP_OUTPUT_FAILED");
  }

  return Object.freeze({
    status: "successor_backup_evidence_emitted",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    backupSetId: logical.BackupSetId,
    sourceMigrationHead: logical.SourceMigrationHead,
    sourceMigrationCount: logical.SourceMigrationCount,
    expectedTableCount: logical.TableCount,
    expectedTableContractSha256: logical.TableContractSha256,
    providerPhysicalBackupStatus: providerPhysicalBackup.status,
    restoreCandidateAvailable: true,
    rawEvidencePath: rawPath,
    rawEvidenceSha256: receipt.rawProvenance.sha256,
    receiptPath,
    receiptSha256: sha256(receiptText),
    capturedAt: capturedAtText,
    expiresAt: receipt.expiresAt,
    containsSecrets: false,
  });
}
