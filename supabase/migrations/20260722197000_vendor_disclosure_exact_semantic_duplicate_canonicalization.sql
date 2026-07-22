-- Canonicalize byte-for-byte duplicate semantic rows produced by legacy
-- validated artifacts. The immutable batch payload and receipt remain intact;
-- only an exact duplicate that was inserted earlier by this same local-only
-- batch/unit is skipped. Any content drift, cross-unit collision, paid run, or
-- pre-existing external row still fails closed with the original 23505 gate.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $vendor_disclosure_exact_semantic_duplicate_patch$
DECLARE
  stage_function regprocedure := pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  stage_definition text;
  patched_definition text;
  old_fragment constant text := $old_fragment$RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';$old_fragment$;
  new_fragment constant text := $new_fragment$
      -- Legacy local artifacts can contain the same source-backed section
      -- twice. Reconcile only a byte-for-byte payload duplicate already owned
      -- by this exact batch and unit. The paid path intentionally remains
      -- fail-closed because its per-unit attestation preserves multiplicity.
      IF p_authorization_kind = 'local_validated_pending_only' AND EXISTS (
        SELECT 1
        FROM public.disclosure_semantic_staging AS semantic
        JOIN public.vendor_disclosure_ingest_owned_rows AS owned
          ON owned.run_sha256 = p_run_sha256
          AND owned.batch_index = p_batch_index
          AND owned.unit_id = row_value ->> 'unit_id'
          AND owned.row_kind = 'semantic'
          AND owned.row_id = semantic.id
        JOIN public.vendor_disclosure_ingest_record_bindings AS binding
          ON binding.run_sha256 = owned.run_sha256
          AND binding.batch_index = owned.batch_index
          AND binding.unit_id = owned.unit_id
          AND binding.row_kind = owned.row_kind
          AND binding.row_id = owned.row_id
        WHERE semantic.snapshot_id = snapshot_row.id
          AND semantic.source_record_key = row_value ->> 'source_record_key'
          AND semantic.partner_vendor_id IS NOT DISTINCT FROM vendor_id_value
          AND semantic.official_price_id IS NOT DISTINCT FROM official_price_id_value
          AND binding.record_ref = COALESCE(
            partner_ref_value,
            row_value ->> 'source_record_key'
          )
          AND binding.vendor_id IS NOT DISTINCT FROM vendor_id_value
          AND binding.agency_id IS NULL
          AND binding.linked_official_price_id IS NOT DISTINCT FROM official_price_id_value
          AND jsonb_build_object(
            'schema_version', semantic.schema_version,
            'unit_id', semantic.unit_id,
            'record_kind', semantic.record_kind,
            'semantic_type', semantic.semantic_type,
            'subject_kind', semantic.subject_kind,
            'subject_name', semantic.subject_name,
            'subject_normalized_name', semantic.subject_normalized_name,
            'partner_record_ref', semantic.partner_record_ref,
            'source_agency', semantic.source_agency,
            'partner_link_status', semantic.partner_link_status,
            'vendor_category', semantic.vendor_category,
            'region_code', semantic.region_code,
            'title', semantic.title,
            'content_verbatim', semantic.content_verbatim,
            'summary', semantic.summary,
            'review_status', semantic.review_status,
            'needs_review', semantic.needs_review,
            'validation_issue_codes', semantic.validation_issue_codes,
            'source_file_ids', semantic.source_file_ids,
            'source_file', semantic.source_file,
            'source_object_keys', semantic.source_object_keys,
            'source_preview_keys', semantic.source_preview_keys,
            'source_quote', semantic.source_quote,
            'source_fingerprint', semantic.source_fingerprint,
            'validation_fingerprint', semantic.validation_fingerprint,
            'confidence', semantic.confidence,
            'source_record_key', semantic.source_record_key,
            'content_fingerprint', semantic.content_fingerprint
          ) = row_value
      ) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
$new_fragment$;
BEGIN
  IF stage_function IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_EXACT_SEMANTIC_STAGE_FUNCTION_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(proc.oid)
  INTO stage_definition
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = stage_function;

  IF stage_definition IS NULL
    OR length(stage_definition) - length(replace(stage_definition, old_fragment, ''))
      IS DISTINCT FROM length(old_fragment)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_EXACT_SEMANTIC_PREDECESSOR_DRIFT';
  END IF;

  patched_definition := replace(stage_definition, old_fragment, new_fragment);
  IF patched_definition = stage_definition
    OR position('Legacy local artifacts can contain the same source-backed section' IN patched_definition) = 0
  THEN
    RAISE EXCEPTION 'DISCLOSURE_EXACT_SEMANTIC_PATCH_FAILED';
  END IF;

  EXECUTE patched_definition;
END;
$vendor_disclosure_exact_semantic_duplicate_patch$;

ALTER FUNCTION public.stage_vendor_disclosure_batch_atomic(
  text, text, text, text, text, integer, integer, text, text,
  text, text, text[], jsonb, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.stage_vendor_disclosure_batch_atomic(
  text, text, text, text, text, integer, integer, text, text,
  text, text, text[], jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.stage_vendor_disclosure_batch_atomic(
  text, text, text, text, text, integer, integer, text, text,
  text, text, text[], jsonb, jsonb
) TO service_role;

DO $vendor_disclosure_exact_semantic_duplicate_postconditions$
DECLARE
  stage_function regprocedure := pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  stage_definition text;
  stage_owner name;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(proc.oid),
    pg_catalog.pg_get_userbyid(proc.proowner)
  INTO stage_definition, stage_owner
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = stage_function;

  IF stage_function IS NULL
    OR stage_owner IS DISTINCT FROM 'postgres'::name
    OR position(
      'Legacy local artifacts can contain the same source-backed section'
      IN stage_definition
    ) = 0
    OR position(
      $local_only$p_authorization_kind = 'local_validated_pending_only'$local_only$
      IN stage_definition
    ) = 0
    OR position(
      $exact_payload$) = row_value$exact_payload$
      IN stage_definition
    ) = 0
    OR position(
      'DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION'
      IN stage_definition
    ) = 0
    OR pg_catalog.has_function_privilege('anon', stage_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'authenticated', stage_function, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', stage_function, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_EXACT_SEMANTIC_POSTCONDITION_FAILED';
  END IF;
END;
$vendor_disclosure_exact_semantic_duplicate_postconditions$;

COMMIT;
