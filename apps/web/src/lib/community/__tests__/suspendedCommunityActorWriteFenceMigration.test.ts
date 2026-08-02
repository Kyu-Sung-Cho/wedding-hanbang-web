// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803112000_enforce_community_suspended_actor_write_fence.sql",
  ),
  "utf8",
);

const ACTIVE = "00000000-0000-4000-8000-000000000001";
const SUSPENDED = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const OTHER = "00000000-0000-4000-8000-000000000004";
const PROFILELESS = "decafbad-1234-4000-8000-000000000005";
const LEGACY_EIGHT = "a1b2c3d4-1111-4111-8111-111111111111";
const LEGACY_FIFTEEN = "b1c2d3e4-2222-4222-8222-222222222222";
const LEGACY_INSERT = "c1d2e3f4-3333-4333-8333-333333333333";
const CUSTOM_NICKNAME = "d1e2f3a4-4444-4444-8444-444444444444";
const ROOM = "10000000-0000-4000-8000-000000000001";
const ACTIVE_POST = "20000000-0000-4000-8000-000000000001";
const SUSPENDED_POST = "20000000-0000-4000-8000-000000000002";
const OTHER_POST = "20000000-0000-4000-8000-000000000003";
const ACTIVE_COMMENT = "30000000-0000-4000-8000-000000000001";
const SUSPENDED_COMMENT = "30000000-0000-4000-8000-000000000002";
const SUSPENDED_ISSUED_UPLOAD = "40000000-0000-4000-8000-000000000001";
const SUSPENDED_FINALIZING_UPLOAD = "40000000-0000-4000-8000-000000000002";
const SUSPENDED_CLAIM = "50000000-0000-4000-8000-000000000001";
const RETRY_CLAIM = "50000000-0000-4000-8000-000000000002";
const databases: PGlite[] = [];

function legacyNickname(userId: string, prefixLength: 8 | 15): string {
  return `user-${userId.replaceAll("-", "").slice(0, prefixLength)}`;
}

