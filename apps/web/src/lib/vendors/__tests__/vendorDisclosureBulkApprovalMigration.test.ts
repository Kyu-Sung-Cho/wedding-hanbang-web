// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721120000_vendor_disclosure_atomic_batch_staging.sql",
  ),
  "utf8",
);
const unitIdsStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_unit_ids_are_safe",
);
const unitIdsEnd = migration.indexOf(
  "CREATE TABLE public.vendor_disclosure_ingest_batches",
  unitIdsStart,
);
const unitIdsSql = migration.slice(unitIdsStart, unitIdsEnd);
const bulkStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_uuid_batch_is_safe",
);
const previewStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.get_vendor_disclosure_unowned_pending_counts",
);
const previewEnd = migration.indexOf(
  "-- The admin UI first reads an eligibility count",
  previewStart,
);
const previewScopeSql = migration.slice(previewStart, previewEnd);
const atomicInsertFenceStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.guard_vendor_disclosure_atomic_pending_insert",
);
const atomicInsertFenceEnd = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_payload_provenance_is_safe",
  atomicInsertFenceStart,
);
const atomicInsertFenceSql = migration.slice(
  atomicInsertFenceStart,
  atomicInsertFenceEnd,
);
const invalidationStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.invalidate_vendor_disclosure_completed_run_atomic",
);
const invalidationEnd = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_identity_has_external_references",
  invalidationStart,
);
const invalidationSql = migration.slice(invalidationStart, invalidationEnd);
const paidAttestationStart = migration.indexOf(
  "CREATE TABLE public.vendor_disclosure_paid_extraction_attestations",
);
const paidAttestationEnd = migration.indexOf(
  "-- Immutable, per-unit provider lineage.",
  paidAttestationStart,
);
const paidAttestationSql = migration.slice(
  paidAttestationStart,
  paidAttestationEnd,
);
const recordBindingStart = migration.indexOf(
  "CREATE TABLE public.vendor_disclosure_ingest_record_bindings",
);
const recordBindingEnd = migration.indexOf(
  "CREATE TABLE public.vendor_disclosure_ingest_owned_identities",
  recordBindingStart,
);
const recordBindingSql = migration.slice(recordBindingStart, recordBindingEnd);
const unitPayloadStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_unit_payload_sha256",
);
const unitPayloadEnd = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.prepare_vendor_disclosure_batch_storage_atomic",
  unitPayloadStart,
);
const unitPayloadSql = migration.slice(unitPayloadStart, unitPayloadEnd);
const bulkEnd = migration.indexOf(
  "-- Preserve the existing dedupe implementations behind a marker-owning RPC",
  bulkStart,
);
const bulkApprovalSql = migration.slice(bulkStart, bulkEnd);

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const VENDOR_B_ID = "20000000-0000-4000-8000-000000000002";
const AGENCY_ID = "21000000-0000-4000-8000-000000000001";
const AGENCY_B_ID = "21000000-0000-4000-8000-000000000002";
const SNAPSHOT_ID = "30000000-0000-4000-8000-000000000001";
const PRICE_ID = "40000000-0000-4000-8000-000000000001";
const PRICE_B_ID = "40000000-0000-4000-8000-000000000002";
const PACKAGE_ID = "41000000-0000-4000-8000-000000000001";
const OPTION_ID = "42000000-0000-4000-8000-000000000001";
const OPTION_B_ID = "42000000-0000-4000-8000-000000000002";
const SEMANTIC_ID = "40000000-0000-4000-8000-000000000003";
const RUN_SHA = "1".repeat(64);
const UNIT_ID = "2".repeat(64);
const RAW_SHA = "3".repeat(64);
const PREVIEW_SHA = "4".repeat(64);
const RAW_KEY = `${RAW_SHA}.pdf`;
const PREVIEW_KEY = `${PREVIEW_SHA}.txt`;
const LEDGER_ID = "50000000-0000-4000-8000-000000000001";
const RAW_OBJECT_ID = "60000000-0000-4000-8000-000000000001";
const PREVIEW_OBJECT_ID = "70000000-0000-4000-8000-000000000001";
const STORAGE_UPDATED_AT = "2026-07-21T00:00:00.000Z";
const PAID_PLAN_SHA = "a".repeat(64);
const PROVIDER_MODEL = "gpt-5.6-luna-2026-07-15";
const REQUEST_HASH = "b".repeat(64);
const SOURCE_FINGERPRINT = "c".repeat(64);
const CONVERSION_FINGERPRINT = "d".repeat(64);
const EXTRACTION_FINGERPRINT = "e".repeat(64);
const VALIDATION_FINGERPRINT = "f".repeat(64);
const FULL_PLAN_SHA = "6".repeat(64);
const BATCH_PLAN_SHA = "c".repeat(64);
const BATCH_SHA = "b".repeat(64);
const PAYLOAD_SHA = "d".repeat(64);
const UNBOUND_UNIT_PAYLOAD_SHA = "0".repeat(64);
const NEWER_RUN_SHA = "6".repeat(64);
const NEWER_UNIT_ID = "7".repeat(64);
const NEWER_SNAPSHOT_ID = "30000000-0000-4000-8000-000000000002";
const NEWER_PRICE_ID = "40000000-0000-4000-8000-000000000002";

interface EligibilityResult {
  eligibility_contract_version: number;
  batch_eligible_count: number;
  has_more: boolean;
  eligibility_sha256: string | null;
}

interface ApprovalResult {
  eligibility_contract_version: number;
  approved_count: number;
  approved_price_ids: string[];
  approval_receipt_sha256: string;
}

interface PreviewScopeResult {
  run_sha256: string;
  snapshot_id: string;
  period_label: string;
  unit_ids: string[];
  official_price_ids: string[];
  semantic_ids: string[];
}

