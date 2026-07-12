import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const bootstrapScript = realpathSync(path.join(scriptDirectory, "invoke-reviewed-powershell.ps1"));
const allowedScripts = new Set([
  "supabase-reconcile-core-baseline.ps1",
  "supabase-ship-safe.ps1",
  "supabase-write-fence.ps1",
]);
const REVIEWED_SCRIPT_SHA256 = Object.freeze({
  "supabase-reconcile-core-baseline.ps1":
    "90f31ef652fa543959c4a2ccf8b6c076cffc5c7f2a2b80c76aeaa10e5fe5d109",
  "supabase-ship-safe.ps1":
    "be94f2d14ee844c6057ee9d905c96a746cf6bfdca89a0c54a668ac88ad697a72",
  "supabase-write-fence.ps1":
    "edc4b04b59eb75c6f69897c1f5e64bf485d64f26f6f73e3e073210487db398fa",
});
const REVIEWED_BOOTSTRAP_SHA256 =
  "c663eee70d6457b4456146dd3697d7e59f6069fa331150f5e3c84a034f610176";
const REVIEWED_COMPANION_SHA256 = Object.freeze({
  "scripts/release-targets.json":
    "a3770c8714fc0bf8411cd613d7ad38990121893ab31952560dda13935a339cd0",
  "scripts/sql/supabase-write-fence-status.sql":
    "935d612ee6ca5b4ddfa190468ac28c6ad63af1ddff8df407ab8f6d14c999a743",
});
const repositoryRoot = realpathSync(path.join(scriptDirectory, ".."));

const COPIED_CHILD_ENV_KEYS = Object.freeze([
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "USERNAME",
  "USERDOMAIN",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "XDG_STATE_HOME",
]);

