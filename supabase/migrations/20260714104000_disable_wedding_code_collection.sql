-- Permanently retire the unvalidated WeddingCode collection surface while
-- preserving its historical rows for a separately approved retention/purge
-- decision. This migration never reads, rewrites, or deletes those rows.
-- Production receipt (2026-07-14): the applied SQL artifact had SHA-256
-- 9F9C36B62A05AAE9D9552B37C67294CA7FC160DAD101F055FDA8FEE098B26D88
-- preserved 13 rows/13 distinct IDs and their content digest. The migration
-- ledger was deliberately not repaired; do not use this comment as approval
-- for a full db push or ledger mark/repair.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Supabase applies a migration inside its ledger transaction. Hold this lock
-- until that transaction commits so an already-running old deployment cannot
-- race between ACL revocation and constraint installation. Replay targets may
-- legitimately lack the historical table, so absence remains an accepted
-- no-op state even though production contained it when this fence was applied.
DO $lock_wedding_code_table_if_present$
DECLARE
  v_table REGCLASS :=
    pg_catalog.to_regclass('public.wedding_code_responses');
BEGIN
  IF v_table IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.wedding_code_responses IN ACCESS EXCLUSIVE MODE;';
  END IF;
END;
$lock_wedding_code_table_if_present$;

-- Remove both direct PostgREST access and the SECURITY DEFINER insert surface
-- used by old web deployments. service_role bypasses RLS, so RLS alone is not
-- a collection fence; it must lose the underlying table/RPC privileges too.
DO $revoke_table_acl_if_present$
DECLARE
  v_table REGCLASS :=
    pg_catalog.to_regclass('public.wedding_code_responses');
BEGIN
  IF v_table IS NOT NULL THEN
    -- ALL PRIVILEGES is intentional: PostgreSQL 17 added MAINTAIN to the
    -- table privilege set, and later releases may add more table privileges.
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.wedding_code_responses FROM PUBLIC, anon, authenticated, service_role;';
  END IF;
END;
$revoke_table_acl_if_present$;

-- Table ACL revocation does not remove a historical column grant. Build the
-- complete current column list from pg_catalog, quote every identifier, and
-- revoke every PostgreSQL column privilege from the same application roles.
DO $revoke_column_acl$
DECLARE
  v_table REGCLASS :=
    pg_catalog.to_regclass('public.wedding_code_responses');
  v_columns TEXT;
  v_privilege TEXT;
BEGIN
  IF v_table IS NOT NULL THEN
    SELECT pg_catalog.string_agg(
      pg_catalog.format('%I', attribute_row.attname),
      ', ' ORDER BY attribute_row.attnum
    )
    INTO v_columns
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = v_table
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    IF v_columns IS NULL THEN
      RAISE EXCEPTION 'WEDDING_CODE_RESPONSE_COLUMNS_NOT_FOUND'
        USING ERRCODE = '55000';
    END IF;

    FOREACH v_privilege IN ARRAY
      ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::TEXT[]
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE %s (%s) ON TABLE public.wedding_code_responses FROM PUBLIC, anon, authenticated, service_role',
        v_privilege,
        v_columns
      );
    END LOOP;
  END IF;
END;
$revoke_column_acl$;

-- origin/main creates the table before it creates this RPC, while later chains
-- may contain one or more RPC overloads. Treat an already-absent RPC as the
-- desired state, but revoke and drop every overload when it exists. DROP is
-- intentionally non-CASCADE so any dependency aborts and rolls back the whole
-- migration instead of silently removing an unreviewed dependent object.
DO $drop_insert_overloads$
DECLARE
  v_signature TEXT;
BEGIN
  FOR v_signature IN
    SELECT pg_catalog.format(
      '%I.%I(%s)',
      namespace_row.nspname,
      procedure_row.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)
    ) AS qualified_signature
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'insert_wedding_code_response'
    ORDER BY qualified_signature
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_signature
    );
    EXECUTE pg_catalog.format('DROP FUNCTION %s', v_signature);
  END LOOP;
