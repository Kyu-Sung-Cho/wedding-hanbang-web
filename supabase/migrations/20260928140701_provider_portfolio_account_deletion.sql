-- Extend the existing deletion manifest without changing the claim or Auth boundary.
-- Provider bytes use user_id/provider_id/media_id.{jpg,png,webp}, including after Auth cascade.
BEGIN;
ALTER TABLE public.account_deletion_media_manifest DROP CONSTRAINT account_deletion_media_bucket;
ALTER TABLE public.account_deletion_media_manifest ADD CONSTRAINT account_deletion_media_bucket
  CHECK (bucket IN ('community-media-staging','community-images','community-videos','chat-image','profile-avatars','provider-portfolio'));
ALTER TABLE public.account_deletion_media_manifest DROP CONSTRAINT account_deletion_media_source;
ALTER TABLE public.account_deletion_media_manifest ADD CONSTRAINT account_deletion_media_source
  CHECK (source IN ('session_staging','session_final','legacy_prefix','quarantine','profile_avatar','provider_portfolio'));
ALTER TABLE public.account_deletion_media_manifest DROP CONSTRAINT account_deletion_media_path_shape;
ALTER TABLE public.account_deletion_media_manifest ADD CONSTRAINT account_deletion_media_path_shape CHECK (
  (
    bucket IN ('chat-image','provider-portfolio')
    AND char_length(path) BETWEEN 111 AND 512
    AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$'
    AND (bucket='chat-image' OR path ~ '\.(jpg|png|webp)$')
  ) OR (
    bucket NOT IN ('chat-image','provider-portfolio')
    AND char_length(path) BETWEEN 38 AND 512
    AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/\\[:cntrl:]]+$'
    AND split_part(path,'/',2) NOT IN ('.','..')
  )
);
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
         'chat-image', 'profile-avatars', 'provider-portfolio'
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
         v_bucket = 'provider-portfolio'
         AND v_path !~ ('^' || v_job.user_id::text
           || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
           || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$')
       )
       OR (
         v_bucket NOT IN ('chat-image', 'provider-portfolio')
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
    ELSIF v_bucket = 'provider-portfolio' THEN
      IF v_source = 'provider_portfolio' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.provider_media m
          JOIN public.provider_profiles p ON p.id=m.provider_id
          WHERE p.owner_id=v_job.user_id AND m.storage_path=v_path
            AND split_part(v_path,'/',2)=p.id::text
            AND split_part(split_part(v_path,'/',3),'.',1)=m.id::text
            AND v_not_before >= m.created_at + interval '35 minutes'
        ) THEN
          RAISE EXCEPTION 'PROVIDER_PORTFOLIO_DELETION_PROOF_INVALID' USING ERRCODE='23514';
        END IF;
      ELSIF v_source IS DISTINCT FROM 'quarantine' THEN
        RAISE EXCEPTION 'PROVIDER_PORTFOLIO_DELETION_PROOF_INVALID' USING ERRCODE='23514';
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

  -- Include registrations even before their object appears, so in-flight uploads retain their grace.
  IF EXISTS (
    SELECT 1 FROM public.provider_media m JOIN public.provider_profiles p ON p.id=m.provider_id
    WHERE p.owner_id=v_job.user_id AND NOT EXISTS (
      SELECT 1 FROM public.account_deletion_media_manifest manifest
      WHERE manifest.job_id=p_job_id AND manifest.bucket='provider-portfolio'
        AND manifest.path=m.storage_path AND manifest.source='provider_portfolio'
    )
  ) THEN
    RAISE EXCEPTION 'PROVIDER_PORTFOLIO_DELETION_INVENTORY_INCOMPLETE' USING ERRCODE='23514';
  END IF;

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
ALTER FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) TO service_role;
COMMIT;
