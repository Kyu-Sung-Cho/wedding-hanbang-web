import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const pgliteEntry = process.env.HBAM_PGLITE_ENTRY;
if (!pgliteEntry || !isAbsolute(pgliteEntry)) {
  throw new Error("trusted PGlite entry path is required");
}
const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
delete process.env.HBAM_PGLITE_ENTRY;

const EXPECTED_TABLES = Object.freeze([
  "account_deletion_jobs",
  "account_deletion_media_manifest",
  "agencies",
  "agency_dedupe_candidates",
  "ai_interactions_log",
  "amora_actions",
  "amora_care_deliveries",
  "amora_care_jobs",
  "amora_care_scan_states",
  "amora_chat_request_claims",
  "amora_conflict_check_claims",
  "amora_couple_profiles",
  "amora_mediation_acceptances",
  "amora_memory_consents",
  "amora_memory_jobs",
  "amora_memory_settings",
  "amora_saved_notes",
  "amora_tool_executions",
  "amora_turn_counters",
  "amora_turn_requests",
  "booking_projection_jobs",
  "chat_feedback",
  "chat_messages",
  "chat_summaries",
  "combos",
  "community_upload_sessions",
  "couples",
  "decision_nodes",
  "disclosure_semantic_staging",
  "events",
  "official_agency_packages",
  "official_price_options",
  "official_prices",
  "official_review_events",
  "price_alerts",
  "price_snapshots",
  "price_upload_confirmation_events",
  "price_upload_confirmations",
  "profiles",
  "tags",
  "vendor_alias_proposals",
  "vendor_dedupe_candidates",
  "vendor_demand_daily",
  "vendor_disclosure_bulk_approval_audits",
  "vendor_disclosure_ingest_batches",
  "vendor_disclosure_ingest_dedupe_links",
  "vendor_disclosure_ingest_identity_links",
  "vendor_disclosure_ingest_owned_identities",
  "vendor_disclosure_ingest_owned_ledger_rows",
  "vendor_disclosure_ingest_owned_rows",
  "vendor_disclosure_ingest_record_bindings",
  "vendor_disclosure_ingest_runs",
  "vendor_disclosure_ingest_storage_links",
  "vendor_disclosure_ingest_unit_provider_lineage",
  "vendor_disclosure_paid_extraction_attestations",
  "vendor_enrichment_private",
  "vendor_reviews",
  "vendor_tags",
  "wedding_journeys",
  "wishlists",
]);

const MAX_INPUT_LINE_CHARS = 180_000_000;

function fail(message) {
  throw new Error(message);
}

function decodeInventory(line) {
  if (!line || line.length > MAX_INPUT_LINE_CHARS) fail("inventory input is invalid");
  try {
    return JSON.parse(Buffer.from(line, "base64").toString("utf8"));
  } catch {
    fail("inventory input is not authenticated JSON");
  }
}

function decodeLogicalData(line) {
  if (!line || line.length > MAX_INPUT_LINE_CHARS) fail("logical input is invalid");
  try {
    return Buffer.from(line, "base64").toString("utf8");
  } catch {
    fail("logical input could not be decoded");
  }
}

function normalizedTable(value) {
  return typeof value === "string" ? value.replace(/^public\./, "") : "";
}

function canonicalRowsDigest(rows) {
  const hash = createHash("sha256");
  for (const row of rows) {
    const value = String(row);
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function constraintKeys(db, tableName, columns) {
  if (!Array.isArray(columns) || columns.length === 0) return [];
  const values = columns.map((_, index) => `row_data -> $${index + 2}`);
  const nulls = columns.map(
    (_, index) => `(not (row_data ? $${index + 2}) or row_data -> $${index + 2} = 'null'::jsonb)`,
  );
  const result = await db.query(
    `with source_rows as (
       select source.value as row_data, source.ordinality
       from rehearsal.authenticated_payload as payload,
            jsonb_array_elements(payload.payload->'tables'->$1->'rows')
              with ordinality as source(value, ordinality)
     )
     select jsonb_build_array(${values.join(", ")})::text as key_text,
            (${nulls.join(" or ")}) as has_null
     from source_rows order by ordinality`,
    [tableName, ...columns],
  );
  return result.rows.map((row) => ({
    keyText: String(row.key_text),
    hasNull: row.has_null === true,
  }));
}

const input = await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    value += chunk;
    if (value.length > MAX_INPUT_LINE_CHARS * 2 + 2) {
      reject(new Error("authenticated inputs exceed the process limit"));
    }
  });
  process.stdin.on("end", () => resolve(value));
  process.stdin.on("error", reject);
});

const lines = input.split(/\r?\n/).filter(Boolean);
if (lines.length !== 2) fail("round-trip requires exactly two authenticated payloads");
const inventory = decodeInventory(lines[0]);
const logicalDataJson = decodeLogicalData(lines[1]);
if (!Array.isArray(inventory?.columns) || !Array.isArray(inventory?.constraints)) {
  fail("inventory schema metadata is incomplete");
}

const columnsByTable = new Map();
for (const column of inventory.columns) {
  if (typeof column?.table_name !== "string" || typeof column?.column_name !== "string") {
    fail("inventory column metadata is invalid");
  }
  const values = columnsByTable.get(column.table_name) ?? [];
  values.push(column.column_name);
  columnsByTable.set(column.table_name, values);
}

