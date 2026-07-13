import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReviewedBootstrapDigest,
  assertReviewedCompanionDigest,
  assertReviewedScriptDigest,
  buildReviewedChildEnv,
  main,
  pathsEqual,
  resolvePowerShellExecutable,
  resolveWindowsSystemExecutable,
} from "./run-reviewed-powershell.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcherPath = path.join(repoRoot, "scripts", "run-reviewed-powershell.mjs");
const launcherSource = readFileSync(launcherPath, "utf8");
const bootstrapSource = readFileSync(
  path.join(repoRoot, "scripts", "invoke-reviewed-powershell.ps1"),
  "utf8",
);

test("reviewed PowerShell digests reject one-byte entrypoint and bootstrap changes", () => {
  for (const scriptName of [
    "supabase-reconcile-core-baseline.ps1",
    "supabase-ship-safe.ps1",
    "supabase-write-fence.ps1",
  ]) {
    const scriptBytes = readFileSync(path.join(repoRoot, "scripts", scriptName));
    assert.match(assertReviewedScriptDigest(scriptName, scriptBytes), /^[0-9a-f]{64}$/);
    const changedScript = Buffer.from(scriptBytes);
    changedScript[changedScript.length - 1] ^= 1;
    assert.throws(() => assertReviewedScriptDigest(scriptName, changedScript));
  }
  const bootstrapBytes = readFileSync(
    path.join(repoRoot, "scripts", "invoke-reviewed-powershell.ps1"),
  );
  assert.match(assertReviewedBootstrapDigest(bootstrapBytes), /^[0-9a-f]{64}$/);
  const changedBootstrap = Buffer.from(bootstrapBytes);
  changedBootstrap[changedBootstrap.length - 1] ^= 1;
  assert.throws(() => assertReviewedBootstrapDigest(changedBootstrap));
  for (const relativePath of [
    "scripts/release-targets.json",
    "scripts/sql/supabase-write-fence-status.sql",
  ]) {
    const companionBytes = readFileSync(path.join(repoRoot, ...relativePath.split("/")));
    assert.match(
      assertReviewedCompanionDigest(relativePath, companionBytes),
      /^[0-9a-f]{64}$/,
    );
    const changedCompanion = Buffer.from(companionBytes);
    changedCompanion[changedCompanion.length - 1] ^= 1;
    assert.throws(() => assertReviewedCompanionDigest(relativePath, changedCompanion));
  }
  assert.match(launcherSource, /"-Command",\s*reviewedBootstrapSource/);
  assert.doesNotMatch(launcherSource, /"-File",\s*bootstrapScript/);
});

