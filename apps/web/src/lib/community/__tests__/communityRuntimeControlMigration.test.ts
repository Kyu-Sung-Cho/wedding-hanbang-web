// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260804130000_community_runtime_control.sql",
);
const migration = readFileSync(migrationPath, "utf8");

const MEMBER_ID = "10000000-0000-4000-8000-000000000001";
const ADMIN_ID = "10000000-0000-4000-8000-000000000002";
const POST_ID = "20000000-0000-4000-8000-000000000001";
const REPORT_ID = "30000000-0000-4000-8000-000000000001";

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

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
    );

    CREATE OR REPLACE FUNCTION public.community_request_is_service()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $$
      SELECT CASE
        WHEN COALESCE(current_setting('request.jwt.claim.role', true), '') <> ''
          THEN current_setting('request.jwt.claim.role', true) = 'service_role'
        ELSE current_user IN ('postgres', 'service_role')
      END
    $$;
    REVOKE ALL ON FUNCTION public.community_request_is_service() FROM PUBLIC;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      avatar_url text,
      badge text NOT NULL DEFAULT 'member',
      rank text NOT NULL DEFAULT 'sprout',
      is_suspended boolean NOT NULL DEFAULT false
    );
    CREATE VIEW public.community_public_profiles
    WITH (security_barrier = true)
    AS
    SELECT user_id, nickname, avatar_url, badge, rank
    FROM public.community_profiles
    WHERE is_suspended = false;

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      title text NOT NULL,
      visibility text NOT NULL DEFAULT 'public'
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL,
      author_id uuid NOT NULL,
      content text NOT NULL
    );
    CREATE TABLE public.community_reports (
      id uuid PRIMARY KEY,
      reporter_id uuid NOT NULL,
      post_id uuid,
      reason text NOT NULL
    );

    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
    CREATE POLICY posts_read ON public.community_posts
      FOR SELECT TO anon, authenticated USING (visibility = 'public');
    CREATE POLICY posts_write ON public.community_posts
      FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
    CREATE POLICY comments_read ON public.community_comments
      FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY comments_write ON public.community_comments
      FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
    CREATE POLICY reports_own ON public.community_reports
      FOR ALL TO authenticated
      USING (reporter_id = auth.uid())
      WITH CHECK (reporter_id = auth.uid());

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.community_posts,
      public.community_comments,
      public.community_reports
      TO authenticated, service_role;
    GRANT SELECT ON TABLE
      public.community_posts,
      public.community_comments
      TO anon;
    GRANT SELECT ON TABLE public.community_public_profiles
      TO anon, authenticated, service_role;

    INSERT INTO public.profiles (id, is_admin)
    VALUES ('${ADMIN_ID}', true), ('${MEMBER_ID}', false);
    INSERT INTO public.community_profiles (
      user_id, nickname, avatar_url, badge, rank, is_suspended
    ) VALUES (
      '${MEMBER_ID}', 'Member', NULL, 'member', 'sprout', false
    );
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId: string | null = null,
) {
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
  await db.exec(`SET ROLE ${role};`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false), set_config('app.community_safety_bypass', 'off', false)",
  );
}

async function setMode(
  db: PGlite,
  mode: "normal" | "read_only" | "disabled",
  reason: string,
) {
  await resetPersona(db);
  await setPersona(db, "service_role");
  const result = await db.query<{ result: Record<string, unknown> }>(
    "SELECT public.community_set_runtime_mode($1, $2, $3) AS result",
    [mode, reason, ADMIN_ID],
  );
  await resetPersona(db);
  return result.rows[0]?.result;
}

