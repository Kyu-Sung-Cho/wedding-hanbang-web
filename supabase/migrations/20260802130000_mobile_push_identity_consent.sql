-- Bind Expo push delivery identifiers and preferences to the authenticated
-- actor. A device token must never remain attached to the previous account
-- after logout, account switching, or an explicit notification opt-out.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $mobile_push_identity_schema_preflight$
DECLARE
  existing_identity_column_count integer;
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'MOBILE_PUSH_IDENTITY_PROFILES_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO existing_identity_column_count
  FROM information_schema.columns AS profile_column
  WHERE profile_column.table_schema = 'public'
    AND profile_column.table_name = 'profiles'
    AND profile_column.column_name IN (
      'push_notifications_enabled',
      'push_notifications_consented_at',
      'community_push_notifications_enabled',
      'partner_push_notifications_enabled',
      'push_token_attached_at'
    );

  IF existing_identity_column_count NOT IN (0, 5) THEN
    RAISE EXCEPTION 'MOBILE_PUSH_IDENTITY_PARTIAL_SCHEMA: %',
      existing_identity_column_count
      USING ERRCODE = '55000';
  END IF;

  -- Keep the one-time legacy-consent reset tied to this transaction's captured
  -- pre-DDL state. A ledger recovery or deliberate replay must not erase a
  -- consent/token that was attached after the first successful migration.
  PERFORM pg_catalog.set_config(
    'hanbang.mobile_push_identity_first_install',
    (existing_identity_column_count = 0)::text,
    true
  );
END;
$mobile_push_identity_schema_preflight$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_notifications_consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS community_push_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS partner_push_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_token_attached_at timestamptz;

-- The previous mobile path requested OS permission automatically and its
-- local toggle was neither actor-scoped nor enforced by delivery. Do not
-- infer durable consent from that state: require an explicit in-app opt-in.
UPDATE public.profiles
SET push_token = NULL,
    push_token_attached_at = NULL,
    push_notifications_enabled = false,
    push_notifications_consented_at = NULL
WHERE pg_catalog.current_setting(
        'hanbang.mobile_push_identity_first_install',
        true
      ) = 'true'
  AND (
    push_token IS NOT NULL
    OR push_token_attached_at IS NOT NULL
    OR push_notifications_enabled IS DISTINCT FROM false
    OR push_notifications_consented_at IS NOT NULL
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_push_consent_consistency_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_push_consent_consistency_check
  CHECK (
    (push_notifications_enabled = true AND push_notifications_consented_at IS NOT NULL)
    OR
    (push_notifications_enabled = false AND push_notifications_consented_at IS NULL)
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_push_token_attachment_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_push_token_attachment_check
  CHECK ((push_token IS NULL) = (push_token_attached_at IS NULL));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_push_token_requires_consent_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_push_token_requires_consent_check
  CHECK (
    push_token IS NULL
    OR (
      push_notifications_enabled = true
      AND push_notifications_consented_at IS NOT NULL
    )
  );

-- Direct writes cannot atomically transfer an installation token away from a
-- prior actor. All token and consent mutations therefore go through the RPCs
-- below, which serialize by token and verify auth.uid().
REVOKE UPDATE (
  push_token,
  push_token_attached_at,
  push_notifications_enabled,
  push_notifications_consented_at,
  community_push_notifications_enabled,
  partner_push_notifications_enabled
) ON TABLE public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_my_mobile_push_preferences(
  p_push_enabled boolean DEFAULT NULL,
  p_community_enabled boolean DEFAULT NULL,
  p_partner_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_push_enabled IS NULL
     AND p_community_enabled IS NULL
     AND p_partner_enabled IS NULL THEN
    RAISE EXCEPTION 'push_preference_change_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET push_notifications_enabled = COALESCE(
        p_push_enabled,
        push_notifications_enabled
      ),
      push_notifications_consented_at = CASE
        WHEN p_push_enabled = true
          THEN COALESCE(push_notifications_consented_at, clock_timestamp())
        WHEN p_push_enabled = false THEN NULL
        ELSE push_notifications_consented_at
      END,
      community_push_notifications_enabled = COALESCE(
        p_community_enabled,
        community_push_notifications_enabled
      ),
      partner_push_notifications_enabled = COALESCE(
        p_partner_enabled,
        partner_push_notifications_enabled
      ),
      push_token = CASE WHEN p_push_enabled = false THEN NULL ELSE push_token END,
      push_token_attached_at = CASE
        WHEN p_push_enabled = false THEN NULL
        ELSE push_token_attached_at
      END,
      updated_at = clock_timestamp()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'pushEnabled', v_profile.push_notifications_enabled,
    'communityEnabled', v_profile.community_push_notifications_enabled,
    'partnerEnabled', v_profile.partner_push_notifications_enabled,
    'consentedAt', v_profile.push_notifications_consented_at,
    'tokenAttached', v_profile.push_token IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_my_mobile_push_token(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_enabled boolean;
  v_consented_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL
     OR octet_length(p_token) < 20
     OR octet_length(p_token) > 512
     OR p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' THEN
    RAISE EXCEPTION 'invalid_push_token' USING ERRCODE = '22023';
  END IF;

  -- Token lock comes before any profile row lock. This gives same-device
  -- account switches one global order and avoids an A-row/B-row deadlock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_token, 0)
  );

  SELECT push_notifications_enabled, push_notifications_consented_at
  INTO v_enabled, v_consented_at
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_enabled IS DISTINCT FROM true OR v_consented_at IS NULL THEN
    RAISE EXCEPTION 'push_consent_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET push_token = NULL,
      push_token_attached_at = NULL,
      updated_at = clock_timestamp()
  WHERE push_token = p_token
    AND id <> v_user_id;

  UPDATE public.profiles
  SET push_token = p_token,
      push_token_attached_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.detach_my_mobile_push_token()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET push_token = NULL,
      push_token_attached_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_user_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_mobile_push_preferences(boolean, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_my_mobile_push_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detach_my_mobile_push_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_mobile_push_preferences(boolean, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_my_mobile_push_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detach_my_mobile_push_token() TO authenticated;

COMMENT ON COLUMN public.profiles.push_notifications_enabled IS
  'Explicit per-account consent for mobile push delivery; false also detaches the token.';
COMMENT ON COLUMN public.profiles.push_notifications_consented_at IS
  'Server timestamp for the current mobile push opt-in; NULL while disabled.';
COMMENT ON COLUMN public.profiles.push_token_attached_at IS
  'Server timestamp when the current Expo installation token was atomically attached.';

COMMIT;
