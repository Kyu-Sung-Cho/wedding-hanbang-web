import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");
const contractDir = resolve(repoRoot, "supabase/contract-migrations");

const amoraMigration = readFileSync(
  resolve(migrationsDir, "20260710050000_amora_request_claims.sql"),
  "utf8"
);
const uploadMigration = readFileSync(
  resolve(migrationsDir, "20260710080000_atomic_community_upload_quota.sql"),
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
});
