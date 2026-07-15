-- EXPAND PHASE: add privacy helpers, authenticated membership RPCs, durable
-- request claims, and compatibility views without removing legacy policies or grants.
-- Apply this migration before the compatible application release.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A single visibility predicate keeps SELECT/INSERT/UPDATE/DELETE semantics aligned.
CREATE OR REPLACE FUNCTION public.can_access_couple_visibility(
  p_couple_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.couples AS couple
    WHERE couple.id = p_couple_id
      AND (
        (p_visibility = 'shared'
          AND (couple.bride_id = auth.uid() OR couple.groom_id = auth.uid()))
        OR (p_visibility = 'bride_private' AND couple.bride_id = auth.uid())
        OR (p_visibility = 'groom_private' AND couple.groom_id = auth.uid())
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_couple_visibility(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_couple_visibility(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_couple_member(p_couple_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.couples AS couple
    WHERE couple.id = p_couple_id
      AND (couple.bride_id = auth.uid() OR couple.groom_id = auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_couple_member(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid)
  TO authenticated, service_role;

-- Existing production data contains grandfathered duplicate groom slots. This
-- trigger blocks only new or changed-to assignments, so legacy rows can still
-- be inspected and cleared without silently deleting customer history.
CREATE OR REPLACE FUNCTION public.guard_new_couple_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_lock_users uuid[];
  v_assignment_users uuid[];
  v_assignment_roles text[] := ARRAY['bride', 'groom'];
  v_user_id uuid;
  v_index integer;
  v_profile_couple_id uuid;
  v_profile_role text;
BEGIN
  IF NEW.bride_id IS NOT NULL AND NEW.bride_id = NEW.groom_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'COUPLE_SAME_USER_IN_BOTH_SLOTS',
      CONSTRAINT = 'couples_distinct_members_guard';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_lock_users := ARRAY[NEW.bride_id, NEW.groom_id];
    v_assignment_users := ARRAY[NEW.bride_id, NEW.groom_id];
  ELSE
    v_lock_users := ARRAY[OLD.bride_id, OLD.groom_id, NEW.bride_id, NEW.groom_id];
    v_assignment_users := ARRAY[
      CASE WHEN NEW.bride_id IS DISTINCT FROM OLD.bride_id THEN NEW.bride_id END,
      CASE WHEN NEW.groom_id IS DISTINCT FROM OLD.groom_id THEN NEW.groom_id END
    ];
  END IF;

  FOR v_user_id IN
    SELECT candidate
    FROM unnest(v_lock_users) AS lock_candidates(candidate)
    WHERE candidate IS NOT NULL
    GROUP BY candidate
    ORDER BY candidate
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hanbang:couple-membership:' || v_user_id::text,
        0
      )
    );
  END LOOP;

  FOR v_user_id IN
    SELECT candidate
    FROM unnest(v_lock_users) AS lock_candidates(candidate)
    WHERE candidate IS NOT NULL
    GROUP BY candidate
    ORDER BY candidate
  LOOP
    PERFORM profile.id
    FROM public.profiles AS profile
    WHERE profile.id = v_user_id
    FOR UPDATE;
  END LOOP;

  FOR v_index IN 1..COALESCE(array_length(v_assignment_users, 1), 0) LOOP
    v_user_id := v_assignment_users[v_index];
    CONTINUE WHEN v_user_id IS NULL;

    SELECT profile.couple_id, profile.role
      INTO v_profile_couple_id, v_profile_role
    FROM public.profiles AS profile
    WHERE profile.id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        MESSAGE = 'COUPLE_MEMBER_PROFILE_REQUIRED',
        CONSTRAINT = 'couples_member_profile_guard';
    END IF;

    IF v_profile_couple_id IS NOT NULL
       AND v_profile_couple_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'COUPLE_PROFILE_MEMBERSHIP_CONFLICT',
        CONSTRAINT = 'couples_profile_membership_guard';
    END IF;

    IF v_profile_role IS NOT NULL
       AND v_profile_role IS DISTINCT FROM v_assignment_roles[v_index] THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'COUPLE_PROFILE_ROLE_CONFLICT',
        CONSTRAINT = 'couples_profile_role_guard';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT couple.id AS couple_id, 'bride'::text AS slot_role
        FROM public.couples AS couple
        WHERE couple.bride_id = v_user_id
        UNION ALL
        SELECT couple.id AS couple_id, 'groom'::text AS slot_role
        FROM public.couples AS couple
        WHERE couple.groom_id = v_user_id
      ) AS occurrence
      WHERE occurrence.couple_id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'COUPLE_MEMBERSHIP_ALREADY_EXISTS',
        CONSTRAINT = 'couples_user_single_membership_guard';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_new_couple_membership()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_new_couple_membership ON public.couples;
CREATE TRIGGER trg_guard_new_couple_membership
  BEFORE INSERT OR UPDATE OF bride_id, groom_id ON public.couples
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_new_couple_membership();

-- Membership guards and directory predicates probe each slot independently.
-- Keep those checks index-backed as the couple table grows.
CREATE INDEX IF NOT EXISTS couples_bride_id_lookup_idx
  ON public.couples (bride_id)
  WHERE bride_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS couples_groom_id_lookup_idx
  ON public.couples (groom_id)
  WHERE groom_id IS NOT NULL;

-- Hosted Supabase installs gen_random_bytes in the extensions schema while
-- the hardened function historically searched only public. Use PostgreSQL's
-- built-in pg_catalog UUID generator so couple creation works consistently in
-- hosted, local, and restored databases without widening search_path.
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_code text;
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..16 LOOP
    v_code := 'WH-' || upper(substr(replace(
      pg_catalog.gen_random_uuid()::text,
      '-',
      ''
    ), 1, 12));

    IF NOT EXISTS (
      SELECT 1 FROM public.couples WHERE invite_code = v_code
    ) THEN
      RETURN v_code;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'INVITE_CODE_EXHAUSTED' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_invite_code()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_invite_code()
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_couple_for_current_user(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_profile_couple_id uuid;
  v_profile_role text;
  v_slot_count integer;
  v_occurrence_couple_id uuid;
  v_occurrence_role text;
  v_couple_id uuid;
  v_invite_code text;
  v_attempt integer;
  v_profile_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'AUTH_REQUIRED', 'error', 'Unauthenticated.'
    );
  END IF;

  IF v_role NOT IN ('bride', 'groom') THEN
    RETURN jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'INVALID_ROLE', 'error', 'Invalid role.'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || v_uid::text,
      0
    )
  );

  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND', 'error', 'Profile not found.'
    );
  END IF;

  SELECT count(*)::integer
    INTO v_slot_count
  FROM (
    SELECT couple.id AS couple_id, 'bride'::text AS slot_role
    FROM public.couples AS couple
    WHERE couple.bride_id = v_uid
    UNION ALL
    SELECT couple.id AS couple_id, 'groom'::text AS slot_role
    FROM public.couples AS couple
    WHERE couple.groom_id = v_uid
  ) AS occurrence;

  IF v_profile_couple_id IS NOT NULL THEN
    IF v_slot_count <> 1 THEN
      RETURN jsonb_build_object(
        'success', false, 'created', false, 'idempotent', false,
        'error_code', 'MEMBERSHIP_INCONSISTENT',
        'error', 'Account membership is inconsistent.'
      );
    END IF;

    SELECT occurrence.couple_id, occurrence.slot_role, couple.invite_code
      INTO v_occurrence_couple_id, v_occurrence_role, v_invite_code
    FROM (
      SELECT candidate.id AS couple_id, 'bride'::text AS slot_role
      FROM public.couples AS candidate
      WHERE candidate.bride_id = v_uid
      UNION ALL
      SELECT candidate.id AS couple_id, 'groom'::text AS slot_role
      FROM public.couples AS candidate
      WHERE candidate.groom_id = v_uid
    ) AS occurrence
    JOIN public.couples AS couple ON couple.id = occurrence.couple_id;

    IF v_occurrence_couple_id = v_profile_couple_id
       AND v_occurrence_role = v_profile_role
       AND v_profile_role = v_role THEN
      RETURN jsonb_build_object(
        'success', true, 'created', false, 'idempotent', true,
        'couple_id', v_occurrence_couple_id,
        'role', v_occurrence_role,
        'invite_code', v_invite_code
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'MEMBERSHIP_INCONSISTENT',
      'error', 'Account membership is inconsistent.'
    );
  END IF;

  IF v_slot_count <> 0
     OR (v_profile_role IS NOT NULL AND v_profile_role <> v_role) THEN
    RETURN jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'MEMBERSHIP_INCONSISTENT',
      'error', 'Account membership is inconsistent.'
    );
  END IF;

  PERFORM pg_catalog.set_config('hanbang.allow_membership_write', 'on', true);

  FOR v_attempt IN 1..8 LOOP
    v_couple_id := NULL;
    v_invite_code := public.generate_invite_code();

    INSERT INTO public.couples (invite_code, bride_id, groom_id)
    VALUES (
      v_invite_code,
      CASE WHEN v_role = 'bride' THEN v_uid ELSE NULL END,
      CASE WHEN v_role = 'groom' THEN v_uid ELSE NULL END
    )
    ON CONFLICT (invite_code) DO NOTHING
    RETURNING id INTO v_couple_id;

    EXIT WHEN v_couple_id IS NOT NULL;
  END LOOP;

  IF v_couple_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'created', false, 'idempotent', false,
      'error_code', 'INVITE_CODE_EXHAUSTED',
      'error', 'Could not generate invite code.'
    );
  END IF;

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      updated_at = now()
  WHERE id = v_uid
    AND couple_id IS NOT DISTINCT FROM v_profile_couple_id
    AND role IS NOT DISTINCT FROM v_profile_role;

  GET DIAGNOSTICS v_profile_rows = ROW_COUNT;
  IF v_profile_rows <> 1 THEN
    RAISE EXCEPTION 'CREATE_COUPLE_PROFILE_UPDATE_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = v_uid
    AND profile.couple_id = v_couple_id
    AND profile.role = v_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREATE_COUPLE_PROFILE_POSTCONDITION_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'created', true, 'idempotent', false,
    'couple_id', v_couple_id,
    'role', v_role,
    'invite_code', v_invite_code
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_couple_for_current_user(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_couple_for_current_user(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.join_couple(p_invite_code text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(COALESCE(p_invite_code, '')));
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_profile_couple_id uuid;
  v_profile_role text;
  v_slot_count integer;
  v_has_canonical_occurrence boolean;
  v_couple_id uuid;
  v_invite_code text;
  v_updated_id uuid;
  v_profile_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'AUTH_REQUIRED', 'error', 'Unauthenticated.'
    );
  END IF;

  IF v_role NOT IN ('bride', 'groom') THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_ROLE', 'error', 'Invalid role.'
    );
  END IF;

  IF v_code !~ '^WH-[A-Z0-9]{6,12}$' THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || v_uid::text,
      0
    )
  );

  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND', 'error', 'Profile not found.'
    );
  END IF;

  SELECT count(*)::integer
    INTO v_slot_count
  FROM (
    SELECT couple.id AS couple_id, 'bride'::text AS slot_role
    FROM public.couples AS couple
    WHERE couple.bride_id = v_uid
    UNION ALL
    SELECT couple.id AS couple_id, 'groom'::text AS slot_role
    FROM public.couples AS couple
    WHERE couple.groom_id = v_uid
  ) AS occurrence;

  SELECT couple.id, couple.invite_code
    INTO v_couple_id, v_invite_code
  FROM public.couples AS couple
  WHERE couple.invite_code = v_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT candidate.id AS couple_id, 'bride'::text AS slot_role
      FROM public.couples AS candidate
      WHERE candidate.bride_id = v_uid
      UNION ALL
      SELECT candidate.id AS couple_id, 'groom'::text AS slot_role
      FROM public.couples AS candidate
      WHERE candidate.groom_id = v_uid
    ) AS occurrence
    WHERE occurrence.couple_id = v_profile_couple_id
      AND occurrence.slot_role = v_profile_role
  ) INTO v_has_canonical_occurrence;

  IF v_profile_couple_id IS NOT NULL THEN
    IF v_slot_count = 1 AND v_has_canonical_occurrence THEN
      IF v_profile_couple_id = v_couple_id AND v_profile_role = v_role THEN
        RETURN jsonb_build_object(
          'success', true, 'joined', false, 'idempotent', true,
          'couple_id', v_couple_id,
          'role', v_role,
          'invite_code', v_invite_code
        );
      END IF;

      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'ALREADY_LINKED',
        'error', 'This account is already linked to another couple.'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'MEMBERSHIP_INCONSISTENT',
      'error', 'Account membership is inconsistent.'
    );
  END IF;

  IF v_slot_count <> 0
     OR (v_profile_role IS NOT NULL AND v_profile_role <> v_role) THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'MEMBERSHIP_INCONSISTENT',
      'error', 'Account membership is inconsistent.'
    );
  END IF;

  PERFORM pg_catalog.set_config('hanbang.allow_membership_write', 'on', true);
  v_updated_id := NULL;

  IF v_role = 'bride' THEN
    UPDATE public.couples
    SET bride_id = v_uid,
        updated_at = now()
    WHERE id = v_couple_id
      AND bride_id IS NULL
      AND (groom_id IS NULL OR groom_id <> v_uid)
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'BRIDE_SLOT_OCCUPIED',
        'error', 'Bride slot is already linked.'
      );
    END IF;
  ELSE
    UPDATE public.couples
    SET groom_id = v_uid,
        updated_at = now()
    WHERE id = v_couple_id
      AND groom_id IS NULL
      AND (bride_id IS NULL OR bride_id <> v_uid)
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'GROOM_SLOT_OCCUPIED',
        'error', 'Groom slot is already linked.'
      );
    END IF;
  END IF;

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      updated_at = now()
  WHERE id = v_uid
    AND couple_id IS NOT DISTINCT FROM v_profile_couple_id
    AND role IS NOT DISTINCT FROM v_profile_role;

  GET DIAGNOSTICS v_profile_rows = ROW_COUNT;
  IF v_profile_rows <> 1 THEN
    RAISE EXCEPTION 'JOIN_COUPLE_PROFILE_UPDATE_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = v_uid
    AND profile.couple_id = v_couple_id
    AND profile.role = v_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOIN_COUPLE_PROFILE_POSTCONDITION_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'joined', true, 'idempotent', false,
    'couple_id', v_couple_id,
    'role', v_role,
    'invite_code', v_invite_code
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.join_couple(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_couple(text, text)
  TO authenticated;

-- A final-message unique index prevents duplicate rows but cannot stop two
-- concurrent requests from both running mutating AI tools. This service-only
-- ledger claims a logical turn before cost reservation/model/tool execution.
CREATE TABLE IF NOT EXISTS public.amora_chat_request_claims (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (
    visibility IN ('shared', 'bride_private', 'groom_private')
  ),
  status text NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'completed', 'failed')
  ),
  message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  PRIMARY KEY (couple_id, request_key),
  CHECK (char_length(request_key) BETWEEN 1 AND 160)
);

