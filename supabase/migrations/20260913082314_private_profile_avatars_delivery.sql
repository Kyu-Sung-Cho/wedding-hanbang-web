BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Hosted Storage는 별도 소유자다. 정식 플랫폼 작업으로 먼저 설치한 보호 정책만 검증한다.
DO $storage_policy_ready$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'storage.objects'::regclass AND p.polcmd = '*' AND NOT p.polpermissive
      AND (SELECT array_agg(pg_catalog.pg_get_userbyid(r) ORDER BY pg_catalog.pg_get_userbyid(r)) FROM unnest(p.polroles) r)
        = ARRAY['anon','authenticated']::name[]
      AND pg_catalog.pg_get_expr(p.polqual,p.polrelid) = '(bucket_id <> ''profile-avatars''::text)'
      AND pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) = '(bucket_id <> ''profile-avatars''::text)'
  ) THEN RAISE EXCEPTION 'PROFILE_AVATAR_STORAGE_POLICY_REQUIRED'; END IF;
END;
$storage_policy_ready$;

CREATE TABLE public.profile_avatars (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('initial', 'emoji', 'photo')),
  emoji text,
  object_path text,
  revision uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT profile_avatar_shape CHECK (
    (kind = 'initial' AND emoji IS NULL AND object_path IS NULL)
    OR (kind = 'emoji' AND emoji IS NOT NULL AND char_length(emoji) BETWEEN 1 AND 16 AND object_path IS NULL)
    OR (kind = 'photo' AND emoji IS NULL AND object_path IS NOT NULL AND object_path = user_id::text || '/' || revision::text || '.webp')
  )
);
-- bytes가 생성되기 전부터 경로를 등록한다. 계정 삭제는 진행 중 업로드의 만료도 기다린다.
CREATE TABLE public.profile_avatar_assets (
  revision uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  upload_until timestamptz NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
  committed_at timestamptz,
  CHECK (object_path = user_id::text || '/' || revision::text || '.webp')
);
CREATE INDEX profile_avatar_assets_user ON public.profile_avatar_assets(user_id);
ALTER TABLE public.profile_avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_avatar_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_avatars, public.profile_avatar_assets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.profile_avatars, public.profile_avatar_assets TO service_role;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-avatars', 'profile-avatars', false, 1048576, ARRAY['image/webp'])
ON CONFLICT (id) DO NOTHING;
DO $bucket_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'profile-avatars' AND public = false
    AND file_size_limit = 1048576 AND allowed_mime_types = ARRAY['image/webp']) THEN
    RAISE EXCEPTION 'PROFILE_AVATAR_BUCKET_CONTRACT_MISMATCH';
  END IF;
END;
$bucket_check$;

CREATE FUNCTION public.register_profile_avatar_asset(p_user_id uuid, p_revision uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $register_avatar$
DECLARE v_path text;
BEGIN
  IF p_user_id IS NULL OR p_revision IS NULL THEN RAISE EXCEPTION 'PROFILE_AVATAR_INVALID'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id = p_user_id AND status <> 'completed') THEN
    RAISE EXCEPTION 'PROFILE_AVATAR_DELETION_PENDING';
  END IF;
  v_path := p_user_id::text || '/' || p_revision::text || '.webp';
  INSERT INTO public.profile_avatar_assets(revision, user_id, object_path) VALUES (p_revision, p_user_id, v_path);
  RETURN jsonb_build_object('object_path', v_path);
END;
$register_avatar$;

