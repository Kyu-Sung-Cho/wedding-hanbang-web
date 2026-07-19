// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  applyAmoraAtomicToolResultToContext,
  buildAmoraAtomicToolOperation,
} from "@/lib/ai/amoraAtomicToolOperation";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

function migration(name: string): string {
  return readFileSync(
    resolve(process.cwd(), `../../supabase/migrations/${name}`),
    "utf8",
  );
}

const reserveBase = migration("20260704120000_create_amora_turn_reserve_rpc.sql");
const costBudget = migration("20260716097000_amora_atomic_cost_budget.sql");
const crashRecovery = migration("20260716110000_amora_crash_recovery_atomicity.sql");
const mutationCoverage = migration("20260716112000_amora_atomic_mutation_coverage.sql");

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_KEY = `chat:${USER_ID}:${REQUEST_ID}`;
const EXPECTED_WEDDING_DATE = "2099-05-01";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE public.couples (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      total_budget bigint NOT NULL DEFAULT 0,
      wedding_date date,
      venue text,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
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
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      dismissed_at timestamptz
    );
    CREATE FUNCTION public.test_action_timestamps() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = now();
      IF NEW.status = 'done' THEN NEW.completed_at = COALESCE(NEW.completed_at, now()); END IF;
      IF NEW.status <> 'done' THEN NEW.completed_at = NULL; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_action_timestamps
    BEFORE UPDATE ON public.amora_actions
    FOR EACH ROW EXECUTE FUNCTION public.test_action_timestamps();
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      request_key text NOT NULL,
      user_id uuid NOT NULL REFERENCES public.profiles(id),
      visibility text NOT NULL,
      status text NOT NULL DEFAULT 'processing',
      message_id uuid REFERENCES public.chat_messages(id),
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      failed_at timestamptz,
      failure_code text,
      attempt_count integer NOT NULL DEFAULT 1,
      user_message_id uuid REFERENCES public.chat_messages(id),
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
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      uncertain_at timestamptz,
      failure_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      pending_action_id uuid,
      PRIMARY KEY (couple_id, request_key, operation_key)
    );
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, couple_id uuid,
      session_id text, message_id uuid, interaction_type text, specialist_type text,
      user_input text, ai_output text, tool_name text, tool_input jsonb,
      tool_output jsonb, latency_ms integer, success boolean DEFAULT true,
      error_message text, model text, tokens_input integer, tokens_output integer,
      cost_usd numeric, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.couples (id) VALUES ('${COUPLE_ID}');
    INSERT INTO public.profiles (id, couple_id, role)
    VALUES ('${USER_ID}', '${COUPLE_ID}', 'bride');
    INSERT INTO public.wedding_journeys (
      couple_id, total_budget, wedding_date, venue, progress
    ) VALUES (
      '${COUPLE_ID}', 50000000, '${EXPECTED_WEDDING_DATE}', '기존 예식장',
      '{"venue":{"category":"venue","status":"not_started","budget":10000000},"partner_note":{"kept":true}}'
    );
    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility
    ) VALUES ('${COUPLE_ID}', '${REQUEST_KEY}', '${USER_ID}', 'shared');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    BEGIN;
    ${reserveBase}
    ${costBudget}
    ${crashRecovery}
    ${mutationCoverage}
    COMMIT;
  `);
  await db.exec("SET ROLE service_role");
  await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
  return db;
}

async function insertExecution(
  db: PGlite,
  toolName: string,
  operationKey: string,
  inputDigest: string,
) {
  await db.query(`
    INSERT INTO public.amora_tool_executions (
      couple_id, request_key, operation_key, tool_name, input_digest,
      atomic_dispatch, request_attempt_count
    ) VALUES ($1::uuid, $2, $3, $4, $5, true, 1)
  `, [COUPLE_ID, REQUEST_KEY, operationKey, toolName, inputDigest]);
}

async function apply(
  db: PGlite,
  operationKey: string,
  inputDigest: string,
  toolInput: unknown,
  domainMutation: unknown,
  result: unknown,
) {
  return db.query<{ result: Record<string, unknown> }>(`
    SELECT public.apply_amora_atomic_tool_execution(
      '${COUPLE_ID}'::uuid, '${REQUEST_KEY}', $1, 1, $2,
      $3::jsonb, $4::jsonb, $5::jsonb
    ) AS result
  `, [
    operationKey,
    inputDigest,
    JSON.stringify(toolInput),
    JSON.stringify(domainMutation),
    JSON.stringify(result),
  ]);
}

describe("Amora atomic mutation coverage migration", () => {
  it("keeps the v1 dispatcher private and the exact public signature service-only", () => {
    expect(mutationCoverage).toContain("RENAME TO apply_amora_atomic_tool_execution_v1");
    expect(mutationCoverage).toMatch(/REVOKE ALL ON FUNCTION public\.apply_amora_atomic_tool_execution_v1[\s\S]*service_role/);
    expect(mutationCoverage).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_amora_atomic_tool_execution\([\s\S]*TO service_role/);
    expect(mutationCoverage).toContain("v_expected_action_id IS NULL");
  });

  it("commits wedding fields and progress entries with CAS while preserving unrelated partner state", async () => {
    const db = await createDatabase();
    try {
      await db.exec("BEGIN");
      const dateFixture = await db.query<{ next_date: string; d_day: number }>(`
        SELECT
          ((now() AT TIME ZONE 'Asia/Seoul')::date + 400)::text AS next_date,
          (((now() AT TIME ZONE 'Asia/Seoul')::date + 400)
            - (now() AT TIME ZONE 'Asia/Seoul')::date)::integer AS d_day
      `);
      const { next_date: nextDate, d_day: dDay } = dateFixture.rows[0];

      await insertExecution(db, "update_wedding_date", "1".repeat(64), "a".repeat(64));
      await apply(
        db,
        "1".repeat(64),
        "a".repeat(64),
        { wedding_date: nextDate },
        {
          kind: "journey_wedding_date_cas",
          expected: EXPECTED_WEDDING_DATE,
          value: nextDate,
        },
        {
          toolName: "update_wedding_date",
          toolOutput: {
            wedding_date: nextDate,
            previous_date: EXPECTED_WEDDING_DATE,
            d_day: dDay,
          },
          success: true,
          displayMessage: "결혼 예정일을 변경했어요.",
        },
      );

      const expectedVenue = { category: "venue", status: "not_started", budget: 10_000_000 };
      const nextVenue = { ...expectedVenue, status: "in_progress" };
      await insertExecution(db, "update_task_status", "2".repeat(64), "b".repeat(64));
      await apply(
        db,
        "2".repeat(64),
        "b".repeat(64),
        { category: "venue", status: "in_progress" },
        {
          kind: "journey_progress_entry_cas",
          key: "venue",
          expectedPresent: true,
          expected: expectedVenue,
          value: nextVenue,
        },
        {
          toolName: "update_task_status",
          toolOutput: {
            category: "venue", status: "in_progress",
            progress_key: "venue", progress_value: nextVenue,
          },
          success: true,
          displayMessage: "예식장 상태를 변경했어요.",
        },
      );

      await db.exec("COMMIT");
      const state = await db.query<{
        wedding_date: string;
        venue_progress: unknown;
        partner_note: unknown;
      }>(`
        SELECT wedding_date::text, progress -> 'venue' AS venue_progress,
          progress -> 'partner_note' AS partner_note
        FROM public.wedding_journeys WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({
        wedding_date: nextDate,
        venue_progress: nextVenue,
        partner_note: { kept: true },
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("commits a whole budget plan atomically without retaining intake text", async () => {
    const db = await createDatabase();
    try {
      const venueExpected = { category: "venue", status: "not_started", budget: 10_000_000 };
      const venueNext = { ...venueExpected, budget: 20_000_000 };
      const studioNext = { category: "studio", status: "not_started", budget: 10_000_000 };
      const reserveNext = { category: "reserve", status: "not_started", budget: 20_000_000 };
      const allocations = [
        { category: "venue", budget: 20_000_000 },
        { category: "studio", budget: 10_000_000 },
        { category: "reserve", budget: 20_000_000 },
      ];
      await insertExecution(db, "apply_budget_plan", "3".repeat(64), "c".repeat(64));
      await apply(
        db,
        "3".repeat(64),
        "c".repeat(64),
        {
          total_budget: 50_000_000,
          allocations: [
            { category: "venue", budget: 20_000_000 },
            { category: "studio", budget: 10_000_000 },
          ],
          intake_summary: "private family finance details",
        },
        {
          kind: "journey_budget_plan_cas",
          expectedBudget: 50_000_000,
          valueBudget: 50_000_000,
          entries: [
            { key: "venue", expectedPresent: true, expected: venueExpected, value: venueNext },
            { key: "studio", expectedPresent: false, value: studioNext },
            { key: "reserve", expectedPresent: false, value: reserveNext },
          ],
        },
        {
          toolName: "apply_budget_plan",
          toolOutput: {
            total_budget: 50_000_000,
            previous_budget: 50_000_000,
            applied_count: 3,
            remainder_to_reserve: 20_000_000,
            allocations,
          },
          success: true,
          displayMessage: "예산안을 적용했어요.",
        },
      );
      const state = await db.query<{ progress: unknown; result: unknown }>(`
        SELECT journey.progress, execution.result
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
         AND execution.operation_key = $2
        WHERE journey.couple_id = $1::uuid
      `, [COUPLE_ID, "3".repeat(64)]);
      expect(state.rows[0]?.progress).toMatchObject({
        venue: venueNext,
        studio: studioNext,
        reserve: reserveNext,
        partner_note: { kept: true },
      });
      expect(JSON.stringify(state.rows[0]?.result)).not.toContain("private family");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("executes venue, category-budget, custom-category, checklist, and wedding-event operations end to end", async () => {
    const db = await createDatabase();
    const context: ToolExecutionContext = {
      coupleId: COUPLE_ID,
      requestKey: REQUEST_KEY,
      requestAttemptCount: 1,
      providerCallIndex: 1,
      weddingContext: {
        weddingDate: "2027-05-01",
        budget: 50_000_000,
        venue: "기존 예식장",
        progress: {
          venue: { category: "venue", status: "not_started", budget: 10_000_000 },
          partner_note: { kept: true },
        } as unknown as ToolExecutionContext["weddingContext"]["progress"],
      },
    };
    try {
      const operations: Array<[string, Record<string, unknown>]> = [
        ["update_venue", { venue: "새 예식장" }],
        ["update_category_budget", { category: "venue", budget: 12_000_000, spent: 1_000_000 }],
        ["add_custom_category", { label: "포토 부스", budget: 500_000 }],
        ["add_custom_category", { label: "포토 부스", spent: 100_000 }],
        ["toggle_checklist_item", { category: "venue", item_id: "venue_03", done: true }],
        ["log_wedding_event", { moment_type: "venue_tour", date: "2027-03-12", title: "예식장 투어" }],
      ];
      for (const [toolName, toolInput] of operations) {
        const identity = getAmoraToolOperationIdentity(toolName, toolInput);
        const operation = buildAmoraAtomicToolOperation(
          toolName,
          toolInput,
          context,
          identity.operationKey,
        );
        expect(operation.result.success).toBe(true);
        await insertExecution(db, toolName, identity.operationKey, identity.inputDigest);
        const durableResult = {
          toolName: operation.result.toolName,
          toolOutput: operation.result.toolOutput,
          success: operation.result.success,
          displayMessage: operation.result.displayMessage,
        };
        const committed = await apply(
          db,
          identity.operationKey,
          identity.inputDigest,
          toolInput,
          operation.domainMutation,
          durableResult,
        );
        const result = committed.rows[0]?.result;
        expect(result).toMatchObject({ success: true, toolName });
        applyAmoraAtomicToolResultToContext({
          ...operation.result,
          toolOutput: result?.toolOutput as Record<string, unknown>,
        }, context);
      }

      const state = await db.query<{
        venue: string;
        progress: Record<string, unknown>;
      }>(`
        SELECT venue, progress
        FROM public.wedding_journeys WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]?.venue).toBe("새 예식장");
      expect(state.rows[0]?.progress).toMatchObject({
        venue: {
          category: "venue",
          budget: 12_000_000,
          spent: 1_000_000,
          checklist: expect.arrayContaining([
            expect.objectContaining({ id: "venue_03", done: true }),
          ]),
        },
        partner_note: { kept: true },
        __events: [expect.objectContaining({
          momentType: "venue_tour",
          date: "2027-03-12",
        })],
      });
      const customEntries = Object.entries(state.rows[0]?.progress ?? {})
        .filter(([key]) => key.startsWith("custom_"));
      expect(customEntries).toHaveLength(1);
      expect(customEntries[0]?.[1]).toMatchObject({
        label: "포토 부스",
        budget: 500_000,
        spent: 100_000,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("inserts and updates canonical amora_actions without a progress mirror", async () => {
    const db = await createDatabase();
    try {
      const invalidOperationKey = "0".repeat(64);
      const invalidActionId = `act_${REQUEST_ID.replace(/-/g, "")}_${invalidOperationKey.slice(0, 24)}`;
      const invalidAction = {
        id: invalidActionId,
        title: "잘못된 카테고리",
        description: null,
        dueDate: null,
        categoryKey: "",
        priority: "medium",
        status: "open",
        source: "chat",
        href: "/wedding/lounge",
      };
      await insertExecution(db, "add_amora_action", invalidOperationKey, "0".repeat(64));
      await expect(apply(
        db,
        invalidOperationKey,
        "0".repeat(64),
        { title: "잘못된 카테고리", category_key: "" },
        { kind: "amora_action_insert", action: invalidAction },
        {
          toolName: "add_amora_action",
          toolOutput: { action: invalidAction },
          success: true,
          displayMessage: "행동 카드를 저장했어요.",
        },
      )).rejects.toThrow(/AMORA_ATOMIC_ACTION_INSERT_INVALID/);

      const operationKey = "4".repeat(64);
      const actionId = `act_${REQUEST_ID.replace(/-/g, "")}_${operationKey.slice(0, 24)}`;
      const action = {
        id: actionId,
        title: "계약서 확인",
        description: null,
        dueDate: "2027-04-01",
        categoryKey: "venue",
        priority: "high",
        status: "open",
        source: "chat",
        href: "/wedding/lounge",
      };
      await insertExecution(db, "add_amora_action", operationKey, "d".repeat(64));
      const inserted = await apply(
        db,
        operationKey,
        "d".repeat(64),
        { title: "계약서 확인", due_date: "2027-04-01", category_key: "venue", priority: "high" },
        { kind: "amora_action_insert", action },
        {
          toolName: "add_amora_action",
          toolOutput: { action },
          success: true,
          displayMessage: "행동 카드를 저장했어요.",
        },
      );
      expect(inserted.rows[0]?.result).toMatchObject({
        success: true,
        toolOutput: { action: { id: actionId, status: "open", createdAt: expect.any(String) } },
      });

      await insertExecution(db, "update_amora_action", "5".repeat(64), "e".repeat(64));
      const updated = await apply(
        db,
        "5".repeat(64),
        "e".repeat(64),
        { action_id: actionId, status: "done" },
        { kind: "amora_action_update", actionId, updates: { status: "done" } },
        {
          toolName: "update_amora_action",
          toolOutput: { action_id: actionId, updates: { status: "done" } },
          success: true,
          displayMessage: "행동 카드를 변경했어요.",
        },
      );
      expect(updated.rows[0]?.result).toMatchObject({
        success: true,
        toolOutput: { action: { id: actionId, status: "done", completedAt: expect.any(String) } },
      });
      const state = await db.query<{ count: number; mirror: unknown }>(`
        SELECT (SELECT count(*)::integer FROM public.amora_actions) AS count,
          progress -> '__amora_actions' AS mirror
        FROM public.wedding_journeys WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({ count: 1, mirror: null });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("durably records no-op and stale-CAS failures without overwriting current state", async () => {
    const db = await createDatabase();
    try {
      await insertExecution(db, "update_venue", "7".repeat(64), "1".repeat(64));
      const noChange = await apply(
        db,
        "7".repeat(64),
        "1".repeat(64),
        { venue: "기존 예식장" },
        { kind: "journey_venue_cas", expected: "기존 예식장", value: "기존 예식장" },
        {
          toolName: "update_venue",
          toolOutput: { venue: "기존 예식장", previous_venue: "기존 예식장" },
          success: true,
          displayMessage: "예식장을 변경했어요.",
        },
      );
      expect(noChange.rows[0]?.result).toMatchObject({
        success: false,
        toolOutput: { error: "no_change" },
      });

      const expected = { category: "venue", status: "not_started", budget: 10_000_000 };
      const concurrent = { ...expected, status: "completed", partner_field: "preserve" };
      const requested = { ...expected, status: "in_progress" };
      await db.query(`
        UPDATE public.wedding_journeys
        SET progress = jsonb_set(progress, '{venue}', $2::jsonb)
        WHERE couple_id = $1::uuid
      `, [COUPLE_ID, JSON.stringify(concurrent)]);
      await insertExecution(db, "update_task_status", "8".repeat(64), "2".repeat(64));
      const stale = await apply(
        db,
        "8".repeat(64),
        "2".repeat(64),
        { category: "venue", status: "in_progress" },
        {
          kind: "journey_progress_entry_cas",
          key: "venue",
          expectedPresent: true,
          expected,
          value: requested,
        },
        {
          toolName: "update_task_status",
          toolOutput: {
            category: "venue", status: "in_progress",
            progress_key: "venue", progress_value: requested,
          },
          success: true,
          displayMessage: "상태를 변경했어요.",
        },
      );
      expect(stale.rows[0]?.result).toMatchObject({
        success: false,
        toolOutput: { error: "domain_state_changed" },
      });
      const state = await db.query<{ venue: unknown; statuses: string[] }>(`
        SELECT journey.progress -> 'venue' AS venue,
          array_agg(execution.status ORDER BY execution.operation_key) AS statuses
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1::uuid
          AND execution.operation_key IN ($2, $3)
        GROUP BY journey.progress
      `, [COUPLE_ID, "7".repeat(64), "8".repeat(64)]);
      expect(state.rows[0]).toEqual({
        venue: concurrent,
        statuses: ["completed", "completed"],
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a forged result and rolls back both domain and ledger state", async () => {
    const db = await createDatabase();
    try {
      const expected = { category: "venue", status: "not_started", budget: 10_000_000 };
      const next = { ...expected, status: "in_progress" };
      await insertExecution(db, "update_task_status", "6".repeat(64), "f".repeat(64));
      await expect(apply(
        db,
        "6".repeat(64),
        "f".repeat(64),
        { category: "venue", status: "in_progress" },
        {
          kind: "journey_progress_entry_cas",
          key: "venue",
          expectedPresent: true,
          expected,
          value: next,
        },
        {
          toolName: "update_task_status",
          toolOutput: {
            category: "venue", status: "completed",
            progress_key: "venue", progress_value: next,
          },
          success: true,
          displayMessage: "완료했어요.",
        },
      )).rejects.toThrow(/AMORA_ATOMIC_TASK_STATUS_INVALID/);
      await expect(apply(
        db,
        "6".repeat(64),
        "f".repeat(64),
        { category: "venue", status: "in_progress" },
        {
          kind: "journey_progress_entry_cas",
          key: "venue",
          expectedPresent: true,
          expected,
          value: next,
        },
        {},
      )).rejects.toThrow(/AMORA_ATOMIC_TOOL_INVALID_INPUT/);
      const state = await db.query<{ status: string; venue: unknown }>(`
        SELECT execution.status, journey.progress -> 'venue' AS venue
        FROM public.amora_tool_executions AS execution
        JOIN public.wedding_journeys AS journey
          ON journey.couple_id = execution.couple_id
        WHERE execution.operation_key = $1
      `, ["6".repeat(64)]);
      expect(state.rows[0]).toEqual({ status: "processing", venue: expected });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
