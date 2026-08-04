// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804200000_community_post_service_write_boundary.sql",
  ),
  "utf8",
);

const ACTOR = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const KEY = "20000000-0000-4000-8000-000000000001";

type Receipt = {
  post: { id: string; author_id: string; title: string };
  poll_id: string | null;
  post_count: number;
};

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      name text,
      is_admin boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_runtime_control (
      control_key text PRIMARY KEY,
      mode text NOT NULL
    );
    INSERT INTO public.community_runtime_control(control_key, mode)
    VALUES ('global', 'normal');

    CREATE TYPE public.community_content_origin AS ENUM (
      'member', 'operator', 'ai', 'industry_professional', 'legacy_unverified'
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      nickname text NOT NULL,
      badge text NOT NULL DEFAULT 'member',
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      is_suspended boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX community_profiles_normalized_nickname_unique
      ON public.community_profiles(lower(nickname));

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      content_origin public.community_content_origin NOT NULL DEFAULT 'member',
      category text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      images text[] NOT NULL DEFAULT '{}',
      slides jsonb,
      visibility text NOT NULL,
      vendor_tags uuid[] NOT NULL DEFAULT '{}',
      tags text[] NOT NULL DEFAULT '{}',
      cost_data jsonb,
      ad_disclosure text NOT NULL DEFAULT 'general',
      sponsorship_detail text,
      price_data jsonb,
      is_quick_review boolean NOT NULL DEFAULT false,
      rating smallint,
      upvote_count integer NOT NULL DEFAULT 0,
      downvote_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      view_count integer NOT NULL DEFAULT 0,
      bookmark_count integer NOT NULL DEFAULT 0,
      is_pinned boolean NOT NULL DEFAULT false,
      is_weekly_best boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
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
      total_votes integer NOT NULL DEFAULT 0,
      version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_poll_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
      position integer NOT NULL,
      label text NOT NULL,
      image_url text,
      vote_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(poll_id, position)
    );

    CREATE FUNCTION public.guard_runtime_write()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_mode text := (SELECT mode FROM public.community_runtime_control WHERE control_key = 'global');
      v_withdrawal boolean := auth.role() = 'service_role'
        AND COALESCE(current_setting('app.community_safety_bypass', true), '') = 'on';
    BEGIN
      IF v_mode = 'normal' OR v_withdrawal THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END IF;
      RAISE EXCEPTION 'community is read-only' USING ERRCODE = '55000';
    END
    $$;
    CREATE TRIGGER runtime_posts
      BEFORE INSERT OR UPDATE OR DELETE ON public.community_posts
      FOR EACH ROW EXECUTE FUNCTION public.guard_runtime_write();
    CREATE TRIGGER runtime_polls
      BEFORE INSERT OR UPDATE OR DELETE ON public.community_polls
      FOR EACH ROW EXECUTE FUNCTION public.guard_runtime_write();
    CREATE TRIGGER runtime_poll_options
      BEFORE INSERT OR UPDATE OR DELETE ON public.community_poll_options
      FOR EACH ROW EXECUTE FUNCTION public.guard_runtime_write();

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO auth.users(id) VALUES ('${ACTOR}'), ('${OTHER}');
    INSERT INTO public.profiles(id, name, is_admin)
    VALUES ('${ACTOR}', 'actor', false), ('${OTHER}', 'other', false);
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(db: PGlite, role: "authenticated" | "service_role") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.exec(`SET ROLE ${role}`);
}

const payload = {
  category: "free",
  title: "atomic post",
  content: "one transaction",
  images: [],
  slides: null,
  visibility: "public",
  vendor_tags: [],
  tags: ["planning"],
  cost_data: null,
  ad_disclosure: "general",
  sponsorship_detail: null,
  price_data: null,
  is_quick_review: false,
  rating: null,
  poll: {
    question: "pick one",
    options: [
      { position: 0, label: "first", image_url: null },
      { position: 1, label: "second", image_url: null },
    ],
    allow_multiple: false,
    is_anonymous: true,
    hide_results_until_voted: true,
    closes_at: null,
  },
};

