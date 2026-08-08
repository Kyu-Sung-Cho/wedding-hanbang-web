// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

function migration(name: string) {
  return readFileSync(
    resolve(process.cwd(), `../../supabase/migrations/${name}`),
    "utf8",
  );
}

const sharedApprovalSql = migration(
  "20260730102000_amora_shared_action_approval_and_notifications.sql",
);
const planChangeSql = migration(
  "20260731123000_couple_plan_change_write_boundary.sql",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const NEW_GROOM_ID = "10000000-0000-4000-8000-000000000004";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const SOLO_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const AMORA_SOURCE_ID = "30000000-0000-4000-8000-000000000001";
const AMORA_CONFIRMATION_ID = "30000000-0000-4000-8000-000000000002";
const AMORA_ACTION_ID = "40000000-0000-4000-8000-000000000001";

type PlanChangeResult = {
  requestId: string;
  status: "applied" | "pending_partner" | "stale" | "rejected";
  requiredCount: number;
  acceptedCount: number;
  isHighImpact: boolean;
  appliedRevision: number | null;
  summary: string;
  journey: {
    couple_id: string;
    state_revision: number;
    total_budget: number | null;
    progress: Record<string, unknown>;
  } | null;
};

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    -- PGlite has no Supabase pgcrypto bundle. This deterministic 32-byte
    -- stand-in tests canonical digest binding rather than SHA-256 itself.
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
      bride_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      groom_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      wedding_date date,
      venue text,
      total_budget bigint,
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
    BEGIN
      IF p_domain_mutation ->> 'kind' = 'journey_total_budget_cas' THEN
        UPDATE public.wedding_journeys
        SET total_budget = (p_domain_mutation ->> 'value')::bigint
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
    ALTER TABLE public.wedding_journeys ENABLE ROW LEVEL SECURITY;
    CREATE POLICY journeys_insert_couple ON public.wedding_journeys
      FOR INSERT TO authenticated
      WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY journeys_update_couple ON public.wedding_journeys
      FOR UPDATE TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));
    GRANT INSERT, UPDATE ON public.wedding_journeys TO authenticated;
    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'),
      ('${GROOM_ID}'),
      ('${OUTSIDER_ID}'),
      ('${NEW_GROOM_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${SOLO_COUPLE_ID}', '${OUTSIDER_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${SOLO_COUPLE_ID}', 'bride'),
      ('${NEW_GROOM_ID}', NULL, NULL);
    INSERT INTO public.wedding_journeys(
      couple_id, wedding_date, venue, total_budget, progress
    ) VALUES
      (
        '${COUPLE_ID}',
        '2027-05-01',
        '기존 예식장',
        50000000,
        '{"venue":{"label":"예식장","status":"in_progress","budget":10000000,"payer":"couple"}}'
      ),
      (
        '${SOLO_COUPLE_ID}',
        '2027-06-01',
        NULL,
        30000000,
        '{}'
      );
  `);
  await db.exec(sharedApprovalSql);
  await db.exec(planChangeSql);
  await db.exec(`
    ALTER TABLE public.wedding_journeys ENABLE ROW LEVEL SECURITY;
    CREATE POLICY plan_test_member_select
      ON public.wedding_journeys
      FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id));
    GRANT SELECT ON public.wedding_journeys TO authenticated;
  `);
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

async function submit(
  db: PGlite,
  options: {
    coupleId?: string;
    actorId?: string;
    revision?: number;
    changes?: Record<string, unknown>;
    surface?: "/schedule" | "/budget" | "/dashboard";
    summary?: string;
  } = {},
) {
  const result = await db.query<{ result: PlanChangeResult }>(
    `SELECT public.submit_couple_plan_change(
       $1, $2, $3, $4::jsonb, $5, $6
     ) AS result`,
    [
      options.coupleId ?? COUPLE_ID,
      options.actorId ?? BRIDE_ID,
      options.revision ?? 0,
      JSON.stringify(options.changes ?? { total_budget: 60_000_000 }),
      options.surface ?? "/budget",
      options.summary ?? "총예산을 6천만원으로 변경해요.",
    ],
  );
  return result.rows[0].result;
}

async function accept(
  db: PGlite,
  requestId: string,
  actorId = GROOM_ID,
  coupleId = COUPLE_ID,
) {
  const result = await db.query<{ result: PlanChangeResult }>(
    "SELECT public.accept_couple_plan_change($1, $2, $3) AS result",
    [requestId, coupleId, actorId],
  );
  return result.rows[0].result;
}

async function status(
  db: PGlite,
  requestId: string,
  actorId = BRIDE_ID,
  coupleId = COUPLE_ID,
) {
  const result = await db.query<{ result: PlanChangeResult }>(
    "SELECT public.get_couple_plan_change_status($1, $2, $3) AS result",
    [requestId, coupleId, actorId],
  );
  return result.rows[0].result;
}

async function reject(
  db: PGlite,
  requestId: string,
  actorId = GROOM_ID,
  coupleId = COUPLE_ID,
) {
  const result = await db.query<{ result: PlanChangeResult }>(
    "SELECT public.reject_couple_plan_change($1, $2, $3) AS result",
    [requestId, coupleId, actorId],
  );
  return result.rows[0].result;
}

describe("couple plan-change write-boundary migration", () => {
  it("installs a separate fail-closed trigger and service-only durable RPCs", () => {
    expect(planChangeSql.trimStart()).toMatch(/^BEGIN;/);
    expect(planChangeSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(planChangeSql).toContain(
      "CREATE TABLE public.couple_plan_change_requests",
    );
    expect(planChangeSql).toContain(
      "CREATE TABLE public.couple_plan_change_acceptances",
    );
    expect(planChangeSql).toContain(
      "couple_plan_change_has_unsafe_display_text",
    );
    expect(planChangeSql).toContain(
      "CREATE UNIQUE INDEX couple_plan_change_submit_idempotency_idx",
    );
    expect(planChangeSql).toMatch(
      /couple_plan_change_submit_idempotency_idx[\s\S]+roster_fingerprint[\s\S]+WHERE status <> 'stale'/,
    );
    expect(planChangeSql).toContain(
      "CREATE UNIQUE INDEX couple_plan_change_one_active_high_impact_idx",
    );
    expect(planChangeSql).toMatch(
      /CREATE TRIGGER trg_00_enforce_couple_plan_change_write_boundary[\s\S]+BEFORE INSERT OR UPDATE ON public\.wedding_journeys/,
    );
    expect(planChangeSql).toContain(
      "DROP POLICY IF EXISTS journeys_insert_couple ON public.wedding_journeys",
    );
    expect(planChangeSql).toMatch(
      /REVOKE INSERT ON TABLE public\.wedding_journeys\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(planChangeSql).toContain(
      "DROP POLICY IF EXISTS journeys_update_couple ON public.wedding_journeys",
    );
    expect(planChangeSql).toMatch(
      /REVOKE UPDATE ON TABLE public\.wedding_journeys\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(planChangeSql).toContain(
      "'hanbang.amora_shared_action_operation_key'",
    );
    expect(planChangeSql).toContain(
      "'hanbang.couple_plan_change_digest'",
    );
    const directWriteGuard = planChangeSql.indexOf(
      "IF auth.role() IS DISTINCT FROM 'service_role'",
      planChangeSql.indexOf(
        "CREATE OR REPLACE FUNCTION public.enforce_couple_plan_change_write_boundary",
      ),
    );
    const coupleLock = planChangeSql.indexOf(
      "FOR SHARE;",
      directWriteGuard,
    );
    expect(directWriteGuard).toBeGreaterThan(-1);
    expect(coupleLock).toBeGreaterThan(directWriteGuard);
    expect(planChangeSql.slice(directWriteGuard, coupleLock)).toContain(
      "COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED",
    );
    expect(planChangeSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.submit_couple_plan_change[\s\S]+authenticated/,
    );
    expect(planChangeSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.submit_couple_plan_change[\s\S]+TO service_role/,
    );
    expect(planChangeSql).not.toMatch(
      /RENAME TO apply_amora_atomic_tool_execution/,
    );
  });

  it("blocks direct linked high-impact writes for postgres, service role, and authenticated members", async () => {
    const db = await createDatabase();
    try {
      await expect(db.query(
        "UPDATE public.wedding_journeys SET total_budget = 60000000 WHERE couple_id = $1",
        [COUPLE_ID],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);

      await setPersona(db, "service_role");
      await expect(db.query(
        "UPDATE public.wedding_journeys SET venue = '새 예식장' WHERE couple_id = $1",
        [COUPLE_ID],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);
      await expect(db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(progress, '{venue,payer}', '"bride"', false)
         WHERE couple_id = $1`,
        [COUPLE_ID],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);
      await expect(db.query(
        `UPDATE public.wedding_journeys
         SET progress = progress - 'venue'
         WHERE couple_id = $1`,
        [COUPLE_ID],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);

      await resetPersona(db);
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(
        "UPDATE public.wedding_journeys SET wedding_date = '2027-05-02' WHERE couple_id = $1",
        [COUPLE_ID],
      )).rejects.toThrow(/permission denied|row-level security/i);
      await expect(db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           progress, '{checklist}', '{"status":"done"}', true
         )
         WHERE couple_id = $1`,
        [COUPLE_ID],
      )).rejects.toThrow(/permission denied|row-level security/i);

      await resetPersona(db);
      await setPersona(db, "service_role");
      const unchanged = await db.query<{
        total_budget: number;
        venue: string;
        state_revision: number;
      }>(
        `SELECT total_budget::integer, venue, state_revision::integer
         FROM public.wedding_journeys WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      expect(unchanged.rows[0]).toEqual({
        total_budget: 50_000_000,
        venue: "기존 예식장",
        state_revision: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows only a service-owned neutral journey bootstrap before the plan RPC", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await db.query(
        "DELETE FROM public.wedding_journeys WHERE couple_id = $1",
        [SOLO_COUPLE_ID],
      );

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      await expect(
        db.query(
          `INSERT INTO public.wedding_journeys(
             couple_id, wedding_date, total_budget, progress
           ) VALUES ($1, '2027-07-01', 40000000, '{}'::jsonb)`,
          [SOLO_COUPLE_ID],
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(
        db.query(
          `INSERT INTO public.wedding_journeys(
             couple_id, wedding_date, total_budget, progress
           ) VALUES ($1, '2027-07-01', 40000000, '{}'::jsonb)`,
          [SOLO_COUPLE_ID],
        ),
      ).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);

      await db.query(
        `INSERT INTO public.wedding_journeys(
           couple_id, wedding_date, venue, total_budget, progress
         ) VALUES ($1, NULL, NULL, 0, '{}'::jsonb)`,
        [SOLO_COUPLE_ID],
      );
      const neutral = await db.query<{
        wedding_date: string | null;
        venue: string | null;
        total_budget: number;
        progress: Record<string, unknown>;
        state_revision: number;
      }>(
        `SELECT wedding_date::text, venue, total_budget::integer, progress,
                state_revision::integer
         FROM public.wedding_journeys
         WHERE couple_id = $1`,
        [SOLO_COUPLE_ID],
      );
      expect(neutral.rows[0]).toEqual({
        wedding_date: null,
        venue: null,
        total_budget: 0,
        progress: {},
        state_revision: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("routes a complete Amora marker set to the existing fully validated atomic guard", async () => {
    const db = await createDatabase();
    try {
      const toolInput = { total_budget: 65_000_000 };
      const identity = getAmoraToolOperationIdentity(
        "update_budget",
        toolInput,
      );
      const issuedAt = Date.now();
      const action = {
        version: 2,
        actionId: AMORA_ACTION_ID,
        tool: "update_budget",
        input: toolInput,
        inputDigest: identity.inputDigest,
        operationKey: identity.operationKey,
        confirmation: "총예산 변경을 함께 확인해 주세요.",
        issuedAt,
        expiresAt: issuedAt + 24 * 60 * 60 * 1_000,
      };

      await db.query(
        `INSERT INTO public.chat_messages(
           id, couple_id, sender_id, sender_type, role, content, metadata,
           visibility, created_at
         ) VALUES (
           $1, $2, NULL, 'ai', 'assistant', 'proposal',
           jsonb_build_object(
             'pending_amora_action', $3::jsonb,
             'pending_amora_action_journey_revision', 0
           ),
           'shared', clock_timestamp()
         )`,
        [AMORA_SOURCE_ID, COUPLE_ID, JSON.stringify(action)],
      );
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.accept_amora_shared_action($1, $2, $3, $4)",
        [AMORA_ACTION_ID, COUPLE_ID, AMORA_SOURCE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.accept_amora_shared_action($1, $2, $3, $4)",
        [AMORA_ACTION_ID, COUPLE_ID, AMORA_SOURCE_ID, GROOM_ID],
      );
      await db.query(
        "SELECT public.claim_amora_shared_action_application($1, $2, $3, $4)",
        [AMORA_ACTION_ID, COUPLE_ID, AMORA_SOURCE_ID, GROOM_ID],
      );

      await resetPersona(db);
      await db.query(
        `INSERT INTO public.chat_messages(
           id, couple_id, sender_id, sender_type, role, content, metadata,
           visibility, created_at
         ) VALUES (
           $1, $2, $3, 'groom', 'user', 'apply',
           jsonb_build_object(
             'confirmed_amora_action_id', $4::text
           ),
           'shared', clock_timestamp() + interval '1 second'
         )`,
        [AMORA_CONFIRMATION_ID, COUPLE_ID, GROOM_ID, AMORA_ACTION_ID],
      );
      await setPersona(db, "service_role");
      await db.query(
        `INSERT INTO public.amora_chat_request_claims(
           couple_id, request_key, user_id, visibility, status,
           user_message_id
         ) VALUES ($1, 'plan-boundary-amora', $2, 'shared', 'processing', $3)`,
        [COUPLE_ID, GROOM_ID, AMORA_CONFIRMATION_ID],
      );
      await db.query(
        `INSERT INTO public.amora_tool_executions(
           couple_id, request_key, operation_key, tool_name, input_digest,
           status, pending_action_id, pending_action_journey_revision
         ) VALUES (
           $1, 'plan-boundary-amora', $2, 'update_budget', $3,
           'processing', $4, 0
         )`,
        [
          COUPLE_ID,
          identity.operationKey,
          identity.inputDigest,
          AMORA_ACTION_ID,
        ],
      );
      const result = {
        toolName: "update_budget",
        toolOutput: {
          total_budget: 65_000_000,
          previous_budget: 50_000_000,
        },
        success: true,
        displayMessage: "applied",
      };
      await db.query(
        `SELECT public.apply_amora_atomic_tool_execution(
           $1, 'plan-boundary-amora', $2, 1, $3,
           $4::jsonb, $5::jsonb, $6::jsonb
         )`,
        [
          COUPLE_ID,
          identity.operationKey,
          identity.inputDigest,
          JSON.stringify(toolInput),
          JSON.stringify({
            kind: "journey_total_budget_cas",
            expected: 50_000_000,
            value: 65_000_000,
          }),
          JSON.stringify(result),
        ],
      );

      const journey = await db.query<{
        total_budget: number;
        state_revision: number;
      }>(
        `SELECT total_budget::integer, state_revision::integer
         FROM public.wedding_journeys WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      expect(journey.rows[0]).toEqual({
        total_budget: 65_000_000,
        state_revision: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("applies a solo mixed high-impact change immediately with a 1/1 receipt", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await expect(submit(db, {
        coupleId: SOLO_COUPLE_ID,
        actorId: BRIDE_ID,
        changes: { total_budget: 40_000_000 },
      })).rejects.toThrow(/COUPLE_PLAN_CHANGE_SCOPE_DENIED/);

      const result = await submit(db, {
        coupleId: SOLO_COUPLE_ID,
        actorId: OUTSIDER_ID,
        changes: {
          total_budget: 40_000_000,
          progress_patch: {
            checklist: {
              status: "in_progress",
              spent: 1_000_000,
            },
            __preferences: {
              weddingStyle: "classic",
            },
          },
        },
        summary: "총예산을 4천만원으로 변경해요.",
      });

      expect(result).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        isHighImpact: true,
        appliedRevision: 1,
        journey: {
          couple_id: SOLO_COUPLE_ID,
          state_revision: 1,
          total_budget: 40_000_000,
          progress: {
            checklist: {
              status: "in_progress",
              spent: 1_000_000,
            },
            __preferences: {
              weddingStyle: "classic",
            },
          },
        },
      });
      expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);

      const audit = await db.query<{
        acceptances: number;
        notifications: number;
        applied: boolean;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.couple_plan_change_acceptances
            WHERE request_id = $1) AS acceptances,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $1) AS notifications,
           (SELECT applied_at IS NOT NULL
            FROM public.couple_plan_change_requests
            WHERE id = $1) AS applied`,
        [result.requestId],
      );
      expect(audit.rows[0]).toEqual({
        acceptances: 1,
        notifications: 0,
        applied: true,
      });

      await expect(status(
        db,
        result.requestId,
        BRIDE_ID,
        SOLO_COUPLE_ID,
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_SCOPE_DENIED/);
      await expect(accept(
        db,
        result.requestId,
        BRIDE_ID,
        SOLO_COUPLE_ID,
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_SCOPE_DENIED/);
      await expect(reject(
        db,
        result.requestId,
        BRIDE_ID,
        SOLO_COUPLE_ID,
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_SCOPE_DENIED/);

      await db.query(
        `UPDATE public.couple_plan_change_requests
         SET status = 'applying',
             applying_at = clock_timestamp(),
             applied_at = NULL,
             applied_by_user_id = NULL,
             applied_revision = NULL
         WHERE id = $1`,
        [result.requestId],
      );
      await db.exec("RESET ROLE");
      await expect(db.query(
        "SELECT public.apply_couple_plan_change_locked($1, $2)",
        [result.requestId, BRIDE_ID],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_SCOPE_DENIED/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps a linked 1/2 request unchanged, reuses duplicate submit, and applies 2/2 exactly once", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);
      expect(pending).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        isHighImpact: true,
        journey: null,
      });

      const unchanged = await db.query<{
        total_budget: number;
        state_revision: number;
      }>(
        `SELECT total_budget::integer, state_revision::integer
         FROM public.wedding_journeys WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      expect(unchanged.rows[0]).toEqual({
        total_budget: 50_000_000,
        state_revision: 0,
      });

      const duplicate = await submit(db);
      expect(duplicate.requestId).toBe(pending.requestId);
      const deduped = await db.query<{
        requests: number;
        partner_cards: number;
        initiator_cards: number;
        notifications: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.couple_plan_change_requests
            WHERE couple_id = $1 AND status = 'pending') AS requests,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2
              AND recipient_user_id = '${GROOM_ID}'
              AND actor_user_id = '${BRIDE_ID}'
              AND event_kind = 'approval_requested'
              AND message = '총예산: 50000000원 → 60000000원'
              AND href = '/budget') AS partner_cards,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2
              AND recipient_user_id = '${BRIDE_ID}'
              AND actor_user_id = '${BRIDE_ID}'
              AND event_kind = 'approval_pending'
              AND message = '총예산: 50000000원 → 60000000원'
              AND href = '/budget') AS initiator_cards,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2) AS notifications`,
        [COUPLE_ID, pending.requestId],
      );
      expect(deduped.rows[0]).toEqual({
        requests: 1,
        partner_cards: 1,
        initiator_cards: 1,
        notifications: 2,
      });

      await db.query(
        `UPDATE public.couple_change_notifications
         SET read_at = clock_timestamp()
         WHERE action_id = $1
           AND recipient_user_id = $2
           AND event_kind = 'approval_pending'`,
        [pending.requestId, BRIDE_ID],
      );

      const applied = await accept(db, pending.requestId);
      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 2,
        acceptedCount: 2,
        appliedRevision: 1,
        journey: {
          couple_id: COUPLE_ID,
          total_budget: 60_000_000,
          state_revision: 1,
        },
      });

      const retry = await accept(db, pending.requestId);
      expect(retry).toMatchObject({
        status: "applied",
        acceptedCount: 2,
        appliedRevision: 1,
      });
      const exactOnce = await db.query<{
        state_revision: number;
        change_notifications: number;
        acceptance_count: number;
        decision_terminal_read: number;
        counterparty_terminal_unread: number;
        pending_cards: number;
      }>(
        `SELECT journey.state_revision::integer,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2 AND event_kind = 'change_applied')
              AS change_notifications,
           (SELECT count(*)::integer
            FROM public.couple_plan_change_acceptances
            WHERE request_id = $2) AS acceptance_count,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2
              AND recipient_user_id = '${GROOM_ID}'
              AND actor_user_id = '${GROOM_ID}'
              AND event_kind = 'change_applied'
              AND read_at IS NOT NULL) AS decision_terminal_read,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2
              AND recipient_user_id = '${BRIDE_ID}'
              AND actor_user_id = '${GROOM_ID}'
              AND event_kind = 'change_applied'
              AND read_at IS NULL) AS counterparty_terminal_unread,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2
              AND event_kind IN (
                'approval_requested', 'approval_pending'
              )) AS pending_cards
         FROM public.wedding_journeys AS journey
         WHERE journey.couple_id = $1`,
        [COUPLE_ID, pending.requestId],
      );
      expect(exactOnce.rows[0]).toEqual({
        state_revision: 1,
        change_notifications: 2,
        acceptance_count: 2,
        decision_terminal_read: 1,
        counterparty_terminal_unread: 1,
        pending_cards: 0,
      });

      const submitReplay = await submit(db);
      expect(submitReplay).toMatchObject({
        requestId: pending.requestId,
        status: "applied",
        appliedRevision: 1,
        journey: {
          couple_id: COUPLE_ID,
          state_revision: 1,
          total_budget: 60_000_000,
        },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a distinct active linked high-impact request without stacking cards", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const first = await submit(db);
      await expect(submit(db, {
        actorId: GROOM_ID,
        changes: { venue: "다른 예식장" },
        surface: "/schedule",
        summary: "예식장을 변경해요.",
      })).rejects.toThrow(/COUPLE_PLAN_CHANGE_ACTIVE_REQUEST/);
      const counts = await db.query<{ requests: number; notifications: number }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.couple_plan_change_requests
            WHERE couple_id = $1 AND status = 'pending'
              AND is_high_impact) AS requests,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $2
              AND event_kind = 'approval_requested') AS notifications`,
        [COUPLE_ID, first.requestId],
      );
      expect(counts.rows[0]).toEqual({ requests: 1, notifications: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("derives the exact protected progress delta for informed approval", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db, {
        changes: {
          progress_patch: {
            venue: {
              label: "예식장",
              status: "in_progress",
              budget: 12_000_000,
              payer: "bride",
              responsibility: "bride",
            },
          },
        },
        summary: "예식장 예산 정보를 바꿔요.",
      });
      const exact =
        "예식장 예산: 10000000원 → 12000000원 · 예식장 부담: 두 사람 → 예비 신부 · 예식장 책임: 미정 → 예비 신부";
      expect(pending).toMatchObject({
        status: "pending_partner",
        summary: exact,
      });
      const stored = await db.query<{ summary: string; message: string }>(
        `SELECT request.summary, notification.message
         FROM public.couple_plan_change_requests AS request
         JOIN public.couple_change_notifications AS notification
           ON notification.action_id = request.id
          AND notification.event_kind = 'approval_requested'
         WHERE request.id = $1`,
        [pending.requestId],
      );
      expect(stored.rows[0]).toEqual({ summary: exact, message: exact });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects linked high-impact requests with undisclosed routine progress deltas", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const undisclosedChanges: Array<Record<string, unknown>> = [
        {
          total_budget: 60_000_000,
          progress_patch: {
            venue: {
              label: "예식장",
              status: "completed",
              spent: 11_000_000,
              budget: 12_000_000,
            },
          },
        },
        {
          total_budget: 60_000_000,
          progress_patch: {
            __preferences: {
              weddingStyle: "classic",
            },
          },
        },
        {
          total_budget: 60_000_000,
          progress_patch: {
            notes: {
              text: "상대방에게 보이지 않은 메모",
            },
          },
        },
        {
          total_budget: 60_000_000,
          progress_patch: {
            notes: {
              label: "숨은 새 이름",
            },
          },
        },
        {
          total_budget: 60_000_000,
          progress_patch: {
            notes: {
              name: "숨은 새 이름",
            },
          },
        },
        {
          total_budget: 60_000_000,
          progress_patch: {
            notes: {
              category: "숨은 새 분류",
            },
          },
        },
        {
          total_budget: 60_000_000,
          progress_patch: {
            __events: [
              {
                id: "hidden-memo-event",
                date: "2027-03-01",
                title: "가족 일정",
                memo: "상대방에게 공개되지 않은 메모",
                momentType: "family",
                createdAt: "2027-03-01T00:00:00.000Z",
                updatedAt: "2027-03-01T00:00:00.000Z",
              },
            ],
          },
        },
        {
          total_budget: 60_000_000,
          progress_patch: {
            __events: [
              {
                id: "hidden-field-event",
                date: "2027-03-01",
                title: "가족 일정",
                privateNote: "요약되지 않은 임의 필드",
                momentType: "family",
                createdAt: "2027-03-01T00:00:00.000Z",
                updatedAt: "2027-03-01T00:00:00.000Z",
              },
            ],
          },
        },
        {
          total_budget: 60_000_000,
          progress_remove_keys: ["venue"],
        },
      ];

      for (const changes of undisclosedChanges) {
        await expect(
          submit(db, {
            changes,
            summary: "총예산과 준비 현황을 함께 변경해요.",
          }),
        ).rejects.toThrow(/COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/);
      }

      const counts = await db.query<{
        requests: number;
        notifications: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.couple_plan_change_requests) AS requests,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications) AS notifications`,
      );
      expect(counts.rows[0]).toEqual({ requests: 0, notifications: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("discloses an appended schedule event in the approval request and notification", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const event = {
        id: "onboarding:sanggyeonrye:2027-03-01",
        date: "2027-03-01",
        title: "양쪽 부모님 첫 만남",
        sourceKey: "onboarding:sanggyeonrye",
        momentType: "sanggyeonrye",
        createdAt: "2027-03-01T00:00:00.000Z",
        updatedAt: "2027-03-01T00:00:00.000Z",
      };
      const pending = await submit(db, {
        changes: {
          total_budget: 60_000_000,
          progress_patch: { __events: [event] },
        },
        surface: "/dashboard",
        summary: "온보딩 계획을 변경해요.",
      });
      const exact =
        "총예산: 50000000원 → 60000000원 · 일정 추가: 양쪽 부모님 첫 만남 (2027-03-01)";

      expect(pending).toMatchObject({
        status: "pending_partner",
        summary: exact,
      });
      const stored = await db.query<{ summary: string; message: string }>(
        `SELECT request.summary, notification.message
         FROM public.couple_plan_change_requests AS request
         JOIN public.couple_change_notifications AS notification
           ON notification.action_id = request.id
          AND notification.event_kind = 'approval_requested'
         WHERE request.id = $1`,
        [pending.requestId],
      );
      expect(stored.rows[0]).toEqual({ summary: exact, message: exact });

      const applied = await accept(db, pending.requestId);
      expect(applied).toMatchObject({
        status: "applied",
        journey: {
          state_revision: 1,
          total_budget: 60_000_000,
          progress: {
            __events: [event],
          },
        },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects event deltas that cannot be represented exactly in the approval summary", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const event = (id: string, date: string) => ({
        id,
        date,
        title: "가족 일정",
        momentType: "family",
        createdAt: `${date}T00:00:00.000Z`,
        updatedAt: `${date}T00:00:00.000Z`,
      });

      await expect(
        submit(db, {
          changes: {
            total_budget: 60_000_000,
            progress_patch: {
              __events: [
                event("event-1", "2027-03-01"),
                event("event-2", "2027-03-02"),
              ],
            },
          },
          surface: "/dashboard",
          summary: "여러 일정을 함께 변경해요.",
        }),
      ).rejects.toThrow(/COUPLE_PLAN_CHANGE_UNSUPPORTED_EVENT_DELTA/);

      const counts = await db.query<{
        requests: number;
        notifications: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.couple_plan_change_requests) AS requests,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications) AS notifications`,
      );
      expect(counts.rows[0]).toEqual({ requests: 0, notifications: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects invisible display-direction spoofing before creating any receipt", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await expect(
        submit(db, {
          changes: { venue: "정상\u202e000000001원" },
          surface: "/schedule",
          summary: "예식장을 변경해요.",
        }),
      ).rejects.toThrow(/COUPLE_PLAN_CHANGE_INVALID_INPUT/);
      await expect(
        submit(db, {
          changes: {
            progress_patch: {
              checklist: { status: "completed" },
            },
          },
          summary: "체크리스트\u2066를 변경해요.",
        }),
      ).rejects.toThrow(/COUPLE_PLAN_CHANGE_INVALID_INPUT/);

      const counts = await db.query<{
        requests: number;
        notifications: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.couple_plan_change_requests) AS requests,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications) AS notifications`,
      );
      expect(counts.rows[0]).toEqual({
        requests: 0,
        notifications: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("marks a pending request stale when the journey revision changes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);

      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           progress, '{checklist}', '{"status":"done"}', true
         )
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      const stale = await accept(db, pending.requestId);
      expect(stale).toMatchObject({
        status: "stale",
        requiredCount: 2,
        acceptedCount: 1,
        journey: null,
      });
      const staleRetry = await accept(db, pending.requestId);
      expect(staleRetry).toMatchObject({
        status: "stale",
        requestId: pending.requestId,
      });

      const state = await db.query<{
        total_budget: number;
        state_revision: number;
        stale_reason: string;
        terminal_notifications: number;
        processor_terminal_read: number;
        other_terminal_unread: number;
        pending_cards: number;
      }>(
        `SELECT journey.total_budget::integer,
                journey.state_revision::integer,
                request.stale_reason,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind = 'change_stale')
                  AS terminal_notifications,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${GROOM_ID}'
                   AND actor_user_id = '${GROOM_ID}'
                   AND event_kind = 'change_stale'
                   AND read_at IS NOT NULL)
                  AS processor_terminal_read,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${BRIDE_ID}'
                   AND actor_user_id = '${GROOM_ID}'
                   AND event_kind = 'change_stale'
                   AND read_at IS NULL)
                  AS other_terminal_unread,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind IN (
                     'approval_requested', 'approval_pending'
                   ))
                  AS pending_cards
         FROM public.wedding_journeys AS journey
         JOIN public.couple_plan_change_requests AS request
           ON request.couple_id = journey.couple_id
         WHERE request.id = $1`,
        [pending.requestId],
      );
      expect(state.rows[0]).toEqual({
        total_budget: 50_000_000,
        state_revision: 1,
        stale_reason: "revision_changed",
        terminal_notifications: 2,
        processor_terminal_read: 1,
        other_terminal_unread: 1,
        pending_cards: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("expires a pending request and terminalizes its approval card", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);
      await db.query(
        `UPDATE public.couple_plan_change_requests
         SET created_at = clock_timestamp() - interval '2 days',
             actor_accepted_at = clock_timestamp() - interval '2 days',
             expires_at = clock_timestamp() - interval '1 day'
         WHERE id = $1`,
        [pending.requestId],
      );

      const expired = await status(db, pending.requestId, GROOM_ID);
      expect(expired).toMatchObject({
        status: "stale",
        requiredCount: 2,
        acceptedCount: 1,
        journey: null,
      });
      const expiredRetry = await status(db, pending.requestId, GROOM_ID);
      expect(expiredRetry).toMatchObject({
        status: "stale",
        requestId: pending.requestId,
      });
      const terminal = await db.query<{
        stale_reason: string;
        terminal_notifications: number;
        processor_terminal_read: number;
        other_terminal_unread: number;
        pending_cards: number;
      }>(
        `SELECT request.stale_reason,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind = 'change_stale')
                  AS terminal_notifications,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${GROOM_ID}'
                   AND actor_user_id = '${GROOM_ID}'
                   AND event_kind = 'change_stale'
                   AND read_at IS NOT NULL)
                  AS processor_terminal_read,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${BRIDE_ID}'
                   AND actor_user_id = '${GROOM_ID}'
                   AND event_kind = 'change_stale'
                   AND read_at IS NULL)
                  AS other_terminal_unread,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind IN (
                     'approval_requested', 'approval_pending'
                   ))
                  AS pending_cards
         FROM public.couple_plan_change_requests AS request
         WHERE request.id = $1`,
        [pending.requestId],
      );
      expect(terminal.rows[0]).toEqual({
        stale_reason: "expired",
        terminal_notifications: 2,
        processor_terminal_read: 1,
        other_terminal_unread: 1,
        pending_cards: 0,
      });

      const retried = await submit(db);
      expect(retried).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
      });
      expect(retried.requestId).not.toBe(pending.requestId);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("invalidates a roster-bound request without disclosing it to a replacement partner", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);

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

      const stale = await status(db, pending.requestId, BRIDE_ID);
      expect(stale).toMatchObject({
        status: "stale",
        acceptedCount: 1,
        journey: null,
      });
      const audit = await db.query<{
        stale_reason: string;
        total_budget: number;
        acceptance_count: number;
        terminal_notifications: number;
        initiator_terminal_read: number;
        original_partner_terminal_unread: number;
        replacement_partner_notifications: number;
      }>(
        `SELECT request.stale_reason,
                journey.total_budget::integer,
                (SELECT count(*)::integer
                 FROM public.couple_plan_change_acceptances
                 WHERE request_id = request.id) AS acceptance_count,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind = 'change_stale')
                  AS terminal_notifications,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${BRIDE_ID}'
                   AND actor_user_id = '${BRIDE_ID}'
                   AND event_kind = 'change_stale'
                   AND read_at IS NOT NULL)
                  AS initiator_terminal_read,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${GROOM_ID}'
                   AND actor_user_id = '${BRIDE_ID}'
                   AND event_kind = 'change_stale'
                   AND read_at IS NULL)
                  AS original_partner_terminal_unread,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${NEW_GROOM_ID}')
                  AS replacement_partner_notifications
         FROM public.couple_plan_change_requests AS request
         JOIN public.wedding_journeys AS journey
           ON journey.couple_id = request.couple_id
         WHERE request.id = $1`,
        [pending.requestId],
      );
      expect(audit.rows[0]).toEqual({
        stale_reason: "roster_changed",
        total_budget: 50_000_000,
        acceptance_count: 1,
        terminal_notifications: 2,
        initiator_terminal_read: 1,
        original_partner_terminal_unread: 1,
        replacement_partner_notifications: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("allows the remaining member to resubmit the same stale intent as a fresh 1/1 request", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);

      await db.query(
        "UPDATE public.profiles SET couple_id = NULL, role = NULL WHERE id = $1",
        [GROOM_ID],
      );
      await db.query(
        "UPDATE public.couples SET groom_id = NULL WHERE id = $1",
        [COUPLE_ID],
      );

      const retried = await submit(db);
      expect(retried).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        appliedRevision: 1,
        journey: {
          couple_id: COUPLE_ID,
          total_budget: 60_000_000,
          state_revision: 1,
        },
      });
      expect(retried.requestId).not.toBe(pending.requestId);

      const old = await status(db, pending.requestId);
      expect(old).toMatchObject({
        status: "stale",
        acceptedCount: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("applies a routine patch immediately, notifies only the partner, and preserves exact copy", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const summary = "체크리스트 메모 상태를 완료로 바꿨어요.";
      const applied = await submit(db, {
        changes: {
          progress_patch: {
            checklist: { status: "completed", note: "전화 확인" },
          },
          progress_remove_keys: [],
        },
        surface: "/dashboard",
        summary,
      });
      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        isHighImpact: false,
        appliedRevision: 1,
        journey: {
          couple_id: COUPLE_ID,
          state_revision: 1,
          progress: {
            checklist: { status: "completed", note: "전화 확인" },
          },
        },
      });

      const replay = await submit(db, {
        changes: {
          progress_patch: {
            checklist: { status: "completed", note: "전화 확인" },
          },
          progress_remove_keys: [],
        },
        surface: "/dashboard",
        summary,
      });
      expect(replay).toMatchObject({
        requestId: applied.requestId,
        status: "applied",
        appliedRevision: 1,
        journey: {
          couple_id: COUPLE_ID,
          state_revision: 1,
        },
      });

      await resetPersona(db);
      await setPersona(db, "authenticated", GROOM_ID);
      const partnerRows = await db.query<{
        action_id: string;
        event_kind: string;
        tool_name: string;
        message: string;
        href: string;
      }>(
        `SELECT action_id::text, event_kind, tool_name, message, href
         FROM public.couple_change_notifications`,
      );
      expect(partnerRows.rows).toEqual([{
        action_id: applied.requestId,
        event_kind: "change_applied",
        tool_name: "manual_plan_change",
        message: summary,
        href: "/dashboard",
      }]);

      await resetPersona(db);
      await setPersona(db, "authenticated", BRIDE_ID);
      expect((await db.query(
        "SELECT id FROM public.couple_change_notifications",
      )).rows).toHaveLength(0);

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      expect((await db.query(
        "SELECT id FROM public.couple_change_notifications",
      )).rows).toHaveLength(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("does not let pending or applied plan receipts block Auth account deletion", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);
      const applied = await submit(db, {
        coupleId: SOLO_COUPLE_ID,
        actorId: OUTSIDER_ID,
        changes: { total_budget: 40_000_000 },
        summary: "총예산을 4천만원으로 변경해요.",
      });
      expect(pending.status).toBe("pending_partner");
      expect(applied.status).toBe("applied");

      await db.exec("RESET ROLE");
      await db.query(
        "DELETE FROM auth.users WHERE id IN ($1, $2)",
        [BRIDE_ID, OUTSIDER_ID],
      );

      const remaining = await db.query<{
        users: number;
        requests: number;
        acceptances: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM auth.users
            WHERE id IN ($1, $2)) AS users,
           (SELECT count(*)::integer
            FROM public.couple_plan_change_requests
            WHERE id IN ($3, $4)) AS requests,
           (SELECT count(*)::integer
            FROM public.couple_plan_change_acceptances
            WHERE request_id IN ($3, $4)) AS acceptances`,
        [BRIDE_ID, OUTSIDER_ID, pending.requestId, applied.requestId],
      );
      expect(remaining.rows[0]).toEqual({
        users: 0,
        requests: 0,
        acceptances: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a pending high-impact request durably without applying it", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);
      const rejected = await reject(db, pending.requestId);
      expect(rejected).toMatchObject({
        status: "rejected",
        requiredCount: 2,
        acceptedCount: 1,
        journey: null,
      });

      const retry = await accept(db, pending.requestId);
      expect(retry).toMatchObject({
        status: "rejected",
        acceptedCount: 1,
      });
      const submitReplay = await submit(db);
      expect(submitReplay).toMatchObject({
        requestId: pending.requestId,
        status: "rejected",
        acceptedCount: 1,
      });
      const audit = await db.query<{
        total_budget: number;
        state_revision: number;
        rejected: boolean;
        applied_notifications: number;
        rejected_notifications: number;
        processor_terminal_read: number;
        other_terminal_unread: number;
        pending_cards: number;
      }>(
        `SELECT journey.total_budget::integer,
                journey.state_revision::integer,
                request.rejected_at IS NOT NULL AS rejected,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind = 'change_applied')
                  AS applied_notifications,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind = 'change_rejected')
                  AS rejected_notifications,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${GROOM_ID}'
                   AND actor_user_id = '${GROOM_ID}'
                   AND event_kind = 'change_rejected'
                   AND read_at IS NOT NULL)
                  AS processor_terminal_read,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND recipient_user_id = '${BRIDE_ID}'
                   AND actor_user_id = '${GROOM_ID}'
                   AND event_kind = 'change_rejected'
                   AND read_at IS NULL)
                  AS other_terminal_unread,
                (SELECT count(*)::integer
                 FROM public.couple_change_notifications
                 WHERE action_id = request.id
                   AND event_kind IN (
                     'approval_requested', 'approval_pending'
                   ))
                  AS pending_cards
         FROM public.couple_plan_change_requests AS request
         JOIN public.wedding_journeys AS journey
           ON journey.couple_id = request.couple_id
         WHERE request.id = $1`,
        [pending.requestId],
      );
      expect(audit.rows[0]).toEqual({
        total_budget: 50_000_000,
        state_revision: 0,
        rejected: true,
        applied_notifications: 0,
        rejected_notifications: 2,
        processor_terminal_read: 1,
        other_terminal_unread: 1,
        pending_cards: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps the partner terminal notification unread when the initiator cancels", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const pending = await submit(db);
      await db.query(
        `UPDATE public.couple_change_notifications
         SET read_at = clock_timestamp()
         WHERE action_id = $1
           AND recipient_user_id = $2
           AND event_kind = 'approval_requested'`,
        [pending.requestId, GROOM_ID],
      );
      await resetPersona(db);
      await setPersona(db, "authenticated", BRIDE_ID);
      const recovered = await db.query<{
        action_id: string;
        actor_user_id: string;
        event_kind: string;
        message: string;
        href: string;
      }>(
        `SELECT action_id::text, actor_user_id::text, event_kind, message, href
         FROM public.couple_change_notifications
         WHERE recipient_user_id = $1`,
        [BRIDE_ID],
      );
      expect(recovered.rows).toEqual([{
        action_id: pending.requestId,
        actor_user_id: BRIDE_ID,
        event_kind: "approval_pending",
        message: "총예산: 50000000원 → 60000000원",
        href: "/budget",
      }]);

      await resetPersona(db);
      await setPersona(db, "service_role");
      const recoveredRequestId = recovered.rows[0]?.action_id ?? "";
      expect(recoveredRequestId).toBe(pending.requestId);
      const rejected = await reject(db, recoveredRequestId, BRIDE_ID);
      expect(rejected).toMatchObject({
        status: "rejected",
        requiredCount: 2,
        acceptedCount: 1,
        journey: null,
      });
      const retry = await reject(db, recoveredRequestId, BRIDE_ID);
      expect(retry).toMatchObject({
        status: "rejected",
        requestId: pending.requestId,
      });

      const notifications = await db.query<{
        approval_cards: number;
        terminal_notifications: number;
        initiator_read_terminal: number;
        partner_unread_terminal: number;
        partner_read_terminal: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $1
              AND event_kind IN (
                'approval_requested', 'approval_pending'
              )) AS approval_cards,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $1
              AND event_kind = 'change_rejected') AS terminal_notifications,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $1
              AND recipient_user_id = $3
              AND actor_user_id = $3
              AND event_kind = 'change_rejected'
              AND read_at IS NOT NULL) AS initiator_read_terminal,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $1
              AND recipient_user_id = $2
              AND actor_user_id = $3
              AND event_kind = 'change_rejected'
              AND read_at IS NULL) AS partner_unread_terminal,
           (SELECT count(*)::integer
            FROM public.couple_change_notifications
            WHERE action_id = $1
              AND recipient_user_id = $2
              AND actor_user_id = $3
              AND event_kind = 'change_rejected'
              AND read_at IS NOT NULL) AS partner_read_terminal`,
        [pending.requestId, GROOM_ID, BRIDE_ID],
      );
      expect(notifications.rows[0]).toEqual({
        approval_cards: 0,
        terminal_notifications: 2,
        initiator_read_terminal: 1,
        partner_unread_terminal: 1,
        partner_read_terminal: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
