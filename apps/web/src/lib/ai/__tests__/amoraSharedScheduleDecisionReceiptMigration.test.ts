// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

const sharedActionMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260730102000_amora_shared_action_approval_and_notifications.sql",
  ),
  "utf8",
);
const scheduleDecisionMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802100000_amora_shared_schedule_decision_receipts.sql",
  ),
  "utf8",
);

/**
 * 옮기기 카드가 "무엇을 어디서" 옮기는지 말할 수 있게 트리거의 입력 키 화이트리스트를
 * 넓힌 마이그레이션. **이 줄이 없으면 이 파일은 옛 트리거를 검사한다** — 도구 스키마만
 * 고치고 운영에서 22023 으로 죽는 상태를 초록불로 통과시킨다.
 */
const moveCardMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260827090000_move_card_can_name_what_it_moves.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const PROPOSAL_ID = "30000000-0000-4000-8000-000000000001";
const CONFIRMATION_ID = "30000000-0000-4000-8000-000000000002";
const ACTION_ID = "40000000-0000-4000-8000-000000000001";
const REQUEST_KEY = "chat:test:schedule-decision";

type ScheduleEvent = {
  id: string;
  date: string;
  time?: string;
  title: string;
  memo?: string;
  categoryKey?: string;
  sourceKey?: string;
  status?: "planned" | "completed";
  createdAt: string;
  updatedAt: string;
};

const EVENT_ONE: ScheduleEvent = {
  id: "evt_first",
  date: "2099-01-15",
  time: "14:30",
  title: "venue visit",
  categoryKey: "venue",
  sourceKey: "category:venue",
  status: "planned",
  createdAt: "2098-12-01T00:00:00.000Z",
  updatedAt: "2098-12-01T00:00:00.000Z",
};

