// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
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
const sharedActionApproval = migration(
  "20260730102000_amora_shared_action_approval_and_notifications.sql",
);
const sharedWrapperStart = sharedActionApproval.indexOf(
  "-- Put the shared-action revision guard around the already-audited atomic",
);
const sharedWrapperEnd = sharedActionApproval.indexOf(
  "CREATE OR REPLACE FUNCTION public.authorize_amora_shared_action_execution(",
  sharedWrapperStart,
);
if (sharedWrapperStart < 0 || sharedWrapperEnd < 0) {
  throw new Error("AMORA_SHARED_ACTION_DISPATCHER_FIXTURE_MISSING");
}
const sharedAtomicWrapper = sharedActionApproval.slice(
  sharedWrapperStart,
  sharedWrapperEnd,
);
const successorPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260816160000_amora_atomic_action_href_parity.sql",
);
const successor = existsSync(successorPath) ? readFileSync(successorPath, "utf8") : "";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const PENDING_ACTION_ID = "40000000-0000-4000-8000-000000000001";
const REQUEST_KEY = `chat:${USER_ID}:${REQUEST_ID}`;

async function createDatabase(options: { applySuccessor?: boolean } = {}) {
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
      IF NEW.status = 'done' THEN
        NEW.completed_at = COALESCE(NEW.completed_at, now());
      END IF;
      IF NEW.status <> 'done' THEN
        NEW.completed_at = NULL;
      END IF;
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
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      couple_id uuid,
      session_id text,
      message_id uuid,
      interaction_type text,
      specialist_type text,
      user_input text,
      ai_output text,
      tool_name text,
      tool_input jsonb,
      tool_output jsonb,
      latency_ms integer,
      success boolean DEFAULT true,
      error_message text,
      model text,
      tokens_input integer,
      tokens_output integer,
      cost_usd numeric,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.couples (id) VALUES ('${COUPLE_ID}');
    INSERT INTO public.profiles (id, couple_id, role)
    VALUES ('${USER_ID}', '${COUPLE_ID}', 'bride');
    INSERT INTO public.wedding_journeys (
      couple_id, total_budget, wedding_date, venue, progress
    ) VALUES (
      '${COUPLE_ID}', 50000000, '2099-05-01', 'test venue',
      '{"venue":{"category":"venue","status":"not_started","budget":10000000}}'
    );
    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility
    ) VALUES ('${COUPLE_ID}', '${REQUEST_KEY}', '${USER_ID}', 'shared');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  await db.exec(reserveBase);
  await db.exec(costBudget);
  await db.exec(crashRecovery);
  await db.exec(mutationCoverage);
  await db.exec(`
    ALTER TABLE public.amora_tool_executions
      ADD COLUMN pending_action_journey_revision bigint;
  `);
  await db.exec(sharedAtomicWrapper);
  if (successor && options.applySuccessor !== false) {
    await db.exec(successor);
  }
  await db.exec("SET ROLE service_role");
  await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
  return db;
}

function buildActionOperation(toolInput: Record<string, unknown>) {
  const identity = getAmoraToolOperationIdentity("add_amora_action", toolInput);
  const context: ToolExecutionContext = {
    coupleId: COUPLE_ID,
    requestKey: REQUEST_KEY,
    requestAttemptCount: 1,
    providerCallIndex: 1,
    weddingContext: {
      weddingDate: "2099-05-01",
      budget: 50_000_000,
      venue: "test venue",
      progress: {},
    },
  };
  const operation = buildAmoraAtomicToolOperation(
    "add_amora_action",
    toolInput,
    context,
    identity.operationKey,
  );
  return { identity, operation };
}

