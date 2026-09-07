import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { validateCompletedStorageDrainEvidence } from "./storage-signed-upload-drain-evidence.mjs";
import {
  AMORA_POST_EXPAND_TABLES,
  AMORA_RELEASE_MIGRATION_VERSIONS,
  ExtendedReleaseContractError,
  validateAmoraExtendedReleaseContracts,
} from "./amora-release-extended-contracts.mjs";
import { analyzeReadOnlySqlEnvelope } from "./sql-read-only-envelope.mjs";
import {
  ProductionToolchainError,
  resolvePinnedWindowsProductionToolchain,
} from "./production-windows-toolchain.mjs";
import { productionDatabaseSystemIdentifier } from "./production-database-identity.mjs";
import {
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
  validateSuccessorRuntimeEvidence,
} from "./supabase-successor-release-contract.mjs";

const MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_BACKUP_MANIFEST_BYTES = 256 * 1024;
const MAX_BACKUP_AGE_MINUTES = 30;
const MAX_BACKUP_RESUME_AGE_MINUTES = 5_256_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const BACKUP_SET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RELEASE_LEASE_OWNER = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MIGRATION_FILE = /^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/;
const SAFE_ID = /^[a-z][a-z0-9-]{2,63}$/;
const GITHUB_HTTPS_ORIGIN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
const BASELINE_CONTRACT_ID = "pre-amora-current-remote-14-table-baseline";
const EPHEMERAL_REBUILD_CONTRACT =
  "production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)";
const HOSTED_RESTORE_REQUIRED_CHECKS = [
  "authApiSmokeVerified",
  "authUsersSchemaAndDataVerified",
  "checkConstraintsVerified",
  "columnDefaultsVerified",
  "destructiveRestoreDrillCompleted",
  "isolatedTargetConfirmed",
  "logicalDataDigestsVerified",
  "rowLevelSecurityPoliciesVerified",
  "rpcDefinitionsAndAclVerified",
  "storageMetadataRestoredVerified",
  "triggersVerified",
  "typedSchemaVerified",
];
const boundedJsonSha256ByValue = new WeakMap();

export class ReleaseBlockedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseBlockedError";
    this.code = code;
  }
}

function blocked(code, message) {
  throw new ReleaseBlockedError(code, message);
}

async function selectReleaseManifest(repoRoot) {
  const path = join(repoRoot, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  if (existsSync(path)) {
    let successor;
    try {
      successor = validateSuccessorReleaseContract({ repoRoot });
    } catch (error) {
      if (error instanceof SuccessorReleaseContractError) {
        blocked(
          "SUCCESSOR_RELEASE_CONTRACT_INVALID",
          `successor release contract is invalid (${error.code}: ${error.message}); production release remains blocked`,
        );
      }
      throw error;
    }
    if (successor.deploymentBlocked) {
      blocked(
        "SUCCESSOR_RELEASE_DEPLOYMENT_BLOCKED",
        `successor release ${successor.manifest.release} is ${successor.manifest.status}; use only the static release fence until its controller contract and private runtime evidence are ready`,
      );
    }
    return {
      manifest: successor.controllerManifest,
      manifestPath: resolve(repoRoot, successor.manifest.controllerContract.file),
      expectedMigrations:
        successor.controllerManifest.expandMigrations.map((entry) => entry.file),
      successor: true,
      successorContract: successor,
    };
  }
  const manifestPath = join(repoRoot, MANIFEST_RELATIVE_PATH);
  const manifest = await readBoundedJson(manifestPath, "release manifest");
  return {
    manifest,
    manifestPath,
    expectedMigrations:
      Array.isArray(manifest.expandMigrations)
        ? manifest.expandMigrations.map((entry) => entry?.file)
        : [],
    successor: false,
    successorContract: null,
  };
}

function assertSafeExecutionEnvironment(environment) {
  const exact = new Set([
    "SUPABASE_CLI_BINARY_OVERRIDE",
    "NODE_OPTIONS",
    "NODE_PATH",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_GLOBAL",
    "GIT_CEILING_DIRECTORIES",
  ]);
  const unsafe = Object.entries(environment).some(([name, value]) =>
    value !== undefined
    && value !== ""
    && (exact.has(name) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)));
  if (unsafe) {
    blocked(
      "EXECUTION_ENVIRONMENT_UNSAFE",
      "Git, Node or Supabase executable override environment variables are forbidden",
    );
  }
}

async function defaultRunCommand(
  command,
  args,
  { cwd, env = process.env, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {},
) {
  return await new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    let timeoutTimer;
    let forceKillTimer;
    const boundedTimeoutMs = Number.isSafeInteger(timeoutMs)
      && timeoutMs >= 1_000
      && timeoutMs <= 30 * 60 * 1000
      ? timeoutMs
      : DEFAULT_COMMAND_TIMEOUT_MS;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      resolveResult({ ...result, timedOut });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length <= 4 * 1024 * 1024) stdout += chunk;
      else outputTruncated = true;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length + chunk.length <= 4 * 1024 * 1024) stderr += chunk;
      else outputTruncated = true;
    });
    child.on("error", (error) => {
      finish({ status: null, signal: null, stdout, stderr, outputTruncated, error });
    });
    child.on("close", (status, signal) => {
      finish({ status, signal, stdout, stderr, outputTruncated });
    });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, boundedTimeoutMs);
  });
}

export const productionReleaseControllerTestHooks = Object.freeze({
  defaultRunCommand,
  validateBackupReceipt,
  selectReleaseManifest,
});

function parseArgs(argv) {
  const allowedValues = new Set([
    "--expected-commit",
    "--remote-ref",
    "--backup-receipt",
    "--backup-source-repo",
    "--receipt-out",
    "--confirm-production",
  ]);
  const result = { apply: false, checkOnly: false, resumePostPush: false };
  for (const argument of argv) {
    if (argument === "--apply") {
      if (result.apply || result.checkOnly || result.resumePostPush) {
        blocked("ARGUMENT_DUPLICATE", "exactly one release mode may be provided");
      }
      result.apply = true;
      continue;
    }
    if (argument === "--check-only") {
      if (result.apply || result.checkOnly || result.resumePostPush) {
        blocked("ARGUMENT_DUPLICATE", "exactly one release mode may be provided");
      }
      result.checkOnly = true;
      continue;
    }
    if (argument === "--resume-post-push") {
      if (result.apply || result.checkOnly || result.resumePostPush) {
        blocked("ARGUMENT_DUPLICATE", "exactly one release mode may be provided");
      }
      result.resumePostPush = true;
      continue;
    }
    if (/(?:include-all|\brepair\b|\breset\b)/i.test(argument)) {
      blocked("FORBIDDEN_OPERATION", "include-all, migration repair and reset are never accepted");
    }
    const separator = argument.indexOf("=");
    if (separator < 1) blocked("ARGUMENT_UNKNOWN", "unsupported release-controller argument");
    const name = argument.slice(0, separator);
    const value = argument.slice(separator + 1);
    if (!allowedValues.has(name)) blocked("ARGUMENT_UNKNOWN", `unsupported argument: ${name}`);
    const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(result, key)) blocked("ARGUMENT_DUPLICATE", `${name} may be provided only once`);
    if (!value) blocked("ARGUMENT_INVALID", `${name} must not be empty`);
    result[key] = value;
  }
  if (!result.apply && !result.checkOnly && !result.resumePostPush) {
    blocked("RELEASE_MODE_REQUIRED", "explicit --apply, --check-only or --resume-post-push is required");
  }
  for (const key of [
    "expectedCommit",
    "remoteRef",
    "backupReceipt",
    "backupSourceRepo",
    "confirmProduction",
  ]) {
    if (!result[key]) blocked("ARGUMENT_REQUIRED", `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} is required`);
  }
  if ((result.apply || result.resumePostPush) && !result.receiptOut) {
    blocked("ARGUMENT_REQUIRED", "--receipt-out is required in apply and resume modes");
  }
  if (result.checkOnly && result.receiptOut) {
    blocked("ARGUMENT_INVALID", "--receipt-out is forbidden in check-only mode");
  }
  if (!COMMIT.test(result.expectedCommit)) {
    blocked("EXPECTED_COMMIT_INVALID", "--expected-commit must be a lowercase 40-character Git SHA");
  }
  if (!/^origin\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(result.remoteRef)
      || result.remoteRef.includes("..")
      || result.remoteRef.includes("//")
      || result.remoteRef.endsWith("/")) {
    blocked("REMOTE_REF_INVALID", "--remote-ref must be one exact origin branch ref");
  }
  return result;
}

function canonicalTextHash(content) {
  return createHash("sha256")
    .update(content.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function summarizeSuccessorRuntimeEvidence(evidence) {
  if (!evidence) return null;
  const records = Object.entries(evidence)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, record]) => ({
      name,
      receiptSha256: record.receiptSha256,
      rawEvidenceSha256: record.rawEvidenceSha256,
      verifiedAt: record.verifiedAt,
      expiresAt: record.expiresAt,
    }));
  return Object.freeze({
    records: Object.freeze(records.map((record) => Object.freeze(record))),
    sha256: canonicalTextHash(
      `${records.map((record) => [
        record.name,
        record.receiptSha256,
        record.rawEvidenceSha256,
        record.verifiedAt,
        record.expiresAt,
      ].join(":")).join("\n")}\n`,
    ),
  });
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function assertReadOnlySqlEnvelope(sql, phase = "post") {
  const code = phase === "pre" ? "PRECONDITION_NOT_READ_ONLY" : "POSTCONDITION_NOT_READ_ONLY";
  const analysis = analyzeReadOnlySqlEnvelope(sql);
  if (!analysis.ok && analysis.reason === "transaction-escape") {
    blocked(code, `${phase}-apply SQL may not escape its read-only transaction`);
  }
  if (!analysis.ok) {
    blocked(code, `${phase}-apply SQL must be enclosed in an explicit read-only transaction`);
  }
}

async function readBoundedJson(path, label) {
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()) {
    blocked("RECEIPT_INVALID", `${label} must be a non-symlink regular file`);
  }
  if (before.size <= 1 || before.size > MAX_RECEIPT_BYTES) {
    blocked("RECEIPT_INVALID", `${label} has an invalid byte size`);
  }
  const sameFile = (left, right) => left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
  let handle;
  let bytes;
  try {
    handle = await open(path, "r");
    const opened = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    if (!opened.isFile() || !linked?.isFile() || linked.isSymbolicLink()
        || !sameFile(before, opened) || !sameFile(opened, linked)) {
      blocked("RECEIPT_INVALID", `${label} changed while it was opened`);
    }
    const buffer = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset <= 1 || offset > MAX_RECEIPT_BYTES || offset !== opened.size
        || !sameFile(opened, after)) {
      blocked("RECEIPT_INVALID", `${label} changed while it was read`);
    }
    bytes = buffer.subarray(0, offset);
  } catch {
    if (!bytes) blocked("RECEIPT_INVALID", `${label} could not be read safely`);
  } finally {
    await handle?.close().catch(() => {});
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    blocked("RECEIPT_INVALID", `${label} is not valid JSON`);
  }
  if (value && typeof value === "object") {
    boundedJsonSha256ByValue.set(
      value,
      createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    );
  }
  return value;
}

function boundedJsonSha256(value, label) {
  const sha256 = value && typeof value === "object"
    ? boundedJsonSha256ByValue.get(value)
    : null;
  if (!sha256) blocked("RECEIPT_INVALID", `${label} was not read from one immutable byte snapshot`);
  return sha256;
}

function containsSecretLikeField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretLikeField);
  return Object.entries(value).some(([key, nested]) =>
    /(?:password|secret|token|api[_-]?key|authorization|credential)/i.test(key)
    || containsSecretLikeField(nested));
}

async function loadReadOnlyChecks({
  manifest,
  repoRoot,
  section,
  phase,
  allIds,
  allPaths,
}) {
  const prefix = phase === "pre" ? "PRECONDITION" : "POSTCONDITION";
  const checks = [];
  for (const check of manifest[section]) {
    const expectedEvidenceEntries = check?.expectedEvidence
      && typeof check.expectedEvidence === "object"
      && !Array.isArray(check.expectedEvidence)
      ? Object.entries(check.expectedEvidence)
      : [];
    const evidenceInvalid = expectedEvidenceEntries.length === 0
      || expectedEvidenceEntries.some(([name, value]) =>
        !/^[a-z][a-z0-9_]*_count$/.test(name)
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 1_000_000_000);
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(check?.id ?? "")
        || allIds.has(check.id)
        || check?.type !== "read-only-sql"
        || typeof check.file !== "string"
        || !/^supabase\/release-checks\/[a-z0-9][a-z0-9_.-]*\.sql$/.test(check.file)
        || !SHA256.test(check.sha256 ?? "")
        || evidenceInvalid) {
      blocked(`${prefix}_MANIFEST_INVALID`, `${section} entries must be hash-pinned read-only SQL files`);
    }
    allIds.add(check.id);
    const checkPath = resolve(repoRoot, check.file);
    if (!inside(repoRoot, checkPath)) {
      blocked(`${prefix}_PATH_INVALID`, `${phase}-apply check path escapes the repository`);
    }
    if (allPaths.has(checkPath)) {
      blocked(`${prefix}_MANIFEST_INVALID`, `${phase}-apply check paths must be unique`);
    }
    allPaths.add(checkPath);
    const checkMetadata = await lstat(checkPath).catch(() => null);
    if (!checkMetadata?.isFile() || checkMetadata.isSymbolicLink()) {
      blocked(`${prefix}_PATH_INVALID`, `${phase}-apply check must be a regular repository file`);
    }
    const sql = await readFile(checkPath, "utf8");
    if (canonicalTextHash(sql) !== check.sha256) {
      blocked(`${prefix}_HASH_MISMATCH`, `${phase}-apply check SQL hash does not match the manifest`);
    }
    assertReadOnlySqlEnvelope(sql, phase);
    checks.push({
      id: check.id,
      path: checkPath,
      expectedEvidence: Object.fromEntries(
        expectedEvidenceEntries.sort(([left], [right]) => left.localeCompare(right)),
      ),
    });
  }
  return checks;
}

