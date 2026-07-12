import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fenceScript = path.join(repoRoot, "scripts", "supabase-write-fence.ps1");
const fenceSource = readFileSync(fenceScript, "utf8");
const dotSourceGuard = [
  'if ($MyInvocation.InvocationName -eq ".") {',
  '  throw "The operational write-fence entrypoint cannot be dot-sourced."',
  "}",
].join("\n");
const offlineHarnessRoot = mkdtempSync(path.join(tmpdir(), "hanbang-fence-harness-"));
const offlineFenceScript = path.join(offlineHarnessRoot, "supabase-write-fence.ps1");
const offlineFenceSource = fenceSource.replace(dotSourceGuard, "");
if (offlineFenceSource === fenceSource) {
  throw new Error("The operational dot-source rejection was not found.");
}
writeFileSync(offlineFenceScript, offlineFenceSource, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
after(() => rmSync(offlineHarnessRoot, { recursive: true, force: true }));
const powershell = process.platform === "win32" ? "powershell" : "pwsh";
const offlineProjectRef = "abcdefghijklmnopqrst";
const productionProjectRef = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "release-targets.json"), "utf8"),
).productionSupabaseProjectRefs[0];

function journalRootFor(stateRoot) {
  return path.join(stateRoot, "WeddingHanbang", "release-fence", offlineProjectRef);
}

function journalPathFor(stateRoot, fenceId) {
  return path.join(journalRootFor(stateRoot), `${fenceId}.json`);
}

function offlineSnapshot(fenceId) {
  const capturedAt = new Date();
  const databaseObservedAt = new Date(capturedAt.getTime() - 1_000);
  const roles = Object.fromEntries(
    ["authenticator", "supabase_auth_admin", "supabase_storage_admin", "dashboard_user"]
      .map((role) => [role, { exists: true, configuredValue: null }])
  );
  return {
    schemaVersion: 2,
    contract: "database-readonly-realtime-cron-v1",
    fenceId,
    projectRef: offlineProjectRef,
    state: "captured",
    production: false,
    capturedAtUtc: capturedAt.toISOString(),
    reviewedHead: "a".repeat(40),
    reviewedTree: "b".repeat(40),
    roleFenceAppliedAtUtc: null,
    backendFence: null,
    releaseCidrs: { ipv4: ["203.0.113.10/32"], ipv6: [] },
    previous: {
      management: {
        network: { ipv4: ["0.0.0.0/0"], ipv6: ["::/0"], status: "applied", entitlement: "allowed" },
        realtime: { suspend: false },
        auth: { disableSignup: false },
      },
      database: {
        contract: "database-readonly-realtime-cron-v1",
        database: "postgres",
        roles,
        cron: { launchActiveJobs: "on", autoOverridePresent: false, autoOverrideValue: null },
        drain: {
          activeTransactions: 0,
          runningCronJobs: 0,
          protectedRoleSessions: 0,
          oldestProtectedRoleSessionAtUtc: null,
          clientBackendSessions: 0,
          unclassifiedClientBackends: 0,
          unclassifiedWriterSessions: 0,
          oldestClientBackendStartAtUtc: null,
          newestClientBackendStartAtUtc: null,
        },
        backendBoundary: {
          observedAtUtc: databaseObservedAt.toISOString(),
          postmasterStartedAtUtc: "2026-07-11T00:00:00.000Z",
          clientBackendSessions: 0,
          unclassifiedClientBackends: 0,
          unclassifiedWriterSessions: 0,
          oldestClientBackendStartAtUtc: null,
          newestClientBackendStartAtUtc: null,
        },
        releaseConnection: {
          roleClass: "supabase_project_postgres",
          transactionReadOnly: true,
        },
      },
    },
    steps: [],
    migrationStarted: false,
    migrationVerified: false,
    postMigrationEvidence: null,
  };
}

function activeOfflineSnapshot(fenceId) {
  const snapshot = offlineSnapshot(fenceId);
  const appliedAtUtc = new Date().toISOString();
  snapshot.state = "active";
  snapshot.roleFenceAppliedAtUtc = appliedAtUtc;
  snapshot.backendFence = {
    appliedAtUtc,
    targetedClientBackends: 0,
    unclassifiedPreFenceClientBackends: 0,
    unmanagedPreFenceWriterBackends: 0,
    terminationFailures: 0,
  };
  snapshot.steps = ["network", "realtime", "auth", "roles", "cron", "verify"]
    .map((name) => ({ name, status: "applied", recordedAtUtc: appliedAtUtc }));
  return snapshot;
}

function verifiedMigrationFixture(fenceId) {
  const snapshot = activeOfflineSnapshot(fenceId);
  const startedAtUtc = new Date().toISOString();
  const verifiedAtUtc = new Date(Date.now() + 10).toISOString();
  const evidence = {
    schemaVersion: 1,
    contract: "post-migration-release-evidence-v1",
    projectRef: offlineProjectRef,
    fenceId,
    reviewedHead: snapshot.reviewedHead,
    verifiedAtUtc,
    checks: {
      migrationHistoryExact: true,
      databaseContractPassed: true,
      dataApiWriteDenied: true,
      authWriteDenied: true,
      storageWriteDenied: true,
      releaseConnectionWritable: true,
    },
  };
  const evidenceJson = JSON.stringify(evidence);
  snapshot.state = "migration_verified";
  snapshot.migrationStarted = true;
  snapshot.migrationVerified = true;
  snapshot.steps.push(
    { name: "migration", status: "started", recordedAtUtc: startedAtUtc },
    { name: "migration_verification", status: "applied", recordedAtUtc: verifiedAtUtc }
  );
  snapshot.postMigrationEvidence = {
    contract: evidence.contract,
    digestSha256: createHash("sha256").update(evidenceJson).digest("hex"),
    verifiedAtUtc: verifiedAtUtc.replace(/\.(\d{3})Z$/, ".$10000+00:00"),
    allRequiredChecksPassed: true,
  };
  return { evidence, evidenceJson, snapshot };
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function importFencePrefix(stateRoot) {
  return [
    `$ReviewedEntrypointRoot = ${quotePowerShell(path.dirname(fenceScript))}`,
    `. ${quotePowerShell(offlineFenceScript)} -Action Plan -ExpectedProjectRef ${quotePowerShell(offlineProjectRef)}`,
    `$script:OfflineTestFenceStateRoot = ${quotePowerShell(stateRoot)}`,
  ].join("; ");
}

function runPowerShell(script, stateRoot) {
  return spawnSync(
    powershell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `${importFencePrefix(stateRoot)}; ${script}`],
    { cwd: repoRoot, encoding: "utf8", timeout: 20_000 }
  );
}

test("production journal root ignores mutable environment namespaces", () => {
  const source = fenceSource;
  assert.match(source, /GetFolderPath\([\s\S]*SpecialFolder\]::LocalApplicationData/);
  assert.doesNotMatch(source, /\$env:(?:LOCALAPPDATA|XDG_STATE_HOME)/);
  assert.match(source, /offline journal root override is restricted to non-production Plan tests/i);
});

test("operational entrypoint rejects dot-sourcing before exporting remote mutators", () => {
  const mutators = [
    "New-FenceSnapshot",
    "Invoke-FenceActivation",
    "Set-NetworkFence",
    "Set-AuthFence",
    "Set-DatabaseRoleFence",
    "Set-CronFence",
  ];
  const command = [
    "$rejected = $false",
    `try { . ${quotePowerShell(fenceScript)} -Action Recover -ExpectedProjectRef ${quotePowerShell(productionProjectRef)} } catch { if ($_.Exception.Message -notmatch 'cannot be dot-sourced') { throw }; $rejected = $true }`,
    "if (-not $rejected) { throw 'dot-source rejection did not run' }",
    ...mutators.map((name) => (
      `if (Get-Command -Name ${quotePowerShell(name)} -CommandType Function -ErrorAction SilentlyContinue) { throw ${quotePowerShell(`${name} leaked`)} }`
    )),
  ].join("; ");
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd: repoRoot, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(
    fenceSource.indexOf("cannot be dot-sourced")
      < fenceSource.indexOf("function Convert-SecureStringToPlainText"),
  );
});