END;
$drop_insert_overloads$;

-- A policy does not grant SQL privileges by itself, but retaining the retired
-- service-role policy would reopen access after any future accidental GRANT.
-- Remove the known policy explicitly, then fail closed against policy drift by
-- dropping every unexpected policy on this retired table as well.
DO $drop_wedding_code_policies$
DECLARE
  v_table REGCLASS :=
    pg_catalog.to_regclass('public.wedding_code_responses');
  v_policy_name TEXT;
BEGIN
  IF v_table IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS wc_responses_service_only ON public.wedding_code_responses;';

    FOR v_policy_name IN
      SELECT policy_row.polname
      FROM pg_catalog.pg_policy AS policy_row
      WHERE policy_row.polrelid = v_table
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY %I ON public.wedding_code_responses',
        v_policy_name
      );
    END LOOP;
  END IF;
END;
$drop_wedding_code_policies$;

DO $verify_wedding_code_policies_absent$
DECLARE
  v_table REGCLASS :=
    pg_catalog.to_regclass('public.wedding_code_responses');
BEGIN
  IF v_table IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_row
    WHERE policy_row.polrelid = v_table
  ) THEN
    RAISE EXCEPTION 'WEDDING_CODE_RESPONSE_POLICY_STILL_PRESENT'
      USING ERRCODE = '55000';
  END IF;
END;
$verify_wedding_code_policies_absent$;

-- The canonical pairing RPC was retired earlier, so guard the REVOKE for
-- replayed environments where it is already absent. Then remove every overload
-- with this feature-specific name so an unreviewed signature cannot survive as
-- a legacy deployment bypass.
DO $revoke_known_pairing$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.pair_wedding_code_response(uuid,uuid)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.pair_wedding_code_response(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$revoke_known_pairing$;

DO $drop_pairing_overloads$
DECLARE
  v_signature TEXT;
BEGIN
  FOR v_signature IN
    SELECT pg_catalog.format(
      '%I.%I(%s)',
      namespace_row.nspname,
      procedure_row.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)
    ) AS qualified_signature
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'pair_wedding_code_response'
    ORDER BY qualified_signature
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_signature
    );
    EXECUTE pg_catalog.format('DROP FUNCTION %s', v_signature);
  END LOOP;
END;
$drop_pairing_overloads$;

DROP FUNCTION IF EXISTS public.pair_wedding_code_response(UUID, UUID);

DO $verify_pairing_absent$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'pair_wedding_code_response'
  ) THEN
    RAISE EXCEPTION 'PAIR_WEDDING_CODE_RESPONSE_STILL_PRESENT'
      USING ERRCODE = '55000';
  END IF;
END;
$verify_pairing_absent$;

-- NOT VALID avoids a historical-row scan. PostgreSQL still enforces the false
-- predicate for every new row version, so both INSERT and UPDATE fail closed.
-- A single DROP + ADD statement is replay-safe and leaves no constraint-free
-- statement boundary; the migration ledger remains the apply-once source.
DO $install_retirement_fence_if_present$
DECLARE
  v_table REGCLASS :=
    pg_catalog.to_regclass('public.wedding_code_responses');
BEGIN
  IF v_table IS NOT NULL THEN
    EXECUTE $fence_ddl$
      ALTER TABLE public.wedding_code_responses
        DROP CONSTRAINT IF EXISTS wedding_code_collection_retired,
        ADD CONSTRAINT wedding_code_collection_retired
        CHECK (false) NOT VALID;
    $fence_ddl$;

    EXECUTE $constraint_comment$
      COMMENT ON CONSTRAINT wedding_code_collection_retired
        ON public.wedding_code_responses IS
        'Retirement fence: rejects every INSERT and UPDATE without scanning preserved historical rows. DELETE requires a separate approved purge migration.';
    $constraint_comment$;

    EXECUTE $table_comment$
      COMMENT ON TABLE public.wedding_code_responses IS
        'Retired WeddingCode collection. Historical rows are preserved; any deletion requires a separate approved retention/purge migration.';
    $table_comment$;
  END IF;
