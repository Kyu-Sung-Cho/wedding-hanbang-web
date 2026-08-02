// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802153000_reconcile_community_post_counters.sql",
  ),
  "utf8",
);

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const POST_A = "10000000-0000-4000-8000-000000000001";
const POST_B = "10000000-0000-4000-8000-000000000002";
const POST_NEW = "10000000-0000-4000-8000-000000000003";
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
      post_count integer DEFAULT 0
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
    );
    INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
    INSERT INTO public.community_profiles (user_id, post_count)
      VALUES ('${USER_A}', 99), ('${USER_B}', 99);
    INSERT INTO public.community_posts (id, author_id)
      VALUES ('${POST_A}', '${USER_A}'), ('${POST_B}', '${USER_A}');
  `);
  return db;
}

async function counts(db: PGlite) {
  return (await db.query<{ user_id: string; post_count: number }>(`
    SELECT user_id, post_count
    FROM public.community_profiles
    ORDER BY user_id
  `)).rows;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("community profile post counter migration", () => {
  it("repairs drift, is idempotent, and installs least-privilege deferred triggers", async () => {
    const db = await createDatabase();
    await db.exec(migration);
    await db.exec(migration);

    expect(await counts(db)).toEqual([
      { user_id: USER_A, post_count: 2 },
      { user_id: USER_B, post_count: 0 },
    ]);

    const metadata = await db.query<{
      name: string;
      owner: string;
      security_definer: boolean;
      config: string[];
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_execute: boolean;
    }>(`
      SELECT proc.proname AS name,
        pg_catalog.pg_get_userbyid(proc.proowner) AS owner,
        proc.prosecdef AS security_definer,
        proc.proconfig AS config,
        pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE') AS anon_execute,
        pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS authenticated_execute,
        pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE') AS service_execute
      FROM pg_catalog.pg_proc AS proc
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'public'
        AND proc.proname IN (
          'community_post_counter_sync',
          'community_profile_post_counter_guard'
        )
      ORDER BY proc.proname
    `);
    expect(metadata.rows).toEqual([
      {
        name: "community_post_counter_sync",
        owner: "postgres",
        security_definer: true,
        config: ['search_path=""'],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
      },
      {
        name: "community_profile_post_counter_guard",
        owner: "postgres",
        security_definer: true,
        config: ['search_path=""'],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
      },
    ]);
  });

  it("normalizes rolling-deploy follow-up writes after create and delete", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    await db.exec(`
      INSERT INTO public.community_posts (id, author_id)
      VALUES ('${POST_NEW}', '${USER_A}')
    `);
    await db.exec(`
      UPDATE public.community_profiles SET post_count = 777
      WHERE user_id = '${USER_A}'
    `);
    expect(await counts(db)).toEqual([
      { user_id: USER_A, post_count: 3 },
      { user_id: USER_B, post_count: 0 },
    ]);

    await db.exec(`DELETE FROM public.community_posts WHERE id = '${POST_NEW}'`);
    await db.exec(`
      UPDATE public.community_profiles SET post_count = post_count - 1
      WHERE user_id = '${USER_A}'
    `);
    expect(await counts(db)).toEqual([
      { user_id: USER_A, post_count: 2 },
      { user_id: USER_B, post_count: 0 },
    ]);
  });

  it("derives the counter when a profile is created after its posts", async () => {
    const db = await createDatabase();
    await db.exec(migration);
    await db.exec(`DELETE FROM public.community_profiles WHERE user_id = '${USER_B}'`);
    await db.exec(`
      INSERT INTO public.community_posts (id, author_id)
      VALUES ('${POST_NEW}', '${USER_B}')
    `);
    await db.exec(`
      INSERT INTO public.community_profiles (user_id, post_count)
      VALUES ('${USER_B}', 777)
    `);

    expect(await counts(db)).toEqual([
      { user_id: USER_A, post_count: 2 },
      { user_id: USER_B, post_count: 1 },
    ]);
  });

  it("reconciles an author transition and an auth cascade", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    await db.exec(`
      UPDATE public.community_posts
      SET author_id = '${USER_B}'
      WHERE id = '${POST_B}'
    `);
    expect(await counts(db)).toEqual([
      { user_id: USER_A, post_count: 1 },
      { user_id: USER_B, post_count: 1 },
    ]);

    await db.exec(`DELETE FROM auth.users WHERE id = '${USER_A}'`);
    expect(await counts(db)).toEqual([
      { user_id: USER_B, post_count: 1 },
    ]);
  });
});
