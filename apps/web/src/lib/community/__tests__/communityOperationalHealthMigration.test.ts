// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260731183000_community_operational_health.sql",
  ),
  "utf8",
);

type HealthResult = {
  window_days: number;
  public_non_review_post_count: number;
  window_question_count: number;
  over_24h_without_human_reply_count: number;
  first_human_reply_median_hours: number | null;
  human_reply_within_24h_rate: number | null;
  resolved_question_rate: number | null;
  post_content_origin_counts: Record<string, number>;
  comment_content_origin_counts: Record<string, number>;
  pending_report_count: number;
  oldest_pending_report_hours: number | null;
  unresolved_appeal_count: number;
  unread_reply_notification_count: number;
};

async function createFinalCommunitySchema(db: PGlite) {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TYPE public.community_content_origin AS ENUM (
      'member',
      'operator',
      'ai',
      'industry_professional',
      'legacy_unverified'
    );

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      category text NOT NULL,
      visibility text NOT NULL,
      under_review boolean NOT NULL DEFAULT false,
      is_resolved boolean NOT NULL DEFAULT false,
      content_origin public.community_content_origin NOT NULL,
      created_at timestamptz NOT NULL
    );

    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES public.community_posts(id),
      content_origin public.community_content_origin NOT NULL,
      is_deleted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL
    );

    CREATE TABLE public.community_reports (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      created_at timestamptz NOT NULL
    );

    CREATE TABLE public.community_moderation_appeals (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      created_at timestamptz NOT NULL
    );

    CREATE TABLE public.community_reply_notifications (
      id uuid PRIMARY KEY,
      read_at timestamptz
    );
  `);
}

describe("community operational health migration", () => {
  it("returns honest release metrics and excludes non-human or hidden activity", async () => {
    const db = await PGlite.create();
    try {
      await createFinalCommunitySchema(db);
      await db.exec(migration);
      await db.exec("BEGIN");
      await db.exec(`
        INSERT INTO public.community_posts (
          id, category, visibility, under_review, is_resolved,
          content_origin, created_at
        ) VALUES
          ('10000000-0000-4000-8000-000000000001', 'is_normal', 'public', false, true,  'member',                now() - interval '10 days'),
          ('10000000-0000-4000-8000-000000000002', 'ama',       'public', false, false, 'member',                now() - interval '5 days'),
          ('10000000-0000-4000-8000-000000000003', 'is_normal', 'public', false, false, 'industry_professional', now() - interval '2 days'),
          ('10000000-0000-4000-8000-000000000004', 'ama',       'public', false, false, 'member',                now() - interval '12 hours'),
          ('10000000-0000-4000-8000-000000000005', 'is_normal', 'public', false, true,  'legacy_unverified',     now() - interval '40 days'),
          ('10000000-0000-4000-8000-000000000006', 'tips_v2',   'public', false, false, 'operator',              now() - interval '1 day'),
          ('10000000-0000-4000-8000-000000000007', 'ama',       'public', true,  false, 'ai',                    now() - interval '4 days'),
          ('10000000-0000-4000-8000-000000000008', 'ama',       'members', false, false, 'ai',                   now() - interval '4 days');

        INSERT INTO public.community_comments (
          id, post_id, content_origin, is_deleted, created_at
        ) VALUES
          ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ai',                    false, now() - interval '9 days 23 hours 30 minutes'),
          ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'member',                false, now() - interval '9 days 22 hours'),
          ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'operator',              false, now() - interval '4 days 23 hours'),
          ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'legacy_unverified',     false, now() - interval '1 day 23 hours'),
          ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', 'industry_professional', false, now() - interval '1 day 14 hours'),
          ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000005', 'member',                false, now() - interval '39 days'),
          ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000006', 'operator',              false, now() - interval '23 hours'),
          ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000006', 'ai',                    true,  now() - interval '22 hours'),
          ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000007', 'member',                false, now() - interval '3 days'),
          ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000008', 'member',                false, now() - interval '3 days');

        INSERT INTO public.community_reports (id, status, created_at) VALUES
          ('30000000-0000-4000-8000-000000000001', 'pending',  now() - interval '10 hours'),
          ('30000000-0000-4000-8000-000000000002', 'pending',  now() - interval '3 hours'),
          ('30000000-0000-4000-8000-000000000003', 'reviewed', now() - interval '20 hours');

        INSERT INTO public.community_moderation_appeals (
          id, status, created_at
        ) VALUES
          ('40000000-0000-4000-8000-000000000001', 'pending',    now() - interval '8 hours'),
          ('40000000-0000-4000-8000-000000000002', 'reviewed',   now() - interval '7 hours'),
          ('40000000-0000-4000-8000-000000000003', 'upheld',     now() - interval '6 hours'),
          ('40000000-0000-4000-8000-000000000004', 'overturned', now() - interval '5 hours');

        INSERT INTO public.community_reply_notifications (id, read_at) VALUES
          ('50000000-0000-4000-8000-000000000001', NULL),
          ('50000000-0000-4000-8000-000000000002', NULL),
          ('50000000-0000-4000-8000-000000000003', now());
      `);

      const result = await db.query<{ health: HealthResult }>(`
        SELECT public.community_operational_health(30) AS health
      `);
      await db.exec("COMMIT");

      expect(result.rows[0]?.health).toMatchObject({
        window_days: 30,
        public_non_review_post_count: 6,
        window_question_count: 4,
        over_24h_without_human_reply_count: 1,
        first_human_reply_median_hours: 6,
        human_reply_within_24h_rate: 0.666667,
        resolved_question_rate: 0.25,
        post_content_origin_counts: {
          member: 3,
          operator: 1,
          ai: 0,
          industry_professional: 1,
          legacy_unverified: 1,
        },
        comment_content_origin_counts: {
          member: 2,
          operator: 2,
          ai: 1,
          industry_professional: 1,
          legacy_unverified: 1,
        },
        pending_report_count: 2,
        oldest_pending_report_hours: 10,
        unresolved_appeal_count: 2,
        unread_reply_notification_count: 2,
      });
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps empty denominators null and exposes only a stable service RPC", async () => {
    const db = await PGlite.create();
    try {
      await createFinalCommunitySchema(db);
      await db.exec(migration);

      const metadata = await db.query<{
        volatility: string;
        security_definer: boolean;
        authenticated_can_execute: boolean;
        service_can_execute: boolean;
      }>(`
        SELECT
          procedure.provolatile AS volatility,
          procedure.prosecdef AS security_definer,
          has_function_privilege(
            'authenticated',
            'public.community_operational_health(integer)',
            'EXECUTE'
          ) AS authenticated_can_execute,
          has_function_privilege(
            'service_role',
            'public.community_operational_health(integer)',
            'EXECUTE'
          ) AS service_can_execute
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'community_operational_health'
      `);
      expect(metadata.rows).toEqual([
        {
          volatility: "s",
          security_definer: true,
          authenticated_can_execute: false,
          service_can_execute: true,
        },
      ]);

      await db.exec("SET ROLE authenticated");
      await expect(
        db.exec("SELECT public.community_operational_health(30)"),
      ).rejects.toThrow(/permission denied/i);
      await db.exec("RESET ROLE");

      await db.exec("SET ROLE service_role");
      const empty = await db.query<{ health: HealthResult }>(`
        SELECT public.community_operational_health() AS health
      `);
      expect(empty.rows[0]?.health).toMatchObject({
        window_days: 30,
        first_human_reply_median_hours: null,
        human_reply_within_24h_rate: null,
        resolved_question_rate: null,
        oldest_pending_report_hours: null,
      });
      await expect(
        db.exec("SELECT public.community_operational_health(6)"),
      ).rejects.toThrow(/between 7 and 90 days/i);
      await expect(
        db.exec("SELECT public.community_operational_health(91)"),
      ).rejects.toThrow(/between 7 and 90 days/i);
      await db.exec("RESET ROLE");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
