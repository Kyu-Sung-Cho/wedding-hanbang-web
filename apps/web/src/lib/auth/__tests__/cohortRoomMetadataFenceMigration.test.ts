// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802139000_require_auth_for_cohort_room_metadata.sql",
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

    CREATE TABLE public.cohort_rooms (
      id uuid PRIMARY KEY,
      year integer NOT NULL,
      month integer NOT NULL,
      room_number integer NOT NULL,
      name text NOT NULL,
      member_count integer NOT NULL DEFAULT 0,
      message_count integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true
    );
    ALTER TABLE public.cohort_rooms ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cohort_rooms_select_all ON public.cohort_rooms
      FOR SELECT USING (true);
    GRANT ALL PRIVILEGES ON TABLE public.cohort_rooms
      TO anon, authenticated, service_role;
    GRANT REFERENCES (year) ON TABLE public.cohort_rooms
      TO authenticated, service_role;

    INSERT INTO public.cohort_rooms (
      id, year, month, room_number, name, member_count, message_count
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      2027, 6, 1, '2027-06 cohort', 12, 30
    );
  `);
  return db;
}

describe("cohort room metadata fence migration", () => {
  it("blocks anonymous discovery and preserves authenticated reads", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      await db.exec("SET ROLE anon");
      await expect(
        db.query("SELECT id, year, month FROM public.cohort_rooms"),
      ).rejects.toThrow(/permission denied/i);

      await db.exec("RESET ROLE");
      await db.exec("SET ROLE authenticated");
      expect((await db.query<{ id: string }>(
        "SELECT id FROM public.cohort_rooms",
      )).rows).toEqual([{
        id: "10000000-0000-4000-8000-000000000001",
      }]);
      await expect(db.exec(`
        UPDATE public.cohort_rooms SET member_count = 999
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps service room maintenance working and is replay-safe", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      await db.exec(`
        UPDATE public.cohort_rooms SET member_count = 13
      `);
      expect((await db.query<{ member_count: number }>(
        "SELECT member_count FROM public.cohort_rooms",
      )).rows).toEqual([{ member_count: 13 }]);
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
          has_table_privilege('service_role', 'public.cohort_rooms', 'SELECT') AS can_select,
          has_table_privilege('service_role', 'public.cohort_rooms', 'INSERT') AS can_insert,
          has_table_privilege('service_role', 'public.cohort_rooms', 'UPDATE') AS can_update,
          has_table_privilege('service_role', 'public.cohort_rooms', 'DELETE') AS can_delete,
          has_table_privilege('service_role', 'public.cohort_rooms', 'TRUNCATE') AS can_truncate,
          has_table_privilege('service_role', 'public.cohort_rooms', 'REFERENCES') AS can_reference,
          has_table_privilege('service_role', 'public.cohort_rooms', 'TRIGGER') AS can_trigger,
          has_any_column_privilege('service_role', 'public.cohort_rooms', 'REFERENCES')
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
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is transactional and verifies effective privileges", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("has_table_privilege");
    expect(migration).not.toContain("'SELECT,INSERT,UPDATE,DELETE'");
    expect(migration).not.toContain(
      "GRANT ALL PRIVILEGES ON TABLE public.cohort_rooms TO service_role;",
    );
  });

  it("rejects a partial service ACL instead of treating SELECT as full DML", async () => {
    const missingServiceDmlMigration = migration.replace(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cohort_rooms TO service_role;",
      "GRANT SELECT ON TABLE public.cohort_rooms TO service_role;",
    );
    expect(missingServiceDmlMigration).not.toBe(migration);

    const db = await createDatabase();
    try {
      await expect(db.exec(missingServiceDmlMigration)).rejects.toThrow(
        /COHORT_ROOM_METADATA_FENCE_SERVICE_PRIVILEGE_MISSING/i,
      );
    } finally {
      await db.close();
    }
  }, 30_000);
});
