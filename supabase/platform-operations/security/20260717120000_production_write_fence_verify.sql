BEGIN TRANSACTION READ ONLY;

DO $verification$
DECLARE
  public_table_count bigint;
  exact_trigger_count bigint;
  named_function_count bigint;
  active_cron_jobs bigint := 0;
BEGIN
  SELECT count(*) INTO public_table_count
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p');

  SELECT count(*) INTO exact_trigger_count
  FROM pg_trigger AS trigger_record
  JOIN pg_class AS relation ON relation.oid = trigger_record.tgrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND trigger_record.tgname = 'trg_production_write_fence_20260717'
    AND NOT trigger_record.tgisinternal
    AND trigger_record.tgenabled = 'O'
    AND trigger_record.tgtype = 62
    AND trigger_record.tgfoid =
      'public.production_write_fence_guard_20260717()'::regprocedure;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job WHERE active' INTO active_cron_jobs;
  END IF;

  SELECT count(*) INTO named_function_count
  FROM pg_proc AS procedure_record
  JOIN pg_namespace AS namespace
    ON namespace.oid = procedure_record.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure_record.proname IN (
      'production_write_fence_guard_20260717',
      'production_write_fence_attach_20260717',
      'production_live_schema_contract_20260717'
    );

  IF public_table_count = 0
     OR exact_trigger_count <> public_table_count
     OR active_cron_jobs <> 0
     OR to_regprocedure('public.production_write_fence_guard_20260717()') IS NULL
     OR to_regprocedure('public.production_write_fence_attach_20260717()') IS NULL
     OR to_regprocedure('public.production_live_schema_contract_20260717()') IS NULL
     OR named_function_count <> 3
     OR to_regclass('public.production_release_lease_20260717') IS NULL
     OR (SELECT count(*) FROM public.production_release_lease_20260717) > 1
     OR EXISTS (
       SELECT 1
       FROM public.production_release_lease_20260717
       WHERE NOT singleton
          OR release_id !~ '^[a-z0-9][a-z0-9-]{2,80}$'
          OR release_commit !~ '^[a-f0-9]{40}$'
          OR outcome_path_sha256 !~ '^[a-f0-9]{64}$'
          OR phase NOT IN ('claimed', 'awaiting-post-push', 'deployment-canary')
          OR updated_at < claimed_at
     )
     OR (SELECT count(*)
         FROM pg_policy
         WHERE polrelid = 'public.production_release_lease_20260717'::regclass) <> 0
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class
       WHERE oid = 'public.production_release_lease_20260717'::regclass
         AND relkind = 'r'
         AND relrowsecurity
         AND relforcerowsecurity
         AND pg_get_userbyid(relowner) = 'postgres'
     )
     OR has_table_privilege('anon',
       'public.production_release_lease_20260717', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated',
       'public.production_release_lease_20260717', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role',
       'public.production_release_lease_20260717', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR (SELECT count(*)
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'production_release_lease_20260717') <> 8
     OR (SELECT array_agg(conname ORDER BY conname)
         FROM pg_constraint
         WHERE conrelid = 'public.production_release_lease_20260717'::regclass
           AND contype IN ('p', 'c'))
       IS DISTINCT FROM ARRAY[
         'production_release_lease_20260717_commit_format',
         'production_release_lease_20260717_outcome_hash_format',
         'production_release_lease_20260717_phase',
         'production_release_lease_20260717_pkey',
         'production_release_lease_20260717_release_id_format',
         'production_release_lease_20260717_singleton_true',
         'production_release_lease_20260717_time_order'
       ]::name[]
     OR pg_get_userbyid(
       (SELECT proowner FROM pg_proc
        WHERE oid = to_regprocedure('public.production_write_fence_guard_20260717()'))
     ) <> 'postgres'
     OR (SELECT prosecdef FROM pg_proc
         WHERE oid = to_regprocedure('public.production_write_fence_guard_20260717()'))
     OR (SELECT md5(prosrc) FROM pg_proc
         WHERE oid = to_regprocedure('public.production_write_fence_guard_20260717()'))
       <> 'e9dc644c0ad98b742bde0e3c83c26f93'
     OR (SELECT proconfig FROM pg_proc
         WHERE oid = to_regprocedure('public.production_write_fence_guard_20260717()'))
       IS DISTINCT FROM ARRAY['search_path=pg_catalog, auth']::text[]
     OR pg_get_userbyid(
       (SELECT proowner FROM pg_proc
        WHERE oid = to_regprocedure('public.production_write_fence_attach_20260717()'))
     ) <> 'postgres'
     OR (SELECT prosecdef FROM pg_proc
         WHERE oid = to_regprocedure('public.production_write_fence_attach_20260717()'))
     OR (SELECT md5(prosrc) FROM pg_proc
         WHERE oid = to_regprocedure('public.production_write_fence_attach_20260717()'))
       <> '9053c6d394854777b878bd219203b06a'
     OR (SELECT proconfig FROM pg_proc
         WHERE oid = to_regprocedure('public.production_write_fence_attach_20260717()'))
       IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
     OR has_function_privilege(
       'anon', 'public.production_write_fence_guard_20260717()', 'EXECUTE')
     OR has_function_privilege(
       'authenticated', 'public.production_write_fence_guard_20260717()', 'EXECUTE')
     OR has_function_privilege(
       'service_role', 'public.production_write_fence_guard_20260717()', 'EXECUTE')
     OR has_function_privilege(
       'anon', 'public.production_write_fence_attach_20260717()', 'EXECUTE')
     OR has_function_privilege(
       'authenticated', 'public.production_write_fence_attach_20260717()', 'EXECUTE')
     OR has_function_privilege(
       'service_role', 'public.production_write_fence_attach_20260717()', 'EXECUTE')
     OR pg_get_userbyid(
       (SELECT proowner FROM pg_proc
        WHERE oid = to_regprocedure('public.production_live_schema_contract_20260717()'))
     ) <> 'postgres'
     OR (SELECT prokind <> 'f'
               OR prosecdef
               OR provolatile <> 's'
               OR proparallel <> 'u'
               OR proisstrict
               OR proleakproof
          FROM pg_proc
         WHERE oid = to_regprocedure('public.production_live_schema_contract_20260717()'))
     OR (SELECT language_definition.lanname
           FROM pg_proc AS procedure_record
           JOIN pg_language AS language_definition
             ON language_definition.oid = procedure_record.prolang
          WHERE procedure_record.oid = to_regprocedure(
            'public.production_live_schema_contract_20260717()'
          )) <> 'sql'
     OR (SELECT pg_get_function_result(oid) FROM pg_proc
         WHERE oid = to_regprocedure('public.production_live_schema_contract_20260717()'))
       <> 'text'
     OR (SELECT md5(prosrc) FROM pg_proc
         WHERE oid = to_regprocedure('public.production_live_schema_contract_20260717()'))
       <> '96ee93c897faa81bae68c8c65e29610b'
     OR (SELECT proconfig FROM pg_proc
         WHERE oid = to_regprocedure('public.production_live_schema_contract_20260717()'))
       IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR has_function_privilege(
       'anon', 'public.production_live_schema_contract_20260717()', 'EXECUTE')
     OR has_function_privilege(
       'authenticated', 'public.production_live_schema_contract_20260717()', 'EXECUTE')
     OR has_function_privilege(
       'service_role', 'public.production_live_schema_contract_20260717()', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_event_trigger
       WHERE evtname = 'evt_production_write_fence_20260717'
         AND (
           evtevent <> 'ddl_command_end'
           OR evtenabled <> 'O'
           OR evtfoid <>
             'public.production_write_fence_attach_20260717()'::regprocedure
           OR pg_get_userbyid(evtowner) <> 'postgres'
         )
     )
     OR (SELECT count(*) FROM pg_event_trigger
         WHERE evtname = 'evt_production_write_fence_20260717') <> 1
     OR EXISTS (
       SELECT 1
       FROM pg_event_trigger
       WHERE evtname = 'evt_production_write_fence_ddl_lock_20260717'
         AND (
           evtevent <> 'ddl_command_start'
           OR evtenabled <> 'O'
           OR evtfoid <>
             'public.production_write_fence_attach_20260717()'::regprocedure
           OR pg_get_userbyid(evtowner) <> 'postgres'
         )
     )
     OR (SELECT count(*) FROM pg_event_trigger
         WHERE evtname = 'evt_production_write_fence_ddl_lock_20260717') <> 1
     OR (SELECT count(*) FROM pg_event_trigger
         WHERE evtfoid =
           'public.production_write_fence_attach_20260717()'::regprocedure) <> 2
  THEN
    RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_VERIFY_FAILED';
  END IF;
END
$verification$;

SELECT
  1 AS production_write_fence_verified_count,
  (SELECT count(*)
   FROM pg_class AS relation
   JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind IN ('r', 'p')) AS production_write_fence_table_count,
  (SELECT count(*)
   FROM public.production_release_lease_20260717)
    AS production_release_lease_row_count,
  upper(public.production_live_schema_contract_20260717())
    AS production_live_schema_contract_sha256;

ROLLBACK;
