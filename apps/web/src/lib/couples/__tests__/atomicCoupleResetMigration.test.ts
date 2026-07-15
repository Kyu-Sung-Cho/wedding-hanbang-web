// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714164500_expand_atomic_couple_reset.sql"
  ),
  "utf8"
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid,
      onboarding_completed boolean NOT NULL DEFAULT true,
      onboarding_step integer NOT NULL DEFAULT 5,
      shared_chat_cleared_at timestamptz,
      private_chat_cleared_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public.guard_membership_write()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF COALESCE(current_setting('hanbang.allow_membership_write', true), '') <> 'on' THEN
        RAISE EXCEPTION 'membership_write_blocked';
      END IF;
      IF TG_TABLE_NAME = 'profiles' THEN
        IF NEW.couple_id IS NULL
           AND COALESCE(current_setting('test.fail_profile_reset', true), '') = 'on' THEN
          RAISE EXCEPTION 'forced_profile_reset_failure';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER guard_couple_membership
      BEFORE UPDATE OF bride_id, groom_id ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.guard_membership_write();
    CREATE TRIGGER guard_profile_membership
      BEFORE UPDATE OF couple_id ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.guard_membership_write();

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT, UPDATE ON public.couples, public.profiles TO authenticated;

    INSERT INTO public.couples (id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${USER_ID}', '${PARTNER_ID}');
    INSERT INTO public.profiles (
      id, couple_id, shared_chat_cleared_at, private_chat_cleared_at
    ) VALUES
      ('${USER_ID}', '${COUPLE_ID}', now(), now()),
      ('${PARTNER_ID}', '${COUPLE_ID}', now(), now());
  `);
  await db.exec(`BEGIN;
` + migration + `
COMMIT;`);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
  userId = USER_ID
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.query("SELECT set_config('test.fail_profile_reset', '', false)");
}

describe("atomic couple reset migration", () => {
  it("detaches only the caller, resets onboarding, and is idempotent", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated");
      await db.query("SELECT public.reset_current_couple_membership()");
      await db.query("SELECT public.reset_current_couple_membership()");
      await resetPersona(db);

      const couple = await db.query<{ bride_id: string | null; groom_id: string | null }>(
        "SELECT bride_id, groom_id FROM public.couples WHERE id = $1",
        [COUPLE_ID]
      );
      const profile = await db.query<{
        couple_id: string | null;
        onboarding_completed: boolean;
        onboarding_step: number;
        shared_chat_cleared_at: string | null;
        private_chat_cleared_at: string | null;
      }>(
        "SELECT couple_id, onboarding_completed, onboarding_step, shared_chat_cleared_at, private_chat_cleared_at FROM public.profiles WHERE id = $1",
        [USER_ID]
      );

      expect(couple.rows[0]).toEqual({ bride_id: null, groom_id: PARTNER_ID });
      expect(profile.rows[0]).toEqual({
        couple_id: null,
        onboarding_completed: false,
        onboarding_step: 1,
        shared_chat_cleared_at: null,
        private_chat_cleared_at: null,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back the couple update when the profile reset fails", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated");
      await db.query("SELECT set_config('test.fail_profile_reset', 'on', false)");
      await expect(
        db.query("SELECT public.reset_current_couple_membership()")
      ).rejects.toThrow(/forced_profile_reset_failure/);
      await resetPersona(db);

      const couple = await db.query<{ bride_id: string; groom_id: string }>(
        "SELECT bride_id, groom_id FROM public.couples WHERE id = $1",
        [COUPLE_ID]
      );
      const profile = await db.query<{ couple_id: string }>(
        "SELECT couple_id FROM public.profiles WHERE id = $1",
        [USER_ID]
      );
      expect(couple.rows[0]).toEqual({ bride_id: USER_ID, groom_id: PARTNER_ID });
      expect(profile.rows[0]?.couple_id).toBe(COUPLE_ID);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not expose the reset RPC to service-role callers", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await expect(
        db.query("SELECT public.reset_current_couple_membership()")
      ).rejects.toThrow();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
