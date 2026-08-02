// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803107000_atomic_community_content_creation.sql",
  ),
  "utf8",
);

const ACTOR = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PUBLIC_POST = "10000000-0000-4000-8000-000000000001";
const DRAFT_POST = "10000000-0000-4000-8000-000000000002";
const ROOT_COMMENT = "20000000-0000-4000-8000-000000000001";
const REPLY_COMMENT = "20000000-0000-4000-8000-000000000002";
const DELETED_COMMENT = "20000000-0000-4000-8000-000000000003";
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
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      nickname text NOT NULL UNIQUE,
      avatar_url text,
      badge text DEFAULT 'member',
      post_count integer DEFAULT 0,
      comment_count integer DEFAULT 0,
      total_upvotes_received integer DEFAULT 0,
      rank text DEFAULT 'sprout',
      wedding_completed boolean DEFAULT false,
      is_suspended boolean DEFAULT false,
      community_public_id uuid
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      author_public_id uuid,
      category text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      images text[] DEFAULT '{}',
      slides jsonb,
      visibility text NOT NULL,
      vendor_tags uuid[] DEFAULT '{}',
      tags text[] DEFAULT '{}',
      cost_data jsonb,
      ad_disclosure text NOT NULL,
      sponsorship_detail text,
      price_data jsonb,
      is_quick_review boolean DEFAULT false,
      rating smallint,
      under_review boolean DEFAULT false,
      upvote_count integer DEFAULT 0,
      downvote_count integer DEFAULT 0,
      comment_count integer DEFAULT 0,
      view_count integer DEFAULT 0,
      bookmark_count integer DEFAULT 0,
      is_pinned boolean DEFAULT false,
      is_weekly_best boolean DEFAULT false
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      author_public_id uuid,
      content text NOT NULL,
      upvote_count integer DEFAULT 0,
      is_deleted boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.community_polls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL UNIQUE REFERENCES public.community_posts(id) ON DELETE CASCADE,
      question text NOT NULL,
      allow_multiple boolean NOT NULL DEFAULT false,
      is_anonymous boolean NOT NULL DEFAULT false,
      hide_results_until_voted boolean NOT NULL DEFAULT false,
      closes_at timestamptz,
      total_voters integer NOT NULL DEFAULT 0,
      total_votes integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.community_poll_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
      position integer NOT NULL,
      label text NOT NULL,
      image_url text,
      vote_count integer NOT NULL DEFAULT 0,
      UNIQUE (poll_id, position)
    );

    CREATE OR REPLACE FUNCTION public.ensure_community_public_identity(
      p_user_id uuid
    ) RETURNS uuid
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    AS $$ SELECT p_user_id $$;
    CREATE OR REPLACE FUNCTION public.bind_profile_identity()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    BEGIN
      NEW.community_public_id := NEW.user_id;
      RETURN NEW;
    END;
    $$;
    CREATE OR REPLACE FUNCTION public.bind_author_identity()
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
    CREATE TRIGGER bind_profile_identity
    BEFORE INSERT ON public.community_profiles
    FOR EACH ROW EXECUTE FUNCTION public.bind_profile_identity();
    CREATE TRIGGER bind_post_identity
    BEFORE INSERT ON public.community_posts
    FOR EACH ROW EXECUTE FUNCTION public.bind_author_identity();
    CREATE TRIGGER bind_comment_identity
    BEFORE INSERT ON public.community_comments
    FOR EACH ROW EXECUTE FUNCTION public.bind_author_identity();

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

    INSERT INTO auth.users (id) VALUES ('${ACTOR}'), ('${OTHER}');
    INSERT INTO public.community_posts (
      id, author_id, category, title, content, visibility, ad_disclosure
    ) VALUES
      ('${PUBLIC_POST}', '${OTHER}', 'free', 'public', 'body', 'public', 'general'),
      ('${DRAFT_POST}', '${OTHER}', 'free', 'draft', 'body', 'draft', 'general');
    INSERT INTO public.community_comments (
      id, post_id, parent_id, author_id, content, is_deleted
    ) VALUES
      ('${ROOT_COMMENT}', '${PUBLIC_POST}', NULL, '${OTHER}', 'root', false),
      ('${REPLY_COMMENT}', '${PUBLIC_POST}', '${ROOT_COMMENT}', '${OTHER}', 'reply', false),
      ('${DELETED_COMMENT}', '${PUBLIC_POST}', NULL, '${OTHER}', 'deleted', true);
  `);
  await db.exec(migration);
  await db.exec(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
  return db;
}

function nickname(userId: string) {
  return `user-${userId.replaceAll("-", "").slice(0, 8)}`;
}

function commentCall({
  postId = PUBLIC_POST,
  parentId = "NULL",
  content = "safe comment",
}: {
  postId?: string;
  parentId?: string;
  content?: string;
} = {}) {
  return `
    SELECT created.id
    FROM public.community_create_comment_atomic(
      '${ACTOR}',
      '${postId}',
      ${parentId},
      '${content}',
      '${nickname(ACTOR)}'
    ) AS created
  `;
}

function postCall(poll: string | null = null) {
  const pollSql = poll === null ? "NULL" : `'${poll.replaceAll("'", "''")}'::jsonb`;
  return `
    SELECT created.id
    FROM public.community_create_post_with_poll_atomic(
      '${ACTOR}',
      '${nickname(ACTOR)}',
      'free',
      'atomic post',
      'safe body',
      ARRAY[]::text[],
      NULL,
      'public',
      ARRAY[]::uuid[],
      ARRAY['tag']::text[],
      NULL,
      'general',
      NULL,
      NULL,
      false,
      NULL,
      ${pollSql}
    ) AS created
  `;
}

