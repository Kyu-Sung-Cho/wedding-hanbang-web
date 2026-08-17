// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804170000_notification_session_ownership.sql",
  ),
  "utf8",
);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SESSION_A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SESSION_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const SESSION_B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const INSTALLATION_A = "10000000-0000-4000-8000-000000000001";
const INSTALLATION_B = "10000000-0000-4000-8000-000000000002";
const PUSH_TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]";
const PUSH_TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;
    CREATE FUNCTION auth.jwt()
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'sub', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        'role', NULLIF(current_setting('request.jwt.claim.role', true), ''),
        'session_id', NULLIF(current_setting('request.jwt.claim.session_id', true), ''),
        'exp', NULLIF(current_setting('request.jwt.claim.exp', true), '')::bigint
      )
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO PUBLIC;

    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE auth.sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
    );
    INSERT INTO auth.users(id) VALUES ('${USER_A}'), ('${USER_B}');
    INSERT INTO auth.sessions(id, user_id) VALUES
      ('${SESSION_A1}', '${USER_A}'),
      ('${SESSION_A2}', '${USER_A}'),
      ('${SESSION_B1}', '${USER_B}');

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      push_token text,
      CONSTRAINT profiles_push_token_shape_check CHECK (
        push_token IS NULL
        OR (
          octet_length(push_token) BETWEEN 16 AND 512
          AND push_token !~ '[[:space:][:cntrl:]]'
        )
      )
    );
    CREATE UNIQUE INDEX profiles_push_token_unique_idx
      ON public.profiles(push_token) WHERE push_token IS NOT NULL;
    INSERT INTO public.profiles(id, push_token)
    VALUES ('${USER_A}', '${PUSH_TOKEN_A}'), ('${USER_B}', NULL);
  `);
  await db.exec(migration);
  return db;
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.session_id', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.exp', '', false)");
}

async function setPersona(
  db: PGlite,
  userId: string,
  sessionId: string,
  expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600,
) {
  await resetPersona(db);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
  );
  await db.query("SELECT set_config('request.jwt.claim.session_id', $1, false)", [
    sessionId,
  ]);
  await db.query("SELECT set_config('request.jwt.claim.exp', $1, false)", [
    String(expiresAtSeconds),
  ]);
  await db.exec("SET ROLE authenticated;");
}

async function bind(
  db: PGlite,
  installationId: string,
  token: string,
  platform = "ios",
) {
  return db.query(
    "SELECT public.bind_mobile_push_token($1::uuid, $2, $3)",
    [installationId, token, platform],
  );
}

async function bindLegacy(db: PGlite, token: string) {
  return db.query("SELECT public.bind_mobile_push_token($1)", [token]);
}

async function release(db: PGlite, installationId: string, token: string) {
  return db.query(
    "SELECT public.release_mobile_push_token($1::uuid, $2)",
    [installationId, token],
  );
}

describe("mobile push notification session ownership migration", () => {
  it("wraps SET LOCAL, table locking, and the full ownership upgrade in one explicit transaction", () => {
    const normalizedMigration = migration.replace(/\r\n/gu, "\n").trim();
    const beginIndex = normalizedMigration.indexOf("\nBEGIN;\n");
    const lockTimeoutIndex = normalizedMigration.indexOf(
      "SET LOCAL lock_timeout = '5s';",
    );
    const tableLockIndex = normalizedMigration.indexOf(
      "LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;",
    );
    const contractIndex = normalizedMigration.lastIndexOf(
      "$notification_session_ownership_contract$;",
    );
    const commitIndex = normalizedMigration.lastIndexOf("\nCOMMIT;");

    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(lockTimeoutIndex).toBeGreaterThan(beginIndex);
    expect(tableLockIndex).toBeGreaterThan(lockTimeoutIndex);
    expect(contractIndex).toBeGreaterThan(tableLockIndex);
    expect(commitIndex).toBeGreaterThan(contractIndex);
    expect(normalizedMigration.slice(commitIndex)).toBe("\nCOMMIT;");
  });

  it("atomically upgrades one same-session legacy binding to one durable delivery target", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bindLegacy(db, PUSH_TOKEN_A);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");
      await resetPersona(db);

      const bindings = await db.query<{
        installation_id: string;
        push_token: string | null;
        platform: string;
        binding_epoch: number;
        revoked_at: Date | null;
        revoke_reason: string | null;
      }>(`
        SELECT installation_id, push_token, platform, binding_epoch,
               revoked_at, revoke_reason
          FROM public.mobile_push_device_tokens
         ORDER BY installation_id
      `);
      expect(bindings.rows).toEqual([
        {
          installation_id: INSTALLATION_A,
          push_token: PUSH_TOKEN_A,
          platform: "ios",
          binding_epoch: 2,
          revoked_at: null,
          revoke_reason: null,
        },
        {
          installation_id: SESSION_A1,
          push_token: null,
          platform: "legacy",
          binding_epoch: 1,
          revoked_at: expect.any(Date),
          revoke_reason: "legacy_installation_upgraded",
        },
      ]);

      await db.exec("SET ROLE service_role;");
      const targets = await db.query<{
        installation_id: string;
        push_token: string;
        platform: string;
        binding_epoch: number;
      }>(
        "SELECT * FROM public.get_mobile_push_delivery_targets($1::uuid)",
        [USER_A],
      );
      expect(targets.rows).toEqual([{
        installation_id: INSTALLATION_A,
        push_token: PUSH_TOKEN_A,
        platform: "ios",
        binding_epoch: 2,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("restores the legacy binding when the surrounding upgrade transaction rolls back", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bindLegacy(db, PUSH_TOKEN_A);

      await db.exec("BEGIN;");
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");
      await db.exec("ROLLBACK;");
      await resetPersona(db);

      const bindings = await db.query<{
        installation_id: string;
        push_token: string | null;
        platform: string;
        binding_epoch: number;
        revoked_at: Date | null;
        revoke_reason: string | null;
      }>(`
        SELECT installation_id, push_token, platform, binding_epoch,
               revoked_at, revoke_reason
          FROM public.mobile_push_device_tokens
         ORDER BY installation_id
      `);
      expect(bindings.rows).toEqual([{
        installation_id: SESSION_A1,
        push_token: PUSH_TOKEN_A,
        platform: "legacy",
        binding_epoch: 1,
        revoked_at: null,
        revoke_reason: null,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("serializes competing legacy upgrades so exactly one durable installation wins", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bindLegacy(db, PUSH_TOKEN_A);

      const competing = await Promise.allSettled([
        bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios"),
        bind(db, INSTALLATION_B, PUSH_TOKEN_A, "android"),
      ]);
      expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = competing.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({ status: "rejected" });
      if (rejected?.status === "rejected") {
        expect(String(rejected.reason)).toMatch(/PUSH_TOKEN_ALREADY_BOUND/u);
      }

      await resetPersona(db);
      const state = await db.query<{
        installation_id: string;
        platform: string;
        binding_epoch: number;
        push_token: string | null;
        revoke_reason: string | null;
      }>(`
        SELECT installation_id, platform, binding_epoch, push_token, revoke_reason
          FROM public.mobile_push_device_tokens
         ORDER BY installation_id
      `);
      const active = state.rows.filter((row) => row.push_token === PUSH_TOKEN_A);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ binding_epoch: 2, revoke_reason: null });
      expect([INSTALLATION_A, INSTALLATION_B]).toContain(active[0]?.installation_id);
      expect(state.rows).toContainEqual(expect.objectContaining({
        installation_id: SESSION_A1,
        platform: "legacy",
        push_token: null,
        revoke_reason: "legacy_installation_upgraded",
      }));
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects an active installation takeover from another session of the same user", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");

      await setPersona(db, USER_A, SESSION_A2);
      await expect(
        bind(db, INSTALLATION_A, PUSH_TOKEN_B, "android"),
      ).rejects.toThrow(/PUSH_INSTALLATION_ALREADY_BOUND/u);
      await resetPersona(db);

      const binding = await db.query<{
        user_id: string;
        session_id: string;
        push_token: string;
        platform: string;
        binding_epoch: number;
      }>(`
        SELECT user_id, session_id, push_token, platform, binding_epoch
          FROM public.mobile_push_device_tokens
         WHERE installation_id = '${INSTALLATION_A}'
           AND revoked_at IS NULL
      `);
      expect(binding.rows).toEqual([{
        user_id: USER_A,
        session_id: SESSION_A1,
        push_token: PUSH_TOKEN_A,
        platform: "ios",
        binding_epoch: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it.each([
    ["another user", USER_B, SESSION_B1],
    ["another session", USER_A, SESSION_A2],
  ])("rejects legacy upgrade by %s", async (_label, claimantId, sessionId) => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bindLegacy(db, PUSH_TOKEN_A);

      await setPersona(db, claimantId, sessionId);
      await expect(
        bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios"),
      ).rejects.toThrow(/PUSH_TOKEN_ALREADY_BOUND/u);
      await resetPersona(db);

      const bindings = await db.query<{
        installation_id: string;
        user_id: string;
        session_id: string;
        push_token: string | null;
        platform: string;
        binding_epoch: number;
        revoked_at: Date | null;
      }>(`
        SELECT installation_id, user_id, session_id, push_token, platform,
               binding_epoch, revoked_at
          FROM public.mobile_push_device_tokens
         ORDER BY installation_id
      `);
      expect(bindings.rows).toEqual([{
        installation_id: SESSION_A1,
        user_id: USER_A,
        session_id: SESSION_A1,
        push_token: PUSH_TOKEN_A,
        platform: "legacy",
        binding_epoch: 1,
        revoked_at: null,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("never treats a non-legacy active binding as upgradeable", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");
      await expect(
        bind(db, INSTALLATION_B, PUSH_TOKEN_A, "android"),
      ).rejects.toThrow(/PUSH_TOKEN_ALREADY_BOUND/u);
      await resetPersona(db);

      const active = await db.query<{
        installation_id: string;
        platform: string;
        binding_epoch: number;
      }>(`
        SELECT installation_id, platform, binding_epoch
          FROM public.mobile_push_device_tokens
         WHERE revoked_at IS NULL
      `);
      expect(active.rows).toEqual([{
        installation_id: INSTALLATION_A,
        platform: "ios",
        binding_epoch: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("replaces rather than adds a device when upgrading at the active-device cap", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bindLegacy(db, PUSH_TOKEN_A);
      for (let index = 1; index <= 7; index += 1) {
        await bind(
          db,
          `31000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          `ExpoPushToken[${String(index).padStart(16, "c")}]`,
        );
      }

      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");
      await resetPersona(db);
      const state = await db.query<{
        active_count: number;
        active_legacy_count: number;
        upgraded_epoch: number;
        legacy_reason: string | null;
      }>(`
        SELECT
          count(*) FILTER (WHERE revoked_at IS NULL)::integer AS active_count,
          count(*) FILTER (
            WHERE revoked_at IS NULL AND platform = 'legacy'
          )::integer AS active_legacy_count,
          max(binding_epoch) FILTER (
            WHERE installation_id = '${INSTALLATION_A}'
          )::integer AS upgraded_epoch,
          max(revoke_reason) FILTER (
            WHERE installation_id = '${SESSION_A1}'
          ) AS legacy_reason
        FROM public.mobile_push_device_tokens
      `);
      expect(state.rows).toEqual([{
        active_count: 8,
        active_legacy_count: 0,
        upgraded_epoch: 2,
        legacy_reason: "legacy_installation_upgraded",
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps two devices independent and makes a late logout compare-and-revoke safe", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");

      await setPersona(db, USER_A, SESSION_A2);
      await bind(db, INSTALLATION_B, PUSH_TOKEN_B, "android");

      await setPersona(db, USER_A, SESSION_A1);
      await release(db, INSTALLATION_A, PUSH_TOKEN_A);
      await resetPersona(db);
      const afterDeviceALogout = await db.query<{
        installation_id: string;
        push_token: string | null;
        revoked_at: Date | null;
      }>(`
        SELECT installation_id, push_token, revoked_at
          FROM public.mobile_push_device_tokens
         ORDER BY installation_id
      `);
      expect(afterDeviceALogout.rows).toHaveLength(2);
      expect(afterDeviceALogout.rows[0]?.push_token).toBeNull();
      expect(afterDeviceALogout.rows[0]?.revoked_at).not.toBeNull();
      expect(afterDeviceALogout.rows[1]).toMatchObject({
        installation_id: INSTALLATION_B,
        push_token: PUSH_TOKEN_B,
        revoked_at: null,
      });

      // The same installation is handed to a new account/session. A delayed
      // release from the old session must not revoke the new binding.
      await setPersona(db, USER_B, SESSION_B1);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A, "ios");
      await setPersona(db, USER_A, SESSION_A1);
      await release(db, INSTALLATION_A, PUSH_TOKEN_A);
      await resetPersona(db);
      const transferred = await db.query<{
        user_id: string;
        session_id: string;
        push_token: string | null;
        binding_epoch: number;
        revoked_at: Date | null;
      }>(`
        SELECT user_id, session_id, push_token, binding_epoch, revoked_at
          FROM public.mobile_push_device_tokens
         WHERE installation_id = '${INSTALLATION_A}'
      `);
      expect(transferred.rows).toEqual([
        {
          user_id: USER_B,
          session_id: SESSION_B1,
          push_token: PUSH_TOKEN_A,
          binding_epoch: 2,
          revoked_at: null,
        },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("never returns expired or deleted Auth sessions to the delivery worker", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A);
      await setPersona(db, USER_A, SESSION_A2, Math.floor(Date.now() / 1000) - 5);
      await expect(bind(db, INSTALLATION_B, PUSH_TOKEN_B)).rejects.toThrow(
        /PUSH_SESSION_EXPIRED/u,
      );

      await resetPersona(db);
      await db.exec("SET ROLE service_role;");
      const active = await db.query<{ push_token: string }>(
        "SELECT push_token FROM public.get_mobile_push_delivery_targets($1::uuid)",
        [USER_A],
      );
      expect(active.rows).toEqual([{ push_token: PUSH_TOKEN_A }]);

      // Access JWT expiry is not Auth session expiry. Backgrounded apps stop
      // refreshing access JWTs, but a still-live auth.sessions row must remain
      // eligible for push delivery.
      await resetPersona(db);
      await db.query(`
        UPDATE public.mobile_push_device_tokens
           SET last_access_token_expires_at = clock_timestamp() - interval '1 hour'
         WHERE installation_id = '${INSTALLATION_A}'
      `);
      await db.exec("SET ROLE service_role;");
      const afterAccessJwtExpiry = await db.query<{ push_token: string }>(
        "SELECT push_token FROM public.get_mobile_push_delivery_targets($1::uuid)",
        [USER_A],
      );
      expect(afterAccessJwtExpiry.rows).toEqual([{ push_token: PUSH_TOKEN_A }]);

      await resetPersona(db);
      await db.query("DELETE FROM auth.sessions WHERE id = $1", [SESSION_A1]);
      await db.exec("SET ROLE service_role;");
      const afterSessionDeletion = await db.query(
        "SELECT * FROM public.get_mobile_push_delivery_targets($1::uuid)",
        [USER_A],
      );
      expect(afterSessionDeletion.rows).toEqual([]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("does not report a server release when the current session still owns another binding", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A);

      await expect(
        release(db, INSTALLATION_A, PUSH_TOKEN_B),
      ).rejects.toThrow(/PUSH_BINDING_MISMATCH/u);
      await expect(db.query(
        "SELECT public.release_mobile_push_token($1)",
        [PUSH_TOKEN_B],
      )).rejects.toThrow(/PUSH_BINDING_MISMATCH/u);
      await resetPersona(db);
      const active = await db.query<{ push_token: string; revoked_at: Date | null }>(`
        SELECT push_token, revoked_at
          FROM public.mobile_push_device_tokens
         WHERE installation_id = '${INSTALLATION_A}'
      `);
      expect(active.rows).toEqual([{
        push_token: PUSH_TOKEN_A,
        revoked_at: null,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects active token theft, then transfers it after the former owner releases", async () => {
    const db = await createDatabase();
    try {
      const legacy = await db.query<{ push_token: string | null }>(`
        SELECT push_token FROM public.profiles WHERE id = '${USER_A}'
      `);
      expect(legacy.rows).toEqual([{ push_token: null }]);
      await expect(db.query(
        "UPDATE public.profiles SET push_token = $1 WHERE id = $2::uuid",
        [PUSH_TOKEN_A, USER_A],
      )).rejects.toThrow(/profiles_push_token_retired_check/u);

      await setPersona(db, USER_A, SESSION_A1);
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A);
      await setPersona(db, USER_B, SESSION_B1);
      await expect(
        bind(db, INSTALLATION_B, PUSH_TOKEN_A, "android"),
      ).rejects.toThrow(/PUSH_TOKEN_ALREADY_BOUND/u);

      await setPersona(db, USER_A, SESSION_A1);
      await release(db, INSTALLATION_A, PUSH_TOKEN_A);
      await setPersona(db, USER_B, SESSION_B1);
      await bind(db, INSTALLATION_B, PUSH_TOKEN_A, "android");
      await resetPersona(db);

      const rows = await db.query<{
        installation_id: string;
        user_id: string;
        push_token: string | null;
        revoked_at: Date | null;
      }>(`
        SELECT installation_id, user_id, push_token, revoked_at
          FROM public.mobile_push_device_tokens
         ORDER BY installation_id
      `);
      expect(rows.rows[0]).toMatchObject({
        installation_id: INSTALLATION_A,
        user_id: USER_A,
        push_token: null,
      });
      expect(rows.rows[0]?.revoked_at).not.toBeNull();
      expect(rows.rows[1]).toMatchObject({
        installation_id: INSTALLATION_B,
        user_id: USER_B,
        push_token: PUSH_TOKEN_A,
        revoked_at: null,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("caps active installations per account without blocking an idempotent refresh", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      for (let index = 1; index <= 8; index += 1) {
        await bind(
          db,
          `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          `ExpoPushToken[${String(index).padStart(16, "a")}]`,
        );
      }
      // Refreshing an existing binding is not a new device and keeps its epoch.
      await bind(
        db,
        "30000000-0000-4000-8000-000000000001",
        "ExpoPushToken[aaaaaaaaaaaaaaa1]",
      );
      await expect(bind(
        db,
        "30000000-0000-4000-8000-000000000009",
        "ExpoPushToken[aaaaaaaaaaaaaaa9]",
      )).rejects.toThrow(/PUSH_ACTIVE_DEVICE_LIMIT/u);

      await resetPersona(db);
      const state = await db.query<{ count: number; max_epoch: number }>(`
        SELECT count(*)::integer AS count,
          max(binding_epoch)::integer AS max_epoch
          FROM public.mobile_push_device_tokens
         WHERE user_id = '${USER_A}' AND revoked_at IS NULL
      `);
      expect(state.rows).toEqual([{ count: 8, max_epoch: 1 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("retains safe legacy RPC wrappers scoped to the JWT session", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await db.query("SELECT public.bind_mobile_push_token($1)", [PUSH_TOKEN_A]);
      await setPersona(db, USER_A, SESSION_A2);
      await db.query("SELECT public.bind_mobile_push_token($1)", [PUSH_TOKEN_B]);
      await setPersona(db, USER_A, SESSION_A1);
      await db.query("SELECT public.release_mobile_push_token()");
      await resetPersona(db);

      const active = await db.query<{ session_id: string; push_token: string }>(`
        SELECT session_id, push_token
          FROM public.mobile_push_device_tokens
         WHERE revoked_at IS NULL
      `);
      expect(active.rows).toEqual([
        { session_id: SESSION_A2, push_token: PUSH_TOKEN_B },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects malformed context and cascades account erasure", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await expect(bind(db, INSTALLATION_A, " token with spaces ")).rejects.toThrow(
        /PUSH_TOKEN_INVALID/u,
      );
      await expect(bind(db, INSTALLATION_A, PUSH_TOKEN_A, "desktop")).rejects.toThrow(
        /PUSH_PLATFORM_INVALID/u,
      );
      await bind(db, INSTALLATION_A, PUSH_TOKEN_A);

      await resetPersona(db);
      await db.query("DELETE FROM auth.users WHERE id = $1", [USER_A]);
      const erased = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
          FROM public.mobile_push_device_tokens
         WHERE user_id = '${USER_A}'
      `);
      expect(erased.rows).toEqual([{ count: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps client table access closed and exact function ACLs", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, USER_A, SESSION_A1);
      await expect(db.query(
        "SELECT * FROM public.mobile_push_device_tokens",
      )).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      const contracts = await db.query<{
        signature: string;
        authenticated_execute: boolean;
        anon_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT oid::regprocedure::text AS signature,
          has_function_privilege('authenticated', oid, 'EXECUTE')
            AS authenticated_execute,
          has_function_privilege('anon', oid, 'EXECUTE') AS anon_execute,
          has_function_privilege('service_role', oid, 'EXECUTE') AS service_execute
        FROM pg_proc
        WHERE oid IN (
          'public.bind_mobile_push_token(uuid,text,text)'::regprocedure,
          'public.release_mobile_push_token(uuid,text)'::regprocedure,
          'public.bind_mobile_push_token(text)'::regprocedure,
          'public.release_mobile_push_token()'::regprocedure,
          'public.get_mobile_push_delivery_targets(uuid)'::regprocedure
        )
        ORDER BY oid::regprocedure::text
      `);
      expect(contracts.rows).toHaveLength(5);
      const delivery = contracts.rows.find((row) =>
        row.signature.includes("get_mobile_push_delivery_targets")
      );
      expect(delivery).toMatchObject({
        authenticated_execute: false,
        anon_execute: false,
        service_execute: true,
      });
      for (const contract of contracts.rows.filter((row) => row !== delivery)) {
        expect(contract).toMatchObject({
          authenticated_execute: true,
          anon_execute: false,
          service_execute: false,
        });
      }
      expect(migration).toMatch(/auth\.sessions[\s\S]*FOR SHARE/u);
      expect(migration).toMatch(/pg_advisory_xact_lock/u);
      expect(migration).not.toMatch(/p_user_id\s+uuid[\s\S]*bind_mobile/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
