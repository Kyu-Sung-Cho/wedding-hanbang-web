-- Make dormant gamification records private and remove client-forgeable streaks.
--
-- The original achievement policy exposed stable auth user UUIDs together with
-- an activity timeline to anonymous callers. The original streak INSERT policy
-- also let an authenticated caller seed arbitrary counters for their own UUID.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.community_achievements') IS NULL
     OR to_regclass('public.community_streaks') IS NULL THEN
    RAISE EXCEPTION 'GAMIFICATION_DATA_FENCE_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'community_achievements'
      AND column_name = 'user_id'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'community_streaks'
      AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'GAMIFICATION_DATA_FENCE_OWNER_COLUMN_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

ALTER TABLE public.community_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_streaks ENABLE ROW LEVEL SECURITY;

DO $drop_existing_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('community_achievements', 'community_streaks')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$drop_existing_policies$;

REVOKE ALL PRIVILEGES ON TABLE
  public.community_achievements,
  public.community_streaks
FROM PUBLIC, anon, authenticated, service_role;

DO $revoke_legacy_column_privileges$
DECLARE
  target_table text;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'community_achievements',
    'community_streaks'
  ]::text[]
  LOOP
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
  END LOOP;
END;
$revoke_legacy_column_privileges$;

GRANT SELECT ON TABLE
  public.community_achievements,
  public.community_streaks
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.community_achievements,
  public.community_streaks
TO service_role;

CREATE POLICY community_achievements_select_own
  ON public.community_achievements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY community_achievements_service_role_all
  ON public.community_achievements
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY community_streaks_select_own
  ON public.community_streaks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY community_streaks_service_role_all
  ON public.community_streaks
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DO $postflight$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'community_achievements',
    'community_streaks'
  ]::text[]
  LOOP
    IF has_table_privilege('anon', format('public.%I', table_name), 'SELECT') THEN
      RAISE EXCEPTION 'GAMIFICATION_DATA_FENCE_ANON_READ_REMAINS: %', table_name
        USING ERRCODE = '55000';
    END IF;

    IF NOT has_table_privilege(
      'authenticated',
      format('public.%I', table_name),
      'SELECT'
    ) OR has_table_privilege(
      'authenticated',
      format('public.%I', table_name),
      'INSERT'
    ) OR has_table_privilege(
      'authenticated',
      format('public.%I', table_name),
      'UPDATE'
    ) OR has_table_privilege(
      'authenticated',
      format('public.%I', table_name),
      'DELETE'
    ) THEN
      RAISE EXCEPTION 'GAMIFICATION_DATA_FENCE_CLIENT_PRIVILEGE_DRIFT: %', table_name
        USING ERRCODE = '55000';
    END IF;

    IF NOT has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'SELECT'
    ) OR NOT has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'INSERT'
    ) OR NOT has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'UPDATE'
    ) OR NOT has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'DELETE'
    ) THEN
      RAISE EXCEPTION 'GAMIFICATION_DATA_FENCE_SERVICE_PRIVILEGE_MISSING: %', table_name
        USING ERRCODE = '55000';
    END IF;

    IF has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'TRUNCATE'
    ) OR has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'REFERENCES'
    ) OR has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'TRIGGER'
    ) OR has_any_column_privilege(
      'service_role',
      format('public.%I', table_name),
      'REFERENCES'
    ) THEN
      RAISE EXCEPTION 'GAMIFICATION_DATA_FENCE_SERVICE_NON_DML_REMAINS: %', table_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$postflight$;

COMMIT;
