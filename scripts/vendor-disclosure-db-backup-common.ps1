Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'vendor-disclosure-db-current-baseline-common.ps1')

$script:VDPostExpandProjectRef = 'slrtobkksjmxgzatjyqb'
$script:VDPostExpandBaselineMigrationHead = '20260727090000'
$script:VDPostExpandMigrationHead = '20260820140000'
$script:VDPostExpandMigrationCount = 231
$script:VDPostExpandMigrationVersionsSha256 = '611f9ead63e878a220d5de8b1a7210a03797080539d21d23ebd2e4786893d993'
$script:VDPostExpandReleaseMigrationCount = 116
$script:VDPostExpandReleaseMigrationVersionsSha256 = '1c24fc4f606781a8320089695054d49b3ded7bb306a260d909e7ac5e2fe2351d'
$script:VDPostExpandAppliedSuffixCount = 84
$script:VDPostExpandAppliedSuffixVersionsSha256 = '84e91d98540f481c5c5294f063f7e26421b5de9838557a5d44cdc46a3fea35bd'
$script:VDPostExpandTableContractSha256 = 'ddf672a17f28e99fd20646a3376cee696430b8b599e10979f6d2c7fd23e5482f'
$script:VDPostExpandExpectedTables = @(
  'account_deletion_jobs',
  'account_deletion_media_manifest',
  'agencies',
  'agency_dedupe_candidates',
  'ai_interactions_log',
  'amora_action_follow_up_cards_v2',
  'amora_action_follow_up_outcomes_v2',
  'amora_actions',
  'amora_care_deliveries',
  'amora_care_jobs',
  'amora_care_scan_states',
  'amora_chat_request_claims',
  'amora_conflict_check_claims',
  'amora_couple_core_criterion_acceptances',
  'amora_couple_core_criterion_proposals',
  'amora_couple_profiles',
  'amora_first_use_action_promotions',
  'amora_first_use_action_proposal_bindings',
  'amora_mediation_acceptances',
  'amora_mediation_outcome_follow_up_cards',
  'amora_mediation_outcome_follow_up_receipts',
  'amora_mediation_private_safety_holds',
  'amora_memory_consents',
  'amora_memory_enqueue_repair_candidates',
  'amora_memory_enqueue_repair_dead_letters',
  'amora_memory_jobs',
  'amora_memory_settings',
  'amora_personalization_preferences',
  'amora_preparation_catch_up_items',
  'amora_preparation_catch_up_receipts',
  'amora_preparation_topic_message_refs',
  'amora_privacy_context_epochs',
  'amora_private_chat_delete_boundaries',
  'amora_provider_egress_grants',
  'amora_provider_runtime_control',
  'amora_saved_notes',
  'amora_shared_action_acceptances',
  'amora_shared_action_application_claims',
  'amora_shared_action_journey_mutation_receipts',
  'amora_shared_action_roster_bindings',
  'amora_today_one_preferences',
  'amora_today_one_recipient_states',
  'amora_today_one_signals',
  'amora_tool_executions',
  'amora_turn_counters',
  'amora_turn_requests',
  'booking_cancellation_receipts',
  'booking_cancellation_write_authorizations',
  'booking_intent_write_authorizations',
  'booking_outcome_write_authorizations',
  'booking_projection_jobs',
  'booking_projection_write_authorizations',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'cohort_moderation_events',
  'combos',
  'community_commands',
  'community_comment_commands',
  'community_comment_delete_receipts',
  'community_decision_answers',
  'community_decision_beta_members',
  'community_decision_outcome_publications',
  'community_decision_outcomes',
  'community_decision_publication_commands',
  'community_decision_thread_events',
  'community_decision_thread_intakes',
  'community_decision_threads',
  'community_moderation_appeal_decisions',
  'community_moderation_appeals',
  'community_moderation_cases',
  'community_moderation_command_receipts',
  'community_moderation_events',
  'community_moderation_holds',
  'community_moderation_notices',
  'community_notification_push_preferences',
  'community_poll_vote_commands',
  'community_poll_vote_quarantine',
  'community_post_delete_receipts',
  'community_post_write_commands',
  'community_reply_notifications',
  'community_responder_command_receipts',
  'community_responder_questions',
  'community_responder_requests',
  'community_responder_supply_events',
  'community_runtime_control',
  'community_runtime_control_events',
  'community_thread_evidence_selections',
  'community_upload_sessions',
  'community_viewer_control_events',
  'community_viewer_controls',
  'conversation_segments',
  'couple_change_notifications',
  'couple_invite_join_attempts',
  'couple_invite_join_runtime_state',
  'couple_invite_redemptions',
  'couple_plan_change_acceptances',
  'couple_plan_change_requests',
  'couples',
  'decision_nodes',
  'disclosure_semantic_staging',
  'events',
  'mobile_push_device_tokens',
  'notification_delivery_outbox',
  'official_agency_packages',
  'official_price_options',
  'official_prices',
  'official_review_events',
  'price_alerts',
  'price_snapshots',
  'price_upload_confirmation_events',
  'price_upload_confirmations',
  'profiles',
  'responder_capacity_slots',
  'tags',
  'vendor_alias_proposals',
  'vendor_dedupe_candidates',
  'vendor_demand_daily',
  'vendor_disclosure_bulk_approval_audits',
  'vendor_disclosure_ingest_batches',
  'vendor_disclosure_ingest_dedupe_links',
  'vendor_disclosure_ingest_identity_links',
  'vendor_disclosure_ingest_owned_identities',
  'vendor_disclosure_ingest_owned_ledger_rows',
  'vendor_disclosure_ingest_owned_rows',
  'vendor_disclosure_ingest_record_bindings',
  'vendor_disclosure_ingest_runs',
  'vendor_disclosure_ingest_storage_links',
  'vendor_disclosure_ingest_unit_provider_lineage',
  'vendor_disclosure_paid_extraction_attestations',
  'vendor_enrichment_private',
  'vendor_inquiry_handoffs',
  'vendor_reviews',
  'vendor_tags',
  'wedding_court_cases',
  'wedding_court_votes',
  'wedding_journeys',
  'wedding_payment_ledger',
  'wishlists'
)
$script:VDPostExpandVerificationReceiptKeys = @(
  'authSchemaContractSha256',
  'authUsersContractSha256',
  'backupContractId',
  'backupContractVersion',
  'backupManifestSha256',
  'backupSetId',
  'capturedAt',
  'checks',
  'containsSecrets',
  'expectedMigrationHead',
  'expectedTableContractSha256',
  'expectedTableCount',
  'expectedTables',
  'kind',
  'liveSchemaContractSha256',
  'logicalDataContractSha256',
  'migrationVersionsSha256',
  'projectRef',
  'receiptVersion',
  'release',
  'releaseCommit',
  'sourceDatabaseOid',
  'sourceDatabaseSystemIdentifier',
  'storageMetadataContractSha256',
  'storageObjectInventorySha256',
  'verifiedAt'
)
$script:VDPostExpandVerificationCheckKeys = @(
  'authDataDigestsVerified',
  'encryptedArtifactsVerified',
  'exactTableContractVerified',
  'liveSchemaDigestVerified',
  'logicalDataDigestsVerified',
  'plaintextWrittenToDisk',
  'storageDataDigestsVerified'
)
$script:VDPostExpandImplementationPaths = @(
  'apps/web/package.json',
  'apps/web/scripts/vendor-disclosure-db-backup-roundtrip.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/amora-db-backup-common.ps1',
  'scripts/provenance/amora-verifier-runtime.json',
  'scripts/vendor-disclosure-db-current-baseline-common.ps1',
  'scripts/vendor-disclosure-db-backup-common.ps1',
  'scripts/vendor-disclosure-db-backup.ps1',
  'scripts/vendor-disclosure-db-verify-backup.ps1'
)