async function validatePinnedReleaseArtifacts({ manifest, repoRoot }) {
  const sections = [
    {
      name: "manualPlatformOperations",
      needsId: true,
      filePattern: /^supabase\/platform-operations\/(?:security|storage)\/[a-z0-9][a-z0-9_.-]*\.sql$/,
    },
    {
      name: "rollbackArtifacts",
      needsId: true,
      filePattern: /^supabase\/platform-operations\/(?:security|storage)\/[a-z0-9][a-z0-9_.-]*_rollback\.sql$/,
    },
    {
      name: "requiredDocuments",
      needsId: false,
      filePattern: /^docs\/[A-Za-z0-9][A-Za-z0-9_./-]*\.md$/,
    },
  ];
  const ids = new Set();
  const paths = new Set();
  const preApplyCheckIds = new Set(
    Array.isArray(manifest.preApplyChecks)
      ? manifest.preApplyChecks.map((check) => check?.id)
      : [],
  );
  const postPushCheckIds = new Set(
    Array.isArray(manifest.postPushChecks)
      ? manifest.postPushChecks.map((check) => check?.id)
      : [],
  );
  const manualOperationIds = new Set();
  const rollbackOperationIds = new Set();
  for (const section of sections) {
    const entries = manifest[section.name];
    if (!Array.isArray(entries) || entries.length === 0) {
      blocked(
        "RELEASE_ARTIFACT_MANIFEST_INVALID",
        `${section.name} must be a non-empty hash-pinned artifact array`,
      );
    }
    for (const entry of entries) {
      const idInvalid = section.needsId
        && (!/^[a-z][a-z0-9-]{2,63}$/.test(entry?.id ?? "") || ids.has(entry.id));
      if (idInvalid
          || typeof entry?.file !== "string"
          || entry.file.includes("..")
          || !section.filePattern.test(entry.file)
          || !SHA256.test(entry.sha256 ?? "")) {
        blocked(
          "RELEASE_ARTIFACT_MANIFEST_INVALID",
          `${section.name} contains an invalid artifact record`,
        );
      }
      if (section.needsId) ids.add(entry.id);
      if (section.name === "manualPlatformOperations") {
        const checkSet = entry.phase === "pre-backup"
          ? preApplyCheckIds
          : entry.phase === "post-push-pre-deploy"
            ? postPushCheckIds
            : null;
        if (!checkSet
            || !SAFE_ID.test(entry.verificationCheckId ?? "")
            || !checkSet.has(entry.verificationCheckId)) {
          blocked(
            "RELEASE_ARTIFACT_MANIFEST_INVALID",
            "every manual platform operation must bind to the read-only check for its release phase",
          );
        }
        manualOperationIds.add(entry.id);
      }
      if (section.name === "rollbackArtifacts") {
        if (!SAFE_ID.test(entry.forOperationId ?? "")
            || rollbackOperationIds.has(entry.forOperationId)) {
          blocked(
            "RELEASE_ARTIFACT_MANIFEST_INVALID",
            "every rollback artifact must bind once to a manual platform operation",
          );
        }
        rollbackOperationIds.add(entry.forOperationId);
      }
      const path = resolve(repoRoot, entry.file);
      if (!inside(repoRoot, path) || paths.has(path)) {
        blocked(
          "RELEASE_ARTIFACT_MANIFEST_INVALID",
          `${section.name} contains an escaping or duplicate artifact path`,
        );
      }
      paths.add(path);
      const metadata = await lstat(path).catch(() => null);
      if (!metadata?.isFile() || metadata.isSymbolicLink()) {
        blocked("RELEASE_ARTIFACT_PATH_INVALID", `${section.name} artifact is not a regular file`);
      }
      if (canonicalTextHash(await readFile(path, "utf8")) !== entry.sha256) {
        blocked("RELEASE_ARTIFACT_HASH_MISMATCH", `${section.name} artifact hash does not match`);
      }
    }
  }
  if (manualOperationIds.size !== rollbackOperationIds.size
      || [...manualOperationIds].some((id) => !rollbackOperationIds.has(id))) {
    blocked(
      "RELEASE_ARTIFACT_MANIFEST_INVALID",
      "every manual platform operation requires exactly one rollback artifact",
    );
  }
  let extendedContracts;
  try {
    extendedContracts = validateAmoraExtendedReleaseContracts(manifest);
  } catch (error) {
    if (error instanceof ExtendedReleaseContractError) {
      blocked(error.code, error.message);
    }
    throw error;
  }
  for (const operation of extendedContracts.forwardOnlySecurityOperations) {
    if (ids.has(operation.id)
        || !preApplyCheckIds.has(operation.verificationCheckId)) {
      blocked(
        "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
        "forward-only operation id or pre-backup verification binding is invalid",
      );
    }
    ids.add(operation.id);
    for (const [kind, artifact] of Object.entries({
      inventory: operation.inventory,
      apply: operation.apply,
      verify: operation.verify,
    })) {
      const path = resolve(repoRoot, artifact.file);
      if (!inside(repoRoot, path) || paths.has(path)) {
        blocked(
          "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
          "forward-only artifact path escapes or collides",
        );
      }
      paths.add(path);
      const metadata = await lstat(path).catch(() => null);
      const sql = metadata?.isFile() && !metadata.isSymbolicLink()
        ? await readFile(path, "utf8")
        : null;
      if (sql === null || canonicalTextHash(sql) !== artifact.sha256) {
        blocked(
          "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
          "forward-only artifact is missing or differs from its hash pin",
        );
      }
      if (kind !== "apply") {
        assertReadOnlySqlEnvelope(sql, "pre");
      } else {
        const canonical = sql.replace(/\r\n?/g, "\n").trim();
        if (!/^begin\s*;/i.test(canonical) || !/commit\s*;\s*$/i.test(canonical)) {
          blocked(
            "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
            "forward-only apply artifact must use one explicit transaction",
          );
        }
      }
    }
  }
  const finalizer = extendedContracts.finalizationContract.operation;
  const finalizerPath = resolve(repoRoot, finalizer.file);
  const finalizerMetadata = await lstat(finalizerPath).catch(() => null);
  if (!finalizerMetadata?.isFile() || finalizerMetadata.isSymbolicLink()
      || paths.has(finalizerPath)
      || canonicalTextHash(await readFile(finalizerPath, "utf8"))
        !== finalizer.sha256) {
    blocked(
      "FINALIZATION_CONTRACT_INVALID",
      "exact-owner finalizer artifact is missing, colliding or hash-mismatched",
    );
  }
  paths.add(finalizerPath);
  for (const [label, artifact] of Object.entries({
    capture: extendedContracts.postExpandBackupContract.capture,
    verifier: extendedContracts.postExpandBackupContract.verifier,
  })) {
    const path = resolve(repoRoot, artifact.file);
    const metadata = await lstat(path).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()
        || canonicalTextHash(await readFile(path, "utf8")) !== artifact.sha256) {
      blocked(
        "POST_EXPAND_BACKUP_CONTRACT_INVALID",
        `post-expand backup ${label} artifact is missing or hash-mismatched`,
      );
    }
  }
  return extendedContracts;
}

async function loadManifest(repoRoot, selection = null) {
  const manifestPath = selection?.manifestPath ?? join(repoRoot, MANIFEST_RELATIVE_PATH);
  const manifest = selection?.manifest
    ?? await readBoundedJson(manifestPath, "release manifest");
  if (typeof manifest.release !== "string" || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(manifest.release)) {
    blocked("MANIFEST_INVALID", "release manifest has an invalid release identifier");
  }
  if (!PROJECT_REF.test(manifest.projectRef)) {
    blocked("MANIFEST_INVALID", "release manifest has an invalid project ref");
  }
  if (!/^\d{14}$/.test(manifest.migrationFloor)) {
    blocked("MANIFEST_INVALID", "release manifest has an invalid migration floor");
  }
  if (!/^\d{14}$/.test(manifest.requiredRemoteHead)
      || manifest.requiredRemoteHead >= manifest.migrationFloor) {
    blocked("MANIFEST_INVALID", "release manifest has an invalid required remote head");
  }
  if (!Array.isArray(manifest.historicalReconciliation)
      || manifest.historicalReconciliation.length !== 0
      || !Array.isArray(manifest.appliedHotfixes)
      || manifest.appliedHotfixes.length !== 0
      || !Array.isArray(manifest.expandMigrations)
      || manifest.expandMigrations.length === 0) {
    blocked(
      "MANIFEST_SCOPE_INVALID",
      "production controller accepts only a non-empty expand set with no history reconciliation or hotfix repair",
    );
  }
  if (!Array.isArray(manifest.preApplyChecks) || manifest.preApplyChecks.length === 0
      || !Array.isArray(manifest.postPushChecks)
      || !Array.isArray(manifest.postApplyChecks) || manifest.postApplyChecks.length === 0) {
    blocked("MANIFEST_INVALID", "preApplyChecks, postPushChecks and postApplyChecks must be arrays with non-empty outer checks");
  }
  const backupContract = manifest.backupContract;
  const successorBackupContract = manifest.status === "controller_ready"
    && manifest.rollbackContract
    && backupContract?.version === 2;
  const successorBackupInvalid = successorBackupContract && (
    backupContract.format !== "hbam2-encrypted-current-user"
    || backupContract.expectedMigrationHead !== manifest.requiredRemoteHead
    || !Array.isArray(backupContract.expectedTables)
    || backupContract.expectedTables.length !== backupContract.expectedTableCount
    || backupContract.expectedTableCount < 1
    || new Set(backupContract.expectedTables).size !== backupContract.expectedTables.length
    || backupContract.expectedTables.some(
      (table, index) =>
        !/^[a-z][a-z0-9_]{1,62}$/.test(table)
        || (index > 0 && table <= backupContract.expectedTables[index - 1]),
    )
    || canonicalTextHash(`${backupContract.expectedTables.join("\n")}\n`)
      !== backupContract.expectedTableContractSha256
    || backupContract.expectedCommitBinding !== "release-expected-commit"
    || !GITHUB_HTTPS_ORIGIN.test(backupContract.expectedOrigin ?? "")
    || typeof backupContract.verifier?.file !== "string"
    || !/^scripts\/[a-z0-9][a-z0-9_.-]*\.ps1$/.test(backupContract.verifier.file)
    || !SHA256.test(backupContract.verifier?.sha256 ?? "")
    || backupContract.providerPhysicalBackup?.maximumAgeHours !== 26
    || backupContract.providerPhysicalBackup?.requiredStatus !== "COMPLETED"
    || backupContract.providerPhysicalBackup?.requirePhysicalBackup !== true
    || backupContract.providerPhysicalBackup?.restoreCapability
      !== "completed-physical-backup"
    || backupContract.hostedRestoreEvidence?.receiptFileName
      !== `${manifest.release}-hosted-restore-evidence.json`
    || backupContract.hostedRestoreEvidence?.maximumAgeMinutes !== 1_440
    || backupContract.hostedRestoreEvidence?.requiredTargetIsolation
      !== "different-supabase-project"
    || JSON.stringify(backupContract.hostedRestoreEvidence?.requiredChecks)
      !== JSON.stringify(HOSTED_RESTORE_REQUIRED_CHECKS)
    || !/^\d+\.\d+\.\d+$/.test(backupContract.supabaseCli?.version ?? "")
    || !UPPER_SHA256.test(backupContract.supabaseCli?.binarySha256 ?? "")
  );
  const predecessorBackupInvalid = !successorBackupContract && (
    backupContract?.id !== BASELINE_CONTRACT_ID
      || backupContract.version !== 1
      || backupContract.expectedTableCount !== 14
      || backupContract.excludedEphemeralTables?.length !== 2
      || backupContract.excludedEphemeralTables[0]
        !== "production_release_lease_20260717"
      || backupContract.excludedEphemeralTables[1] !== "rate_limit_buckets"
      || backupContract.ephemeralRebuildContract !== EPHEMERAL_REBUILD_CONTRACT
      || backupContract.expectedCommitBinding !== "release-expected-commit"
      || !GITHUB_HTTPS_ORIGIN.test(backupContract.expectedOrigin ?? "")
      || backupContract.verifier?.file !== "scripts/amora-db-current-baseline-verify.ps1"
      || !SHA256.test(backupContract.verifier?.sha256 ?? "")
      || backupContract.providerPhysicalBackup?.maximumAgeHours !== 26
      || backupContract.providerPhysicalBackup?.requiredStatus !== "COMPLETED"
      || backupContract.providerPhysicalBackup?.requirePhysicalBackup !== true
      || backupContract.providerPhysicalBackup?.restoreCapability
        !== "completed-physical-backup"
      || backupContract.hostedRestoreEvidence?.receiptFileName
        !== `${manifest.release}-hosted-restore-evidence.json`
      || backupContract.hostedRestoreEvidence?.maximumAgeMinutes !== 1_440
      || backupContract.hostedRestoreEvidence?.requiredTargetIsolation
        !== "different-supabase-project"
      || JSON.stringify(backupContract.hostedRestoreEvidence?.requiredChecks)
        !== JSON.stringify(HOSTED_RESTORE_REQUIRED_CHECKS)
      || !/^\d+\.\d+\.\d+$/.test(backupContract.supabaseCli?.version ?? "")
      || !UPPER_SHA256.test(backupContract.supabaseCli?.binarySha256 ?? "")
  );
  if (successorBackupInvalid || predecessorBackupInvalid) {
    blocked(
      "BACKUP_CONTRACT_INVALID",
      "release manifest must pin its exact current-remote backup, hosted restore, origin and CLI provenance",
    );
  }
  const postPushOperations = Array.isArray(manifest.manualPlatformOperations)
    ? manifest.manualPlatformOperations.filter(
      (operation) => operation?.phase === "post-push-pre-deploy",
    )
    : [];
  const expectedManualControlKeys = postPushOperations.length > 0
    ? [
      "maximumAgeMinutes",
      "postPushReceiptFileName",
      "receiptFileName",
      "signedUploadGraceMinutes",
      "signedUploadTokenTtlMinutes",
      "storageDrainReceiptFileName",
      "storageStabilityWindowMinutes",
    ]
    : [
      "maximumAgeMinutes",
      "receiptFileName",
      "signedUploadGraceMinutes",
      "signedUploadTokenTtlMinutes",
      "storageDrainReceiptFileName",
      "storageStabilityWindowMinutes",
    ];
  const manualControlKeys = manifest.manualControlEvidence
    && typeof manifest.manualControlEvidence === "object"
    && !Array.isArray(manifest.manualControlEvidence)
    ? Object.keys(manifest.manualControlEvidence).sort()
    : [];
  if (typeof manifest.manualControlEvidence !== "object"
      || Array.isArray(manifest.manualControlEvidence)
      || JSON.stringify(manualControlKeys) !== JSON.stringify(expectedManualControlKeys)
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
        manifest.manualControlEvidence.receiptFileName ?? "",
      )
      || manifest.manualControlEvidence.maximumAgeMinutes !== 30
      || manifest.manualControlEvidence.signedUploadTokenTtlMinutes !== 120
      || manifest.manualControlEvidence.signedUploadGraceMinutes !== 10
      || manifest.manualControlEvidence.storageStabilityWindowMinutes !== 5
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
        manifest.manualControlEvidence.storageDrainReceiptFileName ?? "",
      )
      || manifest.manualControlEvidence.storageDrainReceiptFileName
        === manifest.manualControlEvidence.receiptFileName
      || (postPushOperations.length > 0
        && (!/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
          manifest.manualControlEvidence.postPushReceiptFileName ?? "",
        )
          || manifest.manualControlEvidence.postPushReceiptFileName
            === manifest.manualControlEvidence.receiptFileName))
      || (postPushOperations.length > 0) !== (manifest.postPushChecks.length > 0)) {
    blocked(
      "MANUAL_CONTROL_EVIDENCE_INVALID",
      "release manifest must pin exact fresh pre-backup and, when required, post-push evidence receipts",
    );
  }
  const names = new Set();
  let previousVersion = "";
  for (const entry of manifest.expandMigrations) {
    const match = typeof entry?.file === "string" ? entry.file.match(MIGRATION_FILE) : null;
    if (!match || basename(entry.file) !== entry.file || !SHA256.test(entry.sha256 ?? "")) {
      blocked("MANIFEST_INVALID", "every expand migration needs a safe basename and lowercase SHA-256");
    }
    const version = match[1];
    if (version < manifest.migrationFloor || version <= previousVersion || names.has(entry.file)) {
      blocked("MANIFEST_ORDER_INVALID", "expand migrations must be unique and strictly ordered by version");
    }
    previousVersion = version;
    names.add(entry.file);
    const path = join(repoRoot, "supabase", "migrations", entry.file);
    const content = await readFile(path, "utf8").catch(() => null);
    if (content === null || canonicalTextHash(content) !== entry.sha256) {
      blocked("MIGRATION_HASH_MISMATCH", `hash mismatch for ${entry.file}`);
    }
  }

  const releaseEra = (await readdir(join(repoRoot, "supabase", "migrations")))
    .filter((name) => MIGRATION_FILE.test(name))
    .filter((name) => name.slice(0, 14) >= manifest.migrationFloor)
    .sort();
  const expected = manifest.expandMigrations.map((entry) => entry.file);
  if (releaseEra.length !== expected.length || releaseEra.some((name, index) => name !== expected[index])) {
    blocked("MIGRATION_SET_DRIFT", "release-era migration files do not exactly match the manifest");
  }
  const checkIds = new Set();
  const checkPaths = new Set();
  const preApplyChecks = await loadReadOnlyChecks({
    manifest,
    repoRoot,
    section: "preApplyChecks",
    phase: "pre",
    allIds: checkIds,
    allPaths: checkPaths,
  });
  const postApplyChecks = await loadReadOnlyChecks({
    manifest,
    repoRoot,
    section: "postApplyChecks",
    phase: "post",
    allIds: checkIds,
    allPaths: checkPaths,
  });
  const postPushChecks = await loadReadOnlyChecks({
    manifest,
    repoRoot,
    section: "postPushChecks",
    phase: "post",
    allIds: checkIds,
    allPaths: checkPaths,
  });
  const extendedContracts = await validatePinnedReleaseArtifacts({ manifest, repoRoot });
  const forwardOnlyChecks = extendedContracts.forwardOnlySecurityOperations.map(
    (operation) => ({
      id: operation.id,
      path: resolve(repoRoot, operation.verify.file),
      expectedEvidence: operation.verify.expectedEvidence,
    }),
  );
  return {
    manifest,
    manifestPath,
    expectedMigrations: expected,
    preApplyChecks,
    postPushChecks,
    postApplyChecks,
    forwardOnlyChecks,
    extendedContracts,
  };
}

