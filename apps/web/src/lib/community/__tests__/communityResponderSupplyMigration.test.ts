// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804130000_community_runtime_control.sql",
  ),
  "utf8",
);
const responderMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804140000_community_responder_supply_foundation.sql",
  ),
  "utf8",
);
const viewerControlsMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260804180000_community_viewer_controls.sql",
  ),
  "utf8",
);

const ADMIN_ID = "10000000-0000-4000-8000-000000000001";
const RESPONDER_ONE = "10000000-0000-4000-8000-000000000002";
const RESPONDER_TWO = "10000000-0000-4000-8000-000000000003";
const RESPONDER_THREE = "10000000-0000-4000-8000-000000000004";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000005";

type Persona = "anon" | "authenticated" | "service_role";

type SlotResult = {
  slot_id: string;
  eligibility_status: string;
};

type RequestResult = {
  request_id: string;
  question_id: string;
  status: string;
  question_state: string;
};

function futureDate(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      is_admin boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      nickname text NOT NULL,
      is_suspended boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.community_agent_personas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      public_nickname text NOT NULL,
      internal_label text NOT NULL,
      role text NOT NULL,
      public_mode text NOT NULL DEFAULT 'persona',
      status text NOT NULL DEFAULT 'draft',
      backing_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL
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

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

    INSERT INTO auth.users (id) VALUES
      ('${ADMIN_ID}'),
      ('${RESPONDER_ONE}'),
      ('${RESPONDER_TWO}'),
      ('${RESPONDER_THREE}'),
      ('${OUTSIDER_ID}');
    INSERT INTO public.profiles (id, is_admin) VALUES
      ('${ADMIN_ID}', true),
      ('${RESPONDER_ONE}', false),
      ('${RESPONDER_TWO}', false),
      ('${RESPONDER_THREE}', false),
      ('${OUTSIDER_ID}', false);
    INSERT INTO public.community_profiles (user_id, nickname) VALUES
      ('${ADMIN_ID}', 'admin'),
      ('${RESPONDER_ONE}', 'responder-one'),
      ('${RESPONDER_TWO}', 'responder-two'),
      ('${RESPONDER_THREE}', 'responder-three'),
      ('${OUTSIDER_ID}', 'outsider');
  `);
  await db.exec(runtimeMigration);
  await db.exec(responderMigration);
  return db;
}

async function installViewerControlDependencies(db: PGlite) {
  await resetPersona(db);
  await db.exec(`
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;

    ALTER TABLE public.community_profiles
      ADD COLUMN avatar_url text,
      ADD COLUMN badge text,
      ADD COLUMN rank text NOT NULL DEFAULT 'sprout';

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL,
      parent_id uuid,
      author_id uuid NOT NULL
    );
    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      reply_to uuid
    );
    CREATE TABLE public.community_reply_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_id uuid NOT NULL,
      actor_id uuid NOT NULL
    );
    CREATE TABLE public.community_bookmarks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      post_id uuid NOT NULL
    );
    CREATE TABLE public.community_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      post_id uuid,
      comment_id uuid
    );
    CREATE TABLE public.community_polls (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL
    );
    CREATE TABLE public.community_poll_votes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      poll_id uuid NOT NULL
    );

    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cohort_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_reply_notifications ENABLE ROW LEVEL SECURITY;
  `);
  await db.exec(viewerControlsMigration);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

async function setPersona(
  db: PGlite,
  role: Persona,
  userId: string | null = null,
) {
  await resetPersona(db);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
  await db.exec(`SET ROLE ${role}`);
}

type RegisterOptions = {
  origin?: "member" | "industry_professional";
  scope?:
    | "contract_terms"
    | "extra_charge"
    | "vendor_response"
    | "cancellation_refund";
  period?:
    | "within_3_months"
    | "within_6_months"
    | "within_12_months"
    | "over_12_months";
  commercialRelationship?: string;
  hasConflict?: boolean;
  availableFrom?: string;
  availableUntil?: string;
  weeklyLimit?: number;
  cooldownHours?: number;
  maxOpenRequests?: number;
  idempotencyKey: string;
};

async function registerSlot(
  db: PGlite,
  responderId: string,
  options: RegisterOptions,
) {
  await setPersona(db, "service_role");
  const availableFrom = options.availableFrom ?? futureDate(-1);
  const availableUntil = options.availableUntil ?? futureDate(24 * 14);
  const result = await db.query<{ result: SlotResult }>(
    `SELECT public.community_register_responder_capacity_slot(
      $1::uuid, $2, 'contract_extra_cost', $3, $4, $5, $6,
      $7::timestamptz, $8::timestamptz,
      $9::smallint, $10::smallint, $11::smallint, $12::uuid
    ) AS result`,
    [
      responderId,
      options.origin ?? "member",
      options.scope ?? "extra_charge",
      options.period ?? "within_6_months",
      options.commercialRelationship ?? "none",
      options.hasConflict ?? false,
      availableFrom,
      availableUntil,
      options.weeklyLimit ?? 3,
      options.cooldownHours ?? 1,
      options.maxOpenRequests ?? 2,
      options.idempotencyKey,
    ],
  );
  return {
    ...result.rows[0]!.result,
    availableFrom,
    availableUntil,
  };
}

async function reviewSlot(
  db: PGlite,
  slotId: string,
  idempotencyKey: string,
  decision: "verify" | "reject" = "verify",
  reasonCode =
    decision === "verify"
      ? "founding_cohort_human_check_passed"
      : "direct_experience_not_confirmed",
) {
  await setPersona(db, "service_role");
  const result = await db.query<{ result: SlotResult }>(
    `SELECT public.community_review_responder_capacity_slot(
      $1::uuid, $2::uuid, $3, $4, $5::uuid
    ) AS result`,
    [slotId, ADMIN_ID, decision, reasonCode, idempotencyKey],
  );
  return result.rows[0]!.result;
}

type CreateRequestOptions = {
  questionId: string;
  slotId: string;
  role: "primary" | "backup";
  idempotencyKey: string;
  scope?: string;
  expiresAt?: string;
};

async function createRequest(db: PGlite, options: CreateRequestOptions) {
  await setPersona(db, "service_role");
  const expiresAt = options.expiresAt ?? futureDate(24);
  const result = await db.query<{ result: RequestResult }>(
    `SELECT public.community_create_responder_request(
      $1::uuid, $2::uuid, $3, 'contract_extra_cost', $4,
      $5::timestamptz, $6::uuid, $7::uuid
    ) AS result`,
    [
      options.questionId,
      options.slotId,
      options.role,
      options.scope ?? "extra_charge",
      expiresAt,
      ADMIN_ID,
      options.idempotencyKey,
    ],
  );
  return { ...result.rows[0]!.result, expiresAt };
}

async function respond(
  db: PGlite,
  responderId: string,
  requestId: string,
  decision: "accept" | "decline",
  idempotencyKey: string,
  options: {
    commercialRelationship?: string;
    hasConflict?: boolean;
    declineReason?: string | null;
  } = {},
) {
  await setPersona(db, "service_role");
  const result = await db.query<{ result: RequestResult }>(
    `SELECT public.community_respond_responder_request(
      $1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid
    ) AS result`,
    [
      responderId,
      requestId,
      decision,
      options.commercialRelationship ?? "none",
      options.hasConflict ?? false,
      options.declineReason ??
        (decision === "decline" ? "not_available" : null),
      idempotencyKey,
    ],
  );
  return result.rows[0]!.result;
}

async function replayResponderCommand(
  db: PGlite,
  actorId: string,
  operation: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
) {
  await setPersona(db, "service_role");
  const result = await db.query<{ result: Record<string, unknown> | null }>(
    `SELECT public.community_replay_responder_command_service(
      $1::uuid, $2, $3::uuid, $4::jsonb
    ) AS result`,
    [actorId, operation, idempotencyKey, JSON.stringify(payload)],
  );
  return result.rows[0]!.result;
}

async function setRuntimeMode(
  db: PGlite,
  mode: "normal" | "read_only" | "disabled",
) {
  await setPersona(db, "service_role");
  await db.query(
    "SELECT public.community_set_runtime_mode($1, $2, $3::uuid)",
    [mode, `${mode} responder supply test`, ADMIN_ID],
  );
}

function lockingTables(functionName: string) {
  const start = responderMigration.indexOf(
    `CREATE OR REPLACE FUNCTION public.${functionName}`,
  );
  const end = responderMigration.indexOf("\n$$;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return Array.from(
    responderMigration
      .slice(start, end)
      .matchAll(/SELECT[\s\S]*?FOR UPDATE;/giu),
    (match) => {
      if (match[0].includes("public.responder_capacity_slots")) {
        return "slot";
      }
      if (match[0].includes("public.community_responder_requests")) {
        return "request";
      }
      return "other";
    },
  );
}

describe("community responder supply foundation migration", () => {
  it("keeps sensitive context out, forbids fake origins, and exposes only owner/service boundaries", async () => {
    const db = await createDatabase();
    try {
      const columns = await db.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'responder_capacity_slots',
            'community_responder_questions',
            'community_responder_requests'
          )
      `);
      const columnNames = columns.rows.map((row) => row.column_name);
      expect(columnNames).not.toEqual(
        expect.arrayContaining([
          "wedding_date",
          "region",
          "question_body",
          "private_budget",
          "venue_name",
        ]),
      );
      expect(responderMigration).toMatch(/no question body/iu);
      expect(responderMigration).not.toMatch(/community_reports/iu);
      expect(responderMigration).not.toMatch(/community_moderation_appeals/iu);
      expect(responderMigration).not.toMatch(
        /(?:ALTER\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.community_posts/iu,
      );

      const slotOne = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "20000000-0000-4000-8000-000000000001",
      });
      await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "20000000-0000-4000-8000-000000000002",
      });

      await setPersona(db, "authenticated", RESPONDER_ONE);
      const ownSlots = await db.query<{ responder_id: string }>(
        "SELECT responder_id FROM public.responder_capacity_slots",
      );
      expect(ownSlots.rows).toEqual([{ responder_id: RESPONDER_ONE }]);
      await expect(
        db.query("SELECT reviewed_by FROM public.responder_capacity_slots"),
      ).rejects.toThrow(/permission denied/iu);
      await expect(
        db.exec(`
          INSERT INTO public.responder_capacity_slots (
            responder_id, responder_origin, topic, experience_scope,
            experience_period, commercial_relationship, has_conflict,
            available_from, available_until, weekly_request_limit,
            cooldown_hours, max_open_requests, consent_idempotency_key
          ) VALUES (
            '${RESPONDER_ONE}', 'ai', 'contract_extra_cost', 'extra_charge',
            'within_6_months', 'none', false, now(), now() + interval '1 day',
            1, 1, 1, '20000000-0000-4000-8000-000000000099'
          )
        `),
      ).rejects.toThrow(/permission denied/iu);

      await expect(
        db.query(
          "SELECT public.community_review_responder_capacity_slot($1::uuid, $2::uuid, 'verify', 'founding_cohort_human_check_passed', $3::uuid)",
          [
            slotOne.slot_id,
            ADMIN_ID,
            "20000000-0000-4000-8000-000000000098",
          ],
        ),
      ).rejects.toThrow(/permission denied/iu);

      await setPersona(db, "anon");
      await expect(
        db.query(
          `SELECT public.community_register_responder_capacity_slot(
            '${RESPONDER_ONE}'::uuid,
            'member', 'contract_extra_cost', 'extra_charge',
            'within_6_months', 'none', false, now(), now() + interval '1 day',
            1::smallint, 1::smallint, 1::smallint,
            '20000000-0000-4000-8000-000000000097'::uuid
          )`,
        ),
      ).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await expect(
        db.exec(`
          INSERT INTO public.responder_capacity_slots (
            responder_id, responder_origin, topic, experience_scope,
            experience_period, commercial_relationship, has_conflict,
            available_from, available_until, weekly_request_limit,
            cooldown_hours, max_open_requests, consent_idempotency_key
          ) VALUES (
            '${RESPONDER_THREE}', 'ai', 'contract_extra_cost', 'extra_charge',
            'within_6_months', 'none', false, now(), now() + interval '1 day',
            1, 1, 1, '20000000-0000-4000-8000-000000000096'
          )
        `),
      ).rejects.toThrow(/responder_capacity_slots_human_origin/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("makes opt-in and manual human-experience review durable and idempotent", async () => {
    const db = await createDatabase();
    try {
      const idempotencyKey = "21000000-0000-4000-8000-000000000001";
      const slot = await registerSlot(db, RESPONDER_ONE, { idempotencyKey });
      const replay = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey,
        availableFrom: slot.availableFrom,
        availableUntil: slot.availableUntil,
      });
      expect(replay).toEqual(slot);
      expect(replay).not.toHaveProperty("replayed");

      await expect(
        registerSlot(db, RESPONDER_ONE, {
          idempotencyKey,
          scope: "contract_terms",
          availableFrom: slot.availableFrom,
          availableUntil: slot.availableUntil,
        }),
      ).rejects.toThrow(/idempotency key reused with different payload/iu);

      const reviewed = await reviewSlot(
        db,
        slot.slot_id,
        "21000000-0000-4000-8000-000000000002",
      );
      expect(reviewed).toMatchObject({
        eligibility_status: "verified_human_experience",
      });
      expect(reviewed).not.toHaveProperty("replayed");
      const reviewReplay = await reviewSlot(
        db,
        slot.slot_id,
        "21000000-0000-4000-8000-000000000002",
      );
      expect(reviewReplay).toEqual(reviewed);

      const conflictSlot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "21000000-0000-4000-8000-000000000003",
        commercialRelationship: "employee",
        hasConflict: true,
      });
      await expect(
        reviewSlot(
          db,
          conflictSlot.slot_id,
          "21000000-0000-4000-8000-000000000004",
        ),
      ).rejects.toThrow(/conflict-free active human experience is required/iu);

      await setPersona(db, "service_role");
      const events = await db.query<{ event_type: string; count: number }>(`
        SELECT event_type, count(*)::integer AS count
        FROM public.community_responder_supply_events
        WHERE capacity_slot_id = '${slot.slot_id}'
        GROUP BY event_type
        ORDER BY event_type
      `);
      expect(events.rows).toEqual([
        { event_type: "slot_registered", count: 1 },
        { event_type: "slot_reviewed", count: 1 },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("pins service preflight to actor and canonical payload and fails closed on receipt damage", async () => {
    const db = await createDatabase();
    try {
      const key = "21500000-0000-4000-8000-000000000001";
      const slot = await registerSlot(db, RESPONDER_ONE, { idempotencyKey: key });
      const payload = {
        responder_origin: "member",
        topic: "contract_extra_cost",
        experience_scope: "extra_charge",
        experience_period: "within_6_months",
        commercial_relationship: "none",
        has_conflict: false,
        available_from: slot.availableFrom,
        available_until: slot.availableUntil,
        weekly_request_limit: 3,
        cooldown_hours: 1,
        max_open_requests: 2,
      };

      expect(await replayResponderCommand(
        db, RESPONDER_ONE, "register_capacity", key, payload,
      )).toEqual(expect.objectContaining({ slot_id: slot.slot_id }));

      await setPersona(db, "authenticated", RESPONDER_ONE);
      await expect(db.query(
        `SELECT public.community_replay_responder_command_service(
          $1::uuid, 'register_capacity', $2::uuid, $3::jsonb
        )`,
        [RESPONDER_ONE, key, JSON.stringify(payload)],
      )).rejects.toThrow(/permission denied/iu);

      await expect(replayResponderCommand(
        db,
        RESPONDER_ONE,
        "register_capacity",
        key,
        { ...payload, experience_scope: "contract_terms" },
      )).rejects.toThrow(/idempotency key reused with different payload/iu);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_responder_command_receipts
        SET response_payload = jsonb_set(
          response_payload,
          '{slot_id}',
          '"99999999-9999-4999-8999-999999999999"'::jsonb
        )
        WHERE actor_id = '${RESPONDER_ONE}'
          AND operation = 'register_capacity'
          AND idempotency_key = '${key}'
      `);
      await expect(replayResponderCommand(
        db, RESPONDER_ONE, "register_capacity", key, payload,
      )).rejects.toThrow(/receipt digest mismatch/iu);
      await expect(registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: key,
        availableFrom: slot.availableFrom,
        availableUntil: slot.availableUntil,
      })).rejects.toThrow(/receipt digest mismatch/iu);

      await resetPersona(db);
      await db.exec(`
        DELETE FROM public.community_responder_command_receipts
        WHERE actor_id = '${RESPONDER_ONE}'
          AND operation = 'register_capacity'
          AND idempotency_key = '${key}'
      `);
      await expect(registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: key,
        availableFrom: slot.availableFrom,
        availableUntil: slot.availableUntil,
      })).rejects.toThrow(/receipt is unavailable/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps a question private until distinct primary and backup responders explicitly accept", async () => {
    const db = await createDatabase();
    try {
      const primarySlot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "22000000-0000-4000-8000-000000000001",
        commercialRelationship: "platform_research_compensation",
      });
      const backupSlot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "22000000-0000-4000-8000-000000000002",
      });
      await reviewSlot(
        db,
        primarySlot.slot_id,
        "22000000-0000-4000-8000-000000000003",
      );
      await reviewSlot(
        db,
        backupSlot.slot_id,
        "22000000-0000-4000-8000-000000000004",
      );

      const questionId = "22000000-0000-4000-8000-000000000010";
      const primaryRequest = await createRequest(db, {
        questionId,
        slotId: primarySlot.slot_id,
        role: "primary",
        idempotencyKey: "22000000-0000-4000-8000-000000000011",
      });
      expect(primaryRequest.question_state).toBe("private_waitlist");

      await expect(
        respond(
          db,
          RESPONDER_ONE,
          primaryRequest.request_id,
          "accept",
          "22000000-0000-4000-8000-000000000020",
          { commercialRelationship: "none" },
        ),
      ).rejects.toThrow(/commercial relationship changed/iu);

      const primaryAccepted = await respond(
        db,
        RESPONDER_ONE,
        primaryRequest.request_id,
        "accept",
        "22000000-0000-4000-8000-000000000012",
        { commercialRelationship: "platform_research_compensation" },
      );
      expect(primaryAccepted.question_state).toBe("private_waitlist");

      const samePersonBackupSlot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "22000000-0000-4000-8000-000000000017",
      });
      await reviewSlot(
        db,
        samePersonBackupSlot.slot_id,
        "22000000-0000-4000-8000-000000000018",
      );
      await expect(
        createRequest(db, {
          questionId,
          slotId: samePersonBackupSlot.slot_id,
          role: "backup",
          idempotencyKey: "22000000-0000-4000-8000-000000000019",
        }),
      ).rejects.toThrow(/one responder cannot fill two slots/iu);

      const backupRequest = await createRequest(db, {
        questionId,
        slotId: backupSlot.slot_id,
        role: "backup",
        idempotencyKey: "22000000-0000-4000-8000-000000000013",
      });
      expect(backupRequest.question_state).toBe("private_waitlist");

      await setPersona(db, "service_role");
      await expect(
        db.query(
          `SELECT public.community_respond_responder_request(
            '${OUTSIDER_ID}'::uuid, $1::uuid, 'accept', 'none', false, NULL,
            '22000000-0000-4000-8000-000000000014'::uuid
          )`,
          [backupRequest.request_id],
        ),
      ).rejects.toThrow(/only the requested responder can decide/iu);

      const backupAccepted = await respond(
        db,
        RESPONDER_TWO,
        backupRequest.request_id,
        "accept",
        "22000000-0000-4000-8000-000000000015",
      );
      expect(backupAccepted.question_state).toBe("ready_for_review");
      const backupReplay = await respond(
        db,
        RESPONDER_TWO,
        backupRequest.request_id,
        "accept",
        "22000000-0000-4000-8000-000000000015",
      );
      expect(backupReplay).toEqual(backupAccepted);
      expect(backupReplay).not.toHaveProperty("replayed");

      await setPersona(db, "service_role");
      const supply = await db.query<{
        question_state: string;
        issued_request_count: number;
        historical_accept_count: number;
        confirmed_slot_count: number;
        peer_member_confirmed_slot_count: number;
        industry_professional_confirmed_slot_count: number;
        primary_confirmed_count: number;
        backup_confirmed_count: number;
        peer_member_primary_confirmed_count: number;
        peer_member_backup_confirmed_count: number;
      }>(
        `SELECT question_state, issued_request_count,
                historical_accept_count, confirmed_slot_count,
                peer_member_confirmed_slot_count,
                industry_professional_confirmed_slot_count,
                primary_confirmed_count, backup_confirmed_count,
                peer_member_primary_confirmed_count,
                peer_member_backup_confirmed_count
         FROM public.community_responder_question_supply
         WHERE question_id = $1`,
        [questionId],
      );
      expect(supply.rows[0]).toEqual({
        question_state: "ready_for_review",
        issued_request_count: 2,
        historical_accept_count: 2,
        confirmed_slot_count: 2,
        peer_member_confirmed_slot_count: 2,
        industry_professional_confirmed_slot_count: 0,
        primary_confirmed_count: 1,
        backup_confirmed_count: 1,
        peer_member_primary_confirmed_count: 1,
        peer_member_backup_confirmed_count: 1,
      });

      await setPersona(db, "service_role");
      const revoked = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.community_revoke_responder_capacity_slot(
          '${RESPONDER_TWO}'::uuid, $1::uuid, 'topic_opt_out',
          '22000000-0000-4000-8000-000000000016'::uuid
        ) AS result`,
        [backupSlot.slot_id],
      );
      expect(revoked.rows[0]?.result).toMatchObject({
        opt_in_status: "revoked",
      });
      expect(revoked.rows[0]?.result).not.toHaveProperty("replayed");

      await setPersona(db, "service_role");
      const afterOptOut = await db.query<{ question_state: string }>(
        `SELECT question_state
         FROM public.community_responder_question_supply
         WHERE question_id = $1`,
        [questionId],
      );
      expect(afterOptOut.rows[0]?.question_state).toBe("private_waitlist");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps industry-professional supply in a separate lane that cannot open the peer gate", async () => {
    const db = await createDatabase();
    try {
      const primarySlot = await registerSlot(db, RESPONDER_ONE, {
        origin: "industry_professional",
        idempotencyKey: "22500000-0000-4000-8000-000000000001",
        commercialRelationship: "employee",
      });
      const backupSlot = await registerSlot(db, RESPONDER_TWO, {
        origin: "industry_professional",
        idempotencyKey: "22500000-0000-4000-8000-000000000002",
        commercialRelationship: "owner_or_family",
      });
      await reviewSlot(
        db,
        primarySlot.slot_id,
        "22500000-0000-4000-8000-000000000003",
        "verify",
        "industry_identity_and_experience_verified",
      );
      await reviewSlot(
        db,
        backupSlot.slot_id,
        "22500000-0000-4000-8000-000000000004",
        "verify",
        "industry_identity_and_experience_verified",
      );

      const questionId = "22500000-0000-4000-8000-000000000010";
      const primaryRequest = await createRequest(db, {
        questionId,
        slotId: primarySlot.slot_id,
        role: "primary",
        idempotencyKey: "22500000-0000-4000-8000-000000000011",
      });
      const backupRequest = await createRequest(db, {
        questionId,
        slotId: backupSlot.slot_id,
        role: "backup",
        idempotencyKey: "22500000-0000-4000-8000-000000000012",
      });
      await respond(
        db,
        RESPONDER_ONE,
        primaryRequest.request_id,
        "accept",
        "22500000-0000-4000-8000-000000000013",
        { commercialRelationship: "employee" },
      );
      await respond(
        db,
        RESPONDER_TWO,
        backupRequest.request_id,
        "accept",
        "22500000-0000-4000-8000-000000000014",
        { commercialRelationship: "owner_or_family" },
      );

      await setPersona(db, "service_role");
      const supply = await db.query<{
        question_state: string;
        confirmed_slot_count: number;
        peer_member_confirmed_slot_count: number;
        industry_professional_confirmed_slot_count: number;
      }>(
        `SELECT question_state, confirmed_slot_count,
                peer_member_confirmed_slot_count,
                industry_professional_confirmed_slot_count
         FROM public.community_responder_question_supply
         WHERE question_id = $1`,
        [questionId],
      );
      expect(supply.rows[0]).toEqual({
        question_state: "private_waitlist",
        confirmed_slot_count: 2,
        peer_member_confirmed_slot_count: 0,
        industry_professional_confirmed_slot_count: 2,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("revokes a capacity slot when the responder declines with a conflict", async () => {
    const db = await createDatabase();
    try {
      const slot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "22600000-0000-4000-8000-000000000001",
        commercialRelationship: "discount",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "22600000-0000-4000-8000-000000000002",
      );
      const request = await createRequest(db, {
        questionId: "22600000-0000-4000-8000-000000000010",
        slotId: slot.slot_id,
        role: "primary",
        idempotencyKey: "22600000-0000-4000-8000-000000000011",
      });

      await expect(
        respond(
          db,
          RESPONDER_ONE,
          request.request_id,
          "decline",
          "22600000-0000-4000-8000-000000000012",
          { commercialRelationship: "discount", declineReason: "conflict" },
        ),
      ).rejects.toThrow(/invalid responder decision/iu);

      const declined = await respond(
        db,
        RESPONDER_ONE,
        request.request_id,
        "decline",
        "22600000-0000-4000-8000-000000000013",
        {
          commercialRelationship: "discount",
          hasConflict: true,
          declineReason: "conflict",
        },
      );
      expect(declined).toMatchObject({ status: "declined" });
      expect(declined).not.toHaveProperty("replayed");

      await setPersona(db, "service_role");
      const state = await db.query<{
        opt_in_status: string;
        has_conflict: boolean;
        request_status: string;
        event_count: number;
      }>(
        `SELECT slot.opt_in_status, slot.has_conflict,
                request.status AS request_status,
                (
                  SELECT count(*)::integer
                  FROM public.community_responder_supply_events AS event
                  WHERE event.capacity_slot_id = slot.id
                    AND event.event_type IN (
                      'request_declined', 'slot_revoked'
                    )
                ) AS event_count
         FROM public.responder_capacity_slots AS slot
         JOIN public.community_responder_requests AS request
           ON request.capacity_slot_id = slot.id
         WHERE slot.id = $1`,
        [slot.slot_id],
      );
      expect(state.rows[0]).toEqual({
        opt_in_status: "revoked",
        has_conflict: true,
        request_status: "declined",
        event_count: 2,
      });

      await expect(
        createRequest(db, {
          questionId: "22600000-0000-4000-8000-000000000020",
          slotId: slot.slot_id,
          role: "primary",
          idempotencyKey: "22600000-0000-4000-8000-000000000021",
        }),
      ).rejects.toThrow(/eligible conflict-free capacity slot required/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("serializes one slot and enforces cooldown, weekly, and open-work limits", async () => {
    const db = await createDatabase();
    try {
      const slot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "23000000-0000-4000-8000-000000000001",
        weeklyLimit: 3,
        maxOpenRequests: 3,
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "23000000-0000-4000-8000-000000000002",
      );

      await setPersona(db, "service_role");
      const expiresAt = futureDate(24);
      const competing = await Promise.allSettled([
        db.query(
          `SELECT public.community_create_responder_request(
            '23000000-0000-4000-8000-000000000010'::uuid,
            $1::uuid, 'primary', 'contract_extra_cost', 'extra_charge',
            $2::timestamptz, '${ADMIN_ID}'::uuid,
            '23000000-0000-4000-8000-000000000011'::uuid
          )`,
          [slot.slot_id, expiresAt],
        ),
        db.query(
          `SELECT public.community_create_responder_request(
            '23000000-0000-4000-8000-000000000020'::uuid,
            $1::uuid, 'primary', 'contract_extra_cost', 'extra_charge',
            $2::timestamptz, '${ADMIN_ID}'::uuid,
            '23000000-0000-4000-8000-000000000021'::uuid
          )`,
          [slot.slot_id, expiresAt],
        ),
      ]);
      expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(competing.filter((result) => result.status === "rejected")).toHaveLength(
        1,
      );
      const consumed = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.community_responder_requests
         WHERE capacity_slot_id = $1
           AND status IN ('requested', 'accepted')`,
        [slot.slot_id],
      );
      expect(consumed.rows[0]?.count).toBe(1);

      const cooldownSlot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "23000000-0000-4000-8000-000000000030",
        weeklyLimit: 2,
        maxOpenRequests: 2,
      });
      const secondCooldownSlot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "23000000-0000-4000-8000-000000000031",
        weeklyLimit: 2,
        maxOpenRequests: 2,
      });
      const thirdCooldownSlot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "23000000-0000-4000-8000-000000000032",
        weeklyLimit: 2,
        maxOpenRequests: 2,
      });
      await reviewSlot(
        db,
        cooldownSlot.slot_id,
        "23000000-0000-4000-8000-000000000033",
      );
      await reviewSlot(
        db,
        secondCooldownSlot.slot_id,
        "23000000-0000-4000-8000-000000000034",
      );
      await reviewSlot(
        db,
        thirdCooldownSlot.slot_id,
        "23000000-0000-4000-8000-000000000035",
      );

      await createRequest(db, {
        questionId: "23000000-0000-4000-8000-000000000040",
        slotId: cooldownSlot.slot_id,
        role: "primary",
        idempotencyKey: "23000000-0000-4000-8000-000000000041",
      });
      await expect(
        createRequest(db, {
          questionId: "23000000-0000-4000-8000-000000000042",
          slotId: secondCooldownSlot.slot_id,
          role: "primary",
          idempotencyKey: "23000000-0000-4000-8000-000000000043",
        }),
      ).rejects.toThrow(/cooldown is active/iu);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_responder_requests
        SET created_at = now() - interval '2 hours'
        WHERE responder_id = '${RESPONDER_TWO}'
      `);
      await createRequest(db, {
        questionId: "23000000-0000-4000-8000-000000000044",
        slotId: secondCooldownSlot.slot_id,
        role: "primary",
        idempotencyKey: "23000000-0000-4000-8000-000000000045",
      });
      await expect(
        createRequest(db, {
          questionId: "23000000-0000-4000-8000-000000000046",
          slotId: thirdCooldownSlot.slot_id,
          role: "primary",
          idempotencyKey: "23000000-0000-4000-8000-000000000047",
        }),
      ).rejects.toThrow(/weekly request limit reached/iu);

      const openSlotOne = await registerSlot(db, RESPONDER_THREE, {
        idempotencyKey: "23000000-0000-4000-8000-000000000050",
        weeklyLimit: 3,
        maxOpenRequests: 1,
      });
      const openSlotTwo = await registerSlot(db, RESPONDER_THREE, {
        idempotencyKey: "23000000-0000-4000-8000-000000000051",
        weeklyLimit: 3,
        maxOpenRequests: 1,
      });
      await reviewSlot(
        db,
        openSlotOne.slot_id,
        "23000000-0000-4000-8000-000000000052",
      );
      await reviewSlot(
        db,
        openSlotTwo.slot_id,
        "23000000-0000-4000-8000-000000000053",
      );
      const openRequest = await createRequest(db, {
        questionId: "23000000-0000-4000-8000-000000000054",
        slotId: openSlotOne.slot_id,
        role: "primary",
        idempotencyKey: "23000000-0000-4000-8000-000000000055",
      });
      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_responder_requests
        SET created_at = now() - interval '8 days'
        WHERE id = '${openRequest.request_id}'
      `);
      await expect(
        createRequest(db, {
          questionId: "23000000-0000-4000-8000-000000000056",
          slotId: openSlotTwo.slot_id,
          role: "primary",
          idempotencyKey: "23000000-0000-4000-8000-000000000057",
        }),
      ).rejects.toThrow(/open request limit reached/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("blocks new requests and accepts in read-only/disabled while preserving decline and expiration", async () => {
    const db = await createDatabase();
    try {
      const slotOne = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "24000000-0000-4000-8000-000000000001",
      });
      const slotTwo = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "24000000-0000-4000-8000-000000000002",
      });
      await reviewSlot(
        db,
        slotOne.slot_id,
        "24000000-0000-4000-8000-000000000003",
      );
      await reviewSlot(
        db,
        slotTwo.slot_id,
        "24000000-0000-4000-8000-000000000004",
      );
      const requestOne = await createRequest(db, {
        questionId: "24000000-0000-4000-8000-000000000010",
        slotId: slotOne.slot_id,
        role: "primary",
        idempotencyKey: "24000000-0000-4000-8000-000000000011",
      });
      const requestTwo = await createRequest(db, {
        questionId: "24000000-0000-4000-8000-000000000020",
        slotId: slotTwo.slot_id,
        role: "primary",
        idempotencyKey: "24000000-0000-4000-8000-000000000021",
      });

      await setRuntimeMode(db, "read_only");
      const receiptReplay = await createRequest(db, {
        questionId: requestOne.question_id,
        slotId: slotOne.slot_id,
        role: "primary",
        idempotencyKey: "24000000-0000-4000-8000-000000000011",
        expiresAt: requestOne.expiresAt,
      });
      expect(receiptReplay).toEqual(requestOne);
      expect(receiptReplay).not.toHaveProperty("replayed");
      await expect(
        createRequest(db, {
          questionId: "24000000-0000-4000-8000-000000000030",
          slotId: slotOne.slot_id,
          role: "backup",
          idempotencyKey: "24000000-0000-4000-8000-000000000031",
        }),
      ).rejects.toThrow(/not accepting new work/iu);
      await expect(
        respond(
          db,
          RESPONDER_ONE,
          requestOne.request_id,
          "accept",
          "24000000-0000-4000-8000-000000000032",
        ),
      ).rejects.toThrow(/not accepting new work/iu);
      const declined = await respond(
        db,
        RESPONDER_ONE,
        requestOne.request_id,
        "decline",
        "24000000-0000-4000-8000-000000000033",
      );
      expect(declined.status).toBe("declined");

      await setRuntimeMode(db, "disabled");
      await expect(
        respond(
          db,
          RESPONDER_TWO,
          requestTwo.request_id,
          "accept",
          "24000000-0000-4000-8000-000000000034",
        ),
      ).rejects.toThrow(/not accepting new work/iu);
      await expect(
        registerSlot(db, RESPONDER_THREE, {
          idempotencyKey: "24000000-0000-4000-8000-000000000035",
        }),
      ).rejects.toThrow(/not accepting new work/iu);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.community_responder_requests
        SET created_at = now() - interval '2 hours',
            expires_at = now() - interval '1 hour'
        WHERE id = '${requestTwo.request_id}'
      `);
      await setPersona(db, "service_role");
      const expired = await db.query<{ result: RequestResult }>(
        `SELECT public.community_expire_responder_request(
          $1::uuid, '${ADMIN_ID}'::uuid, 'request_deadline', now(),
          '24000000-0000-4000-8000-000000000036'::uuid
        ) AS result`,
        [requestTwo.request_id],
      );
      expect(expired.rows[0]?.result).toMatchObject({
        status: "expired",
      });
      expect(expired.rows[0]?.result).not.toHaveProperty("replayed");

      await resetPersona(db);
      await expect(
        db.exec(
          "UPDATE public.community_responder_supply_events SET new_status = 'tampered'",
        ),
      ).rejects.toThrow(/append-only/iu);

      await db.exec(
        "DELETE FROM public.community_runtime_control WHERE control_key = 'global'",
      );
      const missingControl = await db.query<{ mode: string }>(
        "SELECT public.community_runtime_mode() AS mode",
      );
      expect(missingControl.rows[0]?.mode).toBe("disabled");
      await expect(
        registerSlot(db, RESPONDER_THREE, {
          idempotencyKey: "24000000-0000-4000-8000-000000000037",
        }),
      ).rejects.toThrow(/not accepting new work/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed for suspended or synthetic responders while preserving decline and current supply truth", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec(
        `UPDATE public.community_profiles
         SET is_suspended = true
         WHERE user_id = '${RESPONDER_ONE}'`,
      );
      await expect(
        registerSlot(db, RESPONDER_ONE, {
          idempotencyKey: "25000000-0000-4000-8000-000000000001",
        }),
      ).rejects.toThrow(/eligible human responder required/iu);

      await resetPersona(db);
      await db.exec(
        `UPDATE public.community_profiles
         SET is_suspended = false
         WHERE user_id = '${RESPONDER_ONE}'`,
      );
      await db.exec(`
        INSERT INTO public.community_agent_personas (
          slug, public_nickname, internal_label, role, status, backing_user_id
        ) VALUES (
          'synthetic-responder', 'synthetic', 'synthetic', 'community_helper',
          'retired', '${RESPONDER_ONE}'
        )
      `);
      await expect(
        registerSlot(db, RESPONDER_ONE, {
          idempotencyKey: "25000000-0000-4000-8000-000000000002",
        }),
      ).rejects.toThrow(/eligible human responder required/iu);

      await resetPersona(db);
      await db.exec(
        `DELETE FROM public.community_agent_personas
         WHERE backing_user_id = '${RESPONDER_ONE}'`,
      );
      const acceptedSlot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "25000000-0000-4000-8000-000000000003",
      });
      await reviewSlot(
        db,
        acceptedSlot.slot_id,
        "25000000-0000-4000-8000-000000000004",
      );
      const acceptedRequest = await createRequest(db, {
        questionId: "25000000-0000-4000-8000-000000000010",
        slotId: acceptedSlot.slot_id,
        role: "primary",
        idempotencyKey: "25000000-0000-4000-8000-000000000011",
      });
      await respond(
        db,
        RESPONDER_ONE,
        acceptedRequest.request_id,
        "accept",
        "25000000-0000-4000-8000-000000000012",
      );

      await resetPersona(db);
      await db.exec(
        `UPDATE public.community_profiles
         SET is_suspended = true
         WHERE user_id = '${RESPONDER_ONE}'`,
      );
      await setPersona(db, "service_role");
      const hiddenSupply = await db.query<{ confirmed_slot_count: number }>(
        `SELECT confirmed_slot_count
         FROM public.community_responder_question_supply
         WHERE question_id = $1`,
        [acceptedRequest.question_id],
      );
      expect(hiddenSupply.rows[0]?.confirmed_slot_count).toBe(0);

      const pendingSlot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "25000000-0000-4000-8000-000000000020",
      });
      await reviewSlot(
        db,
        pendingSlot.slot_id,
        "25000000-0000-4000-8000-000000000021",
      );
      const pendingRequest = await createRequest(db, {
        questionId: "25000000-0000-4000-8000-000000000022",
        slotId: pendingSlot.slot_id,
        role: "primary",
        idempotencyKey: "25000000-0000-4000-8000-000000000023",
      });
      await resetPersona(db);
      await db.exec(
        `UPDATE public.community_profiles
         SET is_suspended = true
         WHERE user_id = '${RESPONDER_TWO}'`,
      );
      await expect(
        respond(
          db,
          RESPONDER_TWO,
          pendingRequest.request_id,
          "accept",
          "25000000-0000-4000-8000-000000000024",
        ),
      ).rejects.toThrow(/eligible human responder required/iu);
      const declined = await respond(
        db,
        RESPONDER_TWO,
        pendingRequest.request_id,
        "decline",
        "25000000-0000-4000-8000-000000000025",
      );
      expect(declined.status).toBe("declined");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not let a self-declared member with an industry relationship open the peer lane", async () => {
    const db = await createDatabase();
    try {
      const disguisedIndustrySlot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "25100000-0000-4000-8000-000000000001",
        origin: "member",
        commercialRelationship: "employee",
      });
      await expect(
        reviewSlot(
          db,
          disguisedIndustrySlot.slot_id,
          "25100000-0000-4000-8000-000000000002",
          "verify",
          "founding_cohort_human_check_passed",
        ),
      ).rejects.toThrow(/verified peer lane requires a non-industry relationship/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps account deletion available and tombstones retained audit identities", async () => {
    const db = await createDatabase();
    try {
      const slot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "25200000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "25200000-0000-4000-8000-000000000002",
      );

      await resetPersona(db);
      await db.exec(`DELETE FROM auth.users WHERE id = '${ADMIN_ID}'`);
      const erasedReviewer = await db.query<{
        reviewed_by: string | null;
        reviewer_erased_at: string | null;
      }>(
        `SELECT reviewed_by, reviewer_erased_at
         FROM public.responder_capacity_slots
         WHERE id = $1`,
        [slot.slot_id],
      );
      expect(erasedReviewer.rows[0]?.reviewed_by).toBeNull();
      expect(erasedReviewer.rows[0]?.reviewer_erased_at).not.toBeNull();

      await db.exec(`DELETE FROM auth.users WHERE id = '${RESPONDER_ONE}'`);
      const deletedOwner = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM auth.users
         WHERE id = '${RESPONDER_ONE}'`,
      );
      expect(deletedOwner.rows[0]?.count).toBe(0);
      const retainedEvents = await db.query<{
        actor_id: string | null;
        actor_erased_at: string | null;
        capacity_slot_id: string | null;
        subject_erased_at: string | null;
      }>(
        `SELECT actor_id, actor_erased_at, capacity_slot_id, subject_erased_at
         FROM public.community_responder_supply_events
         WHERE operation_idempotency_key IN (
           '25200000-0000-4000-8000-000000000001'::uuid,
           '25200000-0000-4000-8000-000000000002'::uuid
         )
         ORDER BY event_type`,
      );
      expect(retainedEvents.rows).toHaveLength(2);
      expect(retainedEvents.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor_id: null,
            actor_erased_at: expect.anything(),
            capacity_slot_id: null,
            subject_erased_at: expect.anything(),
          }),
        ]),
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("treats consumed capacity as terminal even after the accepted request expires", async () => {
    const db = await createDatabase();
    try {
      const slot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "25300000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "25300000-0000-4000-8000-000000000002",
      );
      const request = await createRequest(db, {
        questionId: "25300000-0000-4000-8000-000000000010",
        slotId: slot.slot_id,
        role: "primary",
        idempotencyKey: "25300000-0000-4000-8000-000000000011",
      });
      await respond(
        db,
        RESPONDER_ONE,
        request.request_id,
        "accept",
        "25300000-0000-4000-8000-000000000012",
      );
      await setPersona(db, "service_role");
      await db.query(
        `SELECT public.community_expire_responder_request(
          $1::uuid, '${ADMIN_ID}'::uuid, 'operator_capacity_withdrawal', now(),
          '25300000-0000-4000-8000-000000000013'::uuid
        )`,
        [request.request_id],
      );
      await resetPersona(db);
      await db.query(
        `UPDATE public.community_responder_requests
         SET created_at = now() - interval '2 hours'
         WHERE id = $1`,
        [request.request_id],
      );
      await expect(
        createRequest(db, {
          questionId: "25300000-0000-4000-8000-000000000020",
          slotId: slot.slot_id,
          role: "primary",
          idempotencyKey: "25300000-0000-4000-8000-000000000021",
        }),
      ).rejects.toThrow(/capacity slot has already been consumed/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("enforces disabled reads, safe receipt replay, bounded registration, and one lock order", async () => {
    const db = await createDatabase();
    try {
      const firstKey = "25400000-0000-4000-8000-000000000001";
      const first = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: firstKey,
      });
      const reviewKey = "25400000-0000-4000-8000-000000000002";
      const reviewed = await reviewSlot(db, first.slot_id, reviewKey);

      await setRuntimeMode(db, "read_only");
      const registrationReplay = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: firstKey,
        availableFrom: first.availableFrom,
        availableUntil: first.availableUntil,
      });
      expect(registrationReplay).toEqual(first);
      const reviewReplay = await reviewSlot(db, first.slot_id, reviewKey);
      expect(reviewReplay).toEqual(reviewed);

      await setRuntimeMode(db, "normal");
      for (let index = 2; index <= 8; index += 1) {
        await registerSlot(db, RESPONDER_ONE, {
          idempotencyKey: `25400000-0000-4000-8000-${index
            .toString()
            .padStart(12, "0")}`,
        });
      }
      await expect(
        registerSlot(db, RESPONDER_ONE, {
          idempotencyKey: "25400000-0000-4000-8000-000000000009",
        }),
      ).rejects.toThrow(/registration limit reached/iu);

      await setRuntimeMode(db, "disabled");
      await setPersona(db, "authenticated", RESPONDER_ONE);
      const hiddenSlots = await db.query<{ id: string }>(
        "SELECT id FROM public.responder_capacity_slots",
      );
      expect(hiddenSlots.rows).toEqual([]);

      expect(
        lockingTables("community_respond_responder_request").slice(0, 2),
      ).toEqual(["slot", "request"]);
      expect(
        lockingTables("community_revoke_responder_capacity_slot").slice(0, 2),
      ).toEqual(["slot", "request"]);
      expect(
        lockingTables("community_expire_responder_request").slice(0, 2),
      ).toEqual(["slot", "request"]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not expose responder mutations as authenticated direct RPCs", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        register_direct: boolean;
        respond_direct: boolean;
        revoke_direct: boolean;
        register_service: boolean;
        respond_service: boolean;
        revoke_service: boolean;
      }>(`
        SELECT
          COALESCE(has_function_privilege(
            'authenticated',
            to_regprocedure('public.community_register_responder_capacity_slot(uuid,text,text,text,text,text,boolean,timestamptz,timestamptz,smallint,smallint,smallint,uuid)'),
            'EXECUTE'
          ), false) AS register_direct,
          COALESCE(has_function_privilege(
            'authenticated',
            to_regprocedure('public.community_respond_responder_request(uuid,uuid,text,text,boolean,text,uuid)'),
            'EXECUTE'
          ), false) AS respond_direct,
          COALESCE(has_function_privilege(
            'authenticated',
            to_regprocedure('public.community_revoke_responder_capacity_slot(uuid,uuid,text,uuid)'),
            'EXECUTE'
          ), false) AS revoke_direct,
          COALESCE(has_function_privilege(
            'service_role',
            to_regprocedure('public.community_register_responder_capacity_slot(uuid,text,text,text,text,text,boolean,timestamptz,timestamptz,smallint,smallint,smallint,uuid)'),
            'EXECUTE'
          ), false) AS register_service,
          COALESCE(has_function_privilege(
            'service_role',
            to_regprocedure('public.community_respond_responder_request(uuid,uuid,text,text,boolean,text,uuid)'),
            'EXECUTE'
          ), false) AS respond_service,
          COALESCE(has_function_privilege(
            'service_role',
            to_regprocedure('public.community_revoke_responder_capacity_slot(uuid,uuid,text,uuid)'),
            'EXECUTE'
          ), false) AS revoke_service
      `);
      expect(privileges.rows[0]).toEqual({
        register_direct: false,
        respond_direct: false,
        revoke_direct: false,
        register_service: true,
        respond_service: true,
        revoke_service: true,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("quarantines legacy unbound questions when 1400 is followed by viewer controls", async () => {
    const db = await createDatabase();
    try {
      const slot = await registerSlot(db, RESPONDER_ONE, {
        idempotencyKey: "26000000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "26000000-0000-4000-8000-000000000002",
      );
      const request = await createRequest(db, {
        questionId: "26000000-0000-4000-8000-000000000003",
        slotId: slot.slot_id,
        role: "primary",
        idempotencyKey: "26000000-0000-4000-8000-000000000004",
      });

      await installViewerControlDependencies(db);

      const quarantine = await db.query<{
        intake_status: string;
        requester_id: string | null;
        request_status: string;
        expiry_reason_code: string | null;
        consumed_request_id: string | null;
        audit_count: number;
      }>(`
        SELECT
          question.intake_status,
          question.requester_id,
          request.status AS request_status,
          request.expiry_reason_code,
          slot.consumed_request_id,
          (
            SELECT count(*)::int
            FROM public.community_responder_supply_events AS event
            WHERE event.request_id = request.id
              AND event.event_type = 'request_expired'
              AND event.reason_code = 'requester_identity_unbound'
          ) AS audit_count
        FROM public.community_responder_questions AS question
        JOIN public.community_responder_requests AS request
          ON request.question_id = question.id
        JOIN public.responder_capacity_slots AS slot
          ON slot.id = request.capacity_slot_id
        WHERE request.id = '${request.request_id}'
      `);
      expect(quarantine.rows).toEqual([{
        intake_status: "withdrawn",
        requester_id: null,
        request_status: "expired",
        expiry_reason_code: "requester_identity_unbound",
        consumed_request_id: null,
        audit_count: 1,
      }]);

      await setPersona(db, "service_role");
      await expect(db.query(`
        SELECT public.community_create_bound_responder_request(
          '26000000-0000-4000-8000-000000000003'::uuid,
          '${OUTSIDER_ID}'::uuid,
          '${slot.slot_id}'::uuid,
          'primary',
          'contract_extra_cost',
          'extra_charge',
          '${futureDate(24)}'::timestamptz,
          '${ADMIN_ID}'::uuid,
          '26000000-0000-4000-8000-000000000005'::uuid,
          '26000000-0000-4000-8000-000000000006'::uuid
        )
      `)).rejects.toThrow(/binding idempotency conflict/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("exposes one requester-aware atomic request command after viewer controls", async () => {
    const db = await createDatabase();
    try {
      await installViewerControlDependencies(db);
      const slot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "26100000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "26100000-0000-4000-8000-000000000002",
      );
      await setPersona(db, "service_role");

      const privileges = await db.query<{
        legacy_create_service: boolean;
        binder_service: boolean;
        bound_create_service: boolean;
        bound_create_authenticated: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'service_role',
            'public.community_create_responder_request(uuid,uuid,text,text,text,timestamptz,uuid,uuid)',
            'EXECUTE'
          ) AS legacy_create_service,
          has_function_privilege(
            'service_role',
            'public.community_bind_responder_question_requester(uuid,uuid,text,text,uuid,uuid)',
            'EXECUTE'
          ) AS binder_service,
          has_function_privilege(
            'service_role',
            'public.community_create_bound_responder_request(uuid,uuid,uuid,text,text,text,timestamptz,uuid,uuid,uuid)',
            'EXECUTE'
          ) AS bound_create_service,
          has_function_privilege(
            'authenticated',
            'public.community_create_bound_responder_request(uuid,uuid,uuid,text,text,text,timestamptz,uuid,uuid,uuid)',
            'EXECUTE'
          ) AS bound_create_authenticated
      `);
      expect(privileges.rows[0]).toEqual({
        legacy_create_service: false,
        binder_service: false,
        bound_create_service: true,
        bound_create_authenticated: false,
      });

      const questionId = "26100000-0000-4000-8000-000000000003";
      const bindingKey = "26100000-0000-4000-8000-000000000004";
      const requestKey = "26100000-0000-4000-8000-000000000005";
      const expiresAt = futureDate(24);
      const create = () => db.query<{ result: RequestResult }>(`
        SELECT public.community_create_bound_responder_request(
          '${questionId}'::uuid,
          '${OUTSIDER_ID}'::uuid,
          '${slot.slot_id}'::uuid,
          'primary',
          'contract_extra_cost',
          'extra_charge',
          '${expiresAt}'::timestamptz,
          '${ADMIN_ID}'::uuid,
          '${bindingKey}'::uuid,
          '${requestKey}'::uuid
        ) AS result
      `);

      const first = await create();
      expect(first.rows[0]?.result).toMatchObject({
        question_id: questionId,
        status: "requested",
      });
      expect(first.rows[0]?.result).not.toHaveProperty("replayed");
      const replay = await create();
      expect(replay.rows[0]?.result).toEqual(first.rows[0]?.result);

      const persisted = await db.query<{
        requester_id: string;
        binding_key: string;
        request_count: number;
        created_event_count: number;
      }>(`
        SELECT
          question.requester_id,
          question.requester_binding_idempotency_key::text AS binding_key,
          (
            SELECT count(*)::int
            FROM public.community_responder_requests AS request
            WHERE request.question_id = question.id
          ) AS request_count,
          (
            SELECT count(*)::int
            FROM public.community_responder_supply_events AS event
            WHERE event.question_id = question.id
              AND event.event_type = 'request_created'
          ) AS created_event_count
        FROM public.community_responder_questions AS question
        WHERE question.id = '${questionId}'
      `);
      expect(persisted.rows).toEqual([{
        requester_id: OUTSIDER_ID,
        binding_key: bindingKey,
        request_count: 1,
        created_event_count: 1,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("expires blocked direct work with a matching responder supply audit event", async () => {
    const db = await createDatabase();
    try {
      await installViewerControlDependencies(db);
      const slot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "26200000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "26200000-0000-4000-8000-000000000002",
      );
      await setPersona(db, "service_role");
      const questionId = "26200000-0000-4000-8000-000000000003";
      const created = await db.query<{ result: RequestResult }>(`
        SELECT public.community_create_bound_responder_request(
          '${questionId}'::uuid,
          '${OUTSIDER_ID}'::uuid,
          '${slot.slot_id}'::uuid,
          'primary',
          'contract_extra_cost',
          'extra_charge',
          '${futureDate(24)}'::timestamptz,
          '${ADMIN_ID}'::uuid,
          '26200000-0000-4000-8000-000000000004'::uuid,
          '26200000-0000-4000-8000-000000000005'::uuid
        ) AS result
      `);
      const requestId = created.rows[0]!.result.request_id;

      await respond(
        db,
        RESPONDER_TWO,
        requestId,
        "accept",
        "26200000-0000-4000-8000-000000000006",
      );

      await setPersona(db, "service_role");
      const blocked = await db.query<{
        result: { changed: boolean; blocked: boolean };
      }>(`
        SELECT public.community_set_user_block(
          '${OUTSIDER_ID}'::uuid,
          '${RESPONDER_TWO}'::uuid,
          true,
          'unwanted_contact'
        ) AS result
      `);
      expect(blocked.rows[0]?.result).toMatchObject({
        changed: true,
        blocked: true,
      });

      await resetPersona(db);
      const finalState = await db.query<{
        status: string;
        expiry_reason_code: string;
        expiry_key: string;
        consumed_request_id: string | null;
        event_type: string;
        actor_type: string;
        actor_id: string;
        event_key: string;
        previous_status: string;
        new_status: string;
        reason_code: string;
        viewer_expired_count: number;
      }>(`
        SELECT
          request.status,
          request.expiry_reason_code,
          request.expiry_idempotency_key::text AS expiry_key,
          slot.consumed_request_id,
          event.event_type,
          event.actor_type,
          event.actor_id,
          event.operation_idempotency_key::text AS event_key,
          event.previous_status,
          event.new_status,
          event.reason_code,
          (viewer_event.metadata ->> 'expired_responder_request_count')::int
            AS viewer_expired_count
        FROM public.community_responder_requests AS request
        JOIN public.responder_capacity_slots AS slot
          ON slot.id = request.capacity_slot_id
        JOIN public.community_responder_supply_events AS event
          ON event.request_id = request.id
         AND event.event_type = 'request_expired'
        JOIN public.community_viewer_control_events AS viewer_event
          ON viewer_event.blocker_user_id = '${OUTSIDER_ID}'::uuid
         AND viewer_event.blocked_user_id = '${RESPONDER_TWO}'::uuid
         AND viewer_event.action = 'block'
        WHERE request.id = '${requestId}'
      `);
      expect(finalState.rows).toHaveLength(1);
      expect(finalState.rows[0]).toMatchObject({
        status: "expired",
        expiry_reason_code: "requester_unavailable",
        consumed_request_id: requestId,
        event_type: "request_expired",
        actor_type: "requester",
        actor_id: OUTSIDER_ID,
        previous_status: "accepted",
        new_status: "expired",
        reason_code: "requester_unavailable",
        viewer_expired_count: 1,
      });
      expect(finalState.rows[0]?.event_key).toBe(finalState.rows[0]?.expiry_key);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps an accepted slot terminal after requester account deletion", async () => {
    const db = await createDatabase();
    try {
      await installViewerControlDependencies(db);
      const slot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "26210000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "26210000-0000-4000-8000-000000000002",
      );
      await setPersona(db, "service_role");
      const created = await db.query<{ result: RequestResult }>(`
        SELECT public.community_create_bound_responder_request(
          '26210000-0000-4000-8000-000000000003'::uuid,
          '${OUTSIDER_ID}'::uuid,
          '${slot.slot_id}'::uuid,
          'primary',
          'contract_extra_cost',
          'extra_charge',
          '${futureDate(24)}'::timestamptz,
          '${ADMIN_ID}'::uuid,
          '26210000-0000-4000-8000-000000000004'::uuid,
          '26210000-0000-4000-8000-000000000005'::uuid
        ) AS result
      `);
      const requestId = created.rows[0]!.result.request_id;
      await respond(
        db,
        RESPONDER_TWO,
        requestId,
        "accept",
        "26210000-0000-4000-8000-000000000006",
      );

      await resetPersona(db);
      await db.exec(`DELETE FROM auth.users WHERE id = '${OUTSIDER_ID}'`);

      const retained = await db.query<{
        consumed_request_id: string | null;
        request_count: number;
      }>(`
        SELECT
          slot.consumed_request_id,
          (
            SELECT count(*)::int
            FROM public.community_responder_requests AS request
            WHERE request.id = '${requestId}'::uuid
          ) AS request_count
        FROM public.responder_capacity_slots AS slot
        WHERE slot.id = '${slot.slot_id}'::uuid
      `);
      expect(retained.rows).toEqual([{
        consumed_request_id: requestId,
        request_count: 0,
      }]);

      await expect(db.exec(`
        UPDATE public.responder_capacity_slots
        SET consumed_request_id = NULL
        WHERE id = '${slot.slot_id}'::uuid
      `)).rejects.toThrow(/terminal one-shot/iu);
      await expect(db.exec(`
        UPDATE public.responder_capacity_slots
        SET consumed_request_id = '26210000-0000-4000-8000-000000000007'
        WHERE id = '${slot.slot_id}'::uuid
      `)).rejects.toThrow(/terminal one-shot/iu);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rechecks symmetric blocks on accept while keeping decline and supply fail-safe", async () => {
    const db = await createDatabase();
    try {
      await installViewerControlDependencies(db);

      const declinedSlot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "26220000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        declinedSlot.slot_id,
        "26220000-0000-4000-8000-000000000002",
      );
      await setPersona(db, "service_role");
      const blockedQuestionId = "26220000-0000-4000-8000-000000000003";
      const blockedRequest = await db.query<{ result: RequestResult }>(`
        SELECT public.community_create_bound_responder_request(
          '${blockedQuestionId}'::uuid,
          '${OUTSIDER_ID}'::uuid,
          '${declinedSlot.slot_id}'::uuid,
          'primary',
          'contract_extra_cost',
          'extra_charge',
          '${futureDate(24)}'::timestamptz,
          '${ADMIN_ID}'::uuid,
          '26220000-0000-4000-8000-000000000004'::uuid,
          '26220000-0000-4000-8000-000000000005'::uuid
        ) AS result
      `);
      await resetPersona(db);
      await db.exec(`
        INSERT INTO public.community_viewer_controls(
          blocker_user_id, blocked_user_id, reason_category
        ) VALUES (
          '${OUTSIDER_ID}', '${RESPONDER_TWO}', 'safety'
        )
      `);

      await expect(respond(
        db,
        RESPONDER_TWO,
        blockedRequest.rows[0]!.result.request_id,
        "accept",
        "26220000-0000-4000-8000-000000000006",
      )).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);
      const declined = await respond(
        db,
        RESPONDER_TWO,
        blockedRequest.rows[0]!.result.request_id,
        "decline",
        "26220000-0000-4000-8000-000000000007",
      );
      expect(declined.status).toBe("declined");

      const acceptedSlot = await registerSlot(db, RESPONDER_THREE, {
        idempotencyKey: "26220000-0000-4000-8000-000000000008",
      });
      await reviewSlot(
        db,
        acceptedSlot.slot_id,
        "26220000-0000-4000-8000-000000000009",
      );
      await setPersona(db, "service_role");
      const acceptedQuestionId = "26220000-0000-4000-8000-000000000010";
      const acceptedRequest = await db.query<{ result: RequestResult }>(`
        SELECT public.community_create_bound_responder_request(
          '${acceptedQuestionId}'::uuid,
          '${OUTSIDER_ID}'::uuid,
          '${acceptedSlot.slot_id}'::uuid,
          'primary',
          'contract_extra_cost',
          'extra_charge',
          '${futureDate(24)}'::timestamptz,
          '${ADMIN_ID}'::uuid,
          '26220000-0000-4000-8000-000000000011'::uuid,
          '26220000-0000-4000-8000-000000000012'::uuid
        ) AS result
      `);
      await respond(
        db,
        RESPONDER_THREE,
        acceptedRequest.rows[0]!.result.request_id,
        "accept",
        "26220000-0000-4000-8000-000000000013",
      );
      await resetPersona(db);
      await db.exec(`
        INSERT INTO public.community_viewer_controls(
          blocker_user_id, blocked_user_id, reason_category
        ) VALUES (
          '${OUTSIDER_ID}', '${RESPONDER_THREE}', 'safety'
        )
      `);

      const supply = await db.query<{
        historical_accept_count: number;
        confirmed_slot_count: number;
        question_state: string;
      }>(`
        SELECT
          historical_accept_count,
          confirmed_slot_count,
          question_state
        FROM public.community_responder_question_supply
        WHERE question_id = '${acceptedQuestionId}'::uuid
      `);
      expect(supply.rows).toEqual([{
        historical_accept_count: 1,
        confirmed_slot_count: 0,
        question_state: "private_waitlist",
      }]);

      const acceptBoundary = await db.query<{ definition: string }>(`
        SELECT pg_get_functiondef(
          'public.community_respond_responder_request(uuid,uuid,text,text,boolean,text,uuid)'::regprocedure
        ) AS definition
      `);
      expect(acceptBoundary.rows[0]?.definition).toContain(
        "community_private.lock_user_pair",
      );
      expect(acceptBoundary.rows[0]?.definition).toContain(
        "COMMUNITY_INTERACTION_BLOCKED",
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("serializes a block racing requester-aware responder creation on one pair", async () => {
    const db = await createDatabase();
    try {
      await installViewerControlDependencies(db);
      const slot = await registerSlot(db, RESPONDER_THREE, {
        idempotencyKey: "26300000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "26300000-0000-4000-8000-000000000002",
      );
      await resetPersona(db);

      const questionId = "26300000-0000-4000-8000-000000000003";
      await db.exec(`
        CREATE FUNCTION public.test_racing_viewer_block()
        RETURNS jsonb
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
          PERFORM set_config('request.jwt.claim.role', 'service_role', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          RETURN public.community_set_user_block(
            '${OUTSIDER_ID}'::uuid,
            '${RESPONDER_THREE}'::uuid,
            true,
            'safety'
          );
        END
        $$;

        CREATE FUNCTION public.test_racing_responder_create()
        RETURNS jsonb
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
          PERFORM set_config('request.jwt.claim.role', 'service_role', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          RETURN public.community_create_bound_responder_request(
            '${questionId}'::uuid,
            '${OUTSIDER_ID}'::uuid,
            '${slot.slot_id}'::uuid,
            'primary',
            'contract_extra_cost',
            'extra_charge',
            '${futureDate(24)}'::timestamptz,
            '${ADMIN_ID}'::uuid,
            '26300000-0000-4000-8000-000000000004'::uuid,
            '26300000-0000-4000-8000-000000000005'::uuid
          );
        END
        $$;
      `);

      const competing = await Promise.allSettled([
        db.query("SELECT public.test_racing_viewer_block()"),
        db.query("SELECT public.test_racing_responder_create()"),
      ]);
      expect(competing[0]?.status).toBe("fulfilled");

      const invariant = await db.query<{
        active_block_count: number;
        open_request_count: number;
      }>(`
        SELECT
          (
            SELECT count(*)::int
            FROM public.community_viewer_controls AS control
            WHERE control.blocker_user_id = '${OUTSIDER_ID}'::uuid
              AND control.blocked_user_id = '${RESPONDER_THREE}'::uuid
              AND control.revoked_at IS NULL
          ) AS active_block_count,
          (
            SELECT count(*)::int
            FROM public.community_responder_requests AS request
            JOIN public.community_responder_questions AS question
              ON question.id = request.question_id
            WHERE question.requester_id = '${OUTSIDER_ID}'::uuid
              AND request.responder_id = '${RESPONDER_THREE}'::uuid
              AND request.status IN ('requested', 'accepted')
          ) AS open_request_count
      `);
      expect(invariant.rows).toEqual([{
        active_block_count: 1,
        open_request_count: 0,
      }]);

      const lockContract = await db.query<{
        pair_lock: string;
        block_command: string;
        create_command: string;
      }>(`
        SELECT
          pg_get_functiondef(
            'community_private.lock_user_pair(uuid,uuid)'::regprocedure
          ) AS pair_lock,
          pg_get_functiondef(
            'public.community_set_user_block(uuid,uuid,boolean,text)'::regprocedure
          ) AS block_command,
          pg_get_functiondef(
            'public.community_create_bound_responder_request(uuid,uuid,uuid,text,text,text,timestamptz,uuid,uuid,uuid)'::regprocedure
          ) AS create_command
      `);
      expect(lockContract.rows[0]?.pair_lock).toMatch(
        /ORDER BY app_user\.id[\s\S]*FOR UPDATE/iu,
      );
      expect(lockContract.rows[0]?.block_command).toContain(
        "community_private.lock_user_pair",
      );
      expect(lockContract.rows[0]?.create_command).toContain(
        "community_private.lock_user_pair",
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps bound-request receipts replayable while runtime modes reject new work", async () => {
    const db = await createDatabase();
    try {
      await installViewerControlDependencies(db);
      const slot = await registerSlot(db, RESPONDER_TWO, {
        idempotencyKey: "26400000-0000-4000-8000-000000000001",
      });
      await reviewSlot(
        db,
        slot.slot_id,
        "26400000-0000-4000-8000-000000000002",
      );
      const expiresAt = futureDate(24);
      const create = (options: {
        questionId: string;
        bindingKey: string;
        requestKey: string;
      }) => db.query<{ result: RequestResult }>(`
        SELECT public.community_create_bound_responder_request(
          '${options.questionId}'::uuid,
          '${OUTSIDER_ID}'::uuid,
          '${slot.slot_id}'::uuid,
          'primary',
          'contract_extra_cost',
          'extra_charge',
          '${expiresAt}'::timestamptz,
          '${ADMIN_ID}'::uuid,
          '${options.bindingKey}'::uuid,
          '${options.requestKey}'::uuid
        ) AS result
      `);
      const original = {
        questionId: "26400000-0000-4000-8000-000000000003",
        bindingKey: "26400000-0000-4000-8000-000000000004",
        requestKey: "26400000-0000-4000-8000-000000000005",
      };

      await setPersona(db, "service_role");
      const first = await create(original);
      expect(first.rows[0]?.result).not.toHaveProperty("replayed");

      await setRuntimeMode(db, "read_only");
      const readOnlyReplay = await create(original);
      expect(readOnlyReplay.rows[0]?.result).toEqual(first.rows[0]?.result);
      await expect(create({
        questionId: "26400000-0000-4000-8000-000000000006",
        bindingKey: "26400000-0000-4000-8000-000000000007",
        requestKey: "26400000-0000-4000-8000-000000000008",
      })).rejects.toThrow(/not accepting new work/iu);

      await setRuntimeMode(db, "disabled");
      const disabledReplay = await create(original);
      expect(disabledReplay.rows[0]?.result).toEqual(first.rows[0]?.result);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
