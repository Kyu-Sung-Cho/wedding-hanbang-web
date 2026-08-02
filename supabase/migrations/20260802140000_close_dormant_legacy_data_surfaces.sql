-- Quarantine dormant tables that exist in the hosted database but have no
-- current web/mobile consumer. Their legacy PUBLIC policies exposed couple
-- schedules or allowed untrusted clients to forge operational records.
--
-- These tables predate the tracked migration baseline in some environments,
-- so each fence is intentionally conditional. If a table exists, clients lose
-- every direct privilege and only service_role retains access.

BEGIN;

DO $close_dormant_legacy_tables$
DECLARE
  target_table text;
  policy_row record;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'schedules',
    'b2b_survey_responses',
    'dress_fitting_images',
    'vendor_views',
    'vendor_submissions',
    'submission_verifications'
  ]::text[]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      target_table
    );

    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_row.policyname,
        target_table
      );
    END LOOP;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      target_table
    );

    SELECT string_agg(format('%I', column_info.column_name), ', ' ORDER BY column_info.ordinal_position)
    INTO all_columns
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = target_table;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      target_table || '_service_role_all',
      target_table
    );
  END LOOP;
END;
$close_dormant_legacy_tables$;

DO $postflight$
DECLARE
  target_table text;
  target_role text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'schedules',
    'b2b_survey_responses',
    'dress_fitting_images',
    'vendor_views',
    'vendor_submissions',
    'submission_verifications'
  ]::text[]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
    LOOP
      IF has_table_privilege(
        target_role,
        format('public.%I', target_table),
        'SELECT'
      ) OR has_table_privilege(
        target_role,
        format('public.%I', target_table),
        'INSERT'
      ) OR has_table_privilege(
        target_role,
        format('public.%I', target_table),
        'UPDATE'
      ) OR has_table_privilege(
        target_role,
        format('public.%I', target_table),
        'DELETE'
      ) THEN
        RAISE EXCEPTION 'DORMANT_LEGACY_TABLE_CLIENT_ACCESS_REMAINS: %.%',
          target_role,
          target_table
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    IF NOT has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'SELECT'
    ) OR NOT has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'INSERT'
    ) OR NOT has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'UPDATE'
    ) OR NOT has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'DELETE'
    ) THEN
      RAISE EXCEPTION 'DORMANT_LEGACY_TABLE_SERVICE_ACCESS_MISSING: %',
        target_table
        USING ERRCODE = '55000';
    END IF;

    IF has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'TRUNCATE'
    ) OR has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'REFERENCES'
    ) OR has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'TRIGGER'
    ) OR has_any_column_privilege(
      'service_role',
      format('public.%I', target_table),
      'REFERENCES'
    ) THEN
      RAISE EXCEPTION 'DORMANT_LEGACY_TABLE_SERVICE_NON_DML_REMAINS: %',
        target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$postflight$;

COMMIT;
