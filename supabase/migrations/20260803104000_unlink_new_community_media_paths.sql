-- New finalized community objects must not encode the Supabase Auth UUID.
-- Staging remains private and owner-prefixed so signed-token cleanup stays
-- bounded. The final object is linked to its owner only by the private durable
-- upload session, never by its public URL.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.community_upload_sessions
  DROP CONSTRAINT IF EXISTS community_upload_sessions_same_path;
ALTER TABLE public.community_upload_sessions
  DROP CONSTRAINT IF EXISTS community_upload_sessions_owner_path;
ALTER TABLE public.community_upload_sessions
  DROP CONSTRAINT IF EXISTS community_upload_sessions_path_shape;
ALTER TABLE public.community_upload_sessions
  DROP CONSTRAINT IF EXISTS community_upload_sessions_staging_owner_path;
ALTER TABLE public.community_upload_sessions
  DROP CONSTRAINT IF EXISTS community_upload_sessions_staging_path_shape;
ALTER TABLE public.community_upload_sessions
  DROP CONSTRAINT IF EXISTS community_upload_sessions_final_path_shape;

ALTER TABLE public.community_upload_sessions
  ADD CONSTRAINT community_upload_sessions_staging_owner_path
  CHECK (
    staging_path = user_id::text || '/' || id::text || '.' || CASE declared_mime_type
      WHEN 'image/jpeg' THEN 'jpg'
      WHEN 'image/png' THEN 'png'
      WHEN 'image/gif' THEN 'gif'
      WHEN 'image/webp' THEN 'webp'
      ELSE 'invalid'
    END
  ) NOT VALID;

ALTER TABLE public.community_upload_sessions
  ADD CONSTRAINT community_upload_sessions_staging_path_shape
  CHECK (
    staging_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
  ) NOT VALID;

-- Legacy finalized paths remain valid for existing rows. Every new v2 path is
-- a separate random UUID and cannot reuse the durable upload/session UUID.
ALTER TABLE public.community_upload_sessions
  ADD CONSTRAINT community_upload_sessions_final_path_shape
  CHECK (
    final_path = staging_path
    OR (
      final_path ~ '^v2/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
      AND split_part(split_part(final_path, '/', 2), '.', 1) <> id::text
      AND split_part(split_part(final_path, '/', 2), '.', 1) <> user_id::text
      AND split_part(final_path, '.', 2) = CASE declared_mime_type
        WHEN 'image/jpeg' THEN 'jpg'
        WHEN 'image/png' THEN 'png'
        WHEN 'image/gif' THEN 'gif'
        WHEN 'image/webp' THEN 'webp'
        ELSE 'invalid'
      END
    )
  ) NOT VALID;

ALTER TABLE public.community_upload_sessions
  VALIDATE CONSTRAINT community_upload_sessions_staging_owner_path;
ALTER TABLE public.community_upload_sessions
  VALIDATE CONSTRAINT community_upload_sessions_staging_path_shape;
ALTER TABLE public.community_upload_sessions
  VALIDATE CONSTRAINT community_upload_sessions_final_path_shape;

-- The deletion manifest used to accept only owner-prefixed paths. Keep that
-- legacy shape for every non-session source, while allowing an unlinkable v2
-- path only when the row itself declares exact private upload-session proof.
ALTER TABLE public.account_deletion_media_manifest
  DROP CONSTRAINT IF EXISTS account_deletion_media_path_shape;
ALTER TABLE public.account_deletion_media_manifest
  ADD CONSTRAINT account_deletion_media_path_shape
  CHECK (
    (
      bucket = 'chat-image'
      AND char_length(path) BETWEEN 111 AND 512
      AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$'
    )
    OR
    (
      bucket <> 'chat-image'
      AND char_length(path) BETWEEN 38 AND 512
      AND (
        (
          path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/\\[:cntrl:]]+$'
          AND split_part(path, '/', 2) NOT IN ('.', '..')
        )
        OR (
          bucket = 'community-images'
          AND source = 'session_final'
          AND path ~ '^v2/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
        )
      )
    )
  ) NOT VALID;
ALTER TABLE public.account_deletion_media_manifest
  VALIDATE CONSTRAINT account_deletion_media_path_shape;

