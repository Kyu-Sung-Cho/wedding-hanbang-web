import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
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
import {
  AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
  AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
  validateAmoraExtendedReleaseContracts,
} from "./amora-release-extended-contracts.mjs";
import {
  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  SuccessorReleaseContractError,
  validateSuccessorNoAdditionalCostReleaseAssurance,
  validateSuccessorReleaseContract,
  validateSuccessorRuntimeEvidence,
} from "./supabase-successor-release-contract.mjs";
import {
  ProductionToolchainError,
  resolvePinnedWindowsProductionToolchain,
} from "./production-windows-toolchain.mjs";
import { productionDatabaseSystemIdentifier } from "./production-database-identity.mjs";
import {
  computeSuccessorReleaseCheckpointBindingSha256,
  SUCCESSOR_RELEASE_CHECKPOINT_BINDING_VERSION,
} from "./production-release-checkpoint-binding.mjs";
import {
  ExternalGateProvenanceError,
  validateExternalDeploymentCanaryProvenanceFiles,
  validateExternalGateProvenanceFiles,
} from "./production-external-gate-provenance.mjs";
import {
  reverifyVendorDisclosureSuccessorStorageOriginalBytesFiles,
} from "./vendor-disclosure-successor-storage-evidence-provenance.mjs";

const PREDECESSOR_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const FINALIZER_SQL_RELATIVE_PATH =
  "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql";
const SUCCESSOR_FINALIZER_OPERATION_ID =
  "production-write-fence-successor-finalize-20260819122000";
const SUCCESSOR_FINALIZER_SQL_RELATIVE_PATH =
  "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql";
const RELEASE_LOCK_RELATIVE_PATH =
  "supabase/.temp/amora-production-release.lock";
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_BACKUP_MANIFEST_BYTES = 256 * 1024;
const MAX_SUCCESSOR_BACKUP_ARTIFACT_BYTES = 32 * 1024 * 1024 + 1024;
const MAX_SUCCESSOR_BACKUP_KEY_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_FINALIZER_SQL_CHARACTERS = 28 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const RELEASE_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const OWNER_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CANONICAL_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{16,64}$/;
const GITHUB_HTTPS_ORIGIN =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
const CANARY_MAXIMUM_AGE_MINUTES = 15;
const DEPLOYMENT_MAXIMUM_AGE_MINUTES = 1_440;
const REQUIRED_CANARY_CHECKS = Object.freeze([
  "authenticatedReadPassed",
  "browserConsoleClean",
  "databaseFenceStillVerified",
  "deployedCommitMatched",
  "deploymentReady",
  "latencyWithinBaseline",
  "loginLogoutPassed",
  "noUnexpected5xx",
  "publicReadPassed",
  "serverErrorsWithinBaseline",
  "signupStillDisabled",
  "storageHelperClosed",
  "webWriteFenceStillEnabled",
]);
const SUCCESSOR_RUNTIME_EVIDENCE_NAMES = Object.freeze([
  "backup",
  "finalizer",
  "hostedStaging",
  "recoveryAssurance",
  "storage",
]);
const TEMPLATE_TOKENS = Object.freeze({
  projectRef: "__HB_FINALIZER_PROJECT_REF__",
  databaseSystemIdentifier: "__HB_FINALIZER_DATABASE_SYSTEM_IDENTIFIER__",
  release: "__HB_FINALIZER_RELEASE_ID__",
  releaseCommit: "__HB_FINALIZER_RELEASE_COMMIT__",
  leaseOwnerId: "__HB_FINALIZER_LEASE_OWNER_UUID__",
  outcomePathSha256: "__HB_FINALIZER_OUTCOME_PATH_SHA256__",
  outcomeReceiptSha256: "__HB_FINALIZER_OUTCOME_RECEIPT_SHA256__",
  deploymentId: "__HB_FINALIZER_DEPLOYMENT_ID__",
  deploymentUrlSha256: "__HB_FINALIZER_DEPLOYMENT_URL_SHA256__",
  deploymentReceiptSha256: "__HB_FINALIZER_DEPLOYMENT_RECEIPT_SHA256__",
  canaryReceiptSha256: "__HB_FINALIZER_CANARY_RECEIPT_SHA256__",
  canaryVerifiedAt: "__HB_FINALIZER_CANARY_VERIFIED_AT__",
  canaryExpiresAt: "__HB_FINALIZER_CANARY_EXPIRES_AT__",
  postExpandBackupReceiptSha256:
    "__HB_FINALIZER_POST_EXPAND_BACKUP_RECEIPT_SHA256__",
  postExpandBackupReverificationSha256:
    "__HB_FINALIZER_POST_EXPAND_BACKUP_REVERIFICATION_SHA256__",
  postExpandBackupSetId: "__HB_FINALIZER_POST_EXPAND_BACKUP_SET_ID__",
  postExpandBackupManifestSha256:
    "__HB_FINALIZER_POST_EXPAND_BACKUP_MANIFEST_SHA256__",
  postExpandTableContractSha256:
    "__HB_FINALIZER_POST_EXPAND_TABLE_CONTRACT_SHA256__",
  postExpandMigrationContractSha256:
    "__HB_FINALIZER_POST_EXPAND_MIGRATION_CONTRACT_SHA256__",
  postExpandLiveSchemaContractSha256:
    "__HB_FINALIZER_POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA256__",
  postExpandLogicalDataContractSha256:
    "__HB_FINALIZER_POST_EXPAND_LOGICAL_DATA_CONTRACT_SHA256__",
});
const PREDECESSOR_HOSTED_RESTORE_TEMPLATE_TOKEN =
  "__HB_FINALIZER_POST_EXPAND_HOSTED_RESTORE_RECEIPT_SHA256__";
const SUCCESSOR_RECOVERY_ASSURANCE_TEMPLATE_TOKEN =
  "__HB_FINALIZER_RECOVERY_ASSURANCE_RECEIPT_SHA256__";

export class ProductionWriteFenceFinalizerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductionWriteFenceFinalizerError";
    this.code = code;
  }
}

function blocked(code, message) {
  throw new ProductionWriteFenceFinalizerError(code, message);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function exactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function textSha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalTextSha256(value) {
  return textSha256(value.replace(/\r\n?/g, "\n"));
}

function compactFinalizerSql(value) {
  if (typeof value !== "string" || value.length === 0) {
    blocked("FINALIZER_TEMPLATE_INVALID", "finalizer SQL must be non-empty text");
  }
  const output = [];
  const pushCodeSpace = () => {
    if (output.length > 0 && output.at(-1) !== " ") output.push(" ");
  };
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (/\s/.test(character)) {
      while (index < value.length && /\s/.test(value[index])) index += 1;
      pushCodeSpace();
      continue;
    }
    if (value.startsWith("--", index)) {
      index += 2;
      while (index < value.length && !/[\r\n]/.test(value[index])) index += 1;
      pushCodeSpace();
      continue;
    }
    if (value.startsWith("/*", index)) {
      index += 2;
      let depth = 1;
      while (index < value.length && depth > 0) {
        if (value.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (value.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) {
        blocked("FINALIZER_TEMPLATE_INVALID", "unterminated SQL block comment");
      }
      pushCodeSpace();
      continue;
    }
    if (character === "$" ) {
      const delimiter = value.slice(index).match(
        /^(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/,
      )?.[0];
      if (delimiter) {
        const closing = value.indexOf(delimiter, index + delimiter.length);
        if (closing < 0) {
          blocked("FINALIZER_TEMPLATE_INVALID", "unterminated SQL dollar quote");
        }
        const bodyStart = index + delimiter.length;
        const body = value.slice(bodyStart, closing);
        const codeBeforeDelimiter = output.join("").trimEnd();
        const compactedBody = /(?:^|\s)DO$/i.test(codeBeforeDelimiter)
          ? compactFinalizerSql(body)
          : body;
        output.push(delimiter, compactedBody, delimiter);
        index = closing + delimiter.length;
        continue;
      }
    }
    if (character === "'" || character === '"') {
      const quote = character;
      const escapeBackslash = quote === "'" && (
        /[eE]/.test(value[index - 1] ?? "")
          && !/[A-Za-z0-9_$]/.test(value[index - 2] ?? "")
        || value.slice(Math.max(0, index - 2), index).toUpperCase() === "U&"
      );
      const start = index;
      index += 1;
      let closed = false;
      while (index < value.length) {
        if (escapeBackslash && value[index] === "\\") {
          index += Math.min(2, value.length - index);
          continue;
        }
        if (value[index] === quote) {
          if (value[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        blocked("FINALIZER_TEMPLATE_INVALID", "unterminated SQL quoted value");
      }
      output.push(value.slice(start, index));
      continue;
    }
    output.push(character);
    index += 1;
  }
  return output.join("").trim();
}

async function rawFileSha256(path, { upper = false } = {}) {
  const digest = await new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
  return upper ? digest.toUpperCase() : digest;
}

function sameStableFile(left, right) {
  const inodeMatches = !Number.isSafeInteger(left.ino)
    || left.ino === 0
    || (left.ino === right.ino && left.dev === right.dev);
  return inodeMatches
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readStableArtifactDigest(path, label, maximumBytes) {
  const before = await lstat(path).catch(() => null);
  const canonical = await realpath(path).catch(() => null);
  if (!before?.isFile()
      || before.isSymbolicLink()
      || before.size < 1
      || before.size > maximumBytes
      || !canonical) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      `${label} is missing, linked, empty, or oversized`,
    );
  }
  let handle;
  const hash = createHash("sha256");
  let opened;
  let offset = 0;
  try {
    handle = await open(canonical, "r");
    opened = await handle.stat();
    if (!opened.isFile() || !sameStableFile(before, opened)) {
      blocked(
        "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
        `${label} changed while it was opened`,
      );
    }
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      while (offset < opened.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, opened.size - offset),
          offset,
        );
        if (bytesRead < 1) break;
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
    } finally {
      buffer.fill(0);
    }
    const after = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    const afterCanonical = await realpath(path).catch(() => null);
    if (offset !== opened.size
        || !sameStableFile(opened, after)
        || !linked?.isFile()
        || linked.isSymbolicLink()
        || !sameStableFile(after, linked)
        || afterCanonical !== canonical) {
      blocked(
        "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
        `${label} changed while it was hashed`,
      );
    }
  } finally {
    await handle?.close().catch(() => {});
  }
  return Object.freeze({
    bytes: offset,
    sha256: hash.digest("hex"),
  });
}

function containsSecretLikeField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretLikeField);
  return Object.entries(value).some(([key, nested]) =>
    (!/^(?:containsSecrets|containsSensitiveValues|contains_secrets|plaintext_written_to_disk)$/.test(key)
      && /(?:password|secret|token|api[_-]?key|authorization|credential)/i.test(key))
    || containsSecretLikeField(nested));
}

function parseCanonicalInstant(value) {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value
    ? millis
    : null;
}

function parseUtcInstant(value) {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(value)) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function safeNonnegativeInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function parseCanonicalDeploymentUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    blocked("DEPLOYMENT_RECEIPT_INVALID", "deployment URL must be one canonical HTTPS origin");
  }
  if (parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
      || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(parsed.hostname)) {
    blocked("DEPLOYMENT_RECEIPT_INVALID", "deployment URL must be one canonical HTTPS origin");
  }
  return parsed.origin;
}

async function readBoundedJsonFile(path, label) {
  return await readBoundedJsonFileWithLimit(
    path,
    label,
    MAX_RECEIPT_BYTES,
  );
}

async function readBoundedJsonFileWithLimit(path, label, maximumBytes) {
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()
      || before.size < 2 || before.size > maximumBytes) {
    blocked("RECEIPT_INVALID", `${label} must be a bounded non-symlink regular file`);
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
    const buffer = Buffer.alloc(maximumBytes + 1);
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
    if (offset < 2 || offset > maximumBytes || offset !== opened.size
        || !sameFile(opened, after)) {
      blocked("RECEIPT_INVALID", `${label} changed while it was read`);
    }
    bytes = buffer.subarray(0, offset);
  } finally {
    await handle?.close().catch(() => {});
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch {
    blocked("RECEIPT_INVALID", `${label} is not valid JSON`);
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || containsSecretLikeField(receipt)) {
    blocked("RECEIPT_INVALID", `${label} has an invalid or secret-bearing shape`);
  }
  return {
    receipt,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function readBoundedReceipt(path, label, repoRoot) {
  if (!isAbsolute(path) || inside(repoRoot, path) || !path.toLowerCase().endsWith(".json")) {
    blocked("RECEIPT_PATH_INVALID", `${label} must be an absolute JSON path outside Git`);
  }
  return await readBoundedJsonFile(path, label);
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
  if (Object.entries(environment).some(([name, value]) =>
    value !== undefined
    && value !== ""
    && (exact.has(name) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)))) {
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
    }, timeoutMs);
  });
}

