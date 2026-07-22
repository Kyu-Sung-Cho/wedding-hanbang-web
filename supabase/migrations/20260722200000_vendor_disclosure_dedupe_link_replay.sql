-- A validated artifact may repeat an exact dedupe candidate through distinct
-- source occurrences that resolve to the same persisted identity pair. Keep
-- the immutable candidate array and its hashes intact, while journaling that
-- pair once. Any drift in evidence or ownership remains a hard 23505 failure.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $vendor_disclosure_dedupe_link_replay_patch$
DECLARE
  finalizer_function regprocedure := pg_catalog.to_regprocedure(
    'public.finalize_vendor_disclosure_dedupe_atomic(text,text,text,text,text[],jsonb)'
  );
  finalizer_definition text;
  patched_definition text;
  old_vendor_link constant text := $old_vendor_link$INSERT INTO public.vendor_disclosure_ingest_dedupe_links (
          run_sha256, entity_kind, left_identity_id, right_identity_id,
          reason, similarity, created_by_run, initial_candidate_sha256,
          cleanup_status
        ) VALUES (
          p_run_sha256, 'vendor', left_id, right_id,
          candidate ->> 'reason', (candidate ->> 'similarity')::numeric,
          affected_rows = 1,
          encode(extensions.digest(convert_to(jsonb_build_object(
            'entity_kind', 'vendor', 'left_identity_id', left_id,
            'right_identity_id', right_id, 'reason', candidate ->> 'reason',
            'similarity', (candidate ->> 'similarity')::numeric,
            'status', 'pending'
          )::text, 'UTF8'), 'sha256'), 'hex'),
          CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
        );$old_vendor_link$;
  new_vendor_link constant text := $new_vendor_link$INSERT INTO public.vendor_disclosure_ingest_dedupe_links (
          run_sha256, entity_kind, left_identity_id, right_identity_id,
          reason, similarity, created_by_run, initial_candidate_sha256,
          cleanup_status
        ) VALUES (
          p_run_sha256, 'vendor', left_id, right_id,
          candidate ->> 'reason', (candidate ->> 'similarity')::numeric,
          affected_rows = 1,
          encode(extensions.digest(convert_to(jsonb_build_object(
            'entity_kind', 'vendor', 'left_identity_id', left_id,
            'right_identity_id', right_id, 'reason', candidate ->> 'reason',
            'similarity', (candidate ->> 'similarity')::numeric,
            'status', 'pending'
          )::text, 'UTF8'), 'sha256'), 'hex'),
          CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
        ) ON CONFLICT (
          run_sha256, entity_kind, left_identity_id, right_identity_id
        ) DO NOTHING;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows = 0 AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_dedupe_links AS existing_link
          WHERE existing_link.run_sha256 = p_run_sha256
            AND existing_link.entity_kind = 'vendor'
            AND existing_link.left_identity_id = left_id
            AND existing_link.right_identity_id = right_id
            AND existing_link.reason IS NOT DISTINCT FROM candidate ->> 'reason'
            AND existing_link.similarity IS NOT DISTINCT FROM
              (candidate ->> 'similarity')::numeric
            AND existing_link.initial_candidate_sha256 IS NOT DISTINCT FROM
              encode(extensions.digest(convert_to(jsonb_build_object(
                'entity_kind', 'vendor', 'left_identity_id', left_id,
                'right_identity_id', right_id,
                'reason', candidate ->> 'reason',
                'similarity', (candidate ->> 'similarity')::numeric,
                'status', 'pending'
              )::text, 'UTF8'), 'sha256'), 'hex')
            AND (
              (existing_link.created_by_run
                AND existing_link.cleanup_status = 'owned')
              OR (NOT existing_link.created_by_run
                AND existing_link.cleanup_status = 'reused')
            )
        ) THEN
          RAISE EXCEPTION 'DISCLOSURE_DEDUPE_VENDOR_LINK_REPLAY_CONFLICT'
            USING ERRCODE = '23505';
        END IF;$new_vendor_link$;
  old_agency_link constant text := $old_agency_link$INSERT INTO public.vendor_disclosure_ingest_dedupe_links (
          run_sha256, entity_kind, left_identity_id, right_identity_id,
          reason, similarity, created_by_run, initial_candidate_sha256,
          cleanup_status
        ) VALUES (
          p_run_sha256, 'agency', left_id, right_id,
          candidate ->> 'reason', (candidate ->> 'similarity')::numeric,
          affected_rows = 1,
          encode(extensions.digest(convert_to(jsonb_build_object(
            'entity_kind', 'agency', 'left_identity_id', left_id,
            'right_identity_id', right_id, 'reason', candidate ->> 'reason',
            'similarity', (candidate ->> 'similarity')::numeric,
            'status', 'pending'
          )::text, 'UTF8'), 'sha256'), 'hex'),
          CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
        );$old_agency_link$;
  new_agency_link constant text := $new_agency_link$INSERT INTO public.vendor_disclosure_ingest_dedupe_links (
          run_sha256, entity_kind, left_identity_id, right_identity_id,
          reason, similarity, created_by_run, initial_candidate_sha256,
          cleanup_status
        ) VALUES (
          p_run_sha256, 'agency', left_id, right_id,
          candidate ->> 'reason', (candidate ->> 'similarity')::numeric,
          affected_rows = 1,
          encode(extensions.digest(convert_to(jsonb_build_object(
            'entity_kind', 'agency', 'left_identity_id', left_id,
            'right_identity_id', right_id, 'reason', candidate ->> 'reason',
            'similarity', (candidate ->> 'similarity')::numeric,
            'status', 'pending'
          )::text, 'UTF8'), 'sha256'), 'hex'),
          CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
        ) ON CONFLICT (
          run_sha256, entity_kind, left_identity_id, right_identity_id
        ) DO NOTHING;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows = 0 AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_dedupe_links AS existing_link
          WHERE existing_link.run_sha256 = p_run_sha256
            AND existing_link.entity_kind = 'agency'
            AND existing_link.left_identity_id = left_id
            AND existing_link.right_identity_id = right_id
            AND existing_link.reason IS NOT DISTINCT FROM candidate ->> 'reason'
            AND existing_link.similarity IS NOT DISTINCT FROM
              (candidate ->> 'similarity')::numeric
            AND existing_link.initial_candidate_sha256 IS NOT DISTINCT FROM
              encode(extensions.digest(convert_to(jsonb_build_object(
                'entity_kind', 'agency', 'left_identity_id', left_id,
                'right_identity_id', right_id,
                'reason', candidate ->> 'reason',
                'similarity', (candidate ->> 'similarity')::numeric,
                'status', 'pending'
              )::text, 'UTF8'), 'sha256'), 'hex')
            AND (
              (existing_link.created_by_run
                AND existing_link.cleanup_status = 'owned')
              OR (NOT existing_link.created_by_run
                AND existing_link.cleanup_status = 'reused')
            )
        ) THEN
          RAISE EXCEPTION 'DISCLOSURE_DEDUPE_AGENCY_LINK_REPLAY_CONFLICT'
            USING ERRCODE = '23505';
        END IF;$new_agency_link$;