const db = new PGlite();
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
  `);
  try {
    // PostgreSQL parses the authenticated UTF-8 bytes. V8 never parses logical rows,
    // so large JSON numbers cannot be silently coerced through IEEE-754.
    await db.query(
      "insert into rehearsal.authenticated_payload (payload) values ($1::jsonb)",
      [logicalDataJson],
    );
  } catch {
    fail("logical data is not valid PostgreSQL JSONB");
  }

  const namesResult = await db.query(
    `select names.table_name
     from rehearsal.authenticated_payload as payload,
          jsonb_object_keys(payload.payload->'tables') as names(table_name)
     order by names.table_name`,
  );
  const tableNames = namesResult.rows.map((row) => String(row.table_name));
  if (JSON.stringify(tableNames) !== JSON.stringify(EXPECTED_TABLES)) {
    fail("logical data table allowlist is not the exact current Production contract");
  }

  let totalRows = 0n;
  const canonicalDigests = new Map();
  for (const tableName of tableNames) {
    const columns = [...(columnsByTable.get(tableName) ?? [])].sort();
    if (columns.length === 0) fail(`inventory has no columns for ${tableName}`);
    const result = await db.query(
      `select payload.payload->'tables'->$1->>'row_count' as reported_count,
              payload.payload->'tables'->$1->>'canonical_sha256' as canonical_sha256,
              jsonb_array_length(payload.payload->'tables'->$1->'rows')::text as actual_count,
              (select count(*)::text
               from jsonb_array_elements(payload.payload->'tables'->$1->'rows') as source(row_data)
               where jsonb_typeof(source.row_data) <> 'object'
                  or (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
                      from jsonb_object_keys(source.row_data) as keys(key)) <> $2::jsonb
              ) as invalid_rows
       from rehearsal.authenticated_payload as payload`,
      [tableName, JSON.stringify(columns)],
    );
    const check = result.rows[0];
    const digest = String(check?.canonical_sha256 ?? "").toLowerCase();
    if (!check
        || String(check.reported_count) !== String(check.actual_count)
        || String(check.invalid_rows) !== "0"
        || !/^[a-f0-9]{64}$/.test(digest)) {
      fail(`logical data metadata is invalid for ${tableName}`);
    }
    canonicalDigests.set(tableName, digest);
    totalRows += BigInt(String(check.actual_count));
  }

  let primaryConstraintsChecked = 0;
  let foreignKeysChecked = 0;
  let externalForeignKeysSkipped = 0;
  for (const constraint of inventory.constraints) {
    const tableName = normalizedTable(constraint?.table);
    const columns = Array.isArray(constraint?.columns) ? constraint.columns : [];
    if (!tableNames.includes(tableName) || columns.length === 0) continue;
    if (constraint.type === "p" || constraint.type === "u") {
      const keys = await constraintKeys(db, tableName, columns);
      const seen = new Set();
      for (const key of keys) {
        if (constraint.type === "p" && key.hasNull) fail(`null primary key in ${tableName}`);
        if (constraint.type === "u" && key.hasNull) continue;
        if (seen.has(key.keyText)) fail(`duplicate constrained key in ${tableName}`);
        seen.add(key.keyText);
      }
      primaryConstraintsChecked += 1;
    }
    if (constraint.type === "f") {
      const referencedTable = normalizedTable(constraint.referenced_table);
      const referencedColumns = Array.isArray(constraint.referenced_columns)
        ? constraint.referenced_columns
        : [];
      if (!tableNames.includes(referencedTable) || referencedColumns.length !== columns.length) {
        externalForeignKeysSkipped += 1;
        continue;
      }
      const sourceKeys = await constraintKeys(db, tableName, columns);
      const targetKeys = new Set(
        (await constraintKeys(db, referencedTable, referencedColumns))
          .map((key) => key.keyText),
      );
      for (const key of sourceKeys) {
        if (!key.hasNull && !targetKeys.has(key.keyText)) {
          fail(`broken included foreign key in ${tableName}`);
        }
      }
      foreignKeysChecked += 1;
    }
  }

  await db.exec("begin");
  try {
    for (const tableName of tableNames) {
      await db.query(
        `insert into rehearsal.round_trip_rows (table_name, ordinal, row_data)
         select $1, source.ordinality - 1, source.value
         from rehearsal.authenticated_payload as payload,
              jsonb_array_elements(payload.payload->'tables'->$1->'rows')
                with ordinality as source(value, ordinality)`,
        [tableName],
      );
    }
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }

  for (const tableName of tableNames) {
    const source = await db.query(
      `select source.value::text as row_json
       from rehearsal.authenticated_payload as payload,
            jsonb_array_elements(payload.payload->'tables'->$1->'rows')
              with ordinality as source(value, ordinality)
       order by source.ordinality`,
      [tableName],
    );
    const staged = await db.query(
      `select row_data::text as row_json from rehearsal.round_trip_rows
       where table_name = $1 order by ordinal`,
      [tableName],
    );
    const sourceRows = source.rows.map((row) => String(row.row_json));
    const stagedRows = staged.rows.map((row) => String(row.row_json));
    const digest = canonicalDigests.get(tableName);
    if (canonicalRowsDigest(sourceRows) !== digest
        || sourceRows.length !== stagedRows.length
        || canonicalRowsDigest(stagedRows) !== digest) {
      fail(`canonical JSONB round-trip digest mismatch for ${tableName}`);
    }
  }

  process.stdout.write(JSON.stringify({
    JsonbRoundTripVerified: true,
    AuthenticatedJsonbStaged: true,
    Engine: "PGlite",
    TableCount: tableNames.length,
    TotalRows: totalRows.toString(),
    PrimaryConstraintsChecked: primaryConstraintsChecked,
    ForeignKeysChecked: foreignKeysChecked,
    ExternalForeignKeysSkipped: externalForeignKeysSkipped,
    SourceCanonicalDigestsVerified: true,
    LogicalDataParsedInV8: false,
    PlaintextWrittenToDisk: false,
  }));
} finally {
  await db.close();
}
