BEGIN TRANSACTION READ ONLY;

WITH public_relations AS (
  SELECT relation.oid
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
)
SELECT
  (SELECT count(*) FROM public_relations) AS public_table_count,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_production_write_fence_20260717') AS existing_trigger_count,
  (SELECT count(*) FROM pg_event_trigger
    WHERE evtname = 'evt_production_write_fence_20260717') AS existing_event_trigger_count,
  (SELECT count(*) FROM pg_event_trigger
    WHERE evtname = 'evt_production_write_fence_ddl_lock_20260717')
    AS existing_ddl_start_event_trigger_count,
  (to_regprocedure('public.production_write_fence_guard_20260717()') IS NOT NULL)::integer
    AS existing_guard_function_count,
  (to_regprocedure('public.production_write_fence_attach_20260717()') IS NOT NULL)::integer
    AS existing_attach_function_count,
  (to_regprocedure('public.production_live_schema_contract_20260717()') IS NOT NULL)::integer
    AS existing_live_schema_contract_function_count,
  (to_regclass('public.production_release_lease_20260717') IS NOT NULL)::integer
    AS existing_release_lease_table_count,
  (to_regclass('cron.job') IS NOT NULL)::integer AS database_cron_catalog_present_count;

ROLLBACK;
