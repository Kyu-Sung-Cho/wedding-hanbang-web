-- Saved price combinations are created only by the server endpoint after it
-- authenticates the caller, applies the API rate limit, validates the exact
-- request shape, and reprices every public catalog value. Authenticated REST
-- clients retain owned reads/deletes, but cannot bypass that boundary with a
-- direct table INSERT or UPDATE.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP POLICY IF EXISTS price_consumer_owner_all ON public.combos;
DROP POLICY IF EXISTS price_combo_owner_select ON public.combos;
DROP POLICY IF EXISTS price_combo_owner_delete ON public.combos;

CREATE POLICY price_combo_owner_select ON public.combos
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY price_combo_owner_delete ON public.combos
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE ON TABLE public.combos FROM authenticated, service_role;
REVOKE INSERT (
  id,
  user_id,
  name,
  selections,
  total_krw,
  created_at,
  updated_at,
  idempotency_key,
  request_hash
) ON TABLE public.combos FROM authenticated, service_role;
REVOKE UPDATE (
  id,
  user_id,
  name,
  selections,
  total_krw,
  created_at,
  updated_at,
  idempotency_key,
  request_hash
) ON TABLE public.combos FROM authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.combos TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_price_combo_service_v1(
  p_user_id uuid,
  p_name text,
  p_selections jsonb,
  p_total_krw integer,
  p_idempotency_key uuid,
  p_request_hash text
)
RETURNS TABLE (
  id uuid,
  name text,
  selections jsonb,
  total_krw integer,
  created_at timestamptz,
  updated_at timestamptz,
  request_hash text,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $save_price_combo_service_v1$
DECLARE
  category_name text;
  selection_value jsonb;
  option_value jsonb;
  option_names text[];
  option_name_value text;
  vendor_id_value uuid;
  agency_id_value uuid;
  selected_price_id_value uuid;
  base_krw_value integer;
  custom_krw_value integer;
  option_krw_value integer;
  calculated_total numeric := 0;
  existing_request_hash text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PRICE_COMBO_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_name IS NULL
     OR length(btrim(p_name)) NOT BETWEEN 1 AND 80
     OR p_request_hash IS NULL
     OR p_request_hash !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'PRICE_COMBO_SERVICE_ARGUMENT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_selections) IS DISTINCT FROM 'object'
     OR NOT p_selections ?& ARRAY['studio', 'dress', 'makeup']::text[]
     OR (p_selections - ARRAY['studio', 'dress', 'makeup']::text[])
       <> '{}'::jsonb
     OR (
       p_selections -> 'studio' = 'null'::jsonb
       AND p_selections -> 'dress' = 'null'::jsonb
       AND p_selections -> 'makeup' = 'null'::jsonb
     )
  THEN
    RAISE EXCEPTION 'PRICE_COMBO_SELECTIONS_SHAPE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  FOREACH category_name IN ARRAY ARRAY['studio', 'dress', 'makeup']::text[]
  LOOP
    selection_value := p_selections -> category_name;
    CONTINUE WHEN selection_value = 'null'::jsonb;

    IF jsonb_typeof(selection_value) IS DISTINCT FROM 'object'
       OR NOT selection_value ?& ARRAY[
         'vendor_id', 'agency_id', 'base_krw', 'selected_options', 'custom_krw'
       ]::text[]
       OR (
         selection_value - ARRAY[
           'vendor_id', 'agency_id', 'base_krw', 'selected_options', 'custom_krw'
         ]::text[]
       ) <> '{}'::jsonb
       OR jsonb_typeof(selection_value -> 'vendor_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(selection_value -> 'base_krw') IS DISTINCT FROM 'number'
       OR (selection_value ->> 'base_krw') !~ '^(0|[1-9][0-9]{0,9})$'
       OR (selection_value ->> 'base_krw')::numeric > 1000000000
       OR jsonb_typeof(selection_value -> 'selected_options')
         IS DISTINCT FROM 'array'
       OR jsonb_array_length(selection_value -> 'selected_options') > 50
       OR jsonb_typeof(selection_value -> 'agency_id')
         NOT IN ('null', 'string')
       OR jsonb_typeof(selection_value -> 'custom_krw')
         NOT IN ('null', 'number')
       OR (
         jsonb_typeof(selection_value -> 'custom_krw') = 'number'
         AND (
           (selection_value ->> 'custom_krw') !~ '^(0|[1-9][0-9]{0,9})$'
           OR (selection_value ->> 'custom_krw')::numeric > 1000000000
         )
       )
    THEN
      RAISE EXCEPTION 'PRICE_COMBO_SELECTION_SHAPE_INVALID'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      vendor_id_value := (selection_value ->> 'vendor_id')::uuid;
      agency_id_value := CASE
        WHEN jsonb_typeof(selection_value -> 'agency_id') = 'null' THEN NULL
        ELSE (selection_value ->> 'agency_id')::uuid
      END;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'PRICE_COMBO_SELECTION_ID_INVALID'
        USING ERRCODE = '22023';
    END;

    base_krw_value := (selection_value ->> 'base_krw')::integer;
    custom_krw_value := CASE
      WHEN jsonb_typeof(selection_value -> 'custom_krw') = 'null' THEN NULL
      ELSE (selection_value ->> 'custom_krw')::integer
    END;

    SELECT price.official_price_id
    INTO selected_price_id_value
      FROM public.v_public_prices AS price
      WHERE price.is_current IS TRUE
        AND price.vendor_id = vendor_id_value
        AND price.category = category_name
        AND price.agency_id IS NOT DISTINCT FROM agency_id_value
        AND price.price_min_krw = base_krw_value
      ORDER BY price.official_price_id
      LIMIT 1;

    IF selected_price_id_value IS NULL THEN
      RAISE EXCEPTION 'PRICE_COMBO_PUBLIC_PRICE_NOT_FOUND'
        USING ERRCODE = '22023';
    END IF;

    option_names := ARRAY[]::text[];
    FOR option_value IN
      SELECT option_row.value
      FROM jsonb_array_elements(
        selection_value -> 'selected_options'
      ) AS option_row(value)
    LOOP
      IF jsonb_typeof(option_value) IS DISTINCT FROM 'object'
         OR NOT option_value ?& ARRAY['name', 'krw']::text[]
         OR (option_value - ARRAY['name', 'krw']::text[]) <> '{}'::jsonb
         OR jsonb_typeof(option_value -> 'name') IS DISTINCT FROM 'string'
         OR length(btrim(option_value ->> 'name')) NOT BETWEEN 1 AND 200
         OR btrim(option_value ->> 'name') <> option_value ->> 'name'
         OR jsonb_typeof(option_value -> 'krw') IS DISTINCT FROM 'number'
         OR (option_value ->> 'krw') !~ '^(0|[1-9][0-9]{0,9})$'
         OR (option_value ->> 'krw')::numeric > 1000000000
      THEN
        RAISE EXCEPTION 'PRICE_COMBO_OPTION_SHAPE_INVALID'
          USING ERRCODE = '22023';
      END IF;

      option_name_value := option_value ->> 'name';
      option_krw_value := (option_value ->> 'krw')::integer;
      IF option_name_value = ANY(option_names) THEN
        RAISE EXCEPTION 'PRICE_COMBO_OPTION_DUPLICATED'
          USING ERRCODE = '22023';
      END IF;
      option_names := array_append(option_names, option_name_value);

      IF NOT EXISTS (
        SELECT 1
        FROM public.v_public_price_options AS public_option
        WHERE public_option.official_price_id = selected_price_id_value
          AND public_option.name = option_name_value
          AND public_option.price_min_krw = option_krw_value
      ) THEN
        RAISE EXCEPTION 'PRICE_COMBO_PUBLIC_OPTION_NOT_FOUND'
          USING ERRCODE = '22023';
      END IF;

      calculated_total := calculated_total + option_krw_value;
    END LOOP;

    calculated_total := calculated_total
      + COALESCE(custom_krw_value, base_krw_value);
  END LOOP;

  IF calculated_total > 2147483647
     OR p_total_krw IS DISTINCT FROM calculated_total::integer
  THEN
    RAISE EXCEPTION 'PRICE_COMBO_TOTAL_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO public.combos AS combo (
    user_id,
    name,
    selections,
    total_krw,
    idempotency_key,
    request_hash
  ) VALUES (
    p_user_id,
    btrim(p_name),
    p_selections,
    p_total_krw,
    p_idempotency_key,
    p_request_hash
  )
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING
    combo.id,
    combo.name,
    combo.selections,
    combo.total_krw,
    combo.created_at,
    combo.updated_at,
    combo.request_hash,
    false;

  IF FOUND THEN
    RETURN;
  END IF;

  SELECT combo.request_hash
  INTO existing_request_hash
  FROM public.combos AS combo
  WHERE combo.user_id = p_user_id
    AND combo.idempotency_key = p_idempotency_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_COMBO_IDEMPOTENCY_WINNER_MISSING'
      USING ERRCODE = '40001';
  END IF;
  IF existing_request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'PRICE_COMBO_IDEMPOTENCY_KEY_REUSED'
      USING
        ERRCODE = '23505',
        CONSTRAINT = 'combos_user_idempotency_unique';
  END IF;

  RETURN QUERY
  SELECT
    combo.id,
    combo.name,
    combo.selections,
    combo.total_krw,
    combo.created_at,
    combo.updated_at,
    combo.request_hash,
    true
  FROM public.combos AS combo
  WHERE combo.user_id = p_user_id
    AND combo.idempotency_key = p_idempotency_key;
END
$save_price_combo_service_v1$;

ALTER FUNCTION public.save_price_combo_service_v1(
  uuid, text, jsonb, integer, uuid, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.save_price_combo_service_v1(
  uuid, text, jsonb, integer, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_price_combo_service_v1(
  uuid, text, jsonb, integer, uuid, text
) TO service_role;

DO $price_combo_direct_write_fence_postconditions$
BEGIN
  IF has_table_privilege('authenticated', 'public.combos', 'INSERT')
     OR has_table_privilege('authenticated', 'public.combos', 'UPDATE')
     OR has_table_privilege('service_role', 'public.combos', 'INSERT')
     OR has_table_privilege('service_role', 'public.combos', 'UPDATE')
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns AS column_row
       WHERE column_row.table_schema = 'public'
         AND column_row.table_name = 'combos'
         AND (
           has_column_privilege(
             'authenticated', 'public.combos', column_row.column_name, 'INSERT'
           )
           OR has_column_privilege(
             'authenticated', 'public.combos', column_row.column_name, 'UPDATE'
           )
           OR has_column_privilege(
             'service_role', 'public.combos', column_row.column_name, 'INSERT'
           )
           OR has_column_privilege(
             'service_role', 'public.combos', column_row.column_name, 'UPDATE'
           )
         )
     )
     OR NOT has_table_privilege('authenticated', 'public.combos', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.combos', 'DELETE')
     OR has_function_privilege(
       'authenticated',
       'public.save_price_combo_service_v1(uuid,text,jsonb,integer,uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.save_price_combo_service_v1(uuid,text,jsonb,integer,uuid,text)',
       'EXECUTE'
     )
     OR (
       SELECT count(*)
       FROM pg_catalog.pg_policies AS policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'combos'
         AND policy.policyname IN (
           'price_combo_owner_select',
           'price_combo_owner_delete'
         )
         AND policy.roles = ARRAY['authenticated']::name[]
         AND policy.cmd IN ('SELECT', 'DELETE')
     ) <> 2
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies AS policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'combos'
         AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE')
         AND (
           'public'::name = ANY(policy.roles)
           OR 'authenticated'::name = ANY(policy.roles)
         )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid =
         'public.save_price_combo_service_v1(uuid,text,jsonb,integer,uuid,text)'
           ::regprocedure
         AND procedure.prosecdef
     )
     OR (
       SELECT count(*)
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = 'save_price_combo_service_v1'
     ) <> 1
  THEN
    RAISE EXCEPTION 'PRICE_COMBO_DIRECT_WRITE_FENCE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$price_combo_direct_write_fence_postconditions$;

COMMENT ON FUNCTION public.save_price_combo_service_v1(
  uuid, text, jsonb, integer, uuid, text
) IS
  'Service-only price combo save boundary. Authenticated clients retain owned SELECT/DELETE but cannot directly INSERT/UPDATE public.combos.';

COMMIT;
