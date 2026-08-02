-- Enforce one fail-closed suspension boundary for every active community write.
--
-- Product APIs authenticate a user, then cross the database boundary with the
-- service role.  RLS therefore cannot tell a user-originated write from an
-- operational service write.  This migration keeps explicit service/admin
-- maintenance paths intact while making every product RPC lock and validate the
-- actor's community profile in the same transaction as the mutation.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $community_actor_write_fence_preflight$
DECLARE
  missing_relation text;
  missing_function text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'COMMUNITY_ACTOR_WRITE_FENCE_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT required.name
  INTO missing_relation
  FROM (VALUES
    ('auth.users'),
    ('public.profiles'),
    ('public.community_profiles'),
    ('public.community_posts'),
    ('public.community_comments'),
    ('public.community_reports'),
    ('public.community_upload_sessions'),
    ('public.cohort_members'),
    ('public.cohort_messages'),
    ('public.cohort_timeline_events'),
    ('public.cohort_member_reports')
  ) AS required(name)
  WHERE pg_catalog.to_regclass(required.name) IS NULL
  LIMIT 1;

  IF missing_relation IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_ACTOR_WRITE_FENCE_RELATION_MISSING: %', missing_relation
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'community_profiles'
      AND column_name = 'is_suspended'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_ACTOR_WRITE_FENCE_SUSPENSION_COLUMN_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT required.signature
  INTO missing_function
  FROM (VALUES
    (
      'public.community_vote_post(uuid,uuid,smallint)',
      'public.community_vote_post_service_operational(uuid,uuid,smallint)'
    ),
    (
      'public.community_vote_comment(uuid,uuid,smallint)',
      'public.community_vote_comment_service_operational(uuid,uuid,smallint)'
    ),
    (
      'public.community_toggle_bookmark(uuid,uuid)',
      'public.community_toggle_bookmark_service_operational(uuid,uuid)'
    ),
    (
      'public.community_cast_poll_vote(uuid,uuid,uuid)',
      'public.community_cast_poll_vote_service_operational(uuid,uuid,uuid)'
    ),
    (
      'public.community_assign_cohort(uuid,integer,integer)',
      'public.community_assign_cohort_service_operational(uuid,integer,integer)'
    ),
    (
      'public.community_upsert_cohort_contract(uuid,uuid,uuid,text,text,integer,integer,text)',
      'public.community_upsert_cohort_contract_service_operational(uuid,uuid,uuid,text,text,integer,integer,text)'
    )
  ) AS required(signature, operational_signature)
  WHERE pg_catalog.to_regprocedure(required.signature) IS NULL
    AND pg_catalog.to_regprocedure(required.operational_signature) IS NULL
  LIMIT 1;

  IF missing_function IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_ACTOR_WRITE_FENCE_FUNCTION_MISSING: %', missing_function
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)'
     ) IS NULL
     AND pg_catalog.to_regprocedure(
       'public.claim_community_upload_session_service_operational(uuid,uuid,uuid,timestamp with time zone)'
     ) IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_ACTOR_WRITE_FENCE_FUNCTION_MISSING: claim_community_upload_session'
      USING ERRCODE = '55000';
  END IF;
END;
$community_actor_write_fence_preflight$;

-- Legacy profile initializers derived public nicknames from Auth UUID prefixes.
-- Generate opaque system nicknames centrally so neither historical rows nor
-- older insert paths disclose a stable fragment of the private Auth identifier.
CREATE OR REPLACE FUNCTION public.community_private_system_nickname()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $community_private_system_nickname$
DECLARE
  candidate text;
  attempt integer;
BEGIN
  FOR attempt IN 1..32 LOOP
    candidate := 'user-' || pg_catalog.substr(
      pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      1,
      15
    );

    PERFORM 1
    FROM public.community_profiles AS profile
    WHERE pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(profile.nickname), '\s+', '', 'g')
    ) = candidate;

    IF NOT FOUND THEN
      RETURN candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'community_private_system_nickname_exhausted'
    USING ERRCODE = '23505';
END;
$community_private_system_nickname$;

