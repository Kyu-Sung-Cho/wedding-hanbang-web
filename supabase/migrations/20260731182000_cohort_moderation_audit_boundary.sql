-- Cohort member moderation: atomic review, membership action, count repair,
-- and append-only audit evidence.
--
-- This migration deliberately keeps the existing cohort_member_reports,
-- cohort_members, and cohort_rooms shapes intact. A user-visible notice and
-- appeal flow is not claimed here: that requires an authenticated API/UI,
-- privacy-reviewed copy, and an operating owner. The immutable event snapshots
-- preserve the evidence needed to add that flow without reconstructing history.

-- Snapshot identifiers intentionally have no cascading foreign keys. Auth or
-- room deletion must not silently rewrite/delete an audit event, and a RESTRICT
-- key would block the existing account-deletion saga. Retention of this ledger
-- still requires an approved privacy/operations policy; this migration does
-- not invent that period.
CREATE TABLE public.cohort_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  room_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  actor_admin_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'review_member_report'
    CHECK (action = 'review_member_report'),
  reason text NOT NULL
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  deactivate_member_requested boolean NOT NULL,
  member_deactivated boolean NOT NULL,
  before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_cohort_moderation_events_report
  ON public.cohort_moderation_events(report_id, created_at DESC);
CREATE INDEX idx_cohort_moderation_events_room
  ON public.cohort_moderation_events(room_id, created_at DESC);
CREATE INDEX idx_cohort_moderation_events_target
  ON public.cohort_moderation_events(reported_user_id, created_at DESC);

ALTER TABLE public.cohort_moderation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public.cohort_moderation_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT
  ON TABLE public.cohort_moderation_events
  TO service_role;

CREATE POLICY cohort_moderation_events_service_select
  ON public.cohort_moderation_events
  FOR SELECT TO service_role
  USING (true);