test("Windows journal root uses the OS known folder and rejects override misuse", {
  skip: process.platform !== "win32",
}, async () => {
  const poison = await mkdtemp(path.join(tmpdir(), "hanbang-fence-poison-"));
  try {
    const command = [
      `$env:LOCALAPPDATA = ${quotePowerShell(path.join(poison, "local"))}`,
      `$env:XDG_STATE_HOME = ${quotePowerShell(path.join(poison, "xdg"))}`,
      `$env:HOME = ${quotePowerShell(path.join(poison, "home"))}`,
      `$ReviewedEntrypointRoot = ${quotePowerShell(path.dirname(fenceScript))}`,
      `. ${quotePowerShell(offlineFenceScript)} -Action Plan -ExpectedProjectRef ${quotePowerShell(offlineProjectRef)}`,
      "$expected = [IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData))",
      "$actual = Get-FenceStateRoot",
      "if ($actual -ne $expected) { throw 'canonical known-folder root was not used' }",
      `$script:OfflineTestFenceStateRoot = ${quotePowerShell(poison)}`,
      "$script:Action = 'Capture'",
      "$rejectedAction = $false",
      "try { Get-FenceStateRoot | Out-Null } catch { $rejectedAction = $true }",
      "if (-not $rejectedAction) { throw 'non-Plan override was accepted' }",
      "$script:Action = 'Plan'",
      "$script:isProductionTarget = $true",
      "$rejectedProduction = $false",
      "try { Get-FenceStateRoot | Out-Null } catch { $rejectedProduction = $true }",
      "if (-not $rejectedProduction) { throw 'production override was accepted' }",
    ].join("; ");
    const result = spawnSync(
      powershell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { cwd: repoRoot, encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(poison, { recursive: true, force: true });
  }
});

async function waitForLine(stream, expected, stderr) {
  let output = "";
  let errorOutput = "";
  stderr.setEncoding("utf8");
  stderr.on("data", (chunk) => {
    errorOutput += chunk;
  });
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    output += chunk;
    if (output.includes(expected)) return;
  }
  throw new Error(`holder exited before ${expected}: ${errorOutput || output}`);
}

test("a second lifecycle action cannot acquire the same project journal lock", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-lock-"));
  const holder = spawn(
    powershell,
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `${importFencePrefix(stateRoot)}; `
        + "$lock = Enter-ProjectFenceLifecycleLock; "
        + "try { [Console]::Out.WriteLine('LOCK_HELD'); [Console]::Out.Flush(); Start-Sleep -Seconds 15 } "
        + "finally { $lock.Dispose() }",
    ],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    await waitForLine(holder.stdout, "LOCK_HELD", holder.stderr);
    const contender = runPowerShell(
      "try { $other = Enter-ProjectFenceLifecycleLock; $other.Dispose(); throw 'unexpected lock acquisition' } "
        + "catch { if ($_.Exception.Message -notmatch 'already active') { throw }; Write-Output 'LOCK_REJECTED' }",
      stateRoot
    );
    assert.equal(contender.status, 0, contender.stderr);
    assert.match(contender.stdout, /LOCK_REJECTED/);
  } finally {
    holder.kill();
    await new Promise((resolve) => holder.once("exit", resolve));
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a fresh journal hierarchy is durably published before the lifecycle lock can exist", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-dir-durable-"));
  const lockPath = path.join(journalRootFor(stateRoot), ".lifecycle.lock");
  try {
    const result = runPowerShell(
      "function Publish-FenceDirectoryEntryDurably { param([string]$Parent, [string]$Path); throw 'forced directory durability failure' }; "
        + "try { $lock = Enter-ProjectFenceLifecycleLock; $lock.Dispose(); throw 'unexpected lifecycle lock' } "
        + "catch { if ($_.Exception.Message -match 'unexpected lifecycle lock' -or $_.Exception.Message -notmatch 'directory durability') { throw } }; "
        + `if (Test-Path -LiteralPath ${quotePowerShell(lockPath)}) { throw 'lock existed after durability failure' }; `
        + "Write-Output 'DIRECTORY_DURABILITY_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DIRECTORY_DURABILITY_REJECTED/);

    const orderResult = runPowerShell(
      "$script:syncOrder = [Collections.Generic.List[string]]::new(); "
        + "function Publish-FenceDirectoryEntryDurably { param([string]$Parent, [string]$Path); [IO.Directory]::CreateDirectory($Path) | Out-Null }; "
        + "function Sync-FenceDirectoryMetadata { param([string]$Path); $script:syncOrder.Add([IO.Path]::GetFileName($Path)) }; "
        + "Ensure-FenceJournalHierarchyDurable | Out-Null; "
        + `if (($script:syncOrder -join ',') -ne "${offlineProjectRef},release-fence,WeddingHanbang,$([IO.Path]::GetFileName((Get-FenceStateRoot)))") { throw ('wrong sync order: ' + ($script:syncOrder -join ',')) }; `
        + "Write-Output 'DIRECTORY_ORDER_OK'",
      stateRoot
    );
    assert.equal(orderResult.status, 0, orderResult.stderr);
    assert.match(orderResult.stdout, /DIRECTORY_ORDER_OK/);

    const fence = readFileSync(fenceScript, "utf8");
    const enter = fence.slice(
      fence.indexOf("function Enter-ProjectFenceLifecycleLock"),
      fence.indexOf("function Resolve-FenceSnapshotPath")
    );
    const ensure = fence.slice(
      fence.indexOf("function Ensure-FenceJournalHierarchyDurable"),
      fence.indexOf("function Enter-ProjectFenceLifecycleLock")
    );
    const publish = fence.slice(
      fence.indexOf("function Publish-FenceDirectoryEntryDurably"),
      fence.indexOf("function Ensure-FenceJournalHierarchyDurable")
    );
    assert.match(enter, /Ensure-FenceJournalHierarchyDurable/);
    assert.ok(enter.indexOf("Ensure-FenceJournalHierarchyDurable") < enter.indexOf("[IO.File]::Open"));
    assert.doesNotMatch(enter, /CreateDirectory\(\$root\)/);
    assert.match(ensure, /\[array\]::Reverse\(\$durabilityOrder\)/i);
    assert.match(ensure, /Sync-FenceDirectoryMetadata/);
    assert.match(publish, /MoveDirectoryWriteThrough/);
    assert.match(publish, /Sync-FenceDirectoryMetadata/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("journal directories, locks, and snapshots enforce a private owner-only boundary", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-private-journal-"));
  const snapshot = offlineSnapshot("00000000-0000-4000-8000-000000000019");
  const snapshotPath = journalPathFor(stateRoot, snapshot.fenceId);
  try {
    const result = runPowerShell(
      `$snapshot = ${quotePowerShell(JSON.stringify(snapshot))} | ConvertFrom-Json; `
        + "$root = Ensure-FenceJournalHierarchyDurable; Assert-FenceJournalPathPrivate -Path $root -Directory; "
        + "$lock = Enter-ProjectFenceLifecycleLock; try { Assert-FenceJournalPathPrivate -Path (Join-Path $root '.lifecycle.lock') } finally { $lock.Dispose() }; "
        + `Write-FenceSnapshot -Path ${quotePowerShell(snapshotPath)} -Snapshot $snapshot -CreateNew; `
        + `Assert-FenceJournalPathPrivate -Path ${quotePowerShell(snapshotPath)}; `
        + "if ($script:RunningOnWindows) { "
        + `  $acl = [IO.File]::GetAccessControl(${quotePowerShell(snapshotPath)}); `
        + "  $everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0'); "
        + "  $rule = [Security.AccessControl.FileSystemAccessRule]::new($everyone, [Security.AccessControl.FileSystemRights]::Read, [Security.AccessControl.AccessControlType]::Allow); "
        + `  $acl.AddAccessRule($rule) | Out-Null; [IO.File]::SetAccessControl(${quotePowerShell(snapshotPath)}, $acl) `
        + "} else { "
        + "  $modeType = [IO.File].Assembly.GetType('System.IO.UnixFileMode', $false); "
        + "  $mode = [Enum]::Parse($modeType, 'UserRead, UserWrite, GroupRead'); "
        + "  $method = @([IO.File].GetMethods() | Where-Object { $_.Name -eq 'SetUnixFileMode' -and $_.GetParameters().Count -eq 2 -and $_.GetParameters()[0].ParameterType -eq [string] })[0]; "
        + `  $arguments = [object[]]::new(2); $arguments[0] = ${quotePowerShell(snapshotPath)}; $arguments[1] = $mode; $method.Invoke($null, $arguments) | Out-Null `
        + "}; "
        + `try { Assert-FenceJournalPathPrivate -Path ${quotePowerShell(snapshotPath)}; throw 'unexpected public journal acceptance' } `
        + "catch { if ($_.Exception.Message -match 'unexpected public journal acceptance' -or $_.Exception.Message -notmatch 'current-user-only|not private') { throw } }; "
        + "Write-Output 'PRIVATE_JOURNAL_ENFORCED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PRIVATE_JOURNAL_ENFORCED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("activation rejects a captured baseline older than five minutes", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-stale-"));
  try {
    const result = runPowerShell(
      "$snapshot = [pscustomobject]@{ capturedAtUtc = [DateTimeOffset]::UtcNow.AddMinutes(-6).ToString('o') }; "
        + "try { Assert-SnapshotFreshForActivation $snapshot; throw 'unexpected stale acceptance' } "
        + "catch { if ($_.Exception.Message -notmatch 'five-minute') { throw }; Write-Output 'STALE_REJECTED' }",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /STALE_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("management GET restore fields reject missing, coercible, partial, and invalid-CIDR schemas", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-management-schema-"));
  try {
    const result = runPowerShell(
      "function Assert-ManagementSchemaRejected { param([scriptblock]$Probe); "
        + "try { & $Probe | Out-Null; throw 'unexpected management schema acceptance' } "
        + "catch { if ($_.Exception.Message -match 'unexpected management schema acceptance' -or $_.Exception.Message -notmatch 'management restore schema') { throw } } }; "
        + "$validRealtime = '{\"suspend\":false,\"private_only\":{\"message\":\"must-not-persist\"}}' | ConvertFrom-Json; "
        + "$validAuth = '{\"disable_signup\":true}' | ConvertFrom-Json; "
        + "$validNetwork = '{\"config\":{\"dbAllowedCidrs\":[\"0.0.0.0/0\"],\"dbAllowedCidrsV6\":[]},\"status\":\"applied\",\"entitlement\":\"allowed\"}' | ConvertFrom-Json; "
        + "$selectedRealtime = Select-SanitizedRealtimeConfig $validRealtime; "
        + "$selectedAuth = Select-SanitizedAuthConfig $validAuth; "
        + "$selectedNetwork = Select-SanitizedNetworkConfig $validNetwork; "
        + "if ($selectedRealtime.suspend -isnot [bool] -or $selectedRealtime.suspend -ne $false -or @($selectedRealtime.PSObject.Properties).Count -ne 1 -or ($selectedRealtime | ConvertTo-Json -Compress) -match 'must-not-persist|message' -or $selectedAuth.disableSignup -isnot [bool] -or $selectedAuth.disableSignup -ne $true -or $selectedNetwork.ipv4 -isnot [array] -or $selectedNetwork.ipv6 -isnot [array]) { throw 'valid strict schema changed type' }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedRealtimeConfig ('{}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedRealtimeConfig ('{\"suspend\":\"false\"}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedAuthConfig ('{}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedAuthConfig ('{\"disable_signup\":\"false\"}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedNetworkConfig ('{\"status\":\"applied\",\"entitlement\":\"allowed\"}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedNetworkConfig ('{\"config\":{\"dbAllowedCidrs\":\"0.0.0.0/0\",\"dbAllowedCidrsV6\":[]},\"status\":\"applied\",\"entitlement\":\"allowed\"}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedNetworkConfig ('{\"config\":{\"dbAllowedCidrs\":[\"not-a-cidr\"],\"dbAllowedCidrsV6\":[]},\"status\":\"applied\",\"entitlement\":\"allowed\"}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedNetworkConfig ('{\"config\":{\"dbAllowedCidrs\":[\"2001:db8::/32\"],\"dbAllowedCidrsV6\":[]},\"status\":\"applied\",\"entitlement\":\"allowed\"}' | ConvertFrom-Json) }; "
        + "Assert-ManagementSchemaRejected { Select-SanitizedNetworkConfig ('{\"config\":{\"dbAllowedCidrs\":[],\"dbAllowedCidrsV6\":[]},\"status\":true,\"entitlement\":\"allowed\"}' | ConvertFrom-Json) }; "
        + "Write-Output 'MANAGEMENT_SCHEMA_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /MANAGEMENT_SCHEMA_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("snapshot safety strictly validates every nested management restore field", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-snapshot-management-"));
  const snapshot = offlineSnapshot("00000000-0000-4000-8000-000000000008");
  try {
    const result = runPowerShell(
      "function Assert-SnapshotManagementRejected { param($Snapshot); "
        + "try { Assert-FenceSnapshotSafety $Snapshot; throw 'unexpected snapshot management acceptance' } "
        + "catch { if ($_.Exception.Message -match 'unexpected snapshot management acceptance' -or $_.Exception.Message -notmatch 'exact-restore management baseline') { throw } } }; "
        + `$json = ${quotePowerShell(JSON.stringify(snapshot))}; `
        + "$badRealtime = $json | ConvertFrom-Json; $badRealtime.previous.management.realtime.suspend = 'false'; Assert-SnapshotManagementRejected $badRealtime; "
        + "$rawRealtime = $json | ConvertFrom-Json; $rawRealtime.previous.management.realtime | Add-Member -NotePropertyName privateOnly -NotePropertyValue ([pscustomobject]@{ message = 'must-not-persist' }); Assert-SnapshotManagementRejected $rawRealtime; "
        + "$badAuth = $json | ConvertFrom-Json; $badAuth.previous.management.auth.PSObject.Properties.Remove('disableSignup'); Assert-SnapshotManagementRejected $badAuth; "
        + "$badNetworkArray = $json | ConvertFrom-Json; $badNetworkArray.previous.management.network.ipv4 = '0.0.0.0/0'; Assert-SnapshotManagementRejected $badNetworkArray; "
        + "$badNetworkCidr = $json | ConvertFrom-Json; $badNetworkCidr.previous.management.network.ipv6 = @('192.0.2.0/24'); Assert-SnapshotManagementRejected $badNetworkCidr; "
        + "Write-Output 'SNAPSHOT_MANAGEMENT_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SNAPSHOT_MANAGEMENT_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("snapshot safety rejects forged active and migration-verified lifecycle graphs", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-lifecycle-graph-"));
  const snapshot = offlineSnapshot("00000000-0000-4000-8000-000000000018");
  try {
    const result = runPowerShell(
      "function Assert-LifecycleRejected { param($Snapshot); "
        + "try { Assert-FenceSnapshotSafety $Snapshot; throw 'unexpected lifecycle acceptance' } "
        + "catch { if ($_.Exception.Message -match 'unexpected lifecycle acceptance' -or $_.Exception.Message -notmatch 'lifecycle|step|evidence') { throw } } }; "
        + `$json = ${quotePowerShell(JSON.stringify(snapshot))}; `
        + "$forgedActive = $json | ConvertFrom-Json; $forgedActive.state = 'active'; Assert-LifecycleRejected $forgedActive; "
        + "$forgedVerified = $json | ConvertFrom-Json; $forgedVerified.state = 'migration_verified'; $forgedVerified.migrationStarted = $true; $forgedVerified.migrationVerified = $true; $forgedVerified.postMigrationEvidence = [pscustomobject]@{ contract = 'post-migration-release-evidence-v1'; digestSha256 = ('a' * 64); verifiedAtUtc = [DateTimeOffset]::UtcNow.ToString('o'); allRequiredChecksPassed = $true }; Assert-LifecycleRejected $forgedVerified; "
        + "Write-Output 'LIFECYCLE_GRAPH_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LIFECYCLE_GRAPH_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("restore evidence boundary requires and rebinds the original verified artifact", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-evidence-rebind-"));
  const fenceId = "00000000-0000-4000-8000-000000000020";
  const { evidenceJson, snapshot } = verifiedMigrationFixture(fenceId);
  const active = activeOfflineSnapshot(fenceId);
  const evidencePath = path.join(journalRootFor(stateRoot), "post-migration-evidence.json");
  try {
    await mkdir(journalRootFor(stateRoot), { recursive: true });
    await writeFile(evidencePath, evidenceJson, "utf8");
    const result = runPowerShell(
      `$verified = ${quotePowerShell(JSON.stringify(snapshot))} | ConvertFrom-Json; `
        + `$active = ${quotePowerShell(JSON.stringify(active))} | ConvertFrom-Json; `
        + "Ensure-FenceJournalHierarchyDurable | Out-Null; Assert-FenceSnapshotSafety $verified; Assert-FenceSnapshotSafety $active; "
        + `$PostMigrationEvidencePath = ${quotePowerShell(evidencePath)}; Assert-RestoreEvidenceBoundary $verified; `
        + "$PostMigrationEvidencePath = ''; try { Assert-RestoreEvidenceBoundary $verified; throw 'unexpected missing evidence acceptance' } catch { if ($_.Exception.Message -match 'unexpected missing evidence acceptance' -or $_.Exception.Message -notmatch 'required') { throw } }; "
        + `$PostMigrationEvidencePath = ${quotePowerShell(evidencePath)}; try { Assert-RestoreEvidenceBoundary $active; throw 'unexpected active evidence acceptance' } catch { if ($_.Exception.Message -match 'unexpected active evidence acceptance' -or $_.Exception.Message -notmatch 'forbidden') { throw } }; `
        + "Write-Output 'RESTORE_EVIDENCE_REBOUND'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RESTORE_EVIDENCE_REBOUND/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("restore evidence rebind rejects identity, digest, and timestamp drift", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-evidence-drift-"));
  const fenceId = "00000000-0000-4000-8000-000000000021";
  const { evidence, evidenceJson, snapshot } = verifiedMigrationFixture(fenceId);
  const root = journalRootFor(stateRoot);
  const validPath = path.join(root, "valid-evidence.json");
  const identityPath = path.join(root, "wrong-identity-evidence.json");
  const timestampPath = path.join(root, "stale-evidence.json");
  try {
    await mkdir(root, { recursive: true });
    await writeFile(validPath, evidenceJson, "utf8");
    await writeFile(identityPath, JSON.stringify({
      ...evidence,
      fenceId: "00000000-0000-4000-8000-000000000022",
    }), "utf8");
    await writeFile(timestampPath, JSON.stringify({
      ...evidence,
      verifiedAtUtc: new Date(Date.now() - (31 * 60_000)).toISOString(),
    }), "utf8");
    const digestDrift = structuredClone(snapshot);
    digestDrift.postMigrationEvidence.digestSha256 = "b".repeat(64);
    const result = runPowerShell(
      `$snapshot = ${quotePowerShell(JSON.stringify(snapshot))} | ConvertFrom-Json; `
        + `$digestDrift = ${quotePowerShell(JSON.stringify(digestDrift))} | ConvertFrom-Json; `
        + "Ensure-FenceJournalHierarchyDurable | Out-Null; Assert-FenceSnapshotSafety $snapshot; Assert-FenceSnapshotSafety $digestDrift; "
        + "function Assert-RebindRejected { param([string]$EvidencePath, $Candidate, [string]$Pattern); $script:PostMigrationEvidencePath = $EvidencePath; try { Assert-RestoreEvidenceBoundary $Candidate; throw 'unexpected evidence drift acceptance' } catch { if ($_.Exception.Message -match 'unexpected evidence drift acceptance' -or $_.Exception.Message -notmatch $Pattern) { throw } } }; "
        + `Assert-RebindRejected ${quotePowerShell(identityPath)} $snapshot 'identity'; `
        + `Assert-RebindRejected ${quotePowerShell(validPath)} $digestDrift 'digest|summary'; `
        + `Assert-RebindRejected ${quotePowerShell(timestampPath)} $snapshot 'timestamp|window'; `
        + "Write-Output 'RESTORE_EVIDENCE_DRIFT_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RESTORE_EVIDENCE_DRIFT_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a forced unique-temp collision cannot damage the committed journal", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-temp-"));
  const destination = journalPathFor(stateRoot, "00000000-0000-4000-8000-000000000004");
  const collision = `${destination}.forced.tmp`;
  const replacement = offlineSnapshot("00000000-0000-4000-8000-000000000001");
  try {
    await mkdir(journalRootFor(stateRoot), { recursive: true });
    const result = runPowerShell(
      `[IO.File]::WriteAllText(${quotePowerShell(destination)}, 'committed'); `
        + `[IO.File]::WriteAllText(${quotePowerShell(collision)}, 'occupied'); `
        + `function New-FenceTemporaryPath { param([string]$Path) return ${quotePowerShell(collision)} }; `
        + `$replacement = ${quotePowerShell(JSON.stringify(replacement))} | ConvertFrom-Json; `
        + `try { Write-FenceSnapshot -Path ${quotePowerShell(destination)} -Snapshot $replacement; throw 'unexpected collision overwrite' } `
        + "catch { if ($_.Exception.Message -match 'unexpected collision overwrite') { throw } }; "
        + `if ([IO.File]::ReadAllText(${quotePowerShell(destination)}) -ne 'committed') { throw 'destination changed' }; `
        + `if ([IO.File]::ReadAllText(${quotePowerShell(collision)}) -ne 'occupied') { throw 'collision file changed' }; `
        + "Write-Output 'COLLISION_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /COLLISION_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("direct snapshot and evidence reads reject oversized artifacts before JSON parsing", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-bounded-read-"));
  const snapshotPath = journalPathFor(
    stateRoot,
    "00000000-0000-4000-8000-000000000023"
  );
  const evidencePath = path.join(journalRootFor(stateRoot), "oversized-evidence.json");
  try {
    await mkdir(journalRootFor(stateRoot), { recursive: true });
    const oversized = "x".repeat((1024 * 1024) + 1);
    await writeFile(snapshotPath, oversized, "utf8");
    await writeFile(evidencePath, oversized, "utf8");
    const result = runPowerShell(
      "Ensure-FenceJournalHierarchyDurable | Out-Null; "
        + `try { Read-FenceSnapshot ${quotePowerShell(snapshotPath)}; throw 'unexpected oversized snapshot acceptance' } catch { if ($_.Exception.Message -match 'unexpected oversized snapshot acceptance' -or $_.Exception.Message -notmatch 'bounded size') { throw } }; `
        + `$placeholder = [pscustomobject]@{ fenceId = '00000000-0000-4000-8000-000000000023'; reviewedHead = ('a' * 40); steps = @([pscustomobject]@{ name = 'migration'; status = 'started'; recordedAtUtc = [DateTimeOffset]::UtcNow.ToString('o') }) }; `
        + `try { Read-PostMigrationEvidence ${quotePowerShell(evidencePath)} $placeholder; throw 'unexpected oversized evidence acceptance' } catch { if ($_.Exception.Message -match 'unexpected oversized evidence acceptance' -or $_.Exception.Message -notmatch 'bounded size') { throw } }; `
        + "Write-Output 'DIRECT_READS_BOUNDED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DIRECT_READS_BOUNDED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a pathname replacement cannot change the digest bound to already-read journal bytes", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-same-bytes-"));
  const payloadPath = path.join(journalRootFor(stateRoot), "same-bytes-evidence.json");
  const first = '{"contract":"first"}';
  const second = '{"contract":"other"}';
  try {
    await mkdir(journalRootFor(stateRoot), { recursive: true });
    await writeFile(payloadPath, first, "utf8");
    const result = runPowerShell(
      "Ensure-FenceJournalHierarchyDurable | Out-Null; "
        + `$payload = Read-FenceJournalPayloadBounded ${quotePowerShell(payloadPath)}; `
        + `[IO.File]::WriteAllText(${quotePowerShell(payloadPath)}, ${quotePowerShell(second)}, [Text.UTF8Encoding]::new($false)); `
        + "$sha = [Security.Cryptography.SHA256]::Create(); try { $expected = [BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($payload.json))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }; "
        + "if ($payload.json -cne '" + first.replaceAll("'", "''") + "' -or $payload.digestSha256 -cne $expected) { throw 'digest was not bound to the same bytes' }; "
        + `$currentDigest = (Get-FileHash -LiteralPath ${quotePowerShell(payloadPath)} -Algorithm SHA256).Hash.ToLowerInvariant(); `
        + "if ($currentDigest -ceq $payload.digestSha256) { throw 'test replacement did not change path bytes' }; "
        + "Write-Output 'SAME_BYTES_DIGEST_BOUND'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SAME_BYTES_DIGEST_BOUND/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("journal paths reject symbolic-link or junction traversal before any file I/O", async (t) => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-reparse-"));
  const journalRoot = journalRootFor(stateRoot);
  const outside = await mkdtemp(path.join(tmpdir(), "hanbang-fence-outside-"));
  const redirect = path.join(journalRoot, "redirect");
  const escapedDestination = path.join(redirect, "escaped.json");
  const snapshot = offlineSnapshot("00000000-0000-4000-8000-000000000007");
  try {
    await mkdir(journalRoot, { recursive: true });
    try {
      await symlink(outside, redirect, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`filesystem cannot create a test redirect: ${error.code ?? error.message}`);
      return;
    }

    const result = runPowerShell(
      `$snapshot = ${quotePowerShell(JSON.stringify(snapshot))} | ConvertFrom-Json; `
        + `$SnapshotPath = ${quotePowerShell(escapedDestination)}; `
        + "try { Resolve-FenceSnapshotPath; throw 'unexpected redirect resolution' } "
        + "catch { if ($_.Exception.Message -match 'unexpected redirect resolution' -or $_.Exception.Message -notmatch 'reparse point|symbolic link') { throw } }; "
        + `try { Write-FenceSnapshot -Path ${quotePowerShell(escapedDestination)} -Snapshot $snapshot -CreateNew; throw 'unexpected redirect write' } `
        + "catch { if ($_.Exception.Message -match 'unexpected redirect write' -or $_.Exception.Message -notmatch 'reparse point|symbolic link') { throw } }; "
        + "Write-Output 'REDIRECT_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /REDIRECT_REJECTED/);
    assert.throws(() => readFileSync(path.join(outside, "escaped.json")), { code: "ENOENT" });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("journal creation is no-clobber and later updates use a file-durable atomic replacement", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-atomic-"));
  const journalRoot = journalRootFor(stateRoot);
  const destination = path.join(journalRoot, "00000000-0000-4000-8000-000000000004.json");
  const first = offlineSnapshot("00000000-0000-4000-8000-000000000002");
  const clobber = offlineSnapshot("00000000-0000-4000-8000-000000000003");
  const second = offlineSnapshot("00000000-0000-4000-8000-000000000004");
  try {
    const result = runPowerShell(
      `$first = ${quotePowerShell(JSON.stringify(first))} | ConvertFrom-Json; `
        + `$clobber = ${quotePowerShell(JSON.stringify(clobber))} | ConvertFrom-Json; `
        + `$second = ${quotePowerShell(JSON.stringify(second))} | ConvertFrom-Json; `
        + `Write-FenceSnapshot -Path ${quotePowerShell(destination)} -Snapshot $first -CreateNew; `
        + `try { Write-FenceSnapshot -Path ${quotePowerShell(destination)} -Snapshot $clobber -CreateNew; throw 'unexpected no-clobber success' } `
        + "catch { if ($_.Exception.Message -match 'unexpected no-clobber success') { throw } }; "
        + `if ((Get-Content -Raw -LiteralPath ${quotePowerShell(destination)} | ConvertFrom-Json).fenceId -ne $first.fenceId) { throw 'no-clobber journal changed' }; `
        + `Write-FenceSnapshot -Path ${quotePowerShell(destination)} -Snapshot $second; `
        + `if ((Get-Content -Raw -LiteralPath ${quotePowerShell(destination)} | ConvertFrom-Json).fenceId -ne $second.fenceId) { throw 'atomic replacement failed' }; `
        + `if (@(Get-ChildItem -LiteralPath ${quotePowerShell(journalRoot)} -Filter '*.tmp').Count -ne 0) { throw 'temporary residue remained' }; `
        + "Write-Output 'ATOMIC_WRITE_OK'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ATOMIC_WRITE_OK/);

    const fence = readFileSync(fenceScript, "utf8");
    assert.match(fence, /Guid\]::NewGuid\(\)/);
    assert.match(fence, /FileMode\]::CreateNew/);
    assert.match(fence, /FileOptions\]::WriteThrough/);
    assert.match(fence, /\.Flush\(\$true\)/);
    assert.match(fence, /MOVEFILE_WRITE_THROUGH/);
    assert.match(fence, /MoveFileWriteThrough/);
    assert.match(fence, /FlushDirectory/);
    assert.match(fence, /fsync\(fd\)/);
    assert.match(fence, /File\]::Move\(\$Temporary, \$Path\)/);
    assert.match(fence, /File\]::Replace\(\$Temporary, \$Path/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("journal writes reject secret-bearing or structurally invalid snapshots before replacement", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-schema-"));
  const destination = journalPathFor(stateRoot, "00000000-0000-4000-8000-000000000005");
  const committed = offlineSnapshot("00000000-0000-4000-8000-000000000005");
  const malicious = offlineSnapshot("00000000-0000-4000-8000-000000000006");
  try {
    const result = runPowerShell(
      `$committed = ${quotePowerShell(JSON.stringify(committed))} | ConvertFrom-Json; `
        + `$malicious = ${quotePowerShell(JSON.stringify(malicious))} | ConvertFrom-Json; `
        + "$malicious | Add-Member -NotePropertyName apiKey -NotePropertyValue 'must-not-persist'; "
        + `Write-FenceSnapshot -Path ${quotePowerShell(destination)} -Snapshot $committed -CreateNew; `
        + `try { Write-FenceSnapshot -Path ${quotePowerShell(destination)} -Snapshot $malicious; throw 'unexpected secret persistence' } `
        + "catch { if ($_.Exception.Message -match 'unexpected secret persistence' -or $_.Exception.Message -notmatch 'forbidden secret-bearing field') { throw } }; "
        + `if ((Get-Content -Raw -LiteralPath ${quotePowerShell(destination)} | ConvertFrom-Json).fenceId -ne $committed.fenceId) { throw 'committed journal changed' }; `
        + "Write-Output 'SCHEMA_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SCHEMA_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("database release identity stores only one fixed non-PII role classification", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-role-class-"));
  const statusSql = readFileSync(
    path.join(repoRoot, "scripts", "sql", "supabase-write-fence-status.sql"),
    "utf8"
  );
  const snapshot = offlineSnapshot("00000000-0000-4000-8000-000000000013");
  try {
    assert.doesNotMatch(statusSql, /'sessionUser'\s*,/i);
    assert.doesNotMatch(statusSql, /'currentUser'\s*,/i);
    assert.match(
      statusSql,
      /session_user\s*=\s*'postgres'[\s\S]*current_user\s*=\s*'postgres'/i
    );
    assert.match(statusSql, /'roleClass'[\s\S]*'supabase_project_postgres'/i);
    assert.match(
      statusSql,
      /'transactionReadOnly'\s*,\s*current_setting\('transaction_read_only'\)\s*=\s*'on'/i
    );

    const result = runPowerShell(
      `$json = ${quotePowerShell(JSON.stringify(snapshot))}; `
        + "function Assert-ReleaseIdentityRejected { param($Snapshot); try { Assert-FenceSnapshotSafety $Snapshot; throw 'unexpected release identity acceptance' } catch { if ($_.Exception.Message -match 'unexpected release identity acceptance' -or $_.Exception.Message -notmatch 'release connection|role classification') { throw } } }; "
        + "$valid = $json | ConvertFrom-Json; Assert-FenceSnapshotSafety $valid; "
        + "$human = $json | ConvertFrom-Json; $human.previous.database.releaseConnection.roleClass = 'operator@example.com'; Assert-ReleaseIdentityRejected $human; "
        + "$coercible = $json | ConvertFrom-Json; $coercible.previous.database.releaseConnection.roleClass = $true; Assert-ReleaseIdentityRejected $coercible; "
        + "$writableStatus = $json | ConvertFrom-Json; $writableStatus.previous.database.releaseConnection.transactionReadOnly = $false; Assert-ReleaseIdentityRejected $writableStatus; "
        + "$raw = $json | ConvertFrom-Json; $raw.previous.database.releaseConnection | Add-Member -NotePropertyName sessionUser -NotePropertyValue 'operator@example.com'; Assert-ReleaseIdentityRejected $raw; "
        + "$script:badLiveStatus = $json | ConvertFrom-Json; $script:badLiveStatus.previous.database.releaseConnection.roleClass = 'unexpected'; function Invoke-FenceDatabaseQuery { param($Sql, [switch]$ReadOnly, [switch]$ExpectSingleJsonRow); return [pscustomobject]@{ write_fence_status = $script:badLiveStatus.previous.database } }; try { Read-FenceDatabaseStatus | Out-Null; throw 'unexpected live identity acceptance' } catch { if ($_.Exception.Message -match 'unexpected live identity acceptance' -or $_.Exception.Message -notmatch 'release connection|role classification') { throw } }; "
        + "Write-Output 'RELEASE_ROLE_CLASS_PINNED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RELEASE_ROLE_CLASS_PINNED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("exact activation baselines reject management and database drift", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-drift-"));
  const management = {
    network: { ipv4: ["203.0.113.1/32"], ipv6: [], status: "applied", entitlement: "allowed" },
    realtime: { suspend: false },
    auth: { disableSignup: false },
  };
  const database = {
    contract: "database-readonly-realtime-cron-v1",
    database: "postgres",
    roles: { authenticator: { exists: true, configuredValue: null } },
    cron: { launchActiveJobs: "on", autoOverridePresent: false, autoOverrideValue: null },
    drain: {
      activeTransactions: 0,
      runningCronJobs: 0,
      protectedRoleSessions: 0,
      oldestProtectedRoleSessionAtUtc: null,
      clientBackendSessions: 0,
      unclassifiedClientBackends: 0,
      unclassifiedWriterSessions: 0,
      oldestClientBackendStartAtUtc: null,
      newestClientBackendStartAtUtc: null,
    },
    backendBoundary: {
      observedAtUtc: "2026-07-12T00:00:00.0000000+00:00",
      postmasterStartedAtUtc: "2026-07-11T00:00:00.0000000+00:00",
      clientBackendSessions: 0,
      unclassifiedClientBackends: 0,
      unclassifiedWriterSessions: 0,
      oldestClientBackendStartAtUtc: null,
      newestClientBackendStartAtUtc: null,
    },
    releaseConnection: { roleClass: "supabase_project_postgres", transactionReadOnly: true },
  };

  try {
    const result = runPowerShell(
      `$expectedManagement = ${quotePowerShell(JSON.stringify(management))} | ConvertFrom-Json; `
        + `$actualManagement = ${quotePowerShell(JSON.stringify(management))} | ConvertFrom-Json; `
        + "$actualManagement.auth.disableSignup = $true; "
        + "if (Test-ExactManagementBaselineMatches $actualManagement $expectedManagement) { throw 'management drift accepted' }; "
        + `$expectedDatabase = ${quotePowerShell(JSON.stringify(database))} | ConvertFrom-Json; `
        + `$actualDatabase = ${quotePowerShell(JSON.stringify(database))} | ConvertFrom-Json; `
        + "$actualDatabase.backendBoundary.observedAtUtc = '2026-07-12T00:01:00.0000000+00:00'; "
        + "if (-not (Test-ExactDatabaseCaptureBaselineMatches $actualDatabase $expectedDatabase)) { throw 'volatile observation time rejected' }; "
        + "$actualDatabase.drain.activeTransactions = 1; "
        + "if (Test-ExactDatabaseCaptureBaselineMatches $actualDatabase $expectedDatabase) { throw 'database drift accepted' }; "
        + "$expectedDatabase.backendBoundary.clientBackendSessions = 1; "
        + "$expectedDatabase.backendBoundary.unclassifiedClientBackends = 1; "
        + "try { Assert-DatabaseBackendBaselineClassifiable $expectedDatabase; throw 'unknown backend accepted' } "
        + "catch { if ($_.Exception.Message -match 'unknown backend accepted' -or $_.Exception.Message -notmatch 'unknown or unclassifiable') { throw } }; "
        + "Write-Output 'DRIFT_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRIFT_REJECTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("the session fence captures, terminates, and verifies every pre-fence client backend without query text", () => {
  const fence = readFileSync(fenceScript, "utf8");
  const statusSql = readFileSync(
    path.join(repoRoot, "scripts", "sql", "supabase-write-fence-status.sql"),
    "utf8"
  );
  const terminationStart = fence.indexOf("$terminationSql = @'");
  const terminationEnd = fence.indexOf("'@", terminationStart + 20);
  const terminationSql = fence.slice(terminationStart, terminationEnd);

  assert.ok(terminationStart >= 0 && terminationEnd > terminationStart);
  assert.match(terminationSql, /backend_type\s*=\s*'client backend'/i);
  assert.match(terminationSql, /pid\s*<>\s*pg_backend_pid\(\)/i);
  assert.match(terminationSql, /targetedClientBackends/i);
  assert.match(terminationSql, /unclassifiedPreFenceClientBackends/i);
  assert.match(terminationSql, /terminationFailures/i);
  assert.doesNotMatch(terminationSql, /activity\.usename\s+IN\s*\(/i);

  for (const field of [
    "backendBoundary",
    "postmasterStartedAtUtc",
    "clientBackendSessions",
    "unclassifiedClientBackends",
    "unclassifiedWriterSessions",
    "oldestClientBackendStartAtUtc",
    "newestClientBackendStartAtUtc",
  ]) {
    assert.match(statusSql, new RegExp(field, "i"));
  }
  assert.match(statusSql, /backend_type\s*=\s*'client backend'/i);
  assert.doesNotMatch(statusSql, /activity\.query\b/i);
  assert.doesNotMatch(statusSql, /'query'\s*,/i);
  assert.doesNotMatch(statusSql, /client_addr/i);
});

test("database SQL is pinned to the explicit project Management API with strict read-only row responses", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-database-api-"));
  try {
    const result = runPowerShell(
      "$script:databaseCalls = [Collections.Generic.List[object]]::new(); "
        + "$script:ManagementAccessToken = 'offline-credential'; "
        + "function Invoke-FenceDatabaseApiRequest { param([string]$Path, $Body, [switch]$ExpectRows); "
        + "$script:databaseCalls.Add([pscustomobject]@{ path = $Path; body = $Body; expectRows = $ExpectRows.IsPresent }); "
        + "if ($ExpectRows) { Write-Output -NoEnumerate ([object[]]@([pscustomobject]@{ probe = 'ok' })) } }; "
        + "$row = Invoke-FenceDatabaseQuery -Sql 'SELECT 1' -ReadOnly -ExpectSingleJsonRow; "
        + "Invoke-FenceDatabaseQuery -Sql 'ALTER ROLE example' | Out-Null; "
        + "if ($row.probe -ne 'ok' -or $script:databaseCalls.Count -ne 2) { throw 'database response changed' }; "
        + "$read = $script:databaseCalls[0]; $write = $script:databaseCalls[1]; "
        + `if ($read.path -ne '/v1/projects/${offlineProjectRef}/database/query' -or $write.path -ne $read.path) { throw 'database path not pinned' }; `
        + "if ($read.body.query -ne 'SELECT 1' -or $read.body.read_only -isnot [bool] -or $read.body.read_only -ne $true -or $write.body.read_only -isnot [bool] -or $write.body.read_only -ne $false -or -not $read.expectRows -or $write.expectRows) { throw 'read-only contract changed' }; "
        + "function Assert-RowsRejected { param([string]$Json); try { ConvertFrom-FenceDatabaseRowsJson $Json | Out-Null; throw 'unexpected database response acceptance' } catch { if ($_.Exception.Message -match 'unexpected database response acceptance' -or $_.Exception.Message -notmatch 'unexpected result shape') { throw } } }; "
        + "Assert-RowsRejected '{}'; Assert-RowsRejected '[\"raw-row\"]'; Assert-RowsRejected '{\"rows\":[]}'; "
        + "Write-Output 'DATABASE_API_PINNED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DATABASE_API_PINNED/);

    const fence = readFileSync(fenceScript, "utf8");
    assert.match(fence, /\/v1\/projects\/\$ExpectedProjectRef\/database\/query/);
    assert.match(fence, /read_only\s*=\s*\[bool\]\$ReadOnly/);
    assert.doesNotMatch(fence, /corepack\s+pnpm\s+exec\s+supabase/i);
    assert.doesNotMatch(fence, /--linked/);
    assert.doesNotMatch(fence, /SUPABASE_DB_PASSWORD/);
    assert.doesNotMatch(fence, /SUPABASE_ACCESS_TOKEN/);
    assert.doesNotMatch(fence, /database password/i);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("database API accepts only HTTP 201 row arrays and never reflects provider failures", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-database-http-"));
  try {
    const result = runPowerShell(
      "$script:ManagementAccessToken = 'offline-credential'; "
        + "function Invoke-WebRequest { param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec, $ErrorAction, [switch]$UseBasicParsing); $script:lastDatabaseRequest = [pscustomobject]@{ method = $Method; uri = $Uri; body = $Body }; return [pscustomobject]@{ StatusCode = 201; Content = '[{\"probe\":\"ok\"}]' } }; "
        + "$body = [ordered]@{ query = 'SELECT 1'; read_only = $true }; "
        + `$rows = Invoke-FenceDatabaseApiRequest -Path '/v1/projects/${offlineProjectRef}/database/query' -Body $body -ExpectRows; `
        + "if ($rows -isnot [array] -or $rows.Count -ne 1 -or $rows[0].probe -ne 'ok' -or $script:lastDatabaseRequest.method -ne 'Post' -or $script:lastDatabaseRequest.uri -notmatch '/database/query$' -or ($script:lastDatabaseRequest.body | ConvertFrom-Json).read_only -ne $true) { throw 'valid 201 response rejected' }; "
        + "function Invoke-WebRequest { throw 'provider-raw-body-must-not-escape' }; "
        + `try { Invoke-FenceDatabaseApiRequest -Path '/v1/projects/${offlineProjectRef}/database/query' -Body $body -ExpectRows; throw 'unexpected provider failure acceptance' } `
        + "catch { if ($_.Exception.Message -match 'provider-raw-body|unexpected provider failure acceptance' -or $_.Exception.Message -notmatch 'project-scoped database API operation failed') { throw } }; "
        + "function Invoke-WebRequest { return [pscustomobject]@{ StatusCode = 200; Content = '[{\"probe\":\"ok\"}]' } }; "
        + `try { Invoke-FenceDatabaseApiRequest -Path '/v1/projects/${offlineProjectRef}/database/query' -Body $body -ExpectRows; throw 'unexpected status acceptance' } `
        + "catch { if ($_.Exception.Message -match 'unexpected status acceptance' -or $_.Exception.Message -notmatch 'unexpected status') { throw } }; "
        + "Write-Output 'DATABASE_HTTP_STRICT'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DATABASE_HTTP_STRICT/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("remote polling stays below the provider limit and preserves a recovery reserve", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-request-budget-"));
  try {
    const result = runPowerShell(
      "Assert-FenceRemoteBudgetContract; "
        + "$script:RemoteRequestTimestamps.Clear(); "
        + "for ($index = 0; $index -lt $script:NormalRemoteRequestLimit; $index += 1) { $script:RemoteRequestTimestamps.Enqueue([DateTimeOffset]::UtcNow) }; "
        + "try { Enter-FenceRemoteRequestBudget; throw 'unexpected normal budget access' } catch { if ($_.Exception.Message -match 'unexpected normal budget access' -or $_.Exception.Message -notmatch 'request budget') { throw } }; "
        + "$script:UsingRecoveryRequestReserve = $true; Enter-FenceRemoteRequestBudget; "
        + "if ($script:RemoteRequestTimestamps.Count -ne ($script:NormalRemoteRequestLimit + 1)) { throw 'recovery reserve unavailable' }; "
        + "Write-Output 'REQUEST_BUDGET_RESERVED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /REQUEST_BUDGET_RESERVED/);

    const fence = readFileSync(fenceScript, "utf8");
    assert.match(fence, /ProviderRemoteRequestLimitPerMinute\s*=\s*120/);
    assert.match(fence, /RecoveryRequestReserve\s*=\s*48/);
    assert.match(fence, /PollIntervalMilliseconds\s*=\s*3000/);
    const networkWait = fence.slice(
      fence.indexOf("function Wait-NetworkFenceEnforced"),
      fence.indexOf("function Wait-FenceDrain")
    );
    assert.match(networkWait, /Get-LiveNetworkState/);
    assert.doesNotMatch(networkWait, /Get-LiveManagementState/);
    const managementWait = fence.slice(
      fence.indexOf("function Wait-ManagementStateRestored"),
      fence.indexOf("function Wait-NetworkStateRestored")
    );
    assert.match(managementWait, /Get-LiveRealtimeState/);
    assert.match(managementWait, /Get-LiveAuthState/);
    assert.doesNotMatch(managementWait, /Get-LiveManagementState/);
    const restoredNetworkWait = fence.slice(
      fence.indexOf("function Wait-NetworkStateRestored"),
      fence.indexOf("function Wait-DatabaseRoleStateRestored")
    );
    assert.match(restoredNetworkWait, /Get-LiveNetworkState/);
    assert.doesNotMatch(restoredNetworkWait, /Get-LiveManagementState/);
    const activation = fence.slice(
      fence.indexOf("function Invoke-FenceActivation"),
      fence.indexOf("# The offline test harness")
    );
    const rollback = activation.indexOf("Restore-Fence $AccessToken $Snapshot $Path");
    assert.ok(rollback >= 0);
    assert.equal(
      activation.slice(0, rollback).lastIndexOf("$script:UsingRecoveryRequestReserve = $true"),
      -1
    );
    const restore = fence.slice(
      fence.indexOf("function Restore-Fence"),
      fence.indexOf("function Invoke-FenceActivation")
    );
    const restoreCatch = restore.indexOf("$script:UsingRecoveryRequestReserve = $true");
    const refence = restore.indexOf("Set-NetworkFence $AccessToken $Snapshot", restoreCatch);
    assert.ok(restoreCatch >= 0 && refence > restoreCatch);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("operational entrypoint exposes Plan only and has no remote dispatcher", () => {
  const fence = readFileSync(fenceScript, "utf8");
  const remoteStop = fence.indexOf('if ($Action -ne "Plan")');
  const companionBoundary = fence.indexOf("$injectedReleaseTargetsJson");
  const firstFunction = fence.indexOf("function Convert-SecureStringToPlainText");
  const planBoundary = fence.indexOf('if ($Action -eq "Plan")');
  const operationalTail = fence.slice(planBoundary);

  assert.ok(remoteStop >= 0);
  assert.ok(companionBoundary > remoteStop);
  assert.ok(firstFunction > remoteStop);
  assert.ok(planBoundary >= 0);
  assert.equal(fence.indexOf('if ($Action -eq "MarkMigrationStarted")', planBoundary), -1);
  assert.equal(fence.indexOf('if ($Action -eq "MarkMigrationVerified")', planBoundary), -1);
  assert.equal(fence.indexOf("$snapshot.state = \"migration_in_progress\"", planBoundary), -1);
  assert.doesNotMatch(operationalTail, /Read-FenceSecret|switch \(\$Action\)|Restore-Fence/);
  assert.match(operationalTail, /invalid post-Plan state/);
});

test("restore verifies Auth and Realtime, roles, network, then cron in fail-closed order", () => {
  const fence = readFileSync(fenceScript, "utf8");
  const restore = fence.slice(
    fence.indexOf("function Restore-Fence"),
    fence.indexOf("function Invoke-FenceActivation")
  );
  const management = restore.indexOf("Restore-ManagementFence $AccessToken $Snapshot");
  const managementVerified = restore.indexOf("Wait-ManagementStateRestored $AccessToken $Snapshot");
  const roles = restore.indexOf("Restore-DatabaseRoleFence $Snapshot", managementVerified);
  const rolesVerified = restore.indexOf("Wait-DatabaseRoleStateRestored $Snapshot", roles);
  const network = restore.indexOf("Restore-NetworkFence $AccessToken $Snapshot", rolesVerified);
  const networkVerified = restore.indexOf("Wait-NetworkStateRestored $AccessToken $Snapshot", network);
  const cron = restore.indexOf("Restore-CronFence $Snapshot");
  assert.ok(management >= 0);
  assert.ok(managementVerified > management);
  assert.ok(roles > managementVerified);
  assert.ok(rolesVerified > roles);
  assert.ok(network > rolesVerified);
  assert.ok(networkVerified > network);
  assert.ok(cron > networkVerified);

  const managementRestore = fence.slice(
    fence.indexOf("function Restore-ManagementFence"),
    fence.indexOf("function Restore-NetworkFence")
  );
  const networkRestore = fence.slice(
    fence.indexOf("function Restore-NetworkFence"),
    fence.indexOf("function Test-DatabaseRoleBaselineMatches")
  );
  const auth = managementRestore.indexOf('/config/auth"');
  const realtime = managementRestore.indexOf('/config/realtime"');
  assert.ok(auth >= 0);
  assert.ok(realtime > auth);
  assert.equal(managementRestore.indexOf("/network-restrictions/apply"), -1);
  assert.ok(networkRestore.indexOf("/network-restrictions/apply") >= 0);
});

test("restore transitions reject released, wrong-state, untouched recovery, and stale-HEAD journal replay", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-restore-replay-"));
  const replayPath = journalPathFor(stateRoot, "00000000-0000-4000-8000-000000000009");
  const snapshot = offlineSnapshot("00000000-0000-4000-8000-000000000009");
  const activeSnapshot = activeOfflineSnapshot("00000000-0000-4000-8000-000000000009");
  try {
    const result = runPowerShell(
      `$json = ${quotePowerShell(JSON.stringify(snapshot))}; `
        + `$activeJson = ${quotePowerShell(JSON.stringify(activeSnapshot))}; `
        + "$script:forceHeadMismatch = $false; function Assert-SnapshotHead { param($Snapshot); if ($script:forceHeadMismatch) { throw 'Current Git HEAD or tree no longer matches' } }; "
        + "function Assert-RestoreRejected { param($Snapshot, [string]$Mode, [string]$Pattern); try { Assert-RestoreTransitionAllowed $Snapshot $Mode; throw 'unexpected restore transition acceptance' } catch { if ($_.Exception.Message -match 'unexpected restore transition acceptance' -or $_.Exception.Message -notmatch $Pattern) { throw } } }; "
        + "$released = $json | ConvertFrom-Json; $released.state = 'released'; Assert-RestoreRejected $released 'Deactivate' 'terminal|released'; "
        + "$captured = $json | ConvertFrom-Json; Assert-RestoreRejected $captured 'Deactivate' 'transition|state'; "
        + "Assert-RestoreRejected $captured 'Recover' 'state|recovery'; "
        + "$untouched = $json | ConvertFrom-Json; $untouched.state = 'manual_recovery_required'; Assert-RestoreRejected $untouched 'Recover' 'touched|control'; "
        + "$active = $activeJson | ConvertFrom-Json; Assert-RestoreTransitionAllowed $active 'Deactivate'; "
        + "$recoverable = $json | ConvertFrom-Json; $recoverable.state = 'manual_recovery_required'; $recoverable.steps = @([pscustomobject]@{ name = 'network'; status = 'pending'; recordedAtUtc = [DateTimeOffset]::UtcNow.ToString('o') }); Assert-RestoreTransitionAllowed $recoverable 'Recover'; "
        + "$crashBeforeMutation = $json | ConvertFrom-Json; $crashBeforeMutation.state = 'activating'; Assert-RestoreTransitionAllowed $crashBeforeMutation 'Recover'; "
        + "foreach ($crashState in @('activating', 'activation_failed', 'restoring')) { foreach ($control in @('network', 'realtime', 'auth', 'roles', 'cron')) { foreach ($status in @('pending', 'applied')) { $crashed = $json | ConvertFrom-Json; $crashed.state = $crashState; $crashed.steps = @([pscustomobject]@{ name = $control; status = $status; recordedAtUtc = [DateTimeOffset]::UtcNow.ToString('o') }); Assert-RestoreTransitionAllowed $crashed 'Recover' } } }; "
        + "$failedUntouched = $json | ConvertFrom-Json; $failedUntouched.state = 'activation_failed'; Assert-RestoreRejected $failedUntouched 'Recover' 'touched|control'; "
        + `Write-FenceSnapshot -Path ${quotePowerShell(replayPath)} -Snapshot $active -CreateNew; `
        + "$script:forceHeadMismatch = $true; "
        + `try { Restore-Fence 'offline-credential' $active ${quotePowerShell(replayPath)} 'Deactivate'; throw 'unexpected stale HEAD restore' } catch { if ($_.Exception.Message -match 'unexpected stale HEAD restore' -or $_.Exception.Message -notmatch 'HEAD or tree') { throw } }; `
        + "Write-Output 'RESTORE_REPLAY_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RESTORE_REPLAY_REJECTED/);

    const fence = readFileSync(fenceScript, "utf8");
    const restore = fence.slice(
      fence.indexOf("function Restore-Fence"),
      fence.indexOf("function Invoke-FenceActivation")
    );
    const transition = restore.indexOf("Assert-RestoreTransitionAllowed $Snapshot $Mode");
    const firstWrite = restore.indexOf('Write-FenceSnapshot $Path $Snapshot');
    const firstRemote = restore.indexOf("Restore-ManagementFence $AccessToken $Snapshot");
    assert.ok(transition >= 0 && firstWrite > transition && firstRemote > firstWrite);
    for (const verifier of [
      "Wait-ManagementStateRestored $AccessToken $Snapshot",
      "Wait-DatabaseRoleStateRestored $Snapshot",
      "Wait-NetworkStateRestored $AccessToken $Snapshot",
      "Assert-FenceRestored $AccessToken $Snapshot",
    ]) {
      assert.ok(restore.indexOf(verifier) > firstWrite);
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("remote hard-stop precedes companion, Git, journal, credential, and remote boundaries", () => {
  const fence = readFileSync(fenceScript, "utf8");
  const remoteStop = fence.indexOf('if ($Action -ne "Plan")');
  for (const boundary of [
    "$injectedReleaseTargetsJson",
    'Get-Content -Raw -LiteralPath "scripts/release-targets.json"',
    "function Get-CleanReviewedGitIdentity",
    "function Enter-ProjectFenceLifecycleLock",
    "function Read-FenceSecret",
    'function Invoke-FenceDatabaseApiRequest',
  ]) {
    assert.ok(fence.indexOf(boundary) > remoteStop, `${boundary} must follow the stop`);
  }
});

test("a visible final journal payload preserves the no-refence durability marker", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-visible-marker-"));
  const fenceId = "00000000-0000-4000-8000-000000000024";
  const snapshotPath = journalPathFor(stateRoot, fenceId);
  const active = activeOfflineSnapshot(fenceId);
  const released = structuredClone(active);
  released.state = "released";
  released.steps.push({
    name: "restore",
    status: "applied",
    recordedAtUtc: new Date().toISOString(),
  });
  try {
    const result = runPowerShell(
      `$active = ${quotePowerShell(JSON.stringify(active))} | ConvertFrom-Json; `
        + `$released = ${quotePowerShell(JSON.stringify(released))} | ConvertFrom-Json; `
        + `Write-FenceSnapshot -Path ${quotePowerShell(snapshotPath)} -Snapshot $active -CreateNew; `
        + "function Publish-FenceSnapshotFile { param([string]$Temporary, [string]$Path, [switch]$CreateNew); $backup = \"$Path.test.bak\"; [IO.File]::Replace($Temporary, $Path, $backup, $true); Remove-Item -LiteralPath $backup -Force; throw 'simulated metadata failure' }; "
        + `try { Write-FenceSnapshot -Path ${quotePowerShell(snapshotPath)} -Snapshot $released; throw 'unexpected visible publish success' } `
        + "catch { if ($_.Exception.Message -match 'unexpected visible publish success' -or $_.Exception.Data['WriteFencePublishedPayloadVisible'] -ne $true) { throw } }; "
        + "Write-Output 'VISIBLE_MARKER_PRESERVED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VISIBLE_MARKER_PRESERVED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a visible released publish with failed metadata sync never re-fences restored live controls", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-terminal-publish-"));
  const fenceId = "00000000-0000-4000-8000-000000000015";
  const snapshotPath = journalPathFor(stateRoot, fenceId);
  const snapshot = activeOfflineSnapshot(fenceId);
  try {
    const result = runPowerShell(
      `$snapshot = ${quotePowerShell(JSON.stringify(snapshot))} | ConvertFrom-Json; `
        + `Write-FenceSnapshot -Path ${quotePowerShell(snapshotPath)} -Snapshot $snapshot -CreateNew; `
        + "$script:refenceCalls = 0; "
        + "function Assert-SnapshotHead { param($Snapshot) }; "
        + "function Restore-ManagementFence { param($AccessToken, $Snapshot); $script:stage = 'restore-management' }; function Wait-ManagementStateRestored { param($AccessToken, $Snapshot); $script:stage = 'verify-management' }; "
        + "function Restore-DatabaseRoleFence { param($Snapshot); $script:stage = 'restore-roles' }; function Restore-CronFence { param($Snapshot); $script:stage = 'restore-cron' }; "
        + "function Restore-NetworkFence { param($AccessToken, $Snapshot); $script:stage = 'restore-network' }; function Wait-NetworkStateRestored { param($AccessToken, $Snapshot); $script:stage = 'verify-network' }; "
        + "function Wait-DatabaseRoleStateRestored { param($Snapshot); $script:stage = 'verify-roles' }; function Assert-FenceRestored { param($AccessToken, $Snapshot); $script:stage = 'live-restored' }; "
        + "function Set-NetworkFence { $script:stage = 'refence'; $script:refenceCalls += 1 }; function Set-RealtimeFence { $script:refenceCalls += 1 }; function Set-AuthFence { $script:refenceCalls += 1 }; function Set-CronFence { $script:refenceCalls += 1 }; "
        + "function Set-DatabaseRoleFence { $script:refenceCalls += 1; return [pscustomobject]@{ appliedAtUtc = [DateTimeOffset]::UtcNow.ToString('o'); targetedClientBackends = 0; unclassifiedPreFenceClientBackends = 0; unmanagedPreFenceWriterBackends = 0; terminationFailures = 0 } }; function Assert-FenceActive { param($AccessToken, $Snapshot) }; "
        + "function Publish-FenceSnapshotFile { param([string]$Temporary, [string]$Path, [switch]$CreateNew); if (Test-Path -LiteralPath $Path) { $backup = \"$Path.test.bak\"; [IO.File]::Replace($Temporary, $Path, $backup, $true); Remove-Item -LiteralPath $backup -Force } else { [IO.File]::Move($Temporary, $Path) }; $published = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json; $script:stage = ('publish-' + $published.state); if ($published.state -eq 'released') { throw 'simulated directory metadata sync failure after rename' } }; "
        + `try { Restore-Fence 'offline-credential' $snapshot ${quotePowerShell(snapshotPath)} 'Deactivate'; throw 'unexpected terminal publish success' } `
        + "catch { if ($_.Exception.Message -match 'unexpected terminal publish success' -or $_.Exception.Message -notmatch 'restored|released|durability|metadata') { throw ($script:stage + ': ' + $_.Exception.Message) } }; "
        + "if ($script:refenceCalls -ne 0) { throw 'restored live controls were re-fenced after visible terminal publish' }; "
        + `if ((Get-Content -Raw -LiteralPath ${quotePowerShell(snapshotPath)} | ConvertFrom-Json).state -ne 'released') { throw 'visible released journal was overwritten' }; `
        + "Write-Output 'TERMINAL_PUBLISH_SPLIT_BRAIN_PREVENTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TERMINAL_PUBLISH_SPLIT_BRAIN_PREVENTED/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("project journal inventory prevents split-brain captures and multiple unresolved generations", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "hanbang-fence-generation-"));
  const root = journalRootFor(stateRoot);
  const firstPath = path.join(root, "00000000-0000-4000-8000-000000000010.json");
  const secondPath = path.join(root, "00000000-0000-4000-8000-000000000011.json");
  const thirdPath = path.join(root, "00000000-0000-4000-8000-000000000012.json");
  const first = offlineSnapshot("00000000-0000-4000-8000-000000000010");
  const second = offlineSnapshot("00000000-0000-4000-8000-000000000011");
  const third = offlineSnapshot("00000000-0000-4000-8000-000000000012");
  try {
    await mkdir(root, { recursive: true });
    const excessArtifacts = Array.from(
      { length: 65 },
      (_, index) => path.join(root, `bounded-count-${String(index).padStart(2, "0")}.tmp`)
    );
    await Promise.all(excessArtifacts.map((file) => writeFile(file, "{}", "utf8")));
    const excessCount = runPowerShell(
      "try { Assert-NoUnresolvedFenceJournalForCapture; throw 'unexpected unbounded artifact count' } "
        + "catch { if ($_.Exception.Message -match 'unexpected unbounded artifact count' -or $_.Exception.Message -notmatch 'bounded artifact count') { throw } }; "
        + "Write-Output 'ARTIFACT_COUNT_BOUNDED'",
      stateRoot
    );
    assert.equal(excessCount.status, 0, excessCount.stderr);
    assert.match(excessCount.stdout, /ARTIFACT_COUNT_BOUNDED/);
    await Promise.all(excessArtifacts.map((file) => rm(file, { force: true })));

    const oversizedPath = path.join(root, "00000000-0000-4000-8000-000000000016.json");
    await writeFile(oversizedPath, "x".repeat((1024 * 1024) + 1), "utf8");
    const oversized = runPowerShell(
      "try { Assert-NoUnresolvedFenceJournalForCapture; throw 'unexpected oversized artifact acceptance' } "
        + "catch { if ($_.Exception.Message -match 'unexpected oversized artifact acceptance' -or $_.Exception.Message -notmatch 'bounded size') { throw } }; "
        + "Write-Output 'ARTIFACT_SIZE_BOUNDED'",
      stateRoot
    );
    assert.equal(oversized.status, 0, oversized.stderr);
    assert.match(oversized.stdout, /ARTIFACT_SIZE_BOUNDED/);
    await rm(oversizedPath, { force: true });

    const nonJsonPath = path.join(root, "active.dat");
    await writeFile(nonJsonPath, JSON.stringify(first), "utf8");
    const nonJson = runPowerShell(
      `$SnapshotPath = ${quotePowerShell(nonJsonPath)}; `
        + "try { Resolve-FenceSnapshotPath; throw 'unexpected noncanonical snapshot path' } catch { if ($_.Exception.Message -match 'unexpected noncanonical snapshot path' -or $_.Exception.Message -notmatch 'canonical|UUID|json') { throw } }; "
        + "try { Assert-NoUnresolvedFenceJournalForCapture; throw 'unexpected non-json inventory acceptance' } catch { if ($_.Exception.Message -match 'unexpected non-json inventory acceptance' -or $_.Exception.Message -notmatch 'unsupported|artifact|inventory') { throw } }; "
        + "Write-Output 'NON_JSON_REJECTED'",
      stateRoot
    );
    assert.equal(nonJson.status, 0, nonJson.stderr);
    assert.match(nonJson.stdout, /NON_JSON_REJECTED/);
    await rm(nonJsonPath, { force: true });

    const legacyPath = path.join(root, "00000000-0000-4000-8000-000000000014.json");
    await writeFile(legacyPath, JSON.stringify({ ...first, contract: "legacy-write-fence-v0" }), "utf8");
    const legacy = runPowerShell(
      "try { Assert-NoUnresolvedFenceJournalForCapture; throw 'unexpected legacy contract acceptance' } "
        + "catch { if ($_.Exception.Message -match 'unexpected legacy contract acceptance' -or $_.Exception.Message -notmatch 'unrecognized|contract|artifact') { throw } }; "
        + "Write-Output 'LEGACY_CONTRACT_REJECTED'",
      stateRoot
    );
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.match(legacy.stdout, /LEGACY_CONTRACT_REJECTED/);
    await rm(legacyPath, { force: true });

    const evidencePath = path.join(root, "post-migration-evidence.json");
    const evidence = {
      schemaVersion: 1,
      contract: "post-migration-release-evidence-v1",
      projectRef: offlineProjectRef,
      fenceId: first.fenceId,
      reviewedHead: first.reviewedHead,
      verifiedAtUtc: new Date().toISOString(),
      checks: {
        migrationHistoryExact: true,
        databaseContractPassed: true,
        dataApiWriteDenied: true,
        authWriteDenied: true,
        storageWriteDenied: true,
        releaseConnectionWritable: true,
      },
    };
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    const recognizedEvidence = runPowerShell(
      "Assert-NoUnresolvedFenceJournalForCapture; Write-Output 'EXACT_EVIDENCE_ALLOWLISTED'",
      stateRoot
    );
    assert.equal(recognizedEvidence.status, 0, recognizedEvidence.stderr);
    assert.match(recognizedEvidence.stdout, /EXACT_EVIDENCE_ALLOWLISTED/);
    await rm(evidencePath, { force: true });

    await writeFile(evidencePath, JSON.stringify({ ...evidence, schemaVersion: "1" }), "utf8");
    const coercibleEvidence = runPowerShell(
      "try { Assert-NoUnresolvedFenceJournalForCapture; throw 'unexpected coercible evidence acceptance' } "
        + "catch { if ($_.Exception.Message -match 'unexpected coercible evidence acceptance' -or $_.Exception.Message -notmatch 'invalid allowlisted') { throw } }; "
        + "Write-Output 'COERCIBLE_EVIDENCE_REJECTED'",
      stateRoot
    );
    assert.equal(coercibleEvidence.status, 0, coercibleEvidence.stderr);
    assert.match(coercibleEvidence.stdout, /COERCIBLE_EVIDENCE_REJECTED/);
    await rm(evidencePath, { force: true });

    const result = runPowerShell(
      `$first = ${quotePowerShell(JSON.stringify(first))} | ConvertFrom-Json; `
        + `$second = ${quotePowerShell(JSON.stringify(second))} | ConvertFrom-Json; `
        + `$third = ${quotePowerShell(JSON.stringify(third))} | ConvertFrom-Json; `
        + `Write-FenceSnapshot -Path ${quotePowerShell(firstPath)} -Snapshot $first -CreateNew; `
        + "try { Assert-NoUnresolvedFenceJournalForCapture; throw 'unexpected split-brain capture' } catch { if ($_.Exception.Message -match 'unexpected split-brain capture' -or $_.Exception.Message -notmatch 'unresolved') { throw } }; "
        + `Assert-SnapshotIsSoleUnresolvedJournal -Path ${quotePowerShell(firstPath)} -Snapshot $first; `
        + "$first.state = 'released'; "
        + `Write-FenceSnapshot -Path ${quotePowerShell(firstPath)} -Snapshot $first; `
        + "Assert-NoUnresolvedFenceJournalForCapture; "
        + "$second.state = 'manual_recovery_required'; $second.steps = @([pscustomobject]@{ name = 'network'; status = 'pending'; recordedAtUtc = [DateTimeOffset]::UtcNow.ToString('o') }); "
        + `Write-FenceSnapshot -Path ${quotePowerShell(secondPath)} -Snapshot $second -CreateNew; `
        + "try { Assert-NoUnresolvedFenceJournalForCapture; throw 'unexpected manual split-brain capture' } catch { if ($_.Exception.Message -match 'unexpected manual split-brain capture' -or $_.Exception.Message -notmatch 'unresolved') { throw } }; "
        + `Write-FenceSnapshot -Path ${quotePowerShell(thirdPath)} -Snapshot $third -CreateNew; `
        + `try { Assert-SnapshotIsSoleUnresolvedJournal -Path ${quotePowerShell(secondPath)} -Snapshot $second; throw 'unexpected ambiguous generation acceptance' } catch { if ($_.Exception.Message -match 'unexpected ambiguous generation acceptance' -or $_.Exception.Message -notmatch 'multiple|sole|generation') { throw } }; `
        + "Write-Output 'GENERATION_SPLIT_BRAIN_REJECTED'",
      stateRoot
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GENERATION_SPLIT_BRAIN_REJECTED/);

    const fence = readFileSync(fenceScript, "utf8");
    const capture = fence.slice(
      fence.indexOf("function New-FenceSnapshot"),
      fence.indexOf("function Set-NetworkFence")
    );
    assert.match(capture, /Assert-NoUnresolvedFenceJournalForCapture/);
    const activation = fence.slice(
      fence.indexOf("function Invoke-FenceActivation"),
      fence.indexOf("# The offline test harness")
    );
    assert.match(activation, /Assert-SnapshotIsSoleUnresolvedJournal/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("schema v2 rechecks two stable management and DB samples immediately before the first mutation", () => {
  const fence = readFileSync(fenceScript, "utf8");
  assert.match(fence, /\$script:SnapshotSchemaVersion\s*=\s*2/);
  const recheck = fence.slice(
    fence.indexOf("function Assert-ActivationBaselineUnchanged"),
    fence.indexOf("function New-FenceSnapshot")
  );
  assert.equal((recheck.match(/Get-LiveManagementState \$AccessToken/g) ?? []).length, 2);
  assert.equal((recheck.match(/Read-FenceDatabaseStatus/g) ?? []).length, 2);

  const activation = fence.slice(
    fence.indexOf("function Invoke-FenceActivation"),
    fence.indexOf("# The offline test harness")
  );
  const pending = activation.indexOf('Set-FenceStep $Snapshot "network" "pending"');
  const baseline = activation.indexOf("Assert-ActivationBaselineUnchanged $AccessToken $Snapshot");
  const firstMutation = activation.indexOf("Set-NetworkFence $AccessToken $Snapshot");
  assert.ok(pending >= 0);
  assert.ok(baseline > pending);
  assert.ok(firstMutation > baseline);
});

test("Plan admits local-only coordination and names the provider lease required for production", () => {
  const result = spawnSync(
    powershell,
    [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", fenceScript,
      "-Action", "Plan",
      "-ExpectedProjectRef", offlineProjectRef,
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: 20_000 }
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.remoteCallsExecuted, false);
  assert.equal(plan.coordinationScope, "single_host_local_journal_only");
  assert.ok(plan.productionBlockers.includes("provider_side_project_lease_or_cas_across_hosts_and_ci"));
  assert.ok(plan.productionBlockers.includes("same_lease_migration_started_exact_target_push_evidence_restore"));

  const fence = readFileSync(fenceScript, "utf8");
  assert.match(
    fence,
    /provider-side lease\/CAS, exact-target connection, cross-version recovery receipt, and disposable rehearsal/i,
  );
});
