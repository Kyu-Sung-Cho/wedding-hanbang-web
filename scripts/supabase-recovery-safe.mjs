#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  constants as fsConstants,
} from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const GIT_SHA_RE = /^[0-9a-f]{40}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGE_RECIPIENT_RE = /^age1[0-9a-z]{20,}$/;
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STORAGE_CONCURRENCY = 8;
const RECOVERY_FORMAT_VERSION = 2;
const APPROVED_CRON_ARTIFACT_PATH = "operations/approved-cron-contract.json";
const APPROVED_CRON_CONTRACT_VERSION = "hanbang-approved-maintenance-crons-v1";
const APPROVED_CRON_CONTRACT_SHA256 =
  "5c9b4bbd3ba20e564016b3fb196df81aa254e3ff849523bebf9bf269c1c77ff8";
const CRON_REPLAY_STRATEGY =
  "launcher-off-drained-unschedule-and-replay-inactive-v2";
const APPROVED_CRON_REPLAY_SQL_SHA256 =
  "cc8a78b3130ea2ed6c2b26af3a867c8f4c9a501f32fb1863bbb4ca2a6628c577";
const CRON_ACTIVATION_STRATEGY =
  "evidence-complete-enable-approved-jobs-and-launcher-v1";
const APPROVED_CRON_ACTIVATION_SQL_SHA256 =
  "d421d92aa57c2df43e5ebeafae7eebfc4abb5009a9b66ef6e48c536577027553";
const APPROVED_CRON_TIMEZONE = "GMT";
const APPROVED_CRON_SCHEDULER_ROLE = "postgres";
const RESTORE_EVIDENCE_IDENTITY_CONTRACT =
  "isolated-restore-evidence-identity-v1";
const RESTORE_EVIDENCE_ITEM_CONTRACT = "isolated-restore-evidence-item-v1";
const RESTORE_EVIDENCE_KINDS = new Set([
  "database-restore",
  "storage-restore",
  "cron-inactive-replay",
  "post-deploy-inactive-contract",
  "database-storage-parity",
  "rto-measurement",
]);
const ARCHIVE_AUTHENTICITY_CONTRACT =
  "age-sender-signature-external-immutable-anchor-v1";
const BLOCKED_ARCHIVE_AUTHENTICITY_STATUS =
  "blocked-key-custody-and-immutable-anchor-not-approved";
const BASE_CHILD_ENV_KEYS = Object.freeze([
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PATH",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "USERNAME",
  "USERDOMAIN",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);
const SUPABASE_CHILD_ENV_KEYS = Object.freeze([
  ...BASE_CHILD_ENV_KEYS,
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROFILE",
  "SUPABASE_HOME",
  "SUPABASE_NO_KEYRING",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
]);
const REQUIRED_DATABASE_ARTIFACTS = Object.freeze({
  roles: "db/roles.sql",
  schema: "db/schema.sql",
  "data-auth-public": "db/data-auth-public.sql",
  "data-storage": "db/data-storage.sql",
  "migration-history-schema": "db/migration-history-schema.sql",
  "migration-history-data": "db/migration-history-data.sql",
  "managed-auth-storage-changes": "db/managed-auth-storage-changes.sql",
});

export const APPROVED_CRON_CONTRACT = Object.freeze({
  schemaVersion: 1,
  contract: APPROVED_CRON_CONTRACT_VERSION,
  executionEnvironment: Object.freeze({
    preActivationLauncherState: "off",
    runningJobCount: 0,
    timezone: APPROVED_CRON_TIMEZONE,
    schedulerRole: APPROVED_CRON_SCHEDULER_ROLE,
    databaseBinding: "current_database",
  }),
  jobs: Object.freeze([
    Object.freeze({
      jobName: "delete-expired-amora-request-claims",
      schedule: "29 18 * * *",
      command: "SELECT public.delete_expired_amora_request_claims();",
      active: true,
    }),
    Object.freeze({
      jobName: "delete-expired-rate-limit-buckets",
      schedule: "47 18 * * *",
      command: "SELECT public.delete_expired_rate_limit_buckets();",
      active: true,
    }),
    Object.freeze({
      jobName: "enforce-ai-interaction-retention",
      schedule: "17 18 * * *",
      command: "SELECT public.enforce_ai_interaction_retention();",
      active: true,
    }),
    Object.freeze({
      jobName: "enforce-application-survey-retention",
      schedule: "41 18 * * *",
      command: "SELECT public.enforce_application_survey_retention();",
      active: true,
    }),
    Object.freeze({
      jobName: "reconcile-stale-amora-chat-requests",
      schedule: "*/5 * * * *",
      command: "SELECT public.reconcile_stale_amora_chat_requests(100);",
      active: true,
    }),
  ]),
});

const SECRET_RULES = [
  {
    pattern: /(PGPASSWORD\s*=\s*)[^\r\n]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /((?:postgres|postgresql):\/\/[^\s/:]+:)[^\s/@]+@/gi,
    replacement: "$1[REDACTED]@",
  },
  {
    pattern: /(Authorization\s*:\s*Bearer\s+)[^\s]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /((?:apikey|SUPABASE_(?:SERVICE_ROLE|ANON|ACCESS)_KEY|SUPABASE_DB_PASSWORD)\s*[:=]\s*)[^\s,;]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED_JWT]",
  },
  {
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
];

const FORBIDDEN_SUPABASE_FLAGS = new Set([
  "--dry-run",
  "--debug",
  "--password",
  "--db-url",
  "--log-level",
  "--create-ticket",
  "-p",
]);

export class RecoveryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "RecoveryError";
    this.code = code;
  }
}

function recoveryError(code, message, options) {
  return new RecoveryError(code, message, options);
}

export function buildMinimalChildEnv(source = process.env, allowedKeys = BASE_CHILD_ENV_KEYS) {
  const result = {};
  for (const key of allowedKeys) {
    const value = source?.[key];
    if (typeof value === "string" && value) result[key] = value;
  }
  return result;
}

export function redactSecrets(value) {
  let redacted = String(value ?? "");
  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }
  return redacted;
}

export function containsCredentialMaterial(value) {
  const text = String(value ?? "");
  return SECRET_RULES.some((rule) => {
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(text);
  });
}

class SensitiveScanner {
  constructor(overlap = 4096) {
    this.overlap = overlap;
    this.tail = "";
    this.detected = false;
    this.decoder = new TextDecoder("utf-8", { fatal: false });
  }

  push(chunk) {
    const text = this.decoder.decode(chunk, { stream: true });
    const candidate = this.tail + text;
    if (containsCredentialMaterial(candidate)) this.detected = true;
    this.tail = candidate.slice(-this.overlap);
  }

  finish() {
    const finalText = this.tail + this.decoder.decode();
    if (containsCredentialMaterial(finalText)) this.detected = true;
  }
}

class BoundedCapture {
  constructor(limit) {
    this.limit = limit;
    this.parts = [];
    this.size = 0;
    this.truncated = false;
  }

  push(chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = this.limit - this.size;
    if (remaining > 0) {
      const part = buffer.subarray(0, remaining);
      this.parts.push(part);
      this.size += part.length;
    }
    if (buffer.length > remaining) this.truncated = true;
  }

  toBuffer() {
    return Buffer.concat(this.parts, this.size);
  }
}

function captureTransform(scanner, capture, passThrough) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      scanner.push(chunk);
      capture.push(chunk);
      callback(null, passThrough ? chunk : undefined);
    },
    flush(callback) {
      scanner.finish();
      callback();
    },
  });
}

async function terminateNativeProcessTree(child) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;

  if (process.platform === "win32") {
    const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
    const taskkill = windowsRoot
      ? path.join(windowsRoot, "System32", "taskkill.exe")
      : "";
    if (!taskkill || !path.isAbsolute(taskkill) || !(await fileExists(taskkill))) {
      child.kill("SIGKILL");
      return false;
    }
    const exitCode = await new Promise((resolve) => {
      const killer = spawn(
        taskkill,
        ["/PID", String(pid), "/T", "/F"],
        {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
          env: buildMinimalChildEnv(process.env),
        },
      );
      killer.once("error", () => resolve(null));
      killer.once("close", (code) => resolve(code));
    });
    if (exitCode === 0) return true;
    child.kill("SIGKILL");
    return false;
  }

  try {
    // Unix children are spawned in a dedicated process group below. A negative
    // pid terminates every process in that group before plaintext cleanup.
    process.kill(-pid, "SIGKILL");
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return true;
    child.kill("SIGKILL");
    return false;
  }
}

/**
 * Executes a native process without a shell. Raw output never reaches the
 * terminal. Callers may consume a bounded stdout Buffer only after the stream
 * has passed credential scanning.
 */
export async function runBoundedRedacted({
  executable,
  args = [],
  cwd = REPO_ROOT,
  env = buildMinimalChildEnv(process.env),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_OUTPUT_LIMIT,
  captureStdout = false,
  stdoutFile,
  expectedExitCodes = [0],
}) {
  if (!path.isAbsolute(executable)) {
    throw recoveryError("EXECUTABLE_NOT_ABSOLUTE", "Native executable must be an absolute path.");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw recoveryError("INVALID_NATIVE_ARGS", "Native process arguments must be strings.");
  }
  if (stdoutFile && captureStdout) {
    throw recoveryError("INVALID_OUTPUT_MODE", "stdoutFile and captureStdout are mutually exclusive.");
  }

  const stdoutScanner = new SensitiveScanner();
  const stderrScanner = new SensitiveScanner();
  const stdoutCapture = new BoundedCapture(maxOutputBytes);
  const stderrCapture = new BoundedCapture(maxOutputBytes);
  let timedOut = false;
  let child;

  try {
    child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw recoveryError("CHILD_START_FAILED", "Native process could not be started.", { cause: error });
  }

  const stdoutSink = stdoutFile
    ? createWriteStream(stdoutFile, { flags: "wx", mode: 0o600 })
    : undefined;
  const stdoutPipeline = stdoutSink
    ? pipeline(child.stdout, captureTransform(stdoutScanner, stdoutCapture, true), stdoutSink)
    : pipeline(child.stdout, captureTransform(stdoutScanner, stdoutCapture, false));
  const stderrPipeline = pipeline(
    child.stderr,
    captureTransform(stderrScanner, stderrCapture, false),
  );

  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let timeoutResolve;
  const timeoutPromise = new Promise((resolve) => {
    timeoutResolve = resolve;
  });
  const timer = setTimeout(() => timeoutResolve({ timedOut: true }), timeoutMs);
  timer.unref?.();

  let exit;
  let treeTerminationVerified = true;
  try {
    const outcome = await Promise.race([
      exitPromise.then((value) => ({ exit: value })),
      timeoutPromise,
    ]);
    if (outcome.timedOut) {
      timedOut = true;
      treeTerminationVerified = await terminateNativeProcessTree(child);
      exit = await Promise.race([
        exitPromise,
        new Promise((_, reject) => {
          const graceTimer = setTimeout(
            () => reject(recoveryError(
              "PROCESS_TREE_TERMINATION_FAILED",
              "Timed-out native process tree did not terminate within the safety window.",
            )),
            5_000,
          );
          graceTimer.unref?.();
        }),
      ]);
    } else {
      exit = outcome.exit;
    }
    await Promise.all([stdoutPipeline, stderrPipeline]);
  } catch (error) {
    if (stdoutFile) await rm(stdoutFile, { force: true }).catch(() => {});
    throw recoveryError("CHILD_IO_FAILED", "Native process I/O failed.", { cause: error });
  } finally {
    clearTimeout(timer);
  }

  if (stdoutScanner.detected || stderrScanner.detected) {
    if (stdoutFile) await rm(stdoutFile, { force: true }).catch(() => {});
    throw recoveryError(
      "CREDENTIAL_OUTPUT_DETECTED",
      "Credential-like output was suppressed. Rotate the affected credential before retrying.",
    );
  }
  if (timedOut) {
    if (stdoutFile) await rm(stdoutFile, { force: true }).catch(() => {});
    if (!treeTerminationVerified) {
      throw recoveryError(
        "PROCESS_TREE_TERMINATION_FAILED",
        "Timed-out native process tree could not be verified as terminated.",
      );
    }
    throw recoveryError("CHILD_TIMEOUT", "Native process exceeded its time limit.");
  }
  if (!expectedExitCodes.includes(exit.code)) {
    if (stdoutFile) await rm(stdoutFile, { force: true }).catch(() => {});
    throw recoveryError(
      "CHILD_EXIT_NONZERO",
      `Native process failed with exit code ${exit.code ?? "unknown"}. Child output was suppressed.`,
    );
  }
  if (captureStdout && stdoutCapture.truncated) {
    throw recoveryError("CHILD_OUTPUT_LIMIT", "Native stdout exceeded the configured safe limit.");
  }

  return {
    exitCode: exit.code,
    signal: exit.signal,
    stdoutBuffer: captureStdout ? stdoutCapture.toBuffer() : undefined,
    stdoutTruncated: stdoutCapture.truncated,
    stderrTruncated: stderrCapture.truncated,
  };
}

