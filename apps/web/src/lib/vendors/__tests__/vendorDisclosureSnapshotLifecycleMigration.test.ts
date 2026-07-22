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

function migrationSlice(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`migration slice missing: ${start} -> ${end}`);
  }
  return migration.slice(startIndex, endIndex);
}

const unitIdsSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_unit_ids_are_safe",
  "CREATE TABLE public.vendor_disclosure_ingest_batches",
);
const prepareSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.prepare_vendor_disclosure_batch_storage_atomic",
  "CREATE OR REPLACE FUNCTION public.record_vendor_disclosure_storage_object_atomic",
);
const stageSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.stage_vendor_disclosure_batch_atomic",
  "CREATE OR REPLACE FUNCTION public.verify_vendor_disclosure_batch_receipt_atomic",
);
const verifySql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.verify_vendor_disclosure_batch_receipt_atomic",
  "CREATE OR REPLACE FUNCTION public.finalize_vendor_disclosure_dedupe_atomic",
);
const finalizeSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.finalize_vendor_disclosure_dedupe_atomic",
  "-- A completed draft run can be quarantined",
);
const invalidateSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.invalidate_vendor_disclosure_completed_run_atomic",
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_identity_has_external_references",
);
const ensureVendorSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.ensure_vendor_disclosure_vendor_pending",
  "CREATE OR REPLACE FUNCTION public.stage_vendor_disclosure_batch_atomic",
);
const pendingInsertGuardSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.guard_vendor_disclosure_atomic_pending_insert",
  "-- The historical parent guard intentionally allowed service-role recovery",
);
const parentGuardSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.guard_official_review_parent_write",
  "-- The insert fence above was necessary but not sufficient",
);
const protectedWriteGuardSql = migrationSlice(
  "CREATE OR REPLACE FUNCTION public.guard_vendor_disclosure_atomic_protected_write",
  "-- Base-table writes are RPC-only after this migration",
);

const PROJECT_REF = "staging-ref";
const PERIOD = "2026Q3";
const UNIT_ID = "1".repeat(64);
const FIRST_RUN = "2".repeat(64);
const FIRST_PLAN = "3".repeat(64);
const SECOND_RUN = "4".repeat(64);
const SECOND_PLAN = "5".repeat(64);
const AUTH_SHA = "6".repeat(64);
const BATCH_PLAN_SHA = "7".repeat(64);
const BATCH_SHA = "8".repeat(64);
const RECEIPT_SHA = "9".repeat(64);
const PAYLOAD_SHA = "a".repeat(64);
const CANDIDATE_SHA = "b".repeat(64);
const VENDOR_A = "10000000-0000-4000-8000-000000000001";
const VENDOR_B = "10000000-0000-4000-8000-000000000002";
const FIRST_PRICE = "20000000-0000-4000-8000-000000000001";
const SECOND_PRICE = "20000000-0000-4000-8000-000000000002";
const OPTION_ID = "30000000-0000-4000-8000-000000000001";
const ALIAS_ID = "40000000-0000-4000-8000-000000000001";
const PACKAGE_ID = "50000000-0000-4000-8000-000000000001";
const SEMANTIC_ID = "60000000-0000-4000-8000-000000000001";
const OBJECT_SHA = "c".repeat(64);
const OBJECT_KEY = `${OBJECT_SHA}.pdf`;

