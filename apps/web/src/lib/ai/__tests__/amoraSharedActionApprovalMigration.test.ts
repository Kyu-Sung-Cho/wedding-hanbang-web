// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260730102000_amora_shared_action_approval_and_notifications.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const NEW_GROOM_ID = "10000000-0000-4000-8000-000000000004";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const PROPOSAL_ID = "30000000-0000-4000-8000-000000000001";
const CONFIRMATION_ID = "30000000-0000-4000-8000-000000000002";
const ACTION_ID = "40000000-0000-4000-8000-000000000001";
const REQUEST_KEY = "chat:test:shared-action";
const DEFAULT_TOOL_INPUT = { total_budget: 60_000_000 };
const {
  inputDigest: INPUT_DIGEST,
  operationKey: OPERATION_KEY,
} = getAmoraToolOperationIdentity("update_budget", DEFAULT_TOOL_INPUT);

type ApprovalStatus = {
  approvalMode: string;
  accepted: boolean;
  acceptedCount: number;
  requiredCount: number;
  partnerLinked: boolean;
  ready: boolean;
  proposalDigest: string;
};

type ApplicationClaimStatus = {
  applicationGranted: boolean;
  retryAfterMs: number;
};

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    -- PGlite does not ship Supabase's pgcrypto extension. This deterministic
    -- 32-byte stand-in exercises digest binding, not SHA-256 cryptography.
    CREATE FUNCTION extensions.digest(value bytea, algorithm text)
    RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
      SELECT decode(
        md5(encode(value, 'hex')) || md5(encode(value, 'hex') || algorithm),
        'hex'
      )
    $$;
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
      wedding_date date,
      venue text,
      total_budget numeric NOT NULL DEFAULT 0,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL,
      sender_role text,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      stage_tag text,
      specialist_type text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      request_key text NOT NULL,
      user_id uuid NOT NULL REFERENCES public.profiles(id),
      visibility text NOT NULL,
      status text NOT NULL DEFAULT 'processing',
      message_id uuid REFERENCES public.chat_messages(id),
      user_message_id uuid REFERENCES public.chat_messages(id),
      attempt_count integer NOT NULL DEFAULT 1,
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_tool_executions (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      request_key text NOT NULL,
      operation_key text NOT NULL,
      tool_name text NOT NULL,
      input_digest text NOT NULL,
      status text NOT NULL DEFAULT 'processing',
      result jsonb,
      pending_action_id uuid,
      PRIMARY KEY (couple_id, request_key, operation_key)
    );
    CREATE FUNCTION public.is_current_couple_member(p_user_id uuid, p_couple_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        JOIN public.couples AS couple ON couple.id = profile.couple_id
        WHERE profile.id = p_user_id
          AND profile.couple_id = p_couple_id
          AND (
            (profile.role = 'bride' AND couple.bride_id = p_user_id)
            OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
          )
      )
    $$;
    CREATE FUNCTION public.is_couple_member(p_couple_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      SELECT public.is_current_couple_member(auth.uid(), p_couple_id)
    $$;
    CREATE FUNCTION public.can_access_couple_visibility(
      p_couple_id uuid,
      p_visibility text
    )
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        JOIN public.couples AS couple ON couple.id = profile.couple_id
        WHERE profile.id = auth.uid()
          AND profile.couple_id = p_couple_id
          AND (
            (profile.role = 'bride' AND couple.bride_id = profile.id)
            OR (profile.role = 'groom' AND couple.groom_id = profile.id)
          )
          AND (
            p_visibility = 'shared'
            OR (profile.role = 'bride' AND p_visibility = 'bride_private')
            OR (profile.role = 'groom' AND p_visibility = 'groom_private')
          )
      )
    $$;
    CREATE FUNCTION public.apply_amora_atomic_tool_execution(
      p_couple_id uuid,
      p_request_key text,
      p_operation_key text,
      p_request_attempt_count integer,
      p_input_digest text,
      p_tool_input jsonb,
      p_domain_mutation jsonb,
      p_result jsonb
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
    BEGIN
      IF p_domain_mutation ->> 'kind' = 'journey_total_budget_cas' THEN
        UPDATE public.wedding_journeys
        SET total_budget = (p_domain_mutation ->> 'value')::numeric
        WHERE couple_id = p_couple_id;
      ELSIF p_domain_mutation ->> 'kind' = 'journey_progress_key_cas' THEN
        UPDATE public.wedding_journeys
        SET progress = jsonb_set(
          progress,
          ARRAY[p_domain_mutation ->> 'key'],
          p_domain_mutation -> 'value',
          true
        )
        WHERE couple_id = p_couple_id;
      END IF;

      UPDATE public.amora_tool_executions
      SET status = 'completed',
          result = p_result
      WHERE couple_id = p_couple_id
        AND request_key = p_request_key
        AND operation_key = p_operation_key
        AND status = 'processing';
      RETURN p_result;
    END
    $$;
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY chat_select_with_privacy ON public.chat_messages
      FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility));
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid, uuid)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid)
      TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.can_access_couple_visibility(uuid, text)
      TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}'), ('${NEW_GROOM_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${OTHER_COUPLE_ID}', 'bride'),
      ('${NEW_GROOM_ID}', NULL, NULL);
    INSERT INTO public.wedding_journeys(couple_id, total_budget) VALUES
      ('${COUPLE_ID}', 50000000),
      ('${OTHER_COUPLE_ID}', 30000000);
  `);
  await db.exec(migrationSql);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "service_role" | "authenticated",
  userId?: string,
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

async function insertProposal(
  db: PGlite,
  options: {
    id?: string;
    actionId?: string;
    tool?: string;
    input?: Record<string, unknown>;
    issuedAt?: number;
    expiresAt?: number;
    coupleId?: string;
    journeyRevision?: number;
  } = {},
) {
  const issuedAt = options.issuedAt ?? Date.now();
  const tool = options.tool ?? "update_budget";
  const input = options.input ?? DEFAULT_TOOL_INPUT;
  const identity = getAmoraToolOperationIdentity(tool, input);
  const ttlMs = [
    "update_budget",
    "update_wedding_date",
    "update_venue",
    "apply_budget_plan",
  ].includes(tool) || (
    ["update_category_budget", "add_custom_category"].includes(tool)
    && Object.prototype.hasOwnProperty.call(options.input ?? {}, "budget")
  )
    ? 24 * 60 * 60 * 1_000
    : 10 * 60 * 1_000;
  const action = {
    version: 2,
    actionId: options.actionId ?? ACTION_ID,
    tool,
    input,
    inputDigest: identity.inputDigest,
    operationKey: identity.operationKey,
    confirmation: "함께 확인할 변경이에요.",
    issuedAt,
    expiresAt: options.expiresAt ?? issuedAt + ttlMs,
  };
  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, NULL, 'ai', 'assistant', 'generic proposal',
       jsonb_build_object(
         'pending_amora_action', $3::jsonb,
         'pending_amora_action_journey_revision', $4::bigint
       ),
       'shared', clock_timestamp()
     )`,
    [
      options.id ?? PROPOSAL_ID,
      options.coupleId ?? COUPLE_ID,
      JSON.stringify(action),
      options.journeyRevision ?? 0,
    ],
  );
}

async function insertConfirmation(
  db: PGlite,
  userId: string,
  id = CONFIRMATION_ID,
) {
  const senderType = userId === BRIDE_ID ? "bride" : "groom";
  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, $3, $4, 'user', 'apply this exact action', '{}',
       'shared', clock_timestamp() + interval '1 second'
     )`,
    [id, COUPLE_ID, userId, senderType],
  );
}

async function insertApplicationConfirmation(
  db: PGlite,
  userId: string,
  id = CONFIRMATION_ID,
  actionId = ACTION_ID,
) {
  const senderType = userId === BRIDE_ID ? "bride" : "groom";
  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, $3, $4, 'user', 'apply this exact action',
       jsonb_build_object('confirmed_amora_action_id', $5::text),
       'shared', clock_timestamp() + interval '1 second'
     )`,
    [id, COUPLE_ID, userId, senderType, actionId],
  );
}

async function status(
  db: PGlite,
  userId: string,
  proposalId = PROPOSAL_ID,
  actionId = ACTION_ID,
) {
  const result = await db.query<{ result: ApprovalStatus }>(
    "SELECT public.get_amora_shared_action_status($1, $2, $3, $4) AS result",
    [actionId, COUPLE_ID, proposalId, userId],
  );
  return result.rows[0].result;
}

