-- READ-ONLY RELEASE AUDIT. This file must never be placed in migrations/.
-- It proves that the nine historical migrations listed in the Amora release
-- manifest are already represented by production state before their ledger
-- versions are marked applied. It deliberately changes no application data or
-- migration history.

BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $audit_historical_release_effects$
DECLARE
  v_table regclass;
  v_function_definition text;
  v_retired_constraint boolean := false;
BEGIN
  -- 20260704120000: the atomic Amora turn reservation surface exists and is
  -- service-only. Later hardening migrations may replace its body.
  IF pg_catalog.to_regclass('public.amora_turn_counters') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.reserve_amora_turn(uuid,integer,integer)'
     ) IS NULL
     OR pg_catalog.has_table_privilege(
       'anon', 'public.amora_turn_counters', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.amora_turn_counters', 'SELECT'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.reserve_amora_turn(uuid,integer,integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.reserve_amora_turn(uuid,integer,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'HISTORICAL_AUDIT_AMORA_TURN_RESERVATION_MISMATCH';
  END IF;

  -- 20260704130000: opportunistic expiry cleanup remains in the canonical
  -- rate-limit function.
  SELECT pg_catalog.pg_get_functiondef(procedure_row.oid)
  INTO v_function_definition
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname = 'check_rate_limit'
    AND pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)
      = 'p_key text, p_max_requests integer, p_window_ms integer';

  IF v_function_definition IS NULL
     OR v_function_definition NOT LIKE '%DELETE FROM public.rate_limit_buckets%'
     OR v_function_definition NOT LIKE '%INTERVAL ''1 day''%' THEN
    RAISE EXCEPTION 'HISTORICAL_AUDIT_RATE_LIMIT_GC_MISMATCH';
  END IF;

  -- 20260704131000: retired invitation/AI-script tables remain absent.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'public.invitation_visits',
      'public.invitation_guestbook',
      'public.invitation_rsvp',
      'public.invitation_accounts',
      'public.invitation_photos',
      'public.invitations',
      'public.invitation_templates',
      'public.ai_scripts'
    ]::text[]) AS retired_table(name)
    WHERE pg_catalog.to_regclass(retired_table.name) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_AUDIT_RETIRED_INVITATION_TABLE_PRESENT';
  END IF;

  -- 20260705090000: synthetic/ownerless vendors must not be publicly approved.
  IF EXISTS (
    SELECT 1
    FROM public.vendors
    WHERE status = 'approved' AND owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_AUDIT_OWNERLESS_VENDOR_EXPOSED';
  END IF;

  -- 20260705120000 and 20260705140000: notification preference, phone and
  -- consent columns plus the database format constraint exist.
  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name = 'care_notifications_enabled'
         AND data_type = 'boolean' AND is_nullable = 'NO'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name = 'phone'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name = 'phone_care_consented_at'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.profiles'::regclass
         AND constraint_row.conname = 'profiles_phone_format_check'
         AND constraint_row.contype = 'c'
     ) THEN
    RAISE EXCEPTION 'HISTORICAL_AUDIT_PROFILE_CARE_COLUMNS_MISMATCH';
  END IF;

  -- 20260705160000, 20260706100000 and 20260714104000: the candidate table
  -- may be absent, which is a complete collection fence. If preserved, it must
  -- retain the pairing-token column while every application write path stays
  -- retired.
  v_table := pg_catalog.to_regclass('public.wedding_code_responses');
  IF v_table IS NOT NULL THEN
    IF NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_attribute AS attribute_row
         WHERE attribute_row.attrelid = v_table
           AND attribute_row.attname = 'couple_token'
           AND attribute_row.attnum > 0
           AND NOT attribute_row.attisdropped
       )
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_policy AS policy_row
         WHERE policy_row.polrelid = v_table
       )
       OR pg_catalog.has_table_privilege(
         'anon', v_table::oid, 'SELECT,INSERT,UPDATE,DELETE'
       )
       OR pg_catalog.has_table_privilege(
         'authenticated', v_table::oid, 'SELECT,INSERT,UPDATE,DELETE'
       )
       OR pg_catalog.has_table_privilege(
         'service_role', v_table::oid, 'SELECT,INSERT,UPDATE,DELETE'
       ) THEN
      RAISE EXCEPTION 'HISTORICAL_AUDIT_WEDDING_CODE_TABLE_OPEN';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = v_table
        AND constraint_row.conname = 'wedding_code_collection_retired'
        AND constraint_row.contype = 'c'
        AND NOT constraint_row.convalidated
        AND pg_catalog.pg_get_expr(
          constraint_row.conbin,
          constraint_row.conrelid,
          true
        ) IN ('false', '(false)')
    ) INTO v_retired_constraint;

    IF NOT v_retired_constraint THEN
      RAISE EXCEPTION 'HISTORICAL_AUDIT_WEDDING_CODE_FENCE_MISSING';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname IN (
        'insert_wedding_code_response',
        'pair_wedding_code_response'
      )
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_AUDIT_WEDDING_CODE_RPC_PRESENT';
  END IF;
END;
$audit_historical_release_effects$;

SELECT 'HISTORICAL_RELEASE_EFFECTS_VERIFIED' AS release_audit_result;
COMMIT;
