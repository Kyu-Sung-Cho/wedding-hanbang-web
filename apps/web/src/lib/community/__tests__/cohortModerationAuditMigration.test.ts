// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260731182000_cohort_moderation_audit_boundary.sql",
  ),
  "utf8",
);

const ROOM_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_ID = "20000000-0000-4000-8000-000000000001";
const REPORTER_ID = "30000000-0000-4000-8000-000000000001";
const SECOND_REPORTER_ID = "30000000-0000-4000-8000-000000000002";
const ADMIN_ID = "40000000-0000-4000-8000-000000000001";
const REPORT_ID = "50000000-0000-4000-8000-000000000001";
const SIBLING_REPORT_ID = "50000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      is_admin boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.cohort_rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      year integer NOT NULL,
      month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
      room_number integer NOT NULL DEFAULT 1,
      name text NOT NULL,
      member_count integer DEFAULT 0,
      message_count integer DEFAULT 0,
      is_active boolean DEFAULT true,
      created_at timestamptz DEFAULT now(),
      UNIQUE (year, month, room_number)
    );

    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL
        REFERENCES public.cohort_rooms(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      joined_at timestamptz DEFAULT now(),
      last_seen_at timestamptz DEFAULT now(),
      is_active boolean DEFAULT true,
      UNIQUE (room_id, user_id)
    );

    CREATE TABLE public.cohort_member_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL
        REFERENCES public.cohort_rooms(id) ON DELETE CASCADE,
      reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      reported_user_id uuid NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,
      reason text NOT NULL
        CHECK (reason IN ('spam', 'abuse', 'ad', 'inappropriate', 'other')),
      description text,
      status text DEFAULT 'pending'
        CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
      created_at timestamptz DEFAULT now(),
      CHECK (reporter_id <> reported_user_id),
      UNIQUE (room_id, reporter_id, reported_user_id)
    );

    ALTER TABLE public.cohort_rooms ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cohort_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cohort_member_reports ENABLE ROW LEVEL SECURITY;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO auth.users(id) VALUES
      ('${TARGET_ID}'),
      ('${REPORTER_ID}'),
      ('${SECOND_REPORTER_ID}'),
      ('${ADMIN_ID}');

    INSERT INTO public.profiles(id, is_admin)
    VALUES ('${ADMIN_ID}', true);

    INSERT INTO public.cohort_rooms(
      id, year, month, room_number, name, member_count
    )
    VALUES (
      '${ROOM_ID}', 2027, 5, 1, '2027년 5월 결혼 동기', 99
    );

    INSERT INTO public.cohort_members(room_id, user_id, is_active) VALUES
      ('${ROOM_ID}', '${TARGET_ID}', true),
      ('${ROOM_ID}', '${REPORTER_ID}', true),
      ('${ROOM_ID}', '${SECOND_REPORTER_ID}', true);

    INSERT INTO public.cohort_member_reports(
      id, room_id, reporter_id, reported_user_id, reason, description
    )
    VALUES
      (
        '${REPORT_ID}',
        '${ROOM_ID}',
        '${REPORTER_ID}',
        '${TARGET_ID}',
        'abuse',
        '반복적인 모욕 메시지'
      ),
      (
        '${SIBLING_REPORT_ID}',
        '${ROOM_ID}',
        '${SECOND_REPORTER_ID}',
        '${TARGET_ID}',
        'spam',
        '별도의 신고'
      );
  `);

  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false)",
    [role],
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false)",
  );
}

async function reviewReport(
  db: PGlite,
  {
    reportId = REPORT_ID,
    status = "resolved",
    reason = "  확인된 반복 괴롭힘으로 동기방 이용을 제한합니다.  ",
    adminId = ADMIN_ID,
    deactivateMember = true,
  }: {
    reportId?: string;
    status?: "reviewed" | "resolved" | "dismissed";
    reason?: string;
    adminId?: string;
    deactivateMember?: boolean;
  } = {},
) {
  const result = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.community_review_cohort_member_report(
       $1, $2, $3, $4, $5
     ) AS result`,
    [reportId, status, reason, adminId, deactivateMember],
  );

  return result.rows[0]?.result;
}

