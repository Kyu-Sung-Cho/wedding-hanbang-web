-- Durable, payload-free request tombstones. A whole chat request is claimed
-- before any model/tool call, so retries cannot re-run mutations even when a
-- model produces slightly different arguments on the second generation.

-- A deletion request becomes a durable lifecycle state before any cleanup.
-- New chat/model work fails closed while retries may continue the deletion.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_deleting_at timestamptz;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS amora_membership_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS amora_membership_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS private_chat_deleting_at timestamptz;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS amora_membership_resetting_at timestamptz;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_token text;
ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS amora_shared_resetting_at timestamptz;
ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS amora_shared_resetting_user_id uuid;
ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS amora_context_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS amora_context_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS amora_replacement_blocked_at timestamptz;

-- Expand-only release rule: a pre-migration one-slot couple cannot be
-- distinguished safely from a legitimate solo journey. Never infer that a
-- partner departed, clear an invite, or detach journey data in an automatic
-- migration. A future operator-authored migration may mark individually
-- audited couple ids only after an export, classification, and change approval.
-- The lifecycle RPCs below still mark couples when a *new, observed* departure
-- happens after this migration; that event has provenance and is not guessed.

-- Historical environments already have these compatibility columns, but the
-- checked-in baseline did not create them on a fresh database. Profiles and
-- couples are altered first to match runtime profile -> couple -> chat locks.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS sender_type text
    CHECK (sender_type IN ('bride', 'groom', 'ai'));
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS role text
    CHECK (role IN ('user', 'assistant'));
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Couple cleanup must not cascade-delete payload-free spend/accounting rows.
-- The later redaction step clears direct linkage while retaining safe totals.
ALTER TABLE public.ai_interactions_log
  DROP CONSTRAINT IF EXISTS ai_interactions_log_couple_id_fkey;
ALTER TABLE public.ai_interactions_log
  ADD CONSTRAINT ai_interactions_log_couple_id_fkey
  FOREIGN KEY (couple_id) REFERENCES public.couples(id) ON DELETE SET NULL;

-- New money rows are bound to their authenticated creator by the API. Existing
-- rows have no trustworthy person-level provenance, so owner_user_id remains
-- NULL and is quarantined from reads until an operator maps it from an export.
ALTER TABLE public.congratulatory_money
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Preserve the existing self-update guard and add the server-owned deletion
-- lifecycle field. Authenticated clients cannot clear or forge the marker.
CREATE OR REPLACE FUNCTION public.prevent_profile_membership_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_allow boolean := COALESCE(current_setting('hanbang.allow_membership_write', true), '') = 'on';
BEGIN
  IF v_role IN ('anon', 'authenticated') AND NOT v_allow THEN
    NEW.couple_id := OLD.couple_id;
    NEW.role := OLD.role;
    NEW.is_admin := OLD.is_admin;
    NEW.account_deleting_at := OLD.account_deleting_at;
    NEW.private_chat_deleting_at := OLD.private_chat_deleting_at;
    NEW.amora_membership_resetting_at := OLD.amora_membership_resetting_at;
    NEW.amora_membership_generation := OLD.amora_membership_generation;
    NEW.amora_membership_changed_at := OLD.amora_membership_changed_at;
  ELSIF NEW.couple_id IS DISTINCT FROM OLD.couple_id OR NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.amora_membership_generation := OLD.amora_membership_generation + 1;
    NEW.amora_membership_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_self_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
BEGIN
  IF v_role IN ('anon', 'authenticated') THEN
    IF NEW.id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'profile id must match authenticated user' USING ERRCODE = '42501';
    END IF;
    NEW.couple_id := NULL;
    NEW.role := NULL;
    NEW.is_admin := false;
    NEW.onboarding_completed := false;
    NEW.onboarding_step := 0;
    NEW.account_deleting_at := NULL;
    NEW.private_chat_deleting_at := NULL;
    NEW.amora_membership_resetting_at := NULL;
    NEW.amora_membership_generation := 0;
    NEW.amora_membership_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_self_insert ON public.profiles;
CREATE TRIGGER trg_guard_profile_self_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_self_insert();

-- Expand phase keeps the published mobile contract that reads the currently
-- linked partner's name directly. New clients use get_my_partner_public(); the
-- broader row contract is retired only in the gated future contract migration.
CREATE OR REPLACE FUNCTION public.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS caller
      JOIN public.couples AS couple ON couple.id = caller.couple_id
      JOIN public.profiles AS partner
        ON partner.id = p_profile_id
       AND partner.couple_id = couple.id
      WHERE caller.id = auth.uid()
        AND caller.account_deleting_at IS NULL
        AND caller.amora_membership_resetting_at IS NULL
        AND partner.account_deleting_at IS NULL
        AND couple.amora_shared_resetting_at IS NULL
        AND (
          (couple.bride_id = caller.id AND couple.groom_id = partner.id)
          OR (couple.groom_id = caller.id AND couple.bride_id = partner.id)
        )
    );
