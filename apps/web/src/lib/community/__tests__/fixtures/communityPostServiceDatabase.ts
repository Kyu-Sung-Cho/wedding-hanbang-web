// 커뮤니티 글 저장 RPC(`community_create_post_service`)를 실제로 돌리는 PGlite 데이터베이스.
// 마이그레이션 테스트와 15초 후기 저장 계약 테스트가 같은 DB 를 쓴다.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804200000_community_post_service_write_boundary.sql",
  ),
  "utf8",
);

export const ACTOR = "10000000-0000-4000-8000-000000000001";
export const OTHER = "10000000-0000-4000-8000-000000000002";

export async function createDatabase() {
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

export async function setPersona(db: PGlite, role: "authenticated" | "service_role") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.exec(`SET ROLE ${role}`);
}
