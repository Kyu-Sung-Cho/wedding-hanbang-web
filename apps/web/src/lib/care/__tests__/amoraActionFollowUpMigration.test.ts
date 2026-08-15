// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812130000_amora_action_follow_up_v2.sql",
  ),
  "utf8",
);
const explicitExecutionMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260814120000_amora_explicit_action_execution.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const ACTION_ID = "act_weekly_guest_list";

type ClaimResponse = {
  version: number;
  state: string;
  recipientUserId: string;
  card?: {
    id: string;
    revision: number;
    sourceRevision: number;
    sourceDigest: string;
    outcomeIdempotencyKey: string;
    kind: string;
    title: string;
    expiresAt: string;
  };
};

type OutcomeResponse = {
  version: number;
  recipientUserId: string;
  receipt: {
    id: string;
    cardId: string;
    cardRevision: number;
    outcome: string;
    actionStatus: string;
    actionRevision: number;
    recordedAt: string;
    idempotencyKey: string;
  };
};

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
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
    CREATE TABLE public.amora_privacy_context_epochs (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      epoch bigint NOT NULL CHECK (epoch >= 1)
    );
    CREATE TABLE public.amora_today_one_preferences (
      user_id uuid PRIMARY KEY REFERENCES public.profiles(id),
      enabled boolean NOT NULL DEFAULT false,
      opted_in_at timestamptz,
      paused_until timestamptz,
      daily_limit smallint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.amora_today_one_recipient_states (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      recipient_user_id uuid NOT NULL,
      claimed_for_date date NOT NULL,
      state text NOT NULL
    );
    CREATE TABLE public.amora_actions (
      id text PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      title text NOT NULL,
      description text,
      due_date text,
      category_key text,
      priority text NOT NULL DEFAULT 'medium',
      status text NOT NULL DEFAULT 'open',
      source text NOT NULL DEFAULT 'chat',
      href text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by uuid REFERENCES auth.users(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      dismissed_at timestamptz
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
    INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch) VALUES
      ('${COUPLE_ID}', 5), ('${OTHER_COUPLE_ID}', 1);
    INSERT INTO public.amora_today_one_preferences(
      user_id, enabled, opted_in_at
    ) VALUES
      ('${BRIDE_ID}', true, clock_timestamp()),
      ('${GROOM_ID}', true, clock_timestamp());
    INSERT INTO public.amora_actions(
      id, couple_id, title, description, priority, status, source, href, created_by,
      created_at, updated_at
    ) VALUES (
      '${ACTION_ID}', '${COUPLE_ID}', '이번 주 하객 명단 초안 만들기',
      '서로 확인할 이름을 먼저 적어 보세요.', 'high', 'open', 'chat',
      '/wedding/lounge', '${BRIDE_ID}',
      clock_timestamp() - interval '25 hours',
      clock_timestamp() - interval '25 hours'
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role()
      TO anon, authenticated, service_role;
  `);
  await db.exec(migration);
  await db.exec(explicitExecutionMigration);
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

async function claim(
  db: PGlite,
  recipientUserId = BRIDE_ID,
  coupleId = COUPLE_ID,
  privacyEpoch = 5,
) {
  const result = await db.query<{ value: ClaimResponse }>(
    `SELECT public.claim_amora_action_follow_up_v2($1::uuid, $2::uuid, $3::bigint) AS value`,
    [coupleId, recipientUserId, privacyEpoch],
  );
  return result.rows[0]!.value;
}

async function claimExplicitAction(
  db: PGlite,
  actionId = ACTION_ID,
  recipientUserId = BRIDE_ID,
  coupleId = COUPLE_ID,
  privacyEpoch = 5,
) {
  const result = await db.query<{ value: ClaimResponse }>(
    `SELECT public.claim_amora_action_execution_v1(
      $1::uuid, $2::uuid, $3::bigint, $4::text
    ) AS value`,
    [coupleId, recipientUserId, privacyEpoch, actionId],
  );
  return result.rows[0]!.value;
}

async function recordOutcome(
  db: PGlite,
  card: NonNullable<ClaimResponse["card"]>,
  options: {
    outcome?: string;
    blockerCode?: string | null;
    confirmed?: boolean;
    idempotencyKey?: string;
    privacyEpoch?: number;
  } = {},
) {
  const result = await db.query<{ value: OutcomeResponse }>(`
    SELECT public.record_amora_action_follow_up_outcome_v2(
      $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::bigint, $6::bigint,
      $7::text, $8::text, $9::boolean, $10::uuid
    ) AS value
  `, [
    COUPLE_ID,
    BRIDE_ID,
    options.privacyEpoch ?? 5,
    card.id,
    card.revision,
    card.sourceRevision,
    options.outcome ?? "completed",
    options.blockerCode ?? null,
    options.confirmed ?? true,
    options.idempotencyKey ?? card.outcomeIdempotencyKey,
  ]);
  return result.rows[0]!.value;
}

async function recordExplicitOutcome(
  db: PGlite,
  card: NonNullable<ClaimResponse["card"]>,
  options: {
    outcome?: string;
    blockerCode?: string | null;
    confirmed?: boolean;
    idempotencyKey?: string;
    privacyEpoch?: number;
  } = {},
) {
  const result = await db.query<{ value: OutcomeResponse }>(`
    SELECT public.record_amora_action_execution_outcome_v1(
      $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::bigint, $6::bigint,
      $7::text, $8::text, $9::boolean, $10::uuid
    ) AS value
  `, [
    COUPLE_ID,
    BRIDE_ID,
    options.privacyEpoch ?? 5,
    card.id,
    card.revision,
    card.sourceRevision,
    options.outcome ?? "completed",
    options.blockerCode ?? null,
    options.confirmed ?? true,
    options.idempotencyKey ?? card.outcomeIdempotencyKey,
  ]);
  return result.rows[0]!.value;
}

describe("Amora action follow-up v2 migration", () => {
  it("lets an owner explicitly finish the fresh action shown on home without proactive-care opt-in", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_actions
        SET updated_at = clock_timestamp(), created_at = clock_timestamp()
        WHERE id = '${ACTION_ID}';
        UPDATE public.amora_today_one_preferences
        SET enabled = false, opted_in_at = NULL
        WHERE user_id = '${BRIDE_ID}'::uuid;
      `);
      await setPersona(db, "service_role");

      const card = (await claimExplicitAction(db)).card!;
      expect(card).toMatchObject({
        kind: "action_follow_up",
        title: "이번 주 하객 명단 초안 만들기",
        sourceRevision: 1,
      });
      const outcome = await recordExplicitOutcome(db, card);
      const replay = await recordExplicitOutcome(db, card);
      expect(outcome).toMatchObject({
        recipientUserId: BRIDE_ID,
        receipt: {
          outcome: "completed",
          actionStatus: "done",
          actionRevision: 2,
        },
      });
      expect(replay).toEqual(outcome);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps blocked explicit work open and does not immediately ask again", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claimExplicitAction(db)).card!;
      const outcome = await recordExplicitOutcome(db, card, {
        outcome: "blocked",
        blockerCode: "missing_info",
        confirmed: false,
      });
      expect(outcome).toMatchObject({
        receipt: {
          outcome: "blocked",
          blockerCode: "missing_info",
          actionStatus: "open",
          actionRevision: 1,
        },
      });
      expect(await claimExplicitAction(db)).toEqual({
        version: 2,
        state: "none",
        recipientUserId: BRIDE_ID,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed across explicit action roster, privacy, couple, and card-mode boundaries", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await expect(claimExplicitAction(db, ACTION_ID, OUTSIDER_ID, COUPLE_ID, 5))
        .rejects.toMatchObject({ code: "42501" });
      await expect(claimExplicitAction(db, ACTION_ID, BRIDE_ID, COUPLE_ID, 4))
        .rejects.toMatchObject({ code: "40001" });
      expect(await claimExplicitAction(
        db,
        ACTION_ID,
        OUTSIDER_ID,
        OTHER_COUPLE_ID,
        1,
      )).toEqual({
        version: 2,
        state: "none",
        recipientUserId: OUTSIDER_ID,
      });

      const scheduledCard = (await claim(db)).card!;
      await expect(recordExplicitOutcome(db, scheduledCard))
        .rejects.toMatchObject({ code: "P0002" });

      await resetPersona(db);
      const stored = await db.query<{
        action_status: string;
        claim_mode: string;
        outcome_count: number;
      }>(`
        SELECT action.status AS action_status,
               card.claim_mode,
               (SELECT count(*)::integer
                FROM public.amora_action_follow_up_outcomes_v2) AS outcome_count
        FROM public.amora_actions AS action
        JOIN public.amora_action_follow_up_cards_v2 AS card
          ON card.action_id = action.id
        WHERE action.id = '${ACTION_ID}'
      `);
      expect(stored.rows[0]).toEqual({
        action_status: "open",
        claim_mode: "scheduled_follow_up",
        outcome_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("claims one immutable owner-scoped card from a canonical open action", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const first = await claim(db);
      const retry = await claim(db);

      expect(first).toMatchObject({
        version: 2,
        state: "ready",
        recipientUserId: BRIDE_ID,
        card: {
          revision: 1,
          sourceRevision: 1,
          kind: "action_follow_up",
          title: "이번 주 하객 명단 초안 만들기",
        },
      });
      expect(first.card?.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(first.card?.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(first.card?.outcomeIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
      expect(retry).toEqual(first);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not ask about a fresh action or an action whose due date is still ahead", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_actions
        SET due_date = (clock_timestamp() + interval '2 days')::date::text
        WHERE id = '${ACTION_ID}'
      `);
      await setPersona(db, "service_role");
      expect(await claim(db)).toEqual({
        version: 2,
        state: "none",
        recipientUserId: BRIDE_ID,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("treats an impossible date as no due date without aborting the claim", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_actions SET due_date = '2026-02-31'
        WHERE id = '${ACTION_ID}'
      `);
      await setPersona(db, "service_role");
      expect(await claim(db)).toMatchObject({ state: "ready" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("completes an open action once, replays the exact receipt, and consumes the source", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;
      const first = await recordOutcome(db, card);
      const retry = await recordOutcome(db, card);

      expect(first).toMatchObject({
        version: 2,
        recipientUserId: BRIDE_ID,
        receipt: {
          cardId: card.id,
          cardRevision: card.revision,
          outcome: "completed",
          actionStatus: "done",
          actionRevision: 2,
          idempotencyKey: card.outcomeIdempotencyKey,
        },
      });
      expect(retry).toEqual(first);
      expect(await claim(db)).toEqual({
        version: 2,
        state: "daily_limit",
        recipientUserId: BRIDE_ID,
      });

      await resetPersona(db);
      const action = await db.query<{ status: string; follow_up_revision: number }>(`
        SELECT status, follow_up_revision
        FROM public.amora_actions
        WHERE id = '${ACTION_ID}'
      `);
      expect(action.rows[0]).toEqual({ status: "done", follow_up_revision: 2 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("records only a bounded private blocker, keeps the action open, and defers resurfacing", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;
      const first = await recordOutcome(db, card, {
        outcome: "blocked",
        blockerCode: "partner_check",
        confirmed: false,
      });
      const retry = await recordOutcome(db, card, {
        outcome: "blocked",
        blockerCode: "partner_check",
        confirmed: false,
      });

      expect(first).toMatchObject({
        receipt: {
          outcome: "blocked",
          blockerCode: "partner_check",
          actionStatus: "open",
          actionRevision: 1,
        },
      });
      expect(retry).toEqual(first);
      expect(await claim(db)).toMatchObject({ state: "daily_limit" });

      await resetPersona(db);
      const rows = await db.query<{
        status: string;
        blocker_code: string;
        eligible_again_at: string | null;
      }>(`
        SELECT action.status, outcome.blocker_code, card.eligible_again_at
        FROM public.amora_actions AS action
        JOIN public.amora_action_follow_up_cards_v2 AS card
          ON card.action_id = action.id
        JOIN public.amora_action_follow_up_outcomes_v2 AS outcome
          ON outcome.card_id = card.id
        WHERE action.id = '${ACTION_ID}'
      `);
      expect(rows.rows[0]?.status).toBe("open");
      expect(rows.rows[0]?.blocker_code).toBe("partner_check");
      expect(Date.parse(rows.rows[0]!.eligible_again_at!)).toBeGreaterThan(Date.now());
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("records a changed plan without dismissing the existing action", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;
      const result = await recordOutcome(db, card, {
        outcome: "changed",
        confirmed: true,
      });
      expect(result).toMatchObject({
        receipt: {
          outcome: "changed",
          actionStatus: "open",
          actionRevision: 1,
        },
      });
      await resetPersona(db);
      const action = await db.query<{ status: string; card_state: string }>(`
        SELECT action.status, card.state AS card_state
        FROM public.amora_actions AS action
        JOIN public.amora_action_follow_up_cards_v2 AS card
          ON card.action_id = action.id
        WHERE action.id = '${ACTION_ID}'
      `);
      expect(action.rows[0]?.status).toBe("open");
      expect(action.rows[0]?.card_state).toBe("deferred");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("records not-sure without changing the action and defers the same card", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;
      const result = await recordOutcome(db, card, {
        outcome: "not_sure",
        confirmed: false,
      });
      expect(result).toMatchObject({
        receipt: {
          outcome: "not_sure",
          actionStatus: "open",
          actionRevision: 1,
        },
      });
      await resetPersona(db);
      const stored = await db.query<{ status: string; state: string }>(`
        SELECT action.status, card.state
        FROM public.amora_actions AS action
        JOIN public.amora_action_follow_up_cards_v2 AS card
          ON card.action_id = action.id
        WHERE action.id = '${ACTION_ID}'
      `);
      expect(stored.rows[0]).toEqual({ status: "open", state: "deferred" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("renews an expired unacted card with a new revision and idempotency key", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const first = (await claim(db)).card!;
      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_action_follow_up_cards_v2
        SET claimed_for_date =
              (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date - 1,
            created_at = clock_timestamp() - interval '2 days',
            expires_at = clock_timestamp() - interval '1 day'
        WHERE id = '${first.id}'::uuid
      `);
      await setPersona(db, "service_role");
      const renewed = (await claim(db)).card!;
      expect(renewed).toMatchObject({
        id: first.id,
        revision: 2,
        sourceRevision: first.sourceRevision,
        sourceDigest: first.sourceDigest,
      });
      expect(renewed.outcomeIdempotencyKey).not.toBe(first.outcomeIdempotencyKey);
      expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.now());
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("never returns or acts on a card from an older privacy epoch", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;
      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 6 WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      await expect(recordOutcome(db, card, { privacyEpoch: 6 }))
        .rejects.toMatchObject({ code: "40001" });
      expect(await claim(db, BRIDE_ID, COUPLE_ID, 6)).toMatchObject({ state: "daily_limit" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not replay an old receipt after the privacy epoch changes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;
      await recordOutcome(db, card);
      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 6 WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      await expect(recordOutcome(db, card, { privacyEpoch: 6 }))
        .rejects.toMatchObject({ code: "40001" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects an outcome after the recipient leaves the card's couple", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;
      await resetPersona(db);
      await db.exec(`
        UPDATE public.couples SET bride_id = NULL
        WHERE id = '${COUPLE_ID}'::uuid;
        UPDATE public.profiles SET couple_id = '${OTHER_COUPLE_ID}'::uuid
        WHERE id = '${BRIDE_ID}'::uuid;
      `);
      await setPersona(db, "service_role");
      await expect(recordOutcome(db, card)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not claim while the owner is unopted or paused", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_today_one_preferences
        SET enabled = false, opted_in_at = NULL
        WHERE user_id = '${BRIDE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      expect(await claim(db)).toMatchObject({ state: "disabled" });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_today_one_preferences
        SET enabled = true,
            opted_in_at = clock_timestamp(),
            paused_until = clock_timestamp() + interval '1 day'
        WHERE user_id = '${BRIDE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      expect(await claim(db)).toMatchObject({ state: "paused" });

      await resetPersona(db);
      const cards = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_action_follow_up_cards_v2
      `);
      expect(cards.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when the owner opts out or pauses after seeing a card", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claim(db)).card!;

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_today_one_preferences
        SET enabled = false, opted_in_at = NULL
        WHERE user_id = '${BRIDE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      await expect(recordOutcome(db, card)).rejects.toMatchObject({ code: "40001" });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_today_one_preferences
        SET enabled = true,
            opted_in_at = clock_timestamp(),
            paused_until = clock_timestamp() + interval '1 day'
        WHERE user_id = '${BRIDE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      await expect(recordOutcome(db, card)).rejects.toMatchObject({ code: "40001" });

      await resetPersona(db);
      const stored = await db.query<{
        action_status: string;
        card_state: string;
        outcome_count: number;
      }>(`
        SELECT action.status AS action_status,
               card.state AS card_state,
               (SELECT count(*)::integer
                FROM public.amora_action_follow_up_outcomes_v2) AS outcome_count
        FROM public.amora_actions AS action
        JOIN public.amora_action_follow_up_cards_v2 AS card
          ON card.action_id = action.id
        WHERE action.id = '${ACTION_ID}'
      `);
      expect(stored.rows[0]).toEqual({
        action_status: "open",
        card_state: "ready",
        outcome_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically enforces one v1-or-v2 card per owner and KST day", async () => {
    const v2First = await createDatabase();
    try {
      await setPersona(v2First, "service_role");
      expect(await claim(v2First)).toMatchObject({ state: "ready" });
      await resetPersona(v2First);
      await expect(v2First.exec(`
        INSERT INTO public.amora_today_one_recipient_states(
          couple_id, recipient_user_id, claimed_for_date, state
        ) VALUES (
          '${COUPLE_ID}'::uuid,
          '${BRIDE_ID}'::uuid,
          (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date,
          'ready'
        )
      `)).rejects.toMatchObject({ code: "P0001" });
    } finally {
      await resetPersona(v2First).catch(() => undefined);
      await v2First.close();
    }

    const v1First = await createDatabase();
    try {
      await v1First.exec(`
        INSERT INTO public.amora_today_one_recipient_states(
          couple_id, recipient_user_id, claimed_for_date, state
        ) VALUES (
          '${COUPLE_ID}'::uuid,
          '${BRIDE_ID}'::uuid,
          (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date,
          'ready'
        )
      `);
      await setPersona(v1First, "service_role");
      expect(await claim(v1First)).toEqual({
        version: 2,
        state: "none",
        recipientUserId: BRIDE_ID,
      });
      const v2Cards = await v1First.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_action_follow_up_cards_v2
      `);
      expect(v2Cards.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(v1First).catch(() => undefined);
      await v1First.close();
    }
  }, 60_000);

  it("serializes both claim paths and rechecks idempotency after the card lock", async () => {
    const db = await createDatabase();
    try {
      const definitions = await db.query<{ proname: string; prosrc: string }>(`
        SELECT proname, prosrc
        FROM pg_proc
        WHERE proname IN (
          'claim_amora_action_follow_up_v2',
          'enforce_amora_today_one_v1_v2_daily_claim',
          'record_amora_action_follow_up_outcome_v2'
        )
      `);
      const byName = new Map(definitions.rows.map((row) => [row.proname, row.prosrc]));
      const claimSource = byName.get("claim_amora_action_follow_up_v2") ?? "";
      const v1FenceSource = byName.get("enforce_amora_today_one_v1_v2_daily_claim") ?? "";
      const outcomeSource = byName.get("record_amora_action_follow_up_outcome_v2") ?? "";

      expect(claimSource).toContain("pg_advisory_xact_lock");
      expect(v1FenceSource).toContain("pg_advisory_xact_lock");
      expect(v1FenceSource).toContain("amora_action_follow_up_cards_v2");
      const cardLock = outcomeSource.indexOf(
        "FROM public.amora_action_follow_up_cards_v2 AS card",
      );
      const replayAfterCardLock = outcomeSource.indexOf(
        "FROM public.amora_action_follow_up_outcomes_v2 AS saved",
        cardLock + 1,
      );
      expect(cardLock).toBeGreaterThan(-1);
      expect(replayAfterCardLock).toBeGreaterThan(cardLock);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("acquires the same executable transaction advisory key on the v1 and v2 claim paths", async () => {
    // PGlite 0.5.x is a single-user/single-connection WASM runtime, so a
    // Promise.all race on one instance would only test its query mutex. Capture
    // pg_locks from each real trigger/function path instead; multi-session wait
    // and loser behavior remains a hosted PostgreSQL release probe.
    async function v2ClaimLock() {
      const db = await createDatabase();
      try {
        await setPersona(db, "service_role");
        let captured: Array<{ classid: string; objid: string; objsubid: string }> = [];
        await db.transaction(async (tx) => {
          await tx.query(
            `SELECT public.claim_amora_action_follow_up_v2($1::uuid, $2::uuid, $3::bigint)`,
            [COUPLE_ID, BRIDE_ID, 5],
          );
          const locks = await tx.query<{
            classid: string;
            objid: string;
            objsubid: string;
          }>(`
            SELECT classid::text, objid::text, objsubid::text
            FROM pg_catalog.pg_locks
            WHERE locktype = 'advisory' AND granted
            ORDER BY classid, objid, objsubid
          `);
          captured = locks.rows;
        });
        return captured;
      } finally {
        await resetPersona(db).catch(() => undefined);
        await db.close();
      }
    }

    async function v1ClaimLock() {
      const db = await createDatabase();
      try {
        let captured: Array<{ classid: string; objid: string; objsubid: string }> = [];
        await db.transaction(async (tx) => {
          await tx.query(`
            INSERT INTO public.amora_today_one_recipient_states(
              couple_id, recipient_user_id, claimed_for_date, state
            ) VALUES (
              $1::uuid,
              $2::uuid,
              (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date,
              'ready'
            )
          `, [COUPLE_ID, BRIDE_ID]);
          const locks = await tx.query<{
            classid: string;
            objid: string;
            objsubid: string;
          }>(`
            SELECT classid::text, objid::text, objsubid::text
            FROM pg_catalog.pg_locks
            WHERE locktype = 'advisory' AND granted
            ORDER BY classid, objid, objsubid
          `);
          captured = locks.rows;
        });
        return captured;
      } finally {
        await db.close();
      }
    }

    const [v1Locks, v2Locks] = await Promise.all([v1ClaimLock(), v2ClaimLock()]);
    expect(v1Locks).toHaveLength(1);
    expect(v2Locks).toEqual(v1Locks);
  }, 60_000);
});
