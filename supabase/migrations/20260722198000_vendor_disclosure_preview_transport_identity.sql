-- A content-addressed preview can be referenced by more than one source file.
-- The immutable batch payload preserves every source-to-preview mapping, while
-- Storage prepares and uploads the shared object once. This compatibility path
-- is restricted to local pending-only runs; paid attestations retain the
-- historical one-payload-entry-per-Storage-object cardinality contract.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.vendor_disclosure_local_payload_provenance_is_safe(
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $vendor_disclosure_local_payload_provenance_is_safe$
DECLARE
  raw_keys text[];
  preview_keys text[];
  item jsonb;
  preview_item jsonb;
  option_value jsonb;
  unit_value jsonb;
BEGIN
  IF jsonb_typeof(p_payload -> 'units') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'raw_objects') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'preview_objects') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'agency_packages') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'official_prices') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'disclosure_semantics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'units') NOT BETWEEN 1 AND 25
    OR jsonb_array_length(p_payload -> 'raw_objects') > 1000
    OR jsonb_array_length(p_payload -> 'preview_objects') > 1000
  THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    array_agg(raw.value ->> 'storage_path' ORDER BY raw.ordinality),
    '{}'::text[]
  )
  INTO raw_keys
  FROM jsonb_array_elements(p_payload -> 'raw_objects')
    WITH ORDINALITY AS raw(value, ordinality);

  SELECT COALESCE(
    array_agg(preview.value ->> 'storage_path' ORDER BY preview.ordinality),
    '{}'::text[]
  )
  INTO preview_keys
  FROM jsonb_array_elements(p_payload -> 'preview_objects')
    WITH ORDINALITY AS preview(value, ordinality);

  IF cardinality(raw_keys) IS DISTINCT FROM cardinality(ARRAY(
    SELECT DISTINCT key FROM unnest(raw_keys) AS source(key)
  )) THEN
    RETURN false;
  END IF;

  -- Raw Storage identities remain one-to-one. In particular, permitting a
  -- shared preview must not make an unreferenced or malformed raw object valid.
  FOR item IN
    SELECT raw.value
    FROM jsonb_array_elements(p_payload -> 'raw_objects') AS raw(value)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR COALESCE(item ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(item ->> 'ext', '')
        NOT IN ('xlsx', 'docx', 'hwp', 'pdf', 'png')
      OR item ->> 'storage_path'
        IS DISTINCT FROM (item ->> 'sha256') || '.' || (item ->> 'ext')
      OR COALESCE(item ->> 'bytes', '') !~ '^[0-9]{1,9}$'
      OR (item ->> 'bytes')::bigint > 52428800
      OR NULLIF(item ->> 'source_path', '') IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
        WHERE jsonb_typeof(unit.value -> 'source_object_keys') = 'array'
          AND unit.value -> 'source_object_keys'
            @> jsonb_build_array(item ->> 'storage_path')
      )
    THEN
      RETURN false;
    END IF;
  END LOOP;

  -- Foreign-batch provenance occurrences are tolerated only as redundant
  -- mappings of a blob that also has a current-batch raw mapping. Every
  -- occurrence must still be structurally content-addressed, and one key can
  -- never claim a second digest or byte length.
  FOR preview_item IN
    SELECT preview.value
    FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
  LOOP
    IF jsonb_typeof(preview_item) IS DISTINCT FROM 'object'
      OR COALESCE(preview_item ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
      OR preview_item ->> 'storage_path'
        IS DISTINCT FROM (preview_item ->> 'sha256') || '.txt'
      OR COALESCE(preview_item ->> 'bytes', '') !~ '^[0-9]{1,8}$'
      OR (preview_item ->> 'bytes')::bigint > 2097152
      OR COALESCE(preview_item ->> 'source_object_key', '')
        !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png)$'
      OR NULLIF(preview_item ->> 'source_label', '') IS NULL
      OR length(preview_item ->> 'source_label') > 255
      OR preview_item ->> 'source_label' ~ '[\\/]'
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
        WHERE jsonb_typeof(unit.value -> 'source_preview_keys') = 'array'
          AND unit.value -> 'source_preview_keys'
            @> jsonb_build_array(preview_item ->> 'storage_path')
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_payload -> 'preview_objects') AS sibling(value)
        WHERE sibling.value ->> 'storage_path' = preview_item ->> 'storage_path'
          AND (
            sibling.value ->> 'sha256'
              IS DISTINCT FROM preview_item ->> 'sha256'
            OR sibling.value ->> 'bytes'
              IS DISTINCT FROM preview_item ->> 'bytes'
          )
      )
      OR (
        NOT COALESCE(
          (preview_item ->> 'source_object_key') = ANY(raw_keys),
          false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_payload -> 'preview_objects') AS sibling(value)
          WHERE sibling.value ->> 'storage_path'
              = preview_item ->> 'storage_path'
            AND sibling.value ->> 'sha256' = preview_item ->> 'sha256'
            AND sibling.value ->> 'bytes' = preview_item ->> 'bytes'
            AND COALESCE(
              (sibling.value ->> 'source_object_key') = ANY(raw_keys),
              false
            )
        )
      )
    THEN
      RETURN false;
    END IF;
  END LOOP;

  -- Validate current-batch units directly against current raw identities. A
  -- source_preview_key is usable only when at least one occurrence maps it to
  -- a raw object owned by that exact unit. This permits redundant foreign
  -- occurrences without letting them satisfy current provenance.
  FOR unit_value IN
    SELECT unit.value
    FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
  LOOP
    IF jsonb_typeof(unit_value) IS DISTINCT FROM 'object'
      OR jsonb_typeof(unit_value -> 'source_object_keys') IS DISTINCT FROM 'array'
      OR jsonb_array_length(unit_value -> 'source_object_keys') < 1
      OR jsonb_typeof(unit_value -> 'source_preview_keys') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          unit_value -> 'source_object_keys'
        ) AS key(value)
        WHERE key.value IS NULL
          OR NOT COALESCE(key.value = ANY(raw_keys), false)
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          unit_value -> 'source_preview_keys'
        ) AS key(value)
        WHERE key.value IS NULL
          OR NOT COALESCE(key.value = ANY(preview_keys), false)
          OR NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              p_payload -> 'preview_objects'
            ) AS preview(value)
            WHERE preview.value ->> 'storage_path' = key.value
              AND unit_value -> 'source_object_keys'
                @> jsonb_build_array(
                  preview.value ->> 'source_object_key'
                )
          )
      )
      OR jsonb_array_length(unit_value -> 'source_object_keys')
        IS DISTINCT FROM cardinality(ARRAY(
          SELECT DISTINCT key.value
          FROM jsonb_array_elements_text(
            unit_value -> 'source_object_keys'
          ) AS key(value)
        ))
      OR jsonb_array_length(unit_value -> 'source_preview_keys')
        IS DISTINCT FROM cardinality(ARRAY(
          SELECT DISTINCT key.value
          FROM jsonb_array_elements_text(
            unit_value -> 'source_preview_keys'
          ) AS key(value)
        ))
    THEN
      RETURN false;
    END IF;
  END LOOP;

  -- Rows and nested price/package options retain the predecessor's strict
  -- ownership rules. Repeated occurrences can prove a row only through a
  -- mapping whose raw key is explicitly carried by that row and its unit.
  FOR item IN
    SELECT package.value
    FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
    UNION ALL
    SELECT price.value
    FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
    UNION ALL
    SELECT semantic.value
    FROM jsonb_array_elements(
      p_payload -> 'disclosure_semantics'
    ) AS semantic(value)
  LOOP
    SELECT unit.value
    INTO unit_value
    FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
    WHERE unit.value ->> 'unit_id' = item ->> 'unit_id';

    IF unit_value IS NULL
      OR jsonb_typeof(item -> 'source_object_keys') IS DISTINCT FROM 'array'
      OR jsonb_array_length(item -> 'source_object_keys') < 1
      OR jsonb_typeof(item -> 'source_preview_keys') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          item -> 'source_object_keys'
        ) AS key(value)
        WHERE key.value IS NULL
          OR NOT COALESCE(key.value = ANY(raw_keys), false)
          OR NOT (
            unit_value -> 'source_object_keys'
              @> jsonb_build_array(key.value)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          item -> 'source_preview_keys'
        ) AS key(value)
        WHERE key.value IS NULL
          OR NOT COALESCE(key.value = ANY(preview_keys), false)
          OR NOT (
            unit_value -> 'source_preview_keys'
              @> jsonb_build_array(key.value)
          )
          OR NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              p_payload -> 'preview_objects'
            ) AS preview(value)
            WHERE preview.value ->> 'storage_path' = key.value
              AND item -> 'source_object_keys'
                @> jsonb_build_array(
                  preview.value ->> 'source_object_key'
                )
          )
      )
    THEN
      RETURN false;
    END IF;

    IF item ? 'options' THEN
      IF jsonb_typeof(item -> 'options') IS DISTINCT FROM 'array'
        OR jsonb_array_length(item -> 'options') > 1000
      THEN
        RETURN false;
      END IF;

      FOR option_value IN
        SELECT option_row.value
        FROM jsonb_array_elements(item -> 'options') AS option_row(value)
      LOOP
        IF jsonb_typeof(option_value -> 'source_object_keys')
            IS DISTINCT FROM 'array'
          OR jsonb_array_length(option_value -> 'source_object_keys') < 1
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              option_value -> 'source_object_keys'
            ) AS key(value)
            WHERE key.value IS NULL
              OR NOT COALESCE(key.value = ANY(raw_keys), false)
              OR NOT (
                unit_value -> 'source_object_keys'
                  @> jsonb_build_array(key.value)
              )
          )
        THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$vendor_disclosure_local_payload_provenance_is_safe$;