async function accept(
  db: PGlite,
  userId: string,
  proposalId = PROPOSAL_ID,
  actionId = ACTION_ID,
) {
  const result = await db.query<{ result: ApprovalStatus }>(
    "SELECT public.accept_amora_shared_action($1, $2, $3, $4) AS result",
    [actionId, COUPLE_ID, proposalId, userId],
  );
  return result.rows[0].result;
}

async function revoke(
  db: PGlite,
  userId: string,
  proposalId = PROPOSAL_ID,
  actionId = ACTION_ID,
) {
  const result = await db.query<{ result: ApprovalStatus }>(
    "SELECT public.revoke_amora_shared_action_acceptance($1, $2, $3, $4) AS result",
    [actionId, COUPLE_ID, proposalId, userId],
  );
  return result.rows[0].result;
}

async function claimApplication(
  db: PGlite,
  userId: string,
  proposalId = PROPOSAL_ID,
  actionId = ACTION_ID,
) {
  const result = await db.query<{ result: ApplicationClaimStatus }>(
    "SELECT public.claim_amora_shared_action_application($1, $2, $3, $4) AS result",
    [actionId, COUPLE_ID, proposalId, userId],
  );
  return result.rows[0].result;
}

async function insertClaimAndExecution(
  db: PGlite,
  userId: string,
  toolName = "update_budget",
  actionId = ACTION_ID,
  identity: {
    inputDigest: string;
    operationKey: string;
  } = {
    inputDigest: INPUT_DIGEST,
    operationKey: OPERATION_KEY,
  },
) {
  await db.query(
    `INSERT INTO public.amora_chat_request_claims(
       couple_id, request_key, user_id, visibility, status, user_message_id
     ) VALUES ($1, $2, $3, 'shared', 'processing', $4)`,
    [COUPLE_ID, REQUEST_KEY, userId, CONFIRMATION_ID],
  );
  await db.query(
    `INSERT INTO public.amora_tool_executions(
       couple_id, request_key, operation_key, tool_name, input_digest,
       status, pending_action_id, pending_action_journey_revision
     ) VALUES ($1, $2, $3, $4, $5, 'processing', $6, 777)`,
    [
      COUPLE_ID,
      REQUEST_KEY,
      identity.operationKey,
      toolName,
      identity.inputDigest,
      actionId,
    ],
  );
}

async function applyApprovedBudgetMutation(
  db: PGlite,
  nextBudget = 60_000_000,
) {
  const result = {
    toolName: "update_budget",
    toolOutput: {
      total_budget: nextBudget,
      previous_budget: 50_000_000,
    },
    success: true,
    displayMessage: "applied",
  };
  return db.query<{ result: typeof result }>(
    `SELECT public.apply_amora_atomic_tool_execution(
       $1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb
     ) AS result`,
    [
      COUPLE_ID,
      REQUEST_KEY,
      OPERATION_KEY,
      INPUT_DIGEST,
      JSON.stringify(DEFAULT_TOOL_INPUT),
      JSON.stringify({
        kind: "journey_total_budget_cas",
        expected: 50_000_000,
        value: nextBudget,
      }),
      JSON.stringify(result),
    ],
  );
}

async function applyApprovedMutation(
  db: PGlite,
  options: {
    toolName: string;
    toolInput: Record<string, unknown>;
    operationKey: string;
    inputDigest: string;
    domainMutation: Record<string, unknown>;
    toolOutput: Record<string, unknown>;
  },
) {
  const result = {
    toolName: options.toolName,
    toolOutput: options.toolOutput,
    success: true,
    displayMessage: "applied",
  };
  return db.query<{ result: typeof result }>(
    `SELECT public.apply_amora_atomic_tool_execution(
       $1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb
     ) AS result`,
    [
      COUPLE_ID,
      REQUEST_KEY,
      options.operationKey,
      options.inputDigest,
      JSON.stringify(options.toolInput),
      JSON.stringify(options.domainMutation),
      JSON.stringify(result),
    ],
  );
}

