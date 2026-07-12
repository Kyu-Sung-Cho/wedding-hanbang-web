import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const powershellExecutable = process.platform === "win32" ? "powershell" : "pwsh";
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const fence = readRepo("scripts/supabase-write-fence.ps1");
const statusSql = readRepo("scripts/sql/supabase-write-fence-status.sql");
const releaseTargets = JSON.parse(readRepo("scripts/release-targets.json")) as {
  productionSupabaseProjectRefs: string[];
  approvedNonProductionSupabaseProjectRefs: string[];
  productionDatabaseWriteFence: string;
};

describe("database-readonly-realtime-cron-v1 write fence", () => {
  it("hard-stops protected production before credentials or remote operations while the checked-in fuse is open", () => {
    expect(releaseTargets.productionDatabaseWriteFence).toBe("not_configured");
    expect(releaseTargets.approvedNonProductionSupabaseProjectRefs).toEqual([]);
    expect(fence).toContain('$script:Contract = "database-readonly-realtime-cron-v1"');
    expect(fence).toContain('productionDatabaseWriteFence -ne "verified-v1"');

    const productionGuard = fence.indexOf('productionDatabaseWriteFence -ne "verified-v1"');
    const permanentGuard = fence.indexOf("Protected production write-fence actions remain disabled", productionGuard);
    const credentialPrompt = fence.indexOf("Read-Host", productionGuard);
    const managementRequest = fence.indexOf("Invoke-RestMethod", productionGuard);
    const databaseQuery = fence.indexOf("supabase db query", productionGuard);

    expect(productionGuard).toBeGreaterThanOrEqual(0);
    expect(permanentGuard).toBeGreaterThan(productionGuard);
    for (const remoteBoundary of [credentialPrompt, managementRequest, databaseQuery]) {
      expect(remoteBoundary).toBeGreaterThan(productionGuard);
    }
  });

  it("declares a single JSON status row for the readonly roles, cron launcher, and drain evidence", () => {
    expect(statusSql).toContain("database-readonly-realtime-cron-v1");
    expect(statusSql).toContain("default_transaction_read_only");
    expect(statusSql).toContain("cron.launch_active_jobs");
    expect(statusSql).toContain("pg_stat_activity");
    expect(statusSql).toContain("jsonb_build_object");
  });

  it("exposes a local Plan action that performs no remote work and never accepts credentials as CLI arguments", () => {
    const scriptPath = resolve(repoRoot, "scripts/supabase-write-fence.ps1");
    const output = execFileSync(
      powershellExecutable,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Action",
        "Plan",
        "-ExpectedProjectRef",
        "abcdefghijklmnopqrst",
        "-ReleaseIpv4Cidr",
        "203.0.113.10/32",
      ],
      { encoding: "utf8" }
    );
    const plan = JSON.parse(output) as {
      contract: string;
      remoteCallsExecuted: boolean;
      operations: string[];
    };

    expect(plan).toEqual(
      expect.objectContaining({
        contract: "database-readonly-realtime-cron-v1",
        remoteCallsExecuted: false,
      })
    );
    expect(plan.operations).toEqual([
      "restrict_database_network",
      "suspend_and_shutdown_realtime",
      "disable_auth_signup",
      "set_service_roles_read_only",
      "stop_and_drain_pg_cron",
      "verify_release_connection_writable",
    ]);
    const cliParamBlock = fence.slice(0, fence.indexOf("Set-StrictMode"));
    expect(cliParamBlock).not.toMatch(
      /\[(?:string|Security\.SecureString)\]\$(?:AccessToken|DatabasePassword)/
    );
    expect(output).not.toMatch(/token|password|secret/i);
  });

  it("binds activation to the exact network, Realtime, Auth, database-role, cron, and release-writer controls", () => {
    expect(fence).toContain('$script:ManagementApiBase = "https://api.supabase.com"');
    expect(fence).toContain("/network-restrictions/apply");
    expect(fence).toContain("dbAllowedCidrs");
    expect(fence).toContain("/config/realtime");
    expect(fence).toContain("/config/realtime/shutdown");
    expect(fence).toContain("suspend = $true");
    expect(fence).toContain("/config/auth");
    expect(fence).toContain("disable_signup = $true");

    for (const role of [
      "authenticator",
      "supabase_auth_admin",
      "supabase_storage_admin",
      "dashboard_user",
    ]) {
      expect(fence).toContain(
        `ALTER ROLE ${role} IN DATABASE postgres SET default_transaction_read_only TO on`
      );
      expect(statusSql).toContain(`('${role}'::text)`);
    }
    expect(fence).toContain("pg_terminate_backend");
    expect(fence).toContain("ALTER SYSTEM SET cron.launch_active_jobs TO off");
    expect(fence).toContain("SELECT pg_reload_conf()");
    expect(fence).toContain("CREATE TABLE public.release_fence_write_probe");
    expect(fence).not.toContain("CREATE TEMP TABLE release_fence_write_probe");
    expect(fence).toContain("ROLLBACK");
    expect(fence).toContain("ALTER ROLE transaction must commit before this separate connection");
  });

  it("captures enough database state for exact rollback without exposing SQL text or activity queries", () => {
    expect(statusSql).toContain("configuredValue");
    expect(statusSql).toContain("autoOverridePresent");
    expect(statusSql).toContain("autoOverrideValue");
    expect(statusSql).toContain("runningCronJobs");
    expect(statusSql).toContain("protectedRoleSessions");
    expect(statusSql).toContain("releaseConnection");
    expect(statusSql).toContain("transactionReadOnly");
    expect(statusSql).toContain("pg_file_settings");
    expect(statusSql).toContain("cron.job_run_details");
    expect(statusSql).not.toMatch(/'query'\s*,/i);
    expect(statusSql).not.toMatch(/'command'\s*,/i);
    expect(statusSql).not.toContain("sourcefile',");
  });

  it("rechecks the reviewed HEAD before activation and makes migration start an explicit irreversible journal boundary", () => {
    expect(fence).toContain('"MarkMigrationStarted"');
    expect(fence).toContain("function Assert-SnapshotHead");
    expect(fence).toContain("function Get-CleanReviewedGitIdentity");
    expect(fence).toContain('git status --porcelain=v1 --untracked-files=all');
    expect(fence).toContain("reviewedTree = $identity.tree");
    const activation = fence.indexOf("function Invoke-FenceActivation");
    const headCheck = fence.indexOf("Assert-SnapshotHead $Snapshot", activation);
    const firstRemoteMutation = fence.indexOf("Set-NetworkFence $AccessToken $Snapshot", activation);
    expect(headCheck).toBeGreaterThan(activation);
    expect(firstRemoteMutation).toBeGreaterThan(headCheck);

    expect(fence).toContain('$snapshot.migrationStarted = $true');
    expect(fence).toContain('$snapshot.state = "migration_in_progress"');
    expect(fence).toContain('Set-FenceStep $snapshot "migration" "started"');
    expect(fence).toContain('$Snapshot.state = "manual_recovery_required"');
    expect(fence).toContain(
      "Migration started without separate post-migration evidence; the fence remains active."
    );
  });

  it("journals every mutating step before execution so ambiguous timeouts remain recoverable", () => {
    expect(fence).toContain("function Test-FenceStepTouched");
    const activation = fence.slice(
      fence.indexOf("function Invoke-FenceActivation"),
      fence.indexOf('if ($Action -eq "Plan")')
    );
    const mutations = [
      ["network", "Set-NetworkFence $AccessToken $Snapshot"],
      ["realtime", "Set-RealtimeFence $AccessToken"],
      ["auth", "Set-AuthFence $AccessToken"],
      ["roles", "Set-DatabaseRoleFence"],
      ["cron", "Set-CronFence"],
    ] as const;

    for (const [step, mutation] of mutations) {
      const pending = activation.indexOf(`Set-FenceStep $Snapshot "${step}" "pending"`);
      const call = activation.indexOf(mutation);
      const applied = activation.indexOf(`Set-FenceStep $Snapshot "${step}" "applied"`);
      expect(pending).toBeGreaterThanOrEqual(0);
      expect(call).toBeGreaterThan(pending);
      expect(applied).toBeGreaterThan(call);
    }
    expect(fence).toContain('$_.status -in @("pending", "applied")');
  });

  it("scopes both hidden credentials to child-process environment and restores prior values", () => {
    expect(fence).toContain("$previousManagementAccessToken = $env:SUPABASE_ACCESS_TOKEN");
    expect(fence).toContain("$env:SUPABASE_ACCESS_TOKEN = $managementToken");
    expect(fence).toContain("Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue");
    expect(fence).toContain("$env:SUPABASE_ACCESS_TOKEN = $previousManagementAccessToken");

    const queryHelper = fence.slice(
      fence.indexOf("function Invoke-FenceDatabaseQuery"),
      fence.indexOf("function Read-FenceDatabaseStatus")
    );
    expect(queryHelper).not.toContain("-AccessToken");
    expect(queryHelper).not.toContain("-DatabasePassword");
  });

  it("waits for positive network-enforcement evidence and a transaction/cron drain", () => {
    expect(fence).toContain('$script:EnforcedNetworkStatuses = @("applied")');
    expect(fence).toContain('$script:PendingNetworkStatuses = @("stored")');
    expect(fence).toContain("function Wait-NetworkFenceEnforced");
    expect(fence).toContain("Network restriction status cannot prove enforcement");
    expect(fence).toContain("Network restriction did not become enforced before the bounded timeout");
    expect(fence).toContain('entitlement = [string](Get-OptionalProperty $Response "entitlement" "")');
    expect(fence).toContain('$networkEntitlement -ne "allowed"');
    expect(fence).toContain("Captured network baseline is not proven applied and entitled");

    const verification = fence.slice(
      fence.indexOf("function Assert-FenceActive"),
      fence.indexOf("function Restore-DatabaseFence")
    );
    expect(verification).toContain("Wait-NetworkFenceEnforced $AccessToken $Snapshot");

    const drain = fence.slice(
      fence.indexOf("function Wait-FenceDrain"),
      fence.indexOf("function Assert-FenceActive")
    );
    expect(drain).toContain("$protectedRoleSessions = [long]$status.drain.protectedRoleSessions");
    expect(drain).toContain("$oldest -lt $roleFenceAppliedAt");
    expect(drain).toContain("-not $oldProtectedSessions");
    expect(statusSql).toContain("oldestProtectedRoleSessionAtUtc");
    expect(fence).toContain("terminationFailures");
  });

  it("holds the linked-project lock and accepts both pinned CLI JSON row shapes", () => {
    expect(fence).toContain("[IO.FileShare]::Read");
    expect(fence).toContain("$linkLock.Dispose()");
    expect(fence).toContain("function ConvertFrom-SupabaseQueryRows");
    expect(fence).toContain("$document -is [Array]");
    expect(fence).toContain('$document.PSObject.Properties.Name -contains "rows"');
  });

  it("requires separate post-migration evidence before a started migration can release the fence", () => {
    expect(fence).toContain('"MarkMigrationVerified"');
    expect(fence).toContain("[string]$PostMigrationEvidencePath");
    expect(fence).toContain("function Read-PostMigrationEvidence");
    expect(fence).toContain("post-migration-release-evidence-v1");
    for (const check of [
      "migrationHistoryExact",
      "databaseContractPassed",
      "dataApiWriteDenied",
      "authWriteDenied",
      "storageWriteDenied",
      "releaseConnectionWritable",
    ]) {
      expect(fence).toContain(`"${check}"`);
    }
    expect(fence).toContain("Get-FileHash -LiteralPath $Path -Algorithm SHA256");
    expect(fence).toContain('$snapshot.state = "migration_verified"');
    expect(fence).toContain("$snapshot.migrationVerified = $true");
    expect(fence).toContain(
      "$Snapshot.migrationStarted -eq $true -and $Snapshot.migrationVerified -ne $true"
    );
    expect(fence).toContain(
      "Production cannot accept operator-authored post-migration evidence"
    );

    const verificationAction = fence.indexOf('if ($Action -eq "MarkMigrationVerified")');
    const credentialBoundary = fence.indexOf("Assert-LinkedProject", verificationAction);
    expect(verificationAction).toBeGreaterThanOrEqual(0);
    expect(credentialBoundary).toBeGreaterThan(verificationAction);
  });

  it("binds snapshot production identity to protected refs and defaults unknown remote refs to denied", () => {
    expect(fence).toContain("function Assert-FenceSnapshotSafety");
    expect(fence).toContain("Assert-FenceSnapshotSafety $snapshot");
    expect(fence).toContain("Write-fence snapshot production identity does not match the protected-ref policy");
    expect(fence).toContain("$snapshot.production -ne $isProductionTarget");
    expect(fence).toContain("Capture refuses to overwrite an existing write-fence journal");

    const result = spawnSync(
      powershellExecutable,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(repoRoot, "scripts/supabase-write-fence.ps1"),
        "-Action",
        "MarkMigrationStarted",
        "-ExpectedProjectRef",
        "abcdefghijklmnopqrst",
        "-SnapshotPath",
        resolve(repoRoot, "missing-snapshot.json"),
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("approved non-production project ref");
  });

  it("keeps service roles read-only until management is verified, resumes cron last, and re-fences on failure", () => {
    expect(fence).toContain("function Restore-CronFence");
    expect(fence).toContain("function Restore-DatabaseRoleFence");
    expect(fence).toContain("function Wait-ManagementStateRestored");
    expect(fence).toContain("function Wait-DatabaseRoleStateRestored");
    expect(fence).toContain("function Wait-DatabaseStateRestored");
    expect(fence).toContain("function Assert-FenceRestored");

    const restore = fence.slice(
      fence.indexOf("function Restore-Fence"),
      fence.indexOf("function Invoke-FenceActivation")
    );
    const management = restore.indexOf("Restore-ManagementFence $AccessToken $Snapshot");
    const managementVerification = restore.indexOf(
      "Wait-ManagementStateRestored $AccessToken $Snapshot"
    );
    const roles = restore.indexOf("Restore-DatabaseRoleFence $Snapshot");
    const roleVerification = restore.indexOf(
      "Wait-DatabaseRoleStateRestored $Snapshot"
    );
    const cron = restore.indexOf("Restore-CronFence $Snapshot");
    const verification = restore.indexOf("Assert-FenceRestored $AccessToken $Snapshot");
    const released = restore.indexOf('$Snapshot.state = "released"');

    expect(management).toBeGreaterThanOrEqual(0);
    expect(managementVerification).toBeGreaterThan(management);
    expect(roles).toBeGreaterThanOrEqual(0);
    expect(roles).toBeGreaterThan(managementVerification);
    expect(roleVerification).toBeGreaterThan(roles);
    expect(cron).toBeGreaterThan(roleVerification);
    expect(verification).toBeGreaterThan(cron);
    expect(released).toBeGreaterThan(verification);

    const tryBoundary = restore.indexOf("  try {");
    const catchBoundary = restore.indexOf("  } catch {", tryBoundary);
    const refenceNetwork = restore.indexOf(
      "Set-NetworkFence $AccessToken $Snapshot",
      catchBoundary
    );
    const refenceRealtime = restore.indexOf(
      "Set-RealtimeFence $AccessToken",
      catchBoundary
    );
    const refenceAuth = restore.indexOf("Set-AuthFence $AccessToken", catchBoundary);
    const refenceRoles = restore.indexOf("Set-DatabaseRoleFence", catchBoundary);
    const refenceCron = restore.indexOf("Set-CronFence", catchBoundary);
    const refenceVerification = restore.indexOf(
      "Assert-FenceActive $AccessToken $Snapshot",
      catchBoundary
    );

    // Model an exception injected after every intermediate restoration stage:
    // each stage must remain inside the same catch boundary, whose recovery
    // path re-applies and positively verifies every write-fence control.
    for (const injectedFailureStage of [
      management,
      managementVerification,
      roles,
      roleVerification,
      cron,
      verification,
    ]) {
      expect(injectedFailureStage).toBeGreaterThan(tryBoundary);
      expect(injectedFailureStage).toBeLessThan(catchBoundary);
    }
    expect(refenceNetwork).toBeGreaterThan(catchBoundary);
    expect(refenceRealtime).toBeGreaterThan(refenceNetwork);
    expect(refenceAuth).toBeGreaterThan(refenceRealtime);
    expect(refenceRoles).toBeGreaterThan(refenceAuth);
    expect(refenceCron).toBeGreaterThan(refenceRoles);
    expect(refenceVerification).toBeGreaterThan(refenceCron);
    expect(restore).toContain('$Snapshot.state = "manual_recovery_required"');
    expect(restore).toContain('Set-FenceStep $Snapshot "restore" "failed"');
    expect(restore).toContain("Set-NetworkFence $AccessToken $Snapshot");
    expect(restore).toContain("Set-RealtimeFence $AccessToken");
    expect(restore).toContain("Set-AuthFence $AccessToken");
    expect(restore).toContain("live controls were re-fenced");
    expect(restore).toContain("live controls could not be proven");
  });
});
