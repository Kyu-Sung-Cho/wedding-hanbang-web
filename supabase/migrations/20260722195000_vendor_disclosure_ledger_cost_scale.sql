-- Fixes SQLSTATE 23505 in the atomic stage RPC when a validated AI-ledger
-- cost has more than six decimal places. ai_interactions_log.cost_usd is
-- numeric(10,6), so PostgreSQL rounds on INSERT; the equivalence check must
-- compare against the same persisted representation.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.stage_vendor_disclosure_batch_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_batch_plan_sha256 text,
  p_batch_sha256 text,
  p_batch_index integer,
  p_batch_count integer,
  p_snapshot_source text,
  p_snapshot_period text,
  p_authorization_kind text,
  p_authorization_sha256 text,
  p_local_pending_only_unit_ids text[],
  p_storage_objects jsonb,
  p_payload jsonb
)
RETURNS TABLE (
  batch_receipt_sha256 text,
  loaded_unit_ids text[],
  logged_ledger_ids text[],
  already_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $stage_vendor_disclosure_batch_atomic$
DECLARE
  snapshot_row public.price_snapshots%ROWTYPE;
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  stored_batch public.vendor_disclosure_ingest_batches%ROWTYPE;
  payload_sha256_value text;
  unit_ids_value text[];
  logged_ids_value text[] := '{}'::text[];
  row_value jsonb;
  option_value jsonb;
  alias_value text;
  agency_value jsonb;
  agency_id_value uuid;
  package_id_value uuid;
  vendor_id_value uuid;
  official_price_id_value uuid;
  semantic_id_value uuid;
  ledger_id_value text;
  ledger_uuid_value uuid;
  ledger_row public.ai_interactions_log%ROWTYPE;
  expected_ledger_metadata jsonb;
  ledger_initial_row_sha256_value text;
  provider_mode_value text;
  paid_plan_sha256_value text;
  successful_ledger_id_value uuid;
  provider_model_value text;
  request_hash_value text;
  source_fingerprint_value text;
  conversion_fingerprint_value text;
  extraction_fingerprint_value text;
  validation_fingerprint_value text;
  unit_payload_sha256_value text;
  paid_attestation_sha256_value text;
  paid_success_count integer;
  provider_lineage_sha256_value text;
  affected_rows integer;
  partner_ref_value text;
  record_ref_value text;
  record_binding_sha256_value text;
  staged_count integer := 0;
  review_count integer := 0;
  receipt_sha256_value text;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_count NOT BETWEEN 1 AND 1000
    OR p_batch_index NOT BETWEEN 1 AND p_batch_count
    OR cardinality(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) > 1000
    OR p_authorization_kind NOT IN ('paid_pilot_gate', 'local_validated_pending_only')
    OR p_authorization_sha256 !~ '^[0-9a-f]{64}$'
    OR (cardinality(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) > 0)
      IS DISTINCT FROM (p_authorization_kind = 'local_validated_pending_only')
    OR p_storage_objects IS NULL
    OR jsonb_typeof(p_storage_objects) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_storage_objects) NOT BETWEEN 1 AND 2000
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
      WHERE jsonb_typeof(supplied.value) IS DISTINCT FROM 'object'
        OR supplied.value ->> 'bucket' NOT IN ('disclosure-raw', 'disclosure-preview')
        OR COALESCE(supplied.value ->> 'object_key', '') !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
        OR COALESCE(supplied.value ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        OR split_part(supplied.value ->> 'object_key', '.', 1) IS DISTINCT FROM supplied.value ->> 'sha256'
        OR COALESCE(supplied.value ->> 'bytes', '') !~ '^[0-9]{1,9}$'
        OR (supplied.value ->> 'bytes')::bigint > 52428800
        OR jsonb_typeof(supplied.value -> 'created') IS DISTINCT FROM 'boolean'
    )
    OR jsonb_array_length(p_storage_objects) IS DISTINCT FROM (
      SELECT count(DISTINCT (value ->> 'bucket', value ->> 'object_key'))
      FROM jsonb_array_elements(p_storage_objects)
    )
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR NOT p_payload ?& ARRAY[
      'schema_version', 'snapshot', 'snapshot_source', 'units', 'skipped_units',
      'raw_objects', 'preview_objects', 'agency_packages', 'official_prices',
      'disclosure_semantics', 'dedupe_candidates', 'ai_ledger', 'warnings'
    ]::text[]
    OR (p_payload ->> 'schema_version')::integer <> 2
    OR p_payload ->> 'snapshot' IS DISTINCT FROM p_snapshot_period
    OR p_payload ->> 'snapshot_source' IS DISTINCT FROM p_snapshot_source
    OR jsonb_typeof(p_payload -> 'units') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'units') NOT BETWEEN 1 AND 25
    OR jsonb_typeof(p_payload -> 'raw_objects') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'preview_objects') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'agency_packages') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'agency_packages') > 5000
    OR jsonb_typeof(p_payload -> 'official_prices') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'official_prices') > 5000
    OR jsonb_typeof(p_payload -> 'disclosure_semantics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'disclosure_semantics') > 5000
    OR jsonb_typeof(p_payload -> 'dedupe_candidates') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'dedupe_candidates') <> 0
    OR jsonb_typeof(p_payload -> 'ai_ledger') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'ai_ledger') > 5000
    OR NOT public.vendor_disclosure_payload_provenance_is_safe(p_payload)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(unit.value ->> 'unit_id' ORDER BY unit.ordinality)
  INTO unit_ids_value
  FROM jsonb_array_elements(p_payload -> 'units') WITH ORDINALITY AS unit(value, ordinality);
  IF cardinality(unit_ids_value) <> cardinality(ARRAY(
      SELECT DISTINCT unit_id FROM unnest(unit_ids_value) AS source(unit_id)
    ))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
      WHERE unit.value ->> 'unit_id' IS NULL
        OR unit.value ->> 'unit_id' !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'source_fingerprint', '') !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'conversion_fingerprint', '') !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'extraction_fingerprint', '') !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'validation_fingerprint', '') !~ '^[0-9a-f]{64}$'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_INVALID_UNITS' USING ERRCODE = '22023';
  END IF;
  IF p_authorization_kind = 'local_validated_pending_only' AND EXISTS (
    SELECT 1 FROM unnest(unit_ids_value) AS unit(unit_id)
    WHERE NOT COALESCE(
      unit.unit_id = ANY(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])),
      false
    )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LOCAL_UNIT_OUTSIDE_AUTHORIZATION' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT package.value AS value FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
      UNION ALL
      SELECT price.value FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
      UNION ALL
      SELECT semantic.value FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
    ) AS staging_row
    WHERE staging_row.value ->> 'review_status' IS DISTINCT FROM 'pending'
      OR jsonb_typeof(staging_row.value -> 'needs_review') IS DISTINCT FROM 'boolean'
      OR staging_row.value ->> 'unit_id' IS NULL
      OR NOT COALESCE((staging_row.value ->> 'unit_id') = ANY(unit_ids_value), false)
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PENDING_ONLY' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
    WHERE COALESCE(price.value -> 'price_min_krw', 'null'::jsonb) = 'null'::jsonb
      AND COALESCE(price.value -> 'price_max_krw', 'null'::jsonb) = 'null'::jsonb
      AND (price.value ->> 'needs_review')::boolean IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_UNPRICED_ROW_REVIEW_ONLY' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
    WHERE price.value ->> 'category' IS NULL
      OR price.value ->> 'category' NOT IN ('studio', 'dress', 'makeup', 'hall')
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
    WHERE semantic.value ->> 'record_kind' = 'vendor_policy'
      AND (
        semantic.value ->> 'vendor_category' IS NULL
        OR semantic.value ->> 'vendor_category' NOT IN ('studio', 'dress', 'makeup', 'hall')
      )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_FOUR_TAB_CATEGORY_ONLY' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT package.value AS value FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
      UNION ALL
      SELECT price.value FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
      UNION ALL
      SELECT semantic.value FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
    ) AS staging_row
    WHERE COALESCE((staging_row.value ->> 'unit_id') = ANY(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])), false)
      AND (
        (staging_row.value ->> 'needs_review')::boolean IS DISTINCT FROM true
        OR NOT COALESCE(
          staging_row.value -> 'validation_issue_codes' @> '["local_deterministic_review_only"]'::jsonb,
          false
        )
      )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LOCAL_REVIEW_ONLY_CONTRACT' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(unit_ids_value) AS unit(unit_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM (
        SELECT package.value ->> 'unit_id' AS unit_id
        FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
        UNION ALL
        SELECT price.value ->> 'unit_id'
        FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
        UNION ALL
        SELECT semantic.value ->> 'unit_id'
        FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
      ) AS staged
      WHERE staged.unit_id = unit.unit_id
    )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_UNIT_WITHOUT_ROWS' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'ai_ledger') AS ledger(value)
    WHERE ledger.value ->> 'unit_id' IS NULL
      OR NOT COALESCE((ledger.value ->> 'unit_id') = ANY(unit_ids_value), false)
      OR COALESCE(ledger.value ->> 'ledger_id', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(ledger.value ->> 'schema_version', '') !~ '^[23]$'
      OR (
        ledger.value ->> 'schema_version' = '3'
        AND (
          ledger.value ->> 'provider_mode' NOT IN ('production_paid', 'test_only')
          OR COALESCE(ledger.value ->> 'request_hash', '') !~ '^[0-9a-f]{64}$'
          OR (
            ledger.value ->> 'provider_mode' = 'production_paid'
            AND COALESCE(ledger.value ->> 'paid_plan_sha256', '') !~ '^[0-9a-f]{64}$'
          )
          OR (
            ledger.value ->> 'provider_mode' = 'test_only'
            AND ledger.value -> 'paid_plan_sha256' <> 'null'::jsonb
          )
          OR (
            (ledger.value ->> 'success')::boolean
            AND ledger.value ->> 'provider_mode' = 'production_paid'
            AND NULLIF(btrim(ledger.value ->> 'provider_model'), '') IS NULL
          )
        )
      )
  ) OR jsonb_array_length(p_payload -> 'ai_ledger') IS DISTINCT FROM (
    SELECT count(DISTINCT ledger.value ->> 'ledger_id')
    FROM jsonb_array_elements(p_payload -> 'ai_ledger') AS ledger(value)
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_OUTSIDE_BATCH' USING ERRCODE = '23514';
  END IF;
  payload_sha256_value := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row
  FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256
  FOR UPDATE;
  IF run_row.run_sha256 IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_STORAGE_PREPARE_REQUIRED' USING ERRCODE = '55000';
  ELSE
    IF run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
      OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
      OR run_row.authorization_kind IS DISTINCT FROM p_authorization_kind
      OR run_row.authorization_sha256 IS DISTINCT FROM p_authorization_sha256
      OR run_row.local_pending_only_unit_ids IS DISTINCT FROM COALESCE(p_local_pending_only_unit_ids, '{}'::text[])
      OR run_row.snapshot_source IS DISTINCT FROM p_snapshot_source
      OR run_row.snapshot_period IS DISTINCT FROM p_snapshot_period
      OR run_row.batch_count IS DISTINCT FROM p_batch_count
    THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_CONFLICT' USING ERRCODE = '23505';
    END IF;
    -- Terminal runs may retain immutable batch receipts for audit, but those
    -- receipts are never executable replay authority.
    IF run_row.status = 'invalidated' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_INVALIDATED' USING ERRCODE = '55000';
    ELSIF run_row.status = 'aborted' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_ABORTED' USING ERRCODE = '55000';
    END IF;
    SELECT batch.* INTO stored_batch
    FROM public.vendor_disclosure_ingest_batches AS batch
    WHERE batch.run_sha256 = p_run_sha256
      AND batch.batch_index = p_batch_index;
    IF stored_batch.id IS NOT NULL THEN
      IF stored_batch.batch_sha256 IS DISTINCT FROM p_batch_sha256
        OR stored_batch.batch_plan_sha256 IS DISTINCT FROM p_batch_plan_sha256
        OR stored_batch.payload_sha256 IS DISTINCT FROM payload_sha256_value
        OR stored_batch.unit_ids IS DISTINCT FROM unit_ids_value
      THEN
        RAISE EXCEPTION 'DISCLOSURE_ATOMIC_BATCH_CONFLICT' USING ERRCODE = '23505';
      END IF;
      batch_receipt_sha256 := stored_batch.batch_receipt_sha256;
      loaded_unit_ids := stored_batch.unit_ids;
      logged_ledger_ids := stored_batch.logged_ledger_ids;
      already_applied := true;
      RETURN NEXT;
      RETURN;
    END IF;
    IF run_row.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_NOT_ACTIVE' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- EXCLUSIVE conflicts with the ROW SHARE table lock taken by SELECT FOR
  -- UPDATE. Acquire only the two parent tables: this blocks the existing
  -- entity-first dedupe paths without creating a child-table lock-upgrade
  -- cycle with price/package admin review.
  LOCK TABLE public.vendors, public.agencies IN EXCLUSIVE MODE NOWAIT;

  SELECT snapshot.* INTO snapshot_row
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = run_row.snapshot_id
  FOR UPDATE NOWAIT;
  IF snapshot_row.id IS NULL
    OR snapshot_row.published
    OR snapshot_row.is_current
    OR snapshot_row.published_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_SNAPSHOT_NOT_DRAFT' USING ERRCODE = '55000';
  END IF;

  IF run_row.snapshot_id IS DISTINCT FROM snapshot_row.id THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_SNAPSHOT_CONFLICT' USING ERRCODE = '23505';
  END IF;

  PERFORM public.assert_vendor_disclosure_storage_upload_claims_settled(p_run_sha256);

  IF jsonb_array_length(p_storage_objects)
      IS DISTINCT FROM jsonb_array_length(p_payload -> 'raw_objects') + jsonb_array_length(p_payload -> 'preview_objects')
    OR EXISTS (
      SELECT 1
      FROM (
        SELECT 'disclosure-raw'::text AS bucket_id,
          raw.value ->> 'storage_path' AS object_name,
          raw.value ->> 'sha256' AS object_sha256,
          (raw.value ->> 'bytes')::bigint AS object_bytes
        FROM jsonb_array_elements(p_payload -> 'raw_objects') AS raw(value)
        UNION ALL
        SELECT 'disclosure-preview'::text,
          preview.value ->> 'storage_path', preview.value ->> 'sha256',
          (preview.value ->> 'bytes')::bigint
        FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
      ) AS expected
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
        WHERE supplied.value ->> 'bucket' = expected.bucket_id
          AND supplied.value ->> 'object_key' = expected.object_name
          AND supplied.value ->> 'sha256' = expected.object_sha256
          AND (supplied.value ->> 'bytes')::bigint = expected.object_bytes
      )
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.vendor_disclosure_ingest_storage_links AS link
        WHERE link.run_sha256 = p_run_sha256
          AND link.batch_index <= p_batch_index
          AND link.bucket_id = supplied.value ->> 'bucket'
          AND link.object_name = supplied.value ->> 'object_key'
          AND link.object_sha256 = supplied.value ->> 'sha256'
          AND link.object_bytes = (supplied.value ->> 'bytes')::bigint
          AND (
            ((supplied.value ->> 'created')::boolean
              AND link.ownership_state = 'confirmed_created')
            OR (NOT (supplied.value ->> 'created')::boolean
              AND link.ownership_state IN ('confirmed_preexisting', 'confirmed_inherited'))
          )
          AND EXISTS (
            SELECT 1 FROM storage.objects AS object
            WHERE object.bucket_id = link.bucket_id AND object.name = link.object_name
              AND object.id = link.storage_object_id
              AND object.updated_at = link.storage_object_updated_at
              AND object.metadata ->> 'size' = link.object_bytes::text
              AND (
                link.ownership_state = 'confirmed_preexisting'
                OR (
                  object.user_metadata ->> 'ingest_run_sha256' = link.storage_metadata_owner_run_sha256
                  AND object.user_metadata ->> 'ingest_sha256' = link.object_sha256
                  AND object.user_metadata ->> 'ingest_bytes' = link.object_bytes::text
                )
              )
          )
      )
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_STORAGE_OUTCOME_INCOMPLETE' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'raw_objects') AS raw(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'disclosure-raw'
        AND object.name = raw.value ->> 'storage_path'
        AND object.metadata ->> 'size' IS NOT DISTINCT FROM raw.value ->> 'bytes'
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'disclosure-preview'
        AND object.name = preview.value ->> 'storage_path'
        AND object.metadata ->> 'size' IS NOT DISTINCT FROM preview.value ->> 'bytes'
    )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_STORAGE_OBJECT_MISSING_OR_WRONG_SIZE' USING ERRCODE = '23514';
  END IF;
  IF p_batch_index IS DISTINCT FROM run_row.completed_batch_count + 1 THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_BATCH_NOT_ADJACENT' USING ERRCODE = '40001';
  END IF;

  FOR row_value IN SELECT ledger.value FROM jsonb_array_elements(p_payload -> 'ai_ledger') AS ledger(value)
  LOOP
    ledger_id_value := row_value ->> 'ledger_id';
    IF COALESCE(ledger_id_value, '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_ID_INVALID' USING ERRCODE = '22023';
    END IF;
    ledger_uuid_value := (
      substr(ledger_id_value, 1, 8) || '-' || substr(ledger_id_value, 9, 4)
      || '-4' || substr(ledger_id_value, 14, 3)
      || '-8' || substr(ledger_id_value, 18, 3)
      || '-' || substr(ledger_id_value, 21, 12)
    )::uuid;
    expected_ledger_metadata := jsonb_build_object(
      'ingest_call_id', ledger_id_value,
      'ingest_ledger_id', ledger_id_value,
      'ingest_run_id', row_value ->> 'run_id',
      'unit_id', row_value ->> 'unit_id',
      'fingerprint', row_value ->> 'fingerprint',
      'prompt_version', row_value ->> 'prompt_version',
      'request_id', row_value ->> 'request_id',
      'batch_index', (row_value ->> 'batch_index')::integer,
      'attempt', (row_value ->> 'attempt')::integer,
      'ledger_schema_version', (row_value ->> 'schema_version')::integer,
      'provider_mode', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'provider_mode' ELSE NULL END,
      'paid_plan_sha256', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'paid_plan_sha256' ELSE NULL END,
      'provider_model', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'provider_model' ELSE NULL END,
      'request_hash', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'request_hash' ELSE NULL END,
      'source', 'local_disclosure_ingest'
    );
    INSERT INTO public.ai_interactions_log (
      id, session_id, interaction_type, tool_name, latency_ms, success,
      error_message, model, tokens_input, tokens_output, cost_usd, metadata, created_at
    ) VALUES (
      ledger_uuid_value, 'disclosure_ingest', 'disclosure_extraction', 'disclosure_extraction',
      (row_value ->> 'latency_ms')::integer,
      (row_value ->> 'success')::boolean,
      row_value ->> 'error_category',
      COALESCE(row_value ->> 'provider_model', row_value ->> 'model'),
      (row_value ->> 'input_tokens')::integer,
      (row_value ->> 'output_tokens')::integer,
      (row_value ->> 'estimated_cost_usd')::numeric(10,6),
      expected_ledger_metadata,
      (row_value ->> 'attempted_at')::timestamptz
    ) ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    SELECT ledger.* INTO ledger_row
    FROM public.ai_interactions_log AS ledger
    WHERE ledger.id = ledger_uuid_value
    FOR SHARE;
    IF ledger_row.id IS NULL
      OR ledger_row.session_id IS DISTINCT FROM 'disclosure_ingest'
      OR ledger_row.interaction_type IS DISTINCT FROM 'disclosure_extraction'
      OR ledger_row.tool_name IS DISTINCT FROM 'disclosure_extraction'
      OR ledger_row.latency_ms IS DISTINCT FROM (row_value ->> 'latency_ms')::integer
      OR ledger_row.success IS DISTINCT FROM (row_value ->> 'success')::boolean
      OR ledger_row.error_message IS DISTINCT FROM row_value ->> 'error_category'
      OR ledger_row.model IS DISTINCT FROM COALESCE(row_value ->> 'provider_model', row_value ->> 'model')
      OR ledger_row.tokens_input IS DISTINCT FROM (row_value ->> 'input_tokens')::integer
      OR ledger_row.tokens_output IS DISTINCT FROM (row_value ->> 'output_tokens')::integer
      OR ledger_row.cost_usd IS DISTINCT FROM (row_value ->> 'estimated_cost_usd')::numeric(10,6)
      OR ledger_row.metadata IS DISTINCT FROM expected_ledger_metadata
      OR ledger_row.created_at IS DISTINCT FROM (row_value ->> 'attempted_at')::timestamptz
    THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_CONFLICT' USING ERRCODE = '23505';
    END IF;
    ledger_initial_row_sha256_value := encode(extensions.digest(
      convert_to(to_jsonb(ledger_row)::text, 'UTF8'), 'sha256'
    ), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_owned_ledger_rows (
      run_sha256, batch_index, ledger_id, initial_row_sha256,
      created_by_run, cleanup_status
    ) VALUES (
      p_run_sha256, p_batch_index, ledger_uuid_value, ledger_initial_row_sha256_value,
      affected_rows = 1, CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
    ) ON CONFLICT (run_sha256, ledger_id) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned
      WHERE owned.run_sha256 = p_run_sha256
        AND owned.batch_index = p_batch_index
        AND owned.ledger_id = ledger_uuid_value
        AND owned.initial_row_sha256 = ledger_initial_row_sha256_value
        AND owned.created_by_run = (affected_rows = 1)
        AND owned.cleanup_status = CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_OWNERSHIP_CONFLICT' USING ERRCODE = '23505';
    END IF;
    logged_ids_value := array_append(logged_ids_value, ledger_id_value);
  END LOOP;

  FOR row_value IN
    SELECT unit.value FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
  LOOP
    provider_mode_value := 'unproven';
    paid_plan_sha256_value := NULL;
    successful_ledger_id_value := NULL;
    provider_model_value := NULL;
    request_hash_value := NULL;
    source_fingerprint_value := NULL;
    conversion_fingerprint_value := NULL;
    extraction_fingerprint_value := NULL;
    validation_fingerprint_value := NULL;
    unit_payload_sha256_value := public.vendor_disclosure_unit_payload_sha256(
      p_payload,
      row_value ->> 'unit_id'
    );
    paid_attestation_sha256_value := NULL;
    paid_success_count := 0;

    IF p_authorization_kind = 'local_validated_pending_only'
      OR COALESCE(
      row_value -> 'validation_issue_codes' @> '["local_deterministic_review_only"]'::jsonb,
      false
    ) THEN
      provider_mode_value := 'local_deterministic';
    ELSE
      SELECT count(*)::integer
      INTO paid_success_count
      FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned_ledger
      JOIN public.ai_interactions_log AS ledger ON ledger.id = owned_ledger.ledger_id
      JOIN public.vendor_disclosure_paid_extraction_attestations AS attestation
        ON attestation.run_sha256 = owned_ledger.run_sha256
        AND attestation.batch_index = owned_ledger.batch_index
        AND attestation.ledger_id = owned_ledger.ledger_id
      WHERE owned_ledger.run_sha256 = p_run_sha256
        AND owned_ledger.batch_index = p_batch_index
        AND owned_ledger.created_by_run = true
        AND owned_ledger.cleanup_status = 'owned'
        AND (
          SELECT count(*)
          FROM public.vendor_disclosure_ingest_owned_ledger_rows AS any_owner
          WHERE any_owner.ledger_id = owned_ledger.ledger_id
        ) = 1
        AND ledger.session_id = 'disclosure_ingest'
        AND ledger.interaction_type = 'disclosure_extraction'
        AND ledger.tool_name = 'disclosure_extraction'
        AND ledger.success = true
        AND ledger.error_message IS NULL
        AND ledger.metadata ->> 'source' = 'local_disclosure_ingest'
        AND ledger.metadata ->> 'unit_id' = row_value ->> 'unit_id'
        AND ledger.metadata ->> 'ledger_schema_version' = '3'
        AND ledger.metadata ->> 'provider_mode' = 'production_paid'
        AND COALESCE(ledger.metadata ->> 'paid_plan_sha256', '') ~ '^[0-9a-f]{64}$'
        AND NULLIF(btrim(ledger.metadata ->> 'provider_model'), '') IS NOT NULL
        AND ledger.model = ledger.metadata ->> 'provider_model'
        AND attestation.unit_id = row_value ->> 'unit_id'
        AND attestation.request_hash = ledger.metadata ->> 'request_hash'
        AND attestation.extraction_fingerprint = ledger.metadata ->> 'fingerprint'
        AND attestation.paid_plan_sha256 = ledger.metadata ->> 'paid_plan_sha256'
        AND attestation.provider_model = ledger.metadata ->> 'provider_model'
        AND attestation.source_fingerprint = row_value ->> 'source_fingerprint'
        AND attestation.conversion_fingerprint = row_value ->> 'conversion_fingerprint'
        AND attestation.extraction_fingerprint = row_value ->> 'extraction_fingerprint'
        AND attestation.validation_fingerprint = row_value ->> 'validation_fingerprint'
        AND attestation.full_plan_sha256 = p_full_plan_sha256
        AND attestation.batch_plan_sha256 = p_batch_plan_sha256
        AND attestation.batch_sha256 = p_batch_sha256
        AND attestation.payload_sha256 = payload_sha256_value
        AND attestation.unit_payload_sha256 = unit_payload_sha256_value;

      IF paid_success_count = 1 THEN
        SELECT ledger.id, attestation.paid_plan_sha256,
          attestation.provider_model, attestation.request_hash,
          attestation.source_fingerprint, attestation.conversion_fingerprint,
          attestation.extraction_fingerprint, attestation.validation_fingerprint,
          attestation.attestation_sha256
        INTO successful_ledger_id_value, paid_plan_sha256_value, provider_model_value,
          request_hash_value, source_fingerprint_value, conversion_fingerprint_value,
          extraction_fingerprint_value, validation_fingerprint_value,
          paid_attestation_sha256_value
        FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned_ledger
        JOIN public.ai_interactions_log AS ledger ON ledger.id = owned_ledger.ledger_id
        JOIN public.vendor_disclosure_paid_extraction_attestations AS attestation
          ON attestation.run_sha256 = owned_ledger.run_sha256
          AND attestation.batch_index = owned_ledger.batch_index
          AND attestation.ledger_id = owned_ledger.ledger_id
        WHERE owned_ledger.run_sha256 = p_run_sha256
          AND owned_ledger.batch_index = p_batch_index
          AND owned_ledger.created_by_run = true
          AND owned_ledger.cleanup_status = 'owned'
          AND (
            SELECT count(*)
            FROM public.vendor_disclosure_ingest_owned_ledger_rows AS any_owner
            WHERE any_owner.ledger_id = owned_ledger.ledger_id
          ) = 1
          AND ledger.session_id = 'disclosure_ingest'
          AND ledger.interaction_type = 'disclosure_extraction'
          AND ledger.tool_name = 'disclosure_extraction'
          AND ledger.success = true
          AND ledger.error_message IS NULL
          AND ledger.metadata ->> 'source' = 'local_disclosure_ingest'
          AND ledger.metadata ->> 'unit_id' = row_value ->> 'unit_id'
          AND ledger.metadata ->> 'ledger_schema_version' = '3'
          AND ledger.metadata ->> 'provider_mode' = 'production_paid'
          AND COALESCE(ledger.metadata ->> 'paid_plan_sha256', '') ~ '^[0-9a-f]{64}$'
          AND NULLIF(btrim(ledger.metadata ->> 'provider_model'), '') IS NOT NULL
          AND ledger.model = ledger.metadata ->> 'provider_model'
          AND attestation.unit_id = row_value ->> 'unit_id'
          AND attestation.request_hash = ledger.metadata ->> 'request_hash'
          AND attestation.extraction_fingerprint = ledger.metadata ->> 'fingerprint'
          AND attestation.paid_plan_sha256 = ledger.metadata ->> 'paid_plan_sha256'
          AND attestation.provider_model = ledger.metadata ->> 'provider_model'
          AND attestation.source_fingerprint = row_value ->> 'source_fingerprint'
          AND attestation.conversion_fingerprint = row_value ->> 'conversion_fingerprint'
          AND attestation.extraction_fingerprint = row_value ->> 'extraction_fingerprint'
          AND attestation.validation_fingerprint = row_value ->> 'validation_fingerprint'
          AND attestation.full_plan_sha256 = p_full_plan_sha256
          AND attestation.batch_plan_sha256 = p_batch_plan_sha256
          AND attestation.batch_sha256 = p_batch_sha256
          AND attestation.payload_sha256 = payload_sha256_value
          AND attestation.unit_payload_sha256 = unit_payload_sha256_value;
        provider_mode_value := 'production_paid';
      END IF;
    END IF;

    provider_lineage_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'provider_mode', provider_mode_value,
      'paid_plan_sha256', paid_plan_sha256_value,
      'successful_ledger_id', successful_ledger_id_value,
      'provider_model', provider_model_value,
      'request_hash', request_hash_value,
      'source_fingerprint', source_fingerprint_value,
      'conversion_fingerprint', conversion_fingerprint_value,
      'extraction_fingerprint', extraction_fingerprint_value,
      'validation_fingerprint', validation_fingerprint_value,
      'paid_attestation_sha256', paid_attestation_sha256_value,
      'bulk_approval_eligible', provider_mode_value = 'production_paid'
    )::text, 'UTF8'), 'sha256'), 'hex');

    INSERT INTO public.vendor_disclosure_ingest_unit_provider_lineage (
      run_sha256, batch_index, unit_id, provider_mode, paid_plan_sha256,
      successful_ledger_id, provider_model, request_hash, source_fingerprint,
      conversion_fingerprint, extraction_fingerprint, validation_fingerprint,
      paid_attestation_sha256, bulk_approval_eligible, lineage_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', provider_mode_value,
      paid_plan_sha256_value, successful_ledger_id_value, provider_model_value,
      request_hash_value, source_fingerprint_value, conversion_fingerprint_value,
      extraction_fingerprint_value, validation_fingerprint_value,
      paid_attestation_sha256_value,
      provider_mode_value = 'production_paid', provider_lineage_sha256_value
    );
  END LOOP;

  -- All following pending KCA inserts are guarded by table triggers. Keep the
  -- marker transaction-local so it cannot leak through a pooled connection.
  PERFORM set_config(
    'app.vendor_disclosure_atomic_run_sha256',
    p_run_sha256,
    true
  );

  FOR row_value IN SELECT package.value FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
  LOOP
    agency_id_value := public.ensure_vendor_disclosure_agency_pending(
      p_run_sha256,
      p_batch_index,
      row_value ->> 'agency_name',
      row_value ->> 'agency_normalized_name',
      row_value ->> 'agency_corporate_name',
      row_value ->> 'region_code',
      row_value ->> 'source_file'
    );
    IF EXISTS (
      SELECT 1 FROM public.official_agency_packages AS package
      WHERE package.snapshot_id = snapshot_row.id
        AND package.agency_id = agency_id_value
        AND package.package_name = row_value ->> 'package_name'
        AND package.source_file = row_value ->> 'source_file'
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_PACKAGE_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.official_agency_packages (
      snapshot_id, agency_id, package_name, category_scope,
      price_min_krw, price_max_krw, vat_note, price_note, options,
      review_status, needs_review, validation_issue_codes, source_file,
      source_object_keys, source_preview_keys, source_quote, confidence,
      edited_by_admin
    ) VALUES (
      snapshot_row.id,
      agency_id_value,
      row_value ->> 'package_name',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'category_scope')),
      (row_value ->> 'price_min_krw')::integer,
      (row_value ->> 'price_max_krw')::integer,
      row_value ->> 'vat_note',
      row_value ->> 'price_note',
      row_value -> 'options',
      'pending', (row_value ->> 'needs_review')::boolean,
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
      row_value ->> 'source_file',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_object_keys')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_preview_keys')),
      row_value ->> 'source_quote',
      (row_value ->> 'confidence')::numeric,
      false
    ) RETURNING id INTO package_id_value;
    INSERT INTO public.vendor_disclosure_ingest_owned_rows (
      run_sha256, batch_index, unit_id, row_kind, row_id
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'agency_package', package_id_value
    );
    record_ref_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'unit_id', row_value ->> 'unit_id',
      'package_name', row_value -> 'package_name',
      'source_file', row_value -> 'source_file',
      'source_quote', row_value -> 'source_quote'
    )::text, 'UTF8'), 'sha256'), 'hex');
    record_binding_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'row_kind', 'agency_package',
      'row_id', package_id_value,
      'record_ref', record_ref_value,
      'vendor_id', NULL,
      'agency_id', agency_id_value,
      'linked_official_price_id', NULL
    )::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_record_bindings (
      run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
      vendor_id, agency_id, linked_official_price_id, binding_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'agency_package',
      package_id_value, record_ref_value, NULL, agency_id_value, NULL,
      record_binding_sha256_value
    );
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, record_ref, agency_id
    ) VALUES (
      p_run_sha256, row_value ->> 'unit_id', 'agency', '', agency_id_value
    ) ON CONFLICT DO NOTHING;
    staged_count := staged_count + 1;
    IF (row_value ->> 'needs_review')::boolean THEN
      review_count := review_count + 1;
    END IF;
  END LOOP;

  FOR row_value IN SELECT price.value FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
  LOOP
    vendor_id_value := public.ensure_vendor_disclosure_vendor_pending(
      p_run_sha256,
      p_batch_index,
      row_value ->> 'vendor_name',
      row_value ->> 'category',
      row_value ->> 'region_code'
    );
    agency_id_value := NULL;
    agency_value := row_value -> 'source_agency';
    IF agency_value IS NOT NULL AND jsonb_typeof(agency_value) = 'object' THEN
      agency_id_value := public.ensure_vendor_disclosure_agency_pending(
        p_run_sha256,
        p_batch_index,
        agency_value ->> 'name',
        agency_value ->> 'normalized_name',
        agency_value ->> 'corporate_name',
        agency_value ->> 'region_code',
        agency_value ->> 'source_file'
      );
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.official_prices AS price
      WHERE price.snapshot_id = snapshot_row.id
        AND price.source_record_key = row_value ->> 'source_record_key'
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_PRICE_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.official_prices (
      snapshot_id, vendor_id, agency_id, category, item_name, base_spec,
      price_min_krw, price_max_krw, vat_note, price_note, review_status,
      needs_review, validation_issue_codes, source_file, source_object_keys,
      source_preview_keys, source_quote, confidence, source_record_key,
      edited_by_admin
    ) VALUES (
      snapshot_row.id, vendor_id_value, agency_id_value,
      row_value ->> 'category', row_value ->> 'item_name', row_value ->> 'base_spec',
      (row_value ->> 'price_min_krw')::integer,
      (row_value ->> 'price_max_krw')::integer,
      row_value ->> 'vat_note', row_value ->> 'price_note', 'pending',
      (row_value ->> 'needs_review')::boolean,
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
      row_value ->> 'source_file',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_object_keys')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_preview_keys')),
      row_value ->> 'source_quote',
      (row_value ->> 'confidence')::numeric,
      row_value ->> 'source_record_key', false
    ) RETURNING id INTO official_price_id_value;
    INSERT INTO public.vendor_disclosure_ingest_owned_rows (
      run_sha256, batch_index, unit_id, row_kind, row_id
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'official_price', official_price_id_value
    );
    FOR option_value IN SELECT option_row.value FROM jsonb_array_elements(row_value -> 'options') AS option_row(value)
    LOOP
      INSERT INTO public.official_price_options (
        official_price_id, name, price_min_krw, price_max_krw, unit,
        condition, raw_text, source_file, source_quote, source_object_keys,
        confidence
      ) VALUES (
        official_price_id_value,
        option_value ->> 'name',
        (option_value ->> 'price_min_krw')::integer,
        (option_value ->> 'price_max_krw')::integer,
        option_value ->> 'unit',
        option_value ->> 'condition',
        option_value ->> 'raw_text',
        option_value ->> 'source_file',
        option_value ->> 'source_quote',
        ARRAY(SELECT jsonb_array_elements_text(option_value -> 'source_object_keys')),
        (option_value ->> 'confidence')::numeric
      );
    END LOOP;
    FOR alias_value IN SELECT alias.value FROM jsonb_array_elements_text(row_value -> 'alias_proposals') AS alias(value)
    LOOP
      INSERT INTO public.vendor_alias_proposals (
        official_price_id, vendor_id, alias, normalized_alias, status
      ) VALUES (
        official_price_id_value, vendor_id_value, btrim(alias_value),
        public.normalize_price_vendor_name(alias_value), 'pending'
      ) ON CONFLICT (official_price_id, normalized_alias) DO NOTHING;
    END LOOP;
    partner_ref_value := NULLIF(row_value ->> 'partner_record_ref', '');
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, record_ref, vendor_id, official_price_id
    ) VALUES (
      p_run_sha256, row_value ->> 'unit_id', 'vendor',
      COALESCE(partner_ref_value, row_value ->> 'source_record_key'),
      vendor_id_value, official_price_id_value
    );
    IF agency_id_value IS NOT NULL THEN
      INSERT INTO public.vendor_disclosure_ingest_identity_links (
        run_sha256, unit_id, identity_kind, record_ref, agency_id
      ) VALUES (
        p_run_sha256, row_value ->> 'unit_id', 'agency', '', agency_id_value
      ) ON CONFLICT DO NOTHING;
    END IF;
    record_ref_value := COALESCE(partner_ref_value, row_value ->> 'source_record_key');
    record_binding_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'row_kind', 'official_price',
      'row_id', official_price_id_value,
      'record_ref', record_ref_value,
      'vendor_id', vendor_id_value,
      'agency_id', agency_id_value,
      'linked_official_price_id', NULL
    )::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_record_bindings (
      run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
      vendor_id, agency_id, linked_official_price_id, binding_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'official_price',
      official_price_id_value, record_ref_value, vendor_id_value,
      agency_id_value, NULL, record_binding_sha256_value
    );
    staged_count := staged_count + 1;
    IF (row_value ->> 'needs_review')::boolean THEN
      review_count := review_count + 1;
    END IF;
  END LOOP;

  FOR row_value IN SELECT semantic.value FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
  LOOP
    vendor_id_value := NULL;
    official_price_id_value := NULL;
    partner_ref_value := NULLIF(row_value ->> 'partner_record_ref', '');
    IF row_value ->> 'record_kind' = 'vendor_policy' THEN
      SELECT link.vendor_id, link.official_price_id
      INTO vendor_id_value, official_price_id_value
      FROM public.vendor_disclosure_ingest_identity_links AS link
      WHERE link.run_sha256 = p_run_sha256
        AND link.unit_id = row_value ->> 'unit_id'
        AND link.identity_kind = 'vendor'
        AND link.record_ref = partner_ref_value;
      IF vendor_id_value IS NULL AND row_value ->> 'partner_link_status' = 'policy_only_pending_identity' THEN
        vendor_id_value := public.ensure_vendor_disclosure_vendor_pending(
          p_run_sha256,
          p_batch_index,
          row_value ->> 'subject_name',
          row_value ->> 'vendor_category',
          row_value ->> 'region_code'
        );
        INSERT INTO public.vendor_disclosure_ingest_identity_links (
          run_sha256, unit_id, identity_kind, record_ref, vendor_id, official_price_id
        ) VALUES (
          p_run_sha256, row_value ->> 'unit_id', 'vendor', partner_ref_value,
          vendor_id_value, NULL
        );
      END IF;
      IF vendor_id_value IS NULL
        OR (
          row_value ->> 'partner_link_status' = 'price_row_staged'
          AND official_price_id_value IS NULL
        )
      THEN
        RAISE EXCEPTION 'DISCLOSURE_ATOMIC_SEMANTIC_LINK_MISSING' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.disclosure_semantic_staging AS semantic
      WHERE semantic.snapshot_id = snapshot_row.id
        AND semantic.source_record_key = row_value ->> 'source_record_key'
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.disclosure_semantic_staging (
      snapshot_id, schema_version, unit_id, record_kind, semantic_type,
      subject_kind, subject_name, subject_normalized_name, vendor_category,
      region_code, title, content_verbatim, summary, partner_record_ref,
      partner_vendor_id, official_price_id, source_agency, partner_link_status,
      review_status, needs_review, validation_issue_codes, source_file_ids,
      source_file, source_object_keys, source_preview_keys, source_quote,
      source_fingerprint, validation_fingerprint, confidence,
      source_record_key, content_fingerprint
    ) VALUES (
      snapshot_row.id, 2,
      row_value ->> 'unit_id', row_value ->> 'record_kind', row_value ->> 'semantic_type',
      row_value ->> 'subject_kind', row_value ->> 'subject_name', row_value ->> 'subject_normalized_name',
      row_value ->> 'vendor_category', row_value ->> 'region_code', row_value ->> 'title',
      row_value ->> 'content_verbatim', row_value ->> 'summary', partner_ref_value,
      vendor_id_value, official_price_id_value,
      CASE
        WHEN jsonb_typeof(row_value -> 'source_agency') = 'object'
          THEN row_value -> 'source_agency'
        ELSE NULL
      END,
      row_value ->> 'partner_link_status', 'pending',
      (row_value ->> 'needs_review')::boolean,
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_file_ids')),
      row_value ->> 'source_file',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_object_keys')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_preview_keys')),
      row_value ->> 'source_quote', row_value ->> 'source_fingerprint',
      row_value ->> 'validation_fingerprint', (row_value ->> 'confidence')::numeric,
      row_value ->> 'source_record_key', row_value ->> 'content_fingerprint'
    ) RETURNING id INTO semantic_id_value;
    INSERT INTO public.vendor_disclosure_ingest_owned_rows (
      run_sha256, batch_index, unit_id, row_kind, row_id
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'semantic', semantic_id_value
    );
    record_ref_value := COALESCE(partner_ref_value, row_value ->> 'source_record_key');
    record_binding_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'row_kind', 'semantic',
      'row_id', semantic_id_value,
      'record_ref', record_ref_value,
      'vendor_id', vendor_id_value,
      'agency_id', NULL,
      'linked_official_price_id', official_price_id_value
    )::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_record_bindings (
      run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
      vendor_id, agency_id, linked_official_price_id, binding_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'semantic',
      semantic_id_value, record_ref_value, vendor_id_value, NULL,
      official_price_id_value, record_binding_sha256_value
    );
    staged_count := staged_count + 1;
    IF (row_value ->> 'needs_review')::boolean THEN
      review_count := review_count + 1;
    END IF;
  END LOOP;

  receipt_sha256_value := encode(extensions.digest(convert_to(
    p_run_sha256 || chr(31) || p_batch_sha256 || chr(31)
      || payload_sha256_value || chr(31) || snapshot_row.id::text,
    'UTF8'
  ), 'sha256'), 'hex');
  INSERT INTO public.vendor_disclosure_ingest_batches (
    run_sha256, batch_index, batch_sha256, batch_plan_sha256,
    payload_sha256, batch_receipt_sha256, unit_ids, staged_record_count,
    needs_review_count, logged_ledger_ids
  ) VALUES (
    p_run_sha256, p_batch_index, p_batch_sha256, p_batch_plan_sha256,
    payload_sha256_value, receipt_sha256_value, unit_ids_value, staged_count,
    review_count, logged_ids_value
  ) ON CONFLICT (run_sha256, batch_index) DO NOTHING;
  UPDATE public.vendor_disclosure_ingest_runs
  SET completed_batch_count = completed_batch_count + 1,
      updated_at = now()
  WHERE run_sha256 = p_run_sha256;

  batch_receipt_sha256 := receipt_sha256_value;
  loaded_unit_ids := unit_ids_value;
  logged_ledger_ids := logged_ids_value;
  already_applied := false;
  RETURN NEXT;
