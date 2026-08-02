-- Keep photo-like state behind the authenticated server boundary.
--
-- The legacy owner policy let any authenticated client persist arbitrary HTTPS
-- URLs and bypass the route-level limiter.  Existing non-canonical rows are
-- retained (rather than destructively rewritten) but become unreachable; both
-- reads and writes now project only photos that are still published by an
-- approved vendor.

BEGIN;

ALTER TABLE public.vendor_photo_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_photo_likes FORCE ROW LEVEL SECURITY;

DO $drop_vendor_photo_like_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vendor_photo_likes'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.vendor_photo_likes',
      policy_row.policyname
    );
  END LOOP;
END;
$drop_vendor_photo_like_policies$;

REVOKE ALL ON TABLE public.vendor_photo_likes
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vendor_photo_likes TO service_role;

-- NOT VALID preserves potentially old URL rows while enforcing the invariant
-- for every future direct owner write. The only supported writer below also
-- checks the URL against the current published vendor catalog.
ALTER TABLE public.vendor_photo_likes
  DROP CONSTRAINT IF EXISTS vendor_photo_likes_https_url_check;
ALTER TABLE public.vendor_photo_likes
  ADD CONSTRAINT vendor_photo_likes_https_url_check CHECK (
    photo_url IS NOT NULL
    AND pg_catalog.char_length(photo_url) BETWEEN 1 AND 2048
    AND photo_url LIKE 'https://%'
    AND photo_url !~ '[[:space:][:cntrl:]]'
    AND pg_catalog.split_part(
          pg_catalog.split_part(photo_url, '://', 2),
          '/',
          1
        ) <> ''
    AND pg_catalog.split_part(
          pg_catalog.split_part(photo_url, '://', 2),
          '/',
          1
        ) NOT LIKE '%@%'
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.vendor_photo_is_published_v1(
  p_vendor_id uuid,
  p_photo_url text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $vendor_photo_is_published_v1$
  SELECT EXISTS (
    SELECT 1
    FROM public.vendors AS vendor
    WHERE vendor.id = p_vendor_id
      AND vendor.status = 'approved'
      AND (
        vendor.thumbnail_url = p_photo_url
        OR EXISTS (
          SELECT 1
          FROM public.vendor_images AS image
          WHERE image.vendor_id = vendor.id
            AND image.image_url = p_photo_url
        )
        OR EXISTS (
          SELECT 1
          FROM public.vendor_products AS product
          WHERE product.vendor_id = vendor.id
            AND product.is_active IS TRUE
            AND p_photo_url = ANY(
              COALESCE(product.images, ARRAY[]::text[])
            )
        )
      )
  );
$vendor_photo_is_published_v1$;

CREATE OR REPLACE FUNCTION public.toggle_vendor_photo_like_service_v1(
  p_user_id uuid,
  p_vendor_id uuid,
  p_photo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $toggle_vendor_photo_like_service_v1$
DECLARE
  v_existing_id uuid;
  v_total_likes integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'vendor_photo_like_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_vendor_id IS NULL OR p_photo_url IS NULL
     OR pg_catalog.char_length(p_photo_url) NOT BETWEEN 1 AND 2048
     OR p_photo_url NOT LIKE 'https://%'
     OR p_photo_url ~ '[[:space:][:cntrl:]]'
     OR pg_catalog.split_part(
          pg_catalog.split_part(p_photo_url, '://', 2), '/', 1
        ) = ''
     OR pg_catalog.split_part(
          pg_catalog.split_part(p_photo_url, '://', 2), '/', 1
        ) LIKE '%@%'
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_PHOTO_REFERENCE'
    );
  END IF;

  -- Serializing on the authenticated actor makes a concurrent toggle
  -- deterministic and doubles as a fail-closed identity existence check.
  PERFORM actor.id
  FROM auth.users AS actor
  WHERE actor.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'error_code', 'ACTOR_NOT_FOUND'
    );
  END IF;

  IF NOT public.vendor_photo_is_published_v1(p_vendor_id, p_photo_url) THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'error_code', 'PHOTO_NOT_PUBLISHED'
    );
  END IF;

  SELECT photo_like.id
  INTO v_existing_id
  FROM public.vendor_photo_likes AS photo_like
  WHERE photo_like.user_id = p_user_id
    AND photo_like.vendor_id = p_vendor_id
    AND photo_like.photo_url = p_photo_url
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM public.vendor_photo_likes
    WHERE id = v_existing_id;

    RETURN pg_catalog.jsonb_build_object('success', true, 'liked', false);
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_total_likes
  FROM public.vendor_photo_likes AS photo_like
  WHERE photo_like.user_id = p_user_id;

  IF v_total_likes >= 500 THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'error_code', 'PHOTO_LIKE_LIMIT_REACHED'
    );
  END IF;

  INSERT INTO public.vendor_photo_likes (user_id, vendor_id, photo_url)
  VALUES (p_user_id, p_vendor_id, p_photo_url);

  RETURN pg_catalog.jsonb_build_object('success', true, 'liked', true);