async function requireCommandSuccess(runCommand, command, args, options, code) {
  const result = await runCommand(command, args, options);
  if (result?.error || result?.signal || result?.timedOut
      || result?.status !== 0 || result?.outputTruncated) {
    blocked(code, `${code}: external command failed; output withheld`);
  }
  return result;
}

function assertVerifiedCheckResult(output, phase, expectedEvidence) {
  const prefix = phase === "pre" ? "PRECONDITION" : "POSTCONDITION";
  let rows;
  try {
    rows = JSON.parse(output.trim());
  } catch {
    blocked(`${prefix}_RESULT_INVALID`, `${phase}-apply check did not return valid JSON`);
  }
  if (!Array.isArray(rows) || rows.length !== 1
      || !rows[0] || typeof rows[0] !== "object" || Array.isArray(rows[0])
      || rows[0].verified !== true) {
    blocked(`${prefix}_RESULT_INVALID`, `${phase}-apply check must return exactly one verified row`);
  }
  const evidence = {};
  for (const [name, value] of Object.entries(rows[0])) {
    if (name === "verified") continue;
    if (!/^[a-z][a-z0-9_]*_count$/.test(name)
        || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
      blocked(`${prefix}_RESULT_INVALID`, `${phase}-apply check evidence must contain bounded counts only`);
    }
    evidence[name] = value;
  }
  const expectedEntries = Object.entries(expectedEvidence);
  if (Object.keys(evidence).length !== expectedEntries.length
      || expectedEntries.some(([name, value]) => evidence[name] !== value)) {
    blocked(`${prefix}_RESULT_INVALID`, `${phase}-apply check evidence does not match the manifest`);
  }
  return Object.fromEntries(expectedEntries.map(([name]) => [name, evidence[name]]));
}

async function runReadOnlyChecks({
  checks,
  phase,
  runCommand,
  supabaseCli,
  repoRoot,
  assertLinkedRef,
}) {
  const prefix = phase === "pre" ? "PRECONDITION" : "POSTCONDITION";
  const completed = [];
  for (const check of checks) {
    await assertLinkedRef();
    const result = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      [
        "db",
        "query",
        "--linked",
        "--file",
        check.path,
        "--output",
        "json",
        "--agent",
        "no",
        "--workdir",
        repoRoot,
      ],
      { cwd: repoRoot },
      `${prefix}_FAILED`,
    );
    const evidence = assertVerifiedCheckResult(result.stdout, phase, check.expectedEvidence);
    await assertLinkedRef();
    completed.push({ id: check.id, evidence });
  }
  return completed;
}

async function runForwardOnlyChecks({
  checks,
  runCommand,
  supabaseCli,
  repoRoot,
  assertLinkedRef,
}) {
  const completed = [];
  for (const check of checks) {
    await assertLinkedRef();
    const result = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      [
        "db",
        "query",
        "--linked",
        "--file",
        check.path,
        "--output",
        "json",
        "--agent",
        "no",
        "--workdir",
        repoRoot,
      ],
      { cwd: repoRoot },
      "FORWARD_ONLY_SECURITY_VERIFY_FAILED",
    );
    await assertLinkedRef();
    let rows;
    try {
      rows = JSON.parse(result.stdout.trim());
    } catch {
      blocked(
        "FORWARD_ONLY_SECURITY_VERIFY_INVALID",
        "forward-only security verify returned non-JSON evidence",
      );
    }
    const expectedEntries = Object.entries(check.expectedEvidence);
    if (!Array.isArray(rows)
        || rows.length !== 1
        || !hasExactKeys(rows[0], expectedEntries.map(([name]) => name))
        || expectedEntries.some(([name, value]) => rows[0][name] !== value)) {
      blocked(
        "FORWARD_ONLY_SECURITY_VERIFY_INVALID",
        "forward-only security verify evidence is missing, extra or mismatched",
      );
    }
    completed.push({ id: check.id, evidence: rows[0] });
  }
  return completed;
}