describe("community post service write boundary migration", () => {
  it("commits the post, poll, options, profile count and receipt in one service command", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated");
      await expect(db.query(
        "SELECT public.community_create_post_service($1, $2, $3, $4::jsonb)",
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      )).rejects.toThrow(/permission denied/iu);

      await setPersona(db, "service_role");
      const created = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        ) AS receipt`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      );
      expect(created.rows[0]!.receipt).toMatchObject({
        post: { author_id: ACTOR, title: "atomic post" },
        poll_id: expect.any(String),
        post_count: 1,
      });
      expect(created.rows[0]!.receipt).not.toHaveProperty("replayed");

      await db.exec("RESET ROLE");
      const state = await db.query<{
        posts: number;
        polls: number;
        options: number;
        post_count: number;
        commands: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public.community_posts) AS posts,
          (SELECT count(*)::int FROM public.community_polls) AS polls,
          (SELECT count(*)::int FROM public.community_poll_options) AS options,
          (SELECT post_count FROM public.community_profiles WHERE user_id = '${ACTOR}') AS post_count,
          (SELECT count(*)::int FROM public.community_post_write_commands) AS commands
      `);
      expect(state.rows[0]).toEqual({
        posts: 1,
        polls: 1,
        options: 2,
        post_count: 1,
        commands: 1,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("replays the exact payload receipt before runtime and suspension gates and rejects key reuse", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const first = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        ) AS receipt`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      );

      await db.exec("RESET ROLE");
      await db.exec(`
        UPDATE public.community_runtime_control SET mode = 'read_only';
        UPDATE public.community_profiles SET is_suspended = true
        WHERE user_id = '${ACTOR}';
      `);
      await setPersona(db, "service_role");
      const replay = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        ) AS receipt`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      );
      expect(replay.rows[0]!.receipt).toEqual(first.rows[0]!.receipt);

      const changed = { ...payload, title: "different payload" };
      await expect(db.query(
        `SELECT public.community_replay_post_command_service(
          $1::uuid, $2::uuid, $3::jsonb
        )`,
        [ACTOR, KEY, JSON.stringify(changed)],
      )).rejects.toThrow(/COMMUNITY_POST_IDEMPOTENCY_CONFLICT/iu);

      await db.exec("RESET ROLE");
      const state = await db.query<{ posts: number; post_count: number }>(`
        SELECT
          (SELECT count(*)::int FROM public.community_posts) AS posts,
          (SELECT post_count FROM public.community_profiles WHERE user_id = '${ACTOR}') AS post_count
      `);
      expect(state.rows[0]).toEqual({ posts: 1, post_count: 1 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back the post, poll, profile bootstrap, counter and command when an option write fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.fail_second_poll_option()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.position = 1 THEN
            RAISE EXCEPTION 'forced option failure';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER fail_second_poll_option
        BEFORE INSERT ON public.community_poll_options
        FOR EACH ROW EXECUTE FUNCTION public.fail_second_poll_option();
      `);
      await setPersona(db, "service_role");
      await expect(db.query(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        )`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      )).rejects.toThrow(/forced option failure/iu);

      await db.exec("RESET ROLE");
      const state = await db.query<{
        posts: number;
        polls: number;
        options: number;
        profiles: number;
        commands: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public.community_posts) AS posts,
          (SELECT count(*)::int FROM public.community_polls) AS polls,
          (SELECT count(*)::int FROM public.community_poll_options) AS options,
          (SELECT count(*)::int FROM public.community_profiles) AS profiles,
          (SELECT count(*)::int FROM public.community_post_write_commands) AS commands
      `);
      expect(state.rows[0]).toEqual({
        posts: 0,
        polls: 0,
        options: 0,
        profiles: 0,
        commands: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("serializes competing same-key creates into one post and one exact replay", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const sql = `SELECT public.community_create_post_service(
        $1::uuid, $2::uuid, $3::text, $4::jsonb
      ) AS receipt`;
      const [left, right] = await Promise.all([
        db.query<{ receipt: Receipt }>(sql, [
          ACTOR,
          KEY,
          "user-10000000",
          JSON.stringify(payload),
        ]),
        db.query<{ receipt: Receipt }>(sql, [
          ACTOR,
          KEY,
          "user-10000000",
          JSON.stringify(payload),
        ]),
      ]);
      expect(right.rows[0]!.receipt).toEqual(left.rows[0]!.receipt);
      expect(left.rows[0]!.receipt).not.toHaveProperty("replayed");

      await db.exec("RESET ROLE");
      const state = await db.query<{ posts: number; commands: number; post_count: number }>(`
        SELECT
          (SELECT count(*)::int FROM public.community_posts) AS posts,
          (SELECT count(*)::int FROM public.community_post_write_commands) AS commands,
          (SELECT post_count FROM public.community_profiles WHERE user_id = '${ACTOR}') AS post_count
      `);
      expect(state.rows[0]).toEqual({ posts: 1, commands: 1, post_count: 1 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed instead of replaying a malformed stored receipt", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await db.query(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        )`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      );
      await db.exec("RESET ROLE");
      await db.exec(`
        UPDATE public.community_post_write_commands
        SET response_payload = '{"post": {"id": "00000000-0000-4000-8000-000000000000"}}'::jsonb
        WHERE actor_id = '${ACTOR}' AND idempotency_key = '${KEY}'
      `);

      await setPersona(db, "service_role");
      await expect(db.query(
        `SELECT public.community_replay_post_command_service(
          $1::uuid, $2::uuid, $3::jsonb
        )`,
        [ACTOR, KEY, JSON.stringify(payload)],
      )).rejects.toThrow(/COMMUNITY_POST_RECEIPT_INVALID/iu);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("deletes only the author's post with an exact count and returns a stable retry receipt", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const first = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        ) AS receipt`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      );
      const secondPayload = { ...payload, title: "second", poll: null };
      await db.query(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        )`,
        [
          ACTOR,
          "20000000-0000-4000-8000-000000000002",
          "user-10000000",
          JSON.stringify(secondPayload),
        ],
      );

      await expect(db.query(
        "SELECT public.community_delete_post_service($1::uuid, $2::uuid)",
        [OTHER, first.rows[0]!.receipt.post.id],
      )).rejects.toThrow(/COMMUNITY_POST_DELETE_FORBIDDEN/iu);

      const deleted = await db.query<{ receipt: Record<string, unknown> }>(
        "SELECT public.community_delete_post_service($1::uuid, $2::uuid) AS receipt",
        [ACTOR, first.rows[0]!.receipt.post.id],
      );
      expect(deleted.rows[0]!.receipt).toMatchObject({
        actor_id: ACTOR,
        post_id: first.rows[0]!.receipt.post.id,
        deleted: true,
        post_count: 1,
      });
      const replay = await db.query<{ receipt: Record<string, unknown> }>(
        "SELECT public.community_delete_post_service($1::uuid, $2::uuid) AS receipt",
        [ACTOR, first.rows[0]!.receipt.post.id],
      );
      expect(replay.rows[0]!.receipt).toEqual(deleted.rows[0]!.receipt);
      expect(replay.rows[0]!.receipt).not.toHaveProperty("replayed");

      await db.exec("RESET ROLE");
      const state = await db.query<{ posts: number; post_count: number; receipts: number }>(`
        SELECT
          (SELECT count(*)::int FROM public.community_posts) AS posts,
          (SELECT post_count FROM public.community_profiles WHERE user_id = '${ACTOR}') AS post_count,
          (SELECT count(*)::int FROM public.community_post_delete_receipts) AS receipts
      `);
      expect(state.rows[0]).toEqual({ posts: 1, post_count: 1, receipts: 1 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back an author deletion when the profile counter cannot commit", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const created = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        ) AS receipt`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      );
      await db.exec("RESET ROLE");
      await db.exec(`
        CREATE FUNCTION public.fail_post_count_update()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.post_count = 0 THEN
            RAISE EXCEPTION 'forced profile counter failure';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER fail_post_count_update
        BEFORE UPDATE OF post_count ON public.community_profiles
        FOR EACH ROW EXECUTE FUNCTION public.fail_post_count_update();
      `);
      await setPersona(db, "service_role");
      await expect(db.query(
        "SELECT public.community_delete_post_service($1::uuid, $2::uuid)",
        [ACTOR, created.rows[0]!.receipt.post.id],
      )).rejects.toThrow(/forced profile counter failure/iu);

      await db.exec("RESET ROLE");
      const state = await db.query<{ posts: number; post_count: number; receipts: number }>(`
        SELECT
          (SELECT count(*)::int FROM public.community_posts) AS posts,
          (SELECT post_count FROM public.community_profiles WHERE user_id = '${ACTOR}') AS post_count,
          (SELECT count(*)::int FROM public.community_post_delete_receipts) AS receipts
      `);
      expect(state.rows[0]).toEqual({ posts: 1, post_count: 1, receipts: 0 });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("bootstraps a missing legacy profile and recomputes the remaining post count on delete", async () => {
    const db = await createDatabase();
    try {
      const legacyPosts = await db.query<{ id: string }>(`
        INSERT INTO public.community_posts(
          author_id, category, title, content, visibility
        ) VALUES
          ('${ACTOR}', 'free', 'legacy one', 'content', 'public'),
          ('${ACTOR}', 'free', 'legacy two', 'content', 'public')
        RETURNING id::text AS id
      `);
      await setPersona(db, "service_role");
      const deleted = await db.query<{ receipt: Record<string, unknown> }>(
        "SELECT public.community_delete_post_service($1::uuid, $2::uuid) AS receipt",
        [ACTOR, legacyPosts.rows[0]!.id],
      );
      expect(deleted.rows[0]!.receipt).toMatchObject({
        deleted: true,
        post_count: 1,
      });

      await db.exec("RESET ROLE");
      const profile = await db.query<{ post_count: number }>(`
        SELECT post_count
        FROM public.community_profiles
        WHERE user_id = '${ACTOR}'
      `);
      expect(profile.rows).toEqual([{ post_count: 1 }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps author withdrawal available while read-only mode blocks a new post command", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const created = await db.query<{ receipt: Receipt }>(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        ) AS receipt`,
        [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
      );
      await db.exec("RESET ROLE");
      await db.exec(`
        UPDATE public.community_runtime_control SET mode = 'read_only';
        UPDATE public.community_profiles SET is_suspended = true
        WHERE user_id = '${ACTOR}'
      `);
      await setPersona(db, "service_role");
      await expect(db.query(
        `SELECT public.community_create_post_service(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        )`,
        [
          ACTOR,
          "20000000-0000-4000-8000-000000000009",
          "user-10000000",
          JSON.stringify({ ...payload, title: "blocked new command" }),
        ],
      )).rejects.toThrow(/community is read-only/iu);

      const withdrawn = await db.query<{ receipt: Record<string, unknown> }>(
        "SELECT public.community_delete_post_service($1::uuid, $2::uuid) AS receipt",
        [ACTOR, created.rows[0]!.receipt.post.id],
      );
      expect(withdrawn.rows[0]!.receipt).toMatchObject({
        deleted: true,
        post_count: 0,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
