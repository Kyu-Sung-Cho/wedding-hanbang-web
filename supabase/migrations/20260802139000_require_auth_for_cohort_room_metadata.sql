-- Cohort room discovery belongs to authenticated community screens.
-- Remove the legacy anonymous table read while preserving authenticated mobile
-- discovery, authenticated foreign-table joins, and service-side room writes.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.cohort_rooms') IS NULL THEN
    RAISE EXCEPTION 'COHORT_ROOM_METADATA_FENCE_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

ALTER TABLE public.cohort_rooms ENABLE ROW LEVEL SECURITY;

DO $drop_existing_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cohort_rooms'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.cohort_rooms',
      policy_row.policyname
    );
  END LOOP;
END;
$drop_existing_policies$;

REVOKE ALL PRIVILEGES ON TABLE public.cohort_rooms
  FROM PUBLIC, anon, authenticated, service_role;

DO $revoke_legacy_column_privileges$
DECLARE
  all_columns text;
BEGIN
  SELECT string_agg(format('%I', column_info.column_name), ', ' ORDER BY column_info.ordinal_position)
  INTO all_columns
  FROM information_schema.columns AS column_info
  WHERE column_info.table_schema = 'public'
    AND column_info.table_name = 'cohort_rooms';

  EXECUTE format(
    'REVOKE ALL PRIVILEGES (%s) ON TABLE public.cohort_rooms FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
END;
$revoke_legacy_column_privileges$;

GRANT SELECT ON TABLE public.cohort_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cohort_rooms TO service_role;

CREATE POLICY cohort_rooms_authenticated_select
  ON public.cohort_rooms
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY cohort_rooms_service_role_all
  ON public.cohort_rooms
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DO $postflight$
BEGIN
  IF has_table_privilege('anon', 'public.cohort_rooms', 'SELECT') THEN
    RAISE EXCEPTION 'COHORT_ROOM_METADATA_FENCE_ANON_READ_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_table_privilege(
    'authenticated',
    'public.cohort_rooms',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.cohort_rooms',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.cohort_rooms',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.cohort_rooms',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'COHORT_ROOM_METADATA_FENCE_CLIENT_PRIVILEGE_DRIFT'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_table_privilege(
    'service_role',
    'public.cohort_rooms',
    'SELECT'
  ) OR NOT has_table_privilege(
    'service_role',
    'public.cohort_rooms',
    'INSERT'
  ) OR NOT has_table_privilege(
    'service_role',
    'public.cohort_rooms',
    'UPDATE'
  ) OR NOT has_table_privilege(
    'service_role',
    'public.cohort_rooms',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'COHORT_ROOM_METADATA_FENCE_SERVICE_PRIVILEGE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF has_table_privilege(
    'service_role',
    'public.cohort_rooms',
    'TRUNCATE'
  ) OR has_table_privilege(
    'service_role',
    'public.cohort_rooms',
    'REFERENCES'
  ) OR has_table_privilege(
    'service_role',
    'public.cohort_rooms',
    'TRIGGER'
  ) OR has_any_column_privilege(
    'service_role',
    'public.cohort_rooms',
    'REFERENCES'
  ) THEN
    RAISE EXCEPTION 'COHORT_ROOM_METADATA_FENCE_SERVICE_NON_DML_REMAINS'
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;

COMMIT;