const EVENT_TWO: ScheduleEvent = {
  id: "evt_second",
  date: "2099-02-20",
  time: "10:00",
  title: "dress fitting",
  categoryKey: "dress",
  sourceKey: "category:dress",
  status: "planned",
  createdAt: "2098-12-02T00:00:00.000Z",
  updatedAt: "2098-12-02T00:00:00.000Z",
};

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
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
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      category text,
      decision_type text CHECK (
        decision_type IN (
          'exploring', 'considering', 'decided', 'scheduled',
          'booked', 'completed'
        )
      ),
      title text,
      chosen_value jsonb,
      options_considered jsonb DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric(3,2) DEFAULT 0.50,
      stage_tag text,
      decided_at timestamptz,
      source text CHECK (
        source IN (
          'chat', 'manual', 'import', 'vendor_booking', 'schedule',
          'budget', 'onboarding', 'community'
        )
      ),
      source_ref_id uuid,
      source_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
      source_actor_role text CHECK (
        source_actor_role IS NULL OR source_actor_role IN ('bride', 'groom')
      ),
      memory_key text,
      superseded_at timestamptz,
      superseded_by uuid REFERENCES public.decision_nodes(id) ON DELETE SET NULL,
      user_confirmed_at timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared' CHECK (
        visibility IN ('shared', 'bride_private', 'groom_private')
      ),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
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
    CREATE FUNCTION public.is_current_couple_member(
      p_user_id uuid,
      p_couple_id uuid
    )
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
    DECLARE
      v_completed_result jsonb;
    BEGIN
      SELECT execution.result
        INTO v_completed_result
      FROM public.amora_tool_executions AS execution
      WHERE execution.couple_id = p_couple_id
        AND execution.request_key = p_request_key
        AND execution.operation_key = p_operation_key
        AND execution.input_digest = p_input_digest
        AND execution.status = 'completed';
      IF FOUND THEN
        RETURN v_completed_result;
      END IF;

      IF p_domain_mutation ->> 'kind' = 'journey_progress_key_cas' THEN
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
      SET status = 'completed', result = p_result
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
    ALTER TABLE public.decision_nodes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY decision_nodes_select_with_privacy ON public.decision_nodes
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
    GRANT SELECT ON public.decision_nodes TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${OTHER_COUPLE_ID}', 'bride');
    INSERT INTO public.wedding_journeys(couple_id) VALUES
      ('${COUPLE_ID}'), ('${OTHER_COUPLE_ID}');
  `);
  await db.exec(sharedActionMigrationSql);
  await db.exec(scheduleDecisionMigrationSql);
  await db.exec(moveCardMigrationSql);
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

async function seedScheduleEvents(db: PGlite, events: ScheduleEvent[]) {
  await setPersona(db, "service_role");
  const seeded = await db.query<{ state_revision: number }>(
    `UPDATE public.wedding_journeys
        SET progress = jsonb_build_object('__events', $1::jsonb)
      WHERE couple_id = $2
      RETURNING state_revision::integer`,
    [JSON.stringify(events), COUPLE_ID],
  );
  return seeded.rows[0].state_revision;
}

async function prepareApprovedScheduleAction(
  db: PGlite,
  options: {
    toolName: "add_schedule_event" | "update_schedule_event";
    toolInput: Record<string, unknown>;
    actionId?: string;
    proposalId?: string;
    confirmationId?: string;
    requestKey?: string;
    journeyRevision?: number;
  },
) {
  const actionId = options.actionId ?? ACTION_ID;
  const proposalId = options.proposalId ?? PROPOSAL_ID;
  const confirmationId = options.confirmationId ?? CONFIRMATION_ID;
  const requestKey = options.requestKey ?? REQUEST_KEY;
  const identity = getAmoraToolOperationIdentity(
    options.toolName,
    options.toolInput,
  );
  const issuedAt = Date.now();
  const action = {
    version: 2,
    actionId,
    tool: options.toolName,
    input: options.toolInput,
    inputDigest: identity.inputDigest,
    operationKey: identity.operationKey,
    confirmation: "Apply this exact schedule change?",
    issuedAt,
    expiresAt: issuedAt + 10 * 60 * 1_000,
  };

  await setPersona(db, "service_role");
  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, NULL, 'ai', 'assistant', 'schedule proposal',
       jsonb_build_object(
         'pending_amora_action', $3::jsonb,
         'pending_amora_action_journey_revision', $4::bigint
       ),
       'shared', clock_timestamp()
     )`,
    [
      proposalId,
      COUPLE_ID,
      JSON.stringify(action),
      options.journeyRevision ?? 0,
    ],
  );
  const application = await db.query<{ result: { applicationGranted: boolean } }>(
    "SELECT public.claim_amora_shared_action_application($1, $2, $3, $4) AS result",
    [actionId, COUPLE_ID, proposalId, BRIDE_ID],
  );
  expect(application.rows[0].result.applicationGranted).toBe(true);

  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, $3, 'bride', 'user', 'apply exact schedule change',
       jsonb_build_object('confirmed_amora_action_id', $4::text),
       'shared', clock_timestamp() + interval '1 second'
     )`,
    [confirmationId, COUPLE_ID, BRIDE_ID, actionId],
  );
  await db.query(
    `INSERT INTO public.amora_chat_request_claims(
       couple_id, request_key, user_id, visibility, status, user_message_id
     ) VALUES ($1, $2, $3, 'shared', 'processing', $4)`,
    [COUPLE_ID, requestKey, BRIDE_ID, confirmationId],
  );
  await db.query(
    `INSERT INTO public.amora_tool_executions(
       couple_id, request_key, operation_key, tool_name, input_digest,
       status, pending_action_id, pending_action_journey_revision
     ) VALUES ($1, $2, $3, $4, $5, 'processing', $6, 777)`,
    [
      COUPLE_ID,
      requestKey,
      identity.operationKey,
      options.toolName,
      identity.inputDigest,
      actionId,
    ],
  );

  return {
    actionId,
    proposalId,
    confirmationId,
    requestKey,
    ...identity,
  };
}

async function applyScheduleMutation(
  db: PGlite,
  options: {
    toolName: "add_schedule_event" | "update_schedule_event";
    toolInput: Record<string, unknown>;
    identity: { operationKey: string; inputDigest: string };
    requestKey?: string;
    expectedPresent: boolean;
    expected?: ScheduleEvent[];
    value: ScheduleEvent[];
    event: ScheduleEvent;
    previousEvent?: ScheduleEvent;
    updates?: Record<string, unknown>;
  },
) {
  const domainMutation = {
    kind: "journey_progress_key_cas",
    key: "__events",
    expectedPresent: options.expectedPresent,
    ...(options.expectedPresent ? { expected: options.expected } : {}),
    value: options.value,
  };
  const result = {
    toolName: options.toolName,
    toolOutput: {
      event: options.event,
      ...(options.previousEvent
        ? { previous_event: options.previousEvent }
        : {}),
      ...(options.updates ? { updates: options.updates } : {}),
    },
    success: true,
    displayMessage: "schedule applied",
  };
  return db.query<{ result: typeof result }>(
    `SELECT public.apply_amora_atomic_tool_execution(
       $1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb
     ) AS result`,
    [
      COUPLE_ID,
      options.requestKey ?? REQUEST_KEY,
      options.identity.operationKey,
      options.identity.inputDigest,
      JSON.stringify(options.toolInput),
      JSON.stringify(domainMutation),
      JSON.stringify(result),
    ],
  );
}

describe("Amora shared schedule decision receipts", () => {
  it("keeps the follow-up migration transactional and trigger functions private", () => {
    const normalized = scheduleDecisionMigrationSql.trim();
    expect(normalized).toMatch(/^BEGIN;/);
    expect(normalized).toMatch(/COMMIT;$/);
    expect(normalized).toContain(
      "CREATE TRIGGER trg_capture_amora_shared_schedule_delta",
    );
    expect(normalized).toContain(
      "CREATE TRIGGER trg_record_amora_shared_schedule_decision",
    );
    expect(normalized).toContain("schedule_scope");
    expect(normalized).toContain(
      "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
    );
    expect(normalized).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.amora_shared_action_policy/,
    );
    expect(normalized).toMatch(
      /REVOKE ALL ON FUNCTION public\.capture_amora_shared_schedule_delta\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(normalized).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_amora_shared_schedule_decision\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });

  it("atomically records an approved schedule add as state, receipt, and decision", async () => {
    const db = await createDatabase();
    try {
      const toolInput = {
        date: EVENT_ONE.date,
        time: EVENT_ONE.time,
        title: EVENT_ONE.title,
        category_key: EVENT_ONE.categoryKey,
        schedule_scope: "confirmed_fact",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "add_schedule_event",
        toolInput,
      });

      await applyScheduleMutation(db, {
        toolName: "add_schedule_event",
        toolInput,
        identity,
        expectedPresent: false,
        value: [EVENT_ONE],
        event: EVENT_ONE,
      });

      const state = await db.query<{
        state_revision: number;
        events: ScheduleEvent[];
        execution_status: string;
        mutation_kind: string;
        schedule_scope: string;
        schedule_event_id: string;
        before_event: ScheduleEvent | null;
        after_event: ScheduleEvent;
        decision_node_id: string;
        decision_count: number;
      }>(`
        SELECT
          journey.state_revision::integer,
          journey.progress -> '__events' AS events,
          execution.status AS execution_status,
          receipt.mutation_kind,
          receipt.schedule_scope,
          receipt.schedule_event_id,
          receipt.before_event,
          receipt.after_event,
          receipt.decision_node_id::text,
          (SELECT count(*)::integer
             FROM public.decision_nodes AS decision
            WHERE decision.id = receipt.decision_node_id
              AND decision.couple_id = journey.couple_id
              AND decision.source = 'schedule'
              AND decision.decision_type = 'scheduled'
              AND decision.visibility = 'shared'
              AND decision.source_ref_id = '${ACTION_ID}'::uuid
              AND decision.source_message_id = '${CONFIRMATION_ID}'::uuid
              AND decision.source_actor_role = 'bride'
              AND decision.chosen_value ->> 'operation' = 'add'
              AND decision.chosen_value ->> 'eventId' = '${EVENT_ONE.id}'
          ) AS decision_count
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        JOIN public.amora_shared_action_journey_mutation_receipts AS receipt
          ON receipt.couple_id = execution.couple_id
         AND receipt.request_key = execution.request_key
         AND receipt.operation_key = execution.operation_key
        WHERE journey.couple_id = '${COUPLE_ID}'::uuid
      `);

      expect(state.rows[0]).toMatchObject({
        state_revision: 1,
        events: [EVENT_ONE],
        execution_status: "completed",
        mutation_kind: "add",
        schedule_scope: "confirmed_fact",
        schedule_event_id: EVENT_ONE.id,
        before_event: null,
        after_event: EVENT_ONE,
        decision_node_id: expect.any(String),
        decision_count: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  /**
   * 옮기기 카드가 "무엇을 어디서" 옮기는지 말하려면 `expected_title`·`expected_date`
   * 가 카드 입력에 실려야 한다(형제 도구 cancel·restore 는 이미 그렇고, 카드가
   * 그것을 "대상 일정"·"현재 날짜" 로 찍는다).
   *
   * **그런데 도구 스키마만 고치면 운영에서 조용히 죽는다.** 이 트리거가 승인된
   * 입력 키를 정확히 6개로 잠그고 있어서 선언 안 된 키가 하나라도 있으면
   * `AMORA_SHARED_SCHEDULE_UPDATE_DELTA_INVALID`(22023) 로 적용 전체가 롤백된다.
   * 아래 두 검사가 그 관문이 실제로 열렸는지, 그리고 여전히 닫혀 있어야 할 것은
   * 닫혀 있는지를 함께 본다.
   */
  it("옮기기 카드가 대상 일정·현재 날짜를 실어도 적용된다", async () => {
    const db = await createDatabase();
    try {
      const revision = await seedScheduleEvents(db, [EVENT_ONE]);
      const updatedEvent: ScheduleEvent = {
        ...EVENT_ONE,
        date: "2027-09-05",
        updatedAt: "2027-01-02T00:00:00.000Z",
      };
      const updates = { date: updatedEvent.date };
      const toolInput = {
        event_id: EVENT_ONE.id,
        ...updates,
        // 이 둘이 이 검사의 전부다.
        expected_title: EVENT_ONE.title,
        expected_date: EVENT_ONE.date,
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "update_schedule_event",
        toolInput,
        journeyRevision: revision,
      });

      await applyScheduleMutation(db, {
        toolName: "update_schedule_event",
        toolInput,
        identity,
        expectedPresent: true,
        expected: [EVENT_ONE],
        value: [updatedEvent],
        event: updatedEvent,
        previousEvent: EVENT_ONE,
        updates,
      });

      const state = await db.query<{ mutation_kind: string; after_event: ScheduleEvent }>(`
        SELECT receipt.mutation_kind, receipt.after_event
        FROM public.amora_shared_action_journey_mutation_receipts AS receipt
        WHERE receipt.couple_id = '${COUPLE_ID}'::uuid
      `);
      expect(state.rows[0]).toMatchObject({
        mutation_kind: "update",
        after_event: updatedEvent,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("측정기가 살아 있다 — 선언 안 된 키는 여전히 거절된다", async () => {
    const db = await createDatabase();
    try {
      const revision = await seedScheduleEvents(db, [EVENT_ONE]);
      const updatedEvent: ScheduleEvent = {
        ...EVENT_ONE,
        date: "2027-09-05",
        updatedAt: "2027-01-02T00:00:00.000Z",
      };
      const updates = { date: updatedEvent.date };
      const toolInput = {
        event_id: EVENT_ONE.id,
        ...updates,
        // 화이트리스트를 넓혔다고 아무 키나 통과하면 안 된다.
        vendor_name: "소네 스튜디오",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "update_schedule_event",
        toolInput,
        journeyRevision: revision,
      });

      await expect(
        applyScheduleMutation(db, {
          toolName: "update_schedule_event",
          toolInput,
          identity,
          expectedPresent: true,
          expected: [EVENT_ONE],
          value: [updatedEvent],
          event: updatedEvent,
          previousEvent: EVENT_ONE,
          updates,
        }),
      ).rejects.toThrow(/AMORA_SHARED_SCHEDULE_UPDATE_DELTA_INVALID/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("records the exact before and after event for an approved update", async () => {
    const db = await createDatabase();
    try {
      const revision = await seedScheduleEvents(db, [EVENT_ONE]);
      const updatedEvent: ScheduleEvent = {
        ...EVENT_ONE,
        date: "2099-01-22",
        time: "15:45",
        title: "venue contract review",
        updatedAt: "2098-12-03T00:00:00.000Z",
      };
      const updates = {
        date: updatedEvent.date,
        time: updatedEvent.time,
        title: updatedEvent.title,
      };
      const toolInput = {
        event_id: EVENT_ONE.id,
        ...updates,
        schedule_scope: "shared_commitment",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "update_schedule_event",
        toolInput,
        journeyRevision: revision,
      });

      await applyScheduleMutation(db, {
        toolName: "update_schedule_event",
        toolInput,
        identity,
        expectedPresent: true,
        expected: [EVENT_ONE],
        value: [updatedEvent],
        event: updatedEvent,
        previousEvent: EVENT_ONE,
        updates,
      });

      const state = await db.query<{
        state_revision: number;
        events: ScheduleEvent[];
        mutation_kind: string;
        schedule_scope: string;
        before_event: ScheduleEvent;
        after_event: ScheduleEvent;
        operation: string;
        chosen_scope: string;
        chosen_before: ScheduleEvent;
        chosen_after: ScheduleEvent;
      }>(`
        SELECT
          journey.state_revision::integer,
          journey.progress -> '__events' AS events,
          receipt.mutation_kind,
          receipt.schedule_scope,
          receipt.before_event,
          receipt.after_event,
          decision.chosen_value ->> 'operation' AS operation,
          decision.chosen_value ->> 'scheduleScope' AS chosen_scope,
          decision.chosen_value -> 'before' AS chosen_before,
          decision.chosen_value -> 'after' AS chosen_after
        FROM public.wedding_journeys AS journey
        JOIN public.amora_shared_action_journey_mutation_receipts AS receipt
          ON receipt.couple_id = journey.couple_id
        JOIN public.decision_nodes AS decision
          ON decision.id = receipt.decision_node_id
        WHERE journey.couple_id = '${COUPLE_ID}'::uuid
      `);

      expect(state.rows[0]).toEqual({
        state_revision: revision + 1,
        events: [updatedEvent],
        mutation_kind: "update",
        schedule_scope: "shared_commitment",
        before_event: EVENT_ONE,
        after_event: updatedEvent,
        operation: "update",
        chosen_scope: "shared_commitment",
        chosen_before: EVENT_ONE,
        chosen_after: updatedEvent,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects an add that replaces existing events and rolls every write back", async () => {
    const db = await createDatabase();
    try {
      const revision = await seedScheduleEvents(db, [EVENT_ONE]);
      const toolInput = {
        date: EVENT_TWO.date,
        time: EVENT_TWO.time,
        title: EVENT_TWO.title,
        category_key: EVENT_TWO.categoryKey,
        schedule_scope: "confirmed_fact",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "add_schedule_event",
        toolInput,
        journeyRevision: revision,
      });

      await expect(
        applyScheduleMutation(db, {
          toolName: "add_schedule_event",
          toolInput,
          identity,
          expectedPresent: true,
          expected: [EVENT_ONE],
          value: [EVENT_TWO],
          event: EVENT_TWO,
        }),
      ).rejects.toThrow("AMORA_SHARED_SCHEDULE_ADD_DELTA_INVALID");

      const rolledBack = await db.query<{
        state_revision: number;
        events: ScheduleEvent[];
        execution_status: string;
        receipt_count: number;
        decision_count: number;
      }>(`
        SELECT
          journey.state_revision::integer,
          journey.progress -> '__events' AS events,
          execution.status AS execution_status,
          (SELECT count(*)::integer
             FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipt_count,
          (SELECT count(*)::integer FROM public.decision_nodes)
            AS decision_count
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = '${COUPLE_ID}'::uuid
      `);
      expect(rolledBack.rows[0]).toEqual({
        state_revision: revision,
        events: [EVENT_ONE],
        execution_status: "processing",
        receipt_count: 0,
        decision_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects an update that changes more than the one approved event", async () => {
    const db = await createDatabase();
    try {
      const revision = await seedScheduleEvents(db, [EVENT_ONE, EVENT_TWO]);
      const updatedEvent: ScheduleEvent = {
        ...EVENT_ONE,
        title: "venue contract review",
        updatedAt: "2098-12-03T00:00:00.000Z",
      };
      const tamperedSecondEvent: ScheduleEvent = {
        ...EVENT_TWO,
        title: "unapproved dress replacement",
        updatedAt: "2098-12-03T00:00:00.000Z",
      };
      const updates = { title: updatedEvent.title };
      const toolInput = {
        event_id: EVENT_ONE.id,
        ...updates,
        schedule_scope: "shared_commitment",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "update_schedule_event",
        toolInput,
        journeyRevision: revision,
      });

      await expect(
        applyScheduleMutation(db, {
          toolName: "update_schedule_event",
          toolInput,
          identity,
          expectedPresent: true,
          expected: [EVENT_ONE, EVENT_TWO],
          value: [updatedEvent, tamperedSecondEvent],
          event: updatedEvent,
          previousEvent: EVENT_ONE,
          updates,
        }),
      ).rejects.toThrow("AMORA_SHARED_SCHEDULE_UPDATE_DELTA_INVALID");

      const rolledBack = await db.query<{
        state_revision: number;
        events: ScheduleEvent[];
        receipt_count: number;
        decision_count: number;
      }>(`
        SELECT
          journey.state_revision::integer,
          journey.progress -> '__events' AS events,
          (SELECT count(*)::integer
             FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipt_count,
          (SELECT count(*)::integer FROM public.decision_nodes)
            AS decision_count
        FROM public.wedding_journeys AS journey
        WHERE journey.couple_id = '${COUPLE_ID}'::uuid
      `);
      expect(rolledBack.rows[0]).toEqual({
        state_revision: revision,
        events: [EVENT_ONE, EVENT_TWO],
        receipt_count: 0,
        decision_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a non-HH:mm event time at the database boundary", async () => {
    const db = await createDatabase();
    try {
      const invalidTimeEvent: ScheduleEvent = {
        ...EVENT_ONE,
        time: "24:00",
      };
      const toolInput = {
        date: invalidTimeEvent.date,
        time: invalidTimeEvent.time,
        title: invalidTimeEvent.title,
        category_key: invalidTimeEvent.categoryKey,
        schedule_scope: "confirmed_fact",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "add_schedule_event",
        toolInput,
      });

      await expect(
        applyScheduleMutation(db, {
          toolName: "add_schedule_event",
          toolInput,
          identity,
          expectedPresent: false,
          value: [invalidTimeEvent],
          event: invalidTimeEvent,
        }),
      ).rejects.toThrow("AMORA_SHARED_SCHEDULE_ADD_DELTA_INVALID");

      const rolledBack = await db.query<{
        revision: number;
        has_events: boolean;
        receipts: number;
        decisions: number;
      }>(`
        SELECT
          state_revision::integer AS revision,
          progress ? '__events' AS has_events,
          (SELECT count(*)::integer
             FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipts,
          (SELECT count(*)::integer FROM public.decision_nodes) AS decisions
        FROM public.wedding_journeys
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      expect(rolledBack.rows[0]).toEqual({
        revision: 0,
        has_events: false,
        receipts: 0,
        decisions: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a successful result event that differs from the committed delta", async () => {
    const db = await createDatabase();
    try {
      const toolInput = {
        date: EVENT_ONE.date,
        time: EVENT_ONE.time,
        title: EVENT_ONE.title,
        category_key: EVENT_ONE.categoryKey,
        schedule_scope: "confirmed_fact",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "add_schedule_event",
        toolInput,
      });
      const forgedResultEvent: ScheduleEvent = {
        ...EVENT_ONE,
        memo: "not present in the committed schedule state",
      };

      await expect(
        applyScheduleMutation(db, {
          toolName: "add_schedule_event",
          toolInput,
          identity,
          expectedPresent: false,
          value: [EVENT_ONE],
          event: forgedResultEvent,
        }),
      ).rejects.toThrow("AMORA_SHARED_SCHEDULE_DECISION_RECEIPT_INVALID");

      const rolledBack = await db.query<{
        revision: number;
        has_events: boolean;
        execution_status: string;
        receipts: number;
        decisions: number;
      }>(`
        SELECT
          journey.state_revision::integer AS revision,
          journey.progress ? '__events' AS has_events,
          execution.status AS execution_status,
          (SELECT count(*)::integer
             FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipts,
          (SELECT count(*)::integer FROM public.decision_nodes) AS decisions
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = '${COUPLE_ID}'::uuid
      `);
      expect(rolledBack.rows[0]).toEqual({
        revision: 0,
        has_events: false,
        execution_status: "processing",
        receipts: 0,
        decisions: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("returns the stored result on an exact retry without duplicating state or decisions", async () => {
    const db = await createDatabase();
    try {
      const toolInput = {
        date: EVENT_ONE.date,
        time: EVENT_ONE.time,
        title: EVENT_ONE.title,
        category_key: EVENT_ONE.categoryKey,
        schedule_scope: "confirmed_fact",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "add_schedule_event",
        toolInput,
      });
      const mutation = {
        toolName: "add_schedule_event" as const,
        toolInput,
        identity,
        expectedPresent: false,
        value: [EVENT_ONE],
        event: EVENT_ONE,
      };

      const first = await applyScheduleMutation(db, mutation);
      const retry = await applyScheduleMutation(db, mutation);
      expect(retry.rows[0].result).toEqual(first.rows[0].result);

      const counts = await db.query<{
        state_revision: number;
        receipt_count: number;
        decision_count: number;
      }>(`
        SELECT
          journey.state_revision::integer,
          (SELECT count(*)::integer
             FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipt_count,
          (SELECT count(*)::integer FROM public.decision_nodes)
            AS decision_count
        FROM public.wedding_journeys AS journey
        WHERE journey.couple_id = '${COUPLE_ID}'::uuid
      `);
      expect(counts.rows[0]).toEqual({
        state_revision: 1,
        receipt_count: 1,
        decision_count: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls the schedule mutation back when decision recording cannot commit", async () => {
    const db = await createDatabase();
    try {
      const toolInput = {
        date: EVENT_ONE.date,
        time: EVENT_ONE.time,
        title: EVENT_ONE.title,
        category_key: EVENT_ONE.categoryKey,
        schedule_scope: "confirmed_fact",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "add_schedule_event",
        toolInput,
      });
      await resetPersona(db);
      await db.exec(`
        ALTER TABLE public.decision_nodes
          ADD CONSTRAINT test_force_decision_insert_failure
          CHECK (false) NOT VALID
      `);
      await setPersona(db, "service_role");

      await expect(
        applyScheduleMutation(db, {
          toolName: "add_schedule_event",
          toolInput,
          identity,
          expectedPresent: false,
          value: [EVENT_ONE],
          event: EVENT_ONE,
        }),
      ).rejects.toThrow("test_force_decision_insert_failure");

      const rolledBack = await db.query<{
        state_revision: number;
        has_events: boolean;
        execution_status: string;
        receipt_count: number;
        decision_count: number;
      }>(`
        SELECT
          journey.state_revision::integer,
          journey.progress ? '__events' AS has_events,
          execution.status AS execution_status,
          (SELECT count(*)::integer
             FROM public.amora_shared_action_journey_mutation_receipts
          ) AS receipt_count,
          (SELECT count(*)::integer FROM public.decision_nodes)
            AS decision_count
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = '${COUPLE_ID}'::uuid
      `);
      expect(rolledBack.rows[0]).toEqual({
        state_revision: 0,
        has_events: false,
        execution_status: "processing",
        receipt_count: 0,
        decision_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("exposes the shared decision only to the couple and keeps receipts private", async () => {
    const db = await createDatabase();
    try {
      const toolInput = {
        date: EVENT_ONE.date,
        time: EVENT_ONE.time,
        title: EVENT_ONE.title,
        category_key: EVENT_ONE.categoryKey,
        schedule_scope: "confirmed_fact",
      };
      const identity = await prepareApprovedScheduleAction(db, {
        toolName: "add_schedule_event",
        toolInput,
      });
      await applyScheduleMutation(db, {
        toolName: "add_schedule_event",
        toolInput,
        identity,
        expectedPresent: false,
        value: [EVENT_ONE],
        event: EVENT_ONE,
      });

      await setPersona(db, "authenticated", BRIDE_ID);
      const brideRead = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes",
      );
      expect(brideRead.rows[0].count).toBe(1);
      await expect(
        db.query(
          "SELECT * FROM public.amora_shared_action_journey_mutation_receipts",
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT public.capture_amora_shared_schedule_delta()"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT public.record_amora_shared_schedule_decision()"),
      ).rejects.toThrow(/permission denied/i);

      await setPersona(db, "authenticated", OUTSIDER_ID);
      const outsiderRead = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes",
      );
      expect(outsiderRead.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
