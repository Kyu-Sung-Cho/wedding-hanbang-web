-- A local deterministic extraction may faithfully preserve an implausible
-- source literal that is outside PostgreSQL int4. Keep the hash-bound payload
-- unchanged, but quarantine that local pending-only storage projection for
-- human review. Paid staging retains the historical fail-closed int4 cast.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.vendor_disclosure_price_exceeds_integer_storage(
  p_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $vendor_disclosure_price_exceeds_integer_storage$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;

  RETURN (p_value #>> '{}')::numeric < (-2147483648)::numeric
    OR (p_value #>> '{}')::numeric > 2147483647::numeric;
END;
$vendor_disclosure_price_exceeds_integer_storage$;

CREATE OR REPLACE FUNCTION public.vendor_disclosure_price_for_integer_storage(
  p_value jsonb,
  p_authorization_kind text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $vendor_disclosure_price_for_integer_storage$
BEGIN
  IF p_authorization_kind = 'local_validated_pending_only'
    AND public.vendor_disclosure_price_exceeds_integer_storage(p_value)
  THEN
    RETURN NULL;
  END IF;

  -- Deliberately preserve the predecessor's paid-path behavior, including
  -- SQLSTATE 22003 for an out-of-range value.
  RETURN (p_value #>> '{}')::integer;
END;
$vendor_disclosure_price_for_integer_storage$;

CREATE OR REPLACE FUNCTION public.vendor_disclosure_price_options_for_storage(
  p_options jsonb,
  p_authorization_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $vendor_disclosure_price_options_for_storage$
DECLARE
  option_value jsonb;
  stored_options jsonb := '[]'::jsonb;
BEGIN
  IF p_authorization_kind IS DISTINCT FROM 'local_validated_pending_only'
    OR jsonb_typeof(p_options) IS DISTINCT FROM 'array'
  THEN
    RETURN p_options;
  END IF;

  FOR option_value IN
    SELECT option_row.value
    FROM jsonb_array_elements(p_options) AS option_row(value)
  LOOP
    IF public.vendor_disclosure_price_exceeds_integer_storage(
      option_value -> 'price_min_krw'
    ) THEN
      option_value := jsonb_set(
        option_value, '{price_min_krw}', 'null'::jsonb, false
      );
    END IF;
    IF public.vendor_disclosure_price_exceeds_integer_storage(
      option_value -> 'price_max_krw'
    ) THEN
      option_value := jsonb_set(
        option_value, '{price_max_krw}', 'null'::jsonb, false
      );
    END IF;
    stored_options := stored_options || jsonb_build_array(option_value);
  END LOOP;

  RETURN stored_options;
END;
$vendor_disclosure_price_options_for_storage$;

CREATE OR REPLACE FUNCTION public.vendor_disclosure_price_overflow_issue_codes(
  p_row jsonb,
  p_authorization_kind text
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $vendor_disclosure_price_overflow_issue_codes$
DECLARE
  quarantine_code constant text := 'local_price_overflow_quarantined';
  existing_codes text[];
  existing_code text;
  bounded_codes text[] := ARRAY[quarantine_code];
  has_overflow boolean;
BEGIN
  existing_codes := ARRAY(
    SELECT issue.value
    FROM jsonb_array_elements_text(
      p_row -> 'validation_issue_codes'
    ) WITH ORDINALITY AS issue(value, ordinality)
    ORDER BY issue.ordinality
  );

  has_overflow :=
    public.vendor_disclosure_price_exceeds_integer_storage(
      p_row -> 'price_min_krw'
    )
    OR public.vendor_disclosure_price_exceeds_integer_storage(
      p_row -> 'price_max_krw'
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(p_row -> 'options') = 'array'
            THEN p_row -> 'options'
          ELSE '[]'::jsonb
        END
      ) AS option_row(value)
      WHERE public.vendor_disclosure_price_exceeds_integer_storage(
        option_row.value -> 'price_min_krw'
      )
        OR public.vendor_disclosure_price_exceeds_integer_storage(
          option_row.value -> 'price_max_krw'
        )
    );

  IF p_authorization_kind IS DISTINCT FROM 'local_validated_pending_only'
    OR NOT has_overflow
  THEN
    RETURN existing_codes;
  END IF;

  FOREACH existing_code IN ARRAY existing_codes
  LOOP
    EXIT WHEN cardinality(bounded_codes) >= 100;
    IF existing_code IS DISTINCT FROM quarantine_code
      AND NOT COALESCE(existing_code = ANY(bounded_codes), false)
    THEN
      bounded_codes := array_append(bounded_codes, existing_code);
    END IF;
  END LOOP;

  RETURN bounded_codes;
END;
$vendor_disclosure_price_overflow_issue_codes$;

ALTER FUNCTION public.vendor_disclosure_price_exceeds_integer_storage(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_price_for_integer_storage(jsonb, text)
  OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_price_options_for_storage(jsonb, text)
  OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_price_overflow_issue_codes(jsonb, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.vendor_disclosure_price_exceeds_integer_storage(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_price_for_integer_storage(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_price_options_for_storage(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_price_overflow_issue_codes(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $vendor_disclosure_local_price_overflow_patch$
DECLARE
  stage_function regprocedure := pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  stage_definition text;
  patched_definition text;
  old_parent_prices constant text := $old_parent_prices$(row_value ->> 'price_min_krw')::integer,
      (row_value ->> 'price_max_krw')::integer$old_parent_prices$;
  new_parent_prices constant text := $new_parent_prices$public.vendor_disclosure_price_for_integer_storage(
        row_value -> 'price_min_krw', p_authorization_kind
      ),
      public.vendor_disclosure_price_for_integer_storage(
        row_value -> 'price_max_krw', p_authorization_kind
      )$new_parent_prices$;
  old_option_prices constant text := $old_option_prices$(option_value ->> 'price_min_krw')::integer,
        (option_value ->> 'price_max_krw')::integer$old_option_prices$;
  new_option_prices constant text := $new_option_prices$public.vendor_disclosure_price_for_integer_storage(
          option_value -> 'price_min_krw', p_authorization_kind
        ),
        public.vendor_disclosure_price_for_integer_storage(
          option_value -> 'price_max_krw', p_authorization_kind
        )$new_option_prices$;
  old_package_options constant text := $old_package_options$row_value -> 'options',$old_package_options$;
  new_package_options constant text := $new_package_options$public.vendor_disclosure_price_options_for_storage(
        row_value -> 'options', p_authorization_kind
      ),$new_package_options$;
  old_issue_codes constant text := $old_issue_codes$ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),$old_issue_codes$;
  new_issue_codes constant text := $new_issue_codes$public.vendor_disclosure_price_overflow_issue_codes(
        row_value, p_authorization_kind
      ),$new_issue_codes$;
BEGIN
  IF stage_function IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_LOCAL_PRICE_OVERFLOW_STAGE_FUNCTION_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(proc.oid)
  INTO stage_definition
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = stage_function;

  IF stage_definition IS NULL
    OR length(stage_definition) - length(replace(stage_definition, old_parent_prices, ''))
      IS DISTINCT FROM 2 * length(old_parent_prices)
    OR length(stage_definition) - length(replace(stage_definition, old_option_prices, ''))
      IS DISTINCT FROM length(old_option_prices)
    OR length(stage_definition) - length(replace(stage_definition, old_package_options, ''))
      IS DISTINCT FROM length(old_package_options)
    OR length(stage_definition) - length(replace(stage_definition, old_issue_codes, ''))
      IS DISTINCT FROM 3 * length(old_issue_codes)
  THEN
    RAISE EXCEPTION
      'DISCLOSURE_LOCAL_PRICE_OVERFLOW_PREDECESSOR_DRIFT parent=% option=% package_options=% issues=%',
      (length(stage_definition) - length(replace(stage_definition, old_parent_prices, '')))
        / NULLIF(length(old_parent_prices), 0),
      (length(stage_definition) - length(replace(stage_definition, old_option_prices, '')))
        / NULLIF(length(old_option_prices), 0),
      (length(stage_definition) - length(replace(stage_definition, old_package_options, '')))
        / NULLIF(length(old_package_options), 0),
      (length(stage_definition) - length(replace(stage_definition, old_issue_codes, '')))
        / NULLIF(length(old_issue_codes), 0);
  END IF;

  patched_definition := replace(
    replace(
      replace(
        replace(
          stage_definition,
          old_parent_prices,
          new_parent_prices
        ),
        old_option_prices,
        new_option_prices
      ),
      old_package_options,
      new_package_options
    ),
    old_issue_codes,
    new_issue_codes
  );

  IF patched_definition = stage_definition
    OR position(
      'vendor_disclosure_price_for_integer_storage('
      IN patched_definition
    ) = 0
    OR position(
      'vendor_disclosure_price_options_for_storage('
      IN patched_definition
    ) = 0
    OR position(
      'vendor_disclosure_price_overflow_issue_codes('
      IN patched_definition
    ) = 0
  THEN
    RAISE EXCEPTION 'DISCLOSURE_LOCAL_PRICE_OVERFLOW_PATCH_FAILED';
  END IF;

  EXECUTE patched_definition;
END;
$vendor_disclosure_local_price_overflow_patch$;

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

DO $vendor_disclosure_local_price_overflow_postconditions$
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
      'vendor_disclosure_price_for_integer_storage('
      IN stage_definition
    ) = 0
    OR position(
      'vendor_disclosure_price_options_for_storage('
      IN stage_definition
    ) = 0
    OR position(
      'vendor_disclosure_price_overflow_issue_codes('
      IN stage_definition
    ) = 0
    OR position('p_payload :=' IN stage_definition) > 0
    OR pg_catalog.has_function_privilege('anon', stage_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'authenticated', stage_function, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', stage_function, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role',
      'public.vendor_disclosure_price_exceeds_integer_storage(jsonb)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role',
      'public.vendor_disclosure_price_for_integer_storage(jsonb,text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role',
      'public.vendor_disclosure_price_options_for_storage(jsonb,text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role',
      'public.vendor_disclosure_price_overflow_issue_codes(jsonb,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_LOCAL_PRICE_OVERFLOW_POSTCONDITION_FAILED';
  END IF;
END;
$vendor_disclosure_local_price_overflow_postconditions$;

COMMIT;