async function requireSuccess(runCommand, command, args, options, code) {
  const result = await runCommand(command, args, options);
  if (result?.error || result?.signal || result?.timedOut
      || result?.status !== 0 || result?.outputTruncated) {
    blocked(code, `${code}: child command did not return one bounded zero exit`);
  }
  return result;
}

function parseArgs(argv) {
  const allowed = new Set([
    "--expected-commit",
    "--remote-ref",
    "--release-outcome",
    "--deployment-receipt",
    "--post-expand-backup-directory",
    "--post-expand-backup-receipt",
    "--post-expand-hosted-restore-receipt",
    "--recovery-assurance-receipt",
    "--storage-original-bytes-backup-receipt",
    "--canary-receipt",
    "--receipt-out",
    "--confirm-production",
  ]);
  const result = {};
  for (const argument of argv) {
    const separator = argument.indexOf("=");
    if (separator < 1) blocked("ARGUMENT_UNKNOWN", "all finalizer arguments require exact values");
    const name = argument.slice(0, separator);
    const value = argument.slice(separator + 1);
    if (!allowed.has(name)) blocked("ARGUMENT_UNKNOWN", `unsupported argument: ${name}`);
    const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(result, key)) blocked("ARGUMENT_DUPLICATE", `${name} may appear only once`);
    if (!value) blocked("ARGUMENT_INVALID", `${name} must not be empty`);
    result[key] = value;
  }
  for (const name of [...allowed].filter(
    (value) => ![
      "--post-expand-backup-directory",
      "--post-expand-hosted-restore-receipt",
      "--recovery-assurance-receipt",
      "--storage-original-bytes-backup-receipt",
    ].includes(value),
  )) {
    const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!result[key]) blocked("ARGUMENT_REQUIRED", `${name} is required`);
  }
  if (!COMMIT.test(result.expectedCommit)) {
    blocked("EXPECTED_COMMIT_INVALID", "expected commit must be one lowercase 40-character SHA");
  }
  if (!/^origin\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(result.remoteRef)
      || result.remoteRef.includes("..")
      || result.remoteRef.includes("//")
      || result.remoteRef.endsWith("/")) {
    blocked("REMOTE_REF_INVALID", "remote ref must be one exact origin branch");
  }
  return result;
}

function validateStatusSpecificArguments(options, successorController) {
  const hasSuccessorBackupDirectory =
    typeof options.postExpandBackupDirectory === "string"
    && options.postExpandBackupDirectory.length > 0;
  if (successorController && !hasSuccessorBackupDirectory) {
    blocked(
      "ARGUMENT_REQUIRED",
      "successor finalization requires --post-expand-backup-directory",
    );
  }
  if (successorController
      && typeof options.recoveryAssuranceReceipt !== "string") {
    blocked(
      "ARGUMENT_REQUIRED",
      "successor finalization requires --recovery-assurance-receipt",
    );
  }
  if (successorController
      && typeof options.storageOriginalBytesBackupReceipt !== "string") {
    blocked(
      "ARGUMENT_REQUIRED",
      "successor finalization requires --storage-original-bytes-backup-receipt",
    );
  }
  if (successorController
      && options.postExpandHostedRestoreReceipt !== undefined) {
    blocked(
      "ARGUMENT_UNKNOWN",
      "paid hosted-restore evidence is forbidden for successor finalization",
    );
  }
  if (!successorController && hasSuccessorBackupDirectory) {
    blocked(
      "ARGUMENT_UNKNOWN",
      "successor-only backup directory is forbidden for predecessor finalization",
    );
  }
  if (!successorController
      && typeof options.postExpandHostedRestoreReceipt !== "string") {
    blocked(
      "ARGUMENT_REQUIRED",
      "predecessor finalization requires --post-expand-hosted-restore-receipt",
    );
  }
  if (!successorController && options.recoveryAssuranceReceipt !== undefined) {
    blocked(
      "ARGUMENT_UNKNOWN",
      "successor-only recovery assurance is forbidden for predecessor finalization",
    );
  }
  if (!successorController
      && options.storageOriginalBytesBackupReceipt !== undefined) {
    blocked(
      "ARGUMENT_UNKNOWN",
      "successor-only Storage original-byte proof is forbidden for predecessor finalization",
    );
  }
}

async function loadFinalizationManifest(repoRoot) {
  const successorPath = join(
    repoRoot,
    SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  );
  const successorMetadata = await lstat(successorPath).catch(() => null);
  let selectedManifest = null;
  let successorReleaseManifest = null;
  let manifestRelativePath = PREDECESSOR_MANIFEST_RELATIVE_PATH;
  if (successorMetadata) {
    if (!successorMetadata.isFile() || successorMetadata.isSymbolicLink()) {
      blocked(
        "SUCCESSOR_RELEASE_CONTRACT_INVALID",
        "successor release manifest must be one regular repository file",
      );
    }
    let successor;
    try {
      successor = validateSuccessorReleaseContract({ repoRoot });
    } catch (error) {
      if (error instanceof SuccessorReleaseContractError) {
        blocked(
          "SUCCESSOR_RELEASE_CONTRACT_INVALID",
          `successor release contract failed: ${error.code}`,
        );
      }
      throw error;
    }
    if (successor.deploymentBlocked || !successor.controllerManifest) {
      blocked(
        "SUCCESSOR_RELEASE_DEPLOYMENT_BLOCKED",
        "successor release is deployment-blocked and cannot be finalized",
      );
    }
    selectedManifest = successor.controllerManifest;
    successorReleaseManifest = successor.manifest;
    manifestRelativePath = successor.manifest.controllerContract.file;
  }

  const path = join(repoRoot, manifestRelativePath);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()
      || metadata.size < 2 || metadata.size > MAX_RECEIPT_BYTES) {
    blocked("MANIFEST_INVALID", "release manifest must be one bounded regular file");
  }
  let manifest = selectedManifest;
  if (!manifest) {
    try {
      manifest = JSON.parse(await readFile(path, "utf8"));
    } catch {
      blocked("MANIFEST_INVALID", "release manifest is not valid JSON");
    }
  }
  let extendedContracts;
  try {
    extendedContracts = validateAmoraExtendedReleaseContracts(manifest);
  } catch {
    blocked(
      "FINALIZATION_CONTRACT_INVALID",
      "manifest extended release contracts are missing or non-exact",
    );
  }
  const contract = extendedContracts.finalizationContract;
  const operation = contract?.operation;
  const successorController = manifest.status === "controller_ready";
  const expectedOperationId = successorController
    ? SUCCESSOR_FINALIZER_OPERATION_ID
    : "production-write-fence-finalize-20260717121000";
  const expectedOperationFile = successorController
    ? SUCCESSOR_FINALIZER_SQL_RELATIVE_PATH
    : FINALIZER_SQL_RELATIVE_PATH;
  if (!PROJECT_REF.test(manifest.projectRef ?? "")
      || !RELEASE_ID.test(manifest.release ?? "")
      || !GITHUB_HTTPS_ORIGIN.test(manifest.backupContract?.expectedOrigin ?? "")
      || !exactKeys(contract, [
        "id",
        "version",
        "operation",
        "requiredLeasePhase",
        "canaryMaximumAgeMinutes",
        "deploymentMaximumAgeMinutes",
        "requiredCanaryChecks",
        "externalEvidence",
        "confirmationIncludesCanarySha256",
      ])
      || contract.id !== "production-write-fence-exact-owner-finalizer"
      || contract.version !== (manifest.status === "controller_ready" ? 2 : 1)
      || contract.requiredLeasePhase !== "deployment-canary"
      || contract.canaryMaximumAgeMinutes !== CANARY_MAXIMUM_AGE_MINUTES
      || contract.deploymentMaximumAgeMinutes !== DEPLOYMENT_MAXIMUM_AGE_MINUTES
      || contract.confirmationIncludesCanarySha256 !== true
      || JSON.stringify(contract.requiredCanaryChecks)
        !== JSON.stringify(REQUIRED_CANARY_CHECKS)
      || !exactKeys(operation, ["id", "file", "sha256"])
      || operation.id !== expectedOperationId
      || operation.file !== expectedOperationFile
      || !SHA256.test(operation.sha256 ?? "")
      || !/^\d+\.\d+\.\d+$/.test(manifest.backupContract?.supabaseCli?.version ?? "")
      || !UPPER_SHA256.test(manifest.backupContract?.supabaseCli?.binarySha256 ?? "")) {
    blocked(
      "FINALIZATION_CONTRACT_INVALID",
      "manifest must pin the exact-owner finalizer and strict canary contract",
    );
  }
  const sqlPath = join(repoRoot, operation.file);
  const sqlMetadata = await lstat(sqlPath).catch(() => null);
  if (!sqlMetadata?.isFile() || sqlMetadata.isSymbolicLink()) {
    blocked("FINALIZER_SQL_INVALID", "finalizer SQL must be one regular repository file");
  }
  const sql = await readFile(sqlPath, "utf8");
  if (canonicalTextSha256(sql) !== operation.sha256) {
    blocked("FINALIZER_SQL_HASH_MISMATCH", "finalizer SQL differs from its manifest pin");
  }
  const postExpandBackupArtifacts = {
    capture: extendedContracts.postExpandBackupContract.capture,
    verifier: extendedContracts.postExpandBackupContract.verifier,
    ...(extendedContracts.postExpandBackupContract.common
      ? { common: extendedContracts.postExpandBackupContract.common }
      : {}),
  };
  for (const [label, artifact] of Object.entries(postExpandBackupArtifacts)) {
    const artifactPath = join(repoRoot, artifact.file);
    const artifactMetadata = await lstat(artifactPath).catch(() => null);
    if (!artifactMetadata?.isFile() || artifactMetadata.isSymbolicLink()) {
      blocked(
        "POST_EXPAND_BACKUP_CONTRACT_INVALID",
        `post-expand backup ${label} artifact is missing or unsafe`,
      );
    }
    const artifactText = await readFile(artifactPath, "utf8");
    if (canonicalTextSha256(artifactText) !== artifact.sha256) {
      blocked(
        "POST_EXPAND_BACKUP_CONTRACT_INVALID",
        `post-expand backup ${label} artifact differs from its manifest pin`,
      );
    }
  }
  return {
    manifest,
    successorReleaseManifest,
    contract,
    operation,
    postExpandBackupContract: extendedContracts.postExpandBackupContract,
    sql,
  };
}

function validateReleaseLock(lock, outcomePath, manifest, expectedCommit) {
  const successorRelease = manifest.status === "controller_ready";
  const expectedKeys = [
    "outcomeReceiptPathSha256",
    "projectRef",
    "release",
    "releaseCommit",
    "remoteReleaseLeaseOwnerId",
    "rerunProhibitedUntilAdjudicated",
    "startedAt",
    "version",
    ...(successorRelease
      ? [
        "remoteReleaseLeaseCheckpointBindingSha256",
        "successorCheckpointBindingVersion",
      ]
      : []),
  ];
  if (!exactKeys(lock, expectedKeys)
      || lock.version !== 2
      || lock.release !== manifest.release
      || lock.projectRef !== manifest.projectRef
      || lock.releaseCommit !== expectedCommit
      || lock.outcomeReceiptPathSha256 !== textSha256(resolve(outcomePath))
      || (successorRelease
        && (lock.successorCheckpointBindingVersion
            !== SUCCESSOR_RELEASE_CHECKPOINT_BINDING_VERSION
          || !SHA256.test(
            lock.remoteReleaseLeaseCheckpointBindingSha256 ?? "",
          )))
      || !OWNER_UUID.test(lock.remoteReleaseLeaseOwnerId ?? "")
      || lock.rerunProhibitedUntilAdjudicated !== true
      || parseCanonicalInstant(lock.startedAt) === null) {
    blocked("RELEASE_LOCK_INVALID", "retained release lock does not bind the exact lease owner and outcome path");
  }
  return lock;
}

