// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718150000_price_snapshot_promotion.sql"
  ),
  "utf8"
);

const ADMIN_ID = "a0000000-0000-4000-8000-000000000001";
const NON_ADMIN_ID = "a0000000-0000-4000-8000-000000000002";
const OLD_CURRENT_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_ID = "10000000-0000-4000-8000-000000000002";
const SIBLING_ID = "10000000-0000-4000-8000-000000000003";
const OTHER_SOURCE_ID = "20000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY,
      period_label text NOT NULL,
      source text NOT NULL,
      source_url text,
      published_at date,
      is_current boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_price_snapshots_one_current_per_source
      ON public.price_snapshots (source)
      WHERE is_current = true;

    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL
        REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric
    );

    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL
        REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric
    );

    REVOKE ALL ON TABLE
      public.profiles,
      public.price_snapshots,
      public.official_prices,
      public.official_agency_packages
    FROM PUBLIC, anon, authenticated, service_role;

    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.profiles,
      public.price_snapshots,
      public.official_prices,
      public.official_agency_packages
    TO service_role;

    INSERT INTO public.profiles (id, is_admin) VALUES
      ('${ADMIN_ID}', true),
      ('${NON_ADMIN_ID}', false);
  `);
  await db.exec(migration);
  return db;
}

async function seedSnapshots(db: PGlite) {
  await db.exec(`
    INSERT INTO public.price_snapshots (
      id, period_label, source, is_current
    ) VALUES
      ('${OLD_CURRENT_ID}', '2026-Q1', 'kca_tprice', true),
      ('${TARGET_ID}', '2026-Q2', 'kca_tprice', false),
      ('${SIBLING_ID}', '2026-Q3', 'kca_tprice', false),
      ('${OTHER_SOURCE_ID}', '2026-Q2', 'other_source', true);
  `);
}

function approvedValues(snapshotId = TARGET_ID) {
  return `
    '${snapshotId}', 'approved', false,
    'official.xlsx', '공식 가격 원문',
    ARRAY['vendor-disclosures/official.xlsx']::text[], 0.95
  `;
}

async function callPromotion(db: PGlite, actorId = ADMIN_ID) {
  await db.query(`
    SELECT public.promote_price_snapshot('${TARGET_ID}', '${actorId}')
  `);
}

async function snapshotState(db: PGlite) {
  return db.query<{ id: string; source: string; is_current: boolean }>(`
    SELECT id, source, is_current
    FROM public.price_snapshots
    ORDER BY source, id
  `);
}

describe("price snapshot promotion migration", () => {
  it("atomically promotes one source, preserves another source, and replays idempotently", async () => {
    const db = await createDatabase();
    try {
      await seedSnapshots(db);
      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, review_status, needs_review, source_file,
          source_quote, source_object_keys, confidence
        ) VALUES
          ('30000000-0000-4000-8000-000000000001', ${approvedValues()}),
          -- Rejected evidence may stay incomplete: rejected rows are never public.
          ('30000000-0000-4000-8000-000000000002', '${TARGET_ID}',
           'rejected', true, NULL, NULL, '{}'::text[], NULL);

        INSERT INTO public.official_agency_packages (
          id, snapshot_id, review_status, needs_review, source_file,
          source_quote, source_object_keys, confidence
        ) VALUES
          ('40000000-0000-4000-8000-000000000001', ${approvedValues()}),
          ('40000000-0000-4000-8000-000000000002', '${TARGET_ID}',
           'rejected', true, NULL, NULL, '{}'::text[], NULL);
      `);

      await db.exec("SET ROLE service_role;");
      await callPromotion(db);
      await callPromotion(db);
      await db.exec("RESET ROLE;");

      const state = await snapshotState(db);
      expect(state.rows).toEqual([
        { id: OLD_CURRENT_ID, source: "kca_tprice", is_current: false },
        { id: TARGET_ID, source: "kca_tprice", is_current: true },
        { id: SIBLING_ID, source: "kca_tprice", is_current: false },
        { id: OTHER_SOURCE_ID, source: "other_source", is_current: true },
      ]);
      const currentCounts = await db.query<{ source: string; count: number }>(`
        SELECT source, count(*)::int AS count
        FROM public.price_snapshots
        WHERE is_current
        GROUP BY source
        ORDER BY source
      `);
      expect(currentCounts.rows).toEqual([
        { source: "kca_tprice", count: 1 },
        { source: "other_source", count: 1 },
      ]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed and rolls back for every unpublishable review state", async () => {
    const db = await createDatabase();
    try {
      await seedSnapshots(db);
      const invalidRows = [
        ["official_prices", "'pending', true, NULL, NULL, '{}'::text[], NULL"],
        [
          "official_prices",
          "'approved', true, 'official.xlsx', 'quote', ARRAY['object'], 0.9",
        ],
        [
          "official_prices",
          "'approved', false, '', 'quote', ARRAY['object'], 0.9",
        ],
        [
          "official_prices",
          "'approved', false, 'official.xlsx', '', ARRAY['object'], 0.9",
        ],
        [
          "official_prices",
          "'approved', false, 'official.xlsx', 'quote', '{}'::text[], 0.9",
        ],
        [
          "official_prices",
          "'approved', false, 'official.xlsx', 'quote', ARRAY['object'], NULL",
        ],
        [
          "official_agency_packages",
          "'pending', true, NULL, NULL, '{}'::text[], NULL",
        ],
        [
          "official_agency_packages",
          "'approved', true, 'official.xlsx', 'quote', ARRAY['object'], 0.9",
        ],
        [
          "official_agency_packages",
          "'approved', false, '', 'quote', ARRAY['object'], 0.9",
        ],
        [
          "official_agency_packages",
          "'approved', false, 'official.xlsx', '', ARRAY['object'], 0.9",
        ],
        [
          "official_agency_packages",
          "'approved', false, 'official.xlsx', 'quote', '{}'::text[], 0.9",
        ],
        [
          "official_agency_packages",
          "'approved', false, 'official.xlsx', 'quote', ARRAY['object'], NULL",
        ],
      ] as const;

      for (const [table, values] of invalidRows) {
        await db.exec(`
          DELETE FROM public.official_prices;
          DELETE FROM public.official_agency_packages;
          INSERT INTO public.${table} (
            id, snapshot_id, review_status, needs_review, source_file,
            source_quote, source_object_keys, confidence
          ) VALUES (
            gen_random_uuid(), '${TARGET_ID}', ${values}
          );
        `);
        await db.exec("SET ROLE service_role;");
        await expect(callPromotion(db)).rejects.toThrow(/NOT_READY/u);
        await db.exec("RESET ROLE;");

        const state = await snapshotState(db);
        expect(state.rows.find(({ id }) => id === OLD_CURRENT_ID)?.is_current).toBe(
          true
        );
        expect(state.rows.find(({ id }) => id === TARGET_ID)?.is_current).toBe(
          false
        );
      }
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 20_000);

  it("rejects empty and rejected-only targets but permits rejected rows beside one valid row", async () => {
    const db = await createDatabase();
    try {
      await seedSnapshots(db);
      await db.exec("SET ROLE service_role;");
      await expect(callPromotion(db)).rejects.toThrow(
        /PRICE_SNAPSHOT_NO_PUBLISHABLE_ROWS/u
      );
      await db.exec("RESET ROLE;");

      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, review_status, needs_review, source_file,
          source_quote, source_object_keys, confidence
        ) VALUES (
          '50000000-0000-4000-8000-000000000001', '${TARGET_ID}',
          'rejected', true, NULL, NULL, '{}'::text[], NULL
        );
      `);
      await db.exec("SET ROLE service_role;");
      await expect(callPromotion(db)).rejects.toThrow(
        /PRICE_SNAPSHOT_NO_PUBLISHABLE_ROWS/u
      );
      await db.exec("RESET ROLE;");

      await db.exec(`
        INSERT INTO public.official_agency_packages (
          id, snapshot_id, review_status, needs_review, source_file,
          source_quote, source_object_keys, confidence
        ) VALUES (
          '50000000-0000-4000-8000-000000000002', ${approvedValues()}
        );
      `);
      await db.exec("SET ROLE service_role;");
      await callPromotion(db);
      await db.exec("RESET ROLE;");

      const state = await snapshotState(db);
      expect(state.rows.find(({ id }) => id === TARGET_ID)?.is_current).toBe(true);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("allows only service_role plus an admin actor to call the hardened RPC", async () => {
    const db = await createDatabase();
    try {
      await seedSnapshots(db);
      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, review_status, needs_review, source_file,
          source_quote, source_object_keys, confidence
        ) VALUES (
          '60000000-0000-4000-8000-000000000001', ${approvedValues()}
        );
      `);

      const acl = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
        security_definer: boolean;
        safe_search_path: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'anon', 'public.promote_price_snapshot(uuid,uuid)', 'EXECUTE'
          ) AS anon_execute,
          has_function_privilege(
            'authenticated', 'public.promote_price_snapshot(uuid,uuid)', 'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'service_role', 'public.promote_price_snapshot(uuid,uuid)', 'EXECUTE'
          ) AS service_execute,
          proc.prosecdef AS security_definer,
          proc.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
            AS safe_search_path
        FROM pg_catalog.pg_proc AS proc
        WHERE proc.oid =
          'public.promote_price_snapshot(uuid,uuid)'::regprocedure
      `);
      expect(acl.rows).toEqual([
        {
          anon_execute: false,
          authenticated_execute: false,
          service_execute: true,
          security_definer: true,
          safe_search_path: true,
        },
      ]);

      await db.exec("SET ROLE anon;");
      await expect(callPromotion(db)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE; SET ROLE authenticated;");
      await expect(callPromotion(db)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE; SET ROLE service_role;");
      await expect(callPromotion(db, NON_ADMIN_ID)).rejects.toThrow(
        /PRICE_SNAPSHOT_ADMIN_REQUIRED/u
      );
      await db.exec("RESET ROLE;");

      const state = await snapshotState(db);
      expect(state.rows.find(({ id }) => id === OLD_CURRENT_ID)?.is_current).toBe(
        true
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls the previous current flag back if target promotion fails mid-transaction", async () => {
    const db = await createDatabase();
    try {
      await seedSnapshots(db);
      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, review_status, needs_review, source_file,
          source_quote, source_object_keys, confidence
        ) VALUES (
          '65000000-0000-4000-8000-000000000001', ${approvedValues()}
        );

        CREATE FUNCTION public.force_target_promotion_failure()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $force_target_promotion_failure$
        BEGIN
          IF NEW.id = '${TARGET_ID}' AND NEW.is_current = true THEN
            RAISE EXCEPTION 'FORCED_TARGET_PROMOTION_FAILURE';
          END IF;
          RETURN NEW;
        END
        $force_target_promotion_failure$;

        CREATE TRIGGER zz_force_target_promotion_failure
        BEFORE UPDATE OF is_current ON public.price_snapshots
        FOR EACH ROW
        EXECUTE FUNCTION public.force_target_promotion_failure();
      `);

      await db.exec("SET ROLE service_role;");
      await expect(callPromotion(db)).rejects.toThrow(
        /FORCED_TARGET_PROMOTION_FAILURE/u
      );
      await db.exec("RESET ROLE;");

      const state = await snapshotState(db);
      expect(state.rows.find(({ id }) => id === OLD_CURRENT_ID)?.is_current).toBe(
        true
      );
      expect(state.rows.find(({ id }) => id === TARGET_ID)?.is_current).toBe(
        false
      );
      expect(
        state.rows.find(({ id }) => id === OTHER_SOURCE_ID)?.is_current
      ).toBe(true);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("serializes child writes through ordered parent locks and keeps current rows review-safe", async () => {
    const db = await createDatabase();
    try {
      await seedSnapshots(db);
      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, review_status, needs_review, source_file,
          source_quote, source_object_keys, confidence
        ) VALUES (
          '70000000-0000-4000-8000-000000000001', ${approvedValues()}
        );
      `);
      await db.exec("SET ROLE service_role;");
      await callPromotion(db);

      await expect(db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, review_status
        ) VALUES (
          '70000000-0000-4000-8000-000000000002', '${TARGET_ID}', 'pending'
        )
      `)).rejects.toThrow(/PRICE_SNAPSHOT_CURRENT_ROW_NOT_READY/u);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET needs_review = true
        WHERE id = '70000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_CURRENT_ROW_NOT_READY/u);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET review_status = 'rejected',
            needs_review = true,
            source_file = NULL,
            source_quote = NULL,
            source_object_keys = '{}'::text[],
            confidence = NULL
        WHERE id = '70000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_CURRENT_NO_PUBLISHABLE_ROWS/u);
      await expect(db.exec(`
        DELETE FROM public.official_prices
        WHERE id = '70000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_CURRENT_NO_PUBLISHABLE_ROWS/u);

      await db.exec(`
        INSERT INTO public.official_prices (
          id, snapshot_id, review_status
        ) VALUES (
          '70000000-0000-4000-8000-000000000003', '${SIBLING_ID}', 'pending'
        )
      `);
      await db.exec("RESET ROLE;");

      const definitions = await db.query<{
        promotion: string;
        child_fence: string;
      }>(`
        SELECT
          pg_get_functiondef(
            'public.promote_price_snapshot(uuid,uuid)'::regprocedure
          ) AS promotion,
          pg_get_functiondef(
            'public.guard_price_snapshot_review_write()'::regprocedure
          ) AS child_fence
      `);
      const promotion = definitions.rows[0]?.promotion ?? "";
      const childFence = definitions.rows[0]?.child_fence ?? "";
      expect(promotion).toMatch(
        /ORDER BY snapshot_row\.id\s+FOR UPDATE/iu
      );
      expect(childFence).toMatch(
        /ORDER BY snapshot\.id\s+FOR UPDATE/iu
      );
      expect(promotion.indexOf("SET is_current = false")).toBeLessThan(
        promotion.indexOf("SET is_current = true")
      );
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("is migration-replay safe and blocks direct service-role current changes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await seedSnapshots(db);
      await db.exec("SET ROLE service_role;");
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET is_current = true
        WHERE id = '${TARGET_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED/u);
      await expect(db.exec(`
        UPDATE public.price_snapshots
        SET source = 'bypass_source'
        WHERE id = '${OLD_CURRENT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED/u);
      await expect(db.exec(`
        DELETE FROM public.price_snapshots
        WHERE id = '${OLD_CURRENT_ID}'
      `)).rejects.toThrow(/PRICE_SNAPSHOT_PROMOTION_RPC_REQUIRED/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });
});
