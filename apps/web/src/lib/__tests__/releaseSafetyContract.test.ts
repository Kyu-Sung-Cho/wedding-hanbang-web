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
  backupPolicy: { status: string; allowedRestoreProjectRefs: string[] };
};
const ship = readRepo("scripts/supabase-ship-safe.ps1");
const reconcile = readRepo("scripts/supabase-reconcile-core-baseline.ps1");
const lifecycleSmoke = readRepo("scripts/supabase-lifecycle-smoke.mjs");
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
const mobileReleaseReadiness = readRepo("scripts/mobile-release-readiness.mjs");
const liveSmoke = readRepo("scripts/live-smoke-test.mjs");
const researchCohortMigration = readRepo(
  "supabase/migrations/20260712100000_research_cohort_application_identity.sql"
);
const accountDeletionEmailScopeMigration = readRepo(
  "supabase/migrations/20260712101000_durable_account_deletion_email_scope.sql"
);

function functionSourceMd5(sql: string, functionName: string): string {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${escapedName}\\([\\s\\S]*?AS \\$\\$(?<body>[\\s\\S]*?)\\$\\$;`
  ));
  if (!match?.groups?.body) throw new Error(`Missing function body: ${functionName}`);
  return createHash("md5")
    .update(match.groups.body.replace(/\r/g, ""), "utf8")
    .digest("hex");
}

describe("release safety contract", () => {
  it("keeps protected production blocked until a direct database write fence is verified", () => {
    expect(releaseTargets.productionSupabaseProjectRefs).toContain(
      "slrtobkksjmxgzatjyqb"
    );
    expect(releaseTargets.productionDatabaseWriteFence).toBe("not_configured");
    expect(releaseTargets.approvedNonProductionSupabaseProjectRefs).toEqual([]);
    expect(releaseTargets.productionDatabaseWriteFenceContract).toBe(
      "database-readonly-realtime-cron-v1"
    );
    expect(releaseTargets.backupPolicy).toMatchObject({
      status: "not_configured",
      allowedRestoreProjectRefs: [],
    });
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
    expect(reviewedPowerShellLauncher).toContain('"powershell.exe" : "pwsh"');
    expect(reviewedPowerShellLauncher).toContain("spawnSync(executable");
    expect(reviewedPowerShellLauncher).not.toContain("shell:");
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

  it("scans both tracked and untracked repository files before a commit", () => {
    expect(repositorySecretScan).toContain('"--cached", "--others", "--exclude-standard"');
    expect(repositorySecretScan).toContain("[repository-secret-scan]");
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
    expect(liveSmoke).toContain('if (arg === "--") continue;');
    expect(liveSmoke).toContain('--launch-mode=<mode>');
    expect(liveSmoke).toContain('--expected-sha=<sha>');
    expect(liveSmoke).toContain('--research-intake=<state>');
    expect(liveSmoke).toContain('options.launchMode === "coming_soon"');
    expect(liveSmoke).toContain('body?.code !== "SERVICE_NOT_LAUNCHED"');
    expect(liveSmoke).toContain('intakeBody?.code !== "RESEARCH_INTAKE_CLOSED"');
    expect(liveSmoke).toContain('intakeResponse.headers()["cache-control"]?.includes("no-store")');
    expect(liveSmoke).toContain('options.researchIntake === "closed"');
    expect(liveSmoke).toContain("healthBody?.researchCohortApplicationsEnabled");
    expect(liveSmoke).toContain('final.searchParams.has("next")');
    expect(liveSmoke).toContain('healthBody?.deployment !== options.expectedSha.toLowerCase()');
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
  });

  it("preserves pnpm argument forwarding while rejecting unknown live-smoke options", () => {
    const run = (lastArgument: "--help" | "--definitely-unknown-live-smoke-option") => {
      const executable = process.platform === "win32"
        ? process.env.ComSpec ?? "cmd.exe"
        : "corepack";
      const args = process.platform === "win32"
        ? ["/d", "/s", "/c", `corepack pnpm qa:live -- ${lastArgument}`]
        : ["pnpm", "qa:live", "--", lastArgument];
      return spawnSync(executable, args, {
        cwd: repoRoot,
        encoding: "utf8",
        shell: false,
        timeout: 15_000,
      });
    };

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
    const validFingerprint =
      "85:25:B7:5F:66:FC:6A:85:0D:A7:57:A2:CA:D2:47:B9:F6:EB:C7:81:10:D3:2F:B7:2C:84:42:0D:AE:B6:40:0D";
    const run = (identityArgs: string[]) => spawnSync(
      process.execPath,
      [script, "--launch-mode=coming_soon", ...identityArgs],
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
  });

  it("forbids destructive lifecycle smoke tests on every protected production ref", () => {
    expect(lifecycleSmoke).toContain(
      "releaseTargets.productionSupabaseProjectRefs.includes(actualProjectRef)"
    );
    expect(lifecycleSmoke).toContain(
      "Lifecycle smoke tests are forbidden on protected production projects."
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

    expect(preflightSignatures).toHaveLength(52);
    expect(postDeploySignatures).toEqual(preflightSignatures);
    expect(ship).toContain("$script:expectedDependencyFunctionCount = 52");
    expect(ship).toContain("$script:expectedDependencyCronCount = 5");
    expect(ship).toContain(
      "$script:expectedClientDeniedTriggerFunctionCount = 8"
    );
    expect(ship).toContain(
      "$script:expectedClientDeniedTriggerBindingCount = 8"
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
      "public.insert_amora_user_message(uuid,uuid,text,text,text)",
      "public.reconcile_stale_amora_chat_requests(integer)",
      "public.delete_expired_amora_request_claims()",
      "public.apply_journey_progress_patch(uuid,jsonb,text[])",
      "public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)",
      "public.reserve_amora_usage(uuid,integer,integer,boolean)",
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
      expect(sql).toContain("08f9136df3b8fc79f1abf1ee33a0bb95");
      expect(sql).toContain("7224cdd797c3db1613059d9fc79e7fb4");
      expect(sql).toContain("ba6534442ff7bc582d4bdefc396bc841");
    }
    expect(productionPreflight).toMatch(
      /public\.enforce_application_survey_retention\(\)[\s\S]*?04d9b06eedd9eec0c19cf29e5b1a9968[\s\S]*?20260711141000'[\s\S]*?20260712100000'/
    );
    expect(productionPreflight).toContain(
      "'20260710070000', '20260712101000'"
    );
  });

  it("derives forward-migration function hashes from the reviewed SQL bodies", () => {
    const contracts = [
      [researchCohortMigration, "enforce_application_survey_retention"],
      [accountDeletionEmailScopeMigration, "account_deletion_email_scopes_are_canonical"],
      [accountDeletionEmailScopeMigration, "request_account_deletion"],
      [accountDeletionEmailScopeMigration, "renew_account_deletion_job_lease"],
      [accountDeletionEmailScopeMigration, "complete_account_deletion_job"],
    ] as const;

    for (const [migration, functionName] of contracts) {
      const hash = functionSourceMd5(migration, functionName);
      expect(productionPreflight, functionName).toContain(hash);
      expect(postDeploy, functionName).toContain(hash);
    }
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
    expect(postDeploy).toContain(
      "attribute_row.attname IN ('email_scopes', 'email_snapshot_at')"
    );
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
    const placeholderContracts = extractPreflightCronContracts(
      productionPreflight
    );
    const exactContracts = extractPreflightCronContracts(
      dependencyCronPreflight
    );
    expect(placeholderContracts).toHaveLength(5);
    expect(exactContracts).toEqual(placeholderContracts);
    expect(extractPostDeployCronContracts(postDeploy)).toEqual(
      placeholderContracts.map((contract) => ({
        jobName: contract.jobName,
        schedule: contract.schedule,
        command: contract.command,
      }))
    );
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
    expect(ship).toContain("$status.researchCohortApplicationsEnabled -ne $false");
    expect(ship).toContain("$status.accountDeletionCronEnabled -ne $false");
    expect(ship).toContain(
      "Live deployment is missing a dedicated high-entropy RATE_LIMIT_KEY_SECRET that passes the strict configuration boundary."
    );
    expect(ship.slice(finalDryRun, push)).toContain(
      "Compare-Object $pendingVersions $pushPending"
    );
    const lastMomentGap = ship.slice(lastMomentTopology, push);
    expect(lastMomentTopology).toBeGreaterThan(immediateHealth);
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
