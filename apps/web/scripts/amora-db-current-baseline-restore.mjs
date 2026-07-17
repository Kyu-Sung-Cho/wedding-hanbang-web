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
  'ai_interactions_log',
  'amora_actions',
  'amora_chat_request_claims',
  'amora_couple_profiles',
  'amora_tool_executions',
  'amora_turn_counters',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'couples',
  'decision_nodes',
  'profiles',
  'vendor_reviews',
  'wedding_journeys',
]
const MAX_INPUT_LINE_CHARS = 48_000_000
const ORDINAL_COLUMN = '__hbam2_row_ordinal'
let currentStage = 'startup'

function emitSafeFailureStage() {
  process.stderr.write(`HBAM_BASELINE_STAGE=${currentStage}\n`)
}

process.once('uncaughtException', () => {
  emitSafeFailureStage()
  process.exit(1)
})
process.once('unhandledRejection', () => {
  emitSafeFailureStage()
  process.exit(1)
})

function fail(message) {
  throw new Error(message)
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function normalizeTableName(value) {
  return typeof value === 'string' ? value.replace(/^public\./, '') : ''
}

function parseMetadata(line, label) {
  if (!line || line.length > MAX_INPUT_LINE_CHARS) {
    fail(`${label} is missing or exceeds the input limit`)
  }
  try {
    return JSON.parse(Buffer.from(line, 'base64').toString('utf8'))
  } catch {
    fail(`${label} is not valid authenticated JSON`)
  }
}

function decodeOpaqueData(line) {
  if (!line || line.length > MAX_INPUT_LINE_CHARS) {
    fail('logical data is missing or exceeds the input limit')
  }
  try {
    return Buffer.from(line, 'base64').toString('utf8')
  } catch {
    fail('logical data could not be decoded')
  }
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase()
}

function canonicalRowsDigest(rows) {
  const hash = createHash('sha256')
  for (const row of rows) {
    hash.update(String(Buffer.byteLength(row, 'utf8')))
    hash.update(':')
    hash.update(row)
    hash.update('\n')
  }
  return hash.digest('hex').toUpperCase()
}

function assertExactNames(actual, expected, label) {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(`${label} allowlist mismatch`)
  }
}

function assertInventoryShape(inventory, label) {
  const contract = inventory?.schema_contract
  if (
    !contract ||
    !Array.isArray(contract.tables) ||
    !Array.isArray(contract.columns) ||
    !Array.isArray(contract.constraints) ||
    !Array.isArray(contract.indexes) ||
    !Array.isArray(contract.policies) ||
    !Array.isArray(contract.triggers) ||
    !Array.isArray(contract.dependent_functions) ||
    !Array.isArray(contract.owned_sequences) ||
    !/^[0-9A-Fa-f]{64}$/.test(String(inventory.schema_contract_sha256 ?? ''))
  ) {
    fail(`${label} has incomplete schema metadata`)
  }
  assertExactNames(
    contract.tables.map((table) => String(table?.name ?? '')),
    EXPECTED_TABLES,
    `${label} tables`,
  )
  for (const table of contract.tables) {
    if (
      !/^[1-9][0-9]{0,9}$/.test(String(table?.relation_oid ?? '')) ||
      table?.relkind !== 'r' ||
      table?.has_inheritance_children !== false ||
      table?.is_inheritance_child !== false
    ) {
      fail(`${label} contains a non-ordinary or inherited relation`)
    }
  }
}

const input = await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    value += chunk
    if (value.length > MAX_INPUT_LINE_CHARS * 3 + 3) {
      reject(new Error('authenticated input exceeds the process limit'))
    }
  })
  process.stdin.on('end', () => resolve(value))
  process.stdin.on('error', reject)
})

const lines = input.split(/\r?\n/).filter(Boolean)
if (lines.length !== 3) fail('logical row replay expects exactly three authenticated payloads')