function Get-VDPostExpandUtf8Sha256Lower {
  param([Parameter(Mandatory = $true)] [string] $Value)
  return Get-VDCurrentBaselineUtf8Sha256Lower -Value $Value
}

function Get-VDPostExpandCanonicalJsonSha256 {
  param([Parameter(Mandatory = $true)] $Value)
  return Get-VDCurrentBaselineCanonicalJsonSha256 -Value $Value
}

function Assert-VDPostExpandConstants {
  if ($script:VDPostExpandExpectedTables.Count -ne 139 -or
      @($script:VDPostExpandExpectedTables | Sort-Object -Unique).Count -ne 139 -or
      @(Compare-Object -ReferenceObject $script:VDPostExpandExpectedTables `
          -DifferenceObject @($script:VDPostExpandExpectedTables | Sort-Object)).Count -ne 0 -or
      (Get-VDCurrentBaselineTextListSha256 -Values $script:VDPostExpandExpectedTables) -ne
        $script:VDPostExpandTableContractSha256) {
    throw 'Post-expand table contract constants are inconsistent.'
  }
}

function Assert-VDPostExpandExactNames {
  param(
    [Parameter(Mandatory = $true)] [string[]] $Actual,
    [Parameter(Mandatory = $true)] [string] $Label
  )
  $names = @($Actual | Sort-Object)
  if ($names.Count -ne 139 -or
      @(Compare-Object -ReferenceObject $script:VDPostExpandExpectedTables -DifferenceObject $names).Count -ne 0) {
    throw "$Label does not contain the exact 139-table post-expand allowlist."
  }
}

function Get-VDPostExpandTargetValuesSql {
  return ($script:VDPostExpandExpectedTables | ForEach-Object { "    ('$_')" }) -join ",`n"
}

function Get-VDPostExpandSqlPrefix {
  return @"
begin transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local row_security = off;
"@
}

function Get-VDPostExpandIdentitySql {
  return @"
source_identity as materialized (
  select jsonb_build_object(
    'system_identifier', control.system_identifier::text,
    'database_name', current_database(),
    'database_oid', database.oid::text,
    'server_version_num', current_setting('server_version_num')
  ) as identity
  from pg_control_system() as control
  join pg_database as database on database.datname = current_database()
),
migration_contract as materialized (
  select count(*)::integer as migration_count,
         max(version::text) as migration_head,
         encode(sha256(convert_to(coalesce(string_agg(version::text || E'\\n', '' order by version::text), ''), 'UTF8')), 'hex') as versions_sha256,
         coalesce(jsonb_agg(version::text order by version::text), '[]'::jsonb) as versions
  from supabase_migrations.schema_migrations
),
release_migration_contract as materialized (
  select count(*)::integer as migration_count,
         encode(sha256(convert_to(coalesce(string_agg(version::text || E'\\n', '' order by version::text), ''), 'UTF8')), 'hex') as versions_sha256,
         coalesce(jsonb_agg(version::text order by version::text), '[]'::jsonb) as versions
  from supabase_migrations.schema_migrations where version::text >= '20260718120000'
),
applied_suffix_contract as materialized (
  select count(*)::integer as migration_count,
         encode(sha256(convert_to(coalesce(string_agg(version::text || E'\\n', '' order by version::text), ''), 'UTF8')), 'hex') as versions_sha256,
         coalesce(jsonb_agg(version::text order by version::text), '[]'::jsonb) as versions
  from supabase_migrations.schema_migrations where version::text > '$script:VDPostExpandBaselineMigrationHead'
),
target_relations as materialized (
  select target.name, relation.oid, relation.relkind, relation.relrowsecurity,
         relation.relforcerowsecurity, relation.relowner, relation.relacl, relation.reltuples
  from target
  left join pg_namespace as namespace on namespace.nspname = 'public'
  left join pg_class as relation on relation.relnamespace = namespace.oid and relation.relname = target.name
),
relations as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', target.name,
    'relation_oid', target.oid::text,
    'relkind', target.relkind::text,
    'has_inheritance_children', exists(select 1 from pg_inherits where inhparent = target.oid),
    'is_inheritance_child', exists(select 1 from pg_inherits where inhrelid = target.oid)
  ) order by target.name), '[]'::jsonb) as value from target_relations as target
)
"@
}