async function insertPendingAndApply(
  db: PGlite,
  toolInput: Record<string, unknown>,
  pendingActionId: string,
) {
  const { identity, operation } = buildActionOperation(toolInput);
  await db.query(`
    INSERT INTO public.amora_tool_executions (
      couple_id, request_key, operation_key, tool_name, input_digest,
      atomic_dispatch, request_attempt_count, pending_action_id,
      pending_action_journey_revision
    ) VALUES ($1::uuid, $2, $3, 'add_amora_action', $4, true, 1, $5::uuid, 7)
  `, [
    COUPLE_ID,
    REQUEST_KEY,
    identity.operationKey,
    identity.inputDigest,
    pendingActionId,
  ]);
  const durableResult = {
    toolName: operation.result.toolName,
    toolOutput: operation.result.toolOutput,
    success: operation.result.success,
    displayMessage: operation.result.displayMessage,
  };
  const applied = await db.query<{ result: Record<string, unknown> }>(`
    SELECT public.apply_amora_atomic_tool_execution(
      $1::uuid, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb
    ) AS result
  `, [
    COUPLE_ID,
    REQUEST_KEY,
    identity.operationKey,
    identity.inputDigest,
    JSON.stringify(toolInput),
    JSON.stringify(operation.domainMutation),
    JSON.stringify(durableResult),
  ]);
  return { applied, identity, operation };
}

