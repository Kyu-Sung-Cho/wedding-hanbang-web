import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const EXPECTED_TABLES = [
  'account_deletion_jobs',
  'account_deletion_media_manifest',
  'ai_interactions_log',
  'amora_actions',
  'amora_care_deliveries',
  'amora_care_jobs',
  'amora_care_scan_states',
  'amora_chat_request_claims',
  'amora_conflict_check_claims',
  'amora_couple_profiles',
  'amora_mediation_acceptances',
  'amora_memory_consents',
  'amora_memory_jobs',
  'amora_memory_settings',
  'amora_tool_executions',
  'amora_turn_counters',
  'amora_turn_requests',
  'booking_projection_jobs',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'community_upload_sessions',
  'couples',
  'decision_nodes',
  'profiles',
  'vendor_reviews',
  'wedding_journeys',
]

const EXPECTED_RELEASE_MIGRATIONS = [
  '20260716090000',
  '20260716091000',
  '20260716092000',
  '20260716093000',
  '20260716094000',
  '20260716095000',
  '20260716096000',
  '20260716097000',
  '20260716098000',
  '20260716099000',
  '20260716100000',
  '20260716102000',
  '20260716103000',
  '20260716104000',
  '20260716105000',
  '20260716106000',
  '20260716107000',
  '20260716108000',
  '20260716109000',
  '20260716110000',
  '20260716111000',
  '20260716112000',
  '20260716113000',
  '20260716114000',
  '20260716115000',
  '20260716116000',
  '20260716117000',
]

const EXPECTED_CARE_POLICY_INDEXES = [
  'amora_care_deliveries_user_send_day_uidx',
  'amora_care_jobs_active_age_idx',
  'amora_care_jobs_scan_status_idx',
]

const EXPECTED_CARE_POLICY_FUNCTIONS = [
  'amora_care_delivery_clock()',
  'amora_care_is_delivery_window(timestamp with time zone)',
  'amora_care_next_delivery_window(timestamp with time zone)',
  'claim_amora_care_email_delivery(uuid,uuid)',
  'claim_amora_care_email_delivery_pre_delivery_policy(uuid,uuid)',
  'enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)',
  'enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)',
  'get_amora_care_queue_stats(date)',
  'prepare_amora_care_job(uuid,uuid,boolean)',
  'prepare_amora_care_job_pre_delivery_policy(uuid,uuid,boolean)',
]

const EXPECTED_EXPAND_FUNCTIONS = [
  'begin_account_deletion_job(uuid,text)',
  'checkpoint_account_deletion_media(uuid,uuid,text,text)',
  'claim_account_deletion_job(uuid,uuid,timestamp with time zone)',
  'apply_booking_progress_projection(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)',
  'apply_journey_progress_item_patch(uuid,text,jsonb)',
  'checkpoint_amora_conflict_check(uuid,text,uuid,jsonb)',
  'claim_amora_conflict_check(uuid,text,uuid)',
  'claim_amora_tool_execution(uuid,text,text,text,text)',
  'claim_amora_tool_execution(uuid,text,text,text,text,integer)',
  'claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)',
  'claim_booking_projection_job(uuid,integer)',
  'claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)',
  'complete_amora_conflict_check(uuid,text,uuid,jsonb)',
  'enqueue_booking_projection_job()',
  'fail_amora_conflict_check(uuid,text,uuid,text)',
  'finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
  'finalize_amora_conflict_verify_receipt(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
  'finalize_amora_provider_call_receipt(uuid,uuid,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
  'finalize_account_deletion_job(uuid,uuid)',
  'finish_booking_projection_job(uuid,bigint,uuid,boolean,text,integer)',
  'get_booking_projection_queue_stats()',
  'get_wedding_settings_snapshot(uuid)',
  'patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)',
  'patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)',
  'prepare_account_deletion_auth_delete(uuid,uuid)',
  'prepare_amora_provider_call_receipt(uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
  'reconcile_amora_chat_response(uuid,text,uuid,text,uuid)',
  'release_account_deletion_job(uuid,uuid,text)',
  'replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
  'resume_account_deletion_after_manual_review(uuid)',
  'reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)',
  'reserve_amora_turn(uuid,integer,integer)',
  'reserve_amora_turn(uuid,integer,integer,bigint,bigint)',
  'retry_booking_projection_job(uuid)',
  'mark_account_deletion_manual_review(uuid,uuid,text)',
]

function fail(message) {
  throw new Error(message)
}

async function readGuardedSelect(path, label) {
  if (!path) fail(`${label} SQL path is required`)
  const sql = await readFile(path, 'utf8')
  if (!sql.trim()) fail(`${label} SQL is empty`)
  const guarded = sql.match(
    /^\s*begin transaction read only;\s*set local statement_timeout = '120s';\s*set local lock_timeout = '5s';\s*set local row_security = off;\s*([\s\S]*?)\s*commit;\s*$/i,
  )
  if (!guarded) fail(`${label} SQL is missing its exact read-only timeout guard`)
  return guarded[1]
}