END;
$toggle_vendor_photo_like_service_v1$;

CREATE OR REPLACE FUNCTION public.list_vendor_photo_likes_service_v1(
  p_user_id uuid,
  p_vendor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $list_vendor_photo_likes_service_v1$
DECLARE
  v_liked_photos jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'vendor_photo_like_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_vendor_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_PHOTO_REFERENCE'
    );
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(visible_like.photo_url ORDER BY visible_like.created_at DESC),
    '[]'::jsonb
  )
  INTO v_liked_photos
  FROM (
    SELECT photo_like.photo_url, photo_like.created_at
    FROM public.vendor_photo_likes AS photo_like
    WHERE photo_like.user_id = p_user_id
      AND photo_like.vendor_id = p_vendor_id
      AND public.vendor_photo_is_published_v1(
        photo_like.vendor_id,
        photo_like.photo_url
      )
    ORDER BY photo_like.created_at DESC
    LIMIT 500
  ) AS visible_like;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'liked_photos', v_liked_photos
  );
END;
$list_vendor_photo_likes_service_v1$;

ALTER FUNCTION public.vendor_photo_is_published_v1(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.toggle_vendor_photo_like_service_v1(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.list_vendor_photo_likes_service_v1(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.vendor_photo_is_published_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.toggle_vendor_photo_like_service_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_vendor_photo_likes_service_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.toggle_vendor_photo_like_service_v1(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_vendor_photo_likes_service_v1(uuid, uuid)
  TO service_role;

DO $vendor_photo_like_postflight$
DECLARE
  target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
  LOOP
    IF pg_catalog.has_table_privilege(
         target_role,
         'public.vendor_photo_likes',
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
    THEN
      RAISE EXCEPTION 'VENDOR_PHOTO_LIKE_DIRECT_TABLE_PRIVILEGE_REMAINS: %',
        target_role
        USING ERRCODE = '55000';
    END IF;

    IF pg_catalog.has_function_privilege(
         target_role,
         'public.toggle_vendor_photo_like_service_v1(uuid,uuid,text)',
         'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         target_role,
         'public.list_vendor_photo_likes_service_v1(uuid,uuid)',
         'EXECUTE'
       )
    THEN
      RAISE EXCEPTION 'VENDOR_PHOTO_LIKE_SERVICE_RPC_EXPOSED: %', target_role
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.toggle_vendor_photo_like_service_v1(uuid,uuid,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.list_vendor_photo_likes_service_v1(uuid,uuid)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'VENDOR_PHOTO_LIKE_SERVICE_RPC_UNAVAILABLE'
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_photo_like_postflight$;

COMMENT ON FUNCTION public.toggle_vendor_photo_like_service_v1(uuid, uuid, text) IS
  'Service-only atomic photo-like toggle. Accepts only currently published HTTPS vendor media and caps each actor at 500 rows.';
COMMENT ON FUNCTION public.list_vendor_photo_likes_service_v1(uuid, uuid) IS
  'Service-only projection of an actor''s likes that still correspond to currently published approved-vendor media.';

COMMIT;
