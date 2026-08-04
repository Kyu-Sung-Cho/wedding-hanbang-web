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
const atomicReportResolutionMigration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260804103000_community_report_resolution_atomic.sql",
  ),
  "utf8",
);
const runtimeControlMigration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260804130000_community_runtime_control.sql",
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

  it("contains a confirmed report and restores its exact prior state atomically", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await db.exec(`
        UPDATE public.community_posts
        SET visibility = 'members'
        WHERE id = '${POST_ID}'
      `);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");

      await expect(db.query(`
        SELECT public.community_review_report(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'legacy path must be closed',
          '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/permission denied/);

      const resolved = await db.query<{
        result: {
          event_id: string;
          notice_id: string;
          status: string;
          content_action: string;
        };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'confirmed harmful content',
          '${ADMIN_ID}',
          '87000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      const resolution = resolved.rows[0]?.result;
      expect(resolution).toMatchObject({
        status: "resolved",
        content_action: "hide",
      });
      await db.exec("RESET ROLE");

      const contained = await db.query<{
        visibility: string;
        under_review: boolean;
        report_status: string;
        event_action: string;
        appeal_available: boolean;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          report.status AS report_status,
          event.action AS event_action,
          notice.appeal_available
        FROM public.community_reports AS report
        JOIN public.community_posts AS post ON post.id = report.post_id
        JOIN public.community_moderation_events AS event
          ON event.id = '${resolution?.event_id}'
        JOIN public.community_moderation_notices AS notice
          ON notice.id = '${resolution?.notice_id}'
        WHERE report.id = '70000000-0000-4000-8000-000000000001'
      `);
      expect(contained.rows).toEqual([{
        visibility: "members",
        under_review: true,
        report_status: "resolved",
        event_action: "hide",
        appeal_available: true,
      }]);

      const resolvedReplay = await db.query<{
        result: {
          event_id: string;
          notice_id: string;
          idempotent_replay: boolean;
        };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'confirmed harmful content',
          '${ADMIN_ID}',
          '87000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      expect(resolvedReplay.rows[0]?.result).toEqual(resolution);
      expect(resolvedReplay.rows[0]?.result).not.toHaveProperty(
        "idempotent_replay",
      );
      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await db.exec(`
        INSERT INTO public.community_moderation_appeals(
          event_id,
          appellant_id,
          reason
        ) VALUES (
          '${resolution?.event_id}',
          '${AUTHOR_ID}',
          'please review the context again'
        )
      `);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      const dismissed = await db.query<{
        result: {
          event_id: string;
          notice_id: string;
          status: string;
          content_action: string;
        };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'appeal accepted after context review',
          '${ADMIN_ID}',
          '87000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      const dismissal = dismissed.rows[0]?.result;
      expect(dismissal).toMatchObject({
        status: "dismissed",
        content_action: "restore",
      });
      await db.exec("RESET ROLE");

      const restored = await db.query<{
        visibility: string;
        under_review: boolean;
        report_status: string;
        appeal_status: string;
        appeal_available: boolean;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          report.status AS report_status,
          appeal.status AS appeal_status,
          notice.appeal_available
        FROM public.community_reports AS report
        JOIN public.community_posts AS post ON post.id = report.post_id
        JOIN public.community_moderation_appeals AS appeal
          ON appeal.event_id = '${resolution?.event_id}'
        JOIN public.community_moderation_notices AS notice
          ON notice.id = '${dismissal?.notice_id}'
        WHERE report.id = '70000000-0000-4000-8000-000000000001'
      `);
      expect(restored.rows).toEqual([{
        visibility: "members",
        under_review: false,
        report_status: "dismissed",
        appeal_status: "overturned",
        appeal_available: false,
      }]);

      const dismissedReplay = await db.query<{
        result: { event_id: string; idempotent_replay: boolean };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'appeal accepted after context review',
          '${ADMIN_ID}',
          '87000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(dismissedReplay.rows[0]?.result).toEqual(dismissal);

      const reportEventCount = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.community_moderation_events
        WHERE metadata ->> 'report_id' =
          '70000000-0000-4000-8000-000000000001'
          AND metadata ->> 'moderation_command_version' = '3'
      `);
      expect(reportEventCount.rows).toEqual([{ count: 2 }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rolls back content, report status, and evidence when notice delivery fails", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.reject_test_notice()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'simulated notice failure';
        END
        $$;

        CREATE TRIGGER trg_reject_test_notice
        BEFORE INSERT ON public.community_moderation_notices
        FOR EACH ROW
        EXECUTE FUNCTION public.reject_test_notice();
      `);

      await setRequestIdentity(db, "service_role");
      await expect(db.query(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'must roll back as one unit',
          '${ADMIN_ID}',
          '87000000-0000-4000-8000-000000000003'
        )
      `)).rejects.toThrow(/simulated notice failure/);

      const stateAfterFailure = await db.query<{
        visibility: string;
        under_review: boolean;
        report_status: string;
        event_count: number;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          report.status AS report_status,
          (
            SELECT count(*)::int
            FROM public.community_moderation_events AS event
            WHERE event.metadata ->> 'moderation_command_version' = '3'
          ) AS event_count
        FROM public.community_reports AS report
        JOIN public.community_posts AS post ON post.id = report.post_id
        WHERE report.id = '70000000-0000-4000-8000-000000000001'
      `);
      expect(stateAfterFailure.rows).toEqual([{
        visibility: "public",
        under_review: false,
        report_status: "pending",
        event_count: 0,
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps direct moderation reversible without deciding independent reports", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await db.exec(`
        UPDATE public.community_posts
        SET visibility = 'members', under_review = false
        WHERE id = '${POST_ID}'
      `);

      await setRequestIdentity(db, "service_role");
      const directHide = await db.query<{
        result: { event_id: string; action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'direct safety containment',
          '${ADMIN_ID}',
          '88000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      const directHideEventId = directHide.rows[0]?.result.event_id;
      expect(directHide.rows[0]?.result.action).toBe("hide");

      const contained = await db.query<{
        visibility: string;
        under_review: boolean;
        report_statuses: string[];
        direct_version: string;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          ARRAY(
            SELECT report.status
            FROM public.community_reports AS report
            WHERE report.post_id = post.id
            ORDER BY report.status
          ) AS report_statuses,
          event.metadata ->> 'moderation_command_version' AS direct_version
        FROM public.community_posts AS post
        JOIN public.community_moderation_events AS event
          ON event.id = '${directHideEventId}'
        WHERE post.id = '${POST_ID}'
      `);
      expect(contained.rows).toEqual([{
        visibility: "members",
        under_review: true,
        report_statuses: ["dismissed", "pending"],
        direct_version: "3",
      }]);

      const reportResolution = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'independent report confirmed',
          '${ADMIN_ID}',
          '88000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(reportResolution.rows[0]?.result.content_action).toBe(
        "already_contained",
      );

      const reportDismissal = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'independent report overturned',
          '${ADMIN_ID}',
          '88000000-0000-4000-8000-000000000003'
        ) AS result
      `);
      expect(reportDismissal.rows[0]?.result.content_action).toBe(
        "retained_containment",
      );

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await db.exec(`
        INSERT INTO public.community_moderation_appeals(
          event_id,
          appellant_id,
          reason
        ) VALUES (
          '${directHideEventId}',
          '${AUTHOR_ID}',
          'the direct moderation should be reviewed'
        )
      `);

      await setRequestIdentity(db, "service_role");
      const directRestore = await db.query<{
        result: { event_id: string; action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'restore',
          'direct containment overturned',
          '${ADMIN_ID}',
          '88000000-0000-4000-8000-000000000004'
        ) AS result
      `);
      const directRestoreEventId = directRestore.rows[0]?.result.event_id;
      expect(directRestore.rows[0]?.result.action).toBe("restore");

      const restored = await db.query<{
        visibility: string;
        under_review: boolean;
        report_statuses: string[];
        appeal_status: string;
        source_event_id: string;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          ARRAY(
            SELECT report.status
            FROM public.community_reports AS report
            WHERE report.post_id = post.id
            ORDER BY report.status
          ) AS report_statuses,
          appeal.status AS appeal_status,
          restore_event.metadata ->> 'source_event_id' AS source_event_id
        FROM public.community_posts AS post
        JOIN public.community_moderation_appeals AS appeal
          ON appeal.event_id = '${directHideEventId}'
        JOIN public.community_moderation_events AS restore_event
          ON restore_event.id = '${directRestoreEventId}'
        WHERE post.id = '${POST_ID}'
      `);
      expect(restored.rows).toEqual([{
        visibility: "members",
        under_review: false,
        report_statuses: ["dismissed", "dismissed"],
        appeal_status: "overturned",
        source_event_id: directHideEventId,
      }]);

      const restoreReplay = await db.query<{
        result: { event_id: string; idempotent_replay: boolean };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'restore',
          'direct containment overturned',
          '${ADMIN_ID}',
          '88000000-0000-4000-8000-000000000004'
        ) AS result
      `);
      expect(restoreReplay.rows[0]?.result).toEqual(
        directRestore.rows[0]?.result,
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("binds direct moderation replay to one exact UUID command", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await setRequestIdentity(db, "service_role");

      const first = await db.query<{
        result: { event_id: string; content_action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'independent direct containment',
          '${ADMIN_ID}',
          '81000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      const firstEventId = first.rows[0]!.result.event_id;
      expect(first.rows[0]!.result.content_action).toBe("hide");

      const replay = await db.query<{
        result: { event_id: string; idempotent_replay: boolean };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'independent direct containment',
          '${ADMIN_ID}',
          '81000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      expect(replay.rows[0]!.result).toEqual(first.rows[0]!.result);
      expect(replay.rows[0]!.result).not.toHaveProperty("idempotent_replay");

      await expect(db.query(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'changed reason must conflict',
          '${ADMIN_ID}',
          '81000000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow(/COMMUNITY_MODERATION_IDEMPOTENCY_CONFLICT/iu);

      const independent = await db.query<{
        result: { event_id: string; content_action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'second independent containment basis',
          '${ADMIN_ID}',
          '81000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(independent.rows[0]!.result).toMatchObject({
        content_action: "already_contained",
      });
      expect(independent.rows[0]!.result.event_id).not.toBe(firstEventId);

      const activeHolds = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.community_moderation_holds
        WHERE target_type = 'post'
          AND target_id = '${POST_ID}'
          AND released_at IS NULL
      `);
      expect(activeHolds.rows).toEqual([{ count: 2 }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails closed when a durable moderation receipt is corrupt or missing", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await setRequestIdentity(db, "service_role");
      const key = "81500000-0000-4000-8000-000000000001";
      const command = `
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'durable receipt integrity check',
          '${ADMIN_ID}',
          '${key}'
        ) AS result
      `;
      await db.query(command);

      await db.exec("RESET ROLE");
      await db.exec(`
        UPDATE public.community_moderation_command_receipts
        SET response_payload = jsonb_set(
          response_payload,
          '{target_contained}',
          'false'::jsonb
        )
        WHERE idempotency_key = '${key}'
      `);
      await setRequestIdentity(db, "service_role");
      await expect(db.query(command)).rejects.toThrow(
        /COMMUNITY_MODERATION_RECEIPT_DIGEST_MISMATCH/iu,
      );

      await db.exec("RESET ROLE");
      await db.exec(`
        DELETE FROM public.community_moderation_command_receipts
        WHERE idempotency_key = '${key}'
      `);
      await setRequestIdentity(db, "service_role");
      await expect(db.query(command)).rejects.toThrow(
        /COMMUNITY_MODERATION_RECEIPT_UNAVAILABLE/iu,
      );

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await db.exec("SET ROLE authenticated");
      await expect(db.query(
        "SELECT * FROM public.community_moderation_command_receipts",
      )).rejects.toThrow(/permission denied/iu);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps report and direct holds independent and releases to current author intent", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await setRequestIdentity(db, "service_role");

      const reportResolution = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'report basis confirmed',
          '${ADMIN_ID}',
          '82000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      expect(reportResolution.rows[0]!.result.content_action).toBe("hide");

      const directResolution = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'independent direct basis',
          '${ADMIN_ID}',
          '82000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(directResolution.rows[0]!.result.content_action).toBe(
        "already_contained",
      );

      const reportDismissal = await db.query<{
        result: { content_action: string; target_contained: boolean };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'report basis overturned',
          '${ADMIN_ID}',
          '82000000-0000-4000-8000-000000000003'
        ) AS result
      `);
      expect(reportDismissal.rows[0]!.result).toMatchObject({
        content_action: "retained_containment",
        target_contained: true,
      });

      // The author can change their eventual visibility while the moderation
      // overlay remains active. Releasing the final hold must not republish it.
      await db.exec(`
        UPDATE public.community_posts
        SET visibility = 'draft'
        WHERE id = '${POST_ID}'
      `);

      const directRestore = await db.query<{
        result: { content_action: string; target_contained: boolean };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'restore',
          'direct basis overturned',
          '${ADMIN_ID}',
          '82000000-0000-4000-8000-000000000004'
        ) AS result
      `);
      expect(directRestore.rows[0]!.result).toMatchObject({
        content_action: "restore",
        target_contained: false,
      });

      const state = await db.query<{
        visibility: string;
        author_visibility: string;
        under_review: boolean;
        active_holds: number;
      }>(`
        SELECT
          post.visibility,
          post.author_visibility,
          post.under_review,
          (
            SELECT count(*)::int
            FROM public.community_moderation_holds AS hold
            WHERE hold.target_type = 'post'
              AND hold.target_id = post.id
              AND hold.released_at IS NULL
          ) AS active_holds
        FROM public.community_posts AS post
        WHERE post.id = '${POST_ID}'
      `);
      expect(state.rows).toEqual([{
        visibility: "draft",
        author_visibility: "draft",
        under_review: false,
        active_holds: 0,
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("marks an old restore receipt superseded after a later containment", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await setRequestIdentity(db, "service_role");

      await db.query(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'first report decision',
          '${ADMIN_ID}',
          '83000000-0000-4000-8000-000000000001'
        )
      `);
      const dismissal = await db.query<{
        result: { event_id: string; content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'first report overturned',
          '${ADMIN_ID}',
          '83000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(dismissal.rows[0]!.result.content_action).toBe("restore");

      await db.query(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'later independent containment',
          '${ADMIN_ID}',
          '83000000-0000-4000-8000-000000000003'
        )
      `);

      const replay = await db.query<{
        result: {
          event_id: string;
          content_action: string;
          target_contained: boolean;
          original_outcome: { content_action: string };
          current_postcondition: {
            target_contained: boolean;
            superseded: boolean;
          };
        };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'first report overturned',
          '${ADMIN_ID}',
          '83000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(replay.rows[0]!.result).toEqual(dismissal.rows[0]!.result);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("records an appealed hold release without claiming the target was restored", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await setRequestIdentity(db, "service_role");

      const resolution = await db.query<{
        result: { event_id: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'appealable report decision',
          '${ADMIN_ID}',
          '84000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      await db.query(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'independent hold remains',
          '${ADMIN_ID}',
          '84000000-0000-4000-8000-000000000002'
        )
      `);

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await db.exec(`
        INSERT INTO public.community_moderation_appeals(
          event_id,
          appellant_id,
          reason
        ) VALUES (
          '${resolution.rows[0]!.result.event_id}',
          '${AUTHOR_ID}',
          'please reverse this report decision'
        )
      `);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      await expect(db.exec(`
        UPDATE public.community_moderation_appeals
        SET status = 'reviewed',
            resolution_reason = 'unlogged direct service decision'
        WHERE event_id = '${resolution.rows[0]!.result.event_id}'
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");

      const dismissal = await db.query<{
        result: { event_id: string; notice_id: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'report decision overturned while another hold remains',
          '${ADMIN_ID}',
          '84000000-0000-4000-8000-000000000003'
        ) AS result
      `);

      const evidence = await db.query<{
        appeal_status: string;
        decision_count: number;
        notice_action: string;
        content_action: string;
        target_contained: boolean;
        appeal_available: boolean;
      }>(`
        SELECT
          appeal.status AS appeal_status,
          (
            SELECT count(*)::int
            FROM public.community_moderation_appeal_decisions AS decision
            WHERE decision.appeal_id = appeal.id
          ) AS decision_count,
          notice.action AS notice_action,
          notice.content_action,
          notice.target_contained,
          notice.appeal_available
        FROM public.community_moderation_appeals AS appeal
        JOIN public.community_moderation_notices AS notice
          ON notice.id = '${dismissal.rows[0]!.result.notice_id}'
        WHERE appeal.event_id = '${resolution.rows[0]!.result.event_id}'
      `);
      expect(evidence.rows).toEqual([{
        appeal_status: "overturned",
        decision_count: 1,
        notice_action: "restore",
        content_action: "retained_containment",
        target_contained: true,
        appeal_available: false,
      }]);

      await db.query(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'report decision overturned while another hold remains',
          '${ADMIN_ID}',
          '84000000-0000-4000-8000-000000000003'
        )
      `);
      const decisionCount = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.community_moderation_appeal_decisions
      `);
      expect(decisionCount.rows).toEqual([{ count: 1 }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("does not resurrect a comment the author deletes during a report hold", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);

      await setRequestIdentity(db, "authenticated", REPORTER_ID);
      const submitted = await db.query<{
        result: { report_id: string };
      }>(`
        SELECT public.community_submit_report(
          'comment',
          '${COMMENT_ID}',
          'abuse',
          'reported comment'
        ) AS result
      `);
      const reportId = submitted.rows[0]!.result.report_id;

      await setRequestIdentity(db, "service_role");
      await db.query(`
        SELECT public.community_review_report_atomic(
          '${reportId}',
          'resolved',
          'comment report confirmed',
          '${ADMIN_ID}',
          '85000000-0000-4000-8000-000000000001'
        )
      `);

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await expect(db.exec(`
        UPDATE public.community_comments
        SET author_deleted_at = clock_timestamp()
        WHERE id = '${COMMENT_ID}'
      `)).rejects.toThrow(/COMMUNITY_AUTHOR_DELETE_REQUIRES_SERVICE_BOUNDARY/iu);

      await setRequestIdentity(db, "service_role");
      await db.exec(`
        UPDATE public.community_comments
        SET author_deleted_at = clock_timestamp(), is_deleted = true
        WHERE id = '${COMMENT_ID}'
      `);
      const dismissal = await db.query<{
        result: { content_action: string; target_contained: boolean };
      }>(`
        SELECT public.community_review_report_atomic(
          '${reportId}',
          'dismissed',
          'comment report overturned',
          '${ADMIN_ID}',
          '85000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(dismissal.rows[0]!.result).toMatchObject({
        content_action: "restore",
        target_contained: false,
      });

      const state = await db.query<{
        is_deleted: boolean;
        author_deleted: boolean;
        active_holds: number;
      }>(`
        SELECT
          comment.is_deleted,
          comment.author_deleted_at IS NOT NULL AS author_deleted,
          (
            SELECT count(*)::int
            FROM public.community_moderation_holds AS hold
            WHERE hold.target_type = 'comment'
              AND hold.target_id = comment.id
              AND hold.released_at IS NULL
          ) AS active_holds
        FROM public.community_comments AS comment
        WHERE comment.id = '${COMMENT_ID}'
      `);
      expect(state.rows).toEqual([{
        is_deleted: true,
        author_deleted: true,
        active_holds: 0,
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("closes every moderation capability after a failed atomic notice", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await db.exec(runtimeControlMigration);
      await db.exec(`
        GRANT SELECT, UPDATE ON TABLE public.community_posts TO service_role;
        CREATE OR REPLACE FUNCTION public.reject_v3_notice()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'simulated v3 notice failure';
        END
        $$;
        CREATE TRIGGER trg_reject_v3_notice
        BEFORE INSERT ON public.community_moderation_notices
        FOR EACH ROW EXECUTE FUNCTION public.reject_v3_notice();
      `);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      await db.query(
        "SELECT public.community_set_runtime_mode('read_only', 'active moderation incident', $1)",
        [ADMIN_ID],
      );

      await expect(db.query(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'must roll back with notice',
          '${ADMIN_ID}',
          '86000000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow(/simulated v3 notice failure/iu);

      const capabilities = await db.query<{
        safety: string;
        event_write: string;
        overlay_write: string;
        appeal_write: string;
      }>(`
        SELECT
          current_setting('app.community_safety_bypass', true) AS safety,
          current_setting(
            'hanbang.community_moderation_event_write', true
          ) AS event_write,
          current_setting(
            'hanbang.community_moderation_overlay_write', true
          ) AS overlay_write,
          current_setting(
            'hanbang.community_appeal_decision_write', true
          ) AS appeal_write
      `);
      expect(capabilities.rows[0]).toMatchObject({
        safety: expect.not.stringMatching(/^on$/u),
        event_write: expect.not.stringMatching(/^on$/u),
        overlay_write: expect.not.stringMatching(/^on$/u),
        appeal_write: expect.not.stringMatching(/^on$/u),
      });

      await expect(db.exec(`
        UPDATE public.community_posts
        SET title = 'must remain frozen'
        WHERE id = '${POST_ID}'
      `)).rejects.toThrow(/community is read-only/iu);
      await db.exec("RESET ROLE");

      const rollback = await db.query<{
        under_review: boolean;
        event_count: number;
        case_count: number;
        hold_count: number;
      }>(`
        SELECT
          post.under_review,
          (
            SELECT count(*)::int
            FROM public.community_moderation_events AS event
            WHERE event.operation_key =
              '86000000-0000-4000-8000-000000000001'
          ) AS event_count,
          (
            SELECT count(*)::int
            FROM public.community_moderation_cases
          ) AS case_count,
          (
            SELECT count(*)::int
            FROM public.community_moderation_holds
          ) AS hold_count
        FROM public.community_posts AS post
        WHERE post.id = '${POST_ID}'
      `);
      expect(rollback.rows).toEqual([{
        under_review: false,
        event_count: 0,
        case_count: 0,
        hold_count: 0,
      }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not restore content while another independently resolved report remains", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);

      await setRequestIdentity(db, "authenticated", REPORTER_TWO_ID);
      const secondReport = await db.query<{
        result: { report_id: string };
      }>(`
        SELECT public.community_submit_report(
          'post',
          '${POST_ID}',
          'abuse',
          'independent report'
        ) AS result
      `);
      const secondReportId = secondReport.rows[0]?.result.report_id;

      await setRequestIdentity(db, "service_role");
      const firstResolution = await db.query<{
        result: { event_id: string; content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'first confirmed report',
          '${ADMIN_ID}',
          '89000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      expect(firstResolution.rows[0]?.result.content_action).toBe("hide");

      const secondResolution = await db.query<{
        result: { content_action: string; notice_id: string | null };
      }>(`
        SELECT public.community_review_report_atomic(
          '${secondReportId}',
          'resolved',
          'second confirmed report',
          '${ADMIN_ID}',
          '89000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(secondResolution.rows[0]?.result).toMatchObject({
        content_action: "already_contained",
      });
      expect(secondResolution.rows[0]?.result.notice_id).toMatch(
        /^[0-9a-f-]{36}$/iu,
      );

      await setRequestIdentity(db, "authenticated", AUTHOR_ID);
      await db.exec(`
        INSERT INTO public.community_moderation_appeals(
          event_id,
          appellant_id,
          reason
        ) VALUES (
          '${firstResolution.rows[0]?.result.event_id}',
          '${AUTHOR_ID}',
          'the first report lacks context'
        )
      `);

      await setRequestIdentity(db, "service_role");
      const firstDismissal = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'first report overturned; second remains valid',
          '${ADMIN_ID}',
          '89000000-0000-4000-8000-000000000003'
        ) AS result
      `);
      expect(firstDismissal.rows[0]?.result.content_action).toBe(
        "retained_containment",
      );

      const retained = await db.query<{
        visibility: string;
        under_review: boolean;
        first_status: string;
        second_status: string;
        appeal_status: string;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          first_report.status AS first_status,
          second_report.status AS second_status,
          appeal.status AS appeal_status
        FROM public.community_posts AS post
        JOIN public.community_reports AS first_report
          ON first_report.id = '70000000-0000-4000-8000-000000000001'
        JOIN public.community_reports AS second_report
          ON second_report.id = '${secondReportId}'
        JOIN public.community_moderation_appeals AS appeal
          ON appeal.event_id = '${firstResolution.rows[0]?.result.event_id}'
        WHERE post.id = '${POST_ID}'
      `);
      expect(retained.rows).toEqual([{
        visibility: "public",
        under_review: true,
        first_status: "dismissed",
        second_status: "resolved",
        appeal_status: "overturned",
      }]);

      const finalDismissal = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '${secondReportId}',
          'dismissed',
          'last confirmed report overturned',
          '${ADMIN_ID}',
          '89000000-0000-4000-8000-000000000004'
        ) AS result
      `);
      expect(finalDismissal.rows[0]?.result.content_action).toBe("restore");

      const fullyRestored = await db.query<{
        visibility: string;
        under_review: boolean;
        first_status: string;
        second_status: string;
        appeal_status: string;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          first_report.status AS first_status,
          second_report.status AS second_status,
          appeal.status AS appeal_status
        FROM public.community_posts AS post
        JOIN public.community_reports AS first_report
          ON first_report.id = '70000000-0000-4000-8000-000000000001'
        JOIN public.community_reports AS second_report
          ON second_report.id = '${secondReportId}'
        JOIN public.community_moderation_appeals AS appeal
          ON appeal.event_id = '${firstResolution.rows[0]?.result.event_id}'
        WHERE post.id = '${POST_ID}'
      `);
      expect(fullyRestored.rows).toEqual([{
        visibility: "public",
        under_review: false,
        first_status: "dismissed",
        second_status: "dismissed",
        appeal_status: "overturned",
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("orders report and direct holds independently by the locked causal sequence", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);

      await setRequestIdentity(db, "service_role");
      const reportContainment = await db.query<{
        result: { event_id: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'first containment',
          '${ADMIN_ID}',
          '8a000000-0000-4000-8000-000000000001'
        ) AS result
      `);

      await expect(db.query(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'a direct workflow must not replay a report command',
          '${ADMIN_ID}',
          '8a000000-0000-4000-8000-000000000001'
        )
      `)).rejects.toThrow(/COMMUNITY_MODERATION_IDEMPOTENCY_CONFLICT/iu);

      const directContainment = await db.query<{
        result: { event_id: string; idempotent_replay: boolean };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'independent direct containment',
          '${ADMIN_ID}',
          '8a000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(directContainment.rows[0]?.result).not.toHaveProperty(
        "idempotent_replay",
      );
      expect(directContainment.rows[0]?.result.event_id).not.toBe(
        reportContainment.rows[0]?.result.event_id,
      );

      const dismissal = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'report source overturned while direct source remains',
          '${ADMIN_ID}',
          '8a000000-0000-4000-8000-000000000003'
        ) AS result
      `);
      expect(dismissal.rows[0]?.result.content_action).toBe(
        "retained_containment",
      );

      const directRelease = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'restore',
          'release the remaining direct source',
          '${ADMIN_ID}',
          '8a000000-0000-4000-8000-000000000004'
        ) AS result
      `);
      expect(directRelease.rows[0]?.result.content_action).toBe("restore");

      const restored = await db.query<{
        visibility: string;
        under_review: boolean;
        report_status: string;
      }>(`
        SELECT
          post.visibility,
          post.under_review,
          report.status AS report_status
        FROM public.community_posts AS post
        JOIN public.community_reports AS report
          ON report.id = '70000000-0000-4000-8000-000000000001'
        WHERE post.id = '${POST_ID}'
      `);
      expect(restored.rows).toEqual([{
        visibility: "public",
        under_review: false,
        report_status: "dismissed",
      }]);

      const sequenceContract = await db.query<{
        causal_sequence: number;
        operation_key: string;
      }>(`
        SELECT causal_sequence, operation_key::text
        FROM public.community_moderation_events
        WHERE operation_key IN (
          '8a000000-0000-4000-8000-000000000001',
          '8a000000-0000-4000-8000-000000000002',
          '8a000000-0000-4000-8000-000000000003',
          '8a000000-0000-4000-8000-000000000004'
        )
        ORDER BY causal_sequence
      `);
      expect(sequenceContract.rows.map((row) => row.operation_key)).toEqual([
        "8a000000-0000-4000-8000-000000000001",
        "8a000000-0000-4000-8000-000000000002",
        "8a000000-0000-4000-8000-000000000003",
        "8a000000-0000-4000-8000-000000000004",
      ]);
      expect(new Set(
        sequenceContract.rows.map((row) => row.causal_sequence),
      ).size).toBe(sequenceContract.rows.length);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("applies the same containment and restoration boundary to comments", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);

      await setRequestIdentity(db, "authenticated", REPORTER_ID);
      const submitted = await db.query<{
        result: { report_id: string };
      }>(`
        SELECT public.community_submit_report(
          'comment',
          '${COMMENT_ID}',
          'abuse',
          'reported comment'
        ) AS result
      `);
      const commentReportId = submitted.rows[0]?.result.report_id;

      await setRequestIdentity(db, "service_role");
      const resolution = await db.query<{
        result: { event_id: string; content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '${commentReportId}',
          'resolved',
          'confirmed comment abuse',
          '${ADMIN_ID}',
          '8b000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      expect(resolution.rows[0]?.result.content_action).toBe("hide");

      const containedComment = await db.query<{
        is_deleted: boolean;
        status: string;
        action: string;
        appeal_available: boolean;
      }>(`
        SELECT
          comment.is_deleted,
          report.status,
          event.action,
          notice.appeal_available
        FROM public.community_reports AS report
        JOIN public.community_comments AS comment
          ON comment.id = report.comment_id
        JOIN public.community_moderation_events AS event
          ON event.id = '${resolution.rows[0]?.result.event_id}'
        JOIN public.community_moderation_notices AS notice
          ON notice.event_id = event.id
        WHERE report.id = '${commentReportId}'
      `);
      expect(containedComment.rows).toEqual([{
        is_deleted: true,
        status: "resolved",
        action: "hide",
        appeal_available: true,
      }]);

      const dismissal = await db.query<{
        result: { content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '${commentReportId}',
          'dismissed',
          'comment report overturned',
          '${ADMIN_ID}',
          '8b000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(dismissal.rows[0]?.result.content_action).toBe("restore");

      const restoredComment = await db.query<{
        is_deleted: boolean;
        status: string;
      }>(`
        SELECT comment.is_deleted, report.status
        FROM public.community_reports AS report
        JOIN public.community_comments AS comment
          ON comment.id = report.comment_id
        WHERE report.id = '${commentReportId}'
      `);
      expect(restoredComment.rows).toEqual([{
        is_deleted: false,
        status: "dismissed",
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("reviews or directly dismisses a report without publishing an author draft", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await db.exec(`
        UPDATE public.community_posts
        SET visibility = 'draft', under_review = false
        WHERE id = '${POST_ID}'
      `);

      await setRequestIdentity(db, "service_role");
      const reviewed = await db.query<{
        result: { event_id: string; content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'reviewed',
          'evidence review started',
          '${ADMIN_ID}'
        ) AS result
      `);
      expect(reviewed.rows[0]?.result.content_action).toBe("none");

      const reviewedReplay = await db.query<{
        result: { event_id: string; idempotent_replay: boolean };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'reviewed',
          'review request retried',
          '${ADMIN_ID}'
        ) AS result
      `);
      expect(reviewedReplay.rows[0]?.result).toMatchObject({
        event_id: reviewed.rows[0]?.result.event_id,
        idempotent_replay: true,
      });

      const dismissed = await db.query<{
        result: { content_action: string; notice_id: string | null };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'report not substantiated',
          '${ADMIN_ID}'
        ) AS result
      `);
      expect(dismissed.rows[0]?.result).toMatchObject({
        content_action: "none",
        notice_id: null,
      });

      const untouchedDraft = await db.query<{
        visibility: string;
        under_review: boolean;
        status: string;
      }>(`
        SELECT post.visibility, post.under_review, report.status
        FROM public.community_reports AS report
        JOIN public.community_posts AS post ON post.id = report.post_id
        WHERE report.id = '70000000-0000-4000-8000-000000000001'
      `);
      expect(untouchedDraft.rows).toEqual([{
        visibility: "draft",
        under_review: false,
        status: "dismissed",
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps atomic safety moderation available while ordinary writes are stopped", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await db.exec(runtimeControlMigration);
      await db.exec(`
        GRANT SELECT, UPDATE ON TABLE public.community_posts TO service_role;
      `);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      await db.query(
        "SELECT public.community_set_runtime_mode('read_only', 'confirmed abuse incident', $1)",
        [ADMIN_ID],
      );

      await expect(
        db.exec(`
          UPDATE public.community_posts
          SET title = 'ordinary service mutation'
          WHERE id = '${POST_ID}'
        `),
      ).rejects.toThrow(/community is read-only/iu);

      const resolved = await db.query<{
        result: { status: string; content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'confirmed harmful content',
          '${ADMIN_ID}',
          '8c000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      expect(resolved.rows[0]?.result).toMatchObject({
        status: "resolved",
        content_action: "hide",
      });

      const resolvedReplay = await db.query<{
        result: { event_id: string; idempotent_replay: boolean };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'confirmed harmful content',
          '${ADMIN_ID}',
          '8c000000-0000-4000-8000-000000000001'
        ) AS result
      `);
      expect(resolvedReplay.rows[0]?.result).toEqual(resolved.rows[0]?.result);

      const capabilitiesAfterResolve = await db.query<{
        safety: string;
        event_write: string;
        overlay_write: string;
        appeal_write: string;
      }>(`
        SELECT
          current_setting('app.community_safety_bypass', true) AS safety,
          current_setting(
            'hanbang.community_moderation_event_write', true
          ) AS event_write,
          current_setting(
            'hanbang.community_moderation_overlay_write', true
          ) AS overlay_write,
          current_setting(
            'hanbang.community_appeal_decision_write', true
          ) AS appeal_write
      `);
      expect(capabilitiesAfterResolve.rows[0]).toMatchObject({
        safety: expect.not.stringMatching(/^on$/u),
        event_write: expect.not.stringMatching(/^on$/u),
        overlay_write: expect.not.stringMatching(/^on$/u),
        appeal_write: expect.not.stringMatching(/^on$/u),
      });
      await expect(
        db.exec(`
          UPDATE public.community_posts
          SET title = 'mutation after moderation'
          WHERE id = '${POST_ID}'
        `),
      ).rejects.toThrow(/community is read-only/iu);

      await db.query(
        "SELECT public.community_set_runtime_mode('disabled', 'continued incident containment', $1)",
        [ADMIN_ID],
      );
      const dismissed = await db.query<{
        result: { status: string; content_action: string };
      }>(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'reviewed and safe to restore',
          '${ADMIN_ID}',
          '8c000000-0000-4000-8000-000000000002'
        ) AS result
      `);
      expect(dismissed.rows[0]?.result).toMatchObject({
        status: "dismissed",
        content_action: "restore",
      });

      const directHide = await db.query<{
        result: { action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'hide',
          'disabled-mode emergency containment',
          '${ADMIN_ID}',
          '8c000000-0000-4000-8000-000000000003'
        ) AS result
      `);
      expect(directHide.rows[0]?.result.action).toBe("hide");

      const bypassAfterDirectHide = await db.query<{ value: string }>(`
        SELECT current_setting('app.community_safety_bypass', true) AS value
      `);
      expect(bypassAfterDirectHide.rows[0]?.value).not.toBe("on");
      await expect(
        db.exec(`
          UPDATE public.community_posts
          SET title = 'mutation after direct moderation'
          WHERE id = '${POST_ID}'
        `),
      ).rejects.toThrow(/community is disabled/iu);

      const directRestore = await db.query<{
        result: { action: string };
      }>(`
        SELECT public.community_moderate_content(
          'post',
          '${POST_ID}',
          'restore',
          'disabled-mode containment overturned',
          '${ADMIN_ID}',
          '8c000000-0000-4000-8000-000000000004'
        ) AS result
      `);
      expect(directRestore.rows[0]?.result.action).toBe("restore");

      const capabilitiesAfterRestore = await db.query<{
        safety: string;
        event_write: string;
        overlay_write: string;
        appeal_write: string;
      }>(`
        SELECT
          current_setting('app.community_safety_bypass', true) AS safety,
          current_setting(
            'hanbang.community_moderation_event_write', true
          ) AS event_write,
          current_setting(
            'hanbang.community_moderation_overlay_write', true
          ) AS overlay_write,
          current_setting(
            'hanbang.community_appeal_decision_write', true
          ) AS appeal_write
      `);
      expect(capabilitiesAfterRestore.rows[0]).toMatchObject({
        safety: expect.not.stringMatching(/^on$/u),
        event_write: expect.not.stringMatching(/^on$/u),
        overlay_write: expect.not.stringMatching(/^on$/u),
        appeal_write: expect.not.stringMatching(/^on$/u),
      });
      await db.exec("RESET ROLE");

      const state = await db.query<{
        visibility: string;
        under_review: boolean;
        report_status: string;
      }>(`
        SELECT post.visibility, post.under_review, report.status AS report_status
        FROM public.community_posts AS post
        JOIN public.community_reports AS report ON report.post_id = post.id
        WHERE report.id = '70000000-0000-4000-8000-000000000001'
      `);
      expect(state.rows).toEqual([{
        visibility: "public",
        under_review: false,
        report_status: "dismissed",
      }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("denies service execution of moderation RPCs that do not carry an operation key", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");

      await expect(
        db.exec(`
          SELECT public.community_moderate_content(
            'post',
            '${POST_ID}',
            'hide',
            'legacy direct command without operation identity',
            '${ADMIN_ID}'
          )
        `),
      ).rejects.toThrow(/permission denied/iu);

      await expect(
        db.exec(`
          SELECT public.community_review_report_atomic(
            '70000000-0000-4000-8000-000000000001',
            'resolved',
            'legacy report command without operation identity',
            '${ADMIN_ID}'
          )
        `),
      ).rejects.toThrow(/permission denied/iu);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps a dismissed report terminal instead of reopening it with a new key", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(atomicReportResolutionMigration);
      await setRequestIdentity(db, "service_role");

      await db.query(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'dismissed',
          'report was not substantiated',
          '${ADMIN_ID}',
          '8d000000-0000-4000-8000-000000000001'
        )
      `);

      await expect(db.query(`
        SELECT public.community_review_report_atomic(
          '70000000-0000-4000-8000-000000000001',
          'resolved',
          'a new key must not reopen a terminal report',
          '${ADMIN_ID}',
          '8d000000-0000-4000-8000-000000000002'
        )
      `)).rejects.toThrow(/COMMUNITY_REPORT_TRANSITION_CONFLICT/iu);

      const state = await db.query<{
        status: string;
        event_count: number;
        hold_count: number;
      }>(`
        SELECT
          report.status,
          (
            SELECT count(*)::int
            FROM public.community_moderation_events AS event
            WHERE event.metadata ->> 'report_id' = report.id::text
          ) AS event_count,
          (
            SELECT count(*)::int
            FROM public.community_moderation_holds AS hold
            WHERE hold.source_type = 'report'
              AND hold.source_id = report.id
          ) AS hold_count
        FROM public.community_reports AS report
        WHERE report.id = '70000000-0000-4000-8000-000000000001'
      `);
      expect(state.rows).toEqual([{
        status: "dismissed",
        event_count: 1,
        hold_count: 0,
      }]);
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
    expect(atomicReportResolutionMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.community_review_report_atomic(",
    );
    expect(atomicReportResolutionMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.community_review_report\([\s\S]*service_role/,
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