async function assertReleaseGitFence({
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
    } catch (error) {
      if (error instanceof ProductionToolchainError) {
        blocked(error.code, error.message);
      }
      throw error;
    }
  }
  const status = await requireCommandSuccess(
    runCommand,
    git,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repoRoot },
    "GIT_STATUS_FAILED",
  );
  if (status.stdout.trim()) blocked("WORKTREE_DIRTY", "release worktree must be completely clean");
  const head = await requireCommandSuccess(
    runCommand,
    git,
    ["rev-parse", "HEAD"],
    { cwd: repoRoot },
    "GIT_HEAD_FAILED",
  );
  if (head.stdout.trim() !== expectedCommit) blocked("HEAD_MISMATCH", "HEAD does not match --expected-commit");
  const origin = await requireCommandSuccess(
    runCommand,
    git,
    ["remote", "get-url", "origin"],
    { cwd: repoRoot },
    "GIT_ORIGIN_FAILED",
  );
  if (origin.stdout.trim() !== expectedOrigin) {
    blocked("GIT_ORIGIN_MISMATCH", "release checkout origin does not match the manifest");
  }
  const branch = remoteRef.slice("origin/".length);
  const remote = await requireCommandSuccess(
    runCommand,
    git,
    ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`],
    { cwd: repoRoot },
    "REMOTE_REF_CHECK_FAILED",
  );
  const lines = remote.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) blocked("REMOTE_REF_AMBIGUOUS", "remote branch lookup did not return exactly one ref");
  const [remoteCommit, remoteName] = lines[0].trim().split(/\s+/);
  if (remoteCommit !== expectedCommit || remoteName !== `refs/heads/${branch}`) {
    blocked("REMOTE_COMMIT_MISMATCH", "remote branch is not the immutable expected commit");
  }
}

async function validateBackupReceipt({
  path,
  repoRoot,
  backupSourceRepo,
  backupContract,
  expectedCommit,
  projectRef,
  runCommand,
  maximumAgeMinutes = MAX_BACKUP_AGE_MINUTES,
}) {
  let git = "git";
  let powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
  if (runCommand === defaultRunCommand) {
    try {
      ({ git, powershell } = await resolvePinnedWindowsProductionToolchain());
    } catch (error) {
      if (error instanceof ProductionToolchainError) {
        blocked(error.code, error.message);
      }
      throw error;
    }
  }
  if (!isAbsolute(path) || !isAbsolute(backupSourceRepo)) {
    blocked("BACKUP_PATH_INVALID", "backup receipt and backup source repo paths must be absolute");
  }
  if (inside(repoRoot, path) || inside(backupSourceRepo, path)) {
    blocked("BACKUP_PATH_INVALID", "backup verification receipt must remain outside both Git repositories");
  }
  const backupSourceMetadata = await lstat(backupSourceRepo).catch(() => null);
  if (!backupSourceMetadata?.isDirectory() || backupSourceMetadata.isSymbolicLink()) {
    blocked("BACKUP_PATH_INVALID", "backup source repo must be a non-symlink directory");
  }
  const [canonicalRepoRoot, canonicalBackupSourceRepo, canonicalReceipt] =
    await Promise.all([
      realpath(repoRoot).catch(() => null),
      realpath(backupSourceRepo).catch(() => null),
      realpath(path).catch(() => null),
    ]);
  if (!canonicalRepoRoot || !canonicalBackupSourceRepo || !canonicalReceipt
      || inside(canonicalRepoRoot, canonicalReceipt)
      || inside(canonicalBackupSourceRepo, canonicalReceipt)) {
    blocked(
      "BACKUP_PATH_INVALID",
      "backup verification receipt must resolve outside both Git repositories",
    );
  }
  const receipt = await readBoundedJson(path, "backup verification receipt");
  if (containsSecretLikeField(receipt)) {
    blocked("BACKUP_RECEIPT_SECRET_FIELD", "backup verification receipt contains a forbidden secret-like field");
  }
  const boundedCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
  const currentRemoteContract = backupContract.version === 2
    && backupContract.format === "hbam2-encrypted-current-user";
  const currentRemoteReceiptKeys = [
    "AgeSeconds",
    "BackupDirectory",
    "BackupSetId",
    "CreatedAtUtc",
    "ExternalForeignKeysSkipped",
    "ForeignKeysChecked",
    "GitCommit",
    "InventoryCapturedAt",
    "InventoryContractSha256",
    "LiveSchemaContractSha256",
    "LogicalDataContractSha256",
    "ManifestSha256",
    "NodeSha256",
    "NodeVersion",
    "PGliteJsonbRoundTripVerified",
    "PGliteTreeSha256",
    "PGliteVersion",
    "PlaintextWrittenToDisk",
    "PrimaryConstraintsChecked",
    "SourceCanonicalDigestsVerified",
    "SourceCapturedAt",
    "SourceRelationContractSha256",
    "SupabaseCliBinarySha256",
    "SupabaseCliVersion",
    "TableCount",
    "TotalRows",
    "Verified",
  ];
  const createdAtMs = Date.parse(receipt.CreatedAtUtc ?? "");
  const sourceCapturedAtMs = Date.parse(receipt.SourceCapturedAt ?? "");
  const inventoryCapturedAtMs = Date.parse(receipt.InventoryCapturedAt ?? "");
  const currentAgeSeconds = Number.isFinite(createdAtMs)
    ? Math.floor((Date.now() - createdAtMs) / 1_000)
    : Number.NaN;
  if (currentRemoteContract && (
    !hasExactKeys(receipt, currentRemoteReceiptKeys)
    || receipt.Verified !== backupContract.requiredReceiptValues.Verified
    || receipt.SourceCanonicalDigestsVerified
      !== backupContract.requiredReceiptValues.SourceCanonicalDigestsVerified
    || receipt.PGliteJsonbRoundTripVerified
      !== backupContract.requiredReceiptValues.PGliteJsonbRoundTripVerified
    || receipt.PlaintextWrittenToDisk
      !== backupContract.requiredReceiptValues.PlaintextWrittenToDisk
    || !isAbsolute(receipt.BackupDirectory ?? "")
    || !BACKUP_SET_ID.test(receipt.BackupSetId ?? "")
    || !UPPER_SHA256.test(receipt.ManifestSha256 ?? "")
    || !UPPER_SHA256.test(receipt.InventoryContractSha256 ?? "")
    || !UPPER_SHA256.test(receipt.SourceRelationContractSha256 ?? "")
    || !UPPER_SHA256.test(receipt.LiveSchemaContractSha256 ?? "")
    || !UPPER_SHA256.test(receipt.LogicalDataContractSha256 ?? "")
    || receipt.GitCommit !== expectedCommit
    || receipt.SupabaseCliVersion !== backupContract.supabaseCli.version
    || receipt.SupabaseCliBinarySha256
      !== backupContract.supabaseCli.binarySha256
    || !/^v\d+\.\d+\.\d+$/.test(receipt.NodeVersion ?? "")
    || !UPPER_SHA256.test(receipt.NodeSha256 ?? "")
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(receipt.PGliteVersion ?? "")
    || !UPPER_SHA256.test(receipt.PGliteTreeSha256 ?? "")
    || !Number.isFinite(sourceCapturedAtMs)
    || !Number.isFinite(inventoryCapturedAtMs)
    || !Number.isFinite(createdAtMs)
    || sourceCapturedAtMs > inventoryCapturedAtMs
    || inventoryCapturedAtMs > createdAtMs
    || !Number.isFinite(currentAgeSeconds)
    || currentAgeSeconds < -60
    || currentAgeSeconds > maximumAgeMinutes * 60
    || !Number.isFinite(receipt.AgeSeconds)
    || receipt.AgeSeconds < 0
    || receipt.AgeSeconds > maximumAgeMinutes * 60
    || receipt.AgeSeconds > currentAgeSeconds + 60
    || receipt.TableCount !== backupContract.expectedTableCount
    || !boundedCount(receipt.TotalRows)
    || !boundedCount(receipt.PrimaryConstraintsChecked)
    || !boundedCount(receipt.ForeignKeysChecked)
    || !boundedCount(receipt.ExternalForeignKeysSkipped)
  )) {
    blocked(
      "BACKUP_RECEIPT_INVALID",
      "backup receipt does not prove the exact current-remote encrypted backup contract",
    );
  }
  if (!currentRemoteContract && (receipt.Verified !== true
      || !isAbsolute(receipt.BackupDirectory ?? "")
      || !BACKUP_SET_ID.test(receipt.BackupSetId ?? "")
      || !UPPER_SHA256.test(receipt.ManifestSha256 ?? "")
      || !UPPER_SHA256.test(receipt.SchemaContractSha256 ?? "")
      || !UPPER_SHA256.test(receipt.SourceRelationContractSha256 ?? "")
      || !Number.isFinite(Date.parse(receipt.SourceCapturedAt ?? ""))
      || !Number.isFinite(Date.parse(receipt.CreatedAtUtc ?? ""))
      || Date.parse(receipt.CreatedAtUtc) < Date.parse(receipt.SourceCapturedAt)
      || receipt.GitCommit !== expectedCommit
      || receipt.LogicalRowReplayVerified !== true
      || receipt.PlaintextWrittenToDisk !== false
      || receipt.TypedSchemaReplayed !== false
      || receipt.TableCount !== backupContract.expectedTableCount
      || receipt.ExcludedEphemeralTableCount !== 2
      || receipt.EphemeralRebuildContract !== EPHEMERAL_REBUILD_CONTRACT
      || !boundedCount(receipt.TotalRows)
      || !boundedCount(receipt.RestoredColumnCount)
      || receipt.RestoredColumnCount < receipt.TableCount
      || !boundedCount(receipt.UniqueConstraintsReplayed)
      || !boundedCount(receipt.ForeignKeysReplayed)
      || !boundedCount(receipt.ExternalForeignKeysSkipped)
      || !boundedCount(receipt.CheckConstraintsDocumented)
      || receipt.CheckConstraintsReplayed !== 0)) {
    blocked("BACKUP_RECEIPT_INVALID", "backup receipt does not prove all required verification gates");
  }

  if (currentRemoteContract) {
    const backupDirectory = await realpath(receipt.BackupDirectory).catch(() => null);
    const backupDirectoryMetadata = await lstat(receipt.BackupDirectory).catch(() => null);
    if (!backupDirectory
        || !backupDirectoryMetadata?.isDirectory()
        || backupDirectoryMetadata.isSymbolicLink()
        || inside(repoRoot, backupDirectory)
        || inside(backupSourceRepo, backupDirectory)) {
      blocked(
        "BACKUP_ARTIFACT_INVALID",
        "current-remote backup directory must be a private non-symlink directory outside Git",
      );
    }
    const expectedEntries = [
      "logical-data.json.hbam2",
      "logical-data.json.key.dpapi",
      "manifest.json",
      "schema-inventory.json.hbam2",
      "schema-inventory.json.key.dpapi",
    ];
    const entries = await readdir(backupDirectory, { withFileTypes: true })
      .catch(() => []);
    const entryNames = entries.map((entry) => entry.name).sort();
    if (entryNames.length !== expectedEntries.length
        || entryNames.some((entry, index) => entry !== expectedEntries[index])
        || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
      blocked(
        "BACKUP_ARTIFACT_INVALID",
        "current-remote backup directory does not contain the exact encrypted artifact set",
      );
    }
    const privateManifestPath = join(backupDirectory, "manifest.json");
    if (await rawFileSha256(privateManifestPath) !== receipt.ManifestSha256) {
      blocked("BACKUP_ARTIFACT_INVALID", "private backup manifest hash differs from its receipt");
    }
    const privateManifestMetadata = await lstat(privateManifestPath).catch(() => null);
    if (!privateManifestMetadata?.isFile()
        || privateManifestMetadata.isSymbolicLink()
        || privateManifestMetadata.size > MAX_BACKUP_MANIFEST_BYTES) {
      blocked("BACKUP_ARTIFACT_INVALID", "private backup manifest is missing or oversized");
    }
    const privateManifest = await readBoundedJson(
      privateManifestPath,
      "private current-remote backup manifest",
    );
    const tableNames = privateManifest.tables
      && typeof privateManifest.tables === "object"
      && !Array.isArray(privateManifest.tables)
      ? Object.keys(privateManifest.tables)
      : [];
    const cliRelativePath = privateManifest.supabase_cli?.invocation_relative_path;
    if (privateManifest.format
          !== "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser"
        || privateManifest.format_version !== 2
        || privateManifest.status !== "complete"
        || privateManifest.backup_set_id !== receipt.BackupSetId
        || privateManifest.created_at_utc !== receipt.CreatedAtUtc
        || privateManifest.source_captured_at !== receipt.SourceCapturedAt
        || privateManifest.inventory_captured_at !== receipt.InventoryCapturedAt
        || privateManifest.inventory_contract_sha256
          !== receipt.InventoryContractSha256
        || privateManifest.source_relation_contract_sha256
          !== receipt.SourceRelationContractSha256
        || privateManifest.live_schema_contract_sha256
          !== receipt.LiveSchemaContractSha256
        || privateManifest.logical_data_contract_sha256
          !== receipt.LogicalDataContractSha256
        || privateManifest.source_project_ref !== projectRef
        || privateManifest.implementation?.git_commit !== expectedCommit
        || privateManifest.supabase_cli?.version !== backupContract.supabaseCli.version
        || typeof cliRelativePath !== "string"
        || privateManifest.supabase_cli?.files?.[cliRelativePath]
          !== backupContract.supabaseCli.binarySha256
        || privateManifest.plaintext_written_to_disk !== false
        || tableNames.length !== backupContract.expectedTables.length
        || tableNames.some(
          (table, index) => table !== backupContract.expectedTables[index],
        )) {
      blocked(
        "BACKUP_ARTIFACT_INVALID",
        "private backup manifest does not bind the exact project, commit, CLI and baseline tables",
      );
    }
  }

  const clean = await requireCommandSuccess(
    runCommand,
    git,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: backupSourceRepo },
    "BACKUP_SOURCE_GIT_FAILED",
  );
  if (clean.stdout.trim()) blocked("BACKUP_SOURCE_DIRTY", "backup verifier source repo must be clean");
  const head = await requireCommandSuccess(
    runCommand,
    git,
    ["rev-parse", "HEAD"],
    { cwd: backupSourceRepo },
    "BACKUP_SOURCE_GIT_FAILED",
  );
  if (head.stdout.trim() !== receipt.GitCommit) {
    blocked("BACKUP_SOURCE_COMMIT_MISMATCH", "backup verifier source HEAD does not match its receipt");
  }
  const origin = await requireCommandSuccess(
    runCommand,
    git,
    ["remote", "get-url", "origin"],
    { cwd: backupSourceRepo },
    "BACKUP_SOURCE_GIT_FAILED",
  );
  if (origin.stdout.trim() !== backupContract.expectedOrigin) {
    blocked("BACKUP_SOURCE_ORIGIN_MISMATCH", "backup verifier checkout origin does not match the manifest");
  }
  const verifier = resolve(backupSourceRepo, backupContract.verifier.file);
  if (!inside(backupSourceRepo, verifier)) {
    blocked("BACKUP_VERIFIER_INVALID", "backup verifier path escapes its checkout");
  }
  const verifierMetadata = await lstat(verifier).catch(() => null);
  if (!verifierMetadata?.isFile() || verifierMetadata.isSymbolicLink()) {
    blocked("BACKUP_VERIFIER_INVALID", "backup verifier script is missing or is not a regular file");
  }
  if (canonicalTextHash(await readFile(verifier, "utf8")) !== backupContract.verifier.sha256) {
    blocked("BACKUP_VERIFIER_HASH_MISMATCH", "backup verifier does not match the manifest-pinned hash");
  }
  const verification = await requireCommandSuccess(
    runCommand,
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      verifier,
      "-BackupDirectory",
      receipt.BackupDirectory,
      "-ExpectedProjectRef",
      projectRef,
      "-ExpectedBackupSetId",
      receipt.BackupSetId,
      "-ExpectedManifestSha256",
      receipt.ManifestSha256,
      "-MaximumAgeMinutes",
      String(maximumAgeMinutes),
    ],
    { cwd: backupSourceRepo },
    "BACKUP_REVERIFY_FAILED",
  );
  let fresh;
  try {
    fresh = JSON.parse(verification.stdout.trim());
  } catch {
    blocked("BACKUP_REVERIFY_INVALID", "backup verifier did not return one JSON receipt");
  }
  const matchedFields = [
    "BackupSetId",
    "ManifestSha256",
    "SchemaContractSha256",
    "SourceRelationContractSha256",
    "SourceCapturedAt",
    "CreatedAtUtc",
    "ExcludedEphemeralTableCount",
    "EphemeralRebuildContract",
    "GitCommit",
    "TableCount",
    "TotalRows",
    "RestoredColumnCount",
    "UniqueConstraintsReplayed",
    "ForeignKeysReplayed",
    "ExternalForeignKeysSkipped",
    "CheckConstraintsDocumented",
    "CheckConstraintsReplayed",
    "TypedSchemaReplayed",
    "PlaintextWrittenToDisk",
  ];
  if (currentRemoteContract) {
    const immutableKeys = currentRemoteReceiptKeys.filter((key) => key !== "AgeSeconds");
    const freshAge = fresh?.AgeSeconds;
    if (!hasExactKeys(fresh, currentRemoteReceiptKeys)
        || immutableKeys.some((field) => fresh[field] !== receipt[field])
        || !Number.isFinite(freshAge)
        || freshAge < Math.max(0, receipt.AgeSeconds - 1)
        || freshAge > maximumAgeMinutes * 60
        || freshAge < currentAgeSeconds - 60
        || freshAge > currentAgeSeconds + 10 * 60) {
      blocked(
        "BACKUP_REVERIFY_MISMATCH",
        "fresh current-remote backup verification differs from the supplied receipt",
      );
    }
  } else if (fresh.Verified !== true
      || fresh.LogicalRowReplayVerified !== true
      || matchedFields.some((field) => fresh[field] !== receipt[field])) {
    blocked("BACKUP_REVERIFY_MISMATCH", "fresh backup verification does not match the supplied receipt");
  }
  return {
    ...receipt,
    ...(currentRemoteContract
      ? {
        SchemaContractSha256: receipt.LiveSchemaContractSha256,
        SourceRelationContractSha256: receipt.LogicalDataContractSha256,
      }
      : {}),
    SupabaseCliVersion: backupContract.supabaseCli.version,
    SupabaseCliBinarySha256: backupContract.supabaseCli.binarySha256,
  };
}

async function validateHostedRestoreEvidence({
  repoRoot,
  backupReceiptPath,
  backupReceipt,
  manifest,
  expectedCommit,
  now,
  enforceFreshness = true,
}) {
  const contract = manifest.backupContract.hostedRestoreEvidence;
  const path = resolve(dirname(backupReceiptPath), contract.receiptFileName);
  if (dirname(path) !== resolve(dirname(backupReceiptPath)) || inside(repoRoot, path)) {
    blocked("HOSTED_RESTORE_EVIDENCE_INVALID", "hosted restore evidence path is invalid");
  }
  const receipt = await readBoundedJson(path, "hosted restore evidence").catch((error) => {
    if (error instanceof ReleaseBlockedError) {
      blocked(
        "HOSTED_RESTORE_EVIDENCE_REQUIRED",
        "an isolated hosted typed restore receipt is required",
      );
    }
    throw error;
  });
  const exactKeys = [
    "backupManifestSha256",
    "backupSetId",
    "checks",
    "containsSensitiveValues",
    "providerRestoreJobId",
    "receiptVersion",
    "release",
    "releaseCommit",
    "restoreCompletedAt",
    "sourceDataContractSha256",
    "sourceProjectRef",
    "sourceSchemaContractSha256",
    "targetDataContractSha256",
    "targetProjectRef",
    "targetSchemaContractSha256",
    "verifiedAt",
  ];
  const verifiedAtMs = Date.parse(receipt.verifiedAt ?? "");
  const completedAtMs = Date.parse(receipt.restoreCompletedAt ?? "");
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  const checksValid = hasExactKeys(receipt.checks, HOSTED_RESTORE_REQUIRED_CHECKS)
    && HOSTED_RESTORE_REQUIRED_CHECKS.every((name) => receipt.checks[name] === true);
  if (containsSecretLikeField(receipt)
      || !hasExactKeys(receipt, exactKeys)
      || receipt.receiptVersion !== 1
      || receipt.release !== manifest.release
      || receipt.releaseCommit !== expectedCommit
      || receipt.sourceProjectRef !== manifest.projectRef
      || !PROJECT_REF.test(receipt.targetProjectRef ?? "")
      || receipt.targetProjectRef === manifest.projectRef
      || receipt.backupSetId !== backupReceipt.BackupSetId
      || receipt.backupManifestSha256 !== backupReceipt.ManifestSha256
      || receipt.sourceSchemaContractSha256 !== backupReceipt.SchemaContractSha256
      || receipt.targetSchemaContractSha256 !== backupReceipt.SchemaContractSha256
      || receipt.sourceDataContractSha256 !== backupReceipt.SourceRelationContractSha256
      || receipt.targetDataContractSha256 !== backupReceipt.SourceRelationContractSha256
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(receipt.providerRestoreJobId ?? "")
      || !Number.isFinite(nowMs)
      || !Number.isFinite(completedAtMs)
      || !Number.isFinite(verifiedAtMs)
      || completedAtMs < Date.parse(backupReceipt.CreatedAtUtc)
      || verifiedAtMs < completedAtMs
      || verifiedAtMs > nowMs + 5 * 60_000
      || (enforceFreshness
        && nowMs - verifiedAtMs > contract.maximumAgeMinutes * 60_000)
      || !checksValid
      || receipt.containsSensitiveValues !== false) {
    blocked(
      "HOSTED_RESTORE_EVIDENCE_INVALID",
      "hosted restore evidence does not prove isolated typed schema, data, RLS, RPC, Storage and Auth recovery",
    );
  }
  return {
    sha256: boundedJsonSha256(receipt, "hosted restore evidence"),
    targetProjectRef: receipt.targetProjectRef,
    restoreCompletedAt: receipt.restoreCompletedAt,
    verifiedAt: receipt.verifiedAt,
    checkCount: HOSTED_RESTORE_REQUIRED_CHECKS.length,
  };
}

async function validateWriteFenceReceipt({
  repoRoot,
  backupReceiptPath,
  backupReceipt,
  manifest,
  expectedCommit,
  now,
  enforceFreshness = true,
}) {
  const receiptPath = resolve(
    dirname(backupReceiptPath),
    manifest.manualControlEvidence.receiptFileName,
  );
  if (dirname(receiptPath) !== resolve(dirname(backupReceiptPath))) {
    blocked("WRITE_FENCE_RECEIPT_INVALID", "write-fence receipt path escapes its receipt set");
  }
  const receipt = await readBoundedJson(receiptPath, "production write-fence receipt")
    .catch((error) => {
      if (error instanceof ReleaseBlockedError) {
        blocked("WRITE_FENCE_RECEIPT_INVALID", "production write-fence receipt is missing or invalid");
      }
      throw error;
    });
  if (containsSecretLikeField(receipt)) {
    blocked("WRITE_FENCE_RECEIPT_SECRET_FIELD", "write-fence receipt contains a forbidden secret-like field");
  }

  const rootKeys = [
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
  ];
  const controlKeys = [
    "supabaseAuthSignupDisabled",
    "vercelDeploymentCommit",
    "vercelProductionWriteFenceEnabled",
  ];
  const storageDrainKeys = [
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
  ];
  const databaseWriteFenceKeys = [
    "attachFunctionCount",
    "eventTriggerCount",
    "guardFunctionCount",
    "liveSchemaContractFunctionCount",
    "publicTableCount",
    "triggerCount",
  ];
  const providerBackupKeys = [
    "ageSeconds",
    "insertedAt",
    "isPhysicalBackup",
    "latestPhysicalBackupDateUnix",
    "restoreCandidateAvailable",
    "status",
  ];
  const exactKeys = (value, expected) =>
    value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
  const verifiedAtMs = Date.parse(receipt.verifiedAt ?? "");
  const nowMs = now().getTime();
  const maximumAgeMs = manifest.manualControlEvidence.maximumAgeMinutes * 60_000;
  const expectedOperations = manifest.manualPlatformOperations
    .filter((operation) => operation.phase === "pre-backup");
  const operationsValid = Array.isArray(receipt.operations)
    && receipt.operations.length === expectedOperations.length
    && receipt.operations.every((operation, index) => {
      const expected = expectedOperations[index];
      return exactKeys(operation, [
        "applyArtifactSha256",
        "operationId",
        "verificationCheckId",
        "verified",
      ])
        && operation.operationId === expected.id
        && operation.verificationCheckId === expected.verificationCheckId
        && operation.applyArtifactSha256 === expected.sha256
      && operation.verified === true;
    });
  const expectedForwardOperations = manifest.forwardOnlySecurityOperations;
  const forwardOperationsValid = Array.isArray(
    receipt.forwardOnlySecurityOperations,
  )
    && receipt.forwardOnlySecurityOperations.length
      === expectedForwardOperations.length
    && receipt.forwardOnlySecurityOperations.every((operation, index) => {
      const expected = expectedForwardOperations[index];
      return hasExactKeys(operation, [
        "applyArtifactSha256",
        "expectedEvidence",
        "inventoryArtifactSha256",
        "operationId",
        "rollbackPolicy",
        "verificationCheckId",
        "verified",
        "verifyArtifactSha256",
      ])
        && operation.operationId === expected.id
        && operation.verificationCheckId === expected.verificationCheckId
        && operation.inventoryArtifactSha256 === expected.inventory.sha256
        && operation.applyArtifactSha256 === expected.apply.sha256
        && operation.verifyArtifactSha256 === expected.verify.sha256
        && hasExactKeys(
          operation.expectedEvidence,
          Object.keys(expected.verify.expectedEvidence),
        )
        && Object.entries(expected.verify.expectedEvidence).every(
          ([name, value]) => operation.expectedEvidence[name] === value,
        )
        && operation.rollbackPolicy === expected.rollbackPolicy
        && operation.verified === true;
    });
  let storageDrain;
  try {
    storageDrain = await validateCompletedStorageDrainEvidence({
      repoRoot,
      receiptDirectory: dirname(backupReceiptPath),
      manifest,
      expectedCommit,
      now,
      backupSourceCapturedAt: backupReceipt.SourceCapturedAt,
      backupCreatedAt: backupReceipt.CreatedAtUtc,
      enforceFreshness,
    });
  } catch {
    blocked(
      "WRITE_FENCE_RECEIPT_INVALID",
      "write-fence receipt does not bind the completed signed-upload drain before backup",
    );
  }

  if (!exactKeys(receipt, rootKeys)
      || receipt.receiptVersion !== 1
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.backupSetId !== backupReceipt.BackupSetId
      || receipt.backupManifestSha256 !== backupReceipt.ManifestSha256
      || receipt.containsSensitiveValues !== false
      || !Number.isFinite(verifiedAtMs)
      || verifiedAtMs > nowMs + 5 * 60_000
      || (enforceFreshness && nowMs - verifiedAtMs > maximumAgeMs)
      || !exactKeys(receipt.controls, controlKeys)
      || receipt.controls.vercelProductionWriteFenceEnabled !== true
      || receipt.controls.vercelDeploymentCommit !== expectedCommit
      || receipt.controls.supabaseAuthSignupDisabled !== true
      || !exactKeys(receipt.providerPhysicalBackup, providerBackupKeys)
      || receipt.providerPhysicalBackup.status
        !== manifest.backupContract.providerPhysicalBackup.requiredStatus
      || receipt.providerPhysicalBackup.isPhysicalBackup
        !== manifest.backupContract.providerPhysicalBackup.requirePhysicalBackup
      || receipt.providerPhysicalBackup.restoreCandidateAvailable !== true
      || !Number.isSafeInteger(receipt.providerPhysicalBackup.latestPhysicalBackupDateUnix)
      || !Number.isSafeInteger(receipt.providerPhysicalBackup.ageSeconds)
      || receipt.providerPhysicalBackup.ageSeconds < 0
      || (enforceFreshness
        && receipt.providerPhysicalBackup.ageSeconds
          > manifest.backupContract.providerPhysicalBackup.maximumAgeHours * 3600)
      || !Number.isFinite(Date.parse(receipt.providerPhysicalBackup.insertedAt ?? ""))
      || Math.abs(
        Date.parse(receipt.providerPhysicalBackup.insertedAt)
          - receipt.providerPhysicalBackup.latestPhysicalBackupDateUnix * 1000,
      ) > 15 * 60_000
      || receipt.providerPhysicalBackup.ageSeconds !== Math.floor(
        (verifiedAtMs
          - receipt.providerPhysicalBackup.latestPhysicalBackupDateUnix * 1000) / 1000,
      )
      || !exactKeys(receipt.storageSignedUploadDrain, storageDrainKeys)
      || receipt.storageSignedUploadDrain.receiptSha256 !== storageDrain.sha256
      || receipt.storageSignedUploadDrain.startReceiptSha256
        !== storageDrain.startReceiptSha256
      || receipt.storageSignedUploadDrain.freezeVerifiedAt !== storageDrain.freezeVerifiedAt
      || !exactKeys(receipt.storageSignedUploadDrain.preBackupControls, controlKeys)
      || receipt.storageSignedUploadDrain.preBackupControls
        .vercelProductionWriteFenceEnabled !== true
      || receipt.storageSignedUploadDrain.preBackupControls.vercelDeploymentCommit
        !== expectedCommit
      || receipt.storageSignedUploadDrain.preBackupControls.supabaseAuthSignupDisabled !== true
      || !exactKeys(
        receipt.storageSignedUploadDrain.databaseWriteFence,
        databaseWriteFenceKeys,
      )
      || receipt.storageSignedUploadDrain.databaseWriteFence.publicTableCount
        !== storageDrain.databaseWriteFence.publicTableCount
      || receipt.storageSignedUploadDrain.databaseWriteFence.triggerCount
        !== storageDrain.databaseWriteFence.triggerCount
      || receipt.storageSignedUploadDrain.databaseWriteFence.guardFunctionCount !== 1
      || receipt.storageSignedUploadDrain.databaseWriteFence.attachFunctionCount !== 1
      || receipt.storageSignedUploadDrain.databaseWriteFence
        .liveSchemaContractFunctionCount !== 1
      || receipt.storageSignedUploadDrain.databaseWriteFence.eventTriggerCount !== 2
      || receipt.storageSignedUploadDrain.firstStableSnapshotAt
        !== storageDrain.firstStableSnapshotAt
      || receipt.storageSignedUploadDrain.secondStableSnapshotAt
        !== storageDrain.secondStableSnapshotAt
      || receipt.storageSignedUploadDrain.totalObjectCount !== storageDrain.totalObjectCount
      || receipt.storageSignedUploadDrain.objectInventorySha256
        !== storageDrain.objectInventorySha256
      || receipt.storageSignedUploadDrain.mutationPolicyCount !== 0
      || !operationsValid
      || !forwardOperationsValid) {
    blocked(
      "WRITE_FENCE_RECEIPT_INVALID",
      "write-fence receipt does not prove the exact web, Auth, backup and manual-operation gates",
    );
  }

  return {
    sha256: boundedJsonSha256(receipt, "production write-fence receipt"),
    verifiedAt: receipt.verifiedAt,
    operationIds: receipt.operations.map((operation) => operation.operationId),
    forwardOnlyOperationIds:
      receipt.forwardOnlySecurityOperations.map((operation) => operation.operationId),
    controlCount: controlKeys.length,
    storageDrain,
  };
}

function hasExactKeys(value, expectedKeys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort());
}

function textSha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function remoteLeaseSql({
  action,
  manifest,
  expectedCommit,
  ownerId,
  outcomePathSha256,
  expectedSystemIdentifier,
}) {
  if (!RELEASE_LEASE_OWNER.test(ownerId ?? "")
      || !SHA256.test(outcomePathSha256 ?? "")
      || !/^\d{10,32}$/.test(expectedSystemIdentifier ?? "")) {
    blocked("REMOTE_RELEASE_LEASE_ARGUMENT_INVALID", "remote release lease identity is invalid");
  }
  const databaseIdentityPredicate = `(SELECT system_identifier::text
      FROM pg_catalog.pg_control_system()) = '${expectedSystemIdentifier}'`;
  const exactPredicate = `
    singleton = true
    AND release_id = '${manifest.release}'
    AND release_commit = '${expectedCommit}'
    AND owner_id = '${ownerId}'::uuid
    AND outcome_path_sha256 = '${outcomePathSha256}'
    AND ${databaseIdentityPredicate}`;
  const statements = {
    claim: `
WITH claimed AS (
  INSERT INTO public.production_release_lease_20260717 (
    singleton, release_id, release_commit, owner_id, outcome_path_sha256, phase
  ) SELECT
    true, '${manifest.release}', '${expectedCommit}', '${ownerId}'::uuid,
    '${outcomePathSha256}', 'claimed'
  WHERE ${databaseIdentityPredicate}
  ON CONFLICT (singleton) DO NOTHING
  RETURNING 1
)
SELECT count(*)::integer AS remote_release_lease_claim_count FROM claimed;`,
    verify_claimed: `
SELECT count(*)::integer AS remote_release_lease_verify_claimed_count
FROM public.production_release_lease_20260717
WHERE ${exactPredicate}
  AND phase = 'claimed';`,
    mark_awaiting: `
WITH changed AS (
  UPDATE public.production_release_lease_20260717
  SET phase = 'awaiting-post-push', updated_at = statement_timestamp()
  WHERE ${exactPredicate}
    AND phase = 'claimed'
  RETURNING 1
)
SELECT count(*)::integer AS remote_release_lease_mark_awaiting_count FROM changed;`,
    verify_awaiting: `
SELECT count(*)::integer AS remote_release_lease_verify_awaiting_count
FROM public.production_release_lease_20260717
WHERE ${exactPredicate}
  AND phase = 'awaiting-post-push';`,
    mark_deploying_from_claimed: `
WITH changed AS (
  UPDATE public.production_release_lease_20260717
  SET phase = 'deployment-canary', updated_at = statement_timestamp()
  WHERE ${exactPredicate}
    AND phase = 'claimed'
  RETURNING 1
)
SELECT count(*)::integer
  AS remote_release_lease_mark_deploying_from_claimed_count
FROM changed;`,
    mark_deploying_from_awaiting: `
WITH changed AS (
  UPDATE public.production_release_lease_20260717
  SET phase = 'deployment-canary', updated_at = statement_timestamp()
  WHERE ${exactPredicate}
    AND phase = 'awaiting-post-push'
  RETURNING 1
)
SELECT count(*)::integer
  AS remote_release_lease_mark_deploying_from_awaiting_count
FROM changed;`,
    verify_deploying: `
SELECT count(*)::integer AS remote_release_lease_verify_deploying_count
FROM public.production_release_lease_20260717
WHERE ${exactPredicate}
  AND phase = 'deployment-canary';`,
    release: `
WITH removed AS (
  DELETE FROM public.production_release_lease_20260717
  WHERE ${exactPredicate}
  RETURNING 1
)
SELECT count(*)::integer AS remote_release_lease_release_count FROM removed;`,
    verify_empty: `
SELECT (${databaseIdentityPredicate}
        AND count(*) = 0)::integer AS remote_release_lease_verify_empty_count
FROM public.production_release_lease_20260717;`,
  };
  const statement = statements[action];
  if (!statement) {
    blocked("REMOTE_RELEASE_LEASE_ARGUMENT_INVALID", "remote release lease action is invalid");
  }
  return `BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';\n${statement}\nCOMMIT;\n`;
}