ALTER FUNCTION public.community_private_system_nickname() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_private_system_nickname()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_rewrite_legacy_system_nickname_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_rewrite_legacy_system_nickname_on_insert$
DECLARE
  actor_hex text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.nickname IS NULL THEN
    RETURN NEW;
  END IF;

  actor_hex := pg_catalog.replace(NEW.user_id::text, '-', '');
  IF NEW.nickname = 'user-' || pg_catalog.substr(actor_hex, 1, 8)
     OR NEW.nickname = 'user-' || pg_catalog.substr(actor_hex, 1, 15) THEN
    NEW.nickname := public.community_private_system_nickname();
  END IF;

  RETURN NEW;
END;
$community_rewrite_legacy_system_nickname_on_insert$;

ALTER FUNCTION public.community_rewrite_legacy_system_nickname_on_insert()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_rewrite_legacy_system_nickname_on_insert()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS community_profiles_rewrite_legacy_system_nickname_insert
  ON public.community_profiles;
CREATE TRIGGER community_profiles_rewrite_legacy_system_nickname_insert
BEFORE INSERT ON public.community_profiles
FOR EACH ROW
EXECUTE FUNCTION public.community_rewrite_legacy_system_nickname_on_insert();

-- Backfill only exact system-generated forms for that row's own user_id.
-- Similar-looking user-selected nicknames and every normal UPDATE remain intact.
DO $community_private_system_nickname_backfill$
DECLARE
  legacy_profile record;
