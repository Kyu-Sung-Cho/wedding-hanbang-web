// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802138000_close_legacy_gamification_data_surface.sql",
  ),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";

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

    CREATE TABLE public.community_achievements (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      achievement_key text NOT NULL,
      unlocked_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_streaks (
      user_id uuid PRIMARY KEY,
      current_streak integer NOT NULL DEFAULT 0,
      longest_streak integer NOT NULL DEFAULT 0,
      last_login_date date,
      total_logins integer NOT NULL DEFAULT 0
    );

    ALTER TABLE public.community_achievements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_streaks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY ach_select ON public.community_achievements
      FOR SELECT USING (true);
    CREATE POLICY ach_insert ON public.community_achievements
      FOR INSERT WITH CHECK (false);
    CREATE POLICY streak_select ON public.community_streaks
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY streak_insert ON public.community_streaks
      FOR INSERT WITH CHECK (user_id = auth.uid());

    GRANT ALL PRIVILEGES ON TABLE
      public.community_achievements,
      public.community_streaks
    TO anon, authenticated, service_role;
    GRANT REFERENCES (user_id) ON TABLE public.community_achievements
      TO authenticated, service_role;

    INSERT INTO public.community_achievements (id, user_id, achievement_key)
    VALUES
      ('10000000-0000-4000-8000-000000000001', '${USER_ID}', 'first_post'),
      ('10000000-0000-4000-8000-000000000002', '${OTHER_ID}', 'daily_login');
    INSERT INTO public.community_streaks (
      user_id, current_streak, longest_streak, total_logins
    ) VALUES
      ('${USER_ID}', 3, 4, 8),
      ('${OTHER_ID}', 9, 12, 25);
  `);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId = "",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("legacy gamification data fence migration", () => {
  it("blocks anonymous reads and cross-account achievement/streak reads", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      await setPersona(db, "anon");
      await expect(
        db.query("SELECT user_id FROM public.community_achievements"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT user_id FROM public.community_streaks"),
      ).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "authenticated", USER_ID);
      expect((await db.query<{ user_id: string }>(
        "SELECT user_id FROM public.community_achievements ORDER BY user_id",
      )).rows).toEqual([{ user_id: USER_ID }]);
      expect((await db.query<{ user_id: string }>(
        "SELECT user_id FROM public.community_streaks ORDER BY user_id",
      )).rows).toEqual([{ user_id: USER_ID }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects client-forged streaks while preserving service writes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      await setPersona(db, "authenticated", USER_ID);
      await expect(db.exec(`
        INSERT INTO public.community_streaks (
          user_id, current_streak, longest_streak, total_logins
        ) VALUES (
          '00000000-0000-4000-8000-000000000003', 999, 999, 999
        )
      `)).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "service_role");
      await db.exec(`
        INSERT INTO public.community_streaks (
          user_id, current_streak, longest_streak, total_logins
        ) VALUES (
          '00000000-0000-4000-8000-000000000003', 1, 1, 1
        )
      `);
      expect((await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.community_streaks",
      )).rows[0]?.count).toBe(3);

      for (const table of ["community_achievements", "community_streaks"]) {
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
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is transactional, replay-safe, and verifies effective privileges", async () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("has_table_privilege");
    expect(migration).not.toContain("'SELECT,INSERT,UPDATE,DELETE'");
    expect(migration).not.toMatch(/GRANT ALL PRIVILEGES ON TABLE[\s\S]{0,160}TO service_role/);

    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a partial service ACL instead of treating any DML privilege as all", async () => {
    const missingServiceDmlMigration = migration.replace(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE",
      "GRANT SELECT ON TABLE",
    );
    expect(missingServiceDmlMigration).not.toBe(migration);

    const db = await createDatabase();
    try {
      await expect(db.exec(missingServiceDmlMigration)).rejects.toThrow(
        /GAMIFICATION_DATA_FENCE_SERVICE_PRIVILEGE_MISSING/i,
      );
    } finally {
      await db.close();
    }
  }, 30_000);
});
