-- Lock server-trusted columns and canonical write workflows.
--
-- The row policies on these tables only established row ownership. They did
-- not prevent an authenticated client from supplying approval, moderation,
-- reputation, payment, or aggregate fields. All current product writes for
-- these tables already pass through a service-owned API/RPC, except the mobile
-- Expo push-token update. Preserve that one narrow direct write and remove the
-- obsolete direct profile-insert repair path.
--
-- This migration changes privileges and policies only. It does not rewrite or
-- inspect customer rows.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $trusted_field_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT string_agg(
    format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('profiles', 'is_admin'),
    ('profiles', 'push_token'),
    ('vendors', 'status'),
    ('vendors', 'is_verified'),
    ('vendors', 'ai_recommend'),
    ('vendors', 'rating'),
    ('vendors', 'review_count'),
    ('vendor_bookings', 'status'),
    ('vendor_bookings', 'amount'),
    ('vendor_bookings', 'actual_amount'),
    ('vendor_reviews', 'rating'),
    ('vendor_reviews', 'content'),
    ('vendor_reviews', 'reply'),
    ('vendor_reviews', 'is_visible'),
    ('community_profiles', 'rank'),
    ('community_profiles', 'post_count'),
    ('community_profiles', 'warning_count'),
    ('community_profiles', 'is_suspended'),
    ('community_posts', 'is_verified_review'),
    ('community_posts', 'under_review'),
    ('community_posts', 'upvote_count'),
    ('community_posts', 'is_pinned'),
    ('community_posts', 'is_weekly_best')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;
END;
$trusted_field_preflight$;

-- Remove historical authenticated write policies. service_role bypasses RLS
-- and keeps explicit table privileges below.
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;

DROP POLICY IF EXISTS vendors_insert_own ON public.vendors;
DROP POLICY IF EXISTS vendors_update_own ON public.vendors;
DROP POLICY IF EXISTS vendors_delete_own ON public.vendors;
DROP POLICY IF EXISTS "업체: 신규 등록" ON public.vendors;
DROP POLICY IF EXISTS "업체: 본인 업체 수정" ON public.vendors;
DROP POLICY IF EXISTS "서비스: vendors 전체 관리" ON public.vendors;

DROP POLICY IF EXISTS vendor_bookings_insert ON public.vendor_bookings;
DROP POLICY IF EXISTS vendor_bookings_update ON public.vendor_bookings;

DROP POLICY IF EXISTS vendor_reviews_insert ON public.vendor_reviews;
DROP POLICY IF EXISTS vendor_reviews_update ON public.vendor_reviews;
DROP POLICY IF EXISTS vendor_reviews_update_own ON public.vendor_reviews;
DROP POLICY IF EXISTS "고객: 리뷰 작성" ON public.vendor_reviews;
DROP POLICY IF EXISTS "고객: 본인 리뷰 수정" ON public.vendor_reviews;
DROP POLICY IF EXISTS "업체: 리뷰 답변" ON public.vendor_reviews;
DROP POLICY IF EXISTS "서비스: 리뷰 전체 관리" ON public.vendor_reviews;

DROP POLICY IF EXISTS community_profiles_insert ON public.community_profiles;
DROP POLICY IF EXISTS community_profiles_update ON public.community_profiles;

DROP POLICY IF EXISTS cp_insert ON public.community_posts;
DROP POLICY IF EXISTS cp_update ON public.community_posts;
DROP POLICY IF EXISTS cp_delete ON public.community_posts;

-- A table-level REVOKE does not remove an older per-column GRANT. Clear both
-- layers so a historical or manual grant cannot leave one trusted field open.
DO $revoke_direct_write_columns$
DECLARE
  target_table text;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'profiles',
    'vendors',
    'vendor_bookings',
    'vendor_reviews',
    'community_profiles',
    'community_posts'
  ]::text[]
  LOOP
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    IF all_columns IS NULL THEN
      RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_TABLE_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;

    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      all_columns,
      target_table
    );
    EXECUTE format(
      'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      all_columns,
      target_table
    );
  END LOOP;
END;
$revoke_direct_write_columns$;

REVOKE INSERT, UPDATE ON TABLE public.profiles
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON TABLE public.vendors
  FROM PUBLIC, anon, authenticated;
REVOKE DELETE ON TABLE public.vendors
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON TABLE public.vendor_bookings
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON TABLE public.vendor_reviews
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON TABLE public.community_profiles
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_posts
  FROM PUBLIC, anon, authenticated;

-- The shipped mobile client persists only this delivery identifier directly.
-- Its database CHECK constraint remains the validation boundary.
GRANT UPDATE (push_token) ON TABLE public.profiles TO authenticated;

