-- Durable administrator confirmation for ambiguous JSON price uploads.
-- Raw evidence remains in the private disclosure-raw bucket; browser clients
-- receive only an opaque confirmation id and a bounded identity projection.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.price_upload_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_object_key text NOT NULL,
  entry_index integer NOT NULL,
  upload_context jsonb NOT NULL,
  entry_payload jsonb NOT NULL,
  candidate_vendor_ids uuid[] NOT NULL,
  candidate_snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  version bigint NOT NULL DEFAULT 0,
  selected_vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL,
  resolved_by uuid,
  resolved_at timestamptz,
  staged_snapshot_id uuid REFERENCES public.price_snapshots(id) ON DELETE RESTRICT,
  staged_price_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_upload_confirmations_source_key_check CHECK (
    public.disclosure_object_keys_are_safe(ARRAY[source_object_key]::text[])
    AND source_object_key ~ '^[0-9a-f]{64}\.json$'
  ),
  CONSTRAINT price_upload_confirmations_entry_index_check
    CHECK (entry_index BETWEEN 0 AND 49),
  CONSTRAINT price_upload_confirmations_payload_shape_check CHECK (
    jsonb_typeof(upload_context) = 'object'
    AND jsonb_typeof(entry_payload) = 'object'
    AND jsonb_typeof(candidate_snapshot) = 'array'
  ),
  CONSTRAINT price_upload_confirmations_candidates_check CHECK (
    cardinality(candidate_vendor_ids) BETWEEN 1 AND 5
    AND array_position(candidate_vendor_ids, NULL) IS NULL
    AND jsonb_array_length(candidate_snapshot) = cardinality(candidate_vendor_ids)
  ),
  CONSTRAINT price_upload_confirmations_state_check CHECK (
    (state = 'pending'
      AND version = 0
      AND selected_vendor_id IS NULL
      AND resolved_by IS NULL
      AND resolved_at IS NULL
      AND staged_snapshot_id IS NULL
      AND staged_price_count IS NULL)
    OR
    (state = 'resolved'
      AND version = 1
      AND selected_vendor_id IS NOT NULL
      AND selected_vendor_id = ANY(candidate_vendor_ids)
      AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL
      AND staged_snapshot_id IS NOT NULL
      AND staged_price_count BETWEEN 1 AND 20)
  ),
  CONSTRAINT price_upload_confirmations_evidence_entry_key
    UNIQUE (source_object_key, entry_index)
);

CREATE INDEX price_upload_confirmations_pending_queue_idx
  ON public.price_upload_confirmations (created_at, id)
  WHERE state = 'pending';

CREATE TABLE public.price_upload_confirmation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  confirmation_id uuid NOT NULL
    REFERENCES public.price_upload_confirmations(id) ON DELETE RESTRICT,
  action text NOT NULL,
  version bigint NOT NULL,
  actor_id uuid NOT NULL,
  selected_vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_upload_confirmation_events_action_check
    CHECK (action IN ('queued', 'resolved')),
  CONSTRAINT price_upload_confirmation_events_version_check
    CHECK ((action = 'queued' AND version = 0 AND selected_vendor_id IS NULL)
      OR (action = 'resolved' AND version = 1 AND selected_vendor_id IS NOT NULL)),
  UNIQUE (confirmation_id, version)
);

CREATE OR REPLACE FUNCTION public.guard_price_upload_confirmation_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_price_upload_confirmation_immutability$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.source_object_key IS DISTINCT FROM OLD.source_object_key
    OR NEW.entry_index IS DISTINCT FROM OLD.entry_index
    OR NEW.upload_context IS DISTINCT FROM OLD.upload_context
    OR NEW.entry_payload IS DISTINCT FROM OLD.entry_payload
    OR NEW.candidate_vendor_ids IS DISTINCT FROM OLD.candidate_vendor_ids
    OR NEW.candidate_snapshot IS DISTINCT FROM OLD.candidate_snapshot
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$guard_price_upload_confirmation_immutability$;

CREATE OR REPLACE FUNCTION public.reject_price_upload_confirmation_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $reject_price_upload_confirmation_truncate$
BEGIN
  RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_IMMUTABLE'
    USING ERRCODE = '55000';
END
$reject_price_upload_confirmation_truncate$;

CREATE TRIGGER price_upload_confirmations_immutable
BEFORE UPDATE OR DELETE ON public.price_upload_confirmations
FOR EACH ROW EXECUTE FUNCTION public.guard_price_upload_confirmation_immutability();

CREATE TRIGGER price_upload_confirmations_no_truncate
BEFORE TRUNCATE ON public.price_upload_confirmations
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_price_upload_confirmation_truncate();

CREATE TRIGGER price_upload_confirmation_events_append_only
BEFORE UPDATE OR DELETE ON public.price_upload_confirmation_events
FOR EACH ROW EXECUTE FUNCTION public.reject_price_upload_confirmation_truncate();

CREATE TRIGGER price_upload_confirmation_events_no_truncate
BEFORE TRUNCATE ON public.price_upload_confirmation_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_price_upload_confirmation_truncate();

ALTER TABLE public.price_upload_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_upload_confirmations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.price_upload_confirmation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_upload_confirmation_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.price_upload_confirmations OWNER TO postgres;
ALTER TABLE public.price_upload_confirmation_events OWNER TO postgres;
ALTER FUNCTION public.guard_price_upload_confirmation_immutability() OWNER TO postgres;
ALTER FUNCTION public.reject_price_upload_confirmation_truncate() OWNER TO postgres;

REVOKE ALL ON TABLE
  public.price_upload_confirmations,
  public.price_upload_confirmation_events
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.price_upload_confirmations,
  public.price_upload_confirmation_events
TO service_role;

CREATE OR REPLACE FUNCTION public.admin_json_price_upload_context_is_safe(
  p_context jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $admin_json_price_upload_context_is_safe$
DECLARE
  collected_date date;
BEGIN
  IF jsonb_typeof(p_context) IS DISTINCT FROM 'object'
    OR NOT p_context ?& ARRAY[
      'period_label', 'source', 'source_note', 'collected_at'
    ]::text[]
    OR p_context - ARRAY[
      'period_label', 'source', 'source_note', 'collected_at'
    ]::text[] <> '{}'::jsonb
    OR jsonb_typeof(p_context -> 'period_label') IS DISTINCT FROM 'string'
    OR btrim(p_context ->> 'period_label')
      IS DISTINCT FROM p_context ->> 'period_label'
    OR length(p_context ->> 'period_label') NOT BETWEEN 1 AND 40
    OR jsonb_typeof(p_context -> 'source') IS DISTINCT FROM 'string'
    OR p_context ->> 'source' NOT IN ('kca_tprice', 'agency_site', 'mixed')
    OR jsonb_typeof(p_context -> 'source_note') IS DISTINCT FROM 'string'
    OR btrim(p_context ->> 'source_note')
      IS DISTINCT FROM p_context ->> 'source_note'
    OR length(p_context ->> 'source_note') NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_context -> 'collected_at') IS DISTINCT FROM 'string'
    OR btrim(p_context ->> 'collected_at')
      IS DISTINCT FROM p_context ->> 'collected_at'
    OR p_context ->> 'collected_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  THEN
    RETURN false;
  END IF;
  BEGIN
    collected_date := (p_context ->> 'collected_at')::date;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN collected_date::text = p_context ->> 'collected_at';
END
$admin_json_price_upload_context_is_safe$;

