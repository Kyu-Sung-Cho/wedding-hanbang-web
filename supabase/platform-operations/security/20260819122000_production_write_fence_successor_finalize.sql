BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';DO $bind_exact_evidence$
BEGIN
PERFORM pg_catalog.set_config('hanbang.finalizer.project_ref','__HB_FINALIZER_PROJECT_REF__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.database_system_identifier','__HB_FINALIZER_DATABASE_SYSTEM_IDENTIFIER__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.release_id','__HB_FINALIZER_RELEASE_ID__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.release_commit','__HB_FINALIZER_RELEASE_COMMIT__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.lease_owner_id','__HB_FINALIZER_LEASE_OWNER_UUID__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.outcome_path_sha256','__HB_FINALIZER_OUTCOME_PATH_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.outcome_receipt_sha256','__HB_FINALIZER_OUTCOME_RECEIPT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.deployment_id','__HB_FINALIZER_DEPLOYMENT_ID__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.deployment_url_sha256','__HB_FINALIZER_DEPLOYMENT_URL_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.deployment_receipt_sha256','__HB_FINALIZER_DEPLOYMENT_RECEIPT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.canary_receipt_sha256','__HB_FINALIZER_CANARY_RECEIPT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_backup_receipt_sha256','__HB_FINALIZER_POST_EXPAND_BACKUP_RECEIPT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_backup_reverification_sha256','__HB_FINALIZER_POST_EXPAND_BACKUP_REVERIFICATION_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.recovery_assurance_receipt_sha256','__HB_FINALIZER_RECOVERY_ASSURANCE_RECEIPT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_backup_set_id','__HB_FINALIZER_POST_EXPAND_BACKUP_SET_ID__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_backup_manifest_sha256','__HB_FINALIZER_POST_EXPAND_BACKUP_MANIFEST_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_table_contract_sha256','__HB_FINALIZER_POST_EXPAND_TABLE_CONTRACT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_migration_contract_sha256','__HB_FINALIZER_POST_EXPAND_MIGRATION_CONTRACT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_live_schema_contract_sha256','__HB_FINALIZER_POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.post_expand_logical_data_contract_sha256','__HB_FINALIZER_POST_EXPAND_LOGICAL_DATA_CONTRACT_SHA256__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.canary_verified_at','__HB_FINALIZER_CANARY_VERIFIED_AT__',true
);PERFORM pg_catalog.set_config('hanbang.finalizer.canary_expires_at','__HB_FINALIZER_CANARY_EXPIRES_AT__',true
);END
$bind_exact_evidence$;DO $session_and_evidence_precondition$
DECLARE
project_ref text := pg_catalog.current_setting('hanbang.finalizer.project_ref',true
);database_system_identifier text := pg_catalog.current_setting('hanbang.finalizer.database_system_identifier',true
);release_id text := pg_catalog.current_setting('hanbang.finalizer.release_id',true
);release_commit text := pg_catalog.current_setting('hanbang.finalizer.release_commit',true
);lease_owner_id text := pg_catalog.current_setting('hanbang.finalizer.lease_owner_id',true
);outcome_path_sha256 text := pg_catalog.current_setting('hanbang.finalizer.outcome_path_sha256',true
);outcome_receipt_sha256 text := pg_catalog.current_setting('hanbang.finalizer.outcome_receipt_sha256',true
);deployment_id text := pg_catalog.current_setting('hanbang.finalizer.deployment_id',true
);deployment_url_sha256 text := pg_catalog.current_setting('hanbang.finalizer.deployment_url_sha256',true
);deployment_receipt_sha256 text := pg_catalog.current_setting('hanbang.finalizer.deployment_receipt_sha256',true
);canary_receipt_sha256 text := pg_catalog.current_setting('hanbang.finalizer.canary_receipt_sha256',true
);post_expand_backup_receipt_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_receipt_sha256',true
);post_expand_backup_reverification_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_reverification_sha256',true
);recovery_assurance_receipt_sha256 text := pg_catalog.current_setting('hanbang.finalizer.recovery_assurance_receipt_sha256',true
);post_expand_backup_set_id text := pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_set_id',true
);post_expand_backup_manifest_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_manifest_sha256',true
);post_expand_table_contract_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_table_contract_sha256',true
);post_expand_migration_contract_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_migration_contract_sha256',true
);post_expand_live_schema_contract_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_live_schema_contract_sha256',true
);post_expand_logical_data_contract_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_logical_data_contract_sha256',true
);canary_verified_at_text text := pg_catalog.current_setting('hanbang.finalizer.canary_verified_at',true
);canary_expires_at_text text := pg_catalog.current_setting('hanbang.finalizer.canary_expires_at',true
);canary_verified_at timestamp with time zone;canary_expires_at timestamp with time zone;BEGIN
IF current_user<>'postgres'
OR session_user<>'postgres'
OR NULLIF(pg_catalog.current_setting('request.jwt.claims',true),'')
IS NOT NULL
OR NULLIF(pg_catalog.current_setting('request.jwt.claim.role',true),'')
IS NOT NULL
OR auth.role() IS NOT NULL THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_POSTGRES_SESSION_REQUIRED';END IF;IF project_ref !~ '^[a-z0-9]{20}$'
OR database_system_identifier !~ '^[0-9]{10,32}$'
OR (SELECT system_identifier::text
FROM pg_catalog.pg_control_system())
<> database_system_identifier
OR release_id !~ '^[a-z0-9][a-z0-9-]{2,80}$'
OR release_commit !~ '^[a-f0-9]{40}$'
OR lease_owner_id !~
'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
OR outcome_path_sha256 !~ '^[a-f0-9]{64}$'
OR outcome_receipt_sha256 !~ '^[a-f0-9]{64}$'
OR deployment_id !~ '^dpl_[A-Za-z0-9]{16,64}$'
OR deployment_url_sha256 !~ '^[a-f0-9]{64}$'
OR deployment_receipt_sha256 !~ '^[a-f0-9]{64}$'
OR canary_receipt_sha256 !~ '^[a-f0-9]{64}$'
OR post_expand_backup_receipt_sha256 !~ '^[a-f0-9]{64}$'
OR post_expand_backup_reverification_sha256 !~ '^[a-f0-9]{64}$'
OR recovery_assurance_receipt_sha256 !~ '^[a-f0-9]{64}$'
OR post_expand_backup_set_id !~
'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
OR post_expand_backup_manifest_sha256 !~ '^[a-f0-9]{64}$'
OR post_expand_table_contract_sha256 <>
'ddf672a17f28e99fd20646a3376cee696430b8b599e10979f6d2c7fd23e5482f'
OR post_expand_migration_contract_sha256 <>
'807cacbc3a0df7f488908c3cd619879d389dd277bda37f97032d06fb960a44bf'
OR post_expand_live_schema_contract_sha256 !~ '^[a-f0-9]{64}$'
OR post_expand_logical_data_contract_sha256 !~ '^[a-f0-9]{64}$'
OR canary_verified_at_text !~
'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
OR canary_expires_at_text !~
'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_EVIDENCE_FORMAT_INVALID';END IF;canary_verified_at := canary_verified_at_text::timestamp with time zone;canary_expires_at := canary_expires_at_text::timestamp with time zone;IF canary_expires_at<>canary_verified_at+interval '15 minutes'
OR canary_verified_at > statement_timestamp()+interval '1 minute'
OR canary_expires_at <= statement_timestamp() THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_EVIDENCE_STALE';END IF;END
$session_and_evidence_precondition$;DO $serialize_against_all_ddl$
BEGIN
PERFORM pg_catalog.pg_advisory_xact_lock(7523370826071712::bigint);END
$serialize_against_all_ddl$;DO $lock_all_public_tables$
DECLARE
relation_list text;BEGIN
SELECT pg_catalog.string_agg(pg_catalog.format('%I.%I',namespace.nspname,relation.relname),',' ORDER BY relation.oid
)
INTO relation_list
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
ON namespace.oid=relation.relnamespace
WHERE namespace.nspname='public'
AND relation.relkind IN ('r','p');IF relation_list IS NOT NULL THEN
EXECUTE 'LOCK TABLE '||relation_list||' IN SHARE ROW EXCLUSIVE MODE';END IF;END
$lock_all_public_tables$;DO $post_expand_live_contract_precondition$
DECLARE
expected_live_schema_contract_sha256 text := pg_catalog.current_setting('hanbang.finalizer.post_expand_live_schema_contract_sha256',true
);actual_live_schema_contract_sha256 text;BEGIN
IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_RELEASE_LEDGER_MISSING';END IF;LOCK TABLE supabase_migrations.schema_migrations
IN SHARE ROW EXCLUSIVE MODE;IF pg_catalog.to_regprocedure('public.production_successor_live_schema_contract_20260819()'
) IS NULL THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_LIVE_SCHEMA_CONTRACT_MISMATCH';END IF;actual_live_schema_contract_sha256 := pg_catalog.lower(public.production_successor_live_schema_contract_20260819()
);IF actual_live_schema_contract_sha256 IS DISTINCT FROM
expected_live_schema_contract_sha256 THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_LIVE_SCHEMA_CONTRACT_MISMATCH';END IF;END
$post_expand_live_contract_precondition$;DO $exact_owner_and_fence_precondition$
DECLARE
project_ref text := pg_catalog.current_setting('hanbang.finalizer.project_ref',true
);expected_release_id text := pg_catalog.current_setting('hanbang.finalizer.release_id',true
);expected_release_commit text := pg_catalog.current_setting('hanbang.finalizer.release_commit',true
);expected_lease_owner_id uuid := pg_catalog.current_setting('hanbang.finalizer.lease_owner_id',true
)::uuid;expected_outcome_path_sha256 text := pg_catalog.current_setting('hanbang.finalizer.outcome_path_sha256',true
);public_table_count bigint;exact_public_trigger_count bigint;all_named_trigger_count bigint;guard_trigger_count bigint;attach_event_trigger_count bigint;named_function_count bigint;active_cron_jobs bigint := 0;lease_column_contract text[];removed_lease_count bigint;BEGIN
SELECT pg_catalog.count(*)
INTO public_table_count
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
ON namespace.oid=relation.relnamespace
WHERE namespace.nspname='public'
AND relation.relkind IN ('r','p');SELECT pg_catalog.count(*)
INTO exact_public_trigger_count
FROM pg_catalog.pg_trigger AS trigger_record
JOIN pg_catalog.pg_class AS relation
ON relation.oid=trigger_record.tgrelid
JOIN pg_catalog.pg_namespace AS namespace
ON namespace.oid=relation.relnamespace
WHERE namespace.nspname='public'
AND relation.relkind IN ('r','p')
AND trigger_record.tgname='trg_production_write_fence_20260717'
AND NOT trigger_record.tgisinternal
AND trigger_record.tgenabled='O'
AND trigger_record.tgtype=62
AND trigger_record.tgfoid =
'public.production_write_fence_guard_20260717()'::regprocedure;SELECT pg_catalog.count(*)
INTO all_named_trigger_count
FROM pg_catalog.pg_trigger AS trigger_record
WHERE trigger_record.tgname='trg_production_write_fence_20260717';SELECT pg_catalog.count(*)
INTO guard_trigger_count
FROM pg_catalog.pg_trigger AS trigger_record
WHERE trigger_record.tgfoid=pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()'
);SELECT pg_catalog.count(*)
INTO attach_event_trigger_count
FROM pg_catalog.pg_event_trigger AS event_trigger_record
WHERE event_trigger_record.evtfoid=pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()'
);SELECT pg_catalog.count(*)
INTO named_function_count
FROM pg_catalog.pg_proc AS procedure_record
JOIN pg_catalog.pg_namespace AS namespace
ON namespace.oid=procedure_record.pronamespace
WHERE namespace.nspname='public'
AND procedure_record.proname IN ('production_write_fence_guard_20260717','production_write_fence_attach_20260717','production_live_schema_contract_20260717','production_successor_canonical_json_20260819','production_successor_live_schema_contract_20260819'
);SELECT pg_catalog.array_agg(attribute.attname||':'
|| pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)
|| ':'||attribute.attnotnull::text
ORDER BY attribute.attnum
)
INTO lease_column_contract
FROM pg_catalog.pg_attribute AS attribute
WHERE attribute.attrelid=pg_catalog.to_regclass('public.production_release_lease_20260717'
)
AND attribute.attnum > 0
AND NOT attribute.attisdropped;IF pg_catalog.to_regclass('cron.job') IS NOT NULL THEN
EXECUTE 'SELECT count(*) FROM cron.job WHERE active' INTO active_cron_jobs;END IF;IF project_ref IS NULL
OR public_table_count=0
OR exact_public_trigger_count<>public_table_count
OR all_named_trigger_count<>public_table_count
OR guard_trigger_count<>public_table_count
OR attach_event_trigger_count<>2
OR active_cron_jobs<>0
OR pg_catalog.to_regclass('public.production_release_lease_20260717'
) IS NULL
OR (SELECT pg_catalog.count(*)
FROM public.production_release_lease_20260717)<>1
OR (SELECT pg_catalog.count(*)
FROM public.production_release_lease_20260717
WHERE singleton=true
AND release_id=expected_release_id
AND release_commit=expected_release_commit
AND owner_id=expected_lease_owner_id
AND outcome_path_sha256=expected_outcome_path_sha256
AND phase='deployment-canary')<>1
OR lease_column_contract IS DISTINCT FROM ARRAY[
'singleton:boolean:true','release_id:text:true','release_commit:text:true','owner_id:uuid:true','outcome_path_sha256:text:true','phase:text:true','claimed_at:timestamp with time zone:true','updated_at:timestamp with time zone:true'
]::text[]
OR (SELECT pg_catalog.array_agg(constraint_record.conname ORDER BY constraint_record.conname)
FROM pg_catalog.pg_constraint AS constraint_record
WHERE constraint_record.conrelid =
'public.production_release_lease_20260717'::regclass
AND constraint_record.contype IN ('p','c'))
IS DISTINCT FROM ARRAY[
'production_release_lease_20260717_commit_format','production_release_lease_20260717_outcome_hash_format','production_release_lease_20260717_phase','production_release_lease_20260717_pkey','production_release_lease_20260717_release_id_format','production_release_lease_20260717_singleton_true','production_release_lease_20260717_time_order'
]::name[]
OR (SELECT pg_catalog.count(*)
FROM pg_catalog.pg_policy
WHERE polrelid =
'public.production_release_lease_20260717'::regclass)<>0
OR NOT EXISTS (SELECT 1
FROM pg_catalog.pg_class AS relation
WHERE relation.oid =
'public.production_release_lease_20260717'::regclass
AND relation.relkind='r'
AND relation.relrowsecurity
AND relation.relforcerowsecurity
AND pg_catalog.pg_get_userbyid(relation.relowner)='postgres'
)
OR pg_catalog.has_table_privilege('anon','public.production_release_lease_20260717','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
)
OR pg_catalog.has_table_privilege('authenticated','public.production_release_lease_20260717','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
)
OR pg_catalog.has_table_privilege('service_role','public.production_release_lease_20260717','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
)
OR named_function_count<>5
OR pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()'
) IS NULL
OR pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()'
) IS NULL
OR pg_catalog.to_regprocedure('public.production_live_schema_contract_20260717()'
) IS NULL
OR pg_catalog.pg_get_userbyid((SELECT procedure_record.proowner
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()'
)
))<>'postgres'
OR (SELECT procedure_record.prosecdef
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()'
))
OR (SELECT pg_catalog.md5(procedure_record.prosrc)
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()'
))<>'e9dc644c0ad98b742bde0e3c83c26f93'
OR (SELECT procedure_record.proconfig
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()'
)) IS DISTINCT FROM ARRAY['search_path=pg_catalog, auth']::text[]
OR pg_catalog.pg_get_userbyid((SELECT procedure_record.proowner
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()'
)
))<>'postgres'
OR (SELECT procedure_record.prosecdef
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()'
))
OR (SELECT pg_catalog.md5(procedure_record.prosrc)
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()'
))<>'9053c6d394854777b878bd219203b06a'
OR (SELECT procedure_record.proconfig
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()'
)) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
OR pg_catalog.has_function_privilege('anon','public.production_write_fence_guard_20260717()','EXECUTE'
)
OR pg_catalog.has_function_privilege('authenticated','public.production_write_fence_guard_20260717()','EXECUTE'
)
OR pg_catalog.has_function_privilege('service_role','public.production_write_fence_guard_20260717()','EXECUTE'
)
OR pg_catalog.has_function_privilege('anon','public.production_write_fence_attach_20260717()','EXECUTE'
)
OR pg_catalog.has_function_privilege('authenticated','public.production_write_fence_attach_20260717()','EXECUTE'
)
OR pg_catalog.has_function_privilege('service_role','public.production_write_fence_attach_20260717()','EXECUTE'
)
OR pg_catalog.pg_get_userbyid((SELECT procedure_record.proowner
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_live_schema_contract_20260717()'
)
))<>'postgres'
OR (SELECT procedure_record.prokind<>'f'
OR procedure_record.prosecdef
OR procedure_record.provolatile<>'s'
OR procedure_record.proparallel<>'u'
OR procedure_record.proisstrict
OR procedure_record.proleakproof
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_live_schema_contract_20260717()'
))
OR (SELECT language_definition.lanname
FROM pg_catalog.pg_proc AS procedure_record
JOIN pg_catalog.pg_language AS language_definition
ON language_definition.oid=procedure_record.prolang
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_live_schema_contract_20260717()'
))<>'sql'
OR (SELECT pg_catalog.pg_get_function_result(procedure_record.oid)
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_live_schema_contract_20260717()'
))<>'text'
OR (SELECT pg_catalog.md5(procedure_record.prosrc)
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_live_schema_contract_20260717()'
))<>'96ee93c897faa81bae68c8c65e29610b'
OR (SELECT procedure_record.proconfig
FROM pg_catalog.pg_proc AS procedure_record
WHERE procedure_record.oid=pg_catalog.to_regprocedure('public.production_live_schema_contract_20260717()'
)) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
OR pg_catalog.has_function_privilege('anon','public.production_live_schema_contract_20260717()','EXECUTE'
)
OR pg_catalog.has_function_privilege('authenticated','public.production_live_schema_contract_20260717()','EXECUTE'
)
OR pg_catalog.has_function_privilege('service_role','public.production_live_schema_contract_20260717()','EXECUTE'
)
OR (SELECT pg_catalog.array_agg(procedure_record.proname||':' ||
pg_catalog.md5(procedure_record.prosrc)||':' ||
pg_catalog.pg_get_userbyid(procedure_record.proowner)||':' ||
language_definition.lanname||':' ||
procedure_record.prokind::text||':' ||
procedure_record.prosecdef::text||':' ||
procedure_record.provolatile::text||':' ||
procedure_record.proparallel::text||':' ||
procedure_record.proisstrict::text||':' ||
procedure_record.proleakproof::text||':' ||
pg_catalog.array_to_string(procedure_record.proconfig,',')||':' ||
pg_catalog.pg_get_function_result(procedure_record.oid)||':' ||
pg_catalog.has_function_privilege('anon',procedure_record.oid,'EXECUTE'
)::text||':' ||
pg_catalog.has_function_privilege('authenticated',procedure_record.oid,'EXECUTE'
)::text||':' ||
pg_catalog.has_function_privilege('service_role',procedure_record.oid,'EXECUTE'
)::text
ORDER BY procedure_record.proname
)
FROM pg_catalog.pg_proc AS procedure_record
JOIN pg_catalog.pg_namespace AS namespace
ON namespace.oid=procedure_record.pronamespace
JOIN pg_catalog.pg_language AS language_definition
ON language_definition.oid=procedure_record.prolang
WHERE namespace.nspname='public'
AND procedure_record.proname IN ('production_successor_canonical_json_20260819','production_successor_live_schema_contract_20260819'
)) IS DISTINCT FROM ARRAY[
'production_successor_canonical_json_20260819:2ca15a7556f9e5cd0338bd90795c4e71:postgres:plpgsql:f:false:i:s:true:false:search_path=pg_catalog:text:false:false:false','production_successor_live_schema_contract_20260819:7e3df3bebf5babb0b0035a4e202c0b3f:postgres:sql:f:false:s:u:false:false:search_path=pg_catalog, public:text:false:false:false'
]::text[]
OR (SELECT pg_catalog.count(*)
FROM pg_catalog.pg_event_trigger AS event_trigger_record
WHERE event_trigger_record.evtname =
'evt_production_write_fence_20260717')<>1
OR NOT EXISTS (SELECT 1
FROM pg_catalog.pg_event_trigger AS event_trigger_record
WHERE event_trigger_record.evtname =
'evt_production_write_fence_20260717'
AND event_trigger_record.evtevent='ddl_command_end'
AND event_trigger_record.evtenabled='O'
AND event_trigger_record.evttags IS NULL
AND pg_catalog.pg_get_userbyid(event_trigger_record.evtowner)='postgres'
AND event_trigger_record.evtfoid =
'public.production_write_fence_attach_20260717()'::regprocedure
)
OR (SELECT pg_catalog.count(*)
FROM pg_catalog.pg_event_trigger AS event_trigger_record
WHERE event_trigger_record.evtname =
'evt_production_write_fence_ddl_lock_20260717')<>1
OR NOT EXISTS (SELECT 1
FROM pg_catalog.pg_event_trigger AS event_trigger_record
WHERE event_trigger_record.evtname =
'evt_production_write_fence_ddl_lock_20260717'
AND event_trigger_record.evtevent='ddl_command_start'
AND event_trigger_record.evtenabled='O'
AND event_trigger_record.evttags IS NULL
AND pg_catalog.pg_get_userbyid(event_trigger_record.evtowner)='postgres'
AND event_trigger_record.evtfoid =
'public.production_write_fence_attach_20260717()'::regprocedure
)
OR pg_catalog.to_regprocedure('public.production_storage_writes_allowed()'
) IS NULL
OR public.production_storage_writes_allowed() IS DISTINCT FROM false THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_PRECONDITION_FAILED';END IF;DELETE FROM public.production_release_lease_20260717 AS lease
WHERE lease.singleton=true
AND lease.release_id=expected_release_id
AND lease.release_commit=expected_release_commit
AND lease.owner_id=expected_lease_owner_id
AND lease.outcome_path_sha256=expected_outcome_path_sha256
AND lease.phase='deployment-canary';GET DIAGNOSTICS removed_lease_count=ROW_COUNT;IF removed_lease_count<>1
OR EXISTS (SELECT 1 FROM public.production_release_lease_20260717) THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_EXACT_OWNER_DELETE_FAILED';END IF;END
$exact_owner_and_fence_precondition$;DROP EVENT TRIGGER evt_production_write_fence_ddl_lock_20260717;DROP EVENT TRIGGER evt_production_write_fence_20260717;DO $remove_exact_current_table_triggers$
DECLARE
relation_record record;BEGIN
FOR relation_record IN
SELECT relation.oid::regclass AS relation_name
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
ON namespace.oid=relation.relnamespace
WHERE namespace.nspname='public'
AND relation.relkind IN ('r','p')
ORDER BY relation.oid
LOOP
EXECUTE pg_catalog.format('DROP TRIGGER trg_production_write_fence_20260717 ON %s',relation_record.relation_name
);END LOOP;END
$remove_exact_current_table_triggers$;DROP FUNCTION public.production_write_fence_attach_20260717();DROP TABLE public.production_release_lease_20260717;DROP FUNCTION public.production_successor_live_schema_contract_20260819();DROP FUNCTION public.production_successor_canonical_json_20260819(jsonb);DROP FUNCTION public.production_live_schema_contract_20260717();DROP FUNCTION public.production_write_fence_guard_20260717();DO $atomic_postcondition$
BEGIN
IF pg_catalog.to_regclass('public.production_release_lease_20260717'
) IS NOT NULL
OR EXISTS (SELECT 1
FROM pg_catalog.pg_trigger AS trigger_record
WHERE trigger_record.tgname='trg_production_write_fence_20260717'
)
OR EXISTS (SELECT 1
FROM pg_catalog.pg_event_trigger AS event_trigger_record
WHERE event_trigger_record.evtname IN ('evt_production_write_fence_ddl_lock_20260717','evt_production_write_fence_20260717'
)
)
OR EXISTS (SELECT 1
FROM pg_catalog.pg_proc AS procedure_record
JOIN pg_catalog.pg_namespace AS namespace
ON namespace.oid=procedure_record.pronamespace
WHERE namespace.nspname='public'
AND procedure_record.proname IN ('production_write_fence_guard_20260717','production_write_fence_attach_20260717','production_live_schema_contract_20260717','production_successor_canonical_json_20260819','production_successor_live_schema_contract_20260819'
)
)
OR public.production_storage_writes_allowed() IS DISTINCT FROM true THEN
RAISE EXCEPTION 'PRODUCTION_WRITE_FENCE_FINALIZER_POSTCONDITION_FAILED';END IF;END
$atomic_postcondition$;SELECT
1::integer AS production_write_fence_finalize_count,pg_catalog.current_setting('hanbang.finalizer.project_ref',true
) AS target_project_ref,pg_catalog.current_setting('hanbang.finalizer.database_system_identifier',true
) AS target_database_system_identifier,pg_catalog.current_setting('hanbang.finalizer.release_id',true
) AS release_id,pg_catalog.current_setting('hanbang.finalizer.release_commit',true
) AS release_commit,pg_catalog.current_setting('hanbang.finalizer.lease_owner_id',true
) AS lease_owner_id,pg_catalog.current_setting('hanbang.finalizer.outcome_receipt_sha256',true
) AS outcome_receipt_sha256,pg_catalog.current_setting('hanbang.finalizer.deployment_id',true
) AS deployment_id,pg_catalog.current_setting('hanbang.finalizer.deployment_url_sha256',true
) AS deployment_url_sha256,pg_catalog.current_setting('hanbang.finalizer.deployment_receipt_sha256',true
) AS deployment_receipt_sha256,pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_receipt_sha256',true
) AS post_expand_backup_receipt_sha256,pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_reverification_sha256',true
) AS post_expand_backup_reverification_sha256,pg_catalog.current_setting('hanbang.finalizer.recovery_assurance_receipt_sha256',true
) AS recovery_assurance_receipt_sha256,pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_set_id',true
) AS post_expand_backup_set_id,pg_catalog.current_setting('hanbang.finalizer.post_expand_backup_manifest_sha256',true
) AS post_expand_backup_manifest_sha256,pg_catalog.current_setting('hanbang.finalizer.post_expand_table_contract_sha256',true
) AS post_expand_table_contract_sha256,pg_catalog.current_setting('hanbang.finalizer.post_expand_migration_contract_sha256',true
) AS post_expand_migration_contract_sha256,pg_catalog.current_setting('hanbang.finalizer.post_expand_live_schema_contract_sha256',true
) AS post_expand_live_schema_contract_sha256,pg_catalog.current_setting('hanbang.finalizer.post_expand_logical_data_contract_sha256',true
) AS post_expand_logical_data_contract_sha256,pg_catalog.current_setting('hanbang.finalizer.canary_receipt_sha256',true
) AS canary_receipt_sha256,pg_catalog.current_setting('hanbang.finalizer.canary_verified_at',true
) AS canary_verified_at,pg_catalog.current_setting('hanbang.finalizer.canary_expires_at',true
) AS canary_expires_at,1::integer AS production_storage_writes_allowed_count;COMMIT;