describe("community runtime control migration", () => {
  it("keeps control changes service-only and appends durable audit evidence", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", ADMIN_ID);
      await expect(
        db.query(
          "SELECT public.community_set_runtime_mode('read_only', 'incident response', $1)",
          [ADMIN_ID],
        ),
      ).rejects.toThrow(/permission denied/iu);

      const result = await setMode(db, "read_only", "incident response");
      expect(result).toMatchObject({
        previous_mode: "normal",
        mode: "read_only",
        reason: "incident response",
      });

      await setPersona(db, "service_role");
      const state = await db.query<{
        mode: string;
        reason: string;
        event_count: number;
      }>(`
        SELECT control.mode, control.reason,
          (SELECT count(*)::integer
           FROM public.community_runtime_control_events) AS event_count
        FROM public.community_runtime_control AS control
        WHERE control.control_key = 'global'
      `);
      expect(state.rows[0]).toEqual({
        mode: "read_only",
        reason: "incident response",
        event_count: 2,
      });
      await expect(
        db.exec(`
          UPDATE public.community_runtime_control
          SET mode = 'normal'
          WHERE control_key = 'global'
        `),
      ).rejects.toThrow(/permission denied/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("blocks ordinary writes fail-closed while leaving safety intake open", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", MEMBER_ID);
      await expect(
        db.exec(`
          INSERT INTO public.community_posts (id, author_id, title)
          VALUES ('${POST_ID}', '${MEMBER_ID}', 'normal post')
        `),
      ).resolves.toBeDefined();

      await setMode(db, "read_only", "abuse containment");
      await setPersona(db, "authenticated", MEMBER_ID);
      await db.query(
        "SELECT set_config('app.community_safety_bypass', 'on', false)",
      );
      await expect(
        db.exec(`
          INSERT INTO public.community_comments (id, post_id, author_id, content)
          VALUES (
            '40000000-0000-4000-8000-000000000001',
            '${POST_ID}', '${MEMBER_ID}', 'blocked comment'
          )
        `),
      ).rejects.toThrow(/community is read-only/iu);

      await expect(
        db.exec(`
          INSERT INTO public.community_reports (id, reporter_id, post_id, reason)
          VALUES ('${REPORT_ID}', '${MEMBER_ID}', '${POST_ID}', 'abuse')
        `),
      ).resolves.toBeDefined();

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(
        db.exec(`
          INSERT INTO public.community_comments (id, post_id, author_id, content)
          VALUES (
            '40000000-0000-4000-8000-000000000002',
            '${POST_ID}', '${MEMBER_ID}', 'ordinary service write'
          )
        `),
      ).rejects.toThrow(/community is read-only/iu);

      await db.query(
        "SELECT set_config('app.community_safety_bypass', 'on', false)",
      );
      await expect(
        db.exec(`
          INSERT INTO public.community_comments (id, post_id, author_id, content)
          VALUES (
            '40000000-0000-4000-8000-000000000003',
            '${POST_ID}', '${MEMBER_ID}', 'safety operation'
          )
        `),
      ).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("hides community reads when disabled without hiding reports", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", MEMBER_ID);
      await db.exec(`
        INSERT INTO public.community_posts (id, author_id, title)
        VALUES ('${POST_ID}', '${MEMBER_ID}', 'visible before shutdown');
        INSERT INTO public.community_reports (id, reporter_id, post_id, reason)
        VALUES ('${REPORT_ID}', '${MEMBER_ID}', '${POST_ID}', 'abuse');
      `);

      await setMode(db, "disabled", "privacy incident");
      await setPersona(db, "authenticated", MEMBER_ID);
      const posts = await db.query("SELECT id FROM public.community_posts");
      const profiles = await db.query(
        "SELECT user_id FROM public.community_public_profiles",
      );
      const reports = await db.query(
        "SELECT id FROM public.community_reports WHERE id = $1",
        [REPORT_ID],
      );
      expect(posts.rows).toEqual([]);
      expect(profiles.rows).toEqual([]);
      expect(reports.rows).toHaveLength(1);

      await setMode(db, "normal", "incident resolved");
      await setPersona(db, "authenticated", MEMBER_ID);
      const restoredPosts = await db.query(
        "SELECT id FROM public.community_posts",
      );
      const restoredProfiles = await db.query(
        "SELECT user_id FROM public.community_public_profiles",
      );
      expect(restoredPosts.rows).toHaveLength(1);
      expect(restoredProfiles.rows).toHaveLength(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("documents the two-plane release procedure and never fences safety tables", () => {
    expect(migration).toMatch(/COMMUNITY_RUNTIME_MODE/iu);
    expect(migration).toMatch(/community_reports[\s\S]*remain available/iu);
    expect(migration).toMatch(
      /community_moderation_appeals[\s\S]*remain available/iu,
    );

    const guardedTables = migration.match(
      /FOREACH v_table_name IN ARRAY ARRAY\[([\s\S]*?)\]/iu,
    )?.[1];
    expect(guardedTables).toBeDefined();
    expect(guardedTables).not.toMatch(/community_reports/iu);
    expect(guardedTables).not.toMatch(/community_moderation_appeals/iu);
    expect(guardedTables).not.toMatch(/cohort_member_reports/iu);
  });
});
