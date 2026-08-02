// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803106000_reconcile_community_reputation.sql",
  ),
  "utf8",
);

const AUTHOR_A = "00000000-0000-4000-8000-000000000001";
const AUTHOR_B = "00000000-0000-4000-8000-000000000002";
const AUTHOR_C = "00000000-0000-4000-8000-000000000003";
const VOTER_A = "00000000-0000-4000-8000-000000000011";
const VOTER_B = "00000000-0000-4000-8000-000000000012";
const VOTER_C = "00000000-0000-4000-8000-000000000013";
const POST_A = "10000000-0000-4000-8000-000000000001";
const POST_B = "10000000-0000-4000-8000-000000000002";
const POST_C = "10000000-0000-4000-8000-000000000003";
const COMMENT_A = "20000000-0000-4000-8000-000000000001";
const COMMENT_B = "20000000-0000-4000-8000-000000000002";
const COMMENT_DELETED = "20000000-0000-4000-8000-000000000003";
const databases: PGlite[] = [];

async function createDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      post_count integer DEFAULT 0,
      comment_count integer DEFAULT 0,
      total_upvotes_received integer DEFAULT 0,
      wedding_completed boolean DEFAULT false,
      rank text DEFAULT 'sprout',
      community_public_id uuid NOT NULL
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      author_public_id uuid NOT NULL
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      author_public_id uuid NOT NULL,
      is_deleted boolean DEFAULT false
    );
    CREATE TABLE public.community_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
      comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      vote_type smallint NOT NULL,
      CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL)
        OR (post_id IS NULL AND comment_id IS NOT NULL)
      ),
      UNIQUE (user_id, post_id),
      UNIQUE (user_id, comment_id)
    );

    CREATE OR REPLACE FUNCTION public.ensure_community_public_identity(
      p_user_id uuid
    ) RETURNS uuid
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    AS $$ SELECT p_user_id $$;

    CREATE OR REPLACE FUNCTION public.bind_community_author_public_identity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    BEGIN
      NEW.author_public_id := NEW.author_id;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER bind_community_post_public_identity
    BEFORE INSERT OR UPDATE OF author_id, author_public_id
    ON public.community_posts
    FOR EACH ROW EXECUTE FUNCTION public.bind_community_author_public_identity();
    CREATE TRIGGER bind_community_comment_public_identity
    BEFORE INSERT OR UPDATE OF author_id, author_public_id
    ON public.community_comments
    FOR EACH ROW EXECUTE FUNCTION public.bind_community_author_public_identity();

    INSERT INTO auth.users (id) VALUES
      ('${AUTHOR_A}'), ('${AUTHOR_B}'), ('${AUTHOR_C}'),
      ('${VOTER_A}'), ('${VOTER_B}'), ('${VOTER_C}');
    INSERT INTO public.community_profiles (
      user_id, post_count, comment_count, total_upvotes_received, rank,
      community_public_id
    ) VALUES
      ('${AUTHOR_A}', 1, 2, 999, 'master', '${AUTHOR_A}'),
      ('${AUTHOR_C}', 0, 0, 999, 'master', '${AUTHOR_C}');
    INSERT INTO public.community_posts (id, author_id, author_public_id) VALUES
      ('${POST_A}', '${AUTHOR_A}', '${AUTHOR_A}'),
      ('${POST_B}', '${AUTHOR_B}', '${AUTHOR_B}'),
      ('${POST_C}', '${AUTHOR_C}', '${AUTHOR_C}');
    INSERT INTO public.community_comments (
      id, post_id, author_id, author_public_id, is_deleted
    ) VALUES
      ('${COMMENT_A}', '${POST_A}', '${AUTHOR_A}', '${AUTHOR_A}', false),
      ('${COMMENT_B}', '${POST_B}', '${AUTHOR_B}', '${AUTHOR_B}', false),
      ('${COMMENT_DELETED}', '${POST_A}', '${AUTHOR_A}', '${AUTHOR_A}', true);
    INSERT INTO public.community_votes (
      user_id, post_id, comment_id, vote_type
    ) VALUES
      ('${VOTER_A}', '${POST_A}', NULL, 1),
      ('${VOTER_B}', NULL, '${COMMENT_A}', 1),
      ('${VOTER_C}', NULL, '${COMMENT_A}', -1),
      ('${VOTER_A}', NULL, '${COMMENT_DELETED}', 1),
      ('${VOTER_B}', '${POST_B}', NULL, 1),
      ('${VOTER_C}', NULL, '${COMMENT_B}', 1);
  `);
  return db;
}

async function profileReputation(db: PGlite, userId: string) {
  return (await db.query<{
    total_upvotes_received: number;
    rank: string;
  }>(`
    SELECT total_upvotes_received, rank
    FROM public.community_profiles
    WHERE user_id = '${userId}'
  `)).rows[0];
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("community reputation migration", () => {
  it("repairs drift idempotently and leaves trigger helpers uncallable", async () => {
    const db = await createDatabase();
    await db.exec(migration);
    await db.exec(migration);

    expect(await profileReputation(db, AUTHOR_A)).toEqual({
      total_upvotes_received: 2,
      rank: "sprout",
    });
    expect(await profileReputation(db, AUTHOR_C)).toEqual({
      total_upvotes_received: 0,
      rank: "sprout",
    });

    const functions = await db.query<{
      name: string;
      owner: string;
      security_definer: boolean;
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_execute: boolean;
    }>(`
      SELECT
        proc.proname AS name,
        pg_catalog.pg_get_userbyid(proc.proowner) AS owner,
        proc.prosecdef AS security_definer,
        pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
          AS anon_execute,
        pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
          AS authenticated_execute,
        pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE')
          AS service_execute
      FROM pg_catalog.pg_proc AS proc
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'public'
        AND proc.proname IN (
          'community_recompute_profile_upvotes',
          'community_vote_reputation_sync',
          'community_content_reputation_sync',
          'community_profile_upvote_guard',
          'community_recalc_rank'
        )
      ORDER BY proc.proname
    `);
    expect(functions.rows).toHaveLength(5);
    for (const fn of functions.rows) {
      expect(fn).toMatchObject({
        owner: "postgres",
        security_definer: true,
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
      });
    }
  });

  it("derives reputation and rank for a profile created after its content", async () => {
    const db = await createDatabase();
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.community_profiles (
        user_id, post_count, comment_count, total_upvotes_received, rank,
        community_public_id
      ) VALUES (
        '${AUTHOR_B}', 5, 0, 999, 'master', '${AUTHOR_B}'
      )
    `);

    expect(await profileReputation(db, AUTHOR_B)).toEqual({
      total_upvotes_received: 2,
      rank: "preparing",
    });
  });

  it("tracks vote insert, update, retarget, delete, and voter cascade", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    await db.exec(`
      INSERT INTO public.community_votes (user_id, post_id, vote_type)
      VALUES ('${VOTER_C}', '${POST_A}', 1)
    `);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(3);

    await db.exec(`
      UPDATE public.community_votes
      SET vote_type = -1
      WHERE user_id = '${VOTER_C}' AND post_id = '${POST_A}'
    `);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(2);

    await db.exec(`
      UPDATE public.community_votes
      SET post_id = '${POST_C}', vote_type = 1
      WHERE user_id = '${VOTER_C}' AND post_id = '${POST_A}'
    `);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(2);
    expect((await profileReputation(db, AUTHOR_C))?.total_upvotes_received).toBe(1);

    await db.exec(`DELETE FROM auth.users WHERE id = '${VOTER_C}'`);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(2);
    expect((await profileReputation(db, AUTHOR_C))?.total_upvotes_received).toBe(0);
  });

  it("moves reputation and public identity on trusted re-author operations", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    await db.exec(`
      UPDATE public.community_posts
      SET author_id = '${AUTHOR_C}'
      WHERE id = '${POST_A}'
    `);
    const post = await db.query<{ author_id: string; author_public_id: string }>(`
      SELECT author_id, author_public_id
      FROM public.community_posts
      WHERE id = '${POST_A}'
    `);
    expect(post.rows).toEqual([{
      author_id: AUTHOR_C,
      author_public_id: AUTHOR_C,
    }]);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(1);
    expect((await profileReputation(db, AUTHOR_C))?.total_upvotes_received).toBe(1);

    await db.exec(`
      UPDATE public.community_comments
      SET author_id = '${AUTHOR_C}'
      WHERE id = '${COMMENT_A}'
    `);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(0);
    expect((await profileReputation(db, AUTHOR_C))?.total_upvotes_received).toBe(2);

    await expect(db.exec(`
      UPDATE public.community_posts
      SET author_public_id = '${AUTHOR_A}'
      WHERE id = '${POST_A}'
    `)).rejects.toThrow(/COMMUNITY_AUTHOR_PUBLIC_ID_IMMUTABLE/);
  });

  it("removes soft-deleted and cascade-deleted content from reputation", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    await db.exec(`
      UPDATE public.community_comments
      SET is_deleted = true
      WHERE id = '${COMMENT_A}'
    `);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(1);

    await db.exec(`
      UPDATE public.community_comments
      SET is_deleted = false
      WHERE id = '${COMMENT_A}'
    `);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(2);

    await db.exec(`DELETE FROM public.community_posts WHERE id = '${POST_A}'`);
    expect((await profileReputation(db, AUTHOR_A))?.total_upvotes_received).toBe(0);
  });

  it("normalizes direct reputation and rank drift", async () => {
    const db = await createDatabase();
    await db.exec(migration);
    await db.exec(`
      UPDATE public.community_profiles
      SET total_upvotes_received = 999, rank = 'master'
      WHERE user_id = '${AUTHOR_A}'
    `);

    expect(await profileReputation(db, AUTHOR_A)).toEqual({
      total_upvotes_received: 2,
      rank: "sprout",
    });
  });
});