function validateOutcomeCheckEvidence(receipt, manifest, phase) {
  const checks = manifest[`${phase}Checks`];
  const ids = receipt[`${phase}CheckIds`];
  const count = receipt[`${phase}CheckCount`];
  const evidence = receipt[`${phase}CheckEvidence`];
  if (!Array.isArray(checks)
      || (phase === "postApply" && checks.length < 1)
      || !exactArray(ids, checks.map((check) => check.id))
      || count !== checks.length
      || !Array.isArray(evidence)
      || evidence.length !== checks.length) {
    return false;
  }
  return evidence.every((entry, index) => {
    const check = checks[index];
    const expectedEvidence = check?.expectedEvidence;
    const expectedKeys = expectedEvidence && typeof expectedEvidence === "object"
      ? Object.keys(expectedEvidence)
      : [];
    return exactKeys(entry, ["evidence", "id"])
      && entry.id === check?.id
      && expectedKeys.length > 0
      && exactKeys(entry.evidence, expectedKeys)
      && expectedKeys.every((key) => entry.evidence[key] === expectedEvidence[key]);
  });
}

function validateSuccessorRuntimeEvidenceSummary(receipt) {
  const records = receipt.successorRuntimeEvidence;
  const startedAt = parseCanonicalInstant(receipt.startedAt);
  const completedAt = parseCanonicalInstant(receipt.completedAt);
  let releaseAssuranceValid = true;
  try {
    validateSuccessorNoAdditionalCostReleaseAssurance(
      receipt.successorReleaseAssurance,
    );
  } catch {
    releaseAssuranceValid = false;
  }
  if (!releaseAssuranceValid
      || !Array.isArray(records)
      || records.length !== SUCCESSOR_RUNTIME_EVIDENCE_NAMES.length
      || startedAt === null
      || completedAt === null
      || startedAt > completedAt
      || !SHA256.test(receipt.successorRuntimeEvidenceSetSha256 ?? "")) {
    return false;
  }
  for (const [index, record] of records.entries()) {
    const verifiedAt = parseUtcInstant(record?.verifiedAt);
    const expiresAt = parseUtcInstant(record?.expiresAt);
    const isPostExpandAssurance = record?.name === "recoveryAssurance";
    if (!exactKeys(record, [
      "expiresAt",
      "name",
      "rawEvidenceSha256",
      "receiptSha256",
      "verifiedAt",
    ])
        || record.name !== SUCCESSOR_RUNTIME_EVIDENCE_NAMES[index]
        || !SHA256.test(record.receiptSha256 ?? "")
        || !SHA256.test(record.rawEvidenceSha256 ?? "")
        || verifiedAt === null
        || expiresAt === null
        || (isPostExpandAssurance
          ? verifiedAt < startedAt || verifiedAt > completedAt || expiresAt <= completedAt
          : verifiedAt > startedAt || expiresAt <= startedAt)) {
      return false;
    }
  }
  const expectedSha256 = textSha256(
    `${records.map((record) => [
      record.name,
      record.receiptSha256,
      record.rawEvidenceSha256,
      record.verifiedAt,
      record.expiresAt,
    ].join(":")).join("\n")}\n`,
  );
  return expectedSha256 === receipt.successorRuntimeEvidenceSetSha256;
}

function validateOutcomeReceipt({
  receipt,
  sha256,
  path,
  manifest,
  expectedCommit,
  remoteRef,
  releaseLock,
}) {
  const successorRelease = manifest.status === "controller_ready";
  let successorCheckpointBindingSha256 = null;
  if (successorRelease) {
    try {
      successorCheckpointBindingSha256 =
        computeSuccessorReleaseCheckpointBindingSha256({
          version: receipt.successorCheckpointBindingVersion,
          release: receipt.release,
          projectRef: receipt.projectRef,
          expectedCommit: receipt.releaseCommit,
          outcomeReceiptPathSha256: receipt.outcomeReceiptPathSha256,
          backupReceiptSha256: receipt.backupReceiptSha256,
          backupDirectoryPathSha256: receipt.backupDirectoryPathSha256,
          backupArtifactSetSha256: receipt.backupArtifactSetSha256,
          backupSourceCapturedAt: receipt.backupSourceCapturedAt,
          startedAt: receipt.startedAt,
          writeFenceEvidenceSha256: receipt.writeFenceEvidenceSha256,
          preApplySuccessorRuntimeEvidenceSetSha256:
            receipt.preApplySuccessorRuntimeEvidenceSetSha256,
        });
    } catch {
      successorCheckpointBindingSha256 = null;
    }
  }
  if (receipt.receiptVersion !== 1
      || receipt.status !== "database_expand_verified_lease_held"
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.remoteRef !== remoteRef
      || receipt.remoteReleaseLeaseOwnerId !== releaseLock.remoteReleaseLeaseOwnerId
      || (successorRelease
        ? receipt.outcomeReceiptPathSha256
              !== releaseLock.outcomeReceiptPathSha256
          || receipt.remoteReleaseLeaseCheckpointBindingSha256
              !== releaseLock.remoteReleaseLeaseCheckpointBindingSha256
          || receipt.remoteReleaseLeaseOutcomePathSha256
              !== releaseLock.remoteReleaseLeaseCheckpointBindingSha256
          || successorCheckpointBindingSha256
              !== releaseLock.remoteReleaseLeaseCheckpointBindingSha256
        : receipt.remoteReleaseLeaseOutcomePathSha256
            !== releaseLock.outcomeReceiptPathSha256)
      || receipt.remoteReleaseLeasePhase !== "deployment-canary"
      || receipt.postPendingCount !== 0
      || !validateOutcomeCheckEvidence(receipt, manifest, "postPush")
      || !validateOutcomeCheckEvidence(receipt, manifest, "postApply")
      || receipt.postconditionsPassed
        !== receipt.postPushCheckCount + receipt.postApplyCheckCount
      || (successorRelease
        && !validateSuccessorRuntimeEvidenceSummary(receipt))
      || parseCanonicalInstant(receipt.completedAt) === null
      || receipt.supabaseCliVersion !== manifest.backupContract.supabaseCli.version
      || receipt.supabaseCliBinarySha256
        !== manifest.backupContract.supabaseCli.binarySha256
      || receipt.rerunProhibited !== true
      || receipt.containsSecrets !== false
      || textSha256(resolve(path)) !== releaseLock.outcomeReceiptPathSha256
      || !SHA256.test(sha256)) {
    blocked("RELEASE_OUTCOME_INVALID", "outcome is not the exact lease-held deployment-canary checkpoint");
  }
  return {
    sha256,
    completedAt: receipt.completedAt,
    leaseOwnerId: receipt.remoteReleaseLeaseOwnerId,
    outcomePathSha256: receipt.remoteReleaseLeaseOutcomePathSha256,
  };
}

function validateDeploymentReceipt({
  receipt,
  sha256,
  manifest,
  expectedCommit,
  nowMs,
}) {
  const keys = [
    "receiptVersion",
    "kind",
    "release",
    "projectRef",
    "releaseCommit",
    "deploymentId",
    "deploymentUrl",
    "deploymentUrlSha256",
    "deploymentCreatedAt",
    "readyAt",
    "verifiedAt",
    "target",
    "readyState",
    "source",
    "provenance",
    "containsSecrets",
  ];
  const deploymentCreatedAt = parseCanonicalInstant(receipt.deploymentCreatedAt);
  const readyAt = parseCanonicalInstant(receipt.readyAt);
  const verifiedAt = parseCanonicalInstant(receipt.verifiedAt);
  const deploymentUrl = parseCanonicalDeploymentUrl(receipt.deploymentUrl);
  if (!exactKeys(receipt, keys)
      || receipt.receiptVersion !== 1
      || receipt.kind !== "vercel-production-deployment"
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || !DEPLOYMENT_ID.test(receipt.deploymentId ?? "")
      || receipt.deploymentUrl !== deploymentUrl
      || receipt.deploymentUrlSha256 !== textSha256(deploymentUrl)
      || deploymentCreatedAt === null
      || readyAt === null
      || verifiedAt === null
      || deploymentCreatedAt > readyAt
      || readyAt > verifiedAt
      || verifiedAt > nowMs + 60_000
      || nowMs - verifiedAt > DEPLOYMENT_MAXIMUM_AGE_MINUTES * 60_000
      || receipt.target !== "production"
      || receipt.readyState !== "READY"
      || receipt.source !== "vercel-api"
      || receipt.containsSecrets !== false
      || !SHA256.test(sha256)) {
    blocked("DEPLOYMENT_RECEIPT_INVALID", "deployment receipt is stale, mismatched or non-canonical");
  }
  return {
    sha256,
    deploymentId: receipt.deploymentId,
    deploymentUrl,
    deploymentUrlSha256: receipt.deploymentUrlSha256,
    readyAt,
    verifiedAt,
  };
}

