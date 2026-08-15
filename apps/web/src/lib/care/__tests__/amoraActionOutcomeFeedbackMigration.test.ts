// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const followUpMigration = readFileSync(
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
const feedbackMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260815120000_amora_action_outcome_feedback.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const ACTION_ID = "act_guest_list_draft";

interface ClaimedCard {
  id: string;
  revision: number;
  sourceRevision: number;
  outcomeIdempotencyKey: string;
}

interface ClaimResponse {
  state: string;
  card?: ClaimedCard;
}

interface FeedbackResponse {
  version: number;
  state: string;
  recipientUserId: string;
  coupleId: string;
  feedback?: {
    outcomeId: string;
    actionId: string;
    actionTitle: string;
    sourceRevision: number;
    actionRevision: number;
    actionStatus: string;
    outcome: string;
    blockerCode?: string;
    recordedAt: string;
    validUntil: string;
  };
}

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
    INSERT INTO public.amora_today_one_preferences(user_id, enabled, opted_in_at) VALUES
      ('${BRIDE_ID}', true, clock_timestamp()),
      ('${GROOM_ID}', true, clock_timestamp());
    INSERT INTO public.amora_actions(
      id, couple_id, title, description, priority, status, source, created_by
    ) VALUES (
      '${ACTION_ID}', '${COUPLE_ID}', 'Draft the first guest list',
      'Write only the names you already know.', 'high', 'open', 'chat', '${BRIDE_ID}'
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role()
      TO anon, authenticated, service_role;
  `);
  await db.exec(followUpMigration);
  await db.exec(explicitExecutionMigration);
  await db.exec(feedbackMigration);
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

async function claimExplicit(db: PGlite, actionId = ACTION_ID) {
  const result = await db.query<{ value: ClaimResponse }>(`
    SELECT public.claim_amora_action_execution_v1(
      $1::uuid, $2::uuid, $3::bigint, $4::text
    ) AS value
  `, [COUPLE_ID, BRIDE_ID, 5, actionId]);
  return result.rows[0]!.value;
}

async function recordExplicit(
  db: PGlite,
  card: ClaimedCard,
  outcome = "blocked",
  blockerCode: string | null = "partner_check",
  confirmed = false,
) {
  await db.query(`
    SELECT public.record_amora_action_execution_outcome_v1(
      $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::bigint, $6::bigint,
      $7::text, $8::text, $9::boolean, $10::uuid
    )
  `, [
    COUPLE_ID,
    BRIDE_ID,
    5,
    card.id,
    card.revision,
    card.sourceRevision,
    outcome,
    blockerCode,
    confirmed,
    card.outcomeIdempotencyKey,
  ]);
}

async function readFeedback(
  db: PGlite,
  coupleId = COUPLE_ID,
  recipientUserId = BRIDE_ID,
  privacyEpoch = 5,
) {
  const result = await db.query<{ value: FeedbackResponse }>(`
    SELECT public.read_own_amora_action_outcome_feedback_v1(
      $1::uuid, $2::uuid, $3::bigint
    ) AS value
  `, [coupleId, recipientUserId, privacyEpoch]);
  return result.rows[0]!.value;
}

describe("Amora action outcome feedback migration", () => {
  it("returns the fresh canonical blocked result to its exact owner", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claimExplicit(db)).card!;
      await recordExplicit(db, card);

      const result = await readFeedback(db);

      expect(result).toMatchObject({
        version: 1,
        state: "ready",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
        feedback: {
          actionId: ACTION_ID,
          actionTitle: "Draft the first guest list",
          sourceRevision: 1,
          actionRevision: 1,
          actionStatus: "open",
          outcome: "blocked",
          blockerCode: "partner_check",
        },
      });
      expect(result.feedback?.outcomeId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(Date.parse(result.feedback!.validUntil) - Date.parse(result.feedback!.recordedAt))
        .toBe(24 * 60 * 60 * 1_000);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("isolates feedback by service role, recipient, couple roster, and privacy epoch", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claimExplicit(db)).card!;
      await recordExplicit(db, card);

      await expect(readFeedback(db, COUPLE_ID, GROOM_ID, 5)).resolves.toEqual({
        version: 1,
        state: "none",
        recipientUserId: GROOM_ID,
        coupleId: COUPLE_ID,
      });
      await expect(readFeedback(db, COUPLE_ID, OUTSIDER_ID, 5))
        .rejects.toMatchObject({ code: "42501" });
      await expect(readFeedback(db, COUPLE_ID, BRIDE_ID, 4))
        .rejects.toMatchObject({ code: "40001" });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 6
        WHERE couple_id = '${COUPLE_ID}'::uuid;
      `);
      await setPersona(db, "service_role");
      await expect(readFeedback(db, COUPLE_ID, BRIDE_ID, 6)).resolves.toEqual({
        version: 1,
        state: "none",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
      });

      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(readFeedback(db)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("returns none instead of falling back when the latest action revision becomes stale", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const firstCard = (await claimExplicit(db)).card!;
      await recordExplicit(db, firstCard);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_action_follow_up_outcomes_v2
        SET recorded_at = clock_timestamp() - interval '1 hour'
        WHERE action_id = '${ACTION_ID}';
        UPDATE public.amora_action_follow_up_cards_v2
        SET claimed_for_date =
          (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date - 1
        WHERE action_id = '${ACTION_ID}';
        INSERT INTO public.amora_actions(
          id, couple_id, title, description, priority, status, source, created_by
        ) VALUES (
          'act_venue_questions', '${COUPLE_ID}', 'Confirm venue questions',
          'Write the questions that changed.', 'high', 'open', 'chat', '${BRIDE_ID}'
        );
      `);
      await setPersona(db, "service_role");
      const latestCard = (await claimExplicit(db, "act_venue_questions")).card!;
      await recordExplicit(db, latestCard, "changed", null, true);
      expect((await readFeedback(db)).feedback?.actionId).toBe("act_venue_questions");

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_actions
        SET title = 'Confirm the revised venue questions'
        WHERE id = 'act_venue_questions';
      `);
      await setPersona(db, "service_role");

      expect(await readFeedback(db)).toEqual({
        version: 1,
        state: "none",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps a completed transition for D+1 but expires it after the 24-hour lease", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const card = (await claimExplicit(db)).card!;
      await recordExplicit(db, card, "completed", null, true);

      expect(await readFeedback(db)).toMatchObject({
        state: "ready",
        feedback: {
          actionId: ACTION_ID,
          sourceRevision: 1,
          actionRevision: 2,
          actionStatus: "done",
          outcome: "completed",
        },
      });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_action_follow_up_outcomes_v2
        SET recorded_at = clock_timestamp() - interval '23 hours 59 minutes'
        WHERE action_id = '${ACTION_ID}';
      `);
      await setPersona(db, "service_role");
      expect(await readFeedback(db)).toMatchObject({ state: "ready" });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_action_follow_up_outcomes_v2
        SET recorded_at = clock_timestamp() - interval '24 hours 1 minute'
        WHERE action_id = '${ACTION_ID}';
      `);
      await setPersona(db, "service_role");
      expect(await readFeedback(db)).toEqual({
        version: 1,
        state: "none",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("breaks equal-time latest-result ties deterministically by outcome id", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const firstCard = (await claimExplicit(db)).card!;
      await recordExplicit(db, firstCard);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_action_follow_up_cards_v2
        SET claimed_for_date =
          (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date - 1
        WHERE action_id = '${ACTION_ID}';
        INSERT INTO public.amora_actions(
          id, couple_id, title, description, priority, status, source, created_by
        ) VALUES (
          'act_venue_questions', '${COUPLE_ID}', 'Confirm venue questions',
          'Write the questions that changed.', 'high', 'open', 'chat', '${BRIDE_ID}'
        );
      `);
      await setPersona(db, "service_role");
      const secondCard = (await claimExplicit(db, "act_venue_questions")).card!;
      await recordExplicit(db, secondCard, "not_sure", null, false);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_action_follow_up_outcomes_v2
        SET recorded_at = clock_timestamp() - interval '1 hour',
            id = CASE action_id
              WHEN '${ACTION_ID}' THEN '30000000-0000-4000-8000-000000000001'::uuid
              ELSE '30000000-0000-4000-8000-000000000002'::uuid
            END;
      `);
      await setPersona(db, "service_role");

      expect(await readFeedback(db)).toMatchObject({
        state: "ready",
        feedback: {
          outcomeId: "30000000-0000-4000-8000-000000000002",
          actionId: "act_venue_questions",
          outcome: "not_sure",
        },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