BEGIN
  IF finalizer_function IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_LINK_REPLAY_FINALIZER_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(proc.oid)
  INTO finalizer_definition
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = finalizer_function;

  IF finalizer_definition IS NULL
    OR length(finalizer_definition)
      - length(replace(finalizer_definition, old_vendor_link, ''))
        IS DISTINCT FROM length(old_vendor_link)
    OR length(finalizer_definition)
      - length(replace(finalizer_definition, old_agency_link, ''))
        IS DISTINCT FROM length(old_agency_link)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_LINK_REPLAY_PREDECESSOR_DRIFT';
  END IF;

  patched_definition := replace(
    replace(finalizer_definition, old_vendor_link, new_vendor_link),
    old_agency_link,
    new_agency_link
  );

  IF patched_definition = finalizer_definition
    OR position(
      'DISCLOSURE_DEDUPE_VENDOR_LINK_REPLAY_CONFLICT' IN patched_definition
    ) = 0
    OR position(
      'DISCLOSURE_DEDUPE_AGENCY_LINK_REPLAY_CONFLICT' IN patched_definition
    ) = 0
  THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_LINK_REPLAY_PATCH_FAILED';
  END IF;

  EXECUTE patched_definition;
END;
$vendor_disclosure_dedupe_link_replay_patch$;

ALTER FUNCTION public.finalize_vendor_disclosure_dedupe_atomic(
  text, text, text, text, text[], jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.finalize_vendor_disclosure_dedupe_atomic(
  text, text, text, text, text[], jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_vendor_disclosure_dedupe_atomic(
  text, text, text, text, text[], jsonb
) TO service_role;

DO $vendor_disclosure_dedupe_link_replay_postconditions$
DECLARE
  finalizer_function regprocedure := pg_catalog.to_regprocedure(
    'public.finalize_vendor_disclosure_dedupe_atomic(text,text,text,text,text[],jsonb)'
  );
  finalizer_definition text;
  finalizer_owner name;
  finalizer_security_definer boolean;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(proc.oid),
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef
  INTO finalizer_definition, finalizer_owner, finalizer_security_definer
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = finalizer_function;

  IF finalizer_function IS NULL
    OR finalizer_owner IS DISTINCT FROM 'postgres'::name
    OR finalizer_security_definer IS DISTINCT FROM true
    OR position(
      'DISCLOSURE_DEDUPE_VENDOR_LINK_REPLAY_CONFLICT' IN finalizer_definition
    ) = 0
    OR position(
      'DISCLOSURE_DEDUPE_AGENCY_LINK_REPLAY_CONFLICT' IN finalizer_definition
    ) = 0
    OR position(
      'existing_link.initial_candidate_sha256 IS NOT DISTINCT FROM'
      IN finalizer_definition
    ) = 0
    OR position('p_candidates::text' IN finalizer_definition) = 0
    OR position('p_candidates :=' IN finalizer_definition) > 0
    OR pg_catalog.has_function_privilege(
      'anon', finalizer_function, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated', finalizer_function, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', finalizer_function, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_LINK_REPLAY_POSTCONDITION_FAILED';
  END IF;
END;
$vendor_disclosure_dedupe_link_replay_postconditions$;

COMMIT;
