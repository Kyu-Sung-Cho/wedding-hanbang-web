// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714164800_expand_signup_profile_integrity.sql"
  ),
  "utf8"
);
const triggerRestorationMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260818100000_restore_signup_profile_trigger.sql"
);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      name text,
      email text,
      onboarding_completed boolean NOT NULL DEFAULT false,
      onboarding_step integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE FUNCTION public.create_profile_on_signup()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $legacy$
    BEGIN
      INSERT INTO profiles (id) VALUES (NEW.id);
      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
      RETURN NEW;
    END;
    $legacy$;

    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.create_profile_on_signup();
  `);
  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  return db;
}

describe("signup profile integrity migration", () => {
  it("restores the fail-closed Auth profile trigger when hosted schema drift removed it", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (
          id uuid PRIMARY KEY,
          email text,
          raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE TABLE public.profiles (
          id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
          name text,
          email text,
          onboarding_completed boolean NOT NULL DEFAULT false,
          onboarding_step integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE FUNCTION public.create_profile_on_signup()
        RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $drifted$
        BEGIN
          RETURN NEW;
        END;
        $drifted$;
      `);

      const triggerRestorationMigration = readFileSync(
        triggerRestorationMigrationPath,
        "utf8"
      );
      await db.exec(triggerRestorationMigration);
      await db.exec(`
        SET search_path = auth, pg_catalog;
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (
          '00000000-0000-4000-8000-000000000010',
          'restored@example.invalid',
          '{"full_name":"Restored User"}'::jsonb
        );
        RESET search_path;
      `);

      const profile = await db.query<{
        name: string;
        email: string;
        onboarding_completed: boolean;
        onboarding_step: number;
      }>(`
        SELECT name, email, onboarding_completed, onboarding_step
        FROM public.profiles
        WHERE id = '00000000-0000-4000-8000-000000000010'
      `);
      expect(profile.rows).toEqual([{
        name: "Restored User",
        email: "restored@example.invalid",
        onboarding_completed: false,
        onboarding_step: 0,
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("creates the profile when the Auth caller search_path excludes public", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        SET search_path = auth, pg_catalog;
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (
          '00000000-0000-4000-8000-000000000001',
          'release@example.invalid',
          '{"name":"Release Test"}'::jsonb
        );
        RESET search_path;
      `);

      const profile = await db.query<{
        name: string;
        email: string;
        onboarding_completed: boolean;
        onboarding_step: number;
      }>(`
        SELECT name, email, onboarding_completed, onboarding_step
        FROM public.profiles
        WHERE id = '00000000-0000-4000-8000-000000000001'
      `);

      expect(profile.rows).toEqual([
        {
          name: "Release Test",
          email: "release@example.invalid",
          onboarding_completed: false,
          onboarding_step: 0,
        },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails the Auth insert instead of leaving an orphan when profile creation fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec("DROP TABLE public.profiles");
      await expect(
        db.exec(`
          SET search_path = auth, pg_catalog;
          INSERT INTO auth.users (id, email)
          VALUES ('00000000-0000-4000-8000-000000000002', 'blocked@example.invalid');
        `)
      ).rejects.toThrow();

      const users = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM auth.users"
      );
      expect(users.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("is safe to re-run", async () => {
    const db = await createDatabase();
    try {
      await expect(db.exec(`BEGIN;\n${migration}\nCOMMIT;`)).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  }, 30_000);
});
