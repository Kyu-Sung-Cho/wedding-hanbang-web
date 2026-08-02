// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802132000_atomic_initial_admin_bootstrap.sql",
  ),
  "utf8",
);

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      name text,
      email text,
      onboarding_completed boolean NOT NULL DEFAULT false,
      onboarding_step integer NOT NULL DEFAULT 0,
      is_admin boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT ALL ON public.profiles TO service_role;

    INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
    INSERT INTO public.profiles (id, name, email) VALUES
      ('${USER_A}', 'A', 'a@example.com'),
      ('${USER_B}', 'B', 'b@example.com');
  `);
  await db.exec(migration);
  return db;
}

async function setActor(db: PGlite, role: "authenticated" | "service_role") {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function resetActor(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

describe("atomic initial-admin bootstrap migration", () => {
  it("locks before checking or promoting and grants only the service role", () => {
    const lock = migration.indexOf("pg_advisory_xact_lock");
    const existing = migration.indexOf("IF EXISTS (SELECT 1 FROM public.profiles WHERE is_admin = true)");
    const promotion = migration.indexOf("INSERT INTO public.profiles");
    expect(lock).toBeGreaterThan(0);
    expect(existing).toBeGreaterThan(lock);
    expect(promotion).toBeGreaterThan(existing);
    expect(migration).toMatch(/REVOKE ALL[\s\S]*FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/i);
  });

  it("allows exactly one service-owned claim and rejects a second promotion", async () => {
    const db = await createDatabase();
    try {
      await setActor(db, "authenticated");
      await expect(db.query(
        "SELECT public.bootstrap_initial_admin_profile($1, $2, $3)",
        [USER_A, "First Admin", "FIRST@EXAMPLE.COM"],
      )).rejects.toThrow(/permission denied/i);

      await resetActor(db);
      await setActor(db, "service_role");
      const claimed = await db.query<{ bootstrap_initial_admin_profile: boolean }>(
        "SELECT public.bootstrap_initial_admin_profile($1, $2, $3)",
        [USER_A, "First Admin", "FIRST@EXAMPLE.COM"],
      );
      expect(claimed.rows[0]?.bootstrap_initial_admin_profile).toBe(true);

      await expect(db.query(
        "SELECT public.bootstrap_initial_admin_profile($1, $2, $3)",
        [USER_B, "Second Admin", "second@example.com"],
      )).rejects.toThrow(/initial_admin_already_exists/i);

      await resetActor(db);
      const profiles = await db.query<{
        id: string;
        is_admin: boolean;
        email: string;
        onboarding_completed: boolean;
        onboarding_step: number;
      }>(`
        SELECT id::text, is_admin, email, onboarding_completed, onboarding_step
        FROM public.profiles ORDER BY id
      `);
      expect(profiles.rows).toEqual([
        {
          id: USER_A,
          is_admin: true,
          email: "first@example.com",
          onboarding_completed: true,
          onboarding_step: 5,
        },
        {
          id: USER_B,
          is_admin: false,
          email: "b@example.com",
          onboarding_completed: false,
          onboarding_step: 0,
        },
      ]);
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