CREATE OR REPLACE FUNCTION public.cohort_guard_moderation_event_append()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cohort moderation events are append-only'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    OR COALESCE(
      current_setting('hanbang.cohort_moderation_event_write', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION 'cohort moderation events require the atomic service RPC'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
  ON FUNCTION public.cohort_guard_moderation_event_append()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_cohort_moderation_events_append_only
BEFORE INSERT OR UPDATE OR DELETE ON public.cohort_moderation_events
FOR EACH ROW
EXECUTE FUNCTION public.cohort_guard_moderation_event_append();

-- A report decision without a matching event is not an auditable decision.
-- Authenticated users already lack UPDATE privileges; this trigger also closes
-- accidental or legacy service-role writes that bypass the RPC.
CREATE OR REPLACE FUNCTION public.cohort_guard_member_report_status_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND COALESCE(
      current_setting('hanbang.cohort_moderation_event_write', true),
      ''
    ) <> 'on' THEN
    RAISE EXCEPTION 'cohort member report decisions require the atomic moderation RPC'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
  ON FUNCTION public.cohort_guard_member_report_status_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_cohort_member_report_status_audit
BEFORE UPDATE OF status ON public.cohort_member_reports
FOR EACH ROW
EXECUTE FUNCTION public.cohort_guard_member_report_status_write();

CREATE OR REPLACE FUNCTION public.community_review_cohort_member_report(
  p_report_id uuid,
  p_status text,
  p_reason text,
  p_admin_id uuid,
  p_deactivate_member boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.cohort_member_reports%ROWTYPE;
  v_member_id uuid;
  v_member_found boolean := false;
  v_before_member_active boolean;
  v_after_member_active boolean;
  v_before_member_count integer;
  v_after_member_count integer;
  v_before_state jsonb;
  v_after_state jsonb;
  v_event_id uuid := gen_random_uuid();
  v_member_deactivated boolean := false;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'cohort moderation RPC is restricted to service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_report_id IS NULL THEN
    RAISE EXCEPTION 'report id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_status IS NULL
    OR p_status NOT IN ('reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid cohort member report status'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'moderation reason must contain 3 to 2000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'admin actor id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_deactivate_member IS NULL THEN
    RAISE EXCEPTION 'deactivate member decision is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_status = 'dismissed' AND p_deactivate_member THEN
    RAISE EXCEPTION 'a dismissed report cannot deactivate the reported member'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_admin_id
      AND profile.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'admin actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize competing decisions for the same report. The membership and room
  -- locks then align with the established member-before-room write order.
  SELECT report.*
  INTO v_report
  FROM public.cohort_member_reports AS report
  WHERE report.id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort member report not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT member.id, member.is_active
  INTO v_member_id, v_before_member_active
  FROM public.cohort_members AS member
  WHERE member.room_id = v_report.room_id
    AND member.user_id = v_report.reported_user_id
  FOR UPDATE;
  v_member_found := FOUND;

  IF p_deactivate_member AND NOT v_member_found THEN
    RAISE EXCEPTION 'reported cohort membership not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(room.member_count, 0)
  INTO v_before_member_count
  FROM public.cohort_rooms AS room
  WHERE room.id = v_report.room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort room not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_before_state := jsonb_build_object(
    'report_status', v_report.status,
    'membership_found', v_member_found,
    'member_is_active', v_before_member_active,
    'room_member_count', v_before_member_count
  );

  IF p_deactivate_member THEN
    UPDATE public.cohort_members
    SET is_active = false
    WHERE id = v_member_id
      AND is_active IS DISTINCT FROM false;

    v_member_deactivated := v_before_member_active IS TRUE;
  END IF;

  IF v_member_found THEN
    SELECT member.is_active
    INTO v_after_member_active
    FROM public.cohort_members AS member
    WHERE member.id = v_member_id;
  ELSE
    v_after_member_active := NULL;
  END IF;

  SELECT count(*)::integer
  INTO v_after_member_count
  FROM public.cohort_members AS member
  WHERE member.room_id = v_report.room_id
    AND member.is_active IS TRUE;

  UPDATE public.cohort_rooms
  SET member_count = v_after_member_count
  WHERE id = v_report.room_id;

  v_after_state := jsonb_build_object(
    'report_status', p_status,
    'membership_found', v_member_found,
    'member_is_active', v_after_member_active,
    'room_member_count', v_after_member_count
  );

  -- The transaction-local capability lets the two guards admit only this
  -- atomic decision. It is reset before returning, and table privileges still
  -- deny direct event writes to service_role.
  PERFORM set_config('hanbang.cohort_moderation_event_write', 'on', true);

  UPDATE public.cohort_member_reports
  SET status = p_status
  WHERE id = p_report_id;

  INSERT INTO public.cohort_moderation_events (
    id,
    report_id,
    room_id,
    reported_user_id,
    actor_admin_id,
    reason,
    deactivate_member_requested,
    member_deactivated,
    before_state,
    after_state
  )
  VALUES (
    v_event_id,
    p_report_id,
    v_report.room_id,
    v_report.reported_user_id,
    p_admin_id,
    btrim(p_reason),
    p_deactivate_member,
    v_member_deactivated,
    v_before_state,
    v_after_state
  );

  PERFORM set_config('hanbang.cohort_moderation_event_write', 'off', true);

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', p_report_id,
    'status', p_status,
    'event_id', v_event_id,
    'room_id', v_report.room_id,
    'reported_user_id', v_report.reported_user_id,
    'deactivate_member_requested', p_deactivate_member,
    'member_deactivated', v_member_deactivated,
    'before_state', v_before_state,
    'after_state', v_after_state
  );
END;
$$;

REVOKE ALL
  ON FUNCTION public.community_review_cohort_member_report(
    uuid, text, text, uuid, boolean
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.community_review_cohort_member_report(
    uuid, text, text, uuid, boolean
  )
  TO service_role;

-- Repair legacy drift once. Every future review repeats this repair while the
-- room row is locked, so deactivation and its derived count cannot diverge.
UPDATE public.cohort_rooms AS room
SET member_count = (
  SELECT count(*)::integer
  FROM public.cohort_members AS member
  WHERE member.room_id = room.id
    AND member.is_active IS TRUE
)
WHERE room.member_count IS DISTINCT FROM (
  SELECT count(*)::integer
  FROM public.cohort_members AS member
  WHERE member.room_id = room.id
    AND member.is_active IS TRUE
);

-- ---------------------------------------------------------------------------
-- Hosted-clone postconditions (read-only; run before production activation)
-- ---------------------------------------------------------------------------
--
-- 1) No room count drift remains:
-- SELECT room.id, room.member_count, count(member.id) FILTER (
--   WHERE member.is_active IS TRUE
-- ) AS actual_active_members
-- FROM public.cohort_rooms AS room
-- LEFT JOIN public.cohort_members AS member ON member.room_id = room.id
-- GROUP BY room.id, room.member_count
-- HAVING room.member_count IS DISTINCT FROM count(member.id) FILTER (
--   WHERE member.is_active IS TRUE
-- );
--
-- 2) Only service_role can execute the decision RPC:
-- SELECT
--   has_function_privilege(
--     'anon',
--     'public.community_review_cohort_member_report(uuid,text,text,uuid,boolean)',
--     'EXECUTE'
--   ) AS anon_execute,
--   has_function_privilege(
--     'authenticated',
--     'public.community_review_cohort_member_report(uuid,text,text,uuid,boolean)',
--     'EXECUTE'
--   ) AS authenticated_execute,
--   has_function_privilege(
--     'service_role',
--     'public.community_review_cohort_member_report(uuid,text,text,uuid,boolean)',
--     'EXECUTE'
--   ) AS service_execute;
-- Expected: false, false, true.
--
-- 3) service_role can read but cannot directly mutate the ledger:
-- SELECT
--   has_table_privilege(
--     'service_role', 'public.cohort_moderation_events', 'SELECT'
--   ) AS service_select,
--   has_table_privilege(
--     'service_role', 'public.cohort_moderation_events', 'INSERT'
--   ) AS service_insert,
--   has_table_privilege(
--     'service_role', 'public.cohort_moderation_events', 'UPDATE'
--   ) AS service_update,
--   has_table_privilege(
--     'service_role', 'public.cohort_moderation_events', 'DELETE'
--   ) AS service_delete;
-- Expected: true, false, false, false.
--
-- 4) Both mutation guards are installed:
-- SELECT tgname
-- FROM pg_trigger
-- WHERE tgrelid IN (
--   'public.cohort_moderation_events'::regclass,
--   'public.cohort_member_reports'::regclass
-- )
--   AND NOT tgisinternal
--   AND tgname IN (
--     'trg_cohort_moderation_events_append_only',
--     'trg_cohort_member_report_status_audit'
--   )
-- ORDER BY tgname;
--
-- Emergency rollback:
--   * freeze cohort moderation writes and retain the pre-migration backup;
--   * export cohort_moderation_events before any compensating migration;
--   * restore the verified backup for a failed activation, or ship a forward
--     compensating migration that preserves the exported audit ledger;
--   * never drop or rewrite moderation evidence in place.
