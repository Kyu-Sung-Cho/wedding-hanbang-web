import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const EXPECTED_TABLES = [
  'ai_interactions_log',
  'amora_actions',
  'amora_couple_profiles',
  'amora_mediation_acceptances',
  'amora_memory_consents',
  'amora_memory_jobs',
  'amora_memory_settings',
  'amora_turn_counters',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'couples',
  'decision_nodes',
  'profiles',
  'wedding_journeys',
]

function fail(message) {
  throw new Error(message)
}

const sqlPath = process.argv[2]
if (!sqlPath) fail('logical backup SQL path is required')
const logicalBackupSql = await readFile(sqlPath, 'utf8')
if (!logicalBackupSql.trim()) fail('logical backup SQL is empty')
const guardedSql = logicalBackupSql.match(
  /^\s*begin transaction read only;\s*set local statement_timeout = '120s';\s*set local lock_timeout = '5s';\s*set local row_security = off;\s*([\s\S]*?)\s*commit;\s*$/i,
)
if (!guardedSql) fail('logical backup SQL is missing its exact read-only timeout guard')
const logicalSelectSql = guardedSql[1]
const onlyScanCount = (logicalSelectSql.match(/\bfrom\s+only\s+public\./gi) ?? []).length
if (onlyScanCount !== EXPECTED_TABLES.length) {
  fail('logical backup SQL must read every target through FROM ONLY')
}

const db = new PGlite()
try {
  // PGlite 0.5 does not bundle pgcrypto. This compatibility shim keeps the
  // production SQL's sha256(bytea) signature and bytea/encode flow executable;
  // HBAM2's separate source-digest verifier tests the real digest contract.
  await db.exec(`
    create function public.sha256(bytea) returns bytea
    language sql immutable strict
    as $$ select decode(repeat('ab', 32), 'hex') $$;
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

  await db.exec('begin transaction read only')
  await db.exec("set local statement_timeout = '120s'")
  await db.exec("set local lock_timeout = '5s'")
  await db.exec('set local row_security = off')
  let result
  try {
    result = await db.query(logicalSelectSql)
    await db.exec('commit')
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
  if (result.rows.length !== 1) fail('logical backup SQL did not return exactly one row')
  const payloadText = String(result.rows[0]?.payload ?? '')
  if (!payloadText) fail('logical backup SQL returned an empty payload')
  if (!payloadText.includes('9007199254740993')) {
    fail('logical backup SQL did not preserve the exact large integer bytes')
  }
  if (!payloadText.includes('123456789012345678901234.123456')) {
    fail('logical backup SQL did not preserve the exact numeric bytes')
  }

  const payload = JSON.parse(payloadText)
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
    ReadOnlyTimeoutGuardExecuted: true,
    OnlyTargetTablesRead: true,
    RelationIdentityContractCaptured: true,
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
