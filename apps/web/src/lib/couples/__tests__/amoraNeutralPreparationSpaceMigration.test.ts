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
const nullableInviteMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260818110000_restore_couple_invite_nullable_contract.sql",
);
const nullableInviteMigration = readFileSync(nullableInviteMigrationPath, "utf8");
const legacySpaceReportMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260820120000_neutral_join_reports_legacy_space.sql",
  ),
  "utf8",
);
const legacyJoinGuardMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260820130000_legacy_join_blocks_neutral_space.sql",
  ),
  "utf8",
);

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
      invite_code text NOT NULL UNIQUE,
      bride_id uuid,
      groom_id uuid,
      membership_sealed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT couples_invite_lifecycle_valid CHECK (
        invite_code IS NULL OR invite_code ~ '^WH-[A-Z0-9]{12}$'
      )
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

    CREATE FUNCTION public.test_manage_couple_invite_lifecycle() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER trg_manage_couple_invite_lifecycle
      BEFORE INSERT OR UPDATE OF invite_code ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.test_manage_couple_invite_lifecycle();

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

    CREATE FUNCTION public.join_couple_invite_core(
      p_actor_user_id uuid, p_invite_code text, p_role text, p_call_path text
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

    CREATE FUNCTION public.join_couple_server(
      p_actor_user_id uuid, p_invite_code text, p_role text
    ) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT public.join_couple_invite_core(
        p_actor_user_id, p_invite_code, p_role, 'server'
      )
    $$;

    REVOKE ALL ON FUNCTION public.create_couple_for_current_user(text)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.create_couple_for_current_user(text) TO authenticated;
    REVOKE ALL ON FUNCTION public.join_couple_invite_core(uuid,text,text,text)
      FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON FUNCTION public.join_couple_server(uuid,text,text)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.join_couple_server(uuid,text,text) TO service_role;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.profiles(id) VALUES
      ('${OWNER_ID}'), ('${PARTNER_ID}');
    INSERT INTO public.couples(id, invite_code, bride_id)
    VALUES ('${LEGACY_COUPLE_ID}', 'WH-LEGACY000001', '${LEGACY_ID}');
    INSERT INTO public.profiles(id, couple_id, role)
    VALUES ('${LEGACY_ID}', '${LEGACY_COUPLE_ID}', 'bride');
  `);
  if (migration) await db.exec(migration);
  await db.exec(nullableInviteMigration);
  await db.exec(legacySpaceReportMigration);
  await db.exec(legacyJoinGuardMigration);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("neutral preparation-space migration", () => {
  it("구버전 앱이 역할을 골라 중립 공간에 합류하지 못한다", async () => {
    // 웹 플래그를 먼저 켜고 앱 배포가 늦으면, 구버전 앱 사용자가 v2 커플에
    // 'bride'/'groom'을 박은 채 들어온다. 그 사고 구간을 DB에서 닫는다.
    const db = await createDatabase();

    await setPersona(db, "authenticated", OWNER_ID);
    const created = await db.query<{ result: { invite_code: string } }>(`
      SELECT public.create_neutral_preparation_space_for_current_user() AS result
    `);
    const neutralCode = created.rows[0]?.result.invite_code;
    expect(neutralCode).toMatch(/^WH-[A-Z0-9]{12}$/u);

    // 구버전 앱 경로 두 개 모두 막혀야 한다
    await setPersona(db, "service_role");
    const viaServer = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${PARTNER_ID}'::uuid, '${neutralCode}', 'groom'
      ) AS result
    `);
    expect(viaServer.rows[0]?.result).toMatchObject({
      success: false,
      joined: false,
      error_code: "NEUTRAL_PREPARATION_SPACE",
    });

    await setPersona(db, "authenticated", PARTNER_ID);
    const viaLegacy = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple('${neutralCode}', 'groom') AS result
    `);
    expect(viaLegacy.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "NEUTRAL_PREPARATION_SPACE",
    });

    // 아무것도 바뀌지 않았는지 확인한다 — 막혔다는 응답만으로는 부족하다
    await setPersona(db, "service_role");
    const state = await db.query<{ groom_id: string | null; partner_couple_id: string | null }>(`
      SELECT couple.groom_id, partner.couple_id AS partner_couple_id
      FROM public.couples AS couple
      JOIN public.profiles AS partner ON partner.id = '${PARTNER_ID}'
      WHERE couple.invite_code = '${neutralCode}'
    `);
    expect(state.rows[0]).toEqual({ groom_id: null, partner_couple_id: null });
  });

  it("기존(v1) 커플의 역할 합류는 그대로 동작한다", async () => {
    // 가드가 과해서 기존 경로까지 막으면 그건 회귀다
    const db = await createDatabase();
    await setPersona(db, "service_role");
    const result = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${PARTNER_ID}'::uuid, 'WH-LEGACY000001', 'groom'
      ) AS result
    `);
    expect(result.rows[0]?.result).toMatchObject({ success: true, joined: true });
  });

  it("기존(v1) 초대 코드는 '틀린 코드'가 아니라 '기존 방식'으로 구분해 알려준다", async () => {
    // 이 구분이 없으면 플래그를 켜는 순간, 이미 발급된 v1 코드가 전부
    // "초대 코드가 올바르지 않습니다"가 되어 기존 사용자가 영원히 연결 못 한다.
    const db = await createDatabase();
    await setPersona(db, "service_role");

    const legacy = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_neutral_preparation_space_server(
        '${PARTNER_ID}'::uuid, 'WH-LEGACY000001'
      ) AS result
    `);
    expect(legacy.rows[0]?.result).toMatchObject({
      success: false,
      joined: false,
      error_code: "LEGACY_PREPARATION_SPACE",
    });

    // 진짜로 없는 코드는 여전히 INVALID_INVITE_CODE 여야 한다
    const missing = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_neutral_preparation_space_server(
        '${PARTNER_ID}'::uuid, 'WH-NOSUCHCODE1'
      ) AS result
    `);
    expect(missing.rows[0]?.result).toMatchObject({
      error_code: "INVALID_INVITE_CODE",
    });
  });

  it("restores the nullable invite contract required by one-time redemption", async () => {
    const db = await createDatabase();
    const column = await db.query<{ attnotnull: boolean }>(`
      SELECT attnotnull
      FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.couples'::regclass
        AND attname = 'invite_code'
        AND attnum > 0
        AND NOT attisdropped
    `);

    expect(column.rows).toEqual([{ attnotnull: false }]);
    expect(nullableInviteMigration).toMatch(
      /ALTER\s+TABLE\s+public\.couples\s+ALTER\s+COLUMN\s+invite_code\s+DROP\s+NOT\s+NULL/iu,
    );
    expect(nullableInviteMigration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.couples/iu,
    );
  });

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
        '${PARTNER_ID}', 'WH-LEGACY000001'
      ) AS result
    `);
    // 합류가 막힌다는 계약은 그대로다. 다만 "틀린 코드"가 아니라 "기존 방식
    // 공간"으로 구분해 알려준다(20260820120000) — 사용자가 할 일이 다르다.
    expect(joinAttempt.rows[0]?.result).toMatchObject({
      success: false,
      joined: false,
      error_code: "LEGACY_PREPARATION_SPACE",
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