BEGIN
  FOR legacy_profile IN
    SELECT profile.user_id
    FROM public.community_profiles AS profile
    WHERE profile.nickname = 'user-' || pg_catalog.substr(
      pg_catalog.replace(profile.user_id::text, '-', ''), 1, 8
    )
       OR profile.nickname = 'user-' || pg_catalog.substr(
      pg_catalog.replace(profile.user_id::text, '-', ''), 1, 15
    )
    ORDER BY profile.user_id
    FOR UPDATE
  LOOP
    UPDATE public.community_profiles AS profile
    SET nickname = public.community_private_system_nickname(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE profile.user_id = legacy_profile.user_id;
  END LOOP;
END;
$community_private_system_nickname_backfill$;

CREATE OR REPLACE FUNCTION public.community_assert_active_write_actor(
  p_actor_id uuid,
  p_allow_admin_override boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_assert_active_write_actor$
DECLARE
  actor_is_suspended boolean;
  actor_is_admin boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'community_actor_write_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'community_actor_write_actor_required'
      USING ERRCODE = '42501';
  END IF;

  -- Match account-deletion lock order before taking any public-table lock.
  PERFORM actor.id
  FROM auth.users AS actor
  WHERE actor.id = p_actor_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_actor_write_actor_not_found'
      USING ERRCODE = '42501';
  END IF;

  -- Older accounts can reach voting/cohort surfaces before visiting the
  -- profile endpoint. Canonicalize that previously-valid state first; every
  -- later check still locks and reads the authoritative suspension row.
  INSERT INTO public.community_profiles (user_id, nickname)
  VALUES (
    p_actor_id,
    public.community_private_system_nickname()
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- FOR UPDATE closes the suspension race: a concurrent moderation update
  -- either commits first and blocks this write, or waits until this write ends.
  SELECT COALESCE(profile.is_suspended, true)
  INTO actor_is_suspended
  FROM public.community_profiles AS profile
  WHERE profile.user_id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_actor_write_profile_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_allow_admin_override IS TRUE THEN
    SELECT COALESCE(profile.is_admin, false)
    INTO actor_is_admin
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;
  END IF;

  IF actor_is_suspended IS TRUE AND actor_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'community_actor_suspended'
      USING ERRCODE = '42501';
  END IF;
END;
$community_assert_active_write_actor$;

ALTER FUNCTION public.community_assert_active_write_actor(uuid, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_assert_active_write_actor(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_check_active_write_actor(
  p_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.community_assert_active_write_actor(p_actor_id, false);
  RETURN true;
END;
$function$;

-- Preserve the audited implementations under explicit service-operational
-- names.  Product code continues to call the original names, which are replaced
-- below by suspension-aware wrappers.  The service role retains the explicit
-- operational entry points for maintenance and incident response.
DO $rename_community_write_implementations$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.community_vote_post_service_operational(uuid,uuid,smallint)'
     ) IS NULL THEN
    ALTER FUNCTION public.community_vote_post(uuid, uuid, smallint)
      RENAME TO community_vote_post_service_operational;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.community_vote_comment_service_operational(uuid,uuid,smallint)'
     ) IS NULL THEN
    ALTER FUNCTION public.community_vote_comment(uuid, uuid, smallint)
      RENAME TO community_vote_comment_service_operational;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.community_toggle_bookmark_service_operational(uuid,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.community_toggle_bookmark(uuid, uuid)
      RENAME TO community_toggle_bookmark_service_operational;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.community_cast_poll_vote_service_operational(uuid,uuid,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
      RENAME TO community_cast_poll_vote_service_operational;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.community_assign_cohort_service_operational(uuid,integer,integer)'
     ) IS NULL THEN
    ALTER FUNCTION public.community_assign_cohort(uuid, integer, integer)
      RENAME TO community_assign_cohort_service_operational;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.community_upsert_cohort_contract_service_operational(uuid,uuid,uuid,text,text,integer,integer,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.community_upsert_cohort_contract(
      uuid, uuid, uuid, text, text, integer, integer, text
    ) RENAME TO community_upsert_cohort_contract_service_operational;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.claim_community_upload_session_service_operational(uuid,uuid,uuid,timestamp with time zone)'
     ) IS NULL THEN
    ALTER FUNCTION public.claim_community_upload_session(
      uuid, uuid, uuid, timestamptz
    ) RENAME TO claim_community_upload_session_service_operational;
  END IF;
END;
$rename_community_write_implementations$;

CREATE OR REPLACE FUNCTION public.community_vote_post(
  p_user_id uuid,
  p_post_id uuid,
  p_vote_type smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.community_assert_active_write_actor(p_user_id, false);
  PERFORM public.community_vote_post_service_operational(
    p_user_id, p_post_id, p_vote_type
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_vote_comment(
  p_user_id uuid,
  p_comment_id uuid,
  p_vote_type smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.community_assert_active_write_actor(p_user_id, false);
  PERFORM public.community_vote_comment_service_operational(
    p_user_id, p_comment_id, p_vote_type
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_toggle_bookmark(
  p_user_id uuid,
  p_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.community_assert_active_write_actor(p_user_id, false);
  RETURN public.community_toggle_bookmark_service_operational(
    p_user_id, p_post_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_cast_poll_vote(
  p_poll_id uuid,
  p_option_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.community_assert_active_write_actor(p_user_id, false);
  RETURN public.community_cast_poll_vote_service_operational(
    p_poll_id, p_option_id, p_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_assign_cohort(
  p_user_id uuid,
  p_year integer,
  p_month integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.community_assert_active_write_actor(p_user_id, false);
  RETURN public.community_assign_cohort_service_operational(
    p_user_id, p_year, p_month
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_upsert_cohort_contract(
  p_expected_user_id uuid,
  p_user_id uuid,
  p_room_id uuid,
  p_vendor_name text,
  p_category text,
  p_base_price integer,
  p_extra_price integer DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_expected_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'cohort_contract_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_user_id, false);
  RETURN public.community_upsert_cohort_contract_service_operational(
    p_expected_user_id,
    p_user_id,
    p_room_id,
    p_vendor_name,
    p_category,
    p_base_price,
    p_extra_price,
    p_notes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_community_upload_session(
  p_upload_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_stale_before timestamptz
)
RETURNS SETOF public.community_upload_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.community_assert_active_write_actor(p_user_id, false);
  RETURN QUERY
  SELECT *
  FROM public.claim_community_upload_session_service_operational(
    p_upload_id, p_user_id, p_claim_token, p_stale_before
  );
END;
$function$;

-- Content changes are actor-authorized and suspension-checked in the same
-- transaction.  The JSON patch has a closed key set so trusted moderation and
-- counter columns cannot be smuggled through this product RPC.
CREATE OR REPLACE FUNCTION public.community_update_post_for_actor(
  p_actor_id uuid,
  p_post_id uuid,
  p_patch jsonb,
  p_allow_admin_override boolean DEFAULT false
)
RETURNS SETOF public.community_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_author_id uuid;
  actor_is_admin boolean := false;
BEGIN
  IF p_post_id IS NULL
     OR p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_object_keys(p_patch) AS key(name)
       WHERE key.name NOT IN (
         'title', 'content', 'images', 'slides', 'visibility',
         'vendor_tags', 'tags', 'cost_data'
       )
     ) THEN
    RAISE EXCEPTION 'community_post_update_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_allow_admin_override IS TRUE THEN
    SELECT COALESCE(profile.is_admin, false)
    INTO actor_is_admin
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, actor_is_admin);

  SELECT post.author_id
  INTO target_author_id
  FROM public.community_posts AS post
  WHERE post.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_post_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF target_author_id IS DISTINCT FROM p_actor_id AND actor_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'community_post_update_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.community_posts AS post
  SET title = CASE WHEN p_patch ? 'title' THEN p_patch ->> 'title' ELSE post.title END,
      content = CASE WHEN p_patch ? 'content' THEN p_patch ->> 'content' ELSE post.content END,
      images = CASE
        WHEN p_patch ? 'images' THEN ARRAY(
          SELECT value
          FROM pg_catalog.jsonb_array_elements_text(p_patch -> 'images') AS item(value)
        )
        ELSE post.images
      END,
      slides = CASE
        WHEN p_patch ? 'slides' THEN NULLIF(p_patch -> 'slides', 'null'::jsonb)
        ELSE post.slides
      END,
      visibility = CASE
        WHEN p_patch ? 'visibility' THEN p_patch ->> 'visibility'
        ELSE post.visibility
      END,
      vendor_tags = CASE
        WHEN p_patch ? 'vendor_tags' THEN ARRAY(
          SELECT value::uuid
          FROM pg_catalog.jsonb_array_elements_text(p_patch -> 'vendor_tags') AS item(value)
        )
        ELSE post.vendor_tags
      END,
      tags = CASE
        WHEN p_patch ? 'tags' THEN ARRAY(
          SELECT value
          FROM pg_catalog.jsonb_array_elements_text(p_patch -> 'tags') AS item(value)
        )
        ELSE post.tags
      END,
      cost_data = CASE
        WHEN p_patch ? 'cost_data' THEN NULLIF(p_patch -> 'cost_data', 'null'::jsonb)
        ELSE post.cost_data
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE post.id = p_post_id
  RETURNING post.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_delete_post_for_actor(
  p_actor_id uuid,
  p_post_id uuid,
  p_allow_admin_override boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_author_id uuid;
  actor_is_admin boolean := false;
  deleted_id uuid;
BEGIN
  IF p_allow_admin_override IS TRUE THEN
    SELECT COALESCE(profile.is_admin, false)
    INTO actor_is_admin
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, actor_is_admin);

  SELECT post.author_id
  INTO target_author_id
  FROM public.community_posts AS post
  WHERE post.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_post_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF target_author_id IS DISTINCT FROM p_actor_id AND actor_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'community_post_delete_forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.community_posts AS post
  WHERE post.id = p_post_id
  RETURNING post.id INTO deleted_id;

  RETURN deleted_id IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_update_comment_for_actor(
  p_actor_id uuid,
  p_comment_id uuid,
  p_content text,
  p_allow_admin_override boolean DEFAULT false
)
RETURNS SETOF public.community_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_author_id uuid;
  target_is_deleted boolean;
  actor_is_admin boolean := false;
BEGIN
  IF p_content IS NULL OR pg_catalog.btrim(p_content) = '' THEN
    RAISE EXCEPTION 'community_comment_content_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_allow_admin_override IS TRUE THEN
    SELECT COALESCE(profile.is_admin, false)
    INTO actor_is_admin
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, actor_is_admin);

  SELECT comment.author_id, COALESCE(comment.is_deleted, false)
  INTO target_author_id, target_is_deleted
  FROM public.community_comments AS comment
  WHERE comment.id = p_comment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_comment_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF target_is_deleted IS TRUE THEN
    RAISE EXCEPTION 'community_comment_deleted'
      USING ERRCODE = '22023';
  END IF;

  IF target_author_id IS DISTINCT FROM p_actor_id AND actor_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'community_comment_update_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.community_comments AS comment
  SET content = p_content,
      updated_at = pg_catalog.clock_timestamp()
  WHERE comment.id = p_comment_id
  RETURNING comment.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_delete_comment_for_actor(
  p_actor_id uuid,
  p_comment_id uuid,
  p_allow_admin_override boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_author_id uuid;
  target_is_deleted boolean;
  actor_is_admin boolean := false;
BEGIN
  IF p_allow_admin_override IS TRUE THEN
    SELECT COALESCE(profile.is_admin, false)
    INTO actor_is_admin
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, actor_is_admin);

  SELECT comment.author_id, COALESCE(comment.is_deleted, false)
  INTO target_author_id, target_is_deleted
  FROM public.community_comments AS comment
  WHERE comment.id = p_comment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_comment_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF target_is_deleted IS TRUE THEN
    RAISE EXCEPTION 'community_comment_deleted'
      USING ERRCODE = '22023';
  END IF;

  IF target_author_id IS DISTINCT FROM p_actor_id AND actor_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'community_comment_delete_forbidden'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.community_comments AS comment
  SET is_deleted = true,
      content = '삭제된 댓글입니다.',
      updated_at = pg_catalog.clock_timestamp()
  WHERE comment.id = p_comment_id;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_update_profile_for_actor(
  p_actor_id uuid,
  p_nickname text,
  p_avatar_url text,
  p_update_avatar boolean
)
RETURNS SETOF public.community_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_nickname IS NULL OR pg_catalog.btrim(p_nickname) = '' THEN
    RAISE EXCEPTION 'community_profile_nickname_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, false);

  RETURN QUERY
  UPDATE public.community_profiles AS profile
  SET nickname = p_nickname,
      avatar_url = CASE
        WHEN p_update_avatar IS TRUE THEN p_avatar_url
        ELSE profile.avatar_url
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE profile.user_id = p_actor_id
  RETURNING profile.*;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community_actor_write_profile_required'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_submit_post_report_for_actor(
  p_actor_id uuid,
  p_post_id uuid,
  p_reason text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_author_id uuid;
  target_visibility text;
  target_under_review boolean;
  report_id uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'spam', 'abuse', 'ad', 'inappropriate', 'other'
  ) OR (p_description IS NOT NULL AND pg_catalog.char_length(p_description) > 1000) THEN
    RAISE EXCEPTION 'community_report_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, false);

  SELECT post.author_id, post.visibility, COALESCE(post.under_review, false)
  INTO target_author_id, target_visibility, target_under_review
  FROM public.community_posts AS post
  WHERE post.id = p_post_id
  FOR KEY SHARE;

  IF NOT FOUND
     OR target_author_id = p_actor_id
     OR (target_under_review IS TRUE AND target_author_id <> p_actor_id)
     OR target_visibility NOT IN ('public', 'members') THEN
    RAISE EXCEPTION 'community_report_target_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.community_reports (
    reporter_id, post_id, reason, description, status
  ) VALUES (
    p_actor_id, p_post_id, p_reason, p_description, 'pending'
  )
  RETURNING id INTO report_id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'report_id', report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_create_cohort_message_for_actor(
  p_actor_id uuid,
  p_room_id uuid,
  p_content text,
  p_thread_topic text,
  p_reply_to uuid DEFAULT NULL
)
RETURNS SETOF public.cohort_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_content IS NULL
     OR pg_catalog.btrim(p_content) = ''
     OR pg_catalog.char_length(p_content) > 2000
     OR p_thread_topic IS NULL
     OR p_thread_topic NOT IN ('price', 'review', 'concern', 'chat') THEN
    RAISE EXCEPTION 'cohort_message_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, false);

  PERFORM member.id
  FROM public.cohort_members AS member
  WHERE member.room_id = p_room_id
    AND member.user_id = p_actor_id
    AND member.is_active IS TRUE
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_membership_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_reply_to IS NOT NULL THEN
    PERFORM message.id
    FROM public.cohort_messages AS message
    WHERE message.id = p_reply_to
      AND message.room_id = p_room_id
      AND message.is_deleted IS FALSE
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cohort_message_reply_invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO public.cohort_messages (
    room_id, author_id, content, thread_topic, reply_to
  ) VALUES (
    p_room_id, p_actor_id, p_content, p_thread_topic, p_reply_to
  )
  RETURNING cohort_messages.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_create_cohort_timeline_event_for_actor(
  p_actor_id uuid,
  p_room_id uuid,
  p_event_type text,
  p_description text DEFAULT NULL
)
RETURNS SETOF public.cohort_timeline_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_event_type IS NULL OR p_event_type NOT IN (
    'venue_booked', 'studio_booked', 'dress_booked', 'makeup_booked',
    'tour_done', 'contract_done', 'invitation_sent', 'progress_update',
    'wedding_done'
  ) OR (p_description IS NOT NULL AND pg_catalog.char_length(p_description) > 500) THEN
    RAISE EXCEPTION 'cohort_timeline_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, false);

  PERFORM member.id
  FROM public.cohort_members AS member
  WHERE member.room_id = p_room_id
    AND member.user_id = p_actor_id
    AND member.is_active IS TRUE
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_membership_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.cohort_timeline_events (
    room_id, user_id, event_type, description
  ) VALUES (
    p_room_id, p_actor_id, p_event_type, p_description
  )
  RETURNING cohort_timeline_events.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_submit_cohort_member_report_for_actor(
  p_actor_id uuid,
  p_room_id uuid,
  p_reported_user_id uuid,
  p_reason text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  pending_report_count integer;
BEGIN
  IF p_actor_id IS NULL
     OR p_reported_user_id IS NULL
     OR p_actor_id = p_reported_user_id
     OR p_reason IS NULL
     OR p_reason NOT IN ('spam', 'abuse', 'ad', 'inappropriate', 'other')
     OR (p_description IS NOT NULL AND pg_catalog.char_length(p_description) > 1000) THEN
    RAISE EXCEPTION 'cohort_member_report_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, false);

  PERFORM member.id
  FROM public.cohort_members AS member
  WHERE member.room_id = p_room_id
    AND member.user_id = p_actor_id
    AND member.is_active IS TRUE
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_member_report_membership_required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM member.id
  FROM public.cohort_members AS member
  WHERE member.room_id = p_room_id
    AND member.user_id = p_reported_user_id
    AND member.is_active IS TRUE
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_member_report_membership_required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.cohort_member_reports (
    room_id, reporter_id, reported_user_id, reason, description, status
  ) VALUES (
    p_room_id, p_actor_id, p_reported_user_id, p_reason, p_description, 'pending'
  );

  SELECT pg_catalog.count(*)::integer
  INTO pending_report_count
  FROM public.cohort_member_reports AS report
  WHERE report.room_id = p_room_id
    AND report.reported_user_id = p_reported_user_id
    AND report.status = 'pending';

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'report_count', pending_report_count,
    'review_required', pending_report_count >= 5
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_create_upload_session_for_actor(
  p_actor_id uuid,
  p_upload_id uuid,
  p_staging_path text,
  p_final_bucket text,
  p_final_path text,
  p_declared_mime_type text,
  p_declared_size bigint,
  p_expires_at timestamptz
)
RETURNS SETOF public.community_upload_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_upload_id IS NULL
     OR p_staging_path IS NULL
     OR p_final_bucket IS NULL
     OR p_final_path IS NULL
     OR p_declared_mime_type IS NULL
     OR p_declared_size IS NULL
     OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'community_upload_session_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, false);

  RETURN QUERY
  INSERT INTO public.community_upload_sessions (
    id,
    user_id,
    staging_path,
    final_bucket,
    final_path,
    declared_mime_type,
    declared_size,
    status,
    expires_at
  ) VALUES (
    p_upload_id,
    p_actor_id,
    p_staging_path,
    p_final_bucket,
    p_final_path,
    p_declared_mime_type,
    p_declared_size,
    'issued',
    p_expires_at
  )
  RETURNING community_upload_sessions.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_complete_upload_session_for_actor(
  p_actor_id uuid,
  p_upload_id uuid,
  p_claim_token uuid,
  p_actual_size bigint,
  p_actual_mime_type text,
  p_content_sha256 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  completed_id uuid;
  v_completed_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_upload_id IS NULL
     OR p_claim_token IS NULL
     OR p_actual_size IS NULL
     OR p_actual_size <= 0
     OR p_actual_mime_type IS NULL
     OR p_content_sha256 IS NULL
     OR p_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'community_upload_completion_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.community_assert_active_write_actor(p_actor_id, false);

  UPDATE public.community_upload_sessions AS session
  SET status = 'completed',
      actual_size = p_actual_size,
      actual_mime_type = p_actual_mime_type,
      content_sha256 = p_content_sha256,
      sanitized_at = v_completed_at,
      completed_at = v_completed_at,
      claim_token = NULL,
      updated_at = v_completed_at,
      staging_deleted_at = v_completed_at
  WHERE session.id = p_upload_id
    AND session.user_id = p_actor_id
    AND session.status = 'finalizing'
    AND session.claim_token = p_claim_token
  RETURNING session.id INTO completed_id;

  RETURN completed_id IS NOT NULL;
END;
$function$;

-- Restore the original public API names as service-only product entry points.
DO $community_write_function_privileges$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.community_check_active_write_actor(uuid)',
    'public.community_vote_post(uuid,uuid,smallint)',
    'public.community_vote_comment(uuid,uuid,smallint)',
    'public.community_toggle_bookmark(uuid,uuid)',
    'public.community_cast_poll_vote(uuid,uuid,uuid)',
    'public.community_assign_cohort(uuid,integer,integer)',
    'public.community_upsert_cohort_contract(uuid,uuid,uuid,text,text,integer,integer,text)',
    'public.claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)',
    'public.community_update_post_for_actor(uuid,uuid,jsonb,boolean)',
    'public.community_delete_post_for_actor(uuid,uuid,boolean)',
    'public.community_update_comment_for_actor(uuid,uuid,text,boolean)',
    'public.community_delete_comment_for_actor(uuid,uuid,boolean)',
    'public.community_update_profile_for_actor(uuid,text,text,boolean)',
    'public.community_submit_post_report_for_actor(uuid,uuid,text,text)',
    'public.community_create_cohort_message_for_actor(uuid,uuid,text,text,uuid)',
    'public.community_create_cohort_timeline_event_for_actor(uuid,uuid,text,text)',
    'public.community_submit_cohort_member_report_for_actor(uuid,uuid,uuid,text,text)',
    'public.community_create_upload_session_for_actor(uuid,uuid,text,text,text,text,bigint,timestamp with time zone)',
    'public.community_complete_upload_session_for_actor(uuid,uuid,uuid,bigint,text,text)'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO postgres', signature);
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      signature
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      signature
    );
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'public.community_vote_post_service_operational(uuid,uuid,smallint)',
    'public.community_vote_comment_service_operational(uuid,uuid,smallint)',
    'public.community_toggle_bookmark_service_operational(uuid,uuid)',
    'public.community_cast_poll_vote_service_operational(uuid,uuid,uuid)',
    'public.community_assign_cohort_service_operational(uuid,integer,integer)',
    'public.community_upsert_cohort_contract_service_operational(uuid,uuid,uuid,text,text,integer,integer,text)',
    'public.claim_community_upload_session_service_operational(uuid,uuid,uuid,timestamp with time zone)'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO postgres', signature);
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      signature
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      signature
    );
  END LOOP;
END;
$community_write_function_privileges$;

DO $community_actor_write_fence_postcondition$
DECLARE
  unsafe_signature text;
  wrapper_without_gate text;
BEGIN
  SELECT signature
  INTO unsafe_signature
  FROM (VALUES
    ('public.community_check_active_write_actor(uuid)'),
    ('public.community_vote_post(uuid,uuid,smallint)'),
    ('public.community_vote_comment(uuid,uuid,smallint)'),
    ('public.community_toggle_bookmark(uuid,uuid)'),
    ('public.community_cast_poll_vote(uuid,uuid,uuid)'),
    ('public.community_assign_cohort(uuid,integer,integer)'),
    ('public.community_upsert_cohort_contract(uuid,uuid,uuid,text,text,integer,integer,text)'),
    ('public.claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)'),
    ('public.community_update_post_for_actor(uuid,uuid,jsonb,boolean)'),
    ('public.community_delete_post_for_actor(uuid,uuid,boolean)'),
    ('public.community_update_comment_for_actor(uuid,uuid,text,boolean)'),
    ('public.community_delete_comment_for_actor(uuid,uuid,boolean)'),
    ('public.community_update_profile_for_actor(uuid,text,text,boolean)'),
    ('public.community_submit_post_report_for_actor(uuid,uuid,text,text)'),
    ('public.community_create_cohort_message_for_actor(uuid,uuid,text,text,uuid)'),
    ('public.community_create_cohort_timeline_event_for_actor(uuid,uuid,text,text)'),
    ('public.community_submit_cohort_member_report_for_actor(uuid,uuid,uuid,text,text)'),
    ('public.community_create_upload_session_for_actor(uuid,uuid,text,text,text,text,bigint,timestamp with time zone)'),
    ('public.community_complete_upload_session_for_actor(uuid,uuid,uuid,bigint,text,text)')
  ) AS expected(signature)
  WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL
     OR pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
  LIMIT 1;

  IF unsafe_signature IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_ACTOR_WRITE_FENCE_PRIVILEGE_INVALID: %', unsafe_signature
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.community_private_system_nickname()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.community_private_system_nickname()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.community_private_system_nickname()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_PRIVATE_SYSTEM_NICKNAME_PRIVILEGE_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'community_profiles'
      AND trigger.tgname = 'community_profiles_rewrite_legacy_system_nickname_insert'
      AND trigger.tgenabled <> 'D'
      AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_PRIVATE_SYSTEM_NICKNAME_TRIGGER_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    WHERE profile.nickname = 'user-' || pg_catalog.substr(
      pg_catalog.replace(profile.user_id::text, '-', ''), 1, 8
    )
       OR profile.nickname = 'user-' || pg_catalog.substr(
      pg_catalog.replace(profile.user_id::text, '-', ''), 1, 15
    )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_LEGACY_SYSTEM_NICKNAME_BACKFILL_INCOMPLETE'
      USING ERRCODE = '55000';
  END IF;

  SELECT proc.oid::regprocedure::text
  INTO wrapper_without_gate
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname IN (
      'community_check_active_write_actor',
      'community_vote_post',
      'community_vote_comment',
      'community_toggle_bookmark',
      'community_cast_poll_vote',
      'community_assign_cohort',
      'community_upsert_cohort_contract',
      'claim_community_upload_session',
      'community_update_post_for_actor',
      'community_delete_post_for_actor',
      'community_update_comment_for_actor',
      'community_delete_comment_for_actor',
      'community_update_profile_for_actor',
      'community_submit_post_report_for_actor',
      'community_create_cohort_message_for_actor',
      'community_create_cohort_timeline_event_for_actor',
      'community_submit_cohort_member_report_for_actor',
      'community_create_upload_session_for_actor',
      'community_complete_upload_session_for_actor'
    )
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(proc.oid),
      'community_assert_active_write_actor'
    ) = 0
  LIMIT 1;

  IF wrapper_without_gate IS NOT NULL THEN
    RAISE EXCEPTION 'COMMUNITY_ACTOR_WRITE_FENCE_GATE_MISSING: %', wrapper_without_gate
      USING ERRCODE = '55000';
  END IF;
END;
$community_actor_write_fence_postcondition$;

COMMENT ON FUNCTION public.community_private_system_nickname() IS
  'Owner-only generator for opaque 20-character community system nicknames that do not derive from Auth identifiers.';
COMMENT ON FUNCTION public.community_rewrite_legacy_system_nickname_on_insert() IS
  'Insert-only privacy fence that rewrites exact legacy Auth-UUID-derived system nicknames without changing user nickname updates.';
COMMENT ON FUNCTION public.community_assert_active_write_actor(uuid, boolean) IS
  'Owner-only transaction-local actor gate. Locks the profile and rejects missing or suspended product actors; validated admins may override only in moderation wrappers.';
COMMENT ON FUNCTION public.community_vote_post(uuid, uuid, smallint) IS
  'Service-only product vote entry point with fail-closed suspended-actor enforcement.';
COMMENT ON FUNCTION public.community_assign_cohort(uuid, integer, integer) IS
  'Service-only product cohort assignment entry point with fail-closed suspended-actor enforcement.';

COMMIT;
