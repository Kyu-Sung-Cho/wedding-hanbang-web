import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const pgliteEntry = process.env.HBAM_PGLITE_ENTRY;
if (!pgliteEntry || !isAbsolute(pgliteEntry)) throw new Error("trusted PGlite entry path is required");
const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
delete process.env.HBAM_PGLITE_ENTRY;

const EXPECTED_TABLES = Object.freeze([
  "account_deletion_jobs",
  "account_deletion_media_manifest",
  "agencies",
  "agency_dedupe_candidates",
  "ai_interactions_log",
  "amora_action_follow_up_cards_v2",
  "amora_action_follow_up_outcomes_v2",
  "amora_actions",
  "amora_care_deliveries",
  "amora_care_jobs",
  "amora_care_scan_states",
  "amora_chat_request_claims",
  "amora_conflict_check_claims",
  "amora_couple_core_criterion_acceptances",
  "amora_couple_core_criterion_proposals",
  "amora_couple_profiles",
  "amora_first_use_action_promotions",
  "amora_first_use_action_proposal_bindings",
  "amora_mediation_acceptances",
  "amora_mediation_outcome_follow_up_cards",
  "amora_mediation_outcome_follow_up_receipts",
  "amora_mediation_private_safety_holds",
  "amora_memory_consents",
  "amora_memory_enqueue_repair_candidates",
  "amora_memory_enqueue_repair_dead_letters",
  "amora_memory_jobs",
  "amora_memory_settings",
  "amora_personalization_preferences",
  "amora_preparation_catch_up_items",
  "amora_preparation_catch_up_receipts",
  "amora_preparation_topic_message_refs",
  "amora_privacy_context_epochs",
  "amora_private_chat_delete_boundaries",
  "amora_provider_egress_grants",
  "amora_provider_runtime_control",
  "amora_saved_notes",
  "amora_shared_action_acceptances",
  "amora_shared_action_application_claims",
  "amora_shared_action_journey_mutation_receipts",
  "amora_shared_action_roster_bindings",
  "amora_today_one_preferences",
  "amora_today_one_recipient_states",
  "amora_today_one_signals",
  "amora_tool_executions",
  "amora_turn_counters",
  "amora_turn_requests",
  "booking_cancellation_receipts",
  "booking_cancellation_write_authorizations",
  "booking_intent_write_authorizations",
  "booking_outcome_write_authorizations",
  "booking_projection_jobs",
  "booking_projection_write_authorizations",
  "chat_feedback",
  "chat_messages",
  "chat_summaries",
  "cohort_moderation_events",
  "combos",
  "community_commands",
  "community_comment_commands",
  "community_comment_delete_receipts",
  "community_decision_answers",
  "community_decision_beta_members",
  "community_decision_outcome_publications",
  "community_decision_outcomes",
  "community_decision_publication_commands",
  "community_decision_thread_events",
  "community_decision_thread_intakes",
  "community_decision_threads",
  "community_moderation_appeal_decisions",
  "community_moderation_appeals",
  "community_moderation_cases",
  "community_moderation_command_receipts",
  "community_moderation_events",
  "community_moderation_holds",
  "community_moderation_notices",
  "community_notification_push_preferences",
  "community_poll_vote_commands",
  "community_poll_vote_quarantine",
  "community_post_delete_receipts",
  "community_post_write_commands",
  "community_reply_notifications",
  "community_responder_command_receipts",
  "community_responder_questions",
  "community_responder_requests",
  "community_responder_supply_events",
  "community_runtime_control",
  "community_runtime_control_events",
  "community_thread_evidence_selections",
  "community_upload_sessions",
  "community_viewer_control_events",
  "community_viewer_controls",
  "conversation_segments",
  "couple_change_notifications",
  "couple_invite_join_attempts",
  "couple_invite_join_runtime_state",
  "couple_invite_redemptions",
  "couple_plan_change_acceptances",
  "couple_plan_change_requests",
  "couples",
  "decision_nodes",
  "disclosure_semantic_staging",
  "events",
  "mobile_push_device_tokens",
  "notification_delivery_outbox",
  "official_agency_packages",
  "official_price_options",
  "official_prices",
  "official_review_events",
  "price_alerts",
  "price_snapshots",
  "price_upload_confirmation_events",
  "price_upload_confirmations",
  "profiles",
  "responder_capacity_slots",
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
  "vendor_inquiry_handoffs",
  "vendor_reviews",
  "vendor_tags",
  "wedding_court_cases",
  "wedding_court_votes",
  "wedding_journeys",
  "wedding_payment_ledger",
  "wishlists",
]);

const MAX_INPUT_LINE_CHARS = 180_000_000;
const SPECIAL_PARTS = Object.freeze(["auth_users", "storage_buckets", "storage_objects"]);

function fail(message) { throw new Error(message); }

function decodeJsonLine(line, label, parse = true) {
  if (!line || line.length > MAX_INPUT_LINE_CHARS) fail(`${label} input is invalid`);
  try {
    const value = Buffer.from(line, "base64").toString("utf8");
    return parse ? JSON.parse(value) : value;
  } catch {
    fail(`${label} input is not authenticated JSON`);
  }
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

function normalizedTable(value) {
  return typeof value === "string" ? value.replace(/^public\./, "") : "";
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
  return result.rows.map((row) => ({ keyText: String(row.key_text), hasNull: row.has_null === true }));
}

const input = await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    value += chunk;
    if (value.length > MAX_INPUT_LINE_CHARS * 2 + 2) reject(new Error("authenticated inputs exceed limit"));
  });
  process.stdin.on("end", () => resolve(value));
  process.stdin.on("error", reject);
});
const lines = input.split(/\r?\n/).filter(Boolean);
if (lines.length !== 2) fail("round-trip requires exactly two authenticated payloads");
const inventory = decodeJsonLine(lines[0], "inventory");
const logicalDataJson = decodeJsonLine(lines[1], "logical", false);
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
for (const name of EXPECTED_TABLES) {
  if ((columnsByTable.get(name) ?? []).length === 0) fail(`inventory has no columns for ${name}`);
}