ALTER TABLE public.amora_chat_request_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.amora_chat_request_claims
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.amora_chat_request_claims
  TO service_role;

CREATE INDEX IF NOT EXISTS amora_chat_request_claims_status_claimed_idx
  ON public.amora_chat_request_claims (status, claimed_at);

CREATE OR REPLACE FUNCTION public.claim_amora_chat_request(
  p_couple_id uuid,
  p_request_key text,
  p_user_id uuid,
  p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_claim public.amora_chat_request_claims%ROWTYPE;
  v_profile_role text;
  v_expected_chat_prefix text := 'chat:' || p_user_id::text || ':';
  v_expected_greeting_key text := 'greeting:' || p_user_id::text;
  v_is_system_request boolean := p_request_key ~ '^(mediation|lifecycle):[0-9a-f]{64}$';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CHAT_CLAIM_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL OR p_user_id IS NULL
     OR p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
     OR NOT (
       p_request_key = v_expected_greeting_key
       OR v_is_system_request
       OR (
         p_request_key LIKE v_expected_chat_prefix || '%'
         AND substring(p_request_key FROM char_length(v_expected_chat_prefix) + 1)
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_CHAT_CLAIM_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.role
    INTO v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id;

  IF NOT FOUND
     OR (p_visibility = 'bride_private' AND v_profile_role <> 'bride')
     OR (p_visibility = 'groom_private' AND v_profile_role <> 'groom') THEN
    RAISE EXCEPTION 'AMORA_CHAT_CLAIM_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.amora_chat_request_claims (
    couple_id, request_key, user_id, visibility
  )
  VALUES (p_couple_id, p_request_key, p_user_id, p_visibility)
  ON CONFLICT (couple_id, request_key) DO NOTHING
  RETURNING * INTO v_claim;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'action', 'acquired',
      'attempt_count', v_claim.attempt_count,
      'reclaimed', false
    );
  END IF;

  SELECT *
    INTO v_claim
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
  FOR UPDATE;

  IF v_claim.visibility <> p_visibility
     OR (NOT v_is_system_request AND v_claim.user_id <> p_user_id) THEN
    RETURN jsonb_build_object('action', 'conflict');
  END IF;

  IF v_claim.status = 'completed' AND v_claim.message_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'completed',
      'message_id', v_claim.message_id,
      'attempt_count', v_claim.attempt_count
    );
  END IF;

  IF v_claim.status = 'processing'
     AND v_claim.claimed_at >= now() - interval '6 minutes' THEN
    RETURN jsonb_build_object(
      'action', 'in_progress',
      'retry_after_ms', 2000,
      'attempt_count', v_claim.attempt_count
    );
  END IF;

  UPDATE public.amora_chat_request_claims
  SET status = 'processing',
      user_id = CASE WHEN v_is_system_request THEN p_user_id ELSE user_id END,
      message_id = NULL,
      claimed_at = now(),
      completed_at = NULL,
      failed_at = NULL,
      failure_code = NULL,
      attempt_count = attempt_count + 1
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'action', 'acquired',
    'attempt_count', v_claim.attempt_count,
    'reclaimed', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_amora_chat_request(
  p_couple_id uuid,
  p_request_key text,
  p_user_id uuid,
  p_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_rows integer;
  v_status text;
  v_existing_message_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CHAT_COMPLETE_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.chat_messages AS message
    WHERE message.id = p_message_id
      AND message.couple_id = p_couple_id
      AND message.sender_id IS NULL
      AND message.sender_type = 'ai'
      AND message.role = 'assistant'
      AND message.metadata->>'client_request_id' = p_request_key
  ) THEN
    RAISE EXCEPTION 'AMORA_CHAT_COMPLETE_MESSAGE_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.amora_chat_request_claims
  SET status = 'completed',
      message_id = p_message_id,
      completed_at = now(),
      failed_at = NULL,
      failure_code = NULL
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND user_id = p_user_id
    AND status = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN true;
  END IF;

  SELECT claim.status, claim.message_id
    INTO v_status, v_existing_message_id
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_request_key
    AND claim.user_id = p_user_id;

  RETURN v_status = 'completed' AND v_existing_message_id = p_message_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_amora_chat_request(
  p_couple_id uuid,
  p_request_key text,
  p_user_id uuid,
  p_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CHAT_FAIL_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.amora_chat_request_claims
  SET status = 'failed',
      failed_at = now(),
      failure_code = left(regexp_replace(
        COALESCE(p_failure_code, 'UNKNOWN'),
        '[^A-Z0-9_]',
        '',
        'g'
      ), 64)
  WHERE couple_id = p_couple_id
    AND request_key = p_request_key
    AND user_id = p_user_id
    AND status = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_amora_chat_request(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_amora_chat_request(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_chat_request(uuid, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_amora_chat_request(uuid, text, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_amora_chat_request(uuid, text, uuid, text)
  TO service_role;

CREATE OR REPLACE VIEW public.couple_profile_directory
WITH (security_barrier = true, security_invoker = false)
AS
SELECT profile.id, profile.name, profile.role, profile.couple_id
FROM public.profiles AS profile
WHERE public.is_couple_member(profile.couple_id);

ALTER VIEW public.couple_profile_directory OWNER TO postgres;
REVOKE ALL ON TABLE public.couple_profile_directory
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.couple_profile_directory
  TO authenticated;

CREATE OR REPLACE VIEW public.my_profile_chat_state
WITH (security_barrier = true, security_invoker = false)
AS
SELECT profile.id, profile.shared_chat_cleared_at, profile.private_chat_cleared_at
FROM public.profiles AS profile
WHERE profile.id = auth.uid();

ALTER VIEW public.my_profile_chat_state OWNER TO postgres;
REVOKE ALL ON TABLE public.my_profile_chat_state
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.my_profile_chat_state
  TO authenticated;
