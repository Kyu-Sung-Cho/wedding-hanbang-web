import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");
const preregistrationBootstrapMigration = readFileSync(
  resolve(migrationsDir, "20260201000000_preregistrations.sql"),
  "utf8"
);
const vendorLeadMigration = readFileSync(
  resolve(migrationsDir, "20260511020000_vendor_lead_pipeline.sql"),
  "utf8"
);
const contractDir = resolve(repoRoot, "supabase/contract-migrations");

const amoraMigration = readFileSync(
  resolve(migrationsDir, "20260710050000_amora_request_claims.sql"),
  "utf8"
);
const uploadMigration = readFileSync(
  resolve(migrationsDir, "20260710080000_atomic_community_upload_quota.sql"),
  "utf8"
);
const accountDeletionQueueMigration = readFileSync(
  resolve(migrationsDir, "20260710070000_durable_account_deletion_queue.sql"),
  "utf8"
);
const retiredInvitationMigration = readFileSync(
  resolve(migrationsDir, "20260704131000_drop_dead_invitation_tables.sql"),
  "utf8"
);
const legacyCoreBaseline = readFileSync(
  resolve(migrationsDir, "20260202000000_legacy_core_baseline.sql"),
  "utf8"
);
const legacyCommunityRpcMigration = readFileSync(
  resolve(migrationsDir, "20260613130000_harden_community_rpc_permissions.sql"),
  "utf8"
);
const legacyCommunityBaseMigration = readFileSync(
  resolve(migrationsDir, "20260325000000_community.sql"),
  "utf8"
);
const legacyCommunityStorageMigration = readFileSync(
  resolve(migrationsDir, "20260615093000_harden_community_media_storage.sql"),
  "utf8"
);
const disabledContract = readFileSync(
  resolve(contractDir, "20260710060000_release_surface_lockdown.sql.disabled"),
  "utf8"
);
const providerCounterScopeMigration = readFileSync(
  resolve(migrationsDir, "20260711137000_scope_amora_provider_counter_seed.sql"),
  "utf8"
);
const bookingRpcLockMigration = readFileSync(
  resolve(migrationsDir, "20260711138000_lock_booking_rpc_to_service_role.sql"),
  "utf8"
);
const amoraReservationMigration = readFileSync(
  resolve(migrationsDir, "20260711139000_idempotent_amora_usage_reservations.sql"),
  "utf8"
);
const marketplaceCommunityGuardMigration = readFileSync(
  resolve(migrationsDir, "20260711140000_expand_only_marketplace_community_guards.sql"),
  "utf8"
);
const deterministicRetentionMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260711141000_deterministic_application_survey_retention.sql"
  ),
  "utf8"
);
const forwardInviteLifecycleMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260711142000_forward_invite_lifecycle_contract.sql"
  ),
  "utf8"
);
const accountDeletionInvitationForwardMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260711143000_account_deletion_invitation_forward_contract.sql"
  ),
  "utf8"
);
const accountDeletionTriggerAclMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260711144000_lock_account_deletion_trigger_function_acl.sql"
  ),
  "utf8"
);
const serviceOnlyFunctionAclMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260711145000_lock_service_only_function_acl.sql"
  ),
  "utf8"
);
const vendorUploadClosureMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260711146000_disable_unproven_vendor_uploads.sql"
  ),
  "utf8"
);
const rateLimitSubjectMigration = readFileSync(
  resolve(migrationsDir, "20260711147000_rate_limit_subject_lifecycle.sql"),
  "utf8"
);
const clientDeniedTriggerBindingMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260711148000_verify_client_denied_trigger_bindings.sql"
  ),
  "utf8"
);
const researchCohortIdentityMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260712100000_research_cohort_application_identity.sql"
  ),
  "utf8"
);
const accountDeletionEmailScopeMigration = readFileSync(
  resolve(
    migrationsDir,
    "20260712101000_durable_account_deletion_email_scope.sql"
  ),
  "utf8"
);

const activePendingMigrationNames = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql") && name >= "20260710000000")
  .sort();
const activePendingSql = activePendingMigrationNames
  .map((name) => readFileSync(resolve(migrationsDir, name), "utf8"))
  .join("\n");
const contractSqlNames = readdirSync(contractDir).filter((name) =>
  name.includes(".sql")
);

