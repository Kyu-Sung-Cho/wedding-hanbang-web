// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, describe, expect, it } from "vitest";

const phaseAMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812030000_couple_invite_replay_hardening.sql",
  ),
  "utf8",
);
const phaseBContract = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/release-candidates/amora-couple-invite-20260812/phase-b-legacy-rpc-revoke/20260812031000_revoke_legacy_join_couple.sql",
  ),
  "utf8",
);
const atomicResetMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714164500_expand_atomic_couple_reset.sql",
  ),
  "utf8",
);

const OWNER_A = "00000000-0000-4000-8000-000000000001";
const JOINER_A = "00000000-0000-4000-8000-000000000002";
const ATTACKER = "00000000-0000-4000-8000-000000000003";
const OWNER_B = "00000000-0000-4000-8000-000000000004";
const JOINER_B = "00000000-0000-4000-8000-000000000005";
const RATE_ACTOR = "00000000-0000-4000-8000-000000000006";
const WEAK_OWNER = "00000000-0000-4000-8000-000000000007";
const WEAK_JOINER = "00000000-0000-4000-8000-000000000008";
const COUPLE_A = "10000000-0000-4000-8000-000000000001";
const COUPLE_B = "10000000-0000-4000-8000-000000000002";
const SEALED_COUPLE = "10000000-0000-4000-8000-000000000003";
const OWNERLESS_COUPLE = "10000000-0000-4000-8000-000000000004";
const FULL_UNSEALED_COUPLE = "10000000-0000-4000-8000-000000000005";
const WEAK_CODE_COUPLE = "10000000-0000-4000-8000-000000000006";
const CODE_A = "WH-A1B2C3D4E5F6";
const CODE_B = "WH-B1C2D3E4F5A6";
const LEGACY_WEAK_CODE = "WH-ABC123";

