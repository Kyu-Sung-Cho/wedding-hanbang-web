// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260731180000_community_release_trust_boundary.sql",
  ),
  "utf8",
);

const AUTHOR_ID = "10000000-0000-4000-8000-000000000001";
const REPORTER_ID = "10000000-0000-4000-8000-000000000002";
const REPORTER_TWO_ID = "10000000-0000-4000-8000-000000000003";
const REPORTER_THREE_ID = "10000000-0000-4000-8000-000000000004";
const SUSPENDED_ID = "20000000-0000-4000-8000-000000000001";
const AGENT_ID = "30000000-0000-4000-8000-000000000001";
const ADMIN_ID = "40000000-0000-4000-8000-000000000001";
const NEW_USER_ID = "40000000-0000-4000-8000-000000000002";
const POST_ID = "50000000-0000-4000-8000-000000000001";
const SUSPENDED_POST_ID = "50000000-0000-4000-8000-000000000002";
const DELETABLE_POST_ID = "50000000-0000-4000-8000-000000000003";
const COMMENT_ID = "60000000-0000-4000-8000-000000000001";
const SUSPENDED_MESSAGE_ID = "60000000-0000-4000-8000-000000000002";

async function setRequestIdentity(
  db: PGlite,
  role: "authenticated" | "service_role",
  userId?: string,
) {
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
}

