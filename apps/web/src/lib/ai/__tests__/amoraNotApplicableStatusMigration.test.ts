// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// 사용자가 "안 해요"(not_applicable)로 고른 분야도 확인 카드를 누르면 아모라가 예산을
// 바꿀 수 있어야 한다(예산 화면과 같다). 예산 쓰기는 그 상태를 그대로 두고, 체크리스트
// 토글과 update_task_status 입력 목록은 바뀌지 않는다.

const MIGRATIONS = resolve(process.cwd(), "../../supabase/migrations");
const PREVIOUS = "20260911080244_amora_budget_plan_explicit_allocations.sql";
const NEXT = "20260915101500_amora_atomic_not_applicable_status.sql";
const DECISION_WRAPPER = "20260921100000_amora_approved_decision_records.sql";
const FUNCTION = "apply_amora_atomic_tool_execution_pre_shared_revision";

function migration(name: string): string {
  return readFileSync(resolve(MIGRATIONS, name), "utf8");
}

const THREE = "'not_started', 'in_progress', 'completed'";
const FOUR = "'not_started', 'in_progress', 'completed', 'not_applicable'";
const PRESERVED = `
         OR COALESCE(v_value ->> 'status' = 'not_applicable', false)
            IS DISTINCT FROM COALESCE(
              v_expected_present AND v_expected ->> 'status' = 'not_applicable', false
            )`;
const INTENDED_CHANGES: Array<[string, string]> = [
  [
    `         OR v_value ->> 'status' NOT IN (\n           ${THREE}\n         )\n         OR v_value - ARRAY['category', 'status', 'budget', 'spent']`,
    `         OR v_value ->> 'status' NOT IN (\n           ${FOUR}\n         )${PRESERVED}\n         OR v_value - ARRAY['category', 'status', 'budget', 'spent']`,
  ],
  [
    `         OR v_value ->> 'status' NOT IN (\n           ${THREE}\n         )\n         OR v_value - ARRAY['category', 'label', 'status', 'budget', 'spent']`,
    `         OR v_value ->> 'status' NOT IN (\n           ${FOUR}\n         )${PRESERVED}\n         OR v_value - ARRAY['category', 'label', 'status', 'budget', 'spent']`,
  ],
  [
    `         OR v_entry -> 'value' ->> 'status' NOT IN (\n           ${THREE}\n         )`,
    `         OR v_entry -> 'value' ->> 'status' NOT IN (\n           ${FOUR}\n         )`,
  ],
];

function transactionBody(sql: string): string {
  const start = sql.indexOf("BEGIN;\n");
  expect(start).toBeGreaterThan(0);
  return sql.slice(start);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("not_applicable migration keeps the previous function except the intended allow-lists", () => {
  const previous = migration(PREVIOUS);
  const next = migration(NEXT);

  it("preserves the dispatcher behind the approved-decision wrapper and has no CR bytes", () => {
    const definers = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => migration(name).includes(`FUNCTION public.${FUNCTION}(`))
      .sort();
    expect(definers.slice(-3)).toEqual([PREVIOUS, NEXT, DECISION_WRAPPER]);
    const wrapper = migration(DECISION_WRAPPER);
    expect(wrapper).toContain(`ALTER FUNCTION public.${FUNCTION}(\n  uuid,text,text,integer,text,jsonb,jsonb,jsonb\n) RENAME TO apply_amora_atomic_tool_execution_pre_decision_record;`);
    expect(wrapper).toContain("IF p_domain_mutation ->> 'kind' IS DISTINCT FROM 'decision_record_insert' THEN\n    RETURN public.apply_amora_atomic_tool_execution_pre_decision_record(");
    expect(wrapper).not.toContain("CREATE OR REPLACE FUNCTION public.apply_amora_atomic_tool_execution_pre_decision_record(");
    expect(next.includes("\r")).toBe(false);
  });

  it("differs from the previous body only by the three status allow-list edits", () => {
    let expected = transactionBody(previous);
    for (const [before, after] of INTENDED_CHANGES) {
      expect(occurrences(expected, before)).toBe(1);
      expected = expected.replace(before, after);
    }
    expect(transactionBody(next)).toBe(expected);
  });

  it("keeps the checklist toggle, update_task_status inputs and the budget plan preservation invariant", () => {
    const body = transactionBody(next);
    expect(body).toContain(
      `         OR p_tool_input ->> 'status' NOT IN (\n           ${THREE}\n         )\n         OR NOT (v_value ?& ARRAY['category', 'status'])`,
    );
    expect(body).toContain(
      `         OR v_value ->> 'status' NOT IN (\n           ${THREE}\n         )\n         OR jsonb_typeof(v_value -> 'checklist') <> 'array'`,
    );
    expect(body).toContain(
      "         OR v_entry -> 'value' ->> 'status' IS DISTINCT FROM COALESCE(v_expected ->> 'status','not_started') THEN",
    );
    expect(occurrences(body, "'not_applicable'")).toBe(3 + 2 * 2);
  });

  it("keeps SECURITY DEFINER, search_path, timeouts, owner and revoked grants", () => {
    const body = transactionBody(next);
    for (const clause of [
      " SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\n SET lock_timeout TO '5s'\n SET statement_timeout TO '15s'\n",
      `ALTER FUNCTION public.${FUNCTION}(\n  uuid,text,text,integer,text,jsonb,jsonb,jsonb) OWNER TO postgres;`,
      `REVOKE ALL ON FUNCTION public.${FUNCTION}(\n  uuid,text,text,integer,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;\nCOMMIT;\n`,
    ]) {
      expect(occurrences(body, clause)).toBe(1);
      expect(occurrences(transactionBody(previous), clause)).toBe(1);
    }
    expect(body).not.toMatch(/\bGRANT\b/);
  });
});

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_KEY = `chat:${USER_ID}:30000000-0000-4000-8000-000000000001`;