const inventoryBefore = parseMetadata(lines[0], 'schema-before inventory')
const logicalDataJson = decodeOpaqueData(lines[1])
const inventoryAfter = parseMetadata(lines[2], 'schema-after inventory')
assertInventoryShape(inventoryBefore, 'schema-before inventory')
assertInventoryShape(inventoryAfter, 'schema-after inventory')

const columnsByTable = new Map(EXPECTED_TABLES.map((name) => [name, []]))
for (const column of inventoryBefore.schema_contract.columns) {
  const tableName = String(column?.table_name ?? '')
  const columnName = String(column?.column_name ?? '')
  const columns = columnsByTable.get(tableName)
  if (!columns || !columnName || columnName === ORDINAL_COLUMN || columnName.includes('\0')) {
    fail('schema-before inventory has invalid column metadata')
  }
  if (columns.some((candidate) => candidate.name === columnName)) {
    fail(`schema-before inventory repeats column ${tableName}.${columnName}`)
  }
  columns.push({
    name: columnName,
    ordinal: Number(column.ordinal_position),
  })
}
for (const [tableName, columns] of columnsByTable) {
  columns.sort((left, right) => left.ordinal - right.ordinal)
  if (columns.length === 0 || columns.some((column) => !Number.isInteger(column.ordinal))) {
    fail(`schema-before inventory has no ordered columns for ${tableName}`)
  }
}