async function validatePostExpandBackupReceipt({
  receipt,
  sha256,
  path,
  repoRoot,
  manifest,
  contract,
  expectedCommit,
  nowMs,
}) {
  const keys = [
    "Verified",
    "BackupDirectory",
    "BackupSetId",
    "ManifestSha256",
    "InventoryContractSha256",
    "SourceRelationContractSha256",
    "LiveSchemaContractSha256",
    "LogicalDataContractSha256",
    "GitCommit",
    "SupabaseCliVersion",
    "SupabaseCliBinarySha256",
    "NodeVersion",
    "NodeSha256",
    "PGliteVersion",
    "PGliteTreeSha256",
    "CreatedAtUtc",
    "SourceCapturedAt",
    "InventoryCapturedAt",
    "AgeSeconds",
    "TableCount",
    "TotalRows",
    "SourceCanonicalDigestsVerified",
    "PGliteJsonbRoundTripVerified",
    "PrimaryConstraintsChecked",
    "ForeignKeysChecked",
    "ExternalForeignKeysSkipped",
    "PlaintextWrittenToDisk",
  ];
  const createdAt = parseUtcInstant(receipt.CreatedAtUtc);
  const sourceCapturedAt = parseUtcInstant(receipt.SourceCapturedAt);
  const inventoryCapturedAt = parseUtcInstant(receipt.InventoryCapturedAt);
  const currentAgeMs = createdAt === null ? Number.NaN : nowMs - createdAt;
  if (!exactKeys(receipt, keys)
      || receipt.Verified !== contract.requiredReceiptValues.Verified
      || receipt.SourceCanonicalDigestsVerified
        !== contract.requiredReceiptValues.SourceCanonicalDigestsVerified
      || receipt.PGliteJsonbRoundTripVerified
        !== contract.requiredReceiptValues.PGliteJsonbRoundTripVerified
      || receipt.PlaintextWrittenToDisk
        !== contract.requiredReceiptValues.PlaintextWrittenToDisk
      || !isAbsolute(receipt.BackupDirectory ?? "")
      || inside(repoRoot, receipt.BackupDirectory)
      || !CANONICAL_UUID.test(receipt.BackupSetId ?? "")
      || !UPPER_SHA256.test(receipt.ManifestSha256 ?? "")
      || !UPPER_SHA256.test(receipt.InventoryContractSha256 ?? "")
      || !UPPER_SHA256.test(receipt.SourceRelationContractSha256 ?? "")
      || !UPPER_SHA256.test(receipt.LiveSchemaContractSha256 ?? "")
      || !UPPER_SHA256.test(receipt.LogicalDataContractSha256 ?? "")
      || receipt.GitCommit !== expectedCommit
      || receipt.SupabaseCliVersion
        !== manifest.backupContract.supabaseCli.version
      || receipt.SupabaseCliBinarySha256
        !== manifest.backupContract.supabaseCli.binarySha256
      || !/^v\d+\.\d+\.\d+$/.test(receipt.NodeVersion ?? "")
      || !UPPER_SHA256.test(receipt.NodeSha256 ?? "")
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(receipt.PGliteVersion ?? "")
      || !UPPER_SHA256.test(receipt.PGliteTreeSha256 ?? "")
      || createdAt === null
      || sourceCapturedAt === null
      || inventoryCapturedAt === null
      || sourceCapturedAt > inventoryCapturedAt
      || inventoryCapturedAt > createdAt
      || !Number.isFinite(currentAgeMs)
      || currentAgeMs < -60_000
      || currentAgeMs > contract.maximumAgeMinutes * 60_000
      || !Number.isFinite(receipt.AgeSeconds)
      || receipt.AgeSeconds < 0
      || receipt.AgeSeconds > contract.maximumAgeMinutes * 60
      || receipt.AgeSeconds * 1_000 > currentAgeMs + 60_000
      || receipt.TableCount !== contract.expectedTableCount
      || !safeNonnegativeInteger(receipt.TotalRows, 250_000)
      || !safeNonnegativeInteger(receipt.PrimaryConstraintsChecked, 100_000)
      || !safeNonnegativeInteger(receipt.ForeignKeysChecked, 100_000)
      || !safeNonnegativeInteger(receipt.ExternalForeignKeysSkipped, 100_000)
      || !SHA256.test(sha256)) {
    blocked(
      "POST_EXPAND_BACKUP_RECEIPT_INVALID",
      "post-expand backup receipt is stale, altered, incomplete or not exact for this release",
    );
  }

  const backupDirectoryMetadata = await lstat(receipt.BackupDirectory)
    .catch(() => null);
  const backupDirectoryRealPath = await realpath(receipt.BackupDirectory)
    .catch(() => null);
  if (!backupDirectoryMetadata?.isDirectory()
      || backupDirectoryMetadata.isSymbolicLink()
      || !backupDirectoryRealPath
      || inside(repoRoot, backupDirectoryRealPath)) {
    blocked(
      "POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "post-expand backup directory must be an existing non-symlink directory outside Git",
    );
  }
  const expectedEntries = [
    "logical-data.json.hbam2",
    "logical-data.json.key.dpapi",
    "manifest.json",
    "schema-inventory.json.hbam2",
    "schema-inventory.json.key.dpapi",
  ];
  const entries = await readdir(backupDirectoryRealPath, { withFileTypes: true })
    .catch(() => []);
  const entryNames = entries.map((entry) => entry.name).sort();
  if (!exactArray(entryNames, expectedEntries)
      || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    blocked(
      "POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "post-expand backup directory does not contain the exact encrypted artifact set",
    );
  }
  const backupManifestPath = join(backupDirectoryRealPath, "manifest.json");
  if (await rawFileSha256(backupManifestPath, { upper: true })
        !== receipt.ManifestSha256) {
    blocked(
      "POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "post-expand backup manifest differs from the verification receipt",
    );
  }
  const backupManifest = (await readBoundedJsonFileWithLimit(
    backupManifestPath,
    "post-expand backup manifest",
    MAX_BACKUP_MANIFEST_BYTES,
  )).receipt;
  const manifestTableNames = backupManifest.tables
    && typeof backupManifest.tables === "object"
    && !Array.isArray(backupManifest.tables)
    ? Object.keys(backupManifest.tables)
    : [];
  const cliBinaryPath = backupManifest.supabase_cli?.invocation_relative_path;
  if (backupManifest.format !== "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser"
      || backupManifest.format_version !== 2
      || backupManifest.status !== "complete"
      || backupManifest.backup_set_id !== receipt.BackupSetId
      || backupManifest.created_at_utc !== receipt.CreatedAtUtc
      || backupManifest.source_captured_at !== receipt.SourceCapturedAt
      || backupManifest.inventory_captured_at !== receipt.InventoryCapturedAt
      || backupManifest.inventory_contract_sha256
        !== receipt.InventoryContractSha256
      || backupManifest.source_relation_contract_sha256
        !== receipt.SourceRelationContractSha256
      || backupManifest.live_schema_contract_sha256
        !== receipt.LiveSchemaContractSha256
      || backupManifest.logical_data_contract_sha256
        !== receipt.LogicalDataContractSha256
      || backupManifest.source_project_ref !== manifest.projectRef
      || backupManifest.implementation?.git_commit !== expectedCommit
      || backupManifest.supabase_cli?.version
        !== manifest.backupContract.supabaseCli.version
      || typeof cliBinaryPath !== "string"
      || backupManifest.supabase_cli?.files?.[cliBinaryPath]
        !== manifest.backupContract.supabaseCli.binarySha256
      || backupManifest.plaintext_written_to_disk !== false
      || !exactArray(manifestTableNames, contract.expectedTables)) {
    blocked(
      "POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "post-expand backup manifest does not bind the source project, commit, exact 27 tables and verifier receipt",
    );
  }

  return {
    sha256,
    backupSetId: receipt.BackupSetId,
    manifestSha256: receipt.ManifestSha256,
    inventoryContractSha256: receipt.InventoryContractSha256,
    sourceRelationContractSha256: receipt.SourceRelationContractSha256,
    liveSchemaContractSha256: receipt.LiveSchemaContractSha256,
    logicalDataContractSha256: receipt.LogicalDataContractSha256,
    createdAt: receipt.CreatedAtUtc,
    createdAtMs: createdAt,
    tableCount: receipt.TableCount,
    totalRows: receipt.TotalRows,
    receiptPathSha256: textSha256(resolve(path)),
  };
}

const SUCCESSOR_BACKUP_RECEIPT_KEYS = Object.freeze([
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
const SUCCESSOR_BACKUP_CHECK_KEYS = Object.freeze([
  "authDataDigestsVerified",
  "encryptedArtifactsVerified",
  "exactTableContractVerified",
  "liveSchemaDigestVerified",
  "logicalDataDigestsVerified",
  "plaintextWrittenToDisk",
  "storageDataDigestsVerified",
]);
const SUCCESSOR_BACKUP_FILES = Object.freeze([
  "logical-data.json.hbam2",
  "logical-data.json.key.dpapi",
  "manifest.json",
  "schema-inventory.json.hbam2",
  "schema-inventory.json.key.dpapi",
]);

async function validateSuccessorPostExpandBackupReceipt({
  receipt,
  sha256,
  backupDirectory,
  repoRoot,
  sourceManifest,
  controllerManifest,
  contract,
  expectedCommit,
  remoteRef,
  nowMs,
}) {
  const capturedAtMs = parseCanonicalInstant(receipt?.capturedAt);
  const verifiedAtMs = parseCanonicalInstant(receipt?.verifiedAt);
  if (!exactKeys(receipt, SUCCESSOR_BACKUP_RECEIPT_KEYS)
      || receipt.receiptVersion !== 2
      || receipt.kind !== "successor-post-expand-backup-verification-v2"
      || receipt.release !== sourceManifest?.release
      || receipt.projectRef !== sourceManifest?.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.backupContractId !== contract?.id
      || receipt.backupContractVersion !== 2
      || contract?.version !== 2
      || !CANONICAL_UUID.test(receipt.backupSetId ?? "")
      || !SHA256.test(receipt.backupManifestSha256 ?? "")
      || !/^[1-9]\d{0,9}$/.test(receipt.sourceDatabaseOid ?? "")
      || !/^\d{10,32}$/.test(receipt.sourceDatabaseSystemIdentifier ?? "")
      || receipt.expectedMigrationHead !== contract.expectedReleaseMigrationHead
      || receipt.migrationVersionsSha256
        !== contract.expectedReleaseMigrationContractSha256
      || receipt.expectedTableCount !== 139
      || receipt.expectedTableCount !== contract.expectedTableCount
      || !exactArray(receipt.expectedTables, contract.expectedTables)
      || receipt.expectedTableContractSha256
        !== contract.expectedTableContractSha256
      || ![
        receipt.liveSchemaContractSha256,
        receipt.logicalDataContractSha256,
        receipt.authSchemaContractSha256,
        receipt.authUsersContractSha256,
        receipt.storageMetadataContractSha256,
        receipt.storageObjectInventorySha256,
      ].every((value) => SHA256.test(value ?? ""))
      || !exactKeys(receipt.checks, SUCCESSOR_BACKUP_CHECK_KEYS)
      || SUCCESSOR_BACKUP_CHECK_KEYS.some((key) => (
        key === "plaintextWrittenToDisk"
          ? receipt.checks[key] !== false
          : receipt.checks[key] !== true
      ))
      || receipt.containsSecrets !== false
      || capturedAtMs === null
      || verifiedAtMs === null
      || verifiedAtMs < capturedAtMs
      || verifiedAtMs > nowMs + 60_000
      || nowMs - verifiedAtMs > contract.maximumAgeMinutes * 60_000
      || !SHA256.test(sha256 ?? "")) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_RECEIPT_INVALID",
      "successor post-expand backup receipt is not the exact fresh 139-table v2 verification",
    );
  }
  if (!isAbsolute(backupDirectory ?? "") || inside(repoRoot, backupDirectory)) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_DIRECTORY_INVALID",
      "successor post-expand backup directory must be absolute and outside Git",
    );
  }
  const directoryMetadata = await lstat(backupDirectory).catch(() => null);
  const directoryRealPath = await realpath(backupDirectory).catch(() => null);
  if (!directoryMetadata?.isDirectory()
      || directoryMetadata.isSymbolicLink()
      || !directoryRealPath
      || inside(repoRoot, directoryRealPath)
      || !/^post-expand-\d{8}-\d{6}-[a-f0-9]{32}$/.test(
        basename(directoryRealPath),
      )) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_DIRECTORY_INVALID",
      "successor post-expand backup directory is missing, linked, or misnamed",
    );
  }
  const entries = await readdir(directoryRealPath, { withFileTypes: true })
    .catch(() => []);
  const entryNames = entries.map((entry) => entry.name).sort();
  if (!exactArray(entryNames, SUCCESSOR_BACKUP_FILES)
      || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "successor post-expand backup directory does not contain exactly five regular artifacts",
    );
  }
  const manifestPath = join(directoryRealPath, "manifest.json");
  const manifestData = await readBoundedJsonFileWithLimit(
    manifestPath,
    "successor post-expand backup manifest",
    MAX_BACKUP_MANIFEST_BYTES,
  );
  const backupManifest = manifestData.receipt;
  if (manifestData.sha256 !== receipt.backupManifestSha256) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "successor post-expand backup manifest differs from its v2 receipt",
    );
  }
  const sourceIdentity = backupManifest.source_database_identity;
  const cliPath = backupManifest.supabase_cli?.invocation_relative_path;
  const tableNames = backupManifest.tables
    && typeof backupManifest.tables === "object"
    && !Array.isArray(backupManifest.tables)
    ? Object.keys(backupManifest.tables)
    : [];
  if (containsSecretLikeField(backupManifest)
      || backupManifest.status !== "complete"
      || backupManifest.format
        !== "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser"
      || backupManifest.format_version !== 2
      || backupManifest.backup_type
        !== "vendor-disclosure-successor-post-expand-logical-snapshot-v2"
      || backupManifest.backup_set_id !== receipt.backupSetId
      || backupManifest.release !== sourceManifest.release
      || backupManifest.backup_contract_id !== contract.id
      || backupManifest.backup_contract_version !== 2
      || parseUtcInstant(backupManifest.created_at_utc) === null
      || backupManifest.source_captured_at !== receipt.capturedAt
      || backupManifest.source_project_ref !== sourceManifest.projectRef
      || sourceIdentity?.database_oid !== receipt.sourceDatabaseOid
      || sourceIdentity?.system_identifier
        !== receipt.sourceDatabaseSystemIdentifier
      || backupManifest.source_migration_head !== "20260819100000"
      || backupManifest.source_migration_count !== 228
      || backupManifest.release_migration_count
        !== contract.expectedReleaseMigrationVersions.length
      || backupManifest.release_migration_versions_sha256
        !== contract.expectedReleaseMigrationContractSha256
      || backupManifest.table_count !== contract.expectedTableCount
      || !exactArray(backupManifest.expected_tables, contract.expectedTables)
      || !exactArray(tableNames, contract.expectedTables)
      || backupManifest.table_contract_sha256
        !== receipt.expectedTableContractSha256
      || backupManifest.live_schema_contract_sha256
        !== receipt.liveSchemaContractSha256
      || backupManifest.logical_data_contract_sha256
        !== receipt.logicalDataContractSha256
      || backupManifest.auth_schema_contract_sha256
        !== receipt.authSchemaContractSha256
      || backupManifest.auth_users_contract_sha256
        !== receipt.authUsersContractSha256
      || backupManifest.storage_metadata_contract_sha256
        !== receipt.storageMetadataContractSha256
      || backupManifest.storage_object_inventory_sha256
        !== receipt.storageObjectInventorySha256
      || backupManifest.git_commit !== expectedCommit
      || backupManifest.git_origin
        !== controllerManifest.backupContract.expectedOrigin
      || backupManifest.git_remote_ref !== remoteRef
      || backupManifest.plaintext_written_to_disk !== false
      || backupManifest.contains_secrets !== false
      || backupManifest.supabase_cli?.version
        !== controllerManifest.backupContract.supabaseCli.version
      || typeof cliPath !== "string"
      || String(backupManifest.supabase_cli?.files?.[cliPath] ?? "")
        .toUpperCase()
        !== controllerManifest.backupContract.supabaseCli.binarySha256) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "successor post-expand backup manifest does not bind the exact source, candidate, tables, migrations, and digests",
    );
  }
  if (!exactKeys(backupManifest.artifacts, ["logical_data", "schema_inventory"])) {
    blocked(
      "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
      "successor post-expand manifest artifact contract is not exact",
    );
  }
  const artifactContracts = [
    [
      "logical_data",
      "logical-data.json.hbam2",
      "logical-data.json.key.dpapi",
    ],
    [
      "schema_inventory",
      "schema-inventory.json.hbam2",
      "schema-inventory.json.key.dpapi",
    ],
  ];
  const reopenEvidence = [];
  for (const [name, artifactFile, keyFile] of artifactContracts) {
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
        || !safeNonnegativeInteger(
          artifact.plaintext_bytes,
          MAX_SUCCESSOR_BACKUP_ARTIFACT_BYTES,
        )
        || artifact.plaintext_bytes < 1
        || !safeNonnegativeInteger(
          artifact.encrypted_bytes,
          MAX_SUCCESSOR_BACKUP_ARTIFACT_BYTES,
        )
        || artifact.encrypted_bytes < 1) {
      blocked(
        "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
        `successor ${name} encrypted artifact contract is malformed`,
      );
    }
    const [artifactDigest, keyDigest] = await Promise.all([
      readStableArtifactDigest(
        join(directoryRealPath, artifactFile),
        `${name} encrypted artifact`,
        MAX_SUCCESSOR_BACKUP_ARTIFACT_BYTES,
      ),
      readStableArtifactDigest(
        join(directoryRealPath, keyFile),
        `${name} DPAPI key`,
        MAX_SUCCESSOR_BACKUP_KEY_BYTES,
      ),
    ]);
    if (artifactDigest.sha256 !== artifact.encrypted_sha256
        || artifactDigest.bytes !== artifact.encrypted_bytes
        || keyDigest.sha256 !== artifact.key_sha256) {
      blocked(
        "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
        `successor ${name} encrypted artifact changed after verification`,
      );
    }
    reopenEvidence.push(
      `${name}:${artifactDigest.sha256}:${artifactDigest.bytes}:${keyDigest.sha256}:${keyDigest.bytes}`,
    );
  }
  const artifactReverificationSha256 = textSha256(
    `${[
      "successor-post-expand-backup-artifact-reopen-v1",
      sha256,
      manifestData.sha256,
      ...reopenEvidence,
    ].join("\n")}\n`,
  );
  return {
    sha256,
    backupSetId: receipt.backupSetId,
    manifestSha256: receipt.backupManifestSha256,
    liveSchemaContractSha256: receipt.liveSchemaContractSha256,
    logicalDataContractSha256: receipt.logicalDataContractSha256,
    createdAt: receipt.capturedAt,
    createdAtMs: capturedAtMs,
    verifiedAt: receipt.verifiedAt,
    verifiedAtMs,
    tableCount: receipt.expectedTableCount,
    releaseMigrationCount: contract.expectedReleaseMigrationVersions.length,
    artifactReverificationSha256,
    receiptPathSha256: null,
  };
}