$$;
REVOKE ALL ON FUNCTION public.can_read_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_couple_member(p_couple_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = p_couple_id
        AND profile.account_deleting_at IS NULL
        AND profile.amora_membership_resetting_at IS NULL
        AND couple.amora_shared_resetting_at IS NULL
        AND (
          (profile.role::text = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
        )
    );
$$;
REVOKE ALL ON FUNCTION public.is_couple_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_partner_public()
RETURNS TABLE(id uuid, name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT partner.id, partner.name, partner.role::text
  FROM public.profiles AS caller
  JOIN public.couples AS couple ON couple.id = caller.couple_id
  JOIN public.profiles AS partner
    ON partner.id = CASE
      WHEN couple.bride_id = auth.uid() THEN couple.groom_id
      WHEN couple.groom_id = auth.uid() THEN couple.bride_id
      ELSE NULL
    END
  WHERE caller.id = auth.uid()
    AND caller.account_deleting_at IS NULL
    AND caller.amora_membership_resetting_at IS NULL
    AND couple.amora_shared_resetting_at IS NULL
    AND (
      (caller.role::text = 'bride' AND couple.bride_id = caller.id)
      OR (caller.role::text = 'groom' AND couple.groom_id = caller.id)
    )
    AND partner.account_deleting_at IS NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_partner_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_partner_public() TO authenticated, service_role;

-- A view reset is an authorization epoch change. Advancing the generation in
-- the same transaction prevents a response that started before "new chat"
-- from being committed into the newly cleared view.
CREATE OR REPLACE FUNCTION public.reset_my_amora_chat_view(
  p_user_id uuid,
  p_couple_id uuid,
  p_visibility text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_cleared_at timestamptz := clock_timestamp();
  v_expected_private text;
BEGIN
  SELECT profile.role::text INTO v_role
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
    AND profile.account_deleting_at IS NULL
    AND profile.amora_membership_resetting_at IS NULL
    AND couple.amora_shared_resetting_at IS NULL
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = p_user_id)
      OR (profile.role::text = 'groom' AND couple.groom_id = p_user_id)
    )
  FOR UPDATE OF profile, couple;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat view reset ownership verification failed' USING ERRCODE = '42501';
  END IF;

  v_expected_private := CASE WHEN v_role = 'bride' THEN 'bride_private' ELSE 'groom_private' END;
  IF p_visibility <> 'shared' AND p_visibility <> v_expected_private THEN
    RAISE EXCEPTION 'chat view reset visibility verification failed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET shared_chat_cleared_at = CASE
        WHEN p_visibility = 'shared' THEN v_cleared_at
        ELSE shared_chat_cleared_at
      END,
      private_chat_cleared_at = CASE
        WHEN p_visibility <> 'shared' THEN v_cleared_at
        ELSE private_chat_cleared_at
      END,
      amora_membership_generation = amora_membership_generation + 1,
      amora_membership_changed_at = v_cleared_at
  WHERE id = p_user_id;

  RETURN v_cleared_at;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_my_amora_chat_view(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_my_amora_chat_view(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_my_amora_chat_view(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.respond_amora_shared_clear_request(
  p_user_id uuid,
  p_message_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_sender_id uuid;
  v_message_created_at timestamptz;
  v_metadata jsonb;
  v_clear_request jsonb;
  v_candidate_bride_id uuid;
  v_candidate_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_role text;
  v_account_deleting_at timestamptz;
  v_membership_resetting_at timestamptz;
  v_shared_resetting_at timestamptz;
  v_responded_at timestamptz := clock_timestamp();
  v_updated integer;
BEGIN
  IF p_action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'invalid clear request action' USING ERRCODE = '22023';
  END IF;

  SELECT message.couple_id
  INTO v_couple_id
  FROM public.chat_messages AS message
  WHERE message.id = p_message_id
    AND message.visibility::text = 'shared';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clear request message not found' USING ERRCODE = 'P0002';
  END IF;

  -- Read candidate ids, then lock every member profile in UUID order before
  -- locking the couple. This matches lifecycle operations without ever taking
  -- a partner profile lock after the couple lock.
  SELECT bride_id, groom_id INTO v_candidate_bride_id, v_candidate_groom_id
  FROM public.couples WHERE id = v_couple_id;
  IF NOT FOUND OR v_candidate_bride_id IS NULL OR v_candidate_groom_id IS NULL THEN
    RAISE EXCEPTION 'clear request couple is unavailable' USING ERRCODE = '55000';
  END IF;
  PERFORM 1
  FROM public.profiles
  WHERE id IN (v_candidate_bride_id, v_candidate_groom_id)
  ORDER BY id
  FOR UPDATE;

  SELECT bride_id, groom_id, amora_shared_resetting_at
  INTO v_bride_id, v_groom_id, v_shared_resetting_at
  FROM public.couples
  WHERE id = v_couple_id
  FOR UPDATE;
  IF v_bride_id IS DISTINCT FROM v_candidate_bride_id
    OR v_groom_id IS DISTINCT FROM v_candidate_groom_id
  THEN
    RAISE EXCEPTION 'couple membership changed during clear response' USING ERRCODE = '40001';
  END IF;

  SELECT role::text, account_deleting_at, amora_membership_resetting_at
  INTO v_role, v_account_deleting_at, v_membership_resetting_at
  FROM public.profiles
  WHERE id = p_user_id AND couple_id = v_couple_id;
  IF NOT FOUND
    OR v_account_deleting_at IS NOT NULL
    OR v_membership_resetting_at IS NOT NULL
    OR v_shared_resetting_at IS NOT NULL
    OR NOT COALESCE(
      (v_role = 'bride' AND v_bride_id = p_user_id)
        OR (v_role = 'groom' AND v_groom_id = p_user_id),
      false
    )
  THEN
    RAISE EXCEPTION 'clear request ownership verification failed' USING ERRCODE = '42501';
  END IF;

  -- Chat rows are locked last. Lifecycle cleanup follows the same
  -- profiles -> couple -> chat order, avoiding a clear/reset deadlock cycle.
  SELECT message.couple_id, message.sender_id, message.created_at, message.metadata
  INTO v_couple_id, v_sender_id, v_message_created_at, v_metadata
  FROM public.chat_messages AS message
  WHERE message.id = p_message_id
    AND message.visibility::text = 'shared'
    AND message.couple_id = v_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clear request message not found' USING ERRCODE = 'P0002';
  END IF;

  v_clear_request := v_metadata->'clearRequest';
  IF jsonb_typeof(v_clear_request) <> 'object'
    OR v_clear_request->>'type' <> 'shared'
    OR v_clear_request->>'status' <> 'pending'
    OR v_sender_id IS NULL
    OR v_sender_id = p_user_id
    OR v_sender_id NOT IN (v_bride_id, v_groom_id)
    OR v_clear_request->>'requestedBy' IS DISTINCT FROM v_sender_id::text
  THEN
    RAISE EXCEPTION 'clear request is not pending or valid' USING ERRCODE = '55000';
  END IF;

  v_clear_request := v_clear_request || jsonb_build_object(
    'status', CASE WHEN p_action = 'accept' THEN 'accepted' ELSE 'declined' END,
    'respondedBy', p_user_id,
    'respondedAt', v_responded_at
  );
  UPDATE public.chat_messages
  SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{clearRequest}', v_clear_request, true)
  WHERE id = p_message_id;

  IF p_action = 'accept' THEN
    UPDATE public.profiles
    SET shared_chat_cleared_at = GREATEST(
          COALESCE(shared_chat_cleared_at, '-infinity'::timestamptz),
          v_message_created_at
        ),
        amora_membership_generation = amora_membership_generation + 1,
        amora_membership_changed_at = v_responded_at
    WHERE id IN (v_bride_id, v_groom_id)
      AND couple_id = v_couple_id
      AND account_deleting_at IS NULL
      AND amora_membership_resetting_at IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 2 THEN
      RAISE EXCEPTION 'both couple profiles are required for shared reset' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'action', p_action,
    'cleared_at', CASE WHEN p_action = 'accept' THEN v_message_created_at ELSE NULL END
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.respond_amora_shared_clear_request(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_amora_shared_clear_request(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_amora_shared_clear_request(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_my_profile(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.profiles (
    id, name, email, onboarding_completed, onboarding_step,
    couple_id, role, is_admin, account_deleting_at
  ) VALUES (
    v_user_id,
    left(COALESCE(NULLIF(btrim(p_name), ''), '사용자'), 100),
    auth.jwt()->>'email',
    false, 0, NULL, NULL, false, NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_my_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile(text) TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
REVOKE INSERT ON TABLE public.profiles FROM authenticated;

-- Authenticated clients only need the two direct-write fields used by the
-- current web/mobile clients. Membership, admin and lifecycle columns remain
-- service-only even if a future trigger regression occurs.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (name, push_token) ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

-- Couple creation/join is server/RPC-only. The old policy allowed a caller to
-- put an arbitrary victim UUID in the other slot and manufacture membership.
DROP POLICY IF EXISTS couples_insert_own ON public.couples;
REVOKE INSERT ON TABLE public.couples FROM authenticated;

-- Invite codes are 48-bit (12 hex chars) and membership changes are server-only
-- transactions that lock the profile before the couple, matching deletion.
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := 'WH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.couples WHERE invite_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_invite_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_invite_code() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invite_code() TO service_role;

-- Reading and rotating an invite code are one locked server transaction. This
-- removes the API's former Math.random fallback and the read-then-update race.
DROP FUNCTION IF EXISTS public.get_or_rotate_invite_code_safely(uuid, boolean);
DROP FUNCTION IF EXISTS public.get_or_rotate_invite_code_safely(uuid, boolean, boolean);
CREATE OR REPLACE FUNCTION public.get_or_rotate_invite_code_safely(
  p_user_id uuid,
  p_rotate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_invite_code text;
  v_fully_linked boolean;
  v_replacement_blocked_at timestamptz;
BEGIN
  SELECT couple_id, role::text
  INTO v_couple_id, v_role
  FROM public.profiles
  WHERE id = p_user_id
    AND account_deleting_at IS NULL
    AND amora_membership_resetting_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_couple_id IS NULL OR v_role NOT IN ('bride', 'groom') THEN
    RAISE EXCEPTION 'invite state is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT bride_id, groom_id, invite_code, amora_replacement_blocked_at
  INTO v_bride_id, v_groom_id, v_invite_code, v_replacement_blocked_at
  FROM public.couples
  WHERE id = v_couple_id
    AND amora_shared_resetting_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
    OR (v_role = 'bride' AND v_bride_id IS DISTINCT FROM p_user_id)
    OR (v_role = 'groom' AND v_groom_id IS DISTINCT FROM p_user_id)
  THEN
    RAISE EXCEPTION 'invite state is unavailable' USING ERRCODE = '42501';
  END IF;

  v_fully_linked := v_bride_id IS NOT NULL AND v_groom_id IS NOT NULL;
  IF v_replacement_blocked_at IS NOT NULL THEN
    IF v_fully_linked THEN
      RAISE EXCEPTION 'blocked invite state is inconsistent' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'invite_code', NULL,
      'is_fully_linked', false,
      'requires_relink_confirmation', true
    );
  END IF;

  IF COALESCE(p_rotate, false) AND v_fully_linked THEN
    RAISE EXCEPTION 'invite cannot be rotated after linking' USING ERRCODE = '55000';
  END IF;

  IF v_invite_code IS NULL OR COALESCE(p_rotate, false) THEN
    v_invite_code := public.generate_invite_code();
    UPDATE public.couples
    SET invite_code = v_invite_code, updated_at = now()
    WHERE id = v_couple_id;
  END IF;

  RETURN jsonb_build_object(
    'invite_code', v_invite_code,
    'is_fully_linked', v_fully_linked,
    'requires_relink_confirmation', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_rotate_invite_code_safely(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_rotate_invite_code_safely(uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_rotate_invite_code_safely(uuid, boolean) TO service_role;

-- A blocked legacy couple may contain a departed person's shared or derived
-- data. Consent from the remaining member cannot authorize disclosure of that
-- data to a new partner, so confirmation creates a clean couple instead of
-- reopening the old one. The old records are retained for operator-led privacy
-- remediation but have no member and no invite code.
CREATE OR REPLACE FUNCTION public.restart_blocked_amora_couple_safely(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_couple_id uuid;
  v_new_couple_id uuid;
  v_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_invite_code text;
  v_active_leases bigint;
BEGIN
  SELECT couple_id, role::text
  INTO v_old_couple_id, v_role
  FROM public.profiles
  WHERE id = p_user_id
    AND account_deleting_at IS NULL
    AND amora_membership_resetting_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_old_couple_id IS NULL OR v_role NOT IN ('bride', 'groom') THEN
    RAISE EXCEPTION 'blocked couple restart is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT bride_id, groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = v_old_couple_id
    AND amora_replacement_blocked_at IS NOT NULL
    AND amora_shared_resetting_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
    OR (v_bride_id IS NOT NULL AND v_groom_id IS NOT NULL)
    OR (v_role = 'bride' AND (v_bride_id IS DISTINCT FROM p_user_id OR v_groom_id IS NOT NULL))
    OR (v_role = 'groom' AND (v_groom_id IS DISTINCT FROM p_user_id OR v_bride_id IS NOT NULL))
  THEN
    RAISE EXCEPTION 'blocked couple restart is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_active_leases
  FROM public.amora_provider_leases
  WHERE expires_at > now()
    AND (user_id = p_user_id OR couple_id = v_old_couple_id);
  IF v_active_leases > 0 THEN
    RAISE EXCEPTION 'active provider lease prevents blocked couple restart' USING ERRCODE = '55000';
  END IF;

  v_invite_code := public.generate_invite_code();
  INSERT INTO public.couples (invite_code, bride_id, groom_id)
  VALUES (
    v_invite_code,
    CASE WHEN v_role = 'bride' THEN p_user_id ELSE NULL END,
    CASE WHEN v_role = 'groom' THEN p_user_id ELSE NULL END
  )
  RETURNING id INTO v_new_couple_id;

  INSERT INTO public.wedding_journeys (couple_id, total_budget, progress)
  VALUES (v_new_couple_id, 0, '{}'::jsonb);

  UPDATE public.couples
  SET bride_id = CASE WHEN v_role = 'bride' THEN NULL ELSE bride_id END,
      groom_id = CASE WHEN v_role = 'groom' THEN NULL ELSE groom_id END,
      invite_code = NULL,
      amora_context_generation = amora_context_generation + 1,
      amora_context_changed_at = now(),
      updated_at = now()
  WHERE id = v_old_couple_id;

  UPDATE public.profiles
  SET couple_id = v_new_couple_id,
      onboarding_completed = true,
      onboarding_step = 5,
      shared_chat_cleared_at = NULL,
      private_chat_cleared_at = NULL,
      private_chat_deleting_at = NULL,
      updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'invite_code', v_invite_code,
    'is_fully_linked', false,
    'requires_relink_confirmation', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.restart_blocked_amora_couple_safely(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restart_blocked_amora_couple_safely(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restart_blocked_amora_couple_safely(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.join_couple_server(
  p_user_id uuid,
  p_invite_code text,
  p_role text,
  p_wedding_date date,
  p_venue text,
  p_total_budget numeric,
  p_progress jsonb,
  p_sanggyeonrye_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_couple_id uuid;
  v_couple_id uuid;
  v_code text := upper(btrim(COALESCE(p_invite_code, '')));
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_progress jsonb;
  v_events jsonb;
  v_now timestamptz;
BEGIN
  IF v_role NOT IN ('bride', 'groom')
    OR v_code !~ '^WH-[A-Z0-9]{12}$'
    OR p_total_budget IS NULL OR p_total_budget < 0 OR p_total_budget > 10000000000
    OR jsonb_typeof(COALESCE(p_progress, '{}'::jsonb)) <> 'object'
  THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  SELECT couple_id INTO v_profile_couple_id
  FROM public.profiles
  WHERE id = p_user_id
    AND account_deleting_at IS NULL
    AND amora_membership_resetting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_profile_couple_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  SELECT id INTO v_couple_id
  FROM public.couples
  WHERE invite_code = v_code
    AND amora_shared_resetting_at IS NULL
    AND amora_replacement_blocked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  IF v_role = 'bride' THEN
    UPDATE public.couples
    SET bride_id = p_user_id,
        amora_context_generation = amora_context_generation + 1,
        amora_context_changed_at = now(),
        updated_at = now()
    WHERE id = v_couple_id AND bride_id IS NULL
      AND (groom_id IS NULL OR groom_id <> p_user_id);
  ELSE
    UPDATE public.couples
    SET groom_id = p_user_id,
        amora_context_generation = amora_context_generation + 1,
        amora_context_changed_at = now(),
        updated_at = now()
    WHERE id = v_couple_id AND groom_id IS NULL
      AND (bride_id IS NULL OR bride_id <> p_user_id);
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      onboarding_completed = true,
      onboarding_step = 5,
      updated_at = now()
  WHERE id = p_user_id;

  -- A missing legacy journey is created inside the same membership
  -- transaction. Existing couple data is preserved; the joining user's
  -- sanggyeonrye date is appended only when the couple has none yet.
  SELECT progress INTO v_progress
  FROM public.wedding_journeys
  WHERE couple_id = v_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wedding_journeys (
      couple_id, wedding_date, venue, total_budget, progress
    ) VALUES (
      v_couple_id, p_wedding_date, NULLIF(btrim(p_venue), ''),
      p_total_budget, COALESCE(p_progress, '{}'::jsonb)
    );
  ELSIF p_sanggyeonrye_date IS NOT NULL THEN
    v_events := CASE
      WHEN jsonb_typeof(COALESCE(v_progress->'__events', '[]'::jsonb)) = 'array'
        THEN COALESCE(v_progress->'__events', '[]'::jsonb)
      ELSE '[]'::jsonb
    END;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_events) AS event
      WHERE event->>'momentType' = 'sanggyeonrye'
    ) THEN
      v_now := clock_timestamp();
      v_events := v_events || jsonb_build_array(jsonb_build_object(
        'id', 'evt_' || replace(gen_random_uuid()::text, '-', ''),
        'date', p_sanggyeonrye_date,
        'title', '상견례',
        'momentType', 'sanggyeonrye',
        'createdAt', v_now,
        'updatedAt', v_now
      ));
      UPDATE public.wedding_journeys
      SET progress = jsonb_set(COALESCE(v_progress, '{}'::jsonb), '{__events}', v_events, true)
      WHERE couple_id = v_couple_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'couple_id', v_couple_id, 'invite_code', v_code);
END;
$$;
REVOKE ALL ON FUNCTION public.join_couple_server(uuid, text, text, date, text, numeric, jsonb, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_couple_server(uuid, text, text, date, text, numeric, jsonb, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_couple_server(uuid, text, text, date, text, numeric, jsonb, date) TO service_role;

-- Remove a partially deployed legacy overload so PostgREST cannot resolve a
-- caller around the journey/lifecycle-atomic signature above.
DROP FUNCTION IF EXISTS public.join_couple_server(uuid, text, text);

REVOKE ALL ON FUNCTION public.join_couple(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_couple(text, text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_amora_couple_safely(
  p_user_id uuid,
  p_role text,
  p_wedding_date date,
  p_venue text,
  p_total_budget numeric,
  p_progress jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_code text;
  v_couple_id uuid;
  v_existing_couple_id uuid;
BEGIN
  IF v_role NOT IN ('bride', 'groom')
    OR p_total_budget IS NULL OR p_total_budget < 0 OR p_total_budget > 10000000000
    OR jsonb_typeof(COALESCE(p_progress, '{}'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid couple creation arguments' USING ERRCODE = '22023';
  END IF;

  SELECT couple_id INTO v_existing_couple_id
  FROM public.profiles
  WHERE id = p_user_id
    AND account_deleting_at IS NULL
    AND amora_membership_resetting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_existing_couple_id IS NOT NULL THEN
    RAISE EXCEPTION 'profile is not available for couple creation' USING ERRCODE = '55000';
  END IF;

  v_code := public.generate_invite_code();
  INSERT INTO public.couples (invite_code, bride_id, groom_id)
  VALUES (
    v_code,
    CASE WHEN v_role = 'bride' THEN p_user_id ELSE NULL END,
    CASE WHEN v_role = 'groom' THEN p_user_id ELSE NULL END
  )
  RETURNING id INTO v_couple_id;

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      onboarding_completed = true,
      onboarding_step = 5,
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.wedding_journeys (
    couple_id, wedding_date, venue, total_budget, progress
  ) VALUES (
    v_couple_id, p_wedding_date, NULLIF(btrim(p_venue), ''),
    p_total_budget, COALESCE(p_progress, '{}'::jsonb)
  );

  RETURN jsonb_build_object('success', true, 'couple_id', v_couple_id, 'invite_code', v_code);
END;
$$;
REVOKE ALL ON FUNCTION public.create_amora_couple_safely(uuid, text, date, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_amora_couple_safely(uuid, text, date, text, numeric, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_amora_couple_safely(uuid, text, date, text, numeric, jsonb) TO service_role;

-- Do not rewrite historical invite codes in the expand migration. Invalid or
-- missing legacy codes can represent several states that require an audited
-- production classification. Newly created couples receive a safe code in the
-- RPC above; historical repairs belong in a separately approved data migration.

-- Authenticated clients may only create genuine user rows. AI/assistant rows
-- remain service-role only even though the compatibility columns now exist.
DROP POLICY IF EXISTS "chat_insert_couple" ON public.chat_messages;
CREATE POLICY "chat_insert_couple" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND role = 'user'
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.couples c ON c.id = p.couple_id
      WHERE p.id = auth.uid()
        AND p.couple_id = chat_messages.couple_id
        AND p.account_deleting_at IS NULL
        AND p.amora_membership_resetting_at IS NULL
        AND c.amora_shared_resetting_at IS NULL
        AND (
          (p.role::text = 'bride' AND c.bride_id = p.id)
          OR (p.role::text = 'groom' AND c.groom_id = p.id)
        )
        AND p.role::text = chat_messages.sender_type
        AND (chat_messages.sender_role IS NULL OR chat_messages.sender_role = p.role::text)
        AND (
          chat_messages.visibility = 'shared'
          OR (p.private_chat_deleting_at IS NULL AND p.role::text = 'bride'
            AND chat_messages.visibility = 'bride_private')
          OR (p.private_chat_deleting_at IS NULL AND p.role::text = 'groom'
            AND chat_messages.visibility = 'groom_private')
        )
    )
  );

-- Serialize every user-authored message with private clear/account deletion and
-- membership changes. statement_timestamp() detects a stale INSERT that began
-- before a competing clear/reset acquired the profile lock.
CREATE OR REPLACE FUNCTION public.guard_amora_user_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_private_cleared_at timestamptz;
  v_private_deleting_at timestamptz;
  v_account_deleting_at timestamptz;
  v_membership_resetting_at timestamptz;
  v_membership_changed_at timestamptz;
  v_shared_resetting_at timestamptz;
  v_expected_visibility text;
  v_jwt_role text := COALESCE(auth.role(), '');
BEGIN
  IF NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.role::text, profile.private_chat_cleared_at,
         profile.private_chat_deleting_at, profile.account_deleting_at,
         profile.amora_membership_resetting_at, profile.amora_membership_changed_at,
         couple.amora_shared_resetting_at
  INTO v_role, v_private_cleared_at, v_private_deleting_at,
       v_account_deleting_at, v_membership_resetting_at, v_membership_changed_at,
       v_shared_resetting_at
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = NEW.sender_id
    AND profile.couple_id = NEW.couple_id
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = NEW.sender_id)
      OR (profile.role::text = 'groom' AND couple.groom_id = NEW.sender_id)
    )
  FOR UPDATE OF profile, couple;

  IF NOT FOUND OR v_account_deleting_at IS NOT NULL
    OR v_membership_resetting_at IS NOT NULL
    OR v_shared_resetting_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'chat message ownership verification failed' USING ERRCODE = '42501';
  END IF;
  IF v_membership_changed_at > statement_timestamp() THEN
    RAISE EXCEPTION 'membership changed while message insert was waiting' USING ERRCODE = '40001';
  END IF;

  v_expected_visibility := CASE
    WHEN v_role = 'bride' THEN 'bride_private'
    WHEN v_role = 'groom' THEN 'groom_private'
    ELSE NULL
  END;
  IF NEW.visibility NOT IN ('shared', 'bride_private', 'groom_private')
    OR (NEW.visibility <> 'shared' AND NEW.visibility <> v_expected_visibility)
  THEN
    RAISE EXCEPTION 'chat message visibility verification failed' USING ERRCODE = '42501';
  END IF;
  IF NEW.visibility <> 'shared'
    AND v_private_deleting_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'private chat deletion is in progress' USING ERRCODE = '40001';
  END IF;
  IF NEW.visibility <> 'shared'
    AND v_private_cleared_at IS NOT NULL
    AND v_private_cleared_at > statement_timestamp()
  THEN
    RAISE EXCEPTION 'private chat was cleared while message insert was waiting' USING ERRCODE = '40001';
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF NEW.sender_id IS DISTINCT FROM auth.uid()
      OR octet_length(COALESCE(NEW.content, '')) = 0
      OR octet_length(NEW.content) > 12000
    THEN
      RAISE EXCEPTION 'chat message payload is invalid or too large' USING ERRCODE = '22023';
    END IF;
    -- Browser/mobile user rows may only carry the partner-target hint. System
    -- clear requests, tool/audit metadata and AI fields are service-owned.
    NEW.metadata := CASE
      WHEN NEW.visibility::text = 'shared' AND NEW.metadata->>'target' = 'partner'
        THEN jsonb_build_object('target', 'partner')
      ELSE '{}'::jsonb
    END;
    NEW.stage_tag := NULL;
    NEW.specialist_type := NULL;
  END IF;

  NEW.sender_type := v_role;
  NEW.sender_role := v_role;
  NEW.role := 'user';
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_amora_user_message_insert ON public.chat_messages;
CREATE TRIGGER trg_guard_amora_user_message_insert
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_amora_user_message_insert();

CREATE OR REPLACE FUNCTION public.insert_amora_user_message(
  p_user_id uuid,
  p_couple_id uuid,
  p_content text,
  p_visibility text,
  p_target text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_expected_private text;
  v_message public.chat_messages%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF octet_length(COALESCE(p_content, '')) = 0 OR octet_length(p_content) > 12000
    OR p_target IS NOT NULL AND p_target <> 'partner'
  THEN
    RAISE EXCEPTION 'invalid chat message payload' USING ERRCODE = '22023';
  END IF;

  SELECT profile.role::text INTO v_role
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
    AND profile.account_deleting_at IS NULL
    AND profile.amora_membership_resetting_at IS NULL
    AND couple.amora_shared_resetting_at IS NULL
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = p_user_id)
      OR (profile.role::text = 'groom' AND couple.groom_id = p_user_id)
    )
  FOR UPDATE OF profile, couple;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat message ownership verification failed' USING ERRCODE = '42501';
  END IF;

  v_expected_private := CASE WHEN v_role = 'bride' THEN 'bride_private' ELSE 'groom_private' END;
  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
    OR (p_visibility <> 'shared' AND p_visibility <> v_expected_private)
    OR (p_target = 'partner' AND p_visibility <> 'shared')
  THEN
    RAISE EXCEPTION 'chat message visibility verification failed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.chat_messages (
    couple_id, sender_id, sender_type, sender_role, role, content, metadata,
    stage_tag, specialist_type, visibility
  ) VALUES (
    p_couple_id, p_user_id, v_role, v_role, 'user', p_content,
    CASE WHEN p_target = 'partner' THEN jsonb_build_object('target', 'partner') ELSE '{}'::jsonb END,
    NULL, NULL, p_visibility
  ) RETURNING * INTO v_message;
  RETURN to_jsonb(v_message);
END;
$$;
REVOKE ALL ON FUNCTION public.insert_amora_user_message(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_amora_user_message(uuid, uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_amora_user_message(uuid, uuid, text, text, text) TO service_role;

-- Compatibility window: the hardened policy and trigger above keep the
-- published mobile direct-INSERT path safe while new clients use the server
-- route. Revocation lives in the gated future contract migration.
GRANT INSERT ON TABLE public.chat_messages TO authenticated;

-- Reassert privacy RLS after later hardening migrations introduced a broad
-- couple-only summary policy (and an older decision FOR ALL policy remained).
DROP POLICY IF EXISTS chat_summaries_select_couple ON public.chat_summaries;
DROP POLICY IF EXISTS chat_summaries_select_with_privacy ON public.chat_summaries;
CREATE POLICY chat_summaries_select_with_privacy ON public.chat_summaries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.couples couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = chat_summaries.couple_id
        AND profile.account_deleting_at IS NULL
        AND (
          (profile.role::text = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
        )
        AND (
          chat_summaries.visibility::text = 'shared'
          OR chat_summaries.visibility::text = 'bride_private' AND profile.role::text = 'bride'
          OR chat_summaries.visibility::text = 'groom_private' AND profile.role::text = 'groom'
        )
    )
  );

DROP POLICY IF EXISTS "decision_nodes_owner_all" ON public.decision_nodes;
DROP POLICY IF EXISTS "decision_nodes_select_with_privacy" ON public.decision_nodes;
CREATE POLICY "decision_nodes_select_with_privacy" ON public.decision_nodes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.couples couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = decision_nodes.couple_id
        AND profile.account_deleting_at IS NULL
        AND (
          (profile.role::text = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
        )
        AND (
          decision_nodes.visibility::text = 'shared'
          OR decision_nodes.visibility::text = 'bride_private' AND profile.role::text = 'bride'
          OR decision_nodes.visibility::text = 'groom_private' AND profile.role::text = 'groom'
        )
    )
  );

DROP POLICY IF EXISTS "chat_select_with_privacy" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_select_couple" ON public.chat_messages;
CREATE POLICY "chat_select_with_privacy" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.couples couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = chat_messages.couple_id
        AND profile.account_deleting_at IS NULL
        AND (
          (profile.role::text = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
        )
        AND (
          chat_messages.visibility::text = 'shared'
          OR chat_messages.visibility::text = 'bride_private' AND profile.role::text = 'bride'
          OR chat_messages.visibility::text = 'groom_private' AND profile.role::text = 'groom'
        )
    )
  );

DROP POLICY IF EXISTS "amora_couple_profiles_select_with_privacy" ON public.amora_couple_profiles;
CREATE POLICY "amora_couple_profiles_select_with_privacy" ON public.amora_couple_profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.couples couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = amora_couple_profiles.couple_id
        AND profile.account_deleting_at IS NULL
        AND (
          (profile.role::text = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
        )
        AND (
          amora_couple_profiles.visibility::text = 'shared'
          OR amora_couple_profiles.visibility::text = 'bride_private' AND profile.role::text = 'bride'
          OR amora_couple_profiles.visibility::text = 'groom_private' AND profile.role::text = 'groom'
        )
    )
  );

DROP POLICY IF EXISTS couples_select_own ON public.couples;
CREATE POLICY couples_select_own ON public.couples
  FOR SELECT TO authenticated
  USING (public.is_couple_member(id));

-- Expand-only: existing chat attachment access remains unchanged. Bucket
-- retirement and policy removal are staged in the future contract migration
-- after old-client traffic and object retention have both been verified.

-- Community media remains supported, but every write shares the profile lock
-- with account deletion. If upload wins, deletion waits and then removes it; if
-- deletion wins, the upload observes account_deleting_at and is rejected.
CREATE OR REPLACE FUNCTION public.guard_user_media_storage_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_owner_text text;
  v_owner_id uuid;
BEGIN
  IF NEW.bucket_id NOT IN ('community-images', 'community-videos') THEN
    RETURN NEW;
  END IF;

  v_owner_text := (storage.foldername(NEW.name))[1];
  BEGIN
    v_owner_id := v_owner_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid community media owner path' USING ERRCODE = '22023';
  END;

  PERFORM 1
  FROM public.profiles
  WHERE id = v_owner_id AND account_deleting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'community media owner is not active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_media_storage_write ON storage.objects;
CREATE TRIGGER trg_guard_user_media_storage_write
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_user_media_storage_write();

-- Expand-only: legacy vendor media policies are not retired here. Their removal
-- is part of the future contract migration and requires a published-client
-- inventory plus a minimum-version gate.

CREATE TABLE IF NOT EXISTS public.amora_request_claims (
  request_key text PRIMARY KEY CHECK (request_key ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  visibility text NOT NULL CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
  status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.amora_request_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amora_request_claims_service_role_all ON public.amora_request_claims;
CREATE POLICY amora_request_claims_service_role_all
  ON public.amora_request_claims FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.amora_request_claims FROM anon, authenticated;
GRANT ALL ON public.amora_request_claims TO service_role;

CREATE TABLE IF NOT EXISTS public.amora_provider_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  couple_id uuid NOT NULL,
  membership_generation bigint NOT NULL,
  couple_context_generation bigint NOT NULL DEFAULT 0,
  visibility text NOT NULL CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amora_provider_leases_user_expiry
  ON public.amora_provider_leases(user_id, expires_at);
ALTER TABLE public.amora_provider_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amora_provider_leases_service_role_all ON public.amora_provider_leases;
CREATE POLICY amora_provider_leases_service_role_all
  ON public.amora_provider_leases FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.amora_provider_leases FROM anon, authenticated;
GRANT ALL ON public.amora_provider_leases TO service_role;

-- Remove any partially deployed pre-context overload so a rolling app cannot
-- bypass the couple context epoch by resolving the old signature.
DROP FUNCTION IF EXISTS public.acquire_amora_provider_lease(
  uuid, uuid, bigint, text, timestamptz
);
CREATE OR REPLACE FUNCTION public.acquire_amora_provider_lease(
  p_user_id uuid,
  p_couple_id uuid,
  p_expected_membership_generation bigint,
  p_expected_couple_context_generation bigint,
  p_visibility text,
  p_expected_private_cleared_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_generation bigint;
  v_couple_context_generation bigint;
  v_private_cleared_at timestamptz;
  v_private_deleting_at timestamptz;
  v_membership_resetting_at timestamptz;
  v_shared_resetting_at timestamptz;
  v_lease_id uuid;
BEGIN
  SELECT profile.role::text, profile.amora_membership_generation,
         profile.private_chat_cleared_at, profile.private_chat_deleting_at,
         profile.amora_membership_resetting_at, couple.amora_shared_resetting_at,
         couple.amora_context_generation
  INTO v_role, v_generation, v_private_cleared_at, v_private_deleting_at,
       v_membership_resetting_at, v_shared_resetting_at, v_couple_context_generation
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
    AND profile.account_deleting_at IS NULL
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = profile.id)
      OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
    )
  FOR UPDATE OF profile, couple;
  IF NOT FOUND OR v_generation IS DISTINCT FROM p_expected_membership_generation
    OR v_couple_context_generation IS DISTINCT FROM p_expected_couple_context_generation
    OR v_membership_resetting_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'provider lease authorization failed' USING ERRCODE = '42501';
  END IF;
  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
    OR (p_visibility = 'bride_private' AND v_role <> 'bride')
    OR (p_visibility = 'groom_private' AND v_role <> 'groom')
    OR v_shared_resetting_at IS NOT NULL
    OR (p_visibility <> 'shared' AND v_private_deleting_at IS NOT NULL)
    OR (
      p_visibility <> 'shared'
      AND v_private_cleared_at IS DISTINCT FROM p_expected_private_cleared_at
    )
  THEN
    RAISE EXCEPTION 'provider lease visibility generation failed' USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.amora_provider_leases WHERE expires_at <= now();
  INSERT INTO public.amora_provider_leases (
    user_id, couple_id, membership_generation, couple_context_generation,
    visibility, expires_at
  ) VALUES (
    p_user_id, p_couple_id, v_generation, v_couple_context_generation,
    p_visibility, now() + interval '5 minutes'
  ) RETURNING id INTO v_lease_id;
  RETURN v_lease_id;
END;
$$;
REVOKE ALL ON FUNCTION public.acquire_amora_provider_lease(uuid, uuid, bigint, bigint, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_amora_provider_lease(uuid, uuid, bigint, bigint, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_amora_provider_lease(uuid, uuid, bigint, bigint, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.release_amora_provider_lease(p_lease_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.amora_provider_leases WHERE id = p_lease_id;
$$;
REVOKE ALL ON FUNCTION public.release_amora_provider_lease(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_amora_provider_lease(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_amora_provider_lease(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.count_active_amora_provider_leases(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.amora_provider_leases WHERE expires_at <= now();
  SELECT count(*)::integer INTO v_count
  FROM public.amora_provider_leases
  WHERE user_id = p_user_id AND expires_at > now();
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.count_active_amora_provider_leases(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_active_amora_provider_leases(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_amora_provider_leases(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.count_active_amora_private_provider_leases(
  p_user_id uuid,
  p_visibility text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_visibility NOT IN ('bride_private', 'groom_private') THEN
    RAISE EXCEPTION 'invalid private visibility' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.amora_provider_leases WHERE expires_at <= now();
  SELECT count(*)::integer INTO v_count
  FROM public.amora_provider_leases
  WHERE user_id = p_user_id
    AND visibility = p_visibility
    AND expires_at > now();
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.count_active_amora_private_provider_leases(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_active_amora_private_provider_leases(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_amora_private_provider_leases(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.count_active_amora_couple_shared_leases(p_couple_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.amora_provider_leases WHERE expires_at <= now();
  SELECT count(*)::integer INTO v_count
  FROM public.amora_provider_leases
  WHERE couple_id = p_couple_id
    AND visibility = 'shared'
    AND expires_at > now();
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.count_active_amora_couple_shared_leases(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_active_amora_couple_shared_leases(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_amora_couple_shared_leases(uuid) TO service_role;

-- Couple reset/account deletion blocks every provider call for the couple, not
-- only shared turns. Private prompts also contain shared couple context.
CREATE OR REPLACE FUNCTION public.count_active_amora_couple_provider_leases(p_couple_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.amora_provider_leases WHERE expires_at <= now();
  SELECT count(*)::integer INTO v_count
  FROM public.amora_provider_leases
  WHERE couple_id = p_couple_id AND expires_at > now();
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.count_active_amora_couple_provider_leases(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_active_amora_couple_provider_leases(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_amora_couple_provider_leases(uuid) TO service_role;

-- Physical private-chat deletion is a two-phase lifecycle: first advance the
-- private epoch and block new provider leases, then the API drains existing
-- leases before calling delete_private_amora_data(). A failed request remains
-- safely blocked and can be retried without reopening private chat.
CREATE OR REPLACE FUNCTION public.begin_private_amora_delete(
  p_user_id uuid,
  p_couple_id uuid,
  p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_started_at timestamptz;
  v_expected_visibility text;
BEGIN
  SELECT profile.role::text,
         COALESCE(profile.private_chat_deleting_at, clock_timestamp())
  INTO v_role, v_started_at
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
    AND profile.account_deleting_at IS NULL
    AND profile.amora_membership_resetting_at IS NULL
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = p_user_id)
      OR (profile.role::text = 'groom' AND couple.groom_id = p_user_id)
    )
  FOR UPDATE OF profile, couple;

  v_expected_visibility := CASE
    WHEN v_role = 'bride' THEN 'bride_private'
    WHEN v_role = 'groom' THEN 'groom_private'
    ELSE NULL
  END;
  IF v_role IS NULL OR p_visibility IS DISTINCT FROM v_expected_visibility THEN
    RAISE EXCEPTION 'private chat ownership verification failed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET private_chat_deleting_at = v_started_at,
      private_chat_cleared_at = v_started_at
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'started_at', v_started_at,
    'visibility', v_expected_visibility
  );
END;
$$;
REVOKE ALL ON FUNCTION public.begin_private_amora_delete(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_private_amora_delete(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_private_amora_delete(uuid, uuid, text) TO service_role;

-- Couple reset also becomes a lifecycle state before destructive cleanup. It
-- invalidates chat generations and prevents any new provider lease while the
-- API waits for already-running requests to finish.
CREATE OR REPLACE FUNCTION public.begin_amora_membership_reset(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_role text;
  v_account_deleting_at timestamptz;
  v_existing_started_at timestamptz;
  v_started_at timestamptz;
  v_generation bigint;
  v_slot_owned boolean := false;
  v_shared_resetting_at timestamptz;
  v_shared_resetting_user_id uuid;
  v_couple_marker_owned boolean := false;
BEGIN
  SELECT couple_id, role::text, account_deleting_at, amora_membership_resetting_at
  INTO v_couple_id, v_role, v_account_deleting_at, v_existing_started_at
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('profile_found', false);
  END IF;
  IF v_account_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'account deletion is already in progress' USING ERRCODE = '55000';
  END IF;

  IF v_couple_id IS NOT NULL THEN
    PERFORM 1 FROM public.couples WHERE id = v_couple_id FOR UPDATE;
  END IF;

  v_started_at := COALESCE(v_existing_started_at, clock_timestamp());
  IF v_couple_id IS NOT NULL THEN
    SELECT COALESCE((
      (v_role = 'bride' AND bride_id = p_user_id)
        OR (v_role = 'groom' AND groom_id = p_user_id)
      ), false),
      amora_shared_resetting_at,
      amora_shared_resetting_user_id
    INTO v_slot_owned, v_shared_resetting_at, v_shared_resetting_user_id
    FROM public.couples
    WHERE id = v_couple_id
    FOR UPDATE;

    IF FOUND AND v_shared_resetting_at IS NOT NULL
      AND v_shared_resetting_user_id IS DISTINCT FROM p_user_id
    THEN
      RAISE EXCEPTION 'another couple lifecycle operation is in progress' USING ERRCODE = '55000';
    END IF;
    IF FOUND THEN
      UPDATE public.couples
      SET amora_shared_resetting_at = COALESCE(amora_shared_resetting_at, v_started_at),
          amora_shared_resetting_user_id = p_user_id,
          amora_context_generation = CASE
            WHEN v_shared_resetting_at IS NULL THEN amora_context_generation + 1
            ELSE amora_context_generation
          END,
          amora_context_changed_at = CASE
            WHEN v_shared_resetting_at IS NULL THEN now()
            ELSE amora_context_changed_at
          END
      WHERE id = v_couple_id;
      v_couple_marker_owned := true;
    END IF;
  END IF;

  UPDATE public.profiles
  SET amora_membership_resetting_at = v_started_at,
      amora_membership_generation = CASE
        WHEN v_existing_started_at IS NULL THEN amora_membership_generation + 1
        ELSE amora_membership_generation
      END,
      amora_membership_changed_at = CASE
        WHEN v_existing_started_at IS NULL THEN now()
        ELSE amora_membership_changed_at
      END
  WHERE id = p_user_id
  RETURNING amora_membership_generation INTO v_generation;

  RETURN jsonb_build_object(
    'profile_found', true,
    'couple_id', v_couple_id,
    'role', v_role,
    'slot_owned', v_slot_owned,
    'couple_marker_owned', v_couple_marker_owned,
    'membership_generation', v_generation,
    'started_at', v_started_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.begin_amora_membership_reset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_amora_membership_reset(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_amora_membership_reset(uuid) TO service_role;

-- Mark deletion before cleanup. The same profile row is the lifecycle lock used
-- by chat completion/private clear, so new work observes the marker immediately.
CREATE OR REPLACE FUNCTION public.begin_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_role text;
  v_started_at timestamptz;
  v_slot_owned boolean := false;
  v_generation bigint;
  v_shared_resetting_at timestamptz;
  v_shared_resetting_user_id uuid;
  v_couple_marker_owned boolean := false;
  v_bride_id uuid;
  v_groom_id uuid;
BEGIN
  SELECT couple_id, role::text, COALESCE(account_deleting_at, now())
  INTO v_couple_id, v_role, v_started_at
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('profile_found', false);
  END IF;

  IF v_couple_id IS NOT NULL THEN
    SELECT bride_id, groom_id, amora_shared_resetting_at, amora_shared_resetting_user_id
    INTO v_bride_id, v_groom_id, v_shared_resetting_at, v_shared_resetting_user_id
    FROM public.couples
    WHERE id = v_couple_id
    FOR UPDATE;
    v_couple_marker_owned := FOUND;
    v_slot_owned := COALESCE(FOUND AND (
      (v_role = 'bride' AND v_bride_id = p_user_id)
      OR (v_role = 'groom' AND v_groom_id = p_user_id)
    ), false);
    IF v_couple_marker_owned AND v_shared_resetting_at IS NOT NULL
      AND v_shared_resetting_user_id IS DISTINCT FROM p_user_id
    THEN
      RAISE EXCEPTION 'another couple lifecycle operation is in progress' USING ERRCODE = '55000';
    END IF;
    IF v_couple_marker_owned THEN
      UPDATE public.couples
      SET amora_shared_resetting_at = COALESCE(amora_shared_resetting_at, v_started_at),
          amora_shared_resetting_user_id = p_user_id,
          amora_context_generation = CASE
            WHEN v_shared_resetting_at IS NULL THEN amora_context_generation + 1
            ELSE amora_context_generation
          END,
          amora_context_changed_at = CASE
            WHEN v_shared_resetting_at IS NULL THEN now()
            ELSE amora_context_changed_at
          END
      WHERE id = v_couple_id;
    END IF;
  END IF;

  UPDATE public.profiles
  SET account_deleting_at = v_started_at,
      amora_membership_generation = amora_membership_generation + 1,
      amora_membership_changed_at = now()
  WHERE id = p_user_id
  RETURNING amora_membership_generation INTO v_generation;

  RETURN jsonb_build_object(
    'profile_found', true,
    'couple_id', v_couple_id,
    'role', v_role,
    'slot_owned', v_slot_owned,
    'couple_marker_owned', v_couple_marker_owned,
    'membership_generation', v_generation,
    'account_deleting_at', v_started_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.begin_account_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_account_deletion(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.complete_amora_chat_request(
  uuid, uuid, text, text, text, jsonb, text, text, text, timestamptz,
  bigint, text, text, integer, text, integer, integer, numeric, jsonb
);
CREATE OR REPLACE FUNCTION public.complete_amora_chat_request(
  p_user_id uuid,
  p_couple_id uuid,
  p_request_key text,
  p_request_hash text,
  p_content text,
  p_metadata jsonb,
  p_stage_tag text,
  p_specialist_type text,
  p_visibility text,
  p_expected_private_cleared_at timestamptz,
  p_expected_membership_generation bigint,
  p_expected_couple_context_generation bigint,
  p_audit_user_input text,
  p_audit_ai_output text,
  p_audit_latency_ms integer,
  p_audit_model text,
  p_audit_tokens_input integer,
  p_audit_tokens_output integer,
  p_audit_cost_usd numeric,
  p_audit_metadata jsonb
)
RETURNS TABLE(message_id uuid, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_private_cleared_at timestamptz;
  v_private_deleting_at timestamptz;
  v_account_deleting_at timestamptz;
  v_membership_resetting_at timestamptz;
  v_shared_resetting_at timestamptz;
  v_membership_generation bigint;
  v_couple_context_generation bigint;
  v_expected_visibility text;
  v_message_id uuid;
  v_created_at timestamptz;
BEGIN
  SELECT profile.role::text, profile.private_chat_cleared_at,
         profile.private_chat_deleting_at, profile.account_deleting_at,
         profile.amora_membership_resetting_at, profile.amora_membership_generation,
         couple.amora_shared_resetting_at, couple.amora_context_generation
  INTO v_role, v_private_cleared_at, v_private_deleting_at,
       v_account_deleting_at, v_membership_resetting_at, v_membership_generation,
       v_shared_resetting_at, v_couple_context_generation
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = p_user_id)
      OR (profile.role::text = 'groom' AND couple.groom_id = p_user_id)
    )
  FOR UPDATE OF profile, couple;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat completion ownership verification failed' USING ERRCODE = '42501';
  END IF;

  IF v_account_deleting_at IS NOT NULL
    OR v_membership_resetting_at IS NOT NULL
    OR v_shared_resetting_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'account or membership deletion is in progress' USING ERRCODE = '42501';
  END IF;

  IF v_membership_generation IS DISTINCT FROM p_expected_membership_generation THEN
    RAISE EXCEPTION 'chat membership changed while this response was running' USING ERRCODE = '40001';
  END IF;
  IF v_couple_context_generation IS DISTINCT FROM p_expected_couple_context_generation THEN
    RAISE EXCEPTION 'couple context changed while this response was running' USING ERRCODE = '40001';
  END IF;

  v_expected_visibility := CASE
    WHEN v_role = 'bride' THEN 'bride_private'
    WHEN v_role = 'groom' THEN 'groom_private'
    ELSE NULL
  END;

  IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
    OR (p_visibility <> 'shared' AND p_visibility <> v_expected_visibility)
    OR (p_visibility <> 'shared' AND v_private_deleting_at IS NOT NULL)
  THEN
    RAISE EXCEPTION 'chat completion visibility verification failed' USING ERRCODE = '42501';
  END IF;

  IF p_visibility <> 'shared'
    AND v_private_cleared_at IS DISTINCT FROM p_expected_private_cleared_at
  THEN
    RAISE EXCEPTION 'private chat was cleared while this response was running' USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.amora_request_claims
  WHERE request_key = p_request_key
    AND request_hash = p_request_hash
    AND status = 'in_progress'
    AND visibility = p_visibility
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat request claim is not executable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.chat_messages (
    couple_id, sender_id, sender_type, role, content, metadata,
    stage_tag, specialist_type, visibility
  ) VALUES (
    p_couple_id, NULL, 'ai', 'assistant', p_content,
    COALESCE(p_metadata, '{}'::jsonb), p_stage_tag, p_specialist_type, p_visibility
  )
  RETURNING id, chat_messages.created_at INTO v_message_id, v_created_at;

  -- Successful chat audit and the visible message commit together. A logging
  -- constraint/error rolls the whole transaction back instead of losing usage.
  INSERT INTO public.ai_interactions_log (
    user_id, couple_id, message_id, interaction_type, specialist_type,
    user_input, ai_output, latency_ms, success, model,
    tokens_input, tokens_output, cost_usd, metadata
  ) VALUES (
    p_user_id, p_couple_id, v_message_id, 'chat_turn', p_specialist_type,
    p_audit_user_input, p_audit_ai_output, p_audit_latency_ms, true, p_audit_model,
    p_audit_tokens_input, p_audit_tokens_output, p_audit_cost_usd,
    COALESCE(p_audit_metadata, '{}'::jsonb)
  );

  UPDATE public.amora_request_claims
  SET status = 'completed', message_id = v_message_id, updated_at = now()
  WHERE request_key = p_request_key;

  RETURN QUERY SELECT v_message_id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_amora_chat_request(
  uuid, uuid, text, text, text, jsonb, text, text, text, timestamptz,
  bigint, bigint, text, text, integer, text, integer, integer, numeric, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_amora_chat_request(
  uuid, uuid, text, text, text, jsonb, text, text, text, timestamptz,
  bigint, bigint, text, text, integer, text, integer, integer, numeric, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_amora_chat_request(
  uuid, uuid, text, text, text, jsonb, text, text, text, timestamptz,
  bigint, bigint, text, text, integer, text, integer, integer, numeric, jsonb
) TO service_role;

-- Private delete and completion lock the same profile row. Whichever commits
-- second sees the new generation or deletes the completed message atomically.
CREATE OR REPLACE FUNCTION public.delete_private_amora_data(
  p_user_id uuid,
  p_couple_id uuid,
  p_visibility text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_expected_visibility text;
  v_private_deleting_at timestamptz;
  v_account_deleting_at timestamptz;
  v_membership_resetting_at timestamptz;
  v_message_ids uuid[] := ARRAY[]::uuid[];
  v_deleted integer := 0;
BEGIN
  SELECT profile.role::text, profile.private_chat_deleting_at,
         profile.account_deleting_at, profile.amora_membership_resetting_at
  INTO v_role, v_private_deleting_at, v_account_deleting_at, v_membership_resetting_at
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = p_user_id)
      OR (profile.role::text = 'groom' AND couple.groom_id = p_user_id)
    )
  FOR UPDATE OF profile, couple;

  v_expected_visibility := CASE
    WHEN v_role = 'bride' THEN 'bride_private'
    WHEN v_role = 'groom' THEN 'groom_private'
    ELSE NULL
  END;
  IF v_expected_visibility IS NULL OR p_visibility <> v_expected_visibility THEN
    RAISE EXCEPTION 'private chat ownership verification failed' USING ERRCODE = '42501';
  END IF;
  IF v_private_deleting_at IS NULL
    AND v_account_deleting_at IS NULL
    AND v_membership_resetting_at IS NULL
  THEN
    RAISE EXCEPTION 'private chat deletion lifecycle marker is required' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_message_ids
  FROM public.chat_messages
  WHERE couple_id = p_couple_id AND visibility::text = p_visibility;

  UPDATE public.ai_interactions_log
  SET user_input = CASE WHEN user_input IS NULL THEN NULL ELSE '[redacted_by_private_chat_delete]' END,
      ai_output = CASE WHEN ai_output IS NULL THEN NULL ELSE '[redacted_by_private_chat_delete]' END,
      tool_input = NULL, tool_output = NULL,
      error_message = CASE WHEN error_message IS NULL THEN NULL ELSE '[redacted_by_private_chat_delete]' END,
      message_id = NULL,
      metadata = jsonb_strip_nulls(jsonb_build_object(
        'visibility', metadata->>'visibility', 'endpoint', metadata->>'endpoint',
        'source', metadata->>'source', 'quota_class', metadata->>'quota_class',
        'request_usage', metadata->'request_usage', 'private_payload_redacted_at', now()
      ))
  WHERE couple_id = p_couple_id
    AND (message_id = ANY(v_message_ids) OR metadata->>'visibility' = p_visibility
      OR (user_id = p_user_id AND metadata->>'endpoint' IN (
        'chat/summarize','chat/extract-decision','chat/classify-excavation','chat/amora-profile'
      ))
      OR (
        user_id = p_user_id
        AND interaction_type = 'chat_turn'
        AND metadata->>'visibility' IS NULL
      ));

  UPDATE public.amora_request_claims
  SET message_id = NULL, updated_at = now()
  WHERE message_id = ANY(v_message_ids);

  DELETE FROM public.chat_feedback
  WHERE message_id = ANY(v_message_ids::text[]) OR user_id = p_user_id;
  DELETE FROM public.chat_summaries WHERE couple_id = p_couple_id AND visibility::text = p_visibility;
  DELETE FROM public.decision_nodes WHERE couple_id = p_couple_id AND visibility::text = p_visibility;
  DELETE FROM public.amora_couple_profiles WHERE couple_id = p_couple_id AND visibility::text = p_visibility;
  DELETE FROM public.chat_messages WHERE couple_id = p_couple_id AND visibility::text = p_visibility;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.profiles
  SET private_chat_cleared_at = GREATEST(
        COALESCE(private_chat_cleared_at, '-infinity'::timestamptz),
        now()
      ),
      private_chat_deleting_at = NULL
  WHERE id = p_user_id;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_private_amora_data(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_private_amora_data(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_private_amora_data(uuid, uuid, text) TO service_role;

-- Reset/account-delete use the same atomic leave primitive. It locks both the
-- profile and actual couple slot, clears role-private data before freeing the
-- slot, tombstones the departing author's shared messages, and detaches the
-- profile in one transaction. Stale partial memberships are detached without
-- touching the replacement member's role-private data.
CREATE OR REPLACE FUNCTION public.leave_amora_couple_safely(
  p_user_id uuid,
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_role text;
  v_account_deleting_at timestamptz;
  v_membership_resetting_at timestamptz;
  v_bride_id uuid;
  v_groom_id uuid;
  v_shared_resetting_at timestamptz;
  v_shared_resetting_user_id uuid;
  v_slot_owned boolean := false;
  v_has_partner boolean := false;
  v_visibility text;
BEGIN
  IF p_mode NOT IN ('reset', 'account_delete') THEN
    RAISE EXCEPTION 'invalid membership leave mode' USING ERRCODE = '22023';
  END IF;

  SELECT couple_id, role::text, account_deleting_at, amora_membership_resetting_at
  INTO v_couple_id, v_role, v_account_deleting_at, v_membership_resetting_at
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.chat_messages
    SET sender_id = NULL,
        content = '[연결을 초기화한 사용자가 삭제한 메시지입니다.]',
        metadata = jsonb_build_object('membership_reset', true)
    WHERE sender_id = p_user_id AND visibility::text = 'shared';
    DELETE FROM public.chat_feedback WHERE user_id = p_user_id;
    DELETE FROM public.search_logs WHERE user_id = p_user_id;
    DELETE FROM public.congratulatory_money WHERE owner_user_id = p_user_id;
    PERFORM public.redact_user_ai_data(p_user_id);
    RETURN jsonb_build_object('profile_found', false, 'left_couple', false);
  END IF;
  IF p_mode = 'account_delete' AND v_account_deleting_at IS NULL THEN
    RAISE EXCEPTION 'account deletion lifecycle marker is required' USING ERRCODE = '55000';
  END IF;
  IF p_mode = 'reset' AND v_account_deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'account deletion is already in progress' USING ERRCODE = '55000';
  END IF;
  IF p_mode = 'reset' AND v_membership_resetting_at IS NULL THEN
    RAISE EXCEPTION 'membership reset lifecycle marker is required' USING ERRCODE = '55000';
  END IF;

  -- User-owned shared rows are safe to clean even for legacy detached/stale
  -- profiles; never touch role-private rows until actual slot ownership is known.
  UPDATE public.chat_messages
  SET sender_id = NULL,
      content = '[연결을 초기화한 사용자가 삭제한 메시지입니다.]',
      metadata = jsonb_build_object('membership_reset', true)
  WHERE sender_id = p_user_id
    AND visibility::text = 'shared';
  DELETE FROM public.chat_feedback WHERE user_id = p_user_id;
  DELETE FROM public.search_logs WHERE user_id = p_user_id;
  DELETE FROM public.congratulatory_money WHERE owner_user_id = p_user_id;

  IF v_couple_id IS NULL THEN
    UPDATE public.profiles
    SET onboarding_completed = false,
        onboarding_step = 1,
        shared_chat_cleared_at = NULL,
        private_chat_cleared_at = now(),
        private_chat_deleting_at = NULL,
        amora_membership_resetting_at = NULL
    WHERE id = p_user_id;
    PERFORM public.redact_user_ai_data(p_user_id);
    RETURN jsonb_build_object('profile_found', true, 'left_couple', false);
  END IF;

  SELECT bride_id, groom_id, amora_shared_resetting_at, amora_shared_resetting_user_id
  INTO v_bride_id, v_groom_id, v_shared_resetting_at, v_shared_resetting_user_id
  FROM public.couples
  WHERE id = v_couple_id
  FOR UPDATE;

  IF FOUND THEN
    v_slot_owned := COALESCE(
      (v_role = 'bride' AND v_bride_id = p_user_id)
        OR (v_role = 'groom' AND v_groom_id = p_user_id),
      false
    );
  END IF;

  IF NOT v_slot_owned THEN
    UPDATE public.couples
    SET amora_shared_resetting_at = NULL,
        amora_shared_resetting_user_id = NULL,
        updated_at = now()
    WHERE id = v_couple_id
      AND amora_shared_resetting_user_id = p_user_id;
    UPDATE public.profiles
    SET couple_id = NULL,
        onboarding_completed = false,
        onboarding_step = 1,
        shared_chat_cleared_at = NULL,
        private_chat_cleared_at = now(),
        private_chat_deleting_at = NULL,
        amora_membership_resetting_at = NULL
    WHERE id = p_user_id;
    PERFORM public.redact_user_ai_data(p_user_id);
    RETURN jsonb_build_object(
      'profile_found', true,
      'left_couple', false,
      'stale_membership_repaired', true
    );
  END IF;

  IF v_shared_resetting_at IS NULL
    OR v_shared_resetting_user_id IS DISTINCT FROM p_user_id
  THEN
    RAISE EXCEPTION 'couple lifecycle marker is required' USING ERRCODE = '55000';
  END IF;

  v_visibility := CASE WHEN v_role = 'bride' THEN 'bride_private' ELSE 'groom_private' END;
  PERFORM public.delete_private_amora_data(p_user_id, v_couple_id, v_visibility);

  v_has_partner := (v_role = 'bride' AND v_groom_id IS NOT NULL)
    OR (v_role = 'groom' AND v_bride_id IS NOT NULL);

  IF v_has_partner THEN
    UPDATE public.couples
    SET bride_id = CASE WHEN v_role = 'bride' THEN NULL ELSE bride_id END,
        groom_id = CASE WHEN v_role = 'groom' THEN NULL ELSE groom_id END,
        amora_shared_resetting_at = NULL,
        amora_shared_resetting_user_id = NULL,
        amora_replacement_blocked_at = now(),
        invite_code = NULL,
        updated_at = now()
    WHERE id = v_couple_id;

    UPDATE public.profiles
    SET couple_id = NULL,
        onboarding_completed = false,
        onboarding_step = 1,
        shared_chat_cleared_at = NULL,
        private_chat_cleared_at = now(),
        private_chat_deleting_at = NULL,
        amora_membership_resetting_at = NULL
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET couple_id = NULL,
        onboarding_completed = false,
        onboarding_step = 1,
        shared_chat_cleared_at = NULL,
        private_chat_cleared_at = now(),
        private_chat_deleting_at = NULL,
        amora_membership_resetting_at = NULL
    WHERE id = p_user_id;
    DELETE FROM public.couples WHERE id = v_couple_id;
  END IF;

  PERFORM public.redact_user_ai_data(p_user_id);

  RETURN jsonb_build_object(
    'profile_found', true,
    'left_couple', true,
    'couple_deleted', NOT v_has_partner
  );
END;
$$;
REVOKE ALL ON FUNCTION public.leave_amora_couple_safely(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_amora_couple_safely(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_amora_couple_safely(uuid, text) TO service_role;

-- Account deletion removes all direct linkage and raw payload while retaining
-- only the minimal model/cost fields needed for aggregate spend accounting.
CREATE OR REPLACE FUNCTION public.redact_user_ai_data(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redacted integer := 0;
BEGIN
  UPDATE public.chat_messages AS message
  SET metadata = COALESCE(message.metadata, '{}'::jsonb) - 'senderName'
  WHERE message.id IN (
    SELECT log.message_id
    FROM public.ai_interactions_log AS log
    WHERE log.user_id = p_user_id AND log.message_id IS NOT NULL
  );

  UPDATE public.ai_interactions_log
  SET user_id = NULL,
      couple_id = NULL,
      session_id = NULL,
      message_id = NULL,
      user_input = NULL,
      ai_output = NULL,
      tool_input = NULL,
      tool_output = NULL,
      error_message = NULL,
      metadata = jsonb_strip_nulls(jsonb_build_object(
        'visibility', metadata->>'visibility',
        'endpoint', metadata->>'endpoint',
        'source', metadata->>'source',
        'quota_class', metadata->>'quota_class',
        'request_usage', metadata->'request_usage',
        'account_deleted', true,
        'payload_redacted_at', now()
      ))
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_redacted = ROW_COUNT;
  RETURN v_redacted;
END;
$$;
REVOKE ALL ON FUNCTION public.redact_user_ai_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redact_user_ai_data(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_user_ai_data(uuid) TO service_role;

-- Budget total and per-category allocations are one logical mutation. Lock the
-- active member profile and journey, then commit both fields together.
CREATE OR REPLACE FUNCTION public.apply_amora_budget_plan(
  p_user_id uuid,
  p_couple_id uuid,
  p_total_budget numeric,
  p_progress_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress jsonb;
  v_total_budget numeric;
BEGIN
  IF p_total_budget IS NULL OR p_total_budget < 0
    OR jsonb_typeof(COALESCE(p_progress_patch, '{}'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid budget plan arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles p
  WHERE p.id = p_user_id
    AND p.couple_id = p_couple_id
    AND p.account_deleting_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.couples c
      WHERE c.id = p_couple_id
        AND (
          (p.role::text = 'bride' AND c.bride_id = p_user_id)
          OR (p.role::text = 'groom' AND c.groom_id = p_user_id)
        )
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget mutation ownership verification failed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.wedding_journeys
  SET total_budget = p_total_budget,
      progress = COALESCE(progress, '{}'::jsonb) || COALESCE(p_progress_patch, '{}'::jsonb),
      updated_at = now()
  WHERE couple_id = p_couple_id
  RETURNING total_budget, progress INTO v_total_budget, v_progress;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wedding journey not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('total_budget', v_total_budget, 'progress', v_progress);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_amora_budget_plan(uuid, uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_amora_budget_plan(uuid, uuid, numeric, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_amora_budget_plan(uuid, uuid, numeric, jsonb) TO service_role;

-- Feedback is inserted behind the same profile/couple lock as deletion. The
-- target AI message is re-authorized in SQL and its content is not duplicated.
CREATE OR REPLACE FUNCTION public.save_amora_feedback(
  p_user_id uuid,
  p_message_id uuid,
  p_rating text,
  p_correction text,
  p_category text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_role text;
  v_visibility text;
  v_feedback_id uuid;
BEGIN
  IF p_rating NOT IN ('good', 'bad')
    OR length(COALESCE(p_correction, '')) > 1000
    OR length(COALESCE(p_category, '')) > 80
  THEN
    RAISE EXCEPTION 'invalid feedback arguments' USING ERRCODE = '22023';
  END IF;

  SELECT profile.couple_id, profile.role::text
  INTO v_couple_id, v_role
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_user_id
    AND profile.account_deleting_at IS NULL
    AND (
      (profile.role::text = 'bride' AND couple.bride_id = p_user_id)
      OR (profile.role::text = 'groom' AND couple.groom_id = p_user_id)
    )
  FOR UPDATE OF profile, couple;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback ownership verification failed' USING ERRCODE = '42501';
  END IF;

  SELECT visibility::text INTO v_visibility
  FROM public.chat_messages
  WHERE id = p_message_id
    AND couple_id = v_couple_id
    AND sender_type = 'ai'
  FOR SHARE;
  IF NOT FOUND OR (
    v_visibility <> 'shared'
    AND v_visibility <> CASE WHEN v_role = 'bride' THEN 'bride_private' ELSE 'groom_private' END
  ) THEN
    RAISE EXCEPTION 'feedback target verification failed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.chat_feedback (
    user_id, couple_id, message_id, rating, correction, category, message_content
  ) VALUES (
    p_user_id, v_couple_id, p_message_id::text, p_rating,
    NULLIF(btrim(p_correction), ''), NULLIF(btrim(p_category), ''), NULL
  )
  RETURNING id INTO v_feedback_id;
  RETURN v_feedback_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_amora_feedback(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_amora_feedback(uuid, uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_amora_feedback(uuid, uuid, text, text, text) TO service_role;

-- Reverse invariant repair: a couple slot is valid only when the referenced
-- profile points back to the same couple with the same role. Empty/invalid role
-- scopes and private messages authored by a user whose current membership no
-- longer matches are privacy-tainted and are purged before slots are reused.
DROP TABLE IF EXISTS pg_temp.amora_orphan_couple_slots;
CREATE TEMP TABLE amora_orphan_couple_slots ON COMMIT DROP AS
SELECT couple.id AS couple_id, couple.bride_id AS user_id, 'bride'::text AS role,
       'bride_private'::text AS visibility
FROM public.couples AS couple
LEFT JOIN public.profiles AS profile
  ON profile.id = couple.bride_id
 AND profile.couple_id = couple.id
 AND profile.role::text = 'bride'
 AND profile.account_deleting_at IS NULL
WHERE couple.bride_id IS NOT NULL AND profile.id IS NULL
UNION ALL
SELECT couple.id, couple.groom_id, 'groom'::text, 'groom_private'::text
FROM public.couples AS couple
LEFT JOIN public.profiles AS profile
  ON profile.id = couple.groom_id
 AND profile.couple_id = couple.id
 AND profile.role::text = 'groom'
 AND profile.account_deleting_at IS NULL
WHERE couple.groom_id IS NOT NULL AND profile.id IS NULL;

-- Snapshot forward profile→slot inconsistencies before clearing orphan slots or
-- deleting empty couples. Later FK actions can otherwise erase the evidence
-- needed to reset onboarding/private state safely.
DROP TABLE IF EXISTS pg_temp.amora_inconsistent_memberships;
CREATE TEMP TABLE amora_inconsistent_memberships ON COMMIT DROP AS
SELECT
  profile.id AS user_id,
  profile.couple_id,
  CASE
    WHEN profile.role::text = 'bride' THEN 'bride_private'
    WHEN profile.role::text = 'groom' THEN 'groom_private'
    ELSE NULL
  END AS visibility
FROM public.profiles AS profile
LEFT JOIN public.couples AS couple ON couple.id = profile.couple_id
WHERE profile.couple_id IS NOT NULL
  AND (
    profile.account_deleting_at IS NOT NULL
    OR NOT COALESCE((
      (profile.role::text = 'bride' AND couple.bride_id = profile.id)
      OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
    ), false)
  );

DROP TABLE IF EXISTS pg_temp.amora_tainted_private_scopes;
CREATE TEMP TABLE amora_tainted_private_scopes ON COMMIT DROP AS
WITH missing_private_scopes AS (
  SELECT couple.id AS couple_id, 'bride_private'::text AS visibility
  FROM public.couples AS couple
  LEFT JOIN public.profiles AS profile
    ON profile.id = couple.bride_id
   AND profile.couple_id = couple.id
   AND profile.role::text = 'bride'
   AND profile.account_deleting_at IS NULL
  WHERE profile.id IS NULL
  UNION ALL
  SELECT couple.id, 'groom_private'::text
  FROM public.couples AS couple
  LEFT JOIN public.profiles AS profile
    ON profile.id = couple.groom_id
   AND profile.couple_id = couple.id
   AND profile.role::text = 'groom'
   AND profile.account_deleting_at IS NULL
  WHERE profile.id IS NULL
)
SELECT scope.couple_id, scope.visibility
FROM missing_private_scopes AS scope
WHERE EXISTS (
    SELECT 1 FROM public.chat_messages AS message
    WHERE message.couple_id = scope.couple_id
      AND message.visibility::text = scope.visibility
  )
  OR EXISTS (
    SELECT 1 FROM public.ai_interactions_log AS log
    WHERE log.couple_id = scope.couple_id
      AND log.metadata->>'visibility' = scope.visibility
  )
  OR EXISTS (
    SELECT 1 FROM public.chat_summaries AS summary
    WHERE summary.couple_id = scope.couple_id
      AND summary.visibility::text = scope.visibility
  )
  OR EXISTS (
    SELECT 1 FROM public.decision_nodes AS decision
    WHERE decision.couple_id = scope.couple_id
      AND decision.visibility::text = scope.visibility
  )
  OR EXISTS (
    SELECT 1 FROM public.amora_couple_profiles AS memory
    WHERE memory.couple_id = scope.couple_id
      AND memory.visibility::text = scope.visibility
  )
UNION
SELECT DISTINCT message.couple_id, message.visibility::text
FROM public.chat_messages AS message
WHERE message.sender_id IS NOT NULL
  AND message.visibility::text IN ('bride_private', 'groom_private')
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    JOIN public.couples AS couple ON couple.id = profile.couple_id
    WHERE profile.id = message.sender_id
      AND profile.couple_id = message.couple_id
      AND profile.account_deleting_at IS NULL
      AND (
        (message.visibility::text = 'bride_private' AND profile.role::text = 'bride' AND couple.bride_id = profile.id)
        OR (message.visibility::text = 'groom_private' AND profile.role::text = 'groom' AND couple.groom_id = profile.id)
      )
  )
UNION
SELECT DISTINCT message.couple_id, message.visibility::text
FROM public.chat_messages AS message
WHERE message.sender_id IS NULL
  AND message.visibility::text IN ('bride_private', 'groom_private')
  AND (
    message.role = 'user'
    OR message.sender_type IN ('bride', 'groom')
    OR message.sender_role IN ('bride', 'groom')
  );

-- Never silently choose privacy versus valid replacement data during deploy.
-- Dirty legacy scopes require a production inventory, export/backup and an
-- operator-approved repair before this migration may proceed.
DO $$
DECLARE
  v_orphan_count bigint;
  v_inconsistent_count bigint;
  v_private_scope_count bigint;
  v_stale_shared_count bigint;
  v_legacy_null_sender_shared_count bigint;
  v_legacy_payload_count bigint;
  v_detached_raw_audit_count bigint;
  v_private_clear_artifact_count bigint;
  v_unproven_private_derived_count bigint;
  v_orphan_feedback_count bigint;
BEGIN
  SELECT count(*) INTO v_orphan_count FROM pg_temp.amora_orphan_couple_slots;
  SELECT count(*) INTO v_inconsistent_count FROM pg_temp.amora_inconsistent_memberships;
  SELECT count(*) INTO v_private_scope_count FROM pg_temp.amora_tainted_private_scopes;
  SELECT count(*) INTO v_stale_shared_count
  FROM public.chat_messages AS message
  LEFT JOIN public.couples AS couple ON couple.id = message.couple_id
  WHERE message.visibility::text = 'shared'
    AND message.sender_id IS NOT NULL
    AND message.sender_id IS DISTINCT FROM couple.bride_id
    AND message.sender_id IS DISTINCT FROM couple.groom_id;

  SELECT count(*) INTO v_legacy_null_sender_shared_count
  FROM public.chat_messages AS message
  WHERE message.visibility::text = 'shared'
    AND message.sender_id IS NULL
    AND (
      message.role = 'user'
      OR message.sender_type IN ('bride', 'groom')
      OR message.sender_role IN ('bride', 'groom')
    )
    AND NOT (
      COALESCE(message.metadata->>'membership_reset', 'false') = 'true'
      OR COALESCE(message.metadata->>'orphan_membership_repaired', 'false') = 'true'
      OR COALESCE(message.metadata->>'membership_repaired', 'false') = 'true'
    );

  SELECT count(*) INTO v_legacy_payload_count
  FROM public.ai_interactions_log AS log
  WHERE log.interaction_type = 'chat_turn'
    AND log.metadata->>'visibility' IS NULL
    AND (
      log.user_input IS NOT NULL OR log.ai_output IS NOT NULL
      OR log.tool_input IS NOT NULL OR log.tool_output IS NOT NULL
    );

  SELECT count(*) INTO v_detached_raw_audit_count
  FROM public.ai_interactions_log AS log
  WHERE log.interaction_type = 'chat_turn'
    AND log.user_id IS NULL
    AND log.couple_id IS NOT NULL
    AND (
      (log.user_input IS NOT NULL AND log.user_input !~ '^\[redacted_')
      OR (log.ai_output IS NOT NULL AND log.ai_output !~ '^\[redacted_')
      OR log.tool_input IS NOT NULL
      OR log.tool_output IS NOT NULL
      OR (log.error_message IS NOT NULL AND log.error_message !~ '^\[redacted_')
    );

  SELECT
    (SELECT count(*)
     FROM public.ai_interactions_log AS log
     JOIN public.profiles AS profile ON profile.couple_id = log.couple_id
     WHERE profile.private_chat_cleared_at IS NOT NULL
       AND (
         log.metadata->>'visibility' = CASE
           WHEN profile.role::text = 'bride' THEN 'bride_private'
           WHEN profile.role::text = 'groom' THEN 'groom_private'
           ELSE NULL
         END
         OR (
           log.user_id = profile.id
           AND log.metadata->>'endpoint' IN (
             'chat/summarize', 'chat/extract-decision',
             'chat/classify-excavation', 'chat/amora-profile'
           )
         )
       ))
    + (SELECT count(*)
       FROM public.chat_summaries AS summary
       JOIN public.profiles AS profile ON profile.couple_id = summary.couple_id
       WHERE profile.private_chat_cleared_at IS NOT NULL
         AND summary.visibility::text = CASE
           WHEN profile.role::text = 'bride' THEN 'bride_private'
           WHEN profile.role::text = 'groom' THEN 'groom_private'
           ELSE NULL
         END)
    + (SELECT count(*)
       FROM public.decision_nodes AS decision
       JOIN public.profiles AS profile ON profile.couple_id = decision.couple_id
       WHERE profile.private_chat_cleared_at IS NOT NULL
         AND decision.visibility::text = CASE
           WHEN profile.role::text = 'bride' THEN 'bride_private'
           WHEN profile.role::text = 'groom' THEN 'groom_private'
           ELSE NULL
         END)
    + (SELECT count(*)
       FROM public.amora_couple_profiles AS memory
       JOIN public.profiles AS profile ON profile.couple_id = memory.couple_id
       WHERE profile.private_chat_cleared_at IS NOT NULL
         AND memory.visibility::text = CASE
           WHEN profile.role::text = 'bride' THEN 'bride_private'
           WHEN profile.role::text = 'groom' THEN 'groom_private'
           ELSE NULL
         END)
  INTO v_private_clear_artifact_count;

  -- Legacy decision/profile rows have no author or membership-generation
  -- provenance. Even a row that matches today's slot may belong to a former
  -- same-role partner, so production must inventory/export and explicitly
  -- remediate every private derived artifact before this migration proceeds.
  SELECT
    (SELECT count(*) FROM public.chat_summaries
     WHERE visibility::text IN ('bride_private', 'groom_private'))
    + (SELECT count(*) FROM public.decision_nodes
       WHERE visibility::text IN ('bride_private', 'groom_private'))
    + (SELECT count(*) FROM public.amora_couple_profiles
       WHERE visibility::text IN ('bride_private', 'groom_private'))
  INTO v_unproven_private_derived_count;

  SELECT count(*) INTO v_orphan_feedback_count
  FROM public.chat_feedback AS feedback
  WHERE feedback.message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_messages AS message
      WHERE message.id::text = feedback.message_id
    );

  IF v_orphan_count + v_inconsistent_count + v_private_scope_count
       + v_stale_shared_count + v_legacy_null_sender_shared_count
       + v_legacy_payload_count + v_detached_raw_audit_count
       + v_private_clear_artifact_count + v_unproven_private_derived_count
       + v_orphan_feedback_count > 0 THEN
    RAISE EXCEPTION
      'AMORA_LEGACY_REPAIR_REQUIRED orphan=% inconsistent=% private_scopes=% stale_shared=% legacy_null_sender_shared=% legacy_payloads=% detached_raw_audits=% private_clear_artifacts=% unproven_private_derived=% orphan_feedback=%',
      v_orphan_count, v_inconsistent_count, v_private_scope_count,
      v_stale_shared_count, v_legacy_null_sender_shared_count,
      v_legacy_payload_count, v_detached_raw_audit_count,
      v_private_clear_artifact_count, v_unproven_private_derived_count,
      v_orphan_feedback_count
      USING ERRCODE = '55000';
  END IF;
END;
$$;

UPDATE public.ai_interactions_log AS log
SET user_input = CASE WHEN log.user_input IS NULL THEN NULL ELSE '[redacted_tainted_private_scope]' END,
    ai_output = CASE WHEN log.ai_output IS NULL THEN NULL ELSE '[redacted_tainted_private_scope]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN log.error_message IS NULL THEN NULL ELSE '[redacted_tainted_private_scope]' END,
    message_id = NULL,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', log.metadata->>'visibility',
      'endpoint', log.metadata->>'endpoint',
      'source', log.metadata->>'source',
      'quota_class', log.metadata->>'quota_class',
      'request_usage', log.metadata->'request_usage',
      'tainted_private_scope_redacted_at', now()
    ))
FROM pg_temp.amora_tainted_private_scopes AS scope
WHERE log.couple_id = scope.couple_id
  AND log.metadata->>'visibility' = scope.visibility;

UPDATE public.amora_request_claims AS claim
SET message_id = NULL, updated_at = now()
WHERE claim.message_id IN (
  SELECT message.id
  FROM public.chat_messages AS message
  JOIN pg_temp.amora_tainted_private_scopes AS scope
    ON scope.couple_id = message.couple_id
   AND scope.visibility = message.visibility::text
);
DELETE FROM public.chat_feedback AS feedback
WHERE feedback.message_id IN (
  SELECT message.id::text
  FROM public.chat_messages AS message
  JOIN pg_temp.amora_tainted_private_scopes AS scope
    ON scope.couple_id = message.couple_id
   AND scope.visibility = message.visibility::text
);
DELETE FROM public.chat_summaries AS summary
USING pg_temp.amora_tainted_private_scopes AS scope
WHERE summary.couple_id = scope.couple_id AND summary.visibility::text = scope.visibility;
DELETE FROM public.decision_nodes AS decision
USING pg_temp.amora_tainted_private_scopes AS scope
WHERE decision.couple_id = scope.couple_id AND decision.visibility::text = scope.visibility;
DELETE FROM public.amora_couple_profiles AS memory
USING pg_temp.amora_tainted_private_scopes AS scope
WHERE memory.couple_id = scope.couple_id AND memory.visibility::text = scope.visibility;
DELETE FROM public.chat_messages AS message
USING pg_temp.amora_tainted_private_scopes AS scope
WHERE message.couple_id = scope.couple_id AND message.visibility::text = scope.visibility;

-- An orphan slot user may now be a valid member of another couple. Redact only
-- the old (user, couple) audit scope and remove their name from audit-linked AI
-- shared messages; never call the user-global redactor here.
UPDATE public.chat_messages AS message
SET metadata = COALESCE(message.metadata, '{}'::jsonb) - 'senderName'
WHERE message.id IN (
  SELECT log.message_id
  FROM public.ai_interactions_log AS log
  JOIN pg_temp.amora_orphan_couple_slots AS orphan
    ON orphan.user_id = log.user_id AND orphan.couple_id = log.couple_id
  WHERE log.message_id IS NOT NULL
);

-- Redact snapshotted profile->slot audit linkage before an empty-couple DELETE
-- can SET log.couple_id NULL and erase the join evidence.
UPDATE public.ai_interactions_log AS log
SET user_id = NULL,
    couple_id = NULL,
    session_id = NULL,
    message_id = NULL,
    user_input = NULL,
    ai_output = NULL,
    tool_input = NULL,
    tool_output = NULL,
    error_message = NULL,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', log.metadata->>'visibility',
      'endpoint', log.metadata->>'endpoint',
      'source', log.metadata->>'source',
      'quota_class', log.metadata->>'quota_class',
      'request_usage', log.metadata->'request_usage',
      'pre_delete_inconsistent_membership_redacted_at', now()
    ))
FROM pg_temp.amora_inconsistent_memberships AS stale
WHERE log.user_id = stale.user_id AND log.couple_id = stale.couple_id;

UPDATE public.ai_interactions_log AS log
SET user_id = NULL,
    couple_id = NULL,
    session_id = NULL,
    message_id = NULL,
    user_input = NULL,
    ai_output = NULL,
    tool_input = NULL,
    tool_output = NULL,
    error_message = NULL,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', log.metadata->>'visibility',
      'endpoint', log.metadata->>'endpoint',
      'source', log.metadata->>'source',
      'quota_class', log.metadata->>'quota_class',
      'request_usage', log.metadata->'request_usage',
      'orphan_membership_redacted_at', now()
    ))
FROM pg_temp.amora_orphan_couple_slots AS orphan
WHERE log.user_id = orphan.user_id AND log.couple_id = orphan.couple_id;

UPDATE public.chat_messages AS message
SET sender_id = NULL,
    content = '[잘못된 연결에서 삭제된 메시지입니다.]',
    metadata = jsonb_build_object('orphan_membership_repaired', true)
FROM pg_temp.amora_orphan_couple_slots AS orphan
WHERE message.couple_id = orphan.couple_id
  AND message.sender_id = orphan.user_id
  AND message.visibility::text = 'shared';

UPDATE public.couples AS couple
SET bride_id = NULL, updated_at = now()
FROM pg_temp.amora_orphan_couple_slots AS orphan
WHERE orphan.role = 'bride' AND couple.id = orphan.couple_id AND couple.bride_id = orphan.user_id;
UPDATE public.couples AS couple
SET groom_id = NULL, updated_at = now()
FROM pg_temp.amora_orphan_couple_slots AS orphan
WHERE orphan.role = 'groom' AND couple.id = orphan.couple_id AND couple.groom_id = orphan.user_id;

-- Empty legacy couples are retained. They can own invitations, journeys, money
-- and other non-Amora records whose provenance cannot be inferred here.

-- Repair the profile↔couple-slot splits snapshotted before slot cleanup.
-- Ambiguous role-private data is removed rather than guessed and reassigned.

UPDATE public.chat_messages AS message
SET metadata = COALESCE(message.metadata, '{}'::jsonb) - 'senderName'
WHERE message.visibility::text = 'shared'
  AND message.id IN (
    SELECT log.message_id
    FROM public.ai_interactions_log AS log
    JOIN pg_temp.amora_inconsistent_memberships AS stale
      ON stale.user_id = log.user_id AND stale.couple_id = log.couple_id
    WHERE log.message_id IS NOT NULL
  );

UPDATE public.ai_interactions_log AS log
SET user_id = NULL,
    couple_id = NULL,
    session_id = NULL,
    user_input = CASE WHEN log.user_input IS NULL THEN NULL ELSE '[redacted_inconsistent_membership]' END,
    ai_output = CASE WHEN log.ai_output IS NULL THEN NULL ELSE '[redacted_inconsistent_membership]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN log.error_message IS NULL THEN NULL ELSE '[redacted_inconsistent_membership]' END,
    message_id = NULL,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', log.metadata->>'visibility',
      'endpoint', log.metadata->>'endpoint',
      'source', log.metadata->>'source',
      'quota_class', log.metadata->>'quota_class',
      'request_usage', log.metadata->'request_usage',
      'inconsistent_membership_redacted_at', now()
    ))
FROM pg_temp.amora_inconsistent_memberships AS stale
WHERE log.couple_id = stale.couple_id
  AND log.user_id = stale.user_id;

UPDATE public.ai_interactions_log AS log
SET user_id = NULL,
    couple_id = NULL,
    session_id = NULL,
    user_input = CASE WHEN log.user_input IS NULL THEN NULL ELSE '[redacted_inconsistent_private_scope]' END,
    ai_output = CASE WHEN log.ai_output IS NULL THEN NULL ELSE '[redacted_inconsistent_private_scope]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN log.error_message IS NULL THEN NULL ELSE '[redacted_inconsistent_private_scope]' END,
    message_id = NULL,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', log.metadata->>'visibility',
      'endpoint', log.metadata->>'endpoint',
      'source', log.metadata->>'source',
      'quota_class', log.metadata->>'quota_class',
      'request_usage', log.metadata->'request_usage',
      'inconsistent_private_scope_redacted_at', now()
    ))
FROM pg_temp.amora_inconsistent_memberships AS stale
WHERE stale.visibility IS NOT NULL
  AND log.couple_id = stale.couple_id
  AND log.metadata->>'visibility' = stale.visibility;

UPDATE public.amora_request_claims AS claim
SET message_id = NULL, updated_at = now()
WHERE claim.message_id IN (
  SELECT message.id
  FROM public.chat_messages AS message
  JOIN pg_temp.amora_inconsistent_memberships AS stale
    ON stale.couple_id = message.couple_id
   AND stale.visibility = message.visibility::text
);

DELETE FROM public.chat_feedback AS feedback
WHERE feedback.message_id IN (
  SELECT message.id::text
  FROM public.chat_messages AS message
  JOIN pg_temp.amora_inconsistent_memberships AS stale
    ON stale.couple_id = message.couple_id
   AND stale.visibility = message.visibility::text
)
OR feedback.user_id IN (SELECT user_id FROM pg_temp.amora_inconsistent_memberships);

DELETE FROM public.chat_summaries AS summary
USING pg_temp.amora_inconsistent_memberships AS stale
WHERE summary.couple_id = stale.couple_id
  AND summary.visibility::text = stale.visibility;
DELETE FROM public.decision_nodes AS decision
USING pg_temp.amora_inconsistent_memberships AS stale
WHERE decision.couple_id = stale.couple_id
  AND decision.visibility::text = stale.visibility;
DELETE FROM public.amora_couple_profiles AS memory
USING pg_temp.amora_inconsistent_memberships AS stale
WHERE memory.couple_id = stale.couple_id
  AND memory.visibility::text = stale.visibility;
DELETE FROM public.chat_messages AS message
USING pg_temp.amora_inconsistent_memberships AS stale
WHERE message.couple_id = stale.couple_id
  AND message.visibility::text = stale.visibility;

UPDATE public.chat_messages AS message
SET sender_id = NULL,
    content = '[연결이 정리된 사용자가 삭제한 메시지입니다.]',
    metadata = jsonb_build_object('membership_repaired', true)
WHERE message.sender_id IN (SELECT user_id FROM pg_temp.amora_inconsistent_memberships)
  AND message.visibility::text = 'shared';
DELETE FROM public.search_logs
WHERE user_id IN (SELECT user_id FROM pg_temp.amora_inconsistent_memberships);

UPDATE public.profiles AS profile
SET couple_id = NULL,
    onboarding_completed = false,
    onboarding_step = 1,
    private_chat_cleared_at = now()
WHERE profile.id IN (SELECT user_id FROM pg_temp.amora_inconsistent_memberships);

-- One-time repair for payloads left by legacy private-clear and visibility-less
-- audit paths. Safe cost-classification metadata is intentionally preserved.
UPDATE public.ai_interactions_log AS log
SET user_id = NULL,
    couple_id = NULL,
    session_id = NULL,
    message_id = NULL,
    user_input = CASE WHEN log.user_input IS NULL THEN NULL ELSE '[redacted_legacy_payload]' END,
    ai_output = CASE WHEN log.ai_output IS NULL THEN NULL ELSE '[redacted_legacy_payload]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN log.error_message IS NULL THEN NULL ELSE '[redacted_legacy_payload]' END,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', log.metadata->>'visibility',
      'endpoint', log.metadata->>'endpoint',
      'source', log.metadata->>'source',
      'quota_class', log.metadata->>'quota_class',
      'request_usage', log.metadata->'request_usage',
      'legacy_payload_redacted_at', now()
    ))
WHERE log.interaction_type = 'chat_turn'
  AND log.metadata->>'visibility' IS NULL
  AND (
    log.user_input IS NOT NULL OR log.ai_output IS NOT NULL
    OR log.tool_input IS NOT NULL OR log.tool_output IS NOT NULL
  );

UPDATE public.ai_interactions_log AS log
SET user_input = CASE WHEN log.user_input IS NULL THEN NULL ELSE '[redacted_legacy_private_clear]' END,
    ai_output = CASE WHEN log.ai_output IS NULL THEN NULL ELSE '[redacted_legacy_private_clear]' END,
    tool_input = NULL,
    tool_output = NULL,
    error_message = CASE WHEN log.error_message IS NULL THEN NULL ELSE '[redacted_legacy_private_clear]' END,
    message_id = NULL,
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'visibility', log.metadata->>'visibility',
      'endpoint', log.metadata->>'endpoint',
      'source', log.metadata->>'source',
      'quota_class', log.metadata->>'quota_class',
      'request_usage', log.metadata->'request_usage',
      'legacy_private_payload_redacted_at', now()
    ))
FROM public.profiles AS profile
WHERE profile.private_chat_cleared_at IS NOT NULL
  AND log.couple_id = profile.couple_id
  AND (
    log.metadata->>'visibility' = CASE
      WHEN profile.role::text = 'bride' THEN 'bride_private'
      WHEN profile.role::text = 'groom' THEN 'groom_private'
      ELSE NULL
    END
    OR (
      log.user_id = profile.id
      AND log.metadata->>'endpoint' IN (
        'chat/summarize', 'chat/extract-decision',
        'chat/classify-excavation', 'chat/amora-profile'
      )
    )
  );

DELETE FROM public.chat_summaries AS summary
USING public.profiles AS profile
WHERE profile.private_chat_cleared_at IS NOT NULL
  AND summary.couple_id = profile.couple_id
  AND summary.visibility::text = CASE
    WHEN profile.role::text = 'bride' THEN 'bride_private'
    WHEN profile.role::text = 'groom' THEN 'groom_private'
    ELSE NULL
  END;

DELETE FROM public.decision_nodes AS decision
USING public.profiles AS profile
WHERE profile.private_chat_cleared_at IS NOT NULL
  AND decision.couple_id = profile.couple_id
  AND decision.visibility::text = CASE
    WHEN profile.role::text = 'bride' THEN 'bride_private'
    WHEN profile.role::text = 'groom' THEN 'groom_private'
    ELSE NULL
  END;

DELETE FROM public.amora_couple_profiles AS memory
USING public.profiles AS profile
WHERE profile.private_chat_cleared_at IS NOT NULL
  AND memory.couple_id = profile.couple_id
  AND memory.visibility::text = CASE
    WHEN profile.role::text = 'bride' THEN 'bride_private'
    WHEN profile.role::text = 'groom' THEN 'groom_private'
    ELSE NULL
  END;

DELETE FROM public.chat_feedback AS feedback
WHERE feedback.message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_messages AS message
    WHERE message.id::text = feedback.message_id
  );

-- Pseudonymous tombstones contain no prompt/response and expire with the audit horizon.
CREATE OR REPLACE FUNCTION public.delete_expired_amora_request_claims()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.amora_provider_leases WHERE expires_at <= now();
  DELETE FROM public.amora_request_claims WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_expired_amora_request_claims() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_expired_amora_request_claims() TO service_role;

DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job
  WHERE jobname = 'delete-expired-amora-request-claims' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'delete-expired-amora-request-claims',
    '29 18 * * *',
    'SELECT public.delete_expired_amora_request_claims();'
  );
END;
$$;
