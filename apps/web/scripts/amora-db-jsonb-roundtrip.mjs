import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const pgliteEntry = process.env.HBAM_PGLITE_ENTRY
if (!pgliteEntry || !isAbsolute(pgliteEntry)) {
  throw new Error('trusted PGlite entry path is required')
}
const { PGlite } = await import(pathToFileURL(pgliteEntry).href)
delete process.env.HBAM_PGLITE_ENTRY

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
const MAX_INPUT_LINE_CHARS = 180_000_000

function fail(message) {
  throw new Error(message)
}

function parseInventory(line) {
  if (!line || line.length > MAX_INPUT_LINE_CHARS) {
    fail('inventory payload is missing or exceeds the input limit')
  }
  try {
    return JSON.parse(Buffer.from(line, 'base64').toString('utf8'))
  } catch {
    fail('inventory payload is not valid authenticated JSON')
  }
}

function decodeLogicalDataWithoutParsing(line) {
  if (!line || line.length > MAX_INPUT_LINE_CHARS) {
    fail('logical data payload is missing or exceeds the input limit')
  }
  try {
    return Buffer.from(line, 'base64').toString('utf8')
  } catch {
    fail('logical data payload could not be decoded')
  }
}

function normalizedTableName(value) {
  return typeof value === 'string' ? value.replace(/^public\./, '') : ''
}

function canonicalRowsDigest(rows) {
  const hash = createHash('sha256')
  for (const row of rows) {
    const value = String(row)
    hash.update(String(Buffer.byteLength(value, 'utf8')))
    hash.update(':')
    hash.update(value)
    hash.update('\n')
  }
  return hash.digest('hex').toUpperCase()
}

async function getConstraintKeys(db, tableName, columns) {
  if (!Array.isArray(columns) || columns.length === 0) return []
  const valueExpressions = columns.map((_, index) => `row_data -> $${index + 2}`)
  const nullExpressions = columns.map(
    (_, index) => `(not (row_data ? $${index + 2}) or row_data -> $${index + 2} = 'null'::jsonb)`,
  )
  const result = await db.query(
    `with source_rows as (
       select source.value as row_data, source.ordinality
       from rehearsal.authenticated_payload as p,
            jsonb_array_elements(p.payload->'tables'->$1->'rows')
              with ordinality as source(value, ordinality)
     )
     select jsonb_build_array(${valueExpressions.join(', ')})::text as key_text,
            (${nullExpressions.join(' or ')}) as has_null
     from source_rows
     order by ordinality`,
    [tableName, ...columns],
  )
  return result.rows.map((row) => ({
    keyText: String(row.key_text),
    hasNull: row.has_null === true,
  }))
}

const input = await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    value += chunk
    if (value.length > MAX_INPUT_LINE_CHARS * 2 + 2) {
      reject(new Error('authenticated payload input exceeds the process limit'))
    }
  })
  process.stdin.on('end', () => resolve(value))
  process.stdin.on('error', reject)
})

const lines = input.split(/\r?\n/).filter(Boolean)
if (lines.length !== 2) fail('JSONB round-trip expects exactly two authenticated payloads')

const inventory = parseInventory(lines[0])
const logicalDataJson = decodeLogicalDataWithoutParsing(lines[1])
if (!Array.isArray(inventory.columns) || !Array.isArray(inventory.constraints)) {
  fail('JSONB round-trip payload is missing schema metadata')
}

const columnsByTable = new Map()
for (const column of inventory.columns) {
  if (typeof column?.table_name !== 'string' || typeof column?.column_name !== 'string') {
    fail('JSONB round-trip inventory has invalid column metadata')
  }
  const columns = columnsByTable.get(column.table_name) ?? []
  columns.push(column.column_name)
  columnsByTable.set(column.table_name, columns)
}