function Get-VDPostExpandMigrationFieldsSql {
  return @"
    'migration_head', (select migration_head from migration_contract),
    'migration_count', (select migration_count from migration_contract),
    'migration_versions_sha256', (select versions_sha256 from migration_contract),
    'release_migration_count', (select migration_count from release_migration_contract),
    'release_migration_versions_sha256', (select versions_sha256 from release_migration_contract),
    'applied_suffix_count', (select migration_count from applied_suffix_contract),
    'applied_suffix_versions_sha256', (select versions_sha256 from applied_suffix_contract),
"@
}

function Get-VDPostExpandServerGateSql {
  return @"
  and value->>'migration_head' = '$script:VDPostExpandMigrationHead'
  and (value->>'migration_count')::integer = $script:VDPostExpandMigrationCount
  and value->>'migration_versions_sha256' = '$script:VDPostExpandMigrationVersionsSha256'
  and (value->>'release_migration_count')::integer = $script:VDPostExpandReleaseMigrationCount
  and value->>'release_migration_versions_sha256' = '$script:VDPostExpandReleaseMigrationVersionsSha256'
  and (value->>'applied_suffix_count')::integer = $script:VDPostExpandAppliedSuffixCount
  and value->>'applied_suffix_versions_sha256' = '$script:VDPostExpandAppliedSuffixVersionsSha256'
"@
}

function New-VDPostExpandPreflightSql {
  $values = Get-VDPostExpandTargetValuesSql
  $identity = Get-VDPostExpandIdentitySql
  $migrationFields = Get-VDPostExpandMigrationFieldsSql
  $gate = Get-VDPostExpandServerGateSql
  return (Get-VDPostExpandSqlPrefix) + @"

with target(name) as (values
$values
),
$identity,
payload as materialized (
  select jsonb_build_object(
    'captured_at', statement_timestamp(),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists(select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)),
    'row_security', current_setting('row_security'),
    'source_database_identity', (select identity from source_identity),
$migrationFields
    'table_count', (select count(*) from target_relations where oid is not null),
    'estimated_total_bytes', (select coalesce(sum(pg_total_relation_size(oid)), 0) from target_relations),
    'estimated_total_rows', (select coalesce(sum(greatest(reltuples, 0))::bigint, 0) from target_relations),
    'relations', (select value from relations)
  ) as value
)
select case when (value->>'current_role_bypasses_rls')::boolean
  and value->>'row_security' = 'off'
$gate
  and (value->>'table_count')::integer = 139
  and not exists (select 1 from target_relations where oid is null or relkind <> 'r')
  then value::text else null end as payload,
  pg_column_size(value)::bigint as payload_bytes
from payload;

commit;
"@
}