CREATE OR REPLACE FUNCTION public.admin_json_price_upload_entry_is_safe(
  p_entry jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $admin_json_price_upload_entry_is_safe$
DECLARE
  price_value jsonb;
  minimum_price numeric;
  maximum_price numeric;
  source_record_key_value text;
  seen_source_record_keys text[] := '{}'::text[];
BEGIN
  IF jsonb_typeof(p_entry) IS DISTINCT FROM 'object'
    OR NOT p_entry ?& ARRAY[
      'vendor_name', 'category', 'region_code', 'aliases', 'prices'
    ]::text[]
    OR p_entry - ARRAY[
      'vendor_name', 'category', 'region_code', 'aliases', 'prices'
    ]::text[] <> '{}'::jsonb
    OR jsonb_typeof(p_entry -> 'vendor_name') IS DISTINCT FROM 'string'
    OR btrim(p_entry ->> 'vendor_name')
      IS DISTINCT FROM p_entry ->> 'vendor_name'
    OR length(p_entry ->> 'vendor_name') NOT BETWEEN 1 AND 200
    OR p_entry ->> 'category' NOT IN ('studio', 'dress', 'makeup', 'hall')
    OR p_entry ->> 'region_code' NOT IN (
      'seoul_gangnam3', 'seoul_etc', 'incheon', 'busan', 'daejeon',
      'gwangju', 'daegu', 'ulsan', 'gyeonggi', 'chungcheong',
      'jeolla', 'gyeongsang', 'gangwon', 'jeju'
    )
    OR jsonb_typeof(p_entry -> 'aliases') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_entry -> 'aliases') > 100
    OR jsonb_typeof(p_entry -> 'prices') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_entry -> 'prices') NOT BETWEEN 1 AND 20
  THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_entry -> 'aliases') AS alias(value)
    WHERE jsonb_typeof(alias.value) <> 'string'
      OR btrim(alias.value #>> '{}') IS DISTINCT FROM alias.value #>> '{}'
      OR length(alias.value #>> '{}') NOT BETWEEN 1 AND 200
  ) THEN
    RETURN false;
  END IF;

  FOR price_value IN
    SELECT price.value
    FROM jsonb_array_elements(p_entry -> 'prices') AS price(value)
  LOOP
    IF jsonb_typeof(price_value) IS DISTINCT FROM 'object'
      OR NOT price_value ?& ARRAY[
        'agency_slug', 'price_min_krw', 'price_max_krw', 'price_note',
        'base_spec', 'options', 'source_record_key', 'source_quote'
      ]::text[]
      OR price_value - ARRAY[
        'agency_slug', 'price_min_krw', 'price_max_krw', 'price_note',
        'base_spec', 'options', 'source_record_key', 'source_quote'
      ]::text[] <> '{}'::jsonb
      OR jsonb_typeof(price_value -> 'agency_slug') IS DISTINCT FROM 'string'
      OR price_value ->> 'agency_slug' !~ '^[a-z0-9][a-z0-9-]{0,119}$'
      OR jsonb_typeof(price_value -> 'price_min_krw') IS DISTINCT FROM 'number'
      OR jsonb_typeof(price_value -> 'price_max_krw') IS DISTINCT FROM 'number'
      OR jsonb_typeof(price_value -> 'price_note') NOT IN ('string', 'null')
      OR (
        jsonb_typeof(price_value -> 'price_note') = 'string'
        AND (
          btrim(price_value ->> 'price_note')
            IS DISTINCT FROM price_value ->> 'price_note'
          OR length(price_value ->> 'price_note') > 2000
        )
      )
      OR jsonb_typeof(price_value -> 'base_spec') NOT IN ('string', 'null')
      OR (
        jsonb_typeof(price_value -> 'base_spec') = 'string'
        AND (
          btrim(price_value ->> 'base_spec')
            IS DISTINCT FROM price_value ->> 'base_spec'
          OR length(price_value ->> 'base_spec') > 2000
        )
      )
      OR jsonb_typeof(price_value -> 'source_record_key') IS DISTINCT FROM 'string'
      OR price_value ->> 'source_record_key' !~ '^admin-json:[0-9a-f]{64}$'
      OR jsonb_typeof(price_value -> 'source_quote') IS DISTINCT FROM 'string'
      OR length(price_value ->> 'source_quote') NOT BETWEEN 1 AND 2000
      OR NOT public.admin_json_price_options_are_safe(price_value -> 'options')
    THEN
      RETURN false;
    END IF;
    source_record_key_value := price_value ->> 'source_record_key';
    IF source_record_key_value = ANY(seen_source_record_keys) THEN
      RETURN false;
    END IF;
    seen_source_record_keys := array_append(
      seen_source_record_keys,
      source_record_key_value
    );
    minimum_price := (price_value ->> 'price_min_krw')::numeric;
    maximum_price := (price_value ->> 'price_max_krw')::numeric;
    IF minimum_price < 0
      OR maximum_price < minimum_price
      OR minimum_price <> trunc(minimum_price)
      OR maximum_price <> trunc(maximum_price)
      OR maximum_price > 2147483647
    THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END
$admin_json_price_upload_entry_is_safe$;

CREATE OR REPLACE FUNCTION public.admin_json_price_candidates_are_safe(
  p_candidates jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $admin_json_price_candidates_are_safe$
DECLARE
  candidate_value jsonb;
  similarity_value numeric;
BEGIN
  IF jsonb_typeof(p_candidates) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_candidates) NOT BETWEEN 1 AND 5
  THEN
    RETURN false;
  END IF;
  FOR candidate_value IN
    SELECT candidate.value
    FROM jsonb_array_elements(p_candidates) AS candidate(value)
  LOOP
    IF jsonb_typeof(candidate_value) IS DISTINCT FROM 'object'
      OR NOT candidate_value ?& ARRAY[
        'vendor_id', 'vendor_name', 'vendor_slug', 'aliases',
        'similarity', 'match_kind'
      ]::text[]
      OR candidate_value - ARRAY[
        'vendor_id', 'vendor_name', 'vendor_slug', 'aliases',
        'similarity', 'match_kind'
      ]::text[] <> '{}'::jsonb
      OR jsonb_typeof(candidate_value -> 'vendor_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(candidate_value -> 'vendor_name') IS DISTINCT FROM 'string'
      OR btrim(candidate_value ->> 'vendor_name')
        IS DISTINCT FROM candidate_value ->> 'vendor_name'
      OR length(candidate_value ->> 'vendor_name') NOT BETWEEN 1 AND 200
      OR jsonb_typeof(candidate_value -> 'vendor_slug') NOT IN ('string', 'null')
      OR (
        jsonb_typeof(candidate_value -> 'vendor_slug') = 'string'
        AND length(candidate_value ->> 'vendor_slug') > 120
      )
      OR jsonb_typeof(candidate_value -> 'aliases') IS DISTINCT FROM 'array'
      OR jsonb_array_length(candidate_value -> 'aliases') > 100
      OR jsonb_typeof(candidate_value -> 'similarity') IS DISTINCT FROM 'number'
      OR jsonb_typeof(candidate_value -> 'match_kind') IS DISTINCT FROM 'string'
      OR candidate_value ->> 'match_kind'
        NOT IN ('exact_name', 'exact_alias', 'similar')
    THEN
      RETURN false;
    END IF;
    BEGIN
      PERFORM (candidate_value ->> 'vendor_id')::uuid;
      similarity_value := (candidate_value ->> 'similarity')::numeric;
    EXCEPTION WHEN others THEN
      RETURN false;
    END;
    IF similarity_value < 0.6 OR similarity_value > 1 THEN
      RETURN false;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(candidate_value -> 'aliases') AS alias(value)
      WHERE jsonb_typeof(alias.value) <> 'string'
        OR length(alias.value #>> '{}') > 200
    ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END
$admin_json_price_candidates_are_safe$;

CREATE OR REPLACE FUNCTION public.enqueue_price_upload_confirmation(
  p_source_object_key text,
  p_entry_index integer,
  p_upload_context jsonb,
  p_entry_payload jsonb,
  p_candidate_vendor_ids uuid[],
  p_candidate_snapshot jsonb,
  p_created_by uuid
)
RETURNS TABLE (confirmation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $enqueue_price_upload_confirmation$
DECLARE
  existing_row public.price_upload_confirmations%ROWTYPE;
  snapshot_candidate_ids uuid[];
BEGIN
  IF p_created_by IS NULL
    OR p_entry_index NOT BETWEEN 0 AND 49
    OR p_source_object_key !~ '^[0-9a-f]{64}\.json$'
    OR NOT public.disclosure_object_keys_are_safe(
      ARRAY[p_source_object_key]::text[]
    )
    OR jsonb_typeof(p_upload_context) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_entry_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_candidate_snapshot) IS DISTINCT FROM 'array'
    OR cardinality(p_candidate_vendor_ids) NOT BETWEEN 1 AND 5
    OR array_position(p_candidate_vendor_ids, NULL) IS NOT NULL
    OR cardinality(p_candidate_vendor_ids) <> cardinality(ARRAY(
      SELECT DISTINCT candidate_id
      FROM unnest(p_candidate_vendor_ids) AS candidate(candidate_id)
    ))
    OR jsonb_array_length(p_candidate_snapshot)
      <> cardinality(p_candidate_vendor_ids)
    OR NOT public.admin_json_price_upload_context_is_safe(p_upload_context)
    OR NOT public.admin_json_price_upload_entry_is_safe(p_entry_payload)
    OR NOT public.admin_json_price_candidates_are_safe(p_candidate_snapshot)
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(candidate_id ORDER BY candidate_id), '{}'::uuid[])
  INTO snapshot_candidate_ids
  FROM (
    SELECT DISTINCT (candidate ->> 'vendor_id')::uuid AS candidate_id
    FROM jsonb_array_elements(p_candidate_snapshot) AS candidate
    WHERE jsonb_typeof(candidate) = 'object'
      AND candidate ? 'vendor_id'
      AND candidate ? 'vendor_name'
      AND candidate ? 'similarity'
      AND candidate ? 'match_kind'
  ) AS snapshot_candidates;

  IF snapshot_candidate_ids IS DISTINCT FROM (
    SELECT COALESCE(array_agg(candidate_id ORDER BY candidate_id), '{}'::uuid[])
    FROM (SELECT DISTINCT unnest(p_candidate_vendor_ids) AS candidate_id) AS ids
  ) THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_CANDIDATES_INVALID'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.price_upload_confirmations (
    source_object_key,
    entry_index,
    upload_context,
    entry_payload,
    candidate_vendor_ids,
    candidate_snapshot,
    created_by
  ) VALUES (
    p_source_object_key,
    p_entry_index,
    p_upload_context,
    p_entry_payload,
    p_candidate_vendor_ids,
    p_candidate_snapshot,
    p_created_by
  )
  ON CONFLICT (source_object_key, entry_index) DO NOTHING;

  SELECT confirmation.*
  INTO existing_row
  FROM public.price_upload_confirmations AS confirmation
  WHERE confirmation.source_object_key = p_source_object_key
    AND confirmation.entry_index = p_entry_index
  FOR UPDATE;

  IF existing_row.id IS NULL
    OR existing_row.upload_context IS DISTINCT FROM p_upload_context
    OR existing_row.entry_payload IS DISTINCT FROM p_entry_payload
    OR existing_row.candidate_vendor_ids IS DISTINCT FROM p_candidate_vendor_ids
    OR existing_row.candidate_snapshot IS DISTINCT FROM p_candidate_snapshot
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_IDEMPOTENCY_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.price_upload_confirmation_events (
    confirmation_id, action, version, actor_id
  ) VALUES (
    existing_row.id, 'queued', 0, existing_row.created_by
  ) ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT existing_row.id;
END
$enqueue_price_upload_confirmation$;

CREATE OR REPLACE FUNCTION public.list_price_upload_confirmations(
  p_state text DEFAULT 'pending'
)
RETURNS TABLE (
  confirmation_id uuid,
  entry_index integer,
  vendor_name text,
  category text,
  region_code text,
  candidates jsonb,
  state text,
  version bigint,
  selected_vendor_id uuid,
  staged_snapshot_id uuid,
  staged_price_count integer,
  created_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $list_price_upload_confirmations$
  SELECT
    confirmation.id,
    confirmation.entry_index,
    confirmation.entry_payload ->> 'vendor_name',
    confirmation.entry_payload ->> 'category',
    confirmation.entry_payload ->> 'region_code',
    (
      SELECT COALESCE(
        jsonb_agg(
          candidate.value || jsonb_build_object(
            'category', COALESCE(
              CASE
                WHEN vendor.category = 'venue' THEN 'hall'
                ELSE vendor.category
              END,
              confirmation.entry_payload ->> 'category'
            ),
            'region_code', vendor.region_code
          )
          ORDER BY candidate.ordinality
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(confirmation.candidate_snapshot)
        WITH ORDINALITY AS candidate(value, ordinality)
      LEFT JOIN public.vendors AS vendor
        ON vendor.id = (candidate.value ->> 'vendor_id')::uuid
    ),
    confirmation.state,
    confirmation.version,
    confirmation.selected_vendor_id,
    confirmation.staged_snapshot_id,
    confirmation.staged_price_count,
    confirmation.created_at,
    confirmation.resolved_at
  FROM public.price_upload_confirmations AS confirmation
  WHERE p_state IN ('pending', 'resolved')
    AND confirmation.state = p_state
  ORDER BY confirmation.created_at, confirmation.id
  LIMIT 500
$list_price_upload_confirmations$;

CREATE OR REPLACE FUNCTION public.admin_json_price_options_are_safe(
  p_options jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $admin_json_price_options_are_safe$
DECLARE
  option_value jsonb;
  minimum_price numeric;
  maximum_price numeric;
  option_identity text;
  seen_option_identities text[] := '{}'::text[];
BEGIN
  IF jsonb_typeof(p_options) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_options) > 50
  THEN
    RETURN false;
  END IF;
  FOR option_value IN
    SELECT option_row.value
    FROM jsonb_array_elements(p_options) AS option_row(value)
  LOOP
    IF jsonb_typeof(option_value) IS DISTINCT FROM 'object'
      OR NOT option_value ?& ARRAY[
        'name', 'price_min_krw', 'price_max_krw', 'unit', 'condition',
        'raw_text', 'is_effectively_mandatory'
      ]::text[]
      OR option_value - ARRAY[
        'name', 'price_min_krw', 'price_max_krw', 'unit', 'condition',
        'raw_text', 'is_effectively_mandatory'
      ]::text[] <> '{}'::jsonb
      OR jsonb_typeof(option_value -> 'name') IS DISTINCT FROM 'string'
      OR btrim(option_value ->> 'name') IS DISTINCT FROM option_value ->> 'name'
      OR length(option_value ->> 'name') NOT BETWEEN 1 AND 200
      OR jsonb_typeof(option_value -> 'price_min_krw') IS DISTINCT FROM 'number'
      OR jsonb_typeof(option_value -> 'price_max_krw') IS DISTINCT FROM 'number'
      OR jsonb_typeof(option_value -> 'unit') NOT IN ('string', 'null')
      OR (
        jsonb_typeof(option_value -> 'unit') = 'string'
        AND (
          btrim(option_value ->> 'unit') IS DISTINCT FROM option_value ->> 'unit'
          OR length(option_value ->> 'unit') > 100
        )
      )
      OR jsonb_typeof(option_value -> 'condition') NOT IN ('string', 'null')
      OR (
        jsonb_typeof(option_value -> 'condition') = 'string'
        AND (
          btrim(option_value ->> 'condition')
            IS DISTINCT FROM option_value ->> 'condition'
          OR length(option_value ->> 'condition') > 500
        )
      )
      OR jsonb_typeof(option_value -> 'raw_text') IS DISTINCT FROM 'string'
      OR btrim(option_value ->> 'raw_text')
        IS DISTINCT FROM option_value ->> 'raw_text'
      OR length(option_value ->> 'raw_text') NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(option_value -> 'is_effectively_mandatory')
        IS DISTINCT FROM 'boolean'
    THEN
      RETURN false;
    END IF;
    minimum_price := (option_value ->> 'price_min_krw')::numeric;
    maximum_price := (option_value ->> 'price_max_krw')::numeric;
    IF minimum_price < 0
      OR maximum_price < minimum_price
      OR minimum_price <> trunc(minimum_price)
      OR maximum_price <> trunc(maximum_price)
      OR maximum_price > 2147483647
    THEN
      RETURN false;
    END IF;
    option_identity := jsonb_build_array(
      option_value ->> 'name',
      COALESCE(option_value ->> 'unit', ''),
      COALESCE(option_value ->> 'condition', '')
    )::text;
    IF option_identity = ANY(seen_option_identities) THEN
      RETURN false;
    END IF;
    seen_option_identities := array_append(seen_option_identities, option_identity);
  END LOOP;
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END
$admin_json_price_options_are_safe$;

ALTER TABLE public.price_upload_confirmations
  ADD CONSTRAINT price_upload_confirmations_normalized_payload_check
  CHECK (
    public.admin_json_price_upload_context_is_safe(upload_context)
    AND public.admin_json_price_upload_entry_is_safe(entry_payload)
    AND public.admin_json_price_candidates_are_safe(candidate_snapshot)
  ) NOT VALID;
ALTER TABLE public.price_upload_confirmations
  VALIDATE CONSTRAINT price_upload_confirmations_normalized_payload_check;

CREATE OR REPLACE FUNCTION public.stage_admin_json_price(
  p_snapshot_id uuid,
  p_vendor_id uuid,
  p_agency_id uuid,
  p_category text,
  p_item_name text,
  p_price_min_krw integer,
  p_price_max_krw integer,
  p_price_note text,
  p_base_spec text,
  p_options jsonb,
  p_source_file text,
  p_source_object_key text,
  p_source_quote text,
  p_source_record_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $stage_admin_json_price$
DECLARE
  snapshot_row record;
  vendor_row record;
  agency_row record;
  existing_row public.official_prices%ROWTYPE;
  price_id uuid;
BEGIN
  IF p_category NOT IN ('studio', 'dress', 'makeup', 'hall')
    OR NULLIF(btrim(p_item_name), '') IS NULL
    OR length(p_item_name) > 200
    OR p_price_min_krw < 0
    OR p_price_max_krw < p_price_min_krw
    OR NULLIF(btrim(p_source_file), '') IS NULL
    OR length(p_source_file) > 500
    OR NULLIF(btrim(p_source_quote), '') IS NULL
    OR length(p_source_quote) > 2000
    OR p_source_object_key !~ '^[0-9a-f]{64}\.json$'
    OR NOT public.disclosure_object_keys_are_safe(
      ARRAY[p_source_object_key]::text[]
    )
    OR p_source_record_key !~ '^admin-json:[0-9a-f]{64}$'
    OR NOT public.admin_json_price_options_are_safe(p_options)
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_STAGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT snapshot.id, snapshot.published, snapshot.is_current
  INTO snapshot_row
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = p_snapshot_id
  FOR SHARE;
  IF snapshot_row.id IS NULL THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_STAGE_SNAPSHOT_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF snapshot_row.published OR snapshot_row.is_current THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_STAGE_SNAPSHOT_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  SELECT vendor.id, vendor.category, vendor.status
  INTO vendor_row
  FROM public.vendors AS vendor
  WHERE vendor.id = p_vendor_id
  FOR SHARE;
  IF vendor_row.id IS NULL
    OR vendor_row.status NOT IN ('pending', 'approved', 'draft')
    OR vendor_row.category IS DISTINCT FROM (
      CASE WHEN p_category = 'hall' THEN 'venue' ELSE p_category END
    )
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_STAGE_VENDOR_INACTIVE_OR_CATEGORY_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  SELECT agency.id, agency.merged_into_agency_id, agency.is_active
  INTO agency_row
  FROM public.agencies AS agency
  WHERE agency.id = p_agency_id
  FOR SHARE;
  IF agency_row.id IS NULL
    OR agency_row.merged_into_agency_id IS NOT NULL
    OR agency_row.is_active IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_STAGE_AGENCY_INACTIVE'
      USING ERRCODE = '23514';
  END IF;

  SELECT price.*
  INTO existing_row
  FROM public.official_prices AS price
  WHERE price.snapshot_id = p_snapshot_id
    AND price.source_record_key = p_source_record_key
  FOR UPDATE;

  IF existing_row.id IS NULL THEN
    INSERT INTO public.official_prices (
      snapshot_id, vendor_id, agency_id, category, item_name,
      price_min_krw, price_max_krw, price_note, base_spec,
      review_status, needs_review, validation_issue_codes,
      source_file, source_quote, source_object_keys, source_record_key,
      confidence, edited_by_admin
    ) VALUES (
      p_snapshot_id, p_vendor_id, p_agency_id, p_category, p_item_name,
      p_price_min_krw, p_price_max_krw, p_price_note, p_base_spec,
      'pending', true, ARRAY['admin_json_requires_human_review']::text[],
      p_source_file, p_source_quote, ARRAY[p_source_object_key]::text[],
      p_source_record_key, NULL, false
    )
    RETURNING id INTO price_id;
  ELSE
    IF existing_row.review_status <> 'pending'
      OR existing_row.needs_review IS DISTINCT FROM true
      OR existing_row.edited_by_admin IS DISTINCT FROM false
      OR existing_row.reviewed_by IS NOT NULL
      OR existing_row.reviewed_at IS NOT NULL
      OR existing_row.review_action IS NOT NULL
      OR existing_row.review_version <> 0
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_REVIEWED_ROW_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
    IF existing_row.vendor_id IS DISTINCT FROM p_vendor_id
      OR existing_row.agency_id IS DISTINCT FROM p_agency_id
      OR existing_row.category IS DISTINCT FROM p_category
      OR existing_row.item_name IS DISTINCT FROM p_item_name
      OR existing_row.price_min_krw IS DISTINCT FROM p_price_min_krw
      OR existing_row.price_max_krw IS DISTINCT FROM p_price_max_krw
      OR existing_row.price_note IS DISTINCT FROM p_price_note
      OR existing_row.base_spec IS DISTINCT FROM p_base_spec
      OR existing_row.source_file IS DISTINCT FROM p_source_file
      OR existing_row.source_quote IS DISTINCT FROM p_source_quote
      OR existing_row.source_object_keys
        IS DISTINCT FROM ARRAY[p_source_object_key]::text[]
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_STAGE_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    price_id := existing_row.id;
  END IF;

  DELETE FROM public.official_price_options AS option_row
  WHERE option_row.official_price_id = price_id;

  INSERT INTO public.official_price_options (
    official_price_id, name, price_min_krw, price_max_krw, unit,
    condition, raw_text, is_effectively_mandatory, sort_order,
    source_file, source_quote, source_object_keys, confidence
  )
  SELECT
    price_id,
    option_value ->> 'name',
    (option_value ->> 'price_min_krw')::integer,
    (option_value ->> 'price_max_krw')::integer,
    option_value ->> 'unit',
    option_value ->> 'condition',
    option_value ->> 'raw_text',
    (option_value ->> 'is_effectively_mandatory')::boolean,
    option_ordinality - 1,
    p_source_file,
    option_value ->> 'raw_text',
    ARRAY[p_source_object_key]::text[],
    NULL
  FROM jsonb_array_elements(p_options)
    WITH ORDINALITY AS option_row(option_value, option_ordinality);

  RETURN price_id;
END
$stage_admin_json_price$;

CREATE OR REPLACE FUNCTION public.match_vendors_for_price_upload_batch(
  p_requests jsonb
)
RETURNS TABLE (
  entry_index integer,
  candidates jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $match_vendors_for_price_upload_batch$
DECLARE
  request_value jsonb;
  request_index integer;
  seen_indexes integer[] := '{}'::integer[];
BEGIN
  IF jsonb_typeof(p_requests) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_requests) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_MATCH_BATCH_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;
  FOR request_value IN
    SELECT request_row.value
    FROM jsonb_array_elements(p_requests) AS request_row(value)
  LOOP
    IF jsonb_typeof(request_value) IS DISTINCT FROM 'object'
      OR NOT request_value ?& ARRAY[
        'entry_index', 'name', 'category'
      ]::text[]
      OR request_value - ARRAY[
        'entry_index', 'name', 'category'
      ]::text[] <> '{}'::jsonb
      OR jsonb_typeof(request_value -> 'entry_index') IS DISTINCT FROM 'number'
      OR jsonb_typeof(request_value -> 'name') IS DISTINCT FROM 'string'
      OR btrim(request_value ->> 'name') IS DISTINCT FROM request_value ->> 'name'
      OR length(request_value ->> 'name') NOT BETWEEN 1 AND 200
      OR jsonb_typeof(request_value -> 'category') IS DISTINCT FROM 'string'
      OR request_value ->> 'category' NOT IN ('studio', 'dress', 'makeup', 'hall')
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_MATCH_BATCH_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      request_index := (request_value ->> 'entry_index')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_MATCH_BATCH_INVALID_INPUT'
        USING ERRCODE = '22023';
    END;
    IF request_index NOT BETWEEN 0 AND 49
      OR request_index = ANY(seen_indexes)
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_MATCH_BATCH_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
    seen_indexes := array_append(seen_indexes, request_index);
  END LOOP;

  FOR request_value IN
    SELECT request_row.value
    FROM jsonb_array_elements(p_requests) AS request_row(value)
    ORDER BY (request_row.value ->> 'entry_index')::integer
  LOOP
    entry_index := (request_value ->> 'entry_index')::integer;
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'vendor_id', matched.vendor_id,
          'vendor_name', matched.vendor_name,
          'vendor_slug', matched.vendor_slug,
          'aliases', matched.aliases,
          'similarity', matched.similarity,
          'match_kind', matched.match_kind
        )
        ORDER BY
          CASE matched.match_kind
            WHEN 'exact_name' THEN 0
            WHEN 'exact_alias' THEN 1
            ELSE 2
          END,
          matched.similarity DESC,
          matched.vendor_id
      ),
      '[]'::jsonb
    )
    INTO candidates
    FROM public.match_vendor_for_price_upload(
      request_value ->> 'name',
      request_value ->> 'category'
    ) AS matched;
    RETURN NEXT;
  END LOOP;
END
$match_vendors_for_price_upload_batch$;

-- Apply every writable part of one validated synchronous upload in the
-- transaction created by a single PostgREST RPC. Matching and agency lookup in
-- the application are read-only preflight operations; no vendor, snapshot,
-- queue, price, or option can commit unless every prepared entry succeeds.
CREATE OR REPLACE FUNCTION public.apply_admin_json_price_upload(
  p_source_object_key text,
  p_upload_context jsonb,
  p_entries jsonb,
  p_created_by uuid
)
RETURNS TABLE (
  entry_index integer,
  outcome text,
  vendor_id uuid,
  vendor_name text,
  confirmation_id uuid,
  snapshot_id uuid,
  staged_prices integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $apply_admin_json_price_upload$
DECLARE
  plan_entry jsonb;
  entry_payload_value jsonb;
  resolution_value jsonb;
  price_value jsonb;
  resolution_kind text;
  current_entry_index integer;
  seen_entry_indexes integer[] := '{}'::integer[];
  seen_source_record_keys text[] := '{}'::text[];
  source_record_key_value text;
  total_prices integer := 0;
  total_options integer := 0;
  selected_vendor_id uuid;
  selected_vendor record;
  selected_agency record;
  snapshot_row record;
  snapshot_id_value uuid;
  queued_confirmation_id uuid;
  candidate_vendor_ids_value uuid[];
  sorted_candidate_vendor_ids_value uuid[];
  snapshot_candidate_ids_value uuid[];
  entry_staged_count integer;
  source_file_name text;
  upload_collected_at date;
BEGIN
  IF p_created_by IS NULL
    OR p_source_object_key !~ '^[0-9a-f]{64}\.json$'
    OR NOT public.disclosure_object_keys_are_safe(
      ARRAY[p_source_object_key]::text[]
    )
    OR NOT public.admin_json_price_upload_context_is_safe(p_upload_context)
    OR jsonb_typeof(p_entries) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- Validate the complete plan before the first immutable queue or data write.
  FOR plan_entry IN
    SELECT plan.value
    FROM jsonb_array_elements(p_entries) AS plan(value)
  LOOP
    IF jsonb_typeof(plan_entry) IS DISTINCT FROM 'object'
      OR NOT plan_entry ?& ARRAY[
        'entry_index', 'entry_payload', 'resolution'
      ]::text[]
      OR plan_entry - ARRAY[
        'entry_index', 'entry_payload', 'resolution'
      ]::text[] <> '{}'::jsonb
      OR jsonb_typeof(plan_entry -> 'entry_index') IS DISTINCT FROM 'number'
      OR jsonb_typeof(plan_entry -> 'entry_payload') IS DISTINCT FROM 'object'
      OR jsonb_typeof(plan_entry -> 'resolution') IS DISTINCT FROM 'object'
      OR NOT public.admin_json_price_upload_entry_is_safe(
        plan_entry -> 'entry_payload'
      )
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_ENTRY'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      current_entry_index := (plan_entry ->> 'entry_index')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_ENTRY'
        USING ERRCODE = '22023';
    END;
    IF current_entry_index NOT BETWEEN 0 AND 49
      OR current_entry_index = ANY(seen_entry_indexes)
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_ENTRY_INDEX'
        USING ERRCODE = '22023';
    END IF;
    seen_entry_indexes := array_append(seen_entry_indexes, current_entry_index);

    entry_payload_value := plan_entry -> 'entry_payload';
    resolution_value := plan_entry -> 'resolution';
    resolution_kind := resolution_value ->> 'kind';
    IF resolution_kind = 'existing' THEN
      IF NOT resolution_value ?& ARRAY[
          'kind', 'vendor_id', 'vendor_name'
        ]::text[]
        OR resolution_value - ARRAY[
          'kind', 'vendor_id', 'vendor_name'
        ]::text[] <> '{}'::jsonb
        OR jsonb_typeof(resolution_value -> 'vendor_id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(resolution_value -> 'vendor_name') IS DISTINCT FROM 'string'
        OR btrim(resolution_value ->> 'vendor_name')
          IS DISTINCT FROM resolution_value ->> 'vendor_name'
        OR length(resolution_value ->> 'vendor_name') NOT BETWEEN 1 AND 200
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        PERFORM (resolution_value ->> 'vendor_id')::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
          USING ERRCODE = '22023';
      END;
    ELSIF resolution_kind = 'draft' THEN
      IF NOT resolution_value ?& ARRAY[
          'kind', 'vendor_name', 'normalized_name', 'vendor_slug'
        ]::text[]
        OR resolution_value - ARRAY[
          'kind', 'vendor_name', 'normalized_name', 'vendor_slug'
        ]::text[] <> '{}'::jsonb
        OR jsonb_typeof(resolution_value -> 'vendor_name') IS DISTINCT FROM 'string'
        OR btrim(resolution_value ->> 'vendor_name')
          IS DISTINCT FROM resolution_value ->> 'vendor_name'
        OR length(resolution_value ->> 'vendor_name') NOT BETWEEN 1 AND 200
        OR resolution_value ->> 'vendor_name'
          IS DISTINCT FROM entry_payload_value ->> 'vendor_name'
        OR jsonb_typeof(resolution_value -> 'normalized_name') IS DISTINCT FROM 'string'
        OR length(resolution_value ->> 'normalized_name') NOT BETWEEN 1 AND 200
        OR jsonb_typeof(resolution_value -> 'vendor_slug') IS DISTINCT FROM 'string'
        OR resolution_value ->> 'vendor_slug'
          !~ '^(studio|dress|makeup|hall)-[a-z0-9-]+-[0-9a-f]{12}$'
        OR length(resolution_value ->> 'vendor_slug') > 120
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
          USING ERRCODE = '22023';
      END IF;
    ELSIF resolution_kind = 'confirmation' THEN
      IF NOT resolution_value ?& ARRAY[
          'kind', 'candidate_vendor_ids', 'candidate_snapshot'
        ]::text[]
        OR resolution_value - ARRAY[
          'kind', 'candidate_vendor_ids', 'candidate_snapshot'
        ]::text[] <> '{}'::jsonb
        OR jsonb_typeof(resolution_value -> 'candidate_vendor_ids')
          IS DISTINCT FROM 'array'
        OR jsonb_array_length(resolution_value -> 'candidate_vendor_ids')
          NOT BETWEEN 1 AND 5
        OR NOT public.admin_json_price_candidates_are_safe(
          resolution_value -> 'candidate_snapshot'
        )
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        SELECT array_agg(candidate_id ORDER BY candidate_ordinality)
        INTO candidate_vendor_ids_value
        FROM (
          SELECT
            (candidate.value #>> '{}')::uuid AS candidate_id,
            candidate.ordinality AS candidate_ordinality
          FROM jsonb_array_elements(
            resolution_value -> 'candidate_vendor_ids'
          ) WITH ORDINALITY AS candidate(value, ordinality)
        ) AS candidate_ids;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
          USING ERRCODE = '22023';
      END;
      IF cardinality(candidate_vendor_ids_value) <> cardinality(ARRAY(
          SELECT DISTINCT candidate_id
          FROM unnest(candidate_vendor_ids_value) AS candidate(candidate_id)
        ))
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
          USING ERRCODE = '22023';
      END IF;
      SELECT COALESCE(array_agg(candidate_id ORDER BY candidate_id), '{}'::uuid[])
      INTO sorted_candidate_vendor_ids_value
      FROM unnest(candidate_vendor_ids_value) AS candidate(candidate_id);
      SELECT COALESCE(
        array_agg((candidate.value ->> 'vendor_id')::uuid ORDER BY
          (candidate.value ->> 'vendor_id')::uuid),
        '{}'::uuid[]
      )
      INTO snapshot_candidate_ids_value
      FROM jsonb_array_elements(
        resolution_value -> 'candidate_snapshot'
      ) AS candidate(value);
      IF snapshot_candidate_ids_value
        IS DISTINCT FROM sorted_candidate_vendor_ids_value
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION'
        USING ERRCODE = '22023';
    END IF;

    total_prices := total_prices
      + jsonb_array_length(entry_payload_value -> 'prices');
    FOR price_value IN
      SELECT price.value
      FROM jsonb_array_elements(entry_payload_value -> 'prices') AS price(value)
    LOOP
      total_options := total_options
        + jsonb_array_length(price_value -> 'options');
      source_record_key_value := price_value ->> 'source_record_key';
      IF source_record_key_value = ANY(seen_source_record_keys) THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_DUPLICATE_SOURCE_RECORD'
          USING ERRCODE = '22023';
      END IF;
      seen_source_record_keys := array_append(
        seen_source_record_keys,
        source_record_key_value
      );
    END LOOP;
  END LOOP;
  IF total_prices > 200 OR total_options > 1000 THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_BUDGET_EXCEEDED'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    upload_collected_at := (p_upload_context ->> 'collected_at')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_INVALID_INPUT'
      USING ERRCODE = '22023';
  END;
  source_file_name := left(
    format(
      'admin JSON (%s %s).json',
      p_upload_context ->> 'source',
      p_upload_context ->> 'period_label'
    ),
    500
  );

  FOR plan_entry IN
    SELECT plan.value
    FROM jsonb_array_elements(p_entries) AS plan(value)
    ORDER BY (plan.value ->> 'entry_index')::integer
  LOOP
    current_entry_index := (plan_entry ->> 'entry_index')::integer;
    entry_payload_value := plan_entry -> 'entry_payload';
    resolution_value := plan_entry -> 'resolution';
    resolution_kind := resolution_value ->> 'kind';

    IF resolution_kind = 'confirmation' THEN
      SELECT array_agg(candidate_id ORDER BY candidate_ordinality)
      INTO candidate_vendor_ids_value
      FROM (
        SELECT
          (candidate.value #>> '{}')::uuid AS candidate_id,
          candidate.ordinality AS candidate_ordinality
        FROM jsonb_array_elements(
          resolution_value -> 'candidate_vendor_ids'
        ) WITH ORDINALITY AS candidate(value, ordinality)
      ) AS candidate_ids;
      SELECT queued.confirmation_id
      INTO queued_confirmation_id
      FROM public.enqueue_price_upload_confirmation(
        p_source_object_key,
        current_entry_index,
        p_upload_context,
        entry_payload_value,
        candidate_vendor_ids_value,
        resolution_value -> 'candidate_snapshot',
        p_created_by
      ) AS queued;

      entry_index := current_entry_index;
      outcome := 'needs_confirmation';
      vendor_id := NULL;
      vendor_name := entry_payload_value ->> 'vendor_name';
      confirmation_id := queued_confirmation_id;
      snapshot_id := NULL;
      staged_prices := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF resolution_kind = 'existing' THEN
      selected_vendor_id := (resolution_value ->> 'vendor_id')::uuid;
      outcome := 'auto_matched';
    ELSE
      INSERT INTO public.vendors (
        name, category, region_code, aliases, status, slug
      ) VALUES (
        resolution_value ->> 'vendor_name',
        CASE
          WHEN entry_payload_value ->> 'category' = 'hall' THEN 'venue'
          ELSE entry_payload_value ->> 'category'
        END,
        entry_payload_value ->> 'region_code',
        ARRAY(
          SELECT alias.value
          FROM jsonb_array_elements_text(
            entry_payload_value -> 'aliases'
          ) AS alias(value)
        ),
        'draft',
        resolution_value ->> 'vendor_slug'
      ) ON CONFLICT (slug) WHERE slug IS NOT NULL DO NOTHING;
      SELECT vendor.id
      INTO selected_vendor_id
      FROM public.vendors AS vendor
      WHERE vendor.slug = resolution_value ->> 'vendor_slug';
      outcome := 'newly_created';
    END IF;

    SELECT vendor.id, vendor.name, vendor.category, vendor.region_code,
      vendor.aliases, vendor.status, vendor.slug
    INTO selected_vendor
    FROM public.vendors AS vendor
    WHERE vendor.id = selected_vendor_id
    FOR SHARE;
    IF selected_vendor.id IS NULL
      OR selected_vendor.status NOT IN ('pending', 'approved', 'draft')
      OR selected_vendor.category IS DISTINCT FROM (
        CASE
          WHEN entry_payload_value ->> 'category' = 'hall' THEN 'venue'
          ELSE entry_payload_value ->> 'category'
        END
      )
      OR (
        resolution_kind = 'existing'
        AND selected_vendor.name IS DISTINCT FROM resolution_value ->> 'vendor_name'
      )
      OR (
        resolution_kind = 'draft'
        AND (
          selected_vendor.name IS DISTINCT FROM resolution_value ->> 'vendor_name'
          OR selected_vendor.slug IS DISTINCT FROM resolution_value ->> 'vendor_slug'
          OR selected_vendor.region_code
            IS DISTINCT FROM entry_payload_value ->> 'region_code'
        )
      )
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_VENDOR_CONFLICT'
        USING ERRCODE = '23514';
    END IF;

    IF snapshot_id_value IS NULL THEN
      INSERT INTO public.price_snapshots (
        period_label, source, source_note, collected_at,
        published, published_at, is_current
      ) VALUES (
        p_upload_context ->> 'period_label',
        p_upload_context ->> 'source',
        p_upload_context ->> 'source_note',
        upload_collected_at,
        false, NULL, false
      ) ON CONFLICT (source, period_label) DO NOTHING;
      SELECT snapshot.id, snapshot.published, snapshot.is_current,
        snapshot.source_note, snapshot.collected_at
      INTO snapshot_row
      FROM public.price_snapshots AS snapshot
      WHERE snapshot.source = p_upload_context ->> 'source'
        AND snapshot.period_label = p_upload_context ->> 'period_label'
      FOR UPDATE;
      IF snapshot_row.id IS NULL
        OR snapshot_row.published
        OR snapshot_row.is_current
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_SNAPSHOT_IMMUTABLE'
          USING ERRCODE = '55000';
      END IF;
      IF snapshot_row.source_note
          IS DISTINCT FROM p_upload_context ->> 'source_note'
        OR snapshot_row.collected_at IS DISTINCT FROM upload_collected_at
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_SNAPSHOT_CONTEXT_CONFLICT'
          USING ERRCODE = '23505';
      END IF;
      snapshot_id_value := snapshot_row.id;
    END IF;

    entry_staged_count := 0;
    FOR price_value IN
      SELECT price.value
      FROM jsonb_array_elements(entry_payload_value -> 'prices') AS price(value)
    LOOP
      SELECT agency.id, agency.merged_into_agency_id, agency.is_active
      INTO selected_agency
      FROM public.agencies AS agency
      WHERE agency.slug = price_value ->> 'agency_slug'
      FOR SHARE;
      IF selected_agency.id IS NULL
        OR selected_agency.merged_into_agency_id IS NOT NULL
        OR selected_agency.is_active IS DISTINCT FROM true
      THEN
        RAISE EXCEPTION 'PRICE_UPLOAD_ATOMIC_AGENCY_INACTIVE'
          USING ERRCODE = '23514';
      END IF;
      PERFORM public.stage_admin_json_price(
        snapshot_id_value,
        selected_vendor_id,
        selected_agency.id,
        entry_payload_value ->> 'category',
        '기본 공시가',
        (price_value ->> 'price_min_krw')::integer,
        (price_value ->> 'price_max_krw')::integer,
        price_value ->> 'price_note',
        price_value ->> 'base_spec',
        price_value -> 'options',
        source_file_name,
        p_source_object_key,
        price_value ->> 'source_quote',
        price_value ->> 'source_record_key'
      );
      entry_staged_count := entry_staged_count + 1;
    END LOOP;

    entry_index := current_entry_index;
    vendor_id := selected_vendor_id;
    vendor_name := selected_vendor.name;
    confirmation_id := NULL;
    snapshot_id := snapshot_id_value;
    staged_prices := entry_staged_count;
    RETURN NEXT;
  END LOOP;
END
$apply_admin_json_price_upload$;

CREATE OR REPLACE FUNCTION public.resolve_price_upload_confirmation(
  p_confirmation_id uuid,
  p_selected_vendor_id uuid,
  p_expected_version bigint,
  p_resolved_by uuid
)
RETURNS TABLE (
  confirmation_id uuid,
  snapshot_id uuid,
  staged_prices integer,
  version bigint,
  already_resolved boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $resolve_price_upload_confirmation$
DECLARE
  confirmation_row public.price_upload_confirmations%ROWTYPE;
  selected_vendor record;
  snapshot_row record;
  agency_row record;
  price_row record;
  upload_source text;
  upload_period text;
  upload_source_note text;
  upload_collected_at date;
  entry_category text;
  source_file_name text;
  approved_aliases text[];
  staged_count integer := 0;
BEGIN
  IF p_confirmation_id IS NULL
    OR p_selected_vendor_id IS NULL
    OR p_expected_version IS NULL
    OR p_resolved_by IS NULL
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_RESOLVE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT confirmation.*
  INTO confirmation_row
  FROM public.price_upload_confirmations AS confirmation
  WHERE confirmation.id = p_confirmation_id
  FOR UPDATE;
  IF confirmation_row.id IS NULL THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF confirmation_row.state = 'resolved' THEN
    IF confirmation_row.selected_vendor_id IS DISTINCT FROM p_selected_vendor_id THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_ALREADY_RESOLVED_DIFFERENT_VENDOR'
        USING ERRCODE = '40001';
    END IF;
    RETURN QUERY SELECT
      confirmation_row.id,
      confirmation_row.staged_snapshot_id,
      confirmation_row.staged_price_count,
      confirmation_row.version,
      true;
    RETURN;
  END IF;
  IF confirmation_row.state <> 'pending'
    OR confirmation_row.version <> p_expected_version
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_VERSION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;
  IF NOT p_selected_vendor_id = ANY(confirmation_row.candidate_vendor_ids) THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_VENDOR_NOT_A_CANDIDATE'
      USING ERRCODE = '22023';
  END IF;

  entry_category := confirmation_row.entry_payload ->> 'category';
  IF entry_category NOT IN ('studio', 'dress', 'makeup', 'hall') THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_PAYLOAD_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Every name/alias claim in a category shares one transaction lock. The
  -- selected vendor and all competing names/aliases are re-read only after the
  -- lock, so two confirmations cannot both approve the same normalized alias.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'price-upload-alias-namespace-v1:' || CASE
        WHEN entry_category = 'hall' THEN 'venue'
        ELSE entry_category
      END,
      0
    )
  );
  SELECT vendor.id, vendor.name, vendor.category, vendor.status, vendor.aliases
  INTO selected_vendor
  FROM public.vendors AS vendor
  WHERE vendor.id = p_selected_vendor_id
  FOR UPDATE;
  IF selected_vendor.id IS NULL
    OR selected_vendor.status NOT IN ('pending', 'approved', 'draft')
    OR selected_vendor.category IS DISTINCT FROM (
      CASE WHEN entry_category = 'hall' THEN 'venue' ELSE entry_category END
    )
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_VENDOR_INACTIVE_OR_CATEGORY_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  upload_source := confirmation_row.upload_context ->> 'source';
  upload_period := confirmation_row.upload_context ->> 'period_label';
  upload_source_note := confirmation_row.upload_context ->> 'source_note';
  BEGIN
    upload_collected_at :=
      (confirmation_row.upload_context ->> 'collected_at')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_CONTEXT_INVALID'
      USING ERRCODE = '22023';
  END;
  IF upload_source NOT IN ('kca_tprice', 'agency_site', 'mixed')
    OR NULLIF(btrim(upload_period), '') IS NULL
    OR length(upload_period) > 40
    OR NULLIF(btrim(upload_source_note), '') IS NULL
    OR length(upload_source_note) > 500
    OR entry_category NOT IN ('studio', 'dress', 'makeup', 'hall')
    OR jsonb_typeof(confirmation_row.entry_payload -> 'prices') <> 'array'
    OR jsonb_array_length(confirmation_row.entry_payload -> 'prices')
      NOT BETWEEN 1 AND 20
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_PAYLOAD_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Lock and validate every agency before changing aliases. This produces a
  -- clearer failure while the surrounding function transaction still provides
  -- the final all-or-nothing guarantee.
  FOR price_row IN
    SELECT price.value
    FROM jsonb_array_elements(
      confirmation_row.entry_payload -> 'prices'
    ) AS price(value)
  LOOP
    SELECT agency.id, agency.merged_into_agency_id, agency.is_active
    INTO agency_row
    FROM public.agencies AS agency
    WHERE agency.slug = price_row.value ->> 'agency_slug'
    FOR SHARE;
    IF agency_row.id IS NULL
      OR agency_row.merged_into_agency_id IS NOT NULL
      OR agency_row.is_active IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_AGENCY_INACTIVE'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- Add only names not claimed by another active vendor in the same category.
  -- This avoids creating a new exact-alias ambiguity while preserving every
  -- non-conflicting former/display name for deterministic future matching.
  WITH requested_aliases AS (
    SELECT confirmation_row.entry_payload ->> 'vendor_name' AS alias_value
    UNION ALL
    SELECT alias_value
    FROM jsonb_array_elements_text(
      COALESCE(confirmation_row.entry_payload -> 'aliases', '[]'::jsonb)
    ) AS alias(alias_value)
  ), normalized_aliases AS (
    SELECT DISTINCT ON (public.normalize_price_vendor_name(alias_value))
      btrim(alias_value) AS alias_value,
      public.normalize_price_vendor_name(alias_value) AS normalized_alias
    FROM requested_aliases
    WHERE NULLIF(btrim(alias_value), '') IS NOT NULL
      AND length(btrim(alias_value)) <= 200
    ORDER BY public.normalize_price_vendor_name(alias_value), btrim(alias_value)
  )
  SELECT COALESCE(array_agg(alias_row.alias_value ORDER BY alias_row.alias_value), '{}')
  INTO approved_aliases
  FROM normalized_aliases AS alias_row
  WHERE alias_row.normalized_alias <>
      public.normalize_price_vendor_name(selected_vendor.name)
    AND NOT EXISTS (
      SELECT 1
      FROM public.vendors AS other_vendor
      WHERE other_vendor.id <> p_selected_vendor_id
        AND other_vendor.status IN ('pending', 'approved', 'draft')
        AND other_vendor.category = selected_vendor.category
        AND (
          public.normalize_price_vendor_name(other_vendor.name)
            = alias_row.normalized_alias
          OR EXISTS (
            SELECT 1
            FROM unnest(other_vendor.aliases) AS other_alias(value)
            WHERE public.normalize_price_vendor_name(other_alias.value)
              = alias_row.normalized_alias
          )
        )
    );
  PERFORM public.merge_vendor_aliases(p_selected_vendor_id, approved_aliases);

  INSERT INTO public.price_snapshots (
    period_label, source, source_note, collected_at,
    published, published_at, is_current
  ) VALUES (
    upload_period, upload_source, upload_source_note, upload_collected_at,
    false, NULL, false
  ) ON CONFLICT (source, period_label) DO NOTHING;

  SELECT snapshot.id, snapshot.published, snapshot.is_current,
    snapshot.source_note, snapshot.collected_at
  INTO snapshot_row
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.source = upload_source
    AND snapshot.period_label = upload_period
  FOR UPDATE;
  IF snapshot_row.id IS NULL
    OR snapshot_row.published
    OR snapshot_row.is_current
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_SNAPSHOT_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  IF snapshot_row.source_note IS DISTINCT FROM upload_source_note
    OR snapshot_row.collected_at IS DISTINCT FROM upload_collected_at
  THEN
    RAISE EXCEPTION 'PRICE_UPLOAD_CONFIRMATION_SNAPSHOT_CONTEXT_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  source_file_name := left(
    format('admin JSON (%s %s).json', upload_source, upload_period),
    500
  );
  FOR price_row IN
    SELECT price.value, price.ordinality
    FROM jsonb_array_elements(confirmation_row.entry_payload -> 'prices')
      WITH ORDINALITY AS price(value, ordinality)
  LOOP
    SELECT agency.id
    INTO agency_row
    FROM public.agencies AS agency
    WHERE agency.slug = price_row.value ->> 'agency_slug'
      AND agency.merged_into_agency_id IS NULL
      AND agency.is_active = true
    FOR SHARE;

    PERFORM public.stage_admin_json_price(
      snapshot_row.id,
      p_selected_vendor_id,
      agency_row.id,
      entry_category,
      '기본 공시가',
      (price_row.value ->> 'price_min_krw')::integer,
      (price_row.value ->> 'price_max_krw')::integer,
      price_row.value ->> 'price_note',
      price_row.value ->> 'base_spec',
      price_row.value -> 'options',
      source_file_name,
      confirmation_row.source_object_key,
      price_row.value ->> 'source_quote',
      price_row.value ->> 'source_record_key'
    );
    staged_count := staged_count + 1;
  END LOOP;

  UPDATE public.price_upload_confirmations AS confirmation
  SET state = 'resolved',
      version = 1,
      selected_vendor_id = p_selected_vendor_id,
      resolved_by = p_resolved_by,
      resolved_at = now(),
      staged_snapshot_id = snapshot_row.id,
      staged_price_count = staged_count,
      updated_at = now()
  WHERE confirmation.id = confirmation_row.id;

  INSERT INTO public.price_upload_confirmation_events (
    confirmation_id, action, version, actor_id, selected_vendor_id
  ) VALUES (
    confirmation_row.id, 'resolved', 1, p_resolved_by, p_selected_vendor_id
  );

  RETURN QUERY SELECT
    confirmation_row.id,
    snapshot_row.id,
    staged_count,
    1::bigint,
    false;
END
$resolve_price_upload_confirmation$;

ALTER FUNCTION public.enqueue_price_upload_confirmation(
  text, integer, jsonb, jsonb, uuid[], jsonb, uuid
) OWNER TO postgres;
ALTER FUNCTION public.list_price_upload_confirmations(text) OWNER TO postgres;
ALTER FUNCTION public.admin_json_price_upload_context_is_safe(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_json_price_upload_entry_is_safe(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_json_price_candidates_are_safe(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_json_price_options_are_safe(jsonb) OWNER TO postgres;
ALTER FUNCTION public.stage_admin_json_price(
  uuid, uuid, uuid, text, text, integer, integer, text, text, jsonb,
  text, text, text, text
) OWNER TO postgres;
ALTER FUNCTION public.match_vendors_for_price_upload_batch(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.apply_admin_json_price_upload(text, jsonb, jsonb, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.resolve_price_upload_confirmation(uuid, uuid, bigint, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.enqueue_price_upload_confirmation(
  text, integer, jsonb, jsonb, uuid[], jsonb, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_price_upload_confirmations(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_json_price_upload_context_is_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_json_price_upload_entry_is_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_json_price_candidates_are_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_json_price_options_are_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage_admin_json_price(
  uuid, uuid, uuid, text, text, integer, integer, text, text, jsonb,
  text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_vendors_for_price_upload_batch(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_json_price_upload(
  text, jsonb, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_price_upload_confirmation(
  uuid, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_price_upload_confirmation(
  text, integer, jsonb, jsonb, uuid[], jsonb, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_price_upload_confirmations(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_admin_json_price(
  uuid, uuid, uuid, text, text, integer, integer, text, text, jsonb,
  text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_vendors_for_price_upload_batch(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_json_price_upload(
  text, jsonb, jsonb, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_price_upload_confirmation(
  uuid, uuid, bigint, uuid
) TO service_role;

COMMIT;
