// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802130000_amora_in_app_today_one.sql",
  ),
  "utf8",
);
const budgetGuardrailMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802150000_amora_today_one_budget_guardrails.sql",
  ),
  "utf8",
);
const decisionFollowUpMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812100000_amora_today_one_decision_follow_up.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const DECISION_ID = "50000000-0000-4000-8000-000000000001";
const REQUEST_ID = "60000000-0000-4000-8000-000000000001";

const PRESENTATION = {
  kind: "schedule_moment",
  whyNow: "The venue visit is tomorrow.",
  confirmed: ["Schedule: venue visit", "Date: 2099-01-15 14:30"],
  unknown: ["A vendor-side change is not confirmed here."],
  nextAction: { label: "일정 열기", href: "/schedule" },
  impact: "Opening this card does not change the schedule.",
  choices: [
    { action: "open_source", label: "일정 열기" },
    { action: "snooze", label: "Remind me later" },
    { action: "dismiss", label: "Dismiss today" },
    { action: "mute_source", label: "Mute until this content changes" },
  ],
};

const BUDGET_PRESENTATION = {
  kind: "budget_guardrail",
  whyNow: "Recorded spend is above the configured total budget.",
  confirmed: ["Total budget: 30000000 KRW", "Recorded spend: 31000000 KRW"],
  unknown: [
    "기록 지출은 결제 완료 증빙이 아님",
    "Refund, cancellation, and final payment status are not confirmed here.",
  ],
  nextAction: { label: "예산 열기", href: "/budget" },
  impact: "Opening this card does not change payments or budget values.",
  choices: [
    { action: "open_source", label: "예산 열기" },
    { action: "snooze", label: "Remind me later" },
    { action: "dismiss", label: "Dismiss today" },
    { action: "mute_source", label: "Mute until this content changes" },
  ],
};

