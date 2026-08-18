BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
DECLARE
  v_shared_function oid := pg_catalog.to_regprocedure(
    'public.update_updated_at_column()'
  );
  v_successor_function oid := pg_catalog.to_regprocedure(
    'public.set_decision_nodes_updated_at()'
  );
  v_shared_definition text;
  v_trigger_count integer;
  v_trigger_function oid;
  v_trigger_qualifier text;
BEGIN
  IF pg_catalog.to_regclass('public.decision_nodes') IS NULL
     OR v_shared_function IS NULL THEN
    RAISE EXCEPTION 'AMORA_DECISION_NODE_UPDATED_AT_PREREQUISITE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
    INTO v_shared_definition
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_roles AS role ON role.oid = procedure.proowner
  WHERE procedure.oid = v_shared_function
    AND role.rolname = 'postgres'
    AND NOT procedure.prosecdef
    AND procedure.pronargs = 0
    AND procedure.prorettype = 'pg_catalog.trigger'::regtype;

  SELECT pg_catalog.count(*)::integer
    INTO v_trigger_count
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.decision_nodes'::regclass
    AND trigger.tgname = 'set_decision_nodes_updated_at'
    AND NOT trigger.tgisinternal;

  SELECT trigger.tgfoid, trigger.tgqual::text
    INTO v_trigger_function, v_trigger_qualifier
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.decision_nodes'::regclass
    AND trigger.tgname = 'set_decision_nodes_updated_at'
    AND trigger.tgenabled = 'O'
    AND trigger.tgtype = 19
    AND NOT trigger.tgisinternal;

  IF v_shared_definition IS NULL
     OR v_shared_definition !~* 'new[.]updated_at[[:space:]]*:?=[[:space:]]*(pg_catalog[.])?now[(][)]'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.decision_nodes'::regclass
         AND attribute.attname = 'updated_at'
         AND attribute.atttypid = 'pg_catalog.timestamptz'::regtype
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.decision_nodes'::regclass
         AND attribute.attname = 'source'
         AND attribute.atttypid = 'pg_catalog.text'::regtype
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.decision_nodes'::regclass
         AND attribute.attname = 'decision_type'
         AND attribute.atttypid = 'pg_catalog.text'::regtype
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.decision_nodes'::regclass
         AND attribute.attname = 'metadata'
         AND attribute.atttypid = 'pg_catalog.jsonb'::regtype
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
     )
     OR v_trigger_count IS DISTINCT FROM 1
     OR v_trigger_function IS NULL
     OR (
       v_trigger_function IS DISTINCT FROM v_shared_function
       AND (
         v_successor_function IS NULL
         OR v_trigger_function IS DISTINCT FROM v_successor_function
       )
     )
     OR v_trigger_qualifier IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_DECISION_NODE_UPDATED_AT_PREREQUISITE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END
$preconditions$;

CREATE OR REPLACE FUNCTION public.set_decision_nodes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.source IS NOT DISTINCT FROM 'vendor_booking'
     AND NEW.decision_type IS NOT DISTINCT FROM 'completed'
     AND COALESCE(NEW.metadata, '{}'::jsonb) ->> 'hook'
       IS NOT DISTINCT FROM 'booking_outcome' THEN
    NEW.updated_at := pg_catalog.clock_timestamp();
  ELSE
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.set_decision_nodes_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_decision_nodes_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER set_decision_nodes_updated_at ON public.decision_nodes;
CREATE TRIGGER set_decision_nodes_updated_at
  BEFORE UPDATE ON public.decision_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_decision_nodes_updated_at();

DO $postconditions$
DECLARE
  v_function oid := pg_catalog.to_regprocedure(
    'public.set_decision_nodes_updated_at()'
  );
  v_definition text;
  v_owner name;
  v_security_definer boolean;
  v_config text[];
  v_argument_count smallint;
  v_return_type oid;
  v_named_trigger_count integer;
BEGIN
  SELECT
    pg_catalog.pg_get_functiondef(procedure.oid),
    role.rolname,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.pronargs,
    procedure.prorettype
  INTO
    v_definition,
    v_owner,
    v_security_definer,
    v_config,
    v_argument_count,
    v_return_type
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_roles AS role ON role.oid = procedure.proowner
  WHERE procedure.oid = v_function;

  SELECT pg_catalog.count(*)::integer
    INTO v_named_trigger_count
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.decision_nodes'::regclass
    AND trigger.tgname = 'set_decision_nodes_updated_at'
    AND NOT trigger.tgisinternal;

  IF v_function IS NULL
     OR v_definition IS NULL
     OR pg_catalog.lower(v_definition)
       NOT LIKE '%new.source is not distinct from ''vendor_booking''%'
     OR pg_catalog.lower(v_definition)
       NOT LIKE '%new.decision_type is not distinct from ''completed''%'
     OR pg_catalog.lower(v_definition)
       NOT LIKE '%coalesce(new.metadata, ''{}''::jsonb) ->> ''hook''%'
     OR pg_catalog.lower(v_definition)
       NOT LIKE '%is not distinct from ''booking_outcome''%'
     OR pg_catalog.lower(v_definition)
       NOT LIKE '%new.updated_at := pg_catalog.clock_timestamp()%'
     OR pg_catalog.lower(v_definition)
       NOT LIKE '%new.updated_at := pg_catalog.now()%'
     OR v_owner IS DISTINCT FROM 'postgres'::name
     OR v_security_definer IS DISTINCT FROM false
     OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR v_argument_count IS DISTINCT FROM 0::smallint
     OR v_return_type IS DISTINCT FROM 'pg_catalog.trigger'::regtype
     OR pg_catalog.has_function_privilege(
       'anon', v_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', v_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', v_function, 'EXECUTE'
     )
     OR v_named_trigger_count IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.decision_nodes'::regclass
         AND trigger.tgname = 'set_decision_nodes_updated_at'
         AND trigger.tgfoid = v_function
         AND trigger.tgenabled = 'O'
         AND trigger.tgtype = 19
         AND trigger.tgqual IS NULL
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION 'AMORA_DECISION_NODE_UPDATED_AT_POSTCONDITION_FAILED'
      USING
        ERRCODE = '55000',
        DETAIL = pg_catalog.format(
          'definition=%s owner=%s security_definer=%s config=%s args=%s return=%s trigger_count=%s',
          v_definition,
          v_owner,
          v_security_definer,
          v_config,
          v_argument_count,
          v_return_type,
          v_named_trigger_count
        );
  END IF;
END
$postconditions$;

COMMIT;