describe("expand-only mobile migration contract", () => {
  it("uses search-path-independent UUID defaults during fresh replay", () => {
    for (const migration of [
      preregistrationBootstrapMigration,
      vendorLeadMigration,
    ]) {
      expect(migration).toContain("DEFAULT gen_random_uuid()");
      expect(migration).not.toContain("uuid_generate_v4()");
    }
  });

  it("normalizes CRLF before exact function-source hashing", () => {
    for (const name of [
      "20260711144000_lock_account_deletion_trigger_function_acl.sql",
      "20260711145000_lock_service_only_function_acl.sql",
      "20260711146000_disable_unproven_vendor_uploads.sql",
      "20260711147000_rate_limit_subject_lifecycle.sql",
    ]) {
      const migration = readFileSync(resolve(migrationsDir, name), "utf8");
      expect(migration, name).not.toMatch(/md5\([^\n]*\.prosrc\)/);
      expect(migration, name).toContain("chr(13)");
    }
  });


  it("owns transaction boundaries for migrations with gates, locks, or destructive DDL", () => {
    const atomicMigrations = [
      legacyCoreBaseline,
      retiredInvitationMigration,
      amoraMigration,
      accountDeletionQueueMigration,
      marketplaceCommunityGuardMigration,
      deterministicRetentionMigration,
      forwardInviteLifecycleMigration,
      accountDeletionInvitationForwardMigration,
      accountDeletionTriggerAclMigration,
      serviceOnlyFunctionAclMigration,
      vendorUploadClosureMigration,
      rateLimitSubjectMigration,
      clientDeniedTriggerBindingMigration,
      researchCohortIdentityMigration,
      accountDeletionEmailScopeMigration,
    ];

    for (const migration of atomicMigrations) {
      expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
      expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
      expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
      expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
      expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
      expect(migration).toMatch(/SET LOCAL statement_timeout = '\d+s';/);
      expect(migration.indexOf("SET LOCAL lock_timeout")).toBeLessThan(
        migration.search(/^(?:CREATE|ALTER|UPDATE|DELETE|LOCK|DO)\b/m)
      );
    }
  });

  it("locks account-deletion trigger guards against every direct caller", () => {
    for (const signature of [
      "public.guard_account_deletion_user_reference()",
      "public.guard_account_deletion_rate_limit_write()",
    ]) {
      expect(accountDeletionTriggerAclMigration).toContain(
        `ALTER FUNCTION ${signature} OWNER TO postgres;`
      );
      expect(accountDeletionTriggerAclMigration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION ${signature.replace(/[()]/g, "\\$&")}\\s+FROM PUBLIC, anon, authenticated, service_role;`
        )
      );
    }
    expect(accountDeletionTriggerAclMigration).toContain(
      "0518d47d1da58e822a8b6ba662bd06eb"
    );
    expect(accountDeletionTriggerAclMigration).toContain(
      "6f78ae5968446ee2f94e53d2573d4d29"
    );
    expect(accountDeletionTriggerAclMigration).toContain(
      "ACCOUNT_DELETION_TRIGGER_GUARD_CONTRACT_MISMATCH"
    );
    expect(accountDeletionTriggerAclMigration).toContain(
      "ACCOUNT_DELETION_JOB_COLUMN_CONTRACT_MISMATCH"
    );
    expect(accountDeletionTriggerAclMigration).toContain(
      "ACCOUNT_DELETION_JOB_CONSTRAINT_CONTRACT_MISMATCH"
    );
    expect(accountDeletionTriggerAclMigration).toContain(
      "ACCOUNT_DELETION_JOB_INDEX_CONTRACT_MISMATCH"
    );
    expect(accountDeletionTriggerAclMigration).toContain(
      "AMORA_MAINTENANCE_CRON_CONTRACT_MISMATCH"
    );
  });

  it("locks rate-limit and retention maintenance behind the service boundary", () => {
    expect(serviceOnlyFunctionAclMigration).toContain(
      "COALESCE(auth.role(), '') <> 'service_role'"
    );
    expect(serviceOnlyFunctionAclMigration).toContain(
      "p_key !~ '^rl:[0-9a-f]{64}$'"
    );
    expect(serviceOnlyFunctionAclMigration).toContain(
      "533a53dbb36455bafb743070bcf6644b"
    );
    for (const signature of [
      "public.check_rate_limit(text, integer, integer)",
      "public.redact_old_ai_interactions(interval)",
      "public.enforce_ai_interaction_retention()",
      "public.enforce_application_survey_retention()",
      "public.delete_expired_rate_limit_buckets()",
    ]) {
      const escaped = signature.replace(/[()]/g, "\\$&");
      expect(serviceOnlyFunctionAclMigration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION ${escaped}\\s+FROM PUBLIC, anon, authenticated;`
        )
      );
      expect(serviceOnlyFunctionAclMigration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${escaped}\\s+TO service_role;`)
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
      expect(serviceOnlyFunctionAclMigration).toContain(
        `ALTER FUNCTION ${signature} SET search_path = public;`
      );
      expect(serviceOnlyFunctionAclMigration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}`
      );
    }
    for (const cron of [
      "enforce-ai-interaction-retention",
      "enforce-application-survey-retention",
      "delete-expired-rate-limit-buckets",
    ]) {
      expect(serviceOnlyFunctionAclMigration).toContain(`'${cron}'`);
    }
    expect(serviceOnlyFunctionAclMigration).toContain(
      "SERVICE_FUNCTION_CONTRACT_MISMATCH"
    );
    expect(serviceOnlyFunctionAclMigration).toContain(
      "TRIGGER_FUNCTION_ACL_CONTRACT_MISMATCH"
    );
    expect(serviceOnlyFunctionAclMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_profile_on_signup()"
    );
    expect(serviceOnlyFunctionAclMigration).toContain(
      "84a6f9f7f2c366bb87703fcc25cc2f22"
    );
    expect(serviceOnlyFunctionAclMigration).toContain(
      "RETENTION_MAINTENANCE_CRON_CONTRACT_MISMATCH"
    );
  });

  it("disables unproven vendor uploads without deleting or inventorying objects", () => {
    const lock = vendorUploadClosureMigration.indexOf(
      "LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;"
    );
    const gate = vendorUploadClosureMigration.indexOf(
      "UNPROVEN_VENDOR_UPLOADS_PRESENT"
    );
    const firstPolicyDrop = vendorUploadClosureMigration.indexOf(
      'DROP POLICY IF EXISTS "업체: 본인 이미지 업로드"'
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(lock);
    expect(firstPolicyDrop).toBeGreaterThan(gate);
    expect(vendorUploadClosureMigration).toContain(
      "WHERE bucket_id = 'vendor-licenses'"
    );
    expect(vendorUploadClosureMigration).toContain(
      "(storage.foldername(name))[1] ~*"
    );
    for (const policy of [
      "업체: 본인 이미지 업로드",
      "업체: 사업자등록증 업로드",
      "vendor images own folder insert",
      "vendor licenses own folder insert",
    ]) {
      expect(vendorUploadClosureMigration).toContain(
        `DROP POLICY IF EXISTS "${policy}" ON storage.objects;`
      );
    }
    expect(vendorUploadClosureMigration).toContain(
      "NEW.bucket_id IN ('vendor-images', 'vendor-licenses')"
    );
    expect(vendorUploadClosureMigration).toContain(
      "COALESCE(auth.role(), '') <> 'service_role'"
    );
    expect(vendorUploadClosureMigration).toContain(
      "2f2ef78416318e6dd8fbd66c3507a2f9"
    );
    expect(vendorUploadClosureMigration).toContain(
      "VENDOR_UPLOAD_GUARD_TRIGGER_CONTRACT_MISMATCH"
    );
    expect(vendorUploadClosureMigration).not.toContain(
      "save_account_deletion_storage_inventory"
    );
    expect(vendorUploadClosureMigration).not.toMatch(
      /DELETE FROM storage\.objects/
    );
  });

  it("records every client-denied trigger function's exact live binding", () => {
    const lockOrder = [
      "LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;",
      "LOCK TABLE public.chat_messages IN SHARE ROW EXCLUSIVE MODE;",
      "LOCK TABLE public.cohort_members IN SHARE ROW EXCLUSIVE MODE;",
      "LOCK TABLE public.community_profiles IN SHARE ROW EXCLUSIVE MODE;",
      "LOCK TABLE public.couples IN SHARE ROW EXCLUSIVE MODE;",
      "LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;",
    ].map((statement) => clientDeniedTriggerBindingMigration.indexOf(statement));
    expect(lockOrder.every((position) => position >= 0)).toBe(true);
    expect(lockOrder).toEqual([...lockOrder].sort((a, b) => a - b));

    for (const [schema, table, trigger, signature] of [
      ["public", "community_profiles", "trg_recalc_rank", "public.community_recalc_rank()"],
      ["auth", "users", "on_auth_user_created", "public.create_profile_on_signup()"],
      ["public", "chat_messages", "trg_guard_amora_user_message_insert", "public.guard_amora_user_message_insert()"],
      ["public", "profiles", "trg_guard_profile_self_insert", "public.guard_profile_self_insert()"],
      ["public", "cohort_members", "trg_prevent_cohort_membership_client_write", "public.prevent_cohort_membership_client_write()"],
      ["public", "profiles", "trg_prevent_couple_ownership_self_change", "public.prevent_couple_ownership_self_change()"],
      ["public", "couples", "trg_prevent_couple_slot_self_change", "public.prevent_couple_slot_self_change()"],
      ["public", "profiles", "trg_prevent_is_admin_self_change", "public.prevent_is_admin_self_change()"],
    ]) {
      expect(clientDeniedTriggerBindingMigration).toContain(
        `'${schema}', '${table}', '${trigger}'`
      );
      expect(clientDeniedTriggerBindingMigration).toContain(`'${signature}'`);
      expect(clientDeniedTriggerBindingMigration).toContain(
        `DROP TRIGGER IF EXISTS ${trigger}`
      );
      expect(clientDeniedTriggerBindingMigration).toContain(
        `CREATE TRIGGER ${trigger}`
      );
    }
    expect(clientDeniedTriggerBindingMigration).toContain(
      "trigger_row.tgfoid IS DISTINCT FROM"
    );
    expect(clientDeniedTriggerBindingMigration).toContain(
      "pg_get_triggerdef(trigger_row.oid, true)"
    );
    expect(clientDeniedTriggerBindingMigration).toContain(
      "CLIENT_DENIED_TRIGGER_BINDING_CONTRACT_MISMATCH"
    );
  });

  it("binds authenticated rate limits to account deletion lifecycle", () => {
    expect(rateLimitSubjectMigration).toContain(
      "ADD COLUMN IF NOT EXISTS subject_user_id uuid"
    );
    expect(rateLimitSubjectMigration).toContain(
      "FOREIGN KEY (subject_user_id)"
    );
    expect(rateLimitSubjectMigration).toContain("ON DELETE CASCADE");
    expect(rateLimitSubjectMigration).toContain(
      "idx_rate_limit_buckets_subject_user_id"
    );
    expect(rateLimitSubjectMigration).toContain(
      "public.check_rate_limit(text, integer, integer, uuid)"
    );
    for (const hash of [
      "7583f22c1daf9cebea4f7a847a6a507f",
      "dbaddace99dcf6ddbe99da5eefe0797a",
      "b8ebd5bbf8df5b250d36404f4d6f0a5c",
    ]) {
      expect(rateLimitSubjectMigration).toContain(hash);
    }
    expect(rateLimitSubjectMigration).toContain(
      "rate limit subject mismatch"
    );
    expect(rateLimitSubjectMigration).toContain(
      "rate limit subject changed; retry"
    );
    expect(rateLimitSubjectMigration).toContain("ERRCODE = '40001'");
    expect(rateLimitSubjectMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.check_rate_limit\(\s*p_key text,\s*p_max_requests integer,\s*p_window_ms integer\s*\)[\s\S]*?SELECT bucket\.subject_user_id INTO v_existing_subject_user_id[\s\S]*?FROM public\.check_rate_limit\([\s\S]*?v_existing_subject_user_id/
    );
    expect(rateLimitSubjectMigration).toContain(
      "RATE_LIMIT_SUBJECT_TRIGGER_CONTRACT_MISMATCH"
    );
  });

  it("keeps the published direct chat insert and linked-partner read paths", () => {
    expect(amoraMigration).toContain(
      'CREATE POLICY "chat_insert_couple" ON public.chat_messages'
    );
    expect(amoraMigration).toContain(
      "GRANT INSERT ON TABLE public.chat_messages TO authenticated;"
    );
    expect(amoraMigration).not.toContain(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );

    expect(activePendingSql).not.toContain(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );

    const functionStart = activePendingSql.lastIndexOf(
      "CREATE OR REPLACE FUNCTION public.can_read_profile"
    );
    const functionEnd = activePendingSql.indexOf(
      "REVOKE ALL ON FUNCTION public.can_read_profile",
      functionStart
    );
    const functionSql = activePendingSql.slice(functionStart, functionEnd);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);
    expect(functionSql).toContain("JOIN public.profiles AS partner");
    expect(functionSql).toContain(
      "couple.bride_id = caller.id AND couple.groom_id = partner.id"
    );
    expect(functionSql).toContain(
      "couple.groom_id = caller.id AND couple.bride_id = partner.id"
    );
  });

  it("never classifies or rewrites historical one-slot couples automatically", () => {
    expect(amoraMigration).not.toContain(
      "WHERE (bride_id IS NULL) <> (groom_id IS NULL);"
    );
    expect(activePendingSql).not.toContain(
      "WHERE (bride_id IS NULL) <> (groom_id IS NULL);"
    );
    expect(activePendingSql).not.toMatch(
      /FOR v_couple IN\s+SELECT id FROM public\.couples[\s\S]*?invite_code/
    );
    expect(amoraMigration).toMatch(
      /individually\s+-- audited couple ids only after an export, classification, and change approval/
    );
  });

  it("makes revoked invite codes nullable before lifecycle functions can retire them", () => {
    expect(legacyCoreBaseline).toContain("invite_code text NOT NULL UNIQUE");

    const dropNotNull = amoraMigration.indexOf(
      "ALTER COLUMN invite_code DROP NOT NULL;"
    );
    const restartFunction = amoraMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.restart_blocked_amora_couple_safely"
    );
    const leaveFunction = amoraMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.leave_amora_couple_safely"
    );
    const firstRevocation = amoraMigration.indexOf("invite_code = NULL");

    expect(dropNotNull).toBeGreaterThanOrEqual(0);
    expect(restartFunction).toBeGreaterThan(dropNotNull);
    expect(leaveFunction).toBeGreaterThan(dropNotNull);
    expect(firstRevocation).toBeGreaterThan(dropNotNull);
  });

  it("repairs legacy invite formats only behind verified member ownership", () => {
    const inviteFunctionStart = amoraMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_or_rotate_invite_code_safely"
    );
    const inviteFunctionEnd = amoraMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.get_or_rotate_invite_code_safely",
      inviteFunctionStart
    );
    const inviteFunction = amoraMigration.slice(
      inviteFunctionStart,
      inviteFunctionEnd
    );
    const membershipLock = inviteFunction.indexOf("FROM public.profiles");
    const coupleLock = inviteFunction.indexOf("FROM public.couples");
    const legacyRepair = inviteFunction.indexOf(
      "v_invite_code !~ '^WH-[A-F0-9]{12}$'"
    );
    const blockedGuard = inviteFunction.indexOf(
      "IF v_replacement_blocked_at IS NOT NULL"
    );
    const blockedNullResponse = inviteFunction.indexOf(
      "'invite_code', NULL",
      blockedGuard
    );

    expect(inviteFunctionStart).toBeGreaterThanOrEqual(0);
    expect(inviteFunctionEnd).toBeGreaterThan(inviteFunctionStart);
    expect(membershipLock).toBeGreaterThanOrEqual(0);
    expect(coupleLock).toBeGreaterThan(membershipLock);
    expect(inviteFunction.slice(membershipLock, coupleLock)).toContain("FOR UPDATE");
    expect(inviteFunction.slice(coupleLock, legacyRepair)).toContain("FOR UPDATE");
    expect(blockedGuard).toBeGreaterThan(coupleLock);
    expect(blockedNullResponse).toBeGreaterThan(blockedGuard);
    expect(legacyRepair).toBeGreaterThan(blockedNullResponse);
    expect(legacyRepair).toBeGreaterThan(coupleLock);
  });

  it("prevents replacement-blocked couples from retaining a joinable code", () => {
    expect(amoraMigration).toMatch(
      /ADD CONSTRAINT couples_blocked_invite_revoked\s+CHECK \(amora_replacement_blocked_at IS NULL OR invite_code IS NULL\);/
    );
    expect(amoraMigration).toMatch(
      /amora_replacement_blocked_at = now\(\),\s+invite_code = NULL/
    );
    expect(forwardInviteLifecycleMigration).toContain(
      "ALTER COLUMN invite_code DROP NOT NULL;"
    );
    expect(forwardInviteLifecycleMigration).toContain(
      "couples_blocked_invite_revoked"
    );
  });

  it("never lets a preserved zero-member legacy couple become joinable", () => {
    const joinStart = amoraMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.join_couple_server"
    );
    const joinEnd = amoraMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.join_couple_server",
      joinStart
    );
    const joinSql = amoraMigration.slice(joinStart, joinEnd);

    expect(joinStart).toBeGreaterThanOrEqual(0);
    expect(joinEnd).toBeGreaterThan(joinStart);
    expect(joinSql).toContain("AND (bride_id IS NOT NULL OR groom_id IS NOT NULL)");
    expect(joinSql).toContain("AND amora_replacement_blocked_at IS NULL");
    expect(forwardInviteLifecycleMigration).toContain(
      "AND (bride_id IS NOT NULL OR groom_id IS NOT NULL)"
    );
  });

  it("bounds production lock acquisition before the first Amora table change", () => {
    const lockTimeout = amoraMigration.indexOf("SET LOCAL lock_timeout = '5s';");
    const statementTimeout = amoraMigration.indexOf(
      "SET LOCAL statement_timeout = '110s';"
    );
    const firstAlter = amoraMigration.indexOf("ALTER TABLE public.couples");

    expect(lockTimeout).toBeGreaterThanOrEqual(0);
    expect(statementTimeout).toBeGreaterThan(lockTimeout);
    expect(firstAlter).toBeGreaterThan(statementTimeout);
  });

  it("keeps legacy community vote and bookmark contracts during expand", () => {
    expect(activePendingSql).not.toMatch(
      /REVOKE[^;]*ON TABLE public\.community_votes[^;]*FROM[^;]*\b(?:anon|authenticated)\b[^;]*;/i
    );
    expect(activePendingSql).not.toMatch(
      /REVOKE[^;]*ON TABLE public\.community_bookmarks[^;]*FROM[^;]*\b(?:anon|authenticated)\b[^;]*;/i
    );
    expect(activePendingSql).not.toContain(
      'DROP POLICY IF EXISTS "cb_all" ON public.community_bookmarks;'
    );
    expect(activePendingSql).not.toMatch(
      /REVOKE ALL ON FUNCTION public\.community_vote_post\([\s\S]{0,80}FROM anon, authenticated/
    );
    expect(activePendingSql).not.toMatch(
      /REVOKE[^;]*public\.community_vote_post\([^;]*FROM authenticated;/
    );

    expect(legacyCommunityRpcMigration).toContain(
      "AND (auth.uid() IS NULL OR auth.uid() <> p_user_id)"
    );
    expect(legacyCommunityRpcMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.community_vote_post\([\s\S]{0,80}TO authenticated/
    );
    expect(legacyCommunityBaseMigration).toContain(
      'CREATE POLICY "cb_all" ON community_bookmarks FOR ALL USING (user_id = auth.uid());'
    );
  });

  it("keeps direct authenticated community uploads while reserving new API uploads", () => {
    expect(legacyCommunityStorageMigration).toMatch(
      /CREATE POLICY "community-images own folder write"[\s\S]*?FOR INSERT TO authenticated[\s\S]*?bucket_id = 'community-images'[\s\S]*?auth\.uid\(\)::text/
    );
    expect(activePendingSql).not.toMatch(
      /DROP POLICY IF EXISTS "community-images (?:authenticated|own folder) (?:write|update)"/
    );

    const compatibilityBypass = uploadMigration.indexOf(
      "IF COALESCE(auth.role(), '') = 'authenticated' THEN"
    );
    const reservationLookup = uploadMigration.indexOf(
      "FROM public.community_upload_reservations",
      compatibilityBypass
    );

    expect(compatibilityBypass).toBeGreaterThanOrEqual(0);
    expect(reservationLookup).toBeGreaterThan(compatibilityBypass);
    expect(uploadMigration).toContain(
      "The new server route uses service_role and must"
    );
  });

  it("keeps destructive retirement outside automatic migrations and fails it closed", () => {
    expect(activePendingMigrationNames).not.toContain(
      "20260710060000_release_surface_lockdown.sql"
    );
    expect(disabledContract).toContain("MOBILE_CONTRACT_RELEASE_GATE_REQUIRED");
    expect(disabledContract).toContain("hanbang.contract_min_mobile_version");
    expect(disabledContract).toContain("zero-for-14-days");
    expect(disabledContract).toContain(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );
    expect(disabledContract).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_bookmarks FROM anon, authenticated;"
    );
    expect(disabledContract).toContain(
      'DROP POLICY IF EXISTS "community-images own folder write" ON storage.objects;'
    );

    expect(activePendingSql).not.toContain("FUTURE CONTRACT MIGRATION");
    expect(activePendingSql).not.toContain("MOBILE_CONTRACT_RELEASE_GATE_REQUIRED");
    expect(contractSqlNames.length).toBeGreaterThan(0);
    expect(contractSqlNames.every((name) => name.endsWith(".sql.disabled"))).toBe(true);

    const releaseGate = disabledContract.indexOf("MOBILE_CONTRACT_RELEASE_GATE_REQUIRED");
    const firstChatRetirement = disabledContract.indexOf(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );
    const firstCommunityRetirement = disabledContract.indexOf(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_posts FROM anon, authenticated;"
    );
    expect(releaseGate).toBeGreaterThanOrEqual(0);
    expect(firstChatRetirement).toBeGreaterThan(releaseGate);
    expect(firstCommunityRetirement).toBeGreaterThan(releaseGate);
  });

  it("retires invitation storage without leaving deletion-queue references", () => {
    expect(retiredInvitationMigration).toContain(
      "DROP TABLE IF EXISTS public.invitations RESTRICT;"
    );
    expect(retiredInvitationMigration).toContain(
      "DROP TABLE IF EXISTS public.invitation_photos RESTRICT;"
    );
    expect(retiredInvitationMigration).not.toMatch(/DROP TABLE[^;]+CASCADE;/);
    expect(accountDeletionQueueMigration).not.toContain("public.invitations");

    const storageGuardStart = accountDeletionQueueMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.guard_user_media_storage_write()"
    );
    const storageGuardEnd = accountDeletionQueueMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.guard_user_media_storage_write()",
      storageGuardStart
    );
    const storageGuard = accountDeletionQueueMigration.slice(
      storageGuardStart,
      storageGuardEnd
    );

    expect(storageGuardStart).toBeGreaterThanOrEqual(0);
    expect(storageGuardEnd).toBeGreaterThan(storageGuardStart);
    expect(storageGuard).not.toContain("invitation-photos");
    expect(accountDeletionQueueMigration).not.toContain("invitation-photos");
    expect(accountDeletionInvitationForwardMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.guard_user_media_storage_write()"
    );
    expect(accountDeletionInvitationForwardMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.save_account_deletion_storage_inventory("
    );
    expect(accountDeletionInvitationForwardMigration).not.toContain("public.invitations");
    expect(accountDeletionInvitationForwardMigration).not.toContain("'invitation-photos'");

    const dataGate = retiredInvitationMigration.indexOf(
      "INVITATION_DATA_EXPORT_REQUIRED"
    );
    const firstLegacyLock = retiredInvitationMigration.indexOf(
      "LOCK TABLE %s IN ACCESS EXCLUSIVE MODE"
    );
    const storageBucketLock = retiredInvitationMigration.indexOf(
      "WHERE id = 'invitation-photos'"
    );
    const storageGate = retiredInvitationMigration.indexOf(
      "INVITATION_STORAGE_EXPORT_REQUIRED"
    );
    const bucketRetirement = retiredInvitationMigration.indexOf(
      "UPDATE storage.buckets"
    );
    const firstTableDrop = retiredInvitationMigration.indexOf(
      "DROP TABLE IF EXISTS public.invitation_visits RESTRICT;"
    );

    expect(firstLegacyLock).toBeGreaterThanOrEqual(0);
    expect(storageBucketLock).toBeGreaterThan(firstLegacyLock);
    expect(
      retiredInvitationMigration.slice(storageBucketLock, dataGate)
    ).toContain("FOR UPDATE;");
    expect(dataGate).toBeGreaterThan(storageBucketLock);
    expect(retiredInvitationMigration).toContain(
      "299c29b7db8596dfb373cd2684751e47"
    );
    expect(retiredInvitationMigration).toContain(
      "INVITATION_TEMPLATE_EXPORT_REQUIRED"
    );
    expect(storageGate).toBeGreaterThan(dataGate);
    expect(bucketRetirement).toBeGreaterThan(storageGate);
    expect(
      retiredInvitationMigration.slice(bucketRetirement, firstTableDrop)
    ).toContain("SET public = false");
    expect(firstTableDrop).toBeGreaterThan(bucketRetirement);
  });

  it("does not let deterministic audit rows consume the OpenAI provider breaker", () => {
    expect(providerCounterScopeMigration).toContain(
      "model IN ('gpt-5.6-luna', 'gpt-5.6-terra')"
    );
    expect(providerCounterScopeMigration).toContain("model LIKE 'gpt-5.6-luna-%'");
    expect(providerCounterScopeMigration).toContain("model LIKE 'gpt-5.6-terra-%'");
    expect(providerCounterScopeMigration).not.toContain(
      "created_at >= v_kst_day_start AND model IS NOT NULL"
    );
    expect(providerCounterScopeMigration).toContain("Existing current-day rows are not reduced");
    expect(providerCounterScopeMigration).toContain("LEAST(p_couple_cap, 30)");
    expect(providerCounterScopeMigration).toContain("LEAST(p_global_provider_cap, 60)");
    expect(providerCounterScopeMigration).toContain(
      "IF COALESCE(auth.role(), '') <> 'service_role' THEN"
    );
    expect(providerCounterScopeMigration).toContain(
      "'couple:provider_calls:' || p_couple_id::text || ':'"
    );
    expect(providerCounterScopeMigration).toContain(
      "IF v_couple_provider_count >= 20 THEN"
    );
    expect(providerCounterScopeMigration).toContain(
      "RETURN QUERY SELECT false, 'couple_provider_daily'::text"
    );
    expect(providerCounterScopeMigration).not.toContain("v_global_count >= p_global_provider_cap");
  });

  it("keeps the SECURITY DEFINER booking writer behind the service boundary", () => {
    expect(bookingRpcLockMigration).toContain(
      "IF COALESCE(auth.role(), '') <> 'service_role' THEN"
    );
    expect(bookingRpcLockMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_booking_atomic\([\s\S]*?FROM PUBLIC, anon, authenticated;/
    );
    expect(bookingRpcLockMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_booking_atomic\([\s\S]*?TO service_role;/
    );
    expect(bookingRpcLockMigration).toContain("booking time must match an hourly slot");
    expect(bookingRpcLockMigration).toContain("AND status = 'approved'");
  });

  it("makes provider reservations replayable and refunds only unfinished visible turns", () => {
    expect(amoraReservationMigration).toContain(
      "PRIMARY KEY (request_key, provider_ordinal)"
    );
    expect(amoraReservationMigration).toContain("LEAST(p_couple_cap, 30)");
    expect(amoraReservationMigration).toContain("LEAST(p_global_provider_cap, 60)");
    expect(amoraReservationMigration).toContain("v_claim.status = 'completed'");
    expect(amoraReservationMigration).toContain("AND visible_state = 'pending'");
    expect(amoraReservationMigration).toContain("SET count = GREATEST(count - 1, 0)");
    expect(amoraReservationMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reserve_amora_usage_v2\([\s\S]*?FROM PUBLIC, anon, authenticated;/
    );

    const failStart = amoraReservationMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.fail_amora_chat_request"
    );
    const failEnd = amoraReservationMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.fail_amora_chat_request",
      failStart
    );
    const failSql = amoraReservationMigration.slice(failStart, failEnd);

    expect(failStart).toBeGreaterThanOrEqual(0);
    expect(failEnd).toBeGreaterThan(failStart);
    expect(failSql).toMatch(
      /counted_user_turn\s+AND visible_state = 'pending'[\s\S]*?ORDER BY provider_ordinal[\s\S]*?LIMIT 1[\s\S]*?FOR UPDATE/
    );
    expect(failSql).toMatch(
      /IF v_reservation\.provider_state = 'reserved' THEN[\s\S]*?SET count = GREATEST\(count - 1, 0\)[\s\S]*?provider_state = 'failed_unstarted'[\s\S]*?ELSIF v_reservation\.provider_state = 'started' THEN[\s\S]*?provider_state = 'failed_unknown'/
    );
    const globalCounterLocks = failSql.indexOf(
      "SELECT DISTINCT reservation.global_counter_key"
    );
    const coupleProviderLocks = failSql.indexOf(
      "'couple:provider_calls:' || reservation.couple_id::text"
    );
    const visibleCounterLock = failSql.indexOf(
      "v_couple_key := 'couple:user_turns:' || v_couple_id::text"
    );
    const reservationLocks = failSql.indexOf(
      "PERFORM reservation.provider_ordinal"
    );
    expect(globalCounterLocks).toBeGreaterThanOrEqual(0);
    expect(coupleProviderLocks).toBeGreaterThan(globalCounterLocks);
    expect(visibleCounterLock).toBeGreaterThan(coupleProviderLocks);
    expect(reservationLocks).toBeGreaterThan(visibleCounterLock);
    expect(amoraReservationMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.expire_stale_amora_chat_request"
    );
    expect(amoraReservationMigration).toContain(
      "FROM public.fail_amora_chat_request(p_request_key, p_request_hash, 'stale_lease')"
    );
  });

  it("pins lease-gated provider starts and completion settlement", () => {
    expect(amoraReservationMigration).toContain(
      "ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz"
    );
    expect(amoraReservationMigration).toContain(
      "ALTER COLUMN lease_expires_at SET DEFAULT (now() + interval '7 minutes')"
    );
    expect(amoraReservationMigration).toContain(
      "ALTER COLUMN lease_expires_at SET NOT NULL"
    );
    expect(amoraReservationMigration).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_amora_request_claims_stale_lease\s+ON public\.amora_request_claims\(lease_expires_at\)\s+WHERE status = 'in_progress';/
    );
    expect(amoraReservationMigration).toMatch(
      /CHECK \(provider_state IN \(\s*'reserved', 'started', 'completed', 'failed_unstarted', 'failed_unknown'\s*\)\)/
    );

    const markStartedStart = amoraReservationMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.mark_amora_provider_started"
    );
    const markStartedEnd = amoraReservationMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.mark_amora_provider_started",
      markStartedStart
    );
    const markStartedSql = amoraReservationMigration.slice(
      markStartedStart,
      markStartedEnd
    );

    expect(markStartedStart).toBeGreaterThanOrEqual(0);
    expect(markStartedEnd).toBeGreaterThan(markStartedStart);
    expect(markStartedSql).toContain("SET provider_state = 'started'");
    expect(markStartedSql).toContain(
      "AND reservation.provider_state = 'reserved'"
    );
    expect(markStartedSql).toContain("AND claim.status = 'in_progress'");
    expect(markStartedSql).toContain("AND claim.lease_expires_at > now()");
    expect(markStartedSql).toContain("RETURN v_state IN ('started', 'completed')");
    expect(amoraReservationMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.mark_amora_provider_started\(text, text, integer\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(amoraReservationMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mark_amora_provider_started\(text, text, integer\)\s+TO service_role;/
    );

    const settlementStart = amoraReservationMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.settle_amora_reservations_on_claim_status"
    );
    const settlementTrigger = amoraReservationMigration.indexOf(
      "CREATE TRIGGER trg_settle_amora_reservations_on_claim_status",
      settlementStart
    );

    expect(settlementStart).toBeGreaterThanOrEqual(0);
    expect(settlementTrigger).toBeGreaterThan(settlementStart);
    expect(amoraReservationMigration.slice(settlementStart, settlementTrigger)).toMatch(
      /NEW\.status = 'completed'[\s\S]*?SET provider_state = 'completed',[\s\S]*?visible_state = CASE WHEN counted_user_turn THEN 'consumed'/
    );
    expect(amoraReservationMigration.slice(settlementStart, settlementTrigger)).toMatch(
      /NEW\.status = 'failed'[\s\S]*?OLD\.status = 'in_progress'[\s\S]*?reservation\.visible_state = 'pending'[\s\S]*?reservation\.provider_state IN \('reserved', 'started'\)[\s\S]*?FROM public\.fail_amora_chat_request\([\s\S]*?'request_failed'/
    );
    expect(amoraReservationMigration.slice(settlementTrigger)).toMatch(
      /CREATE TRIGGER trg_settle_amora_reservations_on_claim_status\s+AFTER UPDATE OF status ON public\.amora_request_claims\s+FOR EACH ROW EXECUTE FUNCTION public\.settle_amora_reservations_on_claim_status\(\);/
    );

    const failStart = amoraReservationMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.fail_amora_chat_request"
    );
    const failEnd = amoraReservationMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.fail_amora_chat_request",
      failStart
    );
    const failSql = amoraReservationMigration.slice(failStart, failEnd);
    expect(failStart).toBeGreaterThanOrEqual(0);
    expect(failEnd).toBeGreaterThan(failStart);
    expect(failSql.indexOf("SET status = 'failed'")).toBeGreaterThan(
      failSql.indexOf("ELSIF v_reservation.provider_state = 'started'")
    );

    expect(amoraReservationMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reconcile_stale_amora_chat_requests\([\s\S]*?FOR UPDATE SKIP LOCKED[\s\S]*?public\.fail_amora_chat_request\([\s\S]*?'stale_lease'/
    );
    expect(amoraReservationMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reconcile_stale_amora_chat_requests\(integer\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(amoraReservationMigration).toContain(
      "'SELECT public.reconcile_stale_amora_chat_requests(100);'"
    );
    expect(amoraReservationMigration).toContain("'*/5 * * * *'");
  });

  it("pins the visible ordinal invariant and per-couple provider daily ceiling", () => {
    expect(amoraReservationMigration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_amora_one_visible_turn_per_request\s+ON public\.amora_usage_reservations\(request_key\)\s+WHERE counted_user_turn;/
    );
    expect(amoraReservationMigration).toContain(
      "OR (p_count_user_turn AND p_provider_ordinal <> 0)"
    );

    const reserveStart = amoraReservationMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.reserve_amora_usage_v2"
    );
    const reserveEnd = amoraReservationMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.reserve_amora_usage_v2",
      reserveStart
    );
    const checkStart = amoraReservationMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.check_amora_usage"
    );
    const checkEnd = amoraReservationMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.check_amora_usage",
      checkStart
    );
    const reserveSql = amoraReservationMigration.slice(reserveStart, reserveEnd);
    const checkSql = amoraReservationMigration.slice(checkStart, checkEnd);

    expect(reserveStart).toBeGreaterThanOrEqual(0);
    expect(reserveEnd).toBeGreaterThan(reserveStart);
    expect(checkStart).toBeGreaterThanOrEqual(0);
    expect(checkEnd).toBeGreaterThan(checkStart);
    for (const sql of [reserveSql, checkSql]) {
      expect(sql).toContain("'couple:provider_calls:' || p_couple_id::text || ':'");
      expect(sql).toContain("'couple_provider_daily'::text");
      expect(sql).toMatch(
        /LEAST\(\s*GREATEST\(v_effective_global_cap - v_global_count, 0\),\s*GREATEST\(v_effective_couple_provider_cap - v_couple_provider_count(?: - 1)?, 0\)\s*\)/
      );
    }
    expect(reserveSql).toContain(
      "v_effective_couple_provider_cap integer := 20"
    );
    expect(reserveSql).toMatch(
      /VALUES \(\s*v_couple_provider_key,\s*GREATEST\([\s\S]*?FROM public\.amora_usage_reservations[\s\S]*?FROM public\.ai_interactions_log[\s\S]*?couple_id = p_couple_id/
    );
    expect(reserveSql).toMatch(
      /VALUES \(\s*v_global_key,\s*GREATEST\([\s\S]*?FROM public\.ai_interactions_log[\s\S]*?FROM public\.amora_usage_reservations[\s\S]*?global_counter_key = v_global_key/
    );
    expect(checkSql).toMatch(
      /SELECT COALESCE\(\s*\(SELECT count FROM public\.amora_turn_counters WHERE key = v_couple_provider_key\),\s*GREATEST\([\s\S]*?FROM public\.amora_usage_reservations[\s\S]*?FROM public\.ai_interactions_log[\s\S]*?couple_id = p_couple_id/
    );
    expect(reserveSql).toContain("WHERE key = v_couple_provider_key");
    expect(checkSql).toContain(
      "IF v_couple_provider_count >= v_effective_couple_provider_cap THEN"
    );
  });

  it("blocks marketplace self-approval and identifier disclosure", () => {
    expect(marketplaceCommunityGuardMigration).toContain("vendor_server_fields_forbidden");
    expect(marketplaceCommunityGuardMigration).toContain(
      "REVOKE SELECT ON TABLE public.vendors FROM PUBLIC, anon, authenticated"
    );
    expect(marketplaceCommunityGuardMigration).toContain("'id', 'name', 'category'");
    expect(marketplaceCommunityGuardMigration).not.toContain(
      "'id', 'owner_id', 'name'"
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "REVOKE SELECT ON TABLE public.vendor_reviews FROM PUBLIC, anon, authenticated"
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      'CREATE POLICY "vendor_reviews_select" ON public.vendor_reviews FOR SELECT'
    );
  });

  it("serializes and deduplicates community reports before moderation", () => {
    const reportsLock = marketplaceCommunityGuardMigration.indexOf(
      "LOCK TABLE public.community_reports IN SHARE ROW EXCLUSIVE MODE;"
    );
    const postGuard = marketplaceCommunityGuardMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.guard_community_post_server_fields"
    );
    const firstDedupe = marketplaceCommunityGuardMigration.indexOf("WITH ranked AS (");

    expect(reportsLock).toBeGreaterThanOrEqual(0);
    expect(postGuard).toBeGreaterThan(reportsLock);
    expect(firstDedupe).toBeGreaterThan(reportsLock);
    expect(marketplaceCommunityGuardMigration).toMatch(
      /row_number\(\) OVER \(\s*PARTITION BY reporter_id, post_id\s*ORDER BY created_at ASC NULLS LAST, id ASC\s*\)/
    );
    expect(marketplaceCommunityGuardMigration).toMatch(
      /row_number\(\) OVER \(\s*PARTITION BY reporter_id, comment_id\s*ORDER BY created_at ASC NULLS LAST, id ASC\s*\)/
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "uq_community_report_reporter_post"
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "uq_community_report_reporter_comment"
    );

    const autoReviewStart = marketplaceCommunityGuardMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.community_report_auto_review"
    );
    const autoReviewEnd = marketplaceCommunityGuardMigration.indexOf(
      "REVOKE ALL ON FUNCTION public.community_report_auto_review",
      autoReviewStart
    );
    const autoReviewSql = marketplaceCommunityGuardMigration.slice(
      autoReviewStart,
      autoReviewEnd
    );
    const postRowLock = autoReviewSql.indexOf(
      "PERFORM 1 FROM public.community_posts"
    );
    const distinctCount = autoReviewSql.indexOf(
      "SELECT COUNT(DISTINCT reporter_id) INTO v_count"
    );

    expect(autoReviewStart).toBeGreaterThanOrEqual(0);
    expect(autoReviewEnd).toBeGreaterThan(autoReviewStart);
    expect(postRowLock).toBeGreaterThanOrEqual(0);
    expect(autoReviewSql.slice(postRowLock, distinctCount)).toContain("FOR UPDATE;");
    expect(distinctCount).toBeGreaterThan(postRowLock);
    expect(autoReviewSql).toContain("IF v_count >= 3 THEN");
    expect(marketplaceCommunityGuardMigration).toMatch(
      /UPDATE public\.community_posts post[\s\S]*?WHERE NOT COALESCE\(post\.under_review, false\)[\s\S]*?HAVING COUNT\(DISTINCT report\.reporter_id\) >= 3/
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "NOT COALESCE(under_review, false) OR author_id = auth.uid()"
    );
  });

  it("guards comment ownership, parent linkage, and dormant guestbook data", () => {
    expect(marketplaceCommunityGuardMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.guard_community_comment_server_fields"
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "NEW.created_at := now()"
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "OR NEW.created_at IS DISTINCT FROM OLD.created_at"
    );
    expect(marketplaceCommunityGuardMigration).toMatch(
      /NEW\.parent_id IS NOT NULL AND NOT EXISTS \([\s\S]*?parent\.id = NEW\.parent_id[\s\S]*?parent\.post_id = NEW\.post_id[\s\S]*?community_comment_parent_mismatch/
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "CREATE TRIGGER trg_guard_community_comment_server_fields"
    );
    expect(marketplaceCommunityGuardMigration).toContain(
      "REVOKE ALL ON TABLE public.guestbook_messages FROM PUBLIC, anon, authenticated"
    );
    expect(marketplaceCommunityGuardMigration).toMatch(
      /UPDATE storage\.buckets\s+SET public = false\s+WHERE id = 'guestbook-uploads';/
    );
  });

  // Static source regression only: staging must still apply these migrations on
  // the supported PostgreSQL/Supabase versions and exercise their runtime behavior.
  it("pins deterministic retention locks, bounds, triggers, and cleanup indexes", () => {
    const preregistrationLock = deterministicRetentionMigration.indexOf(
      "LOCK TABLE public.preregistrations IN ACCESS EXCLUSIVE MODE;"
    );
    const surveyLock = deterministicRetentionMigration.indexOf(
      "LOCK TABLE public.customer_survey_responses IN ACCESS EXCLUSIVE MODE;"
    );
    const firstBackfill = deterministicRetentionMigration.indexOf(
      "UPDATE public.preregistrations"
    );

    expect(preregistrationLock).toBeGreaterThanOrEqual(0);
    expect(surveyLock).toBeGreaterThan(preregistrationLock);
    expect(firstBackfill).toBeGreaterThan(surveyLock);
    expect(deterministicRetentionMigration).toMatch(
      /ALTER TABLE public\.preregistrations\s+ALTER COLUMN created_at SET DEFAULT now\(\),\s+ALTER COLUMN created_at SET NOT NULL,\s+ALTER COLUMN expires_at SET DEFAULT \(now\(\) \+ interval '180 days'\),\s+ALTER COLUMN expires_at SET NOT NULL;/
    );
    expect(deterministicRetentionMigration).toMatch(
      /ADD CONSTRAINT preregistrations_retention_cap\s+CHECK \(expires_at <= created_at \+ interval '180 days'\);/
    );
    expect(deterministicRetentionMigration).toContain(
      "CREATE TRIGGER trg_clamp_preregistration_retention"
    );
    expect(deterministicRetentionMigration).toMatch(
      /ALTER TABLE public\.customer_survey_responses\s+ALTER COLUMN expires_at SET DEFAULT \(now\(\) \+ interval '365 days'\),\s+ALTER COLUMN expires_at SET NOT NULL;/
    );
    expect(deterministicRetentionMigration).toMatch(
      /ADD CONSTRAINT customer_survey_responses_retention_cap\s+CHECK \(expires_at <= created_at \+ interval '365 days'\);/
    );
    expect(deterministicRetentionMigration).toContain(
      "CREATE TRIGGER trg_clamp_customer_survey_retention"
    );
    expect(deterministicRetentionMigration).toMatch(
      /UPDATE public\.customer_survey_responses\s+SET q23_contact = NULL,\s+user_agent = NULL\s+WHERE q23_contact IS NOT NULL\s+OR user_agent IS NOT NULL;/
    );
    expect(deterministicRetentionMigration).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_customer_survey_expires_at\s+ON public\.customer_survey_responses\(expires_at\);/
    );
    expect(deterministicRetentionMigration).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_preregistrations_expires_at\s+ON public\.preregistrations\(expires_at\);/
    );
    expect(deterministicRetentionMigration).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at\s+ON public\.rate_limit_buckets\(reset_at\);/
    );
  });

  it("separates research consent identity from legacy preregistration rows", () => {
    expect(researchCohortIdentityMigration).toContain(
      "CREATE TABLE public.research_cohort_applications"
    );
    expect(researchCohortIdentityMigration).toContain("No legacy consent is inferred");
    expect(researchCohortIdentityMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(researchCohortIdentityMigration).toContain("SET LOCAL statement_timeout = '120s'");
    expect(researchCohortIdentityMigration).toContain(
      "UNIQUE (cohort_code, email)"
    );
    expect(researchCohortIdentityMigration).toContain(
      "CHECK (cohort_code = 'research-2026-h2')"
    );
    expect(researchCohortIdentityMigration).toContain(
      "email = lower(btrim(email))"
    );
    expect(researchCohortIdentityMigration).toContain(
      "char_length(email) BETWEEN 3 AND 254"
    );
    expect(researchCohortIdentityMigration).toContain(
      "wedding_date date"
    );
    expect(researchCohortIdentityMigration).toContain(
      "wedding_date BETWEEN DATE '2026-07-01' AND DATE '2026-12-31'"
    );
    expect(researchCohortIdentityMigration).toContain(
      "CHECK (privacy_consent_at = created_at)"
    );
    expect(researchCohortIdentityMigration).toContain(
      "CHECK (privacy_policy_version = '2026-07-12')"
    );
    expect(researchCohortIdentityMigration).toContain(
      "CHECK (source = 'research')"
    );
    expect(researchCohortIdentityMigration).toMatch(
      /CHECK \(\s*expires_at >= created_at\s+AND expires_at <= created_at \+ interval '180 days'\s*\)/
    );
    expect(researchCohortIdentityMigration).toContain(
      "research_cohort_applications_receipt_lifecycle_check"
    );
    expect(researchCohortIdentityMigration).toContain(
      "trg_clamp_research_cohort_application_retention"
    );
    expect(researchCohortIdentityMigration).toContain(
      "email_verified_at timestamptz"
    );
    expect(researchCohortIdentityMigration).toContain(
      "research_cohort_applications_email_verification_window_check"
    );
    expect(researchCohortIdentityMigration).toContain(
      "privacy_consent_at IS NOT NULL AND email_verified_at IS NOT NULL"
    );
    expect(researchCohortIdentityMigration).toContain(
      "DELETE FROM public.research_cohort_applications"
    );
    expect(researchCohortIdentityMigration).not.toContain(
      "DROP CONSTRAINT IF EXISTS preregistrations_email_key"
    );
  });

  it("keeps a temporary email-scope attestation until account deletion completes", () => {
    expect(accountDeletionEmailScopeMigration).toContain(
      "ACTIVE_DELETION_EMAIL_SNAPSHOT_RECONCILIATION_REQUIRED"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "ADD COLUMN email_scopes text[]"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "ADD COLUMN email_snapshot_at timestamptz"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "account_deletion_jobs_email_snapshot_lifecycle_check"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "account_deletion_email_scopes_are_canonical"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "account_deletion_jobs_email_scopes_canonical_check"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "scope.value <> lower(btrim(scope.value))"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "count(DISTINCT scope.value)"
    );
    expect(accountDeletionEmailScopeMigration).toMatch(
      /SET user_id = NULL,\s+email_scopes = NULL,\s+email_snapshot_at = NULL,\s+status = 'completed'/
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "ALTER FUNCTION public.request_account_deletion(uuid, text) OWNER TO postgres"
    );
    expect(accountDeletionEmailScopeMigration).toContain(
      "ALTER FUNCTION public.complete_account_deletion_job(uuid, uuid)"
    );
    const centralPreregDelete = accountDeletionEmailScopeMigration.indexOf(
      "DELETE FROM public.preregistrations"
    );
    const centralResearchDelete = accountDeletionEmailScopeMigration.indexOf(
      "DELETE FROM public.research_cohort_applications"
    );
    const legacyScrub = accountDeletionEmailScopeMigration.indexOf(
      "UPDATE public.account_deletions"
    );
    const subjectScrub = accountDeletionEmailScopeMigration.indexOf(
      "SET user_id = NULL,",
      legacyScrub + 1
    );
    expect(centralPreregDelete).toBeGreaterThanOrEqual(0);
    expect(centralResearchDelete).toBeGreaterThan(centralPreregDelete);
    expect(legacyScrub).toBeGreaterThan(centralResearchDelete);
    expect(subjectScrub).toBeGreaterThan(legacyScrub);
    expect(accountDeletionEmailScopeMigration).toContain(
      "email = ANY(v_email_scopes)"
    );
  });
});