function expectOpaqueSystemNickname(nickname: string, actorId: string) {
  const actorUuidHex = actorId.replaceAll("-", "").toLowerCase();
  expect(nickname).toMatch(/^user-[0-9a-f]{15}$/);
  expect(nickname).not.toBe(`user-${actorUuidHex.slice(0, 15)}`);
  expect(actorUuidHex).not.toContain(nickname.slice(5));
}

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
    RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      is_admin boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      nickname text NOT NULL,
      avatar_url text,
      is_suspended boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (nickname)
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title text NOT NULL,
      content text NOT NULL,
      images text[] NOT NULL DEFAULT '{}',
      slides jsonb,
      visibility text NOT NULL DEFAULT 'public',
      vendor_tags uuid[] NOT NULL DEFAULT '{}',
      tags text[] NOT NULL DEFAULT '{}',
      cost_data jsonb,
      under_review boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      content text NOT NULL,
      is_deleted boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
      reason text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'pending'
    );
    CREATE UNIQUE INDEX community_reports_reporter_post_uidx
      ON public.community_reports (reporter_id, post_id);
    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      is_active boolean NOT NULL DEFAULT true,
      UNIQUE (room_id, user_id)
    );
    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      content text NOT NULL,
      thread_topic text NOT NULL,
      images text[] NOT NULL DEFAULT '{}',
      reply_to uuid REFERENCES public.cohort_messages(id),
      is_deleted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.cohort_timeline_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      event_type text NOT NULL,
      description text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.cohort_member_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL,
      reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      reported_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      reason text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'pending',
      UNIQUE (room_id, reporter_id, reported_user_id)
    );
    CREATE TABLE public.community_upload_sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      staging_path text NOT NULL UNIQUE,
      final_bucket text NOT NULL,
      final_path text NOT NULL UNIQUE,
      declared_mime_type text NOT NULL,
      declared_size bigint NOT NULL,
      status text NOT NULL DEFAULT 'issued',
      claim_token uuid,
      finalize_started_at timestamptz,
      finalization_attempts integer NOT NULL DEFAULT 0,
      actual_size bigint,
      actual_mime_type text,
      content_sha256 text,
      sanitized_at timestamptz,
      rejection_code text,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      rejected_at timestamptz,
      staging_deleted_at timestamptz
    );
    CREATE TABLE public.operational_calls (name text NOT NULL, actor_id uuid NOT NULL);

    CREATE FUNCTION public.community_vote_post(uuid, uuid, smallint)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.operational_calls VALUES ('post_vote', $1); END $$;
    CREATE FUNCTION public.community_vote_comment(uuid, uuid, smallint)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.operational_calls VALUES ('comment_vote', $1); END $$;
    CREATE FUNCTION public.community_toggle_bookmark(uuid, uuid)
    RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_object('bookmarked', true, 'bookmark_count', 1)
    $$;
    CREATE FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
    RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_object('ok', true, 'action', 'added')
    $$;
    CREATE FUNCTION public.community_assign_cohort(uuid, integer, integer)
    RETURNS uuid LANGUAGE sql AS $$ SELECT '${ROOM}'::uuid $$;
    CREATE FUNCTION public.community_upsert_cohort_contract(
      uuid, uuid, uuid, text, text, integer, integer DEFAULT NULL, text DEFAULT NULL
    ) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('user_id', $2) $$;
    CREATE FUNCTION public.claim_community_upload_session(uuid, uuid, uuid, timestamptz)
    RETURNS SETOF public.community_upload_sessions LANGUAGE sql AS $$
      SELECT * FROM public.community_upload_sessions
      WHERE id = $1 AND user_id = $2
    $$;
    CREATE FUNCTION public.test_legacy_create_community_profile(uuid)
    RETURNS text LANGUAGE plpgsql AS $$
    DECLARE created_nickname text;
    BEGIN
      INSERT INTO public.community_profiles (user_id, nickname)
      VALUES (
        $1,
        'user-' || substr(replace($1::text, '-', ''), 1, 8)
      )
      RETURNING nickname INTO created_nickname;
      RETURN created_nickname;
    END $$;

    INSERT INTO auth.users (id) VALUES
      ('${ACTIVE}'), ('${SUSPENDED}'), ('${ADMIN}'), ('${OTHER}'),
      ('${PROFILELESS}'), ('${LEGACY_EIGHT}'), ('${LEGACY_FIFTEEN}'),
      ('${LEGACY_INSERT}'), ('${CUSTOM_NICKNAME}');
    INSERT INTO public.profiles (id, is_admin) VALUES
      ('${ACTIVE}', false), ('${SUSPENDED}', false),
      ('${ADMIN}', true), ('${OTHER}', false), ('${PROFILELESS}', false),
      ('${LEGACY_EIGHT}', false), ('${LEGACY_FIFTEEN}', false),
      ('${LEGACY_INSERT}', false), ('${CUSTOM_NICKNAME}', false);
    INSERT INTO public.community_profiles (user_id, nickname, is_suspended) VALUES
      ('${ACTIVE}', 'active', false),
      ('${SUSPENDED}', 'suspended', true),
      ('${ADMIN}', 'admin', true),
      ('${OTHER}', 'other', false),
      ('${LEGACY_EIGHT}', '${legacyNickname(LEGACY_EIGHT, 8)}', false),
      ('${LEGACY_FIFTEEN}', '${legacyNickname(LEGACY_FIFTEEN, 15)}', false),
      ('${CUSTOM_NICKNAME}', 'user-deadbeef', false);
    INSERT INTO public.community_posts (id, author_id, title, content) VALUES
      ('${ACTIVE_POST}', '${ACTIVE}', 'active', 'body'),
      ('${SUSPENDED_POST}', '${SUSPENDED}', 'suspended', 'body'),
      ('${OTHER_POST}', '${OTHER}', 'other', 'body');
    INSERT INTO public.community_comments (id, post_id, author_id, content) VALUES
      ('${ACTIVE_COMMENT}', '${ACTIVE_POST}', '${ACTIVE}', 'active'),
      ('${SUSPENDED_COMMENT}', '${SUSPENDED_POST}', '${SUSPENDED}', 'suspended');
    INSERT INTO public.cohort_members (room_id, user_id) VALUES
      ('${ROOM}', '${ACTIVE}'), ('${ROOM}', '${SUSPENDED}'),
      ('${ROOM}', '${ADMIN}'), ('${ROOM}', '${OTHER}');
    INSERT INTO public.community_upload_sessions (
      id, user_id, staging_path, final_bucket, final_path,
      declared_mime_type, declared_size, status, claim_token,
      finalize_started_at, expires_at
    ) VALUES
      (
        '${SUSPENDED_ISSUED_UPLOAD}', '${SUSPENDED}',
        '${SUSPENDED}/${SUSPENDED_ISSUED_UPLOAD}.jpg', 'community-images',
        'v2/60000000-0000-4000-8000-000000000001.jpg',
        'image/jpeg', 10, 'issued', NULL, NULL,
        clock_timestamp() + interval '10 minutes'
      ),
      (
        '${SUSPENDED_FINALIZING_UPLOAD}', '${SUSPENDED}',
        '${SUSPENDED}/${SUSPENDED_FINALIZING_UPLOAD}.jpg', 'community-images',
        'v2/60000000-0000-4000-8000-000000000002.jpg',
        'image/jpeg', 10, 'finalizing', '${SUSPENDED_CLAIM}',
        clock_timestamp(), clock_timestamp() + interval '10 minutes'
      );
  `);
  await db.exec(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
  await db.exec(migration);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("suspended community actor write fence migration", () => {
  it("installs idempotently and leaves product functions service-only", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    const rows = await db.query<{
      name: string;
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_execute: boolean;
    }>(`
      SELECT proc.proname AS name,
        has_function_privilege('anon', proc.oid, 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS authenticated_execute,
        has_function_privilege('service_role', proc.oid, 'EXECUTE') AS service_execute
      FROM pg_proc AS proc
      JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'public'
        AND proc.proname IN (
          'community_vote_post',
          'community_update_post_for_actor',
          'community_create_cohort_message_for_actor',
          'community_create_upload_session_for_actor'
        )
      ORDER BY proc.proname
    `);
    expect(rows.rows).toHaveLength(4);
    expect(rows.rows.every((row) =>
      !row.anon_execute && !row.authenticated_execute && row.service_execute)).toBe(true);

    const nicknameRows = await db.query<{ user_id: string; nickname: string }>(`
      SELECT user_id, nickname
      FROM public.community_profiles
      WHERE user_id IN ('${LEGACY_EIGHT}', '${LEGACY_FIFTEEN}', '${CUSTOM_NICKNAME}')
      ORDER BY user_id
    `);
    const nicknameByUser = new Map(
      nicknameRows.rows.map((row) => [row.user_id, row.nickname]),
    );
    expectOpaqueSystemNickname(nicknameByUser.get(LEGACY_EIGHT) ?? "", LEGACY_EIGHT);
    expectOpaqueSystemNickname(nicknameByUser.get(LEGACY_FIFTEEN) ?? "", LEGACY_FIFTEEN);
    expect(nicknameByUser.get(CUSTOM_NICKNAME)).toBe("user-deadbeef");
  });

  it("allows active actors but rolls back every covered write for suspended actors", async () => {
    const db = await createDatabase();

    await db.exec(`SELECT public.community_check_active_write_actor('${PROFILELESS}')`);
    const generatedProfile = await db.query<{ nickname: string }>(`
      SELECT nickname
      FROM public.community_profiles
      WHERE user_id = '${PROFILELESS}'
    `);
    expectOpaqueSystemNickname(generatedProfile.rows[0]?.nickname ?? "", PROFILELESS);

    const legacyInsert = await db.query<{ nickname: string }>(`
      SELECT public.test_legacy_create_community_profile('${LEGACY_INSERT}') AS nickname
    `);
    expectOpaqueSystemNickname(legacyInsert.rows[0]?.nickname ?? "", LEGACY_INSERT);

    await db.exec(`
      UPDATE public.community_profiles
      SET nickname = 'custom-name-after-migration'
      WHERE user_id = '${CUSTOM_NICKNAME}'
    `);
    const customNickname = await db.query<{ nickname: string }>(`
      SELECT nickname FROM public.community_profiles
      WHERE user_id = '${CUSTOM_NICKNAME}'
    `);
    expect(customNickname.rows[0]?.nickname).toBe("custom-name-after-migration");

    await db.exec(`SELECT public.community_vote_post('${ACTIVE}', '${OTHER_POST}', 1::smallint)`);
    await db.exec(`
      SELECT id FROM public.community_update_post_for_actor(
        '${ACTIVE}', '${ACTIVE_POST}', '{"title":"updated"}'::jsonb, false
      )
    `);
    await db.exec(`
      SELECT id FROM public.community_create_cohort_message_for_actor(
        '${ACTIVE}', '${ROOM}', 'hello', 'chat', NULL
      )
    `);

    const before = (await db.query<{
      calls: number;
      messages: number;
      reports: number;
      uploads: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM public.operational_calls) AS calls,
        (SELECT count(*)::integer FROM public.cohort_messages) AS messages,
        (SELECT count(*)::integer FROM public.community_reports) AS reports,
        (SELECT count(*)::integer FROM public.community_upload_sessions) AS uploads
    `)).rows[0];

    const blockedCalls = [
      `SELECT public.community_vote_post('${SUSPENDED}', '${OTHER_POST}', 1::smallint)`,
      `SELECT * FROM public.community_update_post_for_actor('${SUSPENDED}', '${SUSPENDED_POST}', '{"title":"bad"}'::jsonb, false)`,
      `SELECT public.community_delete_comment_for_actor('${SUSPENDED}', '${SUSPENDED_COMMENT}', false)`,
      `SELECT * FROM public.community_update_profile_for_actor('${SUSPENDED}', 'changed', NULL, false)`,
      `SELECT public.community_submit_post_report_for_actor('${SUSPENDED}', '${OTHER_POST}', 'spam', NULL)`,
      `SELECT * FROM public.community_create_cohort_message_for_actor('${SUSPENDED}', '${ROOM}', 'bad', 'chat', NULL)`,
      `SELECT * FROM public.community_create_cohort_timeline_event_for_actor('${SUSPENDED}', '${ROOM}', 'progress_update', NULL)`,
      `SELECT public.community_submit_cohort_member_report_for_actor('${SUSPENDED}', '${ROOM}', '${OTHER}', 'spam', NULL)`,
      `SELECT * FROM public.community_create_upload_session_for_actor(
        '${SUSPENDED}', gen_random_uuid(), '${SUSPENDED}/blocked.jpg',
        'community-images', 'v2/00000000-0000-4000-8000-000000000099.jpg',
        'image/jpeg', 10, clock_timestamp() + interval '10 minutes'
      )`,
      `SELECT * FROM public.claim_community_upload_session(
        '${SUSPENDED_ISSUED_UPLOAD}', '${SUSPENDED}', '${RETRY_CLAIM}',
        clock_timestamp() - interval '2 minutes'
      )`,
      `SELECT public.community_complete_upload_session_for_actor(
        '${SUSPENDED}', '${SUSPENDED_FINALIZING_UPLOAD}', '${SUSPENDED_CLAIM}',
        10, 'image/jpeg', '${"a".repeat(64)}'
      )`,
    ];
    for (const sql of blockedCalls) {
      await expect(db.exec(sql)).rejects.toThrow(/community_actor_suspended/);
    }

    const after = (await db.query<typeof before>(`
      SELECT
        (SELECT count(*)::integer FROM public.operational_calls) AS calls,
        (SELECT count(*)::integer FROM public.cohort_messages) AS messages,
        (SELECT count(*)::integer FROM public.community_reports) AS reports,
        (SELECT count(*)::integer FROM public.community_upload_sessions) AS uploads
    `)).rows[0];
    expect(after).toEqual(before);

    const uploadStates = await db.query<{
      id: string;
      status: string;
      claim_token: string | null;
      completed_at: string | null;
    }>(`
      SELECT id, status, claim_token, completed_at
      FROM public.community_upload_sessions
      WHERE id IN ('${SUSPENDED_ISSUED_UPLOAD}', '${SUSPENDED_FINALIZING_UPLOAD}')
      ORDER BY id
    `);
    expect(uploadStates.rows).toEqual([
      {
        id: SUSPENDED_ISSUED_UPLOAD,
        status: "issued",
        claim_token: null,
        completed_at: null,
      },
      {
        id: SUSPENDED_FINALIZING_UPLOAD,
        status: "finalizing",
        claim_token: SUSPENDED_CLAIM,
        completed_at: null,
      },
    ]);

    const suspendedRows = await db.query<{ nickname: string; title: string; content: string }>(`
      SELECT profile.nickname, post.title, comment.content
      FROM public.community_profiles AS profile
      JOIN public.community_posts AS post ON post.author_id = profile.user_id
      JOIN public.community_comments AS comment ON comment.author_id = profile.user_id
      WHERE profile.user_id = '${SUSPENDED}'
    `);
    expect(suspendedRows.rows[0]).toEqual({
      nickname: "suspended",
      title: "suspended",
      content: "suspended",
    });
  });

  it("keeps validated admin moderation and explicit service operations available", async () => {
    const db = await createDatabase();

    await db.exec(`
      SELECT id FROM public.community_update_post_for_actor(
        '${ADMIN}', '${SUSPENDED_POST}', '{"title":"moderated"}'::jsonb, true
      )
    `);
    await expect(
      db.exec(`SELECT public.community_vote_post('${ADMIN}', '${OTHER_POST}', 1::smallint)`),
    ).rejects.toThrow(/community_actor_suspended/);

    await db.exec(`
      SELECT public.community_vote_post_service_operational(
        '${SUSPENDED}', '${OTHER_POST}', 1::smallint
      )
    `);

    const result = await db.query<{ title: string; operational_calls: number }>(`
      SELECT
        (SELECT title FROM public.community_posts WHERE id = '${SUSPENDED_POST}') AS title,
        (SELECT count(*)::integer FROM public.operational_calls
          WHERE actor_id = '${SUSPENDED}') AS operational_calls
    `);
    expect(result.rows[0]).toEqual({ title: "moderated", operational_calls: 1 });
  });
});