function parsePayload(result, label) {
  if (result.rows.length !== 1) fail(`${label} SQL did not return exactly one row`)
  const payloadText = String(result.rows[0]?.payload ?? '')
  if (!payloadText) fail(`${label} SQL returned an empty payload`)
  return { payload: JSON.parse(payloadText), payloadText }
}

function assertPolicyContracts(payload, label) {
  const carePolicy = payload.care_delivery_policy
  if (
    carePolicy?.migration_version !== '20260716095000' ||
    carePolicy?.migration_present !== true ||
    carePolicy?.column !== 'amora_care_deliveries.send_day' ||
    carePolicy?.column_present !== true ||
    carePolicy?.constraint !== 'profiles_care_consent_state_valid' ||
    carePolicy?.constraint_present !== true ||
    carePolicy?.indexes_present !== true ||
    carePolicy?.functions_present !== true ||
    JSON.stringify(carePolicy?.indexes) !== JSON.stringify(EXPECTED_CARE_POLICY_INDEXES) ||
    JSON.stringify(carePolicy?.functions) !== JSON.stringify(EXPECTED_CARE_POLICY_FUNCTIONS)
  ) {
    fail(`${label} SQL did not bind the exact 0950 care delivery policy contract`)
  }
  const memoryDeferral = payload.memory_budget_deferral
  if (
    memoryDeferral?.migration_version !== '20260716098000' ||
    memoryDeferral?.migration_present !== true ||
    memoryDeferral?.function !== 'defer_amora_memory_job(uuid,integer,integer,text)' ||
    memoryDeferral?.function_present !== true ||
    memoryDeferral?.service_role_execute !== true ||
    memoryDeferral?.anon_execute !== false ||
    memoryDeferral?.authenticated_execute !== false ||
    memoryDeferral?.service_only !== true
  ) {
    fail(`${label} SQL did not bind the service-only 0980 memory deferral contract`)
  }
  const releaseMigrations = payload.release_migrations
  if (
    releaseMigrations?.baseline_head !== '20260715210000' ||
    releaseMigrations?.expected_head !== '20260716117000' ||
    releaseMigrations?.actual_head !== '20260716117000' ||
    releaseMigrations?.exact !== true ||
    JSON.stringify(releaseMigrations?.expected_versions) !==
      JSON.stringify(EXPECTED_RELEASE_MIGRATIONS) ||
    JSON.stringify(releaseMigrations?.actual_versions) !==
      JSON.stringify(EXPECTED_RELEASE_MIGRATIONS)
  ) {
    fail(`${label} SQL did not bind the exact 27-migration release ledger`)
  }
}

const logicalSelectSql = await readGuardedSelect(process.argv[2], 'logical backup')
const preflightSelectSql = await readGuardedSelect(process.argv[3], 'preflight')
const inventorySelectSql = await readGuardedSelect(process.argv[4], 'inventory')
const onlyScanCount = (logicalSelectSql.match(/\bfrom\s+only\s+public\./gi) ?? []).length
if (onlyScanCount !== EXPECTED_TABLES.length) {
  fail('logical backup SQL must read every target through FROM ONLY')
}

