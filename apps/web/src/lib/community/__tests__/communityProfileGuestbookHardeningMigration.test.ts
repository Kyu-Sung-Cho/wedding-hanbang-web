// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260804120000_community_profile_guestbook_p0_hardening.sql",
);
const migration = readFileSync(migrationPath, "utf8");

const ACTIVE_USER = "10000000-0000-4000-8000-000000000001";
const SUSPENDED_USER = "10000000-0000-4000-8000-000000000002";
const NO_PROFILE_USER = "10000000-0000-4000-8000-000000000003";
const GUESTBOOK_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      avatar_url text,
      badge text NOT NULL DEFAULT 'member',
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      total_xp integer NOT NULL DEFAULT 0,
      level integer NOT NULL DEFAULT 1,
      rank text NOT NULL DEFAULT 'sprout',
      wedding_year integer,
      wedding_month integer,
      wedding_completed boolean NOT NULL DEFAULT false,
      progress_percent integer NOT NULL DEFAULT 0,
      region text,
      warning_count integer NOT NULL DEFAULT 0,
      is_suspended boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY community_profiles_select
      ON public.community_profiles FOR SELECT USING (true);
    CREATE POLICY community_profiles_insert
      ON public.community_profiles FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY community_profiles_update
      ON public.community_profiles FOR UPDATE TO authenticated
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    GRANT ALL ON TABLE public.community_profiles
      TO anon, authenticated, service_role;
    GRANT SELECT (warning_count), UPDATE (is_suspended)
      ON TABLE public.community_profiles TO authenticated;

    CREATE TABLE public.guestbooks (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL,
      slug text NOT NULL,
      bride_name text NOT NULL,
      groom_name text NOT NULL,
      wedding_date date NOT NULL,
      venue text,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.guestbook_messages (
      id uuid PRIMARY KEY,
      guestbook_id uuid NOT NULL REFERENCES public.guestbooks(id),
      guest_name text NOT NULL,
      relation text,
      message text NOT NULL,
      image_url text,
      is_approved boolean NOT NULL DEFAULT true,
      ip_hash text
    );
    CREATE TABLE public.guestbook_message_reactions (
      id uuid PRIMARY KEY,
      message_id uuid NOT NULL REFERENCES public.guestbook_messages(id),
      reaction_type text NOT NULL,
      ip_hash text NOT NULL
    );
    CREATE TABLE public.guestbook_photos (
      id uuid PRIMARY KEY,
      guestbook_id uuid NOT NULL REFERENCES public.guestbooks(id),
      url text NOT NULL,
      caption text
    );

    ALTER TABLE public.guestbooks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.guestbook_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.guestbook_message_reactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.guestbook_photos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY guestbooks_select_active
      ON public.guestbooks FOR SELECT USING (is_active = true);
    CREATE POLICY guestbooks_update_owner
      ON public.guestbooks FOR UPDATE TO authenticated
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
    CREATE POLICY gb_messages_select
      ON public.guestbook_messages FOR SELECT USING (is_approved = true);
    CREATE POLICY gb_messages_insert_anon
      ON public.guestbook_messages FOR INSERT WITH CHECK (true);
    CREATE POLICY gb_reactions_select
      ON public.guestbook_message_reactions FOR SELECT USING (true);
    CREATE POLICY gb_photos_select
      ON public.guestbook_photos FOR SELECT USING (true);
    GRANT ALL ON TABLE
      public.guestbooks,
      public.guestbook_messages,
      public.guestbook_message_reactions,
      public.guestbook_photos
      TO anon, authenticated, service_role;
    GRANT SELECT (ip_hash) ON TABLE public.guestbook_messages TO PUBLIC;

    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY storage_clients_all
      ON storage.objects FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
    GRANT ALL ON TABLE storage.objects TO anon, authenticated, service_role;
    GRANT SELECT ON TABLE storage.buckets TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public, auth, storage
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid()
      TO anon, authenticated, service_role;

    INSERT INTO public.community_profiles (
      user_id, nickname, avatar_url, badge, rank, wedding_year, wedding_month,
      region, warning_count, is_suspended, total_xp, level
    ) VALUES
      (
        '${ACTIVE_USER}', 'Active', 'https://cdn.example/active.jpg',
        'verified_couple', 'expert', 2027, 5, 'Seoul', 3, false, 900, 4
      ),
      (
        '${SUSPENDED_USER}', 'Suspended', 'https://cdn.example/suspended.jpg',
        'member', 'sprout', 2028, 6, 'Busan', 7, true, 100, 2
      );

    INSERT INTO public.guestbooks (
      id, owner_id, slug, bride_name, groom_name, wedding_date, venue
    ) VALUES (
      '${GUESTBOOK_ID}', '${ACTIVE_USER}', 'private-couple',
      'Bride PII', 'Groom PII', '2027-05-01', 'Private Venue'
    );
    INSERT INTO public.guestbook_messages (
      id, guestbook_id, guest_name, relation, message, ip_hash
    ) VALUES (
      '${MESSAGE_ID}', '${GUESTBOOK_ID}', 'Guest PII', 'family',
      'Private message', 'sensitive-ip-hash'
    );
    INSERT INTO public.guestbook_message_reactions (
      id, message_id, reaction_type, ip_hash
    ) VALUES (
      '40000000-0000-4000-8000-000000000001', '${MESSAGE_ID}',
      'love', 'reaction-ip-hash'
    );
    INSERT INTO public.guestbook_photos (id, guestbook_id, url, caption)
    VALUES (
      '50000000-0000-4000-8000-000000000001', '${GUESTBOOK_ID}',
      'https://cdn.example/private.jpg', 'Private photo'
    );

    INSERT INTO storage.buckets (id, name, public) VALUES
      ('guestbook-images', 'guestbook-images', true),
      ('guestbook-uploads', 'guestbook-uploads', true),
      ('community-images', 'community-images', true);
    INSERT INTO storage.objects (bucket_id, name) VALUES
      ('guestbook-images', 'legacy-cover.jpg'),
      ('guestbook-uploads', 'legacy-message.jpg'),
      ('community-images', 'community.jpg');
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId: string | null = null,
) {
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
  await db.exec(`SET ROLE ${role};`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

describe("community profile and retired guestbook P0 hardening migration", () => {
  it("keeps Supabase-owned storage.objects policy changes out of automatic migrations", () => {
    expect(migration).not.toMatch(/\bstorage\.objects\b/iu);
    expect(migration).not.toMatch(/\bUPDATE\s+storage\.buckets\b/iu);
    expect(migration).toMatch(/hosted Storage owner operation/iu);
  });

  it("publishes only the safe profile projection and makes the base table service-only", async () => {
    const db = await createDatabase();
    try {
      const columns = await db.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'community_public_profiles'
        ORDER BY ordinal_position
      `);
      expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
        "user_id",
        "nickname",
        "avatar_url",
        "badge",
        "rank",
      ]);

      const privileges = await db.query<{
        anon_base_select: boolean;
        auth_base_select: boolean;
        auth_base_update: boolean;
        auth_sensitive_column_select: boolean;
        auth_sensitive_column_update: boolean;
        anon_projection_select: boolean;
        auth_projection_select: boolean;
        auth_projection_update: boolean;
        service_base_all: boolean;
        anon_write_access_execute: boolean;
        auth_write_access_execute: boolean;
        service_write_access_execute: boolean;
      }>(`
        SELECT
          has_table_privilege('anon', 'public.community_profiles', 'SELECT')
            AS anon_base_select,
          has_table_privilege('authenticated', 'public.community_profiles', 'SELECT')
            AS auth_base_select,
          has_table_privilege('authenticated', 'public.community_profiles', 'UPDATE')
            AS auth_base_update,
          has_column_privilege(
            'authenticated', 'public.community_profiles', 'warning_count', 'SELECT'
          ) AS auth_sensitive_column_select,
          has_column_privilege(
            'authenticated', 'public.community_profiles', 'is_suspended', 'UPDATE'
          ) AS auth_sensitive_column_update,
          has_table_privilege('anon', 'public.community_public_profiles', 'SELECT')
            AS anon_projection_select,
          has_table_privilege('authenticated', 'public.community_public_profiles', 'SELECT')
            AS auth_projection_select,
          has_table_privilege('authenticated', 'public.community_public_profiles', 'UPDATE')
            AS auth_projection_update,
          has_table_privilege(
            'service_role', 'public.community_profiles',
            'SELECT,INSERT,UPDATE,DELETE'
          ) AS service_base_all,
          has_function_privilege(
            'anon', 'public.community_get_write_access(uuid)', 'EXECUTE'
          ) AS anon_write_access_execute,
          has_function_privilege(
            'authenticated', 'public.community_get_write_access(uuid)', 'EXECUTE'
          ) AS auth_write_access_execute,
          has_function_privilege(
            'service_role', 'public.community_get_write_access(uuid)', 'EXECUTE'
          ) AS service_write_access_execute
      `);
      expect(privileges.rows[0]).toEqual({
        anon_base_select: false,
        auth_base_select: false,
        auth_base_update: false,
        auth_sensitive_column_select: false,
        auth_sensitive_column_update: false,
        anon_projection_select: true,
        auth_projection_select: true,
        auth_projection_update: false,
        service_base_all: true,
        anon_write_access_execute: false,
        auth_write_access_execute: true,
        service_write_access_execute: true,
      });

      const profilePolicies = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'community_profiles'
      `);
      expect(profilePolicies.rows[0]?.count).toBe(0);

      await setPersona(db, "anon");
      const publicProfiles = await db.query<{
        user_id: string;
        nickname: string;
      }>(`
        SELECT user_id, nickname
        FROM public.community_public_profiles
        ORDER BY user_id
      `);
      expect(publicProfiles.rows).toEqual([
        { user_id: ACTIVE_USER, nickname: "Active" },
      ]);
      await expect(
        db.query("SELECT warning_count FROM public.community_profiles"),
      ).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await setPersona(db, "authenticated", ACTIVE_USER);
      await expect(db.exec(`
        UPDATE public.community_profiles
        SET badge = 'admin', rank = 'master', total_xp = 999999,
            warning_count = 0, is_suspended = false
        WHERE user_id = '${ACTIVE_USER}'
      `)).rejects.toThrow(/permission denied/iu);

      const ownWriteAccess = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.community_get_write_access('${ACTIVE_USER}') AS result
      `);
      expect(ownWriteAccess.rows[0]?.result).toEqual({
        profile_exists: true,
        is_suspended: false,
      });

      await resetPersona(db);
      await setPersona(db, "authenticated", NO_PROFILE_USER);
      const noProfileWriteAccess = await db.query<{
        result: Record<string, unknown>;
      }>(`
        SELECT public.community_get_write_access('${NO_PROFILE_USER}') AS result
      `);
      expect(noProfileWriteAccess.rows[0]?.result).toEqual({
        profile_exists: false,
        is_suspended: false,
      });

      await expect(
        db.query(`
          SELECT public.community_get_write_access('${SUSPENDED_USER}')
        `),
      ).rejects.toThrow(/private to the actor/iu);

      await resetPersona(db);
      await setPersona(db, "service_role");
      const suspendedWriteAccess = await db.query<{
        result: Record<string, unknown>;
      }>(`
        SELECT public.community_get_write_access('${SUSPENDED_USER}') AS result
      `);
      expect(suspendedWriteAccess.rows[0]?.result).toEqual({
        profile_exists: true,
        is_suspended: true,
      });
      await expect(db.exec(`
        UPDATE public.community_profiles
        SET warning_count = warning_count + 1
        WHERE user_id = '${ACTIVE_USER}'
      `)).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("retires guestbook tables without mutating provider-owned Storage metadata", async () => {
    const db = await createDatabase();
    try {
      const guestbookContract = await db.query<{
        table_name: string;
        anon_select: boolean;
        anon_insert: boolean;
        auth_select: boolean;
        auth_update: boolean;
        anon_any_column_select: boolean;
        auth_any_column_update: boolean;
        service_all: boolean;
        policy_count: number;
      }>(`
        SELECT
          relation.table_name,
          has_table_privilege('anon', relation.qualified_name, 'SELECT')
            AS anon_select,
          has_table_privilege('anon', relation.qualified_name, 'INSERT')
            AS anon_insert,
          has_table_privilege('authenticated', relation.qualified_name, 'SELECT')
            AS auth_select,
          has_table_privilege('authenticated', relation.qualified_name, 'UPDATE')
            AS auth_update,
          has_any_column_privilege('anon', relation.qualified_name, 'SELECT')
            AS anon_any_column_select,
          has_any_column_privilege('authenticated', relation.qualified_name, 'UPDATE')
            AS auth_any_column_update,
          has_table_privilege(
            'service_role', relation.qualified_name,
            'SELECT,INSERT,UPDATE,DELETE'
          ) AS service_all,
          (
            SELECT count(*)::integer
            FROM pg_policies AS policy
            WHERE policy.schemaname = 'public'
              AND policy.tablename = relation.table_name
          ) AS policy_count
        FROM (VALUES
          ('guestbooks', 'public.guestbooks'),
          ('guestbook_messages', 'public.guestbook_messages'),
          ('guestbook_message_reactions', 'public.guestbook_message_reactions'),
          ('guestbook_photos', 'public.guestbook_photos')
        ) AS relation(table_name, qualified_name)
        ORDER BY relation.table_name
      `);
      expect(guestbookContract.rows).toEqual(
        [
          "guestbook_message_reactions",
          "guestbook_messages",
          "guestbook_photos",
          "guestbooks",
        ].map((table_name) => ({
          table_name,
          anon_select: false,
          anon_insert: false,
          auth_select: false,
          auth_update: false,
          anon_any_column_select: false,
          auth_any_column_update: false,
          service_all: true,
          policy_count: 0,
        })),
      );

      const buckets = await db.query<{ id: string; public: boolean }>(`
        SELECT id, public
        FROM storage.buckets
        ORDER BY id
      `);
      expect(buckets.rows).toEqual([
        { id: "community-images", public: true },
        { id: "guestbook-images", public: true },
        { id: "guestbook-uploads", public: true },
      ]);

      const storagePolicies = await db.query<{
        policyname: string;
      }>(`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
        ORDER BY policyname
      `);
      expect(storagePolicies.rows).toEqual([{ policyname: "storage_clients_all" }]);

      await setPersona(db, "anon");
      await expect(db.query("SELECT bride_name FROM public.guestbooks"))
        .rejects.toThrow(/permission denied/iu);
      await expect(db.exec(`
        INSERT INTO public.guestbook_messages (
          id, guestbook_id, guest_name, message
        ) VALUES (
          '60000000-0000-4000-8000-000000000001', '${GUESTBOOK_ID}',
          'Spam', 'anonymous spam'
        )
      `)).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await setPersona(db, "authenticated", ACTIVE_USER);
      await resetPersona(db);
      await setPersona(db, "service_role");
      const retained = await db.query<{
        profile_rows: number;
        guestbook_rows: number;
        message_rows: number;
        reaction_rows: number;
        photo_rows: number;
        legacy_object_rows: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.community_profiles)
            AS profile_rows,
          (SELECT count(*)::integer FROM public.guestbooks)
            AS guestbook_rows,
          (SELECT count(*)::integer FROM public.guestbook_messages)
            AS message_rows,
          (SELECT count(*)::integer FROM public.guestbook_message_reactions)
            AS reaction_rows,
          (SELECT count(*)::integer FROM public.guestbook_photos)
            AS photo_rows,
          (SELECT count(*)::integer FROM storage.objects
            WHERE bucket_id IN ('guestbook-images', 'guestbook-uploads'))
            AS legacy_object_rows
      `);
      expect(retained.rows[0]).toEqual({
        profile_rows: 2,
        guestbook_rows: 1,
        message_rows: 1,
        reaction_rows: 1,
        photo_rows: 1,
        legacy_object_rows: 2,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("documents a forward recovery path and contains no destructive data removal", () => {
    expect(migration).toMatch(/Recovery \/ forward rollback:/u);
    expect(migration).toMatch(/No profile, guestbook, message, reaction, photo, or storage-object row is\s+--\s+deleted/iu);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/iu);
    expect(migration).not.toMatch(/\bTRUNCATE\b/iu);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+(?:public|storage)\./iu);

    const projection = migration.match(
      /CREATE OR REPLACE VIEW public\.community_public_profiles[\s\S]*?FROM public\.community_profiles AS profile/iu,
    )?.[0];
    expect(projection).toBeDefined();
    for (const sensitiveColumn of [
      "wedding_year",
      "wedding_month",
      "region",
      "progress_percent",
      "post_count",
      "comment_count",
      "total_upvotes_received",
      "total_xp",
      "level",
      "warning_count",
      "is_suspended",
    ]) {
      expect(projection).not.toMatch(new RegExp(`profile\\.${sensitiveColumn}\\b`, "iu"));
    }
  });
});
