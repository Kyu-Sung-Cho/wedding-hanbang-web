BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precondition$
BEGIN
  IF current_user <> 'postgres'
     OR session_user <> 'postgres'
     OR NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '') IS NOT NULL
     OR NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), '') IS NOT NULL
     OR auth.role() IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_ROLLBACK_POSTGRES_SESSION_REQUIRED';
  END IF;

  IF pg_catalog.to_regclass('public.production_release_lease_20260717') IS NULL
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
     OR (SELECT procedure_record.prokind <> 'f'
               OR procedure_record.prosecdef
               OR procedure_record.provolatile <> 'i'
               OR NOT procedure_record.proisstrict
               OR procedure_record.proparallel <> 's'
               OR procedure_record.proleakproof
               OR pg_catalog.md5(procedure_record.prosrc)
                    <> '2ca15a7556f9e5cd0338bd90795c4e71'
               OR procedure_record.proconfig IS DISTINCT FROM
                    ARRAY['search_path=pg_catalog']::text[]
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_canonical_json_20260819(jsonb)'
          ))
     OR (SELECT procedure_record.prokind <> 'f'
               OR procedure_record.prosecdef
               OR procedure_record.provolatile <> 's'
               OR procedure_record.proisstrict
               OR procedure_record.proparallel <> 'u'
               OR procedure_record.proleakproof
               OR pg_catalog.md5(procedure_record.prosrc)
                    <> '7e3df3bebf5babb0b0035a4e202c0b3f'
               OR procedure_record.proconfig IS DISTINCT FROM
                    ARRAY['search_path=pg_catalog, public']::text[]
           FROM pg_catalog.pg_proc AS procedure_record
          WHERE procedure_record.oid = pg_catalog.to_regprocedure(
            'public.production_successor_live_schema_contract_20260819()'
          ))
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
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_ROLLBACK_PRECONDITION_FAILED';
  END IF;
END
$precondition$;

DROP FUNCTION public.production_successor_live_schema_contract_20260819();
DROP FUNCTION public.production_successor_canonical_json_20260819(jsonb);

DO $postcondition$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.production_successor_live_schema_contract_20260819()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.production_successor_canonical_json_20260819(jsonb)'
     ) IS NOT NULL
     OR pg_catalog.to_regclass('public.production_release_lease_20260717') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.production_write_fence_guard_20260717()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.production_write_fence_attach_20260717()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.production_live_schema_contract_20260717()'
     ) IS NULL
     OR (SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_event_trigger AS event_trigger_record
          WHERE event_trigger_record.evtname IN (
            'evt_production_write_fence_ddl_lock_20260717',
            'evt_production_write_fence_20260717'
          )
            AND event_trigger_record.evtenabled = 'O'
            AND event_trigger_record.evtfoid =
              'public.production_write_fence_attach_20260717()'::pg_catalog.regprocedure
         ) <> 2 THEN
    RAISE EXCEPTION 'PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_ROLLBACK_POSTCONDITION_FAILED';
  END IF;
END
$postcondition$;

COMMIT;
