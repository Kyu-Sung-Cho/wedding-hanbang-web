-- Lock sensitive tables against anonymous PostgREST access.
-- The app still allows authenticated users to read/write their own scoped data,
-- and service_role keeps full server-side access.

-- Helper: drop every existing policy on a table before recreating the intended set.
CREATE OR REPLACE FUNCTION public._drop_all_policies_for_table(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT pol.policyname
    FROM pg_policies pol
    JOIN pg_class cls ON cls.oid = p_table
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE pol.schemaname = ns.nspname
      AND pol.tablename = cls.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p.policyname, p_table);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_couple_member(p_couple_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.couples c
      WHERE c.id = p_couple_id
        AND (c.bride_id = auth.uid() OR c.groom_id = auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION public.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.couples c
      WHERE (c.bride_id = auth.uid() OR c.groom_id = auth.uid())
        AND (c.bride_id = p_profile_id OR c.groom_id = p_profile_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.is_cohort_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.cohort_members m
      WHERE m.room_id = p_room_id
        AND m.user_id = auth.uid()
        AND m.is_active = TRUE
    );
$$;

REVOKE ALL ON FUNCTION public._drop_all_policies_for_table(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_couple_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_cohort_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cohort_member(uuid) TO authenticated, service_role;

-- Rebuild policies on sensitive tables.
SELECT public._drop_all_policies_for_table('public.profiles'::regclass);
SELECT public._drop_all_policies_for_table('public.couples'::regclass);
SELECT public._drop_all_policies_for_table('public.wedding_journeys'::regclass);
SELECT public._drop_all_policies_for_table('public.account_deletions'::regclass);
SELECT public._drop_all_policies_for_table('public.customer_survey_responses'::regclass);
SELECT public._drop_all_policies_for_table('public.chat_feedback'::regclass);
SELECT public._drop_all_policies_for_table('public.chat_summaries'::regclass);
SELECT public._drop_all_policies_for_table('public.community_reports'::regclass);
SELECT public._drop_all_policies_for_table('public.cohort_member_reports'::regclass);
SELECT public._drop_all_policies_for_table('public.cohort_members'::regclass);
SELECT public._drop_all_policies_for_table('public.cohort_messages'::regclass);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_member_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_messages ENABLE ROW LEVEL SECURITY;

-- Table privileges. Policies below still enforce row-level scope.
REVOKE ALL PRIVILEGES ON TABLE
  public.profiles,
  public.couples,
  public.wedding_journeys,
  public.account_deletions,
  public.customer_survey_responses,
  public.chat_feedback,
  public.chat_summaries,
  public.community_reports,
  public.cohort_member_reports,
  public.cohort_members,
  public.cohort_messages
FROM anon;

REVOKE ALL PRIVILEGES ON TABLE
  public.profiles,
  public.couples,
  public.wedding_journeys,
  public.account_deletions,
  public.customer_survey_responses,
  public.chat_feedback,
  public.chat_summaries,
  public.community_reports,
  public.cohort_member_reports,
  public.cohort_members,
  public.cohort_messages
FROM authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.profiles,
  public.couples,
  public.wedding_journeys,
  public.account_deletions,
  public.customer_survey_responses,
  public.chat_feedback,
  public.chat_summaries,
  public.community_reports,
  public.cohort_member_reports,
  public.cohort_members,
  public.cohort_messages
TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT ON TABLE public.couples TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wedding_journeys TO authenticated;
GRANT SELECT ON TABLE public.chat_summaries TO authenticated;
GRANT SELECT, INSERT ON TABLE public.community_reports TO authenticated;
GRANT SELECT, INSERT ON TABLE public.cohort_member_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cohort_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cohort_messages TO authenticated;

-- Service role policies.
CREATE POLICY profiles_service_role_all ON public.profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY couples_service_role_all ON public.couples
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY journeys_service_role_all ON public.wedding_journeys
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY account_deletions_service_role_all ON public.account_deletions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY customer_survey_service_role_all ON public.customer_survey_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY chat_feedback_service_role_all ON public.chat_feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY chat_summaries_service_role_all ON public.chat_summaries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY community_reports_service_role_all ON public.community_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cohort_member_reports_service_role_all ON public.cohort_member_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cohort_members_service_role_all ON public.cohort_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cohort_messages_service_role_all ON public.cohort_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated user policies.
CREATE POLICY profiles_select_related ON public.profiles
  FOR SELECT TO authenticated
  USING (public.can_read_profile(id));

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY couples_select_own ON public.couples
  FOR SELECT TO authenticated
  USING (bride_id = auth.uid() OR groom_id = auth.uid());

CREATE POLICY couples_insert_own ON public.couples
  FOR INSERT TO authenticated
  WITH CHECK (bride_id = auth.uid() OR groom_id = auth.uid());

CREATE POLICY journeys_select_couple ON public.wedding_journeys
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));

CREATE POLICY journeys_insert_couple ON public.wedding_journeys
  FOR INSERT TO authenticated
  WITH CHECK (public.is_couple_member(couple_id));

CREATE POLICY journeys_update_couple ON public.wedding_journeys
  FOR UPDATE TO authenticated
  USING (public.is_couple_member(couple_id))
  WITH CHECK (public.is_couple_member(couple_id));

CREATE POLICY chat_summaries_select_couple ON public.chat_summaries
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));