CREATE OR REPLACE FUNCTION public.reconcile_community_upload_target(
  p_target_table text,
  p_target_id uuid,
  p_owner_id uuid,
  p_payload text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reconcile_target$
DECLARE
  v_session public.community_upload_sessions%ROWTYPE;
  v_final_path text;
  v_uuid_pattern text;
  v_legacy_pattern text;
  v_v2_pattern text;
BEGIN
  IF p_target_table NOT IN ('community_posts', 'cohort_messages') THEN
    RAISE EXCEPTION 'UPLOAD_ATTACHMENT_TARGET_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.community_upload_sessions
     SET attached_table = NULL,
         attached_id = NULL,
         attached_at = NULL,
         updated_at = clock_timestamp()
   WHERE attached_table = p_target_table
     AND attached_id = p_target_id;

  IF p_payload IS NULL OR p_payload = '' THEN
    RETURN;
  END IF;

  v_uuid_pattern := '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  v_legacy_pattern := 'community-images/(' || v_uuid_pattern || '/'
    || v_uuid_pattern || '\.(jpg|png|gif|webp))';
  v_v2_pattern := 'community-images/(v2/' || v_uuid_pattern
    || '\.(jpg|png|gif|webp))';

  FOR v_final_path IN
    SELECT DISTINCT candidate.final_path
      FROM (
        SELECT captures[1] AS final_path
          FROM regexp_matches(p_payload, v_legacy_pattern, 'gi') AS captures
        UNION
        SELECT captures[1] AS final_path
          FROM regexp_matches(p_payload, v_v2_pattern, 'gi') AS captures
      ) AS candidate
  LOOP
    SELECT *
      INTO v_session
      FROM public.community_upload_sessions
     WHERE final_bucket = 'community-images'
       AND final_path = v_final_path
     FOR UPDATE;

    IF NOT FOUND
       OR v_session.user_id <> p_owner_id
       OR v_session.status <> 'completed'
       OR v_session.final_deleted_at IS NOT NULL
       OR v_session.content_sha256 IS NULL THEN
      RAISE EXCEPTION 'UPLOAD_SESSION_NOT_ATTACHABLE' USING ERRCODE = '23514';
    END IF;

    IF v_session.attachment_cleanup_token IS NOT NULL THEN
      RAISE EXCEPTION 'UPLOAD_CLEANUP_IN_PROGRESS' USING ERRCODE = '55000';
    END IF;

    IF v_session.attached_at IS NOT NULL
       AND (
         v_session.attached_table <> p_target_table
         OR v_session.attached_id <> p_target_id
       ) THEN
      RAISE EXCEPTION 'UPLOAD_ALREADY_ATTACHED' USING ERRCODE = '23505';
    END IF;

    UPDATE public.community_upload_sessions
       SET attached_table = p_target_table,
           attached_id = p_target_id,
           attached_at = coalesce(attached_at, clock_timestamp()),
           updated_at = clock_timestamp()
     WHERE id = v_session.id;
  END LOOP;
END;
$reconcile_target$;

REVOKE ALL ON FUNCTION public.reconcile_community_upload_target(text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Account deletion may delete an unlinkable v2 object only when an exact
-- private session proves ownership. Prefix inventory remains legacy-only.
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
         'chat-image'
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
         AND NOT (
           (
             v_source = 'session_final'
             AND v_bucket = 'community-images'
             AND (
               (
                 v_path ~ ('^' || v_job.user_id::text || '/[^/\\[:cntrl:]]+$')
                 AND split_part(v_path, '/', 2) NOT IN ('.', '..')
               )
               OR v_path ~ '^v2/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
             )
           )
           OR (
             v_source <> 'session_final'
             AND v_path ~ ('^' || v_job.user_id::text || '/[^/\\[:cntrl:]]+$')
             AND split_part(v_path, '/', 2) NOT IN ('.', '..')
           )
         )
       ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_PATH_INVALID' USING ERRCODE = '22023';
    END IF;

    IF v_bucket = 'chat-image' THEN
      IF v_source <> 'quarantine' THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_CHAT_PROOF_INVALID' USING ERRCODE = '23514';
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

REVOKE ALL ON FUNCTION public.replace_account_deletion_media_manifest(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_account_deletion_media_manifest(uuid, uuid, jsonb)
  TO service_role;

DO $unlink_community_media_postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.community_upload_sessions AS session
     WHERE NOT (
       session.final_path = session.staging_path
       OR (
         session.final_path ~ '^v2/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
         AND split_part(split_part(session.final_path, '/', 2), '.', 1) <> session.id::text
         AND split_part(split_part(session.final_path, '/', 2), '.', 1) <> session.user_id::text
       )
     )
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_MEDIA_FINAL_PATH_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_MEDIA_DELETION_PROOF_FUNCTION_EXPOSED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
     WHERE constraint_record.conrelid =
           'public.account_deletion_media_manifest'::regclass
       AND constraint_record.conname = 'account_deletion_media_path_shape'
       AND pg_catalog.pg_get_constraintdef(constraint_record.oid) LIKE '%v2/%'
       AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
           LIKE '%session_final%'
  ) THEN
    RAISE EXCEPTION 'COMMUNITY_MEDIA_DELETION_MANIFEST_V2_FENCE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$unlink_community_media_postcondition$;

COMMENT ON COLUMN public.community_upload_sessions.final_path IS
  'Legacy owner-prefixed path or unlinkable v2 random path; ownership lives in this private session.';

COMMIT;
