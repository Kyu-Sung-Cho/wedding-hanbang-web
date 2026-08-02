// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802123000_close_community_read_bypasses.sql",
  ),
  "utf8",
);

const profileRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/profile/route.ts"),
  "utf8",
);
const votedPostsRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/posts/voted/route.ts"),
  "utf8",
);

const AUTHOR_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const VISIBLE_POST_ID = "10000000-0000-4000-8000-000000000001";
const REVIEW_POST_ID = "10000000-0000-4000-8000-000000000002";
const COMMENT_ID = "20000000-0000-4000-8000-000000000001";
const POLL_ID = "30000000-0000-4000-8000-000000000001";
const OPTION_ID = "40000000-0000-4000-8000-000000000001";

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
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      avatar_url text,
      badge text NOT NULL DEFAULT 'member',
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      total_xp integer NOT NULL DEFAULT 0,
      level integer NOT NULL DEFAULT 1,
      rank text NOT NULL DEFAULT 'sprout',
      wedding_year integer,
      wedding_month integer,
      wedding_completed boolean NOT NULL DEFAULT false,
      progress_percent integer NOT NULL DEFAULT 0,
      region text,
      warning_count integer NOT NULL DEFAULT 0,
      is_suspended boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      category text NOT NULL DEFAULT 'free',
      title text NOT NULL,
      content text NOT NULL,
      images text[] NOT NULL DEFAULT '{}',
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean DEFAULT false,
      verification_doc_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES public.community_posts(id),
      content text NOT NULL
    );
    CREATE TABLE public.community_polls (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES public.community_posts(id)
    );
    CREATE TABLE public.community_poll_options (
      id uuid PRIMARY KEY,
      poll_id uuid NOT NULL REFERENCES public.community_polls(id),
      option_text text NOT NULL
    );

    ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_polls ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_poll_options ENABLE ROW LEVEL SECURITY;

    CREATE POLICY community_profiles_select ON public.community_profiles
      FOR SELECT USING (true);
    CREATE POLICY cp_select_public ON public.community_posts
      FOR SELECT USING (visibility = 'public');
    CREATE POLICY cp_select_members ON public.community_posts
      FOR SELECT USING (
        visibility = 'members' AND auth.role() = 'authenticated'
      );
    CREATE POLICY cp_select_drafts ON public.community_posts
      FOR SELECT USING (
        visibility = 'draft' AND author_id = auth.uid()
      );
    CREATE POLICY cc_select ON public.community_comments
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.community_posts AS post
          WHERE post.id = community_comments.post_id
            AND post.visibility = 'public'
        )
      );
    CREATE POLICY polls_select ON public.community_polls
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.community_posts AS post
          WHERE post.id = community_polls.post_id
            AND post.visibility = 'public'
        )
      );
    CREATE POLICY poll_options_select ON public.community_poll_options
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM public.community_polls AS poll
          JOIN public.community_posts AS post ON post.id = poll.post_id
          WHERE poll.id = community_poll_options.poll_id
            AND post.visibility = 'public'
        )
      );

    GRANT SELECT ON TABLE
      public.community_profiles,
      public.community_posts,
      public.community_comments,
      public.community_polls,
      public.community_poll_options
    TO anon, authenticated, service_role;

    INSERT INTO public.community_profiles (
      user_id, nickname, badge, post_count, comment_count,
      total_upvotes_received, total_xp, level, rank, wedding_year,
      wedding_month, wedding_completed, progress_percent, region,
      warning_count, is_suspended
    ) VALUES (
      '${AUTHOR_ID}', 'author', 'member', 4, 5,
      6, 700, 8, 'expert', 2027,
      5, false, 73, 'Seoul',
      2, true
    );

    INSERT INTO public.community_posts (
      id, author_id, title, content, visibility, under_review,
      verification_doc_url
    ) VALUES
      (
        '${VISIBLE_POST_ID}', '${OTHER_ID}', 'Visible', 'Visible body',
        'public', false, 'private/visible-document.pdf'
      ),
      (
        '${REVIEW_POST_ID}', '${AUTHOR_ID}', 'Moderated', 'Hidden body',
        'public', true, 'private/review-document.pdf'
      );

    INSERT INTO public.community_comments (id, post_id, content)
    VALUES ('${COMMENT_ID}', '${REVIEW_POST_ID}', 'Hidden comment');
    INSERT INTO public.community_polls (id, post_id)
    VALUES ('${POLL_ID}', '${REVIEW_POST_ID}');
    INSERT INTO public.community_poll_options (id, poll_id, option_text)
    VALUES ('${OPTION_ID}', '${POLL_ID}', 'Hidden option');
  `);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId = "",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("community read boundary migration", () => {
  it("is DDL-only and removes wildcard reads from affected authenticated routes", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:community_profiles|community_posts|community_comments|community_polls|community_poll_options)\b/i,
    );
    expect(profileRoute).toContain(
      "const { data: profile, error } = await serviceClient",
    );
    expect(votedPostsRoute).toContain(".select(COMMUNITY_POST_PUBLIC_SELECT)");
  });

  it("removes sensitive column privileges but preserves required projections", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      const privileges = await db.query<Record<string, boolean>>(`
        SELECT
          has_column_privilege(
            'anon', 'public.community_posts', 'title', 'SELECT'
          ) AS anon_post_title,
          has_column_privilege(
            'anon', 'public.community_posts', 'verification_doc_url', 'SELECT'
          ) AS anon_verification_doc,
          has_column_privilege(
            'authenticated', 'public.community_posts', 'verification_doc_url', 'SELECT'
          ) AS authenticated_verification_doc,
          has_column_privilege(
            'anon', 'public.community_profiles', 'nickname', 'SELECT'
          ) AS anon_nickname,
          has_column_privilege(
            'anon', 'public.community_profiles', 'region', 'SELECT'
          ) AS anon_region,
          has_column_privilege(
            'anon', 'public.community_profiles', 'post_count', 'SELECT'
          ) AS anon_post_count,
          has_column_privilege(
            'anon', 'public.community_profiles', 'wedding_year', 'SELECT'
          ) AS anon_wedding_year,
          has_column_privilege(
            'authenticated', 'public.community_profiles', 'post_count', 'SELECT'
          ) AS authenticated_post_count,
          has_column_privilege(
            'authenticated', 'public.community_profiles', 'wedding_month', 'SELECT'
          ) AS authenticated_wedding_month,
          has_column_privilege(
            'authenticated', 'public.community_profiles', 'progress_percent', 'SELECT'
          ) AS authenticated_progress,
          has_column_privilege(
            'authenticated', 'public.community_profiles', 'warning_count', 'SELECT'
          ) AS authenticated_warning_count,
          has_column_privilege(
            'authenticated', 'public.community_profiles', 'is_suspended', 'SELECT'
          ) AS authenticated_is_suspended,
          has_table_privilege(
            'service_role', 'public.community_profiles', 'SELECT'
          ) AS service_profile,
          has_table_privilege(
            'service_role', 'public.community_posts', 'SELECT'
          ) AS service_post
      `);

      expect(privileges.rows[0]).toEqual({
        anon_post_title: true,
        anon_verification_doc: false,
        authenticated_verification_doc: false,
        anon_nickname: true,
        anon_region: false,
        anon_post_count: false,
        anon_wedding_year: false,
        authenticated_post_count: true,
        authenticated_wedding_month: false,
        authenticated_progress: false,
        authenticated_warning_count: false,
        authenticated_is_suspended: false,
        service_profile: true,
        service_post: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("hides an under-review post and every child row from non-authors", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      await setPersona(db, "anon");
      const anonPosts = await db.query<{ id: string }>(
        "SELECT id FROM public.community_posts ORDER BY id",
      );
      const anonComments = await db.query<{ id: string }>(
        "SELECT id FROM public.community_comments",
      );
      const anonPolls = await db.query<{ id: string }>(
        "SELECT id FROM public.community_polls",
      );
      const anonOptions = await db.query<{ id: string }>(
        "SELECT id FROM public.community_poll_options",
      );
      expect(anonPosts.rows.map((row) => row.id)).toEqual([VISIBLE_POST_ID]);
      expect(anonComments.rows).toEqual([]);
      expect(anonPolls.rows).toEqual([]);
      expect(anonOptions.rows).toEqual([]);

      await resetPersona(db);
      await setPersona(db, "authenticated", OTHER_ID);
      const otherPosts = await db.query<{ id: string }>(
        "SELECT id FROM public.community_posts ORDER BY id",
      );
      const otherComments = await db.query<{ id: string }>(
        "SELECT id FROM public.community_comments",
      );
      expect(otherPosts.rows.map((row) => row.id)).toEqual([VISIBLE_POST_ID]);
      expect(otherComments.rows).toEqual([]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves author visibility while rejecting direct sensitive-field reads", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "authenticated", AUTHOR_ID);

      const posts = await db.query<{ id: string }>(
        "SELECT id FROM public.community_posts ORDER BY id",
      );
      const comments = await db.query<{ id: string }>(
        "SELECT id FROM public.community_comments",
      );
      const polls = await db.query<{ id: string }>(
        "SELECT id FROM public.community_polls",
      );
      const options = await db.query<{ id: string }>(
        "SELECT id FROM public.community_poll_options",
      );

      expect(posts.rows.map((row) => row.id)).toEqual([
        VISIBLE_POST_ID,
        REVIEW_POST_ID,
      ]);
      expect(comments.rows.map((row) => row.id)).toEqual([COMMENT_ID]);
      expect(polls.rows.map((row) => row.id)).toEqual([POLL_ID]);
      expect(options.rows.map((row) => row.id)).toEqual([OPTION_ID]);

      await expect(
        db.query("SELECT verification_doc_url FROM public.community_posts"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT region, warning_count FROM public.community_profiles"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT wedding_year, wedding_month FROM public.community_profiles"),
      ).rejects.toThrow(/permission denied/i);

      const publicProfile = await db.query<{
        nickname: string;
        post_count: number;
      }>(
        "SELECT nickname, post_count FROM public.community_profiles WHERE user_id = $1",
        [AUTHOR_ID],
      );
      expect(publicProfile.rows[0]).toEqual({ nickname: "author", post_count: 4 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps service reads working and is replay-safe", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
      await setPersona(db, "service_role");

      const sensitive = await db.query<{
        verification_doc_url: string;
        region: string;
        warning_count: number;
      }>(`
        SELECT
          (
            SELECT verification_doc_url
            FROM public.community_posts
            WHERE id = '${REVIEW_POST_ID}'
          ) AS verification_doc_url,
          (
            SELECT region
            FROM public.community_profiles
            WHERE user_id = '${AUTHOR_ID}'
          ) AS region,
          (
            SELECT warning_count
            FROM public.community_profiles
            WHERE user_id = '${AUTHOR_ID}'
          ) AS warning_count
      `);

      expect(sensitive.rows[0]).toEqual({
        verification_doc_url: "private/review-document.pdf",
        region: "Seoul",
        warning_count: 2,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