CREATE FUNCTION public.save_profile_avatar(p_user_id uuid, p_kind text, p_emoji text, p_revision uuid, p_expected_revision uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $save_avatar$
DECLARE v_current public.profile_avatars%ROWTYPE; v_path text;
BEGIN
  IF p_user_id IS NULL OR p_revision IS NULL OR p_kind IS NULL OR p_kind NOT IN ('initial','emoji','photo')
    OR (p_kind <> 'emoji' AND p_emoji IS NOT NULL)
    OR (p_kind = 'emoji' AND (p_emoji IS NULL OR char_length(p_emoji) NOT BETWEEN 1 AND 16)) THEN
    RAISE EXCEPTION 'PROFILE_AVATAR_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id = p_user_id AND status <> 'completed') THEN
    RAISE EXCEPTION 'PROFILE_AVATAR_DELETION_PENDING';
  END IF;
  SELECT * INTO v_current FROM public.profile_avatars WHERE user_id = p_user_id FOR UPDATE;
  IF v_current.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'PROFILE_AVATAR_CONFLICT'; END IF;
  IF p_kind = 'photo' THEN
    UPDATE public.profile_avatar_assets SET committed_at = clock_timestamp()
      WHERE revision = p_revision AND user_id = p_user_id AND committed_at IS NULL AND upload_until > clock_timestamp()
      RETURNING object_path INTO v_path;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_AVATAR_ASSET_INVALID'; END IF;
  END IF;
  INSERT INTO public.profile_avatars(user_id, kind, emoji, object_path, revision)
  VALUES (p_user_id, p_kind, p_emoji, v_path, p_revision)
  ON CONFLICT (user_id) DO UPDATE SET kind = EXCLUDED.kind, emoji = EXCLUDED.emoji,
    object_path = EXCLUDED.object_path, revision = EXCLUDED.revision, updated_at = clock_timestamp()
  RETURNING * INTO v_current;
  RETURN to_jsonb(v_current);
END;
$save_avatar$;
REVOKE ALL ON FUNCTION public.register_profile_avatar_asset(uuid,uuid), public.save_profile_avatar(uuid,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_profile_avatar_asset(uuid,uuid), public.save_profile_avatar(uuid,text,text,uuid,uuid) TO service_role;

-- 같은 SQL 스냅샷에서 본인과 현재 상호 연결된 상대만 반환한다.
CREATE FUNCTION public.read_profile_avatar_snapshot(p_user_id uuid)
RETURNS SETOF public.profile_avatars LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $avatar_snapshot$
  SELECT avatar.* FROM public.profile_avatars avatar
  WHERE avatar.user_id = p_user_id
     OR avatar.user_id IN (
       SELECT partner.id
       FROM public.profiles owner
       JOIN public.couples couple ON couple.id = owner.couple_id
       JOIN public.profiles partner ON partner.couple_id = owner.couple_id
         AND partner.id = CASE WHEN couple.bride_id = owner.id THEN couple.groom_id
                               WHEN couple.groom_id = owner.id THEN couple.bride_id END
       WHERE owner.id = p_user_id AND partner.id <> owner.id
     );
$avatar_snapshot$;
REVOKE ALL ON FUNCTION public.read_profile_avatar_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_profile_avatar_snapshot(uuid) TO service_role;

ALTER TABLE public.account_deletion_media_manifest DROP CONSTRAINT account_deletion_media_bucket;
ALTER TABLE public.account_deletion_media_manifest ADD CONSTRAINT account_deletion_media_bucket CHECK (bucket IN ('community-media-staging','community-images','community-videos','chat-image','profile-avatars'));
ALTER TABLE public.account_deletion_media_manifest DROP CONSTRAINT account_deletion_media_source;
ALTER TABLE public.account_deletion_media_manifest ADD CONSTRAINT account_deletion_media_source CHECK (source IN ('session_staging','session_final','legacy_prefix','quarantine','profile_avatar'));

-- The replacement function below retains the existing job claim, scope, and source proofs.

CREATE OR REPLACE FUNCTION public.replace_account_deletion_media_manifest(
  p_job_id uuid,
  p_claim_token uuid,
  p_manifest jsonb
)
RETURNS SETOF public.account_deletion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $replace_manifest$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_item jsonb;
  v_bucket text;
  v_path text;
  v_source text;
  v_not_before timestamptz;
  v_session public.community_upload_sessions%ROWTYPE;
  v_quarantine_count integer;
  v_ready_after timestamptz;
BEGIN
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE id = p_job_id
     AND status = 'inventorying'
     AND claim_token = p_claim_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF p_manifest IS NULL
     OR jsonb_typeof(p_manifest) <> 'array'
     OR jsonb_array_length(p_manifest) > 10000 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.account_deletion_media_manifest WHERE job_id = p_job_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_manifest)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR (v_item - 'bucket' - 'path' - 'source' - 'not_before') <> '{}'::jsonb THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
    END IF;
    v_bucket := v_item->>'bucket';
    v_path := v_item->>'path';
    v_source := v_item->>'source';
    BEGIN
      v_not_before := (v_item->>'not_before')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
    END;

    IF v_bucket NOT IN (
         'community-media-staging', 'community-images', 'community-videos',
         'chat-image', 'profile-avatars'
       )
       OR v_path IS NULL
       OR char_length(v_path) NOT BETWEEN 38 AND 512
       OR (
         v_bucket = 'chat-image'
         AND v_path !~ (
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
           || v_job.user_id::text
           || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$'
         )
       )
       OR (
         v_bucket <> 'chat-image'
         AND (
           v_path !~ ('^' || v_job.user_id::text || '/[^/\\[:cntrl:]]+$')
           OR split_part(v_path, '/', 2) IN ('.', '..')
         )
       ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_PATH_INVALID' USING ERRCODE = '22023';
    END IF;

    IF v_bucket = 'chat-image' THEN
      IF v_source <> 'quarantine' THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_CHAT_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_bucket = 'profile-avatars' AND v_source = 'profile_avatar' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profile_avatar_assets asset
        WHERE asset.user_id = v_job.user_id AND asset.object_path = v_path
          AND v_not_before >= asset.upload_until
      ) THEN
        RAISE EXCEPTION 'PROFILE_AVATAR_DELETION_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source IN ('session_staging', 'session_final') THEN
      SELECT * INTO v_session
        FROM public.community_upload_sessions
       WHERE user_id = v_job.user_id
         AND (
           (v_source = 'session_staging'
             AND v_bucket = 'community-media-staging'
             AND staging_path = v_path)
           OR
           (v_source = 'session_final'
             AND final_bucket = v_bucket
             AND final_path = v_path)
         );
      IF NOT FOUND OR v_not_before < v_session.expires_at + interval '5 minutes' THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_SESSION_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source = 'legacy_prefix' THEN
      IF NOT (
        (
          v_bucket = 'community-images'
          AND v_path ~* ('^' || v_job.user_id::text || '/[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$')
        )
        OR (
          v_bucket = 'community-videos'
          AND v_path ~* ('^' || v_job.user_id::text || '/[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|mov|webm)$')
        )
      ) THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_LEGACY_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source <> 'quarantine' THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_SOURCE_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.account_deletion_media_manifest(
      job_id, bucket, path, source, not_before
    ) VALUES (p_job_id, v_bucket, v_path, v_source, v_not_before);
  END LOOP;

  SELECT count(*) FILTER (WHERE source = 'quarantine'),
         coalesce(max(not_before) FILTER (WHERE source <> 'quarantine'), clock_timestamp())
    INTO v_quarantine_count, v_ready_after
    FROM public.account_deletion_media_manifest
   WHERE job_id = p_job_id;

  UPDATE public.account_deletion_jobs
     SET status = CASE WHEN v_quarantine_count > 0
                       THEN 'manual_review' ELSE 'inventory_ready' END,
         quarantine_count = v_quarantine_count,
         ready_after = v_ready_after,
         claim_token = NULL,
         claimed_at = NULL,
         last_error_code = CASE WHEN v_quarantine_count > 0
                                THEN 'unproven_legacy_media' ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE id = p_job_id
   RETURNING * INTO v_job;
  RETURN NEXT v_job;
END;
$replace_manifest$;


COMMIT;
