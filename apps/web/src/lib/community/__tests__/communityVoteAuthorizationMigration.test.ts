// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802146000_harden_community_vote_rpc_serialization.sql",
  ),
  "utf8",
);

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const DRAFT_POST_ID = "10000000-0000-4000-8000-000000000001";
const REVIEW_POST_ID = "10000000-0000-4000-8000-000000000002";
const PUBLIC_POST_ID = "10000000-0000-4000-8000-000000000003";
const MEMBERS_POST_ID = "10000000-0000-4000-8000-000000000004";
const OWN_DRAFT_POST_ID = "10000000-0000-4000-8000-000000000005";
const OWN_REVIEW_POST_ID = "10000000-0000-4000-8000-000000000006";
const MISSING_POST_ID = "10000000-0000-4000-8000-000000000099";
const DRAFT_COMMENT_ID = "20000000-0000-4000-8000-000000000001";
const REVIEW_COMMENT_ID = "20000000-0000-4000-8000-000000000002";
const DELETED_COMMENT_ID = "20000000-0000-4000-8000-000000000003";
const PUBLIC_COMMENT_ID = "20000000-0000-4000-8000-000000000004";
const MEMBERS_COMMENT_ID = "20000000-0000-4000-8000-000000000005";
const OWN_DRAFT_COMMENT_ID = "20000000-0000-4000-8000-000000000006";
const OWN_REVIEW_COMMENT_ID = "20000000-0000-4000-8000-000000000007";
const MISSING_COMMENT_ID = "20000000-0000-4000-8000-000000000099";

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
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false,
      upvote_count integer NOT NULL DEFAULT 0,
      downvote_count integer NOT NULL DEFAULT 0
    );

    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      is_deleted boolean NOT NULL DEFAULT false,
      upvote_count integer NOT NULL DEFAULT 0
    );

    CREATE TABLE public.community_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
      comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      vote_type smallint NOT NULL CHECK (vote_type IN (1, -1)),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL)
        OR (post_id IS NULL AND comment_id IS NOT NULL)
      ),
      UNIQUE (user_id, post_id),
      UNIQUE (user_id, comment_id)
    );

    CREATE FUNCTION public.community_vote_post(
      p_user_id uuid,
      p_post_id uuid,
      p_vote_type smallint
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;

      IF p_vote_type = 0 THEN
        DELETE FROM public.community_votes
        WHERE user_id = p_user_id AND post_id = p_post_id;
      ELSE
        INSERT INTO public.community_votes (user_id, post_id, vote_type)
        VALUES (p_user_id, p_post_id, 1)
        ON CONFLICT (user_id, post_id)
        DO UPDATE SET vote_type = EXCLUDED.vote_type;
      END IF;
    END;
    $$;

    CREATE FUNCTION public.community_vote_comment(
      p_user_id uuid,
      p_comment_id uuid,
      p_vote_type smallint
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;

      IF p_vote_type = 0 THEN
        DELETE FROM public.community_votes
        WHERE user_id = p_user_id AND comment_id = p_comment_id;
      ELSE
        INSERT INTO public.community_votes (user_id, comment_id, vote_type)
        VALUES (p_user_id, p_comment_id, p_vote_type)
        ON CONFLICT (user_id, comment_id)
        DO UPDATE SET vote_type = EXCLUDED.vote_type;
      END IF;
    END;
    $$;

    CREATE FUNCTION public.community_vote_target_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    DECLARE
      target_author uuid;
      target_visibility text;
      target_under_review boolean;
    BEGIN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND (auth.uid() IS NULL OR auth.uid() <> NEW.user_id) THEN
        RAISE EXCEPTION 'vote_user_mismatch' USING ERRCODE = '42501';
      END IF;

      IF NEW.post_id IS NOT NULL THEN
        SELECT post.author_id, post.visibility, post.under_review
        INTO target_author, target_visibility, target_under_review
        FROM public.community_posts AS post
        WHERE post.id = NEW.post_id;
      ELSE
        SELECT post.author_id, post.visibility, post.under_review
        INTO target_author, target_visibility, target_under_review
        FROM public.community_comments AS comment
        JOIN public.community_posts AS post ON post.id = comment.post_id
        WHERE comment.id = NEW.comment_id
          AND comment.is_deleted IS FALSE;
      END IF;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'vote_target_not_found' USING ERRCODE = '23503';
      END IF;

      IF COALESCE(auth.role(), '') = 'service_role' THEN
        RETURN NEW;
      END IF;

      IF (COALESCE(target_under_review, false) AND target_author <> NEW.user_id)
         OR (
           target_visibility NOT IN ('public', 'members')
           AND NOT (target_visibility = 'draft' AND target_author = NEW.user_id)
         ) THEN
        RAISE EXCEPTION 'vote_target_not_accessible' USING ERRCODE = '42501';
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trg_community_vote_target_guard
    BEFORE INSERT OR UPDATE ON public.community_votes
    FOR EACH ROW EXECUTE FUNCTION public.community_vote_target_guard();

    REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.community_vote_post(uuid, uuid, smallint)
      TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.community_vote_comment(uuid, uuid, smallint)
      TO authenticated, service_role;
    GRANT ALL ON TABLE public.community_votes TO service_role;

    INSERT INTO auth.users (id) VALUES ('${ACTOR_ID}'), ('${OTHER_ID}');
    INSERT INTO public.community_posts (
      id, author_id, visibility, under_review
    ) VALUES
      ('${DRAFT_POST_ID}', '${OTHER_ID}', 'draft', false),
      ('${REVIEW_POST_ID}', '${OTHER_ID}', 'public', true),
      ('${PUBLIC_POST_ID}', '${OTHER_ID}', 'public', false),
      ('${MEMBERS_POST_ID}', '${OTHER_ID}', 'members', false),
      ('${OWN_DRAFT_POST_ID}', '${ACTOR_ID}', 'draft', false),
      ('${OWN_REVIEW_POST_ID}', '${ACTOR_ID}', 'public', true);

    INSERT INTO public.community_comments (
      id, post_id, author_id, is_deleted
    ) VALUES
      ('${DRAFT_COMMENT_ID}', '${DRAFT_POST_ID}', '${OTHER_ID}', false),
      ('${REVIEW_COMMENT_ID}', '${REVIEW_POST_ID}', '${OTHER_ID}', false),
      ('${DELETED_COMMENT_ID}', '${PUBLIC_POST_ID}', '${OTHER_ID}', true),
      ('${PUBLIC_COMMENT_ID}', '${PUBLIC_POST_ID}', '${OTHER_ID}', false),
      ('${MEMBERS_COMMENT_ID}', '${MEMBERS_POST_ID}', '${OTHER_ID}', false),
      ('${OWN_DRAFT_COMMENT_ID}', '${OWN_DRAFT_POST_ID}', '${ACTOR_ID}', false),
      ('${OWN_REVIEW_COMMENT_ID}', '${OWN_REVIEW_POST_ID}', '${ACTOR_ID}', false);

    SELECT set_config('request.jwt.claim.role', 'service_role', false);
    INSERT INTO public.community_votes (user_id, post_id, vote_type)
    VALUES ('${OTHER_ID}', '${PUBLIC_POST_ID}', 1);
    INSERT INTO public.community_votes (user_id, comment_id, vote_type)
    VALUES ('${OTHER_ID}', '${PUBLIC_COMMENT_ID}', 1);
    UPDATE public.community_posts
    SET upvote_count = 91, downvote_count = 37
    WHERE id = '${PUBLIC_POST_ID}';
    UPDATE public.community_comments
    SET upvote_count = 73
    WHERE id = '${PUBLIC_COMMENT_ID}';
    SELECT set_config('request.jwt.claim.role', '', false);
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

async function captureDatabaseError(db: PGlite, sql: string) {
  try {
    await db.query(sql);
  } catch (caught) {
    const error = caught as { code?: string; message?: string };
    return { code: error.code, message: error.message };
  }
  throw new Error("Expected the database operation to fail");
}

describe("community vote authorization migration", () => {
  it("uses one not-found signal for hidden, moderated, and nonexistent post targets", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "authenticated", ACTOR_ID);

      const failures = [];
      for (const postId of [DRAFT_POST_ID, REVIEW_POST_ID, MISSING_POST_ID]) {
        failures.push(await captureDatabaseError(db, `
          SELECT public.community_vote_post(
            '${ACTOR_ID}', '${postId}', 1::smallint
          )
        `));
      }

      expect(failures).toEqual([
        { code: "P0002", message: "community_vote_target_not_found" },
        { code: "P0002", message: "community_vote_target_not_found" },
        { code: "P0002", message: "community_vote_target_not_found" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("uses one not-found signal for hidden, deleted, and nonexistent comment targets", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "authenticated", ACTOR_ID);

      const failures = [];
      for (const commentId of [
        DRAFT_COMMENT_ID,
        REVIEW_COMMENT_ID,
        DELETED_COMMENT_ID,
        MISSING_COMMENT_ID,
      ]) {
        failures.push(await captureDatabaseError(db, `
          SELECT public.community_vote_comment(
            '${ACTOR_ID}', '${commentId}', 1::smallint
          )
        `));
      }

      expect(failures).toEqual([
        { code: "P0002", message: "community_vote_target_not_found" },
        { code: "P0002", message: "community_vote_target_not_found" },
        { code: "P0002", message: "community_vote_target_not_found" },
        { code: "P0002", message: "community_vote_target_not_found" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("repairs stale counters and recounts actual vote rows after every mutation", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      const repaired = await db.query<{
        post_upvotes: number;
        post_downvotes: number;
        comment_upvotes: number;
      }>(`
        SELECT
          post.upvote_count AS post_upvotes,
          post.downvote_count AS post_downvotes,
          comment.upvote_count AS comment_upvotes
        FROM public.community_posts AS post
        JOIN public.community_comments AS comment
          ON comment.id = '${PUBLIC_COMMENT_ID}'
        WHERE post.id = '${PUBLIC_POST_ID}'
      `);
      expect(repaired.rows).toEqual([{
        post_upvotes: 1,
        post_downvotes: 0,
        comment_upvotes: 1,
      }]);

      await setPersona(db, "authenticated", ACTOR_ID);
      await db.query(`SELECT public.community_vote_post(
        '${ACTOR_ID}', '${PUBLIC_POST_ID}', 1::smallint
      )`);
      await db.query(`SELECT public.community_vote_post(
        '${ACTOR_ID}', '${PUBLIC_POST_ID}', 1::smallint
      )`);
      await db.query(`SELECT public.community_vote_comment(
        '${ACTOR_ID}', '${PUBLIC_COMMENT_ID}', -1::smallint
      )`);
      await db.query(`SELECT public.community_vote_comment(
        '${ACTOR_ID}', '${PUBLIC_COMMENT_ID}', 1::smallint
      )`);

      await resetPersona(db);
      const afterLikes = await db.query<{
        post_upvotes: number;
        post_rows: number;
        comment_upvotes: number;
        comment_upvote_rows: number;
      }>(`
        SELECT
          post.upvote_count AS post_upvotes,
          (
            SELECT count(*)::integer
            FROM public.community_votes
            WHERE post_id = post.id AND vote_type = 1
          ) AS post_rows,
          comment.upvote_count AS comment_upvotes,
          (
            SELECT count(*)::integer
            FROM public.community_votes
            WHERE comment_id = comment.id AND vote_type = 1
          ) AS comment_upvote_rows
        FROM public.community_posts AS post
        JOIN public.community_comments AS comment
          ON comment.id = '${PUBLIC_COMMENT_ID}'
        WHERE post.id = '${PUBLIC_POST_ID}'
      `);
      expect(afterLikes.rows).toEqual([{
        post_upvotes: 2,
        post_rows: 2,
        comment_upvotes: 2,
        comment_upvote_rows: 2,
      }]);

      await db.exec(`
        UPDATE public.community_posts SET upvote_count = 999
        WHERE id = '${PUBLIC_POST_ID}';
        UPDATE public.community_comments SET upvote_count = 999
        WHERE id = '${PUBLIC_COMMENT_ID}';
      `);
      await setPersona(db, "authenticated", ACTOR_ID);
      await db.query(`SELECT public.community_vote_post(
        '${ACTOR_ID}', '${PUBLIC_POST_ID}', 0::smallint
      )`);
      await db.query(`SELECT public.community_vote_comment(
        '${ACTOR_ID}', '${PUBLIC_COMMENT_ID}', 0::smallint
      )`);

      await resetPersona(db);
      const afterRemoval = await db.query<{
        post_upvotes: number;
        comment_upvotes: number;
      }>(`
        SELECT
          post.upvote_count AS post_upvotes,
          comment.upvote_count AS comment_upvotes
        FROM public.community_posts AS post
        JOIN public.community_comments AS comment
          ON comment.id = '${PUBLIC_COMMENT_ID}'
        WHERE post.id = '${PUBLIC_POST_ID}'
      `);
      expect(afterRemoval.rows).toEqual([{
        post_upvotes: 1,
        comment_upvotes: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows members targets plus the actor's own draft and moderated targets", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "authenticated", ACTOR_ID);

      for (const postId of [
        MEMBERS_POST_ID,
        OWN_DRAFT_POST_ID,
        OWN_REVIEW_POST_ID,
      ]) {
        await expect(db.query(`SELECT public.community_vote_post(
          '${ACTOR_ID}', '${postId}', 1::smallint
        )`)).resolves.toBeDefined();
      }

      for (const commentId of [
        MEMBERS_COMMENT_ID,
        OWN_DRAFT_COMMENT_ID,
        OWN_REVIEW_COMMENT_ID,
      ]) {
        await expect(db.query(`SELECT public.community_vote_comment(
          '${ACTOR_ID}', '${commentId}', 1::smallint
        )`)).resolves.toBeDefined();
      }

      await resetPersona(db);
      const votes = await db.query<{ post_votes: number; comment_votes: number }>(`
        SELECT
          count(*) FILTER (WHERE post_id IS NOT NULL)::integer AS post_votes,
          count(*) FILTER (WHERE comment_id IS NOT NULL)::integer AS comment_votes
        FROM public.community_votes
        WHERE user_id = '${ACTOR_ID}'
      `);
      expect(votes.rows).toEqual([{ post_votes: 3, comment_votes: 3 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("binds authenticated actors and applies the same visibility rules to service calls and direct writes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "authenticated", ACTOR_ID);

      for (const sql of [
        `SELECT public.community_vote_post(
          '${OTHER_ID}', '${PUBLIC_POST_ID}', 1::smallint
        )`,
        `SELECT public.community_vote_comment(
          '${OTHER_ID}', '${PUBLIC_COMMENT_ID}', 1::smallint
        )`,
        `SELECT public.community_vote_post(
          '${OTHER_ID}', '${MISSING_POST_ID}', 1::smallint
        )`,
      ]) {
        await expect(db.query(sql)).rejects.toThrow(/community_vote_user_mismatch/i);
      }

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(db.query(`SELECT public.community_vote_post(
        '${ACTOR_ID}', '${PUBLIC_POST_ID}', 1::smallint
      )`)).resolves.toBeDefined();

      const rpcFailures = [];
      for (const postId of [DRAFT_POST_ID, MISSING_POST_ID]) {
        rpcFailures.push(await captureDatabaseError(db, `
          SELECT public.community_vote_post(
            '${ACTOR_ID}', '${postId}', 1::smallint
          )
        `));
      }
      expect(rpcFailures).toEqual([
        { code: "P0002", message: "community_vote_target_not_found" },
        { code: "P0002", message: "community_vote_target_not_found" },
      ]);

      const directFailures = [];
      for (const postId of [DRAFT_POST_ID, MISSING_POST_ID]) {
        directFailures.push(await captureDatabaseError(db, `
          INSERT INTO public.community_votes (user_id, post_id, vote_type)
          VALUES ('${ACTOR_ID}', '${postId}', 1)
        `));
      }
      expect(directFailures).toEqual([
        { code: "P0002", message: "community_vote_target_not_found" },
        { code: "P0002", message: "community_vote_target_not_found" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps post and comment counters exact when account deletion cascades votes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "authenticated", ACTOR_ID);
      await db.query(`SELECT public.community_vote_post(
        '${ACTOR_ID}', '${PUBLIC_POST_ID}', 1::smallint
      )`);
      await db.query(`SELECT public.community_vote_comment(
        '${ACTOR_ID}', '${PUBLIC_COMMENT_ID}', 1::smallint
      )`);

      await resetPersona(db);
      await db.query(`DELETE FROM auth.users WHERE id = '${ACTOR_ID}'`);

      const afterCascade = await db.query<{
        post_counter: number;
        post_rows: number;
        comment_counter: number;
        comment_rows: number;
      }>(`
        SELECT
          post.upvote_count AS post_counter,
          (
            SELECT count(*)::integer
            FROM public.community_votes
            WHERE post_id = post.id AND vote_type = 1
          ) AS post_rows,
          comment.upvote_count AS comment_counter,
          (
            SELECT count(*)::integer
            FROM public.community_votes
            WHERE comment_id = comment.id AND vote_type = 1
          ) AS comment_rows
        FROM public.community_posts AS post
        JOIN public.community_comments AS comment
          ON comment.id = '${PUBLIC_COMMENT_ID}'
        WHERE post.id = '${PUBLIC_POST_ID}'
      `);
      expect(afterCascade.rows).toEqual([{
        post_counter: 1,
        post_rows: 1,
        comment_counter: 1,
        comment_rows: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows a post cascade to finish before deferred vote cleanup runs", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        DELETE FROM public.community_posts
        WHERE id = '${PUBLIC_POST_ID}'
      `);

      const remaining = await db.query<{
        posts: number;
        comments: number;
        votes: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.community_posts
            WHERE id = '${PUBLIC_POST_ID}') AS posts,
          (SELECT count(*)::integer FROM public.community_comments
            WHERE post_id = '${PUBLIC_POST_ID}') AS comments,
          (SELECT count(*)::integer FROM public.community_votes
            WHERE post_id = '${PUBLIC_POST_ID}'
               OR comment_id IN ('${PUBLIC_COMMENT_ID}', '${DELETED_COMMENT_ID}')) AS votes
      `);
      expect(remaining.rows).toEqual([{ posts: 0, comments: 0, votes: 0 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows a comment cascade to finish before deferred vote cleanup runs", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        DELETE FROM public.community_comments
        WHERE id = '${PUBLIC_COMMENT_ID}'
      `);

      const remaining = await db.query<{
        posts: number;
        comments: number;
        comment_votes: number;
        post_upvotes: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.community_posts
            WHERE id = '${PUBLIC_POST_ID}') AS posts,
          (SELECT count(*)::integer FROM public.community_comments
            WHERE id = '${PUBLIC_COMMENT_ID}') AS comments,
          (SELECT count(*)::integer FROM public.community_votes
            WHERE comment_id = '${PUBLIC_COMMENT_ID}') AS comment_votes,
          (SELECT upvote_count FROM public.community_posts
            WHERE id = '${PUBLIC_POST_ID}') AS post_upvotes
      `);
      expect(remaining.rows).toEqual([{
        posts: 1,
        comments: 0,
        comment_votes: 0,
        post_upvotes: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("pins function authority, exact caller grants, and the insert/update target trigger", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      const metadata = await db.query<{
        name: string;
        owner: string;
        security_definer: boolean;
        config: string[];
      }>(`
        SELECT
          proc.proname AS name,
          pg_catalog.pg_get_userbyid(proc.proowner) AS owner,
          proc.prosecdef AS security_definer,
          proc.proconfig AS config
        FROM pg_catalog.pg_proc AS proc
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = proc.pronamespace
        WHERE namespace.nspname = 'public'
          AND proc.proname IN (
            'community_vote_post',
            'community_vote_comment',
            'community_vote_target_guard',
            'community_vote_delete_counter_sync'
          )
        ORDER BY proc.proname
      `);
      expect(metadata.rows).toEqual([
        {
          name: "community_vote_comment",
          owner: "postgres",
          security_definer: true,
          config: ['search_path=""'],
        },
        {
          name: "community_vote_delete_counter_sync",
          owner: "postgres",
          security_definer: true,
          config: ['search_path=""'],
        },
        {
          name: "community_vote_post",
          owner: "postgres",
          security_definer: true,
          config: ['search_path=""'],
        },
        {
          name: "community_vote_target_guard",
          owner: "postgres",
          security_definer: true,
          config: ['search_path=""'],
        },
      ]);

      const grants = await db.query<{
        anon_post: boolean;
        auth_post: boolean;
        service_post: boolean;
        anon_comment: boolean;
        auth_comment: boolean;
        service_comment: boolean;
        anon_guard: boolean;
        auth_guard: boolean;
        service_guard: boolean;
        anon_delete_sync: boolean;
        auth_delete_sync: boolean;
        service_delete_sync: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'anon', 'public.community_vote_post(uuid,uuid,smallint)', 'EXECUTE'
          ) AS anon_post,
          has_function_privilege(
            'authenticated', 'public.community_vote_post(uuid,uuid,smallint)', 'EXECUTE'
          ) AS auth_post,
          has_function_privilege(
            'service_role', 'public.community_vote_post(uuid,uuid,smallint)', 'EXECUTE'
          ) AS service_post,
          has_function_privilege(
            'anon', 'public.community_vote_comment(uuid,uuid,smallint)', 'EXECUTE'
          ) AS anon_comment,
          has_function_privilege(
            'authenticated', 'public.community_vote_comment(uuid,uuid,smallint)', 'EXECUTE'
          ) AS auth_comment,
          has_function_privilege(
            'service_role', 'public.community_vote_comment(uuid,uuid,smallint)', 'EXECUTE'
          ) AS service_comment,
          has_function_privilege(
            'anon', 'public.community_vote_target_guard()', 'EXECUTE'
          ) AS anon_guard,
          has_function_privilege(
            'authenticated', 'public.community_vote_target_guard()', 'EXECUTE'
          ) AS auth_guard,
          has_function_privilege(
            'service_role', 'public.community_vote_target_guard()', 'EXECUTE'
          ) AS service_guard,
          has_function_privilege(
            'anon', 'public.community_vote_delete_counter_sync()', 'EXECUTE'
          ) AS anon_delete_sync,
          has_function_privilege(
            'authenticated', 'public.community_vote_delete_counter_sync()', 'EXECUTE'
          ) AS auth_delete_sync,
          has_function_privilege(
            'service_role', 'public.community_vote_delete_counter_sync()', 'EXECUTE'
          ) AS service_delete_sync
      `);
      expect(grants.rows).toEqual([{
        anon_post: false,
        auth_post: true,
        service_post: true,
        anon_comment: false,
        auth_comment: true,
        service_comment: true,
        anon_guard: false,
        auth_guard: false,
        service_guard: false,
        anon_delete_sync: false,
        auth_delete_sync: false,
        service_delete_sync: false,
      }]);

      const trigger = await db.query<{
        trigger_count: number;
        trigger_type: number;
        function_name: string;
      }>(`
        SELECT
          count(*)::integer AS trigger_count,
          min(trigger.tgtype)::integer AS trigger_type,
          min(proc.proname) AS function_name
        FROM pg_catalog.pg_trigger AS trigger
        JOIN pg_catalog.pg_proc AS proc ON proc.oid = trigger.tgfoid
        WHERE trigger.tgrelid = 'public.community_votes'::regclass
          AND trigger.tgname = 'trg_community_vote_target_guard'
          AND trigger.tgisinternal IS FALSE
      `);
      expect(trigger.rows).toEqual([{
        trigger_count: 1,
        trigger_type: 23,
        function_name: "community_vote_target_guard",
      }]);

      const deleteTrigger = await db.query<{
        trigger_count: number;
        trigger_type: number;
        function_name: string;
        constraint_trigger: boolean;
        deferrable: boolean;
        initially_deferred: boolean;
      }>(`
        SELECT
          count(*)::integer AS trigger_count,
          min(trigger.tgtype)::integer AS trigger_type,
          min(proc.proname) AS function_name,
          bool_and(trigger.tgconstraint <> 0::oid) AS constraint_trigger,
          bool_and(trigger.tgdeferrable) AS deferrable,
          bool_and(trigger.tginitdeferred) AS initially_deferred
        FROM pg_catalog.pg_trigger AS trigger
        JOIN pg_catalog.pg_proc AS proc ON proc.oid = trigger.tgfoid
        WHERE trigger.tgrelid = 'public.community_votes'::regclass
          AND trigger.tgname = 'trg_community_vote_delete_counter_sync'
          AND trigger.tgisinternal IS FALSE
      `);
      expect(deleteTrigger.rows).toEqual([{
        trigger_count: 1,
        trigger_type: 9,
        function_name: "community_vote_delete_counter_sync",
        constraint_trigger: true,
        deferrable: true,
        initially_deferred: true,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
