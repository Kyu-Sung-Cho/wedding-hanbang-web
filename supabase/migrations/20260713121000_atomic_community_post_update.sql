-- Make community post updates a single, current-permission transaction.
-- The RPC accepts only the seven active patch fields, locks before reading the
-- current row, and treats an exact replay as an idempotent no-op.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.community_update_post(
  p_actor_id uuid,
  p_post_id uuid,
  p_patch jsonb
)
RETURNS TABLE(
  post_id uuid,
  updated boolean,
  viewer_is_author boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  target_post public.community_posts%ROWTYPE;
  actor_is_admin boolean := false;
  next_title text;
  next_content text;
  next_category text;
  next_visibility text;
  next_tags text[];
  next_ad_disclosure text;
  next_sponsorship_detail text;
  changed_rows integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'community post update requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL OR p_post_id IS NULL OR p_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid community post update input'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key NOT IN (
      'title',
      'content',
      'category',
      'visibility',
      'tags',
      'ad_disclosure',
      'sponsorship_detail'
    )
  ) THEN
    RAISE EXCEPTION 'unsupported community post update field'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'title' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'title') <> 'string'
       OR pg_catalog.char_length(p_patch ->> 'title') > 200
       OR pg_catalog.btrim(p_patch ->> 'title') = '' THEN
      RAISE EXCEPTION 'invalid community post title'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'content' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'content') <> 'string'
       OR pg_catalog.char_length(p_patch ->> 'content') > 50000
       OR pg_catalog.btrim(p_patch ->> 'content') = '' THEN
      RAISE EXCEPTION 'invalid community post content'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'category' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'category') <> 'string'
       OR (p_patch ->> 'category') NOT IN (
         'is_normal', 'tour_review', 'tips_v2', 'ama', 'free'
       ) THEN
      RAISE EXCEPTION 'invalid community post category'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'visibility' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'visibility') <> 'string'
       OR (p_patch ->> 'visibility') NOT IN ('public', 'members', 'draft') THEN
      RAISE EXCEPTION 'invalid community post visibility'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'ad_disclosure' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'ad_disclosure') <> 'string'
       OR (p_patch ->> 'ad_disclosure') NOT IN ('general', 'sponsored', 'ad') THEN
      RAISE EXCEPTION 'invalid community post ad disclosure'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'sponsorship_detail' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'sponsorship_detail') <> 'string'
       OR pg_catalog.char_length(p_patch ->> 'sponsorship_detail') > 500 THEN
      RAISE EXCEPTION 'invalid community post sponsorship detail'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'tags' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'tags') <> 'array'
       OR pg_catalog.jsonb_array_length(p_patch -> 'tags') > 10
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_patch -> 'tags') AS tag(value)
         WHERE pg_catalog.jsonb_typeof(tag.value) <> 'string'
            OR pg_catalog.char_length(tag.value #>> '{}') > 30
            OR pg_catalog.btrim(tag.value #>> '{}') = ''
       ) THEN
      RAISE EXCEPTION 'invalid community post tags'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT post.*
    INTO target_post
    FROM public.community_posts AS post
   WHERE post.id = p_post_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'community post not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF target_post.author_id IS DISTINCT FROM p_actor_id THEN
    SELECT COALESCE(profile.is_admin, false)
      INTO actor_is_admin
      FROM public.profiles AS profile
     WHERE profile.id = p_actor_id
     FOR SHARE;

    IF NOT COALESCE(actor_is_admin, false) THEN
      RAISE EXCEPTION 'community post update forbidden'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  next_title := target_post.title;
  next_content := target_post.content;
  next_category := target_post.category;
  next_visibility := target_post.visibility;
  next_tags := target_post.tags;
  next_ad_disclosure := target_post.ad_disclosure;
  next_sponsorship_detail := target_post.sponsorship_detail;

  IF p_patch ? 'title' THEN
    next_title := p_patch ->> 'title';
  END IF;
  IF p_patch ? 'content' THEN
    next_content := p_patch ->> 'content';
  END IF;
  IF p_patch ? 'category' THEN
    next_category := p_patch ->> 'category';
  END IF;
  IF p_patch ? 'visibility' THEN
    next_visibility := p_patch ->> 'visibility';
  END IF;
  IF p_patch ? 'tags' THEN
    SELECT COALESCE(
      pg_catalog.array_agg(tag.value ORDER BY tag.ordinality),
      ARRAY[]::text[]
    )
      INTO next_tags
      FROM pg_catalog.jsonb_array_elements_text(p_patch -> 'tags')
        WITH ORDINALITY AS tag(value, ordinality);
  END IF;
  IF p_patch ? 'ad_disclosure' THEN
    next_ad_disclosure := p_patch ->> 'ad_disclosure';
  END IF;
  IF p_patch ? 'sponsorship_detail' THEN
    next_sponsorship_detail := p_patch ->> 'sponsorship_detail';
  END IF;

  IF p_patch ? 'ad_disclosure' OR p_patch ? 'sponsorship_detail' THEN
    IF next_ad_disclosure = 'sponsored' THEN
      IF next_sponsorship_detail IS NULL
         OR pg_catalog.char_length(pg_catalog.btrim(next_sponsorship_detail)) < 5
         OR pg_catalog.char_length(next_sponsorship_detail) > 500 THEN
        RAISE EXCEPTION 'sponsored post requires sponsorship detail'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF p_patch ? 'sponsorship_detail' THEN
        RAISE EXCEPTION 'sponsorship detail requires sponsored disclosure'
          USING ERRCODE = '22023';
      END IF;
      -- Switching away from sponsored must not leave stale disclosure text.
      next_sponsorship_detail := NULL;
    END IF;
  END IF;

  IF next_title IS NOT DISTINCT FROM target_post.title
     AND next_content IS NOT DISTINCT FROM target_post.content
     AND next_category IS NOT DISTINCT FROM target_post.category
     AND next_visibility IS NOT DISTINCT FROM target_post.visibility
     AND next_tags IS NOT DISTINCT FROM target_post.tags
     AND next_ad_disclosure IS NOT DISTINCT FROM target_post.ad_disclosure
     AND next_sponsorship_detail IS NOT DISTINCT FROM target_post.sponsorship_detail THEN
    RETURN QUERY SELECT p_post_id, false, target_post.author_id = p_actor_id;
    RETURN;
  END IF;

  UPDATE public.community_posts AS post
     SET title = next_title,
         content = next_content,
         category = next_category,
         visibility = next_visibility,
         tags = next_tags,
         ad_disclosure = next_ad_disclosure,
         sponsorship_detail = next_sponsorship_detail,
         updated_at = pg_catalog.clock_timestamp()
   WHERE post.id = p_post_id
     AND post.author_id = target_post.author_id;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'community post update conflict'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT p_post_id, true, target_post.author_id = p_actor_id;
END;
$function$;

ALTER FUNCTION public.community_update_post(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_update_post(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_update_post(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.community_update_post(uuid, uuid, jsonb) IS
  'Service-only atomic community post patch. Locks the row, checks current author/admin permission, validates the exact active schema, and makes exact retries no-ops.';

DO $assert_atomic_community_post_update$
DECLARE
  function_oid oid;
  function_source text;
BEGIN
  function_oid := pg_catalog.to_regprocedure(
    'public.community_update_post(uuid,uuid,jsonb)'
  );

  IF function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = function_oid
      AND procedure_row.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig =
        ARRAY['search_path=""', 'row_security=off']::text[]
      AND procedure_row.pronargs = 3
      AND pg_catalog.pg_get_function_arguments(procedure_row.oid) =
        'p_actor_id uuid, p_post_id uuid, p_patch jsonb'
      AND pg_catalog.pg_get_function_result(procedure_row.oid) =
        'TABLE(post_id uuid, updated boolean, viewer_is_author boolean)'
      AND pg_catalog.has_function_privilege(
        'service_role', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated', procedure_row.oid, 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_UPDATE_FUNCTION_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE procedure_row.oid = function_oid
      AND (
        privilege_row.privilege_type <> 'EXECUTE'
        OR privilege_row.grantee = 0
        OR granted_role.rolname NOT IN ('postgres', 'service_role')
      )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_UPDATE_FUNCTION_ACL_NOT_EXACT'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    JOIN pg_catalog.pg_roles AS grantor_role
      ON grantor_role.oid = privilege_row.grantor
    WHERE procedure_row.oid = function_oid
      AND granted_role.rolname = 'service_role'
      AND grantor_role.rolname = 'postgres'
      AND privilege_row.privilege_type = 'EXECUTE'
      AND NOT privilege_row.is_grantable
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_POST_UPDATE_SERVICE_EXECUTE_GRANT_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(function_oid)
    INTO function_source;
  IF pg_catalog.position('FOR UPDATE' IN function_source) = 0
     OR pg_catalog.position('FOR SHARE' IN function_source) = 0
     OR pg_catalog.position('IS NOT DISTINCT FROM' IN function_source) = 0
     OR pg_catalog.position('community post update requires service_role' IN function_source) = 0 THEN
    RAISE EXCEPTION 'COMMUNITY_POST_UPDATE_SOURCE_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$assert_atomic_community_post_update$;

COMMIT;