const databases: PGlite[] = [];

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
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
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

    CREATE FUNCTION public.enforce_couple_roster_epoch()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.membership_sealed_at IS NOT NULL THEN
        IF (OLD.bride_id IS NULL AND NEW.bride_id IS NOT NULL)
           OR (OLD.groom_id IS NULL AND NEW.groom_id IS NOT NULL) THEN
          RAISE EXCEPTION 'COUPLE_ROSTER_EPOCH_CLOSED';
        END IF;
      ELSIF NEW.bride_id IS NOT NULL AND NEW.groom_id IS NOT NULL THEN
        NEW.membership_sealed_at := transaction_timestamp();
      END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER trg_enforce_couple_roster_epoch
      BEFORE INSERT OR UPDATE ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.enforce_couple_roster_epoch();

    CREATE FUNCTION public.generate_invite_code()
    RETURNS text LANGUAGE sql SECURITY DEFINER
    AS $$ SELECT 'WH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) $$;

    CREATE FUNCTION public.join_couple(text, text)
    RETURNS jsonb LANGUAGE sql SECURITY DEFINER
    AS $$ SELECT jsonb_build_object('error_code', 'LEGACY_STUB') $$;

    REVOKE ALL ON FUNCTION public.join_couple(text, text) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.join_couple(text, text) TO authenticated;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.couples (
      id, invite_code, bride_id, groom_id, membership_sealed_at, created_at, updated_at
    ) VALUES
      ('${COUPLE_A}', '${CODE_A}', '${OWNER_A}', NULL, NULL, now(), now()),
      ('${COUPLE_B}', '${CODE_B}', NULL, '${OWNER_B}', NULL, now(), now()),
      ('${SEALED_COUPLE}', 'WH-SEALED1', '${OWNER_A}', '${OWNER_B}', now(), now(), now()),
      ('${OWNERLESS_COUPLE}', 'WH-ORPHAN1', NULL, NULL, NULL, now(), now()),
      ('${WEAK_CODE_COUPLE}', '${LEGACY_WEAK_CODE}', '${WEAK_OWNER}', NULL, NULL, now(), now());
    ALTER TABLE public.couples DISABLE TRIGGER trg_enforce_couple_roster_epoch;
    INSERT INTO public.couples (
      id, invite_code, bride_id, groom_id, membership_sealed_at, created_at, updated_at
    ) VALUES (
      '${FULL_UNSEALED_COUPLE}', 'WH-FULL01', '${OWNER_A}', '${OWNER_B}', NULL, now(), now()
    );
    ALTER TABLE public.couples ENABLE TRIGGER trg_enforce_couple_roster_epoch;
    INSERT INTO public.profiles (id, couple_id, role) VALUES
      ('${OWNER_A}', '${COUPLE_A}', 'bride'),
      ('${JOINER_A}', NULL, 'groom'),
      ('${ATTACKER}', NULL, 'groom'),
      ('${OWNER_B}', '${COUPLE_B}', 'groom'),
      ('${JOINER_B}', NULL, 'bride'),
      ('${RATE_ACTOR}', NULL, 'groom'),
      ('${WEAK_OWNER}', '${WEAK_CODE_COUPLE}', 'bride'),
      ('${WEAK_JOINER}', NULL, 'groom');
  `);
  await db.exec(phaseAMigration);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("couple invite replay hardening rollout", () => {
  it("keeps unrelated invalid attempts off the singleton rollout telemetry row", async () => {
    const db = await createDatabase();
    await db.exec(`
      UPDATE public.couple_invite_join_runtime_state
      SET last_server_attempt_at = NULL,
          last_server_success_at = NULL,
          last_legacy_attempt_at = NULL,
          last_legacy_success_at = NULL,
          updated_at = '2000-01-01T00:00:00Z'
      WHERE singleton;
    `);

    await Promise.all([
      db.query(`
        SELECT public.join_couple_server(
          '${JOINER_A}', 'WH-000000000001', 'groom'
        )
      `),
      db.query(`
        SELECT public.join_couple_server(
          '${ATTACKER}', 'WH-000000000002', 'groom'
        )
      `),
      db.query(`
        SELECT public.join_couple_server(
          '${RATE_ACTOR}', 'WH-000000000003', 'groom'
        )
      `),
    ]);

    const telemetry = await db.query<{
      last_server_attempt_at: Date | null;
      last_server_success_at: Date | null;
      last_legacy_attempt_at: Date | null;
      last_legacy_success_at: Date | null;
      updated_at: Date;
    }>(`
      SELECT last_server_attempt_at, last_server_success_at,
             last_legacy_attempt_at, last_legacy_success_at, updated_at
      FROM public.couple_invite_join_runtime_state
      WHERE singleton
    `);

    expect(telemetry.rows[0]).toEqual({
      last_server_attempt_at: null,
      last_server_success_at: null,
      last_legacy_attempt_at: null,
      last_legacy_success_at: null,
      updated_at: new Date("2000-01-01T00:00:00.000Z"),
    });
  });

  it("installs the incumbent-profile then joiner-profile then couple lock order", async () => {
    const db = await createDatabase();
    const installed = await db.query<{ definition: string }>(`
      SELECT pg_get_functiondef(
        'public.join_couple_invite_core(uuid,text,text,text)'::regprocedure
      ) AS definition
    `);
    const definition = installed.rows[0]?.definition ?? "";
    const incumbentProfileLock = definition.indexOf(
      "FROM public.profiles AS incumbent_profile",
    );
    const joinerProfileLock = definition.indexOf(
      "FROM public.profiles AS joining_profile",
      incumbentProfileLock,
    );
    const resetCompatibleAdvisoryLock = definition.indexOf(
      "hashtextextended(v_couple_id::text, 0)",
      joinerProfileLock,
    );
    const lockedCoupleRead = definition.indexOf(
      "FROM public.couples AS locked_couple",
      resetCompatibleAdvisoryLock,
    );
    const lockedCoupleForUpdate = definition.indexOf(
      "FOR UPDATE",
      lockedCoupleRead,
    );
    const lockedExpiryRefresh = definition.indexOf(
      "v_now := clock_timestamp()",
      lockedCoupleForUpdate,
    );

    expect(incumbentProfileLock).toBeGreaterThan(-1);
    expect(joinerProfileLock).toBeGreaterThan(incumbentProfileLock);
    expect(resetCompatibleAdvisoryLock).toBeGreaterThan(joinerProfileLock);
    expect(lockedCoupleRead).toBeGreaterThan(resetCompatibleAdvisoryLock);
    expect(lockedCoupleForUpdate).toBeGreaterThan(lockedCoupleRead);
    expect(lockedExpiryRefresh).toBeGreaterThan(lockedCoupleForUpdate);
    expect(
      definition.slice(incumbentProfileLock, lockedCoupleRead),
    ).toContain("FOR UPDATE");
    expect(definition.slice(lockedCoupleRead, lockedCoupleForUpdate)).not.toMatch(
      /invite_code_expires_at\s*>\s*v_now/,
    );
    expect(definition.slice(lockedCoupleForUpdate)).toMatch(
      /v_locked_couple_found\s*:=\s*FOUND;[\s\S]*v_now\s*:=\s*clock_timestamp\(\);[\s\S]*NOT\s+v_locked_couple_found[\s\S]*v_invite_expires_at\s*<=\s*v_now/,
    );

    const resetProfileLock = atomicResetMigration.indexOf(
      "FROM public.profiles AS profile",
    );
    const resetCompatibleLock = atomicResetMigration.indexOf(
      "hashtextextended(v_couple_id::text, 0)",
      resetProfileLock,
    );
    const resetCoupleLock = atomicResetMigration.indexOf(
      "FROM public.couples AS couple",
      resetCompatibleLock,
    );
    expect(resetProfileLock).toBeGreaterThan(-1);
    expect(resetCompatibleLock).toBeGreaterThan(resetProfileLock);
    expect(resetCoupleLock).toBeGreaterThan(resetCompatibleLock);
  });

  it("expands a service-only RPC while retaining only the legacy authenticated compatibility grant", async () => {
    const db = await createDatabase();
    const privileges = await db.query<{
      service_new: boolean;
      authenticated_new: boolean;
      authenticated_legacy: boolean;
      anon_legacy: boolean;
    }>(`
      SELECT
        has_function_privilege('service_role', 'public.join_couple_server(uuid,text,text)', 'EXECUTE') AS service_new,
        has_function_privilege('authenticated', 'public.join_couple_server(uuid,text,text)', 'EXECUTE') AS authenticated_new,
        has_function_privilege('authenticated', 'public.join_couple(text,text)', 'EXECUTE') AS authenticated_legacy,
        has_function_privilege('anon', 'public.join_couple(text,text)', 'EXECUTE') AS anon_legacy
    `);

    expect(privileges.rows[0]).toEqual({
      service_new: true,
      authenticated_new: false,
      authenticated_legacy: true,
      anon_legacy: false,
    });

    const lifecycle = await db.query<{
      invite_code_issued_at: Date | null;
      invite_code_expires_at: Date | null;
    }>(`
      SELECT invite_code_issued_at, invite_code_expires_at
      FROM public.couples WHERE id = '${COUPLE_A}'
    `);
    expect(lifecycle.rows[0]?.invite_code_issued_at).toBeInstanceOf(Date);
    expect(lifecycle.rows[0]?.invite_code_expires_at).toBeInstanceOf(Date);
    expect(
      lifecycle.rows[0]!.invite_code_expires_at!.getTime()
        - lifecycle.rows[0]!.invite_code_issued_at!.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);

    const invalidHistorical = await db.query<{
      id: string;
      invite_code: string | null;
    }>(`
      SELECT id, invite_code
      FROM public.couples
      WHERE id IN ('${OWNERLESS_COUPLE}', '${FULL_UNSEALED_COUPLE}')
      ORDER BY id
    `);
    expect(invalidHistorical.rows).toEqual([
      { id: OWNERLESS_COUPLE, invite_code: null },
      { id: FULL_UNSEALED_COUPLE, invite_code: null },
    ]);
  });

  it("atomically rotates every still-active legacy short code before extending expiry", async () => {
    const db = await createDatabase();
    const rotated = await db.query<{ invite_code: string }>(`
      SELECT invite_code
      FROM public.couples
      WHERE id = '${WEAK_CODE_COUPLE}'
    `);
    const rotatedCode = rotated.rows[0]?.invite_code;
    expect(rotatedCode).toMatch(/^WH-[A-Z0-9]{12}$/);
    expect(rotatedCode).not.toBe(LEGACY_WEAK_CODE);
    await expect(db.exec(`
      UPDATE public.couples
      SET invite_code = '${LEGACY_WEAK_CODE}'
      WHERE id = '${WEAK_CODE_COUPLE}'
    `)).rejects.toThrow(/couples_invite_lifecycle_valid/);

    const oldCode = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${WEAK_JOINER}', '${LEGACY_WEAK_CODE}', 'groom'
      ) AS result
    `);
    expect(oldCode.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "INVALID_INVITE_CODE",
    });

    const newCode = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${WEAK_JOINER}', '${rotatedCode}', 'groom'
      ) AS result
    `);
    expect(newCode.rows[0]?.result).toMatchObject({
      success: true,
      joined: true,
      actor_user_id: WEAK_JOINER,
      couple_id: WEAK_CODE_COUPLE,
    });
  });

  it("atomically consumes a valid code, binds replay to the same actor, and seals the roster", async () => {
    const db = await createDatabase();
    const joined = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${JOINER_A}', '${CODE_A}', 'groom'
      ) AS result
    `);
    expect(joined.rows[0]?.result).toMatchObject({
      success: true,
      joined: true,
      idempotent: false,
      actor_user_id: JOINER_A,
      couple_id: COUPLE_A,
      role: "groom",
    });

    const state = await db.query<{
      invite_code: string | null;
      invite_code_issued_at: Date | null;
      invite_code_expires_at: Date | null;
      groom_id: string | null;
      membership_sealed_at: Date | null;
    }>(`
      SELECT invite_code, invite_code_issued_at, invite_code_expires_at,
             groom_id, membership_sealed_at
      FROM public.couples WHERE id = '${COUPLE_A}'
    `);
    expect(state.rows[0]).toMatchObject({
      invite_code: null,
      invite_code_issued_at: null,
      invite_code_expires_at: null,
      groom_id: JOINER_A,
    });
    expect(state.rows[0]?.membership_sealed_at).toBeInstanceOf(Date);

    const redemption = await db.query<{
      invite_code_sha256: string;
      redeemed_by: string;
    }>(`
      SELECT invite_code_sha256, redeemed_by
      FROM public.couple_invite_redemptions
      WHERE couple_id = '${COUPLE_A}'
    `);
    expect(redemption.rows[0]?.invite_code_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(redemption.rows[0]?.invite_code_sha256).not.toContain(CODE_A.slice(3));
    expect(redemption.rows[0]?.redeemed_by).toBe(JOINER_A);

    const retry = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${JOINER_A}', '${CODE_A}', 'groom'
      ) AS result
    `);
    expect(retry.rows[0]?.result).toMatchObject({
      success: true,
      joined: false,
      idempotent: true,
      actor_user_id: JOINER_A,
      couple_id: COUPLE_A,
    });

    const retryAttemptCount = await db.query<{ attempt_count: number }>(`
      SELECT attempt_count FROM public.couple_invite_join_attempts
      WHERE actor_user_id = '${JOINER_A}'
    `);
    expect(retryAttemptCount.rows[0]?.attempt_count).toBe(1);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await db.query(`
        SELECT public.join_couple_server(
          '${JOINER_A}', 'WH-${String(attempt).padStart(12, "0")}', 'groom'
        )
      `);
    }
    const retryAfterExhaustion = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${JOINER_A}', '${CODE_A}', 'groom'
      ) AS result
    `);
    expect(retryAfterExhaustion.rows[0]?.result).toMatchObject({
      success: true,
      joined: false,
      idempotent: true,
      actor_user_id: JOINER_A,
    });

    const stolenReplay = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${ATTACKER}', '${CODE_A}', 'groom'
      ) AS result
    `);
    expect(stolenReplay.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "INVALID_INVITE_CODE",
    });
  });

  it("keeps the legacy authenticated wrapper compatible while recording drain evidence", async () => {
    const db = await createDatabase();
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${JOINER_B}', false);
      SET ROLE authenticated;
    `);
    const joined = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple('${CODE_B}', 'bride') AS result
    `);
    await db.exec("RESET ROLE");

    expect(joined.rows[0]?.result).toMatchObject({
      success: true,
      joined: true,
      actor_user_id: JOINER_B,
      couple_id: COUPLE_B,
      role: "bride",
    });
    const telemetry = await db.query<{
      last_legacy_attempt_at: Date | null;
      last_legacy_success_at: Date | null;
      last_server_success_at: Date | null;
    }>(`
      SELECT last_legacy_attempt_at, last_legacy_success_at,
             last_server_success_at
      FROM public.couple_invite_join_runtime_state WHERE singleton
    `);
    expect(telemetry.rows[0]?.last_legacy_attempt_at).toBeInstanceOf(Date);
    expect(telemetry.rows[0]?.last_legacy_success_at).toBeInstanceOf(Date);
    expect(telemetry.rows[0]?.last_server_success_at).toBeNull();
  });

  it("rejects same-role and sealed-roster joins with the same generic response", async () => {
    const db = await createDatabase();
    const sameRole = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${JOINER_B}', '${CODE_A}', 'bride'
      ) AS result
    `);
    expect(sameRole.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "INVALID_INVITE_CODE",
    });

    const sealed = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${JOINER_A}', 'WH-SEALED1', 'groom'
      ) AS result
    `);
    expect(sealed.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "INVALID_INVITE_CODE",
    });
    expect(sameRole.rows[0]?.result).toEqual(sealed.rows[0]?.result);

    const unchanged = await db.query<{ groom_id: string | null }>(`
      SELECT groom_id FROM public.couples WHERE id = '${COUPLE_A}'
    `);
    expect(unchanged.rows[0]?.groom_id).toBeNull();
  });

  it("does not let an already-linked actor use its own state as an active-code oracle", async () => {
    const db = await createDatabase();
    const activeCode = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${OWNER_B}', '${CODE_A}', 'groom'
      ) AS result
    `);
    const unknownCode = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${OWNER_B}', 'WH-FFFFFFFFFFFF', 'groom'
      ) AS result
    `);

    expect(activeCode.rows[0]?.result).toEqual(unknownCode.rows[0]?.result);
    expect(activeCode.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "ALREADY_LINKED",
    });
  });

  it("does not disclose an active code when historical owner integrity is corrupt", async () => {
    const db = await createDatabase();
    await db.exec(`
      UPDATE public.profiles SET couple_id = NULL WHERE id = '${OWNER_A}'
    `);
    const corruptOwner = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${ATTACKER}', '${CODE_A}', 'groom'
      ) AS result
    `);
    const unknownCode = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${ATTACKER}', 'WH-EEEEEEEEEEEE', 'groom'
      ) AS result
    `);

    expect(corruptOwner.rows[0]?.result).toEqual(unknownCode.rows[0]?.result);
    expect(corruptOwner.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "INVALID_INVITE_CODE",
    });
  });

  it("enforces the ten-attempt window atomically inside the database", async () => {
    const db = await createDatabase();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const result = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.join_couple_server(
          '${RATE_ACTOR}', 'WH-${String(attempt).padStart(12, "0")}', 'groom'
        ) AS result
      `);
      expect(result.rows[0]?.result).toMatchObject({
        success: false,
        error_code: "INVALID_INVITE_CODE",
      });
    }

    const limited = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${RATE_ACTOR}', 'WH-000000000011', 'groom'
      ) AS result
    `);
    expect(limited.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "RATE_LIMITED",
    });
    expect(Number(limited.rows[0]?.result.retry_after_seconds)).toBeGreaterThan(0);

    const attempts = await db.query<{ attempt_count: number }>(`
      SELECT attempt_count FROM public.couple_invite_join_attempts
      WHERE actor_user_id = '${RATE_ACTOR}'
    `);
    expect(attempts.rows[0]?.attempt_count).toBe(11);
  });

  it("rotates expiry with the code and refuses an expired code", async () => {
    const db = await createDatabase();
    const before = await db.query<{ invite_code_expires_at: Date }>(`
      SELECT invite_code_expires_at FROM public.couples WHERE id = '${COUPLE_B}'
    `);
    await db.exec(`
      UPDATE public.couples SET invite_code = 'WH-C1D2E3F4A5B6' WHERE id = '${COUPLE_B}';
    `);
    const rotated = await db.query<{
      invite_code: string;
      invite_code_issued_at: Date;
      invite_code_expires_at: Date;
    }>(`
      SELECT invite_code, invite_code_issued_at, invite_code_expires_at
      FROM public.couples WHERE id = '${COUPLE_B}'
    `);
    expect(rotated.rows[0]?.invite_code).toBe("WH-C1D2E3F4A5B6");
    expect(rotated.rows[0]?.invite_code_expires_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0]!.invite_code_expires_at.getTime(),
    );

    await db.exec(`
      ALTER TABLE public.couples DISABLE TRIGGER trg_manage_couple_invite_lifecycle;
      UPDATE public.couples
      SET invite_code_issued_at = now() - interval '8 days',
          invite_code_expires_at = now() - interval '1 second'
      WHERE id = '${COUPLE_B}';
      ALTER TABLE public.couples ENABLE TRIGGER trg_manage_couple_invite_lifecycle;
    `);
    const expired = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.join_couple_server(
        '${JOINER_B}', 'WH-C1D2E3F4A5B6', 'bride'
      ) AS result
    `);
    expect(expired.rows[0]?.result).toMatchObject({
      success: false,
      error_code: "INVALID_INVITE_CODE",
    });
  });

  it("keeps Phase B inert until the expand/canary/drain evidence is durable", async () => {
    const db = await createDatabase();
    await expect(db.exec(phaseBContract)).rejects.toThrow(
      /COUPLE_INVITE_LEGACY_REVOKE_CANARY_NOT_DRAINED/,
    );
    await db.exec("ROLLBACK");

    await db.query(`
      SELECT public.join_couple_server('${JOINER_A}', '${CODE_A}', 'groom')
    `);
    await db.exec(`
      UPDATE public.couple_invite_join_runtime_state
      SET expanded_at = now() - interval '25 hours',
          last_legacy_attempt_at = now() - interval '25 hours'
      WHERE singleton;
    `);
    await expect(db.exec(phaseBContract)).rejects.toThrow(
      /COUPLE_INVITE_LEGACY_REVOKE_CANARY_NOT_DRAINED/,
    );
    await db.exec("ROLLBACK");
    await db.exec(`
      UPDATE public.couple_invite_join_runtime_state
      SET external_legacy_drain_started_at = now() - interval '25 hours',
          external_legacy_drain_verified_at = now(),
          external_legacy_drain_evidence = 'postgrest-log-query:test;fleet:test-sha'
      WHERE singleton;
    `);
    await db.exec(phaseBContract);

    const privileges = await db.query<{
      authenticated_legacy: boolean;
      service_new: boolean;
    }>(`
      SELECT
        has_function_privilege('authenticated', 'public.join_couple(text,text)', 'EXECUTE') AS authenticated_legacy,
        has_function_privilege('service_role', 'public.join_couple_server(uuid,text,text)', 'EXECUTE') AS service_new
    `);
    expect(privileges.rows[0]).toEqual({
      authenticated_legacy: false,
      service_new: true,
    });
  });
});
