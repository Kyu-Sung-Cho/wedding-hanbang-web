// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722197000_vendor_disclosure_exact_semantic_duplicate_canonicalization.sql",
  ),
  "utf8",
);

const SNAPSHOT_ID = "10000000-0000-4000-8000-000000000001";
const RUN_SHA = "a".repeat(64);
const UNIT_A = "b".repeat(64);
const UNIT_B = "c".repeat(64);
const SOURCE_KEY = "d".repeat(64);
const CONTENT_FINGERPRINT = "e".repeat(64);
const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

function semanticRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 2,
    unit_id: UNIT_A,
    record_kind: "document_section",
    semantic_type: "other",
    subject_kind: "vendor",
    subject_name: "Synthetic Vendor",
    subject_normalized_name: "synthetic vendor",
    partner_record_ref: null,
    source_agency: null,
    partner_link_status: "not_applicable",
    vendor_category: null,
    region_code: "seoul",
    title: "50,000원",
    content_verbatim: "50,000원",
    summary: null,
    review_status: "pending",
    needs_review: true,
    validation_issue_codes: ["local_deterministic_review_only"],
    source_file_ids: ["f".repeat(64)],
    source_file: "synthetic.xlsx",
    source_object_keys: [`${"f".repeat(64)}.xlsx`],
    source_preview_keys: [`${"1".repeat(64)}.txt`],
    source_quote: "Sheet1!A1: 50,000원",
    source_fingerprint: "2".repeat(64),
    validation_fingerprint: "3".repeat(64),
    confidence: 0.5,
    source_record_key: SOURCE_KEY,
    content_fingerprint: CONTENT_FINGERPRINT,
    ...overrides,
  };
}