test("reviewed PowerShell launcher exposes only required release environment", () => {
  const child = buildReviewedChildEnv({
    SystemRoot: "C:\\attacker-controlled-windows",
    WINDIR: "C:\\attacker-controlled-windows",
    COMSPEC: "C:\\malicious-cmd.exe",
    PATHEXT: ".JS",
    PATH: "C:\\malicious-bin",
    SUPABASE_ACCESS_TOKEN: "must-not-cross-boundary",
    SUPABASE_DB_PASSWORD: "database-password",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    OPENAI_API_KEY: "must-not-cross-boundary",
    RESEND_API_KEY: "must-not-cross-boundary",
    GITHUB_TOKEN: "must-not-cross-boundary",
    NODE_OPTIONS: "--require malicious.js",
    NODE_PATH: "C:\\malicious-modules",
    SUPABASE_CLI_BINARY_OVERRIDE: "C:\\malicious.exe",
    SUPABASE_GO_BINARY: "C:\\malicious-go.exe",
    HTTP_PROXY: "http://attacker.invalid:8080",
    HTTPS_PROXY: "http://attacker.invalid:8080",
    NODE_EXTRA_CA_CERTS: "C:\\attacker-ca.pem",
    SSL_CERT_FILE: "C:\\attacker-ca.pem",
    COREPACK_HOME: "C:\\attacker-corepack",
    PNPM_HOME: "C:\\attacker-pnpm",
    PSModulePath: "C:\\Users\\attacker\\Documents\\WindowsPowerShell\\Modules",
    SUPABASE_PROFILE: "attacker-profile",
    SUPABASE_HOME: "C:\\attacker-supabase",
    DOCKER_HOST: "tcp://attacker.invalid:2376",
    GIT_CONFIG_NOSYSTEM: "0",
    GIT_CONFIG_GLOBAL: "C:\\attacker.gitconfig",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "node attacker.js",
    LD_PRELOAD: "/tmp/malicious.so",
    DYLD_INSERT_LIBRARIES: "/tmp/malicious.dylib",
  });

  assert.equal(child.SUPABASE_TELEMETRY_DISABLED, "1");
  assert.equal(child.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(child.GIT_CONFIG_COUNT, "3");
  assert.equal(child.GIT_CONFIG_KEY_0, "core.fsmonitor");
  assert.equal(child.GIT_CONFIG_VALUE_0, "false");
  assert.equal(child.GIT_TERMINAL_PROMPT, "0");
  assert.notEqual(child.PATH, "C:\\malicious-bin");
  assert.ok(
    child.PATH
      .split(path.delimiter)
      .includes(path.dirname(realpathSync(process.execPath))),
  );
  for (const key of [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "OPENAI_API_KEY",
    "RESEND_API_KEY",
    "GITHUB_TOKEN",
    "NODE_OPTIONS",
    "NODE_PATH",
    "SUPABASE_CLI_BINARY_OVERRIDE",
    "SUPABASE_GO_BINARY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "COREPACK_HOME",
    "PNPM_HOME",
    "SUPABASE_PROFILE",
    "SUPABASE_HOME",
    "DOCKER_HOST",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
  ]) {
    assert.equal(child[key], undefined, `${key} must not cross the reviewed boundary`);
  }

  if (process.platform === "win32") {
    assert.equal(child.SystemRoot.toLowerCase(), "c:\\windows");
    assert.equal(child.WINDIR.toLowerCase(), "c:\\windows");
    assert.match(child.COMSPEC, /\\windows\\system32\\cmd\.exe$/i);
    assert.equal(child.PATHEXT, ".COM;.EXE;.BAT;.CMD");
    assert.match(
      child.PSModulePath,
      /\\windows\\system32\\windowspowershell\\v1\.0\\modules$/i,
    );
    assert.match(resolvePowerShellExecutable(), /\\windows\\system32\\windowspowershell\\v1\.0\\powershell\.exe$/i);
  }
});

test("reviewed Windows PowerShell exposes only the fixed system module directory", {
  skip: process.platform !== "win32",
}, () => {
  assert.match(bootstrapSource, /\$global:PSModuleAutoLoadingPreference = "None"/);
  assert.match(bootstrapSource, /Import-Module -Name \$manifest -Force/);
  assert.match(bootstrapSource, /\$ExpectedScriptSha256/);
  assert.match(bootstrapSource, /ComputeHash\(\$reviewedBytes\)/);
  assert.match(bootstrapSource, /\[ScriptBlock\]::Create\(\$reviewedSource\)/);
  assert.doesNotMatch(bootstrapSource, /& \$resolvedScript/);

  const hostileRoot = mkdtempSync(path.join(tmpdir(), "hanbang-shadow-module-"));
  const moduleDirectory = path.join(hostileRoot, "Microsoft.PowerShell.Utility");
  const marker = path.join(hostileRoot, "shadow-module-imported");
  mkdirSync(moduleDirectory, { recursive: true });
  writeFileSync(
    path.join(moduleDirectory, "Microsoft.PowerShell.Utility.psm1"),
    `Set-Content -LiteralPath ${JSON.stringify(marker)} -Value imported\n`,
    { encoding: "utf8", flag: "wx" },
  );
  writeFileSync(
    path.join(moduleDirectory, "Microsoft.PowerShell.Utility.psd1"),
    "@{ RootModule = 'Microsoft.PowerShell.Utility.psm1'; ModuleVersion = '1.0.0'; GUID = '11111111-1111-1111-1111-111111111111' }\n",
    { encoding: "utf8", flag: "wx" },
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        launcherPath,
        path.join(repoRoot, "scripts", "supabase-ship-safe.ps1"),
        "--",
        "-Help",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PSModulePath: hostileRoot },
        timeout: 10_000,
        windowsHide: true,
      },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, output);
    assert.match(output, /Supabase safe ship/);
    assert.doesNotMatch(output, /CLIXML|<Objs\b|<TN\b/);
    assert.equal(existsSync(marker), false, "the hostile shadow module must never load");
  } finally {
    rmSync(hostileRoot, { recursive: true, force: true });
  }
});

test("reviewed Git environment disables a repository-configured fsmonitor executable", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "hanbang-git-config-"));
  const monitor = path.join(directory, "fsmonitor.cjs");
  const marker = path.join(directory, "fsmonitor-ran");
  const git = process.platform === "win32"
    ? "C:\\Program Files\\Git\\cmd\\git.exe"
    : "/usr/bin/git";
  try {
    assert.equal(existsSync(git), true, "reviewed Git executable must exist");
    writeFileSync(
      monitor,
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"); process.stdout.write("\\n");\n`,
      { encoding: "utf8", flag: "wx" },
    );
    assert.equal(spawnSync(git, ["init", "--quiet"], { cwd: directory }).status, 0);
    assert.equal(
      spawnSync(git, ["config", "--local", "core.fsmonitor", `node \"${monitor}\"`], {
        cwd: directory,
      }).status,
      0,
    );
    spawnSync(git, ["status", "--porcelain=v1"], { cwd: directory });
    assert.equal(existsSync(marker), true, "the hostile local config must be executable without isolation");
    rmSync(marker, { force: true });

    const isolated = spawnSync(git, ["status", "--porcelain=v1"], {
      cwd: directory,
      env: buildReviewedChildEnv(),
    });
    assert.equal(isolated.status, 0);
    assert.equal(existsSync(marker), false, "reviewed Git config must override local fsmonitor");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reviewed script directory comparison follows platform path casing rules", () => {
  if (process.platform === "win32") {
    assert.equal(pathsEqual("C:\\Repo\\Scripts", "c:\\repo\\scripts"), true);
  } else {
    assert.equal(pathsEqual("/repo/Scripts", "/repo/scripts"), false);
  }
});

