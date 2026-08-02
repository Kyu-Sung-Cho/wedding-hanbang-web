// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802148000_reconcile_community_comment_counters.sql",
  ),
  "utf8",
);

const POST_AUTHOR_ID = "00000000-0000-4000-8000-000000000001";
const ROOT_AUTHOR_ID = "00000000-0000-4000-8000-000000000002";
const REPLY_AUTHOR_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_AUTHOR_ID = "00000000-0000-4000-8000-000000000004";
const MAIN_POST_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_POST_ID = "10000000-0000-4000-8000-000000000002";
const ROOT_COMMENT_ID = "20000000-0000-4000-8000-000000000001";
const REPLY_COMMENT_ID = "20000000-0000-4000-8000-000000000002";
const DELETED_COMMENT_ID = "20000000-0000-4000-8000-000000000003";
const NEW_COMMENT_ID = "20000000-0000-4000-8000-000000000004";
const NEW_DELETED_COMMENT_ID = "20000000-0000-4000-8000-000000000005";
const NEW_NULL_STATE_COMMENT_ID = "20000000-0000-4000-8000-000000000006";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY
        REFERENCES auth.users(id) ON DELETE CASCADE,
      comment_count integer DEFAULT 0
    );

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,
      comment_count integer DEFAULT 0
    );

    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL
        REFERENCES public.community_posts(id) ON DELETE CASCADE,
      parent_id uuid
        REFERENCES public.community_comments(id) ON DELETE CASCADE,
      author_id uuid NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,
      is_deleted boolean DEFAULT false
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL ON TABLE
      public.community_profiles,
      public.community_posts,
      public.community_comments,
      auth.users
    TO service_role;

    INSERT INTO auth.users (id) VALUES
      ('${POST_AUTHOR_ID}'),
      ('${ROOT_AUTHOR_ID}'),
      ('${REPLY_AUTHOR_ID}'),
      ('${OTHER_AUTHOR_ID}');

    INSERT INTO public.community_profiles (user_id, comment_count) VALUES
      ('${POST_AUTHOR_ID}', 77),
      ('${ROOT_AUTHOR_ID}', 77),
      ('${REPLY_AUTHOR_ID}', 77),
      ('${OTHER_AUTHOR_ID}', 77);

    INSERT INTO public.community_posts (id, author_id, comment_count) VALUES
      ('${MAIN_POST_ID}', '${POST_AUTHOR_ID}', 77),
      ('${SECOND_POST_ID}', '${POST_AUTHOR_ID}', 77);

    INSERT INTO public.community_comments (
      id,
      post_id,
      parent_id,
      author_id,
      is_deleted
    ) VALUES
      (
        '${ROOT_COMMENT_ID}',
        '${MAIN_POST_ID}',
        NULL,
        '${ROOT_AUTHOR_ID}',
        false
      ),
      (
        '${REPLY_COMMENT_ID}',
        '${MAIN_POST_ID}',
        '${ROOT_COMMENT_ID}',
        '${REPLY_AUTHOR_ID}',
        false
      ),
      (
        '${DELETED_COMMENT_ID}',
        '${MAIN_POST_ID}',
        NULL,
        '${REPLY_AUTHOR_ID}',
        true
      );
  `);
  return db;
}

async function readCounters(db: PGlite) {
  const posts = await db.query<{ id: string; comment_count: number }>(`
    SELECT id, comment_count
    FROM public.community_posts
    ORDER BY id
  `);
  const profiles = await db.query<{ user_id: string; comment_count: number }>(`
    SELECT user_id, comment_count
    FROM public.community_profiles
    ORDER BY user_id
  `);
  return { posts: posts.rows, profiles: profiles.rows };
}

describe("community comment counter migration", () => {
  it("installs idempotently, repairs drift, and pins trigger authority", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      expect(await readCounters(db)).toEqual({
        posts: [
          { id: MAIN_POST_ID, comment_count: 2 },
          { id: SECOND_POST_ID, comment_count: 0 },
        ],
        profiles: [
          { user_id: POST_AUTHOR_ID, comment_count: 0 },
          { user_id: ROOT_AUTHOR_ID, comment_count: 1 },
          { user_id: REPLY_AUTHOR_ID, comment_count: 1 },
          { user_id: OTHER_AUTHOR_ID, comment_count: 0 },
        ],
      });

      const functions = await db.query<{
        name: string;
        owner: string;
        security_definer: boolean;
        config: string[];
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT
          proc.proname AS name,
          pg_catalog.pg_get_userbyid(proc.proowner) AS owner,
          proc.prosecdef AS security_definer,
          proc.proconfig AS config,
          pg_catalog.has_function_privilege(
            'anon', proc.oid, 'EXECUTE'
          ) AS anon_execute,
          pg_catalog.has_function_privilege(
            'authenticated', proc.oid, 'EXECUTE'
          ) AS authenticated_execute,
          pg_catalog.has_function_privilege(
            'service_role', proc.oid, 'EXECUTE'
          ) AS service_execute
        FROM pg_catalog.pg_proc AS proc
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = proc.pronamespace
        WHERE namespace.nspname = 'public'
          AND proc.proname IN (
            'community_comment_counter_sync',
            'community_post_comment_counter_guard',
            'community_profile_comment_counter_guard'
          )
        ORDER BY proc.proname
      `);
      expect(functions.rows).toEqual([
        {
          name: "community_comment_counter_sync",
          owner: "postgres",
          security_definer: true,
          config: ['search_path=""'],
          anon_execute: false,
          authenticated_execute: false,
          service_execute: false,
        },
        {
          name: "community_post_comment_counter_guard",
          owner: "postgres",
          security_definer: true,
          config: ['search_path=""'],
          anon_execute: false,
          authenticated_execute: false,
          service_execute: false,
        },
        {
          name: "community_profile_comment_counter_guard",
          owner: "postgres",
          security_definer: true,
          config: ['search_path=""'],
          anon_execute: false,
          authenticated_execute: false,
          service_execute: false,
        },
      ]);

      const triggers = await db.query<{
        name: string;
        trigger_type: number;
        deferrable: boolean;
        initially_deferred: boolean;
        definition: string;
      }>(`
        SELECT
          trigger.tgname AS name,
          trigger.tgtype::integer AS trigger_type,
          trigger.tgdeferrable AS deferrable,
          trigger.tginitdeferred AS initially_deferred,
          pg_catalog.pg_get_triggerdef(trigger.oid) AS definition
        FROM pg_catalog.pg_trigger AS trigger
        WHERE trigger.tgname IN (
          'trg_community_comment_counter_sync',
          'trg_community_post_comment_counter_guard',
          'trg_community_profile_comment_counter_guard'
        )
          AND trigger.tgisinternal IS FALSE
        ORDER BY trigger.tgname
      `);
      expect(triggers.rows).toHaveLength(3);
      expect(triggers.rows[0]).toMatchObject({
        name: "trg_community_comment_counter_sync",
        trigger_type: 29,
        deferrable: true,
        initially_deferred: true,
      });
      expect(triggers.rows[1]).toMatchObject({
        name: "trg_community_post_comment_counter_guard",
        trigger_type: 19,
        deferrable: false,
        initially_deferred: false,
      });
      expect(triggers.rows[1]?.definition).toContain(
        "UPDATE OF comment_count",
      );
      expect(triggers.rows[2]).toMatchObject({
        name: "trg_community_profile_comment_counter_guard",
        trigger_type: 23,
        deferrable: false,
        initially_deferred: false,
      });
      expect(triggers.rows[2]?.definition).toContain(
        "UPDATE OF comment_count",
      );
    } finally {
      await db.close();
    }
  });

  it("normalizes regular and AI insert follow-up counter writes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        INSERT INTO public.community_comments (
          id, post_id, author_id, is_deleted
        ) VALUES (
          '${NEW_COMMENT_ID}',
          '${MAIN_POST_ID}',
          '${OTHER_AUTHOR_ID}',
          false
        )
      `);
      await db.query(`
        INSERT INTO public.community_comments (
          id, post_id, author_id, is_deleted
        ) VALUES
          (
            '${NEW_DELETED_COMMENT_ID}',
            '${MAIN_POST_ID}',
            '${OTHER_AUTHOR_ID}',
            true
          ),
          (
            '${NEW_NULL_STATE_COMMENT_ID}',
            '${MAIN_POST_ID}',
            '${OTHER_AUTHOR_ID}',
            NULL
          )
      `);

      // Older route revisions issued a post read→write after the insert.
      // Rolling deployments and manual stale writes must stay exact instead of
      // adding or losing comments.
      for (const staleCounter of [999, -5, 123]) {
        await db.query(`
          UPDATE public.community_posts
          SET comment_count = ${staleCounter}
          WHERE id = '${MAIN_POST_ID}'
        `);
      }
      await db.query(`
        UPDATE public.community_profiles
        SET comment_count = 999
        WHERE user_id = '${OTHER_AUTHOR_ID}'
      `);

      const counters = await db.query<{
        post_counter: number;
        profile_counter: number;
      }>(`
        SELECT
          post.comment_count AS post_counter,
          profile.comment_count AS profile_counter
        FROM public.community_posts AS post
        CROSS JOIN public.community_profiles AS profile
        WHERE post.id = '${MAIN_POST_ID}'
          AND profile.user_id = '${OTHER_AUTHOR_ID}'
      `);
      expect(counters.rows).toEqual([{ post_counter: 4, profile_counter: 2 }]);
    } finally {
      await db.close();
    }
  });

  it("derives the counter when a profile is created after its comments", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        DELETE FROM public.community_profiles
        WHERE user_id = '${OTHER_AUTHOR_ID}'
      `);
      await db.query(`
        INSERT INTO public.community_comments (
          id, post_id, author_id, is_deleted
        ) VALUES
          (
            '${NEW_COMMENT_ID}',
            '${MAIN_POST_ID}',
            '${OTHER_AUTHOR_ID}',
            false
          ),
          (
            '${NEW_DELETED_COMMENT_ID}',
            '${MAIN_POST_ID}',
            '${OTHER_AUTHOR_ID}',
            true
          ),
          (
            '${NEW_NULL_STATE_COMMENT_ID}',
            '${MAIN_POST_ID}',
            '${OTHER_AUTHOR_ID}',
            NULL
          )
      `);
      await db.query(`
        INSERT INTO public.community_profiles (user_id, comment_count)
        VALUES ('${OTHER_AUTHOR_ID}', 999)
      `);

      const profile = await db.query<{ comment_count: number }>(`
        SELECT comment_count
        FROM public.community_profiles
        WHERE user_id = '${OTHER_AUTHOR_ID}'
      `);
      expect(profile.rows).toEqual([{ comment_count: 2 }]);
    } finally {
      await db.close();
    }
  });

  it("decrements post and profile counters on soft delete", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        UPDATE public.community_comments
        SET is_deleted = true
        WHERE id = '${REPLY_COMMENT_ID}'
      `);

      // Simulate an older API revision's follow-up decrement. The guards must
      // normalize it instead of applying a second decrement.
      await db.query(`
        UPDATE public.community_posts
        SET comment_count = comment_count - 1
        WHERE id = '${MAIN_POST_ID}'
      `);
      await db.query(`
        UPDATE public.community_profiles
        SET comment_count = comment_count - 1
        WHERE user_id = '${REPLY_AUTHOR_ID}'
      `);

      const counters = await db.query<{
        post_counter: number;
        profile_counter: number;
      }>(`
        SELECT
          post.comment_count AS post_counter,
          profile.comment_count AS profile_counter
        FROM public.community_posts AS post
        CROSS JOIN public.community_profiles AS profile
        WHERE post.id = '${MAIN_POST_ID}'
          AND profile.user_id = '${REPLY_AUTHOR_ID}'
      `);
      expect(counters.rows).toEqual([{ post_counter: 1, profile_counter: 0 }]);
    } finally {
      await db.close();
    }
  });

  it("reconciles post, author, and active-state transitions", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        UPDATE public.community_comments
        SET
          post_id = '${SECOND_POST_ID}',
          author_id = '${OTHER_AUTHOR_ID}'
        WHERE id = '${REPLY_COMMENT_ID}'
      `);

      expect(await readCounters(db)).toEqual({
        posts: [
          { id: MAIN_POST_ID, comment_count: 1 },
          { id: SECOND_POST_ID, comment_count: 1 },
        ],
        profiles: [
          { user_id: POST_AUTHOR_ID, comment_count: 0 },
          { user_id: ROOT_AUTHOR_ID, comment_count: 1 },
          { user_id: REPLY_AUTHOR_ID, comment_count: 0 },
          { user_id: OTHER_AUTHOR_ID, comment_count: 1 },
        ],
      });

      await db.query(`
        UPDATE public.community_comments
        SET is_deleted = false
        WHERE id = '${DELETED_COMMENT_ID}'
      `);
      const afterRestore = await db.query<{
        main_post: number;
        reply_profile: number;
      }>(`
        SELECT
          post.comment_count AS main_post,
          profile.comment_count AS reply_profile
        FROM public.community_posts AS post
        CROSS JOIN public.community_profiles AS profile
        WHERE post.id = '${MAIN_POST_ID}'
          AND profile.user_id = '${REPLY_AUTHOR_ID}'
      `);
      expect(afterRestore.rows).toEqual([{ main_post: 2, reply_profile: 1 }]);
    } finally {
      await db.close();
    }
  });

  it("updates surviving aggregates when auth deletion cascades a root and reply", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        DELETE FROM auth.users
        WHERE id = '${ROOT_AUTHOR_ID}'
      `);

      const result = await db.query<{
        post_counter: number;
        post_rows: number;
        reply_profile_counter: number;
        root_profile_rows: number;
      }>(`
        SELECT
          post.comment_count AS post_counter,
          (
            SELECT pg_catalog.count(*)::integer
            FROM public.community_comments
            WHERE post_id = post.id
              AND is_deleted IS NOT TRUE
          ) AS post_rows,
          reply_profile.comment_count AS reply_profile_counter,
          (
            SELECT pg_catalog.count(*)::integer
            FROM public.community_profiles
            WHERE user_id = '${ROOT_AUTHOR_ID}'
          ) AS root_profile_rows
        FROM public.community_posts AS post
        CROSS JOIN public.community_profiles AS reply_profile
        WHERE post.id = '${MAIN_POST_ID}'
          AND reply_profile.user_id = '${REPLY_AUTHOR_ID}'
      `);
      expect(result.rows).toEqual([{
        post_counter: 0,
        post_rows: 0,
        reply_profile_counter: 0,
        root_profile_rows: 0,
      }]);
    } finally {
      await db.close();
    }
  });

  it("allows post cascades and decrements surviving author profiles", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.query(`
        DELETE FROM public.community_posts
        WHERE id = '${MAIN_POST_ID}'
      `);

      const result = await db.query<{
        post_rows: number;
        comment_rows: number;
        root_profile_counter: number;
        reply_profile_counter: number;
      }>(`
        SELECT
          (
            SELECT pg_catalog.count(*)::integer
            FROM public.community_posts
            WHERE id = '${MAIN_POST_ID}'
          ) AS post_rows,
          (
            SELECT pg_catalog.count(*)::integer
            FROM public.community_comments
            WHERE post_id = '${MAIN_POST_ID}'
          ) AS comment_rows,
          root_profile.comment_count AS root_profile_counter,
          reply_profile.comment_count AS reply_profile_counter
        FROM public.community_profiles AS root_profile
        CROSS JOIN public.community_profiles AS reply_profile
        WHERE root_profile.user_id = '${ROOT_AUTHOR_ID}'
          AND reply_profile.user_id = '${REPLY_AUTHOR_ID}'
      `);
      expect(result.rows).toEqual([{
        post_rows: 0,
        comment_rows: 0,
        root_profile_counter: 0,
        reply_profile_counter: 0,
      }]);
    } finally {
      await db.close();
    }
  });
});
