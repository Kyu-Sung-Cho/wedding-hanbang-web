BEGIN;

-- Emergency community control is deliberately independent from application
-- deploys. The database plane stops stale/native clients and ordinary service
-- writes; COMMUNITY_RUNTIME_MODE in apps/web/src/proxy.ts stops current web/API
-- reads and writes. During an incident both planes must be set and verified.
CREATE TABLE IF NOT EXISTS public.community_runtime_control (
  control_key text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'normal',
  reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT community_runtime_control_singleton
    CHECK (control_key = 'global'),
  CONSTRAINT community_runtime_control_mode
    CHECK (mode IN ('normal', 'read_only', 'disabled')),
  CONSTRAINT community_runtime_control_reason
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT community_runtime_control_version
    CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS public.community_runtime_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_mode text,
  mode text NOT NULL,
  reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  version bigint NOT NULL,
  CONSTRAINT community_runtime_control_events_previous_mode
    CHECK (
      previous_mode IS NULL
      OR previous_mode IN ('normal', 'read_only', 'disabled')
    ),
  CONSTRAINT community_runtime_control_events_mode
    CHECK (mode IN ('normal', 'read_only', 'disabled')),
  CONSTRAINT community_runtime_control_events_reason
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT community_runtime_control_events_version
    CHECK (version > 0)
);

ALTER TABLE public.community_runtime_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_runtime_control_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.community_runtime_control,
  public.community_runtime_control_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.community_runtime_control,
  public.community_runtime_control_events
  TO service_role;

DROP POLICY IF EXISTS community_runtime_control_service_select
  ON public.community_runtime_control;
CREATE POLICY community_runtime_control_service_select
  ON public.community_runtime_control
  FOR SELECT TO service_role
  USING (true);

DROP POLICY IF EXISTS community_runtime_control_events_service_select
  ON public.community_runtime_control_events;
CREATE POLICY community_runtime_control_events_service_select
  ON public.community_runtime_control_events
  FOR SELECT TO service_role
  USING (true);

WITH inserted_control AS (
  INSERT INTO public.community_runtime_control (
    control_key,
    mode,
    reason,
    changed_by,
    version
  )
  VALUES (
    'global',
    'normal',
    'initial runtime state',
    NULL,
    1
  )
  ON CONFLICT (control_key) DO NOTHING
  RETURNING mode, reason, changed_at, changed_by, version
)
INSERT INTO public.community_runtime_control_events (
  previous_mode,
  mode,
  reason,
  changed_at,
  changed_by,
  version
)
SELECT
  NULL,
  mode,
  reason,
  changed_at,
  changed_by,
  version
FROM inserted_control;

CREATE OR REPLACE FUNCTION public.community_runtime_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT control.mode
      FROM public.community_runtime_control AS control
      WHERE control.control_key = 'global'
        AND control.mode IN ('normal', 'read_only', 'disabled')
    ),
    'disabled'
  )
$$;

