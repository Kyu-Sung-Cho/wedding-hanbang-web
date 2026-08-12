// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812180000_checklist_collaboration_approval.sql",
  ),
  "utf8",
);

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
const FOREIGN_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

const databases: PGlite[] = [];

async function createDatabase(options: { legacyForeignRef?: boolean } = {}) {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;

    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE FUNCTION public.couple_plan_change_has_unsafe_display_text(value text)
    RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT value IS NULL OR value ~ '[[:cntrl:]]'
    $$;
    CREATE FUNCTION public.couple_plan_change_is_high_impact(
      date, date, text, text, bigint, bigint, jsonb, jsonb
    ) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.couple_plan_change_exact_high_summary(
      date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
    ) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '기존 고영향 변경'::text $$;
    CREATE FUNCTION public.couple_plan_change_digest(value jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT md5(value::text) || md5(value::text) $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid,
      onboarding_completed boolean NOT NULL DEFAULT true,
      onboarding_step integer NOT NULL DEFAULT 5,
      shared_chat_cleared_at timestamptz,
      private_chat_cleared_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE,
      wedding_date date,
      venue text,
      total_budget bigint,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      state_revision bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.couple_plan_change_requests (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      base_revision bigint NOT NULL DEFAULT 0,
      changes jsonb NOT NULL DEFAULT '{}'::jsonb,
      change_digest text NOT NULL DEFAULT repeat('a', 64),
      roster_fingerprint text NOT NULL DEFAULT repeat('b', 32),
      is_high_impact boolean NOT NULL DEFAULT true,
      required_count smallint NOT NULL DEFAULT 2,
      status text NOT NULL,
      applied_at timestamptz,
      applied_revision bigint,
      stale_at timestamptz,
      stale_reason text
    );
    CREATE TABLE public.test_notification_finalizations (
      request_id uuid PRIMARY KEY,
      actor_id uuid NOT NULL,
      event_kind text NOT NULL
    );

    CREATE FUNCTION public.finalize_couple_plan_change_notifications_locked(
      request_id uuid,
      actor_id uuid,
      event_kind text
    ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'service_role_required';
      END IF;
      INSERT INTO public.test_notification_finalizations
        VALUES (request_id, actor_id, event_kind);
    END
    $$;

    CREATE FUNCTION public.guard_membership_write()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF COALESCE(current_setting('hanbang.allow_membership_write', true), '') <> 'on' THEN
        RAISE EXCEPTION 'membership_write_blocked';
      END IF;
      IF TG_TABLE_NAME = 'profiles' THEN
        IF NEW.couple_id IS NULL
           AND COALESCE(current_setting('test.fail_profile_reset', true), '') = 'on' THEN
          RAISE EXCEPTION 'forced_profile_reset_failure';
        END IF;
      END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER guard_couple_membership
      BEFORE UPDATE OF bride_id, groom_id ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.guard_membership_write();
    CREATE TRIGGER guard_profile_membership
      BEFORE UPDATE OF couple_id ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.guard_membership_write();

    CREATE FUNCTION public.is_current_couple_member(user_id uuid, target_couple uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.profiles AS profile
        JOIN public.couples AS couple ON couple.id = profile.couple_id
        WHERE profile.id = user_id
          AND profile.couple_id = target_couple
          AND user_id IN (couple.bride_id, couple.groom_id)
      )
    $$;

    -- This ordinary trigger must remain enabled: the privacy scrub uses the
    -- same revision clock as every other journey write.
    CREATE FUNCTION public.advance_test_journey_revision()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.state_revision := OLD.state_revision + 1;
      NEW.updated_at := clock_timestamp();
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER trg_advance_wedding_journey_state_revision
      BEFORE UPDATE ON public.wedding_journeys
      FOR EACH ROW EXECUTE FUNCTION public.advance_test_journey_revision();

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT, UPDATE ON public.couples, public.profiles,
      public.wedding_journeys, public.couple_plan_change_requests
      TO authenticated;

    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${USER_ID}', '${PARTNER_ID}');
    INSERT INTO public.profiles(
      id, couple_id, shared_chat_cleared_at, private_chat_cleared_at
    ) VALUES
      ('${USER_ID}', '${COUPLE_ID}', now(), now()),
      ('${PARTNER_ID}', '${COUPLE_ID}', now(), now());
    INSERT INTO public.wedding_journeys(
      couple_id, progress, state_revision
    ) VALUES (
      '${COUPLE_ID}',
      $progress$${JSON.stringify({
        venue: {
          category: "venue",
          status: "in_progress",
          checklistReviewedAt: "2026-08-12T07:30:00.000Z",
          checklistReviewedByProfileId: options.legacyForeignRef ? FOREIGN_ID : USER_ID,
          checklistReviewSource: "manual",
          checklist: [
            {
              id: "venue_01",
              label: "예식장 계약",
              done: true,
              state: "completed",
              assignee: {
                kind: "member",
                profileId: options.legacyForeignRef ? FOREIGN_ID : USER_ID,
              },
              completedAt: "2026-08-12T08:00:00.000Z",
              completedByProfileId: options.legacyForeignRef ? FOREIGN_ID : USER_ID,
            },
            {
              id: "venue_02",
              label: "잔금일 확인",
              done: true,
              state: "completed",
              assignee: { kind: "member", profileId: PARTNER_ID },
              completedAt: "2026-08-12T08:30:00.000Z",
              completedByProfileId: PARTNER_ID,
            },
          ],
        },
      })}$progress$::jsonb,
      7
    );
    INSERT INTO public.couple_plan_change_requests(id, couple_id, status)
      VALUES ('${REQUEST_ID}', '${COUPLE_ID}', 'pending');
  `);
  await db.exec(migrationSql);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
  userId = USER_ID,
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId],
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false), set_config('test.fail_profile_reset', '', false)",
  );
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (db) => {
    await resetPersona(db).catch(() => undefined);
    await db.close();
  }));
});

describe("checklist-aware couple reset migration", () => {
  it("backfills legacy non-roster UUIDs through the ordinary revision trigger", async () => {
    const db = await createDatabase({ legacyForeignRef: true });
    const journey = await db.query<{
      progress: Record<string, { checklist: Array<Record<string, unknown>> }>;
      state_revision: number;
    }>(
      "SELECT progress, state_revision FROM public.wedding_journeys WHERE couple_id = $1",
      [COUPLE_ID],
    );
    const category = journey.rows[0].progress.venue;
    expect(journey.rows[0].state_revision).toBe(8);
    expect(category).not.toHaveProperty("checklistReviewedByProfileId");
    expect(category.checklist[0]).toMatchObject({
      id: "venue_01",
      done: true,
      state: "completed",
    });
    expect(category.checklist[0]).not.toHaveProperty("assignee");
    expect(category.checklist[0]).not.toHaveProperty("completedAt");
    expect(category.checklist[0]).not.toHaveProperty("completedByProfileId");
    expect(category.checklist[1]).toMatchObject({
      assignee: { kind: "member", profileId: PARTNER_ID },
      completedByProfileId: PARTNER_ID,
    });

    const request = await db.query<{ status: string; stale_reason: string }>(
      "SELECT status, stale_reason FROM public.couple_plan_change_requests WHERE id = $1",
      [REQUEST_ID],
    );
    expect(request.rows[0]).toEqual({
      status: "stale",
      stale_reason: "revision_changed",
    });
    const finalization = await db.query<{
      actor_id: string;
      event_kind: string;
    }>(
      "SELECT actor_id, event_kind FROM public.test_notification_finalizations WHERE request_id = $1",
      [REQUEST_ID],
    );
    expect(finalization.rows[0]).toEqual({
      actor_id: USER_ID,
      event_kind: "change_stale",
    });
  });

  it("scrubs only the departing member, preserves completion state, advances once, and stales approvals", async () => {
    const db = await createDatabase();
    await setPersona(db, "authenticated");

    await db.query("SELECT public.reset_current_couple_membership()");
    await db.query("SELECT public.reset_current_couple_membership()");
    const restoredRole = await db.query<{ role: string }>(
      "SELECT current_setting('request.jwt.claim.role') AS role",
    );
    await resetPersona(db);

    const journey = await db.query<{
      progress: Record<string, { checklist: Array<Record<string, unknown>> }>;
      state_revision: number;
    }>(
      "SELECT progress, state_revision FROM public.wedding_journeys WHERE couple_id = $1",
      [COUPLE_ID],
    );
    const items = journey.rows[0].progress.venue.checklist;
    expect(journey.rows[0].state_revision).toBe(8);
    expect(items[0]).toMatchObject({
      id: "venue_01",
      done: true,
      state: "completed",
    });
    expect(items[0]).not.toHaveProperty("assignee");
    expect(items[0]).not.toHaveProperty("completedAt");
    expect(items[0]).not.toHaveProperty("completedByProfileId");
    expect(items[1]).toMatchObject({
      assignee: { kind: "member", profileId: PARTNER_ID },
      completedByProfileId: PARTNER_ID,
      done: true,
      state: "completed",
    });
    expect(journey.rows[0].progress.venue).not.toHaveProperty(
      "checklistReviewedByProfileId",
    );
    expect(journey.rows[0].progress.venue).toMatchObject({
      checklistReviewedAt: "2026-08-12T07:30:00.000Z",
      checklistReviewSource: "manual",
    });
    expect(restoredRole.rows[0].role).toBe("authenticated");

    const request = await db.query<{
      status: string;
      stale_reason: string;
      finalization_count: number;
    }>(`
      SELECT request.status,
             request.stale_reason,
             count(finalization.request_id)::integer AS finalization_count
      FROM public.couple_plan_change_requests AS request
      LEFT JOIN public.test_notification_finalizations AS finalization
        ON finalization.request_id = request.id
      WHERE request.id = $1
      GROUP BY request.status, request.stale_reason
    `, [REQUEST_ID]);
    expect(request.rows[0]).toEqual({
      status: "stale",
      stale_reason: "roster_changed",
      finalization_count: 1,
    });

    const couple = await db.query<{ bride_id: string | null; groom_id: string | null }>(
      "SELECT bride_id, groom_id FROM public.couples WHERE id = $1",
      [COUPLE_ID],
    );
    const profile = await db.query<{ couple_id: string | null }>(
      "SELECT couple_id FROM public.profiles WHERE id = $1",
      [USER_ID],
    );
    expect(couple.rows[0]).toEqual({ bride_id: null, groom_id: PARTNER_ID });
    expect(profile.rows[0].couple_id).toBeNull();
  });

  it("rolls back the scrub, revision, stale request, and couple slot if profile reset fails", async () => {
    const db = await createDatabase();
    await setPersona(db, "authenticated");
    await db.query("SELECT set_config('test.fail_profile_reset', 'on', false)");

    await expect(
      db.query("SELECT public.reset_current_couple_membership()"),
    ).rejects.toThrow(/forced_profile_reset_failure/);
    await resetPersona(db);

    const journey = await db.query<{
      progress: Record<string, { checklist: Array<Record<string, unknown>> }>;
      state_revision: number;
    }>(
      "SELECT progress, state_revision FROM public.wedding_journeys WHERE couple_id = $1",
      [COUPLE_ID],
    );
    expect(journey.rows[0].state_revision).toBe(7);
    expect(journey.rows[0].progress.venue.checklist[0]).toMatchObject({
      assignee: { kind: "member", profileId: USER_ID },
      completedByProfileId: USER_ID,
      done: true,
      state: "completed",
    });

    const request = await db.query<{ status: string }>(
      "SELECT status FROM public.couple_plan_change_requests WHERE id = $1",
      [REQUEST_ID],
    );
    const finalizations = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.test_notification_finalizations",
    );
    const couple = await db.query<{ bride_id: string; groom_id: string }>(
      "SELECT bride_id, groom_id FROM public.couples WHERE id = $1",
      [COUPLE_ID],
    );
    expect(request.rows[0].status).toBe("pending");
    expect(finalizations.rows[0].count).toBe(0);
    expect(couple.rows[0]).toEqual({ bride_id: USER_ID, groom_id: PARTNER_ID });
  });

  it("does not accept a client-forged reset GUC without the one-use claim", async () => {
    const db = await createDatabase();
    await setPersona(db, "authenticated");
    await db.query(
      "SELECT set_config('hanbang.couple_reset_checklist_scrub_nonce', $1, false)",
      ["40000000-0000-4000-8000-000000000001"],
    );
    await expect(db.query(`
      UPDATE public.wedding_journeys
      SET progress = jsonb_set(
        progress,
        '{venue,checklist,0,assignee}',
        '{"kind":"couple"}'::jsonb,
        false
      )
      WHERE couple_id = '${COUPLE_ID}'
    `)).rejects.toThrow(/COUPLE_RESET_CHECKLIST_SCRUB_CONFLICT/);
    await expect(db.query(`
      INSERT INTO public.couple_reset_checklist_scrub_claims(
        couple_id, reason, actor_user_id, base_revision, expected_progress
      ) VALUES (
        '${COUPLE_ID}', 'membership_reset', '${USER_ID}', 7, '{}'::jsonb
      )
    `)).rejects.toThrow();
  });

  it("does not expose reset or scrub helpers to service-role callers", async () => {
    const db = await createDatabase();
    await setPersona(db, "service_role");
    await expect(
      db.query("SELECT public.reset_current_couple_membership()"),
    ).rejects.toThrow();
    await expect(
      db.query(
        "SELECT public.scrub_departing_checklist_member_refs('{}'::jsonb, $1::uuid)",
        [USER_ID],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "SELECT public.scrub_non_roster_checklist_member_refs('{}'::jsonb, $1::uuid, $2::uuid)",
        [USER_ID, PARTNER_ID],
      ),
    ).rejects.toThrow();
  });
});