async function migrationDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  openDatabases.push(db);
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    CREATE TABLE public.disclosure_semantic_staging (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL,
      schema_version integer NOT NULL,
      unit_id text NOT NULL,
      record_kind text NOT NULL,
      semantic_type text NOT NULL,
      subject_kind text NOT NULL,
      subject_name text NOT NULL,
      subject_normalized_name text NOT NULL,
      vendor_category text,
      region_code text NOT NULL,
      title text,
      content_verbatim text NOT NULL,
      summary text,
      partner_record_ref text,
      partner_vendor_id uuid,
      official_price_id uuid,
      source_agency jsonb,
      partner_link_status text NOT NULL,
      review_status text NOT NULL,
      needs_review boolean NOT NULL,
      validation_issue_codes text[] NOT NULL,
      source_file_ids text[] NOT NULL,
      source_file text NOT NULL,
      source_object_keys text[] NOT NULL,
      source_preview_keys text[] NOT NULL,
      source_quote text NOT NULL,
      source_fingerprint text NOT NULL,
      validation_fingerprint text NOT NULL,
      confidence numeric NOT NULL,
      source_record_key text NOT NULL,
      content_fingerprint text NOT NULL,
      UNIQUE (snapshot_id, source_record_key)
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_rows (
      run_sha256 text NOT NULL,
      batch_index integer NOT NULL,
      unit_id text NOT NULL,
      row_kind text NOT NULL,
      row_id uuid NOT NULL,
      PRIMARY KEY (run_sha256, row_kind, row_id)
    );
    CREATE TABLE public.vendor_disclosure_ingest_record_bindings (
      run_sha256 text NOT NULL,
      batch_index integer NOT NULL,
      unit_id text NOT NULL,
      row_kind text NOT NULL,
      row_id uuid NOT NULL,
      record_ref text NOT NULL,
      vendor_id uuid,
      agency_id uuid,
      linked_official_price_id uuid,
      PRIMARY KEY (run_sha256, row_kind, row_id)
    );

    CREATE OR REPLACE FUNCTION public.stage_vendor_disclosure_batch_atomic(
      p_target_project_ref text,
      p_run_sha256 text,
      p_full_plan_sha256 text,
      p_batch_plan_sha256 text,
      p_batch_sha256 text,
      p_batch_index integer,
      p_batch_count integer,
      p_snapshot_source text,
      p_snapshot_period text,
      p_authorization_kind text,
      p_authorization_sha256 text,
      p_local_pending_only_unit_ids text[],
      p_storage_objects jsonb,
      p_payload jsonb
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $stage_vendor_disclosure_batch_atomic$
    DECLARE
      snapshot_row record;
      row_value jsonb;
      vendor_id_value uuid := NULL;
      official_price_id_value uuid := NULL;
      partner_ref_value text;
      semantic_id_value uuid;
    BEGIN
      SELECT '${SNAPSHOT_ID}'::uuid AS id INTO snapshot_row;
      FOR row_value IN
        SELECT semantic.value
        FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
      LOOP
        partner_ref_value := NULLIF(row_value ->> 'partner_record_ref', '');
        IF EXISTS (
          SELECT 1 FROM public.disclosure_semantic_staging AS semantic
          WHERE semantic.snapshot_id = snapshot_row.id
            AND semantic.source_record_key = row_value ->> 'source_record_key'
        ) THEN
          RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
        END IF;
        INSERT INTO public.disclosure_semantic_staging (
          snapshot_id, schema_version, unit_id, record_kind, semantic_type,
          subject_kind, subject_name, subject_normalized_name, vendor_category,
          region_code, title, content_verbatim, summary, partner_record_ref,
          partner_vendor_id, official_price_id, source_agency, partner_link_status,
          review_status, needs_review, validation_issue_codes, source_file_ids,
          source_file, source_object_keys, source_preview_keys, source_quote,
          source_fingerprint, validation_fingerprint, confidence,
          source_record_key, content_fingerprint
        ) VALUES (
          snapshot_row.id, (row_value ->> 'schema_version')::integer,
          row_value ->> 'unit_id', row_value ->> 'record_kind', row_value ->> 'semantic_type',
          row_value ->> 'subject_kind', row_value ->> 'subject_name',
          row_value ->> 'subject_normalized_name', row_value ->> 'vendor_category',
          row_value ->> 'region_code', row_value ->> 'title',
          row_value ->> 'content_verbatim', row_value ->> 'summary', partner_ref_value,
          vendor_id_value, official_price_id_value,
          CASE WHEN jsonb_typeof(row_value -> 'source_agency') = 'object'
            THEN row_value -> 'source_agency' ELSE NULL END,
          row_value ->> 'partner_link_status', row_value ->> 'review_status',
          (row_value ->> 'needs_review')::boolean,
          ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
          ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_file_ids')),
          row_value ->> 'source_file',
          ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_object_keys')),
          ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_preview_keys')),
          row_value ->> 'source_quote', row_value ->> 'source_fingerprint',
          row_value ->> 'validation_fingerprint', (row_value ->> 'confidence')::numeric,
          row_value ->> 'source_record_key', row_value ->> 'content_fingerprint'
        ) RETURNING id INTO semantic_id_value;
        INSERT INTO public.vendor_disclosure_ingest_owned_rows (
          run_sha256, batch_index, unit_id, row_kind, row_id
        ) VALUES (
          p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'semantic', semantic_id_value
        );
        INSERT INTO public.vendor_disclosure_ingest_record_bindings (
          run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
          vendor_id, agency_id, linked_official_price_id
        ) VALUES (
          p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'semantic',
          semantic_id_value, COALESCE(partner_ref_value, row_value ->> 'source_record_key'),
          vendor_id_value, NULL, official_price_id_value
        );
      END LOOP;
      RETURN (
        SELECT count(*)::integer FROM public.disclosure_semantic_staging
      );
    END;
    $stage_vendor_disclosure_batch_atomic$;
  `);
  await db.exec(migration);
  return db;
}

async function invoke(
  db: PGlite,
  authorizationKind: "local_validated_pending_only" | "paid_pilot_gate",
  rows: Record<string, unknown>[],
): Promise<void> {
  await db.exec(`
    SELECT public.stage_vendor_disclosure_batch_atomic(
      'synthetic-project', '${RUN_SHA}', repeat('4', 64), repeat('5', 64),
      repeat('6', 64), 1, 1, 'synthetic', '2026Q3', '${authorizationKind}',
      repeat('7', 64), ARRAY['${UNIT_A}', '${UNIT_B}'], '[]'::jsonb,
      $payload$${JSON.stringify({ disclosure_semantics: rows })}$payload$::jsonb
    );
  `);
}

describe("exact semantic duplicate canonicalization migration", () => {
  it("retains one exact local-only row and its immutable ownership binding", async () => {
    const db = await migrationDatabase();
    const row = semanticRow();

    await invoke(db, "local_validated_pending_only", [row, structuredClone(row)]);

    const result = await db.query<{ semantics: number; owned: number; bindings: number }>(`
      SELECT
        (SELECT count(*)::integer FROM public.disclosure_semantic_staging) AS semantics,
        (SELECT count(*)::integer FROM public.vendor_disclosure_ingest_owned_rows) AS owned,
        (SELECT count(*)::integer FROM public.vendor_disclosure_ingest_record_bindings) AS bindings
    `);
    expect(result.rows).toEqual([{ semantics: 1, owned: 1, bindings: 1 }]);
  });

  it("fails closed when one source key carries different content", async () => {
    const db = await migrationDatabase();
    const first = semanticRow();
    const changed = semanticRow({
      content_verbatim: "different content",
      content_fingerprint: "8".repeat(64),
    });

    await expect(invoke(
      db,
      "local_validated_pending_only",
      [first, changed],
    )).rejects.toThrow(/DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION/iu);

    const result = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.disclosure_semantic_staging",
    );
    expect(result.rows).toEqual([{ count: 0 }]);
  });

  it("does not canonicalize paid or cross-unit duplicates", async () => {
    const paidDb = await migrationDatabase();
    const row = semanticRow();
    await expect(invoke(
      paidDb,
      "paid_pilot_gate",
      [row, structuredClone(row)],
    )).rejects.toThrow(/DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION/iu);

    const crossUnitDb = await migrationDatabase();
    await expect(invoke(
      crossUnitDb,
      "local_validated_pending_only",
      [row, semanticRow({ unit_id: UNIT_B })],
    )).rejects.toThrow(/DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION/iu);
  });
});
