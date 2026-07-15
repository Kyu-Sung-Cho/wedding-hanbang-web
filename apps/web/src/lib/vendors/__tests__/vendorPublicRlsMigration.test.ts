// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260715210000_harden_vendor_public_read_policies.sql"
  ),
  "utf8"
);

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      owner_id uuid,
      email text
    );
    CREATE TABLE public.vendor_products (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.vendor_images (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id)
    );

    ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_images ENABLE ROW LEVEL SECURITY;

    GRANT SELECT ON public.vendors, public.vendor_products, public.vendor_images
      TO anon, authenticated, service_role;

    CREATE POLICY vendors_read ON public.vendors
      FOR SELECT TO PUBLIC USING (true);
    CREATE POLICY products_read ON public.vendor_products
      FOR SELECT TO PUBLIC USING (true);
    CREATE POLICY images_read ON public.vendor_images
      FOR SELECT TO PUBLIC USING (true);

    CREATE POLICY vendors_select_approved ON public.vendors
      FOR SELECT TO PUBLIC
      USING (status = 'approved' OR owner_id = auth.uid());
    CREATE POLICY vendor_products_select ON public.vendor_products
      FOR SELECT TO PUBLIC
      USING (
        EXISTS (
          SELECT 1
          FROM public.vendors
          WHERE vendors.id = vendor_products.vendor_id
            AND (vendors.status = 'approved' OR vendors.owner_id = auth.uid())
        )
      );
    CREATE POLICY "공개: 승인 업체 이미지 조회" ON public.vendor_images
      FOR SELECT TO PUBLIC
      USING (
        EXISTS (
          SELECT 1
          FROM public.vendors
          WHERE vendors.id = vendor_images.vendor_id
            AND vendors.status = 'approved'
        )
      );

    INSERT INTO public.vendors (id, status, owner_id, email) VALUES
      ('10000000-0000-4000-8000-000000000001', 'approved', NULL, 'approved@example.invalid'),
      ('10000000-0000-4000-8000-000000000002', 'pending', '${OWNER_ID}', 'pending@example.invalid'),
      ('10000000-0000-4000-8000-000000000003', 'rejected', NULL, 'rejected@example.invalid');
    INSERT INTO public.vendor_products (id, vendor_id) VALUES
      ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
      ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
      ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003');
    INSERT INTO public.vendor_images (id, vendor_id) VALUES
      ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
      ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003');
  `);
  return db;
}

async function applyMigration(db: PGlite) {
  await db.exec(migration);
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId = ""
) {
  await db.exec(`SET ROLE ${role};`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
    userId,
  ]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

async function visibleCounts(db: PGlite) {
  const result = await db.query<{
    vendors: number;
    products: number;
    images: number;
  }>(`
    SELECT
      (SELECT count(*)::INT FROM public.vendors) AS vendors,
      (SELECT count(*)::INT FROM public.vendor_products) AS products,
      (SELECT count(*)::INT FROM public.vendor_images) AS images
  `);
  return result.rows[0];
}

describe("vendor public RLS hardening migration", () => {
  it("contains no vendor data mutation and removes only the known drift policies", () => {
    expect(migration).toMatch(/^--[\s\S]*\nBEGIN;\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("SET lock_timeout = '5s';");
    expect(migration).toContain("SET statement_timeout = '30s';");
    expect(migration).toContain(
      "DROP POLICY IF EXISTS vendors_read ON public.vendors;"
    );
    expect(migration).toContain(
      "DROP POLICY IF EXISTS products_read ON public.vendor_products;"
    );
    expect(migration).toContain(
      "DROP POLICY IF EXISTS images_read ON public.vendor_images;"
    );
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\.(?:vendors|vendor_products|vendor_images)\b/i
    );
    expect(migration).not.toMatch(/CREATE POLICY\s+(?:vendors_read|products_read|images_read)/i);
  });

  it("preserves approved reads and owner reads while hiding pending and rejected rows", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "anon");
      expect(await visibleCounts(db)).toEqual({
        vendors: 3,
        products: 3,
        images: 3,
      });
      await resetPersona(db);

      await applyMigration(db);

      await setPersona(db, "anon");
      expect(await visibleCounts(db)).toEqual({
        vendors: 1,
        products: 1,
        images: 1,
      });
      await resetPersona(db);

      await setPersona(db, "authenticated", OWNER_ID);
      expect(await visibleCounts(db)).toEqual({
        vendors: 2,
        products: 2,
        images: 1,
      });
      await resetPersona(db);

      await setPersona(db, "authenticated", OUTSIDER_ID);
      expect(await visibleCounts(db)).toEqual({
        vendors: 1,
        products: 1,
        images: 1,
      });
      await resetPersona(db);

      await setPersona(db, "service_role");
      expect(await visibleCounts(db)).toEqual({
        vendors: 3,
        products: 3,
        images: 3,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is replay-safe and leaves the expected policy contract", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);
      await applyMigration(db);

      const result = await db.query<{ drift_count: number }>(`
        SELECT count(*)::INT AS drift_count
        FROM pg_policy AS policy_row
        WHERE (policy_row.polrelid, policy_row.polname) IN (
          ('public.vendors'::REGCLASS, 'vendors_read'),
          ('public.vendor_products'::REGCLASS, 'products_read'),
          ('public.vendor_images'::REGCLASS, 'images_read')
        )
      `);
      expect(result.rows[0]?.drift_count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);
});
