import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const packageJson = JSON.parse(readRepo("package.json")) as {
  scripts: Record<string, string>;
};
const releaseTargets = JSON.parse(readRepo("scripts/release-targets.json")) as {
  productionSupabaseProjectRefs: string[];
  productionDatabaseWriteFence: string;
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

describe("release safety contract", () => {
  it("keeps protected production blocked until a direct database write fence is verified", () => {
    expect(releaseTargets.productionSupabaseProjectRefs).toContain(
      "slrtobkksjmxgzatjyqb"
    );
    expect(releaseTargets.productionDatabaseWriteFence).toBe("not_configured");
    for (const script of [ship, reconcile]) {
      expect(script).toContain('productionDatabaseWriteFence -ne "verified-v1"');
    }
  });

  it("does not expose raw mutation aliases or include-all in guarded release commands", () => {
    expect(packageJson.scripts).not.toHaveProperty("supabase:push");
    expect(packageJson.scripts).not.toHaveProperty("supabase:apply:pending");
    expect(packageJson.scripts).not.toHaveProperty("supabase:baseline:history");
    expect(ship).not.toMatch(/db push[^\r\n]*--include-all/);
    expect(reconcile).not.toMatch(/db push[^\r\n]*--include-all/);
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

    expect(preflightSignatures).toHaveLength(50);
    expect(postDeploySignatures).toEqual(preflightSignatures);
    expect(ship).toContain("$script:expectedDependencyFunctionCount = 50");
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
    expect(ship).toContain("$status.rateLimitKeySecretConfigured -ne $true");
    expect(ship).toContain(
      "Live deployment is missing a RATE_LIMIT_KEY_SECRET of at least 32 trimmed characters."
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
