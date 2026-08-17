// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260816180000_amora_neutral_preparation_space.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const LEGACY_ID = "00000000-0000-4000-8000-000000000003";
const LEGACY_COUPLE_ID = "10000000-0000-4000-8000-000000000001";

const databases: PGlite[] = [];

async function setPersona(db: PGlite, role: "authenticated" | "service_role", userId?: string) {
  await db.exec(`
    RESET ROLE;
    SELECT set_config('request.jwt.claim.sub', '', false);
    SET ROLE ${role};
    ${userId ? `SELECT set_config('request.jwt.claim.sub', '${userId}', false);` : ""}
  `);
}

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invite_code text UNIQUE,
      bride_id uuid,
      groom_id uuid,
      membership_sealed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id),
      role text CHECK (role IN ('bride', 'groom')),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE FUNCTION public.test_seal_couple() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.bride_id IS NOT NULL AND NEW.groom_id IS NOT NULL THEN
        NEW.membership_sealed_at := COALESCE(OLD.membership_sealed_at, clock_timestamp());
      END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER trg_test_seal_couple
      BEFORE UPDATE ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.test_seal_couple();

    CREATE FUNCTION public.create_couple_for_current_user(p_role text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public, auth
    AS $$
    DECLARE
      v_actor uuid := auth.uid();
      v_profile public.profiles%ROWTYPE;
      v_couple public.couples%ROWTYPE;
    BEGIN
      IF v_actor IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED');
      END IF;
      IF p_role NOT IN ('bride', 'groom') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_ROLE');
      END IF;
      SELECT * INTO v_profile FROM public.profiles WHERE id = v_actor FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PROFILE_NOT_FOUND');
      END IF;
      IF v_profile.couple_id IS NOT NULL THEN
        SELECT * INTO v_couple FROM public.couples WHERE id = v_profile.couple_id;
        IF v_profile.role = p_role AND (
          (p_role = 'bride' AND v_couple.bride_id = v_actor)
          OR (p_role = 'groom' AND v_couple.groom_id = v_actor)
        ) THEN
          RETURN jsonb_build_object(
            'success', true, 'created', false, 'idempotent', true,
            'couple_id', v_couple.id, 'invite_code', v_couple.invite_code, 'role', p_role
          );
        END IF;
        RETURN jsonb_build_object('success', false, 'error_code', 'MEMBERSHIP_INCONSISTENT');
      END IF;

      INSERT INTO public.couples(invite_code, bride_id, groom_id)
      VALUES (
        'WH-NEUTRAL00001',
        CASE WHEN p_role = 'bride' THEN v_actor END,
        CASE WHEN p_role = 'groom' THEN v_actor END
      ) RETURNING * INTO v_couple;
      UPDATE public.profiles
      SET couple_id = v_couple.id, role = p_role, updated_at = clock_timestamp()
      WHERE id = v_actor;
      RETURN jsonb_build_object(
        'success', true, 'created', true, 'idempotent', false,
        'couple_id', v_couple.id, 'invite_code', v_couple.invite_code, 'role', p_role
      );
    END
    $$;

    CREATE FUNCTION public.join_couple_server(
      p_actor_user_id uuid, p_invite_code text, p_role text
    ) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
    DECLARE
      v_profile public.profiles%ROWTYPE;
      v_couple public.couples%ROWTYPE;
    BEGIN
      SELECT * INTO v_profile FROM public.profiles WHERE id = p_actor_user_id FOR UPDATE;
      IF v_profile.couple_id IS NOT NULL THEN
        SELECT * INTO v_couple FROM public.couples WHERE id = v_profile.couple_id;
        IF v_profile.role = p_role AND (
          (p_role = 'bride' AND v_couple.bride_id = p_actor_user_id)
          OR (p_role = 'groom' AND v_couple.groom_id = p_actor_user_id)
        ) THEN
          RETURN jsonb_build_object(
            'success', true, 'joined', false, 'idempotent', true,
            'actor_user_id', p_actor_user_id, 'couple_id', v_couple.id,
            'invite_code', upper(btrim(p_invite_code)), 'role', p_role
          );
        END IF;
        RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_LINKED');
      END IF;

      SELECT * INTO v_couple FROM public.couples
      WHERE invite_code = upper(btrim(p_invite_code)) FOR UPDATE;
      IF NOT FOUND OR v_couple.membership_sealed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_INVITE_CODE');
      END IF;
      IF (p_role = 'bride' AND (v_couple.bride_id IS NOT NULL OR v_couple.groom_id IS NULL))
         OR (p_role = 'groom' AND (v_couple.groom_id IS NOT NULL OR v_couple.bride_id IS NULL)) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_INVITE_CODE');
      END IF;
      UPDATE public.couples
      SET bride_id = CASE WHEN p_role = 'bride' THEN p_actor_user_id ELSE bride_id END,
          groom_id = CASE WHEN p_role = 'groom' THEN p_actor_user_id ELSE groom_id END,
          invite_code = NULL,
          updated_at = clock_timestamp()
      WHERE id = v_couple.id RETURNING * INTO v_couple;
      UPDATE public.profiles
      SET couple_id = v_couple.id, role = p_role, updated_at = clock_timestamp()
      WHERE id = p_actor_user_id;
      RETURN jsonb_build_object(
        'success', true, 'joined', true, 'idempotent', false,
        'actor_user_id', p_actor_user_id, 'couple_id', v_couple.id,
        'invite_code', upper(btrim(p_invite_code)), 'role', p_role
      );
    END
    $$;

    REVOKE ALL ON FUNCTION public.create_couple_for_current_user(text)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.create_couple_for_current_user(text) TO authenticated;
    REVOKE ALL ON FUNCTION public.join_couple_server(uuid,text,text)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.join_couple_server(uuid,text,text) TO service_role;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.profiles(id) VALUES
      ('${OWNER_ID}'), ('${PARTNER_ID}');
    INSERT INTO public.couples(id, invite_code, bride_id)
    VALUES ('${LEGACY_COUPLE_ID}', 'WH-LEGACY00001', '${LEGACY_ID}');
    INSERT INTO public.profiles(id, couple_id, role)
    VALUES ('${LEGACY_ID}', '${LEGACY_COUPLE_ID}', 'bride');
  `);
  if (migration) await db.exec(migration);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("neutral preparation-space migration", () => {
  it("creates one roleless neutral space without exposing its compatibility slot", async () => {
    const db = await createDatabase();
    await setPersona(db, "authenticated", OWNER_ID);

    const first = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.create_neutral_preparation_space_for_current_user() AS result
    `);
    const result = first.rows[0]?.result;

    expect(result).toMatchObject({
      success: true,
      created: true,
      idempotent: false,
      member_model_version: 2,
    });
    expect(result).not.toHaveProperty("role");

    await setPersona(db, "service_role");
    const stored = await db.query<{
      member_model_version: number;
      bride_id: string | null;
      groom_id: string | null;
      profile_role: string | null;
    }>(`
      SELECT couple.member_model_version, couple.bride_id, couple.groom_id,
             profile.role AS profile_role
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = '${OWNER_ID}'
    `);
    expect(stored.rows[0]).toEqual({
      member_model_version: 2,
      bride_id: OWNER_ID,
      groom_id: null,
      profile_role: "bride",
    });

    await setPersona(db, "authenticated", OWNER_ID);
    const retry = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.create_neutral_preparation_space_for_current_user() AS result
    `);
    expect(retry.rows[0]?.result).toMatchObject({
      success: true,
      created: false,
      idempotent: true,
      couple_id: result?.couple_id,
      member_model_version: 2,
    });
    expect(retry.rows[0]?.result).not.toHaveProperty("role");
  });

  it("joins a neutral invite by selecting the remaining compatibility slot on the server", async () => {
    const db = await createDatabase();
    await setPersona(db, "authenticated", OWNER_ID);
    const created = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.create_neutral_preparation_space_for_current_user() AS result
    `);
    const inviteCode = String(created.rows[0]?.result.invite_code);

    await setPersona(db, "service_role");
    const joined = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_neutral_preparation_space_server(
        '${PARTNER_ID}', '${inviteCode}'
      ) AS result
    `);

    expect(joined.rows[0]?.result).toMatchObject({
      success: true,
      joined: true,
      idempotent: false,
      actor_user_id: PARTNER_ID,
      couple_id: created.rows[0]?.result.couple_id,
      member_model_version: 2,
    });
    expect(joined.rows[0]?.result).not.toHaveProperty("role");

    const stored = await db.query<{
      bride_id: string;
      groom_id: string;
      membership_sealed_at: Date;
      member_model_version: number;
    }>(`
      SELECT bride_id, groom_id, membership_sealed_at, member_model_version
      FROM public.couples
      WHERE id = '${String(created.rows[0]?.result.couple_id)}'
    `);
    expect(stored.rows[0]).toMatchObject({
      bride_id: OWNER_ID,
      groom_id: PARTNER_ID,
      member_model_version: 2,
    });
    expect(stored.rows[0]?.membership_sealed_at).toBeInstanceOf(Date);

    const retry = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_neutral_preparation_space_server(
        '${PARTNER_ID}', '${inviteCode}'
      ) AS result
    `);
    expect(retry.rows[0]?.result).toMatchObject({
      success: true,
      joined: false,
      idempotent: true,
      couple_id: created.rows[0]?.result.couple_id,
      member_model_version: 2,
    });
    expect(retry.rows[0]?.result).not.toHaveProperty("role");
  });

  it("cannot upgrade or join legacy memberships through the neutral boundary", async () => {
    const db = await createDatabase();

    await setPersona(db, "authenticated", LEGACY_ID);
    const createAttempt = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.create_neutral_preparation_space_for_current_user() AS result
    `);
    expect(createAttempt.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "ALREADY_LINKED",
    });

    await setPersona(db, "service_role");
    const joinAttempt = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_neutral_preparation_space_server(
        '${PARTNER_ID}', 'WH-LEGACY00001'
      ) AS result
    `);
    expect(joinAttempt.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "INVALID_INVITE_CODE",
    });

    const state = await db.query<{
      member_model_version: number;
      bride_id: string | null;
      groom_id: string | null;
      partner_couple_id: string | null;
    }>(`
      SELECT couple.member_model_version, couple.bride_id, couple.groom_id,
             partner.couple_id AS partner_couple_id
      FROM public.couples AS couple
      JOIN public.profiles AS partner ON partner.id = '${PARTNER_ID}'
      WHERE couple.id = '${LEGACY_COUPLE_ID}'
    `);
    expect(state.rows[0]).toEqual({
      member_model_version: 1,
      bride_id: LEGACY_ID,
      groom_id: null,
      partner_couple_id: null,
    });

    await expect(db.exec(`
      UPDATE public.couples
      SET member_model_version = 2
      WHERE id = '${LEGACY_COUPLE_ID}'
    `)).rejects.toThrow(/COUPLE_MEMBER_MODEL_VERSION_WRITE_FORBIDDEN/u);
  });

  it("keeps create actor-bound and join service-only", async () => {
    const db = await createDatabase();
    await setPersona(db, "authenticated", OWNER_ID);
    const privileges = await db.query<{
      authenticated_create: boolean;
      authenticated_join: boolean;
      service_create: boolean;
      service_join: boolean;
      anon_create: boolean;
      anon_join: boolean;
    }>(`
      SELECT
        has_function_privilege(
          'authenticated',
          'public.create_neutral_preparation_space_for_current_user()',
          'EXECUTE'
        ) AS authenticated_create,
        has_function_privilege(
          'authenticated',
          'public.join_neutral_preparation_space_server(uuid,text)',
          'EXECUTE'
        ) AS authenticated_join,
        has_function_privilege(
          'service_role',
          'public.create_neutral_preparation_space_for_current_user()',
          'EXECUTE'
        ) AS service_create,
        has_function_privilege(
          'service_role',
          'public.join_neutral_preparation_space_server(uuid,text)',
          'EXECUTE'
        ) AS service_join,
        has_function_privilege(
          'anon',
          'public.create_neutral_preparation_space_for_current_user()',
          'EXECUTE'
        ) AS anon_create,
        has_function_privilege(
          'anon',
          'public.join_neutral_preparation_space_server(uuid,text)',
          'EXECUTE'
        ) AS anon_join
    `);
    expect(privileges.rows[0]).toEqual({
      authenticated_create: true,
      authenticated_join: false,
      service_create: false,
      service_join: true,
      anon_create: false,
      anon_join: false,
    });
  });
});