async function runRemoteReleaseLease({
  action,
  repoRoot,
  receiptOut,
  manifest,
  expectedCommit,
  ownerId,
  outcomePathSha256,
  runCommand,
  supabaseCli,
  assertLinkedRef,
}) {
  const sql = remoteLeaseSql({
    action,
    manifest,
    expectedCommit,
    ownerId,
    outcomePathSha256,
    expectedSystemIdentifier: productionDatabaseSystemIdentifier(
      manifest.projectRef,
      { allowTest: runCommand !== defaultRunCommand },
    ),
  });
  if (sql.length > 8_000) {
    blocked("REMOTE_RELEASE_LEASE_QUERY_INVALID", "remote release lease SQL exceeds its direct-argument bound");
  }
  await assertLinkedRef();
  const result = await requireCommandSuccess(
    runCommand,
    supabaseCli,
    [
      "db", "query", "--linked", sql, "--output", "json",
      "--agent", "no", "--workdir", repoRoot,
    ],
    { cwd: repoRoot },
    "REMOTE_RELEASE_LEASE_QUERY_FAILED",
  );
  await assertLinkedRef();
  let rows;
  try {
    rows = JSON.parse(result.stdout.trim());
  } catch {
    blocked("REMOTE_RELEASE_LEASE_RESULT_INVALID", "remote release lease query returned invalid JSON");
  }
  const key = `remote_release_lease_${action}_count`;
  if (!Array.isArray(rows)
      || rows.length !== 1
      || !hasExactKeys(rows[0], [key])
      || rows[0][key] !== 1) {
    const code = action === "claim"
      ? "REMOTE_RELEASE_LEASE_HELD"
      : "REMOTE_RELEASE_LEASE_MISMATCH";
    blocked(code, "remote production release lease is held or no longer matches this controller");
  }
}

async function validateReleaseLock({
  lockPath,
  outcomeReceiptPath,
  manifest,
  expectedCommit,
}) {
  const lock = await readBoundedJson(lockPath, "production release lock").catch((error) => {
    if (error instanceof ReleaseBlockedError) {
      blocked("RESUME_LOCK_INVALID", "resume requires the exact retained production release lock");
    }
    throw error;
  });
  if (!hasExactKeys(lock, [
    "outcomeReceiptPathSha256",
    "projectRef",
    "release",
    "releaseCommit",
    "remoteReleaseLeaseOwnerId",
    "rerunProhibitedUntilAdjudicated",
    "startedAt",
    "version",
  ])
      || lock.version !== 2
      || lock.release !== manifest.release
      || lock.projectRef !== manifest.projectRef
      || lock.releaseCommit !== expectedCommit
      || lock.outcomeReceiptPathSha256 !== textSha256(resolve(outcomeReceiptPath))
      || !RELEASE_LEASE_OWNER.test(lock.remoteReleaseLeaseOwnerId ?? "")
      || lock.rerunProhibitedUntilAdjudicated !== true
      || !Number.isFinite(Date.parse(lock.startedAt ?? ""))) {
    blocked("RESUME_LOCK_INVALID", "retained production release lock does not bind this exact outcome");
  }
  return lock;
}

async function validateAwaitingOutcomeReceipt({
  path,
  manifest,
  expectedCommit,
  remoteRef,
  expectedMigrations,
  backupReceipt,
}) {
  const receipt = await readBoundedJson(path, "awaiting production release outcome").catch((error) => {
    if (error instanceof ReleaseBlockedError) {
      blocked("AWAITING_OUTCOME_INVALID", "resume requires the retained awaiting outcome receipt");
    }
    throw error;
  });
  const preOperationIds = manifest.manualPlatformOperations
    .filter((operation) => operation.phase === "pre-backup")
    .map((operation) => operation.id);
  const postOperationIds = manifest.manualPlatformOperations
    .filter((operation) => operation.phase === "post-push-pre-deploy")
    .map((operation) => operation.id);
  const forwardOnlyOperationIds = manifest.forwardOnlySecurityOperations
    .map((operation) => operation.id);
  const arraysEqual = (left, right) => Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
  const receiptForSecretScan = { ...receipt };
  delete receiptForSecretScan.containsSecrets;
  if (containsSecretLikeField(receiptForSecretScan)
      || receipt.receiptVersion !== 1
      || receipt.status !== "awaiting_manual_post_push_operations"
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.remoteRef !== remoteRef
      || !arraysEqual(receipt.migrations, expectedMigrations)
      || receipt.backupSetId !== backupReceipt.BackupSetId
      || receipt.backupManifestSha256 !== backupReceipt.ManifestSha256
      || receipt.backupGitCommit !== backupReceipt.GitCommit
      || receipt.backupContractId !== manifest.backupContract.id
      || receipt.backupContractVersion !== manifest.backupContract.version
      || !arraysEqual(receipt.verifiedManualOperationIds, preOperationIds)
      || receipt.verifiedManualOperationCount !== preOperationIds.length
      || !arraysEqual(receipt.pendingManualOperationIds, postOperationIds)
      || receipt.pendingManualOperationCount !== postOperationIds.length
      || !arraysEqual(
        receipt.forwardOnlySecurityOperationIds,
        forwardOnlyOperationIds,
      )
      || receipt.forwardOnlySecurityOperationCount
        !== forwardOnlyOperationIds.length
      || !Array.isArray(receipt.forwardOnlySecurityCheckEvidence)
      || receipt.forwardOnlySecurityCheckEvidence.length
        !== forwardOnlyOperationIds.length
      || receipt.forwardOnlySecurityCheckEvidence.some((entry, index) =>
        entry?.id !== forwardOnlyOperationIds[index]
        || !hasExactKeys(entry, ["evidence", "id"])
        || !hasExactKeys(
          entry.evidence,
          Object.keys(
            manifest.forwardOnlySecurityOperations[index].verify.expectedEvidence,
          ),
        )
        || Object.entries(
          manifest.forwardOnlySecurityOperations[index].verify.expectedEvidence,
        ).some(([name, value]) => entry.evidence[name] !== value))
      || receipt.postPendingCount !== 0
      || !Number.isSafeInteger(receipt.postRemoteLedgerCount)
      || receipt.postRemoteLedgerCount < 1
      || !SHA256.test(receipt.postRemoteLedgerSha256 ?? "")
      || receipt.rerunProhibited !== true
      || receipt.containsSecrets !== false) {
    blocked(
      "AWAITING_OUTCOME_INVALID",
      "retained outcome is not the exact post-push checkpoint for this release and backup",
    );
  }
  return {
    receipt,
    sha256: boundedJsonSha256(receipt, "awaiting production release outcome"),
    postOperationIds,
  };
}

