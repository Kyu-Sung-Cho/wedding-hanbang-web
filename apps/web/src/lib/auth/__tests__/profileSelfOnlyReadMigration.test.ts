// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802155000_make_profiles_self_only.sql",
  ),
  "utf8",
);

const authMeRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/auth/me/route.ts"),
  "utf8",
);

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

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

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      name text,
      email text,
      phone text,
      role text,
      couple_id uuid REFERENCES public.couples(id),
      is_admin boolean NOT NULL DEFAULT false,
      push_token text,
      push_notifications_consented_at timestamptz,
      push_token_attached_at timestamptz
    );

    CREATE FUNCTION public.is_couple_member(p_couple_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.couples
        WHERE id = p_couple_id
          AND (bride_id = auth.uid() OR groom_id = auth.uid())
      )
    $$;
    CREATE FUNCTION public.can_read_profile(p_profile_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT p_profile_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.couples
          WHERE bride_id = auth.uid() AND groom_id = p_profile_id
             OR groom_id = auth.uid() AND bride_id = p_profile_id
        )
    $$;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid), public.can_read_profile(uuid)
      TO authenticated, service_role;

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_select_safe_related ON public.profiles
      FOR SELECT TO authenticated USING (public.can_read_profile(id));
    GRANT SELECT ON TABLE public.profiles TO authenticated;
    GRANT ALL ON TABLE public.profiles, public.couples TO service_role;

    CREATE VIEW public.couple_profile_directory
    WITH (security_barrier = true, security_invoker = false)
    AS
    SELECT profile.id, profile.name, profile.role, profile.couple_id
    FROM public.profiles AS profile
    WHERE public.is_couple_member(profile.couple_id);
    ALTER VIEW public.couple_profile_directory OWNER TO postgres;
    GRANT SELECT ON TABLE public.couple_profile_directory TO authenticated;

    INSERT INTO public.couples (id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${USER_A}', '${USER_B}');
    INSERT INTO public.profiles (
      id, name, email, phone, role, couple_id, is_admin, push_token,
      push_notifications_consented_at, push_token_attached_at
    ) VALUES
      (
        '${USER_A}', 'Alice', 'alice@example.com', '01011112222', 'bride',
        '${COUPLE_ID}', false, 'ExponentPushToken[alice]', now(), now()
      ),
      (
        '${USER_B}', 'Bob', 'bob@example.com', '01033334444', 'groom',
        '${COUPLE_ID}', true, 'ExponentPushToken[bob]', now(), now()
      );
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

describe("profiles self-only read migration", () => {
  it("contains no customer-data mutation and pins the safe partner lookup callsite", () => {
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.profiles\b/i,
    );
    expect(authMeRoute).toContain('.from("couple_profile_directory")');
    expect(authMeRoute).toContain('.select("id, name, role, couple_id")');
  });

  it("denies direct partner profile reads but preserves the four-field directory", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setActor(db, USER_A);

      const directRows = await db.query<{
        id: string;
        email: string;
        phone: string;
        push_token: string;
        is_admin: boolean;
      }>(`
        SELECT id::text, email, phone, push_token, is_admin
        FROM public.profiles
        ORDER BY id
      `);
      expect(directRows.rows).toEqual([{
        id: USER_A,
        email: "alice@example.com",
        phone: "01011112222",
        push_token: "ExponentPushToken[alice]",
        is_admin: false,
      }]);
      const directPartner = await db.query<{ id: string }>(`
        SELECT id::text
        FROM public.profiles
        WHERE id = '${USER_B}'
      `);
      expect(directPartner.rows).toEqual([]);

      const directoryRows = await db.query<{
        id: string;
        name: string;
        role: string;
        couple_id: string;
      }>(`
        SELECT id::text, name, role, couple_id::text
        FROM public.couple_profile_directory
        ORDER BY id
      `);
      expect(directoryRows.rows).toEqual([
        { id: USER_A, name: "Alice", role: "bride", couple_id: COUPLE_ID },
        { id: USER_B, name: "Bob", role: "groom", couple_id: COUPLE_ID },
      ]);

      const columns = await db.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'couple_profile_directory'
        ORDER BY ordinal_position
      `);
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        "id",
        "name",
        "role",
        "couple_id",
      ]);

      await resetActor(db);
      const directoryPrivileges = await db.query<Record<string, boolean>>(`
        SELECT
          has_table_privilege(
            'authenticated', 'public.couple_profile_directory', 'SELECT'
          ) AS authenticated_table,
          has_column_privilege(
            'authenticated', 'public.couple_profile_directory', 'id', 'SELECT'
          ) AS authenticated_id,
          has_column_privilege(
            'authenticated', 'public.couple_profile_directory', 'name', 'SELECT'
          ) AS authenticated_name,
          has_column_privilege(
            'authenticated', 'public.couple_profile_directory', 'role', 'SELECT'
          ) AS authenticated_role,
          has_column_privilege(
            'authenticated', 'public.couple_profile_directory', 'couple_id', 'SELECT'
          ) AS authenticated_couple_id,
          has_any_column_privilege(
            'anon', 'public.couple_profile_directory', 'SELECT'
          ) AS anon_columns,
          has_any_column_privilege(
            'service_role', 'public.couple_profile_directory', 'SELECT'
          ) AS service_columns
      `);
      expect(directoryPrivileges.rows[0]).toEqual({
        authenticated_table: false,
        authenticated_id: true,
        authenticated_name: true,
        authenticated_role: true,
        authenticated_couple_id: true,
        anon_columns: false,
        service_columns: false,
      });

      await db.exec("SET ROLE anon");
      await expect(
        db.query(`SELECT * FROM public.profiles WHERE id = '${USER_A}'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT * FROM public.couple_profile_directory"),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when an unknown PUBLIC profile read policy has drifted in", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE POLICY unexpected_public_profile_read ON public.profiles
          FOR SELECT TO PUBLIC USING (true)
      `);

      await expect(db.exec(migration)).rejects.toThrow(
        /PROFILES_RELATED_READ_POLICY_REMAINS/,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is replay-safe and keeps service-role access for canonical server paths", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      const rows = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.profiles",
      );
      expect(rows.rows[0]?.count).toBe(2);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
