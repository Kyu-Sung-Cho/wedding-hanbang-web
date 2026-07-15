import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const packageJson = JSON.parse(readRepo("package.json")) as {
  scripts: Record<string, string>;
};
const releaseTargets = JSON.parse(readRepo("scripts/release-targets.json")) as {
  productionSupabaseProjectRefs: string[];
  approvedNonProductionSupabaseProjectRefs: string[];
  productionDatabaseWriteFence: string;
  productionDatabaseWriteFenceContract: string;
  productionSupabaseRedirectTokenPolicy: {
    rateLimits: {
      emailSentPerHour: number;
      tokenRefreshPerFiveMinutesPerIp: number;
      signInSignUpsPerFiveMinutesPerIp: number;
      tokenVerificationsPerFiveMinutesPerIp: number;
    };
  };
  productionTurnstileBoundary: {
    status: string;
    contract: string;
    canonicalHostname: string;
    requiredActions: string[];
  };
  backupPolicy: { status: string; allowedRestoreProjectRefs: string[] };
};
const ship = readRepo("scripts/supabase-ship-safe.ps1");
const reconcile = readRepo("scripts/supabase-reconcile-core-baseline.ps1");
const writeFence = readRepo("scripts/supabase-write-fence.ps1");
const recoverySafe = readRepo("scripts/supabase-recovery-safe.mjs");
const lifecycleSmoke = readRepo("scripts/supabase-lifecycle-smoke.mjs");
const previewSmokeGuard = readRepo("scripts/lib/preview-smoke-guard.mjs");
const baseline = readRepo(
  "supabase/migrations/20260202000000_legacy_core_baseline.sql"
);
const baselinePreflight = readRepo(
  "scripts/sql/supabase-core-baseline-preflight.sql"
);
const postDeploy = readRepo("scripts/sql/supabase-post-deploy-contract.sql");
const productionPreflight = readRepo(
  "scripts/sql/supabase-production-preflight.sql"
);
const dependencyCronPreflight = readRepo(
  "scripts/sql/supabase-dependency-cron-preflight.sql"
);
const accountDeletionGuardAcl = readRepo(
  "supabase/migrations/20260711144000_lock_account_deletion_trigger_function_acl.sql"
);
const serviceOnlyFunctionAcl = readRepo(
  "supabase/migrations/20260711145000_lock_service_only_function_acl.sql"
);
const vendorUploadClosure = readRepo(
  "supabase/migrations/20260711146000_disable_unproven_vendor_uploads.sql"
);
const clientDeniedTriggerBindings = readRepo(
  "supabase/migrations/20260711148000_verify_client_denied_trigger_bindings.sql"
);
const rateLimitSubjectSmoke = readRepo(
  "scripts/sql/supabase-rate-limit-subject-smoke.sql"
);
const invitationRetirement = readRepo(
  "supabase/migrations/20260704131000_drop_dead_invitation_tables.sql"
);
const settingsPage = readRepo("apps/web/src/app/(app)/settings/page.tsx");
const adminAuth = readRepo("apps/web/src/app/api/admin/auth/route.ts");
const demoSession = readRepo("apps/web/src/lib/demoSession.ts");
const reviewedPowerShellLauncher = readRepo("scripts/run-reviewed-powershell.mjs");
const repositorySecretScan = readRepo("scripts/scan-tracked-secrets.mjs");
const vercelReleaseInventory = readRepo(
  "scripts/vercel-release-inventory.mjs"
);
const verifyLocal = readRepo("scripts/verify-local.mjs");
const ciWorkflow = readRepo(".github/workflows/ci.yml");
const mobileReleaseReadiness = readRepo("scripts/mobile-release-readiness.mjs");
const liveSmoke = readRepo("scripts/live-smoke-test.mjs");
const researchCohortMigration = readRepo(
  "supabase/migrations/20260712100000_research_cohort_application_identity.sql"
);
const accountDeletionEmailScopeMigration = readRepo(
  "supabase/migrations/20260712101000_durable_account_deletion_email_scope.sql"
);
const amoraResetReadFenceMigration = readRepo(
  "supabase/migrations/20260712102000_close_amora_reset_read_fence.sql"
);
const applicationEmailLifecycleMigration = readRepo(
  "supabase/migrations/20260712103000_serialize_application_email_lifecycle.sql"
);
const authMutationFenceMigration = readRepo(
  "supabase/migrations/20260712104000_block_auth_mutation_during_account_deletion.sql"
);
const authIdentityDeletionStartMigration = readRepo(
  "supabase/migrations/20260712104500_serialize_auth_identity_with_deletion_start.sql"
);
const accountDeletionStorageAuthRaceMigration = readRepo(
  "supabase/migrations/20260712105000_close_account_deletion_storage_auth_race.sql"
);
const unlimitedAmoraMeteringMigration = readRepo(
  "supabase/migrations/20260713101000_unlimited_amora_test_stage_metering.sql"
);
const atomicScheduleEventMigration = readRepo(
  "supabase/migrations/20260713103000_atomic_schedule_event_mutations.sql"
);
const atomicBudgetCategoryMigration = readRepo(
  "supabase/migrations/20260713111000_budget_manual_record_contract.sql"
);
const atomicChecklistItemMigration = readRepo(
  "supabase/migrations/20260713107000_atomic_checklist_item_mutations.sql"
);
const atomicJourneyPreferencesMigration = readRepo(
  "supabase/migrations/20260713108000_atomic_journey_preferences.sql"
);
const rawCustomerTrackingRetirementMigration = readRepo(
  "supabase/migrations/20260713112000_retire_raw_customer_tracking.sql"
);
const profilesDirectSelectClosureMigration = readRepo(
  "supabase/migrations/20260713112500_close_profiles_direct_select.sql"
);
const communityMediaRetirementMigration = readRepo(
  "supabase/migrations/20260713113000_retire_public_community_media.sql"
);
const congratulatoryMoneyRetirementMigration = readRepo(
  "supabase/migrations/20260713114000_retire_congratulatory_money.sql"
);
const communityTextOnlyBoundaryMigration = readRepo(
  "supabase/migrations/20260713115000_close_community_legacy_payload_exposure.sql"
);
const communityUserMutesMigration = readRepo(
  "supabase/migrations/20260713116000_add_community_user_mutes.sql"
);
const communityCommentSafetyMigration = readRepo(
  "supabase/migrations/20260713117000_atomic_community_comment_safety.sql"
);
const opaqueCommunityActorMigration = readRepo(
  "supabase/migrations/20260713118000_opaque_community_actor_ids.sql"
);
const communityPostLifecycleMigration = readRepo(
  "supabase/migrations/20260713119000_atomic_community_post_lifecycle.sql"
);
const researchConsentVersionMigration = readRepo(
  "supabase/migrations/20260713120000_research_cohort_consent_version.sql"
);
const communityPostUpdateMigration = readRepo(
  "supabase/migrations/20260713121000_atomic_community_post_update.sql"
);
const serviceRoleTableAclMigration = readRepo(
  "supabase/migrations/20260713122000_lock_service_role_table_acl.sql"
);
const previewSmokeHarnessMigration = readRepo(
  "supabase/migrations/20260713123000_preview_smoke_fixture_harness.sql"
);
const maintenanceHealthRoute = readRepo(
  "apps/web/src/app/api/health/maintenance/route.ts"
);
const vercelConfig = JSON.parse(readRepo("apps/web/vercel.json"));
const agentsGuide = readRepo("AGENTS.md");
const productionReleaseRunbook = readRepo(
  "docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md"
);
const fullQaReport = readRepo("docs/codex-tasks/FULL_QA_2026-07-12.md");
const projectStatus = readRepo("PROJECT_STATUS.md");
const fullServiceOverview = readRepo("WEDDINGHANBANG_FULL.md");
const serviceStandard = readRepo("WEDDINGHANBANG_SERVICE_DOC.md");
const communityJourney = readRepo("docs/COMMUNITY_TO_SERVICE_USER_JOURNEY.md");
const remoteOperations = readRepo("docs/SUPABASE_REMOTE_OPERATIONS.md");
const turnstile = readRepo("apps/web/src/lib/turnstile.ts");