const WINDOWS_ROOT = "C:\\Windows";
const WINDOWS_SYSTEM32 = path.join(WINDOWS_ROOT, "System32");
const WINDOWS_POWERSHELL = path.join(
  WINDOWS_SYSTEM32,
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const WINDOWS_COMSPEC = path.join(WINDOWS_SYSTEM32, "cmd.exe");
const WINDOWS_SYSTEM_MODULES = path.join(
  WINDOWS_SYSTEM32,
  "WindowsPowerShell",
  "v1.0",
  "Modules",
);
const WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const REVIEWED_WINDOWS_SYSTEM_EXECUTABLES = new Set([
  "cmd.exe",
  "icacls.exe",
  "taskkill.exe",
]);

function existingRealDirectory(candidate, { requireSystemOwned = false } = {}) {
  try {
    const resolved = realpathSync(candidate);
    const stats = statSync(resolved);
    if (!stats.isDirectory()) return null;
    if (
      requireSystemOwned
      && process.platform !== "win32"
      && (stats.uid !== 0 || (stats.mode & 0o022) !== 0)
    ) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function uniquePaths(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry) return false;
    const key = process.platform === "win32" ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildTrustedToolPath() {
  const nodeDirectory = existingRealDirectory(path.dirname(realpathSync(process.execPath)));
  const fixedCandidates = process.platform === "win32"
    ? [
      nodeDirectory,
      existingRealDirectory("C:\\Program Files\\Git\\cmd"),
      existingRealDirectory(WINDOWS_SYSTEM32),
      existingRealDirectory(WINDOWS_ROOT),
      existingRealDirectory(path.join(WINDOWS_SYSTEM32, "Wbem")),
    ]
    : [
      nodeDirectory,
      existingRealDirectory("/usr/bin", { requireSystemOwned: true }),
      existingRealDirectory("/bin", { requireSystemOwned: true }),
    ];
  return uniquePaths(fixedCandidates).join(path.delimiter);
}

export function buildReviewedChildEnv(source = process.env) {
  const child = {};
  for (const key of COPIED_CHILD_ENV_KEYS) {
    if (typeof source[key] === "string" && source[key] !== "") {
      child[key] = source[key];
    }
  }
  if (process.platform === "win32") {
    const windowsRoot = realpathSync(WINDOWS_ROOT);
    child.SystemRoot = windowsRoot;
    child.WINDIR = windowsRoot;
    child.COMSPEC = realpathSync(WINDOWS_COMSPEC);
    child.PATHEXT = WINDOWS_PATHEXT;
    child.PSModulePath = realpathSync(WINDOWS_SYSTEM_MODULES);
  }
  child.PATH = buildTrustedToolPath();
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  child.GIT_CONFIG_NOSYSTEM = "1";
  child.GIT_ATTR_NOSYSTEM = "1";
  child.GIT_CONFIG_GLOBAL = nullDevice;
  child.GIT_CONFIG_COUNT = "3";
  child.GIT_CONFIG_KEY_0 = "core.fsmonitor";
  child.GIT_CONFIG_VALUE_0 = "false";
  child.GIT_CONFIG_KEY_1 = "core.hooksPath";
  child.GIT_CONFIG_VALUE_1 = nullDevice;
  child.GIT_CONFIG_KEY_2 = "core.attributesFile";
  child.GIT_CONFIG_VALUE_2 = nullDevice;
  child.GIT_TERMINAL_PROMPT = "0";
  child.SUPABASE_TELEMETRY_DISABLED = "1";
  return child;
}

export function resolvePowerShellExecutable() {
  if (process.platform === "win32") {
    if (!existsSync(WINDOWS_POWERSHELL)) {
      throw new Error("The fixed reviewed Windows PowerShell runtime is unavailable.");
    }
    return realpathSync(WINDOWS_POWERSHELL);
  }
  throw new Error(
    "Reviewed release PowerShell execution is disabled outside the approved Windows workstation boundary.",
  );
}

export function resolveWindowsSystemExecutable(name) {
  const normalized = typeof name === "string" ? name.toLowerCase() : "";
  if (
    process.platform !== "win32"
    || !REVIEWED_WINDOWS_SYSTEM_EXECUTABLES.has(normalized)
    || path.basename(normalized) !== normalized
  ) {
    throw new Error("The requested Windows system executable is not reviewed.");
  }
  const candidate = path.join(WINDOWS_SYSTEM32, normalized);
  if (!existsSync(candidate)) {
    throw new Error("The reviewed Windows system executable is unavailable.");
  }
  return realpathSync(candidate);
}

export function pathsEqual(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function assertReviewedScriptDigest(name, bytes) {
  const normalized = process.platform === "win32" ? name.toLowerCase() : name;
  const expected = REVIEWED_SCRIPT_SHA256[normalized];
  if (!expected || !Buffer.isBuffer(bytes)) {
    throw new Error("The reviewed PowerShell digest trust root is unavailable.");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error("The reviewed PowerShell entrypoint differs from its trusted digest.");
  }
  return expected;
}

export function assertReviewedBootstrapDigest(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error("The reviewed PowerShell bootstrap trust root is unavailable.");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== REVIEWED_BOOTSTRAP_SHA256) {
    throw new Error("The reviewed PowerShell bootstrap differs from its trusted digest.");
  }
  return REVIEWED_BOOTSTRAP_SHA256;
}

export function assertReviewedCompanionDigest(relativePath, bytes) {
  const expected = REVIEWED_COMPANION_SHA256[relativePath];
  if (!expected || !Buffer.isBuffer(bytes)) {
    throw new Error("The reviewed PowerShell companion digest trust root is unavailable.");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error("A reviewed PowerShell companion differs from its trusted digest.");
  }
  return expected;
}

function readReviewedCompanion(relativePath) {
  const expectedPath = path.join(repositoryRoot, ...relativePath.split("/"));
  const resolved = realpathSync(expectedPath);
  if (!pathsEqual(resolved, expectedPath)) {
    throw new Error("A reviewed PowerShell companion must not traverse a redirect.");
  }
  const bytes = readFileSync(resolved);
  assertReviewedCompanionDigest(relativePath, bytes);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (source.includes("\0")) {
    throw new Error("A reviewed PowerShell companion is not valid text.");
  }
  return source;
}

export function main(argv = process.argv.slice(2)) {
  const requested = argv[0] ?? "";
  const basename = path.basename(requested);
  const allowlistName = process.platform === "win32" ? basename.toLowerCase() : basename;
  if (!allowedScripts.has(allowlistName)) {
    console.error("Only reviewed Supabase PowerShell entrypoints may use this launcher.");
    return 2;
  }

  let resolved;
  try {
    resolved = realpathSync(path.resolve(process.cwd(), requested));
  } catch {
    console.error("The reviewed PowerShell entrypoint does not exist.");
    return 2;
  }
  if (!pathsEqual(path.dirname(resolved), scriptDirectory)) {
    console.error("The PowerShell entrypoint must remain inside the repository scripts directory.");
    return 2;
  }
  let expectedScriptSha256;
  try {
    expectedScriptSha256 = assertReviewedScriptDigest(
      allowlistName,
      readFileSync(resolved),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The reviewed PowerShell digest check failed.");
    return 2;
  }

  let reviewedReleaseTargetsJson;
  let reviewedFenceStatusSql;
  try {
    reviewedReleaseTargetsJson = readReviewedCompanion(
      "scripts/release-targets.json",
    );
    reviewedFenceStatusSql = readReviewedCompanion(
      "scripts/sql/supabase-write-fence-status.sql",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The reviewed PowerShell companion check failed.");
    return 2;
  }

  let executable;
  try {
    executable = resolvePowerShellExecutable();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The required PowerShell runtime is unavailable.");
    return 1;
  }
  let reviewedBootstrapSource;
  try {
    const bootstrapBytes = readFileSync(bootstrapScript);
    assertReviewedBootstrapDigest(bootstrapBytes);
    reviewedBootstrapSource = bootstrapBytes.toString("utf8");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The reviewed PowerShell bootstrap check failed.");
    return 2;
  }
  const forwarded = argv.slice(1);
  if (forwarded[0] === "--") forwarded.shift();
  const forwardedArgumentsBase64 = Buffer.from(
    JSON.stringify(forwarded),
    "utf8",
  ).toString("base64");
  const reviewedEnvelopeBase64 = Buffer.from(
    JSON.stringify({
      reviewedScript: resolved,
      reviewedDirectory: scriptDirectory,
      expectedScriptSha256,
      forwardedArgumentsBase64,
      reviewedReleaseTargetsJson,
      reviewedFenceStatusSql,
    }),
    "utf8",
  ).toString("base64");
  const prefix = [
    "-NoLogo",
    "-NoProfile",
    "-OutputFormat",
    "Text",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    reviewedBootstrapSource,
  ];
  const childEnv = buildReviewedChildEnv();
  childEnv.HANBANG_REVIEWED_ENVELOPE_BASE64 = reviewedEnvelopeBase64;
  const result = spawnSync(executable, prefix, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    console.error(`Unable to start the required PowerShell runtime: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const directRun = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (directRun) process.exit(main());