END;
$stage_vendor_disclosure_batch_atomic$;

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

DO $vendor_disclosure_ledger_cost_scale_postconditions$
DECLARE
  stage_function regprocedure := pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  stage_definition text;
  stage_owner name;
BEGIN
  IF stage_function IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_LEDGER_COST_SCALE_FUNCTION_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(proc.oid),
    pg_catalog.pg_get_userbyid(proc.proowner)
  INTO stage_definition, stage_owner
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = stage_function;

  IF position(
      $expected_insert$(row_value ->> 'estimated_cost_usd')::numeric(10,6),$expected_insert$
      IN stage_definition
    ) = 0
    OR position(
      $expected_comparison$ledger_row.cost_usd IS DISTINCT FROM (row_value ->> 'estimated_cost_usd')::numeric(10,6)$expected_comparison$
      IN stage_definition
    ) = 0
  THEN
    RAISE EXCEPTION 'DISCLOSURE_LEDGER_COST_SCALE_CAST_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS col
    WHERE col.table_schema = 'public'
      AND col.table_name = 'ai_interactions_log'
      AND col.column_name = 'cost_usd'
      AND col.numeric_precision = 10
      AND col.numeric_scale = 6
  ) OR 0.0747925::numeric(10,6) IS DISTINCT FROM 0.074793::numeric
  THEN
    RAISE EXCEPTION 'DISCLOSURE_LEDGER_COST_SCALE_CONTRACT_DRIFT';
  END IF;

  IF stage_owner IS DISTINCT FROM 'postgres'::name
    OR pg_catalog.has_function_privilege('anon', stage_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'authenticated', stage_function, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', stage_function, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_LEDGER_COST_SCALE_PRIVILEGE_DRIFT';
  END IF;
END;
$vendor_disclosure_ledger_cost_scale_postconditions$;

COMMIT;