async function createDatabase(withNotApplicableMigration = true) {
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
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, couple_id uuid REFERENCES public.couples(id), role text);
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid, sender_type text NOT NULL, role text NOT NULL, content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, visibility text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      total_budget bigint NOT NULL DEFAULT 0, wedding_date date, venue text,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_actions (
      id text PRIMARY KEY, couple_id uuid NOT NULL REFERENCES public.couples(id),
      title text NOT NULL, description text, due_date text, category_key text,
      priority text NOT NULL DEFAULT 'medium', status text NOT NULL DEFAULT 'open',
      source text NOT NULL DEFAULT 'chat', href text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, dismissed_at timestamptz
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id), request_key text NOT NULL,
      user_id uuid NOT NULL REFERENCES public.profiles(id), visibility text NOT NULL,
      status text NOT NULL DEFAULT 'processing', message_id uuid REFERENCES public.chat_messages(id),
      claimed_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, failed_at timestamptz,
      failure_code text, attempt_count integer NOT NULL DEFAULT 1,
      user_message_id uuid REFERENCES public.chat_messages(id),
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_tool_executions (
      couple_id uuid NOT NULL REFERENCES public.couples(id), request_key text NOT NULL,
      operation_key text NOT NULL, tool_name text NOT NULL, input_digest text NOT NULL,
      status text NOT NULL DEFAULT 'processing', result jsonb,
      claimed_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, uncertain_at timestamptz,
      failure_code text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), pending_action_id uuid,
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
    INSERT INTO public.profiles (id, couple_id, role) VALUES ('${USER_ID}', '${COUPLE_ID}', 'bride');
    INSERT INTO public.wedding_journeys (couple_id, total_budget, progress)
    VALUES ('${COUPLE_ID}', 50000000, '{}'::jsonb);
    INSERT INTO public.amora_chat_request_claims (couple_id, request_key, user_id, visibility)
    VALUES ('${COUPLE_ID}', '${REQUEST_KEY}', '${USER_ID}', 'shared');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  for (const name of [
    "20260704120000_create_amora_turn_reserve_rpc.sql",
    "20260716097000_amora_atomic_cost_budget.sql",
    "20260716110000_amora_crash_recovery_atomicity.sql",
    "20260716112000_amora_atomic_mutation_coverage.sql",
    "20260824150000_amora_custom_category_label_match.sql",
    "20260906130734_amora_budget_plan_preserves_existing_allocations.sql",
    "20260907085111_amora_budget_plan_named_allocations.sql",
    PREVIOUS,
    ...(withNotApplicableMigration ? [NEXT] : []),
  ]) await db.exec(migration(name));
  await db.exec("ALTER TABLE public.amora_tool_executions ADD COLUMN pending_action_journey_revision bigint");
  const wrapper = migration("20260730102000_amora_shared_action_approval_and_notifications.sql")
    .match(/CREATE FUNCTION public\.apply_amora_atomic_tool_execution\([\s\S]*?\$function\$;/u)?.[0];
  if (!wrapper) throw new Error("Current public atomic wrapper missing");
  await db.exec(wrapper.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"));
  await db.exec("SET ROLE service_role");
  await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
  return db;
}

type Progress = Record<string, Record<string, unknown>>;
let operationCounter = 0;

async function setJourney(db: PGlite, progress: Progress, totalBudget = 50_000_000) {
  await db.query("UPDATE public.wedding_journeys SET total_budget=$1, progress=$2::jsonb", [totalBudget, JSON.stringify(progress)]);
}

async function journey(db: PGlite) {
  return (await db.query<{ total_budget: number; progress: Progress }>(
    "SELECT total_budget, progress FROM public.wedding_journeys",
  )).rows[0];
}

async function apply(db: PGlite, toolName: string, toolInput: unknown, domainMutation: unknown, toolOutput: unknown) {
  operationCounter += 1;
  const operationKey = operationCounter.toString(16).padStart(64, "0");
  const inputDigest = operationCounter.toString(16).padStart(64, "f");
  await db.query(`
    INSERT INTO public.amora_tool_executions (
      couple_id, request_key, operation_key, tool_name, input_digest, atomic_dispatch, request_attempt_count
    ) VALUES ($1::uuid, $2, $3, $4, $5, true, 1)
  `, [COUPLE_ID, REQUEST_KEY, operationKey, toolName, inputDigest]);
  const committed = await db.query<{ result: Record<string, unknown> }>(`
    SELECT public.apply_amora_atomic_tool_execution($1::uuid, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb) AS result
  `, [COUPLE_ID, REQUEST_KEY, operationKey, inputDigest, JSON.stringify(toolInput), JSON.stringify(domainMutation),
    JSON.stringify({ toolName, toolOutput, success: true, displayMessage: "확인한 변경을 저장했어요." })]);
  return committed.rows[0].result;
}

function categoryBudget(expected: Record<string, unknown> | undefined, value: Record<string, unknown>) {
  const key = String(value.category);
  return [
    { category: key, budget: value.budget },
    { kind: "journey_progress_entry_cas", key, expectedPresent: expected !== undefined, ...(expected ? { expected } : {}), value },
    { category: key, budget: value.budget, progress_key: key, progress_value: value },
  ] as const;
}

function customCategory(key: string, expected: Record<string, unknown> | undefined, value: Record<string, unknown>) {
  return [
    { label: value.label, budget: value.budget },
    { kind: "journey_progress_entry_cas", key, expectedPresent: expected !== undefined, ...(expected ? { expected } : {}), value },
    { key, label: value.label, created: expected === undefined, progress_key: key, progress_value: value },
  ] as const;
}

async function budgetPlan(db: PGlite, entries: Array<{ key: string; expected?: Record<string, unknown>; value: Record<string, unknown> }>) {
  const { total_budget: totalBudget, progress } = await journey(db);
  await db.exec("RESET ROLE");
  const basis = (await db.query<{ basis: Record<string, number> }>(
    "SELECT public.amora_budget_plan_non_reserve_budgets(progress) AS basis FROM public.wedding_journeys",
  )).rows[0].basis;
  await db.exec("SET ROLE service_role");
  const allocations = entries.map(({ key, value }) => ({ category: key, budget: value.budget }));
  return [
    { total_budget: Number(totalBudget), allocation_mode: "explicit", allocations },
    {
      kind: "journey_budget_plan_cas", expectedBudget: Number(totalBudget), valueBudget: Number(totalBudget),
      expectedNonReserveBudgets: basis, expectedReserveBudget: Number(progress.reserve?.budget ?? 0),
      entries: entries.map(({ key, expected, value }) => ({
        key, expectedPresent: expected !== undefined, ...(expected ? { expected } : {}), value,
      })),
    },
    {
      total_budget: Number(totalBudget), previous_budget: Number(totalBudget), applied_count: entries.length,
      remainder_to_reserve: 0, allocations,
    },
  ] as const;
}

describe("not_applicable categories accept confirmed Amora budget writes and keep their status", () => {
  const skipped = { category: "ham", status: "not_applicable", budget: 300_000, spent: 0, notes: "양가 합의" };
  const customSkipped = { category: "custom_ui", label: "웨딩카", status: "not_applicable", budget: 200_000 };

  it("the previous SQL rejects the same category budget change (this is the live failure)", async () => {
    const db = await createDatabase(false);
    try {
      await setJourney(db, { ham: skipped });
      await expect(apply(db, "update_category_budget", ...categoryBudget(skipped, { ...skipped, budget: 500_000 })))
        .rejects.toThrow("AMORA_ATOMIC_CATEGORY_BUDGET_INVALID");
      expect((await journey(db)).progress).toEqual({ ham: skipped });
    } finally { await db.close(); }
  }, 30_000);

  it("update_category_budget changes only the amount and leaves not_applicable in place", async () => {
    const db = await createDatabase();
    try {
      await setJourney(db, { ham: skipped });
      const result = await apply(db, "update_category_budget", ...categoryBudget(skipped, { ...skipped, budget: 500_000 }));
      expect(result).toMatchObject({ success: true });
      expect((await journey(db)).progress).toEqual({ ham: { ...skipped, budget: 500_000 } });
    } finally { await db.close(); }
  }, 30_000);

  it.each([
    ["clears a stored not_applicable", skipped, { ...skipped, status: "not_started", budget: 500_000 }],
    ["sets not_applicable on an in-progress category", { ...skipped, status: "in_progress" }, { ...skipped, budget: 500_000 }],
    ["creates a new not_applicable category", undefined, { category: "ham", status: "not_applicable", budget: 500_000 }],
  ])("update_category_budget refuses a write that %s", async (_name, expected, value) => {
    const db = await createDatabase();
    try {
      const initial: Progress = expected ? { ham: expected } : {};
      await setJourney(db, initial);
      await expect(apply(db, "update_category_budget", ...categoryBudget(expected, value)))
        .rejects.toThrow("AMORA_ATOMIC_CATEGORY_BUDGET_INVALID");
      expect((await journey(db)).progress).toEqual(initial);
    } finally { await db.close(); }
  }, 30_000);

  it("add_custom_category updates an existing not_applicable custom item without changing its status", async () => {
    const db = await createDatabase();
    try {
      await setJourney(db, { custom_ui: customSkipped });
      const result = await apply(db, "add_custom_category", ...customCategory("custom_ui", customSkipped, { ...customSkipped, budget: 350_000 }));
      expect(result).toMatchObject({ success: true });
      expect((await journey(db)).progress).toEqual({ custom_ui: { ...customSkipped, budget: 350_000 } });
      await expect(apply(db, "add_custom_category", ...customCategory("custom_ui", { ...customSkipped, budget: 350_000 },
        { ...customSkipped, status: "in_progress", budget: 400_000 }))).rejects.toThrow("AMORA_ATOMIC_CUSTOM_CATEGORY_INVALID");
      expect((await journey(db)).progress).toEqual({ custom_ui: { ...customSkipped, budget: 350_000 } });
    } finally { await db.close(); }
  }, 30_000);

  it("apply_budget_plan allocates to a not_applicable category and refuses a changed status", async () => {
    const db = await createDatabase();
    try {
      const venue = { category: "venue", status: "in_progress", budget: 10_000_000 };
      await setJourney(db, { ham: skipped, venue });
      const plan = await budgetPlan(db, [{ key: "ham", expected: skipped, value: { ...skipped, budget: 800_000 } }]);
      const forged = structuredClone(plan[1]) as { entries: Array<{ value: Record<string, unknown> }> };
      forged.entries[0].value.status = "not_started";
      await expect(apply(db, "apply_budget_plan", plan[0], forged, plan[2])).rejects.toThrow("AMORA_ATOMIC_BUDGET_PLAN_ENTRY_INVALID");
      expect((await journey(db)).progress).toEqual({ ham: skipped, venue });
      const result = await apply(db, "apply_budget_plan", ...plan);
      expect(result).toMatchObject({ success: true });
      expect((await journey(db)).progress).toEqual({ ham: { ...skipped, budget: 800_000 }, venue });
    } finally { await db.close(); }
  }, 30_000);

  it("toggle_checklist_item on a not_applicable category is still rejected", async () => {
    const db = await createDatabase();
    try {
      const withChecklist = { category: "ham", status: "not_applicable", checklist: [{ id: "ham_01", label: "함 준비", done: false }] };
      const next = { ...withChecklist, checklist: [{ id: "ham_01", label: "함 준비", done: true }] };
      await setJourney(db, { ham: withChecklist });
      await expect(apply(db, "toggle_checklist_item", { category: "ham", item_id: "ham_01", done: true },
        { kind: "journey_progress_entry_cas", key: "ham", expectedPresent: true, expected: withChecklist, value: next },
        { category: "ham", item_id: "ham_01", done: true, new_status: "not_applicable", item_label: "함 준비", progress_key: "ham", progress_value: next },
      )).rejects.toThrow("AMORA_ATOMIC_CHECKLIST_INVALID");
      expect((await journey(db)).progress).toEqual({ ham: withChecklist });
    } finally { await db.close(); }
  }, 30_000);

  it("update_task_status can move a category out of not_applicable but cannot set it", async () => {
    const db = await createDatabase();
    try {
      await setJourney(db, { ham: skipped });
      const toStatus = (expected: Record<string, unknown>, status: string) => {
        const value = { ...expected, status };
        return [{ category: "ham", status },
          { kind: "journey_progress_entry_cas", key: "ham", expectedPresent: true, expected, value },
          { category: "ham", status, progress_key: "ham", progress_value: value }] as const;
      };
      expect(await apply(db, "update_task_status", ...toStatus(skipped, "in_progress"))).toMatchObject({ success: true });
      const moved = { ...skipped, status: "in_progress" };
      expect((await journey(db)).progress).toEqual({ ham: moved });
      await expect(apply(db, "update_task_status", ...toStatus(moved, "not_applicable")))
        .rejects.toThrow("AMORA_ATOMIC_TASK_STATUS_INVALID");
      expect((await journey(db)).progress).toEqual({ ham: moved });
    } finally { await db.close(); }
  }, 30_000);
});
