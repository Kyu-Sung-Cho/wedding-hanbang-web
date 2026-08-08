BEGIN;

-- P0 boundary: community_profiles contains both public identity and server-owned
-- moderation/gamification state. Row ownership alone cannot protect columns, so
-- browser and mobile roles must never read or mutate the base relation directly.
ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy record;
  v_columns text;
BEGIN
  -- Remove every legacy policy, including hosted drift with an unexpected name.
  -- The public read contract is the projection below; controlled server code uses
  -- service_role and SECURITY DEFINER functions for base-table operations.
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'community_profiles'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.community_profiles',
      v_policy.policyname
    );
  END LOOP;

  REVOKE ALL PRIVILEGES ON TABLE public.community_profiles
    FROM PUBLIC, anon, authenticated;

  -- Table-level REVOKE does not remove historical column grants. Clear those too,
  -- including columns added after this migration was authored.
  SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
  INTO v_columns
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.community_profiles'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE SELECT (%s) ON TABLE public.community_profiles FROM PUBLIC, anon, authenticated',
      v_columns
    );
    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.community_profiles FROM PUBLIC, anon, authenticated',
      v_columns
    );
    EXECUTE format(
      'REVOKE UPDATE (%s) ON TABLE public.community_profiles FROM PUBLIC, anon, authenticated',
      v_columns
    );
    EXECUTE format(
      'REVOKE REFERENCES (%s) ON TABLE public.community_profiles FROM PUBLIC, anon, authenticated',
      v_columns
    );
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON TABLE public.community_profiles TO service_role;

COMMENT ON TABLE public.community_profiles IS
  'Server-only community identity source. Public clients use community_public_profiles; moderation, rank, XP, counters, warning, and suspension fields are never client-writable.';

-- Intentionally small public contract. Wedding timing, region, progress, counts,
-- XP/level, warnings, and suspension state stay out of the public projection.
-- The explicit suspension predicate prevents a suspended identity from being
-- rediscovered through this read path while retaining the underlying record.
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
WHERE COALESCE(profile.is_suspended, false) = false;

REVOKE ALL PRIVILEGES ON TABLE public.community_public_profiles
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_public_profiles
  TO anon, authenticated, service_role;

COMMENT ON VIEW public.community_public_profiles IS
  'Read-only public community identity projection. Contains display identity only and omits wedding timing, region, activity telemetry, moderation state, and gamification state.';

-- Server routes still need one narrow answer before accepting a write. Do not
-- reopen the base table for that check: expose only the caller's own suspended
-- bit through a SECURITY DEFINER boundary. service_role may check an explicit
-- actor on behalf of a verified API request; authenticated callers are pinned
-- to auth.uid().
CREATE OR REPLACE FUNCTION public.community_get_write_access(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_role text := COALESCE(
    current_setting('request.jwt.claim.role', true),
    ''
  );
  v_is_suspended boolean;
  v_profile_exists boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'community actor is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_request_role <> 'service_role'
    AND (
      auth.uid() IS NULL
      OR auth.uid() IS DISTINCT FROM p_user_id
    ) THEN
    RAISE EXCEPTION 'community write access is private to the actor'
      USING ERRCODE = '42501';
  END IF;

  -- Aggregate to exactly one row so a first-time user without a community
  -- profile gets an explicit false/false contract instead of NULL values.
  SELECT
    count(*) > 0,
    COALESCE(bool_or(COALESCE(profile.is_suspended, false)), false)
  INTO v_profile_exists, v_is_suspended
  FROM public.community_profiles AS profile
  WHERE profile.user_id = p_user_id;

  RETURN jsonb_build_object(
    'profile_exists', v_profile_exists,
    'is_suspended', COALESCE(v_is_suspended, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_get_write_access(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_get_write_access(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.community_get_write_access(uuid) IS
  'Narrow own-actor suspension check used by server write gates; never exposes profile counters, wedding timing, or moderation metadata.';

-- Retire the unused guestbook relations without deleting recoverable user data.
-- Every client privilege and policy is removed; service_role retains break-glass
-- export/recovery access for a future consented product migration.
DO $$
DECLARE
  v_table_name text;
  v_policy record;
  v_columns text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'guestbooks',
    'guestbook_messages',
    'guestbook_message_reactions',
    'guestbook_photos'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table_name
    );

    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table_name
    LOOP
      EXECUTE format(
        'DROP POLICY %I ON public.%I',
        v_policy.policyname,
        v_table_name
      );
    END LOOP;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table_name
    );

    SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
    INTO v_columns
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = to_regclass(format('public.%I', v_table_name))
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table_name
      );
      EXECUTE format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table_name
      );
      EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table_name
      );
      EXECUTE format(
        'REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table_name
      );
    END IF;

    EXECUTE format(
      'GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role',
      v_table_name
    );
    EXECUTE format(
      'COMMENT ON TABLE public.%I IS %L',
      v_table_name,
      'Retired guestbook data retained for controlled service-role recovery; all client access is denied.'
    );
  END LOOP;
END
$$;

-- The legacy upload buckets were public even after their application routes were
-- removed. Supabase owns every relation in its Storage schema and documents its
-- metadata as read-only for application SQL. Making both buckets private and
-- verifying the final object-policy manifest therefore stays in the separate,
-- release-blocking hosted Storage owner operation, executed through the supported
-- Storage API / Dashboard rather than this automatic migration.

-- Recovery / forward rollback:
--   * No profile, guestbook, message, reaction, photo, or storage-object row is
--     deleted here. service_role can export or migrate every retained record.
--   * Restore a consented guestbook only with a new forward migration that adds
--     narrow policies, explicitly approved projection columns, and a private
--     signed-object path. Do not restore the historical USING/WITH CHECK(true)
--     policies or set the buckets public as an emergency shortcut.
--   * App reads of community identity must move to community_public_profiles in
--     the same release before this migration is applied remotely.

COMMIT;