function functionSourceMd5(
  sql: string,
  functionName: string,
  schemaName = "public"
): string {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSchema = schemaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION ${escapedSchema}\\.${escapedName}\\([\\s\\S]*?AS (?<delimiter>\\$[A-Za-z0-9_]*\\$)(?<body>[\\s\\S]*?)\\k<delimiter>;`
  ));
  if (!match?.groups?.body) throw new Error(`Missing function body: ${functionName}`);
  return createHash("md5")
    .update(match.groups.body.replace(/\r/g, ""), "utf8")
    .digest("hex");
}

describe("release safety contract", () => {
  it("prevents a main merge from racing production database gates", () => {
    expect(vercelConfig.git?.deploymentEnabled).toBe(false);
  });

  it("pins the controller-only Vercel release path without logging protection bypass secrets", () => {
    expect(agentsGuide).toContain(
      "## Deploy Configuration (configured by /setup-deploy)"
    );
    expect(agentsGuide).toContain("project `wedding-hanbang-web`");
    expect(agentsGuide).toContain("별도의 보호된 `release-control`");
    expect(agentsGuide).toContain("로컬 Vercel CLI는 운영 proof를 만들지 않는다");
    expect(agentsGuide).not.toContain("vercel@55.0.0 inspect");
    expect(agentsGuide).not.toContain("`--prod --skip-domain`");
    expect(agentsGuide).toContain("자동 Git 배포는 계속 비활성");
    expect(productionReleaseRunbook).toContain("controller-only 실행 계약");
    expect(productionReleaseRunbook).toContain("로컬 CLI 실행 금지");
    expect(productionReleaseRunbook).not.toContain("$VercelCliVersion");
    expect(productionReleaseRunbook).not.toContain(
      "<reviewed-vercel-cli-version>"
    );
    expect(productionReleaseRunbook).toContain(
      "`automationBypassConfigured` boolean과 개수만"
    );
    expect(productionReleaseRunbook).toContain(
      "`Object.keys(...)` 결과를 stdout/stderr에 보내지 않는다"
    );
    expect(fullQaReport).toContain(
      "automation-bypass 비밀이 내부 도구 출력에 한 번 노출"
    );
  });

  it("keeps protected production blocked until a direct database write fence is verified", () => {
    expect(releaseTargets.productionSupabaseProjectRefs).toContain(
      "slrtobkksjmxgzatjyqb"
    );
    expect(releaseTargets.productionDatabaseWriteFence).toBe("not_configured");
    expect(releaseTargets.approvedNonProductionSupabaseProjectRefs).toEqual([]);
    expect(releaseTargets.productionDatabaseWriteFenceContract).toBe(
      "database-readonly-realtime-cron-v1"
    );
    expect(releaseTargets.productionSupabaseRedirectTokenPolicy.rateLimits)
      .toEqual({
        emailSentPerHour: 2,
        tokenRefreshPerFiveMinutesPerIp: 150,
        signInSignUpsPerFiveMinutesPerIp: 30,
        tokenVerificationsPerFiveMinutesPerIp: 30,
      });
    expect(releaseTargets.backupPolicy).toMatchObject({
      status: "not_configured",
      allowedRestoreProjectRefs: [],
    });
    expect(releaseTargets.productionTurnstileBoundary).toEqual({
      status: "not_configured",
      contract: "siteverify-hostname-action-v1",
      canonicalHostname: "hanbang.ai",
      requiredActions: ["signup", "forgot_password"],
    });
    expect(turnstile).not.toContain('| "survey"');
    expect(ship).toContain('"signup,forgot_password"');
    expect(ship).not.toContain('"signup,forgot_password,preregister"');
    expect(ship).not.toContain("signup,forgot_password,preregister,survey");
    expect(ship).toContain(
      "all two active public hostname/action-bound Siteverify flows are independently attested"
    );
    for (const script of [ship, reconcile]) {
      expect(script).toContain('productionDatabaseWriteFence -ne "verified-v1"');
      expect(script).toContain('backupPolicy.status -ne "verified-v1"');
    }
    expect(ship).toContain(
      "Production push remains disabled until ship is bound to a live fence snapshot"
    );
    expect(reconcile).toContain(
      "Production baseline reconciliation remains disabled until it is bound to one live write-fence lifecycle"
    );
    expect(packageJson.scripts["supabase:fence:test"]).toContain(
      "supabase-write-fence-offline.test.mjs"
    );
    expect(packageJson.scripts["supabase:fence:test"]).not.toContain(
      "supabase-write-fence-evidence"
    );
    expect(verifyLocal).toContain(
      "Supabase write-fence lifecycle tests"
    );
    expect(packageJson.scripts).not.toHaveProperty("supabase:fence:evidence");
  });

  it("sanitizes Vercel release inventory without treating an omitted bypass field as empty", () => {
    expect(packageJson.scripts["vercel:release-inventory:test"]).toContain(
      "vercel-release-inventory.test.mjs"
    );
    expect(verifyLocal).toContain("Vercel release inventory redaction tests");
    expect(vercelReleaseInventory).toContain("automationBypassFieldObserved");
    expect(vercelReleaseInventory).toContain("nextCursorPresent");
    expect(vercelReleaseInventory).toContain("previousCursorPresent");
    expect(vercelReleaseInventory).toContain("singlePageComplete");
    expect(vercelReleaseInventory).toContain("deploymentHasCustomEnvironment");
    expect(vercelReleaseInventory).toContain("configurationSourceObserved");
    expect(vercelReleaseInventory).toContain("unscopedTargetOwners");
    expect(vercelReleaseInventory).toContain("branchOwners");
    expect(vercelReleaseInventory).toContain("customEnvironmentOwners");
    expect(vercelReleaseInventory).toContain("customEnvironmentCount");
    expect(vercelReleaseInventory).toContain(
      'evaluationMode: "offline-local-artifacts"'
    );
    expect(vercelReleaseInventory).toContain("sourceAttestationVerified: false");
    expect(vercelReleaseInventory).toContain("productionProof: false");
    expect(vercelReleaseInventory).toContain("releaseEligible: false");
    expect(vercelReleaseInventory).toContain('["count", "next", "prev"]');
    expect(vercelReleaseInventory).not.toContain("localeCompare");
    expect(vercelReleaseInventory).toContain("lstatLocalPathWithoutRedirects");
    expect(vercelReleaseInventory).toContain("await lstat(current)");
    expect(vercelReleaseInventory).toContain("metadata.isSymbolicLink()");
    expect(vercelReleaseInventory).toContain(
      "constants.O_RDONLY | constants.O_NOFOLLOW"
    );
    expect(vercelReleaseInventory).toContain("await handle.readFile()");
    for (const metadataField of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) {
      expect(vercelReleaseInventory).toContain(
        `left.${metadataField} === right.${metadataField}`
      );
    }
    expect(vercelReleaseInventory).not.toContain("await readFile(resolvedPath)");
    expect(vercelReleaseInventory).toContain("fieldObserved: false");
    expect(vercelReleaseInventory).toContain("configured: null");
    expect(vercelReleaseInventory).toContain("count: null");
    expect(vercelReleaseInventory).not.toMatch(/\bfetch\s*\(/);
    expect(vercelReleaseInventory).not.toMatch(
      /node:(?:http|https|net|tls|child_process)/
    );
    expect(vercelReleaseInventory).not.toMatch(/\bchild_process\b/);
  });

  it("does not expose raw mutation aliases or include-all in guarded release commands", () => {
    for (const retiredAlias of [
      "supabase:push",
      "supabase:push:dry",
      "supabase:apply:pending",
      "supabase:baseline:history",
      "supabase:login",
      "supabase:link",
      "supabase:migrations",
      "supabase:setup:safe",
      "supabase:check:safe",
    ]) {
      expect(packageJson.scripts).not.toHaveProperty(retiredAlias);
    }
    expect(ship).not.toMatch(/db push[^\r\n]*--include-all/);
    expect(reconcile).not.toMatch(/db push[^\r\n]*--include-all/);
  });

  it("launches reviewed PowerShell workflows without a shell or OS-specific package alias", () => {
    for (const scriptName of [
      "supabase:baseline:core",
      "supabase:ship:safe",
      "supabase:fence",
    ]) {
      expect(packageJson.scripts[scriptName]).toContain("run-reviewed-powershell.mjs");
      expect(packageJson.scripts[scriptName]).not.toMatch(/^(?:powershell|pwsh)\s/);
    }
    expect(reviewedPowerShellLauncher).toContain('process.platform === "win32"');
    expect(reviewedPowerShellLauncher).toContain("resolvePowerShellExecutable()");
    expect(reviewedPowerShellLauncher).toContain('const WINDOWS_ROOT = "C:\\\\Windows"');
    expect(reviewedPowerShellLauncher).toContain(
      "Reviewed release PowerShell execution is disabled outside"
    );
    expect(reviewedPowerShellLauncher).toContain("spawnSync(executable");
    expect(reviewedPowerShellLauncher).not.toContain("shell:");
  });

  it("hard-stops every remote Supabase mutation and export before credentials", () => {
    const shipStop = ship.indexOf("Remote migration execution is disabled");
    expect(shipStop).toBeGreaterThan(0);
    expect(shipStop).toBeLessThan(ship.indexOf('Read-Host "Paste Supabase database password'));

    const reconcileStop = reconcile.indexOf(
      "Remote baseline reconciliation is disabled"
    );
    expect(reconcileStop).toBeGreaterThan(0);
    expect(reconcileStop).toBeLessThan(
      reconcile.indexOf('Read-Host "Paste Supabase database password')
    );

    const fenceStop = writeFence.indexOf("All remote write-fence execution is disabled");
    expect(fenceStop).toBeGreaterThan(0);
    for (const boundary of [
      "$injectedReleaseTargetsJson",
      'Get-Content -Raw -LiteralPath "scripts/release-targets.json"',
      "function Read-FenceSecret",
      "function Enter-ProjectFenceLifecycleLock",
      "function Invoke-FenceDatabaseApiRequest",
    ]) {
      expect(writeFence.indexOf(boundary)).toBeGreaterThan(fenceStop);
    }
    expect(writeFence.indexOf('if ($Action -eq "MarkMigrationStarted")')).toBe(-1);
    expect(writeFence.indexOf('if ($Action -eq "MarkMigrationVerified")')).toBe(-1);
    const fenceOperationalTail = writeFence.slice(
      writeFence.indexOf('if ($Action -eq "Plan")')
    );
    expect(fenceOperationalTail).not.toContain("switch ($Action)");
    expect(fenceOperationalTail).not.toContain("Restore-Fence");

    const exportBody = recoverySafe.slice(
      recoverySafe.indexOf("async function exportRecovery"),
      recoverySafe.indexOf("async function main")
    );
    const recoveryExportStop = exportBody.indexOf(
      "assertRecoveryExportExecutionEnabled();"
    );
    const recoveryCredentialBoundary = exportBody.indexOf(
      "process.env.SUPABASE_SERVICE_ROLE_KEY"
    );
    const recoveryTargetsBoundary = exportBody.indexOf("loadReleaseTargets(");
    const recoveryGitBoundary = exportBody.indexOf("captureGitState(");
    expect(recoveryExportStop).toBeGreaterThanOrEqual(0);
    expect(recoveryCredentialBoundary).toBeGreaterThan(recoveryExportStop);
    expect(recoveryTargetsBoundary).toBeGreaterThan(recoveryExportStop);
    expect(recoveryGitBoundary).toBeGreaterThan(recoveryExportStop);
  });

  it("keeps administrator and demo-session secrets on separate strong boundaries", () => {
    expect(adminAuth).toContain("value.length >= 24");
    expect(adminAuth).toContain("isStrongAdminAccessSecret(ADMIN_PASSWORD)");
    expect(adminAuth).toContain('new Set(["login", "initial-setup", "create-admin"])');
    expect(adminAuth).toContain('rateLimitKey("admin-auth", req)');
    expect(adminAuth).not.toContain("admin-auth:${action}");
    expect(demoSession).toContain("configured.length >= 32");
    expect(demoSession).not.toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
    expect(demoSession).not.toContain("process.env.ADMIN_PASSWORD");
  });

  it("scans the full Git history plus tracked and untracked files before a commit", () => {
    expect(repositorySecretScan).toContain('"--cached", "--others", "--exclude-standard"');
    expect(repositorySecretScan).toContain('["rev-list", "--all"]');
    expect(repositorySecretScan).toContain('"--no-textconv"');
    expect(repositorySecretScan).toContain('"--root"');
    expect(repositorySecretScan).toContain('"-m"');
    expect(repositorySecretScan).toContain('"--format=%x1e%H%x00%B"');
    expect(repositorySecretScan).toContain('"refs/tags"');
    expect(repositorySecretScan).toContain('"cat-file", "tag"');
    expect(repositorySecretScan).toContain("maxBuffer: 64 * 1024 * 1024");
    expect(repositorySecretScan).toContain("[repository-secret-scan]");
  });

  it("runs the no-install history gate before any CI dependency lifecycle", () => {
    const historyJob = ciWorkflow.slice(
      ciWorkflow.indexOf("  secret-history:"),
      ciWorkflow.indexOf("  quality:")
    );
    const windowsJob = ciWorkflow.slice(
      ciWorkflow.indexOf("  windows-launcher-contract:"),
      ciWorkflow.indexOf("  quality:")
    );
    const qualityJob = ciWorkflow.slice(ciWorkflow.indexOf("  quality:"));
    expect(historyJob).toContain("fetch-depth: 0");
    expect(historyJob).toContain("package-manager-cache: false");
    expect(historyJob).toContain("node ./scripts/scan-tracked-secrets.mjs");
    expect(historyJob).not.toContain("pnpm install");
    expect(historyJob).not.toContain("pnpm/action-setup");
    expect(windowsJob).toContain("windows-launcher-contract:");
    expect(windowsJob).toContain("runs-on: windows-latest");
    expect(windowsJob).toContain(
      "node --test ./scripts/run-reviewed-powershell.test.mjs"
    );
    expect(windowsJob).toContain("./scripts/supabase-write-fence-offline.test.mjs");
    expect(windowsJob).toContain("./scripts/supabase-recovery-safe.test.mjs");
    expect(windowsJob).toContain("native children consume only");
    expect(windowsJob).toContain("archive staging streams");
    expect(windowsJob).toContain("decrypt-stream digest");
    expect(windowsJob).toContain("timeout terminates a descendant");
    expect(qualityJob).toContain(
      "needs: [secret-history, windows-launcher-contract]"
    );
    expect(qualityJob).toContain("fetch-depth: 1");
    expect(qualityJob.indexOf("node ./scripts/scan-tracked-secrets.mjs"))
      .toBeLessThan(qualityJob.indexOf("pnpm install --frozen-lockfile"));
    expect(qualityJob).toContain("pnpm audit --prod --audit-level high");
  });

  it("never lets the static mobile checker self-certify a store release", () => {
    const storeGate = mobileReleaseReadiness.slice(
      mobileReleaseReadiness.indexOf("if (storeReleaseMode)"),
      mobileReleaseReadiness.indexOf("} else {", mobileReleaseReadiness.indexOf("if (storeReleaseMode)")),
    );
    expect(storeGate).toContain("expect(");
    expect(storeGate).toContain("false");
    expect(storeGate).toContain("physical-device evidence are machine-verified");
  });

  it("binds the coming-soon live canary to the exact deployment and server gate", () => {
    expect(maintenanceHealthRoute).toContain("launchMode: configuredLaunchMode()");
    expect(maintenanceHealthRoute).toContain('mode === "coming_soon" || mode === "full"');
    expect(maintenanceHealthRoute).toContain('return "invalid"');
    expect(ship).toContain('$status.launchMode -ne "coming_soon"');
    expect(ship).toContain("full launch is blocked");
    expect(liveSmoke).toContain('if (arg === "--") continue;');
    expect(liveSmoke).toContain('--launch-mode=<mode>');
    expect(liveSmoke).toContain('--expected-sha=<sha>');
    expect(liveSmoke).toContain('--research-intake=<state>');
    expect(liveSmoke).toContain('options.launchMode === "coming_soon"');
    expect(liveSmoke).toContain('body?.code !== "SERVICE_NOT_LAUNCHED"');
    expect(liveSmoke).toContain('intakeBody?.code !== "RESEARCH_INTAKE_CLOSED"');
    expect(liveSmoke).toContain('intakeResponse.headers()["cache-control"]?.includes("no-store")');
    expect(liveSmoke).toContain('options.researchIntake === "closed"');
    expect(liveSmoke).toContain("body.researchCohortApplicationsEnabled");
    expect(liveSmoke).toContain('body.amoraUsageLimitMode !== "unlimited_test"');
    expect(liveSmoke).toContain('final.searchParams.has("next")');
    expect(liveSmoke).toContain('body.deployment !== options.expectedSha.toLowerCase()');
    expect(liveSmoke).toContain(
      "body.supabaseProjectRef !== options.expectedSupabaseProjectRef"
    );
    expect(liveSmoke).toContain("isPlausibleCommitSha(options.expectedSha)");
    expect(liveSmoke).toContain("isPlausibleAppleTeamId(options.appleTeamId)");
    expect(liveSmoke).toContain("isPlausibleSigningFingerprint(options.playSigningSha256)");
    for (const associationPath of [
      "/apple-app-site-association",
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ]) {
      expect(liveSmoke).toContain(associationPath);
    }
    for (const document of [
      projectStatus,
      fullServiceOverview,
      serviceStandard,
      productionReleaseRunbook,
    ]) {
      expect(document).toContain("coming_soon");
      expect(document).toContain("full");
      expect(document).toMatch(/계정 삭제/);
      expect(document).toMatch(/법적|약관|개인정보/);
    }
  });

  it("preserves pnpm argument forwarding while rejecting unknown live-smoke options", () => {
    const script = resolve(repoRoot, "scripts/live-smoke-test.mjs");
    const run = (lastArgument: "--help" | "--definitely-unknown-live-smoke-option") => {
      return spawnSync(process.execPath, [script, "--", lastArgument], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: false,
        timeout: 15_000,
      });
    };

    expect(packageJson.scripts["qa:live"]).toBe("node ./scripts/live-smoke-test.mjs");
    const help = run("--help");
    expect(help.error).toBeUndefined();
    expect(help.status).toBe(0);
    expect(`${help.stdout}\n${help.stderr}`).toContain("Usage: pnpm qa:live [options]");

    const unknown = run("--definitely-unknown-live-smoke-option");
    expect(unknown.error).toBeUndefined();
    expect(unknown.status).not.toBe(0);
    expect(`${unknown.stdout}\n${unknown.stderr}`).toContain(
      "Unknown argument: --definitely-unknown-live-smoke-option"
    );
  });

  it("rejects obvious placeholder release identities before starting a browser", () => {
    const script = resolve(repoRoot, "scripts/live-smoke-test.mjs");
    const validSha = "76a644031180216a7f3c7a4e3a4a8cf18b11463e";
    const validTeamId = "6RSK726532";
    const validSupabaseProjectRef = "abcdefghijklmnopqrst";
    const validFingerprint =
      "85:25:B7:5F:66:FC:6A:85:0D:A7:57:A2:CA:D2:47:B9:F6:EB:C7:81:10:D3:2F:B7:2C:84:42:0D:AE:B6:40:0D";
    const run = (identityArgs: string[]) => spawnSync(
      process.execPath,
      [
        script,
        "--launch-mode=coming_soon",
        `--expected-supabase-project-ref=${validSupabaseProjectRef}`,
        ...identityArgs,
      ],
      { cwd: repoRoot, encoding: "utf8", shell: false, timeout: 10_000 }
    );

    const placeholderSha = run([
      `--expected-sha=${"0".repeat(40)}`,
      `--apple-team-id=${validTeamId}`,
      `--play-signing-sha256=${validFingerprint}`,
    ]);
    expect(placeholderSha.status).not.toBe(0);
    expect(`${placeholderSha.stdout}\n${placeholderSha.stderr}`).toContain(
      "--expected-sha must be"
    );

    const placeholderTeam = run([
      `--expected-sha=${validSha}`,
      "--apple-team-id=AAAAAAAAAA",
      `--play-signing-sha256=${validFingerprint}`,
    ]);
    expect(placeholderTeam.status).not.toBe(0);
    expect(`${placeholderTeam.stdout}\n${placeholderTeam.stderr}`).toContain(
      "--apple-team-id must match"
    );

    const placeholderFingerprint = run([
      `--expected-sha=${validSha}`,
      `--apple-team-id=${validTeamId}`,
      `--play-signing-sha256=${"00".repeat(32)}`,
    ]);
    expect(placeholderFingerprint.status).not.toBe(0);
    expect(`${placeholderFingerprint.stdout}\n${placeholderFingerprint.stderr}`).toContain(
      "--play-signing-sha256 must match"
    );

    const sequentialTeam = run([
      `--expected-sha=${validSha}`,
      "--apple-team-id=0123456789",
      `--play-signing-sha256=${validFingerprint}`,
    ]);
    expect(sequentialTeam.status).not.toBe(0);
    expect(`${sequentialTeam.stdout}\n${sequentialTeam.stderr}`).toContain(
      "--apple-team-id must match"
    );

    const sequentialFingerprint = run([
      `--expected-sha=${validSha}`,
      `--apple-team-id=${validTeamId}`,
      `--play-signing-sha256=${"0123456789abcdef".repeat(4)}`,
    ]);
    expect(sequentialFingerprint.status).not.toBe(0);
    expect(`${sequentialFingerprint.stdout}\n${sequentialFingerprint.stderr}`).toContain(
      "--play-signing-sha256 must match"
    );

    const sequentialSha = run([
      `--expected-sha=${"0123456789abcdef".repeat(3).slice(0, 40)}`,
      `--apple-team-id=${validTeamId}`,
      `--play-signing-sha256=${validFingerprint}`,
    ]);
    expect(sequentialSha.status).not.toBe(0);
    expect(`${sequentialSha.stdout}\n${sequentialSha.stderr}`).toContain(
      "--expected-sha must be"
    );
  }, 15_000);

  it("forbids destructive lifecycle smoke tests on every protected production ref", () => {
    expect(lifecycleSmoke).toContain("assertApprovedPreviewTarget");
    expect(previewSmokeGuard).toContain("productionRefs.includes(expectedProjectRef)");
    expect(previewSmokeGuard).toContain(
      "Smoke tests require an explicitly approved non-production project."
    );
    expect(lifecycleSmoke).toContain("SUPABASE_EXPECTED_PROJECT_REF");
  });

  it("requires exact validated constraints, ready indexes, defaults, and RLS before baseline reconciliation", () => {
    for (const sql of [baseline, baselinePreflight]) {
      expect(sql).toContain("pg_get_constraintdef");
      expect(sql).toContain("convalidated");
      expect(sql).toContain("pg_get_indexdef");
      expect(sql).toContain("indisvalid");
      expect(sql).toContain("indisready");
      expect(sql).toContain("relrowsecurity");
      expect(sql).toContain("('vendor_favorites', 'created_at', 'now()')");
    }
    expect(baselinePreflight).toContain("category_constraint_mismatches");
    expect(baselinePreflight).not.toContain("missing_category_tokens");
  });

  it("pins service permissions and account-deletion trigger behavior exactly", () => {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(postDeploy).toContain(
        `'service_role', format('public.%I', required.table_name), '${privilege}'`
      );
    }
    expect(postDeploy).toContain(
      "trigger_row.tgfoid = to_regprocedure(required.function_signature)"
    );
    expect(postDeploy).toContain(
      "pg_get_triggerdef(trigger_row.oid, true) = required.definition"
    );
    expect(postDeploy).toMatch(
      /AND 2 = \(\s*SELECT count\(\*\)\s*FROM pg_catalog\.pg_trigger trigger_row\s*WHERE trigger_row\.tgrelid = to_regclass\('public\.research_cohort_applications'\)/
    );
  });

  it("keeps the preflight and post-deploy dependency closures synchronized", () => {
    const preflightFunctions = productionPreflight.slice(
      productionPreflight.indexOf("required_dependency_functions("),
      productionPreflight.indexOf("required_replaceable_argument_names(")
    );
    const postDeployFunctions = postDeploy.slice(
      postDeploy.indexOf("WITH required_functions("),
      postDeploy.indexOf("service_denied_functions(")
    );
    const extractSignatures = (sql: string) =>
      [...sql.matchAll(/\(\s*'([^']+\([^']*\))'/g)]
        .map((match) => match[1])
        .sort();
    const preflightSignatures = extractSignatures(preflightFunctions);
    const postDeploySignatures = extractSignatures(postDeployFunctions);
    const preflightTriggerFunctions = productionPreflight.slice(
      productionPreflight.indexOf("required_client_denied_trigger_functions("),
      productionPreflight.indexOf("client_denied_trigger_function_status AS")
    );
    const postDeployTriggerFunctions = postDeploy.slice(
      postDeploy.indexOf("required_client_denied_trigger_functions("),
      postDeploy.indexOf("client_denied_trigger_function_status AS")
    );
    const preflightTriggerBindings = productionPreflight.slice(
      productionPreflight.indexOf("required_client_denied_trigger_bindings("),
      productionPreflight.indexOf("client_denied_trigger_binding_status AS")
    );
    const postDeployTriggerBindings = postDeploy.slice(
      postDeploy.indexOf("required_client_denied_trigger_bindings("),
      postDeploy.indexOf("client_denied_trigger_binding_status AS")
    );
    const extractBindingNames = (sql: string) =>
      [...sql.matchAll(
        /\(\s*'(?:auth|public|storage)'\s*,\s*'[^']+'\s*,\s*'([^']+)'/g
      )].map((match) => match[1]).sort();

    expect(preflightSignatures).toHaveLength(64);
    expect(postDeploySignatures).toEqual(preflightSignatures);
    const preflightTriggerFunctionSignatures = extractSignatures(
      preflightTriggerFunctions
    );
    expect(preflightTriggerFunctionSignatures).toHaveLength(15);
    expect(extractSignatures(postDeployTriggerFunctions)).toEqual(
      preflightTriggerFunctionSignatures
    );
    const preflightTriggerBindingNames = extractBindingNames(
      preflightTriggerBindings
    );
    expect(preflightTriggerBindingNames).toHaveLength(18);
    expect(extractBindingNames(postDeployTriggerBindings)).toEqual(
      preflightTriggerBindingNames
    );
    expect(ship).toContain("$script:expectedDependencyFunctionCount = 64");
    expect(ship).toContain("$script:expectedDependencyCronCount = 6");
    expect(ship).toContain(
      "$script:expectedClientDeniedTriggerFunctionCount = 15"
    );
    expect(ship).toContain(
      "$script:expectedClientDeniedTriggerBindingCount = 18"
    );
    expect(ship).toContain("dependency_function_status");
    expect(ship).toContain("dependency_cron_status");
    expect(ship).toContain("$status.existing_replaceable -ne $true");
    expect(ship).toContain("$status.exact -ne $true");

    for (const signature of [
      "public.guard_account_deletion_user_reference()",
      "public.guard_account_deletion_rate_limit_write()",
      "public.account_deletion_queue_health()",
      "public.requeue_dead_account_deletion_job(uuid)",
      "public.account_deletion_email_scopes_are_canonical(text[])",
      "public.renew_account_deletion_job_lease(uuid,uuid,integer)",
      "public.list_account_deletion_owned_storage_objects(uuid,uuid,text,text,integer)",
      "public.mark_account_deletion_cleanup_ready(uuid,uuid,integer)",
      "public.insert_amora_user_message(uuid,uuid,text,text,text)",
      "public.reconcile_stale_amora_chat_requests(integer)",
      "public.delete_expired_amora_request_claims()",
      "public.apply_journey_progress_patch(uuid,jsonb,text[])",
      "public.mutate_journey_schedule_event(uuid,text,jsonb,text,text)",
      "public.mutate_journey_budget_category(uuid,text,jsonb,text[],text)",
      "public.mutate_journey_checklist_item(uuid,text,text,boolean,boolean,jsonb)",
      "public.patch_journey_preferences(uuid,jsonb)",
      "public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)",
      "public.reserve_amora_usage(uuid,integer,integer,boolean)",
      "public.reserve_amora_turn(uuid,integer,integer)",
      "public.reserve_amora_usage_unlimited_v1(uuid,text,text,integer)",
      "public.meter_amora_provider_usage_unlimited_v1(uuid)",
      "public.check_rate_limit(text,integer,integer)",
      "public.check_rate_limit(text,integer,integer,uuid)",
      "public.redact_old_ai_interactions(interval)",
      "public.enforce_ai_interaction_retention()",
      "public.enforce_application_survey_retention()",
      "public.delete_expired_rate_limit_buckets()",
    ]) {
      expect(preflightSignatures).toContain(signature);
    }
    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain(
        "md5(replace(procedure_row.prosrc, chr(13), ''))"
      );
      expect(sql).toContain("8fb08367706397c9a1d00e299a48e7d5");
      expect(sql).toContain("0518d47d1da58e822a8b6ba662bd06eb");
      expect(sql).toContain("b8ebd5bbf8df5b250d36404f4d6f0a5c");
      expect(sql).toContain("b0184ebdb2888d329ef714726d7f76f6");
      expect(sql).toContain("29fe1226857032d271e78f585f887956");
      expect(sql).toContain("reconcile-stale-amora-chat-requests");
      expect(sql).toContain("delete-expired-amora-request-claims");
      expect(sql).toContain("enforce-ai-interaction-retention");
      expect(sql).toContain("enforce-application-survey-retention");
      expect(sql).toContain("delete-expired-rate-limit-buckets");
      expect(sql).toContain("dbaddace99dcf6ddbe99da5eefe0797a");
      expect(sql).toContain("7583f22c1daf9cebea4f7a847a6a507f");
      expect(sql).toContain("04d9b06eedd9eec0c19cf29e5b1a9968");
      expect(sql).toContain("ba6534442ff7bc582d4bdefc396bc841");
    }
    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain("d375108d46ea6663f58a7fbe80fa3d93");
      expect(sql).toContain("b1e4030efdc81da7dcd4697206221ffc");
      expect(sql).toContain("07ad809b73c9daac9ea0ebe7d90e2809");
      expect(sql).toContain("7ccae1027d97c12b32d9d04c92a54002");
      expect(sql).toContain("4aee5587c9f133ff8e23609c23bfbd86");
      expect(sql).toContain("2bed182fdddecbf115ecd0856e14aed7");
      expect(sql).toContain("32d02e88418f75f08d788ab5da07c9af");
      expect(sql).toContain("868a650d26b5bf4aff730c73b99f009e");
      for (const triggerName of [
        "trg_lock_preregistration_email_lifecycle",
        "trg_lock_research_cohort_application_email_lifecycle",
        "trg_block_auth_user_update_during_account_deletion",
        "trg_block_storage_owner_write_during_account_deletion",
        "trg_block_auth_user_delete_until_account_cleanup_ready",
      ]) {
        expect(sql).toContain(triggerName);
      }
    }
    expect(productionPreflight).not.toContain("08f9136df3b8fc79f1abf1ee33a0bb95");
    expect(productionPreflight).not.toContain("7224cdd797c3db1613059d9fc79e7fb4");
    expect(productionPreflight).toContain("required.expected_search_path");
    expect(productionPreflight).toContain(
      "required.expected_service_role_execute"
    );
    expect(productionPreflight).toMatch(
      /public\.enforce_application_survey_retention\(\)[\s\S]*?04d9b06eedd9eec0c19cf29e5b1a9968[\s\S]*?20260711141000'[\s\S]*?20260712100000'/
    );
    expect(productionPreflight).toMatch(
      /public\.request_account_deletion\(uuid,text\)[\s\S]*?d375108d46ea6663f58a7fbe80fa3d93[\s\S]*?'20260710070000', '20260712104500'/
    );
    expect(productionPreflight).toMatch(
      /public\.complete_account_deletion_job\(uuid,uuid\)[\s\S]*?b1e4030efdc81da7dcd4697206221ffc[\s\S]*?'20260710070000', '20260712105000'/
    );
  });

  it("derives forward-migration function hashes from the reviewed SQL bodies", () => {
    const sharedContracts = [
      [researchCohortMigration, "enforce_application_survey_retention"],
      [accountDeletionEmailScopeMigration, "account_deletion_email_scopes_are_canonical"],
      [accountDeletionEmailScopeMigration, "renew_account_deletion_job_lease"],
      [accountDeletionStorageAuthRaceMigration, "list_account_deletion_owned_storage_objects"],
      [accountDeletionStorageAuthRaceMigration, "mark_account_deletion_cleanup_ready"],
      [unlimitedAmoraMeteringMigration, "reserve_amora_usage"],
      [unlimitedAmoraMeteringMigration, "reserve_amora_turn"],
      [unlimitedAmoraMeteringMigration, "reserve_amora_usage_v2"],
      [unlimitedAmoraMeteringMigration, "check_amora_usage"],
      [unlimitedAmoraMeteringMigration, "reserve_amora_usage_unlimited_v1"],
      [unlimitedAmoraMeteringMigration, "meter_amora_provider_usage_unlimited_v1"],
      [atomicScheduleEventMigration, "mutate_journey_schedule_event"],
      [atomicBudgetCategoryMigration, "mutate_journey_budget_category"],
      [atomicChecklistItemMigration, "mutate_journey_checklist_item"],
      [atomicJourneyPreferencesMigration, "patch_journey_preferences"],
      [communityCommentSafetyMigration, "community_soft_delete_comment"],
      [communityPostLifecycleMigration, "community_hard_delete_post"],
      [communityPostUpdateMigration, "community_update_post"],
    ] as const;

    for (const [migration, functionName] of sharedContracts) {
      const hash = functionSourceMd5(migration, functionName);
      expect(productionPreflight, functionName).toContain(hash);
      expect(postDeploy, functionName).toContain(hash);
    }

    for (const [migration, functionName] of [
      [applicationEmailLifecycleMigration, "lock_application_email_lifecycle_write"],
      [authMutationFenceMigration, "block_auth_user_update_during_account_deletion"],
      [authIdentityDeletionStartMigration, "request_account_deletion"],
      [accountDeletionStorageAuthRaceMigration, "block_storage_owner_write_during_account_deletion"],
      [accountDeletionStorageAuthRaceMigration, "block_auth_user_delete_until_account_cleanup_ready"],
      [accountDeletionStorageAuthRaceMigration, "complete_account_deletion_job"],
      [opaqueCommunityActorMigration, "sync_community_actor_identity"],
      [communityPostLifecycleMigration, "maintain_community_profile_post_count"],
      [communityPostLifecycleMigration, "maintain_community_counts_after_comment_delete"],
    ] as const) {
      const hash = functionSourceMd5(migration, functionName);
      expect(productionPreflight, functionName).toContain(hash);
      expect(postDeploy, functionName).toContain(hash);
    }

    const opaqueMuteHelperHash = functionSourceMd5(
      opaqueCommunityActorMigration,
      "community_author_is_muted"
    );
    expect(opaqueMuteHelperHash).toBe("618d8f9a6968a99f285f4a09ab8da44e");
    expect(productionPreflight).toContain(opaqueMuteHelperHash);
    expect(postDeploy).toContain(opaqueMuteHelperHash);
  });

  it("attests every Amora reset read fence without a permissive client bypass", () => {
    const expectedPolicies = [
      ["amora_couple_profiles", "amora_couple_profiles_select_with_privacy"],
      ["chat_messages", "chat_select_with_privacy"],
      ["chat_summaries", "chat_summaries_select_with_privacy"],
      ["decision_nodes", "decision_nodes_select_with_privacy"],
    ] as const;

    for (const [tableName, policyName] of expectedPolicies) {
      expect(amoraResetReadFenceMigration).toContain(
        `CREATE POLICY "${policyName}"`
      );
      expect(postDeploy).toContain(`('${tableName}', '${policyName}')`);
      expect(productionPreflight).toContain(`('${tableName}', '${policyName}')`);
    }
    const helperHash = functionSourceMd5(
      amoraResetReadFenceMigration,
      "can_read_amora_couple_data"
    );
    expect(helperHash).toBe("668077b0545119cc3af092bbf4cb98ae");
    expect(postDeploy).toContain(helperHash);
    expect(productionPreflight).toContain(helperHash);
    for (const marker of [
      "policy_row.permissive = 'PERMISSIVE'",
      "policy_row.roles = ARRAY['authenticated'::name]",
      "policy_row.cmd = 'SELECT'",
      "policy_row.with_check IS NULL",
      "procedure_row.prosecdef",
      "procedure_row.provolatile = 's'",
      "'search_path=pg_catalog, pg_temp'",
      "'row_security=off'",
      "cardinality(procedure_row.proconfig) = 2",
      "'authenticated', procedure_row.oid, 'EXECUTE'",
      "'anon', procedure_row.oid, 'EXECUTE'",
      "'service_role', procedure_row.oid, 'EXECUTE'",
      "'authenticated', format('public.%I', required.table_name), 'SELECT'",
      "'anon', format('public.%I', required.table_name), 'SELECT'",
      "regexp_replace(coalesce(policy_row.qual, '')",
      "'^(public\\.)?can_read_amora_couple_data'",
      "client_policy.cmd IN ('SELECT', 'ALL')",
      "pg_has_role(",
      "'authenticated', policy_role.role_name, 'MEMBER'",
      "policy_role.role_name = 'public'::name",
      "client_read_policy_count",
      "amora_reset_read_helper_exact",
      "all_amora_reset_read_policies_exact",
    ]) {
      expect(postDeploy).toContain(marker);
    }
    for (const marker of [
      "amora_reset_read_helper_present",
      "amora_reset_read_helper_existing_replaceable",
      "amora_reset_read_helper_exact",
      "amora_reset_read_policy_replacement_safe",
      "amora_reset_read_policies_exact",
      '"20260712102000" -in $PendingVersions',
      "$Contract.amora_reset_read_helper_exact -ne $true",
      "$Contract.all_amora_reset_read_policies_exact -ne $true",
    ]) {
      expect(`${productionPreflight}\n${ship}`).toContain(marker);
    }
    expect(postDeploy).toMatch(
      /'all_sensitive_rls_present',[\s\S]*?amora_reset_read_policy_status WHERE NOT exact[\s\S]*?amora_reset_read_helper_status/
    );
  });

  it("attests application-email and auth-deletion trigger bodies and bindings", () => {
    for (const [migration, functionName] of [
      [applicationEmailLifecycleMigration, "lock_application_email_lifecycle_write"],
      [authMutationFenceMigration, "block_auth_user_update_during_account_deletion"],
      [accountDeletionStorageAuthRaceMigration, "block_storage_owner_write_during_account_deletion"],
      [accountDeletionStorageAuthRaceMigration, "block_auth_user_delete_until_account_cleanup_ready"],
    ] as const) {
      expect(postDeploy).toContain(functionSourceMd5(migration, functionName));
    }
    for (const triggerName of [
      "trg_lock_preregistration_email_lifecycle",
      "trg_lock_research_cohort_application_email_lifecycle",
      "trg_block_auth_user_update_during_account_deletion",
      "trg_block_storage_owner_write_during_account_deletion",
      "trg_block_auth_user_delete_until_account_cleanup_ready",
    ]) {
      expect(postDeploy).toContain(triggerName);
    }
    expect(postDeploy).toContain("'search_path=pg_catalog, pg_temp', true");
    expect(postDeploy).toContain("'search_path=pg_catalog, pg_temp', false");
    expect(postDeploy).toContain(
      "= required.expected_service_role_execute"
    );
    expect(postDeploy).toContain(
      "pg_get_triggerdef(trigger_row.oid, true) = required.definition"
    );
  });

  it("pins the research cohort table's defaults, constraints, indexes, trigger, RLS, and ACL", () => {
    const contract = postDeploy.slice(
      postDeploy.indexOf("'research_cohort_application_identity_exact'"),
      postDeploy.indexOf("'rate_limit_subject_contract_exact'")
    );

    for (const expected of [
      "pg_get_userbyid(table_row.relowner) = 'postgres'",
      "pg_get_expr(default_row.adbin, default_row.adrelid)",
      "AND 18 = (",
      "research_cohort_applications_pkey",
      "CHECK (cohort_code = ''research-2026-h2''::text)",
      "research_cohort_applications_email_identity_check",
      "research_cohort_applications_wedding_date_window_check",
      "CHECK (role = ANY",
      "research_cohort_applications_privacy_consent_timestamp_check",
      "research_cohort_applications_privacy_policy_check",
      "2026-07-12",
      "2026-07-14",
      "research_cohort_applications_receipt_lifecycle_check",
      "CHECK (receipt_email_status = ANY",
      "research_cohort_applications_retention_cap",
      "research_cohort_applications_email_verification_window_check",
      "pg_get_constraintdef(constraint_row.oid, true)",
      "idx_research_cohort_applications_expires_at",
      "idx_research_cohort_applications_current",
      "pg_get_indexdef(index_class.oid)",
      "trigger_row.tgenabled = 'O'",
      "pg_get_triggerdef(trigger_row.oid, true)",
      "FROM pg_catalog.pg_policies policy_row",
    ]) {
      expect(contract).toContain(expected);
    }
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of [
        "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
      ]) {
        expect(contract).toContain(
          `NOT has_table_privilege('${role}', 'public.research_cohort_applications', '${privilege}')`
        );
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
        expect(contract).toContain(
          `NOT has_any_column_privilege('${role}', 'public.research_cohort_applications', '${privilege}')`
        );
      }
    }
    for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(contract).toContain(
        `NOT has_table_privilege('service_role', 'public.research_cohort_applications', '${privilege}')`
      );
    }
    expect(contract).toContain(
      "NOT has_any_column_privilege('service_role', 'public.research_cohort_applications', 'REFERENCES')"
    );
  });

  it("requires a durable account-deletion email attestation before auth removal", () => {
    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain("email_scopes");
      expect(sql).toContain("email_snapshot_at");
    }
    expect(productionPreflight).toContain("active_jobs_missing_auth_subject");
    expect(ship).toContain("active_deletion_jobs_missing_auth_subject");
    expect(ship).toContain("account_deletion_email_attestation");
    expect(ship).toContain('Creator = "20260712101000"');
    expect(postDeploy).toContain(
      "account_deletion_jobs_email_snapshot_lifecycle_check"
    );
    expect(postDeploy).toContain(
      "account_deletion_jobs_email_scopes_bounded_check"
    );
    expect(postDeploy).toContain(
      "account_deletion_jobs_email_scopes_canonical_check"
    );
    expect(postDeploy).toContain(
      "account_deletion_email_scopes_are_canonical(email_scopes)"
    );
    expect(postDeploy).toContain("attribute_row.attidentity = ''");
    expect(postDeploy).toContain("attribute_row.attgenerated = ''");
    for (const column of [
      "email_scopes",
      "email_snapshot_at",
      "auth_delete_ready_until",
    ]) {
      expect(postDeploy).toContain(`'${column}'`);
    }
  });

  it("handles a production database where pg_cron is created by a pending migration", () => {
    const extractPreflightCronContracts = (sql: string) => {
      const block = sql.slice(
        sql.indexOf("required_dependency_crons("),
        sql.indexOf("), dependency_cron_status AS (")
      );
      return [...block.matchAll(
        /\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'(20\d{12})'\s*\)/g
      )]
        .map((match) => ({
          jobName: match[1],
          schedule: match[2],
          command: match[3],
          creatorVersion: match[4],
        }))
        .sort((left, right) => left.jobName.localeCompare(right.jobName));
    };
    const extractPostDeployCronContracts = (sql: string) => {
      const block = sql.slice(
        sql.indexOf("required_maintenance_crons("),
        sql.indexOf("), maintenance_cron_status AS (")
      );
      return [...block.matchAll(
        /\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\s*\)/g
      )]
        .map((match) => ({
          jobName: match[1],
          schedule: match[2],
          command: match[3],
        }))
        .sort((left, right) => left.jobName.localeCompare(right.jobName));
    };

    expect(productionPreflight).not.toContain(
      "LEFT JOIN cron.job job_row"
    );
    expect(productionPreflight).toContain("0::bigint AS existing_count");
    expect(productionPreflight).toContain("true AS existing_replaceable");
    expect(productionPreflight).toContain("false AS exact");
    expect(ship).toContain(
      "SELECT to_regclass('cron.job') IS NOT NULL AS present;"
    );
    expect(ship).toContain(
      "scripts/sql/supabase-dependency-cron-preflight.sql"
    );
    expect(dependencyCronPreflight).toContain(
      "LEFT JOIN cron.job job_row ON job_row.jobname = required.job_name"
    );
    expect(dependencyCronPreflight).toContain(
      "job_row.database = current_database()"
    );
    expect(dependencyCronPreflight).toContain("job_row.username = 'postgres'");
    const placeholderContracts = extractPreflightCronContracts(
      productionPreflight
    );
    const exactContracts = extractPreflightCronContracts(
      dependencyCronPreflight
    );
    expect(placeholderContracts).toHaveLength(6);
    expect(exactContracts).toEqual(placeholderContracts);
    expect(extractPostDeployCronContracts(postDeploy)).toEqual(
      placeholderContracts.map((contract) => ({
        jobName: contract.jobName,
        schedule: contract.schedule,
        command: contract.command,
      }))
    );
    expect(postDeploy).toContain(
      "job_row.database = current_database()"
    );
    expect(postDeploy).toContain("job_row.username = 'postgres'");
    expect(postDeploy).toContain(
      "current_setting('cron.launch_active_jobs', true)"
    );
    expect(postDeploy).toContain("current_setting('cron.timezone', true)");
    expect(postDeploy).toContain("all_maintenance_cron_definitions_exact");
    expect(postDeploy).toContain("all_maintenance_crons_inactive_exact");
    for (const jobName of [
      "delete-expired-amora-request-claims",
      "reconcile-stale-amora-chat-requests",
      "enforce-ai-interaction-retention",
      "enforce-application-survey-retention",
      "delete-expired-rate-limit-buckets",
    ]) {
      expect(productionPreflight).toContain(jobName);
      expect(dependencyCronPreflight).toContain(jobName);
    }
  });

  it("locks service-only maintenance RPCs and trigger functions at the release boundary", () => {
    expect(serviceOnlyFunctionAcl).toContain(
      "COALESCE(auth.role(), '') <> 'service_role'"
    );
    expect(serviceOnlyFunctionAcl).toContain(
      "p_key !~ '^rl:[0-9a-f]{64}$'"
    );
    for (const signature of [
      "public.check_rate_limit(text, integer, integer)",
      "public.redact_old_ai_interactions(interval)",
      "public.enforce_ai_interaction_retention()",
      "public.enforce_application_survey_retention()",
      "public.delete_expired_rate_limit_buckets()",
    ]) {
      expect(serviceOnlyFunctionAcl).toContain(
        `REVOKE ALL ON FUNCTION ${signature}`
      );
    }
    for (const signature of [
      "public.community_recalc_rank()",
      "public.create_profile_on_signup()",
      "public.guard_amora_user_message_insert()",
      "public.guard_profile_self_insert()",
      "public.prevent_cohort_membership_client_write()",
      "public.prevent_couple_ownership_self_change()",
      "public.prevent_couple_slot_self_change()",
      "public.prevent_is_admin_self_change()",
    ]) {
      expect(serviceOnlyFunctionAcl).toContain(
        `ALTER FUNCTION ${signature} SET search_path = public;`
      );
      expect(serviceOnlyFunctionAcl).toContain(
        `REVOKE ALL ON FUNCTION ${signature}`
      );
    }
    expect(productionPreflight).toContain(
      "ARRAY['p_job_id', 'p_worker_token', 'p_inventory']::text[]"
    );
    expect(productionPreflight).not.toContain(
      "ARRAY['p_job_id', 'p_lock_token', 'p_storage_inventory']::text[]"
    );
    expect(postDeploy).toContain(
      "all_client_denied_trigger_functions_exact"
    );
    expect(ship).toContain(
      "$Contract.all_client_denied_trigger_functions_exact -ne $true"
    );
    expect(postDeploy).toContain("all_client_denied_trigger_bindings_exact");
    expect(ship).toContain(
      "$Contract.all_client_denied_trigger_bindings_exact -ne $true"
    );
    expect(productionPreflight).toContain(
      "client_denied_trigger_binding_status"
    );
    expect(ship).toContain("client_denied_trigger_binding_status");
    expect(clientDeniedTriggerBindings).toContain(
      "CLIENT_DENIED_TRIGGER_BINDING_CONTRACT_MISMATCH"
    );
    expect(clientDeniedTriggerBindings).toContain(
      "trg_guard_amora_user_message_insert"
    );
  });

  it("revalidates every mutable production authorization immediately before push", () => {
    const finalDryRun = ship.indexOf('Invoke-Step "Final dry-run"');
    const immediateTopology = ship.indexOf(
      'Read-JsonQueryRow "Immediate pre-push migration topology"'
    );
    const immediateHealth = ship.indexOf(
      "$pushMaintenanceIdentity = Assert-MaintenanceHealth"
    );
    const immediateServiceIdentity = ship.indexOf(
      'Invoke-Step "Immediate service-role project identity recheck"'
    );
    const immediateAnonIdentity = ship.indexOf(
      'Invoke-Step "Immediate anonymous project identity recheck"'
    );
    const immediateBackup = ship.indexOf(
      "Assert-Backup $ExpectedProjectRef $BackupRef $maintenanceIdentity.StartedAt",
      immediateAnonIdentity
    );
    const immediateAccountDeletionDrain = ship.indexOf(
      "Assert-NoProcessingAccountDeletionJobs",
      finalDryRun
    );
    const lastMomentTopology = ship.indexOf(
      '"Last-moment pre-push migration topology"'
    );
    const lastMomentArtifacts = ship.indexOf(
      "Assert-ReleaseArtifactsUnchanged $reviewedHead $reviewedFingerprint",
      lastMomentTopology
    );
    const push = ship.indexOf('Invoke-Step "Push pending migrations"');

    expect(finalDryRun).toBeGreaterThanOrEqual(0);
    for (const marker of [
      immediateTopology,
      immediateHealth,
      immediateServiceIdentity,
      immediateAnonIdentity,
      immediateBackup,
      immediateAccountDeletionDrain,
      lastMomentTopology,
      lastMomentArtifacts,
    ]) {
      expect(marker).toBeGreaterThan(finalDryRun);
      expect(marker).toBeLessThan(push);
    }
    expect(ship.slice(finalDryRun, push)).toContain(
      "Maintenance authorization expired immediately before push."
    );
    expect(ship.slice(finalDryRun, push)).toContain(
      "Maintenance authorization expired during immediate pre-push verification."
    );
    expect(ship.slice(finalDryRun, push)).toContain("$reviewedDeployment");
    expect(ship).toContain("$reviewedDeployment = $reviewedHead");
    expect(ship).not.toContain("$reviewedHead.Substring(0, 12)");
    expect(ship).toContain("$ExpectedDeployment -notmatch '^[0-9a-f]{40}$'");
    expect(ship).toContain("$status.rateLimitKeySecretConfigured -ne $true");
    expect(ship).toContain('$status.amoraUsageLimitMode -ne "unlimited_test"');
    expect(ship).toContain("$status.researchCohortApplicationsEnabled -ne $false");
    expect(ship).toContain("$status.customerSurveyIntakeEnabled -ne $false");
    expect(ship).toContain("$status.accountDeletionCronEnabled -ne $false");
    expect(ship).toContain("$script:accountDeletionWorkerLeaseSeconds = 600");
    expect(ship).toContain("$script:accountDeletionMaxInvocationSeconds = 120");
    expect(ship).toContain("Assert-AccountDeletionWorkerDrainWindow");
    expect(ship).toContain(
      "Live deployment is missing a dedicated high-entropy RATE_LIMIT_KEY_SECRET that passes the strict configuration boundary."
    );
    expect(ship.slice(finalDryRun, push)).toContain(
      "Compare-Object $pendingVersions $pushPending"
    );
    const lastMomentGap = ship.slice(lastMomentTopology, push);
    expect(lastMomentTopology).toBeGreaterThan(immediateHealth);
    expect(immediateAccountDeletionDrain).toBeGreaterThan(immediateHealth);
    expect(immediateAccountDeletionDrain).toBeLessThan(lastMomentTopology);
    expect(lastMomentArtifacts).toBeGreaterThan(lastMomentTopology);
    expect(lastMomentGap).toContain(
      "Compare-Object $pendingVersions $lastMomentPending"
    );
    expect(lastMomentGap).not.toContain("Assert-MaintenanceHealth");
    expect(lastMomentGap).not.toContain("Assert-Backup");
    expect(lastMomentGap).not.toContain("--verify-access-only");
    expect(lastMomentGap).not.toContain("--verify-key-only");
    expect(ship).toContain(
      "The CLI cannot atomically bind"
    );
  });

  it("forbids quality-gate skips on protected production refs before release work", () => {
    const skipGuard = ship.indexOf(
      "$isProductionTarget -and ($SkipBuild -or $SkipLint -or $SkipAudit)"
    );
    const writeFence = ship.indexOf(
      '$targets.productionDatabaseWriteFence -ne "verified-v1"'
    );
    const typecheck = ship.indexOf('Invoke-Step "TypeScript check"');
    expect(skipGuard).toBeGreaterThanOrEqual(0);
    expect(skipGuard).toBeLessThan(writeFence);
    expect(skipGuard).toBeLessThan(typecheck);
    expect(ship).toContain(
      "Protected production refs forbid -SkipBuild, -SkipLint, and -SkipAudit."
    );
  });

  it("fails closed on unproven vendor uploads and requires the disabled post-state", () => {
    for (const sql of [productionPreflight, postDeploy, vendorUploadClosure]) {
      expect(sql).toContain("vendor-licenses");
      expect(sql).toContain("vendor-images");
      expect(sql).toContain(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
      );
      expect(sql).toContain("2f2ef78416318e6dd8fbd66c3507a2f9");
    }
    expect(productionPreflight).toContain("vendor_license_object_count");
    expect(productionPreflight).toContain("vendor_uuid_image_object_count");
    expect(productionPreflight).toContain(
      "vendor_storage_uploads_disabled_contract_exact"
    );
    expect(ship).toContain("$vendorLicenseObjectCount -ne 0");
    expect(ship).toContain("$vendorUuidImageObjectCount -ne 0");
    expect(ship).toContain(
      '$vendorStorageDisablePending = "20260711146000" -in $PendingVersions'
    );
    expect(postDeploy).toContain("vendor_upload_insert_policies_absent");
    expect(postDeploy).toContain("unproven_vendor_upload_objects_absent");
    expect(ship).toContain(
      "$Contract.vendor_upload_insert_policies_absent -ne $true"
    );
    expect(ship).toContain(
      "$Contract.unproven_vendor_upload_objects_absent -ne $true"
    );
    expect(vendorUploadClosure).not.toContain(
      "save_account_deletion_storage_inventory"
    );
  });

  it("pins authenticated rate limits to the account lifecycle contract", () => {
    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain(
        "public.check_rate_limit(text,integer,integer,uuid)"
      );
      expect(sql).toContain("7583f22c1daf9cebea4f7a847a6a507f");
      expect(sql).toContain("dbaddace99dcf6ddbe99da5eefe0797a");
      expect(sql).toContain("b8ebd5bbf8df5b250d36404f4d6f0a5c");
      expect(sql).toContain("rate_limit_buckets_subject_user_id_fkey");
      expect(sql).toContain("idx_rate_limit_buckets_subject_user_id");
      expect(sql).toContain("has_any_column_privilege(");
      expect(sql).toContain(
        "'service_role', 'public.rate_limit_buckets', 'INSERT'"
      );
      expect(sql).toContain(
        "'service_role', 'public.rate_limit_buckets', 'UPDATE'"
      );
    }
    expect(productionPreflight).toContain("rate_limit_subject_contract_exact");
    expect(postDeploy).toContain("rate_limit_subject_contract_exact");
    expect(ship).toContain(
      "$Contract.rate_limit_subject_contract_exact -ne $true"
    );
    expect(ship).toContain('Creator = "20260711147000"');
    for (const assertion of [
      "RATE_LIMIT_NULL_SUBJECT_CONTRACT_FAILED",
      "RATE_LIMIT_THREE_ARG_COMPAT_CONTRACT_FAILED",
      "RATE_LIMIT_SAME_SUBJECT_COUNT_CONTRACT_FAILED",
      "RATE_LIMIT_DIFFERENT_SUBJECT_WAS_NOT_REJECTED",
      "RATE_LIMIT_MISSING_SUBJECT_WAS_NOT_REJECTED",
      "RATE_LIMIT_DELETING_SUBJECT_WAS_NOT_REJECTED",
      "RATE_LIMIT_SUBJECT_DELETE_DID_NOT_CASCADE",
    ]) {
      expect(rateLimitSubjectSmoke).toContain(assertion);
    }
    expect(rateLimitSubjectSmoke.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(rateLimitSubjectSmoke).toMatch(
      /public\.check_rate_limit\(v_bound_key, 10, 60000\);/
    );
  });

  it("pins the complete durable account-deletion queue catalog", () => {
    for (const sql of [productionPreflight, postDeploy, accountDeletionGuardAcl]) {
      for (const column of [
        "user_id",
        "reason",
        "status",
        "attempts",
        "next_attempt_at",
        "lock_token",
        "locked_until",
        "storage_inventory",
        "last_error_code",
        "last_attempt_at",
        "dead_lettered_at",
        "completed_at",
        "created_at",
        "updated_at",
      ]) {
        expect(sql).toContain(`'${column}'`);
      }
      expect(sql).toContain("account_deletion_jobs_user_id_key");
      expect(sql).toContain("account_deletion_jobs_status_check");
      expect(sql).toContain("account_deletion_jobs_check2");
      expect(sql).toContain("account_deletion_jobs_check3");
      expect(sql).toContain("account_deletion_jobs_due_idx");
      expect(sql).toContain("account_deletion_jobs_stale_lock_idx");
      expect(sql).toContain("account_deletion_jobs_dead_letter_idx");
    }
    expect(postDeploy).toContain("account_deletion_jobs_catalog_exact");
    expect(ship).toContain("$Contract.account_deletion_jobs_catalog_exact -ne $true");
    for (const sql of [
      productionPreflight,
      postDeploy,
      accountDeletionStorageAuthRaceMigration,
    ]) {
      expect(sql).toContain("auth_delete_ready_until");
    }
    expect(productionPreflight).toContain("owned_storage_owners_over_20000");
    expect(productionPreflight).toContain("unattributed_chat_image_objects");
    expect(productionPreflight).toContain("orphaned_chat_image_objects");
    expect(productionPreflight).toContain("'processing_jobs'");
    expect(postDeploy).toContain("unattributed_chat_image_objects");
    expect(postDeploy).toContain("orphaned_chat_image_objects");
    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain("WHERE auth_owner.id = object_row.owner_id::uuid");
      expect(sql).toMatch(
        /'orphaned_chat_image_objects'[\s\S]*?CASE[\s\S]*?NOT EXISTS \([\s\S]*?FROM auth\.users AS auth_owner[\s\S]*?ELSE false[\s\S]*?END/
      );
    }
    expect(ship).toContain(
      "owned_storage_owners_over_20000 = [long]$Preflight.account_deletion_gate.owned_storage_owners_over_20000"
    );
    expect(ship).toContain(
      "unattributed_chat_image_objects = [long]$Preflight.account_deletion_gate.unattributed_chat_image_objects"
    );
    expect(ship).toContain(
      "orphaned_chat_image_objects = [long]$Preflight.account_deletion_gate.orphaned_chat_image_objects"
    );
    expect(ship).toContain(
      "([long]$Contract.orphaned_chat_image_objects -ne 0)"
    );
    expect(ship).toContain(
      "processing_account_deletion_jobs = [long]$Preflight.account_deletion_gate.processing_jobs"
    );
    expect(ship).toContain('Creator = "20260712105000"');
  });

  it("will not retire customized invitation template thumbnails as canonical seed data", () => {
    expect(invitationRetirement).toContain(
      "count(*) FILTER (WHERE thumbnail_url IS NOT NULL)"
    );
    expect(invitationRetirement).toContain("v_thumbnail_rows <> 0");
    expect(ship).toContain(
      "count(*) FILTER (WHERE thumbnail_url IS NOT NULL)::bigint AS thumbnail_count"
    );
    expect(ship).toContain("thumbnail_count -ne 0");
  });

  it("fails closed when a dynamic source is absent after its creator migration", () => {
    expect(ship).toContain("Assert-PreflightDynamicSourceTopology");
    expect(ship).toContain(
      "Required dynamic source $($requirement.Key) is absent after its creator migration."
    );
    for (const creator of [
      "20260705120000",
      "20260705160000",
      "20260706100000",
      "20260710050000",
      "20260710110000",
      "20260711139000",
    ]) {
      expect(ship).toContain(creator);
    }
  });

  it("emits and consumes the exact privacy-minimum remote contract", () => {
    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain("privacy_minimum_contract AS (");
      expect(sql).toContain("privacy_expected_table_acl(");
      expect(sql).toContain("privacy_expected_effective_acl AS (");
      expect(sql).toContain("privacy_effective_acl AS (");
      expect(sql).toContain("('community_profiles', 'PUBLIC', ARRAY[]::text[])");
      expect(sql).toContain("('community_achievements', 'PUBLIC', ARRAY[]::text[])");
      expect(sql).toContain("('community_vendor_tags', 'PUBLIC', ARRAY[]::text[])");
      expect(sql).toContain("view_row.reloptions = ARRAY['security_invoker=true']::text[]");
      expect(sql).toContain("constraint_row.convalidated");
      expect(sql).toContain("trigger_row.tgtype = 23");
      expect(sql).toContain("WHERE exact IS DISTINCT FROM true");
      expect(sql).toContain(
        "casewhencount\\*>=5thenroundavglatest\\.base_price::integer"
      );
      expect(sql).toContain(
        "casewhencountlatest\\.extra_price>=5andcountlatest\\.extra_price=count\\*thenroundavglatest\\.base_price\\+latest\\.extra_pricefilterwherelatest\\.extra_priceisnotnull::integer"
      );
      expect(sql).toContain(
        "orderbycontract.room_id,contract.category,contract.user_id,contract.created_atdescnullslast,contract.iddesc"
      );
      expect(sql).toContain("pg_catalog.has_table_privilege(");
      expect(sql).toContain("pg_catalog.has_any_column_privilege(");
      expect(sql).toContain(
        "AND coalesce((SELECT exact FROM privacy_effective_acl), false)"
      );
    }
    expect(productionPreflight).toContain(
      "AS privacy_minimum_contract_exact"
    );
    expect(productionPreflight).toContain(
      "AS privacy_minimum_invalid_cohort_rows"
    );
    expect(postDeploy).toMatch(
      /'privacy_minimum_contract_exact', coalesce\(\(\s*SELECT exact FROM privacy_minimum_contract/
    );
    expect(ship).toContain(
      '$privacyMinimumPending = "20260713100000" -in $PendingVersions'
    );
    expect(ship).toContain(
      "$Preflight.dynamic_sources.privacy_minimum_contract_exact -ne $true"
    );
    expect(ship).toContain(
      "$Contract.privacy_minimum_contract_exact -ne $true"
    );
  });

  it("uses all-of checks for required service privileges and any-of checks for forbidden browser privileges", () => {
    const positiveCombinedServicePrivilege =
      /(?<!NOT )has_table_privilege\(\s*'service_role',\s*(?:'[^']+'|[a-z_][\w.]*|to_regclass\([^)]*\)),\s*'[A-Z]+(?:,[A-Z]+)+'\s*\)/g;
    const forbiddenBrowserAnyOf =
      /NOT EXISTS\s*\([\s\S]{0,700}?WHERE has_table_privilege\(\s*client\.role_name,[\s\S]{0,180}?'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'\s*\)/;

    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).not.toMatch(positiveCombinedServicePrivilege);
      expect(sql).toMatch(forbiddenBrowserAnyOf);

      for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
        expect(sql).toContain(
          `'service_role', 'public.profiles', '${privilege}'`,
        );
      }
      expect(sql).toContain(
        "NOT has_table_privilege(\n        'service_role', 'public.profiles', 'DELETE'",
      );
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(sql).toContain(
          `'service_role', 'public.community_posts', '${privilege}'`,
        );
      }
      for (const privilege of ["SELECT", "INSERT", "DELETE"]) {
        expect(sql).toContain(
          `'service_role', table_row.oid, '${privilege}'`,
        );
      }
      expect(sql).toContain(
        "'service_role', table_row.oid,\n            'UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'",
      );
    }
  });

  it("fails closed across every trusted-beta retirement and community safety migration", () => {
    const contracts = [
      {
        version: "20260713112000",
        migration: rawCustomerTrackingRetirementMigration,
        replaceable: "raw_tracking_retirement_replaceable",
        exact: "raw_tracking_retirement_exact",
        migrationMarkers: [
          "REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role",
          "GRANT SELECT, DELETE ON TABLE public.customer_events TO service_role",
          "GRANT DELETE ON TABLE public.search_logs TO service_role",
          "raw-tracking column ACL remains",
          "TRUNCATE",
          "block_retired_raw_customer_tracking_writes",
          "enforce_raw_customer_tracking_retention",
          "interval '90 days'",
        ],
      },
      {
        version: "20260713112500",
        migration: profilesDirectSelectClosureMigration,
        replaceable: "profiles_direct_select_closure_replaceable",
        exact: "profiles_direct_select_closure_exact",
        migrationMarkers: [
          "REVOKE SELECT ON TABLE public.profiles",
          "get_my_profile_safe",
          "get_my_partner_public",
          "get_my_chat_view_state",
        ],
      },
      {
        version: "20260713113000",
        migration: communityMediaRetirementMigration,
        replaceable: "community_media_retirement_replaceable",
        exact: "community_media_retirement_exact",
        migrationMarkers: [
          "block_retired_community_media_object_writes",
          "block_retired_community_post_media_writes",
          "block_retired_community_poll_writes",
        ],
      },
      {
        version: "20260713114000",
        migration: congratulatoryMoneyRetirementMigration,
        replaceable: "congratulatory_money_retirement_replaceable",
        exact: "congratulatory_money_retirement_exact",
        migrationMarkers: [
          "REVOKE ALL ON TABLE public.congratulatory_money",
          "reject_congratulatory_money_write",
        ],
      },
      {
        version: "20260713115000",
        migration: communityTextOnlyBoundaryMigration,
        replaceable: "community_text_only_boundary_replaceable",
        exact: "community_text_only_boundary_exact",
        migrationMarkers: [
          "ALTER PUBLICATION supabase_realtime DROP TABLE public.community_posts",
          "block_retired_community_structured_fields",
          "search_vector",
        ],
      },
      {
        version: "20260713116000",
        migration: communityUserMutesMigration,
        replaceable: "community_user_mutes_replaceable",
        exact: "community_user_mutes_exact",
        migrationMarkers: [
          "CREATE TABLE IF NOT EXISTS public.community_user_mutes",
          "FORCE ROW LEVEL SECURITY",
          "GRANT SELECT, INSERT, DELETE ON TABLE public.community_user_mutes TO service_role",
          "CREATE OR REPLACE FUNCTION public.community_author_is_muted",
          "AND NOT public.community_author_is_muted(author_id)",
          "puballtables",
        ],
      },
      {
        version: "20260713117000",
        migration: communityCommentSafetyMigration,
        replaceable: "community_comment_safety_replaceable",
        exact: "community_comment_safety_exact",
        migrationMarkers: [
          "community_soft_delete_comment",
          "SET row_security = off",
          "FOR UPDATE",
          "COMMUNITY_COMMENT_DELETE_FUNCTION_ACL_NOT_EXACT",
        ],
      },
      {
        version: "20260713118000",
        migration: opaqueCommunityActorMigration,
        replaceable: "community_opaque_actor_boundary_replaceable",
        exact: "community_opaque_actor_boundary_exact",
        migrationMarkers: [
          "public_actor_id",
          "author_public_id",
          "community_profiles_public_nickname_nonempty",
          "community_profiles_public_avatar_emoji_only",
          "sync_community_actor_identity",
          "SECURITY DEFINER",
          "SET row_security = off",
          "WHERE auth_user.id = NEW.public_actor_id",
          "GRANT UPDATE (content, updated_at)",
          "TRUNCATE",
          "puballtables",
        ],
      },
      {
        version: "20260713119000",
        migration: communityPostLifecycleMigration,
        replaceable: "community_post_lifecycle_replaceable",
        exact: "community_post_lifecycle_exact",
        migrationMarkers: [
          "maintain_community_profile_post_count",
          "maintain_community_counts_after_comment_delete",
          "SET row_security = off",
          "REFERENCING OLD TABLE AS deleted_community_comments",
          "COMMUNITY_PROFILE_COMMENT_COUNT_RECONCILIATION_FAILED",
          "community_hard_delete_post",
          "FOR UPDATE",
        ],
      },
      {
        version: "20260713120000",
        migration: researchConsentVersionMigration,
        replaceable: "research_consent_version_replaceable",
        exact: "research_consent_version_exact",
        migrationMarkers: [
          "SET LOCAL lock_timeout = '5s'",
          "SET LOCAL statement_timeout = '120s'",
          "2026-07-12",
          "2026-07-14",
          "pg_catalog.pg_get_constraintdef(constraint_row.oid, true)",
          "privacy_policy_version = ANY",
          "VALIDATE CONSTRAINT research_cohort_applications_privacy_policy_check",
        ],
      },
      {
        version: "20260713121000",
        migration: communityPostUpdateMigration,
        replaceable: "community_post_update_replaceable",
        exact: "community_post_update_exact",
        migrationMarkers: [
          "community_update_post",
          "SET row_security = off",
          "p_patch jsonb",
          "FOR UPDATE",
          "COMMUNITY_POST_UPDATE_FUNCTION_ACL_NOT_EXACT",
        ],
      },
      {
        version: "20260713122000",
        migration: serviceRoleTableAclMigration,
        replaceable: "service_role_table_acl_replaceable",
        exact: "service_role_table_acl_exact",
        migrationMarkers: [
          "$rebuild_service_role_table_acl$",
          "amora_usage_reservations",
          "'MAINTAIN'",
          "PUBLIC table ACL remains on %",
          "service_role direct ACL is not exact on %",
        ],
      },
      {
        version: "20260713123000",
        migration: previewSmokeHarnessMigration,
        replaceable: "preview_smoke_harness_replaceable",
        exact: "preview_smoke_harness_exact",
        migrationMarkers: [
          "preview_smoke_projects_production_ref_check",
          "private.assert_preview_smoke_authorized",
          "public.assert_preview_smoke_ready",
          "public.prepare_preview_lifecycle_smoke_fixture",
          "public.inspect_preview_amora_smoke_turn",
          "public.cleanup_preview_smoke_fixture",
          "$assert_preview_smoke_acl$",
        ],
      },
    ] as const;

    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain("trusted_beta_function_contracts(");
      expect(sql).toContain("trusted_beta_trigger_contracts(");
      expect(sql).toContain("trusted_beta_surface_contract AS (");
      expect(sql).toContain("pg_catalog.pg_publication_tables");
      expect(sql).toContain("community_user_mutes_no_self");
      expect(sql).toContain("idx_community_user_mutes_muted_user");
      expect(sql).toContain("community_user_mutes_muter_id_fkey");
      expect(sql).toContain("community_user_mutes_muted_user_id_fkey");
      for (const hash of [
        "f031cc768a520d401c88ff041fe54f6a",
        "54e4f6ece31461d0f63ffbcb1d15ee6e",
        "4a127cecbf5bc39fed3ab8200e3ffaca",
        "0663224c1e2322c2c02d39945cb1e659",
        "5caa2a873cc53ade8dd64ba5163e80a1",
        "49a00b8e5ed57e5ccc46d71edce8001d",
        "8154296e2bd4b97fb2ab8b52ead5b39e",
        "993ce2d6eac939878a835e4c39eb4749",
        "06a4a3cfd01028b6bc8efffe4d308c45",
        "8b0a42a25c812f05ba84cc060dcfc24e",
        "1f94340d26771efa8d1fcf13e4eb875b",
        "65e9cb5b5a27f8446bdfbe5153c74366",
        "618d8f9a6968a99f285f4a09ab8da44e",
        "728309d11c41d182e4b3fe827004e90c",
        "b322f9adb70968e2a4220f404d138b0b",
        "6aac47ba565ff0f44bed0466a6d7b5d0",
        "0b72e707092ed3bc704bb19ff3df9aff",
      ]) {
        expect(sql).toContain(hash);
      }
    }
    expect(productionPreflight).toContain("9a4ad31283eaa7f89e7e34fb58ea8687");
    expect(postDeploy).not.toContain("9a4ad31283eaa7f89e7e34fb58ea8687");

    for (const contract of contracts) {
      expect(productionPreflight).toContain(
        `AS ${contract.replaceable}`
      );
      expect(productionPreflight).toContain(`AS ${contract.exact}`);
      expect(postDeploy).toContain(`'${contract.exact}'`);
      expect(ship).toContain(`Version = "${contract.version}"`);
      expect(ship).toContain(`Replaceable = "${contract.replaceable}"`);
      expect(ship).toContain(`Exact = "${contract.exact}"`);
      for (const marker of contract.migrationMarkers) {
        expect(contract.migration).toContain(marker);
      }
    }

    for (const [schemaName, functionName] of [
      ["private", "assert_preview_smoke_authorized"],
      ["private", "assert_preview_smoke_user"],
      ["public", "assert_preview_smoke_ready"],
      ["public", "prepare_preview_lifecycle_smoke_fixture"],
      ["public", "inspect_preview_amora_smoke_turn"],
      ["public", "cleanup_preview_smoke_fixture"],
    ] as const) {
      const hash = functionSourceMd5(
        previewSmokeHarnessMigration,
        functionName,
        schemaName
      );
      expect(productionPreflight).toContain(hash);
      expect(postDeploy).toContain(hash);
    }
    for (const productionRef of releaseTargets.productionSupabaseProjectRefs) {
      expect(previewSmokeHarnessMigration).toContain(`'${productionRef}'`);
      expect(productionPreflight).toContain(`'${productionRef}'`);
      expect(postDeploy).toContain(`'${productionRef}'`);
    }

    expect(productionPreflight).toContain("'raw_customer_events_expired'");
    expect(productionPreflight).toContain("'raw_search_logs_expired'");
    expect(postDeploy).toContain("'raw_customer_events_expired'");
    expect(postDeploy).toContain("'raw_search_logs_expired'");
    expect(ship).toContain(
      "raw_customer_events_expired = [long]$Preflight.data_rewrites.raw_customer_events_expired"
    );
    expect(ship).toContain(
      "raw_search_logs_expired = [long]$Preflight.data_rewrites.raw_search_logs_expired"
    );
    expect(dependencyCronPreflight).toContain(
      "'enforce-raw-customer-tracking-retention'"
    );
    expect(rawCustomerTrackingRetirementMigration).not.toContain(
      "GRANT ALL PRIVILEGES"
    );
    expect(postDeploy).toContain(
      "'enforce-raw-customer-tracking-retention'"
    );
    for (const sql of [productionPreflight, postDeploy]) {
      expect(sql).toContain("trusted_beta_mute_policy_status AS (");
      expect(sql).toContain("community_author_is_muted");
      expect(sql).toContain("client_read_policy");
      expect(sql).toContain("('community_posts', 'cp_select_drafts')");
      expect(sql).toContain(
        "'service_role', table_row.oid, 'UPDATE,REFERENCES'"
      );
      expect(sql).toContain("publication_row.puballtables");
      expect(sql).toContain("required.service_role_execute");
      expect(sql).toContain("required.anon_execute");
      expect(sql).toContain("required.authenticated_execute");
      expect(sql).toContain("trusted_beta_function_acl_status AS (");
      expect(sql).toContain("search_path=\"\",row_security=off");
      expect(sql).toContain(
        "'service_role', 'public.community_comments', 'INSERT'"
      );
      expect(sql).toContain(
        "'service_role', 'public.community_comments', 'TRUNCATE'"
      );
      expect(sql).toContain("ARRAY['content', 'updated_at']::name[]");
      expect(sql).toContain("community_profiles_public_nickname_nonempty");
      expect(sql).toContain("community_profiles_public_avatar_emoji_only");
    }
    expect(productionPreflight).toContain("research_consent_version_invalid_rows");
    expect(productionPreflight).not.toContain(
      "FROM public.research_cohort_applications"
    );
    expect(productionPreflight).not.toContain(
      "community_profile.public_actor_id"
    );
    expect(productionPreflight).toContain(
      "to_jsonb(community_profile)->>'public_actor_id'"
    );
    expect(postDeploy).toContain("'research_consent_version_invalid_rows'");
    expect(ship).toContain("research_consent_version_invalid_rows");
    expect(ship).toContain("Dynamic research consent-version inventory");
  });

  it("keeps active product and operations documents on the physical trust boundary", () => {
    const activeProductDocuments = [
      projectStatus,
      fullServiceOverview,
      serviceStandard,
      communityJourney,
    ];
    for (const document of activeProductDocuments) {
      expect(document).not.toContain("PUBLIC_BETA_CAPABILITIES");
      expect(document).toMatch(/물리적으로|물리적|별도 설계/);
    }

    expect(projectStatus).toContain("DB 영속 rate limit");
    expect(projectStatus).toContain("작성자 숨김");
    expect(fullServiceOverview).toContain("text-only");
    expect(fullServiceOverview).toContain("숨긴 작성자");
    expect(serviceStandard).toContain("5개 읽기 도구");
    expect(serviceStandard).toContain("OpenAI 전송 안내의 체크박스");
    expect(serviceStandard).toContain("DOCX");
    expect(serviceStandard).toContain("DB 영속 rate limit");
    expect(serviceStandard).toContain("항상 `503`");
    expect(serviceStandard).toContain("service_role");
    expect(serviceStandard).toContain("Realtime publication");
    expect(communityJourney).toContain("작성자 숨김");
    expect(communityJourney).toContain("전역 스위치는 두지 않으며");

    for (const operationsDocument of [
      productionReleaseRunbook,
      remoteOperations,
    ]) {
      expect(operationsDocument).toContain("20260713112000");
      expect(operationsDocument).toContain("20260713116000");
      expect(operationsDocument).toContain("20260713117000");
      expect(operationsDocument).toContain("20260713118000");
      expect(operationsDocument).toContain("20260713119000");
      expect(operationsDocument).toContain("20260713120000");
      expect(operationsDocument).toContain("20260713121000");
      expect(operationsDocument).toContain("20260713122000");
      expect(operationsDocument).toContain("20260713123000");
      expect(operationsDocument).toContain("puballtables");
      expect(operationsDocument).toContain("community_user_mutes");
      expect(operationsDocument).toContain("customerSurveyIntakeEnabled");
    }
    expect(remoteOperations).not.toMatch(/local migration은 총 \d+개/);
  });

  it("reloads ambiguous replacement mutations while preserving actionable 4xx errors", () => {
    const dispatchMarker = settingsPage.indexOf(
      "freshSpaceRequestDispatched = isCreatingFreshSpace"
    );
    const finallyBlock = settingsPage.indexOf("} finally {", dispatchMarker);
    const fullReload = settingsPage.indexOf("window.location.reload()", finallyBlock);

    expect(dispatchMarker).toBeGreaterThanOrEqual(0);
    expect(finallyBlock).toBeGreaterThan(dispatchMarker);
    expect(fullReload).toBeGreaterThan(finallyBlock);
    expect(settingsPage).toContain(
      "shouldReloadAfterFreshSpaceResponse(freshSpaceResponseStatus)"
    );
    expect(settingsPage).toContain(
      "setCoupleCodeError(apiResponseMessage(data"
    );
  });
});