async function validatePostPushEvidenceReceipt({
  backupReceiptPath,
  backupReceipt,
  awaitingOutcome,
  manifest,
  expectedCommit,
  now,
}) {
  const receiptPath = resolve(
    dirname(backupReceiptPath),
    manifest.manualControlEvidence.postPushReceiptFileName,
  );
  if (dirname(receiptPath) !== resolve(dirname(backupReceiptPath))) {
    blocked("POST_PUSH_EVIDENCE_INVALID", "post-push evidence path escapes its receipt set");
  }
  const receipt = await readBoundedJson(receiptPath, "post-push platform evidence").catch((error) => {
    if (error instanceof ReleaseBlockedError) {
      blocked("POST_PUSH_EVIDENCE_INVALID", "post-push platform evidence is missing or invalid");
    }
    throw error;
  });
  const rootKeys = [
    "awaitingOutcomeReceiptSha256",
    "backupManifestSha256",
    "backupSetId",
    "containsSensitiveValues",
    "controls",
    "operations",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "verifiedAt",
  ];
  const controlKeys = [
    "supabaseAuthSignupDisabled",
    "vercelDeploymentCommit",
    "vercelProductionWriteFenceEnabled",
  ];
  const verifiedAtMs = Date.parse(receipt.verifiedAt ?? "");
  const nowMs = now().getTime();
  const maximumAgeMs = manifest.manualControlEvidence.maximumAgeMinutes * 60_000;
  const expectedOperations = manifest.manualPlatformOperations
    .filter((operation) => operation.phase === "post-push-pre-deploy");
  const operationsValid = Array.isArray(receipt.operations)
    && receipt.operations.length === expectedOperations.length
    && receipt.operations.every((operation, index) => {
      const expected = expectedOperations[index];
      return hasExactKeys(operation, [
        "applyArtifactSha256",
        "operationId",
        "verificationCheckId",
        "verified",
      ])
        && operation.operationId === expected.id
        && operation.verificationCheckId === expected.verificationCheckId
        && operation.applyArtifactSha256 === expected.sha256
        && operation.verified === true;
    });
  if (containsSecretLikeField(receipt)
      || !hasExactKeys(receipt, rootKeys)
      || receipt.receiptVersion !== 1
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.backupSetId !== backupReceipt.BackupSetId
      || receipt.backupManifestSha256 !== backupReceipt.ManifestSha256
      || receipt.awaitingOutcomeReceiptSha256 !== awaitingOutcome.sha256
      || receipt.containsSensitiveValues !== false
      || !Number.isFinite(verifiedAtMs)
      || verifiedAtMs > nowMs + 5 * 60_000
      || nowMs - verifiedAtMs > maximumAgeMs
      || !hasExactKeys(receipt.controls, controlKeys)
      || receipt.controls.vercelProductionWriteFenceEnabled !== true
      || receipt.controls.vercelDeploymentCommit !== expectedCommit
      || receipt.controls.supabaseAuthSignupDisabled !== true
      || !operationsValid) {
    blocked(
      "POST_PUSH_EVIDENCE_INVALID",
      "post-push evidence does not bind the exact release checkpoint and operations",
    );
  }
  return {
    sha256: boundedJsonSha256(receipt, "post-push platform evidence"),
    verifiedAt: receipt.verifiedAt,
    operationIds: receipt.operations.map((operation) => operation.operationId),
  };
}

async function rawFileSha256(path) {
  return await new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex").toUpperCase()));
  });
}

function cliPackageCandidates() {
  if (process.platform === "win32" && ["x64", "arm64"].includes(process.arch)) {
    return [`cli-windows-${process.arch}`];
  }
  if (process.platform === "darwin" && ["x64", "arm64"].includes(process.arch)) {
    return [`cli-darwin-${process.arch}`];
  }
  if (process.platform === "linux" && ["x64", "arm64"].includes(process.arch)) {
    return [`cli-linux-${process.arch}`, `cli-linux-${process.arch}-musl`];
  }
  blocked("SUPABASE_CLI_PLATFORM_UNSUPPORTED", "this host platform has no approved Supabase CLI package");
}

async function resolvePinnedSupabaseCli(repoRoot, backupReceipt) {
  if (process.env.SUPABASE_CLI_BINARY_OVERRIDE) {
    blocked("SUPABASE_CLI_OVERRIDE_FORBIDDEN", "SUPABASE_CLI_BINARY_OVERRIDE is forbidden for production release");
  }
  const rootPackage = await readBoundedJson(join(repoRoot, "package.json"), "root package manifest");
  const wrapperPackagePath = join(repoRoot, "node_modules", "supabase", "package.json");
  const wrapperPackage = await readBoundedJson(
    wrapperPackagePath,
    "installed Supabase CLI package manifest",
  );
  const expectedVersion = rootPackage?.devDependencies?.supabase;
  if (expectedVersion !== backupReceipt.SupabaseCliVersion
      || wrapperPackage?.version !== expectedVersion) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "Supabase CLI version differs from package and backup provenance");
  }

  const installed = [];
  const wrapperDirectory = await realpath(dirname(wrapperPackagePath)).catch(() => null);
  if (!wrapperDirectory || !inside(repoRoot, wrapperDirectory)) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "Supabase CLI wrapper resolved outside the repository");
  }
  const wrapperDependencyRoot = dirname(wrapperDirectory);
  for (const candidate of cliPackageCandidates()) {
    const packagePath = join(wrapperDependencyRoot, "@supabase", candidate, "package.json");
    const packageMetadata = await lstat(packagePath).catch(() => null);
    if (!packageMetadata?.isFile()) continue;
    const packageManifest = await readBoundedJson(packagePath, "native Supabase CLI package manifest");
    if (packageManifest.version !== expectedVersion) {
      blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "native Supabase CLI package version is not pinned");
    }
    installed.push(join(
      dirname(packagePath),
      "bin",
      `supabase${process.platform === "win32" ? ".exe" : ""}`,
    ));
  }
  if (installed.length !== 1) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "exactly one native Supabase CLI package must be installed");
  }
  const binaryPath = installed[0];
  const binaryMetadata = await lstat(binaryPath).catch(() => null);
  if (!binaryMetadata?.isFile() || binaryMetadata.isSymbolicLink()) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "native Supabase CLI binary is missing or not a regular file");
  }
  if (await rawFileSha256(binaryPath) !== backupReceipt.SupabaseCliBinarySha256) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "native Supabase CLI binary hash differs from the verified backup provenance");
  }
  return binaryPath;
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parsePendingMigrations(output) {
  const found = [];
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const match = line.trim().match(/^(?:[•?*+-]\s*)?(\d{14}_[a-z0-9][a-z0-9_.-]*\.sql)$/i);
    if (match) found.push(match[1]);
  }
  return found;
}

function assertDryRunRecognized(output, code, { allowUpToDate = false } = {}) {
  const normalized = stripAnsi(output);
  if (!/\bDRY\s+RUN\b/i.test(normalized)
      && !(allowUpToDate && /remote\s+database\s+is\s+up\s+to\s+date/i.test(normalized))) {
    blocked(code, `${code}: Supabase dry-run output marker was not recognized`);
  }
}

function assertExactOrdered(actual, expected, code) {
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    blocked(code, `${code}: remote migration set or order differs from the manifest`);
  }
}

function parseRemoteLedger(output) {
  const versions = [];
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const columns = line.split("|");
    if (columns.length >= 3 && /^\d{14}$/.test(columns[1].trim())) {
      versions.push(columns[1].trim());
    }
  }
  return versions;
}

async function createLinkedRefFence(repoRoot, expectedRef) {
  const path = join(repoRoot, "supabase", ".temp", "project-ref");
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()) {
    blocked("LINKED_REF_INVALID", "Supabase linked project ref is missing or not a regular file");
  }
  const content = (await readFile(path, "utf8")).trim();
  if (content !== expectedRef) blocked("LINKED_REF_MISMATCH", "Supabase is linked to a different project");
  const fingerprint = `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}`;
  return async () => {
    const current = await lstat(path).catch(() => null);
    const currentContent = current?.isFile() ? (await readFile(path, "utf8")).trim() : "";
    const currentFingerprint = current
      ? `${current.dev}:${current.ino}:${current.size}:${current.mtimeMs}`
      : "missing";
    if (currentContent !== expectedRef || currentFingerprint !== fingerprint) {
      blocked("LINKED_REF_CHANGED", "linked project ref changed during the release attempt");
    }
  };
}

async function writeReceipt(path, receipt, { exclusive = false } = {}) {
  const content = `${JSON.stringify(receipt, null, 2)}\n`;
  if (exclusive) {
    const handle = await open(path, "wx", 0o600).catch(() => null);
    if (!handle) blocked("RECEIPT_PATH_EXISTS", "release receipt path must not already exist");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return;
  }
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function runPostPushResume({
  repoRoot,
  options,
  manifest,
  expectedMigrations,
  postPushChecks,
  postApplyChecks,
  forwardOnlyChecks,
  lockPath,
  runCommand,
  now,
  refreshSuccessorRuntimeEvidence = () => null,
}) {
  const releaseLock = await validateReleaseLock({
    lockPath,
    outcomeReceiptPath: options.receiptOut,
    manifest,
    expectedCommit: options.expectedCommit,
  });
  const resumeLeasePath = `${lockPath}.resume`;
  const resumeLease = await open(resumeLeasePath, "wx", 0o600).catch(() => null);
  if (!resumeLease) {
    blocked("RESUME_ALREADY_RUNNING", "another post-push resume attempt is already running");
  }
  try {
    await resumeLease.writeFile(`${JSON.stringify({
      version: 2,
      release: manifest.release,
      projectRef: manifest.projectRef,
      releaseCommit: options.expectedCommit,
      remoteReleaseLeaseOwnerId: releaseLock.remoteReleaseLeaseOwnerId,
      outcomeReceiptPathSha256: releaseLock.outcomeReceiptPathSha256,
      processId: process.pid,
      resumedAt: now().toISOString(),
    })}\n`, "utf8");
    await resumeLease.sync();
    const assertLinkedRef = await createLinkedRefFence(repoRoot, manifest.projectRef);
    const backupReceipt = await validateBackupReceipt({
      path: options.backupReceipt,
      repoRoot,
      backupSourceRepo: options.backupSourceRepo,
      backupContract: manifest.backupContract,
      expectedCommit: options.expectedCommit,
      projectRef: manifest.projectRef,
      runCommand,
      maximumAgeMinutes: MAX_BACKUP_RESUME_AGE_MINUTES,
    });
    const hostedRestoreEvidence = await validateHostedRestoreEvidence({
      repoRoot,
      backupReceiptPath: options.backupReceipt,
      backupReceipt,
      manifest,
      expectedCommit: options.expectedCommit,
      now,
      enforceFreshness: false,
    });
    const writeFenceEvidence = await validateWriteFenceReceipt({
      repoRoot,
      backupReceiptPath: options.backupReceipt,
      backupReceipt,
      manifest,
      expectedCommit: options.expectedCommit,
      now,
      enforceFreshness: false,
    });
    const awaitingOutcome = await validateAwaitingOutcomeReceipt({
      path: options.receiptOut,
      manifest,
      expectedCommit: options.expectedCommit,
      remoteRef: options.remoteRef,
      expectedMigrations,
      backupReceipt,
    });
    if (awaitingOutcome.receipt.writeFenceEvidenceSha256 !== writeFenceEvidence.sha256
        || awaitingOutcome.receipt.writeFenceEvidenceVerifiedAt
          !== writeFenceEvidence.verifiedAt
        || awaitingOutcome.receipt.remoteReleaseLeaseOwnerId
          !== releaseLock.remoteReleaseLeaseOwnerId
        || awaitingOutcome.receipt.remoteReleaseLeaseOutcomePathSha256
          !== releaseLock.outcomeReceiptPathSha256
        || awaitingOutcome.receipt.remoteReleaseLeasePhase !== "awaiting-post-push") {
      blocked(
        "AWAITING_OUTCOME_INVALID",
        "retained outcome no longer binds the exact pre-push write-fence evidence",
      );
    }
    if (awaitingOutcome.receipt.hostedRestoreEvidenceSha256
          !== hostedRestoreEvidence.sha256
        || awaitingOutcome.receipt.hostedRestoreTargetProjectRef
          !== hostedRestoreEvidence.targetProjectRef
        || awaitingOutcome.receipt.hostedRestoreEvidenceVerifiedAt
          !== hostedRestoreEvidence.verifiedAt) {
      blocked(
        "AWAITING_OUTCOME_INVALID",
        "retained outcome no longer binds the isolated hosted restore evidence",
      );
    }
    const supabaseCli = await resolvePinnedSupabaseCli(repoRoot, backupReceipt);
    let recoveredRemoteDeployingPhase = false;
    try {
      await runRemoteReleaseLease({
        action: "verify_awaiting",
        repoRoot,
        receiptOut: options.receiptOut,
        manifest,
        expectedCommit: options.expectedCommit,
        ownerId: releaseLock.remoteReleaseLeaseOwnerId,
        outcomePathSha256: releaseLock.outcomeReceiptPathSha256,
        runCommand,
        supabaseCli,
        assertLinkedRef,
      });
    } catch (error) {
      if (!(error instanceof ReleaseBlockedError)
          || error.code !== "REMOTE_RELEASE_LEASE_MISMATCH") {
        throw error;
      }
      await runRemoteReleaseLease({
        action: "verify_deploying",
        repoRoot,
        receiptOut: options.receiptOut,
        manifest,
        expectedCommit: options.expectedCommit,
        ownerId: releaseLock.remoteReleaseLeaseOwnerId,
        outcomePathSha256: releaseLock.outcomeReceiptPathSha256,
        runCommand,
        supabaseCli,
        assertLinkedRef,
      });
      recoveredRemoteDeployingPhase = true;
    }

    await assertLinkedRef();
    const dryRun = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      ["db", "push", "--linked", "--dry-run", "--agent", "no", "--workdir", repoRoot],
      { cwd: repoRoot },
      "RESUME_DRY_RUN_FAILED",
    );
    assertDryRunRecognized(
      `${dryRun.stdout}\n${dryRun.stderr}`,
      "RESUME_DRY_RUN_UNRECOGNIZED",
      { allowUpToDate: true },
    );
    assertExactOrdered(
      parsePendingMigrations(`${dryRun.stdout}\n${dryRun.stderr}`),
      [],
      "RESUME_PENDING_NOT_CLEAN",
    );
    const ledger = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      ["migration", "list", "--linked", "--agent", "no", "--workdir", repoRoot],
      { cwd: repoRoot },
      "RESUME_LEDGER_FAILED",
    );
    const postRemoteVersions = parseRemoteLedger(`${ledger.stdout}\n${ledger.stderr}`);
    if (postRemoteVersions.length !== new Set(postRemoteVersions).size
        || postRemoteVersions.length !== awaitingOutcome.receipt.postRemoteLedgerCount
        || canonicalTextHash(`${postRemoteVersions.join("\n")}\n`)
          !== awaitingOutcome.receipt.postRemoteLedgerSha256) {
      blocked("RESUME_LEDGER_DRIFT", "remote ledger no longer matches the retained post-push checkpoint");
    }
    const expectedVersions = expectedMigrations.map((migration) => migration.slice(0, 14));
    assertExactOrdered(
      postRemoteVersions.slice(-expectedVersions.length),
      expectedVersions,
      "RESUME_LEDGER_TAIL_MISMATCH",
    );
    await assertLinkedRef();

    const postPushEvidence = await validatePostPushEvidenceReceipt({
      backupReceiptPath: options.backupReceipt,
      backupReceipt,
      awaitingOutcome,
      manifest,
      expectedCommit: options.expectedCommit,
      now,
    });
    const postPushCheckEvidence = await runReadOnlyChecks({
      checks: postPushChecks,
      phase: "post",
      runCommand,
      supabaseCli,
      repoRoot,
      assertLinkedRef,
    });
    const forwardOnlySecurityCheckEvidence = await runForwardOnlyChecks({
      checks: forwardOnlyChecks,
      runCommand,
      supabaseCli,
      repoRoot,
      assertLinkedRef,
    });
    const liveForwardOnlyIds = forwardOnlySecurityCheckEvidence.map(
      (entry) => entry.id,
    );
    if (writeFenceEvidence.forwardOnlyOperationIds.length
          !== liveForwardOnlyIds.length
        || writeFenceEvidence.forwardOnlyOperationIds.some(
          (id, index) => id !== liveForwardOnlyIds[index],
        )) {
      blocked(
        "FORWARD_ONLY_SECURITY_EVIDENCE_MISMATCH",
        "retained pre-backup ACL evidence differs from the live exact ACL",
      );
    }
    const postApplyCheckEvidence = await runReadOnlyChecks({
      checks: postApplyChecks,
      phase: "post",
      runCommand,
      supabaseCli,
      repoRoot,
      assertLinkedRef,
    });
    await assertLinkedRef();
    await assertReleaseGitFence({
      repoRoot,
      expectedCommit: options.expectedCommit,
      expectedOrigin: manifest.backupContract.expectedOrigin,
      remoteRef: options.remoteRef,
      runCommand,
    });

    const preOperationIds = manifest.manualPlatformOperations
      .filter((operation) => operation.phase === "pre-backup")
      .map((operation) => operation.id);
    const successorRuntimeEvidence =
      refreshSuccessorRuntimeEvidence();
    if (!recoveredRemoteDeployingPhase) {
      await runRemoteReleaseLease({
        action: "mark_deploying_from_awaiting",
        repoRoot,
        receiptOut: options.receiptOut,
        manifest,
        expectedCommit: options.expectedCommit,
        ownerId: releaseLock.remoteReleaseLeaseOwnerId,
        outcomePathSha256: releaseLock.outcomeReceiptPathSha256,
        runCommand,
        supabaseCli,
        assertLinkedRef,
      });
    }
    await runRemoteReleaseLease({
      action: "verify_deploying",
      repoRoot,
      receiptOut: options.receiptOut,
      manifest,
      expectedCommit: options.expectedCommit,
      ownerId: releaseLock.remoteReleaseLeaseOwnerId,
      outcomePathSha256: releaseLock.outcomeReceiptPathSha256,
      runCommand,
      supabaseCli,
      assertLinkedRef,
    });
    const finalReceipt = {
      ...awaitingOutcome.receipt,
      status: "database_expand_verified_lease_held",
      completedAt: now().toISOString(),
      verifiedManualOperationIds: [...preOperationIds, ...postPushEvidence.operationIds],
      verifiedManualOperationCount: preOperationIds.length + postPushEvidence.operationIds.length,
      pendingManualOperationIds: [],
      pendingManualOperationCount: 0,
      writeFenceEvidenceSha256: writeFenceEvidence.sha256,
      writeFenceEvidenceVerifiedAt: writeFenceEvidence.verifiedAt,
      postPushEvidenceSha256: postPushEvidence.sha256,
      postPushEvidenceVerifiedAt: postPushEvidence.verifiedAt,
      postPushEvidenceOperationIds: postPushEvidence.operationIds,
      postPushCheckIds: postPushCheckEvidence.map((entry) => entry.id),
      postPushCheckCount: postPushCheckEvidence.length,
      postPushCheckEvidence,
      postApplyCheckIds: postApplyCheckEvidence.map((entry) => entry.id),
      postApplyCheckCount: postApplyCheckEvidence.length,
      postApplyCheckEvidence,
      forwardOnlySecurityOperationIds:
        forwardOnlySecurityCheckEvidence.map((entry) => entry.id),
      forwardOnlySecurityOperationCount:
        forwardOnlySecurityCheckEvidence.length,
      forwardOnlySecurityCheckEvidence,
      postconditionsPassed: postPushCheckEvidence.length + postApplyCheckEvidence.length,
      remoteReleaseLeasePhase: "deployment-canary",
      remoteReleaseLeaseRecoveredFromDeployingPhase: recoveredRemoteDeployingPhase,
      rerunProhibited: true,
      operatorAction: "DO_NOT_RERUN DB PUSH. Hand this exact lease owner and receipt to the deploy/canary/fence-finalization controller; release remains NO-GO until that controller atomically lifts the fence and closes the lease.",
      ...(successorRuntimeEvidence
        ? {
          successorRuntimeEvidence:
            successorRuntimeEvidence.records,
          successorRuntimeEvidenceSetSha256:
            successorRuntimeEvidence.sha256,
        }
        : {}),
    };
    await writeReceipt(options.receiptOut, finalReceipt);
    return finalReceipt;
  } finally {
    await resumeLease.close().catch(() => {});
    await rm(resumeLeasePath, { force: true }).catch(() => {});
  }
}

