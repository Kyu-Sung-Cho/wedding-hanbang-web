// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718140000_disclosure_source_previews.sql",
  ),
  "utf8",
);

async function baseline() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_name text NOT NULL
    );
    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      package_name text NOT NULL
    );
    CREATE VIEW public.v_public_official_prices AS
      SELECT id, item_name FROM public.official_prices;
    CREATE VIEW public.v_public_agency_packages AS
      SELECT id, package_name FROM public.official_agency_packages;

    GRANT SELECT ON public.official_prices, public.official_agency_packages TO anon, authenticated;
    GRANT SELECT ON public.v_public_official_prices, public.v_public_agency_packages TO anon, authenticated;
  `);
  return db;
}

describe("private disclosure source preview migration", () => {
  it("creates a bounded private text bucket and keeps preview columns service-only", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      const bucket = await db.query<{
        public: boolean;
        file_size_limit: number;
        allowed_mime_types: string[];
      }>(`
        SELECT public, file_size_limit, allowed_mime_types
        FROM storage.buckets
        WHERE id = 'disclosure-preview'
      `);
      expect(bucket.rows).toEqual([{
        public: false,
        file_size_limit: 2 * 1024 * 1024,
        allowed_mime_types: ["text/plain"],
      }]);

      await expect(db.exec(`
        SET ROLE anon;
        SELECT source_preview_keys FROM public.official_prices;
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");
      await expect(db.exec(`
        SET ROLE authenticated;
        SELECT source_preview_keys FROM public.official_agency_packages;
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");

      const publicColumns = await db.query<{ table_name: string; column_name: string }>(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('v_public_official_prices', 'v_public_agency_packages')
          AND column_name = 'source_preview_keys'
      `);
      expect(publicColumns.rows).toEqual([]);
      const policies = await db.query<{ policyname: string }>(`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND COALESCE(qual, '') LIKE '%disclosure-preview%'
      `);
      expect(policies.rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("rejects unsafe keys and freezes a non-empty preview association", async () => {
    const db = await baseline();
    const keyA = `${"a".repeat(64)}.txt`;
    const keyB = `${"b".repeat(64)}.txt`;
    try {
      await db.exec(migration);
      await db.exec(`
        SET ROLE service_role;
        INSERT INTO public.official_prices (id, item_name)
        VALUES ('10000000-0000-4000-8000-000000000001', 'Generated price');
        UPDATE public.official_prices
        SET source_preview_keys = ARRAY['${keyA}']
        WHERE id = '10000000-0000-4000-8000-000000000001';
      `);
      await expect(db.exec(`
        UPDATE public.official_prices
        SET source_preview_keys = ARRAY['${keyB}']
        WHERE id = '10000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow(/PREVIEW_KEYS_IMMUTABLE/iu);
      await expect(db.exec(`
        INSERT INTO public.official_agency_packages (package_name, source_preview_keys)
        VALUES ('Generated package', ARRAY['../../private.txt'])
      `)).rejects.toThrow();
      const tooMany = Array.from({ length: 17 }, (_, index) =>
        `'${index.toString(16).padStart(64, "0")}.txt'`
      ).join(",");
      await expect(db.exec(`
        INSERT INTO public.official_agency_packages (package_name, source_preview_keys)
        VALUES ('Generated package', ARRAY[${tooMany}])
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
