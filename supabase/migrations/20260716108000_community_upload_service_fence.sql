-- The app-owned session state below makes signed uploads replay-safe and gives
-- the cleanup cron a durable orphan inventory. This migration intentionally
-- does not mutate Supabase-owned storage.objects policies or storage.buckets.
-- Storage is frozen before backup and finalized separately after all migrations;
-- neither hosted Storage phase is a prerequisite inside this migration.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.community_upload_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staging_path text NOT NULL UNIQUE,
  final_bucket text NOT NULL,
  final_path text NOT NULL UNIQUE,
  declared_mime_type text NOT NULL,
  declared_size bigint NOT NULL,
  status text NOT NULL DEFAULT 'issued',
  claim_token uuid,
  finalize_started_at timestamptz,
  finalization_attempts integer NOT NULL DEFAULT 0,
  actual_size bigint,
  actual_mime_type text,
  rejection_code text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  rejected_at timestamptz,
  staging_deleted_at timestamptz,
  CONSTRAINT community_upload_sessions_same_path
    CHECK (staging_path = final_path),
  CONSTRAINT community_upload_sessions_owner_path
    CHECK (
      staging_path = user_id::text || '/' || id::text || '.' || CASE declared_mime_type
        WHEN 'image/jpeg' THEN 'jpg'
        WHEN 'image/png' THEN 'png'
        WHEN 'image/gif' THEN 'gif'
        WHEN 'image/webp' THEN 'webp'
        ELSE 'invalid'
      END
    ),
  CONSTRAINT community_upload_sessions_path_shape
    CHECK (
      staging_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
    ),
  CONSTRAINT community_upload_sessions_mime
    CHECK (declared_mime_type IN (
      'image/jpeg', 'image/png', 'image/gif', 'image/webp'
    )),
  CONSTRAINT community_upload_sessions_bucket_mime
    CHECK (
      final_bucket = 'community-images' AND declared_mime_type LIKE 'image/%'
    ),
  CONSTRAINT community_upload_sessions_declared_size
    CHECK (
      declared_size > 0
      AND declared_size <= CASE
        WHEN declared_mime_type IN ('image/jpeg', 'image/png', 'image/webp')
          THEN 5 * 1024 * 1024
        WHEN declared_mime_type = 'image/gif' THEN 6 * 1024 * 1024
        ELSE 5 * 1024 * 1024
      END
    ),
  CONSTRAINT community_upload_sessions_status
    CHECK (status IN ('issued', 'finalizing', 'completed', 'rejected', 'expired')),
  CONSTRAINT community_upload_sessions_attempts
    CHECK (finalization_attempts >= 0),
  CONSTRAINT community_upload_sessions_claim_state
    CHECK (
      (status = 'finalizing' AND claim_token IS NOT NULL AND finalize_started_at IS NOT NULL)
      OR (status <> 'finalizing' AND claim_token IS NULL)
    ),
  CONSTRAINT community_upload_sessions_completion_state
    CHECK (
      status <> 'completed'
      OR (
        completed_at IS NOT NULL
        AND actual_size = declared_size
        AND actual_mime_type = declared_mime_type
        AND staging_deleted_at IS NOT NULL
      )
    ),
  CONSTRAINT community_upload_sessions_actual_size
    CHECK (actual_size IS NULL OR actual_size > 0),
  CONSTRAINT community_upload_sessions_expiry
    CHECK (
      expires_at > created_at
      AND expires_at <= created_at + interval '2 hours 5 minutes'
    )
);

CREATE INDEX IF NOT EXISTS community_upload_sessions_cleanup_idx
  ON public.community_upload_sessions (expires_at, status)
  WHERE status IN ('issued', 'finalizing', 'rejected', 'expired');

CREATE INDEX IF NOT EXISTS community_upload_sessions_user_created_idx
  ON public.community_upload_sessions (user_id, created_at DESC);

ALTER TABLE public.community_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_upload_sessions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.community_upload_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.community_upload_sessions FROM anon;
REVOKE ALL ON TABLE public.community_upload_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.community_upload_sessions TO service_role;

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
AS $claim$
DECLARE
  v_session public.community_upload_sessions%ROWTYPE;
BEGIN
  SELECT *
    INTO v_session
    FROM public.community_upload_sessions
   WHERE id = p_upload_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_session.expires_at > clock_timestamp()
     AND (
       v_session.status = 'issued'
       OR (
         v_session.status = 'finalizing'
         AND v_session.finalize_started_at <= LEAST(
           p_stale_before,
           clock_timestamp() - interval '2 minutes'
         )
       )
     ) THEN
    UPDATE public.community_upload_sessions
       SET status = 'finalizing',
           claim_token = p_claim_token,
           finalize_started_at = clock_timestamp(),
           finalization_attempts = finalization_attempts + 1,
           updated_at = clock_timestamp()
     WHERE id = v_session.id
     RETURNING * INTO v_session;
  END IF;

  RETURN NEXT v_session;
END;
$claim$;

REVOKE ALL ON FUNCTION public.claim_community_upload_session(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_community_upload_session(
  uuid, uuid, uuid, timestamptz
) FROM anon;
REVOKE ALL ON FUNCTION public.claim_community_upload_session(
  uuid, uuid, uuid, timestamptz
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_community_upload_session(
  uuid, uuid, uuid, timestamptz
) TO service_role;