describe("Amora shared-action approval migration", () => {
  it("is an expand-only transactional migration with bounded locks", () => {
    const sql = migrationSql;

    expect(sql.trimStart()).toMatch(/^BEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql).toContain("SET LOCAL statement_timeout = '60s'");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.amora_shared_action_acceptances");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.amora_shared_action_application_claims");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.amora_shared_action_journey_mutation_receipts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.couple_change_notifications");
    expect(sql).toContain(
      "RENAME TO apply_amora_atomic_tool_execution_pre_shared_revision",
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.apply_amora_atomic_tool_execution_pre_shared_revision[\s\S]+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_amora_atomic_tool_execution\([\s\S]+TO service_role/,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_bind_amora_shared_action_application[\s\S]+BEFORE INSERT[\s\S]+ON public\.chat_messages/,
    );
    expect(sql).toMatch(
      /CREATE POLICY chat_messages_insert_own_user[\s\S]+confirmed_amora_action_id/,
    );
    expect(sql).toMatch(
      /pg_publication_tables[\s\S]+ALTER PUBLICATION supabase_realtime ADD TABLE public\.couple_change_notifications/,
    );
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(sql).not.toMatch(/source\.(content)|message\.content/);
    expect(sql).not.toContain("decision_nodes");

    const contextStart = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.amora_shared_action_context",
    );
    const contextEnd = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_amora_shared_action_status",
    );
    const contextSql = sql.slice(contextStart, contextEnd);
    expect(contextSql).toMatch(
      /SELECT journey\.state_revision[\s\S]+WHERE journey\.couple_id = p_couple_id;/,
    );
    expect(contextSql).not.toMatch(
      /SELECT journey\.state_revision[\s\S]+WHERE journey\.couple_id = p_couple_id\s+FOR (UPDATE|SHARE)/,
    );

    const wrapperStart = sql.indexOf(
      "CREATE FUNCTION public.apply_amora_atomic_tool_execution(",
    );
    const wrapperEnd = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.authorize_amora_shared_action_execution",
    );
    const wrapperSql = sql.slice(wrapperStart, wrapperEnd);
    const wrapperFenceRead = wrapperSql.match(
      /SELECT execution\.pending_action_id,[\s\S]+WHERE execution\.couple_id = p_couple_id[\s\S]+AND execution\.operation_key = p_operation_key;/,
    )?.[0] ?? "";
    expect(wrapperFenceRead).not.toBe("");
    expect(wrapperFenceRead).not.toMatch(/\bFOR (UPDATE|SHARE)\b/);
    expect(sql).toContain(
      "OLD.state_revision IS DISTINCT FROM v_expected_revision",
    );
  });

  it("keeps multi-session races behind database uniqueness and advisory locking", () => {
    // PGlite's in-memory test driver does not expose independent sessions, so
    // it cannot prove PostgreSQL lock scheduling. The behavior tests below
    // still prove idempotent duplicate votes and notifications; this static
    // contract makes the hosted-PostgreSQL concurrency boundary explicit.
    expect(migrationSql).toContain("pg_advisory_xact_lock");
    expect(migrationSql).toMatch(
      /PRIMARY KEY \(couple_id, source_message_id, action_id, user_id\)/,
    );
    expect(migrationSql).toMatch(
      /amora_shared_action_application_claims[\s\S]+PRIMARY KEY \(couple_id, source_message_id, action_id\)/,
    );
    expect(migrationSql).toMatch(
      /UNIQUE[\s\S]+confirmation_message_id[\s\S]+WHERE confirmation_message_id IS NOT NULL/,
    );
    expect(migrationSql).toMatch(
      /UNIQUE \(couple_id, recipient_user_id, action_id, event_kind\)/,
    );
    expect(migrationSql).toMatch(
      /notify_amora_shared_action_completion[\s\S]+claim\.user_message_id[\s\S]+lag\(message\.id\)[\s\S]+ordered\.id = v_confirmation_message_id/,
    );
  });

  it("advances the journey revision exactly once on every update", async () => {
    const db = await createDatabase();
    try {
      const before = await db.query<{ updated_at: string }>(
        `SELECT updated_at::text
         FROM public.wedding_journeys
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );

      await db.query(
        `UPDATE public.wedding_journeys
         SET total_budget = 51000000,
             state_revision = 777,
             updated_at = '2000-01-01T00:00:00Z'
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      const first = await db.query<{
        state_revision: number;
        updated_at: string;
      }>(
        `SELECT state_revision::integer, updated_at::text
         FROM public.wedding_journeys
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      expect(first.rows[0].state_revision).toBe(1);
      expect(new Date(first.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.rows[0].updated_at).getTime(),
      );

      await db.query(
        `UPDATE public.wedding_journeys
         SET venue = 'revision test venue',
             state_revision = 0
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      const second = await db.query<{ state_revision: number }>(
        `SELECT state_revision::integer
         FROM public.wedding_journeys
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      expect(second.rows[0].state_revision).toBe(2);
    } finally {
      await db.close();
    }
  });

  it("starts every inserted journey at server-owned revision zero", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        "DELETE FROM public.wedding_journeys WHERE couple_id = $1",
        [OTHER_COUPLE_ID],
      );
      await db.query(
        `INSERT INTO public.wedding_journeys(
           couple_id, total_budget, state_revision, updated_at
         ) VALUES ($1, 30000000, 9007199254740991, '2000-01-01T00:00:00Z')`,
        [OTHER_COUPLE_ID],
      );
      const inserted = await db.query<{
        state_revision: number;
        updated_at: string;
      }>(
        `SELECT state_revision::integer, updated_at::text
         FROM public.wedding_journeys
         WHERE couple_id = $1`,
        [OTHER_COUPLE_ID],
      );
      expect(inserted.rows[0].state_revision).toBe(0);
      expect(new Date(inserted.rows[0].updated_at).getUTCFullYear()).toBeGreaterThan(
        2000,
      );
    } finally {
      await db.close();
    }
  });

  it("classifies every mutating tool fail-closed", async () => {
    const db = await createDatabase();
    try {
      const result = await db.query<{
        budget: string;
        category_budget: string;
        category_spent: string;
        custom_budget: string;
        custom_spent: string;
        schedule: string;
        action_insert: string;
        action_update: string;
        destructive: string;
        unknown_tool: string;
      }>(`
        SELECT
          public.amora_shared_action_policy('update_budget', '{"total_budget":1}') AS budget,
          public.amora_shared_action_policy('update_category_budget', '{"budget":1}') AS category_budget,
          public.amora_shared_action_policy('update_category_budget', '{"spent":1}') AS category_spent,
          public.amora_shared_action_policy('add_custom_category', '{"label":"x","budget":1}') AS custom_budget,
          public.amora_shared_action_policy('add_custom_category', '{"label":"x","spent":1}') AS custom_spent,
          public.amora_shared_action_policy('add_schedule_event', '{"title":"x"}') AS schedule,
          public.amora_shared_action_policy('add_amora_action', '{"title":"x"}') AS action_insert,
          public.amora_shared_action_policy('update_amora_action', '{"action_id":"x","title":"y"}') AS action_update,
          public.amora_shared_action_policy('delete_schedule_event', '{"event_id":"x"}') AS destructive,
          public.amora_shared_action_policy('future_tool', '{}') AS unknown_tool
      `);

      expect(result.rows[0]).toEqual({
        budget: "couple",
        category_budget: "couple",
        category_spent: "single",
        custom_budget: "couple",
        custom_spent: "single",
        schedule: "single",
        action_insert: "single",
        action_update: "blocked",
        destructive: "blocked",
        unknown_tool: "blocked",
      });
    } finally {
      await db.close();
    }
  });

  it("blocks existing action updates until an action-row CAS is available", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, {
        tool: "update_amora_action",
        input: {
          action_id: "50000000-0000-4000-8000-000000000001",
          title: "stale replacement",
        },
      });
      await setPersona(db, "service_role");

      await expect(status(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_BLOCKED/,
      );
      await expect(claimApplication(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_BLOCKED/,
      );
      const claims = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.amora_shared_action_application_claims`,
      );
      expect(claims.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects legacy v1 proposals without the versioned execution identity", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = jsonb_set(
           metadata,
           '{pending_amora_action,version}',
           '1'::jsonb,
           false
         )
         WHERE id = $1`,
        [PROPOSAL_ID],
      );
      await setPersona(db, "service_role");

      await expect(status(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_INVALID/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("requires one canonical bounded integer journey revision sibling", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");

      await db.query(
        `UPDATE public.chat_messages
         SET metadata = metadata - 'pending_amora_action_journey_revision'
         WHERE id = $1`,
        [PROPOSAL_ID],
      );
      await expect(status(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_INVALID/,
      );

      await db.query(
        `UPDATE public.chat_messages
         SET metadata = jsonb_set(
           metadata,
           '{pending_amora_action_journey_revision}',
           to_jsonb(9007199254740992::numeric)
         )
         WHERE id = $1`,
        [PROPOSAL_ID],
      );
      await expect(status(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_INVALID/,
      );

      await db.query(
        `UPDATE public.chat_messages
         SET metadata = jsonb_set(
           metadata,
           '{pending_amora_action_journey_revision}',
           '0.0'::jsonb
         )
         WHERE id = $1`,
        [PROPOSAL_ID],
      );
      await expect(status(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_INVALID/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("requires two distinct linked members, deduplicates votes, and fixes notification recipients", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");

      expect(await status(db, BRIDE_ID)).toMatchObject({
        approvalMode: "couple",
        accepted: false,
        acceptedCount: 0,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      });

      expect(await accept(db, BRIDE_ID)).toMatchObject({
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        ready: false,
      });
      expect(await accept(db, BRIDE_ID)).toMatchObject({
        acceptedCount: 1,
        ready: false,
      });
      expect(await accept(db, GROOM_ID)).toMatchObject({
        accepted: true,
        acceptedCount: 2,
        requiredCount: 2,
        ready: true,
      });

      const votes = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.amora_shared_action_acceptances",
      );
      expect(votes.rows[0].count).toBe(2);

      const notifications = await db.query<{
        event_kind: string;
        actor_user_id: string;
        recipient_user_id: string;
        read_at: string | null;
      }>(`
        SELECT event_kind, actor_user_id::text, recipient_user_id::text,
               read_at::text
        FROM public.couple_change_notifications
        ORDER BY created_at, event_kind
      `);
      expect(notifications.rows).toEqual([
        {
          event_kind: "approval_requested",
          actor_user_id: BRIDE_ID,
          recipient_user_id: GROOM_ID,
          read_at: expect.any(String),
        },
      ]);

      await db.query(
        "DELETE FROM public.chat_messages WHERE id = $1",
        [PROPOSAL_ID],
      );
      const preserved = await db.query<{ votes: number; notifications: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_shared_action_acceptances) AS votes,
          (SELECT count(*)::integer FROM public.couple_change_notifications) AS notifications
      `);
      expect(preserved.rows[0]).toEqual({ votes: 2, notifications: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("grants only one application lease for an exact ready action", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);

      expect(await claimApplication(db, BRIDE_ID)).toEqual({
        applicationGranted: true,
        retryAfterMs: 0,
      });

      const competing = await claimApplication(db, GROOM_ID);
      expect(competing.applicationGranted).toBe(false);
      expect(competing.retryAfterMs).toBeGreaterThan(0);
      expect(competing.retryAfterMs).toBeLessThanOrEqual(60_000);

      expect(await claimApplication(db, BRIDE_ID)).toEqual({
        applicationGranted: true,
        retryAfterMs: 0,
      });

      const lease = await db.query<{
        claimed_by_user_id: string;
        count: number;
      }>(`
        SELECT min(claimed_by_user_id::text) AS claimed_by_user_id,
               count(*)::integer AS count
        FROM public.amora_shared_action_application_claims
      `);
      expect(lease.rows[0]).toEqual({
        claimed_by_user_id: BRIDE_ID,
        count: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("lets exactly one current member take over an expired unbound lease", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      expect(await claimApplication(db, BRIDE_ID)).toMatchObject({
        applicationGranted: true,
      });

      await db.query(
        `UPDATE public.amora_shared_action_application_claims
         SET claimed_at = clock_timestamp() - interval '61 seconds',
             lease_expires_at = clock_timestamp() - interval '1 second'
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );

      expect(await claimApplication(db, GROOM_ID)).toEqual({
        applicationGranted: true,
        retryAfterMs: 0,
      });
      expect((await claimApplication(db, BRIDE_ID)).applicationGranted).toBe(
        false,
      );

      const owner = await db.query<{ claimed_by_user_id: string }>(
        `SELECT claimed_by_user_id::text
         FROM public.amora_shared_action_application_claims
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );
      expect(owner.rows[0].claimed_by_user_id).toBe(GROOM_ID);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("refuses an application lease until every required approval is active", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);

      await expect(claimApplication(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_APPROVAL_REQUIRED/,
      );
      const claims = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.amora_shared_action_application_claims`,
      );
      expect(claims.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a proposal-time revision after the journey changes before claim", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, { journeyRevision: 0 });
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await db.query(
        `UPDATE public.wedding_journeys
         SET total_budget = 52000000
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );

      await expect(claimApplication(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_CHANGED/,
      );
      const state = await db.query<{
        claims: number;
        state_revision: number;
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM public.amora_shared_action_application_claims
          ) AS claims,
          (
            SELECT state_revision::integer
            FROM public.wedding_journeys
            WHERE couple_id = '${COUPLE_ID}'
          ) AS state_revision
      `);
      expect(state.rows[0]).toEqual({ claims: 0, state_revision: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows a current member to claim a ready single-policy action", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, {
        tool: "add_schedule_event",
        input: { date: "2099-01-01", title: "venue visit" },
      });
      await setPersona(db, "service_role");

      expect(await claimApplication(db, BRIDE_ID)).toEqual({
        applicationGranted: true,
        retryAfterMs: 0,
      });
      expect((await claimApplication(db, GROOM_ID)).applicationGranted).toBe(
        false,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("binds a granted lease to the exact confirmation in the chat insert transaction", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);

      await insertApplicationConfirmation(db, GROOM_ID);

      const binding = await db.query<{
        claimed_by_user_id: string;
        confirmation_message_id: string | null;
      }>(
        `SELECT claimed_by_user_id::text, confirmation_message_id::text
         FROM public.amora_shared_action_application_claims
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );
      expect(binding.rows).toEqual([{
        claimed_by_user_id: GROOM_ID,
        confirmation_message_id: CONFIRMATION_ID,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects and rolls back an application confirmation without a lease", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);

      await expect(
        insertApplicationConfirmation(db, GROOM_ID),
      ).rejects.toThrow(/AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID/);

      const confirmation = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.chat_messages
         WHERE id = $1`,
        [CONFIRMATION_ID],
      );
      expect(confirmation.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects the wrong actor without consuming the real claimant's lease", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, BRIDE_ID);

      await expect(
        insertApplicationConfirmation(db, GROOM_ID),
      ).rejects.toThrow(/AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID/);

      await insertApplicationConfirmation(db, BRIDE_ID);
      const binding = await db.query<{ confirmation_message_id: string }>(
        `SELECT confirmation_message_id::text
         FROM public.amora_shared_action_application_claims
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );
      expect(binding.rows[0].confirmation_message_id).toBe(CONFIRMATION_ID);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects and rolls back a confirmation for an expired unbound lease", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, BRIDE_ID);
      await db.query(
        `UPDATE public.amora_shared_action_application_claims
         SET claimed_at = clock_timestamp() - interval '61 seconds',
             lease_expires_at = clock_timestamp() - interval '1 second'
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );

      await expect(
        insertApplicationConfirmation(db, BRIDE_ID),
      ).rejects.toThrow(/AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID/);
      const confirmation = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.chat_messages
         WHERE id = $1`,
        [CONFIRMATION_ID],
      );
      expect(confirmation.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("persists only one confirmation when two inserts race for one lease", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, BRIDE_ID);

      await insertApplicationConfirmation(db, BRIDE_ID);
      await expect(insertApplicationConfirmation(
        db,
        BRIDE_ID,
        "30000000-0000-4000-8000-000000000003",
      )).rejects.toThrow(
        /AMORA_SHARED_ACTION_(STALE_CONTEXT|APPLICATION_CLAIM_INVALID)/,
      );

      const confirmations = await db.query<{
        count: number;
        confirmation_message_id: string;
      }>(
        `SELECT
           (
             SELECT count(*)::integer
             FROM public.chat_messages
             WHERE metadata ? 'confirmed_amora_action_id'
           ) AS count,
           confirmation_message_id::text
         FROM public.amora_shared_action_application_claims
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );
      expect(confirmations.rows[0]).toEqual({
        count: 1,
        confirmation_message_id: CONFIRMATION_ID,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("invalidates a single-policy claim when its exact proposal changes", async () => {
    const db = await createDatabase();
    try {
      const originalInput = {
        date: "2099-01-01",
        title: "venue visit",
      };
      await insertProposal(db, {
        tool: "add_schedule_event",
        input: originalInput,
      });
      await setPersona(db, "service_role");
      await claimApplication(db, BRIDE_ID);

      const changedInput = {
        date: "2099-01-02",
        title: "venue visit",
      };
      const changedIdentity = getAmoraToolOperationIdentity(
        "add_schedule_event",
        changedInput,
      );
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = jsonb_set(
           jsonb_set(
             jsonb_set(
               metadata,
               '{pending_amora_action,input}',
               $2::jsonb,
               false
             ),
             '{pending_amora_action,inputDigest}',
             to_jsonb($3::text),
             false
           ),
           '{pending_amora_action,operationKey}',
           to_jsonb($4::text),
           false
         )
         WHERE id = $1`,
        [
          PROPOSAL_ID,
          JSON.stringify(changedInput),
          changedIdentity.inputDigest,
          changedIdentity.operationKey,
        ],
      );

      await expect(
        insertApplicationConfirmation(db, BRIDE_ID),
      ).rejects.toThrow(
        /AMORA_SHARED_ACTION_(PROPOSAL_CHANGED|APPLICATION_CLAIM_INVALID)/,
      );
      const confirmation = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.chat_messages
         WHERE id = $1`,
        [CONFIRMATION_ID],
      );
      expect(confirmation.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows only strict shared confirmation metadata through authenticated chat RLS", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);

      await resetPersona(db);
      await setPersona(db, "authenticated", GROOM_ID);
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'groom', 'user', 'apply this exact action',
           jsonb_build_object(
             'confirmed_amora_action_id', $3::text,
             'forged', true
           ),
           'shared'
         )`,
        [COUPLE_ID, GROOM_ID, ACTION_ID],
      )).rejects.toThrow(/row-level security|permission denied/i);

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'groom', 'user', 'private confirmation is invalid',
           jsonb_build_object('confirmed_amora_action_id', $3::text),
           'groom_private'
         )`,
        [COUPLE_ID, GROOM_ID, ACTION_ID],
      )).rejects.toThrow(
        /AMORA_SHARED_ACTION_CONFIRMATION_INVALID|row-level security/i,
      );

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'groom', 'user', 'partner-target confirmation is invalid',
           jsonb_build_object(
             'confirmed_amora_action_id', $3::text,
             'target', 'partner'
           ),
           'shared'
         )`,
        [COUPLE_ID, GROOM_ID, ACTION_ID],
      )).rejects.toThrow(
        /AMORA_SHARED_ACTION_CONFIRMATION_INVALID|row-level security/i,
      );

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'groom', 'user', 'malformed action id is invalid',
           '{"confirmed_amora_action_id":"not-a-uuid"}'::jsonb,
           'shared'
         )`,
        [COUPLE_ID, GROOM_ID],
      )).rejects.toThrow(
        /AMORA_SHARED_ACTION_CONFIRMATION_INVALID|row-level security/i,
      );

      const inserted = await db.query<{ id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'groom', 'user', 'apply this exact action',
           jsonb_build_object('confirmed_amora_action_id', $3::text),
           'shared'
         )
         RETURNING id::text`,
        [COUPLE_ID, GROOM_ID, ACTION_ID],
      );

      await resetPersona(db);
      await setPersona(db, "service_role");
      const binding = await db.query<{ confirmation_message_id: string }>(
        `SELECT confirmation_message_id::text
         FROM public.amora_shared_action_application_claims
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );
      expect(binding.rows[0].confirmation_message_id).toBe(inserted.rows[0].id);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("authorizes only the exact confirmation already bound to its application lease", async () => {
    const unclaimedDb = await createDatabase();
    try {
      await insertProposal(unclaimedDb);
      await setPersona(unclaimedDb, "service_role");
      await accept(unclaimedDb, BRIDE_ID);
      await accept(unclaimedDb, GROOM_ID);
      await resetPersona(unclaimedDb);
      await insertConfirmation(unclaimedDb, GROOM_ID);
      await setPersona(unclaimedDb, "service_role");

      await expect(unclaimedDb.query(
        "SELECT public.authorize_amora_shared_action_execution($1, $2, $3, $4, $5)",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, CONFIRMATION_ID, GROOM_ID],
      )).rejects.toThrow(/AMORA_SHARED_ACTION_APPLICATION_CLAIM_INVALID/);
    } finally {
      await resetPersona(unclaimedDb).catch(() => undefined);
      await unclaimedDb.close();
    }

    const boundDb = await createDatabase();
    try {
      await insertProposal(boundDb);
      await setPersona(boundDb, "service_role");
      await accept(boundDb, BRIDE_ID);
      await accept(boundDb, GROOM_ID);
      await claimApplication(boundDb, GROOM_ID);
      await insertApplicationConfirmation(boundDb, GROOM_ID);
      await boundDb.query(
        `UPDATE public.amora_shared_action_application_claims
         SET claimed_at = clock_timestamp() - interval '2 minutes',
             lease_expires_at = clock_timestamp() - interval '1 minute'
         WHERE couple_id = $1
           AND source_message_id = $2
           AND action_id = $3`,
        [COUPLE_ID, PROPOSAL_ID, ACTION_ID],
      );

      const authorized = await boundDb.query<{
        result: { authorized: boolean };
      }>(
        "SELECT public.authorize_amora_shared_action_execution($1, $2, $3, $4, $5) AS result",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, CONFIRMATION_ID, GROOM_ID],
      );
      expect(authorized.rows[0].result.authorized).toBe(true);
    } finally {
      await resetPersona(boundDb).catch(() => undefined);
      await boundDb.close();
    }
  });

  it("stores the proposal-time journey revision on the execution fence", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, { journeyRevision: 0 });
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);
      await insertApplicationConfirmation(db, GROOM_ID);
      await insertClaimAndExecution(db, GROOM_ID);

      const execution = await db.query<{
        pending_action_journey_revision: number;
      }>(
        `SELECT pending_action_journey_revision::integer
         FROM public.amora_tool_executions
         WHERE couple_id = $1
           AND request_key = $2
           AND operation_key = $3`,
        [COUPLE_ID, REQUEST_KEY, OPERATION_KEY],
      );
      expect(execution.rows[0].pending_action_journey_revision).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("commits one approved journey mutation from revision r to r plus one", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, { journeyRevision: 0 });
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);
      await insertApplicationConfirmation(db, GROOM_ID);
      await insertClaimAndExecution(db, GROOM_ID);

      const applied = await applyApprovedBudgetMutation(db);
      expect(applied.rows[0].result.success).toBe(true);

      const durable = await db.query<{
        state_revision: number;
        total_budget: number;
        status: string;
        notifications: number;
      }>(`
        SELECT
          journey.state_revision::integer,
          journey.total_budget::integer,
          execution.status,
          (
            SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE event_kind = 'change_applied'
          ) AS notifications
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = '${COUPLE_ID}'
          AND execution.request_key = '${REQUEST_KEY}'
          AND execution.operation_key = '${OPERATION_KEY}'
      `);
      expect(durable.rows[0]).toEqual({
        state_revision: 1,
        total_budget: 60_000_000,
        status: "completed",
        notifications: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a journey change after confirmation but before the execution fence", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, { journeyRevision: 0 });
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);
      await insertApplicationConfirmation(db, GROOM_ID);
      await db.query(
        `UPDATE public.wedding_journeys
         SET venue = 'changed after confirmation'
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );

      await expect(insertClaimAndExecution(db, GROOM_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_CHANGED/,
      );
      const durable = await db.query<{
        executions: number;
        revision: number;
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM public.amora_tool_executions
          ) AS executions,
          (
            SELECT state_revision::integer
            FROM public.wedding_journeys
            WHERE couple_id = '${COUPLE_ID}'
          ) AS revision
      `);
      expect(durable.rows[0]).toEqual({ executions: 0, revision: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects direct success completion and an external change after the execution fence", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, { journeyRevision: 0 });
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);
      await insertApplicationConfirmation(db, GROOM_ID);
      await insertClaimAndExecution(db, GROOM_ID);

      await expect(db.query(
        `UPDATE public.amora_tool_executions
         SET status = 'completed',
             result = '{"toolName":"update_budget","toolOutput":{"total_budget":60000000},"success":true,"displayMessage":"applied"}'
         WHERE couple_id = $1 AND request_key = $2 AND operation_key = $3`,
        [COUPLE_ID, REQUEST_KEY, OPERATION_KEY],
      )).rejects.toThrow(/AMORA_SHARED_ACTION_PROPOSAL_CHANGED/);

      await db.query(
        `UPDATE public.wedding_journeys
         SET venue = 'external winner'
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      await expect(applyApprovedBudgetMutation(db)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_CHANGED/,
      );

      const durable = await db.query<{
        budget: number;
        venue: string;
        revision: number;
        status: string;
        receipts: number;
        notifications: number;
      }>(`
        SELECT
          journey.total_budget::integer AS budget,
          journey.venue,
          journey.state_revision::integer AS revision,
          execution.status,
          (
            SELECT count(*)::integer
            FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipts,
          (
            SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE event_kind = 'change_applied'
          ) AS notifications
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = '${COUPLE_ID}'
          AND execution.request_key = '${REQUEST_KEY}'
          AND execution.operation_key = '${OPERATION_KEY}'
      `);
      expect(durable.rows[0]).toEqual({
        budget: 50_000_000,
        venue: "external winner",
        revision: 1,
        status: "processing",
        receipts: 0,
        notifications: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects source revision tampering after the immutable execution fence", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db, { journeyRevision: 0 });
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);
      await insertApplicationConfirmation(db, GROOM_ID);
      await insertClaimAndExecution(db, GROOM_ID);
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = jsonb_set(
           metadata,
           '{pending_amora_action_journey_revision}',
           '1'::jsonb
         )
         WHERE id = $1`,
        [PROPOSAL_ID],
      );

      await expect(applyApprovedBudgetMutation(db)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_CHANGED/,
      );
      const durable = await db.query<{
        budget: number;
        revision: number;
        status: string;
        receipts: number;
      }>(`
        SELECT
          journey.total_budget::integer AS budget,
          journey.state_revision::integer AS revision,
          execution.status,
          (
            SELECT count(*)::integer
            FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipts
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = '${COUPLE_ID}'
          AND execution.request_key = '${REQUEST_KEY}'
          AND execution.operation_key = '${OPERATION_KEY}'
      `);
      expect(durable.rows[0]).toEqual({
        budget: 50_000_000,
        revision: 0,
        status: "processing",
        receipts: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects transaction-local revision marker spoofing without durable authority", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await db.query(
        `SELECT
           set_config('hanbang.amora_shared_action_couple_id', $1, false),
           set_config('hanbang.amora_shared_action_request_key', 'spoof', false),
           set_config('hanbang.amora_shared_action_operation_key', $2, false),
           set_config('hanbang.amora_shared_action_action_id', $3, false),
           set_config('hanbang.amora_shared_action_expected_revision', '0', false),
           set_config('hanbang.amora_shared_action_applied_revision', '', false)`,
        [COUPLE_ID, "e".repeat(64), ACTION_ID],
      );

      await expect(db.query(
        `UPDATE public.wedding_journeys
         SET total_budget = 99999999
         WHERE couple_id = $1`,
        [COUPLE_ID],
      )).rejects.toThrow(/AMORA_SHARED_ACTION_PROPOSAL_CHANGED/);

      const journey = await db.query<{
        budget: number;
        revision: number;
      }>(
        `SELECT total_budget::integer AS budget,
                state_revision::integer AS revision
         FROM public.wedding_journeys
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      expect(journey.rows[0]).toEqual({
        budget: 50_000_000,
        revision: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("completes a non-journey shared action only at unchanged revision r", async () => {
    const db = await createDatabase();
    try {
      const input = {
        title: "call the venue",
        due_date: "2099-01-01",
      };
      const identity = getAmoraToolOperationIdentity("add_amora_action", input);
      await insertProposal(db, {
        tool: "add_amora_action",
        input,
        journeyRevision: 0,
      });
      await setPersona(db, "service_role");
      await claimApplication(db, BRIDE_ID);
      await insertApplicationConfirmation(db, BRIDE_ID);
      await insertClaimAndExecution(
        db,
        BRIDE_ID,
        "add_amora_action",
        ACTION_ID,
        identity,
      );
      await applyApprovedMutation(db, {
        toolName: "add_amora_action",
        toolInput: input,
        ...identity,
        domainMutation: {
          kind: "amora_action_insert",
          actionId: "50000000-0000-4000-8000-000000000001",
        },
        toolOutput: {
          action: { id: "50000000-0000-4000-8000-000000000001" },
        },
      });

      const durable = await db.query<{
        revision: number;
        status: string;
        receipts: number;
      }>(`
        SELECT
          journey.state_revision::integer AS revision,
          execution.status,
          (
            SELECT count(*)::integer
            FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipts
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = '${COUPLE_ID}'
          AND execution.request_key = '${REQUEST_KEY}'
          AND execution.operation_key = '${identity.operationKey}'
      `);
      expect(durable.rows[0]).toEqual({
        revision: 0,
        status: "completed",
        receipts: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("withdraws one active vote without deleting it and restores that exact vote on reaccept", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");

      expect(await accept(db, BRIDE_ID)).toMatchObject({
        accepted: true,
        acceptedCount: 1,
        ready: false,
      });
      const firstApproval = await db.query<{
        created_at: string;
        id: string;
      }>(`
        SELECT id::text, created_at::text
        FROM public.couple_change_notifications
        WHERE event_kind = 'approval_requested'
      `);
      expect(firstApproval.rows).toHaveLength(1);
      await db.query(
        `UPDATE public.couple_change_notifications
         SET read_at = clock_timestamp()
         WHERE id = $1`,
        [firstApproval.rows[0].id],
      );

      expect(await revoke(db, BRIDE_ID)).toMatchObject({
        accepted: false,
        acceptedCount: 0,
        ready: false,
      });
      expect(await revoke(db, BRIDE_ID)).toMatchObject({
        accepted: false,
        acceptedCount: 0,
        ready: false,
      });

      const withdrawn = await db.query<{
        accepted_at: string;
        revoked_at: string | null;
        count: number;
      }>(`
        SELECT max(accepted_at)::text AS accepted_at,
               max(revoked_at)::text AS revoked_at,
               count(*)::integer AS count
        FROM public.amora_shared_action_acceptances
        WHERE user_id = $1
      `, [BRIDE_ID]);
      expect(withdrawn.rows[0].count).toBe(1);
      expect(withdrawn.rows[0].revoked_at).not.toBeNull();

      expect(await accept(db, BRIDE_ID)).toMatchObject({
        accepted: true,
        acceptedCount: 1,
        ready: false,
      });
      const resurfacedApproval = await db.query<{
        created_at: string;
        id: string;
        read_at: string | null;
      }>(`
        SELECT id::text, read_at::text, created_at::text
        FROM public.couple_change_notifications
        WHERE event_kind = 'approval_requested'
      `);
      expect(resurfacedApproval.rows).toHaveLength(1);
      expect(resurfacedApproval.rows[0]).toMatchObject({
        id: firstApproval.rows[0].id,
        read_at: null,
      });
      expect(
        new Date(resurfacedApproval.rows[0].created_at).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(firstApproval.rows[0].created_at).getTime(),
      );

      await db.query(
        `UPDATE public.couple_change_notifications
         SET read_at = clock_timestamp()
         WHERE id = $1`,
        [firstApproval.rows[0].id],
      );
      const readBeforeActiveDuplicate = await db.query<{ read_at: string }>(
        `SELECT read_at::text
         FROM public.couple_change_notifications
         WHERE id = $1`,
        [firstApproval.rows[0].id],
      );
      expect(await accept(db, BRIDE_ID)).toMatchObject({
        acceptedCount: 1,
        ready: false,
      });
      const readAfterActiveDuplicate = await db.query<{ read_at: string }>(
        `SELECT read_at::text
         FROM public.couple_change_notifications
         WHERE id = $1`,
        [firstApproval.rows[0].id],
      );
      expect(readAfterActiveDuplicate.rows[0].read_at).toBe(
        readBeforeActiveDuplicate.rows[0].read_at,
      );

      const restored = await db.query<{
        accepted_at: string;
        revoked_at: string | null;
        count: number;
      }>(`
        SELECT max(accepted_at)::text AS accepted_at,
               max(revoked_at)::text AS revoked_at,
               count(*)::integer AS count
        FROM public.amora_shared_action_acceptances
        WHERE user_id = $1
      `, [BRIDE_ID]);
      expect(restored.rows[0]).toMatchObject({ revoked_at: null, count: 1 });
      expect(new Date(restored.rows[0].accepted_at).getTime()).toBeGreaterThan(
        new Date(withdrawn.rows[0].accepted_at).getTime(),
      );

      const events = await db.query<{
        event_kind: string;
        count: number;
        unread: number;
      }>(`
        SELECT event_kind,
               count(*)::integer AS count,
               count(*) FILTER (WHERE read_at IS NULL)::integer AS unread
        FROM public.couple_change_notifications
        GROUP BY event_kind
        ORDER BY event_kind
      `);
      expect(events.rows).toEqual([
        { event_kind: "approval_requested", count: 1, unread: 0 },
        { event_kind: "approval_withdrawn", count: 1, unread: 0 },
      ]);

      const withdrawalCopy = await db.query<{
        href: string;
        message: string;
      }>(`
        SELECT href, message
        FROM public.couple_change_notifications
        WHERE event_kind = 'approval_withdrawn'
      `);
      expect(withdrawalCopy.rows).toEqual([{
        href: "/chat",
        message: "변경 적용 요청 전 공동 확인 한 건이 철회됐어요.",
      }]);
      expect(withdrawalCopy.rows[0].message).not.toContain("generic proposal");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("frees an unbound application lease when an active approval is withdrawn", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      expect((await claimApplication(db, BRIDE_ID)).applicationGranted).toBe(
        true,
      );

      await revoke(db, GROOM_ID);
      const noUnpromptedWithdrawal = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.couple_change_notifications
         WHERE event_kind = 'approval_withdrawn'`,
      );
      expect(noUnpromptedWithdrawal.rows[0].count).toBe(0);
      await accept(db, GROOM_ID);

      expect(await claimApplication(db, GROOM_ID)).toEqual({
        applicationGranted: true,
        retryAfterMs: 0,
      });
      expect((await claimApplication(db, BRIDE_ID)).applicationGranted).toBe(
        false,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("removes a revoked vote from the execution boundary", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await revoke(db, BRIDE_ID);
      await resetPersona(db);
      await insertConfirmation(db, BRIDE_ID);
      await setPersona(db, "service_role");

      await expect(insertClaimAndExecution(db, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_APPROVAL_REQUIRED/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("never lets one partner revoke the other partner's vote", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);

      expect(await revoke(db, GROOM_ID)).toMatchObject({
        accepted: false,
        acceptedCount: 1,
        ready: false,
      });
      expect(await status(db, BRIDE_ID)).toMatchObject({
        accepted: true,
        acceptedCount: 1,
        ready: false,
      });

      const votes = await db.query<{
        bride_active: number;
        groom_rows: number;
      }>(`
        SELECT
          count(*) FILTER (
            WHERE user_id = $1 AND revoked_at IS NULL
          )::integer AS bride_active,
          count(*) FILTER (WHERE user_id = $2)::integer AS groom_rows
        FROM public.amora_shared_action_acceptances
      `, [BRIDE_ID, GROOM_ID]);
      expect(votes.rows[0]).toEqual({ bride_active: 1, groom_rows: 0 });

      const withdrawals = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.couple_change_notifications
        WHERE event_kind = 'approval_withdrawn'
      `);
      expect(withdrawals.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects withdrawal after the exact action completed successfully", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);
      await accept(db, GROOM_ID);
      await claimApplication(db, GROOM_ID);
      await resetPersona(db);
      await insertApplicationConfirmation(db, GROOM_ID);
      await setPersona(db, "service_role");
      await insertClaimAndExecution(db, GROOM_ID);
      await applyApprovedBudgetMutation(db);

      await expect(revoke(db, GROOM_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_ALREADY_APPLIED/,
      );

      const audit = await db.query<{
        active_votes: number;
        withdrawals: number;
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM public.amora_shared_action_acceptances
            WHERE revoked_at IS NULL
          ) AS active_votes,
          (
            SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE event_kind = 'approval_withdrawn'
          ) AS withdrawals
      `);
      expect(audit.rows[0]).toEqual({ active_votes: 2, withdrawals: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("lets a solo member approve once without inventing a partner notification", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        "UPDATE public.couples SET groom_id = NULL WHERE id = $1",
        [COUPLE_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = NULL, role = NULL WHERE id = $1",
        [GROOM_ID],
      );
      await insertProposal(db);
      await setPersona(db, "service_role");

      expect(await accept(db, BRIDE_ID)).toMatchObject({
        accepted: true,
        acceptedCount: 1,
        requiredCount: 1,
        partnerLinked: false,
        ready: true,
      });
      const notifications = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.couple_change_notifications",
      );
      expect(notifications.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("invalidates prior consent when the current roster changes", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await accept(db, BRIDE_ID);

      await db.query(
        "UPDATE public.profiles SET couple_id = NULL, role = NULL WHERE id = $1",
        [GROOM_ID],
      );
      await db.query(
        "UPDATE public.couples SET groom_id = $2 WHERE id = $1",
        [COUPLE_ID, NEW_GROOM_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = $2, role = 'groom' WHERE id = $1",
        [NEW_GROOM_ID, COUPLE_ID],
      );

      await expect(status(db, NEW_GROOM_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_CHANGED/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("binds every vote to the exact immutable proposal digest", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      const first = await accept(db, BRIDE_ID);
      expect(first.proposalDigest).toMatch(/^[a-f0-9]{64}$/);

      await db.query(
        `UPDATE public.chat_messages
         SET metadata = jsonb_set(
           metadata,
           '{pending_amora_action,input,total_budget}',
           '61000000'::jsonb,
           false
         )
         WHERE id = $1`,
        [PROPOSAL_ID],
      );
      await expect(status(db, GROOM_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_PROPOSAL_CHANGED/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects stale, expired, and cross-couple proposals", async () => {
    const staleDb = await createDatabase();
    try {
      await insertProposal(staleDb);
      await staleDb.query(
        `INSERT INTO public.chat_messages(
           id, couple_id, sender_id, sender_type, role, content, visibility,
           metadata, created_at
         ) VALUES (
           '30000000-0000-4000-8000-000000000099', $1, $2, 'bride',
           'user', 'newer canonical context', 'shared', '{}', clock_timestamp() + interval '1 second'
         )`,
        [COUPLE_ID, BRIDE_ID],
      );
      await setPersona(staleDb, "service_role");
      await expect(status(staleDb, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_STALE_CONTEXT/,
      );
    } finally {
      await resetPersona(staleDb).catch(() => undefined);
      await staleDb.close();
    }

    const expiredDb = await createDatabase();
    try {
      const issuedAt = Date.now() - 25 * 60 * 60 * 1_000;
      await insertProposal(expiredDb, { issuedAt });
      await setPersona(expiredDb, "service_role");
      await expect(status(expiredDb, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_EXPIRED/,
      );
    } finally {
      await resetPersona(expiredDb).catch(() => undefined);
      await expiredDb.close();
    }

    const wrongTtlDb = await createDatabase();
    try {
      const issuedAt = Date.now();
      await insertProposal(wrongTtlDb, {
        issuedAt,
        expiresAt: issuedAt + 10 * 60 * 1_000,
      });
      await setPersona(wrongTtlDb, "service_role");
      await expect(status(wrongTtlDb, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_EXPIRED/,
      );
    } finally {
      await resetPersona(wrongTtlDb).catch(() => undefined);
      await wrongTtlDb.close();
    }

    const crossCoupleDb = await createDatabase();
    try {
      await insertProposal(crossCoupleDb);
      await setPersona(crossCoupleDb, "service_role");
      await expect(crossCoupleDb.query(
        "SELECT public.get_amora_shared_action_status($1, $2, $3, $4)",
        [ACTION_ID, OTHER_COUPLE_ID, PROPOSAL_ID, OUTSIDER_ID],
      )).rejects.toThrow(/AMORA_SHARED_ACTION_PROPOSAL_INVALID/);
    } finally {
      await resetPersona(crossCoupleDb).catch(() => undefined);
      await crossCoupleDb.close();
    }
  }, 30_000);

  it("authorizes domain execution only after the exact current roster has accepted", async () => {
    const partialDb = await createDatabase();
    try {
      await insertProposal(partialDb);
      await setPersona(partialDb, "service_role");
      await accept(partialDb, BRIDE_ID);
      await resetPersona(partialDb);
      await insertConfirmation(partialDb, BRIDE_ID);
      await setPersona(partialDb, "service_role");

      await expect(partialDb.query(
        "SELECT public.authorize_amora_shared_action_execution($1, $2, $3, $4, $5)",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, CONFIRMATION_ID, BRIDE_ID],
      )).rejects.toThrow(/AMORA_SHARED_ACTION_APPROVAL_REQUIRED/);
    } finally {
      await resetPersona(partialDb).catch(() => undefined);
      await partialDb.close();
    }

    const readyDb = await createDatabase();
    try {
      await insertProposal(readyDb);
      await setPersona(readyDb, "service_role");
      await accept(readyDb, BRIDE_ID);
      await accept(readyDb, GROOM_ID);
      await claimApplication(readyDb, GROOM_ID);
      await resetPersona(readyDb);
      await insertApplicationConfirmation(readyDb, GROOM_ID);
      await setPersona(readyDb, "service_role");

      await expect(revoke(readyDb, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_STALE_CONTEXT/,
      );
      const postConfirmationWithdrawals = await readyDb.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.couple_change_notifications
        WHERE event_kind = 'approval_withdrawn'
      `);
      expect(postConfirmationWithdrawals.rows[0].count).toBe(0);

      const authorized = await readyDb.query<{
        result: { authorized: boolean; approvalMode: string };
      }>(
        "SELECT public.authorize_amora_shared_action_execution($1, $2, $3, $4, $5) AS result",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, CONFIRMATION_ID, GROOM_ID],
      );
      expect(authorized.rows[0].result).toMatchObject({
        authorized: true,
        approvalMode: "couple",
      });

      await resetPersona(readyDb);
      await readyDb.query(
        `INSERT INTO public.chat_messages(
           id, couple_id, sender_id, sender_type, role, content, metadata,
           visibility, created_at
         ) VALUES (
           '30000000-0000-4000-8000-000000000003', $1, $2, 'bride',
           'user', 'newer context', '{}', 'shared',
           clock_timestamp() + interval '2 seconds'
         )`,
        [COUPLE_ID, BRIDE_ID],
      );
      await setPersona(readyDb, "service_role");
      await expect(readyDb.query(
        "SELECT public.authorize_amora_shared_action_execution($1, $2, $3, $4, $5)",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, CONFIRMATION_ID, GROOM_ID],
      )).rejects.toThrow(/AMORA_SHARED_ACTION_STALE_CONTEXT/);
    } finally {
      await resetPersona(readyDb).catch(() => undefined);
      await readyDb.close();
    }
  });

  it("blocks the execution ledger before a 2/2 approval and binds the exact action tool", async () => {
    const partialDb = await createDatabase();
    try {
      await insertProposal(partialDb);
      await setPersona(partialDb, "service_role");
      await accept(partialDb, BRIDE_ID);
      await resetPersona(partialDb);
      await insertConfirmation(partialDb, BRIDE_ID);
      await setPersona(partialDb, "service_role");

      await expect(insertClaimAndExecution(partialDb, BRIDE_ID)).rejects.toThrow(
        /AMORA_SHARED_ACTION_APPROVAL_REQUIRED/,
      );
    } finally {
      await resetPersona(partialDb).catch(() => undefined);
      await partialDb.close();
    }

    const wrongToolDb = await createDatabase();
    try {
      await insertProposal(wrongToolDb);
      await setPersona(wrongToolDb, "service_role");
      await accept(wrongToolDb, BRIDE_ID);
      await accept(wrongToolDb, GROOM_ID);
      await claimApplication(wrongToolDb, GROOM_ID);
      await resetPersona(wrongToolDb);
      await insertApplicationConfirmation(wrongToolDb, GROOM_ID);
      await setPersona(wrongToolDb, "service_role");

      await expect(
        insertClaimAndExecution(wrongToolDb, GROOM_ID, "update_venue"),
      ).rejects.toThrow(/AMORA_SHARED_ACTION_EXECUTION_MISMATCH/);
    } finally {
      await resetPersona(wrongToolDb).catch(() => undefined);
      await wrongToolDb.close();
    }

    const wrongInputDb = await createDatabase();
    try {
      await insertProposal(wrongInputDb);
      await setPersona(wrongInputDb, "service_role");
      await accept(wrongInputDb, BRIDE_ID);
      await accept(wrongInputDb, GROOM_ID);
      await claimApplication(wrongInputDb, GROOM_ID);
      await resetPersona(wrongInputDb);
      await insertApplicationConfirmation(wrongInputDb, GROOM_ID);
      await setPersona(wrongInputDb, "service_role");

      await expect(insertClaimAndExecution(
        wrongInputDb,
        GROOM_ID,
        "update_budget",
        ACTION_ID,
        {
          inputDigest: "c".repeat(64),
          operationKey: OPERATION_KEY,
        },
      )).rejects.toThrow(/AMORA_SHARED_ACTION_EXECUTION_MISMATCH/);

      await expect(wrongInputDb.query(
        `INSERT INTO public.amora_tool_executions(
           couple_id, request_key, operation_key, tool_name, input_digest,
           status, pending_action_id
         ) VALUES ($1, $2, $3, 'update_budget', $4, 'processing', $5)`,
        [
          COUPLE_ID,
          REQUEST_KEY,
          "d".repeat(64),
          INPUT_DIGEST,
          ACTION_ID,
        ],
      )).rejects.toThrow(/AMORA_SHARED_ACTION_EXECUTION_MISMATCH/);
    } finally {
      await resetPersona(wrongInputDb).catch(() => undefined);
      await wrongInputDb.close();
    }
  }, 30_000);

  it("emits exactly one partner change event only for a successful completion", async () => {
    const successDb = await createDatabase();
    try {
      await insertProposal(successDb);
      await setPersona(successDb, "service_role");
      await accept(successDb, BRIDE_ID);
      await revoke(successDb, BRIDE_ID);
      await accept(successDb, BRIDE_ID);
      await accept(successDb, GROOM_ID);
      await claimApplication(successDb, GROOM_ID);
      await resetPersona(successDb);
      await insertApplicationConfirmation(successDb, GROOM_ID);
      await setPersona(successDb, "service_role");
      await insertClaimAndExecution(successDb, GROOM_ID);

      await applyApprovedBudgetMutation(successDb);
      await successDb.query(
        `UPDATE public.amora_tool_executions
         SET result = result
         WHERE couple_id = $1 AND request_key = $2 AND operation_key = $3`,
        [COUPLE_ID, REQUEST_KEY, OPERATION_KEY],
      );

      const applied = await successDb.query<{
        recipient_user_id: string;
        actor_user_id: string;
        count: number;
      }>(`
        SELECT recipient_user_id::text, actor_user_id::text,
               count(*)::integer AS count
        FROM public.couple_change_notifications
        WHERE event_kind = 'change_applied'
        GROUP BY recipient_user_id, actor_user_id
      `);
      expect(applied.rows).toEqual([{
        recipient_user_id: BRIDE_ID,
        actor_user_id: GROOM_ID,
        count: 1,
      }]);

      const lifecycle = await successDb.query<{
        event_kind: string;
        count: number;
        unread: number;
      }>(`
        SELECT event_kind,
               count(*)::integer AS count,
               count(*) FILTER (WHERE read_at IS NULL)::integer AS unread
        FROM public.couple_change_notifications
        GROUP BY event_kind
        ORDER BY event_kind
      `);
      expect(lifecycle.rows).toEqual([
        { event_kind: "approval_requested", count: 1, unread: 0 },
        { event_kind: "approval_withdrawn", count: 1, unread: 0 },
        { event_kind: "change_applied", count: 1, unread: 1 },
      ]);
    } finally {
      await resetPersona(successDb).catch(() => undefined);
      await successDb.close();
    }

    const failedDb = await createDatabase();
    try {
      await insertProposal(failedDb);
      await setPersona(failedDb, "service_role");
      await accept(failedDb, BRIDE_ID);
      await accept(failedDb, GROOM_ID);
      await claimApplication(failedDb, GROOM_ID);
      await resetPersona(failedDb);
      await insertApplicationConfirmation(failedDb, GROOM_ID);
      await setPersona(failedDb, "service_role");
      await insertClaimAndExecution(failedDb, GROOM_ID);
      await failedDb.query(
        `UPDATE public.amora_tool_executions
         SET status = 'completed',
             result = '{"toolName":"update_budget","toolOutput":{},"success":false,"displayMessage":"no-op"}'
         WHERE couple_id = $1 AND request_key = $2 AND operation_key = $3`,
        [COUPLE_ID, REQUEST_KEY, OPERATION_KEY],
      );
      const applied = await failedDb.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.couple_change_notifications
         WHERE event_kind = 'change_applied'`,
      );
      expect(applied.rows[0].count).toBe(0);
    } finally {
      await resetPersona(failedDb).catch(() => undefined);
      await failedDb.close();
    }
  });

  it("keeps notifications recipient-only while allowing durable read receipts", async () => {
    const db = await createDatabase();
    try {
      await insertProposal(db);
      await setPersona(db, "service_role");
      await db.query(
        `INSERT INTO public.couple_change_notifications(
           couple_id, recipient_user_id, actor_user_id, source_message_id,
           action_id, event_kind, tool_name, title, message, href
         ) VALUES (
           $1, $2, $3, $4, $5, 'change_applied', 'update_budget',
           'generic title', 'generic message', '/budget'
         )`,
        [COUPLE_ID, BRIDE_ID, GROOM_ID, PROPOSAL_ID, ACTION_ID],
      );

      await resetPersona(db);
      await setPersona(db, "authenticated", BRIDE_ID);
      const own = await db.query<{ id: string; read_at: string | null }>(
        "SELECT id::text, read_at::text FROM public.couple_change_notifications",
      );
      expect(own.rows).toHaveLength(1);
      const notificationId = own.rows[0].id;

      await db.query(
        `UPDATE public.couple_change_notifications
         SET read_at = clock_timestamp()
         WHERE id = $1`,
        [notificationId],
      );
      await expect(db.query(
        `UPDATE public.couple_change_notifications
         SET title = 'tampered'
         WHERE id = $1`,
        [notificationId],
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        `INSERT INTO public.couple_change_notifications(
           couple_id, recipient_user_id, actor_user_id, source_message_id,
           action_id, event_kind, tool_name, title, message, href
         ) VALUES ($1, $2, $3, $4, $5, 'change_applied', 'update_budget', 'x', 'x', '/budget')`,
        [COUPLE_ID, BRIDE_ID, GROOM_ID, PROPOSAL_ID, ACTION_ID],
      )).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      const outsider = await db.query(
        "SELECT id FROM public.couple_change_notifications",
      );
      expect(outsider.rows).toHaveLength(0);

      await resetPersona(db);
      await setPersona(db, "service_role");
      const persisted = await db.query<{ read_at: string | null }>(
        "SELECT read_at::text FROM public.couple_change_notifications WHERE id = $1",
        [notificationId],
      );
      expect(persisted.rows[0].read_at).not.toBeNull();
      await expect(db.query(
        `SELECT public.apply_amora_atomic_tool_execution_pre_shared_revision(
           $1, 'private-bypass', $2, 1, $3,
           '{}'::jsonb, '{"kind":"none"}'::jsonb, '{}'::jsonb
         )`,
        [COUPLE_ID, OPERATION_KEY, INPUT_DIGEST],
      )).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(
        "SELECT public.accept_amora_shared_action($1, $2, $3, $4)",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, BRIDE_ID],
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "SELECT public.revoke_amora_shared_action_acceptance($1, $2, $3, $4)",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, BRIDE_ID],
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "SELECT public.claim_amora_shared_action_application($1, $2, $3, $4)",
        [ACTION_ID, COUPLE_ID, PROPOSAL_ID, BRIDE_ID],
      )).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("notifies the partner after a one-person routine change succeeds", async () => {
    const db = await createDatabase();
    try {
      const routineInput = {
        date: "2099-01-01",
        title: "venue visit",
      };
      const routineIdentity = getAmoraToolOperationIdentity(
        "add_schedule_event",
        routineInput,
      );
      await insertProposal(db, {
        tool: "add_schedule_event",
        input: routineInput,
      });
      await setPersona(db, "service_role");
      expect(await status(db, BRIDE_ID)).toMatchObject({
        approvalMode: "single",
        accepted: false,
        acceptedCount: 0,
        requiredCount: 2,
        partnerLinked: true,
        ready: true,
      });
      await claimApplication(db, BRIDE_ID);
      await resetPersona(db);
      await insertApplicationConfirmation(db, BRIDE_ID);
      await setPersona(db, "service_role");
      await insertClaimAndExecution(
        db,
        BRIDE_ID,
        "add_schedule_event",
        ACTION_ID,
        routineIdentity,
      );
      await applyApprovedMutation(db, {
        toolName: "add_schedule_event",
        toolInput: routineInput,
        ...routineIdentity,
        domainMutation: {
          kind: "journey_progress_key_cas",
          key: "__events",
          expectedPresent: false,
          value: [{ id: "x", ...routineInput }],
        },
        toolOutput: { event: { id: "x" } },
      });

      const applied = await db.query<{
        recipient_user_id: string;
        actor_user_id: string;
        tool_name: string;
        event_kind: string;
        read_at: string | null;
      }>(`
        SELECT recipient_user_id::text, actor_user_id::text, tool_name,
               event_kind, read_at::text
        FROM public.couple_change_notifications
      `);
      expect(applied.rows).toEqual([{
        recipient_user_id: GROOM_ID,
        actor_user_id: BRIDE_ID,
        tool_name: "add_schedule_event",
        event_kind: "change_applied",
        read_at: null,
      }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
