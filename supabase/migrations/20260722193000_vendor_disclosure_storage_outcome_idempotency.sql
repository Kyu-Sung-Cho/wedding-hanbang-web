-- Restore exact idempotency for a Storage outcome whose successful RPC reply
-- was lost after the claim had already been closed. The immutable local claim
-- and object journals replay that same outcome; confirmed_created objects also
-- carry the exact original claim identity in Storage metadata.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_batch_index integer,
  p_bucket_id text,
  p_object_name text,
  p_object_sha256 text,
  p_object_bytes bigint,
  p_created_by_run boolean,
  p_claim_token uuid,
  p_claim_epoch bigint,
  p_claimant_id uuid
)
RETURNS TABLE (ownership_state text, already_recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $record_vendor_disclosure_storage_object_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  link_row public.vendor_disclosure_ingest_storage_links%ROWTYPE;
  object_row storage.objects%ROWTYPE;
  expected_state text;
  metadata_owner_run_sha256 text;
  is_closed_outcome_replay boolean;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_index < 1
    OR p_bucket_id NOT IN ('disclosure-raw', 'disclosure-preview')
    OR p_object_name !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
    OR p_object_sha256 !~ '^[0-9a-f]{64}$'
    OR split_part(p_object_name, '.', 1) IS DISTINCT FROM p_object_sha256
    OR p_object_bytes < 0 OR p_object_bytes > 52428800
    OR p_claim_token IS NULL OR p_claim_epoch < 1 OR p_claimant_id IS NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  expected_state := CASE WHEN p_created_by_run THEN 'confirmed_created' ELSE 'confirmed_preexisting' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-storage-v1:' || p_bucket_id || ':' || p_object_name,
    0
  ));
  SELECT run.* INTO run_row FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256 FOR UPDATE NOWAIT;
  SELECT link.* INTO link_row FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256
    AND link.bucket_id = p_bucket_id AND link.object_name = p_object_name
  FOR UPDATE NOWAIT;
  SELECT object.* INTO object_row FROM storage.objects AS object
  WHERE object.bucket_id = p_bucket_id AND object.name = p_object_name;
  metadata_owner_run_sha256 := NULLIF(object_row.user_metadata ->> 'ingest_run_sha256', '');

  -- Validate the immutable run, link, object generation, and ownership metadata
  -- before considering either an active claim or a closed exact replay.
  IF run_row.run_sha256 IS NULL
    OR run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.status NOT IN ('active', 'complete')
    OR link_row.run_sha256 IS NULL
    OR link_row.batch_index > p_batch_index
    OR link_row.object_sha256 IS DISTINCT FROM p_object_sha256
    OR link_row.object_bytes IS DISTINCT FROM p_object_bytes
    OR object_row.id IS NULL
    OR object_row.metadata ->> 'size' IS DISTINCT FROM p_object_bytes::text
    OR (
       p_created_by_run
       AND (
        object_row.user_metadata ->> 'ingest_run_sha256' IS DISTINCT FROM p_run_sha256
        OR object_row.user_metadata ->> 'ingest_sha256' IS DISTINCT FROM p_object_sha256
        OR object_row.user_metadata ->> 'ingest_bytes' IS DISTINCT FROM p_object_bytes::text
      )
    )
    OR (
      NOT p_created_by_run
      AND NOT (
        (
          NOT (object_row.user_metadata ? 'ingest_run_sha256')
          AND NOT (object_row.user_metadata ? 'ingest_sha256')
          AND NOT (object_row.user_metadata ? 'ingest_bytes')
        )
        OR (
          object_row.user_metadata ? 'ingest_run_sha256'
          AND object_row.user_metadata ? 'ingest_sha256'
          AND object_row.user_metadata ? 'ingest_bytes'
          AND metadata_owner_run_sha256 ~ '^[0-9a-f]{64}$'
          AND object_row.user_metadata ->> 'ingest_sha256' = p_object_sha256
          AND object_row.user_metadata ->> 'ingest_bytes' = p_object_bytes::text
        )
      )
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_CONFLICT' USING ERRCODE = '23505';
  END IF;

  is_closed_outcome_replay :=
    link_row.ownership_state <> 'intent'
    AND link_row.upload_claim_token IS NULL
    AND link_row.upload_claimant_id IS NULL
    AND link_row.upload_claim_action IS NULL
    AND link_row.upload_claim_epoch IS NOT DISTINCT FROM p_claim_epoch
    AND (
      link_row.ownership_state = expected_state
      OR (NOT p_created_by_run AND link_row.ownership_state = 'confirmed_inherited')
    )
    AND link_row.storage_object_id IS NOT DISTINCT FROM object_row.id
    AND link_row.storage_object_updated_at IS NOT DISTINCT FROM object_row.updated_at
    AND link_row.storage_metadata_owner_run_sha256 IS NOT DISTINCT FROM metadata_owner_run_sha256
    AND (
      NOT p_created_by_run
      OR (
        object_row.user_metadata ->> 'ingest_claim_token' IS NOT DISTINCT FROM p_claim_token::text
        AND object_row.user_metadata ->> 'ingest_claim_epoch' IS NOT DISTINCT FROM p_claim_epoch::text
        AND object_row.user_metadata ->> 'ingest_claimant_id' IS NOT DISTINCT FROM p_claimant_id::text
      )
    );

  IF is_closed_outcome_replay THEN
    ownership_state := link_row.ownership_state;
    already_recorded := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Every non-closed-replay path still requires the exact live claim.
  IF link_row.upload_claim_token IS DISTINCT FROM p_claim_token
    OR link_row.upload_claim_epoch IS DISTINCT FROM p_claim_epoch
    OR link_row.upload_claimant_id IS DISTINCT FROM p_claimant_id
    OR (
      p_created_by_run
      AND link_row.upload_claim_action = 'upload'
      AND (
        object_row.user_metadata ->> 'ingest_claim_token' IS DISTINCT FROM p_claim_token::text
        OR object_row.user_metadata ->> 'ingest_claim_epoch' IS DISTINCT FROM p_claim_epoch::text
        OR object_row.user_metadata ->> 'ingest_claimant_id' IS DISTINCT FROM p_claimant_id::text
      )
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_CONFLICT' USING ERRCODE = '23505';
  END IF;

  IF link_row.ownership_state <> 'intent' THEN
    IF NOT (
        link_row.ownership_state = expected_state
        OR (NOT p_created_by_run AND link_row.ownership_state = 'confirmed_inherited')
      )
      OR link_row.storage_object_id IS DISTINCT FROM object_row.id
      OR link_row.storage_object_updated_at IS DISTINCT FROM object_row.updated_at
      OR link_row.storage_metadata_owner_run_sha256 IS DISTINCT FROM metadata_owner_run_sha256
    THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_REPLAY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    UPDATE public.vendor_disclosure_ingest_storage_links
    SET upload_claim_token = NULL, upload_claimant_id = NULL, upload_claim_action = NULL,
        upload_claimed_at = NULL, upload_claim_expires_at = NULL
    WHERE run_sha256 = p_run_sha256 AND bucket_id = p_bucket_id AND object_name = p_object_name
      AND upload_claim_token = p_claim_token AND upload_claim_epoch = p_claim_epoch
      AND upload_claimant_id = p_claimant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_CLAIM_CLOSE_RACE' USING ERRCODE = '40001';
    END IF;
    ownership_state := link_row.ownership_state;
    already_recorded := true;
    RETURN NEXT;
    RETURN;
  END IF;
  IF run_row.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_COMPLETE_RUN_INTENT_FORBIDDEN' USING ERRCODE = '55000';
  END IF;
  UPDATE public.vendor_disclosure_ingest_storage_links
  SET ownership_state = expected_state,
      storage_metadata_owner_run_sha256 = metadata_owner_run_sha256,
      storage_object_id = object_row.id,
      storage_object_updated_at = object_row.updated_at,
      confirmed_at = now(),
      upload_claim_token = NULL, upload_claimant_id = NULL, upload_claim_action = NULL,
      upload_claimed_at = NULL, upload_claim_expires_at = NULL
  WHERE run_sha256 = p_run_sha256 AND bucket_id = p_bucket_id AND object_name = p_object_name
    AND upload_claim_token = p_claim_token AND upload_claim_epoch = p_claim_epoch
    AND upload_claimant_id = p_claimant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_CLAIM_CLOSE_RACE' USING ERRCODE = '40001';
  END IF;
  ownership_state := expected_state;
  already_recorded := false;
  RETURN NEXT;
END;
$record_vendor_disclosure_storage_object_atomic$;

ALTER FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, boolean, uuid, bigint, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, boolean, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, boolean, uuid, bigint, uuid
) TO service_role;

COMMIT;
