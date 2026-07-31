// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260730100000_retire_undisclosed_community_agents.sql",
  ),
  "utf8",
);

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const HUMAN_ID = "22222222-2222-4222-8222-222222222222";
const PERSONA_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_POST_ID = "44444444-4444-4444-8444-444444444444";
const HUMAN_POST_ID = "55555555-5555-4555-8555-555555555555";
const AGENT_COMMENT_ID = "66666666-6666-4666-8666-666666666666";
const HUMAN_COMMENT_ID = "77777777-7777-4777-8777-777777777777";

describe("undisclosed community agent retirement", () => {
  it("contains old activity, corrects counters, and blocks new public activity", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE service_role NOLOGIN BYPASSRLS;

        CREATE TABLE public.community_agent_personas (
          id uuid PRIMARY KEY,
          slug text NOT NULL UNIQUE,
          status text NOT NULL,
          backing_user_id uuid,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.community_agent_content_drafts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id uuid NOT NULL,
          status text NOT NULL,
          auto_publish boolean NOT NULL DEFAULT false,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.community_posts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          author_id uuid NOT NULL,
          visibility text NOT NULL DEFAULT 'public',
          is_pinned boolean NOT NULL DEFAULT false,
          is_weekly_best boolean NOT NULL DEFAULT false,
          upvote_count integer NOT NULL DEFAULT 0,
          downvote_count integer NOT NULL DEFAULT 0,
          comment_count integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.community_comments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id uuid NOT NULL,
          author_id uuid NOT NULL,
          is_deleted boolean NOT NULL DEFAULT false,
          upvote_count integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.cohort_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          author_id uuid NOT NULL,
          is_deleted boolean NOT NULL DEFAULT false
        );
        CREATE TABLE public.community_votes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          post_id uuid,
          comment_id uuid,
          vote_type smallint NOT NULL
        );
        CREATE TABLE public.community_profiles (
          user_id uuid PRIMARY KEY,
          nickname text NOT NULL,
          avatar_url text,
          post_count integer NOT NULL DEFAULT 0,
          comment_count integer NOT NULL DEFAULT 0,
          total_upvotes_received integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        INSERT INTO public.community_agent_personas(id, slug, status, backing_user_id)
        VALUES ('${PERSONA_ID}', 'yeon-senior-helper', 'active', '${AGENT_ID}');
        INSERT INTO public.community_agent_content_drafts(agent_id, status, auto_publish)
        VALUES ('${PERSONA_ID}', 'approved', true);
        INSERT INTO public.community_profiles(
          user_id, nickname, avatar_url, post_count, comment_count, total_upvotes_received
        ) VALUES
          ('${AGENT_ID}', 'yeon', 'https://example.com/agent.png', 1, 1, 12),
          ('${HUMAN_ID}', '실사용자', null, 1, 1, 99);
        INSERT INTO public.community_posts(
          id, author_id, visibility, is_pinned, is_weekly_best,
          upvote_count, downvote_count, comment_count
        ) VALUES
          ('${AGENT_POST_ID}', '${AGENT_ID}', 'public', true, true, 5, 1, 0),
          ('${HUMAN_POST_ID}', '${HUMAN_ID}', 'public', false, false, 2, 0, 2);
        INSERT INTO public.community_comments(
          id, post_id, author_id, is_deleted, upvote_count
        ) VALUES
          ('${AGENT_COMMENT_ID}', '${HUMAN_POST_ID}', '${AGENT_ID}', false, 0),
          ('${HUMAN_COMMENT_ID}', '${HUMAN_POST_ID}', '${HUMAN_ID}', false, 2);
        INSERT INTO public.cohort_messages(author_id, is_deleted)
        VALUES ('${AGENT_ID}', false);
        INSERT INTO public.community_votes(user_id, post_id, comment_id, vote_type) VALUES
          ('${AGENT_ID}', '${HUMAN_POST_ID}', null, 1),
          ('${HUMAN_ID}', '${HUMAN_POST_ID}', null, 1),
          ('${AGENT_ID}', null, '${HUMAN_COMMENT_ID}', 1),
          ('${HUMAN_ID}', null, '${HUMAN_COMMENT_ID}', 1);
      `);

      await db.exec(migration);

      const personas = await db.query<{ status: string }>(
        "SELECT status FROM public.community_agent_personas",
      );
      expect(personas.rows).toEqual([{ status: "retired" }]);

      const posts = await db.query<{
        id: string;
        visibility: string;
        upvote_count: number;
        comment_count: number;
      }>(`
        SELECT id, visibility, upvote_count, comment_count
        FROM public.community_posts
        ORDER BY id
      `);
      expect(posts.rows).toEqual([
        {
          id: AGENT_POST_ID,
          visibility: "draft",
          upvote_count: 0,
          comment_count: 0,
        },
        {
          id: HUMAN_POST_ID,
          visibility: "public",
          upvote_count: 1,
          comment_count: 1,
        },
      ]);

      const agentProfile = await db.query<{
        nickname: string;
        avatar_url: string | null;
        post_count: number;
        comment_count: number;
      }>(`
        SELECT nickname, avatar_url, post_count, comment_count
        FROM public.community_profiles
        WHERE user_id = '${AGENT_ID}'
      `);
      expect(agentProfile.rows).toEqual([{
        nickname: "AI 콘텐츠(중단) yeon-senior-helper",
        avatar_url: null,
        post_count: 0,
        comment_count: 0,
      }]);

      const humanProfile = await db.query<{ total_upvotes_received: number }>(`
        SELECT total_upvotes_received
        FROM public.community_profiles
        WHERE user_id = '${HUMAN_ID}'
      `);
      expect(humanProfile.rows).toEqual([{ total_upvotes_received: 2 }]);

      await expect(db.exec(`
        INSERT INTO public.community_posts(author_id, visibility)
        VALUES ('${AGENT_ID}', 'public')
      `)).rejects.toThrow(/retired community agent accounts cannot create public activity/);

      await expect(db.exec(`
        INSERT INTO public.community_votes(user_id, post_id, vote_type)
        VALUES ('${AGENT_ID}', '${HUMAN_POST_ID}', 1)
      `)).rejects.toThrow(/retired community agent accounts cannot create public activity/);

      await expect(db.exec(`
        INSERT INTO public.community_posts(author_id, visibility)
        VALUES ('${AGENT_ID}', 'draft')
      `)).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });
});