describe("cohort moderation audit boundary migration", () => {
  it("atomically changes only the selected report, deactivates its target, repairs the room count, and records snapshots", async () => {
    const db = await createDatabase();
    try {
      const repaired = await db.query<{ member_count: number }>(
        `SELECT member_count::integer
         FROM public.cohort_rooms
         WHERE id = $1`,
        [ROOM_ID],
      );
      expect(repaired.rows).toEqual([{ member_count: 3 }]);

      await setPersona(db, "service_role");
      const receipt = await reviewReport(db);
      expect(receipt).toMatchObject({
        ok: true,
        report_id: REPORT_ID,
        status: "resolved",
        room_id: ROOM_ID,
        reported_user_id: TARGET_ID,
        deactivate_member_requested: true,
        member_deactivated: true,
        before_state: {
          report_status: "pending",
          membership_found: true,
          member_is_active: true,
          room_member_count: 3,
        },
        after_state: {
          report_status: "resolved",
          membership_found: true,
          member_is_active: false,
          room_member_count: 2,
        },
      });

      const state = await db.query<{
        selected_status: string;
        sibling_status: string;
        target_active: boolean;
        member_count: number;
        events: number;
        actor_admin_id: string;
        reason: string;
        member_deactivated: boolean;
        before_state: Record<string, unknown>;
        after_state: Record<string, unknown>;
      }>(
        `SELECT
           selected.status AS selected_status,
           sibling.status AS sibling_status,
           member.is_active AS target_active,
           room.member_count::integer,
           (SELECT count(*)::integer
            FROM public.cohort_moderation_events) AS events,
           event.actor_admin_id::text,
           event.reason,
           event.member_deactivated,
           event.before_state,
           event.after_state
         FROM public.cohort_member_reports AS selected
         JOIN public.cohort_member_reports AS sibling
           ON sibling.id = $2
         JOIN public.cohort_members AS member
           ON member.room_id = selected.room_id
          AND member.user_id = selected.reported_user_id
         JOIN public.cohort_rooms AS room
           ON room.id = selected.room_id
         JOIN public.cohort_moderation_events AS event
           ON event.report_id = selected.id
         WHERE selected.id = $1`,
        [REPORT_ID, SIBLING_REPORT_ID],
      );

      expect(state.rows[0]).toEqual({
        selected_status: "resolved",
        sibling_status: "pending",
        target_active: false,
        member_count: 2,
        events: 1,
        actor_admin_id: ADMIN_ID,
        reason: "확인된 반복 괴롭힘으로 동기방 이용을 제한합니다.",
        member_deactivated: true,
        before_state: {
          report_status: "pending",
          membership_found: true,
          member_is_active: true,
          room_member_count: 3,
        },
        after_state: {
          report_status: "resolved",
          membership_found: true,
          member_is_active: false,
          room_member_count: 2,
        },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back the report, membership, count, and event together when the audit insert cannot commit", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.force_cohort_moderation_event_failure()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'forced_cohort_moderation_event_failure';
        END;
        $$;

        CREATE TRIGGER zz_force_cohort_moderation_event_failure
        BEFORE INSERT ON public.cohort_moderation_events
        FOR EACH ROW
        EXECUTE FUNCTION public.force_cohort_moderation_event_failure();
      `);

      await setPersona(db, "service_role");
      await expect(reviewReport(db)).rejects.toThrow(
        "forced_cohort_moderation_event_failure",
      );

      const state = await db.query<{
        report_status: string;
        target_active: boolean;
        member_count: number;
        events: number;
      }>(
        `SELECT
           report.status AS report_status,
           member.is_active AS target_active,
           room.member_count::integer,
           (SELECT count(*)::integer
            FROM public.cohort_moderation_events) AS events
         FROM public.cohort_member_reports AS report
         JOIN public.cohort_members AS member
           ON member.room_id = report.room_id
          AND member.user_id = report.reported_user_id
         JOIN public.cohort_rooms AS room ON room.id = report.room_id
         WHERE report.id = $1`,
        [REPORT_ID],
      );

      expect(state.rows).toEqual([{
        report_status: "pending",
        target_active: true,
        member_count: 3,
        events: 0,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the RPC service-only and defends the ledger and report status from direct writes", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        authenticated_execute: boolean;
        service_execute: boolean;
        service_select: boolean;
        service_insert: boolean;
        service_update: boolean;
        service_delete: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'authenticated',
            'public.community_review_cohort_member_report(uuid,text,text,uuid,boolean)',
            'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.community_review_cohort_member_report(uuid,text,text,uuid,boolean)',
            'EXECUTE'
          ) AS service_execute,
          has_table_privilege(
            'service_role',
            'public.cohort_moderation_events',
            'SELECT'
          ) AS service_select,
          has_table_privilege(
            'service_role',
            'public.cohort_moderation_events',
            'INSERT'
          ) AS service_insert,
          has_table_privilege(
            'service_role',
            'public.cohort_moderation_events',
            'UPDATE'
          ) AS service_update,
          has_table_privilege(
            'service_role',
            'public.cohort_moderation_events',
            'DELETE'
          ) AS service_delete
      `);
      expect(privileges.rows).toEqual([{
        authenticated_execute: false,
        service_execute: true,
        service_select: true,
        service_insert: false,
        service_update: false,
        service_delete: false,
      }]);

      await setPersona(db, "authenticated");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
      );
      await expect(reviewReport(db)).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(db.exec(`
        INSERT INTO public.cohort_moderation_events (
          report_id,
          room_id,
          reported_user_id,
          actor_admin_id,
          reason,
          deactivate_member_requested,
          member_deactivated,
          before_state,
          after_state
        )
        VALUES (
          '${REPORT_ID}',
          '${ROOM_ID}',
          '${TARGET_ID}',
          '${ADMIN_ID}',
          '위조 감사 기록',
          false,
          false,
          '{}'::jsonb,
          '{}'::jsonb
        )
      `)).rejects.toThrow(/permission denied/i);

      await expect(db.exec(`
        UPDATE public.cohort_member_reports
        SET status = 'resolved'
        WHERE id = '${REPORT_ID}'
      `)).rejects.toThrow(/atomic moderation RPC/);

      const receipt = await reviewReport(db, {
        status: "reviewed",
        reason: "운영자 확인을 완료했습니다.",
        deactivateMember: false,
      });
      const eventId =
        typeof receipt?.event_id === "string" ? receipt.event_id : "";
      expect(eventId).not.toBe("");

      await resetPersona(db);
      await expect(db.exec(`
        UPDATE public.cohort_moderation_events
        SET reason = '변조된 이유'
        WHERE id = '${eventId}'
      `)).rejects.toThrow(/append-only/);
      await expect(db.exec(`
        DELETE FROM public.cohort_moderation_events
        WHERE id = '${eventId}'
      `)).rejects.toThrow(/append-only/);
      await expect(db.exec(`
        INSERT INTO public.cohort_moderation_events (
          report_id,
          room_id,
          reported_user_id,
          actor_admin_id,
          reason,
          deactivate_member_requested,
          member_deactivated,
          before_state,
          after_state
        )
        VALUES (
          '${REPORT_ID}',
          '${ROOM_ID}',
          '${TARGET_ID}',
          '${ADMIN_ID}',
          '직접 삽입 시도',
          false,
          false,
          '{}'::jsonb,
          '{}'::jsonb
        )
      `)).rejects.toThrow(/atomic service RPC/);

      expect(migration).toMatch(
        /FROM public\.cohort_member_reports AS report[\s\S]*WHERE report\.id = p_report_id[\s\S]*FOR UPDATE;/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