function New-VDPostExpandInventorySql {
  $values = Get-VDPostExpandTargetValuesSql
  $identity = Get-VDPostExpandIdentitySql
  $migrationFields = Get-VDPostExpandMigrationFieldsSql
  $gate = Get-VDPostExpandServerGateSql
  return (Get-VDPostExpandSqlPrefix) + @"

with target(name) as (values
$values
),
$identity,
public_columns as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', relation.relname, 'ordinal_position', attribute.attnum,
    'column_name', attribute.attname, 'data_type', format_type(attribute.atttypid, attribute.atttypmod),
    'not_null', attribute.attnotnull, 'identity', attribute.attidentity::text,
    'generated', attribute.attgenerated::text,
    'default_expression', pg_get_expr(defaults.adbin, defaults.adrelid),
    'collation', case when collation.oid is null then null
      else collation_namespace.nspname || '.' || collation.collname end
  ) order by relation.relname, attribute.attnum), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_attribute as attribute on attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
  left join pg_attrdef as defaults on defaults.adrelid = relation.oid and defaults.adnum = attribute.attnum
  left join pg_collation as collation on collation.oid = attribute.attcollation and attribute.attcollation <> 0
  left join pg_namespace as collation_namespace on collation_namespace.oid = collation.collnamespace
),
portable_columns_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || relation.relname, 'ordinal_position', attribute.attnum,
    'column_name', attribute.attname, 'data_type', format_type(attribute.atttypid, attribute.atttypmod),
    'not_null', attribute.attnotnull, 'identity', attribute.attidentity::text,
    'generated', attribute.attgenerated::text,
    'default_expression', pg_get_expr(defaults.adbin, defaults.adrelid),
    'collation', case when collation.oid is null then null
      else collation_namespace.nspname || '.' || collation.collname end
  ) order by relation.relname, attribute.attnum), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_attribute as attribute on attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
  left join pg_attrdef as defaults on defaults.adrelid = relation.oid and defaults.adnum = attribute.attnum
  left join pg_collation as collation on collation.oid = attribute.attcollation and attribute.attcollation <> 0
  left join pg_namespace as collation_namespace on collation_namespace.oid = collation.collnamespace
),
public_constraints as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || relation.relname, 'name', item.conname, 'type', item.contype::text,
    'definition', pg_get_constraintdef(item.oid, false),
    'columns', coalesce((select jsonb_agg(attribute.attname order by keys.ordinality)
      from unnest(item.conkey) with ordinality as keys(attnum, ordinality)
      join pg_attribute as attribute on attribute.attrelid = relation.oid and attribute.attnum = keys.attnum), '[]'::jsonb),
    'referenced_table', case when item.confrelid = 0 then null
      else referenced_namespace.nspname || '.' || referenced_relation.relname end,
    'referenced_columns', coalesce((select jsonb_agg(attribute.attname order by keys.ordinality)
      from unnest(item.confkey) with ordinality as keys(attnum, ordinality)
      join pg_attribute as attribute on attribute.attrelid = item.confrelid and attribute.attnum = keys.attnum), '[]'::jsonb)
  ) order by relation.relname, item.conname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_constraint as item on item.conrelid = relation.oid
  left join pg_class as referenced_relation on referenced_relation.oid = item.confrelid
  left join pg_namespace as referenced_namespace on referenced_namespace.oid = referenced_relation.relnamespace
),
indexes_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || relation.relname,
    'index', index_namespace.nspname || '.' || index_relation.relname,
    'definition', pg_get_indexdef(index_relation.oid),
    'valid', index_record.indisvalid, 'ready', index_record.indisready
  ) order by relation.relname, index_relation.relname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_index as index_record on index_record.indrelid = relation.oid
  join pg_class as index_relation on index_relation.oid = index_record.indexrelid
  join pg_namespace as index_namespace on index_namespace.oid = index_relation.relnamespace
),
policies_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || relation.relname, 'name', policy.polname,
    'command', policy.polcmd::text, 'permissive', policy.polpermissive,
    'roles', (select coalesce(jsonb_agg(
      case when roles.role_oid = 0 then 'PUBLIC' else pg_get_userbyid(roles.role_oid) end
      order by case when roles.role_oid = 0 then 'PUBLIC' else pg_get_userbyid(roles.role_oid) end
    ), '[]'::jsonb) from unnest(policy.polroles) as roles(role_oid)),
    'using_expression', pg_get_expr(policy.polqual, policy.polrelid),
    'check_expression', pg_get_expr(policy.polwithcheck, policy.polrelid)
  ) order by relation.relname, policy.polname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_policy as policy on policy.polrelid = relation.oid
),
triggers_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || relation.relname, 'name', trigger_record.tgname,
    'enabled', trigger_record.tgenabled::text,
    'definition', pg_get_triggerdef(trigger_record.oid, false),
    'function_identity', function_namespace.nspname || '.' || function_record.proname
      || '(' || pg_get_function_identity_arguments(function_record.oid) || ')'
  ) order by relation.relname, trigger_record.tgname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_trigger as trigger_record on trigger_record.tgrelid = relation.oid and not trigger_record.tgisinternal
  join pg_proc as function_record on function_record.oid = trigger_record.tgfoid
  join pg_namespace as function_namespace on function_namespace.oid = function_record.pronamespace
),
tables_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', 'public.' || relation.name, 'relkind', relation.relkind::text,
    'rls', relation.relrowsecurity, 'force_rls', relation.relforcerowsecurity,
    'owner', pg_get_userbyid(relation.relowner),
    'has_inheritance_children', exists(select 1 from pg_inherits where inhparent = relation.oid),
    'is_inheritance_child', exists(select 1 from pg_inherits where inhrelid = relation.oid),
    'acl', (select coalesce(jsonb_agg(jsonb_build_object(
      'grantor', pg_get_userbyid(acl.grantor),
      'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
      'privilege', acl.privilege_type, 'grantable', acl.is_grantable
    ) order by acl.grantee, acl.privilege_type, acl.is_grantable), '[]'::jsonb)
      from aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) as acl)
  ) order by relation.name), '[]'::jsonb) as value
  from target_relations as relation
),
schema_rows as materialized (
  select namespace.nspname as schema_name, relation.relname as table_name,
         attribute.attnum as ordinal_position, attribute.attname as column_name,
         format_type(attribute.atttypid, attribute.atttypmod) as data_type,
         attribute.attnotnull as not_null, attribute.attidentity::text as identity,
         attribute.attgenerated::text as generated,
         pg_get_expr(defaults.adbin, defaults.adrelid) as default_expression,
         case when collation.oid is null then null
           else collation_namespace.nspname || '.' || collation.collname end as collation
  from pg_namespace as namespace
  join pg_class as relation on relation.relnamespace = namespace.oid and relation.relkind = 'r'
  join pg_attribute as attribute on attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
  left join pg_attrdef as defaults on defaults.adrelid = relation.oid and defaults.adnum = attribute.attnum
  left join pg_collation as collation on collation.oid = attribute.attcollation and attribute.attcollation <> 0
  left join pg_namespace as collation_namespace on collation_namespace.oid = collation.collnamespace
  where (namespace.nspname = 'auth' and relation.relname = 'users')
     or (namespace.nspname = 'storage' and relation.relname in ('buckets', 'objects'))
),
public_schema_contract as materialized (
  select jsonb_build_object(
    'tables', (select value from tables_contract),
    'columns', (select value from portable_columns_contract),
    'constraints', (select value from public_constraints),
    'indexes', (select value from indexes_contract),
    'policies', (select value from policies_contract),
    'triggers', (select value from triggers_contract)
  ) as value
),
auth_schema_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', schema_name || '.' || table_name, 'ordinal_position', ordinal_position,
    'column_name', column_name, 'data_type', data_type, 'not_null', not_null,
    'identity', identity, 'generated', generated, 'default_expression', default_expression,
    'collation', collation
  ) order by table_name, ordinal_position), '[]'::jsonb) as value
  from schema_rows where schema_name = 'auth'
),
storage_schema_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', schema_name || '.' || table_name, 'ordinal_position', ordinal_position,
    'column_name', column_name, 'data_type', data_type, 'not_null', not_null,
    'identity', identity, 'generated', generated, 'default_expression', default_expression,
    'collation', collation
  ) order by table_name, ordinal_position), '[]'::jsonb) as value
  from schema_rows where schema_name = 'storage'
),
payload as materialized (
  select jsonb_build_object(
    'captured_at', statement_timestamp(), 'current_user', current_user, 'session_user', session_user,
    'current_role_bypasses_rls', exists(select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)),
    'row_security', current_setting('row_security'), 'source_database_identity', (select identity from source_identity),
$migrationFields
    'migration_versions', (select versions from migration_contract),
    'release_migration_versions', (select versions from release_migration_contract),
    'applied_suffix_versions', (select versions from applied_suffix_contract),
    'relations', (select value from relations),
    'columns', (select value from public_columns), 'constraints', (select value from public_constraints),
    'schema_contract', (select value from public_schema_contract),
    'auth_schema_contract', (select value from auth_schema_contract),
    'storage_schema_contract', (select value from storage_schema_contract)
  ) as value
)
select case when (value->>'current_role_bypasses_rls')::boolean and value->>'row_security' = 'off'
$gate
  and not exists (select 1 from target_relations where oid is null or relkind <> 'r')
  then value::text else null end as payload,
  pg_column_size(value)::bigint as payload_bytes from payload;

