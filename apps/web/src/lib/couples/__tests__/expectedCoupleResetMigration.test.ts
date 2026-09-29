// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrations = [
  "20260714164500_expand_atomic_couple_reset.sql",
  "20260928144843_couple_reset_expected_identity.sql",
].map(file => readFileSync(resolve(process.cwd(), "../../supabase/migrations", file), "utf8"));
const USER = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000002";
const MISSING = "00000000-0000-4000-8000-000000000003";
const COUPLE = "10000000-0000-4000-8000-000000000001";
const OTHER_COUPLE = "10000000-0000-4000-8000-000000000002";

let db: PGlite;

async function persona(userId: string | null, role = "authenticated") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  if (role === "authenticated" || role === "anon" || role === "service_role") {
    await db.exec(`SET ROLE ${role}`);
  }
}

function reset(userId: string | null, coupleId: string | null) {
  return db.query<{ result: { success: boolean; previous_couple_id: string | null } }>(
    "SELECT public.reset_expected_couple_membership($1::uuid, $2::uuid) AS result",
    [userId, coupleId],
  );
}

async function snapshot() {
  await db.exec("RESET ROLE");
  return (await db.query(`SELECT jsonb_build_object(
    'couples', (SELECT jsonb_agg(row_to_json(c) ORDER BY c.id) FROM public.couples c),
    'profiles', (SELECT jsonb_agg(row_to_json(p) ORDER BY p.id) FROM public.profiles p)
  ) AS snapshot`)).rows;
}

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY, bride_id uuid, groom_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, couple_id uuid,
      onboarding_completed boolean NOT NULL DEFAULT true,
      onboarding_step integer NOT NULL DEFAULT 5,
      shared_chat_cleared_at timestamptz, private_chat_cleared_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.guard_membership_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF COALESCE(current_setting('hanbang.allow_membership_write', true), '') <> 'on' THEN
        RAISE EXCEPTION 'membership_write_blocked';
      END IF;
      IF TG_TABLE_NAME = 'profiles' AND COALESCE(current_setting('test.fail_profile_reset', true), '') = 'on' THEN
        RAISE EXCEPTION 'forced_profile_reset_failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER guard_couple_membership BEFORE UPDATE OF bride_id, groom_id ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.guard_membership_write();
    CREATE TRIGGER guard_profile_membership BEFORE UPDATE OF couple_id ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.guard_membership_write();
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    INSERT INTO public.couples (id, bride_id, groom_id) VALUES ('${COUPLE}', '${USER}', '${PARTNER}');
    INSERT INTO public.profiles (id, couple_id, shared_chat_cleared_at, private_chat_cleared_at)
      VALUES ('${USER}', '${COUPLE}', now(), now()), ('${PARTNER}', '${COUPLE}', now(), now());
  `);
  await db.exec(`BEGIN;\n${migrations.join("\n")}\nCOMMIT;`);
});

afterEach(async () => { await db.close(); });

describe("expected couple reset SQL boundary", () => {
  it.each([
    [PARTNER, COUPLE, "couple_reset_user_changed"],
    [null, COUPLE, "couple_reset_user_changed"],
    [USER, OTHER_COUPLE, "couple_reset_couple_changed"],
    [USER, null, "couple_reset_couple_changed"],
  ] as const)("rejects expected identity %s / %s before any write", async (expectedUser, expectedCouple, message) => {
    const before = await snapshot();
    await persona(USER);
    await expect(reset(expectedUser, expectedCouple)).rejects.toMatchObject({ code: "P0001", message });
    expect(await snapshot()).toEqual(before);
  });

  it.each([USER, PARTNER])("detaches only the confirmed member %s through the existing RPC", async (actor) => {
    await persona(actor);
    expect((await reset(actor, COUPLE)).rows[0].result).toEqual({ success: true, previous_couple_id: COUPLE });
    await db.exec("RESET ROLE");
    const couple = (await db.query("SELECT bride_id, groom_id FROM public.couples")).rows[0];
    expect(couple).toEqual({ bride_id: actor === USER ? null : USER, groom_id: actor === PARTNER ? null : PARTNER });
    const profile = (await db.query("SELECT couple_id, onboarding_completed, onboarding_step, shared_chat_cleared_at, private_chat_cleared_at FROM public.profiles WHERE id=$1", [actor])).rows[0];
    expect(profile).toEqual({ couple_id: null, onboarding_completed: false, onboarding_step: 1,
      shared_chat_cleared_at: null, private_chat_cleared_at: null });
  });

  it("rejects an old coupled confirmation after reset but accepts repeated explicit null confirmations", async () => {
    await persona(USER);
    await reset(USER, COUPLE);
    const cleared = await snapshot();
    await persona(USER);
    await expect(reset(USER, COUPLE)).rejects.toMatchObject({ code: "P0001", message: "couple_reset_couple_changed" });
    expect(await snapshot()).toEqual(cleared);
    await persona(USER);
    for (let index = 0; index < 2; index++) {
      expect((await reset(USER, null)).rows[0].result).toEqual({ success: true, previous_couple_id: null });
    }
  });

  it("reports a missing actor profile without changing the couple", async () => {
    const before = await snapshot();
    await persona(MISSING);
    await expect(reset(MISSING, null)).rejects.toMatchObject({ code: "P0002", message: "profile_not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls the couple update back if the nested profile reset fails", async () => {
    const before = await snapshot();
    await persona(USER);
    await db.query("SELECT set_config('test.fail_profile_reset', 'on', false)");
    await expect(reset(USER, COUPLE)).rejects.toThrow("forced_profile_reset_failure");
    expect(await snapshot()).toEqual(before);
  });

  it.each(["anon", "service_role"])("denies execution for the %s database role", async (role) => {
    await persona(USER, role);
    await expect(reset(USER, COUPLE)).rejects.toMatchObject({ code: "42501" });
  });

  it.each(["missing_uid", "wrong_claim_role"])("denies an authenticated connection with %s", async (mode) => {
    await persona(mode === "missing_uid" ? null : USER);
    if (mode === "wrong_claim_role") await db.query("SELECT set_config('request.jwt.claim.role', 'anon', false)");
    await expect(reset(USER, COUPLE)).rejects.toMatchObject({ code: "42501", message: "authentication_required" });
  });

  it("sets the bounded execution and namespace settings in the database catalog", async () => {
    const result = await db.query<{ proconfig: string[]; prosecdef: boolean }>(
      "SELECT proconfig, prosecdef FROM pg_proc WHERE oid='public.reset_expected_couple_membership(uuid,uuid)'::regprocedure",
    );
    expect(result.rows[0]).toEqual({ prosecdef: true, proconfig: ["search_path=pg_catalog, public", "lock_timeout=5s", "statement_timeout=15s"] });
  });
});