async function rowCounts(db: PGlite) {
  return (await db.query<{
    profiles: number;
    posts: number;
    comments: number;
    polls: number;
    options: number;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM public.community_profiles) AS profiles,
      (SELECT count(*)::integer FROM public.community_posts) AS posts,
      (SELECT count(*)::integer FROM public.community_comments) AS comments,
      (SELECT count(*)::integer FROM public.community_polls) AS polls,
      (SELECT count(*)::integer FROM public.community_poll_options) AS options
  `)).rows[0];
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("atomic community creation migration", () => {
  it("holds mutation-conflicting locks across comment authorization and insert", () => {
    const commentFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.community_create_comment_atomic"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.community_create_post_with_poll_atomic"),
    );
    const postFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.community_create_post_with_poll_atomic"),
      migration.indexOf("ALTER FUNCTION public.community_create_comment_atomic"),
    );

    expect(commentFunction).toMatch(
      /FROM public\.community_posts AS post[\s\S]*?WHERE post\.id = p_post_id[\s\S]*?FOR UPDATE;/,
    );
    expect(commentFunction).toMatch(
      /FROM public\.community_comments AS comment[\s\S]*?WHERE comment\.id = p_parent_id[\s\S]*?FOR UPDATE;/,
    );
    expect(commentFunction).toMatch(
      /FROM public\.community_profiles AS profile[\s\S]*?WHERE profile\.user_id = p_actor_id[\s\S]*?FOR UPDATE;/,
    );
    expect(postFunction).toMatch(
      /FROM public\.community_profiles AS profile[\s\S]*?WHERE profile\.user_id = p_actor_id[\s\S]*?FOR UPDATE;/,
    );
  });

  it("installs idempotently with service-only execution", async () => {
    const db = await createDatabase();
    await db.exec(migration);

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
          'community_create_comment_atomic',
          'community_create_post_with_poll_atomic'
        )
      ORDER BY proc.proname
    `);
    expect(functions.rows).toEqual([
      {
        name: "community_create_comment_atomic",
        owner: "postgres",
        security_definer: true,
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
      },
      {
        name: "community_create_post_with_poll_atomic",
        owner: "postgres",
        security_definer: true,
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
      },
    ]);

    await db.exec(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`);
    await expect(db.exec(commentCall())).rejects.toThrow(
      /community_create_service_role_required/,
    );
  });

  it("creates profile and comment in one call after revalidating the target", async () => {
    const db = await createDatabase();
    const before = await rowCounts(db);
    const result = await db.query<{ id: string }>(commentCall());

    expect(result.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await rowCounts(db)).toEqual({
      ...before,
      profiles: (before?.profiles ?? 0) + 1,
      comments: (before?.comments ?? 0) + 1,
    });
  });

  it("rejects inaccessible posts and invalid parent relationships without writes", async () => {
    const db = await createDatabase();
    const before = await rowCounts(db);

    await expect(db.exec(commentCall({ postId: DRAFT_POST }))).rejects.toThrow(
      /community_comment_target_not_found/,
    );
    await expect(db.exec(commentCall({
      parentId: `'${REPLY_COMMENT}'`,
    }))).rejects.toThrow(/community_comment_depth_exceeded/);
    await expect(db.exec(commentCall({
      parentId: `'${DELETED_COMMENT}'`,
    }))).rejects.toThrow(/community_comment_parent_not_found/);

    expect(await rowCounts(db)).toEqual(before);
  });

  it("fails closed for a suspended community actor", async () => {
    const db = await createDatabase();
    await db.exec(`
      INSERT INTO public.community_profiles (user_id, nickname, is_suspended)
      VALUES ('${ACTOR}', '${nickname(ACTOR)}', true)
    `);
    const before = await rowCounts(db);

    await expect(db.exec(commentCall())).rejects.toThrow(
      /community_create_actor_suspended/,
    );
    await expect(db.exec(postCall())).rejects.toThrow(
      /community_create_actor_suspended/,
    );
    expect(await rowCounts(db)).toEqual(before);
  });

  it("creates post, poll, and options atomically", async () => {
    const db = await createDatabase();
    const before = await rowCounts(db);
    const poll = JSON.stringify({
      question: "pick one",
      options: [
        { position: 0, label: "one", image_url: null },
        { position: 1, label: "two", image_url: null },
      ],
      allow_multiple: false,
      is_anonymous: true,
      hide_results_until_voted: true,
      closes_at: null,
    });

    const result = await db.query<{ id: string }>(postCall(poll));
    expect(result.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await rowCounts(db)).toEqual({
      profiles: (before?.profiles ?? 0) + 1,
      posts: (before?.posts ?? 0) + 1,
      comments: before?.comments ?? 0,
      polls: 1,
      options: 2,
    });
  });

  it("rolls back profile, post, and poll when an option insert fails", async () => {
    const db = await createDatabase();
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.reject_exploding_option()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.label = 'explode' THEN
          RAISE EXCEPTION 'forced option failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_exploding_option
      BEFORE INSERT ON public.community_poll_options
      FOR EACH ROW EXECUTE FUNCTION public.reject_exploding_option();
    `);
    const before = await rowCounts(db);
    const poll = JSON.stringify({
      question: "pick one",
      options: [
        { position: 0, label: "one", image_url: null },
        { position: 1, label: "explode", image_url: null },
      ],
      allow_multiple: false,
      is_anonymous: false,
      hide_results_until_voted: false,
      closes_at: null,
    });

    await expect(db.exec(postCall(poll))).rejects.toThrow(/forced option failure/);
    expect(await rowCounts(db)).toEqual(before);
  });

  it("rejects malformed poll data before creating any row", async () => {
    const db = await createDatabase();
    const before = await rowCounts(db);
    const duplicatePositions = JSON.stringify({
      question: "pick one",
      options: [
        { position: 0, label: "one", image_url: null },
        { position: 0, label: "two", image_url: null },
      ],
      allow_multiple: false,
      is_anonymous: false,
      hide_results_until_voted: false,
      closes_at: null,
      attacker_controlled_column: true,
    });

    await expect(db.exec(postCall(duplicatePositions))).rejects.toThrow(
      /community_poll_payload_invalid/,
    );

    const oversizedPosition = `{
      "question":"pick one",
      "options":[
        {"position":0,"label":"one","image_url":null},
        {"position":99999999999999999999999999999999999999999999999999,"label":"two","image_url":null}
      ],
      "allow_multiple":false,
      "is_anonymous":false,
      "hide_results_until_voted":false,
      "closes_at":null
    }`;
    await expect(db.exec(postCall(oversizedPosition))).rejects.toThrow(
      /community_poll_option_positions_invalid/,
    );

    const infiniteClose = JSON.stringify({
      question: "pick one",
      options: [
        { position: 0, label: "one", image_url: null },
        { position: 1, label: "two", image_url: null },
      ],
      allow_multiple: false,
      is_anonymous: false,
      hide_results_until_voted: false,
      closes_at: "infinity",
    });
    await expect(db.exec(postCall(infiniteClose))).rejects.toThrow(
      /community_poll_close_time_invalid/,
    );
    expect(await rowCounts(db)).toEqual(before);
  });
});