async function reverifyPostExpandBackupReceipt({
  receipt,
  repoRoot,
  manifest,
  contract,
  runCommand,
  nowMs,
}) {
  if (process.platform !== "win32" && runCommand === defaultRunCommand) {
    blocked(
      "POST_EXPAND_BACKUP_REVERIFY_PLATFORM_INVALID",
      "the DPAPI-bound post-expand backup must be reverified on its Windows creator host",
    );
  }
  const verifierPath = join(repoRoot, contract.verifier.file);
  let powershell = "powershell.exe";
  if (runCommand === defaultRunCommand) {
    try {
      powershell = (await resolvePinnedWindowsProductionToolchain()).powershell;
    } catch (error) {
      if (error instanceof ProductionToolchainError) {
        blocked(error.code, error.message);
      }
      throw error;
    }
  }
  const verification = await requireSuccess(
    runCommand,
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      verifierPath,
      "-BackupDirectory",
      receipt.BackupDirectory,
      "-ExpectedProjectRef",
      manifest.projectRef,
      "-ExpectedBackupSetId",
      receipt.BackupSetId,
      "-ExpectedManifestSha256",
      receipt.ManifestSha256,
      "-MaximumAgeMinutes",
      String(contract.maximumAgeMinutes),
    ],
    { cwd: repoRoot, timeoutMs: 10 * 60 * 1_000 },
    "POST_EXPAND_BACKUP_REVERIFY_FAILED",
  );
  if (verification.stdout.length > MAX_RECEIPT_BYTES) {
    blocked(
      "POST_EXPAND_BACKUP_REVERIFY_INVALID",
      "post-expand backup verifier returned oversized evidence",
    );
  }
  let fresh;
  try {
    fresh = JSON.parse(verification.stdout.trim());
  } catch {
    blocked(
      "POST_EXPAND_BACKUP_REVERIFY_INVALID",
      "post-expand backup verifier did not return one JSON receipt",
    );
  }
  const receiptKeys = Object.keys(receipt);
  const immutableReceiptKeys = receiptKeys.filter((key) => key !== "AgeSeconds");
  const freshAgeSeconds = fresh?.AgeSeconds;
  const currentAgeSeconds = (nowMs - parseUtcInstant(receipt.CreatedAtUtc)) / 1_000;
  if (!exactKeys(fresh, receiptKeys)
      || containsSecretLikeField(fresh)
      || immutableReceiptKeys.some((key) => fresh[key] !== receipt[key])
      || !Number.isFinite(freshAgeSeconds)
      || freshAgeSeconds < Math.max(0, receipt.AgeSeconds - 1)
      || freshAgeSeconds > contract.maximumAgeMinutes * 60
      || freshAgeSeconds < currentAgeSeconds - 60
      || freshAgeSeconds > currentAgeSeconds + 10 * 60) {
    blocked(
      "POST_EXPAND_BACKUP_REVERIFY_MISMATCH",
      "fresh pinned verifier evidence differs from the supplied post-expand receipt",
    );
  }
  return {
    sha256: textSha256(verification.stdout),
    ageSeconds: freshAgeSeconds,
  };
}

function validatePostExpandHostedRestoreReceipt({
  receipt,
  sha256,
  manifest,
  contract,
  expectedCommit,
  backup,
  nowMs,
}) {
  const keys = [
    "receiptVersion",
    "kind",
    "release",
    "releaseCommit",
    "sourceProjectRef",
    "targetProjectRef",
    "backupSetId",
    "backupManifestSha256",
    "sourceSchemaContractSha256",
    "targetSchemaContractSha256",
    "sourceDataContractSha256",
    "targetDataContractSha256",
    "sourceLiveSchemaContractSha256",
    "targetLiveSchemaContractSha256",
    "sourceLogicalDataContractSha256",
    "targetLogicalDataContractSha256",
    "targetTables",
    "targetReleaseMigrationVersions",
    "targetTableContractSha256",
    "targetReleaseMigrationContractSha256",
    "providerRestoreJobId",
    "restoreCompletedAt",
    "verifiedAt",
    "checks",
    "provenance",
    "containsSensitiveValues",
  ];
  const restoreCompletedAt = parseUtcInstant(receipt.restoreCompletedAt);
  const verifiedAt = parseUtcInstant(receipt.verifiedAt);
  const checksValid = exactKeys(
    receipt.checks,
    POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
  ) && POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS.every(
    (check) => receipt.checks[check] === true,
  );
  if (!exactKeys(receipt, keys)
      || receipt.receiptVersion !== 1
      || receipt.kind !== "post-expand-hosted-restore-evidence"
      || receipt.release !== manifest.release
      || receipt.releaseCommit !== expectedCommit
      || receipt.sourceProjectRef !== manifest.projectRef
      || !PROJECT_REF.test(receipt.targetProjectRef ?? "")
      || receipt.targetProjectRef === manifest.projectRef
      || receipt.backupSetId !== backup.backupSetId
      || receipt.backupManifestSha256 !== backup.manifestSha256
      || receipt.sourceSchemaContractSha256
        !== backup.inventoryContractSha256
      || receipt.targetSchemaContractSha256
        !== backup.inventoryContractSha256
      || receipt.sourceDataContractSha256
        !== backup.sourceRelationContractSha256
      || receipt.targetDataContractSha256
        !== backup.sourceRelationContractSha256
      || receipt.sourceLiveSchemaContractSha256
        !== backup.liveSchemaContractSha256
      || receipt.targetLiveSchemaContractSha256
        !== backup.liveSchemaContractSha256
      || receipt.sourceLogicalDataContractSha256
        !== backup.logicalDataContractSha256
      || receipt.targetLogicalDataContractSha256
        !== backup.logicalDataContractSha256
      || !exactArray(receipt.targetTables, contract.expectedTables)
      || !exactArray(
        receipt.targetReleaseMigrationVersions,
        contract.expectedReleaseMigrationVersions,
      )
      || receipt.targetTableContractSha256
        !== contract.expectedTableContractSha256
      || receipt.targetReleaseMigrationContractSha256
        !== contract.expectedReleaseMigrationContractSha256
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(
        receipt.providerRestoreJobId ?? "",
      )
      || restoreCompletedAt === null
      || verifiedAt === null
      || restoreCompletedAt < backup.createdAtMs
      || verifiedAt < restoreCompletedAt
      || verifiedAt > nowMs + 5 * 60_000
      || nowMs - verifiedAt
        > contract.hostedRestoreEvidence.maximumAgeMinutes * 60_000
      || !checksValid
      || receipt.containsSensitiveValues !== false
      || !SHA256.test(sha256)) {
    blocked(
      "POST_EXPAND_HOSTED_RESTORE_RECEIPT_INVALID",
      "hosted restore evidence does not prove the different-project exact 27-table and 09:00..11:70 restore",
    );
  }
  return {
    sha256,
    targetProjectRef: receipt.targetProjectRef,
    restoreCompletedAt: receipt.restoreCompletedAt,
    verifiedAt: receipt.verifiedAt,
    verifiedAtMs: verifiedAt,
    checkCount: POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS.length,
    liveSchemaContractSha256: receipt.targetLiveSchemaContractSha256,
    logicalDataContractSha256: receipt.targetLogicalDataContractSha256,
  };
}