END;
$install_retirement_fence_if_present$;

-- Refuse to enter the migration ledger unless inherited PUBLIC grants,
-- column-level drift, RPC ACLs, and the scan-free write fence all match the
-- retirement contract observed by the production pre/post verifier.
DO $verify_collection_retirement$
DECLARE
  v_table REGCLASS :=
    pg_catalog.to_regclass('public.wedding_code_responses');
  v_role TEXT;
  v_table_privilege TEXT;
  v_table_privileges TEXT[] := ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]::TEXT[];
  v_column_privilege TEXT;
  v_column_name TEXT;
  v_insert_overload_count BIGINT;
BEGIN
  -- MAINTAIN was introduced in PostgreSQL 17. Keep this migration replayable
  -- on older/PGlite runtimes while verifying it wherever the server supports
  -- the privilege name.
  IF pg_catalog.current_setting('server_version_num')::INTEGER >= 170000 THEN
    v_table_privileges := pg_catalog.array_append(
      v_table_privileges,
      'MAINTAIN'
    );
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_insert_overload_count
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname = 'insert_wedding_code_response';

  IF v_insert_overload_count <> 0 THEN
    RAISE EXCEPTION
      'INSERT_WEDDING_CODE_RESPONSE_STILL_PRESENT: overload_count=%',
      v_insert_overload_count
      USING ERRCODE = '55000';
  END IF;

  -- A deliberately absent table is already a complete row-level fence. The
  -- function absence check above still runs so a detached SECURITY DEFINER RPC
  -- cannot survive after the table has been removed.
  IF v_table IS NULL THEN
    RETURN;
  END IF;

  -- PUBLIC is a pseudo-role rather than a pg_roles row, so verify its direct
  -- ACL separately. REVOKE ALL above must leave no current or future table
  -- privilege attached to PUBLIC.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS class_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        class_row.relacl,
        pg_catalog.acldefault('r', class_row.relowner)
      )
    ) AS acl_row
    WHERE class_row.oid = v_table
      AND acl_row.grantee = 0
  ) THEN
    RAISE EXCEPTION 'WEDDING_CODE_TABLE_ACL_STILL_OPEN: role=PUBLIC'
      USING ERRCODE = '55000';
  END IF;

  FOR v_role IN
    SELECT application_role.role_name
    FROM pg_catalog.unnest(
      ARRAY['anon', 'authenticated', 'service_role']::TEXT[]
    ) AS application_role(role_name)
  LOOP
    FOREACH v_table_privilege IN ARRAY v_table_privileges
    LOOP
      IF pg_catalog.has_table_privilege(
        v_role,
        v_table::OID,
        v_table_privilege
      ) THEN
        RAISE EXCEPTION
          'WEDDING_CODE_TABLE_ACL_STILL_OPEN: role=%, privilege=%',
          v_role,
          v_table_privilege
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    FOR v_column_name IN
      SELECT attribute_row.attname::TEXT
      FROM pg_catalog.pg_attribute AS attribute_row
      WHERE attribute_row.attrelid = v_table
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
    LOOP
      FOREACH v_column_privilege IN ARRAY
        ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::TEXT[]
      LOOP
        IF pg_catalog.has_column_privilege(
          v_role,
          v_table::OID,
          v_column_name,
          v_column_privilege
        ) THEN
          RAISE EXCEPTION
            'WEDDING_CODE_COLUMN_ACL_STILL_OPEN: role=%, column=%, privilege=%',
            v_role,
            v_column_name,
            v_column_privilege
            USING ERRCODE = '55000';
        END IF;
      END LOOP;
    END LOOP;

  END LOOP;

  IF NOT EXISTS (
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
  ) THEN
    RAISE EXCEPTION 'WEDDING_CODE_RETIREMENT_CONSTRAINT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$verify_collection_retirement$;