const db = new PGlite();
try {
  await db.exec(`
    create schema rehearsal;
    create table rehearsal.authenticated_payload (payload jsonb not null check (jsonb_typeof(payload) = 'object'));
    create table rehearsal.round_trip_rows (
      domain_name text not null, ordinal bigint not null, row_data jsonb not null,
      primary key (domain_name, ordinal)
    );
  `);
  try {
    // PostgreSQL parses authenticated bytes. V8 never parses row values, preserving large JSON numbers.
    await db.query("insert into rehearsal.authenticated_payload (payload) values ($1::jsonb)", [logicalDataJson]);
  } catch {
    fail("logical data is not valid PostgreSQL JSONB");
  }

  const names = await db.query(
    `select name as table_name from rehearsal.authenticated_payload as payload,
       jsonb_object_keys(payload.payload->'tables') as names(name) order by name`,
  );
  const tableNames = names.rows.map((row) => String(row.table_name));
  if (JSON.stringify(tableNames) !== JSON.stringify(EXPECTED_TABLES)) {
    fail("logical data table allowlist is not the exact 139-table contract");
  }

  const domains = [...tableNames, ...SPECIAL_PARTS];
  const expectedDigests = new Map();
  let totalRows = 0n;
  for (const domain of domains) {
    const isPublic = EXPECTED_TABLES.includes(domain);
    const path = isPublic ? `payload.payload->'tables'->$1` : `payload.payload->$1`;
    const metadata = await db.query(
      `select ${path}->>'row_count' as reported_count,
              ${path}->>'canonical_sha256' as canonical_sha256,
              jsonb_array_length(${path}->'rows')::text as actual_count,
              (select count(*)::text from jsonb_array_elements(${path}->'rows') as item(value)
                where jsonb_typeof(item.value) <> 'object') as invalid_rows
       from rehearsal.authenticated_payload as payload`,
      [domain],
    );
    const check = metadata.rows[0];
    const digest = String(check?.canonical_sha256 ?? "").toLowerCase();
    if (!check || String(check.reported_count) !== String(check.actual_count)
        || String(check.invalid_rows) !== "0" || !/^[a-f0-9]{64}$/.test(digest)) {
      fail(`logical data metadata is invalid for ${domain}`);
    }
    if (isPublic) {
      const columns = [...(columnsByTable.get(domain) ?? [])].sort();
      const shape = await db.query(
        `select count(*)::text as invalid_rows
         from rehearsal.authenticated_payload as payload,
              jsonb_array_elements(payload.payload->'tables'->$1->'rows') as item(value)
         where (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
                from jsonb_object_keys(item.value) as keys(key)) <> $2::jsonb`,
        [domain, JSON.stringify(columns)],
      );
      if (String(shape.rows[0]?.invalid_rows) !== "0") fail(`row shape is invalid for ${domain}`);
    }
    expectedDigests.set(domain, digest);
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
      const target = normalizedTable(constraint.referenced_table);
      const targetColumns = Array.isArray(constraint.referenced_columns) ? constraint.referenced_columns : [];
      if (!tableNames.includes(target) || targetColumns.length !== columns.length) {
        externalForeignKeysSkipped += 1;
        continue;
      }
      const sourceKeys = await constraintKeys(db, tableName, columns);
      const targetKeys = new Set((await constraintKeys(db, target, targetColumns)).map((key) => key.keyText));
      for (const key of sourceKeys) {
        if (!key.hasNull && !targetKeys.has(key.keyText)) fail(`broken included foreign key in ${tableName}`);
      }
      foreignKeysChecked += 1;
    }
  }

  await db.exec("begin");
  try {
    for (const domain of domains) {
      const isPublic = EXPECTED_TABLES.includes(domain);
      const path = isPublic ? "payload.payload->'tables'->$1->'rows'" : "payload.payload->$1->'rows'";
      await db.query(
        `insert into rehearsal.round_trip_rows (domain_name, ordinal, row_data)
         select $1, source.ordinality - 1, source.value
         from rehearsal.authenticated_payload as payload,
              jsonb_array_elements(${path}) with ordinality as source(value, ordinality)`,
        [domain],
      );
    }
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }

  for (const domain of domains) {
    const isPublic = EXPECTED_TABLES.includes(domain);
    const path = isPublic ? "payload.payload->'tables'->$1->'rows'" : "payload.payload->$1->'rows'";
    const source = await db.query(
      `select source.value::text as row_json from rehearsal.authenticated_payload as payload,
       jsonb_array_elements(${path}) with ordinality as source(value, ordinality)
       order by source.ordinality`,
      [domain],
    );
    const staged = await db.query(
      "select row_data::text as row_json from rehearsal.round_trip_rows where domain_name = $1 order by ordinal",
      [domain],
    );
    const sourceRows = source.rows.map((row) => String(row.row_json));
    const stagedRows = staged.rows.map((row) => String(row.row_json));
    const digest = expectedDigests.get(domain);
    if (canonicalRowsDigest(sourceRows) !== digest || sourceRows.length !== stagedRows.length
        || canonicalRowsDigest(stagedRows) !== digest) {
      fail(`canonical JSONB round-trip digest mismatch for ${domain}`);
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
    AuthDataDigestsVerified: true,
    StorageDataDigestsVerified: true,
    LogicalDataParsedInV8: false,
    PlaintextWrittenToDisk: false,
  }));
} finally {
  await db.close();
}