CREATE POLICY community_reports_select_own ON public.community_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY community_reports_insert_own ON public.community_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY cohort_member_reports_select_own ON public.cohort_member_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY cohort_member_reports_insert_own ON public.cohort_member_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND reported_user_id <> auth.uid()
    AND public.is_cohort_member(room_id)
  );

CREATE POLICY cohort_members_select_room ON public.cohort_members
  FOR SELECT TO authenticated
  USING (public.is_cohort_member(room_id) OR user_id = auth.uid());

CREATE POLICY cohort_members_insert_self ON public.cohort_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.cohort_rooms r
      WHERE r.id = room_id
        AND r.is_active = TRUE
    )
  );

CREATE POLICY cohort_members_update_self ON public.cohort_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY cohort_members_delete_self ON public.cohort_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY cohort_messages_select_room ON public.cohort_messages
  FOR SELECT TO authenticated
  USING (public.is_cohort_member(room_id));

CREATE POLICY cohort_messages_insert_member ON public.cohort_messages
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_cohort_member(room_id));

CREATE POLICY cohort_messages_update_own ON public.cohort_messages
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid() AND public.is_cohort_member(room_id));

CREATE POLICY cohort_messages_delete_own ON public.cohort_messages
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- Column guards for direct client writes. Server/service flows remain allowed.
CREATE OR REPLACE FUNCTION public.prevent_profile_membership_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_allow boolean := COALESCE(current_setting('hanbang.allow_membership_write', true), '') = 'on';
BEGIN
  IF v_role IN ('anon', 'authenticated') AND NOT v_allow THEN
    NEW.couple_id := OLD.couple_id;
    NEW.role := OLD.role;
    NEW.is_admin := OLD.is_admin;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_membership_self_change ON public.profiles;
CREATE TRIGGER trg_prevent_profile_membership_self_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_membership_self_change();

CREATE OR REPLACE FUNCTION public.prevent_couple_slot_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_allow boolean := COALESCE(current_setting('hanbang.allow_membership_write', true), '') = 'on';
BEGIN
  IF v_role IN ('anon', 'authenticated') AND NOT v_allow THEN
    NEW.bride_id := OLD.bride_id;
    NEW.groom_id := OLD.groom_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_couple_slot_self_change ON public.couples;
CREATE TRIGGER trg_prevent_couple_slot_self_change
  BEFORE UPDATE ON public.couples
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_couple_slot_self_change();

CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  code text;
  code_exists boolean;
BEGIN
  LOOP
    code := 'WH-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    SELECT EXISTS(SELECT 1 FROM public.couples WHERE invite_code = code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  RETURN code;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_couple(p_invite_code text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple record;
BEGIN
  SELECT * INTO v_couple FROM public.couples WHERE invite_code = p_invite_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid invite code.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND couple_id IS NOT NULL
      AND couple_id <> v_couple.id
  ) THEN
    RETURN jsonb_build_object('error', 'This account is already linked to another couple.');
  END IF;

  PERFORM set_config('hanbang.allow_membership_write', 'on', true);

  IF p_role = 'bride' THEN
    IF v_couple.bride_id IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'Bride slot is already linked.');
    END IF;
    UPDATE public.couples
    SET bride_id = auth.uid(), updated_at = now()
    WHERE id = v_couple.id;
  ELSIF p_role = 'groom' THEN
    IF v_couple.groom_id IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'Groom slot is already linked.');
    END IF;
    UPDATE public.couples
    SET groom_id = auth.uid(), updated_at = now()
    WHERE id = v_couple.id;
  ELSE
    RETURN jsonb_build_object('error', 'Invalid role.');
  END IF;

  UPDATE public.profiles
  SET couple_id = v_couple.id, role = p_role, updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'couple_id', v_couple.id,
    'invite_code', v_couple.invite_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_invite_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_couple(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_invite_code() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_couple(text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public._drop_all_policies_for_table(regclass);