ALTER FUNCTION public.vendor_disclosure_local_payload_provenance_is_safe(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.vendor_disclosure_local_payload_provenance_is_safe(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

DO $vendor_disclosure_preview_transport_patch$
DECLARE
  stage_function regprocedure := pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  stage_definition text;
  patched_definition text;
  old_fragment constant text := $old_fragment$jsonb_array_length(p_payload -> 'raw_objects') + jsonb_array_length(p_payload -> 'preview_objects')$old_fragment$;
  new_fragment constant text := $new_fragment$(CASE
        WHEN p_authorization_kind = 'local_validated_pending_only' THEN
          jsonb_array_length(p_payload -> 'raw_objects') + (
            SELECT count(*)::integer
            FROM (
              SELECT DISTINCT preview.value ->> 'storage_path' AS storage_path
              FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
            ) AS distinct_preview
          )
        ELSE
          jsonb_array_length(p_payload -> 'raw_objects') + jsonb_array_length(p_payload -> 'preview_objects')
      END)$new_fragment$;
  old_provenance_fragment constant text := $old_provenance$public.vendor_disclosure_payload_provenance_is_safe(p_payload)$old_provenance$;
  new_provenance_fragment constant text := $new_provenance$(CASE
      WHEN p_authorization_kind = 'local_validated_pending_only' THEN
        public.vendor_disclosure_local_payload_provenance_is_safe(p_payload)
      ELSE
        public.vendor_disclosure_payload_provenance_is_safe(p_payload)
    END)$new_provenance$;
BEGIN
  IF stage_function IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_PREVIEW_TRANSPORT_STAGE_FUNCTION_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(proc.oid)
  INTO stage_definition
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = stage_function;

  IF stage_definition IS NULL
    OR length(stage_definition) - length(replace(stage_definition, old_fragment, ''))
      IS DISTINCT FROM length(old_fragment)
    OR length(stage_definition) - length(replace(stage_definition, old_provenance_fragment, ''))
      IS DISTINCT FROM length(old_provenance_fragment)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_PREVIEW_TRANSPORT_PREDECESSOR_DRIFT';
  END IF;

  patched_definition := replace(
    replace(stage_definition, old_fragment, new_fragment),
    old_provenance_fragment,
    new_provenance_fragment
  );
  IF patched_definition = stage_definition
    OR position(
      $canonical_preview$SELECT DISTINCT preview.value ->> 'storage_path' AS storage_path$canonical_preview$
      IN patched_definition
    ) = 0
    OR position(
      'vendor_disclosure_local_payload_provenance_is_safe(p_payload)'
      IN patched_definition
    ) = 0
  THEN
    RAISE EXCEPTION 'DISCLOSURE_PREVIEW_TRANSPORT_PATCH_FAILED';
  END IF;

  EXECUTE patched_definition;
END;
$vendor_disclosure_preview_transport_patch$;

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

DO $vendor_disclosure_preview_transport_postconditions$
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
      $canonical_preview$SELECT DISTINCT preview.value ->> 'storage_path' AS storage_path$canonical_preview$
      IN stage_definition
    ) = 0
    OR position(
      $local_only$p_authorization_kind = 'local_validated_pending_only'$local_only$
      IN stage_definition
    ) = 0
    OR position(
      'vendor_disclosure_local_payload_provenance_is_safe(p_payload)'
      IN stage_definition
    ) = 0
    OR position(
      $storage_equivalence$WHERE supplied.value ->> 'bucket' = expected.bucket_id$storage_equivalence$
      IN stage_definition
    ) = 0
    OR position(
      'DISCLOSURE_ATOMIC_STORAGE_OUTCOME_INCOMPLETE'
      IN stage_definition
    ) = 0
    OR pg_catalog.has_function_privilege('anon', stage_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'authenticated', stage_function, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', stage_function, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role',
      'public.vendor_disclosure_local_payload_provenance_is_safe(jsonb)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_PREVIEW_TRANSPORT_POSTCONDITION_FAILED';
  END IF;
END;
$vendor_disclosure_preview_transport_postconditions$;

COMMIT;
