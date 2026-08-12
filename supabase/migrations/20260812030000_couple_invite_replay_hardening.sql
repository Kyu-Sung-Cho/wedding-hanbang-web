BEGIN;

-- Phase A (expand): this migration is intentionally backward compatible.
-- The authenticated legacy RPC remains available until the separately gated
-- release-candidate contract proves the server path has drained old callers.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF pg_catalog.to_regclass('public.couples') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regprocedure('public.join_couple(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.generate_invite_code()') IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.couples'::regclass
         AND attname = 'membership_sealed_at'
         AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.couples'::regclass
         AND tgname = 'trg_enforce_couple_roster_epoch'
         AND NOT tgisinternal
         AND tgenabled <> 'D'
     ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_HARDENING_PRECONDITION_INVALID';
  END IF;
END
$preconditions$;

LOCK TABLE public.couples IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS invite_code_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_code_expires_at timestamptz;

-- Invalid historical shells must not make the lifecycle constraint impossible
-- to validate. They cannot be joined safely, so consume their unsealed code.
UPDATE public.couples
SET invite_code = NULL,
    invite_code_issued_at = NULL,
    invite_code_expires_at = NULL,
    updated_at = transaction_timestamp()
WHERE invite_code IS NOT NULL
  AND membership_sealed_at IS NULL
  AND ((bride_id IS NOT NULL)::integer + (groom_id IS NOT NULL)::integer) <> 1;

-- The oldest invite generator emitted only six hexadecimal characters
-- (24 bits). Per-actor throttling cannot make that safe against many accounts,
-- so rotate every still-active short/malformed historical code before giving
-- current invitations a final seven-day window. This intentionally requires
-- affected couples to re-share the new code shown by supported clients.
UPDATE public.couples
SET invite_code = public.generate_invite_code(),
    invite_code_issued_at = transaction_timestamp(),
    invite_code_expires_at = transaction_timestamp() + interval '7 days',
    updated_at = transaction_timestamp()
WHERE invite_code IS NOT NULL
  AND membership_sealed_at IS NULL
  AND ((bride_id IS NOT NULL)::integer + (groom_id IS NOT NULL)::integer) = 1
  AND invite_code !~ '^WH-[A-Z0-9]{12}$';

-- Preserve every remaining strong one-member invite for one final seven-day
-- window. Sealed, full, or ownerless historical codes remain non-redeemable.
UPDATE public.couples
SET invite_code_issued_at = transaction_timestamp(),
    invite_code_expires_at = transaction_timestamp() + interval '7 days'
WHERE invite_code IS NOT NULL
  AND membership_sealed_at IS NULL
  AND ((bride_id IS NOT NULL)::integer + (groom_id IS NOT NULL)::integer) = 1
  AND (
    invite_code_issued_at IS NULL
    OR invite_code_expires_at IS NULL
    OR invite_code_expires_at <= invite_code_issued_at
  );

CREATE OR REPLACE FUNCTION public.manage_couple_invite_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.invite_code IS NULL THEN
      NEW.invite_code_issued_at := NULL;
      NEW.invite_code_expires_at := NULL;
    ELSE
      NEW.invite_code_issued_at := transaction_timestamp();
      NEW.invite_code_expires_at := transaction_timestamp() + interval '7 days';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.invite_code IS DISTINCT FROM OLD.invite_code THEN
    IF NEW.invite_code IS NULL THEN
      NEW.invite_code_issued_at := NULL;
      NEW.invite_code_expires_at := NULL;
    ELSE
      NEW.invite_code_issued_at := transaction_timestamp();
      NEW.invite_code_expires_at := transaction_timestamp() + interval '7 days';
    END IF;
  ELSIF NEW.invite_code_issued_at IS DISTINCT FROM OLD.invite_code_issued_at
     OR NEW.invite_code_expires_at IS DISTINCT FROM OLD.invite_code_expires_at THEN
    RAISE EXCEPTION 'COUPLE_INVITE_LIFECYCLE_SERVER_MANAGED'
      USING ERRCODE = '23514', CONSTRAINT = 'couples_invite_lifecycle_guard';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.manage_couple_invite_lifecycle() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manage_couple_invite_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_manage_couple_invite_lifecycle ON public.couples;
CREATE TRIGGER trg_manage_couple_invite_lifecycle
  BEFORE INSERT OR UPDATE OF invite_code, invite_code_issued_at, invite_code_expires_at
  ON public.couples
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_couple_invite_lifecycle();