const db = new PGlite()
try {
  await db.exec(`
    create schema rehearsal;
    create table rehearsal.authenticated_payload (
      payload jsonb not null check (jsonb_typeof(payload) = 'object')
    );
    create table rehearsal.round_trip_rows (
      table_name text not null,
      ordinal bigint not null,
      row_data jsonb not null,
      primary key (table_name, ordinal)
    );
  `)

  try {
    // Keep the logical payload as an opaque UTF-8 string in V8. PostgreSQL parses
    // the original bytes directly, avoiding IEEE-754 coercion of JSON numbers.
    await db.query(
      'insert into rehearsal.authenticated_payload (payload) values ($1::jsonb)',
      [logicalDataJson],
    )
  } catch {
    fail('logical data payload is not valid PostgreSQL JSONB')
  }

  const payloadShape = await db.query(
    `select jsonb_typeof(payload->'tables') as tables_type
     from rehearsal.authenticated_payload`,
  )
  if (payloadShape.rows[0]?.tables_type !== 'object') {
    fail('logical data payload has no tables object')
  }

  const tableResult = await db.query(
    `select names.table_name
     from rehearsal.authenticated_payload as p,
          jsonb_object_keys(p.payload->'tables') as names(table_name)
     order by names.table_name`,
  )
  const tableNames = tableResult.rows.map((row) => String(row.table_name))
  if (JSON.stringify(tableNames) !== JSON.stringify(EXPECTED_TABLES)) {
    fail('JSONB round-trip table allowlist mismatch')
  }

  let totalRows = 0n
  const sourceCanonicalDigests = new Map()
  for (const tableName of tableNames) {
    const expectedColumns = [...(columnsByTable.get(tableName) ?? [])].sort()
    if (expectedColumns.length === 0) {
      fail(`JSONB round-trip has no inventory columns for ${tableName}`)
    }
    const tableCheck = await db.query(
      `select (p.payload->'tables'->$1->>'row_count') as reported_count,
              jsonb_typeof(p.payload->'tables'->$1->'canonical_sha256') as digest_type,
              (p.payload->'tables'->$1->>'canonical_sha256') as canonical_sha256,
              jsonb_array_length(p.payload->'tables'->$1->'rows')::text as actual_count,
              (
                select count(*)::text
                from jsonb_array_elements(p.payload->'tables'->$1->'rows') as source(row_data)
                where jsonb_typeof(source.row_data) <> 'object'
                   or (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                       from jsonb_object_keys(source.row_data) as keys(k)) <> $2::jsonb
              ) as invalid_rows
       from rehearsal.authenticated_payload as p`,
      [tableName, JSON.stringify(expectedColumns)],
    )
    const check = tableCheck.rows[0]
    if (
      !check ||
      String(check.reported_count) !== String(check.actual_count) ||
      String(check.invalid_rows) !== '0'
    ) {
      fail(`JSONB round-trip metadata mismatch for ${tableName}`)
    }
    const sourceCanonicalDigest = String(check.canonical_sha256 ?? '')
    if (check.digest_type !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(sourceCanonicalDigest)) {
      fail(`JSONB round-trip has an invalid source canonical digest for ${tableName}`)
    }
    sourceCanonicalDigests.set(tableName, sourceCanonicalDigest.toUpperCase())
    totalRows += BigInt(String(check.actual_count))
  }

  let primaryConstraintsChecked = 0
  let foreignKeysChecked = 0
  let externalForeignKeysSkipped = 0
  for (const constraint of inventory.constraints) {
    const tableName = normalizedTableName(constraint.table)
    const columns = Array.isArray(constraint.columns) ? constraint.columns : []
    if (!tableNames.includes(tableName) || columns.length === 0) continue

    if (constraint.type === 'p' || constraint.type === 'u') {
      const keys = await getConstraintKeys(db, tableName, columns)
      const seen = new Set()
      for (const key of keys) {
        if (constraint.type === 'p' && key.hasNull) {
          fail(`JSONB round-trip found a null primary key in ${tableName}`)
        }
        if (constraint.type === 'u' && key.hasNull) continue
        if (seen.has(key.keyText)) {
          fail(`JSONB round-trip found a duplicate key in ${tableName}`)
        }
        seen.add(key.keyText)
      }
      primaryConstraintsChecked += 1
    }

    if (constraint.type === 'f') {
      const referencedTable = normalizedTableName(constraint.referenced_table)
      const referencedColumns = Array.isArray(constraint.referenced_columns)
        ? constraint.referenced_columns
        : []
      if (!tableNames.includes(referencedTable) || referencedColumns.length !== columns.length) {
        externalForeignKeysSkipped += 1
        continue
      }
      const sourceKeys = await getConstraintKeys(db, tableName, columns)
      const referencedKeys = new Set(
        (await getConstraintKeys(db, referencedTable, referencedColumns)).map((key) => key.keyText),
      )
      for (const key of sourceKeys) {
        if (key.hasNull) continue
        if (!referencedKeys.has(key.keyText)) {
          fail(`JSONB round-trip found a broken included foreign key in ${tableName}`)
        }
      }
      foreignKeysChecked += 1
    }
  }

  await db.exec('begin')
  try {
    for (const tableName of tableNames) {
      await db.query(
        `insert into rehearsal.round_trip_rows (table_name, ordinal, row_data)
         select $1, source.ordinality - 1, source.value
         from rehearsal.authenticated_payload as p,
              jsonb_array_elements(p.payload->'tables'->$1->'rows')
                with ordinality as source(value, ordinality)`,
        [tableName],
      )
    }
    await db.exec('commit')
  } catch (error) {
    await db.exec('rollback')
    throw error
  }

  for (const tableName of tableNames) {
    const source = await db.query(
      `select source.value::text as row_json
       from rehearsal.authenticated_payload as p,
            jsonb_array_elements(p.payload->'tables'->$1->'rows')
              with ordinality as source(value, ordinality)
       order by source.ordinality`,
      [tableName],
    )
    const staged = await db.query(
      `select row_data::text as row_json
       from rehearsal.round_trip_rows
       where table_name = $1 order by ordinal`,
      [tableName],
    )
    const sourceRows = source.rows.map((row) => String(row.row_json))
    const stagedRows = staged.rows.map((row) => String(row.row_json))
    const expectedDigest = sourceCanonicalDigests.get(tableName)
    if (canonicalRowsDigest(sourceRows) !== expectedDigest) {
      fail(`source PostgreSQL canonical digest mismatch for ${tableName}`)
    }
    if (
      sourceRows.length !== stagedRows.length ||
      canonicalRowsDigest(stagedRows) !== expectedDigest
    ) {
      fail(`PGlite JSONB canonical round-trip mismatch for ${tableName}`)
    }
  }

  process.stdout.write(JSON.stringify({
    JsonbRoundTripVerified: true,
    AuthenticatedJsonbStaged: true,
    Engine: 'PGlite',
    TableCount: tableNames.length,
    TotalRows: totalRows.toString(),
    PrimaryConstraintsChecked: primaryConstraintsChecked,
    ForeignKeysChecked: foreignKeysChecked,
    ExternalForeignKeysSkipped: externalForeignKeysSkipped,
    SourceCanonicalDigestsVerified: true,
    LogicalDataParsedInV8: false,
    PlaintextWrittenToDisk: false,
  }))
} finally {
  await db.close()
}