export async function runProductionRelease({
  repoRoot: requestedRepoRoot,
  argv,
  runCommand = defaultRunCommand,
  now = () => new Date(),
} = {}) {
  const repoRoot = resolve(requestedRepoRoot ?? process.cwd());
  if ((argv ?? []).some(arg => ['--amora-runtime-hotfix', '--amora-named-budget-hotfix'].includes(arg))) {
    assertSafeExecutionEnvironment(process.env);
    const {
      parseHotfixArgs,
      parseHotfixFinalizeArgs,
      loadHotfixRelease,
      parseNamedBudgetHotfixArgs,
      loadNamedBudgetHotfixRelease,
      createManagementHotfixTransport,
      runAmoraRuntimeHotfix,
      runAmoraRuntimeHotfixFinalize,
      HotfixBlocked,
    } = await import("./amora-runtime-hotfix-controller.mjs");
    const finalizing = argv.includes("--finalize");
    const named = argv.includes('--amora-named-budget-hotfix');
    const options = named ? parseNamedBudgetHotfixArgs(argv) : finalizing ? parseHotfixFinalizeArgs(argv) : parseHotfixArgs(argv);
    const release = named ? loadNamedBudgetHotfixRelease(repoRoot) : loadHotfixRelease(repoRoot);
    const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
    if (!/^sbp_(oauth_)?[a-f0-9]{40}$/.test(accessToken ?? "")) {
      throw new HotfixBlocked("EXISTING_CLI_CREDENTIAL_UNAVAILABLE");
    }
    const runtime = {
      repoRoot, now,
      transport: createManagementHotfixTransport({ accessToken, projectRef: release.hotfix.projectRef }),
      primitives: { assertReleaseGitFence, runCommand },
    };
    if (finalizing) {
      return runAmoraRuntimeHotfixFinalize({
        ...runtime,
        mode: named ? '--amora-named-budget-hotfix' : '--amora-runtime-hotfix',
        evidenceRoot: options["evidence-root"],
        outcomePath: options.outcome,
        canaryPath: options.canary,
        receiptOut: options["receipt-out"],
        expectedCommit: options["expected-commit"],
        remoteRef: options["remote-ref"],
        confirmProduction: options["confirm-production"],
      });
    }
    return runAmoraRuntimeHotfix({ ...runtime, argv });
  }
  if ((argv ?? []).includes("--current-baseline")) {
    assertSafeExecutionEnvironment(process.env);
    const { runCurrentBaselineRelease } = await import("./current-baseline-release-controller.mjs");
    return runCurrentBaselineRelease({
      repoRoot, argv, runCommand, now,
      primitives: { assertReleaseGitFence, resolvePinnedSupabaseCli, runRemoteReleaseLease,
        createLinkedRefFence, parsePendingMigrations, assertDryRunRecognized,
        assertExactOrdered, runReadOnlyChecks, writeReceipt },
    });
  }
  const options = parseArgs(argv ?? []);
  assertSafeExecutionEnvironment(process.env);
  const selection = await selectReleaseManifest(repoRoot);
  const {
    manifest,
    expectedMigrations,
    preApplyChecks,
    postPushChecks,
    postApplyChecks,
    forwardOnlyChecks,
  } = await loadManifest(repoRoot, selection);
  const confirmationMode = options.checkOnly
    ? "CHECK"
    : options.resumePostPush
      ? "RESUME"
      : "APPLY";
  const confirmation = `${confirmationMode}:${manifest.projectRef}:${manifest.release}:${options.expectedCommit}`;
  if (options.confirmProduction !== confirmation) {
    blocked("PRODUCTION_CONFIRMATION_MISMATCH", "production confirmation does not match project, release and commit");
  }
  const refreshSuccessorRuntimeEvidence = () => {
    if (!selection.successor) return null;
    try {
      return summarizeSuccessorRuntimeEvidence(validateSuccessorRuntimeEvidence({
        repoRoot,
        receiptRoot: dirname(options.backupReceipt),
        manifest: selection.successorContract.manifest,
        controllerManifest: manifest,
        expectedCommit: options.expectedCommit,
        now,
      }));
    } catch (error) {
      if (error instanceof SuccessorReleaseContractError) {
        blocked(
          error.code,
          "successor private runtime evidence is missing, stale, mismatched or semantically incomplete",
        );
      }
      throw error;
    }
  };
  let successorRuntimeEvidence = refreshSuccessorRuntimeEvidence();
  if (options.apply || options.resumePostPush) {
    if (!isAbsolute(options.receiptOut) || inside(repoRoot, options.receiptOut)) {
      blocked("RECEIPT_PATH_INVALID", "--receipt-out must be an absolute JSON path outside the Git repository");
    }
    if (!options.receiptOut.toLowerCase().endsWith(".json")) {
      blocked("RECEIPT_PATH_INVALID", "--receipt-out must end in .json");
    }
    const receiptParent = dirname(options.receiptOut);
    const parentMetadata = await lstat(receiptParent).catch(() => null);
    if (!parentMetadata?.isDirectory() || parentMetadata.isSymbolicLink()) {
      blocked("RECEIPT_PATH_INVALID", "release receipt parent directory must already exist");
    }
    const [canonicalRepoRoot, canonicalReceiptParent] = await Promise.all([
      realpath(repoRoot).catch(() => null),
      realpath(receiptParent).catch(() => null),
    ]);
    if (!canonicalRepoRoot || !canonicalReceiptParent
        || inside(canonicalRepoRoot, canonicalReceiptParent)) {
      blocked(
        "RECEIPT_PATH_INVALID",
        "release receipt parent must resolve outside the Git repository",
      );
    }
  }

  await assertReleaseGitFence({
    repoRoot,
    expectedCommit: options.expectedCommit,
    expectedOrigin: manifest.backupContract.expectedOrigin,
    remoteRef: options.remoteRef,
    runCommand,
  });
  await requireCommandSuccess(
    runCommand,
    process.execPath,
    [join(repoRoot, "scripts", "supabase-release-fence.mjs")],
    { cwd: repoRoot },
    "STATIC_RELEASE_FENCE_FAILED",
  );

  const lockPath = join(repoRoot, "supabase", ".temp", "amora-production-release.lock");
  if (options.resumePostPush) {
    successorRuntimeEvidence = refreshSuccessorRuntimeEvidence();
    return await runPostPushResume({
      repoRoot,
      options,
      manifest,
      expectedMigrations,
      postPushChecks,
      postApplyChecks,
      forwardOnlyChecks,
      lockPath,
      runCommand,
      now,
      refreshSuccessorRuntimeEvidence,
    });
  }
  const lock = options.apply
    ? await open(lockPath, "wx", 0o600).catch(() => null)
    : null;
  if (options.apply && !lock) {
    blocked("RELEASE_LOCKED", "another or unresolved release attempt owns the local release lock");
  }
  let preserveLock = false;
  let pushStarted = false;
  let receiptStarted = false;
  const remoteReleaseLeaseOwnerId = options.apply ? randomUUID() : null;
  const outcomeReceiptPathSha256 = options.apply
    ? textSha256(resolve(options.receiptOut))
    : null;
  let remoteReleaseLeaseClaimed = false;
  let remoteReleaseLeaseClaimAttempted = false;
  let remoteLeaseSupabaseCli = null;
  let remoteLeaseLinkedRefFence = null;
  try {
    if (lock) {
      await lock.writeFile(`${JSON.stringify({
        version: 2,
        release: manifest.release,
        projectRef: manifest.projectRef,
        releaseCommit: options.expectedCommit,
        outcomeReceiptPathSha256,
        remoteReleaseLeaseOwnerId,
        startedAt: now().toISOString(),
        rerunProhibitedUntilAdjudicated: true,
      })}\n`, "utf8");
      await lock.sync();
    }

    const assertLinkedRef = await createLinkedRefFence(repoRoot, manifest.projectRef);
    const backupReceipt = await validateBackupReceipt({
      path: options.backupReceipt,
      repoRoot,
      backupSourceRepo: options.backupSourceRepo,
      backupContract: manifest.backupContract,
      expectedCommit: options.expectedCommit,
      projectRef: manifest.projectRef,
      runCommand,
    });
    const hostedRestoreEvidence = await validateHostedRestoreEvidence({
      repoRoot,
      backupReceiptPath: options.backupReceipt,
      backupReceipt,
      manifest,
      expectedCommit: options.expectedCommit,
      now,
    });
    const writeFenceEvidence = await validateWriteFenceReceipt({
      repoRoot,
      backupReceiptPath: options.backupReceipt,
      backupReceipt,
      manifest,
      expectedCommit: options.expectedCommit,
      now,
    });
    const supabaseCli = await resolvePinnedSupabaseCli(repoRoot, backupReceipt);
    remoteLeaseSupabaseCli = supabaseCli;
    remoteLeaseLinkedRefFence = assertLinkedRef;

    if (options.apply) {
      successorRuntimeEvidence = refreshSuccessorRuntimeEvidence();
      remoteReleaseLeaseClaimAttempted = true;
      preserveLock = true;
      try {
        await runRemoteReleaseLease({
          action: "claim",
          repoRoot,
          receiptOut: options.receiptOut,
          manifest,
          expectedCommit: options.expectedCommit,
          ownerId: remoteReleaseLeaseOwnerId,
          outcomePathSha256: outcomeReceiptPathSha256,
          runCommand,
          supabaseCli,
          assertLinkedRef,
        });
      } catch (error) {
        if (error instanceof ReleaseBlockedError
            && error.code === "REMOTE_RELEASE_LEASE_HELD") {
          remoteReleaseLeaseClaimAttempted = false;
          preserveLock = false;
        }
        throw error;
      }
      remoteReleaseLeaseClaimed = true;
      preserveLock = false;
      await runRemoteReleaseLease({
        action: "verify_claimed",
        repoRoot,
        receiptOut: options.receiptOut,
        manifest,
        expectedCommit: options.expectedCommit,
        ownerId: remoteReleaseLeaseOwnerId,
        outcomePathSha256: outcomeReceiptPathSha256,
        runCommand,
        supabaseCli,
        assertLinkedRef,
      });
    }

    await assertLinkedRef();
    const dryRun = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      ["db", "push", "--linked", "--dry-run", "--agent", "no", "--workdir", repoRoot],
      { cwd: repoRoot },
      "PRE_PUSH_DRY_RUN_FAILED",
    );
    await assertLinkedRef();
    assertDryRunRecognized(
      `${dryRun.stdout}\n${dryRun.stderr}`,
      "PRE_PUSH_DRY_RUN_UNRECOGNIZED",
    );
    assertExactOrdered(
      parsePendingMigrations(`${dryRun.stdout}\n${dryRun.stderr}`),
      expectedMigrations,
      "PRE_PUSH_PENDING_MISMATCH",
    );
    const preLedgerResult = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      ["migration", "list", "--linked", "--agent", "no", "--workdir", repoRoot],
      { cwd: repoRoot },
      "PRE_PUSH_LEDGER_FAILED",
    );
    const preRemoteVersions = parseRemoteLedger(
      `${preLedgerResult.stdout}\n${preLedgerResult.stderr}`,
    );
    if (preRemoteVersions.length !== new Set(preRemoteVersions).size) {
      blocked("PRE_PUSH_LEDGER_DUPLICATE", "remote migration ledger contains duplicate versions");
    }
    if (preRemoteVersions.at(-1) !== manifest.requiredRemoteHead) {
      blocked(
        "PRE_PUSH_LEDGER_HEAD_MISMATCH",
        "remote migration ledger head does not match the manifest baseline",
      );
    }
    const expectedVersions = expectedMigrations.map((migration) => migration.slice(0, 14));
    if (expectedVersions.some((version) => preRemoteVersions.includes(version))) {
      blocked("PRE_PUSH_LEDGER_CONTRADICTION", "pending manifest version is already present in the remote ledger");
    }

    const preApplyCheckEvidence = await runReadOnlyChecks({
      checks: preApplyChecks,
      phase: "pre",
      runCommand,
      supabaseCli,
      repoRoot,
      assertLinkedRef,
    });
    const preApplyCheckIds = preApplyCheckEvidence.map((entry) => entry.id);
    const forwardOnlySecurityCheckEvidence = await runForwardOnlyChecks({
      checks: forwardOnlyChecks,
      runCommand,
      supabaseCli,
      repoRoot,
      assertLinkedRef,
    });
    const forwardOnlySecurityOperationIds =
      forwardOnlySecurityCheckEvidence.map((entry) => entry.id);
    if (writeFenceEvidence.forwardOnlyOperationIds.length
          !== forwardOnlySecurityOperationIds.length
        || writeFenceEvidence.forwardOnlyOperationIds.some(
          (id, index) => id !== forwardOnlySecurityOperationIds[index],
        )) {
      blocked(
        "FORWARD_ONLY_SECURITY_EVIDENCE_MISMATCH",
        "pre-backup write-fence receipt and live exact-ACL verification differ",
      );
    }
    const preBackupOperations = manifest.manualPlatformOperations
      .filter((entry) => entry.phase === "pre-backup");
    const postPushOperations = manifest.manualPlatformOperations
      .filter((entry) => entry.phase === "post-push-pre-deploy");

    await assertReleaseGitFence({
      repoRoot,
      expectedCommit: options.expectedCommit,
      expectedOrigin: manifest.backupContract.expectedOrigin,
      remoteRef: options.remoteRef,
      runCommand,
    });
    await assertLinkedRef();
    successorRuntimeEvidence = refreshSuccessorRuntimeEvidence();

    if (options.checkOnly) {
      return {
        status: "preflight_verified",
        release: manifest.release,
        projectRef: manifest.projectRef,
        releaseCommit: options.expectedCommit,
        remoteRef: options.remoteRef,
        migrations: expectedMigrations,
        requiredRemoteHead: manifest.requiredRemoteHead,
        backupContractId: manifest.backupContract.id,
        backupContractVersion: manifest.backupContract.version,
        backupExpectedTableCount: manifest.backupContract.expectedTableCount,
        backupExcludedEphemeralTables: manifest.backupContract.excludedEphemeralTables,
        backupEphemeralRebuildContract: manifest.backupContract.ephemeralRebuildContract,
        verifiedManualOperationIds: preBackupOperations.map((entry) => entry.id),
        verifiedManualOperationCount: preBackupOperations.length,
        pendingManualOperationIds: postPushOperations.map((entry) => entry.id),
        pendingManualOperationCount: postPushOperations.length,
        writeFenceEvidenceSha256: writeFenceEvidence.sha256,
        writeFenceEvidenceVerifiedAt: writeFenceEvidence.verifiedAt,
        writeFenceEvidenceOperationIds: writeFenceEvidence.operationIds,
        writeFenceEvidenceControlCount: writeFenceEvidence.controlCount,
        hostedRestoreEvidenceSha256: hostedRestoreEvidence.sha256,
        hostedRestoreTargetProjectRef: hostedRestoreEvidence.targetProjectRef,
        hostedRestoreEvidenceVerifiedAt: hostedRestoreEvidence.verifiedAt,
        hostedRestoreEvidenceCheckCount: hostedRestoreEvidence.checkCount,
        preApplyCheckIds,
        preApplyCheckCount: preApplyCheckIds.length,
        preApplyCheckEvidence,
        forwardOnlySecurityOperationIds,
        forwardOnlySecurityOperationCount:
          forwardOnlySecurityOperationIds.length,
        forwardOnlySecurityCheckEvidence,
        ...(successorRuntimeEvidence
          ? {
            successorRuntimeEvidence:
              successorRuntimeEvidence.records,
            successorRuntimeEvidenceSetSha256:
              successorRuntimeEvidence.sha256,
          }
          : {}),
      };
    }

    const startedAt = now().toISOString();
    const baseReceipt = {
      receiptVersion: 1,
      release: manifest.release,
      projectRef: manifest.projectRef,
      releaseCommit: options.expectedCommit,
      remoteRef: options.remoteRef,
      remoteReleaseLeaseOwnerId,
      remoteReleaseLeaseOutcomePathSha256: outcomeReceiptPathSha256,
      remoteReleaseLeasePhase: "claimed",
      migrations: expectedMigrations,
      backupSetId: backupReceipt.BackupSetId,
      backupManifestSha256: backupReceipt.ManifestSha256,
      backupGitCommit: backupReceipt.GitCommit,
      backupContractId: manifest.backupContract.id,
      backupContractVersion: manifest.backupContract.version,
      backupExpectedTableCount: manifest.backupContract.expectedTableCount,
      backupExcludedEphemeralTables: manifest.backupContract.excludedEphemeralTables,
      backupEphemeralRebuildContract: manifest.backupContract.ephemeralRebuildContract,
      backupVerifierSha256: manifest.backupContract.verifier.sha256,
      sourceOrigin: manifest.backupContract.expectedOrigin,
      verifiedManualOperationIds: preBackupOperations.map((entry) => entry.id),
      verifiedManualOperationCount: preBackupOperations.length,
      pendingManualOperationIds: postPushOperations.map((entry) => entry.id),
      pendingManualOperationCount: postPushOperations.length,
      rollbackArtifactIds: manifest.rollbackArtifacts.map((entry) => entry.id),
      writeFenceEvidenceSha256: writeFenceEvidence.sha256,
      writeFenceEvidenceVerifiedAt: writeFenceEvidence.verifiedAt,
      writeFenceEvidenceOperationIds: writeFenceEvidence.operationIds,
      writeFenceEvidenceControlCount: writeFenceEvidence.controlCount,
      hostedRestoreEvidenceSha256: hostedRestoreEvidence.sha256,
      hostedRestoreTargetProjectRef: hostedRestoreEvidence.targetProjectRef,
      hostedRestoreEvidenceVerifiedAt: hostedRestoreEvidence.verifiedAt,
      hostedRestoreEvidenceCheckCount: hostedRestoreEvidence.checkCount,
      supabaseCliVersion: backupReceipt.SupabaseCliVersion,
      supabaseCliBinarySha256: backupReceipt.SupabaseCliBinarySha256,
      preRemoteLedgerCount: preRemoteVersions.length,
      preRemoteLedgerSha256: canonicalTextHash(`${preRemoteVersions.join("\n")}\n`),
      preApplyCheckIds,
      preApplyCheckCount: preApplyCheckIds.length,
      preApplyCheckEvidence,
      forwardOnlySecurityOperationIds,
      forwardOnlySecurityOperationCount:
        forwardOnlySecurityOperationIds.length,
      forwardOnlySecurityCheckEvidence,
      startedAt,
      status: "started",
      rerunProhibited: true,
      containsSecrets: false,
      ...(successorRuntimeEvidence
        ? {
          successorRuntimeEvidence:
            successorRuntimeEvidence.records,
          successorRuntimeEvidenceSetSha256:
            successorRuntimeEvidence.sha256,
        }
        : {}),
    };
    await writeReceipt(options.receiptOut, baseReceipt, { exclusive: true });
    receiptStarted = true;
    pushStarted = true;
    preserveLock = true;
    const push = await runCommand(
      supabaseCli,
      ["db", "push", "--linked", "--yes", "--agent", "no", "--workdir", repoRoot],
      { cwd: repoRoot },
    );
    if (push?.error || push?.signal || push?.timedOut
        || push?.status !== 0 || push?.outputTruncated) {
      await writeReceipt(options.receiptOut, {
        ...baseReceipt,
        status: "ambiguous_push_outcome",
        lastUpdatedAt: now().toISOString(),
        operatorAction: "DO_NOT_RERUN; inspect the linked project migration ledger and schema postconditions read-only, then review the retained lock and receipt.",
      });
      blocked("PUSH_OUTCOME_AMBIGUOUS", "database push did not return a verified success; do not rerun");
    }

    await writeReceipt(options.receiptOut, {
      ...baseReceipt,
      status: "push_exit_zero_postverification_required",
      lastUpdatedAt: now().toISOString(),
      operatorAction: "DO_NOT_RERUN until DB post-verification reaches the lease-held deploy/canary handoff.",
    });
    await assertLinkedRef();
    const postDryRun = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      ["db", "push", "--linked", "--dry-run", "--agent", "no", "--workdir", repoRoot],
      { cwd: repoRoot },
      "POST_PUSH_DRY_RUN_FAILED",
    );
    assertDryRunRecognized(
      `${postDryRun.stdout}\n${postDryRun.stderr}`,
      "POST_PUSH_DRY_RUN_UNRECOGNIZED",
      { allowUpToDate: true },
    );
    const postPending = parsePendingMigrations(`${postDryRun.stdout}\n${postDryRun.stderr}`);
    assertExactOrdered(postPending, [], "POST_PUSH_PENDING_NOT_CLEAN");

    const ledger = await requireCommandSuccess(
      runCommand,
      supabaseCli,
      ["migration", "list", "--linked", "--agent", "no", "--workdir", repoRoot],
      { cwd: repoRoot },
      "POST_PUSH_LEDGER_FAILED",
    );
    const postRemoteVersions = parseRemoteLedger(`${ledger.stdout}\n${ledger.stderr}`);
    assertExactOrdered(
      postRemoteVersions,
      [...preRemoteVersions, ...expectedVersions],
      "POST_PUSH_LEDGER_DELTA_MISMATCH",
    );

    const postRemoteLedgerSha256 = canonicalTextHash(`${postRemoteVersions.join("\n")}\n`);
    if (postPushOperations.length > 0) {
      await runRemoteReleaseLease({
        action: "mark_awaiting",
        repoRoot,
        receiptOut: options.receiptOut,
        manifest,
        expectedCommit: options.expectedCommit,
        ownerId: remoteReleaseLeaseOwnerId,
        outcomePathSha256: outcomeReceiptPathSha256,
        runCommand,
        supabaseCli,
        assertLinkedRef,
      });
      await runRemoteReleaseLease({
        action: "verify_awaiting",
        repoRoot,
        receiptOut: options.receiptOut,
        manifest,
        expectedCommit: options.expectedCommit,
        ownerId: remoteReleaseLeaseOwnerId,
        outcomePathSha256: outcomeReceiptPathSha256,
        runCommand,
        supabaseCli,
        assertLinkedRef,
      });
      const awaitingReceipt = {
        ...baseReceipt,
        status: "awaiting_manual_post_push_operations",
        remoteReleaseLeasePhase: "awaiting-post-push",
        lastUpdatedAt: now().toISOString(),
        postPendingCount: 0,
        postRemoteLedgerCount: postRemoteVersions.length,
        postRemoteLedgerSha256,
        rerunProhibited: true,
        operatorAction: "DO_NOT_RERUN DB PUSH. Execute only the manifest-pinned post-push platform operation, capture its exact evidence receipt, then use --resume-post-push.",
      };
      await writeReceipt(options.receiptOut, awaitingReceipt);
      return awaitingReceipt;
    }

    const postApplyCheckEvidence = await runReadOnlyChecks({
      checks: postApplyChecks,
      phase: "post",
      runCommand,
      supabaseCli,
      repoRoot,
      assertLinkedRef,
    });
    const postApplyCheckIds = postApplyCheckEvidence.map((entry) => entry.id);

    await assertLinkedRef();
    await assertReleaseGitFence({
      repoRoot,
      expectedCommit: options.expectedCommit,
      expectedOrigin: manifest.backupContract.expectedOrigin,
      remoteRef: options.remoteRef,
      runCommand,
    });
    await runRemoteReleaseLease({
      action: "mark_deploying_from_claimed",
      repoRoot,
      receiptOut: options.receiptOut,
      manifest,
      expectedCommit: options.expectedCommit,
      ownerId: remoteReleaseLeaseOwnerId,
      outcomePathSha256: outcomeReceiptPathSha256,
      runCommand,
      supabaseCli,
      assertLinkedRef,
    });
    await runRemoteReleaseLease({
      action: "verify_deploying",
      repoRoot,
      receiptOut: options.receiptOut,
      manifest,
      expectedCommit: options.expectedCommit,
      ownerId: remoteReleaseLeaseOwnerId,
      outcomePathSha256: outcomeReceiptPathSha256,
      runCommand,
      supabaseCli,
      assertLinkedRef,
    });
    const finalReceipt = {
      ...baseReceipt,
      status: "database_expand_verified_lease_held",
      completedAt: now().toISOString(),
      postPendingCount: 0,
      postRemoteLedgerCount: postRemoteVersions.length,
      postRemoteLedgerSha256,
      postPushCheckIds: [],
      postPushCheckCount: 0,
      postPushCheckEvidence: [],
      postApplyCheckIds,
      postApplyCheckCount: postApplyCheckIds.length,
      postApplyCheckEvidence,
      postconditionsPassed: postApplyCheckIds.length,
      remoteReleaseLeasePhase: "deployment-canary",
      rerunProhibited: true,
      operatorAction: "DO_NOT_RERUN DB PUSH. Hand this exact lease owner and receipt to the deploy/canary/fence-finalization controller; release remains NO-GO until that controller atomically lifts the fence and closes the lease.",
    };
    await writeReceipt(options.receiptOut, finalReceipt);
    return finalReceipt;
  } catch (error) {
    if (!pushStarted && remoteReleaseLeaseClaimed) {
      try {
        await runRemoteReleaseLease({
          action: "release",
          repoRoot,
          receiptOut: options.receiptOut,
          manifest,
          expectedCommit: options.expectedCommit,
          ownerId: remoteReleaseLeaseOwnerId,
          outcomePathSha256: outcomeReceiptPathSha256,
          runCommand,
          supabaseCli: remoteLeaseSupabaseCli,
          assertLinkedRef: remoteLeaseLinkedRefFence,
        });
        await runRemoteReleaseLease({
          action: "verify_empty",
          repoRoot,
          receiptOut: options.receiptOut,
          manifest,
          expectedCommit: options.expectedCommit,
          ownerId: remoteReleaseLeaseOwnerId,
          outcomePathSha256: outcomeReceiptPathSha256,
          runCommand,
          supabaseCli: remoteLeaseSupabaseCli,
          assertLinkedRef: remoteLeaseLinkedRefFence,
        });
        remoteReleaseLeaseClaimed = false;
        remoteReleaseLeaseClaimAttempted = false;
        preserveLock = false;
      } catch (cleanupError) {
        preserveLock = true;
        throw cleanupError;
      }
    } else if (!pushStarted && remoteReleaseLeaseClaimAttempted) {
      preserveLock = true;
    }
    if (pushStarted) preserveLock = true;
    if (pushStarted && receiptStarted && error instanceof ReleaseBlockedError
        && error.code !== "PUSH_OUTCOME_AMBIGUOUS") {
      const existing = await readBoundedJson(options.receiptOut, "release outcome receipt").catch(() => null);
      if (existing) {
        await writeReceipt(options.receiptOut, {
          ...existing,
          status: "ambiguous_postverification_failure",
          lastUpdatedAt: now().toISOString(),
          rerunProhibited: true,
          containsSecrets: false,
          operatorAction: "DO_NOT_RERUN; inspect migration ledger and schema postconditions read-only before adjudication.",
        }).catch(() => {});
      }
    }
    throw error;
  } finally {
    if (lock) await lock.close().catch(() => {});
    if (lock && !preserveLock) await rm(lockPath, { force: true }).catch(() => {});
  }
}