ALTER TABLE public.couples
  DROP CONSTRAINT IF EXISTS couples_invite_lifecycle_valid;
ALTER TABLE public.couples
  ADD CONSTRAINT couples_invite_lifecycle_valid CHECK (
    (
      invite_code IS NULL
      AND invite_code_issued_at IS NULL
      AND invite_code_expires_at IS NULL
    )
    OR (
      invite_code IS NOT NULL
      AND invite_code ~ '^WH-[A-Z0-9]{12}$'
      AND invite_code_issued_at IS NOT NULL
      AND invite_code_expires_at > invite_code_issued_at
    )
    OR (
      invite_code IS NOT NULL
      AND membership_sealed_at IS NOT NULL
      AND invite_code_issued_at IS NULL
      AND invite_code_expires_at IS NULL
    )
  ) NOT VALID;
ALTER TABLE public.couples
  VALIDATE CONSTRAINT couples_invite_lifecycle_valid;

CREATE TABLE IF NOT EXISTS public.couple_invite_join_attempts (
  actor_user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 2147483647),
  last_attempt_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.couple_invite_join_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_invite_join_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.couple_invite_join_attempts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.couple_invite_join_attempts
  TO service_role;

CREATE TABLE IF NOT EXISTS public.couple_invite_redemptions (
  invite_code_sha256 text PRIMARY KEY
    CHECK (invite_code_sha256 ~ '^[0-9a-f]{64}$'),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  redeemed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  redeemed_role text NOT NULL CHECK (redeemed_role IN ('bride', 'groom')),
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  original_expires_at timestamptz NOT NULL,
  UNIQUE (couple_id, redeemed_by)
);

ALTER TABLE public.couple_invite_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_invite_redemptions FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.couple_invite_redemptions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.couple_invite_redemptions TO service_role;

CREATE TABLE IF NOT EXISTS public.couple_invite_join_runtime_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  expanded_at timestamptz NOT NULL DEFAULT now(),
  last_server_attempt_at timestamptz,
  last_server_success_at timestamptz,
  last_legacy_attempt_at timestamptz,
  last_legacy_success_at timestamptz,
  external_legacy_drain_started_at timestamptz,
  external_legacy_drain_verified_at timestamptz,
  external_legacy_drain_evidence text,
  legacy_rpc_revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT couple_invite_external_drain_attestation_valid CHECK (
    (
      external_legacy_drain_started_at IS NULL
      AND external_legacy_drain_verified_at IS NULL
      AND external_legacy_drain_evidence IS NULL
    )
    OR (
      external_legacy_drain_started_at IS NOT NULL
      AND external_legacy_drain_verified_at
        >= external_legacy_drain_started_at + interval '24 hours'
      AND external_legacy_drain_evidence IS NOT NULL
      AND pg_catalog.btrim(external_legacy_drain_evidence) <> ''
    )
  )
);