function jsonbLiteral(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

async function databaseJsonbSha256(db: PGlite, value: unknown): Promise<string> {
  const result = await db.query<{ value: string }>(`
    SELECT encode(extensions.digest(
      convert_to((${jsonbLiteral(value)})::text, 'UTF8'),
      'sha256'
    ), 'hex') AS value
  `);
  return result.rows[0]!.value;
}

async function payloadUnitSha256(
  db: PGlite,
  payload: unknown,
): Promise<string> {
  const result = await db.query<{ value: string }>(`
    SELECT public.vendor_disclosure_unit_payload_sha256(
      ${jsonbLiteral(payload)}, '${UNIT_ID}'
    ) AS value
  `);
  return result.rows[0]!.value;
}

function paidPayloadWithPrice(
  price: number,
  semanticContent = "취소 규정 원문",
) {
  return {
    agency_packages: [],
    official_prices: [{
      unit_id: UNIT_ID,
      category: "studio",
      item_name: "Synthetic basic",
      base_spec: null,
      price_min_krw: price,
      price_max_krw: price,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: false,
      validation_issue_codes: [],
      source_file: "synthetic.pdf",
      source_object_keys: [RAW_KEY],
      source_preview_keys: [PREVIEW_KEY],
      source_quote: "100,000원",
      confidence: 0.95,
      source_record_key: "5".repeat(64),
    }],
    disclosure_semantics: [{
      schema_version: 2,
      unit_id: UNIT_ID,
      record_kind: "document_section",
      semantic_type: "notice",
      subject_kind: "agency",
      subject_name: "Synthetic Studio",
      subject_normalized_name: "syntheticstudio",
      vendor_category: null,
      region_code: "11",
      title: "취소 규정",
      content_verbatim: semanticContent,
      summary: "취소 규정 요약",
      partner_record_ref: null,
      source_agency: null,
      partner_link_status: "not_applicable",
      review_status: "pending",
      needs_review: false,
      validation_issue_codes: [],
      source_file_ids: [RAW_SHA],
      source_file: "synthetic.pdf",
      source_object_keys: [RAW_KEY],
      source_preview_keys: [PREVIEW_KEY],
      source_quote: "취소 규정 원문",
      source_fingerprint: SOURCE_FINGERPRINT,
      validation_fingerprint: VALIDATION_FINGERPRINT,
      confidence: 0.95,
      source_record_key: "7".repeat(64),
      content_fingerprint: "8".repeat(64),
    }],
  };
}

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA extensions;
    CREATE SCHEMA storage;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      public boolean NOT NULL
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY,
      bucket_id text NOT NULL,
      name text NOT NULL,
      updated_at timestamptz NOT NULL,
      metadata jsonb NOT NULL,
      user_metadata jsonb NOT NULL
    );

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text,
      category text,
      region_code text,
      status text,
      merged_into_vendor_id uuid,
      updated_at timestamptz
    );
    CREATE TABLE public.agencies (
      id uuid PRIMARY KEY,
      name text,
      normalized_name text,
      region_code text,
      is_active boolean,
      merged_into_agency_id uuid,
      updated_at timestamptz
    );
    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      published boolean,
      is_current boolean,
      published_at date,
      source text,
      period_label text
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid,
      vendor_id uuid,
      agency_id uuid,
      category text,
      item_name text,
      base_spec text,
      price_min_krw integer,
      price_max_krw integer,
      vat_note text,
      price_note text,
      review_status text,
      needs_review boolean,
      validation_issue_codes text[],
      source_file text,
      source_quote text,
      source_object_keys text[],
      source_preview_keys text[],
      source_record_key text,
      confidence numeric,
      edited_by_admin boolean,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint,
      updated_at timestamptz
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY,
      official_price_id uuid,
      name text,
      price_min_krw integer,
      price_max_krw integer,
      unit text,
      condition text,
      raw_text text,
      source_file text,
      source_quote text,
      source_object_keys text[],
      confidence numeric
    );
    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY,
      agency_id uuid,
      package_name text,
      category_scope text[],
      price_min_krw integer,
      price_max_krw integer,
      vat_note text,
      price_note text,
      options jsonb,
      review_status text,
      needs_review boolean,
      validation_issue_codes text[],
      confidence numeric,
      snapshot_id uuid,
      source_file text,
      source_object_keys text[],
      source_preview_keys text[],
      source_quote text,
      edited_by_admin boolean DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint DEFAULT 0
    );
    CREATE TABLE public.disclosure_semantic_staging (
      id uuid PRIMARY KEY,
      schema_version smallint,
      unit_id text,
      record_kind text,
      semantic_type text,
      subject_kind text,
      subject_name text,
      subject_normalized_name text,
      vendor_category text,
      region_code text,
      title text,
      content_verbatim text,
      summary text,
      partner_record_ref text,
      partner_vendor_id uuid,
      official_price_id uuid,
      source_agency jsonb,
      partner_link_status text,
      review_status text,
      needs_review boolean,
      validation_issue_codes text[],
      confidence numeric,
      source_fingerprint text,
      validation_fingerprint text,
      snapshot_id uuid,
      source_file_ids text[],
      source_file text,
      source_object_keys text[],
      source_preview_keys text[],
      source_quote text,
      source_record_key text,
      content_fingerprint text
    );
    CREATE TABLE public.vendor_dedupe_candidates (
      left_vendor_id uuid,
      right_vendor_id uuid,
      status text,
      reason text,
      similarity numeric
    );
    CREATE TABLE public.agency_dedupe_candidates (
      left_agency_id uuid,
      right_agency_id uuid,
      status text,
      reason text,
      similarity numeric
    );
    CREATE TABLE public.vendor_alias_proposals (official_price_id uuid);
    CREATE TABLE public.official_review_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_kind text,
      entity_id uuid,
      actor_id uuid,
      action text,
      from_review_version bigint,
      to_review_version bigint,
      change_hash text
    );
    CREATE TABLE public.vendor_disclosure_ingest_runs (
      run_sha256 text PRIMARY KEY,
      target_project_ref text DEFAULT 'staging-ref',
      full_plan_sha256 text,
      authorization_kind text,
      authorization_sha256 text,
      local_pending_only_unit_ids text[],
      status text,
      completed_batch_count integer,
      batch_count integer,
      dedupe_finalized_at timestamptz,
      dedupe_candidates_sha256 text,
      dedupe_payload_sha256 text,
      snapshot_id uuid,
      snapshot_source text,
      snapshot_period text,
      invalidated_at timestamptz,
      invalidation_reason text,
      invalidation_receipt_sha256 text,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.vendor_disclosure_ingest_batches (
      run_sha256 text,
      batch_index integer,
      batch_sha256 text,
      batch_plan_sha256 text,
      payload_sha256 text,
      batch_receipt_sha256 text,
      unit_ids text[],
      staged_record_count integer,
      needs_review_count integer
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_rows (
      run_sha256 text,
      batch_index integer,
      unit_id text,
      row_kind text,
      row_id uuid
    );
    CREATE TABLE public.vendor_disclosure_ingest_identity_links (
      run_sha256 text,
      unit_id text,
      identity_kind text,
      official_price_id uuid,
      vendor_id uuid,
      agency_id uuid,
      record_ref text DEFAULT ''
    );
    CREATE TABLE public.vendor_disclosure_ingest_record_bindings (
      run_sha256 text,
      batch_index integer,
      unit_id text,
      row_kind text,
      row_id uuid,
      record_ref text,
      vendor_id uuid,
      agency_id uuid,
      linked_official_price_id uuid,
      binding_sha256 text
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_ledger_rows (
      run_sha256 text,
      batch_index integer,
      ledger_id uuid,
      created_by_run boolean,
      cleanup_status text
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_identities (
      run_sha256 text,
      batch_index integer,
      identity_kind text,
      identity_id uuid,
      parent_vendor_id uuid,
      initial_row_sha256 text,
      cleanup_status text
    );
    CREATE TABLE public.vendor_disclosure_ingest_dedupe_links (
      run_sha256 text,
      entity_kind text,
      left_identity_id uuid,
      right_identity_id uuid,
      reason text,
      similarity numeric,
      created_by_run boolean,
      initial_candidate_sha256 text,
      cleanup_status text
    );
    CREATE TABLE public.vendor_disclosure_paid_extraction_attestations (
      run_sha256 text,
      batch_index integer,
      unit_id text,
      ledger_id uuid,
      request_hash text,
      paid_plan_sha256 text,
      provider_model text,
      source_fingerprint text,
      conversion_fingerprint text,
      extraction_fingerprint text,
      validation_fingerprint text,
      full_plan_sha256 text,
      batch_plan_sha256 text,
      batch_sha256 text,
      payload_sha256 text,
      unit_payload_sha256 text,
      attestation_sha256 text
    );
    CREATE TABLE public.vendor_disclosure_ingest_unit_provider_lineage (
      run_sha256 text,
      batch_index integer,
      unit_id text,
      provider_mode text,
      paid_plan_sha256 text,
      successful_ledger_id uuid,
      provider_model text,
      request_hash text,
      source_fingerprint text,
      conversion_fingerprint text,
      extraction_fingerprint text,
      validation_fingerprint text,
      paid_attestation_sha256 text,
      bulk_approval_eligible boolean,
      lineage_sha256 text
    );
    CREATE TABLE public.vendor_disclosure_ingest_storage_links (
      run_sha256 text,
      bucket_id text,
      object_name text,
      object_sha256 text,
      object_bytes bigint,
      ownership_state text,
      storage_metadata_owner_run_sha256 text,
      storage_object_id uuid,
      storage_object_updated_at timestamptz
    );
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY,
      session_id text,
      interaction_type text,
      tool_name text,
      success boolean,
      error_message text,
      model text,
      tokens_input integer,
      tokens_output integer,
      cost_usd numeric,
      metadata jsonb,
      created_at timestamptz
    );

    CREATE FUNCTION public.guard_official_review_event_append_only()
    RETURNS trigger LANGUAGE plpgsql AS $function$
    BEGIN
      RAISE EXCEPTION 'OFFICIAL_REVIEW_EVENT_APPEND_ONLY';
    END
    $function$;

    CREATE FUNCTION public.review_official_price(
      p_price_id uuid,
      p_actor_id uuid,
      p_action text,
      p_values jsonb,
      p_options jsonb,
      p_expected_review_version bigint
    ) RETURNS void LANGUAGE plpgsql AS $function$
    DECLARE
      previous_version bigint;
    BEGIN
      SELECT review_version INTO previous_version
      FROM public.official_prices
      WHERE id = p_price_id
      FOR UPDATE;
      IF previous_version IS DISTINCT FROM p_expected_review_version THEN
        RAISE EXCEPTION 'PRICE_REVIEW_VERSION_CONFLICT' USING ERRCODE = '40001';
      END IF;
      UPDATE public.official_prices
      SET review_status = p_action || 'd',
          needs_review = false,
          reviewed_by = p_actor_id,
          reviewed_at = now(),
          review_action = p_action,
          review_version = previous_version + 1
      WHERE id = p_price_id;
      INSERT INTO public.official_review_events (
        entity_kind, entity_id, actor_id, action,
        from_review_version, to_review_version, change_hash
      ) VALUES (
        'price', p_price_id, p_actor_id, p_action,
        previous_version, previous_version + 1, repeat('c', 64)
      );
    END
    $function$;
  `);
  await db.exec(unitIdsSql);
  await db.exec(unitPayloadSql);
  await db.exec(previewScopeSql);
  await db.exec(invalidationSql);
  await db.exec(bulkApprovalSql);
  return db;
}

async function seedCleanLocalRow(db: PGlite) {
  await db.exec(`
    INSERT INTO public.profiles VALUES ('${ACTOR_ID}', true);
    INSERT INTO public.vendors VALUES (
      '${VENDOR_ID}', 'Synthetic Studio', 'studio', '11', 'approved', NULL, now()
    );
    INSERT INTO public.price_snapshots VALUES (
      '${SNAPSHOT_ID}', false, false, NULL, 'kca_tprice', '2026Q3'
    );
    INSERT INTO public.official_prices VALUES (
      '${PRICE_ID}', '${SNAPSHOT_ID}', '${VENDOR_ID}', NULL,
      'studio', 'Synthetic basic', NULL, 100000, 100000, NULL, NULL,
      'pending', false, '{}', 'synthetic.pdf', '100,000원',
      ARRAY['${RAW_KEY}'], ARRAY['${PREVIEW_KEY}'], '${"5".repeat(64)}',
      0.95, false, NULL, NULL, NULL, 0, now()
    );
    INSERT INTO public.vendor_disclosure_ingest_runs (
      run_sha256, full_plan_sha256, authorization_kind, authorization_sha256,
      local_pending_only_unit_ids, status, completed_batch_count, batch_count,
      dedupe_finalized_at, dedupe_candidates_sha256, dedupe_payload_sha256,
      snapshot_id, snapshot_source, snapshot_period
    ) VALUES (
      '${RUN_SHA}', '${"6".repeat(64)}', 'local_validated_pending_only',
      '${"7".repeat(64)}', ARRAY['${UNIT_ID}'], 'complete', 1, 1, now(),
      '${"8".repeat(64)}', '${"9".repeat(64)}', '${SNAPSHOT_ID}',
      'kca_tprice', '2026Q3'
    );
    INSERT INTO public.vendor_disclosure_ingest_batches VALUES (
      '${RUN_SHA}', 1, '${"a".repeat(64)}', '${"b".repeat(64)}',
      '${"c".repeat(64)}', '${"d".repeat(64)}', ARRAY['${UNIT_ID}'], 1, 0
    );
    INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_ID}'
    );
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, official_price_id, vendor_id, agency_id,
      record_ref
    ) VALUES (
      '${RUN_SHA}', '${UNIT_ID}', 'vendor', '${PRICE_ID}', '${VENDOR_ID}', NULL,
      '${"5".repeat(64)}'
    );
    INSERT INTO public.vendor_disclosure_ingest_record_bindings VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_ID}',
      '${"5".repeat(64)}', '${VENDOR_ID}', NULL, NULL, '${"0".repeat(64)}'
    );
    INSERT INTO public.vendor_disclosure_ingest_unit_provider_lineage VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'local_deterministic', NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, false, '${"e".repeat(64)}'
    );
    INSERT INTO public.vendor_disclosure_ingest_storage_links (
      run_sha256, bucket_id, object_name, object_sha256, object_bytes,
      ownership_state, storage_metadata_owner_run_sha256,
      storage_object_id, storage_object_updated_at
    ) VALUES
      (
        '${RUN_SHA}', 'disclosure-raw', '${RAW_KEY}', '${RAW_SHA}', 10,
        'confirmed_created', '${RUN_SHA}', gen_random_uuid(), now()
      ),
      (
        '${RUN_SHA}', 'disclosure-preview', '${PREVIEW_KEY}', '${PREVIEW_SHA}', 10,
        'confirmed_created', '${RUN_SHA}', gen_random_uuid(), now()
      );
  `);
}

async function seedCleanPaidRow(db: PGlite) {
  await db.exec(`
    INSERT INTO public.profiles VALUES ('${ACTOR_ID}', true);
    INSERT INTO public.vendors VALUES (
      '${VENDOR_ID}', 'Synthetic Studio', 'studio', '11', 'approved', NULL, now()
    );
    INSERT INTO public.price_snapshots VALUES (
      '${SNAPSHOT_ID}', false, false, NULL, 'kca_tprice', '2026Q3'
    );
    INSERT INTO public.official_prices VALUES (
      '${PRICE_ID}', '${SNAPSHOT_ID}', '${VENDOR_ID}', NULL,
      'studio', 'Synthetic basic', NULL, 100000, 100000, NULL, NULL,
      'pending', false, '{}', 'synthetic.pdf', '100,000원',
      ARRAY['${RAW_KEY}'], ARRAY['${PREVIEW_KEY}'], '${"5".repeat(64)}',
      0.95, false, NULL, NULL, NULL, 0, now()
    );
    INSERT INTO public.vendor_disclosure_ingest_runs (
      run_sha256, full_plan_sha256, authorization_kind, authorization_sha256,
      local_pending_only_unit_ids, status, completed_batch_count, batch_count,
      dedupe_finalized_at, dedupe_candidates_sha256, dedupe_payload_sha256,
      snapshot_id, snapshot_source, snapshot_period
    ) VALUES (
      '${RUN_SHA}', '${"6".repeat(64)}', 'paid_pilot_gate',
      '${"7".repeat(64)}', '{}', 'complete', 1, 1, now(),
      '${"8".repeat(64)}', '${"9".repeat(64)}', '${SNAPSHOT_ID}',
      'kca_tprice', '2026Q3'
    );
    INSERT INTO public.vendor_disclosure_ingest_batches VALUES (
      '${RUN_SHA}', 1, '${"b".repeat(64)}', '${"c".repeat(64)}',
      '${"d".repeat(64)}', '${"e".repeat(64)}', ARRAY['${UNIT_ID}'], 1, 0
    );
    INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_ID}'
    );
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, official_price_id, vendor_id, agency_id,
      record_ref
    ) VALUES (
      '${RUN_SHA}', '${UNIT_ID}', 'vendor', '${PRICE_ID}', '${VENDOR_ID}', NULL,
      '${"5".repeat(64)}'
    );
    INSERT INTO public.vendor_disclosure_ingest_record_bindings VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_ID}',
      '${"5".repeat(64)}', '${VENDOR_ID}', NULL, NULL, '${"0".repeat(64)}'
    );
    INSERT INTO public.ai_interactions_log VALUES (
      '${LEDGER_ID}', 'disclosure_ingest', 'disclosure_extraction',
      'disclosure_extraction', true, NULL, '${PROVIDER_MODEL}', 100, 20, 0.01,
      jsonb_build_object(
        'source', 'local_disclosure_ingest',
        'unit_id', '${UNIT_ID}',
        'ledger_schema_version', '3',
        'provider_mode', 'production_paid',
        'paid_plan_sha256', '${PAID_PLAN_SHA}',
        'provider_model', '${PROVIDER_MODEL}',
        'request_hash', '${REQUEST_HASH}',
        'fingerprint', '${EXTRACTION_FINGERPRINT}'
      ),
      '2026-07-21T00:00:00.000Z'
    );
    INSERT INTO public.vendor_disclosure_ingest_owned_ledger_rows VALUES (
      '${RUN_SHA}', 1, '${LEDGER_ID}', true, 'owned'
    );
    INSERT INTO public.vendor_disclosure_ingest_unit_provider_lineage VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'production_paid', '${PAID_PLAN_SHA}',
      '${LEDGER_ID}', '${PROVIDER_MODEL}', '${REQUEST_HASH}',
      '${SOURCE_FINGERPRINT}', '${CONVERSION_FINGERPRINT}',
      '${EXTRACTION_FINGERPRINT}', '${VALIDATION_FINGERPRINT}',
      '${UNBOUND_UNIT_PAYLOAD_SHA}',
      true, '${"f".repeat(64)}'
    );
    INSERT INTO storage.buckets VALUES
      ('disclosure-raw', false), ('disclosure-preview', false);
    INSERT INTO storage.objects VALUES
      (
        '${RAW_OBJECT_ID}', 'disclosure-raw', '${RAW_KEY}', '${STORAGE_UPDATED_AT}',
        '{"size":"10"}',
        jsonb_build_object(
          'ingest_run_sha256', '${RUN_SHA}',
          'ingest_sha256', '${RAW_SHA}',
          'ingest_bytes', '10'
        )
      ),
      (
        '${PREVIEW_OBJECT_ID}', 'disclosure-preview', '${PREVIEW_KEY}', '${STORAGE_UPDATED_AT}',
        '{"size":"10"}',
        jsonb_build_object(
          'ingest_run_sha256', '${RUN_SHA}',
          'ingest_sha256', '${PREVIEW_SHA}',
          'ingest_bytes', '10'
        )
      );
    INSERT INTO public.vendor_disclosure_ingest_storage_links (
      run_sha256, bucket_id, object_name, object_sha256, object_bytes,
      ownership_state, storage_metadata_owner_run_sha256,
      storage_object_id, storage_object_updated_at
    ) VALUES
      (
        '${RUN_SHA}', 'disclosure-raw', '${RAW_KEY}', '${RAW_SHA}', 10,
        'confirmed_created', '${RUN_SHA}', '${RAW_OBJECT_ID}', '${STORAGE_UPDATED_AT}'
      ),
      (
        '${RUN_SHA}', 'disclosure-preview', '${PREVIEW_KEY}', '${PREVIEW_SHA}', 10,
        'confirmed_created', '${RUN_SHA}', '${PREVIEW_OBJECT_ID}', '${STORAGE_UPDATED_AT}'
      );
  `);
}

async function seedSecondPriceWithOptions(db: PGlite) {
  await db.exec(`
    INSERT INTO public.vendors VALUES (
      '${VENDOR_B_ID}', 'Synthetic Studio B', 'studio', '11', 'approved', NULL, now()
    );
    INSERT INTO public.official_prices VALUES (
      '${PRICE_B_ID}', '${SNAPSHOT_ID}', '${VENDOR_B_ID}', NULL,
      'studio', 'Synthetic premium', 'premium', 200000, 200000, NULL, 'B note',
      'pending', false, '{}', 'synthetic-b.pdf', '200,000원',
      ARRAY['${RAW_KEY}'], ARRAY['${PREVIEW_KEY}'], '${"6".repeat(64)}',
      0.95, false, NULL, NULL, NULL, 0, now()
    );
    INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_B_ID}'
    );
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, official_price_id, vendor_id, agency_id,
      record_ref
    ) VALUES (
      '${RUN_SHA}', '${UNIT_ID}', 'vendor', '${PRICE_B_ID}', '${VENDOR_B_ID}', NULL,
      '${"6".repeat(64)}'
    );
    INSERT INTO public.vendor_disclosure_ingest_record_bindings VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_B_ID}',
      '${"6".repeat(64)}', '${VENDOR_B_ID}', NULL, NULL, '${"1".repeat(64)}'
    );
    INSERT INTO public.official_price_options VALUES
      (
        '${OPTION_ID}', '${PRICE_ID}', 'A option', 10000, 10000, '회',
        'A condition', 'A raw', 'synthetic.pdf', 'A option 10,000원',
        ARRAY['${RAW_KEY}'], 0.95
      ),
      (
        '${OPTION_B_ID}', '${PRICE_B_ID}', 'B option', 20000, 20000, '회',
        'B condition', 'B raw', 'synthetic-b.pdf', 'B option 20,000원',
        ARRAY['${RAW_KEY}'], 0.95
      );
    UPDATE public.vendor_disclosure_ingest_batches
    SET staged_record_count = 2
    WHERE run_sha256 = '${RUN_SHA}' AND batch_index = 1
  `);
}

async function seedTwoAgencies(db: PGlite) {
  await db.exec(`
    INSERT INTO public.agencies VALUES
      ('${AGENCY_ID}', 'Agency A', 'agencya', '11', true, NULL, now()),
      ('${AGENCY_B_ID}', 'Agency B', 'agencyb', '11', true, NULL, now())
  `);
}

async function bindPrimaryPriceToAgency(db: PGlite) {
  await seedTwoAgencies(db);
  await db.exec(`
    UPDATE public.official_prices SET agency_id = '${AGENCY_ID}' WHERE id = '${PRICE_ID}';
    UPDATE public.vendor_disclosure_ingest_record_bindings
    SET agency_id = '${AGENCY_ID}'
    WHERE run_sha256 = '${RUN_SHA}' AND row_kind = 'official_price'
      AND row_id = '${PRICE_ID}';
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, official_price_id, vendor_id, agency_id
    ) VALUES ('${RUN_SHA}', '${UNIT_ID}', 'agency', NULL, NULL, '${AGENCY_ID}')
  `);
}

async function seedAgencyPackage(db: PGlite) {
  await db.exec(`
    INSERT INTO public.official_agency_packages (
      id, package_name, category_scope, price_min_krw, price_max_krw,
      vat_note, price_note, options, review_status, needs_review,
      validation_issue_codes, confidence, snapshot_id, source_file,
      source_object_keys, source_preview_keys, source_quote
    ) VALUES (
      '${PACKAGE_ID}', 'Agency package', ARRAY['studio'], 300000, 300000,
      NULL, NULL, '[]'::jsonb, 'pending', false, '{}', 0.95,
      '${SNAPSHOT_ID}', 'agency.pdf', ARRAY['${RAW_KEY}'],
      ARRAY['${PREVIEW_KEY}'], '패키지 300,000원'
    );
    UPDATE public.official_agency_packages SET agency_id = '${AGENCY_ID}'
    WHERE id = '${PACKAGE_ID}';
    INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'agency_package', '${PACKAGE_ID}'
    );
    INSERT INTO public.vendor_disclosure_ingest_record_bindings VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', 'agency_package', '${PACKAGE_ID}',
      '${"9".repeat(64)}', NULL, '${AGENCY_ID}', NULL, '${"2".repeat(64)}'
    );
    UPDATE public.vendor_disclosure_ingest_batches
    SET staged_record_count = 2
    WHERE run_sha256 = '${RUN_SHA}' AND batch_index = 1
  `);
}

async function seedPaidAttestation(
  db: PGlite,
  binding: {
    payloadSha256?: string;
    unitPayloadSha256?: string;
    updateProviderLineage?: boolean;
  } = {},
) {
  const payloadSha256 = binding.payloadSha256 ?? PAYLOAD_SHA;
  const unitPayloadSha256 = binding.unitPayloadSha256 ?? UNBOUND_UNIT_PAYLOAD_SHA;
  await db.exec(`
    INSERT INTO public.vendor_disclosure_paid_extraction_attestations (
      run_sha256, batch_index, unit_id, ledger_id, request_hash,
      paid_plan_sha256, provider_model, source_fingerprint,
      conversion_fingerprint, extraction_fingerprint, validation_fingerprint,
      full_plan_sha256, batch_plan_sha256, batch_sha256, payload_sha256,
      unit_payload_sha256, attestation_sha256
    ) VALUES (
      '${RUN_SHA}', 1, '${UNIT_ID}', '${LEDGER_ID}', '${REQUEST_HASH}',
      '${PAID_PLAN_SHA}', '${PROVIDER_MODEL}', '${SOURCE_FINGERPRINT}',
      '${CONVERSION_FINGERPRINT}', '${EXTRACTION_FINGERPRINT}',
      '${VALIDATION_FINGERPRINT}', '${FULL_PLAN_SHA}', '${BATCH_PLAN_SHA}',
      '${BATCH_SHA}', '${payloadSha256}', '${unitPayloadSha256}',
      encode(extensions.digest(convert_to(jsonb_build_object(
        'run_sha256', '${RUN_SHA}',
        'batch_index', 1,
        'unit_id', '${UNIT_ID}',
        'ledger_id', '${LEDGER_ID}'::uuid,
        'request_hash', '${REQUEST_HASH}',
        'paid_plan_sha256', '${PAID_PLAN_SHA}',
        'provider_model', '${PROVIDER_MODEL}',
        'source_fingerprint', '${SOURCE_FINGERPRINT}',
        'conversion_fingerprint', '${CONVERSION_FINGERPRINT}',
        'extraction_fingerprint', '${EXTRACTION_FINGERPRINT}',
        'validation_fingerprint', '${VALIDATION_FINGERPRINT}',
        'full_plan_sha256', '${FULL_PLAN_SHA}',
        'batch_plan_sha256', '${BATCH_PLAN_SHA}',
        'batch_sha256', '${BATCH_SHA}',
        'payload_sha256', '${payloadSha256}',
        'unit_payload_sha256', '${unitPayloadSha256}'
      )::text, 'UTF8'), 'sha256'), 'hex')
    );
  `);
  if (binding.updateProviderLineage) {
    await db.exec(`
      UPDATE public.vendor_disclosure_ingest_unit_provider_lineage AS lineage
      SET paid_attestation_sha256 = attestation.attestation_sha256
      FROM public.vendor_disclosure_paid_extraction_attestations AS attestation
      WHERE lineage.run_sha256 = attestation.run_sha256
        AND lineage.unit_id = attestation.unit_id
        AND lineage.run_sha256 = '${RUN_SHA}'
        AND lineage.unit_id = '${UNIT_ID}'
    `);
  }
}

async function seedPersistedBoundPaidAttestation(db: PGlite) {
  const digest = await db.query<{ value: string }>(`
    SELECT public.vendor_disclosure_persisted_unit_payload_sha256(
      '${RUN_SHA}', '${UNIT_ID}'
    ) AS value
  `);
  await seedPaidAttestation(db, {
    unitPayloadSha256: digest.rows[0]!.value,
    updateProviderLineage: true,
  });
}

async function seedNewerCompleteLocalRun(db: PGlite) {
  await db.exec(`
    UPDATE public.vendor_disclosure_ingest_runs
    SET dedupe_finalized_at = '2026-07-20T00:00:00.000Z'
    WHERE run_sha256 = '${RUN_SHA}';
    INSERT INTO public.price_snapshots VALUES (
      '${NEWER_SNAPSHOT_ID}', false, false, NULL, 'kca_tprice', '2026Q3-newer'
    );
    INSERT INTO public.official_prices VALUES (
      '${NEWER_PRICE_ID}', '${NEWER_SNAPSHOT_ID}', '${VENDOR_ID}', NULL,
      'studio', 'Newer local row', NULL, 110000, 110000, NULL, NULL,
      'pending', false, '{}', 'newer.pdf', 'KRW 110000',
      ARRAY['${RAW_KEY}'], ARRAY['${PREVIEW_KEY}'], '${"6".repeat(64)}',
      0.95, false, NULL, NULL, NULL, 0, now()
    );
    INSERT INTO public.vendor_disclosure_ingest_runs (
      run_sha256, full_plan_sha256, authorization_kind, authorization_sha256,
      local_pending_only_unit_ids, status, completed_batch_count, batch_count,
      dedupe_finalized_at, dedupe_candidates_sha256, dedupe_payload_sha256,
      snapshot_id, snapshot_source, snapshot_period
    ) VALUES (
      '${NEWER_RUN_SHA}', '${"1".repeat(64)}', 'local_validated_pending_only',
      '${"2".repeat(64)}', ARRAY['${NEWER_UNIT_ID}'], 'complete', 1, 1,
      '2026-07-21T00:00:00.000Z', '${"3".repeat(64)}', '${"4".repeat(64)}',
      '${NEWER_SNAPSHOT_ID}', 'kca_tprice', '2026Q3-newer'
    );
    INSERT INTO public.vendor_disclosure_ingest_batches VALUES (
      '${NEWER_RUN_SHA}', 1, '${"5".repeat(64)}', '${"6".repeat(64)}',
      '${"7".repeat(64)}', '${"8".repeat(64)}', ARRAY['${NEWER_UNIT_ID}'], 1, 0
    );
    INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
      '${NEWER_RUN_SHA}', 1, '${NEWER_UNIT_ID}', 'official_price', '${NEWER_PRICE_ID}'
    );
    INSERT INTO public.vendor_disclosure_ingest_identity_links VALUES (
      '${NEWER_RUN_SHA}', '${NEWER_UNIT_ID}', 'vendor',
      '${NEWER_PRICE_ID}', '${VENDOR_ID}', NULL
    );
    INSERT INTO public.vendor_disclosure_ingest_unit_provider_lineage VALUES (
      '${NEWER_RUN_SHA}', 1, '${NEWER_UNIT_ID}', 'local_deterministic',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      false, '${"9".repeat(64)}'
    );
  `);
}

describe("vendor disclosure bulk approval migration", { timeout: 30_000 }, () => {
  it("blocks direct pending KCA inserts even when a caller spoofs the active-run marker", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE TABLE public.price_snapshots (
          id uuid PRIMARY KEY, source text, period_label text
        );
        CREATE TABLE public.vendor_disclosure_ingest_runs (
          run_sha256 text PRIMARY KEY,
          snapshot_id uuid,
          snapshot_source text,
          status text
        );
        CREATE TABLE public.official_prices (
          id uuid PRIMARY KEY, snapshot_id uuid, review_status text
        );
        CREATE TABLE public.official_agency_packages (
          id uuid PRIMARY KEY, snapshot_id uuid, review_status text
        );
        CREATE TABLE public.disclosure_semantic_staging (
          id uuid PRIMARY KEY, snapshot_id uuid, review_status text
        );
        CREATE TABLE public.official_price_options (
          id uuid PRIMARY KEY, official_price_id uuid
        );
        CREATE TABLE public.vendor_disclosure_ingest_owned_rows (
          run_sha256 text, row_kind text, row_id uuid
        );
      `);
      await db.exec(atomicInsertFenceSql);
      await db.exec(`
        INSERT INTO public.price_snapshots VALUES ('${SNAPSHOT_ID}', 'kca_tprice', '2026Q3');
      `);
      for (const [table, id] of [
        ["official_prices", PRICE_ID],
        ["official_agency_packages", PACKAGE_ID],
        ["disclosure_semantic_staging", SEMANTIC_ID],
      ] as const) {
        await expect(db.exec(`
          INSERT INTO public.${table} VALUES ('${id}', '${SNAPSHOT_ID}', 'pending')
        `)).rejects.toThrow(/DISCLOSURE_ATOMIC_OWNERSHIP_CONTEXT_REQUIRED/u);
      }

      await db.exec(`
        INSERT INTO public.vendor_disclosure_ingest_runs VALUES (
          '${RUN_SHA}', '${SNAPSHOT_ID}', 'kca_tprice', 'active'
        );
        SELECT set_config('app.vendor_disclosure_atomic_run_sha256', '${RUN_SHA}', false);
      `);
      await expect(db.exec(`
        INSERT INTO public.official_prices VALUES (
          '${PRICE_ID}', '${SNAPSHOT_ID}', 'pending'
        );
      `)).rejects.toThrow(/DISCLOSURE_ATOMIC_OWNERSHIP_CONTEXT_REQUIRED/u);
      // PGlite leaves an explicitly opened transaction aborted after the
      // expected trigger error; a real client would issue the same rollback.
      await db.exec("ROLLBACK");
      const rows = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      expect(rows.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("detects legacy unowned pending KCA rows and fails preview closed", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.price_snapshots VALUES (
          '${SNAPSHOT_ID}', false, false, NULL, 'kca_tprice', '2026Q3'
        );
        INSERT INTO public.official_prices (
          id, snapshot_id, category, item_name, review_status, needs_review,
          validation_issue_codes, source_object_keys, source_preview_keys,
          edited_by_admin, review_version
        ) VALUES (
          '${PRICE_ID}', '${SNAPSHOT_ID}', 'studio', 'Legacy direct row',
          'pending', true, '{}', '{}', '{}', false, 0
        );
      `);
      const counts = await db.query<{
        official_price_count: bigint;
        agency_package_count: bigint;
        semantic_count: bigint;
      }>("SELECT * FROM public.get_vendor_disclosure_unowned_pending_counts()");
      expect(Number(counts.rows[0]?.official_price_count)).toBe(1);
      expect(Number(counts.rows[0]?.agency_package_count)).toBe(0);
      expect(Number(counts.rows[0]?.semantic_count)).toBe(0);
      await expect(db.query(
        "SELECT * FROM public.get_vendor_disclosure_admin_preview_scope()",
      )).rejects.toThrow(/ADMIN_PREVIEW_UNOWNED_PENDING_KCA_TPRICE/u);
    } finally {
      await db.close();
    }
  });

  it("stores resolved record bindings as digest-checked append-only facts", async () => {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    try {
      await db.exec(`
        CREATE SCHEMA extensions;
        CREATE EXTENSION pgcrypto SCHEMA extensions;
        CREATE TABLE public.vendor_disclosure_ingest_runs (
          run_sha256 text PRIMARY KEY
        );
        CREATE TABLE public.vendor_disclosure_ingest_batches (
          run_sha256 text,
          batch_index integer,
          UNIQUE (run_sha256, batch_index)
        );
        CREATE FUNCTION public.guard_official_review_event_append_only()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
          RAISE EXCEPTION 'OFFICIAL_REVIEW_EVENT_APPEND_ONLY';
        END
        $function$;
      `);
      await db.exec(recordBindingSql);
      await db.exec(`
        INSERT INTO public.vendor_disclosure_ingest_runs VALUES ('${RUN_SHA}');
        INSERT INTO public.vendor_disclosure_ingest_batches VALUES ('${RUN_SHA}', 1);
        INSERT INTO public.vendor_disclosure_ingest_record_bindings (
          run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
          vendor_id, agency_id, linked_official_price_id, binding_sha256
        ) VALUES (
          '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_ID}',
          '${"5".repeat(64)}', '${VENDOR_ID}', NULL, NULL,
          encode(extensions.digest(convert_to(jsonb_build_object(
            'run_sha256', '${RUN_SHA}',
            'batch_index', 1,
            'unit_id', '${UNIT_ID}',
            'row_kind', 'official_price',
            'row_id', '${PRICE_ID}'::uuid,
            'record_ref', '${"5".repeat(64)}',
            'vendor_id', '${VENDOR_ID}'::uuid,
            'agency_id', NULL,
            'linked_official_price_id', NULL
          )::text, 'UTF8'), 'sha256'), 'hex')
        )
      `);
      await expect(db.exec(`
        UPDATE public.vendor_disclosure_ingest_record_bindings
        SET vendor_id = '${VENDOR_B_ID}'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_EVENT_APPEND_ONLY/u);
      await expect(db.exec(`
        DELETE FROM public.vendor_disclosure_ingest_record_bindings
      `)).rejects.toThrow(/OFFICIAL_REVIEW_EVENT_APPEND_ONLY/u);
      await expect(db.exec(`
        INSERT INTO public.vendor_disclosure_ingest_record_bindings (
          run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
          vendor_id, agency_id, linked_official_price_id, binding_sha256
        ) VALUES (
          '${RUN_SHA}', 1, '${UNIT_ID}', 'official_price', '${PRICE_B_ID}',
          '${"6".repeat(64)}', '${VENDOR_B_ID}', NULL, NULL, '${"0".repeat(64)}'
        )
      `)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.close();
    }
  });

  it("stores paid extraction attestations as digest-checked, append-only, globally non-reusable facts", async () => {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    try {
      await db.exec(`
        CREATE SCHEMA extensions;
        CREATE EXTENSION pgcrypto SCHEMA extensions;
        CREATE TABLE public.vendor_disclosure_ingest_runs (
          run_sha256 text PRIMARY KEY
        );
        CREATE FUNCTION public.guard_official_review_event_append_only()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
          RAISE EXCEPTION 'OFFICIAL_REVIEW_EVENT_APPEND_ONLY';
        END
        $function$;
      `);
      await db.exec(paidAttestationSql);
      await db.exec(`INSERT INTO public.vendor_disclosure_ingest_runs VALUES ('${RUN_SHA}')`);
      await seedPaidAttestation(db);

      await expect(db.exec(`
        UPDATE public.vendor_disclosure_paid_extraction_attestations
        SET provider_model = 'forged'
      `)).rejects.toThrow(/OFFICIAL_REVIEW_EVENT_APPEND_ONLY/u);
      await expect(db.exec(`
        DELETE FROM public.vendor_disclosure_paid_extraction_attestations
      `)).rejects.toThrow(/OFFICIAL_REVIEW_EVENT_APPEND_ONLY/u);
      await expect(seedPaidAttestation(db)).rejects.toMatchObject({ code: "23505" });
      await expect(db.exec(`
        INSERT INTO public.vendor_disclosure_paid_extraction_attestations (
          run_sha256, batch_index, unit_id, ledger_id, request_hash,
          paid_plan_sha256, provider_model, source_fingerprint,
          conversion_fingerprint, extraction_fingerprint, validation_fingerprint,
          full_plan_sha256, batch_plan_sha256, batch_sha256, payload_sha256,
          unit_payload_sha256,
          attestation_sha256
        ) VALUES (
          '${RUN_SHA}', 1, '${"8".repeat(64)}',
          '50000000-0000-4000-8000-000000000002', '${"9".repeat(64)}',
          '${PAID_PLAN_SHA}', '${PROVIDER_MODEL}', '${SOURCE_FINGERPRINT}',
          '${CONVERSION_FINGERPRINT}', '${EXTRACTION_FINGERPRINT}',
          '${VALIDATION_FINGERPRINT}', '${FULL_PLAN_SHA}', '${BATCH_PLAN_SHA}',
          '${BATCH_SHA}', '${PAYLOAD_SHA}', '${UNBOUND_UNIT_PAYLOAD_SHA}',
          '${"0".repeat(64)}'
        )
      `)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.close();
    }
  });

  it("excludes an invalidated run from the exact completed ownership scope and fails closed on a broken unit link", async () => {
    const db = await createDatabase();
    try {
      await seedCleanLocalRow(db);
      const olderRunSha = "0".repeat(64);
      const olderUnitId = "9".repeat(64);
      const olderPriceId = "40000000-0000-4000-8000-000000000002";
      await db.exec(`
        INSERT INTO public.official_prices VALUES (
          '${olderPriceId}', '${SNAPSHOT_ID}', '${VENDOR_ID}', NULL,
          'studio', 'Older run row', NULL, 90000, 90000, NULL, NULL,
          'pending', false, '{}', 'older.pdf', '90,000원',
          ARRAY['${RAW_KEY}'], ARRAY['${PREVIEW_KEY}'], '${"4".repeat(64)}',
          0.95, false, NULL, NULL, NULL, 0, now()
        );
        INSERT INTO public.vendor_disclosure_ingest_runs (
          run_sha256, full_plan_sha256, authorization_kind, authorization_sha256,
          local_pending_only_unit_ids, status, completed_batch_count, batch_count,
          dedupe_finalized_at, dedupe_candidates_sha256, dedupe_payload_sha256,
          snapshot_id, snapshot_source, snapshot_period
        ) VALUES (
          '${olderRunSha}', '${"3".repeat(64)}', 'local_validated_pending_only',
          '${"4".repeat(64)}', ARRAY['${olderUnitId}'], 'invalidated', 1, 1,
          '2026-07-20T00:00:00.000Z', '${"5".repeat(64)}', '${"6".repeat(64)}',
          '${SNAPSHOT_ID}', 'kca_tprice', '2026Q3'
        );
        INSERT INTO public.vendor_disclosure_ingest_batches VALUES (
          '${olderRunSha}', 1, '${"7".repeat(64)}', '${"8".repeat(64)}',
          '${"9".repeat(64)}', '${"a".repeat(64)}', ARRAY['${olderUnitId}'], 1, 1
        );
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
          '${olderRunSha}', 1, '${olderUnitId}', 'official_price', '${olderPriceId}'
        );
      `);

      const scoped = await db.query<PreviewScopeResult>(`
        SELECT * FROM public.get_vendor_disclosure_admin_preview_scope()
      `);
      expect(scoped.rows).toEqual([{
        run_sha256: RUN_SHA,
        snapshot_id: SNAPSHOT_ID,
        period_label: "2026Q3",
        unit_ids: [UNIT_ID],
        official_price_ids: [PRICE_ID],
        semantic_ids: [],
      }]);

      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_owned_rows
        SET unit_id = '${"8".repeat(64)}'
        WHERE run_sha256 = '${RUN_SHA}'
      `);
      await expect(db.query(`
        SELECT * FROM public.get_vendor_disclosure_admin_preview_scope()
      `)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.close();
    }
  });

  it("atomically invalidates only an untouched completed draft and makes replay idempotent", async () => {
    const db = await createDatabase();
    try {
      await seedCleanLocalRow(db);
      const first = await db.query<{
        invalidated: boolean;
        already_invalidated: boolean;
        invalidation_receipt_sha256: string;
      }>(`
        SELECT * FROM public.invalidate_vendor_disclosure_completed_run_atomic(
          'staging-ref', '${RUN_SHA}', '${"6".repeat(64)}', 'bad completed import'
        )
      `);
      expect(first.rows[0]).toMatchObject({
        invalidated: true,
        already_invalidated: false,
      });
      expect(first.rows[0]?.invalidation_receipt_sha256).toMatch(/^[a-f0-9]{64}$/u);
      const scope = await db.query(`
        SELECT * FROM public.get_vendor_disclosure_admin_preview_scope()
      `);
      expect(scope.rows).toEqual([]);

      const replay = await db.query<{
        invalidated: boolean;
        already_invalidated: boolean;
        invalidation_receipt_sha256: string;
      }>(`
        SELECT * FROM public.invalidate_vendor_disclosure_completed_run_atomic(
          'staging-ref', '${RUN_SHA}', '${"6".repeat(64)}', 'bad completed import'
        )
      `);
      expect(replay.rows[0]).toEqual({
        invalidated: false,
        already_invalidated: true,
        invalidation_receipt_sha256: first.rows[0]!.invalidation_receipt_sha256,
      });
      await expect(db.query(`
        SELECT * FROM public.invalidate_vendor_disclosure_completed_run_atomic(
          'staging-ref', '${RUN_SHA}', '${"6".repeat(64)}', 'different reason'
        )
      `)).rejects.toMatchObject({ code: "23505" });
    } finally {
      await db.close();
    }
  });

  it("refuses completed-run invalidation after review or snapshot publication state", async () => {
    const reviewedDb = await createDatabase();
    try {
      await seedCleanLocalRow(reviewedDb);
      await reviewedDb.exec(`
        UPDATE public.official_prices
        SET review_version = 1, edited_by_admin = true
        WHERE id = '${PRICE_ID}'
      `);
      await expect(reviewedDb.query(`
        SELECT * FROM public.invalidate_vendor_disclosure_completed_run_atomic(
          'staging-ref', '${RUN_SHA}', '${"6".repeat(64)}', 'reviewed row'
        )
      `)).rejects.toMatchObject({ code: "55000" });
    } finally {
      await reviewedDb.close();
    }

    const publishedDb = await createDatabase();
    try {
      await seedCleanLocalRow(publishedDb);
      await publishedDb.exec(`
        UPDATE public.price_snapshots
        SET is_current = true
        WHERE id = '${SNAPSHOT_ID}'
      `);
      await expect(publishedDb.query(`
        SELECT * FROM public.invalidate_vendor_disclosure_completed_run_atomic(
          'staging-ref', '${RUN_SHA}', '${"6".repeat(64)}', 'published snapshot'
        )
      `)).rejects.toMatchObject({ code: "55000" });
    } finally {
      await publishedDb.close();
    }
  });

  it("derives vendor-detail IDs only from the exact completed-run preview scope", async () => {
    const db = await createDatabase();
    try {
      await seedCleanLocalRow(db);
      await seedSecondPriceWithOptions(db);

      const firstVendor = await db.query<PreviewScopeResult>(`
        SELECT *
        FROM public.get_vendor_disclosure_admin_preview_vendor_scope('${VENDOR_ID}')
      `);
      expect(firstVendor.rows).toEqual([{
        run_sha256: RUN_SHA,
        snapshot_id: SNAPSHOT_ID,
        period_label: "2026Q3",
        unit_ids: [UNIT_ID],
        official_price_ids: [PRICE_ID],
        semantic_ids: [],
      }]);

      const secondVendor = await db.query<PreviewScopeResult>(`
        SELECT *
        FROM public.get_vendor_disclosure_admin_preview_vendor_scope('${VENDOR_B_ID}')
      `);
      expect(secondVendor.rows[0]?.official_price_ids).toEqual([PRICE_B_ID]);
    } finally {
      await db.close();
    }
  });

  it("keeps a local row ineligible even when only its caller authorization is forged as paid", async () => {
    const db = await createDatabase();
    try {
      await seedCleanLocalRow(db);

      const local = await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `);
      expect(local.rows[0]?.value).toEqual({
        eligibility_contract_version: 1,
        batch_eligible_count: 0,
        has_more: false,
        eligibility_sha256: null,
      });

      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_runs
        SET authorization_kind = 'paid_pilot_gate',
            local_pending_only_unit_ids = '{}'
        WHERE run_sha256 = '${RUN_SHA}';
      `);
      const eligible = await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `);
      expect(eligible.rows[0]?.value).toEqual({
        eligibility_contract_version: 1,
        batch_eligible_count: 0,
        has_more: false,
        eligibility_sha256: null,
      });
    } finally {
      await db.close();
    }
  });

  it("fails closed when two non-invalidated completed draft runs compete for preview and approval", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await seedPersistedBoundPaidAttestation(db);
      await seedNewerCompleteLocalRun(db);

      await expect(db.query<PreviewScopeResult>(`
        SELECT * FROM public.get_vendor_disclosure_admin_preview_scope()
      `)).rejects.toMatchObject({ code: "23514" });

      await expect(db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.close();
    }
  });

  it("does not trust caller-shaped paid ledger and lineage rows without a preexisting immutable attestation", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);

      const eligibility = await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `);
      expect(eligibility.rows[0]?.value).toEqual({
        eligibility_contract_version: 1,
        batch_eligible_count: 0,
        has_more: false,
        eligibility_sha256: null,
      });
    } finally {
      await db.close();
    }
  });

  it("makes same-fingerprint paid rows ineligible when flat payload or persisted price content is substituted", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await db.exec(`
        INSERT INTO public.disclosure_semantic_staging (
          id, schema_version, unit_id, record_kind, semantic_type, subject_kind,
          subject_name, subject_normalized_name, vendor_category, region_code,
          title, content_verbatim, summary, partner_record_ref, source_agency,
          partner_link_status, review_status, needs_review,
          validation_issue_codes, confidence, source_fingerprint,
          validation_fingerprint, snapshot_id, source_file_ids, source_file,
          source_object_keys, source_preview_keys, source_quote,
          source_record_key, content_fingerprint
        ) VALUES (
          '${SEMANTIC_ID}', 2, '${UNIT_ID}', 'document_section', 'notice',
          'agency', 'Synthetic Studio', 'syntheticstudio', NULL, '11',
          '취소 규정', '취소 규정 원문', '취소 규정 요약', NULL, NULL,
          'not_applicable', 'pending', false, '{}', 0.95,
          '${SOURCE_FINGERPRINT}', '${VALIDATION_FINGERPRINT}', '${SNAPSHOT_ID}',
          ARRAY['${RAW_SHA}'], 'synthetic.pdf', ARRAY['${RAW_KEY}'],
          ARRAY['${PREVIEW_KEY}'], '취소 규정 원문', '${"7".repeat(64)}',
          '${"8".repeat(64)}'
        );
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
          '${RUN_SHA}', 1, '${UNIT_ID}', 'semantic', '${SEMANTIC_ID}'
        );
        INSERT INTO public.vendor_disclosure_ingest_record_bindings VALUES (
          '${RUN_SHA}', 1, '${UNIT_ID}', 'semantic', '${SEMANTIC_ID}',
          '${"7".repeat(64)}', NULL, NULL, NULL, '${"3".repeat(64)}'
        );
        UPDATE public.vendor_disclosure_ingest_batches
        SET staged_record_count = 2
        WHERE run_sha256 = '${RUN_SHA}' AND batch_index = 1
      `);
      const originalPayload = paidPayloadWithPrice(100_000);
      const forgedPayload = paidPayloadWithPrice(900_000);
      const forgedSemanticPayload = paidPayloadWithPrice(
        100_000,
        "변조된 취소 규정",
      );
      const originalPayloadSha256 = await databaseJsonbSha256(db, originalPayload);
      const forgedPayloadSha256 = await databaseJsonbSha256(db, forgedPayload);
      const originalUnitPayloadSha256 = await payloadUnitSha256(db, originalPayload);
      const forgedUnitPayloadSha256 = await payloadUnitSha256(db, forgedPayload);
      const forgedSemanticUnitPayloadSha256 = await payloadUnitSha256(
        db,
        forgedSemanticPayload,
      );
      const persistedUnitPayload = await db.query<{ value: string }>(`
        SELECT public.vendor_disclosure_persisted_unit_payload_sha256(
          '${RUN_SHA}', '${UNIT_ID}'
        ) AS value
      `);

      expect(originalPayloadSha256).not.toBe(forgedPayloadSha256);
      expect(originalUnitPayloadSha256).not.toBe(forgedUnitPayloadSha256);
      expect(originalUnitPayloadSha256).not.toBe(forgedSemanticUnitPayloadSha256);
      expect(persistedUnitPayload.rows[0]!.value).toBe(originalUnitPayloadSha256);

      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_batches
        SET payload_sha256 = '${originalPayloadSha256}'
        WHERE run_sha256 = '${RUN_SHA}' AND batch_index = 1
      `);
      await seedPaidAttestation(db, {
        payloadSha256: originalPayloadSha256,
        unitPayloadSha256: originalUnitPayloadSha256,
        updateProviderLineage: true,
      });
      const readCount = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `)).rows[0]!.value.batch_eligible_count;

      expect(await readCount()).toBe(1);

      // This is the exact value stage_vendor_disclosure_batch_atomic would
      // derive from a caller payload whose price changed but whose unit,
      // artifact fingerprints, request hash, and paid ledger were replayed.
      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_batches
        SET payload_sha256 = '${forgedPayloadSha256}'
        WHERE run_sha256 = '${RUN_SHA}' AND batch_index = 1
      `);
      expect(await readCount()).toBe(0);

      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_batches
        SET payload_sha256 = '${originalPayloadSha256}'
        WHERE run_sha256 = '${RUN_SHA}' AND batch_index = 1;
        UPDATE public.official_prices
        SET price_min_krw = 900000, price_max_krw = 900000
        WHERE id = '${PRICE_ID}'
      `);
      expect(await readCount()).toBe(0);

      await db.exec(`
        UPDATE public.official_prices
        SET price_min_krw = 100000, price_max_krw = 100000
        WHERE id = '${PRICE_ID}'
      `);
      expect(await readCount()).toBe(1);
      await db.exec(`
        UPDATE public.disclosure_semantic_staging
        SET content_verbatim = '변조된 취소 규정'
        WHERE id = '${SEMANTIC_ID}'
      `);
      expect(await readCount()).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("rejects an order-preserving whole-record swap across two vendor bindings in one unit", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await seedSecondPriceWithOptions(db);
      await seedPersistedBoundPaidAttestation(db);
      const readCount = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility('${ACTOR_ID}', 25) AS value
      `)).rows[0]!.value.batch_eligible_count;
      expect(await readCount()).toBe(2);
      const firstBatch = (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 1
        ) AS value
      `)).rows[0]!.value;
      expect(firstBatch).toMatchObject({
        batch_eligible_count: 1,
        has_more: true,
      });
      expect(firstBatch.eligibility_sha256).toMatch(/^[0-9a-f]{64}$/u);

      await db.exec(`
        UPDATE public.official_prices AS target
        SET item_name = source.item_name,
            base_spec = source.base_spec,
            price_min_krw = source.price_min_krw,
            price_max_krw = source.price_max_krw,
            vat_note = source.vat_note,
            price_note = source.price_note,
            source_file = source.source_file,
            source_quote = source.source_quote,
            source_object_keys = source.source_object_keys,
            source_preview_keys = source.source_preview_keys,
            source_record_key = source.source_record_key,
            confidence = source.confidence
        FROM (VALUES
          ('${PRICE_ID}'::uuid, '${PRICE_B_ID}'::uuid),
          ('${PRICE_B_ID}'::uuid, '${PRICE_ID}'::uuid)
        ) AS pair(target_id, source_id)
        JOIN public.official_prices AS source ON source.id = pair.source_id
        WHERE target.id = pair.target_id;
        UPDATE public.official_price_options
        SET official_price_id = CASE official_price_id
          WHEN '${PRICE_ID}'::uuid THEN '${PRICE_B_ID}'::uuid
          ELSE '${PRICE_ID}'::uuid
        END
        WHERE official_price_id IN ('${PRICE_ID}', '${PRICE_B_ID}')
      `);

      expect(await readCount()).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("rejects removing the attested resolved source agency from a price", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await bindPrimaryPriceToAgency(db);
      await seedPersistedBoundPaidAttestation(db);
      const readCount = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility('${ACTOR_ID}', 25) AS value
      `)).rows[0]!.value.batch_eligible_count;
      expect(await readCount()).toBe(1);
      await db.exec(`UPDATE public.official_prices SET agency_id = NULL WHERE id = '${PRICE_ID}'`);
      expect(await readCount()).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("rejects an agency-package identity substitution, including after eligibility CAS is read", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await bindPrimaryPriceToAgency(db);
      await seedAgencyPackage(db);
      await seedPersistedBoundPaidAttestation(db);
      const before = (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility('${ACTOR_ID}', 25) AS value
      `)).rows[0]!.value;
      expect(before.batch_eligible_count).toBe(1);
      expect(before.eligibility_sha256).toMatch(/^[0-9a-f]{64}$/u);

      await db.exec(`
        UPDATE public.official_agency_packages
        SET agency_id = '${AGENCY_B_ID}'
        WHERE id = '${PACKAGE_ID}'
      `);
      const after = (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility('${ACTOR_ID}', 25) AS value
      `)).rows[0]!.value;
      expect(after.batch_eligible_count).toBe(0);
      await expect(db.query(`
        SELECT public.approve_vendor_disclosure_validated_batch(
          '${ACTOR_ID}', 25, 1, '${before.eligibility_sha256}'
        )
      `)).rejects.toMatchObject({ code: "40001" });
    } finally {
      await db.close();
    }
  });

  it("invalidates candidate A when sibling price B drifts from its vendor binding", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await seedSecondPriceWithOptions(db);
      await seedPersistedBoundPaidAttestation(db);
      const readCount = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility('${ACTOR_ID}', 25) AS value
      `)).rows[0]!.value.batch_eligible_count;
      expect(await readCount()).toBe(2);
      await db.exec(`
        UPDATE public.official_prices SET vendor_id = '${VENDOR_ID}' WHERE id = '${PRICE_B_ID}'
      `);
      expect(await readCount()).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("invalidates the unit when a vendor-policy semantic drifts from its resolved price/vendor link", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await db.exec(`
        INSERT INTO public.disclosure_semantic_staging (
          id, schema_version, unit_id, record_kind, semantic_type, subject_kind,
          subject_name, subject_normalized_name, vendor_category, region_code,
          title, content_verbatim, summary, partner_record_ref,
          partner_vendor_id, official_price_id, source_agency,
          partner_link_status, review_status, needs_review,
          validation_issue_codes, confidence, source_fingerprint,
          validation_fingerprint, snapshot_id, source_file_ids, source_file,
          source_object_keys, source_preview_keys, source_quote,
          source_record_key, content_fingerprint
        ) VALUES (
          '${SEMANTIC_ID}', 2, '${UNIT_ID}', 'vendor_policy', 'penalty',
          'vendor', 'Synthetic Studio', 'syntheticstudio', 'studio', '11',
          NULL, '취소 수수료 원문', NULL, '${"5".repeat(64)}',
          '${VENDOR_ID}', '${PRICE_ID}', NULL, 'price_row_staged', 'pending',
          false, '{}', 0.95, '${SOURCE_FINGERPRINT}',
          '${VALIDATION_FINGERPRINT}', '${SNAPSHOT_ID}', ARRAY['${RAW_SHA}'],
          'synthetic.pdf', ARRAY['${RAW_KEY}'], ARRAY['${PREVIEW_KEY}'],
          '취소 수수료 원문', '${"7".repeat(64)}', '${"8".repeat(64)}'
        );
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES (
          '${RUN_SHA}', 1, '${UNIT_ID}', 'semantic', '${SEMANTIC_ID}'
        );
        INSERT INTO public.vendor_disclosure_ingest_record_bindings VALUES (
          '${RUN_SHA}', 1, '${UNIT_ID}', 'semantic', '${SEMANTIC_ID}',
          '${"5".repeat(64)}', '${VENDOR_ID}', NULL, '${PRICE_ID}',
          '${"4".repeat(64)}'
        );
        UPDATE public.vendor_disclosure_ingest_batches
        SET staged_record_count = 2
        WHERE run_sha256 = '${RUN_SHA}' AND batch_index = 1
      `);
      await seedPersistedBoundPaidAttestation(db);
      const readCount = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility('${ACTOR_ID}', 25) AS value
      `)).rows[0]!.value.batch_eligible_count;
      expect(await readCount()).toBe(1);
      await db.exec(`
        UPDATE public.disclosure_semantic_staging
        SET partner_vendor_id = '${VENDOR_B_ID}'
        WHERE id = '${SEMANTIC_ID}'
      `);
      expect(await readCount()).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("rejects a metadata-less preexisting Storage object even when its name and size match", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await seedPersistedBoundPaidAttestation(db);
      const readEligibility = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `)).rows[0]!.value;
      expect((await readEligibility()).batch_eligible_count).toBe(1);
      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_storage_links
        SET ownership_state = 'confirmed_preexisting',
            storage_metadata_owner_run_sha256 = NULL
        WHERE run_sha256 = '${RUN_SHA}' AND bucket_id = 'disclosure-raw';
        UPDATE storage.objects
        SET user_metadata = '{}'::jsonb
        WHERE id = '${RAW_OBJECT_ID}';
      `);

      expect(await readEligibility()).toEqual({
        eligibility_contract_version: 1,
        batch_eligible_count: 0,
        has_more: false,
        eligibility_sha256: null,
      });

      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_storage_links
        SET ownership_state = 'confirmed_created',
            storage_metadata_owner_run_sha256 = '${RUN_SHA}'
        WHERE run_sha256 = '${RUN_SHA}' AND bucket_id = 'disclosure-raw';
        UPDATE storage.objects
        SET user_metadata = jsonb_build_object(
          'ingest_run_sha256', '${RUN_SHA}',
          'ingest_sha256', '${RAW_SHA}',
          'ingest_bytes', '10'
        )
        WHERE id = '${RAW_OBJECT_ID}';
        UPDATE public.vendor_disclosure_ingest_storage_links
        SET ownership_state = 'confirmed_preexisting',
            storage_metadata_owner_run_sha256 = NULL
        WHERE run_sha256 = '${RUN_SHA}' AND bucket_id = 'disclosure-preview';
        UPDATE storage.objects
        SET user_metadata = '{}'::jsonb
        WHERE id = '${PREVIEW_OBJECT_ID}';
      `);
      expect(await readEligibility()).toEqual({
        eligibility_contract_version: 1,
        batch_eligible_count: 0,
        has_more: false,
        eligibility_sha256: null,
      });
    } finally {
      await db.close();
    }
  });

  it("rejects reused or multiply-owned ledgers and any request binding drift", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await seedPersistedBoundPaidAttestation(db);
      const readCount = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `)).rows[0]!.value.batch_eligible_count;

      expect(await readCount()).toBe(1);
      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_owned_ledger_rows
        SET created_by_run = false, cleanup_status = 'reused'
        WHERE run_sha256 = '${RUN_SHA}' AND ledger_id = '${LEDGER_ID}'
      `);
      expect(await readCount()).toBe(0);

      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_owned_ledger_rows
        SET created_by_run = true, cleanup_status = 'owned'
        WHERE run_sha256 = '${RUN_SHA}' AND ledger_id = '${LEDGER_ID}';
        INSERT INTO public.vendor_disclosure_ingest_owned_ledger_rows VALUES (
          '${"0".repeat(64)}', 1, '${LEDGER_ID}', false, 'reused'
        )
      `);
      expect(await readCount()).toBe(0);

      await db.exec(`
        DELETE FROM public.vendor_disclosure_ingest_owned_ledger_rows
        WHERE run_sha256 = '${"0".repeat(64)}';
        UPDATE public.ai_interactions_log
        SET metadata = jsonb_set(metadata, '{request_hash}', to_jsonb('${"9".repeat(64)}'::text))
        WHERE id = '${LEDGER_ID}'
      `);
      expect(await readCount()).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("requires live immutable storage evidence and atomically audits only an exact paid approval", async () => {
    const db = await createDatabase();
    try {
      await seedCleanPaidRow(db);
      await seedPersistedBoundPaidAttestation(db);

      const readEligibility = async () => (await db.query<{ value: EligibilityResult }>(`
        SELECT public.get_vendor_disclosure_bulk_approval_eligibility(
          '${ACTOR_ID}', 25
        ) AS value
      `)).rows[0]!.value;

      expect(await readEligibility()).toMatchObject({
        eligibility_contract_version: 1,
        batch_eligible_count: 1,
        has_more: false,
      });

      await db.exec(`DELETE FROM storage.objects WHERE id = '${RAW_OBJECT_ID}'`);
      expect(await readEligibility()).toEqual({
        eligibility_contract_version: 1,
        batch_eligible_count: 0,
        has_more: false,
        eligibility_sha256: null,
      });

      await db.exec(`
        INSERT INTO storage.objects VALUES (
          '${RAW_OBJECT_ID}', 'disclosure-raw', '${RAW_KEY}', '${STORAGE_UPDATED_AT}',
          '{"size":"10"}',
          jsonb_build_object(
            'ingest_run_sha256', '${RUN_SHA}',
            'ingest_sha256', '${RAW_SHA}',
            'ingest_bytes', '10'
          )
        )
      `);
      const confirmed = await readEligibility();
      expect(confirmed.batch_eligible_count).toBe(1);
      expect(confirmed.eligibility_sha256).toMatch(/^[0-9a-f]{64}$/u);

      await db.exec(`
        UPDATE storage.objects
        SET updated_at = '2026-07-21T00:00:01.000Z'
        WHERE id = '${RAW_OBJECT_ID}'
      `);
      expect((await readEligibility()).batch_eligible_count).toBe(0);

      await expect(db.query(`
        SELECT public.approve_vendor_disclosure_validated_batch(
          '${ACTOR_ID}', 25, 1, '${confirmed.eligibility_sha256}'
        )
      `)).rejects.toMatchObject({ code: "40001" });
      const unchanged = await db.query<{
        audit_count: number;
        review_status: string;
      }>(`
        SELECT price.review_status,
          (SELECT count(*)::integer
           FROM public.vendor_disclosure_bulk_approval_audits) AS audit_count
        FROM public.official_prices AS price
        WHERE price.id = '${PRICE_ID}'
      `);
      expect(unchanged.rows).toEqual([{ review_status: "pending", audit_count: 0 }]);

      await db.exec(`
        UPDATE storage.objects
        SET updated_at = '${STORAGE_UPDATED_AT}'
        WHERE id = '${RAW_OBJECT_ID}'
      `);
      const restored = await readEligibility();
      expect(restored.batch_eligible_count).toBe(1);
      expect(restored.eligibility_sha256).toMatch(/^[0-9a-f]{64}$/u);

      const approved = await db.query<{ value: ApprovalResult }>(`
        SELECT public.approve_vendor_disclosure_validated_batch(
          '${ACTOR_ID}', 25, 1, '${restored.eligibility_sha256}'
        ) AS value
      `);
      expect(approved.rows[0]?.value).toMatchObject({
        eligibility_contract_version: 1,
        approved_count: 1,
        approved_price_ids: [PRICE_ID],
      });
      expect(approved.rows[0]?.value.approval_receipt_sha256).toMatch(
        /^[0-9a-f]{64}$/u,
      );

      const committed = await db.query<{
        audit_count: number;
        review_event_count: number;
        review_status: string;
        review_version: number;
      }>(`
        SELECT price.review_status, price.review_version::integer,
          (SELECT count(*)::integer FROM public.official_review_events)
            AS review_event_count,
          (SELECT count(*)::integer
           FROM public.vendor_disclosure_bulk_approval_audits) AS audit_count
        FROM public.official_prices AS price
        WHERE price.id = '${PRICE_ID}'
      `);
      expect(committed.rows).toEqual([{
        review_status: "approved",
        review_version: 1,
        review_event_count: 1,
        audit_count: 1,
      }]);
    } finally {
      await db.close();
    }
  });
});
