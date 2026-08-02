// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802130000_mobile_push_identity_consent.sql",
  ),
  "utf8",
);
const readProjectionMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802155100_mobile_push_preference_read_projection.sql",
  ),
  "utf8",
);
const actorBoundMutationMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802155200_bind_mobile_push_mutations_to_expected_actor.sql",
  ),
  "utf8",
);

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const TOKEN = "ExponentPushToken[same_device_token_123]";

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

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      push_token text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX profiles_push_token_unique_idx
      ON public.profiles (push_token) WHERE push_token IS NOT NULL;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT TO authenticated USING (id = auth.uid());
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

    GRANT SELECT ON public.profiles TO authenticated;
    GRANT UPDATE (push_token) ON public.profiles TO authenticated;
    GRANT ALL ON public.profiles TO service_role;

    INSERT INTO public.profiles (id, push_token) VALUES
      ('${USER_A}', '${TOKEN}'),
      ('${USER_B}', NULL);
  `);
  return db;
}

async function setActor(db: PGlite, userId: string) {
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetActor(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("mobile push identity and consent migration", () => {
  it("clears inferred legacy consent and makes direct token writes impossible", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      const legacy = await db.query<{
        push_token: string | null;
        enabled: boolean;
        consented_at: string | null;
      }>(`
        SELECT push_token,
               push_notifications_enabled AS enabled,
               push_notifications_consented_at::text AS consented_at
        FROM public.profiles WHERE id = '${USER_A}'
      `);
      expect(legacy.rows[0]).toEqual({
        push_token: null,
        enabled: false,
        consented_at: null,
      });

      await setActor(db, USER_A);
      await expect(db.exec(`
        UPDATE public.profiles SET push_token = '${TOKEN}' WHERE id = '${USER_A}'
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("requires consent, atomically transfers one device token, and detaches on opt-out", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setActor(db, USER_A);
      await expect(
        db.query("SELECT public.attach_my_mobile_push_token($1)", [TOKEN]),
      ).rejects.toThrow(/push_consent_required/i);
      await db.query(
        "SELECT public.set_my_mobile_push_preferences(true, true, true)",
      );
      await db.query("SELECT public.attach_my_mobile_push_token($1)", [TOKEN]);

      await resetActor(db);
      await setActor(db, USER_B);
      await db.query(
        "SELECT public.set_my_mobile_push_preferences(true, false, true)",
      );
      await db.query("SELECT public.attach_my_mobile_push_token($1)", [TOKEN]);

      await resetActor(db);
      const transferred = await db.query<{
        id: string;
        push_token: string | null;
        attached: boolean;
      }>(`
        SELECT id::text, push_token, push_token_attached_at IS NOT NULL AS attached
        FROM public.profiles ORDER BY id
      `);
      expect(transferred.rows).toEqual([
        { id: USER_A, push_token: null, attached: false },
        { id: USER_B, push_token: TOKEN, attached: true },
      ]);

      await setActor(db, USER_B);
      await db.query(
        "SELECT public.set_my_mobile_push_preferences(false, NULL, NULL)",
      );
      await resetActor(db);
      const optedOut = await db.query<{
        push_token: string | null;
        enabled: boolean;
        consented_at: string | null;
      }>(`
        SELECT push_token,
               push_notifications_enabled AS enabled,
               push_notifications_consented_at::text AS consented_at
        FROM public.profiles WHERE id = '${USER_B}'
      `);
      expect(optedOut.rows[0]).toEqual({
        push_token: null,
        enabled: false,
        consented_at: null,
      });
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves a new explicit opt-in and attached token when the migration is replayed", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setActor(db, USER_A);
      await db.query(
        "SELECT public.set_my_mobile_push_preferences(true, false, true)",
      );
      await db.query("SELECT public.attach_my_mobile_push_token($1)", [TOKEN]);

      await resetActor(db);
      await db.exec(migration);

      const preserved = await db.query<{
        push_token: string | null;
        enabled: boolean;
        consented: boolean;
        attached: boolean;
        community_enabled: boolean;
        partner_enabled: boolean;
      }>(`
        SELECT
          push_token,
          push_notifications_enabled AS enabled,
          push_notifications_consented_at IS NOT NULL AS consented,
          push_token_attached_at IS NOT NULL AS attached,
          community_push_notifications_enabled AS community_enabled,
          partner_push_notifications_enabled AS partner_enabled
        FROM public.profiles
        WHERE id = '${USER_A}'
      `);
      expect(preserved.rows[0]).toEqual({
        push_token: TOKEN,
        enabled: true,
        consented: true,
        attached: true,
        community_enabled: false,
        partner_enabled: true,
      });
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed on a partial identity schema without clearing a legacy token", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.profiles
        ADD COLUMN push_notifications_enabled boolean NOT NULL DEFAULT false
      `);

      await expect(db.exec(migration)).rejects.toThrow(
        /MOBILE_PUSH_IDENTITY_PARTIAL_SCHEMA: 1/i,
      );
      await db.exec("ROLLBACK").catch(() => undefined);

      const preserved = await db.query<{
        push_token: string | null;
        new_column_count: number;
      }>(`
        SELECT
          profile.push_token,
          (
            SELECT count(*)::integer
            FROM information_schema.columns AS profile_column
            WHERE profile_column.table_schema = 'public'
              AND profile_column.table_name = 'profiles'
              AND profile_column.column_name IN (
                'push_notifications_enabled',
                'push_notifications_consented_at',
                'community_push_notifications_enabled',
                'partner_push_notifications_enabled',
                'push_token_attached_at'
              )
          ) AS new_column_count
        FROM public.profiles AS profile
        WHERE profile.id = '${USER_A}'
      `);
      expect(preserved.rows[0]).toEqual({
        push_token: TOKEN,
        new_column_count: 1,
      });
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects even service-owned token writes that are not backed by consent", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      await expect(db.exec(`
        UPDATE public.profiles
        SET push_token = '${TOKEN}', push_token_attached_at = now()
        WHERE id = '${USER_B}'
      `)).rejects.toThrow(/profiles_push_token_requires_consent_check/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("returns only a boolean token projection and binds reads to auth.uid()", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(readProjectionMigration);
      await setActor(db, USER_A);
      await db.query(
        "SELECT public.set_my_mobile_push_preferences(true, false, true)",
      );
      await db.query("SELECT public.attach_my_mobile_push_token($1)", [TOKEN]);

      const response = await db.query<{ preferences: Record<string, unknown> }>(
        "SELECT public.get_my_mobile_push_preferences($1) AS preferences",
        [USER_A],
      );
      expect(response.rows[0]?.preferences).toMatchObject({
        pushEnabled: true,
        communityEnabled: false,
        partnerEnabled: true,
        tokenAttached: true,
      });
      expect(Object.keys(response.rows[0]?.preferences ?? {}).sort()).toEqual([
        "communityEnabled",
        "consentedAt",
        "partnerEnabled",
        "pushEnabled",
        "tokenAttached",
      ]);
      expect(JSON.stringify(response.rows[0]?.preferences)).not.toContain(TOKEN);
      await expect(
        db.query("SELECT public.get_my_mobile_push_preferences($1)", [USER_B]),
      ).rejects.toThrow(/push_actor_mismatch/i);
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("grants projection execution only to authenticated callers", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(readProjectionMigration);

      const privileges = await db.query<{
        authenticated: boolean;
        anonymous: boolean;
        service: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'authenticated',
            'public.get_my_mobile_push_preferences(uuid)',
            'EXECUTE'
          ) AS authenticated,
          has_function_privilege(
            'anon',
            'public.get_my_mobile_push_preferences(uuid)',
            'EXECUTE'
          ) AS anonymous,
          has_function_privilege(
            'service_role',
            'public.get_my_mobile_push_preferences(uuid)',
            'EXECUTE'
          ) AS service
      `);
      expect(privileges.rows[0]).toEqual({
        authenticated: true,
        anonymous: false,
        service: false,
      });

      await db.exec("SET ROLE anon");
      await expect(
        db.query("SELECT public.get_my_mobile_push_preferences($1)", [USER_A]),
      ).rejects.toThrow(/permission denied/i);
      await db.exec("RESET ROLE");
      await db.exec("SET ROLE service_role");
      await expect(
        db.query("SELECT public.get_my_mobile_push_preferences($1)", [USER_A]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects stale expected actors before any v2 push mutation", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(actorBoundMutationMigration);
      await setActor(db, USER_A);

      await expect(
        db.query(
          "SELECT public.set_my_mobile_push_preferences_v2($1, true, false, true)",
          [USER_B],
        ),
      ).rejects.toThrow(/push_actor_mismatch/i);
      await expect(
        db.query(
          "SELECT public.attach_my_mobile_push_token_v2($1, $2)",
          [USER_B, TOKEN],
        ),
      ).rejects.toThrow(/push_actor_mismatch/i);

      const setResponse = await db.query<{ preferences: Record<string, unknown> }>(
        "SELECT public.set_my_mobile_push_preferences_v2($1, true, false, true) AS preferences",
        [USER_A],
      );
      expect(Object.keys(setResponse.rows[0]?.preferences ?? {}).sort()).toEqual([
        "communityEnabled",
        "consentedAt",
        "partnerEnabled",
        "pushEnabled",
        "tokenAttached",
      ]);
      expect(JSON.stringify(setResponse.rows[0]?.preferences)).not.toContain(TOKEN);
      await db.query(
        "SELECT public.attach_my_mobile_push_token_v2($1, $2)",
        [USER_A, TOKEN],
      );

      await resetActor(db);
      await setActor(db, USER_B);
      await expect(
        db.query("SELECT public.detach_my_mobile_push_token_v2($1)", [USER_A]),
      ).rejects.toThrow(/push_actor_mismatch/i);

      await resetActor(db);
      const state = await db.query<{
        id: string;
        enabled: boolean;
        push_token: string | null;
      }>(`
        SELECT id::text,
               push_notifications_enabled AS enabled,
               push_token
        FROM public.profiles
        ORDER BY id
      `);
      expect(state.rows).toEqual([
        { id: USER_A, enabled: true, push_token: TOKEN },
        { id: USER_B, enabled: false, push_token: null },
      ]);
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps every expected-actor mutation v2 RPC authenticated-only and replay-safe", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(actorBoundMutationMigration);
      await db.exec(actorBoundMutationMigration);

      const signatures = [
        "public.set_my_mobile_push_preferences_v2(uuid,boolean,boolean,boolean)",
        "public.attach_my_mobile_push_token_v2(uuid,text)",
        "public.detach_my_mobile_push_token_v2(uuid)",
      ];
      for (const signature of signatures) {
        const privileges = await db.query<{
          authenticated: boolean;
          anonymous: boolean;
          service: boolean;
        }>(`
          SELECT
            has_function_privilege(
              'authenticated',
              '${signature}',
              'EXECUTE'
            ) AS authenticated,
            has_function_privilege('anon', '${signature}', 'EXECUTE') AS anonymous,
            has_function_privilege('service_role', '${signature}', 'EXECUTE') AS service
        `);
        expect(privileges.rows[0]).toEqual({
          authenticated: true,
          anonymous: false,
          service: false,
        });
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
