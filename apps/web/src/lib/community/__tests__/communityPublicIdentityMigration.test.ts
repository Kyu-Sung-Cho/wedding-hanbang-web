// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803103000_add_community_public_identities.sql",
  ),
  "utf8",
);
const contractApply = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/platform-operations/security/20260803104500_community_public_identity_contract_apply.sql",
  ),
  "utf8",
);
const contractVerify = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/platform-operations/security/20260803104500_community_public_identity_contract_verify.sql",
  ),
  "utf8",
);

const USER_ONE = "10000000-0000-4000-8000-000000000001";
const USER_TWO = "10000000-0000-4000-8000-000000000002";
const USER_THREE = "10000000-0000-4000-8000-000000000003";
const CALLER_CHOSEN_ID = "90000000-0000-4000-8000-000000000009";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users (id) VALUES
      ('${USER_ONE}'), ('${USER_TWO}'), ('${USER_THREE}');

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      nickname text NOT NULL
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title text NOT NULL,
      content text NOT NULL
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      content text NOT NULL
    );

    ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profile_read ON public.community_profiles FOR SELECT USING (true);
    CREATE POLICY post_read ON public.community_posts FOR SELECT USING (true);
    CREATE POLICY comment_read ON public.community_comments FOR SELECT USING (true);

    GRANT SELECT ON TABLE public.community_profiles, public.community_posts,
      public.community_comments TO anon, authenticated, service_role;
    GRANT INSERT, UPDATE, DELETE ON TABLE public.community_profiles,
      public.community_posts, public.community_comments TO service_role;

    INSERT INTO public.community_profiles (user_id, nickname)
    VALUES ('${USER_ONE}', 'one');
    INSERT INTO public.community_posts (id, author_id, title, content) VALUES
      ('20000000-0000-4000-8000-000000000001', '${USER_ONE}', 'one', 'body'),
      ('20000000-0000-4000-8000-000000000002', '${USER_TWO}', 'two', 'body');
    INSERT INTO public.community_comments (post_id, author_id, content)
    VALUES ('20000000-0000-4000-8000-000000000001', '${USER_ONE}', 'comment');
  `);
  return db;
}

async function addProductionProjectionColumns(db: PGlite) {
  await db.exec(`
    ALTER TABLE public.community_posts
      ADD COLUMN category text,
      ADD COLUMN images text[],
      ADD COLUMN slides jsonb,
      ADD COLUMN visibility text,
      ADD COLUMN ad_disclosure text,
      ADD COLUMN sponsorship_detail text,
      ADD COLUMN ai_comment jsonb,
      ADD COLUMN is_resolved boolean,
      ADD COLUMN is_verified_review boolean,
      ADD COLUMN price_data jsonb,
      ADD COLUMN is_quick_review boolean,
      ADD COLUMN rating integer,
      ADD COLUMN under_review boolean,
      ADD COLUMN upvote_count integer,
      ADD COLUMN downvote_count integer,
      ADD COLUMN comment_count integer,
      ADD COLUMN view_count integer,
      ADD COLUMN bookmark_count integer,
      ADD COLUMN is_pinned boolean,
      ADD COLUMN is_weekly_best boolean,
      ADD COLUMN vendor_tags text[],
      ADD COLUMN tags text[],
      ADD COLUMN cost_data jsonb,
      ADD COLUMN search_vector tsvector,
      ADD COLUMN created_at timestamptz,
      ADD COLUMN updated_at timestamptz;

    ALTER TABLE public.community_comments
      ADD COLUMN parent_id uuid,
      ADD COLUMN upvote_count integer,
      ADD COLUMN is_deleted boolean,
      ADD COLUMN created_at timestamptz,
      ADD COLUMN updated_at timestamptz;

    ALTER TABLE public.community_profiles
      ADD COLUMN avatar_url text,
      ADD COLUMN badge text,
      ADD COLUMN rank text,
      ADD COLUMN post_count integer,
      ADD COLUMN comment_count integer,
      ADD COLUMN total_upvotes_received integer;
  `);
}

describe("community public identity migration", () => {
  it("backfills one stable pseudonym per auth user and is replay-safe", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      const rows = await db.query<{
        user_id: string;
        public_id: string;
      }>(`
        SELECT user_id::text, public_id::text
          FROM public.community_public_identities
         ORDER BY user_id
      `);

      expect(rows.rows).toHaveLength(2);
      expect(new Set(rows.rows.map((row) => row.public_id)).size).toBe(2);
      for (const row of rows.rows) {
        expect(row.public_id).not.toBe(row.user_id);
      }

      const mirrors = await db.query<{ mismatch_count: number }>(`
        SELECT (
          SELECT count(*)::int
            FROM public.community_posts AS post
            JOIN public.community_public_identities AS identity
              ON identity.user_id = post.author_id
           WHERE post.author_public_id IS DISTINCT FROM identity.public_id
        ) + (
          SELECT count(*)::int
            FROM public.community_comments AS comment
            JOIN public.community_public_identities AS identity
              ON identity.user_id = comment.author_id
           WHERE comment.author_public_id IS DISTINCT FROM identity.public_id
        ) AS mismatch_count
      `);
      expect(mirrors.rows[0].mismatch_count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("overrides caller-supplied IDs and rejects every public-ID mutation", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      await db.query(
        "INSERT INTO public.community_public_identities (user_id, public_id) VALUES ($1, $2)",
        [USER_THREE, CALLER_CHOSEN_ID],
      );
      const identity = await db.query<{ public_id: string }>(
        "SELECT public_id::text FROM public.community_public_identities WHERE user_id = $1",
        [USER_THREE],
      );
      expect(identity.rows[0].public_id).not.toBe(CALLER_CHOSEN_ID);

      await db.query(
        "INSERT INTO public.community_profiles (user_id, nickname, community_public_id) VALUES ($1, 'three', $2)",
        [USER_THREE, CALLER_CHOSEN_ID],
      );
      const profile = await db.query<{ community_public_id: string }>(
        "SELECT community_public_id::text FROM public.community_profiles WHERE user_id = $1",
        [USER_THREE],
      );
      expect(profile.rows[0].community_public_id).toBe(identity.rows[0].public_id);

      await expect(db.query(
        "UPDATE public.community_public_identities SET public_id = $1 WHERE user_id = $2",
        [CALLER_CHOSEN_ID, USER_THREE],
      )).rejects.toThrow(/IMMUTABLE/);
      await expect(db.query(
        "UPDATE public.community_profiles SET community_public_id = $1 WHERE user_id = $2",
        [CALLER_CHOSEN_ID, USER_THREE],
      )).rejects.toThrow(/IMMUTABLE/);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps the private map closed while granting only public mirrors", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      const privileges = await db.query<Record<string, boolean>>(`
        SELECT
          has_table_privilege('anon', 'public.community_public_identities', 'SELECT')
            AS anon_map,
          has_table_privilege('authenticated', 'public.community_public_identities', 'SELECT')
            AS authenticated_map,
          has_column_privilege('anon', 'public.community_posts', 'author_public_id', 'SELECT')
            AS anon_post_public_id,
          has_column_privilege('authenticated', 'public.community_comments', 'author_public_id', 'SELECT')
            AS authenticated_comment_public_id,
          has_column_privilege('anon', 'public.community_profiles', 'community_public_id', 'SELECT')
            AS anon_profile_public_id,
          has_table_privilege('service_role', 'public.community_public_identities', 'SELECT')
            AS service_map
      `);
      expect(privileges.rows[0]).toEqual({
        anon_map: false,
        authenticated_map: false,
        anon_post_public_id: true,
        authenticated_comment_public_id: true,
        anon_profile_public_id: true,
        service_map: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("cuts over to exact public columns while preserving full service projections", async () => {
    const db = await createDatabase();
    try {
      await addProductionProjectionColumns(db);
      await db.exec(migration);
      await db.exec(contractApply);
      await db.exec(contractVerify);

      const privileges = await db.query<Record<string, boolean>>(`
        SELECT
          has_column_privilege('anon', 'public.community_posts', 'author_id', 'SELECT')
            AS anon_post_auth_id,
          has_column_privilege('authenticated', 'public.community_comments', 'author_id', 'SELECT')
            AS authenticated_comment_auth_id,
          has_column_privilege('anon', 'public.community_profiles', 'user_id', 'SELECT')
            AS anon_profile_auth_id,
          has_column_privilege('anon', 'public.community_posts', 'author_public_id', 'SELECT')
            AS anon_post_public_id,
          has_column_privilege('authenticated', 'public.community_comments', 'author_public_id', 'SELECT')
            AS authenticated_comment_public_id,
          has_column_privilege('anon', 'public.community_profiles', 'community_public_id', 'SELECT')
            AS anon_profile_public_id,
          has_table_privilege('service_role', 'public.community_posts', 'SELECT')
            AS service_posts,
          has_table_privilege('service_role', 'public.community_public_identities', 'SELECT')
            AS service_map
      `);
      expect(privileges.rows[0]).toEqual({
        anon_post_auth_id: false,
        authenticated_comment_auth_id: false,
        anon_profile_auth_id: false,
        anon_post_public_id: true,
        authenticated_comment_public_id: true,
        anon_profile_public_id: true,
        service_posts: true,
        service_map: true,
      });

      await db.exec("SET ROLE anon;");
      await expect(db.query(
        "SELECT author_id FROM public.community_posts",
      )).rejects.toThrow(/permission denied/i);
      const publicRows = await db.query<{ author_public_id: string }>(
        "SELECT author_public_id::text FROM public.community_posts ORDER BY id",
      );
      expect(publicRows.rows).toHaveLength(2);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
