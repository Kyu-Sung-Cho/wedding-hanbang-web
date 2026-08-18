// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260818170000_amora_vendor_review_trigger_search_path.sql",
);

const VENDOR_ID = "10000000-0000-4000-8000-000000000001";
const REVIEW_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_REVIEW_ID = "20000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      rating numeric(2,1) NOT NULL DEFAULT 0,
      review_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.vendor_reviews (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      rating integer NOT NULL,
      is_visible boolean NOT NULL DEFAULT true
    );
    CREATE OR REPLACE FUNCTION public.update_vendor_rating()
    RETURNS trigger AS $$
    BEGIN
      UPDATE vendors SET
        rating = (SELECT COALESCE(AVG(rating)::NUMERIC(2,1), 0) FROM vendor_reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id) AND is_visible = true),
        review_count = (SELECT COUNT(*)::INTEGER FROM vendor_reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id) AND is_visible = true)
      WHERE id = COALESCE(NEW.vendor_id, OLD.vendor_id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER update_vendor_rating_on_review
      AFTER INSERT OR UPDATE OR DELETE ON public.vendor_reviews
      FOR EACH ROW EXECUTE FUNCTION public.update_vendor_rating();
    INSERT INTO public.vendors(id) VALUES ('${VENDOR_ID}');
  `);
  return db;
}

async function insertReview(db: PGlite, id = REVIEW_ID) {
  return db.query(`
    INSERT INTO public.vendor_reviews(id, vendor_id, rating, is_visible)
    VALUES ($1::uuid, $2::uuid, 5, true)
  `, [id, VENDOR_ID]);
}

describe("Amora vendor-review trigger search-path successor", () => {
  it("repairs rating projection when the booking writer runs with an empty search path", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET search_path = ''");
      await expect(insertReview(db)).rejects.toThrow(/relation "vendors" does not exist/);

      expect(existsSync(migrationPath)).toBe(true);
      await db.exec(readFileSync(migrationPath, "utf8"));
      await insertReview(db);

      const vendor = await db.query<{ rating: string; review_count: number }>(`
        SELECT rating::text, review_count
        FROM public.vendors
        WHERE id = $1::uuid
      `, [VENDOR_ID]);
      expect(vendor.rows).toEqual([{ rating: "5.0", review_count: 1 }]);
    } finally {
      await db.close();
    }
  });

  it("preserves visible-review rating projection across insert, update, and delete", async () => {
    const db = await createDatabase();
    try {
      await db.exec(readFileSync(migrationPath, "utf8"));
      await db.exec("SET search_path = ''");
      await insertReview(db);
      await db.query(`
        INSERT INTO public.vendor_reviews(id, vendor_id, rating, is_visible)
        VALUES ($1::uuid, $2::uuid, 1, false)
      `, [SECOND_REVIEW_ID, VENDOR_ID]);
      let vendor = await db.query<{ rating: string; review_count: number }>(`
        SELECT rating::text, review_count FROM public.vendors WHERE id = $1::uuid
      `, [VENDOR_ID]);
      expect(vendor.rows).toEqual([{ rating: "5.0", review_count: 1 }]);

      await db.query(`
        UPDATE public.vendor_reviews SET is_visible = true
        WHERE id = $1::uuid
      `, [SECOND_REVIEW_ID]);
      vendor = await db.query<{ rating: string; review_count: number }>(`
        SELECT rating::text, review_count FROM public.vendors WHERE id = $1::uuid
      `, [VENDOR_ID]);
      expect(vendor.rows).toEqual([{ rating: "3.0", review_count: 2 }]);

      await db.query("DELETE FROM public.vendor_reviews WHERE id = $1::uuid", [REVIEW_ID]);
      vendor = await db.query<{ rating: string; review_count: number }>(`
        SELECT rating::text, review_count FROM public.vendors WHERE id = $1::uuid
      `, [VENDOR_ID]);
      expect(vendor.rows).toEqual([{ rating: "1.0", review_count: 1 }]);

      await db.query("DELETE FROM public.vendor_reviews WHERE id = $1::uuid", [SECOND_REVIEW_ID]);
      vendor = await db.query<{ rating: string; review_count: number }>(`
        SELECT rating::text, review_count FROM public.vendors WHERE id = $1::uuid
      `, [VENDOR_ID]);
      expect(vendor.rows).toEqual([{ rating: "0.0", review_count: 0 }]);
    } finally {
      await db.close();
    }
  });

  it("pins the trigger function owner, search path, ACL, and enabled binding", async () => {
    const db = await createDatabase();
    try {
      await db.exec(readFileSync(migrationPath, "utf8"));
      const contract = await db.query<{
        owner: string;
        security_definer: boolean;
        config: string[] | null;
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
        trigger_count: number;
        definition: string;
      }>(`
        SELECT
          procedure.proowner::regrole::text AS owner,
          procedure.prosecdef AS security_definer,
          procedure.proconfig AS config,
          has_function_privilege('anon', procedure.oid, 'EXECUTE') AS anon_execute,
          has_function_privilege('authenticated', procedure.oid, 'EXECUTE') AS authenticated_execute,
          has_function_privilege('service_role', procedure.oid, 'EXECUTE') AS service_execute,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger
            WHERE trigger.tgrelid = 'public.vendor_reviews'::regclass
              AND trigger.tgname = 'update_vendor_rating_on_review'
              AND trigger.tgfoid = procedure.oid
              AND trigger.tgenabled = 'O'
              AND NOT trigger.tgisinternal
          ) AS trigger_count,
          pg_catalog.pg_get_functiondef(procedure.oid) AS definition
        FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = 'public.update_vendor_rating()'::regprocedure
      `);
      expect(contract.rows[0]).toMatchObject({
        owner: "postgres",
        security_definer: false,
        config: ["search_path=pg_catalog, public"],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
        trigger_count: 1,
      });
      expect(contract.rows[0]?.definition).toContain("UPDATE public.vendors AS vendor");
      expect(contract.rows[0]?.definition).toContain("FROM public.vendor_reviews AS review");
    } finally {
      await db.close();
    }
  });

  it("fails closed when the audited predecessor function has drifted", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.update_vendor_rating()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM 1;
          RETURN NEW;
        END
        $$
      `);
      await expect(db.exec(readFileSync(migrationPath, "utf8")))
        .rejects.toThrow(/AMORA_VENDOR_REVIEW_TRIGGER_PREREQUISITE_DRIFT/);
      await db.exec("ROLLBACK");
      const definition = await db.query<{ definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.update_vendor_rating()'::regprocedure
        ) AS definition
      `);
      expect(definition.rows[0]?.definition).toContain("PERFORM 1");
      expect(definition.rows[0]?.definition).not.toContain("public.vendor_reviews AS review");
    } finally {
      await db.close();
    }
  });
});
