// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802140000_close_dormant_legacy_data_surfaces.sql",
  ),
  "utf8",
);

const TARGETS = [
  "schedules",
  "b2b_survey_responses",
  "dress_fitting_images",
  "vendor_views",
  "vendor_submissions",
  "submission_verifications",
] as const;

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.schedules (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      title text NOT NULL,
      description text,
      date date NOT NULL,
      location text
    );
    CREATE TABLE public.b2b_survey_responses (
      id uuid PRIMARY KEY,
      contact_name text,
      contact_phone text,
      contact_email text
    );
    CREATE TABLE public.dress_fitting_images (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL,
      image_url text NOT NULL
    );
    CREATE TABLE public.vendor_views (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL,
      viewer_id uuid,
      created_at timestamptz
    );
    CREATE TABLE public.vendor_submissions (
      id uuid PRIMARY KEY,
      user_id uuid,
      vendor_name text,
      status text,
      evidence_urls text[],
      admin_note text
    );
    CREATE TABLE public.submission_verifications (
      id uuid PRIMARY KEY,
      submission_id uuid,
      user_id uuid,
      comment text
    );

    ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.b2b_survey_responses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.dress_fitting_images ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_views ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_submissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.submission_verifications ENABLE ROW LEVEL SECURITY;

    CREATE POLICY schedules_select ON public.schedules FOR SELECT USING (true);
    CREATE POLICY schedules_insert ON public.schedules FOR INSERT WITH CHECK (true);
    CREATE POLICY schedules_update ON public.schedules FOR UPDATE USING (true);
    CREATE POLICY schedules_delete ON public.schedules FOR DELETE USING (true);
    CREATE POLICY b2b_insert ON public.b2b_survey_responses FOR INSERT WITH CHECK (true);
    CREATE POLICY fitting_select ON public.dress_fitting_images FOR SELECT USING (true);
    CREATE POLICY fitting_insert ON public.dress_fitting_images
      FOR INSERT WITH CHECK (true);
    CREATE POLICY vendor_views_insert ON public.vendor_views
      FOR INSERT WITH CHECK (true);
    CREATE POLICY submission_approved ON public.vendor_submissions
      FOR SELECT USING (status = 'approved');
    CREATE POLICY verification_select ON public.submission_verifications
      FOR SELECT USING (true);

    GRANT ALL PRIVILEGES ON TABLE
      public.schedules,
      public.b2b_survey_responses,
      public.dress_fitting_images,
      public.vendor_views,
      public.vendor_submissions,
      public.submission_verifications
    TO anon, authenticated, service_role;
    GRANT REFERENCES (couple_id) ON TABLE public.schedules
      TO authenticated, service_role;

    INSERT INTO public.schedules (
      id, couple_id, title, description, date, location
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Private appointment', 'Contract meeting', '2027-06-03', 'Private venue'
    );
  `);
  return db;
}

describe("dormant legacy data fence migration", () => {
  it("removes every direct client privilege from each hosted-only table", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        for (const table of TARGETS) {
          await expect(
            db.query(`SELECT * FROM public.${table}`),
          ).rejects.toThrow(/permission denied/i);
          await expect(db.exec(`
            INSERT INTO public.${table} DEFAULT VALUES
          `)).rejects.toThrow(/permission denied/i);
        }
        await db.exec("RESET ROLE");
      }
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves service access and replays safely", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      expect((await db.query<{ title: string }>(
        "SELECT title FROM public.schedules",
      )).rows).toEqual([{ title: "Private appointment" }]);
      for (const table of TARGETS) {
        expect((await db.query<{
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          can_truncate: boolean;
          can_reference: boolean;
          can_trigger: boolean;
          can_reference_column: boolean;
        }>(`
          SELECT
            has_table_privilege('service_role', 'public.${table}', 'SELECT') AS can_select,
            has_table_privilege('service_role', 'public.${table}', 'INSERT') AS can_insert,
            has_table_privilege('service_role', 'public.${table}', 'UPDATE') AS can_update,
            has_table_privilege('service_role', 'public.${table}', 'DELETE') AS can_delete,
            has_table_privilege('service_role', 'public.${table}', 'TRUNCATE') AS can_truncate,
            has_table_privilege('service_role', 'public.${table}', 'REFERENCES') AS can_reference,
            has_table_privilege('service_role', 'public.${table}', 'TRIGGER') AS can_trigger,
            has_any_column_privilege('service_role', 'public.${table}', 'REFERENCES')
              AS can_reference_column
        `)).rows).toEqual([{
          can_select: true,
          can_insert: true,
          can_update: true,
          can_delete: true,
          can_truncate: false,
          can_reference: false,
          can_trigger: false,
          can_reference_column: false,
        }]);
      }
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is safe when hosted-only tables are absent", async () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("has_table_privilege");
    expect(migration).not.toContain("'SELECT,INSERT,UPDATE,DELETE'");
    expect(migration).not.toContain(
      "GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role",
    );

    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      `);
      await db.exec(migration);
      await db.exec(migration);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a partial service ACL instead of treating SELECT as full DML", async () => {
    const missingServiceDmlMigration = migration.replace(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role",
      "GRANT SELECT ON TABLE public.%I TO service_role",
    );
    expect(missingServiceDmlMigration).not.toBe(migration);

    const db = await createDatabase();
    try {
      await expect(db.exec(missingServiceDmlMigration)).rejects.toThrow(
        /DORMANT_LEGACY_TABLE_SERVICE_ACCESS_MISSING/i,
      );
    } finally {
      await db.close();
    }
  }, 30_000);
});