test("reviewed Windows system executables reject unknown names and traversal", () => {
  assert.throws(() => resolveWindowsSystemExecutable("../cmd.exe"));
  assert.throws(() => resolveWindowsSystemExecutable("powershell.exe"));
  assert.throws(() => resolveWindowsSystemExecutable({ toString: () => "cmd.exe" }));
  if (process.platform === "win32") {
    assert.match(resolveWindowsSystemExecutable("taskkill.exe"), /\\windows\\system32\\taskkill\.exe$/i);
  }
});

test("launcher rejects missing and outside entrypoints with an allowed basename", () => {
  assert.equal(main(["missing-reviewed-script.ps1"]), 2);
  const outside = mkdtempSync(path.join(tmpdir(), "hanbang-launcher-"));
  const outsideScript = path.join(outside, "supabase-ship-safe.ps1");
  try {
    writeFileSync(outsideScript, "exit 0\n", { encoding: "utf8", flag: "wx" });
    assert.equal(main([outsideScript]), 2);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("launcher forwards arguments to the reviewed runtime and returns child status", {
  skip: process.platform !== "win32",
}, () => {
  const ship = path.join(repoRoot, "scripts", "supabase-ship-safe.ps1");
  const caseVariantShip = ship.replace(/scripts/i, "SCRIPTS").replace(
    /supabase-ship-safe\.ps1$/i,
    "SUPABASE-SHIP-SAFE.PS1",
  );
  assert.equal(main([caseVariantShip, "--", "-Help"]), 0);
  assert.equal(main([ship, "--", "-UnknownParameter"]), 1);
  assert.equal(
    main([
      ship,
      "--",
      "-ExpectedProjectRef",
      "x".repeat(20),
      "-ExpectedProjectRef",
      "y".repeat(20),
    ]),
    1,
  );
  const fence = path.join(repoRoot, "scripts", "supabase-write-fence.ps1");
  assert.equal(main([fence, "--", "-ExpectedProjectRef", "invalid"]), 1);

  const reconcile = spawnSync(
    process.execPath,
    [
      launcherPath,
      path.join(repoRoot, "scripts", "supabase-reconcile-core-baseline.ps1"),
      "--",
      "-Help",
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  const reconcileOutput = `${reconcile.stdout ?? ""}\n${reconcile.stderr ?? ""}`;
  assert.equal(reconcile.error, undefined);
  assert.equal(reconcile.status, 0, reconcileOutput);
  assert.match(reconcileOutput, /Supabase legacy core baseline reconciliation/);
  assert.doesNotMatch(reconcileOutput, /CLIXML|<Objs\b|<TN\b/);

  const fencePlan = spawnSync(
    process.execPath,
    [
      launcherPath,
      fence,
      "--",
      "-Action",
      "Plan",
      "-ExpectedProjectRef",
      "abcdefghijklmnopqrst",
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  const fencePlanOutput = `${fencePlan.stdout ?? ""}\n${fencePlan.stderr ?? ""}`;
  assert.equal(fencePlan.error, undefined);
  assert.equal(fencePlan.status, 0, fencePlanOutput);
  assert.doesNotMatch(fencePlanOutput, /CLIXML|<Objs\b|<TN\b/);
  assert.deepEqual(JSON.parse(fencePlan.stdout), {
    contract: "database-readonly-realtime-cron-v1",
    projectRef: "abcdefghijklmnopqrst",
    production: false,
    remoteCallsExecuted: false,
    coordinationScope: "single_host_local_journal_only",
    productionBlockers: [
      "provider_side_project_lease_or_cas_across_hosts_and_ci",
      "same_lease_migration_started_exact_target_push_evidence_restore",
      "fresh_live_fence_and_black_box_denial_recheck_immediately_before_push",
      "pinned_migration_connection_and_disposable_beta_api_rehearsal",
      "continuous_writer_role_coverage_and_provider_change_freeze",
    ],
    operations: [
      "restrict_database_network",
      "suspend_and_shutdown_realtime",
      "disable_auth_signup",
      "set_service_roles_read_only",
      "stop_and_drain_pg_cron",
      "verify_release_connection_writable",
    ],
  });
});
