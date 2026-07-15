-- CONTRACT PHASE: harden account and couple membership boundaries after the web release has
-- switched full-profile reads/writes to authenticated server-side routes.
--
-- Deployment order is deliberate:
--   1. apply 20260714160000_harden_amora_privacy_boundaries.sql;
--   2. deploy the compatible web/mobile code that uses couple_profile_directory;
--   3. apply this migration only after the application canary passes.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.couple_profile_directory') IS NULL
     OR to_regprocedure('public.join_couple(text,text)') IS NULL
     OR to_regprocedure('public.create_couple_for_current_user(text)') IS NULL
     OR NOT has_function_privilege(
       'authenticated',
       'public.create_couple_for_current_user(text)',
       'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'profiles'
         AND column_name = 'push_token'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger_record
       JOIN pg_proc AS trigger_function
         ON trigger_function.oid = trigger_record.tgfoid
       WHERE trigger_record.tgrelid = 'auth.users'::regclass
         AND trigger_record.tgname = 'on_auth_user_created'
         AND trigger_record.tgenabled <> 'D'
         AND NOT trigger_record.tgisinternal
         AND trigger_function.proname = 'create_profile_on_signup'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'public.couples'::regclass
         AND tgname = 'trg_guard_new_couple_membership'
         AND tgenabled <> 'D'
     )
     OR NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.couples', 'INSERT')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'profiles'
         AND policyname = 'profiles_select_related'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'couples'
         AND policyname = 'couples_insert_own'
     ) THEN
    RAISE EXCEPTION 'AMORA_ACCOUNT_HARDENING_PRECONDITION_FAILED';
  END IF;
END;
$$;

-- Partner rows remain visible only for backwards-compatible safe-column reads.
-- Table-level SELECT is removed below, so email, phone, consent, care and admin
-- fields cannot be selected even when the row-level predicate allows a partner.
CREATE OR REPLACE FUNCTION public.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.couples AS couple
      WHERE (couple.bride_id = auth.uid() OR couple.groom_id = auth.uid())
        AND (couple.bride_id = p_profile_id OR couple.groom_id = p_profile_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_profile(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_select_related ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
DROP POLICY IF EXISTS profiles_select_safe_related ON public.profiles;
CREATE POLICY profiles_select_safe_related ON public.profiles
  FOR SELECT TO authenticated
  USING (public.can_read_profile(id));

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;

REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT (
  id,
  name,
  role,
  couple_id,
  onboarding_completed
) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (
  name,
  -- Mixed-version window: shipped mobile clients still persist this column
  -- directly under the self-only profile policy. Remove only after a minimum
  -- app version using the replacement server endpoint is enforced.
  push_token,
  shared_chat_cleared_at,
  private_chat_cleared_at
) ON TABLE public.profiles TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.profiles TO service_role;

-- Invoker mode is important: direct client UPDATEs run as authenticated and
-- cannot change membership/admin state. The SECURITY DEFINER join RPC runs its
-- nested UPDATE as its owner and may perform the already-validated membership
-- synchronization.
CREATE OR REPLACE FUNCTION public.prevent_profile_membership_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.couple_id := OLD.couple_id;
    NEW.role := OLD.role;
    NEW.is_admin := OLD.is_admin;
    NEW.user_type := OLD.user_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_couple_ownership_self_change ON public.profiles;
DROP TRIGGER IF EXISTS trg_prevent_profile_membership_self_change ON public.profiles;
CREATE TRIGGER trg_prevent_profile_membership_self_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_membership_self_change();

REVOKE ALL ON FUNCTION public.prevent_profile_membership_self_change()
  FROM PUBLIC, anon, authenticated;

-- Signup is fail-closed: an Auth user must never be created without its profile.
CREATE OR REPLACE FUNCTION public.create_profile_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    name,
    email,
    onboarding_completed,
    onboarding_step,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'User'
    ),
    NEW.email,
    false,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, profiles.email),
    name = COALESCE(NULLIF(EXCLUDED.name, ''), profiles.name),
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_profile_on_signup()
  FROM PUBLIC, anon, authenticated, service_role;

-- Couple rows are client read-only. Creation and reset remain server-side;
-- joining remains available only through the atomic join_couple RPC below.
DROP POLICY IF EXISTS couples_insert_own ON public.couples;
REVOKE ALL PRIVILEGES ON TABLE public.couples FROM anon, authenticated;
GRANT SELECT ON TABLE public.couples TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.couples TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_couple_slot_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
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

REVOKE ALL ON FUNCTION public.prevent_couple_slot_self_change()
  FROM PUBLIC, anon, authenticated;

-- The expand migration owns the concurrency-safe create/join RPC bodies. Do
-- not redefine them here: this contract migration only removes direct writes.
REVOKE ALL ON FUNCTION public.join_couple(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_couple(text, text)
  TO authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'name', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'name', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'push_token', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'phone', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'consents', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.couples', 'INSERT')
     OR has_table_privilege('authenticated', 'public.couples', 'UPDATE')
     OR NOT has_function_privilege('authenticated', 'public.join_couple(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_couple_for_current_user(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.join_couple(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_couple_for_current_user(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AMORA_ACCOUNT_HARDENING_ACL_INVALID';
  END IF;

  IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
        AND policyname IN ('profiles_select_related', 'profiles_insert_own')
    )
    OR EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'couples'
        AND policyname = 'couples_insert_own'
    ) THEN
    RAISE EXCEPTION 'AMORA_ACCOUNT_HARDENING_LEGACY_POLICY_REMAINS';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.join_couple(text, text) IS
  'Idempotently claims one couple slot with global membership locks and synchronizes exactly one existing profile row.';

COMMENT ON FUNCTION public.create_couple_for_current_user(text) IS
  'Idempotently creates one couple for the authenticated user under the global membership lock.';