async function validateSuccessorRecoveryAssuranceEvidence({
  repoRoot,
  receiptRoot,
  recoveryReceiptPath,
  recoveryReceiptSha256,
  sourceManifest,
  controllerManifest,
  expectedCommit,
  outcomeReceipt,
  postExpandBackup,
  postExpandBackupReceiptSha256,
  now,
  validateRuntimeEvidence = validateSuccessorRuntimeEvidence,
  storageOriginalBytesBackupReceiptPath,
  reverifyStorageOriginalBytes =
    reverifyVendorDisclosureSuccessorStorageOriginalBytesFiles,
}) {
  const contract = sourceManifest?.deploymentEvidence?.recoveryAssurance;
  if (resolve(recoveryReceiptPath)
        !== resolve(receiptRoot, contract?.receiptFileName ?? "invalid")
      || !SHA256.test(recoveryReceiptSha256 ?? "")) {
    blocked(
      "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
      "recovery-assurance receipt path does not match the exact private runtime contract",
    );
  }
  let runtime;
  try {
    runtime = validateRuntimeEvidence({
      repoRoot,
      receiptRoot,
      manifest: sourceManifest,
      controllerManifest,
      expectedCommit,
      phase: "complete",
      now,
    });
  } catch (error) {
    if (error instanceof SuccessorReleaseContractError) {
      blocked(
        "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
        `no-cost recovery evidence failed live revalidation: ${error.code}`,
      );
    }
    throw error;
  }
  const runtimeNames = Object.keys(runtime).sort();
  if (!exactArray(runtimeNames, SUCCESSOR_RUNTIME_EVIDENCE_NAMES)) {
    blocked(
      "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
      "live runtime evidence does not contain the exact no-cost five-record set",
    );
  }
  const storageProvenance = runtime.storage?.storageProvenance;
  let storageFiles;
  try {
    if (!storageProvenance) throw new Error("missing Storage provenance");
    storageFiles = await reverifyStorageOriginalBytes({
      repoRoot,
      receiptPath: storageOriginalBytesBackupReceiptPath,
      provenance: storageProvenance,
      manifest: sourceManifest,
      expectedCommit,
    });
  } catch {
    blocked(
      "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
      "Storage original-byte receipt, private manifest, or encrypted archive failed live hash revalidation",
    );
  }
  const outcomeRecords = outcomeReceipt?.successorRuntimeEvidence;
  if (!Array.isArray(outcomeRecords)
      || outcomeRecords.length !== runtimeNames.length) {
    blocked(
      "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
      "release outcome does not retain the live no-cost evidence set",
    );
  }
  for (const [index, name] of runtimeNames.entries()) {
    const live = runtime[name];
    const retained = outcomeRecords[index];
    if (retained?.name !== name
        || retained.receiptSha256 !== live.receiptSha256
        || retained.rawEvidenceSha256 !== live.rawEvidenceSha256
        || retained.verifiedAt !== live.verifiedAt
        || retained.expiresAt !== live.expiresAt) {
      blocked(
        "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
        "release outcome runtime hashes differ from the safely reopened evidence files",
      );
    }
  }
  const liveSetSha256 = textSha256(
    `${outcomeRecords.map((record) => [
      record.name,
      record.receiptSha256,
      record.rawEvidenceSha256,
      record.verifiedAt,
      record.expiresAt,
    ].join(":")).join("\n")}\n`,
  );
  const recovery = runtime.recoveryAssurance;
  const observations = recovery?.observations;
  let releaseAssurance;
  try {
    releaseAssurance = validateSuccessorNoAdditionalCostReleaseAssurance(
      recovery?.releaseAssurance,
    );
    validateSuccessorNoAdditionalCostReleaseAssurance(
      outcomeReceipt?.successorReleaseAssurance,
    );
  } catch {
    blocked(
      "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
      "successor evidence must disclose that no hosted restore was performed or claimed",
    );
  }
  if (liveSetSha256 !== outcomeReceipt.successorRuntimeEvidenceSetSha256
      || recovery.receiptSha256 !== recoveryReceiptSha256
      || observations?.backupContractId !== controllerManifest.backupContract.id
      || observations?.postExpandBackupContractId
        !== controllerManifest.postExpandBackupContract.id
      || observations?.postExpandBackupReceiptSha256
        !== postExpandBackupReceiptSha256
      || observations?.postExpandBackupManifestSha256
        !== postExpandBackup.manifestSha256
      || observations?.postExpandBackupReverificationSha256
        !== postExpandBackup.artifactReverificationSha256
      || observations?.postExpandLiveSchemaContractSha256
        !== postExpandBackup.liveSchemaContractSha256
      || observations?.postExpandLogicalDataContractSha256
        !== postExpandBackup.logicalDataContractSha256
      || observations?.postExpandEncryptedArtifactsVerified !== true
      || observations?.postExpandPGliteJsonbRoundTripVerified !== true
      || observations?.providerPhysicalBackupStatus
        !== controllerManifest.backupContract.providerPhysicalBackup.requiredStatus
      || JSON.stringify(releaseAssurance)
        !== JSON.stringify(SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE)
      || JSON.stringify(outcomeReceipt.successorReleaseAssurance)
        !== JSON.stringify(SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE)) {
    blocked(
      "SUCCESSOR_RECOVERY_ASSURANCE_INVALID",
      "recovery assurance does not bind the retained Staging/backup proofs and live post-expand encrypted artifacts",
    );
  }
  return {
    sha256: recoveryReceiptSha256,
    rawSha256: recovery.rawEvidenceSha256,
    verifiedAt: recovery.verifiedAt,
    verifiedAtMs: parseUtcInstant(recovery.verifiedAt),
    releaseAssurance,
    observations,
    storageOriginalBytesBackupReceiptSha256: storageFiles.receiptSha256,
    storageOriginalBytesPrivateRawSha256: storageFiles.privateRawSha256,
    storageEncryptedBackupArtifactSha256:
      storageFiles.encryptedBackupArtifactSha256,
    storageOriginalBytesManifestSha256:
      storageFiles.originalBytesManifestSha256,
  };
}

function validateCanaryReceipt({
  receipt,
  sha256,
  manifest,
  expectedCommit,
  outcome,
  deployment,
  postExpandBackup,
  postExpandRecoveryProof,
  nowMs,
}) {
  const successorController = manifest.status === "controller_ready";
  const recoveryProofReceiptKey = successorController
    ? "recoveryAssuranceReceiptSha256"
    : "postExpandHostedRestoreReceiptSha256";
  const keys = [
    "receiptVersion",
    "kind",
    "release",
    "projectRef",
    "releaseCommit",
    "deploymentId",
    "deploymentUrlSha256",
    "deploymentReceiptSha256",
    "releaseOutcomeReceiptSha256",
    "postExpandBackupReceiptSha256",
    recoveryProofReceiptKey,
    "observationStartedAt",
    "verifiedAt",
    "expiresAt",
    "observationWindowSeconds",
    "checks",
    "provenance",
    "containsSecrets",
  ];
  const observationStartedAt = parseCanonicalInstant(receipt.observationStartedAt);
  const verifiedAt = parseCanonicalInstant(receipt.verifiedAt);
  const expiresAt = parseCanonicalInstant(receipt.expiresAt);
  const checksValid = exactKeys(receipt.checks, REQUIRED_CANARY_CHECKS)
    && REQUIRED_CANARY_CHECKS.every((check) => receipt.checks[check] === true);
  if (!exactKeys(receipt, keys)
      || receipt.receiptVersion !== 1
      || receipt.kind !== "production-write-fenced-canary"
      || receipt.release !== manifest.release
      || receipt.projectRef !== manifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.deploymentId !== deployment.deploymentId
      || receipt.deploymentUrlSha256 !== deployment.deploymentUrlSha256
      || receipt.deploymentReceiptSha256 !== deployment.sha256
      || receipt.releaseOutcomeReceiptSha256 !== outcome.sha256
      || receipt.postExpandBackupReceiptSha256 !== postExpandBackup.sha256
      || receipt[recoveryProofReceiptKey] !== postExpandRecoveryProof.sha256
      || observationStartedAt === null
      || verifiedAt === null
      || expiresAt === null
      || observationStartedAt < deployment.readyAt
      || observationStartedAt < parseCanonicalInstant(outcome.completedAt)
      || observationStartedAt < postExpandRecoveryProof.verifiedAtMs
      || verifiedAt < observationStartedAt
      || !Number.isSafeInteger(receipt.observationWindowSeconds)
      || receipt.observationWindowSeconds < 300
      || receipt.observationWindowSeconds > 3_600
      || verifiedAt - observationStartedAt
        !== receipt.observationWindowSeconds * 1_000
      || expiresAt - verifiedAt !== CANARY_MAXIMUM_AGE_MINUTES * 60_000
      || verifiedAt > nowMs + 60_000
      || expiresAt <= nowMs
      || !checksValid
      || receipt.containsSecrets !== false
      || !SHA256.test(sha256)) {
    blocked("CANARY_RECEIPT_INVALID", "canary evidence is stale, incomplete, mismatched or altered");
  }
  return {
    sha256,
    verifiedAt: receipt.verifiedAt,
    expiresAt: receipt.expiresAt,
    observationStartedAt: receipt.observationStartedAt,
    observationWindowSeconds: receipt.observationWindowSeconds,
  };
}

