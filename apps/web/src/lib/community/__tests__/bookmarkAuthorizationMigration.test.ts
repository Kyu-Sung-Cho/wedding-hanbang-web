// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802145000_close_community_bookmark_visibility_bypass.sql",
  ),
  "utf8",
);

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const PUBLIC_POST_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_DRAFT_ID = "10000000-0000-4000-8000-000000000002";
const OTHER_REVIEW_ID = "10000000-0000-4000-8000-000000000003";
const MEMBERS_POST_ID = "10000000-0000-4000-8000-000000000004";
const OWN_DRAFT_ID = "10000000-0000-4000-8000-000000000005";
const OWN_REVIEW_ID = "10000000-0000-4000-8000-000000000006";
const LEGACY_POLICY_POST_ID = "10000000-0000-4000-8000-000000000007";

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

    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false,
      bookmark_count integer NOT NULL DEFAULT 0
    );

    CREATE TABLE public.community_bookmarks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, post_id)
    );

    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

    CREATE POLICY community_posts_public_read ON public.community_posts
      FOR SELECT USING (visibility = 'public' AND under_review IS FALSE);
    CREATE POLICY "cb_all" ON public.community_bookmarks
      FOR ALL USING (user_id = auth.uid());
    CREATE POLICY legacy_bookmark_select_all ON public.community_bookmarks
      FOR SELECT TO authenticated USING (true);

    GRANT SELECT ON TABLE public.community_posts TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_bookmarks TO authenticated;
    GRANT ALL ON TABLE public.community_posts, public.community_bookmarks TO service_role;
    GRANT SELECT, DELETE ON TABLE auth.users TO service_role;

    INSERT INTO auth.users (id) VALUES ('${ACTOR_ID}'), ('${OTHER_ID}');

    INSERT INTO public.community_posts (id, author_id, visibility, under_review)
    VALUES
      ('${PUBLIC_POST_ID}', '${OTHER_ID}', 'public', false),
      ('${OTHER_DRAFT_ID}', '${OTHER_ID}', 'draft', false),
      ('${OTHER_REVIEW_ID}', '${OTHER_ID}', 'public', true),
      ('${MEMBERS_POST_ID}', '${OTHER_ID}', 'members', false),
      ('${OWN_DRAFT_ID}', '${ACTOR_ID}', 'draft', false),
      ('${OWN_REVIEW_ID}', '${ACTOR_ID}', 'public', true),
      ('${LEGACY_POLICY_POST_ID}', '${OTHER_ID}', 'public', false);

    INSERT INTO public.community_bookmarks (user_id, post_id)
    VALUES
      ('${ACTOR_ID}', '${PUBLIC_POST_ID}'),
      ('${OTHER_ID}', '${LEGACY_POLICY_POST_ID}');
  `);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
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

describe("community bookmark authorization migration", () => {
  it("revokes authenticated direct bookmark mutations while preserving own reads", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "authenticated", ACTOR_ID);

      const visible = await db.query<{ user_id: string; post_id: string }>(`
        SELECT user_id, post_id FROM public.community_bookmarks
      `);
      expect(visible.rows).toEqual([{ user_id: ACTOR_ID, post_id: PUBLIC_POST_ID }]);

      await resetPersona(db);
      const rls = await db.query<{ enabled: boolean }>(`
        SELECT relrowsecurity AS enabled
        FROM pg_catalog.pg_class
        WHERE oid = 'public.community_bookmarks'::regclass
      `);
      expect(rls.rows).toEqual([{ enabled: true }]);

      await setPersona(db, "authenticated", ACTOR_ID);

      await expect(db.query(`
        INSERT INTO public.community_bookmarks (user_id, post_id)
        VALUES ('${ACTOR_ID}', '${OTHER_DRAFT_ID}')
      `)).rejects.toThrow(/permission denied/i);

      await expect(db.query(`
        DELETE FROM public.community_bookmarks
        WHERE user_id = '${ACTOR_ID}' AND post_id = '${PUBLIC_POST_ID}'
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("exposes an atomic toggle only to the service role and keeps the counter exact", async () => {
    const db = await createDatabase();
    try {
      await db.query(`
        INSERT INTO public.community_bookmarks (user_id, post_id)
        VALUES ('${OTHER_ID}', '${PUBLIC_POST_ID}')
      `);
      await db.exec(migration);
      await setPersona(db, "authenticated", ACTOR_ID);
      await expect(db.query(`
        SELECT public.community_toggle_bookmark('${ACTOR_ID}', '${PUBLIC_POST_ID}')
      `)).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "service_role");

      const removed = await db.query<{
        result: { bookmarked: boolean; bookmark_count: number };
      }>(`
        SELECT public.community_toggle_bookmark(
          '${ACTOR_ID}', '${PUBLIC_POST_ID}'
        ) AS result
      `);
      expect(removed.rows[0]?.result).toEqual({
        bookmarked: false,
        bookmark_count: 1,
      });

      const added = await db.query<{
        result: { bookmarked: boolean; bookmark_count: number };
      }>(`
        SELECT public.community_toggle_bookmark(
          '${ACTOR_ID}', '${PUBLIC_POST_ID}'
        ) AS result
      `);
      expect(added.rows[0]?.result).toEqual({
        bookmarked: true,
        bookmark_count: 2,
      });

      await resetPersona(db);
      const stored = await db.query<{ bookmark_count: number; row_count: number }>(`
        SELECT
          post.bookmark_count,
          count(bookmark.id)::integer AS row_count
        FROM public.community_posts AS post
        LEFT JOIN public.community_bookmarks AS bookmark ON bookmark.post_id = post.id
        WHERE post.id = '${PUBLIC_POST_ID}'
        GROUP BY post.id, post.bookmark_count
      `);
      expect(stored.rows).toEqual([{ bookmark_count: 2, row_count: 2 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed with the same not-found signal for another user's draft and moderated post", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      for (const postId of [OTHER_DRAFT_ID, OTHER_REVIEW_ID]) {
        await expect(db.query(`
          SELECT public.community_toggle_bookmark('${ACTOR_ID}', '${postId}')
        `)).rejects.toThrow(/community_post_not_found/i);
      }

      await resetPersona(db);
      const hiddenBookmarks = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.community_bookmarks
        WHERE user_id = '${ACTOR_ID}'
          AND post_id IN ('${OTHER_DRAFT_ID}', '${OTHER_REVIEW_ID}')
      `);
      expect(hiddenBookmarks.rows).toEqual([{ count: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows members posts plus the actor's own draft and moderated post", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      for (const postId of [MEMBERS_POST_ID, OWN_DRAFT_ID, OWN_REVIEW_ID]) {
        const result = await db.query<{
          result: { bookmarked: boolean; bookmark_count: number };
        }>(`
          SELECT public.community_toggle_bookmark(
            '${ACTOR_ID}', '${postId}'
          ) AS result
        `);
        expect(result.rows[0]?.result).toEqual({
          bookmarked: true,
          bookmark_count: 1,
        });
      }
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("blocks service-role table DML and rejects owner calls without a service JWT role", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await expect(db.query(`
        INSERT INTO public.community_bookmarks (user_id, post_id)
        VALUES ('${ACTOR_ID}', '${OTHER_DRAFT_ID}')
      `)).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await expect(db.query(`
        SELECT public.community_toggle_bookmark('${ACTOR_ID}', '${MEMBERS_POST_ID}')
      `)).rejects.toThrow(/service_role/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves account-deletion FK cascade without service bookmark DML grants", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
      await setPersona(db, "service_role");

      const before = await db.query<{ bookmark_count: number }>(`
        SELECT bookmark_count
        FROM public.community_posts
        WHERE id = '${PUBLIC_POST_ID}'
      `);
      expect(before.rows).toEqual([{ bookmark_count: 1 }]);

      await db.query(`DELETE FROM auth.users WHERE id = '${ACTOR_ID}'`);

      await resetPersona(db);
      const remaining = await db.query<{ count: number; bookmark_count: number }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM public.community_bookmarks
            WHERE user_id = '${ACTOR_ID}'
          ) AS count,
          post.bookmark_count
        FROM public.community_posts AS post
        WHERE post.id = '${PUBLIC_POST_ID}'
      `);
      expect(remaining.rows).toEqual([{ count: 0, bookmark_count: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("does not obstruct a post deletion cascading through bookmarks", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await expect(
        db.query(`DELETE FROM public.community_posts WHERE id = '${PUBLIC_POST_ID}'`),
      ).resolves.toBeDefined();

      await resetPersona(db);
      const remaining = await db.query<{ post_count: number; bookmark_count: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.community_posts
            WHERE id = '${PUBLIC_POST_ID}') AS post_count,
          (SELECT count(*)::integer FROM public.community_bookmarks
            WHERE post_id = '${PUBLIC_POST_ID}') AS bookmark_count
      `);
      expect(remaining.rows).toEqual([{ post_count: 0, bookmark_count: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