commit;
"@
}

function New-VDPostExpandLogicalSql {
  $values = Get-VDPostExpandTargetValuesSql
  $identity = Get-VDPostExpandIdentitySql
  $migrationFields = Get-VDPostExpandMigrationFieldsSql
  $gate = Get-VDPostExpandServerGateSql
  $rowCtes = [Collections.Generic.List[string]]::new()
  $tableSelects = [Collections.Generic.List[string]]::new()
  for ($index = 0; $index -lt $script:VDPostExpandExpectedTables.Count; $index++) {
    $table = $script:VDPostExpandExpectedTables[$index]
    $rowCtes.Add("table_$index as materialized (select to_jsonb(row_value) as row_data from only public.$table as row_value)")
    $tableSelects.Add(@"
  select '$table'::text as name, (select jsonb_build_object(
      'row_count', count(*),
      'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
      'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
        octet_length(row_data::text)::text || ':' || row_data::text || E'\\n', '' order by row_data::text
      ), ''), 'UTF8')), 'hex')
    ) from table_$index) as value
"@.TrimEnd())
  }
  $rows = $rowCtes -join ",`n"
  $tables = $tableSelects -join "`n  union all`n"
  return (Get-VDPostExpandSqlPrefix) + @"

with target(name) as (values
$values
),
$identity,
$rows,
auth_users_rows as materialized (select to_jsonb(row_value) as row_data from only auth.users as row_value),
storage_buckets_rows as materialized (select to_jsonb(row_value) as row_data from only storage.buckets as row_value),
storage_objects_rows as materialized (select to_jsonb(row_value) as row_data from only storage.objects as row_value),
table_payloads as materialized (
$tables
),
auth_users_payload as materialized (select jsonb_build_object(
  'row_count', count(*), 'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
  'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(octet_length(row_data::text)::text || ':' || row_data::text || E'\\n', '' order by row_data::text), ''), 'UTF8')), 'hex')) as value from auth_users_rows),
storage_buckets_payload as materialized (select jsonb_build_object(
  'row_count', count(*), 'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
  'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(octet_length(row_data::text)::text || ':' || row_data::text || E'\\n', '' order by row_data::text), ''), 'UTF8')), 'hex')) as value from storage_buckets_rows),
storage_objects_payload as materialized (select jsonb_build_object(
  'row_count', count(*), 'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
  'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(octet_length(row_data::text)::text || ':' || row_data::text || E'\\n', '' order by row_data::text), ''), 'UTF8')), 'hex')) as value from storage_objects_rows),
payload as materialized (
  select jsonb_build_object(
    'captured_at', statement_timestamp(), 'current_user', current_user, 'session_user', session_user,
    'current_role_bypasses_rls', exists(select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)),
    'row_security', current_setting('row_security'), 'source_database_identity', (select identity from source_identity),
$migrationFields
    'relations', (select value from relations),
    'tables', (select jsonb_object_agg(name, value order by name) from table_payloads),
    'auth_users', (select value from auth_users_payload),
    'storage_buckets', (select value from storage_buckets_payload),
    'storage_objects', (select value from storage_objects_payload)
  ) as value
)
select case when (value->>'current_role_bypasses_rls')::boolean and value->>'row_security' = 'off'
$gate
  and not exists (select 1 from target_relations where oid is null or relkind <> 'r')
  and pg_column_size(value) <= 33554432 then value::text else null end as payload,
  pg_column_size(value)::bigint as payload_bytes from payload;

commit;
"@
}

function Assert-VDPostExpandSourceContract {
  param([Parameter(Mandatory = $true)] $Value, [Parameter(Mandatory = $true)] [string] $Label)
  foreach ($field in @('captured_at', 'current_user', 'session_user', 'current_role_bypasses_rls',
    'row_security', 'source_database_identity', 'migration_head', 'migration_count',
    'migration_versions_sha256', 'release_migration_count', 'release_migration_versions_sha256',
    'applied_suffix_count', 'applied_suffix_versions_sha256', 'relations')) {
    if (-not $Value.PSObject.Properties[$field]) { throw "$Label is missing $field." }
  }
  if (-not [bool]$Value.current_role_bypasses_rls -or [string]$Value.row_security -ne 'off' -or
      [string]$Value.migration_head -ne $script:VDPostExpandMigrationHead -or
      [int]$Value.migration_count -ne $script:VDPostExpandMigrationCount -or
      [string]$Value.migration_versions_sha256 -ne $script:VDPostExpandMigrationVersionsSha256 -or
      [int]$Value.release_migration_count -ne $script:VDPostExpandReleaseMigrationCount -or
      [string]$Value.release_migration_versions_sha256 -ne $script:VDPostExpandReleaseMigrationVersionsSha256 -or
      [int]$Value.applied_suffix_count -ne $script:VDPostExpandAppliedSuffixCount -or
      [string]$Value.applied_suffix_versions_sha256 -ne $script:VDPostExpandAppliedSuffixVersionsSha256) {
    throw "$Label role or migration ledger is not the exact post-expand Production contract."
  }
  try { [void][DateTimeOffset]::Parse([string]$Value.captured_at) }
  catch { throw "$Label captured_at is invalid." }
  Assert-HBAM2RelationShapes -Relations $Value.relations -ExpectedNames $script:VDPostExpandExpectedTables -Label $Label
  $identity = $Value.source_database_identity
  if ([string]$identity.system_identifier -notmatch '^[0-9]{10,32}$' -or
      [string]$identity.database_oid -notmatch '^[1-9][0-9]{0,9}$' -or
      [string]$identity.server_version_num -notmatch '^[1-9][0-9]{4,7}$' -or
      [string]::IsNullOrWhiteSpace([string]$identity.database_name)) {
    throw "$Label source database identity is invalid."
  }
}

function Get-VDPostExpandDataContractDigests {
  param([Parameter(Mandatory = $true)] $Inventory, [Parameter(Mandatory = $true)] $Logical)
  $portablePublicSchema = ConvertTo-VDPostExpandPortableSchemaValue -Value $Inventory.schema_contract
  $portableAuthSchema = ConvertTo-VDPostExpandPortableSchemaValue -Value $Inventory.auth_schema_contract
  $portableStorageSchema = ConvertTo-VDPostExpandPortableSchemaValue -Value $Inventory.storage_schema_contract
  $public = [ordered]@{}
  foreach ($property in @($Logical.tables.PSObject.Properties | Sort-Object Name)) {
    $public[$property.Name] = [ordered]@{
      row_count = [int64]$property.Value.row_count
      canonical_sha256 = ([string]$property.Value.canonical_sha256).ToLowerInvariant()
    }
  }
  $authUsers = [ordered]@{
    row_count = [int64]$Logical.auth_users.row_count
    canonical_sha256 = ([string]$Logical.auth_users.canonical_sha256).ToLowerInvariant()
  }
  $storageBuckets = [ordered]@{
    row_count = [int64]$Logical.storage_buckets.row_count
    canonical_sha256 = ([string]$Logical.storage_buckets.canonical_sha256).ToLowerInvariant()
  }
  $storageObjects = [ordered]@{
    row_count = [int64]$Logical.storage_objects.row_count
    canonical_sha256 = ([string]$Logical.storage_objects.canonical_sha256).ToLowerInvariant()
  }
  return [ordered]@{
    LiveSchemaContractSha256 = Get-VDPostExpandCanonicalJsonSha256 -Value ([ordered]@{
      public = $portablePublicSchema; auth = $portableAuthSchema; storage = $portableStorageSchema
    })
    LogicalDataContractSha256 = Get-VDPostExpandCanonicalJsonSha256 -Value ([ordered]@{
      public = $public; auth_users = $authUsers; storage_buckets = $storageBuckets; storage_objects = $storageObjects
    })
    AuthSchemaContractSha256 = Get-VDPostExpandCanonicalJsonSha256 -Value $portableAuthSchema
    AuthUsersContractSha256 = Get-VDPostExpandCanonicalJsonSha256 -Value $authUsers
    StorageMetadataContractSha256 = Get-VDPostExpandCanonicalJsonSha256 -Value ([ordered]@{
      schema = $portableStorageSchema; buckets = $storageBuckets
    })
    StorageObjectInventorySha256 = Get-VDPostExpandCanonicalJsonSha256 -Value $storageObjects
  }
}

function ConvertTo-VDPostExpandPortableSchemaValue {
  param($Value)
  if ($null -eq $Value) { return $null }
  if ($Value -is [Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
      if ($key -match '(?i)(^oid$|_oid$|filenode$)') { continue }
      $result[$key] = ConvertTo-VDPostExpandPortableSchemaValue -Value $Value[$key]
    }
    return $result
  }
  if ($Value -is [Management.Automation.PSCustomObject]) {
    $result = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties | Sort-Object Name)) {
      if ($property.Name -match '(?i)(^oid$|_oid$|filenode$)') { continue }
      $result[$property.Name] = ConvertTo-VDPostExpandPortableSchemaValue -Value $property.Value
    }
    return $result
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    return ,@($Value | ForEach-Object { ConvertTo-VDPostExpandPortableSchemaValue -Value $_ })
  }
  return $Value
}

function Sync-VDPostExpandParentDirectory {
  param([Parameter(Mandatory = $true)] [string] $Path)
  if ($env:OS -eq 'Windows_NT') { return }
  if (-not ('VDPostExpandNativeMethods' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VDPostExpandNativeMethods {
  [DllImport("libc", SetLastError=true)] public static extern int open(string path, int flags);
  [DllImport("libc", SetLastError=true)] public static extern int fsync(int fd);
  [DllImport("libc", SetLastError=true)] public static extern int close(int fd);
}
'@
  }
  $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
  $fd = [VDPostExpandNativeMethods]::open($directory, 0)
  if ($fd -lt 0) { throw 'Could not open the evidence parent directory for fsync.' }
  try { if ([VDPostExpandNativeMethods]::fsync($fd) -ne 0) { throw 'Could not fsync the evidence parent directory.' } }
  finally { [void][VDPostExpandNativeMethods]::close($fd) }
}

function Write-VDPostExpandDurableExclusiveBytes {
  param([Parameter(Mandatory = $true)] [string] $Path, [Parameter(Mandatory = $true)] [byte[]] $Bytes)
  $full = [IO.Path]::GetFullPath($Path)
  $parent = [IO.Path]::GetDirectoryName($full)
  if (-not (Test-Path -LiteralPath $parent -PathType Container) -or $Bytes.Length -lt 1) {
    throw 'Durable output parent or bytes are invalid.'
  }
  $created = $false
  $stream = $null
  try {
    $stream = [IO.FileStream]::new($full, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
      [IO.FileShare]::None, 65536, [IO.FileOptions]::WriteThrough)
    $created = $true
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Flush($true)
    $stream.Dispose(); $stream = $null
    Sync-VDPostExpandParentDirectory -Path $full
  } catch {
    if ($stream) { $stream.Dispose() }
    if ($created -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      Remove-Item -LiteralPath $full -Force
      Sync-VDPostExpandParentDirectory -Path $full
    }
    throw
  }
}

function Write-VDPostExpandDurableReceipt {
  param([Parameter(Mandatory = $true)] [string] $Path, [Parameter(Mandatory = $true)] [string] $Json)
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Json)
  $created = $false
  try {
    if ($bytes.Length -gt 65536) { throw 'Verification receipt exceeds 64 KiB.' }
    Write-VDPostExpandDurableExclusiveBytes -Path $Path -Bytes $bytes
    $created = $true
    Set-HBAM2PrivateFileAcl -Path $Path
  } catch {
    $failure = $_
    if ($created -and (Test-Path -LiteralPath $Path -PathType Leaf)) {
      try {
        Remove-Item -LiteralPath $Path -Force
        Sync-VDPostExpandParentDirectory -Path $Path
      } catch {
        throw [AggregateException]::new(
          'Verification receipt cleanup failed.',
          [Exception[]]@($failure.Exception, $_.Exception)
        )
      }
    }
    throw $failure
  } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Protect-VDPostExpandArtifact {
  param(
    [Parameter(Mandatory = $true)] [byte[]] $Plaintext,
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] [ValidateSet('schema-inventory.json', 'logical-data.json')] [string] $ArtifactName,
    [Parameter(Mandatory = $true)] [string] $ProjectRef,
    [Parameter(Mandatory = $true)] [string] $BackupSetId
  )
  if ($Plaintext.Length -lt 1 -or $Plaintext.Length -gt $script:HBAM2MaximumPayloadBytes) {
    throw 'Backup plaintext exceeds the configured size limit.'
  }
  $masterKey = New-Object byte[] 64; $encKey = New-Object byte[] 32
  $macKey = New-Object byte[] 32; $iv = New-Object byte[] 16
  $ciphertext = $null; $envelope = $null; $tag = $null; $artifactBytes = $null
  $protectedKey = $null; $entropy = $null
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $rng.GetBytes($masterKey); $rng.GetBytes($iv)
    [Buffer]::BlockCopy($masterKey, 0, $encKey, 0, 32)
    [Buffer]::BlockCopy($masterKey, 32, $macKey, 0, 32)
    $aes.KeySize = 256; $aes.BlockSize = 128; $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7; $aes.Key = $encKey; $aes.IV = $iv
    $encryptor = $aes.CreateEncryptor()
    try { $ciphertext = $encryptor.TransformFinalBlock($Plaintext, 0, $Plaintext.Length) }
    finally { $encryptor.Dispose() }
    $envelope = Join-HBAM2ByteArrays -Arrays @($script:HBAM2Magic, [byte[]]@($script:HBAM2Version),
      ([Guid]::ParseExact($BackupSetId, 'D')).ToByteArray(), $iv,
      [BitConverter]::GetBytes([int64]$Plaintext.Length), $ciphertext)
    $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
    try { $tag = $hmac.ComputeHash($envelope) } finally { $hmac.Dispose() }
    $artifactBytes = Join-HBAM2ByteArrays -Arrays @($envelope, $tag)
    $entropy = Get-HBAM2Entropy -ProjectRef $ProjectRef -ArtifactName $ArtifactName -BackupSetId $BackupSetId
    $protectedKey = [Security.Cryptography.ProtectedData]::Protect(
      $masterKey, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $artifactPath = Join-Path $Directory "$ArtifactName.hbam2"
    $keyPath = Join-Path $Directory "$ArtifactName.key.dpapi"
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($artifactPath)) -ne [IO.Path]::GetFullPath($Directory).TrimEnd('\') -or
        [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($keyPath)) -ne [IO.Path]::GetFullPath($Directory).TrimEnd('\')) {
      throw 'Backup artifact path escaped its staging directory.'
    }
    Write-VDPostExpandDurableExclusiveBytes -Path $artifactPath -Bytes $artifactBytes
    Write-VDPostExpandDurableExclusiveBytes -Path $keyPath -Bytes $protectedKey
    Set-HBAM2PrivateFileAcl -Path $artifactPath; Set-HBAM2PrivateFileAcl -Path $keyPath
    return [ordered]@{
      backup_set_id = $BackupSetId; artifact = [IO.Path]::GetFileName($artifactPath); key = [IO.Path]::GetFileName($keyPath)
      plaintext_sha256 = (Get-HBAM2Sha256Hex -Bytes $Plaintext).ToLowerInvariant()
      encrypted_sha256 = (Get-HBAM2Sha256Hex -Bytes $artifactBytes).ToLowerInvariant()
      key_sha256 = (Get-HBAM2Sha256Hex -Bytes $protectedKey).ToLowerInvariant()
      plaintext_bytes = $Plaintext.Length; encrypted_bytes = $artifactBytes.Length
    }
  } finally {
    $rng.Dispose(); $aes.Dispose()
    [Array]::Clear($masterKey, 0, $masterKey.Length)
    [Array]::Clear($encKey, 0, $encKey.Length)
    [Array]::Clear($macKey, 0, $macKey.Length)
    [Array]::Clear($iv, 0, $iv.Length)
    if ($ciphertext) { [Array]::Clear($ciphertext, 0, $ciphertext.Length) }
    if ($envelope) { [Array]::Clear($envelope, 0, $envelope.Length) }
    if ($tag) { [Array]::Clear($tag, 0, $tag.Length) }
    if ($artifactBytes) { [Array]::Clear($artifactBytes, 0, $artifactBytes.Length) }
    if ($protectedKey) { [Array]::Clear($protectedKey, 0, $protectedKey.Length) }
    if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
  }
}

function New-VDPostExpandImplementationFence {
  param([Parameter(Mandatory = $true)] [string] $RepoRoot, [Parameter(Mandatory = $true)] [string] $ExpectedCommit)
  $streams = [Collections.Generic.List[IO.FileStream]]::new(); $files = [ordered]@{}; $gitBlobs = [ordered]@{}
  try {
    foreach ($relative in $script:VDPostExpandImplementationPaths) {
      $path = [IO.Path]::GetFullPath((Join-Path $RepoRoot $relative.Replace('/', '\')))
      $prefix = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
      if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $path -PathType Leaf) -or
          ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Post-expand implementation path escaped, linked, or is missing.'
      }
      $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $streams.Add($stream)
      $files[$relative] = (Get-HBAM2StreamSha256Hex -Stream $stream).ToLowerInvariant()
      $gitBlobs[$relative] = (Get-HBAM2GitBlobSha256Hex -RepoRoot $RepoRoot -Commit $ExpectedCommit -RelativePath $relative).ToLowerInvariant()
      if ($files[$relative] -ne $gitBlobs[$relative]) { throw 'Post-expand implementation differs from the exact release commit.' }
    }
    return [pscustomobject]@{ Streams = $streams; Provenance = [ordered]@{ git_commit = $ExpectedCommit; files = $files; git_blobs = $gitBlobs } }
  } catch { foreach ($stream in $streams) { $stream.Dispose() }; throw }
}

function Assert-VDPostExpandImplementationFence {
  param([Parameter(Mandatory = $true)] $Fence, $Recorded)
  if ($Fence.Streams.Count -ne $script:VDPostExpandImplementationPaths.Count) { throw 'Post-expand implementation fence is incomplete.' }
  for ($index = 0; $index -lt $script:VDPostExpandImplementationPaths.Count; $index++) {
    $relative = $script:VDPostExpandImplementationPaths[$index]
    $hash = (Get-HBAM2StreamSha256Hex -Stream $Fence.Streams[$index]).ToLowerInvariant()
    if ($hash -ne [string]$Fence.Provenance.files[$relative] -or
        ($Recorded -and ($hash -ne [string](Get-HBAM2ObjectPropertyValue -Value $Recorded.files -Name $relative) -or
          $hash -ne [string](Get-HBAM2ObjectPropertyValue -Value $Recorded.git_blobs -Name $relative)))) {
      throw 'Post-expand implementation changed or differs from recorded provenance.'
    }
  }
}

function Close-VDPostExpandImplementationFence {
  param($Fence)
  if ($Fence -and $Fence.Streams) { foreach ($stream in $Fence.Streams) { $stream.Dispose() } }
}

function Assert-VDPostExpandExactPushedGitState {
  param(
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [string] $ExpectedCommit,
    [Parameter(Mandatory = $true)] [string] $ExpectedOrigin,
    [Parameter(Mandatory = $true)] [string] $RemoteRef
  )
  # The delegated exact fence executes: git ls-remote --exit-code origin refs/heads/<branch>.
  Assert-VDCurrentBaselineExactPushedGitState -RepoRoot $RepoRoot -ExpectedCommit $ExpectedCommit `
    -ExpectedOrigin $ExpectedOrigin -RemoteRef $RemoteRef
}

function Assert-VDPostExpandVerificationReceipt {
  param([Parameter(Mandatory = $true)] $Receipt)
  $actual = @($Receipt.Keys | ForEach-Object { [string]$_ } | Sort-Object)
  $expected = @($script:VDPostExpandVerificationReceiptKeys | Sort-Object)
  if ($actual.Count -ne $expected.Count -or @(Compare-Object $expected $actual).Count -ne 0 -or
      [int]$Receipt.receiptVersion -ne 2 -or [string]$Receipt.kind -ne 'successor-post-expand-backup-verification-v2' -or
      [bool]$Receipt.containsSecrets -or [int]$Receipt.expectedTableCount -ne 139 -or
      [string]$Receipt.sourceDatabaseOid -notmatch '^[1-9][0-9]{0,9}$' -or
      [string]$Receipt.sourceDatabaseSystemIdentifier -notmatch '^[0-9]{10,32}$') {
    throw 'Post-expand verification receipt has an invalid exact public schema.'
  }
  $checkNames = @($Receipt.checks.Keys | ForEach-Object { [string]$_ } | Sort-Object)
  if (@(Compare-Object @($script:VDPostExpandVerificationCheckKeys | Sort-Object) $checkNames).Count -ne 0 -or
      [bool]$Receipt.checks.plaintextWrittenToDisk -or
      @($script:VDPostExpandVerificationCheckKeys | Where-Object { $_ -ne 'plaintextWrittenToDisk' -and -not [bool]$Receipt.checks[$_] }).Count -ne 0) {
    throw 'Post-expand verification checks are not exact.'
  }
  foreach ($name in @('backupManifestSha256', 'expectedTableContractSha256', 'migrationVersionsSha256',
    'liveSchemaContractSha256', 'logicalDataContractSha256', 'authSchemaContractSha256',
    'authUsersContractSha256', 'storageMetadataContractSha256', 'storageObjectInventorySha256')) {
    if ([string]$Receipt[$name] -notmatch '^[a-f0-9]{64}$') { throw "Post-expand receipt digest $name is invalid." }
  }
  $json = $Receipt | ConvertTo-Json -Depth 20 -Compress
  if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536 -or
      $json -match '(?i)"(access[_-]?token|authorization|password|service[_-]?role[_-]?key|api[_-]?key)"\s*:') {
    throw 'Post-expand receipt is oversized or secret-bearing.'
  }
}

Assert-VDPostExpandConstants