function jsonbLiteral(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

async function createLifecycleDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE SCHEMA extensions;
    CREATE SCHEMA storage;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      user_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (bucket_id, name)
    );

    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      period_label text NOT NULL,
      source text NOT NULL,
      source_url text,
      source_note text,
      collected_at date NOT NULL DEFAULT CURRENT_DATE,
      published_at date,
      published boolean NOT NULL DEFAULT false,
      is_current boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source, period_label)
    );
    CREATE TABLE public.vendor_disclosure_ingest_runs (
      run_sha256 text PRIMARY KEY,
      target_project_ref text NOT NULL,
      full_plan_sha256 text NOT NULL,
      authorization_kind text NOT NULL,
      authorization_sha256 text NOT NULL,
      local_pending_only_unit_ids text[] NOT NULL DEFAULT '{}',
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      snapshot_source text NOT NULL,
      snapshot_period text NOT NULL,
      snapshot_created_by_run boolean NOT NULL DEFAULT false,
      supersedes_run_sha256 text UNIQUE REFERENCES public.vendor_disclosure_ingest_runs(run_sha256),
      batch_count integer NOT NULL,
      completed_batch_count integer NOT NULL DEFAULT 0,
      dedupe_candidates_sha256 text,
      dedupe_payload_sha256 text,
      status text NOT NULL DEFAULT 'active',
      aborted_at timestamptz,
      abort_reason text,
      storage_rollback_receipt_sha256 text,
      invalidated_at timestamptz,
      invalidation_reason text,
      invalidation_receipt_sha256 text,
      dedupe_finalized_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX one_live_snapshot
      ON public.vendor_disclosure_ingest_runs (snapshot_id)
      WHERE status IN ('active', 'complete');
    CREATE TABLE public.vendor_disclosure_ingest_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256),
      batch_index integer NOT NULL,
      batch_sha256 text NOT NULL,
      batch_plan_sha256 text NOT NULL,
      payload_sha256 text NOT NULL,
      batch_receipt_sha256 text NOT NULL,
      unit_ids text[] NOT NULL,
      staged_record_count integer NOT NULL,
      needs_review_count integer NOT NULL,
      logged_ledger_ids text[] NOT NULL DEFAULT '{}',
      applied_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (run_sha256, batch_index),
      UNIQUE (run_sha256, batch_sha256)
    );
    CREATE TABLE public.vendor_disclosure_ingest_storage_links (
      run_sha256 text NOT NULL,
      batch_index integer NOT NULL,
      bucket_id text NOT NULL,
      object_name text NOT NULL,
      object_sha256 text NOT NULL,
      object_bytes bigint NOT NULL,
      ownership_state text NOT NULL DEFAULT 'intent',
      storage_metadata_owner_run_sha256 text,
      storage_object_id uuid,
      storage_object_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz,
      deleted_at timestamptz,
      PRIMARY KEY (run_sha256, bucket_id, object_name)
    );

    CREATE TABLE public.vendors (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.agencies (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      vendor_id uuid REFERENCES public.vendors(id),
      agency_id uuid REFERENCES public.agencies(id),
      review_status text NOT NULL,
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0,
      category text,
      item_name text,
      needs_review boolean,
      validation_issue_codes text[],
      source_object_keys text[],
      source_preview_keys text[]
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY,
      official_price_id uuid NOT NULL REFERENCES public.official_prices(id) ON DELETE CASCADE,
      name text NOT NULL
    );
    CREATE TABLE public.vendor_alias_proposals (
      id uuid PRIMARY KEY,
      official_price_id uuid NOT NULL REFERENCES public.official_prices(id) ON DELETE CASCADE,
      alias text NOT NULL
    );
    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      review_status text NOT NULL,
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0
    );
    CREATE TABLE public.disclosure_semantic_staging (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      official_price_id uuid REFERENCES public.official_prices(id) ON DELETE RESTRICT,
      review_status text NOT NULL
    );
    CREATE TABLE public.official_review_events (
      entity_kind text NOT NULL,
      entity_id uuid NOT NULL
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_rows (
      run_sha256 text NOT NULL,
      batch_index integer NOT NULL,
      unit_id text NOT NULL,
      row_kind text NOT NULL,
      row_id uuid NOT NULL,
      PRIMARY KEY (run_sha256, row_kind, row_id)
    );
    CREATE TABLE public.vendor_disclosure_ingest_identity_links (
      run_sha256 text NOT NULL,
      unit_id text NOT NULL,
      identity_kind text NOT NULL,
      record_ref text NOT NULL DEFAULT '',
      vendor_id uuid,
      agency_id uuid,
      official_price_id uuid REFERENCES public.official_prices(id) ON DELETE RESTRICT
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
      binding_sha256 text NOT NULL
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_identities (
      run_sha256 text NOT NULL,
      batch_index integer NOT NULL,
      identity_kind text NOT NULL,
      identity_id uuid NOT NULL,
      parent_vendor_id uuid,
      initial_row_sha256 text NOT NULL,
      cleanup_status text NOT NULL
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_ledger_rows (
      run_sha256 text NOT NULL,
      batch_index integer NOT NULL,
      ledger_id uuid NOT NULL,
      initial_row_sha256 text NOT NULL,
      created_by_run boolean NOT NULL,
      cleanup_status text NOT NULL
    );
    CREATE TABLE public.vendor_dedupe_candidates (
      left_vendor_id uuid NOT NULL,
      right_vendor_id uuid NOT NULL,
      reason text NOT NULL,
      similarity numeric NOT NULL,
      status text NOT NULL,
      UNIQUE (left_vendor_id, right_vendor_id)
    );
    CREATE TABLE public.agency_dedupe_candidates (
      left_agency_id uuid NOT NULL,
      right_agency_id uuid NOT NULL,
      reason text NOT NULL,
      similarity numeric NOT NULL,
      status text NOT NULL,
      UNIQUE (left_agency_id, right_agency_id)
    );
    CREATE TABLE public.vendor_disclosure_ingest_dedupe_links (
      run_sha256 text NOT NULL,
      entity_kind text NOT NULL,
      left_identity_id uuid NOT NULL,
      right_identity_id uuid NOT NULL,
      reason text NOT NULL,
      similarity numeric NOT NULL,
      created_by_run boolean NOT NULL,
      initial_candidate_sha256 text NOT NULL,
      cleanup_status text NOT NULL,
      PRIMARY KEY (run_sha256, entity_kind, left_identity_id, right_identity_id)
    );
    CREATE TABLE public.ai_interactions_log (id uuid PRIMARY KEY);

    CREATE FUNCTION public.vendor_disclosure_payload_provenance_is_safe(jsonb)
    RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
  `);
  await db.exec(unitIdsSql);
  await db.exec(prepareSql);
  await db.exec(stageSql);
  await db.exec(pendingInsertGuardSql);
  await db.exec(parentGuardSql);
  await db.exec(`
    CREATE TRIGGER official_prices_parent_review_write_fence
    BEFORE INSERT OR UPDATE OR DELETE ON public.official_prices
    FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_parent_write();
    CREATE TRIGGER official_agency_packages_parent_review_write_fence
    BEFORE INSERT OR UPDATE OR DELETE ON public.official_agency_packages
    FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_parent_write();
  `);
  await db.exec(protectedWriteGuardSql);
  await db.exec(verifySql);
  await db.exec(finalizeSql);
  await db.exec(invalidateSql);
  return db;
}

const storageIntent = [{
  bucket: "disclosure-raw",
  object_key: OBJECT_KEY,
  sha256: OBJECT_SHA,
  bytes: 100,
}];

async function prepareRun(
  db: PGlite,
  runSha: string,
  planSha: string,
): Promise<void> {
  await db.query(`
    SELECT * FROM public.prepare_vendor_disclosure_batch_storage_atomic(
      '${PROJECT_REF}', '${runSha}', '${planSha}', 1, 1,
      'kca_tprice', '${PERIOD}', 'local_validated_pending_only', '${AUTH_SHA}',
      ARRAY['${UNIT_ID}'], ${jsonbLiteral(storageIntent)}
    )
  `);
}

describe("vendor disclosure snapshot lifecycle migration", () => {
  it("bootstraps a fresh draft and permits one audited corrected successor after cleanup", async () => {
    const db = await createLifecycleDatabase();
    try {
      await prepareRun(db, FIRST_RUN, FIRST_PLAN);
      const bootstrapped = await db.query<{
        snapshot_count: number;
        snapshot_created_by_run: boolean;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.price_snapshots) AS snapshot_count,
          snapshot_created_by_run
        FROM public.vendor_disclosure_ingest_runs
        WHERE run_sha256 = '${FIRST_RUN}'
      `);
      expect(bootstrapped.rows[0]).toEqual({
        snapshot_count: 1,
        snapshot_created_by_run: true,
      });

      const snapshot = await db.query<{ id: string }>(`
        SELECT id FROM public.price_snapshots
        WHERE source = 'kca_tprice' AND period_label = '${PERIOD}'
      `);
      const snapshotId = snapshot.rows[0]!.id;
      await db.exec(`
        BEGIN;
        SELECT set_config(
          'app.vendor_disclosure_atomic_run_sha256', '${FIRST_RUN}', true
        );
        INSERT INTO public.vendors VALUES
          ('${VENDOR_A}', 'First vendor'), ('${VENDOR_B}', 'Second vendor');
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, review_status, category, item_name,
          needs_review, validation_issue_codes, source_object_keys, source_preview_keys
        ) VALUES (
          '${FIRST_PRICE}', '${snapshotId}', '${VENDOR_A}', 'pending',
          'studio', 'Original price', true, '{}', ARRAY['${OBJECT_KEY}'], '{}'
        );
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES
          ('${FIRST_RUN}', 1, '${UNIT_ID}', 'official_price', '${FIRST_PRICE}');
        INSERT INTO public.official_price_options VALUES
          ('${OPTION_ID}', '${FIRST_PRICE}', 'Original option');
        INSERT INTO public.vendor_alias_proposals VALUES
          ('${ALIAS_ID}', '${FIRST_PRICE}', 'Original alias');
        INSERT INTO public.official_agency_packages (
          id, snapshot_id, review_status
        ) VALUES ('${PACKAGE_ID}', '${snapshotId}', 'pending');
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES
          ('${FIRST_RUN}', 1, '${UNIT_ID}', 'agency_package', '${PACKAGE_ID}');
        INSERT INTO public.disclosure_semantic_staging (
          id, snapshot_id, official_price_id, review_status
        ) VALUES ('${SEMANTIC_ID}', '${snapshotId}', '${FIRST_PRICE}', 'pending');
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES
          ('${FIRST_RUN}', 1, '${UNIT_ID}', 'semantic', '${SEMANTIC_ID}');
        INSERT INTO public.vendor_disclosure_ingest_batches (
          run_sha256, batch_index, batch_sha256, batch_plan_sha256,
          payload_sha256, batch_receipt_sha256, unit_ids,
          staged_record_count, needs_review_count
        ) VALUES (
          '${FIRST_RUN}', 1, '${BATCH_SHA}', '${BATCH_PLAN_SHA}',
          '${PAYLOAD_SHA}', '${RECEIPT_SHA}', ARRAY['${UNIT_ID}'], 3, 3
        );
        INSERT INTO public.vendor_disclosure_ingest_identity_links VALUES
          ('${FIRST_RUN}', '${UNIT_ID}', 'vendor', 'original-price',
           '${VENDOR_A}', NULL, '${FIRST_PRICE}');
        INSERT INTO public.vendor_disclosure_ingest_record_bindings VALUES
          ('${FIRST_RUN}', 1, '${UNIT_ID}', 'official_price', '${FIRST_PRICE}',
           'original-price', '${VENDOR_A}', NULL, NULL, '${"d".repeat(64)}');
        INSERT INTO public.vendor_dedupe_candidates VALUES
          ('${VENDOR_A}', '${VENDOR_B}', 'original candidate', 0.91, 'pending');
        INSERT INTO public.vendor_disclosure_ingest_dedupe_links VALUES
          ('${FIRST_RUN}', 'vendor', '${VENDOR_A}', '${VENDOR_B}',
           'original candidate', 0.91, true, '${CANDIDATE_SHA}', 'owned');
        UPDATE public.vendor_disclosure_ingest_storage_links
        SET ownership_state = 'confirmed_created',
            storage_metadata_owner_run_sha256 = '${FIRST_RUN}'
        WHERE run_sha256 = '${FIRST_RUN}';
        UPDATE public.vendor_disclosure_ingest_runs
        SET status = 'complete', completed_batch_count = 1,
            dedupe_finalized_at = now(),
            dedupe_candidates_sha256 = '${CANDIDATE_SHA}',
            dedupe_payload_sha256 = '${"e".repeat(64)}'
        WHERE run_sha256 = '${FIRST_RUN}';
        COMMIT;
      `);

      const invalidated = await db.query<{
        invalidated: boolean;
        already_invalidated: boolean;
        invalidation_receipt_sha256: string;
      }>(`
        SELECT * FROM public.invalidate_vendor_disclosure_completed_run_atomic(
          '${PROJECT_REF}', '${FIRST_RUN}', '${FIRST_PLAN}', 'correct source mapping'
        )
      `);
      expect(invalidated.rows[0]).toMatchObject({
        invalidated: true,
        already_invalidated: false,
      });
      expect(invalidated.rows[0]!.invalidation_receipt_sha256).toMatch(/^[a-f0-9]{64}$/u);

      const cleanup = await db.query<{
        prices: number;
        options: number;
        aliases: number;
        packages: number;
        semantics: number;
        candidates: number;
        owned_rows: number;
        bindings: number;
        identity_price_id: string | null;
        storage_state: string;
        dedupe_cleanup: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.official_prices) AS prices,
          (SELECT count(*)::integer FROM public.official_price_options) AS options,
          (SELECT count(*)::integer FROM public.vendor_alias_proposals) AS aliases,
          (SELECT count(*)::integer FROM public.official_agency_packages) AS packages,
          (SELECT count(*)::integer FROM public.disclosure_semantic_staging) AS semantics,
          (SELECT count(*)::integer FROM public.vendor_dedupe_candidates) AS candidates,
          (SELECT count(*)::integer FROM public.vendor_disclosure_ingest_owned_rows
            WHERE run_sha256 = '${FIRST_RUN}') AS owned_rows,
          (SELECT count(*)::integer FROM public.vendor_disclosure_ingest_record_bindings
            WHERE run_sha256 = '${FIRST_RUN}') AS bindings,
          (SELECT official_price_id FROM public.vendor_disclosure_ingest_identity_links
            WHERE run_sha256 = '${FIRST_RUN}') AS identity_price_id,
          (SELECT ownership_state FROM public.vendor_disclosure_ingest_storage_links
            WHERE run_sha256 = '${FIRST_RUN}') AS storage_state,
          (SELECT cleanup_status FROM public.vendor_disclosure_ingest_dedupe_links
            WHERE run_sha256 = '${FIRST_RUN}') AS dedupe_cleanup
      `);
      expect(cleanup.rows[0]).toEqual({
        prices: 0,
        options: 0,
        aliases: 0,
        packages: 0,
        semantics: 0,
        candidates: 0,
        owned_rows: 3,
        bindings: 1,
        identity_price_id: null,
        storage_state: "retained_shared",
        dedupe_cleanup: "deleted",
      });

      await prepareRun(db, SECOND_RUN, SECOND_PLAN);
      const successor = await db.query<{
        snapshot_count: number;
        snapshot_created_by_run: boolean;
        supersedes_run_sha256: string;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.price_snapshots) AS snapshot_count,
          snapshot_created_by_run, supersedes_run_sha256
        FROM public.vendor_disclosure_ingest_runs
        WHERE run_sha256 = '${SECOND_RUN}'
      `);
      expect(successor.rows[0]).toEqual({
        snapshot_count: 1,
        snapshot_created_by_run: false,
        supersedes_run_sha256: FIRST_RUN,
      });

      await db.exec(`
        BEGIN;
        SELECT set_config(
          'app.vendor_disclosure_atomic_run_sha256', '${SECOND_RUN}', true
        );
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, review_status, category, item_name,
          needs_review, validation_issue_codes, source_object_keys, source_preview_keys
        ) VALUES (
          '${SECOND_PRICE}', '${snapshotId}', '${VENDOR_A}', 'pending',
          'studio', 'Corrected price', true, '{}', ARRAY['${OBJECT_KEY}'], '{}'
        );
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES
          ('${SECOND_RUN}', 1, '${UNIT_ID}', 'official_price', '${SECOND_PRICE}');
        INSERT INTO public.official_price_options VALUES
          (gen_random_uuid(), '${SECOND_PRICE}', 'Corrected option');
        INSERT INTO public.vendor_alias_proposals VALUES
          (gen_random_uuid(), '${SECOND_PRICE}', 'Corrected alias');
        INSERT INTO public.vendor_dedupe_candidates VALUES
          ('${VENDOR_A}', '${VENDOR_B}', 'corrected candidate', 0.87, 'pending');
        INSERT INTO public.vendor_disclosure_ingest_batches (
          run_sha256, batch_index, batch_sha256, batch_plan_sha256,
          payload_sha256, batch_receipt_sha256, unit_ids,
          staged_record_count, needs_review_count
        ) VALUES (
          '${SECOND_RUN}', 1, '${"f".repeat(64)}', '${BATCH_PLAN_SHA}',
          '${PAYLOAD_SHA}', '${RECEIPT_SHA}', ARRAY['${UNIT_ID}'], 1, 1
        );
        UPDATE public.vendor_disclosure_ingest_runs
        SET completed_batch_count = 1
        WHERE run_sha256 = '${SECOND_RUN}';
        COMMIT;
      `);
      await db.query(`
        SELECT * FROM public.finalize_vendor_disclosure_dedupe_atomic(
          '${PROJECT_REF}', '${SECOND_RUN}', '${SECOND_PLAN}', '${"0".repeat(64)}',
          ARRAY['${"f".repeat(64)}'], '[]'::jsonb
        )
      `);
      const corrected = await db.query<{ status: string; price_count: number }>(`
        SELECT status,
          (SELECT count(*)::integer FROM public.official_prices
           WHERE snapshot_id = '${snapshotId}') AS price_count
        FROM public.vendor_disclosure_ingest_runs
        WHERE run_sha256 = '${SECOND_RUN}'
      `);
      expect(corrected.rows[0]).toEqual({ status: "complete", price_count: 1 });
    } finally {
      await db.close();
    }
  });

  it("rejects a copied invalidation marker from direct SQL and another postgres-owned function", async () => {
    const db = await createLifecycleDatabase();
    try {
      await prepareRun(db, FIRST_RUN, FIRST_PLAN);
      const snapshot = await db.query<{ id: string }>(`
        SELECT id FROM public.price_snapshots
        WHERE source = 'kca_tprice' AND period_label = '${PERIOD}'
      `);
      const snapshotId = snapshot.rows[0]!.id;
      await db.exec(`
        BEGIN;
        SELECT set_config(
          'app.vendor_disclosure_atomic_run_sha256', '${FIRST_RUN}', true
        );
        INSERT INTO public.vendors VALUES ('${VENDOR_A}', 'Guarded vendor');
        INSERT INTO public.official_prices (
          id, snapshot_id, vendor_id, review_status, category, item_name,
          needs_review, validation_issue_codes, source_object_keys, source_preview_keys
        ) VALUES (
          '${FIRST_PRICE}', '${snapshotId}', '${VENDOR_A}', 'pending',
          'studio', 'Guarded price', true, '{}', ARRAY['${OBJECT_KEY}'], '{}'
        ), (
          '${SECOND_PRICE}', '${snapshotId}', '${VENDOR_A}', 'pending',
          'studio', 'Unowned control price', true, '{}', ARRAY['${OBJECT_KEY}'], '{}'
        );
        INSERT INTO public.vendor_disclosure_ingest_owned_rows VALUES
          ('${FIRST_RUN}', 1, '${UNIT_ID}', 'official_price', '${FIRST_PRICE}');
        INSERT INTO public.official_price_options VALUES
          ('${OPTION_ID}', '${FIRST_PRICE}', 'Guarded option');
        UPDATE public.vendor_disclosure_ingest_runs
        SET status = 'complete'
        WHERE run_sha256 = '${FIRST_RUN}';
        COMMIT;
      `);

      await db.exec("BEGIN");
      await db.query(`
        SELECT set_config(
          'app.vendor_disclosure_atomic_invalidate_run_sha256',
          '${FIRST_RUN}', true
        )
      `);
      await expect(db.query(`
        DELETE FROM public.official_price_options WHERE id = '${OPTION_ID}'
      `)).rejects.toMatchObject({ code: "42501" });
      await db.exec("ROLLBACK");

      await db.exec(`
        CREATE FUNCTION public.spoof_vendor_disclosure_invalidation(text, uuid)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog, public, pg_temp
        AS $spoof_vendor_disclosure_invalidation$
        BEGIN
          PERFORM set_config(
            'app.vendor_disclosure_atomic_invalidate_run_sha256', $1, true
          );
          DELETE FROM public.official_prices WHERE id = $2;
        END;
        $spoof_vendor_disclosure_invalidation$;
      `);
      await expect(db.query(`
        SELECT public.spoof_vendor_disclosure_invalidation(
          '${FIRST_RUN}', '${FIRST_PRICE}'
        )
      `)).rejects.toMatchObject({ code: "42501" });

      // Isolate the inherited parent guard as well: even without the newer
      // protected-write trigger, the copied marker from the wrong function is
      // not a valid delete capability.
      await db.exec(`
        ALTER TABLE public.official_prices
        DISABLE TRIGGER official_prices_atomic_protected_write_fence
      `);
      await expect(db.query(`
        SELECT public.spoof_vendor_disclosure_invalidation(
          '${FIRST_RUN}', '${FIRST_PRICE}'
        )
      `)).rejects.toMatchObject({ code: "42501" });
      await db.exec(`
        ALTER TABLE public.official_prices
        ENABLE TRIGGER official_prices_atomic_protected_write_fence
      `);

      // Even the exact function identity cannot use one run's marker to
      // delete a different, unowned row. Replacing the body is safe here
      // because this database exists only for this isolated guard test.
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.invalidate_vendor_disclosure_completed_run_atomic(
          p_target_project_ref text,
          p_run_sha256 text,
          p_full_plan_sha256 text,
          p_reason text
        )
        RETURNS TABLE (
          invalidated boolean,
          already_invalidated boolean,
          invalidation_receipt_sha256 text
        )
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog, public, pg_temp
        AS $wrong_row_invalidation$
        BEGIN
          PERFORM set_config(
            'app.vendor_disclosure_atomic_invalidate_run_sha256',
            p_run_sha256,
            true
          );
          DELETE FROM public.official_prices WHERE id = p_reason::uuid;
          invalidated := true;
          already_invalidated := false;
          invalidation_receipt_sha256 := repeat('0', 64);
          RETURN NEXT;
        END;
        $wrong_row_invalidation$;
      `);
      await expect(db.query(`
        SELECT * FROM public.invalidate_vendor_disclosure_completed_run_atomic(
          '${PROJECT_REF}', '${FIRST_RUN}', '${FIRST_PLAN}', '${SECOND_PRICE}'
        )
      `)).rejects.toMatchObject({ code: "42501" });

      const retained = await db.query<{ prices: number; options: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.official_prices) AS prices,
          (SELECT count(*)::integer FROM public.official_price_options) AS options
      `);
      expect(retained.rows[0]).toEqual({ prices: 2, options: 1 });
    } finally {
      await db.close();
    }
  });

  it("fails closed when more than one invalidated predecessor is eligible", async () => {
    const db = await createLifecycleDatabase();
    try {
      await db.exec(`
        INSERT INTO public.price_snapshots (period_label, source)
        VALUES ('${PERIOD}', 'kca_tprice');
        INSERT INTO public.vendor_disclosure_ingest_runs (
          run_sha256, target_project_ref, full_plan_sha256,
          authorization_kind, authorization_sha256, local_pending_only_unit_ids,
          snapshot_id, snapshot_source, snapshot_period, batch_count, status
        )
        SELECT terminal.run_sha, '${PROJECT_REF}', terminal.plan_sha,
          'local_validated_pending_only', '${AUTH_SHA}', ARRAY['${UNIT_ID}'],
          snapshot.id, 'kca_tprice', '${PERIOD}', 1, 'invalidated'
        FROM public.price_snapshots AS snapshot
        CROSS JOIN (VALUES
          ('${"d".repeat(64)}', '${"e".repeat(64)}'),
          ('${"e".repeat(64)}', '${"f".repeat(64)}')
        ) AS terminal(run_sha, plan_sha);
      `);
      await expect(prepareRun(db, FIRST_RUN, FIRST_PLAN)).rejects.toMatchObject({
        code: "23514",
      });
    } finally {
      await db.close();
    }
  });

  it.each(["invalidated", "aborted"])(
    "hard-fails stage, receipt, and finalizer replay for a %s run",
    async (terminalStatus) => {
      const db = await createLifecycleDatabase();
      try {
        await prepareRun(db, FIRST_RUN, FIRST_PLAN);
        await db.exec(`
          INSERT INTO public.vendor_disclosure_ingest_batches (
            run_sha256, batch_index, batch_sha256, batch_plan_sha256,
            payload_sha256, batch_receipt_sha256, unit_ids,
            staged_record_count, needs_review_count
          ) VALUES (
            '${FIRST_RUN}', 1, '${BATCH_SHA}', '${BATCH_PLAN_SHA}',
            '${PAYLOAD_SHA}', '${RECEIPT_SHA}', ARRAY['${UNIT_ID}'], 1, 1
          );
          UPDATE public.vendor_disclosure_ingest_runs
          SET status = '${terminalStatus}', completed_batch_count = 1,
              dedupe_finalized_at = now(),
              dedupe_candidates_sha256 = '${CANDIDATE_SHA}',
              dedupe_payload_sha256 = '${"e".repeat(64)}'
          WHERE run_sha256 = '${FIRST_RUN}';
        `);
        const stagePayload = {
          schema_version: 2,
          snapshot: PERIOD,
          snapshot_source: "kca_tprice",
          units: [{
            unit_id: UNIT_ID,
            source_fingerprint: "1".repeat(64),
            conversion_fingerprint: "2".repeat(64),
            extraction_fingerprint: "3".repeat(64),
            validation_fingerprint: "4".repeat(64),
          }],
          skipped_units: [],
          raw_objects: [],
          preview_objects: [],
          agency_packages: [],
          official_prices: [{
            unit_id: UNIT_ID,
            review_status: "pending",
            needs_review: true,
            validation_issue_codes: ["local_deterministic_review_only"],
            category: "studio",
            price_min_krw: 1,
            price_max_krw: 1,
          }],
          disclosure_semantics: [],
          dedupe_candidates: [],
          ai_ledger: [],
          warnings: [],
        };
        const storageObjects = [{ ...storageIntent[0], created: false }];
        await expect(db.query(`
          SELECT * FROM public.stage_vendor_disclosure_batch_atomic(
            '${PROJECT_REF}', '${FIRST_RUN}', '${FIRST_PLAN}',
            '${BATCH_PLAN_SHA}', '${BATCH_SHA}', 1, 1,
            'kca_tprice', '${PERIOD}', 'local_validated_pending_only',
            '${AUTH_SHA}', ARRAY['${UNIT_ID}'], ${jsonbLiteral(storageObjects)},
            ${jsonbLiteral(stagePayload)}
          )
        `)).rejects.toMatchObject({ code: "55000" });
        await expect(db.query(`
          SELECT * FROM public.verify_vendor_disclosure_batch_receipt_atomic(
            '${PROJECT_REF}', '${FIRST_RUN}', '${FIRST_PLAN}',
            '${BATCH_PLAN_SHA}', '${BATCH_SHA}', 1, 1,
            '${RECEIPT_SHA}', ARRAY['${UNIT_ID}']
          )
        `)).rejects.toMatchObject({ code: "23505" });
        await expect(db.query(`
          SELECT * FROM public.finalize_vendor_disclosure_dedupe_atomic(
            '${PROJECT_REF}', '${FIRST_RUN}', '${FIRST_PLAN}', '${CANDIDATE_SHA}',
            ARRAY['${BATCH_SHA}'], '[]'::jsonb
          )
        `)).rejects.toMatchObject({ code: "55000" });
      } finally {
        await db.close();
      }
    },
  );
});