const db = new PGlite()
try {
  async function executeReadOnly(selectSql) {
    await db.exec('begin transaction read only')
    await db.exec("set local statement_timeout = '120s'")
    await db.exec("set local lock_timeout = '5s'")
    await db.exec('set local row_security = off')
    try {
      const result = await db.query(selectSql)
      await db.exec('commit')
      return result
    } catch (error) {
      await db.exec('rollback')
      throw error
    }
  }

  // PGlite 0.5 does not bundle pgcrypto. This compatibility shim keeps the
  // production SQL's sha256(bytea) signature and bytea/encode flow executable;
  // HBAM2's separate source-digest verifier tests the real digest contract.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create function public.sha256(bytea) returns bytea
    language sql immutable strict
    as $$ select decode(repeat('ab', 32), 'hex') $$;

    -- The production inventory reads the hash-pinned fence helper. Its full
    -- catalog semantics are exercised by productionWriteFenceFinalizer.test;
    -- this isolated SQL-contract fixture only needs the authenticated shape.
    create function public.production_live_schema_contract_20260717()
    returns text language sql stable security invoker
    set search_path = pg_catalog
    as $$ select repeat('ab', 32) $$;
    revoke all on function public.production_live_schema_contract_20260717()
      from public, anon, authenticated, service_role;
  `)
  for (const tableName of EXPECTED_TABLES) {
    await db.exec(`
      create table public.${tableName} (
        id bigint primary key,
        exact_numeric numeric(30, 6) not null,
        note text not null
      );
    `)
    await db.query(
      `insert into public.${tableName} (id, exact_numeric, note)
       values (9007199254740993, 123456789012345678901234.123456, $1)`,
      [tableName],
    )
  }

  await db.exec(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text primary key,
      name text not null
    );
    insert into supabase_migrations.schema_migrations (version, name) values
      ${EXPECTED_RELEASE_MIGRATIONS.map((version) => `('${version}', 'release_${version}')`).join(',\n      ')};

    alter table public.amora_care_deliveries
      add column user_id bigint,
      add column send_day date;
    alter table public.amora_care_jobs
      add column scan_day date,
      add column status text,
      add column created_at timestamptz;
    alter table public.profiles
      add column care_notifications_enabled boolean not null default false,
      add column care_notifications_consented_at timestamptz,
      add constraint profiles_care_consent_state_valid
        check (care_notifications_enabled = (care_notifications_consented_at is not null));

    create unique index amora_care_deliveries_user_send_day_uidx
      on public.amora_care_deliveries (user_id, send_day)
      where send_day is not null;
    create index amora_care_jobs_scan_status_idx
      on public.amora_care_jobs (scan_day, status);
    create index amora_care_jobs_active_age_idx
      on public.amora_care_jobs (created_at)
      where status in ('pending', 'processing');

    create function public.enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.prepare_amora_care_job(uuid,uuid,boolean)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.claim_amora_care_email_delivery(uuid,uuid)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.amora_care_delivery_clock()
      returns timestamptz language sql as $$ select statement_timestamp() $$;
    create function public.amora_care_is_delivery_window(timestamptz)
      returns boolean language sql as $$ select true $$;
    create function public.amora_care_next_delivery_window(timestamptz)
      returns timestamptz language sql as $$ select $1 $$;
    create function public.get_amora_care_queue_stats(date)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.prepare_amora_care_job_pre_delivery_policy(uuid,uuid,boolean)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.claim_amora_care_email_delivery_pre_delivery_policy(uuid,uuid)
      returns jsonb language sql as $$ select '{}'::jsonb $$;

    create function public.defer_amora_memory_job(uuid,integer,integer,text)
      returns boolean
      language sql
      security definer
      set search_path = pg_catalog, public
      set lock_timeout = '5s'
      set statement_timeout = '30s'
      as $$ select true $$;
    revoke all on function public.defer_amora_memory_job(uuid,integer,integer,text)
      from public, anon, authenticated;
    grant execute on function public.defer_amora_memory_job(uuid,integer,integer,text)
      to service_role;
  `)

  for (const identity of EXPECTED_EXPAND_FUNCTIONS) {
    if (identity === 'enqueue_booking_projection_job()') continue
    await db.exec(`
      create function public.${identity}
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    `)
  }
  await db.exec(`
    create table public.vendor_bookings (
      id uuid primary key,
      status text,
      actual_amount numeric
    );
    create function public.enqueue_booking_projection_job()
      returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger vendor_bookings_projection_outbox
      after insert or update of status, actual_amount on public.vendor_bookings
      for each row execute function public.enqueue_booking_projection_job();
  `)

  const { payload: preflightPayload } = parsePayload(
    await executeReadOnly(preflightSelectSql),
    'preflight',
  )
  assertPolicyContracts(preflightPayload, 'preflight')
  if (Number(preflightPayload.table_count) !== EXPECTED_TABLES.length) {
    fail('preflight SQL table allowlist count mismatch')
  }

  await db.exec("delete from supabase_migrations.schema_migrations where version = '20260716117000'")
  const belowHeadResult = await executeReadOnly(preflightSelectSql)
  if (belowHeadResult.rows.length !== 1 || belowHeadResult.rows[0]?.payload !== null) {
    fail('preflight SQL accepted a release ledger below exact head 1170')
  }
  await db.exec(
    "insert into supabase_migrations.schema_migrations (version, name) values ('20260716117000', 'release_20260716117000')",
  )

  const { payload: inventoryPayload } = parsePayload(
    await executeReadOnly(inventorySelectSql),
    'inventory',
  )
  assertPolicyContracts(inventoryPayload, 'inventory')
  const deferralFunction = inventoryPayload.functions?.find(
    (entry) => String(entry?.identity ?? '').replace(/^public\./, '') ===
      'defer_amora_memory_job(uuid,integer,integer,text)',
  )
  if (
    deferralFunction?.owner !== 'postgres' ||
    deferralFunction?.security_definer !== true ||
    JSON.stringify(deferralFunction?.acl) !==
      JSON.stringify(['postgres=X/postgres', 'service_role=X/postgres']) ||
    JSON.stringify(deferralFunction?.config) !==
      JSON.stringify([
        'search_path=pg_catalog, public',
        'lock_timeout=5s',
        'statement_timeout=30s',
      ])
  ) {
    fail('inventory SQL did not preserve the exact service-only 0980 ACL/configuration')
  }
  const inventoryIdentities = (inventoryPayload.functions ?? [])
    .map((entry) => String(entry?.identity ?? '').replace(/^public\./, ''))
  const missingExpandFunctions = EXPECTED_EXPAND_FUNCTIONS.filter(
    (identity) => !inventoryIdentities.includes(identity),
  )
  if (missingExpandFunctions.length !== 0) {
    fail(`inventory SQL omitted expand function identities: ${missingExpandFunctions.join(', ')}`)
  }
  const projectionTrigger = (inventoryPayload.external_triggers ?? []).filter(
    (entry) => entry?.schema === 'public' &&
      entry?.table === 'vendor_bookings' &&
      entry?.name === 'vendor_bookings_projection_outbox' &&
      entry?.timing === 'AFTER' &&
      entry?.fires_insert === true &&
      entry?.fires_update === true &&
      entry?.function_identity === 'enqueue_booking_projection_job()',
  )
  if (projectionTrigger.length !== 1) {
    fail('inventory SQL omitted the vendor booking projection outbox trigger')
  }

  await db.exec(
    "insert into supabase_migrations.schema_migrations (version, name) values ('20260716118000', 'unreviewed_future_migration')",
  )
  const aheadOfHeadResult = await executeReadOnly(inventorySelectSql)
  if (aheadOfHeadResult.rows.length !== 1 || aheadOfHeadResult.rows[0]?.payload !== null) {
    fail('inventory SQL accepted an unreviewed migration after exact head 1170')
  }
  await db.exec("delete from supabase_migrations.schema_migrations where version = '20260716118000'")

  const { payload, payloadText } = parsePayload(
    await executeReadOnly(logicalSelectSql),
    'logical backup',
  )
  if (!payloadText.includes('9007199254740993')) {
    fail('logical backup SQL did not preserve the exact large integer bytes')
  }
  if (!payloadText.includes('123456789012345678901234.123456')) {
    fail('logical backup SQL did not preserve the exact numeric bytes')
  }

  assertPolicyContracts(payload, 'logical backup')
  const tableNames = Object.keys(payload.tables ?? {}).sort()
  if (JSON.stringify(tableNames) !== JSON.stringify(EXPECTED_TABLES)) {
    fail('logical backup SQL table allowlist mismatch')
  }
  const relations = Array.isArray(payload.relations) ? payload.relations : []
  const relationNames = relations.map((relation) => String(relation?.name ?? '')).sort()
  if (JSON.stringify(relationNames) !== JSON.stringify(EXPECTED_TABLES)) {
    fail('logical backup SQL relation allowlist mismatch')
  }
  for (const relation of relations) {
    if (
      !/^[1-9][0-9]{0,9}$/.test(String(relation?.relation_oid ?? '')) ||
      relation?.relkind !== 'r' ||
      relation?.has_inheritance_children !== false ||
      relation?.is_inheritance_child !== false
    ) {
      fail('logical backup SQL returned an unsafe relation shape')
    }
  }
  for (const tableName of tableNames) {
    const table = payload.tables[tableName]
    if (String(table?.row_count) !== '1' || !Array.isArray(table?.rows) || table.rows.length !== 1) {
      fail(`logical backup SQL row count mismatch for ${tableName}`)
    }
    if (!/^[0-9a-f]{64}$/.test(String(table?.canonical_sha256 ?? ''))) {
      fail(`logical backup SQL did not return a lowercase SHA-256 for ${tableName}`)
    }
  }

  process.stdout.write(JSON.stringify({
    ActualLogicalSqlExecuted: true,
    ActualPreflightSqlExecuted: true,
    ActualInventorySqlExecuted: true,
    ReadOnlyTimeoutGuardExecuted: true,
    OnlyTargetTablesRead: true,
    RelationIdentityContractCaptured: true,
    CareDeliveryPolicyContractVerified: true,
    MemoryDeferralContractVerified: true,
    ExactReleaseMigrationLedgerVerified: true,
    MissingReleaseHeadRejectedServerSide: true,
    FutureReleaseMigrationRejectedServerSide: true,
    ExpandFunctionIdentityContractVerified: true,
    BookingProjectionTriggerContractVerified: true,
    Engine: 'PGlite',
    Sha256CompatibilityShim: true,
    TableCount: tableNames.length,
    TotalRows: tableNames.length,
    CanonicalDigestsLowercase: true,
    ExactLargeIntegerPreserved: true,
    ExactNumericPreserved: true,
    PlaintextWrittenToDisk: false,
  }))
} finally {
  await db.close()
}