export function assertSafeSupabaseArgs(args) {
  for (const argument of args) {
    if (!argument.startsWith("-")) continue;
    const lower = argument.toLowerCase();
    const flag = /^-p.+/.test(lower) && !lower.startsWith("--")
      ? "-p"
      : lower.split("=", 1)[0];
    if (FORBIDDEN_SUPABASE_FLAGS.has(flag)) {
      throw recoveryError(
        "FORBIDDEN_SUPABASE_FLAG",
        `Recovery tooling forbids the Supabase flag ${flag}.`,
      );
    }
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function removeRecoveryPathVerified(
  targetPath,
  {
    recursive = false,
    removeImpl = rm,
    lstatImpl = lstat,
  } = {},
) {
  if (!targetPath) return;
  try {
    await removeImpl(targetPath, { recursive, force: true });
  } catch (error) {
    throw recoveryError(
      "RECOVERY_CLEANUP_FAILED",
      "Recovery cleanup failed; plaintext residue may remain.",
      { cause: error },
    );
  }
  try {
    await lstatImpl(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw recoveryError(
      "RECOVERY_CLEANUP_VERIFY_FAILED",
      "Recovery cleanup could not verify that the target was removed.",
      { cause: error },
    );
  }
  throw recoveryError(
    "RECOVERY_CLEANUP_RESIDUE",
    "Recovery cleanup reported success but the target still exists.",
  );
}

async function removeRecoveryPathsVerified(entries) {
  const results = await Promise.allSettled(
    entries.map(({ targetPath, recursive = false }) =>
      removeRecoveryPathVerified(targetPath, { recursive })),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

function isPathWithin(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathSegments(candidatePath) {
  return path.resolve(candidatePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

export function assertSafeStagingRoot(
  candidatePath,
  { repoRoot = REPO_ROOT, home = homedir(), osTemp = tmpdir() } = {},
) {
  if (!candidatePath || !path.isAbsolute(candidatePath)) {
    throw recoveryError("STAGING_NOT_ABSOLUTE", "Plaintext staging must use an absolute path.");
  }
  const resolved = path.resolve(candidatePath);
  if (isPathWithin(repoRoot, resolved)) {
    throw recoveryError("STAGING_IN_REPOSITORY", "Plaintext staging is forbidden inside the repository.");
  }
  if (isPathWithin(osTemp, resolved)) {
    throw recoveryError("STAGING_IN_TEMP", "Plaintext staging is forbidden under the operating-system temp directory.");
  }
  const homeDesktop = path.join(home, "Desktop");
  if (isPathWithin(homeDesktop, resolved)) {
    throw recoveryError("STAGING_ON_DESKTOP", "Plaintext staging is forbidden on Desktop.");
  }
  const segments = pathSegments(resolved);
  if (segments.some((segment) => segment === "temp" || segment === "tmp")) {
    throw recoveryError("STAGING_IN_TEMP", "Plaintext staging may not contain a temp directory segment.");
  }
  if (segments.some((segment) => segment.startsWith("onedrive"))) {
    throw recoveryError("STAGING_IN_ONEDRIVE", "Plaintext staging is forbidden in OneDrive.");
  }
  return resolved;
}

function assertSafeFinalOutputRoot(candidatePath, repoRoot = REPO_ROOT) {
  if (!candidatePath || !path.isAbsolute(candidatePath)) {
    throw recoveryError("OUTPUT_NOT_ABSOLUTE", "Encrypted output must use an absolute path.");
  }
  const resolved = path.resolve(candidatePath);
  if (isPathWithin(repoRoot, resolved)) {
    throw recoveryError("OUTPUT_IN_REPOSITORY", "Recovery artifacts are forbidden inside the repository.");
  }
  return resolved;
}

async function lockDownDirectory(directoryPath) {
  await chmod(directoryPath, 0o700).catch(() => {});
  if (process.platform !== "win32") return;
  const username = process.env.USERNAME;
  if (!username) throw recoveryError("WINDOWS_IDENTITY_MISSING", "Windows user identity is unavailable.");
  const icacls = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe");
  await runBoundedRedacted({
    executable: icacls,
    args: [
      directoryPath,
      "/inheritance:r",
      "/grant:r",
      `${username}:(OI)(CI)F`,
      "SYSTEM:(OI)(CI)F",
    ],
    timeoutMs: 30_000,
  });
}

async function createSecureWorkspace(stagingRoot) {
  const safeRoot = assertSafeStagingRoot(stagingRoot);
  const rootInfo = await stat(safeRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    throw recoveryError("STAGING_ROOT_MISSING", "The approved encrypted staging root must already exist.");
  }
  const resolvedRoot = await realpath(safeRoot);
  assertSafeStagingRoot(resolvedRoot);
  const workspace = path.join(resolvedRoot, `hanbang-recovery-${randomUUID()}`);
  await mkdir(workspace, { mode: 0o700 });
  try {
    await lockDownDirectory(workspace);
  } catch (error) {
    await removeRecoveryPathVerified(workspace, { recursive: true });
    throw error;
  }
  return workspace;
}

async function assertSensitiveFilePath(filePath) {
  assertSafeStagingRoot(path.dirname(path.resolve(filePath)));
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw recoveryError("SENSITIVE_FILE_INVALID", "Sensitive identity file must be a regular file.");
  }
}

export async function resolvePinnedSupabaseBinary(repoRoot = REPO_ROOT) {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const version = packageJson.devDependencies?.supabase ?? packageJson.dependencies?.supabase;
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw recoveryError("SUPABASE_VERSION_NOT_PINNED", "package.json must pin an exact Supabase CLI version.");
  }
  const nodeModulesRoot = await realpath(path.join(repoRoot, "node_modules")).catch(() => null);
  if (!nodeModulesRoot) {
    throw recoveryError("PINNED_SUPABASE_PACKAGE_MISSING", "Install repository dependencies first.");
  }
  const installedPackageJson = path.join(repoRoot, "node_modules", "supabase", "package.json");
  const installedPackageJsonReal = await realpath(installedPackageJson).catch(() => null);
  if (!installedPackageJsonReal || !isPathWithin(nodeModulesRoot, installedPackageJsonReal)) {
    throw recoveryError(
      "UNTRUSTED_SUPABASE_PACKAGE",
      "Installed Supabase package did not resolve inside repository node_modules.",
    );
  }
  const installedPackage = JSON.parse(await readFile(installedPackageJsonReal, "utf8"));
  if (installedPackage.name !== "supabase" || installedPackage.version !== version) {
    throw recoveryError(
      "SUPABASE_PACKAGE_VERSION_MISMATCH",
      "Installed Supabase package does not match package.json.",
    );
  }
  const binEntry = typeof installedPackage.bin === "string"
    ? installedPackage.bin
    : installedPackage.bin?.supabase;
  if (
    typeof binEntry !== "string"
    || !binEntry
    || path.isAbsolute(binEntry)
    || binEntry.split(/[\\/]+/).includes("..")
  ) {
    throw recoveryError("SUPABASE_PACKAGE_BIN_INVALID", "Installed Supabase package has an unsafe CLI entry.");
  }
  const installedPackageRoot = await realpath(path.dirname(installedPackageJson));
  const entrypoint = await realpath(path.resolve(path.dirname(installedPackageJson), binEntry)).catch(() => null);
  if (
    !entrypoint
    || !isPathWithin(nodeModulesRoot, entrypoint)
    || !isPathWithin(installedPackageRoot, entrypoint)
    || !(await stat(entrypoint)).isFile()
  ) {
    throw recoveryError(
      "UNTRUSTED_SUPABASE_ENTRYPOINT",
      "Installed Supabase CLI entry did not resolve inside its pinned package.",
    );
  }
  const nodeExecutable = await realpath(process.execPath);
  return {
    executable: nodeExecutable,
    prefixArgs: Object.freeze([entrypoint]),
    entrypoint,
    version,
    pinned: true,
  };
}

async function runSupabase(binary, args, options = {}) {
  if (
    !binary?.pinned
    || !/^\d+\.\d+\.\d+$/.test(binary.version ?? "")
    || !Array.isArray(binary.prefixArgs)
    || binary.prefixArgs.length !== 1
    || !path.isAbsolute(binary.prefixArgs[0])
  ) {
    throw recoveryError("UNPINNED_SUPABASE_CLI", "Only the repository-pinned Supabase CLI may run.");
  }
  assertSafeSupabaseArgs(args);
  const childEnv = buildMinimalChildEnv(
    options.env ?? process.env,
    SUPABASE_CHILD_ENV_KEYS,
  );
  childEnv.SUPABASE_TELEMETRY_DISABLED = "1";
  delete childEnv.SUPABASE_CLI_BINARY_OVERRIDE;
  delete childEnv.SUPABASE_GO_BINARY;
  delete childEnv.NODE_OPTIONS;
  delete childEnv.NODE_PATH;
  try {
    return await runBoundedRedacted({
      executable: binary.executable,
      args: [...binary.prefixArgs, ...args],
      cwd: options.cwd ?? REPO_ROOT,
      env: childEnv,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      captureStdout: options.captureStdout,
      stdoutFile: options.stdoutFile,
    });
  } catch (error) {
    if (error instanceof RecoveryError && error.code === "CREDENTIAL_OUTPUT_DETECTED") {
      throw error;
    }
    throw recoveryError(
      "SUPABASE_COMMAND_FAILED",
      "Repository-pinned Supabase CLI command failed. Child output was suppressed.",
      { cause: error },
    );
  }
}

async function resolveExecutableFromPath(name) {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? `${name}${extension}` : name);
      if (await fileExists(candidate)) return realpath(candidate);
    }
  }
  throw recoveryError("REQUIRED_EXECUTABLE_MISSING", `Required executable ${name} is not installed.`);
}

async function assertPinnedSupabaseVersion(binary) {
  const result = await runSupabase(binary, ["--version"], {
    captureStdout: true,
    maxOutputBytes: 4096,
    timeoutMs: 30_000,
  });
  const reported = result.stdoutBuffer.toString("utf8").trim().match(/\d+\.\d+\.\d+/)?.[0];
  if (reported !== binary.version) {
    throw recoveryError(
      "SUPABASE_BINARY_VERSION_MISMATCH",
      "Installed Supabase binary does not match the version pinned in package.json.",
    );
  }
}

export async function verifyPinnedSupabaseInstallation(repoRoot = REPO_ROOT) {
  const binary = await resolvePinnedSupabaseBinary(repoRoot);
  await assertPinnedSupabaseVersion(binary);
  return {
    version: binary.version,
    executable: binary.executable,
    entrypoint: binary.entrypoint,
  };
}

async function resolveRecoveryTool(name, { isProduction = false, policy } = {}) {
  if (!isProduction) return resolveExecutableFromPath(name);
  const configured = policy?.recoveryTools?.[name];
  if (
    !configured
    || typeof configured.path !== "string"
    || !path.isAbsolute(configured.path)
    || !SHA256_RE.test(configured.sha256 ?? "")
  ) {
    throw recoveryError(
      "PRODUCTION_RECOVERY_TOOL_POLICY_MISSING",
      `Production recovery requires an absolute path and SHA-256 policy for ${name}.`,
    );
  }
  const executable = await realpath(configured.path).catch(() => null);
  const info = executable ? await stat(executable).catch(() => null) : null;
  if (!executable || !info?.isFile()) {
    throw recoveryError(
      "PRODUCTION_RECOVERY_TOOL_MISSING",
      `The policy-pinned production recovery tool ${name} is unavailable.`,
    );
  }
  const digest = await sha256File(executable);
  if (digest.sha256.toLowerCase() !== configured.sha256.toLowerCase()) {
    throw recoveryError(
      "PRODUCTION_RECOVERY_TOOL_HASH_MISMATCH",
      `The policy-pinned production recovery tool ${name} failed SHA-256 verification.`,
    );
  }
  return executable;
}

export async function resolveRecoveryTools(options = {}) {
  const ageExecutable = await resolveRecoveryTool("age", options);
  const tarExecutable = await resolveRecoveryTool("tar", options);
  await runBoundedRedacted({
    executable: ageExecutable,
    args: ["--version"],
    captureStdout: true,
    maxOutputBytes: 4096,
    timeoutMs: 30_000,
  });
  await runBoundedRedacted({
    executable: tarExecutable,
    args: ["--version"],
    captureStdout: true,
    maxOutputBytes: 4096,
    timeoutMs: 30_000,
  });
  return { ageExecutable, tarExecutable };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function canonicalizePgDumpForComparison(sqlText) {
  if (typeof sqlText !== "string" || sqlText.includes("\uFFFD")) {
    throw recoveryError(
      "DATABASE_DUMP_COMPARISON_INVALID",
      "Database dump is not valid UTF-8 text for stability comparison.",
    );
  }

  const directiveLines = [...sqlText.matchAll(
    /^\\(?:restrict|unrestrict)\b[^\r\n]*(?:\r?$)/gm,
  )];
  if (directiveLines.length === 0) return sqlText;
  if (directiveLines.length !== 2) {
    throw recoveryError(
      "DATABASE_DUMP_RESTRICT_MARKER_INVALID",
      "Database dump contains an invalid number of restrict markers.",
    );
  }

  const parsed = directiveLines.map((match) => {
    const line = match[0];
    const exact = line.match(/^\\(restrict|unrestrict)[ \t]+([^\s]+)[ \t]*(\r?)$/);
    if (!exact || !Number.isSafeInteger(match.index)) {
      throw recoveryError(
        "DATABASE_DUMP_RESTRICT_MARKER_INVALID",
        "Database dump contains a malformed restrict marker.",
      );
    }
    return {
      command: exact[1],
      key: exact[2],
      carriageReturn: exact[3],
      index: match.index,
      length: line.length,
    };
  });

  if (
    parsed[0].command !== "restrict"
    || parsed[1].command !== "unrestrict"
    || parsed[0].key !== parsed[1].key
    || parsed[0].index >= parsed[1].index
  ) {
    throw recoveryError(
      "DATABASE_DUMP_RESTRICT_MARKER_INVALID",
      "Database dump restrict markers are not a matching ordered pair.",
    );
  }

  const normalizedKey = "[canonical-pg-dump-restrict-key]";
  let normalized = sqlText;
  for (const marker of [...parsed].reverse()) {
    const replacement = `\\${marker.command} ${normalizedKey}${marker.carriageReturn}`;
    normalized = normalized.slice(0, marker.index)
      + replacement
      + normalized.slice(marker.index + marker.length);
  }
  return normalized;
}

async function databaseArtifactComparisonSha256(filePath) {
  const sqlText = await readFile(filePath, "utf8");
  return sha256Text(canonicalizePgDumpForComparison(sqlText));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function restoreEvidenceIdentityPayload(value) {
  return {
    contract: value?.contract,
    restoreAttemptId: value?.restoreAttemptId,
    artifactId: value?.artifactId,
    archiveSha256: value?.archiveSha256,
    sourceProjectRef: value?.sourceProjectRef,
    targetProjectRef: value?.targetProjectRef,
    targetDatabase: value?.targetDatabase,
    sourceGitSha: value?.sourceGitSha,
    sourceCompletedAt: value?.sourceCompletedAt,
    restoreStartedAt: value?.restoreStartedAt,
    databaseSnapshotSha256: value?.databaseSnapshotSha256,
    storageMetadataSha256: value?.storageMetadataSha256,
    storageObjectCount: value?.storageObjectCount,
    storageTotalBytes: value?.storageTotalBytes,
  };
}

function assertRestoreEvidenceIdentity(value) {
  const payload = restoreEvidenceIdentityPayload(value);
  const sourceCompletedAt = exactIsoTimestamp(payload.sourceCompletedAt);
  const restoreStartedAt = exactIsoTimestamp(payload.restoreStartedAt);
  const expectedIdentitySha256 = sha256Text(canonicalJson(payload));
  const expected = { ...payload, identitySha256: expectedIdentitySha256 };
  if (
    payload.contract !== RESTORE_EVIDENCE_IDENTITY_CONTRACT
    || !UUID_RE.test(payload.restoreAttemptId ?? "")
    || !UUID_RE.test(payload.artifactId ?? "")
    || !SHA256_RE.test(payload.archiveSha256 ?? "")
    || !PROJECT_REF_RE.test(payload.sourceProjectRef ?? "")
    || !PROJECT_REF_RE.test(payload.targetProjectRef ?? "")
    || payload.sourceProjectRef === payload.targetProjectRef
    || !/^[a-z_][a-z0-9_$]{0,62}$/.test(payload.targetDatabase ?? "")
    || !GIT_SHA_RE.test(payload.sourceGitSha ?? "")
    || sourceCompletedAt === null
    || restoreStartedAt === null
    || restoreStartedAt < sourceCompletedAt
    || !SHA256_RE.test(payload.databaseSnapshotSha256 ?? "")
    || !SHA256_RE.test(payload.storageMetadataSha256 ?? "")
    || !Number.isSafeInteger(payload.storageObjectCount)
    || payload.storageObjectCount < 0
    || !Number.isSafeInteger(payload.storageTotalBytes)
    || payload.storageTotalBytes < 0
    || canonicalJson(value) !== canonicalJson(expected)
  ) {
    throw recoveryError(
      "RESTORE_EVIDENCE_IDENTITY_INVALID",
      "Restore evidence identity is incomplete, non-canonical, or internally inconsistent.",
    );
  }
  return expected;
}

export function createRestoreEvidenceIdentity({
  archiveEvidence,
  restoreAttemptId,
  sourceProjectRef,
  targetProjectRef,
  targetDatabase,
  restoreStartedAt,
}) {
  if (
    archiveEvidence?.sourceProjectRef !== sourceProjectRef
    || !UUID_RE.test(archiveEvidence?.artifactId ?? "")
    || !SHA256_RE.test(archiveEvidence?.archiveSha256 ?? "")
    || !GIT_SHA_RE.test(archiveEvidence?.sourceGitSha ?? "")
    || exactIsoTimestamp(archiveEvidence?.sourceCompletedAt) === null
    || !SHA256_RE.test(archiveEvidence?.databaseSnapshotSha256 ?? "")
    || !SHA256_RE.test(archiveEvidence?.storageMetadataSha256 ?? "")
    || !Number.isSafeInteger(archiveEvidence?.storageObjectCount)
    || archiveEvidence.storageObjectCount < 0
    || !Number.isSafeInteger(archiveEvidence?.storageTotalBytes)
    || archiveEvidence.storageTotalBytes < 0
  ) {
    throw recoveryError(
      "RESTORE_ARCHIVE_IDENTITY_INVALID",
      "Verified archive evidence cannot seed an exact restore evidence identity.",
    );
  }
  const payload = {
    contract: RESTORE_EVIDENCE_IDENTITY_CONTRACT,
    restoreAttemptId,
    artifactId: archiveEvidence.artifactId,
    archiveSha256: archiveEvidence.archiveSha256.toLowerCase(),
    sourceProjectRef,
    targetProjectRef,
    targetDatabase,
    sourceGitSha: archiveEvidence.sourceGitSha.toLowerCase(),
    sourceCompletedAt: archiveEvidence.sourceCompletedAt,
    restoreStartedAt,
    databaseSnapshotSha256: archiveEvidence.databaseSnapshotSha256.toLowerCase(),
    storageMetadataSha256: archiveEvidence.storageMetadataSha256.toLowerCase(),
    storageObjectCount: archiveEvidence.storageObjectCount,
    storageTotalBytes: archiveEvidence.storageTotalBytes,
  };
  return assertRestoreEvidenceIdentity({
    ...payload,
    identitySha256: sha256Text(canonicalJson(payload)),
  });
}

export function bindRestoreEvidence({
  identity,
  kind,
  previousEvidenceSha256,
  payload,
}) {
  const exactIdentity = assertRestoreEvidenceIdentity(identity);
  if (
    !RESTORE_EVIDENCE_KINDS.has(kind)
    || !SHA256_RE.test(previousEvidenceSha256 ?? "")
    || !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
  ) {
    throw recoveryError(
      "RESTORE_EVIDENCE_ITEM_INVALID",
      "Restore evidence item has an invalid kind, predecessor, or payload.",
    );
  }
  const body = {
    contract: RESTORE_EVIDENCE_ITEM_CONTRACT,
    kind,
    identitySha256: exactIdentity.identitySha256,
    previousEvidenceSha256: previousEvidenceSha256.toLowerCase(),
    payload: canonicalize(payload),
  };
  return {
    ...body,
    evidenceSha256: sha256Text(canonicalJson(body)),
  };
}

function assertBoundRestoreEvidence({
  evidence,
  identity,
  kind,
  previousEvidenceSha256,
}) {
  const exactIdentity = assertRestoreEvidenceIdentity(identity);
  if (evidence?.identitySha256 !== exactIdentity.identitySha256) {
    throw recoveryError(
      "RESTORE_EVIDENCE_IDENTITY_MISMATCH",
      "Restore evidence belongs to another archive, source, target, or attempt.",
    );
  }
  if (evidence?.previousEvidenceSha256 !== previousEvidenceSha256) {
    throw recoveryError(
      "RESTORE_EVIDENCE_CHAIN_MISMATCH",
      "Restore evidence does not extend the exact preceding evidence item.",
    );
  }
  const rebound = bindRestoreEvidence({
    identity: exactIdentity,
    kind,
    previousEvidenceSha256,
    payload: evidence?.payload,
  });
  if (canonicalJson(evidence) !== canonicalJson(rebound)) {
    throw recoveryError(
      "RESTORE_EVIDENCE_DIGEST_MISMATCH",
      "Restore evidence payload or digest is not canonical and intact.",
    );
  }
  return rebound;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function exactCronRowsMismatchSql(contract, expectedActive) {
  const expectedValues = contract.jobs.map((job) =>
    `      (${sqlLiteral(job.jobName)}, ${sqlLiteral(job.schedule)}, ${sqlLiteral(job.command)})`)
    .join(",\n");
  return [
    "EXISTS (",
    "    SELECT 1",
    "    FROM (VALUES",
    expectedValues,
    "    ) expected(job_name, expected_schedule, expected_command)",
    "    LEFT JOIN cron.job job_row ON job_row.jobname = expected.job_name",
    "    GROUP BY expected.job_name, expected.expected_schedule, expected.expected_command",
    "    HAVING count(job_row.jobid) <> 1",
    "       OR NOT bool_and(",
    "         job_row.schedule = expected.expected_schedule",
    "         AND job_row.command = expected.expected_command",
    `         AND job_row.active IS ${expectedActive ? "TRUE" : "FALSE"}`,
    "         AND job_row.database = pg_catalog.current_database()",
    `         AND job_row.username = ${sqlLiteral(APPROVED_CRON_SCHEDULER_ROLE)}`,
    "       )",
    "  )",
  ].join("\n");
}

export function assertApprovedCronContract(value) {
  const expected = canonicalJson(APPROVED_CRON_CONTRACT);
  if (canonicalJson(value) !== expected) {
    throw recoveryError(
      "APPROVED_CRON_CONTRACT_MISMATCH",
      "Source cron jobs do not match the exact portable definition and execution-environment contract.",
    );
  }
  return JSON.parse(expected);
}

export function buildApprovedCronReplaySql(value = APPROVED_CRON_CONTRACT) {
  const contract = assertApprovedCronContract(value);
  const inactiveRowsMismatch = exactCronRowsMismatchSql(contract, false);
  const lines = [
    "BEGIN;",
    "DO $recovery_cron_replay$",
    "DECLARE",
    "  v_job_id bigint;",
    "BEGIN",
    "  IF pg_catalog.to_regclass('cron.job') IS NULL THEN",
    "    RAISE EXCEPTION 'RECOVERY_CRON_CATALOG_MISSING' USING ERRCODE = '55000';",
    "  END IF;",
    "  IF pg_catalog.to_regclass('cron.job_run_details') IS NULL THEN",
    "    RAISE EXCEPTION 'RECOVERY_CRON_RUN_CATALOG_MISSING' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF coalesce(pg_catalog.current_setting('cron.launch_active_jobs', true), '') <> ${sqlLiteral("off")} THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_LAUNCHER_NOT_FENCED' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF coalesce(pg_catalog.current_setting('cron.timezone', true), '') <> ${sqlLiteral(APPROVED_CRON_TIMEZONE)} THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_TIMEZONE_MISMATCH' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF current_user <> ${sqlLiteral(APPROVED_CRON_SCHEDULER_ROLE)} THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_SCHEDULER_ROLE_MISMATCH' USING ERRCODE = '42501';",
    "  END IF;",
    "  IF EXISTS (SELECT 1 FROM cron.job_run_details WHERE status = 'running') THEN",
    "    RAISE EXCEPTION 'RECOVERY_CRON_JOBS_NOT_DRAINED' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname NOT IN (${contract.jobs.map((job) => sqlLiteral(job.jobName)).join(", ")})) THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_TARGET_HAS_UNAPPROVED_JOBS' USING ERRCODE = '55000';",
    "  END IF;",
    "  LOCK TABLE cron.job IN SHARE ROW EXCLUSIVE MODE;",
  ];
  for (const job of contract.jobs) {
    lines.push(
      "",
      "  FOR v_job_id IN",
      `    SELECT jobid FROM cron.job WHERE jobname = ${sqlLiteral(job.jobName)}`,
      "  LOOP",
      "    PERFORM cron.unschedule(v_job_id);",
      "  END LOOP;",
      "  PERFORM cron.schedule_in_database(",
      `    ${sqlLiteral(job.jobName)},`,
      `    ${sqlLiteral(job.schedule)},`,
      `    ${sqlLiteral(job.command)},`,
      "    pg_catalog.current_database(),",
      `    ${sqlLiteral(APPROVED_CRON_SCHEDULER_ROLE)},`,
      "    false",
      "  );",
    );
  }
  lines.push(
    "",
    `  IF (SELECT count(*) FROM cron.job) <> ${contract.jobs.length}`,
    `     OR ${inactiveRowsMismatch} THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_INACTIVE_REPLAY_MISMATCH' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF coalesce(pg_catalog.current_setting('cron.launch_active_jobs', true), '') <> ${sqlLiteral("off")}`,
    "     OR EXISTS (SELECT 1 FROM cron.job_run_details WHERE status = 'running') THEN",
    "    RAISE EXCEPTION 'RECOVERY_CRON_FENCE_DRIFT' USING ERRCODE = '55000';",
    "  END IF;",
    "END;",
    "$recovery_cron_replay$;",
    "COMMIT;",
    "",
  );
  return lines.join("\n");
}

export function buildApprovedCronActivationSql(value = APPROVED_CRON_CONTRACT) {
  const contract = assertApprovedCronContract(value);
  const inactiveRowsMismatch = exactCronRowsMismatchSql(contract, false);
  const activeRowsMismatch = exactCronRowsMismatchSql(contract, true);
  const lines = [
    "BEGIN;",
    "DO $recovery_cron_activation$",
    "DECLARE",
    "  v_job_id bigint;",
    "BEGIN",
    "  IF pg_catalog.to_regclass('cron.job') IS NULL",
    "     OR pg_catalog.to_regclass('cron.job_run_details') IS NULL THEN",
    "    RAISE EXCEPTION 'RECOVERY_CRON_CATALOG_MISSING' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF coalesce(pg_catalog.current_setting('cron.launch_active_jobs', true), '') <> ${sqlLiteral("off")}`,
    `     OR coalesce(pg_catalog.current_setting('cron.timezone', true), '') <> ${sqlLiteral(APPROVED_CRON_TIMEZONE)}`,
    `     OR current_user <> ${sqlLiteral(APPROVED_CRON_SCHEDULER_ROLE)}`,
    "     OR EXISTS (SELECT 1 FROM cron.job_run_details WHERE status = 'running') THEN",
    "    RAISE EXCEPTION 'RECOVERY_CRON_ACTIVATION_FENCE_INVALID' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF (SELECT count(*) FROM cron.job) <> ${contract.jobs.length}`,
    `     OR ${inactiveRowsMismatch} THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_PREACTIVATION_CONTRACT_MISMATCH' USING ERRCODE = '55000';",
    "  END IF;",
    "  LOCK TABLE cron.job IN SHARE ROW EXCLUSIVE MODE;",
  ];
  for (const job of contract.jobs) {
    lines.push(
      "",
      `  SELECT jobid INTO STRICT v_job_id FROM cron.job WHERE jobname = ${sqlLiteral(job.jobName)};`,
      "  PERFORM cron.alter_job(v_job_id, active := true);",
    );
  }
  lines.push(
    "",
    `  IF (SELECT count(*) FROM cron.job) <> ${contract.jobs.length}`,
    `     OR ${activeRowsMismatch} THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_ACTIVATION_ROW_MISMATCH' USING ERRCODE = '55000';",
    "  END IF;",
    `  IF coalesce(pg_catalog.current_setting('cron.launch_active_jobs', true), '') <> ${sqlLiteral("off")}`,
    `     OR coalesce(pg_catalog.current_setting('cron.timezone', true), '') <> ${sqlLiteral(APPROVED_CRON_TIMEZONE)}`,
    "     OR EXISTS (SELECT 1 FROM cron.job_run_details WHERE status = 'running') THEN",
    "    RAISE EXCEPTION 'RECOVERY_CRON_ACTIVATION_FENCE_DRIFT' USING ERRCODE = '55000';",
    "  END IF;",
    "END;",
    "$recovery_cron_activation$;",
    "COMMIT;",
    "ALTER SYSTEM SET cron.launch_active_jobs TO on;",
    "SELECT pg_catalog.pg_reload_conf();",
    "DO $recovery_cron_activation_verify$",
    "BEGIN",
    `  IF coalesce(pg_catalog.current_setting('cron.launch_active_jobs', true), '') <> ${sqlLiteral("on")} THEN`,
    "    RAISE EXCEPTION 'RECOVERY_CRON_LAUNCHER_ACTIVATION_FAILED' USING ERRCODE = '55000';",
    "  END IF;",
    "END;",
    "$recovery_cron_activation_verify$;",
    "",
  );
  return lines.join("\n");
}

function approvedCronContractSha256() {
  const actual = sha256Text(canonicalJson(APPROVED_CRON_CONTRACT));
  if (actual !== APPROVED_CRON_CONTRACT_SHA256) {
    throw recoveryError(
      "APPROVED_CRON_IMPLEMENTATION_DRIFT",
      "Approved cron data changed without a recovery contract version update.",
    );
  }
  return APPROVED_CRON_CONTRACT_SHA256;
}

function approvedCronReplaySqlSha256() {
  const actual = sha256Text(buildApprovedCronReplaySql());
  if (actual !== APPROVED_CRON_REPLAY_SQL_SHA256) {
    throw recoveryError(
      "APPROVED_CRON_IMPLEMENTATION_DRIFT",
      "Approved cron replay SQL changed without a recovery contract version update.",
    );
  }
  return APPROVED_CRON_REPLAY_SQL_SHA256;
}

function approvedCronActivationSqlSha256() {
  const actual = sha256Text(buildApprovedCronActivationSql());
  if (actual !== APPROVED_CRON_ACTIVATION_SQL_SHA256) {
    throw recoveryError(
      "APPROVED_CRON_IMPLEMENTATION_DRIFT",
      "Approved cron activation SQL changed without a recovery contract version update.",
    );
  }
  return APPROVED_CRON_ACTIVATION_SQL_SHA256;
}

export function approvedCronRecoveryContractMetadata() {
  return {
    contractVersion: APPROVED_CRON_CONTRACT_VERSION,
    contractSha256: approvedCronContractSha256(),
    jobCount: APPROVED_CRON_CONTRACT.jobs.length,
    replayStrategy: CRON_REPLAY_STRATEGY,
    replaySqlSha256: approvedCronReplaySqlSha256(),
    preActivationLauncherState: "off",
    postActivationLauncherState: "on",
    preActivationRunningJobCount: 0,
    replayedJobsActive: false,
    targetDatabaseBinding: "current_database",
    schedulerRole: APPROVED_CRON_SCHEDULER_ROLE,
    timezone: APPROVED_CRON_TIMEZONE,
    replayRequired: true,
    postDeployRecheckRequired: true,
    activationStrategy: CRON_ACTIVATION_STRATEGY,
    activationSqlSha256: approvedCronActivationSqlSha256(),
    activationRequired: true,
    activationAfterParityRequired: true,
    postActivationRecheckRequired: true,
  };
}

function archiveAuthenticityDescriptor(policy) {
  const configured = policy?.archiveAuthenticity;
  if (
    configured?.contract !== ARCHIVE_AUTHENTICITY_CONTRACT
    || configured?.status !== BLOCKED_ARCHIVE_AUTHENTICITY_STATUS
    || configured?.senderSigningKeyRef !== null
    || configured?.externalImmutableAnchorRef !== null
  ) {
    throw recoveryError(
      "ARCHIVE_AUTHENTICITY_POLICY_INVALID",
      "Recovery policy must remain explicitly blocked until sender-key custody and an external immutable anchor are approved.",
    );
  }
  return {
    contract: ARCHIVE_AUTHENTICITY_CONTRACT,
    status: BLOCKED_ARCHIVE_AUTHENTICITY_STATUS,
    senderSignatureVerified: false,
    externalImmutableAnchorVerified: false,
  };
}

async function loadReleaseTargets(repoRoot = REPO_ROOT) {
  const text = await readFile(path.join(repoRoot, "scripts", "release-targets.json"), "utf8");
  return JSON.parse(text);
}

function protectedRefs(targets) {
  return Array.isArray(targets.productionSupabaseProjectRefs)
    ? targets.productionSupabaseProjectRefs.map(String)
    : [];
}

export function assertProductionExportAllowed({
  expectedProjectRef,
  targets,
  trafficDrained = false,
  maintenanceStartedAt,
  writeFenceEvidenceSha256,
  now = new Date(),
}) {
  const isProduction = protectedRefs(targets).includes(expectedProjectRef);
  if (!isProduction) return { isProduction: false, policy: targets.backupPolicy ?? null };
  if (targets.productionDatabaseWriteFence !== "verified-v1") {
    throw recoveryError("PRODUCTION_WRITE_FENCE_UNVERIFIED", "Production export is blocked until the write fence is verified.");
  }
  const policy = targets.backupPolicy;
  if (!policy || policy.status !== "verified-v1") {
    throw recoveryError("PRODUCTION_BACKUP_POLICY_UNVERIFIED", "Production export is blocked until backup policy is verified.");
  }
  if (!trafficDrained) {
    throw recoveryError("PRODUCTION_TRAFFIC_NOT_DRAINED", "Production export requires an active traffic drain.");
  }
  const startedAt = new Date(maintenanceStartedAt ?? "");
  if (Number.isNaN(startedAt.getTime()) || startedAt > now || now - startedAt > 30 * 60_000) {
    throw recoveryError("PRODUCTION_MAINTENANCE_WINDOW_INVALID", "Production maintenance start must be within the last 30 minutes.");
  }
  if (!SHA256_RE.test(writeFenceEvidenceSha256 ?? "")) {
    throw recoveryError("WRITE_FENCE_EVIDENCE_INVALID", "Production export requires a SHA-256 write-fence evidence reference.");
  }
  throw recoveryError(
    "PRODUCTION_RECOVERY_LIFECYCLE_UNVERIFIED",
    "Production export remains disabled until a live fence snapshot and automated black-box evidence are cryptographically bound to recovery.",
  );
}

export function assertApprovedNonProductionSource(expectedProjectRef, targets) {
  const approved = Array.isArray(targets.approvedNonProductionSupabaseProjectRefs)
    ? targets.approvedNonProductionSupabaseProjectRefs.map(String)
    : [];
  if (!protectedRefs(targets).includes(expectedProjectRef) && !approved.includes(expectedProjectRef)) {
    throw recoveryError(
      "SOURCE_PROJECT_NOT_APPROVED",
      "Recovery export requires a checked-in approved non-production project ref.",
    );
  }
}

export function assertRestoreTargetAllowed({ sourceProjectRef, targetProjectRef, targets }) {
  if (!PROJECT_REF_RE.test(targetProjectRef ?? "")) {
    throw recoveryError("TARGET_PROJECT_REF_INVALID", "A valid isolated target project ref is required.");
  }
  if (protectedRefs(targets).includes(targetProjectRef)) {
    throw recoveryError("PRODUCTION_RESTORE_FORBIDDEN", "Recovery tooling never restores into a protected production project.");
  }
  if (sourceProjectRef === targetProjectRef) {
    throw recoveryError("SOURCE_TARGET_REF_EQUAL", "Recovery verification target must differ from the source project.");
  }
  const policy = targets.backupPolicy;
  const allowlist = Array.isArray(policy?.allowedRestoreProjectRefs)
    ? policy.allowedRestoreProjectRefs.map(String)
    : [];
  if (policy?.status !== "verified-v1" || !allowlist.includes(targetProjectRef)) {
    throw recoveryError("RESTORE_TARGET_NOT_APPROVED", "Isolated restore target is not approved by backup policy.");
  }
}

async function assertLinkedProject(expectedProjectRef, repoRoot = REPO_ROOT) {
  const linkedRefPath = path.join(repoRoot, "supabase", ".temp", "project-ref");
  const linkedRef = (await readFile(linkedRefPath, "utf8").catch(() => "")).trim();
  if (linkedRef !== expectedProjectRef) {
    throw recoveryError("LINKED_PROJECT_MISMATCH", "Linked Supabase project does not match the expected ref.");
  }
}

function parseJsonOutput(buffer, label) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw recoveryError("NATIVE_JSON_INVALID", `${label} returned an invalid JSON shape.`);
  }
}

export function extractQueryRows(document, label = "Database query") {
  if (Array.isArray(document)) return document;
  if (document && Array.isArray(document.rows)) return document.rows;
  throw recoveryError(
    "NATIVE_QUERY_SHAPE_INVALID",
    `${label} returned an unsupported JSON row envelope.`,
  );
}

async function captureInventory(binary, repoRoot = REPO_ROOT) {
  const result = await runSupabase(
    binary,
    [
      "db",
      "query",
      "--linked",
      "--file",
      path.join(repoRoot, "scripts", "sql", "supabase-recovery-inventory.sql"),
      "--output",
      "json",
    ],
    { captureStdout: true, maxOutputBytes: 8 * 1024 * 1024 },
  );
  const document = parseJsonOutput(result.stdoutBuffer, "Recovery inventory");
  const rows = extractQueryRows(document, "Recovery inventory");
  if (rows.length !== 1) {
    throw recoveryError("INVENTORY_SHAPE_INVALID", "Recovery inventory returned an unexpected row count.");
  }
  const inventory = rows[0].recovery_inventory;
  if (!inventory || inventory.schemaVersion !== 1) {
    throw recoveryError("INVENTORY_VERSION_INVALID", "Recovery inventory schema version is unsupported.");
  }
  return inventory;
}

async function queryApprovedCronContract(binary, repoRoot = REPO_ROOT) {
  const result = await runSupabase(
    binary,
    [
      "db",
      "query",
      "--linked",
      "--file",
      path.join(repoRoot, "scripts", "sql", "supabase-recovery-cron-contract.sql"),
      "--output",
      "json",
    ],
    { captureStdout: true, maxOutputBytes: 1024 * 1024 },
  );
  const document = parseJsonOutput(result.stdoutBuffer, "Recovery cron contract");
  const rows = extractQueryRows(document, "Recovery cron contract");
  if (rows.length !== 1) {
    throw recoveryError(
      "CRON_CONTRACT_SHAPE_INVALID",
      "Recovery cron contract returned an unexpected row count.",
    );
  }
  return assertApprovedCronContract(rows[0].recovery_cron_contract);
}

export function assertApprovedCronSnapshotsStable(primary, verification) {
  const primaryContract = assertApprovedCronContract(primary);
  const verificationContract = assertApprovedCronContract(verification);
  const primaryCanonical = canonicalJson(primaryContract);
  if (primaryCanonical !== canonicalJson(verificationContract)) {
    throw recoveryError(
      "CRON_CONTRACT_DRIFT",
      "Approved cron jobs changed during recovery export.",
    );
  }
  return sha256Text(primaryCanonical);
}

async function writeApprovedCronContractArtifact(contract, workspace) {
  const approved = assertApprovedCronContract(contract);
  const operationsDirectory = path.join(workspace, "operations");
  const artifactPath = path.join(
    workspace,
    ...APPROVED_CRON_ARTIFACT_PATH.split("/"),
  );
  await mkdir(operationsDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    artifactPath,
    `${canonicalJson(approved)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  const artifactDigest = await sha256File(artifactPath);
  return {
    ...approvedCronRecoveryContractMetadata(),
    artifact: {
      path: APPROVED_CRON_ARTIFACT_PATH,
      ...artifactDigest,
    },
  };
}

async function listStorageObjects(binary, pageSize = 500) {
  const objects = [];
  for (let offset = 0; ; offset += pageSize) {
    const sql = `SELECT to_jsonb(o) AS object_record FROM storage.objects o ORDER BY o.bucket_id, o.name, o.id LIMIT ${pageSize} OFFSET ${offset};`;
    const result = await runSupabase(
      binary,
      ["db", "query", "--linked", "--output", "json", sql],
      { captureStdout: true, maxOutputBytes: 16 * 1024 * 1024 },
    );
    const document = parseJsonOutput(result.stdoutBuffer, "Storage inventory page");
    const page = extractQueryRows(document, "Storage inventory page")
      .map((row) => row.object_record);
    if (page.some((entry) => !entry || typeof entry.name !== "string" || typeof entry.bucket_id !== "string")) {
      throw recoveryError("STORAGE_OBJECT_SHAPE_INVALID", "Storage inventory contains an invalid object record.");
    }
    objects.push(...page);
    if (page.length < pageSize) break;
  }
  return objects;
}

function storageMetadataDigest(objects) {
  return sha256Text(canonicalJson(objects));
}

function stableInventoryProjection(inventory) {
  return {
    schemaVersion: inventory.schemaVersion,
    authUserCount: inventory.authUserCount,
    publicTableCounts: inventory.publicTableCounts,
    extensions: inventory.extensions,
    sequences: inventory.sequences,
    storage: inventory.storage,
  };
}

export function stableInventoryDigest(inventory, objects) {
  return sha256Text(canonicalJson({
    inventory: stableInventoryProjection(inventory),
    storageMetadataSha256: storageMetadataDigest(objects),
    storageObjectCount: objects.length,
  }));
}

function databaseSnapshotProjection(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.artifacts)
    || !snapshot.copyTableDigests || typeof snapshot.copyTableDigests !== "object") {
    throw recoveryError(
      "DATABASE_SNAPSHOT_EVIDENCE_INVALID",
      "Database snapshot evidence has an invalid shape.",
    );
  }

  const artifacts = snapshot.artifacts.map((artifact) => {
    if (
      !artifact
      || typeof artifact.kind !== "string"
      || typeof artifact.path !== "string"
      || !SHA256_RE.test(artifact.sha256 ?? "")
      || !SHA256_RE.test(artifact.comparisonSha256 ?? "")
      || !Number.isSafeInteger(artifact.size)
      || artifact.size < 0
    ) {
      throw recoveryError(
        "DATABASE_SNAPSHOT_EVIDENCE_INVALID",
        "Database snapshot evidence contains an invalid artifact.",
      );
    }
    return {
      kind: artifact.kind,
      path: artifact.path,
      comparisonSha256: artifact.comparisonSha256.toLowerCase(),
    };
  }).sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));

  const identities = artifacts.map(({ kind, path: artifactPath }) => `${kind}\0${artifactPath}`);
  if (new Set(identities).size !== identities.length) {
    throw recoveryError(
      "DATABASE_SNAPSHOT_EVIDENCE_INVALID",
      "Database snapshot evidence contains duplicate artifacts.",
    );
  }

  return {
    artifacts,
    copyTableDigests: snapshot.copyTableDigests,
  };
}

/**
 * Proves that every SQL artifact, including row-bearing dumps, is identical
 * across two independent captures after validating and normalizing only the
 * random pg_dump restrict-key pair. Row counts alone cannot detect an UPDATE
 * that keeps table cardinality unchanged.
 */
export function assertDatabaseSnapshotStable(primary, verification) {
  const primaryEvidence = canonicalJson(databaseSnapshotProjection(primary));
  const verificationEvidence = canonicalJson(databaseSnapshotProjection(verification));
  if (primaryEvidence !== verificationEvidence) {
    throw recoveryError(
      "DATABASE_SNAPSHOT_DRIFT",
      "Database content or schema changed between independent recovery captures.",
    );
  }
  return sha256Text(primaryEvidence);
}

export function parseStorageConcurrency(value) {
  const parsed = Number(value ?? 4);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_STORAGE_CONCURRENCY) {
    throw recoveryError(
      "STORAGE_CONCURRENCY_INVALID",
      `Storage concurrency must be an integer from 1 to ${MAX_STORAGE_CONCURRENCY}.`,
    );
  }
  return parsed;
}

function encodedStorageObjectUrl(projectRef, object) {
  const bucket = encodeURIComponent(object.bucket_id);
  const key = object.name.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return new URL(`/storage/v1/object/authenticated/${bucket}/${key}`, `https://${projectRef}.supabase.co`);
}

function expectedObjectSize(object) {
  const candidate = object?.metadata?.size;
  const parsed = typeof candidate === "number" ? candidate : Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchObjectToBlob({
  object,
  projectRef,
  serviceRoleKey,
  workspace,
  fetchImpl = fetch,
  attempts = 3,
}) {
  const incomingDirectory = path.join(workspace, "incoming");
  const blobDirectory = path.join(workspace, "blobs");
  await mkdir(incomingDirectory, { recursive: true, mode: 0o700 });
  await mkdir(blobDirectory, { recursive: true, mode: 0o700 });
  let lastCode = "STORAGE_DOWNLOAD_FAILED";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const partial = path.join(incomingDirectory, `${randomUUID()}.part`);
    try {
      const response = await fetchImpl(encodedStorageObjectUrl(projectRef, object), {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status >= 300 && response.status < 400) {
        throw recoveryError("STORAGE_REDIRECT_FORBIDDEN", "Storage download redirect was refused.");
      }
      if (response.status !== 200 || !response.body) {
        lastCode = `STORAGE_HTTP_${response.status}`;
        if (![408, 429].includes(response.status) && response.status < 500) {
          throw recoveryError(lastCode, "Storage object download was refused.");
        }
        throw recoveryError(lastCode, "Storage object download is temporarily unavailable.");
      }

      const hash = createHash("sha256");
      let byteSize = 0;
      const hashingStream = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          byteSize += chunk.length;
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        hashingStream,
        createWriteStream(partial, { flags: "wx", mode: 0o600 }),
      );
      const expectedSize = expectedObjectSize(object);
      if (expectedSize !== null && expectedSize !== byteSize) {
        throw recoveryError("STORAGE_SIZE_MISMATCH", "Storage object byte size differs from metadata.");
      }
      const byteSha256 = hash.digest("hex");
      const relativeBlobPath = path.posix.join("blobs", byteSha256);
      const finalBlob = path.join(blobDirectory, byteSha256);
      if (await fileExists(finalBlob)) {
        await rm(partial, { force: true });
      } else {
        await rename(partial, finalBlob);
        await chmod(finalBlob, 0o600).catch(() => {});
      }
      return {
        object,
        byteSha256,
        byteSize,
        blob: relativeBlobPath,
      };
    } catch (error) {
      await rm(partial, { force: true }).catch(() => {});
      if (error instanceof RecoveryError && [
        "STORAGE_REDIRECT_FORBIDDEN",
        "STORAGE_SIZE_MISMATCH",
        "STORAGE_HTTP_400",
        "STORAGE_HTTP_401",
        "STORAGE_HTTP_403",
        "STORAGE_HTTP_404",
      ].includes(error.code)) throw error;
      if (attempt === attempts) {
        throw recoveryError(lastCode, "Storage object download failed after bounded retries.", { cause: error });
      }
      await wait(250 * (2 ** (attempt - 1)));
    }
  }
  throw recoveryError(lastCode, "Storage object download failed.");
}

export async function exportStorageObjects(options) {
  const concurrency = parseStorageConcurrency(options.concurrency);
  const results = new Array(options.objects.length);
  let cursor = 0;
  let firstFailure;
  async function worker() {
    while (!firstFailure) {
      const index = cursor;
      cursor += 1;
      if (index >= options.objects.length) return;
      try {
        results[index] = await fetchObjectToBlob({
          ...options,
          object: options.objects[index],
        });
      } catch (error) {
        firstFailure ??= error;
        return;
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, options.objects.length || 1) },
    worker,
  );
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((entry) => entry.status === "rejected");
  if (firstFailure) throw firstFailure;
  if (rejected) throw rejected.reason;
  return results;
}

export function assertStorageManifestCoverage(sourceObjects, exportedObjects) {
  if (sourceObjects.length !== exportedObjects.length) {
    throw recoveryError("STORAGE_MANIFEST_COVERAGE_MISMATCH", "Storage manifest does not cover every source object.");
  }
  const sourceIdentities = new Set();
  for (let index = 0; index < sourceObjects.length; index += 1) {
    const source = sourceObjects[index];
    const exported = exportedObjects[index];
    const identity = `${source.bucket_id}\u0000${source.name}`;
    if (sourceIdentities.has(identity)) {
      throw recoveryError("STORAGE_SOURCE_IDENTITY_DUPLICATE", "Storage source inventory contains a duplicate object identity.");
    }
    sourceIdentities.add(identity);
    if (
      !exported
      || exported.object?.bucket_id !== source.bucket_id
      || exported.object?.name !== source.name
      || !SHA256_RE.test(exported.byteSha256 ?? "")
      || exported.blob !== path.posix.join("blobs", exported.byteSha256)
      || !Number.isSafeInteger(exported.byteSize)
      || exported.byteSize < 0
    ) {
      throw recoveryError("STORAGE_MANIFEST_COVERAGE_MISMATCH", "Storage manifest contains a missing or invalid object entry.");
    }
  }
}

async function assertNonEmptyFile(filePath, allowEmpty = false) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || (!allowEmpty && info.size === 0)) {
    throw recoveryError("RECOVERY_ARTIFACT_INVALID", "A recovery artifact is missing or empty.");
  }
}

async function dumpDatabase(binary, workspace, repoRoot = REPO_ROOT) {
  const dbDirectory = path.join(workspace, "db");
  await mkdir(dbDirectory, { mode: 0o700 });
  const definitions = [
    { name: "roles", file: "roles.sql", args: ["db", "dump", "--linked", "--role-only"] },
    { name: "schema", file: "schema.sql", args: ["db", "dump", "--linked"] },
    {
      name: "data-auth-public",
      file: "data-auth-public.sql",
      args: ["db", "dump", "--linked", "--data-only", "--use-copy", "--schema", "auth,public"],
    },
    {
      name: "data-storage",
      file: "data-storage.sql",
      args: [
        "db", "dump", "--linked", "--data-only", "--use-copy", "--schema", "storage",
        "-x", "storage.buckets_vectors", "-x", "storage.vector_indexes",
      ],
    },
    {
      name: "migration-history-schema",
      file: "migration-history-schema.sql",
      args: ["db", "dump", "--linked", "--schema", "supabase_migrations"],
    },
    {
      name: "migration-history-data",
      file: "migration-history-data.sql",
      args: ["db", "dump", "--linked", "--data-only", "--use-copy", "--schema", "supabase_migrations"],
    },
  ];

  const artifacts = [];
  for (const definition of definitions) {
    const target = path.join(dbDirectory, definition.file);
    await runSupabase(binary, [...definition.args, "--file", target], { timeoutMs: 30 * 60_000 });
    await assertNonEmptyFile(target);
    const digest = await sha256File(target);
    artifacts.push({
      kind: definition.name,
      path: path.posix.join("db", definition.file),
      ...digest,
      comparisonSha256: await databaseArtifactComparisonSha256(target),
    });
  }

  const managedChanges = path.join(dbDirectory, "managed-auth-storage-changes.sql");
  await runSupabase(
    binary,
    ["db", "diff", "--linked", "--schema", "auth,storage"],
    { stdoutFile: managedChanges, timeoutMs: 30 * 60_000 },
  );
  await assertNonEmptyFile(managedChanges, true);
  artifacts.push({
    kind: "managed-auth-storage-changes",
    path: path.posix.join("db", "managed-auth-storage-changes.sql"),
    ...(await sha256File(managedChanges)),
    comparisonSha256: await databaseArtifactComparisonSha256(managedChanges),
  });

  const copyTableDigests = {};
  for (const artifact of artifacts.filter((entry) => entry.kind.includes("data"))) {
    Object.assign(
      copyTableDigests,
      await parseCopyTableDigests(path.join(workspace, ...artifact.path.split("/"))),
    );
  }
  return { artifacts, copyTableDigests };
}

async function verifyIndependentDatabaseSnapshot(
  binary,
  workspace,
  primarySnapshot,
  repoRoot = REPO_ROOT,
) {
  const verificationWorkspace = path.join(workspace, "database-stability-verification");
  await mkdir(verificationWorkspace, { mode: 0o700 });
  try {
    const verificationSnapshot = await dumpDatabase(binary, verificationWorkspace, repoRoot);
    return assertDatabaseSnapshotStable(primarySnapshot, verificationSnapshot);
  } finally {
    await removeRecoveryPathVerified(verificationWorkspace, { recursive: true });
  }
}

function addMod256(leftHex, rightHex) {
  const modulus = 1n << 256n;
  return ((BigInt(`0x${leftHex}`) + BigInt(`0x${rightHex}`)) % modulus)
    .toString(16)
    .padStart(64, "0");
}

function xor256(leftHex, rightHex) {
  return (BigInt(`0x${leftHex}`) ^ BigInt(`0x${rightHex}`))
    .toString(16)
    .padStart(64, "0");
}

export async function parseCopyTableDigests(sqlFile) {
  const stream = createReadStream(sqlFile, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const result = {};
  let active = null;
  for await (const line of lines) {
    if (!active) {
      const match = line.match(/^COPY\s+(.+?)\s+\((.+)\)\s+FROM stdin;$/);
      if (match) {
        active = {
          table: match[1],
          columnsSha256: sha256Text(match[2]),
          rows: 0,
          xor: "0".repeat(64),
          sum: "0".repeat(64),
        };
      }
      continue;
    }
    if (line === "\\.") {
      result[active.table] = {
        rows: active.rows,
        columnsSha256: active.columnsSha256,
        rowHashXor: active.xor,
        rowHashSumMod256: active.sum,
      };
      active = null;
      continue;
    }
    const rowHash = sha256Text(line);
    active.rows += 1;
    active.xor = xor256(active.xor, rowHash);
    active.sum = addMod256(active.sum, rowHash);
  }
  if (active) throw recoveryError("COPY_DUMP_TRUNCATED", "COPY data ended before its terminator.");
  return result;
}

function ageRecipientFromArgs(args, policy, isProduction) {
  const configured = Array.isArray(policy?.ageRecipients)
    ? policy.ageRecipients.map((entry) => typeof entry === "string" ? entry : entry?.recipient).filter(Boolean)
    : [];
  const requested = args["age-recipient"] ?? configured[0];
  if (!AGE_RECIPIENT_RE.test(requested ?? "")) {
    throw recoveryError("AGE_RECIPIENT_INVALID", "A valid age recipient is required.");
  }
  if (isProduction && !configured.includes(requested)) {
    throw recoveryError("AGE_RECIPIENT_NOT_APPROVED", "Production age recipient is not approved by backup policy.");
  }
  return requested;
}

async function createEncryptedArchive({ workspace, outputRoot, artifactId, ageRecipient, tools }) {
  const { tarExecutable, ageExecutable } = tools;
  const packagingDirectory = `${workspace}-package`;
  const tarPath = path.join(packagingDirectory, "archive.tar");
  const partial = path.join(outputRoot, `${artifactId}.tar.age.partial`);
  const final = path.join(outputRoot, `${artifactId}.tar.age`);
  await mkdir(packagingDirectory, { mode: 0o700 });
  try {
    await lockDownDirectory(packagingDirectory);
    await runBoundedRedacted({
      executable: tarExecutable,
      args: ["-cf", tarPath, "-C", workspace, "."],
      timeoutMs: 30 * 60_000,
    });
    await assertNonEmptyFile(tarPath);
    await runBoundedRedacted({
      executable: ageExecutable,
      args: ["-r", ageRecipient, "-o", partial, tarPath],
      timeoutMs: 30 * 60_000,
    });
    await assertNonEmptyFile(partial);
    await rename(partial, final);
    await chmod(final, 0o600).catch(() => {});
    return { archivePath: final, ...(await sha256File(final)) };
  } finally {
    await removeRecoveryPathsVerified([
      { targetPath: partial },
      { targetPath: packagingDirectory, recursive: true },
    ]);
  }
}

function privateManifestFileEntries(privateManifest) {
  const databaseFiles = privateManifest.database?.files ?? [];
  const operationalArtifacts = privateManifest.operations?.approvedCron?.artifact
    ? [privateManifest.operations.approvedCron.artifact]
    : [];
  const blobMap = new Map();
  for (const entry of privateManifest.storage?.objects ?? []) {
    if (!blobMap.has(entry.blob)) {
      blobMap.set(entry.blob, { path: entry.blob, sha256: entry.byteSha256, size: entry.byteSize });
    }
  }
  return [...databaseFiles, ...operationalArtifacts, ...blobMap.values()];
}

export async function verifyPrivateManifestArtifactDigests(
  privateManifest,
  extractedDirectory,
) {
  const databasePaths = new Set(
    (privateManifest.database?.files ?? []).map((entry) => entry.path),
  );
  for (const entry of privateManifestFileEntries(privateManifest)) {
    if (!validateTarEntry(entry.path)) {
      throw recoveryError(
        "PRIVATE_MANIFEST_PATH_INVALID",
        "Private manifest contains an unsafe artifact path.",
      );
    }
    const artifactPath = path.join(extractedDirectory, ...entry.path.split("/"));
    const digest = await sha256File(artifactPath);
    if (digest.sha256 !== entry.sha256 || digest.size !== entry.size) {
      throw recoveryError(
        "PRIVATE_ARTIFACT_DIGEST_MISMATCH",
        "Decrypted recovery artifact failed checksum verification.",
      );
    }

    // comparisonSha256 canonicalizes pg_dump text and is meaningful only for
    // database SQL artifacts. Storage blobs are arbitrary binary files; their
    // exact raw SHA-256 and byte size above are the complete integrity proof.
    if (!databasePaths.has(entry.path)) continue;
    const comparisonSha256 = await databaseArtifactComparisonSha256(artifactPath);
    if (comparisonSha256 !== entry.comparisonSha256) {
      throw recoveryError(
        "DATABASE_ARTIFACT_COMPARISON_DIGEST_MISMATCH",
        "Decrypted database artifact failed stability-digest verification.",
      );
    }
  }
}

function normalizeArchivePath(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

function assertUniqueArchiveEntries(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const normalized = normalizeArchivePath(entry);
    if (!normalized) continue;
    const collisionKey = normalized.normalize("NFC").toLowerCase();
    if (seen.has(collisionKey)) {
      throw recoveryError(
        "ARCHIVE_ENTRY_DUPLICATE",
        "Recovery archive contains a duplicate path.",
      );
    }
    seen.add(collisionKey);
  }
}

export function assertApprovedCronRecoveryManifest(value) {
  if (
    value?.contractVersion !== APPROVED_CRON_CONTRACT_VERSION
    || value?.artifact?.path !== APPROVED_CRON_ARTIFACT_PATH
    || !SHA256_RE.test(value?.artifact?.sha256 ?? "")
    || !Number.isSafeInteger(value?.artifact?.size)
    || value.artifact.size <= 0
    || value.contractSha256 !== approvedCronContractSha256()
    || value.jobCount !== APPROVED_CRON_CONTRACT.jobs.length
    || value.replayStrategy !== CRON_REPLAY_STRATEGY
    || value.replaySqlSha256 !== approvedCronReplaySqlSha256()
    || value.preActivationLauncherState !== "off"
    || value.postActivationLauncherState !== "on"
    || value.preActivationRunningJobCount !== 0
    || value.replayedJobsActive !== false
    || value.targetDatabaseBinding !== "current_database"
    || value.schedulerRole !== APPROVED_CRON_SCHEDULER_ROLE
    || value.timezone !== APPROVED_CRON_TIMEZONE
    || value.replayRequired !== true
    || value.postDeployRecheckRequired !== true
    || value.activationStrategy !== CRON_ACTIVATION_STRATEGY
    || value.activationSqlSha256 !== approvedCronActivationSqlSha256()
    || value.activationRequired !== true
    || value.activationAfterParityRequired !== true
    || value.postActivationRecheckRequired !== true
  ) {
    throw recoveryError(
      "CRON_RECOVERY_ARTIFACT_INVALID",
      "Recovery archive is missing the exact approved cron artifact and replay contract.",
    );
  }
  return value;
}

export async function verifyApprovedCronRecoveryArtifact(
  privateManifest,
  extractedDirectory,
) {
  const manifest = assertApprovedCronRecoveryManifest(
    privateManifest.operations?.approvedCron,
  );
  const artifactPath = path.join(
    extractedDirectory,
    ...manifest.artifact.path.split("/"),
  );
  const artifactText = await readFile(artifactPath, "utf8");
  let contract;
  try {
    contract = assertApprovedCronContract(JSON.parse(artifactText));
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw recoveryError(
      "CRON_RECOVERY_ARTIFACT_JSON_INVALID",
      "Approved cron recovery artifact is not valid JSON.",
      { cause: error },
    );
  }
  if (artifactText !== `${canonicalJson(contract)}\n`) {
    throw recoveryError(
      "CRON_RECOVERY_ARTIFACT_NONCANONICAL",
      "Approved cron recovery artifact is not in canonical portable form.",
    );
  }
  return { contract, manifest };
}

function assertBlockedArchiveAuthenticityDescriptor(value) {
  const expected = {
    contract: ARCHIVE_AUTHENTICITY_CONTRACT,
    status: BLOCKED_ARCHIVE_AUTHENTICITY_STATUS,
    senderSignatureVerified: false,
    externalImmutableAnchorVerified: false,
  };
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw recoveryError(
      "ARCHIVE_AUTHENTICITY_DESCRIPTOR_INVALID",
      "Recovery metadata must explicitly preserve the blocked archive-authenticity gate.",
    );
  }
  return value;
}

export function assertPrivateManifestArchiveCoverage(privateManifest, extractedFiles) {
  const databaseFiles = privateManifest.database?.files;
  const copyTableDigests = privateManifest.database?.copyTableDigests;
  const storageObjects = privateManifest.storage?.objects;
  const inventory = privateManifest.database?.inventory;
  if (
    !Array.isArray(databaseFiles)
    || !copyTableDigests
    || typeof copyTableDigests !== "object"
    || Array.isArray(copyTableDigests)
    || !Array.isArray(storageObjects)
    || inventory?.schemaVersion !== 1
    || storageObjects.some((entry) =>
      !entry?.object
      || typeof entry.object.bucket_id !== "string"
      || typeof entry.object.name !== "string")
  ) {
    throw recoveryError(
      "PRIVATE_MANIFEST_COVERAGE_INVALID",
      "Private recovery manifest is missing required database or Storage coverage.",
    );
  }

  const expectedKinds = Object.keys(REQUIRED_DATABASE_ARTIFACTS);
  if (databaseFiles.length !== expectedKinds.length) {
    throw recoveryError(
      "DATABASE_ARTIFACT_SET_MISMATCH",
      "Recovery archive does not contain the exact required database artifact set.",
    );
  }
  const seenKinds = new Set();
  const declaredPaths = new Set(["manifest.private.json"]);
  for (const entry of databaseFiles) {
    const expectedPath = REQUIRED_DATABASE_ARTIFACTS[entry?.kind];
    if (
      !expectedPath
      || entry.path !== expectedPath
      || seenKinds.has(entry.kind)
      || !SHA256_RE.test(entry.sha256 ?? "")
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
    ) {
      throw recoveryError(
        "DATABASE_ARTIFACT_SET_MISMATCH",
        "Recovery archive contains a missing, duplicate, or invalid database artifact.",
      );
    }
    seenKinds.add(entry.kind);
    declaredPaths.add(entry.path);
  }
  if (expectedKinds.some((kind) => !seenKinds.has(kind))) {
    throw recoveryError(
      "DATABASE_ARTIFACT_SET_MISMATCH",
      "Recovery archive is missing a required database artifact.",
    );
  }

  const approvedCron = assertApprovedCronRecoveryManifest(
    privateManifest.operations?.approvedCron,
  );
  assertBlockedArchiveAuthenticityDescriptor(privateManifest.authenticity);
  declaredPaths.add(approvedCron.artifact.path);

  const consistency = privateManifest.consistency;
  const boundDatabaseSnapshotSha256 = sha256Text(canonicalJson(
    databaseSnapshotProjection({
      artifacts: databaseFiles,
      copyTableDigests,
    }),
  ));
  if (
    consistency?.cronSnapshotMethod !== "independent-exact-query-v1"
    || consistency.cronContractSha256 !== approvedCron.contractSha256
  ) {
    throw recoveryError(
      "CRON_STABILITY_EVIDENCE_INVALID",
      "Recovery archive lacks bound independent cron stability evidence.",
    );
  }
  if (
    consistency?.stable !== true
    || consistency.databaseSnapshotMethod !== "independent-redump-v2-restrict-canonical"
    || !SHA256_RE.test(consistency.preInventorySha256 ?? "")
    || consistency.preInventorySha256 !== consistency.postInventorySha256
    || consistency.databaseSnapshotSha256 !== boundDatabaseSnapshotSha256
  ) {
    throw recoveryError(
      "DATABASE_STABILITY_EVIDENCE_INVALID",
      "Recovery archive lacks bound independent database stability evidence.",
    );
  }

  assertStorageManifestCoverage(
    storageObjects.map((entry) => entry?.object),
    storageObjects,
  );
  const computedStorageBytes = storageObjects.reduce(
    (sum, entry) => sum + entry.byteSize,
    0,
  );
  const sourceObjects = storageObjects.map((entry) => entry.object);
  const inventoryStorage = inventory.storage;
  const inventoryBuckets = inventoryStorage?.buckets;
  const inventoryBucketIds = Array.isArray(inventoryBuckets)
    ? inventoryBuckets.map((bucket) => bucket?.id)
    : [];
  const uniqueInventoryBucketIds = new Set(inventoryBucketIds);
  if (
    !inventoryStorage
    || !Array.isArray(inventoryBuckets)
    || inventoryBucketIds.some((id) => typeof id !== "string" || !id)
    || uniqueInventoryBucketIds.size !== inventoryBucketIds.length
    || !Number.isSafeInteger(inventoryStorage.bucketCount)
    || inventoryStorage.bucketCount < 0
    || inventoryBuckets.length !== inventoryStorage.bucketCount
    || !Number.isSafeInteger(inventoryStorage.objectCount)
    || inventoryStorage.objectCount < 0
    || !Number.isSafeInteger(inventoryStorage.totalBytes)
    || inventoryStorage.totalBytes < 0
    || !Number.isSafeInteger(privateManifest.storage.bucketCount)
    || privateManifest.storage.bucketCount < 0
    || privateManifest.storage.bucketCount !== inventoryStorage.bucketCount
    || storageObjects.length !== inventoryStorage.objectCount
    || !Number.isSafeInteger(privateManifest.storage.totalBytes)
    || privateManifest.storage.totalBytes !== computedStorageBytes
    || computedStorageBytes !== inventoryStorage.totalBytes
    || storageObjects.some((entry) => expectedObjectSize(entry.object) !== entry.byteSize)
    || sourceObjects.some((object) => !uniqueInventoryBucketIds.has(object.bucket_id))
    || privateManifest.storage.metadataSha256 !== storageMetadataDigest(sourceObjects)
  ) {
    throw recoveryError(
      "STORAGE_AGGREGATE_MISMATCH",
      "Recovery Storage manifest aggregates do not match its source inventory.",
    );
  }
  for (const entry of storageObjects) declaredPaths.add(entry.blob);

  const actualPaths = (extractedFiles ?? []).map(normalizeArchivePath);
  const actualPathSet = new Set(actualPaths);
  if (
    actualPathSet.size !== actualPaths.length
    || actualPathSet.size !== declaredPaths.size
    || [...declaredPaths].some((entry) => !actualPathSet.has(entry))
  ) {
    throw recoveryError(
      "ARCHIVE_FILE_SET_MISMATCH",
      "Recovery archive files do not exactly match the private manifest.",
    );
  }
}

function publicApprovedCronSummary(privateCron) {
  return {
    contractVersion: privateCron?.contractVersion,
    jobCount: privateCron?.jobCount,
    contractSha256: privateCron?.contractSha256,
    privateArtifactSha256: privateCron?.artifact?.sha256,
    replayStrategy: privateCron?.replayStrategy,
    replaySqlSha256: privateCron?.replaySqlSha256,
    preActivationLauncherState: privateCron?.preActivationLauncherState,
    postActivationLauncherState: privateCron?.postActivationLauncherState,
    preActivationRunningJobCount: privateCron?.preActivationRunningJobCount,
    replayedJobsActive: privateCron?.replayedJobsActive,
    targetDatabaseBinding: privateCron?.targetDatabaseBinding,
    schedulerRole: privateCron?.schedulerRole,
    timezone: privateCron?.timezone,
    replayRequired: privateCron?.replayRequired,
    postDeployRecheckRequired: privateCron?.postDeployRecheckRequired,
    activationStrategy: privateCron?.activationStrategy,
    activationSqlSha256: privateCron?.activationSqlSha256,
    activationRequired: privateCron?.activationRequired,
    activationAfterParityRequired: privateCron?.activationAfterParityRequired,
    postActivationRecheckRequired: privateCron?.postActivationRecheckRequired,
  };
}

export function assertPublicPrivateManifestConsistency(
  publicManifest,
  privateManifest,
) {
  const expectedDatabase = {
    fileCount: privateManifest.database?.files?.length,
    copyTableCount: Object.keys(
      privateManifest.database?.copyTableDigests ?? {},
    ).length,
  };
  const expectedStorage = {
    bucketCount: privateManifest.storage?.bucketCount,
    objectCount: privateManifest.storage?.objects?.length,
    totalBytes: privateManifest.storage?.totalBytes,
    privateMetadataSha256: privateManifest.storage?.metadataSha256,
  };
  const expectedOperations = {
    approvedCron: publicApprovedCronSummary(
      privateManifest.operations?.approvedCron,
    ),
  };
  if (
    privateManifest.formatVersion !== RECOVERY_FORMAT_VERSION ||
    publicManifest.formatVersion !== RECOVERY_FORMAT_VERSION ||
    privateManifest.artifactId !== publicManifest.artifactId ||
    canonicalJson(privateManifest.source) !== canonicalJson(publicManifest.source) ||
    canonicalJson(privateManifest.consistency) !==
      canonicalJson(publicManifest.consistency) ||
    canonicalJson(expectedDatabase) !== canonicalJson(publicManifest.database) ||
    canonicalJson(expectedStorage) !== canonicalJson(publicManifest.storage) ||
    canonicalJson(expectedOperations) !== canonicalJson(publicManifest.operations) ||
    canonicalJson(privateManifest.authenticity) !==
      canonicalJson(publicManifest.authenticity) ||
    publicManifest.releaseEligible !== false ||
    publicManifest.restoreDrillVerified !== false
  ) {
    throw recoveryError(
      "PUBLIC_PRIVATE_MANIFEST_MISMATCH",
      "Public recovery metadata does not match the encrypted private manifest.",
    );
  }
}

async function walkFiles(root, relative = "") {
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name);
    const childAbsolute = path.join(root, childRelative);
    const info = await lstat(childAbsolute);
    if (info.isSymbolicLink()) {
      throw recoveryError("ARCHIVE_SYMLINK_FORBIDDEN", "Recovery archive may not contain symbolic links.");
    }
    if (info.isDirectory()) files.push(...await walkFiles(root, childRelative));
    else if (info.isFile()) files.push(childRelative);
    else throw recoveryError("ARCHIVE_ENTRY_UNSUPPORTED", "Recovery archive contains an unsupported entry type.");
  }
  return files;
}

function validateTarEntry(entry) {
  const normalized = entry.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  return !segments.includes("..");
}

export function validateVerboseTarListing(listing) {
  const lines = String(listing ?? "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const type = line[0];
    if ((type !== "-" && type !== "d") || line.includes(" -> ") || line.includes(" link to ")) {
      throw recoveryError(
        "ARCHIVE_LINK_ENTRY_FORBIDDEN",
        "Recovery archive contains a symbolic link, hard link, or unsupported entry type.",
      );
    }
  }
}

export async function verifyArchive({
  archivePath,
  publicManifestPath,
  identityFile,
  stagingRoot,
  expectedSourceProjectRef,
}) {
  await assertSensitiveFilePath(identityFile);
  const publicManifest = JSON.parse(await readFile(publicManifestPath, "utf8"));
  if (
    publicManifest.formatVersion !== RECOVERY_FORMAT_VERSION
    || !publicManifest.archive?.sha256
  ) {
    throw recoveryError("PUBLIC_MANIFEST_INVALID", "Public recovery manifest is invalid.");
  }
  if (expectedSourceProjectRef && publicManifest.source?.projectRef !== expectedSourceProjectRef) {
    throw recoveryError("ARCHIVE_SOURCE_MISMATCH", "Recovery archive source project does not match expectation.");
  }
  const archiveDigest = await sha256File(archivePath);
  if (
    publicManifest.archive.file !== path.basename(archivePath) ||
    archiveDigest.sha256 !== publicManifest.archive.sha256 ||
    archiveDigest.size !== publicManifest.archive.size
  ) {
    throw recoveryError("ARCHIVE_DIGEST_MISMATCH", "Encrypted recovery archive digest does not match its manifest.");
  }

  const targets = await loadReleaseTargets();
  const configuredAuthenticity = archiveAuthenticityDescriptor(
    targets.backupPolicy,
  );
  const tools = await resolveRecoveryTools({
    isProduction: protectedRefs(targets).includes(publicManifest.source?.projectRef),
    policy: targets.backupPolicy,
  });
  const workspace = await createSecureWorkspace(stagingRoot);
  const tarPath = path.join(workspace, "archive.tar");
  const extractDirectory = path.join(workspace, "extracted");
  const { ageExecutable, tarExecutable } = tools;
  try {
    await runBoundedRedacted({
      executable: ageExecutable,
      args: ["-d", "-i", identityFile, "-o", tarPath, archivePath],
      timeoutMs: 30 * 60_000,
    });
    await assertNonEmptyFile(tarPath);
    const listing = await runBoundedRedacted({
      executable: tarExecutable,
      args: ["-tf", tarPath],
      captureStdout: true,
      maxOutputBytes: 16 * 1024 * 1024,
      timeoutMs: 10 * 60_000,
    });
    const entries = listing.stdoutBuffer.toString("utf8").split(/\r?\n/).filter(Boolean);
    if (entries.some((entry) => !validateTarEntry(entry))) {
      throw recoveryError("ARCHIVE_PATH_TRAVERSAL", "Recovery archive contains an unsafe path.");
    }
    assertUniqueArchiveEntries(entries);
    const verboseListing = await runBoundedRedacted({
      executable: tarExecutable,
      args: ["-tvf", tarPath],
      captureStdout: true,
      maxOutputBytes: 32 * 1024 * 1024,
      timeoutMs: 10 * 60_000,
    });
    validateVerboseTarListing(verboseListing.stdoutBuffer.toString("utf8"));
    await mkdir(extractDirectory, { mode: 0o700 });
    await runBoundedRedacted({
      executable: tarExecutable,
      args: ["-xf", tarPath, "-C", extractDirectory],
      timeoutMs: 30 * 60_000,
    });
    const extractedFiles = await walkFiles(extractDirectory);
    const privateManifest = JSON.parse(
      await readFile(path.join(extractDirectory, "manifest.private.json"), "utf8"),
    );
    assertPublicPrivateManifestConsistency(publicManifest, privateManifest);
    assertPrivateManifestArchiveCoverage(privateManifest, extractedFiles);
    if (
      canonicalJson(privateManifest.authenticity) !==
      canonicalJson(configuredAuthenticity)
    ) {
      throw recoveryError(
        "ARCHIVE_AUTHENTICITY_POLICY_MISMATCH",
        "Archive authenticity metadata does not match the checked-in blocked policy.",
      );
    }
    if (
      expectedSourceProjectRef &&
      privateManifest.source?.projectRef !== expectedSourceProjectRef
    ) {
      throw recoveryError(
        "ARCHIVE_SOURCE_MISMATCH",
        "Encrypted recovery source project does not match expectation.",
      );
    }
    await verifyPrivateManifestArtifactDigests(privateManifest, extractDirectory);
    const actualCopyTableDigests = {};
    for (const entry of privateManifest.database.files.filter(({ kind }) => kind.includes("data"))) {
      Object.assign(
        actualCopyTableDigests,
        await parseCopyTableDigests(path.join(extractDirectory, ...entry.path.split("/"))),
      );
    }
    if (
      canonicalJson(actualCopyTableDigests) !==
      canonicalJson(privateManifest.database.copyTableDigests)
    ) {
      throw recoveryError(
        "COPY_DIGEST_MISMATCH",
        "Recovery COPY table digests do not match the decrypted database artifacts.",
      );
    }
    const { manifest: approvedCronManifest } =
      await verifyApprovedCronRecoveryArtifact(
        privateManifest,
        extractDirectory,
      );
    return {
      ok: true,
      archiveIntegrityVerified: true,
      artifactId: publicManifest.artifactId,
      sourceProjectRef: privateManifest.source.projectRef,
      sourceGitSha: privateManifest.source.gitSha,
      sourceCompletedAt: privateManifest.source.completedAt,
      databaseSnapshotSha256:
        privateManifest.consistency.databaseSnapshotSha256,
      databaseFileCount: privateManifest.database.files.length,
      storageObjectCount: privateManifest.storage.objects.length,
      storageTotalBytes: privateManifest.storage.totalBytes,
      storageMetadataSha256: privateManifest.storage.metadataSha256,
      cronContractVerified: true,
      cronContractVersion: approvedCronManifest.contractVersion,
      cronContractSha256: approvedCronManifest.contractSha256,
      cronJobCount: approvedCronManifest.jobCount,
      cronReplayStrategy: approvedCronManifest.replayStrategy,
      cronReplaySqlSha256: approvedCronManifest.replaySqlSha256,
      cronPreActivationLauncherState:
        approvedCronManifest.preActivationLauncherState,
      cronPostActivationLauncherState:
        approvedCronManifest.postActivationLauncherState,
      cronPreActivationRunningJobCount:
        approvedCronManifest.preActivationRunningJobCount,
      cronReplayedJobsActive: approvedCronManifest.replayedJobsActive,
      cronTargetDatabaseBinding: approvedCronManifest.targetDatabaseBinding,
      cronSchedulerRole: approvedCronManifest.schedulerRole,
      cronTimezone: approvedCronManifest.timezone,
      cronReplayRequired: true,
      postDeployRecheckRequired: true,
      cronActivationStrategy: approvedCronManifest.activationStrategy,
      cronActivationSqlSha256: approvedCronManifest.activationSqlSha256,
      cronActivationRequired: true,
      cronActivationAfterParityRequired: true,
      postActivationRecheckRequired: true,
      archiveAuthenticityVerified: false,
      senderSignatureVerified: false,
      externalImmutableAnchorVerified: false,
      archiveAuthenticityStatus: configuredAuthenticity.status,
      archiveSha256: archiveDigest.sha256,
    };
  } finally {
    await removeRecoveryPathVerified(workspace, { recursive: true });
  }
}

function publicManifestFromPrivate(privateManifest, encryptedArchive, ageRecipient) {
  return {
    formatVersion: RECOVERY_FORMAT_VERSION,
    artifactId: privateManifest.artifactId,
    source: privateManifest.source,
    consistency: privateManifest.consistency,
    database: {
      fileCount: privateManifest.database.files.length,
      copyTableCount: Object.keys(privateManifest.database.copyTableDigests).length,
    },
    storage: {
      bucketCount: privateManifest.storage.bucketCount,
      objectCount: privateManifest.storage.objects.length,
      totalBytes: privateManifest.storage.totalBytes,
      privateMetadataSha256: privateManifest.storage.metadataSha256,
    },
    operations: {
      approvedCron: publicApprovedCronSummary(
        privateManifest.operations.approvedCron,
      ),
    },
    authenticity: privateManifest.authenticity,
    crypto: {
      format: "age",
      recipientFingerprint: sha256Text(ageRecipient),
    },
    archive: {
      file: path.basename(encryptedArchive.archivePath),
      sha256: encryptedArchive.sha256,
      size: encryptedArchive.size,
    },
    releaseEligible: false,
    restoreDrillVerified: false,
  };
}

async function captureGitState(repoRoot = REPO_ROOT) {
  const gitExecutable = await resolveExecutableFromPath("git");
  const statusResult = await runBoundedRedacted({
    executable: gitExecutable,
    args: ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd: repoRoot,
    captureStdout: true,
  });
  if (statusResult.stdoutBuffer.toString("utf8").trim()) {
    throw recoveryError("WORKTREE_NOT_CLEAN", "Recovery export requires a clean Git worktree.");
  }
  const headResult = await runBoundedRedacted({
    executable: gitExecutable,
    args: ["rev-parse", "HEAD"],
    cwd: repoRoot,
    captureStdout: true,
  });
  const head = headResult.stdoutBuffer.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw recoveryError("GIT_HEAD_INVALID", "Git HEAD is unavailable.");
  return { head };
}

async function exportRecovery(args, repoRoot = REPO_ROOT) {
  const expectedProjectRef = args["expected-project-ref"];
  if (!PROJECT_REF_RE.test(expectedProjectRef ?? "")) {
    throw recoveryError("SOURCE_PROJECT_REF_INVALID", "--expected-project-ref is required.");
  }
  const targets = await loadReleaseTargets(repoRoot);
  assertApprovedNonProductionSource(expectedProjectRef, targets);
  const gate = assertProductionExportAllowed({
    expectedProjectRef,
    targets,
    trafficDrained: args["traffic-drained"] === true,
    maintenanceStartedAt: args["maintenance-started-at"],
    writeFenceEvidenceSha256: args["write-fence-evidence-sha256"],
  });
  const authenticity = archiveAuthenticityDescriptor(gate.policy);
  const ageRecipient = ageRecipientFromArgs(args, gate.policy, gate.isProduction);
  const stagingRoot = assertSafeStagingRoot(args["staging-root"]);
  const outputRoot = assertSafeFinalOutputRoot(args["output-root"], repoRoot);
  const storageConcurrency = parseStorageConcurrency(
    args["max-storage-concurrency"] ?? gate.policy?.maxStorageConcurrency ?? 4,
  );
  const tools = await resolveRecoveryTools({
    isProduction: gate.isProduction,
    policy: gate.policy,
  });
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await assertLinkedProject(expectedProjectRef, repoRoot);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw recoveryError("SERVICE_ROLE_KEY_MISSING", "Storage export requires a service-role key in process environment.");
  }
  const binary = await resolvePinnedSupabaseBinary(repoRoot);
  await assertPinnedSupabaseVersion(binary);
  if (gate.policy?.requiredCliVersion && gate.policy.requiredCliVersion !== binary.version) {
    throw recoveryError("SUPABASE_CLI_POLICY_MISMATCH", "Pinned Supabase CLI version differs from backup policy.");
  }
  const git = await captureGitState(repoRoot);
  const artifactId = randomUUID();
  const startedAt = new Date().toISOString();
  const workspace = await createSecureWorkspace(stagingRoot);
  let encryptedArchive;
  try {
    const preInventory = await captureInventory(binary, repoRoot);
    const preObjects = await listStorageObjects(binary);
    const preCronContract = await queryApprovedCronContract(binary, repoRoot);
    const preDigest = stableInventoryDigest(preInventory, preObjects);
    const database = await dumpDatabase(binary, workspace, repoRoot);
    const storageObjects = await exportStorageObjects({
      objects: preObjects,
      projectRef: expectedProjectRef,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      workspace,
      concurrency: storageConcurrency,
    });
    assertStorageManifestCoverage(preObjects, storageObjects);
    const databaseSnapshotSha256 = await verifyIndependentDatabaseSnapshot(
      binary,
      workspace,
      database,
      repoRoot,
    );
    const postInventory = await captureInventory(binary, repoRoot);
    const postObjects = await listStorageObjects(binary);
    const postCronContract = await queryApprovedCronContract(binary, repoRoot);
    const postDigest = stableInventoryDigest(postInventory, postObjects);
    if (preDigest !== postDigest) {
      throw recoveryError("SOURCE_INVENTORY_DRIFT", "Source DB or Storage inventory changed during export.");
    }
    const cronContractSha256 = assertApprovedCronSnapshotsStable(
      preCronContract,
      postCronContract,
    );
    const approvedCron = await writeApprovedCronContractArtifact(
      preCronContract,
      workspace,
    );
    if (approvedCron.contractSha256 !== cronContractSha256) {
      throw recoveryError(
        "CRON_CONTRACT_DIGEST_MISMATCH",
        "Approved cron artifact digest does not match its stable source snapshot.",
      );
    }
    const totalBytes = storageObjects.reduce((sum, entry) => sum + entry.byteSize, 0);
    const privateManifest = {
      formatVersion: RECOVERY_FORMAT_VERSION,
      artifactId,
      source: {
        projectRef: expectedProjectRef,
        gitSha: git.head,
        supabaseCliVersion: binary.version,
        startedAt,
        completedAt: new Date().toISOString(),
      },
      consistency: {
        isProtectedProduction: gate.isProduction,
        trafficDrained: args["traffic-drained"] === true,
        maintenanceStartedAt: args["maintenance-started-at"] ?? null,
        writeFenceEvidenceSha256: args["write-fence-evidence-sha256"] ?? null,
        preInventorySha256: preDigest,
        postInventorySha256: postDigest,
        databaseSnapshotMethod: "independent-redump-v2-restrict-canonical",
        databaseSnapshotSha256,
        cronSnapshotMethod: "independent-exact-query-v1",
        cronContractSha256,
        stable: true,
      },
      database: {
        inventory: preInventory,
        files: database.artifacts,
        copyTableDigests: database.copyTableDigests,
      },
      storage: {
        bucketCount: Number(preInventory.storage?.bucketCount ?? 0),
        objects: storageObjects,
        totalBytes,
        metadataSha256: storageMetadataDigest(preObjects),
      },
      operations: { approvedCron },
      authenticity,
    };
    await writeFile(
      path.join(workspace, "manifest.private.json"),
      `${canonicalJson(privateManifest)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    encryptedArchive = await createEncryptedArchive({
      workspace,
      outputRoot,
      artifactId,
      ageRecipient,
      tools,
    });
    const publicManifest = publicManifestFromPrivate(privateManifest, encryptedArchive, ageRecipient);
    const partialManifest = path.join(outputRoot, `${artifactId}.manifest.json.partial`);
    const finalManifest = path.join(outputRoot, `${artifactId}.manifest.json`);
    await writeFile(partialManifest, `${canonicalJson(publicManifest)}\n`, { mode: 0o600, flag: "wx" });
    await rename(partialManifest, finalManifest);
    return {
      ok: true,
      artifactId,
      archive: encryptedArchive.archivePath,
      manifest: finalManifest,
      releaseEligible: false,
      restoreDrillVerified: false,
    };
  } catch (error) {
    if (encryptedArchive?.archivePath) await rm(encryptedArchive.archivePath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await removeRecoveryPathsVerified([
      { targetPath: `${workspace}-package`, recursive: true },
      { targetPath: workspace, recursive: true },
    ]);
  }
}

function assertArchiveCronEvidence(archiveEvidence) {
  if (
    archiveEvidence?.cronContractVerified !== true
    || archiveEvidence.cronContractVersion !== APPROVED_CRON_CONTRACT_VERSION
    || archiveEvidence.cronContractSha256 !== approvedCronContractSha256()
    || archiveEvidence.cronJobCount !== APPROVED_CRON_CONTRACT.jobs.length
    || archiveEvidence.cronReplayStrategy !== CRON_REPLAY_STRATEGY
    || archiveEvidence.cronReplaySqlSha256 !== approvedCronReplaySqlSha256()
    || archiveEvidence.cronPreActivationLauncherState !== "off"
    || archiveEvidence.cronPostActivationLauncherState !== "on"
    || archiveEvidence.cronPreActivationRunningJobCount !== 0
    || archiveEvidence.cronReplayedJobsActive !== false
    || archiveEvidence.cronTargetDatabaseBinding !== "current_database"
    || archiveEvidence.cronSchedulerRole !== APPROVED_CRON_SCHEDULER_ROLE
    || archiveEvidence.cronTimezone !== APPROVED_CRON_TIMEZONE
    || archiveEvidence.cronReplayRequired !== true
    || archiveEvidence.postDeployRecheckRequired !== true
    || archiveEvidence.cronActivationStrategy !== CRON_ACTIVATION_STRATEGY
    || archiveEvidence.cronActivationSqlSha256 !== approvedCronActivationSqlSha256()
    || archiveEvidence.cronActivationRequired !== true
    || archiveEvidence.cronActivationAfterParityRequired !== true
    || archiveEvidence.postActivationRecheckRequired !== true
  ) {
    throw recoveryError(
      "ARCHIVE_CRON_CONTRACT_UNVERIFIED",
      "Restore planning requires a verified five-job cron artifact and mandatory replay/recheck contract.",
    );
  }
  return archiveEvidence;
}

function assertArchiveAuthenticityForRestore(targets, archiveEvidence) {
  const policy = targets.backupPolicy?.archiveAuthenticity;
  if (
    policy?.contract !== ARCHIVE_AUTHENTICITY_CONTRACT
    || policy?.status !== "verified-v1"
    || typeof policy.senderSigningKeyRef !== "string"
    || !policy.senderSigningKeyRef
    || typeof policy.externalImmutableAnchorRef !== "string"
    || !policy.externalImmutableAnchorRef
    || archiveEvidence?.archiveAuthenticityVerified !== true
    || archiveEvidence.senderSignatureVerified !== true
    || archiveEvidence.externalImmutableAnchorVerified !== true
  ) {
    throw recoveryError(
      "ARCHIVE_AUTHENTICITY_UNVERIFIED",
      "Restore is blocked until an approved sender signature and external immutable anchor are independently verified.",
    );
  }
}

export function buildRestorePlan(archiveEvidence) {
  assertArchiveCronEvidence(archiveEvidence);
  return {
    contract: "isolated-db-storage-cron-restore-v1",
    artifactId: archiveEvidence.artifactId ?? null,
    cron: {
      contractVersion: archiveEvidence.cronContractVersion,
      contractSha256: archiveEvidence.cronContractSha256,
      jobCount: archiveEvidence.cronJobCount,
      replayStrategy: archiveEvidence.cronReplayStrategy,
      replaySqlSha256: archiveEvidence.cronReplaySqlSha256,
      preActivationLauncherState:
        archiveEvidence.cronPreActivationLauncherState,
      postActivationLauncherState:
        archiveEvidence.cronPostActivationLauncherState,
      preActivationRunningJobCount:
        archiveEvidence.cronPreActivationRunningJobCount,
      replayedJobsActive: archiveEvidence.cronReplayedJobsActive,
      targetDatabaseBinding: archiveEvidence.cronTargetDatabaseBinding,
      schedulerRole: archiveEvidence.cronSchedulerRole,
      timezone: archiveEvidence.cronTimezone,
      activationStrategy: archiveEvidence.cronActivationStrategy,
      activationSqlSha256: archiveEvidence.cronActivationSqlSha256,
      activationRequired: archiveEvidence.cronActivationRequired,
    },
    requiredSequence: [
      "set-cron-launcher-off-and-drain",
      "restore-database-and-migration-ledger",
      "restore-storage-metadata-and-bytes",
      "replay-approved-cron-contract-inactive",
      "run-exact-post-deploy-contract-with-crons-inactive",
      "verify-database-storage-parity-and-rto",
      "activate-approved-crons-after-bound-evidence",
      "run-exact-post-activation-contract",
    ],
    restored: false,
    releaseEligible: false,
  };
}

export function assertRestoreCompletionEvidence({
  restoreIdentity,
  archiveEvidence,
  databaseRestoreEvidence,
  storageRestoreEvidence,
  cronReplayEvidence,
  postDeployEvidence,
  parityEvidence,
  rtoEvidence,
}) {
  const identity = assertRestoreEvidenceIdentity(restoreIdentity);
  const archiveBoundIdentity = createRestoreEvidenceIdentity({
    archiveEvidence,
    restoreAttemptId: identity.restoreAttemptId,
    sourceProjectRef: identity.sourceProjectRef,
    targetProjectRef: identity.targetProjectRef,
    targetDatabase: identity.targetDatabase,
    restoreStartedAt: identity.restoreStartedAt,
  });
  if (canonicalJson(identity) !== canonicalJson(archiveBoundIdentity)) {
    throw recoveryError(
      "RESTORE_EVIDENCE_IDENTITY_MISMATCH",
      "Restore identity does not match the verified archive and selected target.",
    );
  }
  const plan = buildRestorePlan(archiveEvidence);
  const databaseBoundEvidence = assertBoundRestoreEvidence({
    evidence: databaseRestoreEvidence,
    identity,
    kind: "database-restore",
    previousEvidenceSha256: identity.identitySha256,
  });
  const storageBoundEvidence = assertBoundRestoreEvidence({
    evidence: storageRestoreEvidence,
    identity,
    kind: "storage-restore",
    previousEvidenceSha256: databaseBoundEvidence.evidenceSha256,
  });
  const cronBoundEvidence = assertBoundRestoreEvidence({
    evidence: cronReplayEvidence,
    identity,
    kind: "cron-inactive-replay",
    previousEvidenceSha256: storageBoundEvidence.evidenceSha256,
  });
  const postDeployBoundEvidence = assertBoundRestoreEvidence({
    evidence: postDeployEvidence,
    identity,
    kind: "post-deploy-inactive-contract",
    previousEvidenceSha256: cronBoundEvidence.evidenceSha256,
  });
  const parityBoundEvidence = assertBoundRestoreEvidence({
    evidence: parityEvidence,
    identity,
    kind: "database-storage-parity",
    previousEvidenceSha256: postDeployBoundEvidence.evidenceSha256,
  });
  const rtoBoundEvidence = assertBoundRestoreEvidence({
    evidence: rtoEvidence,
    identity,
    kind: "rto-measurement",
    previousEvidenceSha256: parityBoundEvidence.evidenceSha256,
  });
  const databaseRestorePayload = databaseBoundEvidence.payload;
  const storageRestorePayload = storageBoundEvidence.payload;
  const cronReplayPayload = cronBoundEvidence.payload;
  const postDeployPayload = postDeployBoundEvidence.payload;
  const parityPayload = parityBoundEvidence.payload;
  const rtoPayload = rtoBoundEvidence.payload;
  const restoreStartedAt = exactIsoTimestamp(identity.restoreStartedAt);
  const databaseRestoredAt = exactIsoTimestamp(databaseRestorePayload?.restoredAt);
  const storageRestoredAt = exactIsoTimestamp(storageRestorePayload?.restoredAt);
  if (
    archiveEvidence.archiveIntegrityVerified !== true
    || archiveEvidence.archiveAuthenticityVerified !== true
    || archiveEvidence.senderSignatureVerified !== true
    || archiveEvidence.externalImmutableAnchorVerified !== true
    || databaseRestorePayload?.ok !== true
    || databaseRestorePayload.databaseSnapshotSha256 !== identity.databaseSnapshotSha256
    || databaseRestoredAt === null
    || databaseRestoredAt < restoreStartedAt
    || storageRestorePayload?.ok !== true
    || storageRestorePayload.storageMetadataSha256 !== identity.storageMetadataSha256
    || storageRestorePayload.storageObjectCount !== identity.storageObjectCount
    || storageRestorePayload.storageTotalBytes !== identity.storageTotalBytes
    || storageRestoredAt === null
    || storageRestoredAt < databaseRestoredAt
  ) {
    throw recoveryError(
      "RESTORE_COMPLETION_EVIDENCE_INCOMPLETE",
      "Database, Storage, integrity, and archive-authenticity evidence are all required before restored status.",
    );
  }
  const replayedAt = exactIsoTimestamp(cronReplayPayload?.replayedAt);
  if (
    cronReplayPayload?.ok !== true
    || cronReplayPayload.contractSha256 !== plan.cron.contractSha256
    || cronReplayPayload.jobCount !== plan.cron.jobCount
    || cronReplayPayload.replaySqlSha256 !== plan.cron.replaySqlSha256
    || cronReplayPayload.launcherState !== plan.cron.preActivationLauncherState
    || cronReplayPayload.runningJobCount !== plan.cron.preActivationRunningJobCount
    || cronReplayPayload.jobsActive !== plan.cron.replayedJobsActive
    || cronReplayPayload.targetDatabase !== identity.targetDatabase
    || cronReplayPayload.schedulerRole !== plan.cron.schedulerRole
    || cronReplayPayload.timezone !== plan.cron.timezone
    || replayedAt === null
    || replayedAt < storageRestoredAt
  ) {
    throw recoveryError(
      "CRON_REPLAY_EVIDENCE_MISSING",
      "The approved cron contract must be replayed exactly before restored status.",
    );
  }
  const postDeployCheckedAt = exactIsoTimestamp(postDeployPayload?.checkedAt);
  if (
    postDeployPayload?.ok !== true
    || postDeployPayload.allNonCronContractsExact !== true
    || postDeployPayload.allMaintenanceCronDefinitionsExact !== true
    || postDeployPayload.allMaintenanceCronsInactiveExact !== true
    || postDeployPayload.cronContractSha256 !== plan.cron.contractSha256
    || postDeployPayload.launcherState !== "off"
    || postDeployPayload.runningJobCount !== 0
    || postDeployCheckedAt === null
    || postDeployCheckedAt < replayedAt
  ) {
    throw recoveryError(
      "POST_RESTORE_CONTRACT_RECHECK_FAILED",
      "An exact post-deploy contract recheck after cron replay is required before restored status.",
    );
  }
  const parityCheckedAt = exactIsoTimestamp(parityPayload?.checkedAt);
  const rtoMeasuredAt = exactIsoTimestamp(rtoPayload?.measuredAt);
  const rtoStartedAt = exactIsoTimestamp(rtoPayload?.restoreStartedAt);
  const rtoCompletedAt = exactIsoTimestamp(rtoPayload?.restoreCompletedAt);
  const measuredRtoSeconds = rtoStartedAt === null || rtoCompletedAt === null
    ? null
    : (rtoCompletedAt - rtoStartedAt) / 1000;
  if (
    parityPayload?.ok !== true
    || parityPayload.databaseSnapshotSha256 !== identity.databaseSnapshotSha256
    || parityPayload.storageMetadataSha256 !== identity.storageMetadataSha256
    || parityPayload.storageObjectCount !== identity.storageObjectCount
    || parityPayload.storageTotalBytes !== identity.storageTotalBytes
    || parityCheckedAt === null
    || parityCheckedAt < postDeployCheckedAt
    || rtoPayload?.ok !== true
    || rtoPayload.restoreStartedAt !== identity.restoreStartedAt
    || rtoMeasuredAt === null
    || rtoCompletedAt === null
    || rtoCompletedAt < parityCheckedAt
    || rtoMeasuredAt < rtoCompletedAt
    || !Number.isFinite(rtoPayload.rtoSeconds)
    || rtoPayload.rtoSeconds < 0
    || rtoPayload.rtoSeconds !== measuredRtoSeconds
  ) {
    throw recoveryError(
      "RESTORE_COMPLETION_EVIDENCE_INCOMPLETE",
      "Database/Storage parity and measured RTO evidence are required before restored status.",
    );
  }
  throw recoveryError(
    "RESTORE_COMPLETION_ATTESTATION_NOT_ENABLED",
    "All modeled evidence is present, but no implemented restore runner may attest restored status yet.",
  );
}

export async function restoreVerifyReadiness({
  sourceProjectRef,
  targetProjectRef,
  targets,
  archiveVerifier,
}) {
  assertRestoreTargetAllowed({ sourceProjectRef, targetProjectRef, targets });
  const archiveEvidence = await archiveVerifier();
  if (
    archiveEvidence?.ok !== true
    || archiveEvidence.archiveIntegrityVerified !== true
  ) {
    throw recoveryError(
      "ARCHIVE_VERIFICATION_FAILED",
      "Archive verification did not produce successful evidence.",
    );
  }
  buildRestorePlan(archiveEvidence);
  assertArchiveAuthenticityForRestore(targets, archiveEvidence);
  throw recoveryError(
    "RESTORE_EXECUTION_NOT_ENABLED",
    "Archive integrity, authenticity, and cron planning passed, but DB/Storage restore execution remains intentionally disabled.",
  );
}

function parseCliArgs(argv) {
  const [command, ...tokens] = argv;
  if (!command) throw recoveryError("COMMAND_REQUIRED", "Expected export, verify-archive, or restore-verify.");
  const args = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw recoveryError("ARGUMENT_INVALID", "Recovery arguments must use --name syntax.");
    const equalsIndex = token.indexOf("=");
    if (equalsIndex > 2) {
      args[token.slice(2, equalsIndex)] = token.slice(equalsIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

async function main(argv = process.argv.slice(2)) {
  const { command, args } = parseCliArgs(argv);
  if (command === "export") return exportRecovery(args);
  if (command === "verify-archive") {
    return verifyArchive({
      archivePath: args.archive,
      publicManifestPath: args.manifest,
      identityFile: args["identity-file"],
      stagingRoot: args["staging-root"],
      expectedSourceProjectRef: args["expected-project-ref"],
    });
  }
  if (command === "restore-verify") {
    const expectedSourceProjectRef = args["expected-project-ref"];
    if (!PROJECT_REF_RE.test(expectedSourceProjectRef ?? "")) {
      throw recoveryError(
        "SOURCE_PROJECT_REF_INVALID",
        "restore-verify requires an explicit --expected-project-ref.",
      );
    }
    const targets = await loadReleaseTargets();
    return restoreVerifyReadiness({
      sourceProjectRef: expectedSourceProjectRef,
      targetProjectRef: args["target-project-ref"],
      targets,
      archiveVerifier: () => verifyArchive({
        archivePath: args.archive,
        publicManifestPath: args.manifest,
        identityFile: args["identity-file"],
        stagingRoot: args["staging-root"],
        expectedSourceProjectRef,
      }),
    });
  }
  throw recoveryError("COMMAND_INVALID", "Expected export, verify-archive, or restore-verify.");
}

const directRun = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (directRun) {
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      const code = error instanceof RecoveryError ? error.code : "RECOVERY_UNEXPECTED_ERROR";
      const message = error instanceof RecoveryError
        ? redactSecrets(error.message)
        : "Recovery command failed unexpectedly.";
      console.error(JSON.stringify({ ok: false, code, message }));
      process.exitCode = 1;
    });
}