const DECISION_FOLLOW_UP_PRESENTATION = {
  kind: "decision_follow_up",
  whyNow: "직접 확인한 결정이 반영된 뒤 하루가 지났어요. 지금도 이대로 진행할지 확인해 보세요.",
  confirmed: ["결정: 총예산을 3천만원으로 확정"],
  unknown: [],
  nextAction: { label: "예산 열기", href: "/budget" },
  impact: "확인만 하며 예산·일정·체크리스트를 자동으로 바꾸지 않아요.",
  choices: [
    { action: "open_source", label: "예산 열기" },
    { action: "snooze", label: "나중에" },
    { action: "dismiss", label: "오늘 닫기" },
    { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
  ],
};

type TodayOneResponse = {
  version: number;
  state: string;
  recipientUserId: string;
  claimedForDate: string;
  card?: {
    id: string;
    revision: number;
    sourceRevision: number;
    sourceKey: string;
    kind: string;
    expiresAt: string;
  };
};

async function createDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      state_revision bigint NOT NULL DEFAULT 0,
      wedding_date date,
      venue text,
      total_budget bigint,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.amora_privacy_context_epochs (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      epoch bigint NOT NULL CHECK (epoch >= 1)
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      decision_type text NOT NULL,
      title text NOT NULL,
      decided_at timestamptz,
      source text NOT NULL,
      source_ref_id uuid,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      source_actor_role text,
      superseded_at timestamptz,
      user_confirmed_at timestamptz
    );
    CREATE TABLE public.couple_plan_change_requests (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      actor_user_id uuid NOT NULL REFERENCES auth.users(id),
      base_revision bigint NOT NULL,
      changes jsonb NOT NULL,
      change_digest text NOT NULL,
      roster_fingerprint text NOT NULL,
      surface_href text NOT NULL,
      summary text NOT NULL,
      is_high_impact boolean NOT NULL,
      required_count smallint NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      actor_accepted_at timestamptz NOT NULL,
      applied_at timestamptz,
      applied_by_user_id uuid REFERENCES auth.users(id),
      applied_revision bigint,
      schedule_mutation_kind text,
      schedule_event_id text,
      schedule_before_event jsonb,
      schedule_after_event jsonb
    );
    CREATE TABLE public.couple_plan_change_acceptances (
      request_id uuid NOT NULL REFERENCES public.couple_plan_change_requests(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      change_digest text NOT NULL,
      roster_fingerprint text NOT NULL,
      accepted_at timestamptz NOT NULL,
      PRIMARY KEY (request_id, user_id)
    );

    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${OTHER_COUPLE_ID}', 'bride');
    INSERT INTO public.wedding_journeys(
      couple_id, state_revision, total_budget
    ) VALUES
      ('${COUPLE_ID}', 7, 30000000),
      ('${OTHER_COUPLE_ID}', 3, NULL);
    INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch) VALUES
      ('${COUPLE_ID}', 5),
      ('${OTHER_COUPLE_ID}', 1);

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role()
      TO anon, authenticated, service_role;
    GRANT SELECT ON public.profiles, public.couples TO authenticated;
  `);
  await db.exec(migrationSql);
  await db.exec(budgetGuardrailMigrationSql);
  await db.exec(decisionFollowUpMigrationSql);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId?: string,
) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`SET ROLE ${role}`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

async function compileCard(
  db: PGlite,
  options: {
    recipientUserId?: string;
    coupleId?: string;
    sourceKey?: string;
    stateDigest?: string;
    sourceRevision?: number;
    priority?: number;
    presentation?: Record<string, unknown>;
  } = {},
): Promise<TodayOneResponse> {
  const result = await db.query<{ result: TodayOneResponse }>(
    `SELECT public.compile_amora_today_one_card(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint,
       $6::integer, $7::jsonb
     ) AS result`,
    [
      options.coupleId ?? COUPLE_ID,
      options.recipientUserId ?? BRIDE_ID,
      options.sourceKey ?? "schedule:venue:d1",
      options.stateDigest ?? "a".repeat(64),
      options.sourceRevision ?? 7,
      options.priority ?? 100,
      JSON.stringify(options.presentation ?? PRESENTATION),
    ],
  );
  return result.rows[0].result;
}

async function compileDecisionFollowUpCard(
  db: PGlite,
  expectedPrivacyEpoch = 5,
  sourceRevision = 7,
): Promise<TodayOneResponse> {
  const result = await db.query<{ result: TodayOneResponse }>(
    `SELECT public.compile_amora_decision_follow_up_card(
       $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text,
       $6::bigint, $7::integer, $8::jsonb
     ) AS result`,
    [
      COUPLE_ID,
      BRIDE_ID,
      DECISION_ID,
      expectedPrivacyEpoch,
      "d".repeat(64),
      sourceRevision,
      80,
      JSON.stringify(DECISION_FOLLOW_UP_PRESENTATION),
    ],
  );
  return result.rows[0].result;
}

async function seedConfirmedDecision(db: PGlite) {
  await db.exec(`
    INSERT INTO public.couple_plan_change_requests(
      id, couple_id, actor_user_id, base_revision, changes, change_digest,
      roster_fingerprint, surface_href, summary, is_high_impact,
      required_count, status, created_at, expires_at, actor_accepted_at,
      applied_at, applied_by_user_id, applied_revision
    ) VALUES (
      '${REQUEST_ID}'::uuid,
      '${COUPLE_ID}'::uuid,
      '${BRIDE_ID}'::uuid,
      6,
      '{"total_budget":30000000}'::jsonb,
      repeat('a', 64),
      md5('${BRIDE_ID}:${GROOM_ID}'),
      '/budget',
      '총예산을 3천만원으로 확정',
      true,
      2,
      'applied',
      '2098-12-29T00:00:00.000Z'::timestamptz,
      '2099-01-05T00:00:00.000Z'::timestamptz,
      '2098-12-30T00:00:00.000Z'::timestamptz,
      '2098-12-30T00:00:00.000Z'::timestamptz,
      '${BRIDE_ID}'::uuid,
      7
    );
    INSERT INTO public.couple_plan_change_acceptances(
      request_id, couple_id, user_id, change_digest,
      roster_fingerprint, accepted_at
    ) VALUES
      (
        '${REQUEST_ID}'::uuid, '${COUPLE_ID}'::uuid, '${BRIDE_ID}'::uuid,
        repeat('a', 64), md5('${BRIDE_ID}:${GROOM_ID}'),
        '2098-12-30T00:00:00.000Z'::timestamptz
      ),
      (
        '${REQUEST_ID}'::uuid, '${COUPLE_ID}'::uuid, '${GROOM_ID}'::uuid,
        repeat('a', 64), md5('${BRIDE_ID}:${GROOM_ID}'),
        '2098-12-30T00:00:00.000Z'::timestamptz
      );
    INSERT INTO public.decision_nodes(
       id, couple_id, decision_type, title, decided_at, source,
       source_ref_id, metadata, visibility, source_actor_role,
       superseded_at, user_confirmed_at
     ) VALUES (
       '${DECISION_ID}'::uuid,
       '${COUPLE_ID}'::uuid,
       'decided',
       '총예산을 3천만원으로 확정',
       '2098-12-30T00:00:00.000Z'::timestamptz,
       'manual',
       '${REQUEST_ID}'::uuid,
       jsonb_build_object(
         'origin', 'couple_plan_change_request',
         'requestId', '${REQUEST_ID}'::uuid,
         'changeDigest', repeat('a', 64),
         'rosterFingerprint', md5('${BRIDE_ID}:${GROOM_ID}'),
         'expectedRevision', 6,
         'appliedRevision', 7,
         'requiredCount', 2,
         'acceptances', (
           SELECT jsonb_agg(
             jsonb_build_object(
               'userId', acceptance.user_id,
               'acceptedAt', acceptance.accepted_at
             ) ORDER BY acceptance.user_id
           )
           FROM public.couple_plan_change_acceptances AS acceptance
           WHERE acceptance.request_id = '${REQUEST_ID}'::uuid
         ),
         'surfaceHref', '/budget'
       ),
       'shared',
       'bride',
       NULL,
       '2098-12-30T00:00:00.000Z'::timestamptz
     );
  `);
}

async function setPreference(
  db: PGlite,
  userId: string,
  enabled: boolean,
  pausedUntil: string | null = null,
) {
  await setPersona(db, "authenticated", userId);
  const result = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.set_amora_today_one_preference(
       $1::boolean, $2::timestamptz
     ) AS result`,
    [enabled, pausedUntil],
  );
  return result.rows[0].result;
}