async function createBaseline(db: PGlite) {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE OR REPLACE FUNCTION auth.uid()
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

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      is_suspended boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.community_agent_personas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      status text NOT NULL,
      backing_user_id uuid
    );

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL,
      title text NOT NULL DEFAULT '제목',
      content text NOT NULL DEFAULT '내용',
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      search_vector tsvector
    );

    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
      author_id uuid NOT NULL,
      content text NOT NULL DEFAULT '답변',
      is_deleted boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.community_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      post_id uuid,
      comment_id uuid,
      vote_type smallint NOT NULL DEFAULT 1
    );

    CREATE TABLE public.community_poll_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id uuid NOT NULL DEFAULT gen_random_uuid(),
      option_id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL
    );

    CREATE TABLE public.community_bookmarks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      post_id uuid NOT NULL
    );

    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL,
      content text NOT NULL DEFAULT '메시지',
      is_deleted boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.cohort_contracts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      notes text
    );

    CREATE TABLE public.cohort_timeline_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      description text
    );

    CREATE TABLE public.community_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id uuid NOT NULL,
      post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
      comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
      reason text NOT NULL CHECK (
        reason IN ('spam', 'abuse', 'ad', 'inappropriate', 'other')
      ),
      description text,
      status text NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'reviewed', 'resolved', 'dismissed')
      ),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL)
        OR (post_id IS NULL AND comment_id IS NOT NULL)
      )
    );

    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;

    CREATE POLICY baseline_posts_select
      ON public.community_posts FOR SELECT USING (true);
    CREATE POLICY baseline_comments_select
      ON public.community_comments FOR SELECT USING (true);
    CREATE POLICY community_reports_select_own
      ON public.community_reports FOR SELECT TO authenticated
      USING (reporter_id = auth.uid());
    CREATE POLICY community_reports_insert_own
      ON public.community_reports FOR INSERT TO authenticated
      WITH CHECK (reporter_id = auth.uid());

    CREATE OR REPLACE FUNCTION public.community_report_auto_review()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RETURN NEW;
    END
    $$;

    CREATE TRIGGER trg_report_auto_review
    AFTER INSERT ON public.community_reports
    FOR EACH ROW
    EXECUTE FUNCTION public.community_report_auto_review();

    INSERT INTO auth.users(id) VALUES
      ('${AUTHOR_ID}'),
      ('${REPORTER_ID}'),
      ('${REPORTER_TWO_ID}'),
      ('${REPORTER_THREE_ID}'),
      ('${SUSPENDED_ID}'),
      ('${AGENT_ID}'),
      ('${ADMIN_ID}'),
      ('${NEW_USER_ID}');

    INSERT INTO public.profiles(id, is_admin)
    VALUES ('${ADMIN_ID}', true);

    INSERT INTO public.community_profiles(user_id, is_suspended) VALUES
      ('${AUTHOR_ID}', false),
      ('${REPORTER_ID}', false),
      ('${REPORTER_TWO_ID}', false),
      ('${REPORTER_THREE_ID}', false),
      ('${SUSPENDED_ID}', true);

    INSERT INTO public.community_agent_personas(status, backing_user_id)
    VALUES ('active', '${AGENT_ID}');

    INSERT INTO public.community_posts(id, author_id, title, visibility) VALUES
      ('${POST_ID}', '${AUTHOR_ID}', '레거시 질문', 'public'),
      ('${SUSPENDED_POST_ID}', '${SUSPENDED_ID}', '정지 사용자 글', 'public'),
      ('${DELETABLE_POST_ID}', '${SUSPENDED_ID}', '삭제할 글', 'public');

    INSERT INTO public.community_comments(id, post_id, author_id, content)
    VALUES ('${COMMENT_ID}', '${POST_ID}', '${AUTHOR_ID}', '레거시 답변');

    INSERT INTO public.cohort_messages(id, author_id, content)
    VALUES ('${SUSPENDED_MESSAGE_ID}', '${SUSPENDED_ID}', '정지 전 메시지');

    INSERT INTO public.community_reports(
      id, reporter_id, post_id, reason, description, created_at
    ) VALUES
      (
        '70000000-0000-4000-8000-000000000001',
        '${REPORTER_ID}',
        '${POST_ID}',
        'spam',
        '첫 신고',
        '2026-07-01T00:00:00Z'
      ),
      (
        '70000000-0000-4000-8000-000000000002',
        '${REPORTER_ID}',
        '${POST_ID}',
        'spam',
        '중복 신고',
        '2026-07-02T00:00:00Z'
      ),
      (
        '70000000-0000-4000-8000-000000000003',
        '${AUTHOR_ID}',
        '${POST_ID}',
        'other',
        '자기 신고',
        '2026-07-03T00:00:00Z'
      );
  `);
}

describe("community release trust migration", () => {
  it("enforces provenance, suspension, report, moderation, notice, and appeal boundaries", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);

      const legacyOrigins = await db.query<{ origin: string }>(`
        SELECT content_origin::text AS origin
        FROM public.community_posts
        WHERE id = '${POST_ID}'
        UNION ALL
        SELECT content_origin::text AS origin
        FROM public.community_comments
        WHERE id = '${COMMENT_ID}'
      `);
      expect(legacyOrigins.rows).toEqual([
        { origin: "legacy_unverified" },
        { origin: "legacy_unverified" },
      ]);

      const historicalReports = await db.query<{
        reporter_id: string;
        status: string;
      }>(`
        SELECT reporter_id, status
        FROM public.community_reports
        WHERE post_id = '${POST_ID}'
        ORDER BY reporter_id
      `);
      expect(historicalReports.rows).toEqual([
        { reporter_id: AUTHOR_ID, status: "dismissed" },
        { reporter_id: REPORTER_ID, status: "pending" },
      ]);

      await db.exec("SET ROLE service_role");
      await expect(db.exec(`
        UPDATE public.community_reports
        SET status = 'resolved'
        WHERE id = '70000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE");

      const autoReviewTrigger = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_trigger
        WHERE tgname = 'trg_report_auto_review'
          AND NOT tgisinternal
      `);
      expect(autoReviewTrigger.rows).toEqual([{ count: 0 }]);

      await setRequestIdentity(db, "authenticated", REPORTER_ID);
      const memberPost = await db.query<{ id: string; content_origin: string }>(`
        INSERT INTO public.community_posts(author_id, title)
        VALUES ('${REPORTER_ID}', '새 질문')
        RETURNING id, content_origin::text
      `);
      expect(memberPost.rows[0]?.content_origin).toBe("member");

      await expect(db.exec(`
        INSERT INTO public.community_posts(author_id, title, content_origin)
        VALUES ('${REPORTER_ID}', '출처 위조', 'ai')
      `)).rejects.toThrow(/cannot assign community content provenance/);

      await setRequestIdentity(db, "authenticated", SUSPENDED_ID);
      await expect(db.exec(`
        INSERT INTO public.community_posts(author_id, title)
        VALUES ('${SUSPENDED_ID}', '정지 후 새 글')
      `)).rejects.toThrow(/account is suspended/);
      await expect(db.exec(`
        INSERT INTO public.community_votes(user_id, post_id)
        VALUES ('${SUSPENDED_ID}', '${POST_ID}')
      `)).rejects.toThrow(/account is suspended/);
      await expect(db.exec(`
        INSERT INTO public.community_poll_votes(user_id)
        VALUES ('${SUSPENDED_ID}')
      `)).rejects.toThrow(/account is suspended/);

      await expect(db.exec(`
        UPDATE public.community_posts
        SET title = '정지 중 편집'
        WHERE id = '${SUSPENDED_POST_ID}'
      `)).rejects.toThrow(/account is suspended/);

      await expect(db.exec(`
        UPDATE public.community_posts
        SET visibility = 'draft'
        WHERE id = '${SUSPENDED_POST_ID}'
      `)).resolves.toBeDefined();
      await expect(db.exec(`
        UPDATE public.cohort_messages
        SET is_deleted = true
        WHERE id = '${SUSPENDED_MESSAGE_ID}'
      `)).resolves.toBeDefined();

      await expect(db.exec(`
        DELETE FROM public.community_posts
        WHERE id = '${DELETABLE_POST_ID}'
      `)).resolves.toBeDefined();

      await setRequestIdentity(db, "authenticated", NEW_USER_ID);
      await expect(db.exec(`
        INSERT INTO public.community_votes(user_id, post_id)
        VALUES ('${NEW_USER_ID}', '${POST_ID}')
      `)).resolves.toBeDefined();
      await expect(db.exec(`
        INSERT INTO public.community_bookmarks(user_id, post_id)
        VALUES ('${NEW_USER_ID}', '${POST_ID}')
      `)).resolves.toBeDefined();

      await setRequestIdentity(db, "authenticated", AGENT_ID);
      await expect(db.exec(`
        INSERT INTO public.community_posts(author_id, title, visibility)
        VALUES ('${AGENT_ID}', '사람처럼 보이는 글', 'public')
      `)).rejects.toThrow(/agent backing accounts cannot create public activity/);

      const containedAgentPost = await db.query<{ id: string }>(`
        INSERT INTO public.community_posts(author_id, title, visibility)
        VALUES ('${AGENT_ID}', '격리된 초안', 'draft')
        RETURNING id
      `);
      const containedAgentPostId = containedAgentPost.rows[0]?.id;
      expect(containedAgentPostId).toBeTruthy();

      await expect(db.exec(`
        UPDATE public.community_posts
        SET visibility = 'public'
        WHERE id = '${containedAgentPostId}'
      `)).rejects.toThrow(/agent backing accounts cannot create public activity/);

      await expect(db.exec(`
        INSERT INTO public.community_votes(user_id, post_id)
        VALUES ('${AGENT_ID}', '${POST_ID}')
      `)).rejects.toThrow(/agent backing accounts cannot create public activity/);

      await setRequestIdentity(db, "authenticated", REPORTER_ID);
      const firstCommentReport = await db.query<{ result: { report_id: string } }>(`
        SELECT public.community_submit_report(
          'comment',
          '${COMMENT_ID}',
          'abuse',
          '모욕적인 답변'
        ) AS result
      `);
      const firstCommentReportId = firstCommentReport.rows[0]?.result.report_id;
      const repeatedCommentReport = await db.query<{
        result: { report_id: string };
      }>(`
        SELECT public.community_submit_report(
          'comment',
          '${COMMENT_ID}',
          'abuse',
          '중복 제출'
        ) AS result
      `);
      expect(repeatedCommentReport.rows[0]?.result.report_id).toBe(
        firstCommentReportId,
      );

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await expect(db.exec(`
        SELECT public.community_submit_report(
          'post',
          '${POST_ID}',
          'other',
          '내 글 신고'
        )
      `)).rejects.toThrow(/cannot report their own content/);

      for (const reporterId of [REPORTER_TWO_ID, REPORTER_THREE_ID]) {
        await setRequestIdentity(db, "authenticated", reporterId);
        await db.query(
          `
            SELECT public.community_submit_report(
              'post',
              $1,
              'spam',
              '추가 신고'
            )
          `,
          [POST_ID],
        );
      }

      const reviewStateBeforeModeration = await db.query<{
        under_review: boolean;
      }>(`
        SELECT under_review
        FROM public.community_posts
        WHERE id = '${POST_ID}'
      `);
      expect(reviewStateBeforeModeration.rows).toEqual([
        { under_review: false },
      ]);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      const reviewedReport = await db.query<{
        result: {
          ok: boolean;
          event_id: string;
          status: string;
          target_type: string;
          target_id: string;
        };
      }>(`
        SELECT public.community_review_report(
          '70000000-0000-4000-8000-000000000001',
          'reviewed',
          '신고 증거를 확인함',
          '${ADMIN_ID}'
        ) AS result
      `);
      await db.exec("RESET ROLE");
      expect(reviewedReport.rows[0]?.result).toMatchObject({
        ok: true,
        status: "reviewed",
        target_type: "post",
        target_id: POST_ID,
      });
      const reviewedReportReplay = await db.query<{
        result: { event_id: string; idempotent_replay: boolean };
      }>(`
        SELECT public.community_review_report(
          '70000000-0000-4000-8000-000000000001',
          'reviewed',
          '같은 요청 재시도',
          '${ADMIN_ID}'
        ) AS result
      `);
      expect(reviewedReportReplay.rows[0]?.result).toMatchObject({
        event_id: reviewedReport.rows[0]?.result.event_id,
        idempotent_replay: true,
      });

      const hidden = await db.query<{
        result: {
          ok: boolean;
          event_id: string;
          notice_id: string;
          action: string;
        };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          '신고 검토 결과 숨김',
          '${ADMIN_ID}'
        ) AS result
      `);
      expect(hidden.rows[0]?.result).toMatchObject({
        ok: true,
        action: "hide",
      });

      const eventId = hidden.rows[0]?.result.event_id;
      const noticeId = hidden.rows[0]?.result.notice_id;
      const hiddenReplay = await db.query<{
        result: {
          event_id: string;
          notice_id: string;
          idempotent_replay: boolean;
        };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          '네트워크 재시도',
          '${ADMIN_ID}'
        ) AS result
      `);
      expect(hiddenReplay.rows[0]?.result).toMatchObject({
        event_id: eventId,
        notice_id: noticeId,
        idempotent_replay: true,
      });

      const moderatedState = await db.query<{
        visibility: string;
        under_review: boolean;
      }>(`
        SELECT visibility, under_review
        FROM public.community_posts
        WHERE id = '${POST_ID}'
      `);
      expect(moderatedState.rows).toEqual([
        { visibility: "draft", under_review: true },
      ]);

      const resolvedReports = await db.query<{ status: string; count: number }>(`
        SELECT status, count(*)::int AS count
        FROM public.community_reports
        WHERE post_id = '${POST_ID}'
        GROUP BY status
        ORDER BY status
      `);
      expect(resolvedReports.rows).toEqual([
        { status: "dismissed", count: 1 },
        { status: "resolved", count: 3 },
      ]);

      const notice = await db.query<{
        id: string;
        recipient_id: string;
        appeal_available: boolean;
      }>(`
        SELECT id, recipient_id, appeal_available
        FROM public.community_moderation_notices
        WHERE event_id = '${eventId}'
      `);
      expect(notice.rows).toEqual([
        {
          id: noticeId,
          recipient_id: AUTHOR_ID,
          appeal_available: true,
        },
      ]);

      await expect(db.exec(`
        UPDATE public.community_moderation_events
        SET reason = '감사 기록 위조'
        WHERE id = '${eventId}'
      `)).rejects.toThrow(/append-only/);
      await expect(db.exec(`
        DELETE FROM public.community_moderation_events
        WHERE id = '${eventId}'
      `)).rejects.toThrow(/append-only/);
      await expect(db.exec(`
        INSERT INTO public.community_moderation_events(
          target_type,
          target_id,
          target_author_id,
          action,
          actor_id,
          reason,
          before_state,
          after_state
        )
        VALUES (
          'post',
          '${POST_ID}',
          '${AUTHOR_ID}',
          'hide',
          '${ADMIN_ID}',
          'RPC를 우회한 감사 로그',
          '{}'::jsonb,
          '{}'::jsonb
        )
      `)).rejects.toThrow(/atomic service RPC/);

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await db.exec(`
        UPDATE public.community_moderation_notices
        SET read_at = now()
        WHERE id = '${noticeId}'
      `);
      await expect(db.exec(`
        UPDATE public.community_moderation_notices
        SET read_at = now() + interval '1 minute'
        WHERE id = '${noticeId}'
      `)).rejects.toThrow(/unread-to-read/);

      await expect(db.exec(`
        INSERT INTO public.community_moderation_appeals(
          event_id,
          appellant_id,
          reason
        )
        VALUES (
          '${eventId}',
          '${AUTHOR_ID}',
          '맥락을 다시 검토해 주세요.'
        )
      `)).resolves.toBeDefined();
      await expect(db.exec(`
        INSERT INTO public.community_moderation_appeals(
          event_id,
          appellant_id,
          reason
        )
        VALUES (
          '${eventId}',
          '${AUTHOR_ID}',
          '두 번째 이의'
        )
      `)).rejects.toThrow();

      await setRequestIdentity(db, "service_role");
      await db.query(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'restore',
          '재검토 결과 복원',
          '${ADMIN_ID}'
        )
      `);

      const restoredState = await db.query<{
        visibility: string;
        under_review: boolean;
      }>(`
        SELECT visibility, under_review
        FROM public.community_posts
        WHERE id = '${POST_ID}'
      `);
      expect(restoredState.rows).toEqual([
        { visibility: "public", under_review: false },
      ]);

      const reportStatusesAfterRestore = await db.query<{
        status: string;
        count: number;
      }>(`
        SELECT status, count(*)::int AS count
        FROM public.community_reports
        WHERE post_id = '${POST_ID}'
        GROUP BY status
      `);
      expect(reportStatusesAfterRestore.rows).toEqual([
        { status: "dismissed", count: 4 },
      ]);

      const reclassified = await db.query<{
        result: { ok: boolean; changed: boolean; content_origin: string };
      }>(`
        SELECT public.community_reclassify_content_origin(
          'post',
          '${POST_ID}',
          'operator',
          '운영자 작성 이력 확인',
          '${ADMIN_ID}'
        ) AS result
      `);
      expect(reclassified.rows[0]?.result).toMatchObject({
        ok: true,
        changed: true,
        content_origin: "operator",
      });

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await expect(db.exec(`
        UPDATE public.community_posts
        SET content_origin = 'member'
        WHERE id = '${POST_ID}'
      `)).rejects.toThrow(/provenance is immutable/);

      const eventActions = await db.query<{ action: string }>(`
        SELECT action
        FROM public.community_moderation_events
        ORDER BY created_at, id
      `);
      expect(eventActions.rows.map((row) => row.action).sort()).toEqual([
        "hide",
        "reclassify_origin",
        "restore",
        "review_report",
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps the release contract explicit in SQL", () => {
    expect(migration).toContain(
      "CREATE TYPE public.community_content_origin AS ENUM",
    );
    expect(migration).toMatch(
      /DROP TRIGGER IF EXISTS trg_report_auto_review/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS community_reports_reporter_comment_unique/,
    );
    expect(migration).toMatch(
      /community moderation events are append-only/,
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.community_moderate_content(",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.community_review_report(",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.community_moderation_notices",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.community_moderation_appeals",
    );
    expect(migration).toContain(
      "Suspension never removes the user's right to delete or contain their own",
    );
    expect(migration).toContain("Postconditions (run read-only on a hosted clone");
  });
});
