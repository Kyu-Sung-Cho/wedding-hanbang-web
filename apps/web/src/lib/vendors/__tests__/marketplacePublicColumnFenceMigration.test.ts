// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802141000_minimize_public_marketplace_column_access.sql",
  ),
  "utf8",
);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.vendor_products (
      id uuid PRIMARY KEY, vendor_id uuid, name text, description text,
      price integer, discount_price integer, original_price integer,
      duration text, duration_minutes integer, is_active boolean,
      is_popular boolean, sort_order integer, category_fields jsonb,
      includes text[], excludes text[], images text[],
      created_at timestamptz, updated_at timestamptz, notes text
    );
    CREATE TABLE public.vendor_reviews (
      id uuid PRIMARY KEY, vendor_id uuid, booking_id uuid, customer_id uuid,
      rating integer, content text, images text[], reply text,
      replied_at timestamptz, is_visible boolean, created_at timestamptz,
      updated_at timestamptz
    );
    CREATE TABLE public.vendor_staff (
      id uuid PRIMARY KEY, vendor_id uuid, name text, role text,
      description text, is_active boolean, sort_order integer,
      created_at timestamptz
    );
    CREATE TABLE public.vendor_images (
      id uuid PRIMARY KEY, vendor_id uuid, image_url text, image_type text,
      sort_order integer, created_at timestamptz, product_id uuid,
      alt_text text, is_thumbnail boolean
    );
    CREATE TABLE public.vendor_timeslots (
      id uuid PRIMARY KEY, vendor_id uuid, day integer, hour integer,
      available boolean, max_bookings integer
    );
    CREATE TABLE public.product_timeslots (
      id uuid PRIMARY KEY, product_id uuid, day integer, hour integer,
      available boolean, max_bookings integer
    );
    CREATE TABLE public.staff_timeslots (
      id uuid PRIMARY KEY, staff_id uuid, day integer, hour integer,
      available boolean, max_bookings integer
    );

    ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_reviews ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_staff ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_images ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_timeslots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.product_timeslots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.staff_timeslots ENABLE ROW LEVEL SECURITY;

    CREATE POLICY products_public ON public.vendor_products FOR SELECT USING (true);
    CREATE POLICY reviews_public ON public.vendor_reviews FOR SELECT USING (true);
    CREATE POLICY staff_public ON public.vendor_staff FOR SELECT USING (true);
    CREATE POLICY images_public ON public.vendor_images FOR SELECT USING (true);
    CREATE POLICY vendor_slots_public ON public.vendor_timeslots FOR SELECT USING (true);
    CREATE POLICY product_slots_public ON public.product_timeslots FOR SELECT USING (true);
    CREATE POLICY staff_slots_public ON public.staff_timeslots FOR SELECT USING (true);

    GRANT SELECT ON TABLE
      public.vendor_products,
      public.vendor_reviews,
      public.vendor_staff,
      public.vendor_images,
      public.vendor_timeslots,
      public.product_timeslots,
      public.staff_timeslots
    TO anon, authenticated, service_role;

    INSERT INTO public.vendor_products (
      id, vendor_id, name, is_active, notes
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Public product', true, 'vendor-only margin note'
    );
    INSERT INTO public.vendor_reviews (
      id, vendor_id, booking_id, customer_id, rating, content, is_visible
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      5, 'Public review', true
    );
    INSERT INTO public.vendor_timeslots (
      id, vendor_id, day, hour, available, max_bookings
    ) VALUES (
      '60000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      1, 11, true, 12
    );
  `);
  return db;
}

describe("marketplace public column fence migration", () => {
  it("preserves public catalog fields while hiding identities and operations", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        expect((await db.query<{ name: string }>(
          "SELECT name FROM public.vendor_products",
        )).rows).toEqual([{ name: "Public product" }]);
        expect((await db.query<{ rating: number }>(
          "SELECT rating FROM public.vendor_reviews",
        )).rows).toEqual([{ rating: 5 }]);
        expect((await db.query<{ available: boolean }>(
          "SELECT available FROM public.vendor_timeslots",
        )).rows).toEqual([{ available: true }]);

        await expect(
          db.query("SELECT notes FROM public.vendor_products"),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.query("SELECT booking_id, customer_id FROM public.vendor_reviews"),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.query("SELECT max_bookings FROM public.vendor_timeslots"),
        ).rejects.toThrow(/permission denied/i);
        await db.exec("RESET ROLE");
      }
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves full service reads and is replay-safe", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      expect((await db.query<{
        notes: string;
        customer_id: string;
        max_bookings: number;
      }>(`
        SELECT
          (SELECT notes FROM public.vendor_products LIMIT 1) AS notes,
          (SELECT customer_id FROM public.vendor_reviews LIMIT 1) AS customer_id,
          (SELECT max_bookings FROM public.vendor_timeslots LIMIT 1) AS max_bookings
      `)).rows[0]).toEqual({
        notes: "vendor-only margin note",
        customer_id: "50000000-0000-4000-8000-000000000001",
        max_bookings: 12,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is transactional and verifies future columns remain private", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("MARKETPLACE_PRIVATE_COLUMN_EXPOSED");
    expect(migration).toContain("has_column_privilege");
  });
});