INSERT INTO public.couple_invite_join_runtime_state(singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.couple_invite_join_runtime_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_invite_join_runtime_state FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.couple_invite_join_runtime_state
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.couple_invite_join_runtime_state
  TO service_role;

CREATE OR REPLACE FUNCTION public.join_couple_invite_core(
  p_actor_user_id uuid,
  p_invite_code text,
  p_role text,
  p_call_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_now timestamptz := transaction_timestamp();
  v_code text := upper(btrim(COALESCE(p_invite_code, '')));
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_code_sha256 text;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_slot_count integer;
  v_has_canonical_occurrence boolean;
  v_attempt_count integer;
  v_window_started_at timestamptz;
  v_retry_after_seconds integer;
  v_redemption public.couple_invite_redemptions%ROWTYPE;
  v_redemption_found boolean := false;
  v_couple_id uuid;
  v_invite_code text;
  v_invite_expires_at timestamptz;
  v_locked_couple_found boolean := false;
  v_bride_id uuid;
  v_groom_id uuid;
  v_membership_sealed_at timestamptz;
  v_owner_user_id uuid;
  v_owner_role text;
  v_updated_id uuid;
  v_profile_rows integer;
BEGIN
  IF p_call_path NOT IN ('server', 'legacy') THEN
    RAISE EXCEPTION 'COUPLE_INVITE_CALL_PATH_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_actor_user_id IS NULL THEN
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

  IF v_code !~ '^WH-[A-Z0-9]{12}$' THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- This first profile read is intentionally non-locking. Active-code joins
  -- later take the incumbent profile, joining profile, and couple locks in
  -- that order so they cannot deadlock with reset_current_couple_membership.
  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'PROFILE_NOT_FOUND', 'error', 'Profile not found.'
    );
  END IF;

  v_code_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT redemption.*
    INTO v_redemption
  FROM public.couple_invite_redemptions AS redemption
  WHERE redemption.invite_code_sha256 = v_code_sha256
  FOR UPDATE;
  v_redemption_found := FOUND;

  -- A retry by the exact actor is a read of its durable success receipt, not a
  -- new guess. It must remain available even after invalid-attempt exhaustion.
  IF v_redemption_found THEN
    SELECT joining_profile.couple_id, joining_profile.role
      INTO v_profile_couple_id, v_profile_role
    FROM public.profiles AS joining_profile
    WHERE joining_profile.id = p_actor_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'PROFILE_NOT_FOUND', 'error', 'Profile not found.'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = p_actor_user_id
        AND profile.couple_id = v_redemption.couple_id
        AND profile.role = v_redemption.redeemed_role
        AND (
          (profile.role = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role = 'groom' AND couple.groom_id = profile.id)
        )
    ) INTO v_has_canonical_occurrence;

    IF v_redemption.redeemed_by = p_actor_user_id
       AND v_redemption.redeemed_role = v_role
       AND v_has_canonical_occurrence THEN
      IF p_call_path = 'server' THEN
        UPDATE public.couple_invite_join_runtime_state
        SET last_server_attempt_at = v_now,
            last_server_success_at = v_now,
            updated_at = v_now
        WHERE singleton;
      ELSE
        UPDATE public.couple_invite_join_runtime_state
        SET last_legacy_attempt_at = v_now,
            last_legacy_success_at = v_now,
            updated_at = v_now
        WHERE singleton;
      END IF;
      RETURN jsonb_build_object(
        'success', true, 'joined', false, 'idempotent', true,
        'actor_user_id', p_actor_user_id,
        'couple_id', v_redemption.couple_id,
        'role', v_role,
        'invite_code', v_code
      );
    END IF;
  END IF;

  -- An actor that already has any canonical membership cannot join again. Do
  -- this before active-code lookup so its own state cannot become a validity
  -- oracle. The exact actor's durable redemption receipt above remains the
  -- sole idempotent exception.
  SELECT count(*)::integer
    INTO v_slot_count
  FROM (
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.bride_id = p_actor_user_id
    UNION ALL
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.groom_id = p_actor_user_id
  ) AS occurrence;

  IF v_profile_couple_id IS NOT NULL OR v_slot_count <> 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'ALREADY_LINKED',
      'error', 'This account is already linked to another couple.'
    );
  END IF;

  INSERT INTO public.couple_invite_join_attempts(
    actor_user_id, window_started_at, attempt_count, last_attempt_at, updated_at
  ) VALUES (
    p_actor_user_id, v_now, 1, v_now, v_now
  )
  ON CONFLICT (actor_user_id) DO UPDATE
  SET window_started_at = CASE
        WHEN couple_invite_join_attempts.window_started_at <= v_now - interval '10 minutes'
          THEN v_now
        ELSE couple_invite_join_attempts.window_started_at
      END,
      attempt_count = CASE
        WHEN couple_invite_join_attempts.window_started_at <= v_now - interval '10 minutes'
          THEN 1
        ELSE LEAST(couple_invite_join_attempts.attempt_count + 1, 2147483647)
      END,
      last_attempt_at = v_now,
      updated_at = v_now
  RETURNING attempt_count, window_started_at
    INTO v_attempt_count, v_window_started_at;

  IF v_attempt_count > 10 THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(epoch FROM (
        v_window_started_at + interval '10 minutes' - v_now
      )))::integer
    );
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'RATE_LIMITED', 'error', 'Too many invite attempts.',
      'retry_after_seconds', v_retry_after_seconds
    );
  END IF;

  IF v_redemption_found THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- Discover the incumbent without locking the couple. Taking the couple row
  -- here would invert reset_current_couple_membership's profile -> couple
  -- order. Every value is re-read and revalidated after the canonical locks.
  SELECT candidate_couple.id, candidate_couple.invite_code,
         candidate_couple.invite_code_expires_at,
         candidate_couple.bride_id, candidate_couple.groom_id,
         candidate_couple.membership_sealed_at
    INTO v_couple_id, v_invite_code, v_invite_expires_at,
         v_bride_id, v_groom_id, v_membership_sealed_at
  FROM public.couples AS candidate_couple
  WHERE candidate_couple.invite_code = v_code
    AND candidate_couple.invite_code_issued_at IS NOT NULL
    AND candidate_couple.invite_code_expires_at > v_now;

  IF NOT FOUND
     OR v_membership_sealed_at IS NOT NULL
     OR ((v_bride_id IS NOT NULL)::integer + (v_groom_id IS NOT NULL)::integer) <> 1 THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  IF v_bride_id IS NOT NULL THEN
    v_owner_user_id := v_bride_id;
    v_owner_role := 'bride';
    IF v_role <> 'groom' THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
      );
    END IF;
  ELSE
    v_owner_user_id := v_groom_id;
    v_owner_role := 'groom';
    IF v_role <> 'bride' THEN
      RETURN jsonb_build_object(
        'success', false, 'joined', false, 'idempotent', false,
        'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
      );
    END IF;
  END IF;

  IF p_actor_user_id = v_owner_user_id THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  -- Canonical active-join order: incumbent profile -> joining profile ->
  -- couple-scoped reset advisory lock -> couple row. A concurrent owner reset
  -- either finishes before this block or waits before taking the couple row;
  -- neither side can hold the couple while waiting for the other's profile.
  PERFORM incumbent_profile.id
  FROM public.profiles AS incumbent_profile
  WHERE incumbent_profile.id = v_owner_user_id
    AND incumbent_profile.couple_id = v_couple_id
    AND incumbent_profile.role = v_owner_role
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  SELECT joining_profile.couple_id, joining_profile.role
    INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS joining_profile
  WHERE joining_profile.id = p_actor_user_id
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
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.bride_id = p_actor_user_id
    UNION ALL
    SELECT couple.id FROM public.couples AS couple
    WHERE couple.groom_id = p_actor_user_id
  ) AS occurrence;

  IF v_profile_couple_id IS NOT NULL OR v_slot_count <> 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'ALREADY_LINKED',
      'error', 'This account is already linked to another couple.'
    );
  END IF;

  IF v_profile_role IS NOT NULL AND v_profile_role <> v_role THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_couple_id::text, 0)
  );

  SELECT locked_couple.id, locked_couple.invite_code,
         locked_couple.invite_code_expires_at,
         locked_couple.bride_id, locked_couple.groom_id,
         locked_couple.membership_sealed_at
    INTO v_couple_id, v_invite_code, v_invite_expires_at,
         v_bride_id, v_groom_id, v_membership_sealed_at
  FROM public.couples AS locked_couple
  WHERE locked_couple.id = v_couple_id
    AND locked_couple.invite_code = v_code
    AND locked_couple.invite_code_issued_at IS NOT NULL
  FOR UPDATE;

  v_locked_couple_found := FOUND;
  -- The transaction can wait first for the advisory lock and then for this
  -- couple row. Refresh only after both locks are owned so a code that expires
  -- during either wait cannot pass the final revalidation or UPDATE.
  v_now := clock_timestamp();

  IF NOT v_locked_couple_found
     OR v_invite_expires_at IS NULL
     OR v_invite_expires_at <= v_now
     OR v_membership_sealed_at IS NOT NULL
     OR ((v_bride_id IS NOT NULL)::integer + (v_groom_id IS NOT NULL)::integer) <> 1
     OR (
       v_owner_role = 'bride'
       AND (
         v_bride_id IS DISTINCT FROM v_owner_user_id
         OR v_groom_id IS NOT NULL
       )
     )
     OR (
       v_owner_role = 'groom'
       AND (
         v_groom_id IS DISTINCT FROM v_owner_user_id
         OR v_bride_id IS NOT NULL
       )
     ) THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  PERFORM pg_catalog.set_config('hanbang.allow_membership_write', 'on', true);
  v_updated_id := NULL;

  IF v_role = 'bride' THEN
    UPDATE public.couples
    SET bride_id = p_actor_user_id,
        invite_code = NULL,
        updated_at = v_now
    WHERE id = v_couple_id
      AND membership_sealed_at IS NULL
      AND invite_code = v_code
      AND invite_code_expires_at > v_now
      AND bride_id IS NULL
      AND groom_id = v_owner_user_id
    RETURNING id INTO v_updated_id;
  ELSE
    UPDATE public.couples
    SET groom_id = p_actor_user_id,
        invite_code = NULL,
        updated_at = v_now
    WHERE id = v_couple_id
      AND membership_sealed_at IS NULL
      AND invite_code = v_code
      AND invite_code_expires_at > v_now
      AND groom_id IS NULL
      AND bride_id = v_owner_user_id
    RETURNING id INTO v_updated_id;
  END IF;

  IF v_updated_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'joined', false, 'idempotent', false,
      'error_code', 'INVALID_INVITE_CODE', 'error', 'Invalid invite code.'
    );
  END IF;

  INSERT INTO public.couple_invite_redemptions(
    invite_code_sha256, couple_id, redeemed_by, redeemed_role,
    redeemed_at, original_expires_at
  ) VALUES (
    v_code_sha256, v_couple_id, p_actor_user_id, v_role,
    v_now, v_invite_expires_at
  );

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      updated_at = v_now
  WHERE id = p_actor_user_id
    AND couple_id IS NOT DISTINCT FROM v_profile_couple_id
    AND role IS NOT DISTINCT FROM v_profile_role;

  GET DIAGNOSTICS v_profile_rows = ROW_COUNT;
  IF v_profile_rows <> 1 THEN
    RAISE EXCEPTION 'JOIN_COUPLE_PROFILE_UPDATE_FAILED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  JOIN public.couples AS couple ON couple.id = profile.couple_id
  WHERE profile.id = p_actor_user_id
    AND profile.couple_id = v_couple_id
    AND profile.role = v_role
    AND couple.membership_sealed_at IS NOT NULL
    AND couple.invite_code IS NULL
    AND (
      (v_role = 'bride' AND couple.bride_id = p_actor_user_id)
      OR (v_role = 'groom' AND couple.groom_id = p_actor_user_id)
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOIN_COUPLE_POSTCONDITION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  IF p_call_path = 'server' THEN
    UPDATE public.couple_invite_join_runtime_state
    SET last_server_attempt_at = v_now,
        last_server_success_at = v_now,
        updated_at = v_now
    WHERE singleton;
  ELSE
    UPDATE public.couple_invite_join_runtime_state
    SET last_legacy_attempt_at = v_now,
        last_legacy_success_at = v_now,
        updated_at = v_now
    WHERE singleton;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'joined', true, 'idempotent', false,
    'actor_user_id', p_actor_user_id,
    'couple_id', v_couple_id,
    'role', v_role,
    'invite_code', v_code
  );
