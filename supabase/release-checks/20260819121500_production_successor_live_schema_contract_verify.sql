BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  public_table_count bigint;
  exact_trigger_count bigint;
BEGIN
  IF current_user <> 'postgres'
     OR session_user <> 'postgres'
     OR NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '') IS NOT NULL
     OR NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), '') IS NOT NULL
     OR auth.role() IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_VERIFY_POSTGRES_SESSION_REQUIRED';
  END IF;

  SELECT pg_catalog.count(*) INTO public_table_count
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind IN ('r', 'p');
  SELECT pg_catalog.count(*) INTO exact_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind IN ('r', 'p')
     AND trigger_record.tgname = 'trg_production_write_fence_20260717'
     AND NOT trigger_record.tgisinternal
     AND trigger_record.tgenabled = 'O'
     AND trigger_record.tgtype = 62
     AND trigger_record.tgfoid =
       'public.production_write_fence_guard_20260717()'::pg_catalog.regprocedure;

  IF public_table_count = 0
     OR exact_trigger_count <> public_table_count
     OR pg_catalog.to_regclass('public.production_release_lease_20260717') IS NULL
     OR (SELECT pg_catalog.md5(procedure_record.prosrc)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_write_fence_guard_20260717()'
          )) <> 'e9dc644c0ad98b742bde0e3c83c26f93'
     OR (SELECT pg_catalog.md5(procedure_record.prosrc)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_write_fence_attach_20260717()'
          )) <> '9053c6d394854777b878bd219203b06a'
     OR (SELECT pg_catalog.md5(procedure_record.prosrc)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_live_schema_contract_20260717()'
          )) <> '96ee93c897faa81bae68c8c65e29610b'
     OR (SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_event_trigger AS event_trigger_record
          WHERE event_trigger_record.evtname IN (
            'evt_production_write_fence_ddl_lock_20260717',
            'evt_production_write_fence_20260717'
          )
            AND event_trigger_record.evtenabled = 'O'
            AND event_trigger_record.evtfoid =
              'public.production_write_fence_attach_20260717()'::pg_catalog.regprocedure
            AND pg_catalog.pg_get_userbyid(event_trigger_record.evtowner) = 'postgres'
         ) <> 2
     OR pg_catalog.pg_get_userbyid((SELECT procedure_record.proowner
       FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid = pg_catalog.to_regprocedure(
        'public.production_successor_canonical_json_20260819(jsonb)'
      ))) <> 'postgres'
     OR (SELECT procedure_record.prokind <> 'f'
               OR procedure_record.prosecdef
               OR procedure_record.provolatile <> 'i'
               OR NOT procedure_record.proisstrict
               OR procedure_record.proparallel <> 's'
               OR procedure_record.proleakproof
               OR pg_catalog.md5(procedure_record.prosrc)
                    <> '2ca15a7556f9e5cd0338bd90795c4e71'
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_canonical_json_20260819(jsonb)'
          ))
     OR (SELECT language_definition.lanname
           FROM pg_catalog.pg_proc AS procedure_record
           JOIN pg_catalog.pg_language AS language_definition
             ON language_definition.oid = procedure_record.prolang
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_canonical_json_20260819(jsonb)'
          )) <> 'plpgsql'
     OR (SELECT pg_catalog.pg_get_function_result(procedure_record.oid)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_canonical_json_20260819(jsonb)'
          )) <> 'text'
     OR (SELECT procedure_record.proconfig
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_canonical_json_20260819(jsonb)'
          )) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR pg_catalog.pg_get_userbyid((SELECT procedure_record.proowner
       FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid = pg_catalog.to_regprocedure(
        'public.production_successor_live_schema_contract_20260819()'
      ))) <> 'postgres'
     OR (SELECT procedure_record.prokind <> 'f'
               OR procedure_record.prosecdef
               OR procedure_record.provolatile <> 's'
               OR procedure_record.proisstrict
               OR procedure_record.proparallel <> 'u'
               OR procedure_record.proleakproof
               OR pg_catalog.md5(procedure_record.prosrc)
                    <> '7e3df3bebf5babb0b0035a4e202c0b3f'
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_live_schema_contract_20260819()'
          ))
     OR (SELECT language_definition.lanname
           FROM pg_catalog.pg_proc AS procedure_record
           JOIN pg_catalog.pg_language AS language_definition
             ON language_definition.oid = procedure_record.prolang
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_live_schema_contract_20260819()'
          )) <> 'sql'
     OR (SELECT pg_catalog.pg_get_function_result(procedure_record.oid)
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_live_schema_contract_20260819()'
          )) <> 'text'
     OR (SELECT procedure_record.proconfig
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_live_schema_contract_20260819()'
          )) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
     OR pg_catalog.has_function_privilege(
       'anon', 'public.production_successor_canonical_json_20260819(jsonb)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.production_successor_canonical_json_20260819(jsonb)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.production_successor_canonical_json_20260819(jsonb)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.production_successor_live_schema_contract_20260819()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.production_successor_live_schema_contract_20260819()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.production_successor_live_schema_contract_20260819()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_VERIFY_FAILED';
  END IF;
END
$verify$;

SELECT
  true AS verified,
  1::integer AS production_successor_live_schema_contract_verify_count;

ROLLBACK;
