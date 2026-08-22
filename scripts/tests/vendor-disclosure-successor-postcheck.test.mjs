import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { successorCreatedPublicTables } from "../lib/supabase-successor-release-contract.mjs";

const REPO_ROOT = process.cwd();
const POSTCHECK_PATH = join(
  REPO_ROOT,
  "supabase",
  "release-checks",
  "vendor-disclosure-successor-post.sql",
);
const MANIFEST_PATH = join(
  REPO_ROOT,
  "supabase",
  "release-manifests",
  "vendor-disclosure-v2-20260718.json",
);

const EXPECTED_EVIDENCE_FIELDS = Object.freeze([
  "account_deletion_auth_fk_contract_count",
  "chat_server_only_ingest_boundary_count",
  "chat_partner_recipient_select_policy_count",
  "chat_partner_recipient_trigger_count",
  "conversation_segment_active_index_count",
  "conversation_segment_rls_policy_count",
  "conversation_segment_rpc_acl_count",
  "conversation_segment_scope_fk_count",
  "first_use_deterministic_application_rpc_acl_count",
  "first_use_deterministic_proposal_rpc_acl_count",
  "provider_backed_add_action_application_rpc_acl_count",
  "atomic_action_private_dispatcher_acl_count",
  "atomic_action_public_dispatcher_acl_count",
  "atomic_action_href_whitespace_parity_count",
  "booking_outcome_provenance_rpc_acl_count",
  "booking_outcome_provenance_v1_actor_time_contract_count",
  "neutral_preparation_space_rpc_acl_count",
  "neutral_preparation_space_member_model_contract_count",
  "preparation_catch_up_rpc_acl_count",
  "preparation_catch_up_private_actor_binding_contract_count",
  "preparation_notes_read_rpc_acl_count",
  "preparation_action_receipt_binding_read_rpc_acl_count",
  "mediation_private_draft_boundary_trigger_count",
  "topic_criterion_action_context_trigger_count",
  "shared_action_receipt_trigger_contract_count",
  "vendor_review_trigger_search_path_contract_count",
  "decision_node_updated_at_clock_trigger_contract_count",
  "signup_profile_trigger_contract_count",
  "couple_invite_nullable_contract_count",
  "couple_plan_change_auth_user_fk_count",
  "couple_plan_change_display_guard_count",
  "couple_plan_change_idempotency_index_count",
  "couple_plan_change_journey_write_fence_count",
  "couple_plan_change_terminal_event_count",
  "couple_plan_change_write_boundary_trigger_count",
  "successor_created_table_count",
  "successor_migration_head_count",
  "wedding_court_auth_delete_fk_count",
  "chat_feedback_auth_delete_fk_count",
  "payment_ledger_fk_contract_count",
].sort());

function readPostcheck() {
  return readFileSync(POSTCHECK_PATH, "utf8");
}