async function actOnCard(
  db: PGlite,
  options: {
    cardId: string;
    expectedRevision?: number;
    expectedSourceRevision?: number;
    action: "open_source" | "snooze" | "dismiss" | "mute_source";
  },
): Promise<TodayOneResponse> {
  const result = await db.query<{ result: TodayOneResponse }>(
    `SELECT public.act_on_amora_today_one_card(
       $1::uuid, $2::bigint, $3::bigint, $4::text
     ) AS result`,
    [
      options.cardId,
      options.expectedRevision ?? 1,
      options.expectedSourceRevision ?? 7,
      options.action,
    ],
  );
  return result.rows[0].result;
}

describe("in-app TodayOne storage migration", () => {
  it("atomically fences a confirmed-decision follow-up by the current privacy epoch", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.amora_today_one_clock()
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = pg_catalog
        AS $$ SELECT '2099-01-02T03:00:00.000Z'::timestamptz $$
      `);
      await seedConfirmedDecision(db);
      await db.exec(`
        UPDATE public.wedding_journeys
        SET state_revision = 8
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPreference(db, BRIDE_ID, true);
      await setPersona(db, "service_role");

      const ready = await compileDecisionFollowUpCard(db, 5, 8);
      expect(ready).toMatchObject({
        state: "ready",
        card: {
          sourceKey: `decision:${DECISION_ID}`,
          kind: "decision_follow_up",
          sourceRevision: 8,
        },
      });

      await resetPersona(db);
      await db.exec(`
        DELETE FROM public.amora_today_one_recipient_states;
        DELETE FROM public.amora_today_one_signals;
        UPDATE public.wedding_journeys
        SET state_revision = 9,
            total_budget = 31000000
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      const reversed = await compileDecisionFollowUpCard(db, 5, 9);
      expect(reversed).toMatchObject({ state: "none" });

      await resetPersona(db);
      const reversedSignals = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_today_one_signals
        WHERE source_key = 'decision:${DECISION_ID}'
      `);
      expect(reversedSignals.rows[0].count).toBe(0);
      await db.exec(`
        UPDATE public.wedding_journeys
        SET state_revision = 10,
            total_budget = 30000000
        WHERE couple_id = '${COUPLE_ID}'::uuid;
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 6
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      await expect(compileDecisionFollowUpCard(db, 5, 10)).rejects.toMatchObject({
        code: "40001",
      });

      await resetPersona(db);
      const signals = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_today_one_signals
        WHERE source_key = 'decision:${DECISION_ID}'
      `);
      expect(signals.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is rerun-safe and keeps schedule, budget, and decision follow-up kinds exact", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(decisionFollowUpMigrationSql);

      const validation = await db.query<{
        schedule_valid: boolean;
        budget_valid: boolean;
        decision_follow_up_valid: boolean;
        mismatched_href_valid: boolean;
        extra_field_valid: boolean;
        kind_constraint: string;
      }>(`
        SELECT
          public.amora_today_one_presentation_is_valid(
            '${JSON.stringify(PRESENTATION).replaceAll("'", "''")}'::jsonb
          ) AS schedule_valid,
          public.amora_today_one_presentation_is_valid(
            '${JSON.stringify(BUDGET_PRESENTATION).replaceAll("'", "''")}'::jsonb
          ) AS budget_valid,
          public.amora_today_one_presentation_is_valid(
            '${JSON.stringify(DECISION_FOLLOW_UP_PRESENTATION).replaceAll("'", "''")}'::jsonb
          ) AS decision_follow_up_valid,
          public.amora_today_one_presentation_is_valid(
            '${JSON.stringify({
              ...BUDGET_PRESENTATION,
              nextAction: { label: "일정 열기", href: "/schedule" },
            }).replaceAll("'", "''")}'::jsonb
          ) AS mismatched_href_valid,
          public.amora_today_one_presentation_is_valid(
            '${JSON.stringify({
              ...BUDGET_PRESENTATION,
              unreviewed: true,
            }).replaceAll("'", "''")}'::jsonb
          ) AS extra_field_valid,
          pg_get_constraintdef(constraint_row.oid) AS kind_constraint
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.amora_today_one_signals'::regclass
          AND constraint_row.conname = 'amora_today_one_signals_kind_check'
      `);
      expect(validation.rows[0]).toMatchObject({
        schedule_valid: true,
        budget_valid: true,
        decision_follow_up_valid: true,
        mismatched_href_valid: false,
        extra_field_valid: false,
      });
      expect(validation.rows[0].kind_constraint).toContain("schedule_moment");
      expect(validation.rows[0].kind_constraint).toContain("budget_guardrail");
      expect(validation.rows[0].kind_constraint).toContain("decision_follow_up");

      await setPreference(db, BRIDE_ID, true);
      await setPersona(db, "service_role");
      const result = await compileCard(db, {
        sourceKey: "budget:recorded-total-over-total",
        stateDigest: "e".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      });
      expect(result).toMatchObject({
        state: "ready",
        card: {
          kind: "budget_guardrail",
          sourceKey: "budget:recorded-total-over-total",
        },
      });

      const secondCandidate = await compileCard(db, {
        sourceKey: "schedule:venue:d1",
        stateDigest: "f".repeat(64),
        priority: 110,
        presentation: PRESENTATION,
      });
      expect(secondCandidate).toMatchObject({ state: "daily_limit" });

      await resetPersona(db);
      await expect(db.exec(`
        UPDATE public.amora_today_one_signals
        SET kind = 'schedule_moment'
        WHERE source_key = 'budget:recorded-total-over-total'
      `)).rejects.toMatchObject({ code: "23514" });
      await expect(db.exec(`
        UPDATE public.amora_today_one_signals
        SET kind = 'unknown_kind'
        WHERE source_key = 'budget:recorded-total-over-total'
      `)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("locks the source signal before the recipient card in both mutation paths", () => {
    const actionStart = migrationSql.indexOf(
      "CREATE FUNCTION public.act_on_amora_today_one_card(",
    );
    const actionEnd = migrationSql.indexOf(
      "ALTER FUNCTION public.amora_today_one_text_is_safe",
      actionStart,
    );
    const actionSql = migrationSql.slice(actionStart, actionEnd);
    const signalLock = actionSql.indexOf("SELECT * INTO v_signal");
    const recipientCardLock = actionSql.indexOf("SELECT * INTO v_recipient_state");

    expect(actionStart).toBeGreaterThanOrEqual(0);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(signalLock).toBeGreaterThanOrEqual(0);
    expect(recipientCardLock).toBeGreaterThanOrEqual(0);
    expect(signalLock).toBeLessThan(recipientCardLock);
  });

  it("is default-off and converges an explicitly opted-in exact retry to one card", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const disabled = await compileCard(db);
      expect(disabled).toMatchObject({
        version: 1,
        state: "disabled",
        recipientUserId: BRIDE_ID,
      });
      expect(disabled.card).toBeUndefined();

      const preference = await setPreference(db, BRIDE_ID, true);
      expect(preference).toMatchObject({ enabled: true });

      await setPersona(db, "service_role");
      const first = await compileCard(db);
      const retry = await compileCard(db);
      expect(first).toMatchObject({
        version: 1,
        state: "ready",
        recipientUserId: BRIDE_ID,
        card: {
          revision: 1,
          sourceRevision: 7,
          sourceKey: "schedule:venue:d1",
        },
      });
      expect(first.card?.id).toMatch(UUID_PATTERN);
      expect(first.card?.expiresAt).toEqual(expect.any(String));
      expect(retry).toEqual(first);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects stale or conflicting evidence and enforces one card per recipient day", async () => {
    const db = await createDatabase();
    try {
      await setPreference(db, BRIDE_ID, true);
      await setPersona(db, "service_role");

      const stale = await compileCard(db, { sourceRevision: 6 });
      expect(stale).toMatchObject({ state: "source_stale" });

      const first = await compileCard(db);
      const conflicting = await compileCard(db, {
        stateDigest: "b".repeat(64),
      });
      expect(conflicting).toMatchObject({ state: "source_stale" });
      expect(await compileCard(db)).toEqual(first);

      const secondSource = await compileCard(db, {
        sourceKey: "schedule:dress:d1",
        stateDigest: "c".repeat(64),
      });
      expect(secondSource).toMatchObject({ state: "daily_limit" });
      expect(secondSource.card).toBeUndefined();

      await resetPersona(db);
      const counts = await db.query<{ signals: number; cards: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_today_one_signals) AS signals,
          (SELECT count(*)::integer
             FROM public.amora_today_one_recipient_states) AS cards
      `);
      expect(counts.rows[0]).toEqual({ signals: 1, cards: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps card actions owner-scoped and persists snooze and source mute without I/O", async () => {
    const db = await createDatabase();
    try {
      await setPreference(db, BRIDE_ID, true);
      await setPreference(db, GROOM_ID, true);
      await setPersona(db, "service_role");
      const brideCard = await compileCard(db);
      const groomCard = await compileCard(db, { recipientUserId: GROOM_ID });
      expect(brideCard.card?.id).toMatch(UUID_PATTERN);
      expect(groomCard.card?.id).toMatch(UUID_PATTERN);

      await setPersona(db, "authenticated", GROOM_ID);
      await expect(
        actOnCard(db, {
          cardId: brideCard.card!.id,
          action: "dismiss",
        }),
      ).rejects.toMatchObject({ code: "42501" });

      await setPersona(db, "authenticated", BRIDE_ID);
      const snoozed = await actOnCard(db, {
        cardId: brideCard.card!.id,
        action: "snooze",
      });
      expect(snoozed).toMatchObject({ state: "paused" });

      await setPersona(db, "service_role");
      expect(await compileCard(db)).toMatchObject({ state: "paused" });

      await setPersona(db, "authenticated", BRIDE_ID);
      const staleRetry = await actOnCard(db, {
        cardId: brideCard.card!.id,
        action: "snooze",
      });
      expect(staleRetry).toMatchObject({ state: "source_stale" });

      await setPersona(db, "authenticated", GROOM_ID);
      const muted = await actOnCard(db, {
        cardId: groomCard.card!.id,
        action: "mute_source",
      });
      expect(muted).toMatchObject({ state: "none" });

      await setPersona(db, "service_role");
      expect(
        await compileCard(db, { recipientUserId: GROOM_ID }),
      ).toMatchObject({ state: "none" });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.wedding_journeys
        SET state_revision = 8
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      expect(
        await compileCard(db, {
          recipientUserId: GROOM_ID,
          sourceRevision: 8,
          stateDigest: "d".repeat(64),
        }),
      ).toMatchObject({ state: "none" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("scopes a source mute to one state-digest episode and resurfaces a changed recurrence", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.amora_today_one_clock()
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = pg_catalog
        AS $$ SELECT '2099-01-01T03:00:00.000Z'::timestamptz $$
      `);
      await setPreference(db, BRIDE_ID, true);
      await setPersona(db, "service_role");
      const original = await compileCard(db, {
        sourceKey: "budget:recorded-total-over-total",
        stateDigest: "a".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      });

      await setPersona(db, "authenticated", BRIDE_ID);
      await actOnCard(db, {
        cardId: original.card!.id,
        action: "mute_source",
      });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.wedding_journeys
        SET state_revision = 8
        WHERE couple_id = '${COUPLE_ID}'::uuid;
        CREATE OR REPLACE FUNCTION public.amora_today_one_clock()
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = pg_catalog
        AS $$ SELECT '2099-01-02T03:00:00.000Z'::timestamptz $$;
      `);
      await setPersona(db, "service_role");
      expect(await compileCard(db, {
        sourceKey: "budget:recorded-total-over-total",
        sourceRevision: 8,
        stateDigest: "a".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      })).toMatchObject({ state: "none" });

      // Revision 9 represents a resolved interval: the source is absent, so
      // the compiler is intentionally not called for this source.
      await resetPersona(db);
      await db.exec(`
        UPDATE public.wedding_journeys
        SET state_revision = 9
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await db.exec(`
        UPDATE public.wedding_journeys
        SET state_revision = 10
        WHERE couple_id = '${COUPLE_ID}'::uuid;
        CREATE OR REPLACE FUNCTION public.amora_today_one_clock()
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = pg_catalog
        AS $$ SELECT '2099-01-03T03:00:00.000Z'::timestamptz $$;
      `);
      await setPersona(db, "service_role");
      const recurrence = await compileCard(db, {
        sourceKey: "budget:recorded-total-over-total",
        sourceRevision: 10,
        stateDigest: "b".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      });
      expect(recurrence).toMatchObject({
        state: "ready",
        card: { sourceRevision: 10 },
      });

      await resetPersona(db);
      const signal = await db.query<{
        muted_at: string | null;
        muted_by: string | null;
        state_digest: string;
      }>(`
        SELECT muted_at, muted_by, state_digest
        FROM public.amora_today_one_signals
        WHERE recipient_user_id = '${BRIDE_ID}'::uuid
          AND source_key = 'budget:recorded-total-over-total'
      `);
      expect(signal.rows[0]).toEqual({
        muted_at: null,
        muted_by: null,
        state_digest: "b".repeat(64),
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects unsafe or ambiguous card presentations before storing a signal", async () => {
    const db = await createDatabase();
    try {
      await setPreference(db, BRIDE_ID, true);
      await setPersona(db, "service_role");

      const unsafePresentations = [
        {
          ...PRESENTATION,
          nextAction: { label: "Leave", href: "https://evil.example" },
        },
        {
          ...PRESENTATION,
          nextAction: { label: "Leave", href: "//evil.example/path" },
        },
        {
          ...PRESENTATION,
          nextAction: { label: "Leave", href: "/schedule\\escape" },
        },
        {
          ...PRESENTATION,
          choices: [
            { action: "dismiss", label: "Dismiss once" },
            { action: "dismiss", label: "Dismiss twice" },
          ],
        },
        {
          ...PRESENTATION,
          whyNow: "Unsafe\u0000copy",
        },
        {
          ...PRESENTATION,
          whyNow: "Unsafe\u202Ecopy",
        },
        {
          ...PRESENTATION,
          unreviewed: "extra field",
        },
      ];

      for (const presentation of unsafePresentations) {
        await expect(
          compileCard(db, {
            presentation: presentation as typeof PRESENTATION,
          }),
        ).rejects.toMatchObject({
          code: expect.stringMatching(/^(22023|22P05)$/),
        });
      }

      await resetPersona(db);
      const counts = await db.query<{ signals: number; cards: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_today_one_signals) AS signals,
          (SELECT count(*)::integer
             FROM public.amora_today_one_recipient_states) AS cards
      `);
      expect(counts.rows[0]).toEqual({ signals: 0, cards: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("honors the owner's pause and disable choices before creating any card", async () => {
    const db = await createDatabase();
    try {
      const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const pausedPreference = await setPreference(
        db,
        BRIDE_ID,
        true,
        pausedUntil,
      );
      expect(pausedPreference).toMatchObject({
        enabled: true,
        pausedUntil: expect.any(String),
        dailyLimit: 1,
      });

      await setPersona(db, "service_role");
      expect(await compileCard(db)).toMatchObject({ state: "paused" });

      const disabledPreference = await setPreference(db, BRIDE_ID, false);
      expect(disabledPreference).toMatchObject({
        enabled: false,
        optedInAt: null,
        pausedUntil: null,
      });
      await setPersona(db, "service_role");
      expect(await compileCard(db)).toMatchObject({ state: "disabled" });

      await resetPersona(db);
      const counts = await db.query<{ signals: number; cards: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_today_one_signals) AS signals,
          (SELECT count(*)::integer
             FROM public.amora_today_one_recipient_states) AS cards
      `);
      expect(counts.rows[0]).toEqual({ signals: 0, cards: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("starts an independent source episode after the owner joins a different couple", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.amora_today_one_clock()
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = pg_catalog
        AS $$ SELECT '2099-01-01T03:00:00.000Z'::timestamptz $$
      `);
      await setPreference(db, GROOM_ID, true);
      await setPersona(db, "service_role");
      const oldCoupleCard = await compileCard(db, {
        recipientUserId: GROOM_ID,
        sourceKey: "budget:recorded-total-over-total",
        stateDigest: "a".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      });
      expect(oldCoupleCard).toMatchObject({ state: "ready" });

      await setPersona(db, "authenticated", GROOM_ID);
      await actOnCard(db, {
        cardId: oldCoupleCard.card!.id,
        action: "mute_source",
      });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.couples
        SET groom_id = NULL
        WHERE id = '${COUPLE_ID}'::uuid;
        UPDATE public.couples
        SET groom_id = '${GROOM_ID}'::uuid
        WHERE id = '${OTHER_COUPLE_ID}'::uuid;
        UPDATE public.profiles
        SET couple_id = '${OTHER_COUPLE_ID}'::uuid,
            role = 'groom'
        WHERE id = '${GROOM_ID}'::uuid;
        CREATE OR REPLACE FUNCTION public.amora_today_one_clock()
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = pg_catalog
        AS $$ SELECT '2099-01-02T03:00:00.000Z'::timestamptz $$;
      `);

      await setPersona(db, "service_role");
      const newCoupleCard = await compileCard(db, {
        coupleId: OTHER_COUPLE_ID,
        recipientUserId: GROOM_ID,
        sourceKey: "budget:recorded-total-over-total",
        sourceRevision: 3,
        stateDigest: "b".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      });
      expect(newCoupleCard).toMatchObject({
        state: "ready",
        card: {
          sourceKey: "budget:recorded-total-over-total",
          sourceRevision: 3,
        },
      });

      await resetPersona(db);
      const signals = await db.query<{ couple_id: string; muted: boolean }>(`
        SELECT couple_id::text,
               muted_at IS NOT NULL AS muted
        FROM public.amora_today_one_signals
        WHERE recipient_user_id = '${GROOM_ID}'::uuid
          AND source_key = 'budget:recorded-total-over-total'
        ORDER BY couple_id
      `);
      expect(signals.rows).toEqual([
        { couple_id: COUPLE_ID, muted: true },
        { couple_id: OTHER_COUPLE_ID, muted: false },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("allows an independent daily card after a same-day couple relink", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.amora_today_one_clock()
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = pg_catalog
        AS $$ SELECT '2099-01-01T03:00:00.000Z'::timestamptz $$
      `);
      await setPreference(db, GROOM_ID, true);
      await setPersona(db, "service_role");
      const oldCoupleCard = await compileCard(db, {
        recipientUserId: GROOM_ID,
        sourceKey: "budget:recorded-total-over-total",
        stateDigest: "a".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      });
      expect(oldCoupleCard).toMatchObject({ state: "ready" });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.couples
        SET groom_id = NULL
        WHERE id = '${COUPLE_ID}'::uuid;
        UPDATE public.couples
        SET groom_id = '${GROOM_ID}'::uuid
        WHERE id = '${OTHER_COUPLE_ID}'::uuid;
        UPDATE public.profiles
        SET couple_id = '${OTHER_COUPLE_ID}'::uuid,
            role = 'groom'
        WHERE id = '${GROOM_ID}'::uuid;
      `);

      await setPersona(db, "service_role");
      const newCoupleCard = await compileCard(db, {
        coupleId: OTHER_COUPLE_ID,
        recipientUserId: GROOM_ID,
        sourceKey: "budget:recorded-total-over-total",
        sourceRevision: 3,
        stateDigest: "b".repeat(64),
        priority: 300,
        presentation: BUDGET_PRESENTATION,
      });
      expect(newCoupleCard).toMatchObject({
        state: "ready",
        card: { sourceRevision: 3 },
      });

      await resetPersona(db);
      const cards = await db.query<{ couple_id: string; claimed_for_date: string }>(`
        SELECT couple_id::text, claimed_for_date::text
        FROM public.amora_today_one_recipient_states
        WHERE recipient_user_id = '${GROOM_ID}'::uuid
        ORDER BY couple_id
      `);
      expect(cards.rows).toEqual([
        { couple_id: COUPLE_ID, claimed_for_date: "2099-01-01" },
        { couple_id: OTHER_COUPLE_ID, claimed_for_date: "2099-01-01" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not apply an owner action after the underlying journey revision changes", async () => {
    const db = await createDatabase();
    try {
      await setPreference(db, BRIDE_ID, true);
      await setPersona(db, "service_role");
      const card = await compileCard(db);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.wedding_journeys
        SET state_revision = 8
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);

      await setPersona(db, "authenticated", BRIDE_ID);
      const result = await actOnCard(db, {
        cardId: card.card!.id,
        action: "dismiss",
      });
      expect(result).toMatchObject({ state: "source_stale" });

      await resetPersona(db);
      const stored = await db.query<{
        state: string;
        revision: number;
        last_action: string | null;
      }>(`
        SELECT state, revision::integer, last_action
        FROM public.amora_today_one_recipient_states
        WHERE id = '${card.card!.id}'::uuid
      `);
      expect(stored.rows[0]).toEqual({
        state: "ready",
        revision: 1,
        last_action: null,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("isolates rows by current recipient and exposes only the intended RPCs", async () => {
    const db = await createDatabase();
    try {
      await setPreference(db, BRIDE_ID, true);
      await setPreference(db, GROOM_ID, true);
      await setPersona(db, "service_role");
      const brideCard = await compileCard(db);
      await compileCard(db, { recipientUserId: GROOM_ID });

      await setPersona(db, "authenticated", BRIDE_ID);
      const brideRows = await db.query<{
        recipient_user_id: string;
        card_recipient_user_id: string;
      }>(`
        SELECT signal.recipient_user_id::text,
               recipient_state.recipient_user_id::text AS card_recipient_user_id
        FROM public.amora_today_one_signals AS signal
        JOIN public.amora_today_one_recipient_states AS recipient_state
          ON recipient_state.signal_id = signal.id
      `);
      expect(brideRows.rows).toEqual([{
        recipient_user_id: BRIDE_ID,
        card_recipient_user_id: BRIDE_ID,
      }]);
      await expect(
        db.exec(`
          UPDATE public.amora_today_one_preferences
          SET enabled = false
          WHERE user_id = '${BRIDE_ID}'::uuid
        `),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(compileCard(db)).rejects.toMatchObject({ code: "42501" });

      await setPersona(db, "authenticated", GROOM_ID);
      const groomSignals = await db.query<{ recipient_user_id: string }>(`
        SELECT recipient_user_id::text
        FROM public.amora_today_one_signals
      `);
      expect(groomSignals.rows).toEqual([{ recipient_user_id: GROOM_ID }]);

      await setPersona(db, "authenticated", OUTSIDER_ID);
      const outsiderSignals = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_today_one_signals
      `);
      expect(outsiderSignals.rows[0].count).toBe(0);

      await setPersona(db, "service_role");
      await expect(
        db.query("SELECT * FROM public.amora_today_one_signals"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query(
          `SELECT public.act_on_amora_today_one_card(
             $1::uuid, 1, 7, 'dismiss'
           )`,
          [brideCard.card!.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await resetPersona(db);
      const acl = await db.query<{
        authenticated_compile: boolean;
        service_compile: boolean;
        authenticated_preference: boolean;
        authenticated_action: boolean;
        service_action: boolean;
        authenticated_table_update: boolean;
        service_table_select: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'authenticated',
            'public.compile_amora_today_one_card(uuid,uuid,text,text,bigint,integer,jsonb)',
            'EXECUTE'
          ) AS authenticated_compile,
          has_function_privilege(
            'service_role',
            'public.compile_amora_today_one_card(uuid,uuid,text,text,bigint,integer,jsonb)',
            'EXECUTE'
          ) AS service_compile,
          has_function_privilege(
            'authenticated',
            'public.set_amora_today_one_preference(boolean,timestamptz)',
            'EXECUTE'
          ) AS authenticated_preference,
          has_function_privilege(
            'authenticated',
            'public.act_on_amora_today_one_card(uuid,bigint,bigint,text)',
            'EXECUTE'
          ) AS authenticated_action,
          has_function_privilege(
            'service_role',
            'public.act_on_amora_today_one_card(uuid,bigint,bigint,text)',
            'EXECUTE'
          ) AS service_action,
          has_table_privilege(
            'authenticated', 'public.amora_today_one_preferences', 'UPDATE'
          ) AS authenticated_table_update,
          has_table_privilege(
            'service_role', 'public.amora_today_one_signals', 'SELECT'
          ) AS service_table_select
      `);
      expect(acl.rows[0]).toEqual({
        authenticated_compile: false,
        service_compile: true,
        authenticated_preference: true,
        authenticated_action: true,
        service_action: false,
        authenticated_table_update: false,
        service_table_select: false,
      });

      const hardening = await db.query<{
        all_forced_rls: boolean;
        all_fixed_search_path: boolean;
        has_external_io_reference: boolean;
      }>(`
        SELECT
          bool_and(relation.relrowsecurity AND relation.relforcerowsecurity)
            FILTER (WHERE relation.relname IN (
              'amora_today_one_preferences',
              'amora_today_one_signals',
              'amora_today_one_recipient_states'
            )) AS all_forced_rls,
          (
            SELECT bool_and(
              array_to_string(procedure.proconfig, ',') LIKE '%search_path=%'
            )
            FROM pg_proc AS procedure
            JOIN pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = 'public'
              AND procedure.proname LIKE '%amora_today_one%'
          ) AS all_fixed_search_path,
          (
            SELECT bool_or(
              procedure.prosrc ~* '(chat_messages|amora_care_jobs|amora_care_deliveries|http|net\\.)'
            )
            FROM pg_proc AS procedure
            JOIN pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = 'public'
              AND procedure.proname LIKE '%amora_today_one%'
          ) AS has_external_io_reference
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
      `);
      expect(hardening.rows[0]).toEqual({
        all_forced_rls: true,
        all_fixed_search_path: true,
        has_external_io_reference: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when a nullable roster slot and profile role disagree", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.profiles
        SET role = 'groom'
        WHERE id = '${OUTSIDER_ID}'::uuid
      `);
      await setPreference(db, OUTSIDER_ID, true);
      await setPersona(db, "service_role");
      await expect(
        compileCard(db, {
          coupleId: OTHER_COUPLE_ID,
          recipientUserId: OUTSIDER_ID,
          sourceRevision: 3,
        }),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
