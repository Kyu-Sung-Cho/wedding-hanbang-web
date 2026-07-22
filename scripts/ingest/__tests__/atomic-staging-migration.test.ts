import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  "supabase/migrations/20260721120000_vendor_disclosure_atomic_batch_staging.sql",
);

test("the atomic disclosure staging migration is resumable, draft-only, pending-only, and service-role-only", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_runs/iu);
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_batches/iu);
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_owned_rows/iu);
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_record_bindings/iu);
  assert.match(sql, /vendor_disclosure_record_bindings_append_only/iu);
  assert.match(sql, /vendor_disclosure_record_bindings_no_truncate/iu);
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_owned_identities/iu);
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_owned_ledger_rows/iu);
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_dedupe_links/iu);
  assert.match(sql, /snapshot_created_by_run boolean NOT NULL DEFAULT false/iu);
  assert.match(sql, /supersedes_run_sha256 text UNIQUE/iu);
  assert.match(
    sql,
    /vendor_disclosure_ingest_runs_one_live_snapshot_idx[\s\S]{0,180}WHERE status IN \('active', 'complete'\)/iu,
  );
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_paid_extraction_attestations/iu);
  assert.match(
    sql,
    /vendor_disclosure_paid_extraction_attestations[\s\S]{0,1400}full_plan_sha256 text NOT NULL[\s\S]{0,500}batch_plan_sha256 text NOT NULL[\s\S]{0,500}batch_sha256 text NOT NULL[\s\S]{0,500}payload_sha256 text NOT NULL[\s\S]{0,500}unit_payload_sha256 text NOT NULL/iu,
  );
  assert.match(sql, /vendor_disclosure_paid_extraction_attestations_append_only/iu);
  assert.match(sql, /vendor_disclosure_paid_extraction_attestations_no_truncate/iu);
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_unit_provider_lineage/iu);
  assert.match(sql, /vendor_disclosure_unit_provider_lineage_append_only/iu);
  assert.match(
    sql,
    /IF p_authorization_kind = 'local_validated_pending_only'\s+OR COALESCE\([\s\S]{0,180}local_deterministic_review_only[\s\S]{0,80}provider_mode_value := 'local_deterministic'/iu,
  );
  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_ingest_storage_links/iu);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.guard_vendor_disclosure_atomic_pending_insert\(\)[\s\S]*current_setting\([\s\S]{0,160}app\.vendor_disclosure_atomic_run_sha256[\s\S]*DISCLOSURE_ATOMIC_OWNERSHIP_CONTEXT_REQUIRED/iu,
  );
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.guard_vendor_disclosure_atomic_pending_insert\(\)[\s\S]{0,260}LANGUAGE plpgsql[\s\S]{0,140}SET search_path[\s\S]*current_user = stage_function_owner/iu,
    "a caller-spoofable custom GUC must also be bound to the postgres-owned staging RPC",
  );
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.guard_vendor_disclosure_atomic_protected_write\(\)[\s\S]*DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED/iu,
  );
  assert.match(
    sql,
    /CREATE TRIGGER price_snapshots_atomic_identity_fence[\s\S]{0,180}BEFORE UPDATE OF source, period_label ON public\.price_snapshots/iu,
  );
  assert.match(
    sql,
    /CREATE TRIGGER official_prices_atomic_protected_write_fence[\s\S]{0,180}BEFORE UPDATE OR DELETE ON public\.official_prices/iu,
  );
  assert.match(
    sql,
    /CREATE TRIGGER official_agency_packages_atomic_protected_write_fence[\s\S]{0,200}BEFORE UPDATE OR DELETE ON public\.official_agency_packages/iu,
  );
  assert.match(
    sql,
    /CREATE TRIGGER disclosure_semantic_atomic_protected_write_fence[\s\S]{0,200}BEFORE UPDATE OR DELETE ON public\.disclosure_semantic_staging/iu,
  );
  assert.match(
    sql,
    /CREATE TRIGGER official_price_options_atomic_protected_write_fence[\s\S]{0,220}BEFORE INSERT OR UPDATE OR DELETE ON public\.official_price_options/iu,
  );
  assert.match(
    sql,
    /abort_vendor_disclosure_ingest_run_atomic[\s\S]*set_config\(\s*'app\.vendor_disclosure_atomic_abort_run_sha256',\s*p_run_sha256,\s*true\s*\)[\s\S]*DELETE FROM public\.disclosure_semantic_staging/iu,
  );
  assert.match(
    sql,
    /invalidate_vendor_disclosure_completed_run_atomic[\s\S]*set_config\(\s*'app\.vendor_disclosure_atomic_invalidate_run_sha256',\s*p_run_sha256,\s*true\s*\)[\s\S]*DELETE FROM public\.disclosure_semantic_staging/iu,
  );
  assert.match(
    sql,
    /guard_official_review_parent_write[\s\S]*PG_CONTEXT[\s\S]*invalidate_vendor_disclosure_completed_run_atomic\(text,text,text,text\)[\s\S]*owned\.row_id = target_row_id[\s\S]*run\.status = 'complete'[\s\S]*run\.snapshot_id = OLD\.snapshot_id/iu,
    "the inherited parent guard must authenticate the exact invalidation call, owned row, and snapshot",
  );
  assert.match(
    sql,
    /guard_vendor_disclosure_atomic_protected_write[\s\S]*PG_CONTEXT[\s\S]*invalidate_vendor_disclosure_completed_run_atomic\(text,text,text,text\)[\s\S]*run\.status = 'complete'[\s\S]*owned\.run_sha256 = invalidation_marker[\s\S]*owned\.row_id = old_parent_price_id/iu,
    "the protected child guard must reject a copied GUC from a different call stack or row",
  );
  assert.match(
    sql,
    /decide_vendor_dedupe_candidate_atomic_inner[\s\S]*app\.vendor_disclosure_atomic_vendor_dedupe_mapping[\s\S]*decide_vendor_dedupe_candidate_atomic_inner/iu,
  );
  assert.match(
    sql,
    /decide_agency_dedupe_candidate_atomic_inner[\s\S]*app\.vendor_disclosure_atomic_agency_dedupe_mapping[\s\S]*decide_agency_dedupe_candidate_atomic_inner/iu,
  );
  assert.match(
    sql,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE[\s\S]{0,220}public\.official_prices[\s\S]{0,220}public\.official_price_options[\s\S]{0,220}FROM service_role/iu,
  );
  assert.match(sql, /CREATE TRIGGER official_prices_atomic_pending_insert_fence[\s\S]{0,180}BEFORE INSERT ON public\.official_prices/iu);
  assert.match(sql, /CREATE TRIGGER official_agency_packages_atomic_pending_insert_fence[\s\S]{0,200}BEFORE INSERT ON public\.official_agency_packages/iu);
  assert.match(sql, /CREATE TRIGGER disclosure_semantic_atomic_pending_insert_fence[\s\S]{0,200}BEFORE INSERT ON public\.disclosure_semantic_staging/iu);
  assert.match(
    sql,
    /PERFORM set_config\(\s*'app\.vendor_disclosure_atomic_run_sha256',\s*p_run_sha256,\s*true\s*\)[\s\S]{0,300}jsonb_array_elements\(p_payload -> 'agency_packages'\)/iu,
  );
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.get_vendor_disclosure_unowned_pending_counts\(\)[\s\S]*row_kind = 'official_price'[\s\S]*row_kind = 'agency_package'[\s\S]*row_kind = 'semantic'/iu,
  );
  assert.match(
    sql,
    /get_vendor_disclosure_admin_preview_scope[\s\S]*get_vendor_disclosure_unowned_pending_counts\(\)[\s\S]{0,500}ADMIN_PREVIEW_UNOWNED_PENDING_KCA_TPRICE/iu,
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.prepare_vendor_disclosure_batch_storage_atomic/iu);
  assert.match(
    sql,
    /prepare_vendor_disclosure_batch_storage_atomic[\s\S]*vendor-disclosure-snapshot-v1:[\s\S]*INSERT INTO public\.price_snapshots[\s\S]*ON CONFLICT \(source, period_label\) DO NOTHING[\s\S]*DISCLOSURE_STORAGE_PREPARE_AMBIGUOUS_INVALIDATED_PREDECESSOR/iu,
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_vendor_disclosure_storage_object_atomic/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.assert_vendor_disclosure_storage_intents_settled/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.stage_vendor_disclosure_batch_atomic/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.verify_vendor_disclosure_batch_receipt_atomic/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.finalize_vendor_disclosure_dedupe_atomic/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.abort_vendor_disclosure_ingest_run_atomic/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.invalidate_vendor_disclosure_completed_run_atomic/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.complete_vendor_disclosure_storage_rollback_atomic/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_vendor_disclosure_admin_preview_scope\(\)/iu);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.get_vendor_disclosure_admin_preview_vendor_scope\(\s*p_vendor_id uuid\s*\)/iu,
  );
  assert.match(
    sql,
    /get_vendor_disclosure_admin_preview_vendor_scope[\s\S]{0,1500}FROM public\.get_vendor_disclosure_admin_preview_scope\(\)[\s\S]{0,200}latest_scope/iu,
  );
  assert.match(
    sql,
    /unnest\(latest_scope\.official_price_ids\)[\s\S]{0,500}price\.vendor_id = p_vendor_id[\s\S]{0,700}unnest\(latest_scope\.semantic_ids\)[\s\S]{0,500}semantic\.partner_vendor_id = p_vendor_id/iu,
  );
  assert.match(
    sql,
    /get_vendor_disclosure_admin_preview_scope[\s\S]*owned\.unit_id = ANY\(batch\.unit_ids\)[\s\S]*ADMIN_PREVIEW_SCOPE_INVALID_OWNERSHIP/iu,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.get_vendor_disclosure_admin_preview_scope\(\)[\s\S]{0,180}FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.get_vendor_disclosure_admin_preview_scope\(\)[\s\S]{0,100}TO service_role/iu,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.get_vendor_disclosure_admin_preview_vendor_scope\(uuid\)[\s\S]{0,180}FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.get_vendor_disclosure_admin_preview_vendor_scope\(uuid\)[\s\S]{0,100}TO service_role/iu,
  );
  assert.match(sql, /jsonb_array_length\(p_payload -> 'units'\)[\s\S]*BETWEEN 1 AND 25/iu);
  assert.match(sql, /FROM public\.price_snapshots AS snapshot[\s\S]*FOR UPDATE/iu);
  assert.match(sql, /snapshot_row\.published[\s\S]*snapshot_row\.is_current/iu);
  assert.match(sql, /LOCK TABLE public\.vendors, public\.agencies IN EXCLUSIVE MODE NOWAIT/iu);
  assert.match(
    sql,
    /LOCK TABLE public\.vendor_dedupe_candidates, public\.agency_dedupe_candidates[\s\S]*IN EXCLUSIVE MODE NOWAIT/iu,
  );
  assert.match(sql, /FROM public\.price_snapshots AS snapshot[\s\S]{0,250}FOR UPDATE NOWAIT/iu);
  assert.match(sql, /FOR UPDATE OF package[\s\S]*FOR UPDATE OF price[\s\S]*FOR UPDATE OF semantic/iu);
  assert.match(sql, /SET lock_timeout = '5s'[\s\S]*SET statement_timeout = '120s'/iu);
  assert.match(sql, /vendor_disclosure_payload_provenance_is_safe\(p_payload\)/iu);
  assert.match(sql, /FROM storage\.objects/iu);
  assert.match(sql, /DISCLOSURE_ATOMIC_UNIT_WITHOUT_ROWS/iu);
  assert.match(sql, /review_status[\s\S]*'pending'/iu);
  assert.match(sql, /status[\s\S]*'pending'/iu);
  assert.match(sql, /ON CONFLICT \(run_sha256, batch_index\)/iu);
  assert.match(sql, /payload_sha256[\s\S]*batch_sha256/iu);
  assert.match(sql, /link\.unit_id = row_value ->> 'unit_id'/iu);
  assert.match(sql, /row_value ->> 'needs_review'\)::boolean/iu);
  assert.match(sql, /GET DIAGNOSTICS affected_rows = ROW_COUNT/iu);
  assert.match(sql, /DISCLOSURE_ATOMIC_LEDGER_CONFLICT/iu);
  assert.match(sql, /created_by_run[\s\S]*retained_shared/iu);
  assert.match(sql, /FROM public\.ai_interactions_log AS ledger[\s\S]{0,180}FOR SHARE/iu);
  assert.match(
    sql,
    /JOIN public\.vendor_disclosure_paid_extraction_attestations AS attestation[\s\S]*attestation\.request_hash = ledger\.metadata ->> 'request_hash'[\s\S]*attestation\.source_fingerprint = row_value ->> 'source_fingerprint'[\s\S]*attestation\.validation_fingerprint = row_value ->> 'validation_fingerprint'/iu,
  );
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.vendor_disclosure_unit_payload_sha256\([\s\S]*p_payload jsonb[\s\S]*p_unit_id text[\s\S]*RETURNS text/iu,
  );
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.vendor_disclosure_persisted_unit_payload_sha256\([\s\S]*p_run_sha256 text[\s\S]*p_unit_id text[\s\S]*RETURNS text/iu,
  );
  assert.match(
    sql,
    /vendor_disclosure_unit_payload_sha256[\s\S]*'record_ref', COALESCE\([\s\S]{0,180}partner_record_ref[\s\S]{0,180}source_record_key/iu,
  );
  assert.match(
    sql,
    /vendor_disclosure_persisted_unit_payload_sha256[\s\S]*JOIN public\.vendor_disclosure_ingest_record_bindings AS binding[\s\S]*'record_ref', binding\.record_ref/iu,
  );
  assert.match(sql, /owned_ledger\.created_by_run = true[\s\S]{0,100}owned_ledger\.cleanup_status = 'owned'/iu);
  assert.match(
    sql,
    /FROM public\.vendor_disclosure_ingest_owned_ledger_rows AS any_owner[\s\S]{0,100}any_owner\.ledger_id = owned_ledger\.ledger_id/iu,
  );
  assert.match(sql, /local_deterministic_review_only[\s\S]*needs_review/iu);
  assert.match(sql, /DISCLOSURE_ATOMIC_UNPRICED_ROW_REVIEW_ONLY/iu);
  assert.match(sql, /COALESCE\(price\.value -> 'price_min_krw', 'null'::jsonb\)/iu);
  assert.match(sql, /DISCLOSURE_ATOMIC_FOUR_TAB_CATEGORY_ONLY/iu);
  assert.match(
    sql,
    /price\.value ->> 'category' IS NULL[\s\S]{0,160}price\.value ->> 'category' NOT IN \('studio', 'dress', 'makeup', 'hall'\)[\s\S]{0,500}semantic\.value ->> 'vendor_category' IS NULL[\s\S]{0,160}semantic\.value ->> 'vendor_category' NOT IN \('studio', 'dress', 'makeup', 'hall'\)/iu,
  );
  assert.match(sql, /DISCLOSURE_DEDUPE_LOCAL_UNIT_SET_INCOMPLETE/iu);
  assert.match(sql, /package\.review_version <> 0[\s\S]*price\.review_version <> 0/iu);
  assert.match(sql, /vendor-disclosure-storage-v1:/iu);
  assert.match(sql, /user_metadata ->> 'ingest_run_sha256'/iu);
  assert.match(sql, /ownership_state = 'delete_authorized'/iu);
  assert.match(sql, /confirmed_inherited/iu);
  assert.match(sql, /DISCLOSURE_ABORT_STORAGE_HANDOFF_RACE/iu);
  assert.match(sql, /upload_claim_epoch bigint NOT NULL DEFAULT 0/iu);
  assert.match(sql, /upload_claim_token uuid/iu);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_vendor_disclosure_storage_object_atomic/iu);
  assert.match(
    sql,
    /record_vendor_disclosure_storage_object_atomic\([\s\S]{0,400}p_claim_token uuid,[\s\S]{0,100}p_claim_epoch bigint/iu,
  );
  assert.match(sql, /ingest_claim_token[\s\S]{0,180}ingest_claim_epoch/iu);
  const abortStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.abort_vendor_disclosure_ingest_run_atomic");
  const abortEnd = sql.indexOf("$abort_vendor_disclosure_ingest_run_atomic$;", abortStart);
  const abortSql = sql.slice(abortStart, abortEnd);
  const firstClaimFence = abortSql.indexOf(
    "PERFORM public.assert_vendor_disclosure_storage_upload_claims_settled(p_run_sha256)",
  );
  const intentReconciliation = abortSql.indexOf(
    "SET ownership_state = 'ambiguous'",
    firstClaimFence,
  );
  const finalClaimFence = abortSql.indexOf(
    "PERFORM public.assert_vendor_disclosure_storage_upload_claims_settled(p_run_sha256)",
    firstClaimFence + 1,
  );
  const finalIntentFence = abortSql.indexOf(
    "PERFORM public.assert_vendor_disclosure_storage_intents_settled(p_run_sha256)",
  );
  const abortedStatusWrite = abortSql.indexOf("SET status = 'aborted'");
  assert.ok(firstClaimFence > 0 && firstClaimFence < intentReconciliation);
  assert.ok(intentReconciliation < finalClaimFence && finalClaimFence < finalIntentFence);
  assert.ok(finalIntentFence < abortedStatusWrite);
  assert.match(sql, /DISCLOSURE_ABORT_VENDOR_HANDOFF_RACE/iu);
  assert.match(sql, /DISCLOSURE_ABORT_AGENCY_HANDOFF_RACE/iu);
  assert.match(sql, /vendor-disclosure-identity-v1:/iu);
  assert.match(sql, /link\.ownership_state = 'intent' OR \([\s\S]{0,180}object\.id = link\.storage_object_id/iu);
  assert.match(sql, /DELETE FROM public\.vendor_timeslots/iu);
  assert.match(sql, /DELETE FROM public\.ai_interactions_log/iu);
  assert.match(sql, /DELETE FROM public\.vendors/iu);
  assert.match(sql, /DELETE FROM public\.agencies/iu);
  assert.match(sql, /storage_rollback_objects/iu);
  assert.match(sql, /storage_object_outcomes/iu);
  assert.match(sql, /storage_rollback_receipt_sha256/iu);
  assert.match(
    sql,
    /complete_vendor_disclosure_storage_rollback_atomic\([\s\S]{0,220}p_storage_rollback_receipt_sha256 text[\s\S]*DISCLOSURE_STORAGE_ROLLBACK_COMPLETE_RECEIPT_CONFLICT/iu,
  );
  assert.match(
    sql,
    /LOCK TABLE storage\.objects IN SHARE ROW EXCLUSIVE MODE NOWAIT[\s\S]{0,300}DISCLOSURE_STORAGE_ROLLBACK_OBJECT_STILL_EXISTS/iu,
  );
  assert.match(
    sql,
    /complete_vendor_disclosure_storage_rollback_atomic[\s\S]*PERFORM public\.assert_vendor_disclosure_storage_intents_settled\(p_run_sha256\)[\s\S]{0,180}PERFORM public\.assert_vendor_disclosure_storage_upload_claims_settled\(p_run_sha256\)[\s\S]*LOCK TABLE storage\.objects IN SHARE ROW EXCLUSIVE MODE NOWAIT/iu,
  );
  assert.match(sql, /status IN \('active', 'complete', 'invalidated', 'aborted'\)/iu);
  assert.match(
    sql,
    /invalidate_vendor_disclosure_completed_run_atomic[\s\S]*vendor-disclosure-bulk-approval-v1[\s\S]*pg_advisory_xact_lock\(20260718, 20300\)[\s\S]*DISCLOSURE_INVALIDATE_SNAPSHOT_NOT_DRAFT[\s\S]*DISCLOSURE_INVALIDATE_REVIEWED_OR_EDITED_ROWS_FORBIDDEN[\s\S]*cleanup_manifest_sha256[\s\S]*DELETE FROM public\.official_prices[\s\S]*SET status = 'invalidated'/iu,
  );
  assert.match(
    sql,
    /SELECT count\(\*\)::integer[\s\S]{0,1000}IF eligible_run_count > 1 THEN[\s\S]{0,120}ADMIN_PREVIEW_SCOPE_AMBIGUOUS_COMPLETED_RUNS/iu,
  );
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public, pg_temp/iu);
  assert.doesNotMatch(sql, /^END\r?$/gmu);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.stage_vendor_disclosure_batch_atomic[\s\S]*FROM PUBLIC, anon, authenticated/iu);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.ensure_vendor_disclosure_agency_pending[\s\S]{0,200}FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.vendor_disclosure_ingest_runs FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.vendor_disclosure_ingest_unit_provider_lineage FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.vendor_disclosure_ingest_record_bindings FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.guard_vendor_disclosure_atomic_pending_insert\(\)[\s\S]{0,100}FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.get_vendor_disclosure_unowned_pending_counts\(\)[\s\S]{0,100}TO service_role/iu,
  );
  assert.doesNotMatch(
    sql,
    /GRANT\s+(?:SELECT,\s*)?(?:INSERT|UPDATE|DELETE)[^;]*vendor_disclosure_ingest_record_bindings/iu,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.vendor_disclosure_paid_extraction_attestations FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.doesNotMatch(
    sql,
    /GRANT\s+(?:SELECT,\s*)?(?:INSERT|UPDATE|DELETE)[^;]*vendor_disclosure_paid_extraction_attestations/iu,
  );
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.stage_vendor_disclosure_batch_atomic[\s\S]*TO service_role/iu);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.prepare_vendor_disclosure_batch_storage_atomic[\s\S]*TO service_role/iu);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_vendor_disclosure_storage_object_atomic[\s\S]*TO service_role/iu);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.record_vendor_disclosure_storage_object_atomic[\s\S]*TO service_role/iu);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.verify_vendor_disclosure_batch_receipt_atomic[\s\S]*TO service_role/iu);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.complete_vendor_disclosure_storage_rollback_atomic[\s\S]*TO service_role/iu);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.invalidate_vendor_disclosure_completed_run_atomic[\s\S]*TO service_role/iu);
  assert.doesNotMatch(sql, /GRANT\s+(?:SELECT,\s*)?(?:INSERT|UPDATE|DELETE)[^;]*vendor_disclosure_ingest_(?:runs|batches|identity_links|owned_rows)/iu);
  const stageStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.stage_vendor_disclosure_batch_atomic");
  const finalizerStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.finalize_vendor_disclosure_dedupe_atomic");
  const stageSql = sql.slice(stageStart, finalizerStart);
  assert.ok(
    stageSql.indexOf("DISCLOSURE_ATOMIC_RUN_INVALIDATED")
      < stageSql.indexOf("IF stored_batch.id IS NOT NULL THEN"),
    "an invalidated run must fail before exact batch replay can return success",
  );
  assert.match(
    stageSql,
    /payload_sha256_value := encode\(extensions\.digest\(convert_to\(p_payload::text, 'UTF8'\), 'sha256'\), 'hex'\)[\s\S]*attestation\.full_plan_sha256 = p_full_plan_sha256[\s\S]*attestation\.batch_plan_sha256 = p_batch_plan_sha256[\s\S]*attestation\.batch_sha256 = p_batch_sha256[\s\S]*attestation\.payload_sha256 = payload_sha256_value[\s\S]*attestation\.unit_payload_sha256 = unit_payload_sha256_value/iu,
  );
  assert.doesNotMatch(
    stageSql,
    /INSERT INTO public\.vendor_disclosure_paid_extraction_attestations/iu,
    "the caller-driven staging RPC must never mint its own paid attestation",
  );
  assert.match(
    stageSql,
    /INSERT INTO public\.vendor_disclosure_ingest_record_bindings[\s\S]*'agency_package'[\s\S]*INSERT INTO public\.vendor_disclosure_ingest_record_bindings[\s\S]*'official_price'[\s\S]*INSERT INTO public\.vendor_disclosure_ingest_record_bindings[\s\S]*'semantic'/iu,
  );
  assert.ok(
    stageSql.indexOf("IF stored_batch.id IS NOT NULL THEN")
      < stageSql.indexOf("DISCLOSURE_ATOMIC_SNAPSHOT_NOT_DRAFT"),
    "an exact committed batch replay must return before the mutable draft-snapshot gate",
  );
  const finalizerSql = sql.slice(finalizerStart);
  assert.ok(
    finalizerSql.indexOf("DISCLOSURE_DEDUPE_RUN_INVALIDATED")
      < finalizerSql.indexOf("IF run_row.dedupe_finalized_at IS NOT NULL THEN"),
    "an invalidated run must fail before exact finalizer replay can return success",
  );
  const receiptStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.verify_vendor_disclosure_batch_receipt_atomic",
  );
  const receiptSql = sql.slice(receiptStart, finalizerStart);
  assert.match(receiptSql, /run_row\.status NOT IN \('active', 'complete'\)/iu);
  assert.ok(
    finalizerSql.indexOf("IF run_row.dedupe_finalized_at IS NOT NULL THEN")
      < finalizerSql.indexOf("DISCLOSURE_DEDUPE_SNAPSHOT_NOT_DRAFT"),
    "an exact finalizer replay must return before the mutable draft-snapshot gate",
  );
  assert.doesNotMatch(sql, /UPDATE\s+public\.price_snapshots\s+SET\s+published\s*=\s*true/iu);
  assert.doesNotMatch(sql, /review_status\s*[,)]?\s*(?:VALUES\s*)?\(?\s*'approved'/iu);
});