-- Keep every canonical server API, SECURITY DEFINER RPC, Auth trigger, and
-- account-deletion workflow operational after removing PUBLIC-derived grants.
GRANT INSERT, UPDATE ON TABLE
  public.profiles,
  public.vendors,
  public.vendor_bookings,
  public.vendor_reviews,
  public.community_profiles,
  public.community_posts
TO service_role;
GRANT DELETE ON TABLE public.vendors, public.community_posts TO service_role;

DO $trusted_field_postcondition$
DECLARE
  target_table text;
  target_role text;
  unexpected_column text;
  unsafe_policy text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
  LOOP
    IF has_table_privilege(target_role, 'public.profiles', 'INSERT')
       OR has_any_column_privilege(target_role, 'public.profiles', 'INSERT') THEN
      RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_PROFILE_INSERT_OPEN: %', target_role
        USING ERRCODE = '55000';
    END IF;

    SELECT existing.column_name
    INTO unexpected_column
    FROM information_schema.columns AS existing
    WHERE existing.table_schema = 'public'
      AND existing.table_name = 'profiles'
      AND existing.column_name <> 'push_token'
      AND has_column_privilege(
        target_role,
        'public.profiles',
        existing.column_name,
        'UPDATE'
      )
    ORDER BY existing.ordinal_position
    LIMIT 1;

    IF unexpected_column IS NOT NULL THEN
      RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_PROFILE_UPDATE_OPEN: %.%',
        target_role,
        unexpected_column
        USING ERRCODE = '55000';
    END IF;

    IF target_role = 'authenticated'
       AND NOT has_column_privilege(
         'authenticated',
         'public.profiles',
         'push_token',
         'UPDATE'
       ) THEN
      RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_PUSH_TOKEN_CLOSED'
        USING ERRCODE = '55000';
    END IF;

    FOREACH target_table IN ARRAY ARRAY[
      'vendors',
      'vendor_bookings',
      'vendor_reviews',
      'community_profiles',
      'community_posts'
    ]::text[]
    LOOP
      IF has_table_privilege(
           target_role,
           format('public.%I', target_table),
           'INSERT'
         )
         OR has_any_column_privilege(
           target_role,
           format('public.%I', target_table),
           'INSERT'
         )
         OR has_table_privilege(
           target_role,
           format('public.%I', target_table),
           'UPDATE'
         )
         OR has_any_column_privilege(
           target_role,
           format('public.%I', target_table),
           'UPDATE'
         ) THEN
        RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_WRITE_OPEN: %.%',
          target_role,
          target_table
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    IF has_table_privilege(target_role, 'public.community_posts', 'DELETE') THEN
      RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_POST_DELETE_OPEN: %', target_role
        USING ERRCODE = '55000';
    END IF;

    IF has_table_privilege(target_role, 'public.vendors', 'DELETE') THEN
      RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_VENDOR_DELETE_OPEN: %', target_role
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT format('%I.%I policy %I', namespace.nspname, relation.relname, policy.polname)
  INTO unsafe_policy
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'profiles',
      'vendors',
      'vendor_bookings',
      'vendor_reviews',
      'community_profiles',
      'community_posts'
    )
    -- FOR ALL ('*') policies are write-capable too. Historical PUBLIC-scoped
    -- service-only policies were redundant with BYPASSRLS and were removed
    -- above so an unknown ALL policy cannot become dangerous after a later
    -- privilege grant.
    AND policy.polcmd IN ('*', 'a', 'w', 'd')
    AND (
      0::oid = ANY(policy.polroles)
      OR (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
         = ANY(policy.polroles)
    )
    AND NOT (
      relation.relname = 'profiles'
      AND policy.polname = 'profiles_update_own'
      AND policy.polcmd = 'w'
    )
  ORDER BY namespace.nspname, relation.relname, policy.polname
  LIMIT 1;

  IF unsafe_policy IS NOT NULL THEN
    RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_WRITE_POLICY_REMAINS: %', unsafe_policy
      USING ERRCODE = '55000';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'profiles',
    'vendors',
    'vendor_bookings',
    'vendor_reviews',
    'community_profiles',
    'community_posts'
  ]::text[]
  LOOP
    IF NOT has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'INSERT'
    ) OR NOT has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'UPDATE'
    ) THEN
      RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_SERVICE_WRITE_CLOSED: %', target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
    'service_role',
    'public.community_posts',
    'DELETE'
  ) OR NOT has_table_privilege(
    'service_role',
    'public.vendors',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'TRUSTED_FIELD_FENCE_SERVICE_DELETE_CLOSED'
      USING ERRCODE = '55000';
  END IF;
END;
$trusted_field_postcondition$;

COMMIT;