const db = new PGlite()
try {
  currentStage = 'payload-staging'
  await db.exec(`
    create schema rehearsal;
    create table rehearsal.authenticated_payloads (
      kind text primary key,
      payload jsonb not null check (jsonb_typeof(payload) = 'object')
    );
  `)
  try {
    await db.query(
      `insert into rehearsal.authenticated_payloads (kind, payload)
       values ('before', $1::jsonb), ('data', $2::jsonb), ('after', $3::jsonb)`,
      [
        Buffer.from(lines[0], 'base64').toString('utf8'),
        logicalDataJson,
        Buffer.from(lines[2], 'base64').toString('utf8'),
      ],
    )
  } catch {
    fail('authenticated payloads are not valid PostgreSQL JSONB')
  }

  currentStage = 'schema-contract-check'
  const contractCheck = await db.query(`
    select
      before.payload->'schema_contract' = after.payload->'schema_contract' as contracts_equal,
      (before.payload->'schema_contract')::text as contract_json,
      before.payload->>'schema_contract_sha256' as before_digest,
      after.payload->>'schema_contract_sha256' as after_digest
    from rehearsal.authenticated_payloads as before
    join rehearsal.authenticated_payloads as after on after.kind = 'after'
    where before.kind = 'before'
  `)
  const checkedContract = contractCheck.rows[0]
  if (
    !checkedContract?.contracts_equal ||
    sha256(String(checkedContract.contract_json)) !== String(checkedContract.before_digest).toUpperCase() ||
    String(checkedContract.before_digest).toUpperCase() !==
      String(checkedContract.after_digest).toUpperCase()
  ) {
    fail('schema-before and schema-after contracts or source digest differ')
  }

  currentStage = 'table-allowlist-check'
  const tableResult = await db.query(`
    select table_name
    from rehearsal.authenticated_payloads as payload,
         jsonb_object_keys(payload.payload->'tables') as names(table_name)
    where payload.kind = 'data'
    order by table_name
  `)
  const tableNames = tableResult.rows.map((row) => String(row.table_name))
  assertExactNames(tableNames, EXPECTED_TABLES, 'logical data tables')

  await db.exec('create schema baseline_restore')
  let totalRows = 0n
  let restoredColumns = 0
  const expectedDigests = new Map()

  for (const tableName of EXPECTED_TABLES) {
    currentStage = `restore-table-${tableName}`
    const columns = columnsByTable.get(tableName)
    const sortedColumnNames = columns.map((column) => column.name).sort()
    const rowShape = await db.query(
      `select
         payload.payload->'tables'->$1->>'row_count' as reported_count,
         payload.payload->'tables'->$1->>'canonical_sha256' as canonical_sha256,
         jsonb_array_length(payload.payload->'tables'->$1->'rows')::text as actual_count,
         (
           select count(*)::text
           from jsonb_array_elements(payload.payload->'tables'->$1->'rows') as source(row_data)
           where jsonb_typeof(source.row_data) <> 'object'
              or (
                select coalesce(jsonb_agg(key_name order by key_name), '[]'::jsonb)
                from jsonb_object_keys(source.row_data) as keys(key_name)
              ) <> $2::jsonb
         ) as invalid_rows
       from rehearsal.authenticated_payloads as payload
       where payload.kind = 'data'`,
      [tableName, JSON.stringify(sortedColumnNames)],
    )
    const shape = rowShape.rows[0]
    if (
      !shape ||
      String(shape.reported_count) !== String(shape.actual_count) ||
      String(shape.invalid_rows) !== '0' ||
      !/^[0-9A-Fa-f]{64}$/.test(String(shape.canonical_sha256 ?? ''))
    ) {
      fail(`logical row shape or metadata mismatch for ${tableName}`)
    }

    expectedDigests.set(tableName, String(shape.canonical_sha256).toUpperCase())
    totalRows += BigInt(String(shape.actual_count))
    restoredColumns += columns.length

    const tableSql = quoteIdentifier(tableName)
    const columnDefinitions = columns
      .map((column) => `${quoteIdentifier(column.name)} jsonb`)
      .join(', ')
    await db.exec(
      `create table baseline_restore.${tableSql} (
         ${quoteIdentifier(ORDINAL_COLUMN)} bigint not null unique,
         ${columnDefinitions}
       )`,
    )

    const valueExpressions = columns.map(
      (_, index) =>
        `case when source.value -> $${index + 2} = 'null'::jsonb ` +
        `then null else source.value -> $${index + 2} end`,
    )
    await db.query(
      `insert into baseline_restore.${tableSql}
         (${quoteIdentifier(ORDINAL_COLUMN)}, ${columns.map((column) => quoteIdentifier(column.name)).join(', ')})
       select source.ordinality - 1, ${valueExpressions.join(', ')}
       from rehearsal.authenticated_payloads as payload,
            jsonb_array_elements(payload.payload->'tables'->$1->'rows')
              with ordinality as source(value, ordinality)
       where payload.kind = 'data'`,
      [tableName, ...columns.map((column) => column.name)],
    )
  }

  let uniqueConstraintsReplayed = 0
  let foreignKeysReplayed = 0
  let externalForeignKeysSkipped = 0
  let checkConstraintsDocumented = 0
  const constraints = inventoryBefore.schema_contract.constraints

  for (const [index, constraint] of constraints.entries()) {
    currentStage = `unique-constraint-${index}`
    const tableName = normalizeTableName(constraint?.table)
    const columns = Array.isArray(constraint?.columns)
      ? constraint.columns.map((column) => String(column))
      : []
    const knownColumns = new Set((columnsByTable.get(tableName) ?? []).map((column) => column.name))
    if (!EXPECTED_TABLES.includes(tableName) || columns.length === 0) {
      continue
    }
    if (columns.some((column) => !knownColumns.has(column))) {
      fail(`constraint references an unknown restored column on ${tableName}`)
    }
    if (constraint?.type !== 'p' && constraint?.type !== 'u') continue
    const kind = constraint.type === 'p' ? 'primary key' : 'unique'
    await db.exec(
      `alter table baseline_restore.${quoteIdentifier(tableName)}
       add constraint ${quoteIdentifier(`hbam2_unique_${index}`)} ${kind}
       (${columns.map(quoteIdentifier).join(', ')})`,
    )
    uniqueConstraintsReplayed += 1
  }

  for (const [index, constraint] of constraints.entries()) {
    currentStage = `foreign-key-${index}`
    if (constraint?.type === 'c') {
      checkConstraintsDocumented += 1
      continue
    }
    if (constraint?.type !== 'f') continue
    const tableName = normalizeTableName(constraint.table)
    const referencedTable = normalizeTableName(constraint.referenced_table)
    const columns = Array.isArray(constraint.columns)
      ? constraint.columns.map((column) => String(column))
      : []
    const referencedColumns = Array.isArray(constraint.referenced_columns)
      ? constraint.referenced_columns.map((column) => String(column))
      : []
    if (
      !EXPECTED_TABLES.includes(tableName) ||
      !EXPECTED_TABLES.includes(referencedTable) ||
      columns.length === 0 ||
      columns.length !== referencedColumns.length
    ) {
      externalForeignKeysSkipped += 1
      continue
    }
    const sourceColumnNames = new Set(
      columnsByTable.get(tableName).map((column) => column.name),
    )
    const targetColumnNames = new Set(
      columnsByTable.get(referencedTable).map((column) => column.name),
    )
    if (
      columns.some((column) => !sourceColumnNames.has(column)) ||
      referencedColumns.some((column) => !targetColumnNames.has(column))
    ) {
      fail(`foreign key references an unknown restored column on ${tableName}`)
    }
    await db.exec(
      `alter table baseline_restore.${quoteIdentifier(tableName)}
       add constraint ${quoteIdentifier(`hbam2_fk_${index}`)} foreign key
       (${columns.map(quoteIdentifier).join(', ')})
       references baseline_restore.${quoteIdentifier(referencedTable)}
       (${referencedColumns.map(quoteIdentifier).join(', ')})`,
    )
    foreignKeysReplayed += 1
  }

  for (const tableName of EXPECTED_TABLES) {
    currentStage = `digest-restored-query-${tableName}`
    const tableSql = quoteIdentifier(tableName)
    const restored = await db.query(
      `select (to_jsonb(restored_row) - '${ORDINAL_COLUMN}')::text as row_json
       from baseline_restore.${tableSql} as restored_row
       order by ${quoteIdentifier(ORDINAL_COLUMN)}`,
    )
    currentStage = `digest-source-query-${tableName}`
    const source = await db.query(
      `select source.value::text as row_json
       from rehearsal.authenticated_payloads as payload,
            jsonb_array_elements(payload.payload->'tables'->$1->'rows')
              with ordinality as source(value, ordinality)
       where payload.kind = 'data'
       order by source.ordinality`,
      [tableName],
    )
    const restoredRows = restored.rows.map((row) => String(row.row_json))
    const sourceRows = source.rows.map((row) => String(row.row_json))
    const expectedDigest = expectedDigests.get(tableName)
    currentStage = `digest-compare-${tableName}`
    if (
      restoredRows.length !== sourceRows.length ||
      canonicalRowsDigest(sourceRows) !== expectedDigest ||
      canonicalRowsDigest(restoredRows) !== expectedDigest
    ) {
      fail(`restored row digest mismatch for ${tableName}`)
    }
  }

  currentStage = 'receipt'
  process.stdout.write(JSON.stringify({
    LogicalRowReplayVerified: true,
    ColumnWiseTablesRestored: true,
    SchemaContractBeforeAfterVerified: true,
    SourceCanonicalDigestsVerified: true,
    RestoredCanonicalDigestsVerified: true,
    Engine: 'PGlite',
    TableCount: EXPECTED_TABLES.length,
    RestoredColumnCount: restoredColumns,
    TotalRows: totalRows.toString(),
    UniqueConstraintsReplayed: uniqueConstraintsReplayed,
    ForeignKeysReplayed: foreignKeysReplayed,
    ExternalForeignKeysSkipped: externalForeignKeysSkipped,
    CheckConstraintsDocumented: checkConstraintsDocumented,
    CheckConstraintsReplayed: 0,
    TypedSchemaReplayed: false,
    LogicalDataParsedInV8: false,
    PlaintextWrittenToDisk: false,
  }))
} finally {
  await db.close()
}