END
$function$;

ALTER FUNCTION public.join_couple_invite_core(uuid, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_couple_invite_core(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.join_couple_server(
  p_actor_user_id uuid,
  p_invite_code text,
  p_role text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
  SELECT public.join_couple_invite_core(
    p_actor_user_id,
    p_invite_code,
    p_role,
    'server'
  )
$function$;

ALTER FUNCTION public.join_couple_server(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_couple_server(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_couple_server(uuid, text, text)
  TO service_role;

-- Compatibility wrapper. It receives the authenticated actor only from the
-- verified JWT and runs the same expiry, one-time, roster, and DB-rate fences.
-- Phase B revokes this sole remaining direct-client entry point after canary.
CREATE OR REPLACE FUNCTION public.join_couple(
  p_invite_code text,
  p_role text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
  SELECT public.join_couple_invite_core(
    auth.uid(),
    p_invite_code,
    p_role,
    'legacy'
  )
$function$;

ALTER FUNCTION public.join_couple(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.join_couple(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_couple(text, text)
  TO authenticated;

DO $postconditions$
BEGIN
  IF pg_catalog.to_regprocedure('public.join_couple_server(uuid,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.join_couple_invite_core(uuid,text,text,text)') IS NULL
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.join_couple_server(uuid,text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.join_couple_server(uuid,text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.join_couple_server(uuid,text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.join_couple_invite_core(uuid,text,text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.join_couple_invite_core(uuid,text,text,text)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.join_couple(text,text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.join_couple(text,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_HARDENING_ACL_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couples
    WHERE invite_code IS NOT NULL
      AND membership_sealed_at IS NULL
      AND ((bride_id IS NOT NULL)::integer + (groom_id IS NOT NULL)::integer) = 1
      AND (
        invite_code !~ '^WH-[A-Z0-9]{12}$'
        OR
        invite_code_issued_at IS NULL
        OR invite_code_expires_at IS NULL
        OR invite_code_expires_at <= invite_code_issued_at
      )
  )
  OR NOT EXISTS (
    SELECT 1 FROM public.couple_invite_join_runtime_state WHERE singleton
  ) THEN
    RAISE EXCEPTION 'COUPLE_INVITE_HARDENING_STATE_INVALID';
  END IF;
END
$postconditions$;

COMMIT;
