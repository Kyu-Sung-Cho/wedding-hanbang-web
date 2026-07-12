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
const AGE_RECIPIENT_RE = /^age1[0-9a-z]{20,}$/;
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STORAGE_CONCURRENCY = 8;
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
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref?.();

  let exit;
  try {
    exit = await exitPromise;
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
      sha256: artifact.sha256.toLowerCase(),
      size: artifact.size,
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
 * across two independent captures. Row counts alone cannot detect an UPDATE
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
  const blobMap = new Map();
  for (const entry of privateManifest.storage?.objects ?? []) {
    if (!blobMap.has(entry.blob)) {
      blobMap.set(entry.blob, { path: entry.blob, sha256: entry.byteSha256, size: entry.byteSize });
    }
  }
  return [...databaseFiles, ...blobMap.values()];
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

  const consistency = privateManifest.consistency;
  const boundDatabaseSnapshotSha256 = sha256Text(canonicalJson(
    databaseSnapshotProjection({
      artifacts: databaseFiles,
      copyTableDigests,
    }),
  ));
  if (
    consistency?.stable !== true
    || consistency.databaseSnapshotMethod !== "independent-redump-v1"
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
  if (
    privateManifest.formatVersion !== 1 ||
    publicManifest.formatVersion !== 1 ||
    privateManifest.artifactId !== publicManifest.artifactId ||
    canonicalJson(privateManifest.source) !== canonicalJson(publicManifest.source) ||
    canonicalJson(privateManifest.consistency) !==
      canonicalJson(publicManifest.consistency) ||
    canonicalJson(expectedDatabase) !== canonicalJson(publicManifest.database) ||
    canonicalJson(expectedStorage) !== canonicalJson(publicManifest.storage) ||
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
  if (publicManifest.formatVersion !== 1 || !publicManifest.archive?.sha256) {
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
      expectedSourceProjectRef &&
      privateManifest.source?.projectRef !== expectedSourceProjectRef
    ) {
      throw recoveryError(
        "ARCHIVE_SOURCE_MISMATCH",
        "Encrypted recovery source project does not match expectation.",
      );
    }
    for (const entry of privateManifestFileEntries(privateManifest)) {
      if (!validateTarEntry(entry.path)) {
        throw recoveryError("PRIVATE_MANIFEST_PATH_INVALID", "Private manifest contains an unsafe artifact path.");
      }
      const digest = await sha256File(path.join(extractDirectory, ...entry.path.split("/")));
      if (digest.sha256 !== entry.sha256 || digest.size !== entry.size) {
        throw recoveryError("PRIVATE_ARTIFACT_DIGEST_MISMATCH", "Decrypted recovery artifact failed checksum verification.");
      }
    }
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
    return {
      ok: true,
      artifactId: publicManifest.artifactId,
      sourceProjectRef: privateManifest.source.projectRef,
      databaseFileCount: privateManifest.database.files.length,
      storageObjectCount: privateManifest.storage.objects.length,
      storageTotalBytes: privateManifest.storage.totalBytes,
      archiveSha256: archiveDigest.sha256,
    };
  } finally {
    await removeRecoveryPathVerified(workspace, { recursive: true });
  }
}

function publicManifestFromPrivate(privateManifest, encryptedArchive, ageRecipient) {
  return {
    formatVersion: 1,
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
    const postDigest = stableInventoryDigest(postInventory, postObjects);
    if (preDigest !== postDigest) {
      throw recoveryError("SOURCE_INVENTORY_DRIFT", "Source DB or Storage inventory changed during export.");
    }
    const totalBytes = storageObjects.reduce((sum, entry) => sum + entry.byteSize, 0);
    const privateManifest = {
      formatVersion: 1,
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
        databaseSnapshotMethod: "independent-redump-v1",
        databaseSnapshotSha256,
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

export async function restoreVerifyReadiness({
  sourceProjectRef,
  targetProjectRef,
  targets,
  archiveVerifier,
}) {
  assertRestoreTargetAllowed({ sourceProjectRef, targetProjectRef, targets });
  const archiveEvidence = await archiveVerifier();
  if (archiveEvidence?.ok !== true) {
    throw recoveryError(
      "ARCHIVE_VERIFICATION_FAILED",
      "Archive verification did not produce successful evidence.",
    );
  }
  return {
    ok: true,
    phase: "phase-a-scaffold",
    sourceProjectRef,
    targetProjectRef,
    archiveVerified: true,
    databaseRestored: false,
    storageRestored: false,
    parityVerified: false,
    rtoVerified: false,
    releaseEligible: false,
    status: "archive_verified_restore_execution_not_enabled",
  };
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