describe("Amora atomic action href parity successor", () => {
  it("applies an existing omitted-href MC proposal without changing its identity", async () => {
    const db = await createDatabase();
    const toolInput = { title: "사회자 섭외 확인", category_key: "mc" };
    const { identity, operation } = buildActionOperation(toolInput);
    expect(operation.result).toMatchObject({
      success: true,
      toolOutput: { action: { categoryKey: "mc", href: "/wedding/chat" } },
    });

    try {
      const { applied } = await insertPendingAndApply(
        db,
        toolInput,
        PENDING_ACTION_ID,
      );
      expect(applied.rows[0]?.result).toMatchObject({
        success: true,
        toolOutput: { action: { categoryKey: "mc", href: "/wedding/chat" } },
      });
      const persisted = await db.query<{
        href: string;
        operation_key: string;
        input_digest: string;
        pending_action_id: string;
      }>(`
        SELECT action.href,
          execution.operation_key,
          execution.input_digest,
          execution.pending_action_id::text
        FROM public.amora_actions AS action
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = action.couple_id
        WHERE action.couple_id = $1::uuid
          AND execution.operation_key = $2
      `, [COUPLE_ID, identity.operationKey]);
      expect(persisted.rows[0]).toEqual({
        href: "/wedding/chat",
        operation_key: identity.operationKey,
        input_digest: identity.inputDigest,
        pending_action_id: PENDING_ACTION_ID,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("applies an omitted-href gift proposal to the same live chat target", async () => {
    const db = await createDatabase();
    const toolInput = { title: "답례품 수량 확인", category_key: "gift" };
    try {
      const { applied, identity, operation } = await insertPendingAndApply(
        db,
        toolInput,
        "40000000-0000-4000-8000-000000000002",
      );
      expect(operation.result).toMatchObject({
        success: true,
        toolOutput: { action: { categoryKey: "gift", href: "/wedding/chat" } },
      });
      expect(applied.rows[0]?.result).toMatchObject({
        success: true,
        toolOutput: { action: { categoryKey: "gift", href: "/wedding/chat" } },
      });
      const persisted = await db.query<{ href: string; input_digest: string }>(`
        SELECT action.href, execution.input_digest
        FROM public.amora_actions AS action
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = action.couple_id
        WHERE action.couple_id = $1::uuid
          AND execution.operation_key = $2
      `, [COUPLE_ID, identity.operationKey]);
      expect(persisted.rows[0]).toEqual({
        href: "/wedding/chat",
        input_digest: identity.inputDigest,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("applies ASCII edge whitespace using the same title and description normalization as TypeScript", async () => {
    const db = await createDatabase();
    const toolInput = {
      title: "\tAlpha\n",
      description: "\r\nDetail\tline \n",
      category_key: "mc",
    };
    try {
      const { applied, operation } = await insertPendingAndApply(
        db,
        toolInput,
        "40000000-0000-4000-8000-000000000021",
      );
      expect(operation.result).toMatchObject({
        success: true,
        toolOutput: {
          action: {
            title: "Alpha",
            description: "Detail line",
            href: "/wedding/chat",
          },
        },
      });
      expect(applied.rows[0]?.result).toMatchObject({
        success: true,
        toolOutput: {
          action: {
            title: "Alpha",
            description: "Detail line",
            href: "/wedding/chat",
          },
        },
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("retains plain-space edge and internal-whitespace canonicalization", async () => {
    const db = await createDatabase();
    const toolInput = {
      title: "   Alpha   Beta   ",
      description: "  Detail   line  ",
      category_key: "gift",
    };
    try {
      const { applied, operation } = await insertPendingAndApply(
        db,
        toolInput,
        "40000000-0000-4000-8000-000000000022",
      );
      const expectedAction = {
        title: "Alpha Beta",
        description: "Detail line",
        href: "/wedding/chat",
      };
      expect(operation.result).toMatchObject({
        success: true,
        toolOutput: { action: expectedAction },
      });
      expect(applied.rows[0]?.result).toMatchObject({
        success: true,
        toolOutput: { action: expectedAction },
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves an explicit href instead of applying the category default", async () => {
    const db = await createDatabase();
    const toolInput = {
      title: "사회자 체크리스트 열기",
      category_key: "mc",
      href: "/wedding/lounge",
    };
    try {
      const { applied, operation } = await insertPendingAndApply(
        db,
        toolInput,
        "40000000-0000-4000-8000-000000000003",
      );
      expect(operation.result).toMatchObject({
        success: true,
        toolOutput: { action: { categoryKey: "mc", href: "/wedding/lounge" } },
      });
      expect(applied.rows[0]?.result).toMatchObject({
        success: true,
        toolOutput: { action: { href: "/wedding/lounge" } },
      });
      const persisted = await db.query<{ href: string }>(`
        SELECT href FROM public.amora_actions WHERE couple_id = $1::uuid
      `, [COUPLE_ID]);
      expect(persisted.rows).toEqual([{ href: "/wedding/lounge" }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps every unaffected omitted-href default and source precedence", async () => {
    const db = await createDatabase();
    const cases = [
      {
        toolInput: { title: "venue default", category_key: "venue" },
        pendingActionId: "40000000-0000-4000-8000-000000000011",
        href: "/wedding/lounge",
      },
      {
        toolInput: { title: "invitation default", category_key: "invitation" },
        pendingActionId: "40000000-0000-4000-8000-000000000012",
        href: "/wedding/schedule",
      },
      {
        toolInput: { title: "quote precedence", category_key: "mc", source: "quote" },
        pendingActionId: "40000000-0000-4000-8000-000000000013",
        href: "/wedding/community/quote-check",
      },
      {
        toolInput: { title: "budget precedence", category_key: "gift", source: "budget" },
        pendingActionId: "40000000-0000-4000-8000-000000000014",
        href: "/wedding/budget",
      },
      {
        toolInput: { title: "schedule precedence", category_key: "gift", source: "schedule" },
        pendingActionId: "40000000-0000-4000-8000-000000000015",
        href: "/wedding/schedule",
      },
    ] as const;
    try {
      for (const testCase of cases) {
        const { applied, operation } = await insertPendingAndApply(
          db,
          testCase.toolInput,
          testCase.pendingActionId,
        );
        expect(operation.result).toMatchObject({
          success: true,
          toolOutput: { action: { href: testCase.href } },
        });
        expect(applied.rows[0]?.result).toMatchObject({
          success: true,
          toolOutput: { action: { href: testCase.href } },
        });
      }
      const persisted = await db.query<{ title: string; href: string }>(`
        SELECT title, href
        FROM public.amora_actions
        WHERE couple_id = $1::uuid
        ORDER BY title
      `, [COUPLE_ID]);
      expect(Object.fromEntries(
        persisted.rows.map(({ title, href }) => [title, href]),
      )).toEqual(Object.fromEntries(
        cases.map(({ toolInput, href }) => [toolInput.title, href]),
      ));
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps unrelated atomic operations unchanged through the public dispatcher", async () => {
    const db = await createDatabase();
    const toolInput = { venue: "New venue" };
    const identity = getAmoraToolOperationIdentity("update_venue", toolInput);
    const context: ToolExecutionContext = {
      coupleId: COUPLE_ID,
      requestKey: REQUEST_KEY,
      requestAttemptCount: 1,
      providerCallIndex: 1,
      weddingContext: {
        weddingDate: "2099-05-01",
        budget: 50_000_000,
        venue: "test venue",
        progress: {},
      },
    };
    const operation = buildAmoraAtomicToolOperation(
      "update_venue",
      toolInput,
      context,
      identity.operationKey,
    );
    try {
      await db.query(`
        INSERT INTO public.amora_tool_executions (
          couple_id, request_key, operation_key, tool_name, input_digest,
          atomic_dispatch, request_attempt_count
        ) VALUES ($1::uuid, $2, $3, 'update_venue', $4, true, 1)
      `, [COUPLE_ID, REQUEST_KEY, identity.operationKey, identity.inputDigest]);
      const applied = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.apply_amora_atomic_tool_execution(
          $1::uuid, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb
        ) AS result
      `, [
        COUPLE_ID,
        REQUEST_KEY,
        identity.operationKey,
        identity.inputDigest,
        JSON.stringify(toolInput),
        JSON.stringify(operation.domainMutation),
        JSON.stringify({
          toolName: operation.result.toolName,
          toolOutput: operation.result.toolOutput,
          success: operation.result.success,
          displayMessage: operation.result.displayMessage,
        }),
      ]);
      expect(applied.rows[0]?.result).toMatchObject({
        success: true,
        toolName: "update_venue",
        toolOutput: { venue: "New venue", previous_venue: "test venue" },
      });
      const persisted = await db.query<{ venue: string; status: string }>(`
        SELECT journey.venue, execution.status
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1::uuid
          AND execution.operation_key = $2
      `, [COUPLE_ID, identity.operationKey]);
      expect(persisted.rows).toEqual([{ venue: "New venue", status: "completed" }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("changes only the retired literal while preserving signature, locks, and ACLs", async () => {
    const db = await createDatabase({ applySuccessor: false });
    const privateSignature =
      "public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)";
    const publicSignature =
      "public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)";
    const readDefinitions = () => db.query<{
      private_definition: string;
      public_definition: string;
    }>(`
      SELECT
        pg_get_functiondef($1::regprocedure) AS private_definition,
        pg_get_functiondef($2::regprocedure) AS public_definition
    `, [privateSignature, publicSignature]);

    try {
      const before = await readDefinitions();
      expect(before.rows[0]?.private_definition).toContain(
        "WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/etiquette'",
      );
      await db.exec("RESET ROLE");
      await db.exec(successor);
      await db.exec("SET ROLE service_role");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
      );

      const after = await readDefinitions();
      const canonicalBefore = before.rows[0]!.private_definition.replaceAll(
        "\r\n",
        "\n",
      );
      const canonicalAfter = after.rows[0]!.private_definition.replaceAll(
        "\r\n",
        "\n",
      );
      const replacements: Array<{ old: string; next: string }> = [
        {
          old: "WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/etiquette'",
          next: "WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/chat'",
        },
        {
          old: `char_length(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       )) NOT BETWEEN 1 AND 120`,
          next: `char_length(btrim(regexp_replace(
         p_tool_input ->> 'title', '[[:space:]]+', ' ', 'g'
       ))) NOT BETWEEN 1 AND 120`,
        },
        {
          old: `left(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       ), 120) <> v_value ->> 'title'`,
          next: `left(btrim(regexp_replace(
         p_tool_input ->> 'title', '[[:space:]]+', ' ', 'g'
       )), 120) <> v_value ->> 'title'`,
        },
        {
          old: `char_length(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           )) > 500`,
          next: `char_length(btrim(regexp_replace(
             p_tool_input ->> 'description', '[[:space:]]+', ' ', 'g'
           ))) > 500`,
        },
        {
          old: `NULLIF(left(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           ), 500), '') IS DISTINCT FROM v_value ->> 'description'`,
          next: `NULLIF(left(btrim(regexp_replace(
             p_tool_input ->> 'description', '[[:space:]]+', ' ', 'g'
           )), 500), '') IS DISTINCT FROM v_value ->> 'description'`,
        },
      ];
      expect(after.rows[0]?.public_definition).toBe(
        before.rows[0]?.public_definition,
      );
      let reconstructed = canonicalAfter;
      for (const replacement of replacements) {
        expect(canonicalBefore.split(replacement.old)).toHaveLength(2);
        expect(canonicalBefore).not.toContain(replacement.next);
        expect(canonicalAfter).not.toContain(replacement.old);
        expect(canonicalAfter.split(replacement.next)).toHaveLength(2);
        reconstructed = reconstructed.replace(replacement.next, replacement.old);
      }
      expect(reconstructed).toBe(canonicalBefore);

      const contract = await db.query<{
        private_owner: string;
        public_owner: string;
        private_security_definer: boolean;
        public_security_definer: boolean;
        private_config: string[];
        public_config: string[];
        private_anon: boolean;
        private_authenticated: boolean;
        private_service: boolean;
        public_anon: boolean;
        public_authenticated: boolean;
        public_service: boolean;
        public_result: string;
      }>(`
        SELECT
          pg_get_userbyid(private_proc.proowner)::text AS private_owner,
          pg_get_userbyid(public_proc.proowner)::text AS public_owner,
          private_proc.prosecdef AS private_security_definer,
          public_proc.prosecdef AS public_security_definer,
          private_proc.proconfig AS private_config,
          public_proc.proconfig AS public_config,
          has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS private_anon,
          has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS private_authenticated,
          has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS private_service,
          has_function_privilege('anon', $2::regprocedure, 'EXECUTE') AS public_anon,
          has_function_privilege('authenticated', $2::regprocedure, 'EXECUTE') AS public_authenticated,
          has_function_privilege('service_role', $2::regprocedure, 'EXECUTE') AS public_service,
          pg_get_function_result(public_proc.oid) AS public_result
        FROM pg_proc AS private_proc
        CROSS JOIN pg_proc AS public_proc
        WHERE private_proc.oid = $1::regprocedure
          AND public_proc.oid = $2::regprocedure
      `, [privateSignature, publicSignature]);
      expect(contract.rows[0]).toMatchObject({
        private_owner: "postgres",
        public_owner: "postgres",
        private_security_definer: true,
        public_security_definer: true,
        private_anon: false,
        private_authenticated: false,
        private_service: false,
        public_anon: false,
        public_authenticated: false,
        public_service: true,
        public_result: "jsonb",
      });
      expect(contract.rows[0]?.private_config).toEqual(expect.arrayContaining([
        "search_path=pg_catalog, public",
        "lock_timeout=5s",
        "statement_timeout=15s",
      ]));
      expect(contract.rows[0]?.public_config).toEqual(expect.arrayContaining([
        "search_path=pg_catalog, public",
        "lock_timeout=5s",
        "statement_timeout=15s",
      ]));
      expect(successor).not.toMatch(
        /ai_interactions_log|provider_call|anthropic/i,
      );

      await expect(db.query(`
        SELECT public.apply_amora_atomic_tool_execution_pre_shared_revision(
          NULL::uuid, NULL::text, NULL::text, NULL::integer,
          NULL::text, NULL::jsonb, NULL::jsonb, NULL::jsonb
        )
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when the audited predecessor literal has drifted", async () => {
    const db = await createDatabase({ applySuccessor: false });
    try {
      await db.exec("RESET ROLE");
      await db.exec(`
        DO $tamper$
        DECLARE
          definition text;
        BEGIN
          SELECT pg_get_functiondef(
            'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'::regprocedure
          ) INTO definition;
          EXECUTE replace(
            definition,
            $$WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/etiquette'$$,
            $$WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/unknown'$$
          );
        END
        $tamper$;
      `);
      await expect(db.exec(successor)).rejects.toThrow(
        /AMORA_ATOMIC_ACTION_HREF_PARITY_PREDECESSOR_DRIFT/,
      );
      await db.exec("ROLLBACK").catch(() => undefined);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
