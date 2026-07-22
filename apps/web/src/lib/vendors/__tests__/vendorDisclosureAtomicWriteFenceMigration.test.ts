// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721120000_vendor_disclosure_atomic_batch_staging.sql",
  ),
  "utf8",
);
const fenceStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.guard_vendor_disclosure_atomic_pending_insert",
);
const fenceEnd = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.vendor_disclosure_payload_provenance_is_safe",
  fenceStart,
);
const fenceSql = migration.slice(fenceStart, fenceEnd);

const KCA_SNAPSHOT_ID = "10000000-0000-4000-8000-000000000001";
const NON_KCA_SNAPSHOT_ID = "10000000-0000-4000-8000-000000000002";
const RUN_A = "a".repeat(64);
const RUN_B = "b".repeat(64);

function ids(prefix: string) {
  return {
    price: `${prefix}0000000-0000-4000-8000-000000000001`,
    option: `${prefix}0000000-0000-4000-8000-000000000002`,
    package: `${prefix}0000000-0000-4000-8000-000000000003`,
    semantic: `${prefix}0000000-0000-4000-8000-000000000004`,
  };
}

const A = ids("2");
const B = ids("3");
const LEGACY_PRICE_ID = "40000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      source text NOT NULL,
      period_label text NOT NULL
    );
    CREATE TABLE public.vendor_disclosure_ingest_runs (
      run_sha256 text PRIMARY KEY,
      snapshot_id uuid NOT NULL,
      snapshot_source text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_rows (
      run_sha256 text NOT NULL,
      row_kind text NOT NULL,
      row_id uuid NOT NULL
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      item_name text NOT NULL,
      vendor_id uuid,
      agency_id uuid,
      review_status text NOT NULL DEFAULT 'pending',
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY,
      official_price_id uuid NOT NULL
        REFERENCES public.official_prices(id) ON DELETE CASCADE,
      name text NOT NULL
    );
    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      package_name text NOT NULL,
      agency_id uuid,
      review_status text NOT NULL DEFAULT 'pending',
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.disclosure_semantic_staging (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id),
      content_verbatim text NOT NULL,
      partner_vendor_id uuid,
      review_status text NOT NULL DEFAULT 'pending'
    );

    INSERT INTO public.price_snapshots VALUES
      ('${KCA_SNAPSHOT_ID}', 'kca_tprice', '2026Q3'),
      ('${NON_KCA_SNAPSHOT_ID}', 'agency_site', '2026Q3');
    INSERT INTO public.official_prices (
      id, snapshot_id, item_name
    ) VALUES (
      '${LEGACY_PRICE_ID}', '${NON_KCA_SNAPSHOT_ID}', 'legacy non-KCA'
    );

    CREATE FUNCTION public.stage_vendor_disclosure_batch_atomic(
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
    ) RETURNS TABLE (
      batch_receipt_sha256 text,
      loaded_unit_ids text[],
      logged_ledger_ids text[],
      already_applied boolean
    )
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $function$
    DECLARE
      snapshot_value uuid;
      price_value uuid := (p_payload ->> 'price_id')::uuid;
      option_value uuid := (p_payload ->> 'option_id')::uuid;
      package_value uuid := (p_payload ->> 'package_id')::uuid;
      semantic_value uuid := (p_payload ->> 'semantic_id')::uuid;
    BEGIN
      SELECT run.snapshot_id INTO snapshot_value
      FROM public.vendor_disclosure_ingest_runs AS run
      WHERE run.run_sha256 = p_run_sha256 AND run.status = 'active';
      PERFORM set_config(
        'app.vendor_disclosure_atomic_run_sha256', p_run_sha256, true
      );
      INSERT INTO public.official_agency_packages (
        id, snapshot_id, package_name
      ) VALUES (package_value, snapshot_value, 'atomic package');
      INSERT INTO public.vendor_disclosure_ingest_owned_rows
      VALUES (p_run_sha256, 'agency_package', package_value);
      INSERT INTO public.official_prices (id, snapshot_id, item_name)
      VALUES (price_value, snapshot_value, 'atomic price');
      INSERT INTO public.vendor_disclosure_ingest_owned_rows
      VALUES (p_run_sha256, 'official_price', price_value);
      INSERT INTO public.official_price_options
      VALUES (option_value, price_value, 'atomic option');
      INSERT INTO public.disclosure_semantic_staging (
        id, snapshot_id, content_verbatim
      ) VALUES (semantic_value, snapshot_value, 'atomic semantic');
      INSERT INTO public.vendor_disclosure_ingest_owned_rows
      VALUES (p_run_sha256, 'semantic', semantic_value);
      batch_receipt_sha256 := repeat('1', 64);
      loaded_unit_ids := ARRAY[repeat('2', 64)];
      logged_ledger_ids := '{}'::text[];
      already_applied := false;
      RETURN NEXT;
    END
    $function$;

    CREATE FUNCTION public.review_official_price(
      p_price_id uuid,
      p_actor_id uuid,
      p_action text,
      p_values jsonb,
      p_options jsonb,
      p_expected_review_version bigint
    ) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $function$
    BEGIN
      PERFORM set_config(
        'hanbang.review_official_price_parent_id', p_price_id::text, true
      );
      UPDATE public.official_prices
      SET item_name = p_values ->> 'item_name',
          review_status = p_action || 'd',
          review_version = p_expected_review_version + 1
      WHERE id = p_price_id;
      UPDATE public.official_price_options
      SET name = p_options -> 0 ->> 'name'
      WHERE official_price_id = p_price_id;
      PERFORM set_config('hanbang.review_official_price_parent_id', '', true);
    END
    $function$;

    CREATE FUNCTION public.review_official_agency_package(
      p_package_id uuid,
      p_actor_id uuid,
      p_action text,
      p_values jsonb,
      p_options jsonb,
      p_expected_review_version bigint
    ) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $function$
    BEGIN
      PERFORM set_config(
        'hanbang.review_official_agency_package_parent_id',
        p_package_id::text,
        true
      );
      UPDATE public.official_agency_packages
      SET package_name = p_values ->> 'package_name',
          review_status = p_action || 'd',
          review_version = p_expected_review_version + 1
      WHERE id = p_package_id;
      PERFORM set_config(
        'hanbang.review_official_agency_package_parent_id', '', true
      );
    END
    $function$;

    CREATE FUNCTION public.abort_vendor_disclosure_ingest_run_atomic(
      p_target_project_ref text,
      p_run_sha256 text,
      p_full_plan_sha256 text,
      p_reason text
    ) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $function$
    BEGIN
      PERFORM set_config(
        'app.vendor_disclosure_atomic_abort_run_sha256', p_run_sha256, true
      );
      DELETE FROM public.disclosure_semantic_staging AS semantic
      WHERE semantic.id IN (
        SELECT owned.row_id
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'semantic'
      );
      DELETE FROM public.official_agency_packages AS package
      WHERE package.id IN (
        SELECT owned.row_id
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        WHERE owned.run_sha256 = p_run_sha256
          AND owned.row_kind = 'agency_package'
      );
      DELETE FROM public.official_prices AS price
      WHERE price.id IN (
        SELECT owned.row_id
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        WHERE owned.run_sha256 = p_run_sha256
          AND owned.row_kind = 'official_price'
      );
      PERFORM set_config(
        'app.vendor_disclosure_atomic_abort_run_sha256', '', true
      );
    END
    $function$;
  `);

  await db.exec(fenceSql);
  await db.exec(`
    CREATE TRIGGER official_prices_parent_review_write_fence
    BEFORE INSERT OR UPDATE OR DELETE ON public.official_prices
    FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_parent_write();
    CREATE TRIGGER official_agency_packages_parent_review_write_fence
    BEFORE INSERT OR UPDATE OR DELETE ON public.official_agency_packages
    FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_parent_write();

    -- Exercise the trigger boundary even if a future migration accidentally
    -- re-grants base-table writes; the production migration itself revokes them.
    GRANT ALL ON TABLE public.price_snapshots,
      public.vendor_disclosure_ingest_runs,
      public.vendor_disclosure_ingest_owned_rows,
      public.official_prices,
      public.official_price_options,
      public.official_agency_packages,
      public.disclosure_semantic_staging
    TO service_role;
    GRANT EXECUTE ON FUNCTION public.stage_vendor_disclosure_batch_atomic(
      text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.review_official_price(
      uuid,uuid,text,jsonb,jsonb,bigint
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.review_official_agency_package(
      uuid,uuid,text,jsonb,jsonb,bigint
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.abort_vendor_disclosure_ingest_run_atomic(
      text,text,text,text
    ) TO service_role;
  `);
  return db;
}

async function insertRun(db: PGlite, runSha256: string) {
  await db.exec(`
    INSERT INTO public.vendor_disclosure_ingest_runs
    VALUES ('${runSha256}', '${KCA_SNAPSHOT_ID}', 'kca_tprice', 'active')
  `);
}

async function stage(db: PGlite, runSha256: string, values: ReturnType<typeof ids>) {
  const payload = JSON.stringify({
    price_id: values.price,
    option_id: values.option,
    package_id: values.package,
    semantic_id: values.semantic,
  }).replaceAll("'", "''");
  await db.exec(`
    SELECT * FROM public.stage_vendor_disclosure_batch_atomic(
      'staging-ref', '${runSha256}', repeat('1', 64), repeat('2', 64),
      repeat('3', 64), 1, 1, 'kca_tprice', '2026Q3',
      'local_validated_pending_only', repeat('4', 64),
      ARRAY[repeat('5', 64)], '[]'::jsonb, '${payload}'::jsonb
    )
  `);
}

describe("vendor disclosure atomic write fence", () => {
  it("rejects caller-spoofed markers, snapshot relabeling, and non-KCA to KCA reassignment", async () => {
    const db = await createDatabase();
    try {
      await insertRun(db, RUN_A);
      await db.exec("SET ROLE service_role");
      await db.exec(`
        SELECT set_config(
          'app.vendor_disclosure_atomic_run_sha256', '${RUN_A}', false
        )
      `);
      await expect(db.exec(`
        INSERT INTO public.official_prices (id, snapshot_id, item_name)
        VALUES (
          '50000000-0000-4000-8000-000000000001',
          '${KCA_SNAPSHOT_ID}',
          'forged marker insert'
        )
      `)).rejects.toThrow(/DISCLOSURE_ATOMIC_OWNERSHIP_CONTEXT_REQUIRED/u);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET snapshot_id = '${KCA_SNAPSHOT_ID}'
        WHERE id = '${LEGACY_PRICE_ID}'
      `)).rejects.toThrow(/DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET source = 'kca_tprice'
        WHERE id = '${NON_KCA_SNAPSHOT_ID}'
      `)).rejects.toThrow(/DISCLOSURE_ATOMIC_SNAPSHOT_IDENTITY_IMMUTABLE/u);
    } finally {
      await db.close();
    }
  });

  it("preserves atomic staging and exact admin review while blocking owned-row and option DML", async () => {
    const db = await createDatabase();
    try {
      await insertRun(db, RUN_A);
      await db.exec("SET ROLE service_role");
      await stage(db, RUN_A, A);

      for (const statement of [
        `UPDATE public.official_prices SET item_name = 'forged' WHERE id = '${A.price}'`,
        `UPDATE public.official_agency_packages SET package_name = 'forged' WHERE id = '${A.package}'`,
        `UPDATE public.disclosure_semantic_staging SET content_verbatim = 'forged' WHERE id = '${A.semantic}'`,
        `UPDATE public.official_price_options SET name = 'forged' WHERE id = '${A.option}'`,
        `DELETE FROM public.official_price_options WHERE id = '${A.option}'`,
        `INSERT INTO public.official_price_options VALUES (
          '60000000-0000-4000-8000-000000000001', '${A.price}', 'forged'
        )`,
      ]) {
        await expect(db.exec(statement)).rejects.toThrow(
          /DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED/u,
        );
      }

      await db.exec(`
        SELECT public.review_official_price(
          '${A.price}', NULL, 'approve', '{"item_name":"reviewed price"}'::jsonb,
          '[{"name":"reviewed option"}]'::jsonb, 0
        );
        SELECT public.review_official_agency_package(
          '${A.package}', NULL, 'approve',
          '{"package_name":"reviewed package"}'::jsonb, '[]'::jsonb, 0
        )
      `);
      const reviewed = await db.query<{
        item_name: string;
        option_name: string;
        package_name: string;
      }>(`
        SELECT price.item_name, option_row.name AS option_name,
          package.package_name
        FROM public.official_prices AS price
        JOIN public.official_price_options AS option_row
          ON option_row.official_price_id = price.id
        CROSS JOIN public.official_agency_packages AS package
        WHERE price.id = '${A.price}' AND package.id = '${A.package}'
      `);
      expect(reviewed.rows[0]).toEqual({
        item_name: "reviewed price",
        option_name: "reviewed option",
        package_name: "reviewed package",
      });

      await db.exec("RESET ROLE");
      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_runs
        SET status = 'complete' WHERE run_sha256 = '${RUN_A}'
      `);
      await db.exec("SET ROLE service_role");
      await expect(db.exec(`
        UPDATE public.official_prices
        SET item_name = 'completed-run forgery' WHERE id = '${A.price}'
      `)).rejects.toThrow(/DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED/u);
      await db.exec("RESET ROLE");
      await db.exec(`
        UPDATE public.vendor_disclosure_ingest_runs
        SET status = 'invalidated' WHERE run_sha256 = '${RUN_A}'
      `);
      await db.exec("SET ROLE service_role");
      await expect(db.exec(`
        DELETE FROM public.official_prices WHERE id = '${A.price}'
      `)).rejects.toThrow(/DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED/u);
    } finally {
      await db.close();
    }
  });

  it("lets only the postgres-owned abort RPC remove an untouched active run", async () => {
    const db = await createDatabase();
    try {
      await insertRun(db, RUN_B);
      await db.exec("SET ROLE service_role");
      await stage(db, RUN_B, B);
      await db.exec(`
        SELECT set_config(
          'app.vendor_disclosure_atomic_abort_run_sha256', '${RUN_B}', false
        )
      `);
      await expect(db.exec(`
        DELETE FROM public.official_prices WHERE id = '${B.price}'
      `)).rejects.toThrow(/DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED/u);

      await db.exec(`
        SELECT public.abort_vendor_disclosure_ingest_run_atomic(
          'staging-ref', '${RUN_B}', repeat('1', 64), 'test rollback'
        )
      `);
      const remaining = await db.query<{ count: number }>(`
        SELECT (
          (SELECT count(*) FROM public.official_prices WHERE id = '${B.price}')
          + (SELECT count(*) FROM public.official_price_options WHERE id = '${B.option}')
          + (SELECT count(*) FROM public.official_agency_packages WHERE id = '${B.package}')
          + (SELECT count(*) FROM public.disclosure_semantic_staging WHERE id = '${B.semantic}')
        )::integer AS count
      `);
      expect(remaining.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  });
});