test("successor postcheck is a read-only, single-row, catalog-backed evidence query", () => {
  const sql = readPostcheck();
  const executableSql = sql
    .replace(/--[^\r\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");

  assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/i);
  assert.match(sql, /COMMIT;\s*$/i);
  assert.doesNotMatch(
    executableSql,
    /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i,
  );
  assert.match(sql, /\bverified\b/i);

  for (const catalogContract of [
    /pg_catalog\.pg_proc/i,
    /pg_catalog\.pg_constraint/i,
    /pg_catalog\.pg_trigger/i,
    /pg_catalog\.pg_index/i,
    /pg_catalog\.pg_policies/i,
    /pg_catalog\.pg_attribute/i,
    /pg_catalog\.pg_get_functiondef/i,
    /pg_catalog\.has_function_privilege/i,
    /pg_catalog\.has_table_privilege/i,
    /supabase_migrations\.schema_migrations/i,
  ]) {
    assert.match(sql, catalogContract);
  }
});

test("successor postcheck emits exactly the controller's bounded evidence fields", () => {
  const sql = readPostcheck();
  const emittedFields = [...sql.matchAll(/\bAS\s+([a-z][a-z0-9_]*_count)\b/gi)]
    .map((match) => match[1].toLowerCase())
    .sort();

  assert.deepEqual(emittedFields, EXPECTED_EVIDENCE_FIELDS);
  for (const field of EXPECTED_EVIDENCE_FIELDS) {
    assert.doesNotMatch(
      sql,
      new RegExp(String.raw`\b\d+\s+AS\s+${field}\b`, "i"),
      `${field} must be derived from hosted catalogs, not a numeric literal`,
    );
  }
  assert.doesNotMatch(sql, /\btrue\s+AS\s+verified\b/i);
});

test("successor table and ordered migration evidence is complete and source-derived", () => {
  const sql = readPostcheck();
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const createdTables = successorCreatedPublicTables(REPO_ROOT, manifest.expandMigrations);
  const baselineIndex = manifest.expandMigrations.findIndex(
    ({ file }) => file.startsWith("20260727090000_"),
  );
  const pendingVersions = manifest.expandMigrations
    .slice(baselineIndex + 1)
    .map(({ file }) => file.slice(0, 14));

  assert.equal(createdTables.length, 112);
  assert.equal(pendingVersions.length, 86);
  for (const table of createdTables) {
    assert.match(sql, new RegExp(String.raw`\('${table.replaceAll("_", "[_]")}'::name\)`, "i"));
  }
  for (const version of pendingVersions) {
    assert.match(sql, new RegExp(String.raw`\('${version}'::text\)`, "i"));
  }
  assert.match(sql, /max\(version::text\)[\s\S]*20260820150000/i);
});

test("each security evidence group is tied to its exact hosted object", () => {
  const sql = readPostcheck();
  for (const exactObject of [
    "prepare_account_deletion_auth_delete",
    "trg_enforce_chat_partner_recipient",
    "chat_select_with_privacy",
    "conversation_segments_one_active_shared",
    "conversation_segments_one_active_private_scope",
    "conversation_segments_one_active_private_owner",
    "chat_messages_segment_scope_fk",
    "chat_summaries_segment_scope_fk",
    "finalize_amora_first_use_action_proposal_v1",
    "finalize_amora_first_use_action_application_v1",
    "finalize_amora_provider_backed_add_action_application_v1",
    "apply_amora_atomic_tool_execution_pre_shared_revision",
    "complete_amora_booking_outcome_atomic",
    "create_neutral_preparation_space_for_current_user",
    "join_neutral_preparation_space_server",
    "finalize_amora_preparation_catch_up_v1",
    "list_amora_preparation_notes_v1",
    "list_amora_preparation_action_receipt_bindings_v1",
    "trg_enforce_amora_mediation_private_draft_boundary",
    "trg_seal_amora_topic_criterion_action_context_v1",
    "trg_bind_amora_shared_action_application",
    "update_vendor_rating_on_review",
    "set_decision_nodes_updated_at",
    "on_auth_user_created",
    "trg_manage_couple_invite_lifecycle",
    "trg_00_enforce_couple_plan_change_write_boundary",
    "couple_plan_change_submit_idempotency_idx",
    "wedding_court_votes",
    "chat_feedback_user_id_fkey",
    "wedding_payment_ledger_couple_id_fkey",
    "wedding_payment_ledger_created_by_fkey",
    "wedding_payment_ledger_updated_by_fkey",
  ]) {
    assert.match(sql, new RegExp(exactObject));
  }
  assert.match(sql, /pg_catalog\.has_any_column_privilege/i);
});

test("postcheck follows the final server-only chat and dormant segment RPC contracts", () => {
  const sql = readPostcheck();
  const serverIngest = readFileSync(join(
    REPO_ROOT,
    "supabase",
    "migrations",
    "20260812090000_amora_server_only_chat_ingest.sql",
  ), "utf8");
  const segmentDualWrite = readFileSync(join(
    REPO_ROOT,
    "supabase",
    "migrations",
    "20260802120000_amora_conversation_segment_dual_write.sql",
  ), "utf8");

  assert.match(serverIngest, /DROP POLICY IF EXISTS chat_messages_insert_own_user/i);
  assert.match(serverIngest, /has_any_column_privilege[\s\S]*authenticated[\s\S]*INSERT/i);
  assert.match(
    segmentDualWrite,
    /REVOKE EXECUTE ON FUNCTION public\.start_amora_conversation_segment[\s\S]*FROM authenticated/i,
  );
  assert.match(sql, /AS chat_server_only_ingest_boundary_count/i);
  assert.doesNotMatch(sql, /AS chat_partner_recipient_insert_policy_count/i);
  assert.match(
    sql,
    /start_amora_conversation_segment\(uuid,text,uuid,uuid,text\)'::text, 'none'::name,[\s\S]*statement_timeout=15s/i,
  );
  assert.match(
    sql,
    /finalize_amora_preparation_catch_up_v1[\s\S]*search_path=pg_catalog, public, extensions[\s\S]*statement_timeout=30s/i,
  );
  assert.match(sql, /md5\(procedure_record\.prosrc\) = '8697f4a6b29816116d1573e6793fefe2'/i);
  assert.match(
    sql,
    /wedding_payment_ledger_(?:created|updated)_by_fkey[\s\S]*confrelid = pg_catalog\.to_regclass\('public\.profiles'\)/i,
  );
});

test("application feature-off values are not fabricated as database evidence", () => {
  const sql = readPostcheck();
  assert.doesNotMatch(sql, /successor_feature_flags_off_count/i);
  assert.doesNotMatch(sql, /AMORA_(?:OPENAI|TODAY_ONE|PROACTIVE_CHAT)_ENABLED/i);
});

test("PGlite parses and executes the fail-closed postcheck against a minimal empty catalog", async () => {
  const pgliteEntry = join(
    REPO_ROOT,
    "apps",
    "web",
    "node_modules",
    "@electric-sql",
    "pglite",
    "dist",
    "index.js",
  );
  const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
      CREATE TABLE public.chat_messages (id uuid PRIMARY KEY);
      CREATE TABLE public.conversation_segments (id uuid PRIMARY KEY);
      CREATE TABLE public.couples (id uuid PRIMARY KEY);
      CREATE TABLE public.amora_preparation_catch_up_receipts (id uuid PRIMARY KEY);
      CREATE TABLE public.amora_preparation_catch_up_items (id uuid PRIMARY KEY);
      CREATE TABLE public.amora_actions (id uuid PRIMARY KEY);
      CREATE TABLE public.vendor_reviews (id uuid PRIMARY KEY);
      CREATE TABLE public.decision_nodes (id uuid PRIMARY KEY);
      CREATE TABLE public.wedding_journeys (id uuid PRIMARY KEY);
      CREATE TABLE public.couple_plan_change_requests (id uuid PRIMARY KEY);
      CREATE TABLE public.couple_plan_change_acceptances (id uuid PRIMARY KEY);
      CREATE TABLE public.couple_change_notifications (id uuid PRIMARY KEY);
      CREATE TABLE public.wedding_court_votes (id uuid PRIMARY KEY);
      CREATE TABLE public.chat_feedback (id uuid PRIMARY KEY);
      CREATE TABLE public.wedding_payment_ledger (id uuid PRIMARY KEY);
    `);
    const resultSets = await database.exec(readPostcheck());
    const result = resultSets.find((entry) => entry.fields?.some(
      (field) => field.name === "verified",
    ));

    assert.ok(result, "postcheck did not emit its evidence row");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].verified, false);
    for (const field of EXPECTED_EVIDENCE_FIELDS) {
      assert.equal(Number.isSafeInteger(result.rows[0][field]), true, field);
      assert.ok(result.rows[0][field] >= 0, field);
    }
  } finally {
    await database.close();
  }
});