REVOKE ALL ON FUNCTION public.community_runtime_mode()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_runtime_mode()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_guard_runtime_event_append()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT'
    OR NOT public.community_request_is_service()
    OR COALESCE(
      current_setting('hanbang.community_runtime_control_write', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION 'community runtime control events are append-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_runtime_event_append()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_community_runtime_control_events_append_only
  ON public.community_runtime_control_events;
CREATE TRIGGER trg_community_runtime_control_events_append_only
BEFORE INSERT OR UPDATE OR DELETE
ON public.community_runtime_control_events
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_runtime_event_append();

CREATE OR REPLACE FUNCTION public.community_set_runtime_mode(
  p_mode text,
  p_reason text,
  p_changed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous_mode text;
  v_version bigint;
  v_event_id uuid := gen_random_uuid();
  v_changed_at timestamptz := now();
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL
    OR p_mode NOT IN ('normal', 'read_only', 'disabled') THEN
    RAISE EXCEPTION 'invalid community runtime mode'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'runtime control reason must contain 3 to 500 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_changed_by IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = p_changed_by
        AND profile.is_admin IS TRUE
    ) THEN
    RAISE EXCEPTION 'changed_by must be a verified administrator'
      USING ERRCODE = '42501';
  END IF;

  SELECT control.mode, control.version + 1
  INTO v_previous_mode, v_version
  FROM public.community_runtime_control AS control
  WHERE control.control_key = 'global'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community runtime control is unavailable'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config(
    'hanbang.community_runtime_control_write',
    'on',
    true
  );

  UPDATE public.community_runtime_control
  SET mode = p_mode,
      reason = btrim(p_reason),
      changed_at = v_changed_at,
      changed_by = p_changed_by,
      version = v_version
  WHERE control_key = 'global';

  INSERT INTO public.community_runtime_control_events (
    id,
    previous_mode,
    mode,
    reason,
    changed_at,
    changed_by,
    version
  )
  VALUES (
    v_event_id,
    v_previous_mode,
    p_mode,
    btrim(p_reason),
    v_changed_at,
    p_changed_by,
    v_version
  );

  PERFORM set_config(
    'hanbang.community_runtime_control_write',
    'off',
    true
  );

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'previous_mode', v_previous_mode,
    'mode', p_mode,
    'reason', btrim(p_reason),
    'changed_at', v_changed_at,
    'changed_by', p_changed_by,
    'version', v_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_set_runtime_mode(
  text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_set_runtime_mode(
  text, text, uuid
) TO service_role;

-- Safety capabilities are accepted only for service-role requests. A client
-- setting the same custom GUC cannot bypass this fence. Existing audited
-- moderation RPCs set one of these transaction-local capabilities.
CREATE OR REPLACE FUNCTION public.community_guard_runtime_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode text := public.community_runtime_mode();
  v_service_safety_bypass boolean :=
    public.community_request_is_service()
    AND (
      COALESCE(
        current_setting('app.community_safety_bypass', true),
        ''
      ) = 'on'
      OR COALESCE(
        current_setting('hanbang.community_moderation_event_write', true),
        ''
      ) = 'on'
      OR COALESCE(
        current_setting('hanbang.cohort_moderation_event_write', true),
        ''
      ) = 'on'
    );
BEGIN
  IF v_mode = 'normal' OR v_service_safety_bypass THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF v_mode = 'read_only' THEN
    RAISE EXCEPTION 'community is read-only'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'community is disabled'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public.community_guard_runtime_write()
  FROM PUBLIC, anon, authenticated, service_role;

-- Ordinary community content and engagement are frozen in read_only/disabled.
-- community_reports, cohort_member_reports, and community_moderation_appeals
-- intentionally remain available as safety intake paths.
DO $$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'community_posts',
    'community_comments',
    'community_votes',
    'community_bookmarks',
    'community_polls',
    'community_poll_options',
    'community_poll_votes',
    'cohort_messages',
    'cohort_contracts',
    'cohort_timeline_events'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS community_runtime_write_fence ON public.%I',
      v_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER community_runtime_write_fence '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.community_guard_runtime_write()',
      v_table_name
    );
  END LOOP;
END
$$;

-- Restrictive policies compose with every existing permissive policy, so a
-- hosted policy added under another name cannot reopen stale-client reads.
DO $$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'community_posts',
    'community_comments',
    'community_votes',
    'community_bookmarks',
    'community_polls',
    'community_poll_options',
    'community_poll_votes',
    'community_vendor_tags',
    'community_xp_log',
    'community_streaks',
    'community_achievements',
    'cohort_rooms',
    'cohort_members',
    'cohort_messages',
    'cohort_contracts',
    'cohort_timeline_events'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS community_runtime_read_fence ON public.%I',
      v_table_name
    );
    EXECUTE format(
      'CREATE POLICY community_runtime_read_fence '
      || 'ON public.%I AS RESTRICTIVE FOR SELECT TO anon, authenticated '
      || 'USING (public.community_runtime_mode() <> ''disabled'')',
      v_table_name
    );
  END LOOP;
END
$$;

-- Views execute as their owner by default and therefore do not inherit a base
-- table RLS fence. Carry the disabled predicate into the public projection.
DO $$
BEGIN
  IF to_regclass('public.community_profiles') IS NOT NULL
    AND to_regclass('public.community_public_profiles') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.community_public_profiles
      WITH (security_barrier = true)
      AS
      SELECT
        profile.user_id,
        profile.nickname,
        profile.avatar_url,
        profile.badge,
        profile.rank
      FROM public.community_profiles AS profile
      WHERE COALESCE(profile.is_suspended, false) = false
        AND public.community_runtime_mode() <> 'disabled'
    $view$;
  END IF;
END
$$;

COMMENT ON TABLE public.community_runtime_control IS
  'Singleton database-plane emergency state. Set only through community_set_runtime_mode and mirror with COMMUNITY_RUNTIME_MODE at the web proxy.';
COMMENT ON TABLE public.community_runtime_control_events IS
  'Append-only evidence for every community runtime mode transition.';
COMMENT ON FUNCTION public.community_set_runtime_mode(text, text, uuid) IS
  'Service-only emergency control. Activation requires the web proxy COMMUNITY_RUNTIME_MODE to be changed and verified too; recovery restores the DB first and proxy last.';

-- Activation runbook (two planes, neither is sufficient alone):
--   1. Set COMMUNITY_RUNTIME_MODE=read_only or disabled at the web runtime.
--   2. Call community_set_runtime_mode with the same mode and an incident reason.
--   3. Verify current web/API behavior, direct authenticated DB behavior, and
--      that report/appeal/moderation safety paths still succeed.
-- Recovery:
--   1. Resolve the incident and verify data integrity.
--   2. Set the database mode to normal and verify the durable event.
--   3. Set COMMUNITY_RUNTIME_MODE=normal at the web runtime last.

COMMIT;