describe("vendor disclosure vendor creation compatibility", () => {
  it("populates required legacy location and region columns from the canonical region code", async () => {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    try {
      await db.exec(`
        CREATE SCHEMA extensions;
        CREATE EXTENSION pgcrypto SCHEMA extensions;

        CREATE TABLE public.vendors (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_id uuid,
          name text NOT NULL,
          slug text,
          category text NOT NULL,
          location text NOT NULL,
          region text NOT NULL,
          region_code text NOT NULL,
          aliases text[] NOT NULL DEFAULT '{}',
          status text NOT NULL,
          attributes jsonb NOT NULL DEFAULT '{}',
          enrichment_status text NOT NULL
        );
        CREATE TABLE public.vendor_timeslots (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
          day integer NOT NULL,
          hour integer NOT NULL
        );
        CREATE TABLE public.vendor_disclosure_ingest_owned_identities (
          run_sha256 text NOT NULL,
          batch_index integer NOT NULL,
          identity_kind text NOT NULL,
          identity_id uuid NOT NULL,
          parent_vendor_id uuid,
          initial_row_sha256 text NOT NULL,
          cleanup_status text NOT NULL DEFAULT 'owned'
        );
        CREATE FUNCTION public.normalize_price_vendor_name(value text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        STRICT
        AS $$
          SELECT lower(regexp_replace(btrim(value), '[^[:alnum:]]+', '', 'g'))
        $$;
        CREATE FUNCTION public.create_test_vendor_timeslots()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          INSERT INTO public.vendor_timeslots (vendor_id, day, hour)
          SELECT NEW.id, ((slot_number - 1) / 12) + 1,
            ((slot_number - 1) % 12) + 9
          FROM generate_series(1, 84) AS slot_number;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER create_test_vendor_timeslots
        AFTER INSERT ON public.vendors
        FOR EACH ROW EXECUTE FUNCTION public.create_test_vendor_timeslots();
      `);
      await db.exec(ensureVendorSql);

      const created = await db.query<{ vendor_id: string }>(`
        SELECT public.ensure_vendor_disclosure_vendor_pending(
          '${FIRST_RUN}', 1, '리전 호환 업체', 'studio', 'seoul_gangnam3'
        ) AS vendor_id
      `);
      const vendorId = created.rows[0]!.vendor_id;
      const persisted = await db.query<{
        location: string;
        region: string;
        region_code: string;
        slot_count: number;
        ownership_count: number;
      }>(`
        SELECT vendor.location, vendor.region, vendor.region_code,
          (SELECT count(*)::integer FROM public.vendor_timeslots AS slot
           WHERE slot.vendor_id = vendor.id) AS slot_count,
          (SELECT count(*)::integer
           FROM public.vendor_disclosure_ingest_owned_identities AS owned
           WHERE owned.run_sha256 = '${FIRST_RUN}'
             AND (owned.identity_id = vendor.id OR owned.parent_vendor_id = vendor.id)
          ) AS ownership_count
        FROM public.vendors AS vendor
        WHERE vendor.id = '${vendorId}'
      `);
      expect(persisted.rows[0]).toEqual({
        location: "seoul_gangnam3",
        region: "seoul_gangnam3",
        region_code: "seoul_gangnam3",
        slot_count: 84,
        ownership_count: 85,
      });
    } finally {
      await db.close();
    }
  });
});