test("bulk approval is an atomic paid-pilot-only database contract with a human-bound fingerprint", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE public\.vendor_disclosure_bulk_approval_audits/iu);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.get_vendor_disclosure_bulk_approval_eligibility\(\s*p_actor_id uuid,\s*p_batch_limit integer\s*\)[\s\S]*RETURNS jsonb/iu,
  );
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.approve_vendor_disclosure_validated_batch\(\s*p_actor_id uuid,\s*p_batch_limit integer,\s*p_expected_eligible_count integer,\s*p_expected_eligibility_sha256 text\s*\)[\s\S]*RETURNS jsonb/iu,
  );
  assert.match(sql, /p_batch_limit BETWEEN 1 AND 25/iu);
  assert.match(sql, /actor_profile\.id = p_actor_id[\s\S]{0,120}actor_profile\.is_admin = true/iu);
  assert.match(sql, /authorization_kind = 'paid_pilot_gate'/iu);
  assert.match(sql, /provider_lineage\.provider_mode = 'production_paid'/iu);
  assert.match(sql, /provider_lineage\.bulk_approval_eligible = true/iu);
  assert.match(
    sql,
    /JOIN public\.get_vendor_disclosure_admin_preview_scope\(\) AS latest_scope[\s\S]{0,300}latest_scope\.official_price_ids/iu,
  );
  assert.match(sql, /JOIN public\.vendor_disclosure_paid_extraction_attestations AS paid_attestation/iu);
  assert.match(
    sql,
    /JOIN public\.vendor_disclosure_ingest_record_bindings AS price_binding[\s\S]*price_binding\.vendor_id = price\.vendor_id[\s\S]*price_binding\.agency_id IS NOT DISTINCT FROM price\.agency_id/iu,
  );
  assert.match(
    sql,
    /paid_attestation\.full_plan_sha256 = run\.full_plan_sha256[\s\S]*paid_attestation\.batch_plan_sha256 = batch\.batch_plan_sha256[\s\S]*paid_attestation\.batch_sha256 = batch\.batch_sha256[\s\S]*paid_attestation\.payload_sha256 = batch\.payload_sha256[\s\S]*paid_attestation\.unit_payload_sha256\s*=\s*public\.vendor_disclosure_persisted_unit_payload_sha256\([\s\S]{0,160}owned\.unit_id/iu,
  );
  assert.match(sql, /provider_owned_ledger\.created_by_run = true/iu);
  assert.match(sql, /provider_owned_ledger\.cleanup_status = 'owned'/iu);
  assert.match(
    sql,
    /provider_ledger\.metadata ->> 'paid_plan_sha256' = provider_lineage\.paid_plan_sha256/iu,
  );
  assert.match(sql, /run\.status = 'complete'/iu);
  assert.match(sql, /run\.dedupe_finalized_at IS NOT NULL/iu);
  assert.match(sql, /cardinality\(run\.local_pending_only_unit_ids\) = 0/iu);
  assert.match(sql, /price\.review_status = 'pending'/iu);
  assert.match(sql, /price\.needs_review = false/iu);
  assert.match(sql, /price\.confidence >= 0\.9/iu);
  assert.match(sql, /cardinality\(price\.validation_issue_codes\) = 0/iu);
  assert.match(sql, /snapshot\.published = false/iu);
  assert.match(sql, /snapshot\.is_current = false/iu);
  assert.match(sql, /vendor\.status = 'approved'/iu);
  assert.match(sql, /vendor\.merged_into_vendor_id IS NULL/iu);
  assert.match(sql, /agency\.is_active = true/iu);
  assert.match(sql, /agency\.merged_into_agency_id IS NULL/iu);
  assert.match(sql, /FROM public\.vendor_dedupe_candidates/iu);
  assert.match(sql, /FROM public\.agency_dedupe_candidates/iu);
  assert.match(sql, /FROM public\.vendor_alias_proposals/iu);
  assert.match(sql, /FROM public\.official_price_options/iu);
  assert.match(sql, /option_row\.source_quote/iu);
  assert.match(sql, /option_row\.source_object_keys/iu);
  assert.match(sql, /extensions\.digest\([\s\S]*'sha256'/iu);
  assert.match(sql, /ORDER BY[\s\S]{0,240}price_id/iu);
  assert.match(sql, /BULK_APPROVAL_ELIGIBILITY_CHANGED/iu);
  assert.match(sql, /LOCK TABLE public\.vendor_dedupe_candidates/iu);
  assert.match(
    sql,
    /LOCK TABLE[\s\S]*vendor_disclosure_paid_extraction_attestations[\s\S]*IN SHARE MODE NOWAIT/iu,
  );
  assert.match(
    sql,
    /LOCK TABLE[\s\S]*vendor_disclosure_ingest_record_bindings[\s\S]*IN SHARE MODE NOWAIT/iu,
  );
  assert.match(
    sql,
    /WHEN 'official_price' THEN[\s\S]*sibling_binding\.vendor_id IS DISTINCT FROM sibling_price\.vendor_id[\s\S]*WHEN 'agency_package' THEN[\s\S]*sibling_binding\.agency_id IS DISTINCT FROM sibling_package\.agency_id[\s\S]*WHEN 'semantic' THEN[\s\S]*sibling_binding\.vendor_id IS DISTINCT FROM sibling_semantic\.partner_vendor_id/iu,
  );
  assert.match(sql, /JOIN storage\.objects AS raw_object/iu);
  assert.match(sql, /JOIN storage\.objects AS preview_object/iu);
  assert.match(sql, /split_part\(raw_link\.object_name, '\.', 1\) = raw_link\.object_sha256/iu);
  assert.match(sql, /raw_object\.id = raw_link\.storage_object_id/iu);
  assert.match(sql, /raw_object\.updated_at = raw_link\.storage_object_updated_at/iu);
  assert.match(sql, /raw_bucket\.public = false/iu);
  assert.match(sql, /raw_object\.user_metadata ->> 'ingest_sha256' = raw_link\.object_sha256/iu);
  assert.match(sql, /preview_object\.user_metadata ->> 'ingest_sha256' = preview_link\.object_sha256/iu);
  assert.doesNotMatch(
    sql,
    /storage_metadata_owner_run_sha256 IS NULL[\s\S]{0,250}NOT COALESCE\([^)]*user_metadata \? 'ingest_sha256'/iu,
  );
  const approvalStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.approve_vendor_disclosure_validated_batch",
  );
  const approvalEnd = sql.indexOf(
    "$approve_vendor_disclosure_validated_batch$;",
    approvalStart,
  );
  const approvalSql = sql.slice(approvalStart, approvalEnd);
  const domainTableLockStart = approvalSql.indexOf("LOCK TABLE");
  const domainTableLockEnd = approvalSql.indexOf(
    "IN SHARE MODE NOWAIT;",
    domainTableLockStart,
  );
  const domainTableLock = approvalSql.slice(
    domainTableLockStart,
    domainTableLockEnd,
  );
  assert.doesNotMatch(domainTableLock, /public\.ai_interactions_log/iu);
  assert.doesNotMatch(domainTableLock, /storage\.(?:buckets|objects)/iu);
  assert.match(
    approvalSql,
    /FROM public\.ai_interactions_log AS provider_ledger[\s\S]{0,900}FOR SHARE OF provider_ledger NOWAIT/iu,
  );
  assert.match(
    approvalSql,
    /FROM storage\.buckets AS storage_bucket[\s\S]{0,1500}FOR SHARE OF storage_bucket NOWAIT/iu,
  );
  assert.match(
    approvalSql,
    /FROM storage\.objects AS storage_object[\s\S]{0,1800}FOR SHARE OF storage_object NOWAIT/iu,
  );
  const firstCandidateRead = approvalSql.indexOf(
    "public.vendor_disclosure_bulk_approval_candidates(p_batch_limit)",
  );
  const parentLock = approvalSql.indexOf("FOR UPDATE", firstCandidateRead);
  const recomputedCandidateRead = approvalSql.indexOf(
    "public.vendor_disclosure_bulk_approval_candidates(p_batch_limit)",
    parentLock,
  );
  assert.ok(firstCandidateRead >= 0 && parentLock > firstCandidateRead);
  assert.ok(recomputedCandidateRead > parentLock);
  for (const exactLock of [
    "FOR SHARE OF provider_ledger NOWAIT",
    "FOR SHARE OF storage_bucket NOWAIT",
    "FOR SHARE OF storage_object NOWAIT",
  ]) {
    const lockIndex = approvalSql.indexOf(exactLock);
    assert.ok(lockIndex > parentLock && lockIndex < recomputedCandidateRead);
  }
  assert.match(
    sql,
    /PERFORM public\.review_official_price\([\s\S]{0,500}'approve'[\s\S]{0,500}review_version/iu,
  );
  assert.match(sql, /INSERT INTO public\.vendor_disclosure_bulk_approval_audits/iu);
  assert.match(sql, /approval_receipt_sha256/iu);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.get_vendor_disclosure_bulk_approval_eligibility\(uuid, integer\)[\s\S]{0,180}FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.approve_vendor_disclosure_validated_batch\(\s*uuid, integer, integer, text\s*\)[\s\S]{0,100}TO service_role/iu,
  );
});