export function renderProductionWriteFenceFinalizerSql(
  template,
  evidence,
  postExpandBackupContract = {
    expectedTableContractSha256:
      AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
    expectedReleaseMigrationContractSha256:
      AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  },
) {
  const usesRecoveryAssurance =
    evidence.recoveryAssuranceReceiptSha256 !== undefined;
  if (usesRecoveryAssurance
        === (evidence.postExpandHostedRestoreReceiptSha256 !== undefined)) {
    blocked(
      "FINALIZER_EVIDENCE_INVALID",
      "finalizer evidence must bind exactly one status-specific recovery proof",
    );
  }
  const patterns = {
    projectRef: PROJECT_REF,
    databaseSystemIdentifier: /^\d{10,32}$/,
    release: RELEASE_ID,
    releaseCommit: COMMIT,
    leaseOwnerId: OWNER_UUID,
    outcomePathSha256: SHA256,
    outcomeReceiptSha256: SHA256,
    deploymentId: DEPLOYMENT_ID,
    deploymentUrlSha256: SHA256,
    deploymentReceiptSha256: SHA256,
    canaryReceiptSha256: SHA256,
    postExpandBackupReceiptSha256: SHA256,
    postExpandBackupReverificationSha256: SHA256,
    ...(usesRecoveryAssurance
      ? { recoveryAssuranceReceiptSha256: SHA256 }
      : { postExpandHostedRestoreReceiptSha256: SHA256 }),
    postExpandBackupSetId: CANONICAL_UUID,
    postExpandBackupManifestSha256:
      usesRecoveryAssurance ? SHA256 : UPPER_SHA256,
    postExpandTableContractSha256: SHA256,
    postExpandMigrationContractSha256: SHA256,
    postExpandLiveSchemaContractSha256:
      usesRecoveryAssurance ? SHA256 : UPPER_SHA256,
    postExpandLogicalDataContractSha256:
      usesRecoveryAssurance ? SHA256 : UPPER_SHA256,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    if (!pattern.test(evidence[key] ?? "")) {
      blocked("FINALIZER_EVIDENCE_INVALID", `invalid finalizer evidence field: ${key}`);
    }
  }
  if (parseCanonicalInstant(evidence.canaryVerifiedAt) === null
      || parseCanonicalInstant(evidence.canaryExpiresAt) === null) {
    blocked("FINALIZER_EVIDENCE_INVALID", "finalizer canary timestamps are non-canonical");
  }
  if (evidence.postExpandTableContractSha256
        !== postExpandBackupContract?.expectedTableContractSha256
      || evidence.postExpandMigrationContractSha256
        !== postExpandBackupContract?.expectedReleaseMigrationContractSha256) {
    blocked(
      "FINALIZER_EVIDENCE_INVALID",
      "post-expand table and migration contract digests are not exact",
    );
  }
  let rendered = template.replace(/\r\n?/g, "\n");
  const statusSpecificTokens = usesRecoveryAssurance
    ? {
      recoveryAssuranceReceiptSha256:
        SUCCESSOR_RECOVERY_ASSURANCE_TEMPLATE_TOKEN,
    }
    : {
      postExpandHostedRestoreReceiptSha256:
        PREDECESSOR_HOSTED_RESTORE_TEMPLATE_TOKEN,
    };
  for (const [key, token] of Object.entries({
    ...TEMPLATE_TOKENS,
    ...statusSpecificTokens,
  })) {
    const count = rendered.split(token).length - 1;
    if (count !== 1) {
      blocked("FINALIZER_TEMPLATE_INVALID", `finalizer template token count is not exact: ${key}`);
    }
    rendered = rendered.replace(token, evidence[key]);
  }
  if (/__HB_FINALIZER_[A-Z0-9_]+__/.test(rendered)) {
    blocked("FINALIZER_TEMPLATE_INVALID", "unresolved finalizer template token remains");
  }
  return compactFinalizerSql(rendered);
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
  const status = await requireSuccess(
    runCommand,
    git,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repoRoot },
    "GIT_STATUS_FAILED",
  );
  if (status.stdout.trim()) blocked("WORKTREE_DIRTY", "finalizer requires a completely clean release checkout");
  const head = await requireSuccess(
    runCommand,
    git,
    ["rev-parse", "HEAD"],
    { cwd: repoRoot },
    "GIT_HEAD_FAILED",
  );
  if (head.stdout.trim() !== expectedCommit) blocked("HEAD_MISMATCH", "HEAD differs from the expected commit");
  const origin = await requireSuccess(
    runCommand,
    git,
    ["remote", "get-url", "origin"],
    { cwd: repoRoot },
    "GIT_ORIGIN_FAILED",
  );
  if (origin.stdout.trim() !== expectedOrigin) blocked("GIT_ORIGIN_MISMATCH", "origin differs from the manifest");
  const branch = remoteRef.slice("origin/".length);
  const remote = await requireSuccess(
    runCommand,
    git,
    ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`],
    { cwd: repoRoot },
    "REMOTE_REF_CHECK_FAILED",
  );
  const lines = remote.stdout.trim().split(/\r?\n/).filter(Boolean);
  const [remoteCommit, remoteName] = lines.length === 1
    ? lines[0].trim().split(/\s+/)
    : [];
  if (lines.length !== 1
      || remoteCommit !== expectedCommit
      || remoteName !== `refs/heads/${branch}`) {
    blocked("REMOTE_COMMIT_MISMATCH", "remote branch is not the immutable expected commit");
  }
}

async function createLinkedRefFence(repoRoot, expectedRef) {
  const path = join(repoRoot, "supabase", ".temp", "project-ref");
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()) {
    blocked("LINKED_REF_INVALID", "Supabase linked project ref is missing or unsafe");
  }
  const content = (await readFile(path, "utf8")).trim();
  if (content !== expectedRef) blocked("LINKED_REF_MISMATCH", "Supabase is linked to another project");
  const fingerprint = `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}`;
  return async () => {
    const current = await lstat(path).catch(() => null);
    const currentContent = current?.isFile() ? (await readFile(path, "utf8")).trim() : "";
    const currentFingerprint = current
      ? `${current.dev}:${current.ino}:${current.size}:${current.mtimeMs}`
      : "missing";
    if (currentContent !== expectedRef || currentFingerprint !== fingerprint) {
      blocked("LINKED_REF_CHANGED", "linked project ref changed during finalization");
    }
  };
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
  blocked("SUPABASE_CLI_PLATFORM_UNSUPPORTED", "host platform has no approved Supabase CLI package");
}

async function resolvePinnedSupabaseCli(repoRoot, manifest, outcomeReceipt) {
  const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  const wrapperPath = join(repoRoot, "node_modules", "supabase", "package.json");
  const wrapper = JSON.parse(await readFile(wrapperPath, "utf8"));
  const expectedVersion = manifest.backupContract.supabaseCli.version;
  if (packageJson.devDependencies?.supabase !== expectedVersion
      || wrapper.version !== expectedVersion
      || outcomeReceipt.supabaseCliVersion !== expectedVersion
      || outcomeReceipt.supabaseCliBinarySha256
        !== manifest.backupContract.supabaseCli.binarySha256) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "Supabase CLI version or receipt provenance differs");
  }
  const wrapperDirectory = await realpath(dirname(wrapperPath)).catch(() => null);
  if (!wrapperDirectory || !inside(repoRoot, wrapperDirectory)) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "Supabase CLI wrapper resolved outside the repository");
  }
  const candidates = [];
  for (const name of cliPackageCandidates()) {
    const packagePath = join(dirname(wrapperDirectory), "@supabase", name, "package.json");
    const metadata = await lstat(packagePath).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) continue;
    const nativePackage = JSON.parse(await readFile(packagePath, "utf8"));
    if (nativePackage.version !== expectedVersion) {
      blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "native Supabase CLI package is not pinned");
    }
    candidates.push(join(
      dirname(packagePath),
      "bin",
      `supabase${process.platform === "win32" ? ".exe" : ""}`,
    ));
  }
  if (candidates.length !== 1) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "exactly one native Supabase CLI must be installed");
  }
  const binary = candidates[0];
  const metadata = await lstat(binary).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()
      || await rawFileSha256(binary, { upper: true })
        !== manifest.backupContract.supabaseCli.binarySha256) {
    blocked("SUPABASE_CLI_PROVENANCE_MISMATCH", "native Supabase CLI binary hash differs");
  }
  return binary;
}

async function writeJsonAtomic(path, value, { exclusive = false } = {}) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (exclusive) {
    const handle = await open(path, "wx", 0o600).catch(() => null);
    if (!handle) blocked("RECEIPT_PATH_EXISTS", "finalization receipt path already exists");
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

export async function runProductionWriteFenceFinalizer({
  repoRoot: requestedRepoRoot,
  argv,
  runCommand = defaultRunCommand,
  now = () => new Date(),
  resolveSupabaseCli = resolvePinnedSupabaseCli,
} = {}) {
  const repoRoot = resolve(requestedRepoRoot ?? process.cwd());
  const options = parseArgs(argv ?? []);
  assertSafeExecutionEnvironment(process.env);
  const {
    manifest,
    successorReleaseManifest,
    contract: finalizationContract,
    operation,
    postExpandBackupContract,
    sql,
  } = await loadFinalizationManifest(repoRoot);
  const successorController = manifest.status === "controller_ready";
  validateStatusSpecificArguments(options, successorController);

  const canonicalRepoRoot = await realpath(repoRoot);
  const canonicalReceiptPaths = [];
  const recoveryProofReceiptPath = successorController
    ? options.recoveryAssuranceReceipt
    : options.postExpandHostedRestoreReceipt;
  for (const path of [
    options.releaseOutcome,
    options.deploymentReceipt,
    options.postExpandBackupReceipt,
    recoveryProofReceiptPath,
    options.canaryReceipt,
    options.receiptOut,
  ]) {
    if (!isAbsolute(path) || inside(repoRoot, path) || !path.toLowerCase().endsWith(".json")) {
      blocked("RECEIPT_PATH_INVALID", "all finalizer receipts must be absolute JSON paths outside Git");
    }
    const parent = await realpath(dirname(path)).catch(() => null);
    if (!parent || inside(canonicalRepoRoot, parent)) {
      blocked("RECEIPT_PATH_INVALID", "receipt parent must resolve outside the repository");
    }
    const existing = await lstat(path).catch(() => null);
    const canonical = existing
      ? await realpath(path).catch(() => null)
      : resolve(parent, basename(path));
    if (!canonical || inside(canonicalRepoRoot, canonical)) {
      blocked("RECEIPT_PATH_INVALID", "receipt path must resolve outside the repository");
    }
    canonicalReceiptPaths.push(
      process.platform === "win32" ? canonical.toLowerCase() : canonical,
    );
  }
  if (new Set(canonicalReceiptPaths).size !== 6) {
    blocked("RECEIPT_PATH_INVALID", "finalizer input and output receipt paths must be distinct");
  }
  const outputParent = await lstat(dirname(options.receiptOut)).catch(() => null);
  if (!outputParent?.isDirectory() || outputParent.isSymbolicLink()) {
    blocked("RECEIPT_PATH_INVALID", "finalization receipt parent must be an existing regular directory");
  }
  if (await lstat(options.receiptOut).catch(() => null)) {
    blocked("RECEIPT_PATH_EXISTS", "finalization receipt output must not already exist");
  }

  const lockPath = join(repoRoot, RELEASE_LOCK_RELATIVE_PATH);
  const resumeLockPath = `${lockPath}.resume`;
  const finalizerLockPath = `${lockPath}.finalize`;
  if (await lstat(resumeLockPath).catch(() => null)) {
    blocked("RESUME_STILL_ACTIVE", "post-push resume lock still exists; finalization is forbidden");
  }
  const lockData = await readBoundedJsonFile(lockPath, "release lock")
    .catch((error) => {
      if (error instanceof ProductionWriteFenceFinalizerError) {
        blocked("RELEASE_LOCK_INVALID", "exact retained production release lock is required");
      }
      throw error;
    });
  const releaseLock = validateReleaseLock(
    lockData.receipt,
    options.releaseOutcome,
    manifest,
    options.expectedCommit,
  );

  const outcomeData = await readBoundedReceipt(
    options.releaseOutcome,
    "release outcome",
    repoRoot,
  );
  const outcome = validateOutcomeReceipt({
    ...outcomeData,
    path: options.releaseOutcome,
    manifest,
    expectedCommit: options.expectedCommit,
    remoteRef: options.remoteRef,
    releaseLock,
  });
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : NaN;
  if (!Number.isFinite(nowMs)) blocked("CLOCK_INVALID", "finalizer clock is invalid");
  const deploymentData = await readBoundedReceipt(
    options.deploymentReceipt,
    "deployment receipt",
    repoRoot,
  );
  const deployment = validateDeploymentReceipt({
    ...deploymentData,
    manifest,
    expectedCommit: options.expectedCommit,
    nowMs,
  });
  const postExpandBackupData = await readBoundedReceipt(
    options.postExpandBackupReceipt,
    "post-expand backup receipt",
    repoRoot,
  );
  const postExpandBackup = successorController
    ? await validateSuccessorPostExpandBackupReceipt({
      ...postExpandBackupData,
      backupDirectory: options.postExpandBackupDirectory,
      repoRoot,
      sourceManifest: successorReleaseManifest,
      controllerManifest: manifest,
      contract: postExpandBackupContract,
      expectedCommit: options.expectedCommit,
      remoteRef: options.remoteRef,
      nowMs,
    })
    : await validatePostExpandBackupReceipt({
      ...postExpandBackupData,
      path: options.postExpandBackupReceipt,
      repoRoot,
      manifest,
      contract: postExpandBackupContract,
      expectedCommit: options.expectedCommit,
      nowMs,
    });
  const recoveryProofData = await readBoundedReceipt(
    recoveryProofReceiptPath,
    successorController
      ? "successor no-cost recovery-assurance receipt"
      : "post-expand hosted restore receipt",
    repoRoot,
  );
  const postExpandRecoveryProof = successorController
    ? await validateSuccessorRecoveryAssuranceEvidence({
      repoRoot,
      receiptRoot: dirname(options.postExpandBackupReceipt),
      recoveryReceiptPath: recoveryProofReceiptPath,
      recoveryReceiptSha256: recoveryProofData.sha256,
      sourceManifest: successorReleaseManifest,
      controllerManifest: manifest,
      expectedCommit: options.expectedCommit,
      outcomeReceipt: outcomeData.receipt,
      postExpandBackup,
      postExpandBackupReceiptSha256: postExpandBackupData.sha256,
      storageOriginalBytesBackupReceiptPath:
        options.storageOriginalBytesBackupReceipt,
      now,
    })
    : validatePostExpandHostedRestoreReceipt({
      ...recoveryProofData,
      manifest,
      contract: postExpandBackupContract,
      expectedCommit: options.expectedCommit,
      backup: postExpandBackup,
      nowMs,
    });
  const canaryData = await readBoundedReceipt(
    options.canaryReceipt,
    "canary receipt",
    repoRoot,
  );
  const canary = validateCanaryReceipt({
    ...canaryData,
    manifest,
    expectedCommit: options.expectedCommit,
    outcome,
    deployment,
    postExpandBackup,
    postExpandRecoveryProof,
    nowMs,
  });
  let externalGateProvenance;
  try {
    const expectedExternal = {
      releaseCommit: options.expectedCommit,
      vercelTeamId: finalizationContract.externalEvidence.vercel.teamId,
      vercelProjectId:
        finalizationContract.externalEvidence.vercel.projectId,
      productionHost:
        finalizationContract.externalEvidence.vercel.productionHost,
      expectedTables: postExpandBackupContract.expectedTables,
      expectedMigrationVersions:
        postExpandBackupContract.expectedReleaseMigrationVersions,
      requiredCanaryChecks: finalizationContract.requiredCanaryChecks,
      databaseSystemIdentifier: productionDatabaseSystemIdentifier(
        manifest.projectRef,
        { allowTest: runCommand !== defaultRunCommand },
      ),
    };
    if (successorController) {
      externalGateProvenance = {
        ...await validateExternalDeploymentCanaryProvenanceFiles({
          deploymentReceipt: deploymentData.receipt,
          deploymentReceiptPath: options.deploymentReceipt,
          canaryReceipt: canaryData.receipt,
          canaryReceiptPath: options.canaryReceipt,
          expected: expectedExternal,
        }),
        successorRecoveryAssuranceRawEvidenceSha256:
          postExpandRecoveryProof.rawSha256,
      };
    } else {
      externalGateProvenance = await validateExternalGateProvenanceFiles({
        deploymentReceipt: deploymentData.receipt,
        deploymentReceiptPath: options.deploymentReceipt,
        hostedRestoreReceipt: recoveryProofData.receipt,
        hostedRestoreReceiptPath: recoveryProofReceiptPath,
        canaryReceipt: canaryData.receipt,
        canaryReceiptPath: options.canaryReceipt,
        expected: expectedExternal,
      });
    }
  } catch (error) {
    if (error instanceof ExternalGateProvenanceError) {
      blocked(
        "EXTERNAL_GATE_PROVENANCE_INVALID",
        `external deployment, recovery or canary evidence failed: ${error.code}`,
      );
    }
    throw error;
  }
  const confirmation = [
    "FINALIZE",
    manifest.projectRef,
    manifest.release,
    options.expectedCommit,
    deployment.deploymentId,
    canary.sha256,
  ].join(":");
  if (options.confirmProduction !== confirmation) {
    blocked(
      "PRODUCTION_CONFIRMATION_MISMATCH",
      "confirmation must bind project, release, commit, deployment and exact canary SHA-256",
    );
  }

  await assertReleaseGitFence({
    repoRoot,
    expectedCommit: options.expectedCommit,
    expectedOrigin: manifest.backupContract.expectedOrigin,
    remoteRef: options.remoteRef,
    runCommand,
  });
  let postExpandBackupReverification;
  if (successorController) {
    const reopened = await validateSuccessorPostExpandBackupReceipt({
      ...postExpandBackupData,
      backupDirectory: options.postExpandBackupDirectory,
      repoRoot,
      sourceManifest: successorReleaseManifest,
      controllerManifest: manifest,
      contract: postExpandBackupContract,
      expectedCommit: options.expectedCommit,
      remoteRef: options.remoteRef,
      nowMs,
    });
    if (reopened.artifactReverificationSha256
          !== postExpandBackup.artifactReverificationSha256) {
      blocked(
        "SUCCESSOR_POST_EXPAND_BACKUP_ARTIFACT_INVALID",
        "successor backup artifact evidence changed between validation and finalization",
      );
    }
    postExpandBackupReverification = {
      sha256: reopened.artifactReverificationSha256,
      ageSeconds: Math.max(0, (nowMs - reopened.verifiedAtMs) / 1_000),
    };
  } else {
    postExpandBackupReverification = await reverifyPostExpandBackupReceipt({
      receipt: postExpandBackupData.receipt,
      repoRoot,
      manifest,
      contract: postExpandBackupContract,
      runCommand,
      nowMs,
    });
  }
  const assertLinkedRef = await createLinkedRefFence(repoRoot, manifest.projectRef);
  const supabaseCli = await resolveSupabaseCli(repoRoot, manifest, outcomeData.receipt);
  const renderedSql = renderProductionWriteFenceFinalizerSql(sql, {
    projectRef: manifest.projectRef,
    databaseSystemIdentifier: productionDatabaseSystemIdentifier(
      manifest.projectRef,
      { allowTest: runCommand !== defaultRunCommand },
    ),
    release: manifest.release,
    releaseCommit: options.expectedCommit,
    leaseOwnerId: outcome.leaseOwnerId,
    outcomePathSha256: outcome.outcomePathSha256,
    outcomeReceiptSha256: outcome.sha256,
    deploymentId: deployment.deploymentId,
    deploymentUrlSha256: deployment.deploymentUrlSha256,
    deploymentReceiptSha256: deployment.sha256,
    canaryReceiptSha256: canary.sha256,
    canaryVerifiedAt: canary.verifiedAt,
    canaryExpiresAt: canary.expiresAt,
    postExpandBackupReceiptSha256: postExpandBackup.sha256,
    postExpandBackupReverificationSha256:
      postExpandBackupReverification.sha256,
    ...(successorController
      ? {
        recoveryAssuranceReceiptSha256: postExpandRecoveryProof.sha256,
      }
      : {
        postExpandHostedRestoreReceiptSha256:
          postExpandRecoveryProof.sha256,
      }),
    postExpandBackupSetId: postExpandBackup.backupSetId,
    postExpandBackupManifestSha256: postExpandBackup.manifestSha256,
    postExpandTableContractSha256:
      postExpandBackupContract.expectedTableContractSha256,
    postExpandMigrationContractSha256:
      postExpandBackupContract.expectedReleaseMigrationContractSha256,
    postExpandLiveSchemaContractSha256:
      postExpandBackup.liveSchemaContractSha256,
    postExpandLogicalDataContractSha256:
      postExpandBackup.logicalDataContractSha256,
  }, postExpandBackupContract);

  const finalizerLock = await open(finalizerLockPath, "wx", 0o600).catch(() => null);
  if (!finalizerLock) {
    blocked("FINALIZER_LOCKED", "another or unresolved exact-owner finalizer attempt exists");
  }
  let queryStarted = false;
  let finalizerLockClosed = false;
  if (renderedSql.length > MAX_FINALIZER_SQL_CHARACTERS) {
    blocked(
      "FINALIZER_SQL_TOO_LARGE",
      "rendered finalizer SQL exceeds the bounded direct-argument envelope",
    );
  }
  try {
    await finalizerLock.writeFile(`${JSON.stringify({
      version: 1,
      release: manifest.release,
      projectRef: manifest.projectRef,
      releaseCommit: options.expectedCommit,
      leaseOwnerId: outcome.leaseOwnerId,
      outcomeReceiptSha256: outcome.sha256,
      deploymentReceiptSha256: deployment.sha256,
      postExpandBackupReceiptSha256: postExpandBackup.sha256,
      postExpandBackupReverificationSha256:
        postExpandBackupReverification.sha256,
      ...(successorController
        ? {
          recoveryAssuranceReceiptSha256:
            postExpandRecoveryProof.sha256,
          storageEncryptedBackupArtifactSha256:
            postExpandRecoveryProof.storageEncryptedBackupArtifactSha256,
          storageOriginalBytesBackupReceiptSha256:
            postExpandRecoveryProof.storageOriginalBytesBackupReceiptSha256,
          storageOriginalBytesManifestSha256:
            postExpandRecoveryProof.storageOriginalBytesManifestSha256,
          storageOriginalBytesPrivateRawSha256:
            postExpandRecoveryProof.storageOriginalBytesPrivateRawSha256,
        }
        : {
          postExpandHostedRestoreReceiptSha256:
            postExpandRecoveryProof.sha256,
        }),
      externalGateProvenance,
      canaryReceiptSha256: canary.sha256,
      finalizerReceiptPathSha256: textSha256(resolve(options.receiptOut)),
      startedAt: nowValue.toISOString(),
      adjudicationRequiredIfPresent: true,
    })}\n`, "utf8");
    await finalizerLock.sync();

    const baseReceipt = {
      receiptVersion: 1,
      kind: "production-write-fence-finalization",
      status: "finalization_started_outcome_ambiguous_until_verified",
      release: manifest.release,
      projectRef: manifest.projectRef,
      releaseCommit: options.expectedCommit,
      remoteRef: options.remoteRef,
      leaseOwnerId: outcome.leaseOwnerId,
      outcomePathSha256: outcome.outcomePathSha256,
      outcomeReceiptSha256: outcome.sha256,
      deploymentId: deployment.deploymentId,
      deploymentUrlSha256: deployment.deploymentUrlSha256,
      deploymentReceiptSha256: deployment.sha256,
      postExpandBackupReceiptSha256: postExpandBackup.sha256,
      postExpandBackupReverificationSha256:
        postExpandBackupReverification.sha256,
      postExpandBackupReverifiedAgeSeconds:
        postExpandBackupReverification.ageSeconds,
      ...(successorController
        ? {
          recoveryAssuranceReceiptSha256:
            postExpandRecoveryProof.sha256,
          recoveryAssuranceVerifiedAt:
            postExpandRecoveryProof.verifiedAt,
          storageEncryptedBackupArtifactSha256:
            postExpandRecoveryProof.storageEncryptedBackupArtifactSha256,
          storageOriginalBytesBackupReceiptSha256:
            postExpandRecoveryProof.storageOriginalBytesBackupReceiptSha256,
          storageOriginalBytesManifestSha256:
            postExpandRecoveryProof.storageOriginalBytesManifestSha256,
          storageOriginalBytesPrivateRawSha256:
            postExpandRecoveryProof.storageOriginalBytesPrivateRawSha256,
          successorReleaseAssurance:
            postExpandRecoveryProof.releaseAssurance,
        }
        : {
          postExpandHostedRestoreReceiptSha256:
            postExpandRecoveryProof.sha256,
          postExpandHostedRestoreTargetProjectRef:
            postExpandRecoveryProof.targetProjectRef,
          postExpandHostedRestoreVerifiedAt:
            postExpandRecoveryProof.verifiedAt,
        }),
      postExpandBackupSetId: postExpandBackup.backupSetId,
      postExpandBackupManifestSha256: postExpandBackup.manifestSha256,
      postExpandTableContractSha256:
        postExpandBackupContract.expectedTableContractSha256,
      postExpandMigrationContractSha256:
        postExpandBackupContract.expectedReleaseMigrationContractSha256,
      postExpandLiveSchemaContractSha256:
        postExpandBackup.liveSchemaContractSha256,
      postExpandLogicalDataContractSha256:
        postExpandBackup.logicalDataContractSha256,
      externalGateProvenance,
      canaryReceiptSha256: canary.sha256,
      canaryVerifiedAt: canary.verifiedAt,
      canaryExpiresAt: canary.expiresAt,
      canaryObservationWindowSeconds: canary.observationWindowSeconds,
      finalizerOperationId: operation.id,
      finalizerOperationSha256: operation.sha256,
      startedAt: nowValue.toISOString(),
      completedAt: null,
      databaseEvidence: null,
      rerunProhibitedUntilAdjudicated: true,
      containsSecrets: false,
    };
    await writeJsonAtomic(options.receiptOut, baseReceipt, { exclusive: true });

    await assertLinkedRef();
    queryStarted = true;
    const result = await requireSuccess(
      runCommand,
      supabaseCli,
      [
        "db",
        "query",
        "--linked",
        renderedSql,
        "--output",
        "json",
        "--agent",
        "no",
        "--workdir",
        repoRoot,
      ],
      { cwd: repoRoot },
      "FINALIZER_OUTCOME_AMBIGUOUS",
    );
    await assertLinkedRef();
    let rows;
    try {
      rows = JSON.parse(result.stdout.trim());
    } catch {
      blocked("FINALIZER_OUTCOME_AMBIGUOUS", "finalizer returned non-JSON evidence");
    }
    const expectedDatabaseEvidence = {
      production_write_fence_finalize_count: 1,
      target_project_ref: manifest.projectRef,
      target_database_system_identifier: productionDatabaseSystemIdentifier(
        manifest.projectRef,
        { allowTest: runCommand !== defaultRunCommand },
      ),
      release_id: manifest.release,
      release_commit: options.expectedCommit,
      lease_owner_id: outcome.leaseOwnerId,
      outcome_receipt_sha256: outcome.sha256,
      deployment_id: deployment.deploymentId,
      deployment_url_sha256: deployment.deploymentUrlSha256,
      deployment_receipt_sha256: deployment.sha256,
      post_expand_backup_receipt_sha256: postExpandBackup.sha256,
      post_expand_backup_reverification_sha256:
        postExpandBackupReverification.sha256,
      ...(successorController
        ? {
          recovery_assurance_receipt_sha256:
            postExpandRecoveryProof.sha256,
        }
        : {
          post_expand_hosted_restore_receipt_sha256:
            postExpandRecoveryProof.sha256,
        }),
      post_expand_backup_set_id: postExpandBackup.backupSetId,
      post_expand_backup_manifest_sha256: postExpandBackup.manifestSha256,
      post_expand_table_contract_sha256:
        postExpandBackupContract.expectedTableContractSha256,
      post_expand_migration_contract_sha256:
        postExpandBackupContract.expectedReleaseMigrationContractSha256,
      post_expand_live_schema_contract_sha256:
        postExpandBackup.liveSchemaContractSha256,
      post_expand_logical_data_contract_sha256:
        postExpandBackup.logicalDataContractSha256,
      canary_receipt_sha256: canary.sha256,
      canary_verified_at: canary.verifiedAt,
      canary_expires_at: canary.expiresAt,
      production_storage_writes_allowed_count: 1,
    };
    if (!Array.isArray(rows)
        || rows.length !== 1
        || !exactKeys(rows[0], Object.keys(expectedDatabaseEvidence))
        || Object.entries(expectedDatabaseEvidence).some(
          ([key, value]) => rows[0][key] !== value,
        )) {
      blocked(
        "FINALIZER_OUTCOME_AMBIGUOUS",
        "database finalizer evidence is missing, extra or mismatched",
      );
    }

    const completedAt = now().toISOString();
    await writeJsonAtomic(options.receiptOut, {
      ...baseReceipt,
      status: "database_finalized_local_cleanup_pending",
      completedAt,
      databaseEvidence: rows[0],
      rerunProhibitedUntilAdjudicated: true,
    });

    await finalizerLock.close();
    finalizerLockClosed = true;
    await rm(lockPath);
    await rm(finalizerLockPath);
    if (await lstat(lockPath).catch(() => null)
        || await lstat(finalizerLockPath).catch(() => null)) {
      blocked("LOCAL_LOCK_CLEANUP_FAILED", "database finalized but local locks need adjudicated cleanup");
    }
    const finalReceipt = {
      ...baseReceipt,
      status: "verified_success",
      completedAt,
      databaseEvidence: rows[0],
      rerunProhibitedUntilAdjudicated: false,
    };
    await writeJsonAtomic(options.receiptOut, finalReceipt);
    return finalReceipt;
  } finally {
    if (!finalizerLockClosed) await finalizerLock.close().catch(() => {});
    if (!queryStarted) await rm(finalizerLockPath, { force: true }).catch(() => {});
  }
}

export const productionWriteFenceFinalizerTestHooks = Object.freeze({
  compactFinalizerSql,
  defaultRunCommand,
  loadFinalizationManifest,
  parseArgs,
  requiredCanaryChecks: REQUIRED_CANARY_CHECKS,
  textSha256,
  validateOutcomeReceipt,
  validateReleaseLock,
  validateSuccessorRuntimeEvidenceSummary,
  validateStatusSpecificArguments,
  validateSuccessorPostExpandBackupReceipt,
  validateSuccessorRecoveryAssuranceEvidence,
});
