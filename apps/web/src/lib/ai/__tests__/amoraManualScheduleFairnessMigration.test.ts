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
const bookingProjectionSql = migration(
  "20260716102000_booking_projection_outbox.sql",
);
const planChangeSql = migration(
  "20260731123000_couple_plan_change_write_boundary.sql",
);
const sharedScheduleReceiptSql = migration(
  "20260802100000_amora_shared_schedule_decision_receipts.sql",
);
const manualScheduleSql = migration(
  "20260802140000_amora_manual_schedule_fairness.sql",
);
const bookingQuoteSpendSoftCancelSql = migration(
  "20260802160000_booking_quote_spend_soft_cancel.sql",
);
const bookingOutcomeProvenanceSql = migration(
  "20260816170000_amora_booking_outcome_provenance.sql",
);
const decisionNodeUpdatedAtClockSql = migration(
  "20260818180000_amora_decision_node_updated_at_clock.sql",
);
const budgetProgressIntegritySql = migration(
  "20260802200000_journey_budget_progress_integrity.sql",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const SOLO_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const SOLO_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const VENDOR_ID = "30000000-0000-4000-8000-000000000001";
const BOOKING_ID = "40000000-0000-4000-8000-000000000001";
const STALE_PROFILE_ID = "10000000-0000-4000-8000-000000000004";
const REPLACEMENT_SOLO_ID = "10000000-0000-4000-8000-000000000005";
const SHARED_PROPOSAL_ID = "50000000-0000-4000-8000-000000000001";
const SHARED_CONFIRMATION_ID = "50000000-0000-4000-8000-000000000002";
const SHARED_ACTION_ID = "60000000-0000-4000-8000-000000000001";

type PlanChangeResult = {
  requestId: string;
  status: "applied" | "pending_partner" | "stale" | "rejected";
  requiredCount: number;
  acceptedCount: number;
  isHighImpact: boolean;
  appliedRevision: number | null;
  summary: string;
  journey: {
    state_revision: number;
    progress: Record<string, unknown>;
  } | null;
};

function event(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    date: "2027-03-01",
    time: "14:00",
    title: "드레스 최종 피팅",
    memo: "수선 결과 확인",
    categoryKey: "dress",
    sourceKey: "manual",
    momentType: "dress_fitting",
    status: "planned",
    completionCriteria: "수선 결과를 확인하면 완료",
    assignee: { kind: "member", profileId: BRIDE_ID },
    createdAt: "2026-08-02T03:00:00.000Z",
    updatedAt: "2026-08-02T03:00:00.000Z",
    ...overrides,
  };
}

async function createDatabase(options: {
  coupleProgress?: Record<string, unknown>;
  soloProgress?: Record<string, unknown>;
  seedLegacyApplied?: boolean;
  seedLegacyScheduleApplied?: boolean;
} = {}) {
  const db = await PGlite.create();
  const coupleProgress = JSON.stringify(options.coupleProgress ?? {})
    .replaceAll("'", "''");
  const soloProgress = JSON.stringify(options.soloProgress ?? {})
    .replaceAll("'", "''");
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
    CREATE FUNCTION public.update_updated_at_column()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END
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
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text,
      category text,
      status text NOT NULL DEFAULT 'approved',
      owner_id uuid REFERENCES auth.users(id)
    );
    CREATE FUNCTION public.is_vendor_owner(p_vendor_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.vendors AS vendor
        WHERE vendor.id = p_vendor_id AND vendor.owner_id = auth.uid()
      )
    $$;
    CREATE TABLE public.vendor_products (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      name text NOT NULL,
      price numeric NOT NULL DEFAULT 0,
      discount_price numeric,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.vendor_staff (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      name text NOT NULL,
      role text,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.vendor_timeslots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      day smallint NOT NULL,
      hour smallint NOT NULL,
      available boolean NOT NULL DEFAULT true,
      max_bookings smallint NOT NULL DEFAULT 1,
      UNIQUE (vendor_id, day, hour)
    );
    CREATE TABLE public.product_timeslots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL REFERENCES public.vendor_products(id),
      day smallint NOT NULL,
      hour smallint NOT NULL,
      available boolean NOT NULL DEFAULT true,
      max_bookings smallint NOT NULL DEFAULT 1,
      UNIQUE (product_id, day, hour)
    );
    CREATE TABLE public.staff_timeslots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL REFERENCES public.vendor_staff(id),
      day smallint NOT NULL,
      hour smallint NOT NULL,
      available boolean NOT NULL DEFAULT true,
      max_bookings smallint NOT NULL DEFAULT 1,
      UNIQUE (staff_id, day, hour)
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      product_id uuid,
      staff_id uuid,
      booking_date date NOT NULL,
      booking_time time NOT NULL,
      booking_type text NOT NULL DEFAULT 'consultation',
      bride_name text DEFAULT '',
      groom_name text DEFAULT '',
      contact_phone text DEFAULT '',
      status text NOT NULL DEFAULT 'pending',
      amount numeric,
      actual_amount numeric,
      is_paid boolean NOT NULL DEFAULT false,
      memo text DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
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
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      category text,
      decision_type text CHECK (
        decision_type IN (
          'exploring', 'considering', 'decided', 'scheduled', 'booked',
          'completed'
        )
      ),
      title text,
      chosen_value jsonb,
      options_considered jsonb DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric(3,2),
      decided_at timestamptz,
      source text CHECK (
        source IN (
          'chat', 'manual', 'import', 'vendor_booking', 'schedule', 'budget',
          'onboarding', 'community'
        )
      ),
      source_ref_id uuid,
      source_message_id uuid REFERENCES public.chat_messages(id),
      source_actor_role text CHECK (
        source_actor_role IS NULL OR source_actor_role IN ('bride', 'groom')
      ),
      user_confirmed_at timestamptz,
      metadata jsonb DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX decision_nodes_booking_outcome_unique
      ON public.decision_nodes (couple_id, source_ref_id, source, decision_type)
      WHERE source = 'vendor_booking'
        AND decision_type = 'completed'
        AND source_ref_id IS NOT NULL;
    CREATE TRIGGER set_decision_nodes_updated_at
      BEFORE UPDATE ON public.decision_nodes
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    CREATE FUNCTION public.complete_vendor_booking_outcome(
      p_booking_id uuid,
      p_customer_id uuid,
      p_actual_amount numeric,
      p_contracted_amount numeric,
      p_rating integer,
      p_review text,
      p_share_public_review boolean
    )
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_booking public.vendor_bookings%ROWTYPE;
      v_vendor public.vendors%ROWTYPE;
      v_decision_id uuid;
      v_review_id uuid := gen_random_uuid();
    BEGIN
      UPDATE public.vendor_bookings
      SET status = 'completed',
          actual_amount = p_actual_amount,
          contracted_amount = p_contracted_amount,
          updated_at = now()
      WHERE id = p_booking_id
        AND couple_id = (
          SELECT profile.couple_id
          FROM public.profiles AS profile
          WHERE profile.id = p_customer_id
        )
      RETURNING * INTO v_booking;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'booking_outcome_not_found';
      END IF;
      SELECT * INTO v_vendor
      FROM public.vendors WHERE id = v_booking.vendor_id;
      INSERT INTO public.decision_nodes (
        couple_id, category, decision_type, title, chosen_value,
        source, source_ref_id, decided_at, user_confirmed_at, metadata
      ) VALUES (
        v_booking.couple_id,
        COALESCE(v_vendor.category, 'vendor'),
        'completed',
        '사용자 완료 기록',
        jsonb_build_object('actual_amount', p_actual_amount),
        'vendor_booking',
        v_booking.id,
        now(),
        now(),
        jsonb_build_object(
          'origin', 'test_outcome_stub',
          'hook', 'booking_outcome'
        )
      )
      ON CONFLICT (couple_id, source_ref_id, source, decision_type)
        WHERE source = 'vendor_booking'
          AND decision_type = 'completed'
          AND source_ref_id IS NOT NULL
      DO UPDATE SET
        chosen_value = EXCLUDED.chosen_value,
        decided_at = EXCLUDED.decided_at,
        user_confirmed_at = EXCLUDED.user_confirmed_at,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id INTO v_decision_id;
      RETURN jsonb_build_object(
        'booking', jsonb_build_object(
          'id', v_booking.id,
          'status', v_booking.status,
          'actual_amount', v_booking.actual_amount,
          'contracted_amount', v_booking.contracted_amount
        ),
        'review', jsonb_build_object(
          'id', v_review_id,
          'rating', p_rating,
          'content', p_review,
          'is_visible', p_share_public_review
        ),
        'decisionId', v_decision_id,
        'baselineAmount', COALESCE(p_contracted_amount, v_booking.amount, 0),
        'extraAmount', GREATEST(
          COALESCE(p_actual_amount, 0) - COALESCE(p_contracted_amount, v_booking.amount, 0),
          0
        ),
        'context', jsonb_build_object(
          'vendorId', v_vendor.id,
          'vendorName', v_vendor.name,
          'vendorCategory', v_vendor.category,
          'productId', v_booking.product_id,
          'productName', NULL
        )
      );
    END
    $$;
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
      SELECT public.is_current_couple_member(auth.uid(), p_couple_id)
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
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
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
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${SOLO_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${SOLO_COUPLE_ID}', '${SOLO_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${SOLO_ID}', '${SOLO_COUPLE_ID}', 'bride');
    INSERT INTO public.vendors(id, name, category) VALUES
      ('${VENDOR_ID}', 'Hanbang Studio', 'studio');
    INSERT INTO public.wedding_journeys(
      couple_id, wedding_date, venue, total_budget, progress
    ) VALUES
      (
        '${COUPLE_ID}', '2027-05-01', '기존 예식장', 50000000,
        '${coupleProgress}'::jsonb
      ),
      (
        '${SOLO_COUPLE_ID}', '2027-06-01', NULL, 30000000,
        '${soloProgress}'::jsonb
      );
  `);
  await db.exec(bookingProjectionSql);
  await db.exec(sharedApprovalSql);
  await db.exec(planChangeSql);
  await db.exec(sharedScheduleReceiptSql);
  if (options.seedLegacyApplied) {
    await setServiceRole(db);
    await db.query(
      `SELECT public.submit_couple_plan_change(
         $1, $2, 0, $3::jsonb, '/dashboard', $4
       )`,
      [
        COUPLE_ID,
        BRIDE_ID,
        JSON.stringify({
          progress_patch: {
            checklist: { status: "completed", note: "기존 적용 기록" },
          },
        }),
        "기존 체크리스트 변경을 적용했어요.",
      ],
    );
    await resetPersona(db);
  }
  if (options.seedLegacyScheduleApplied) {
    await setServiceRole(db);
    await db.query(
      `SELECT public.submit_couple_plan_change(
         $1, $2, $3, $4::jsonb, '/schedule', $5
       )`,
      [
        COUPLE_ID,
        BRIDE_ID,
        options.seedLegacyApplied ? 1 : 0,
        JSON.stringify({
          progress_patch: {
            ...(options.seedLegacyApplied
              ? {
                  checklist: {
                    status: "completed",
                    note: "기존 적용 기록",
                  },
                }
              : {}),
            __events: [{
              id: "legacy-schedule-event",
              date: "2027-03-01",
              title: "기존 수동 일정",
              createdAt: "2026-08-01T03:00:00.000Z",
              updatedAt: "2026-08-01T03:00:00.000Z",
            }],
          },
        }),
        "기존 수동 일정을 추가했어요.",
      ],
    );
    await resetPersona(db);
  }
  await db.exec(manualScheduleSql);
  await db.exec(bookingQuoteSpendSoftCancelSql);
  await db.exec(bookingOutcomeProvenanceSql);
  await db.exec(decisionNodeUpdatedAtClockSql);
  await db.exec(budgetProgressIntegritySql);
  return db;
}

async function setServiceRole(db: PGlite) {
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
}

async function seedLegacyBooking(
  db: PGlite,
  statement: string,
  params: readonly unknown[],
) {
  // Legacy fixtures model rows that existed before the service-role INSERT
  // fence. PostgreSQL-owner maintenance can seed them; application roles may
  // not mint vendor-visible rows after 1600.
  await resetPersona(db);
  await db.query(statement, [...params]);
  await setServiceRole(db);
}

async function seedProtectedBookingUpdate(
  db: PGlite,
  statement: string,
  params: readonly unknown[],
) {
  await resetPersona(db);
  await db.query(
    "ALTER TABLE public.vendor_bookings DISABLE TRIGGER trg_00_authorize_booking_protected_write",
  );
  try {
    await db.query(statement, [...params]);
  } finally {
    await db.query(
      "ALTER TABLE public.vendor_bookings ENABLE TRIGGER trg_00_authorize_booking_protected_write",
    );
  }
  await setServiceRole(db);
}

async function submit(
  db: PGlite,
  options: {
    coupleId?: string;
    actorId?: string;
    revision?: number;
    events?: Array<Record<string, unknown>>;
    changes?: Record<string, unknown>;
    summary?: string;
    surface?: "/schedule" | "/budget" | "/dashboard";
  } = {},
) {
  const changes = options.changes ?? {
    progress_patch: { __events: options.events ?? [event("event-1")] },
  };
  const result = await db.query<{ result: PlanChangeResult }>(
    `SELECT public.submit_couple_plan_change(
       $1, $2, $3, $4::jsonb, $5, $6
     ) AS result`,
    [
      options.coupleId ?? COUPLE_ID,
      options.actorId ?? BRIDE_ID,
      options.revision ?? 0,
      JSON.stringify(changes),
      options.surface ?? "/schedule",
      options.summary ?? "클라이언트가 보낸 임의 일정 요약",
    ],
  );
  return result.rows[0].result;
}

async function accept(db: PGlite, requestId: string) {
  const result = await db.query<{ result: PlanChangeResult }>(
    "SELECT public.accept_couple_plan_change($1, $2, $3) AS result",
    [requestId, COUPLE_ID, GROOM_ID],
  );
  return result.rows[0].result;
}

async function prepareApprovedSharedScheduleAction(
  db: PGlite,
  options: {
    toolName:
      | "cancel_schedule_event"
      | "restore_schedule_event"
      | "delete_schedule_event";
    toolInput: Record<string, unknown>;
    journeyRevision: number;
    requestKey: string;
    proposalId: string;
    confirmationId: string;
    actionId: string;
  },
) {
  const atStage = async <T>(stage: string, task: Promise<T>) => {
    try {
      return await task;
    } catch (error) {
      throw new Error(`${stage}: ${String(error)}`, { cause: error });
    }
  };
  const identity = getAmoraToolOperationIdentity(
    options.toolName,
    options.toolInput,
  );
  const issuedAt = Date.now();
  const action = {
    version: 2,
    actionId: options.actionId,
    tool: options.toolName,
    input: options.toolInput,
    inputDigest: identity.inputDigest,
    operationKey: identity.operationKey,
    confirmation: "Apply this exact schedule state change?",
    issuedAt,
    expiresAt: issuedAt + 24 * 60 * 60 * 1_000,
  };

  await atStage("insert proposal", db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, NULL, 'ai', 'assistant', 'schedule proposal',
       jsonb_build_object(
         'pending_amora_action', $3::jsonb,
         'pending_amora_action_journey_revision', $4::bigint
       ),
       'shared',
       clock_timestamp() + ($4::bigint * interval '10 seconds')
     )`,
    [
      options.proposalId,
      COUPLE_ID,
      JSON.stringify(action),
      options.journeyRevision,
    ],
  ));
  await atStage("accept bride", db.query(
    "SELECT public.accept_amora_shared_action($1, $2, $3, $4)",
    [options.actionId, COUPLE_ID, options.proposalId, BRIDE_ID],
  ));
  await atStage("accept groom", db.query(
    "SELECT public.accept_amora_shared_action($1, $2, $3, $4)",
    [options.actionId, COUPLE_ID, options.proposalId, GROOM_ID],
  ));
  const application = await atStage("claim application", db.query<{
    result: { applicationGranted: boolean };
  }>(
    "SELECT public.claim_amora_shared_action_application($1, $2, $3, $4) AS result",
    [options.actionId, COUPLE_ID, options.proposalId, BRIDE_ID],
  ));
  expect(application.rows[0]?.result.applicationGranted).toBe(true);
  await atStage("insert confirmation", db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, $3, 'bride', 'user', 'apply exact schedule state change',
       jsonb_build_object('confirmed_amora_action_id', $4::text),
       'shared',
       clock_timestamp() + (($5::bigint * 10 + 1) * interval '1 second')
     )`,
    [
      options.confirmationId,
      COUPLE_ID,
      BRIDE_ID,
      options.actionId,
      options.journeyRevision,
    ],
  ));
  await atStage("insert request", db.query(
    `INSERT INTO public.amora_chat_request_claims(
       couple_id, request_key, user_id, visibility, status, user_message_id
     ) VALUES ($1, $2, $3, 'shared', 'processing', $4)`,
    [COUPLE_ID, options.requestKey, BRIDE_ID, options.confirmationId],
  ));
  await atStage("insert execution", db.query(
    `INSERT INTO public.amora_tool_executions(
       couple_id, request_key, operation_key, tool_name, input_digest,
       status, pending_action_id, pending_action_journey_revision
     ) VALUES ($1, $2, $3, $4, $5, 'processing', $6, 777)`,
    [
      COUPLE_ID,
      options.requestKey,
      identity.operationKey,
      options.toolName,
      identity.inputDigest,
      options.actionId,
    ],
  ));
  return identity;
}

async function applySharedScheduleStateMutation(
  db: PGlite,
  options: {
    toolName:
      | "cancel_schedule_event"
      | "restore_schedule_event"
      | "delete_schedule_event";
    toolInput: Record<string, unknown>;
    requestKey: string;
    identity: { operationKey: string; inputDigest: string };
    expectedEvents: Array<Record<string, unknown>>;
    nextEvents: Array<Record<string, unknown>>;
    previousEvent: Record<string, unknown>;
    event: Record<string, unknown>;
  },
) {
  const domainMutation = {
    kind: "journey_progress_key_cas",
    key: "__events",
    expectedPresent: true,
    expected: options.expectedEvents,
    value: options.nextEvents,
  };
  const result = {
    toolName: options.toolName,
    toolOutput: {
      event: options.event,
      previous_event: options.previousEvent,
    },
    success: true,
    displayMessage: "schedule state applied",
  };
  return db.query<{ result: typeof result }>(
    `SELECT public.apply_amora_atomic_tool_execution(
       $1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb
     ) AS result`,
    [
      COUPLE_ID,
      options.requestKey,
      options.identity.operationKey,
      options.identity.inputDigest,
      JSON.stringify(options.toolInput),
      JSON.stringify(domainMutation),
      JSON.stringify(result),
    ],
  );
}

describe("journey budget progress integrity migration", () => {
  it("requires 2/2 approval for a linked spent change and exposes the exact amount delta", async () => {
    const db = await createDatabase({
      coupleProgress: {
        venue: {
          category: "venue",
          label: "예식장",
          budget: 10_000_000,
          spent: 1_000_000,
          payer: "couple",
        },
      },
    });
    try {
      await setServiceRole(db);
      const pending = await submit(db, {
        changes: {
          progress_patch: {
            venue: {
              category: "venue",
              label: "예식장",
              budget: 10_000_000,
              spent: 2_000_000,
              payer: "couple",
            },
          },
        },
        surface: "/budget",
        summary: "진행 상황: 1개 수정",
      });

      expect(pending).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        isHighImpact: true,
        appliedRevision: null,
        journey: null,
      });
      expect(pending.summary).toBe("예식장 지출: 1000000원 → 2000000원");
      const beforeAcceptance = await db.query<{ spent: string }>(`
        SELECT progress #>> '{venue,spent}' AS spent
        FROM public.wedding_journeys
        WHERE couple_id = '${COUPLE_ID}'
      `);
      expect(beforeAcceptance.rows[0]?.spent).toBe("1000000");

      const applied = await accept(db, pending.requestId);
      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 2,
        acceptedCount: 2,
        appliedRevision: 1,
        journey: { state_revision: 1 },
      });
      expect(
        (applied.journey?.progress.venue as { spent?: number }).spent,
      ).toBe(2_000_000);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it.each([
    ["negative spent", { category: "venue", spent: -1 }],
    ["over-limit spent", { category: "venue", spent: 1_000_000_001 }],
    ["fractional budget", { category: "venue", budget: 1.5 }],
    ["string budget", { category: "venue", budget: "1000000" }],
    ["legacy payer as a new write", { category: "venue", payer: "bride" }],
    ["mismatched category", { category: "studio", spent: 1_000_000 }],
    ["empty label", { category: "venue", label: "   " }],
    ["overlong label", { category: "venue", label: "가".repeat(201) }],
    ["unsafe label", { category: "venue", label: "예식장\u202e거짓" }],
    ["non-record known category", 1_000_000],
  ])("rejects %s at the service-only RPC boundary", async (_label, venue) => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await expect(submit(db, {
        changes: { progress_patch: { venue } },
        surface: "/budget",
      })).rejects.toThrow(/COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS/);
      const unchanged = await db.query<{ state_revision: number }>(`
        SELECT state_revision
        FROM public.wedding_journeys
        WHERE couple_id = '${COUPLE_ID}'
      `);
      expect(unchanged.rows[0]?.state_revision).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps unrelated progress writable without rewriting a legacy stored payer", async () => {
    const db = await createDatabase({
      coupleProgress: {
        venue: {
          category: "venue",
          label: "예식장",
          budget: 10_000_000,
          payer: "bride",
        },
      },
    });
    try {
      await setServiceRole(db);
      const applied = await submit(db, {
        changes: {
          progress_patch: {
            checklist: { status: "completed", items: [] },
            preferences: { reminderEnabled: false },
          },
        },
        surface: "/dashboard",
      });

      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        isHighImpact: false,
        appliedRevision: 1,
      });
      expect(
        (applied.journey?.progress.venue as { payer?: string }).payer,
      ).toBe("bride");
      expect(applied.journey?.progress).toMatchObject({
        checklist: { status: "completed", items: [] },
        preferences: { reminderEnabled: false },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps a solo spent change atomic at 1/1 while retaining its exact summary", async () => {
    const db = await createDatabase({
      soloProgress: {
        venue: { spent: 1_000_000 },
      },
    });
    try {
      await setServiceRole(db);
      const applied = await submit(db, {
        coupleId: SOLO_COUPLE_ID,
        actorId: SOLO_ID,
        changes: {
          progress_patch: {
            venue: { spent: 2_000_000 },
          },
        },
        surface: "/budget",
      });

      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        isHighImpact: true,
        appliedRevision: 1,
        summary: "venue 지출: 1000000원 → 2000000원",
      });
      expect(
        (applied.journey?.progress.venue as { spent?: number }).spent,
      ).toBe(2_000_000);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("is rerunnable and keeps only the public submit wrapper executable by service_role", async () => {
    const db = await createDatabase();
    try {
      await db.exec(budgetProgressIntegritySql);
      const privileges = await db.query<{
        public_submit: boolean;
        private_submit: boolean;
        validator: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'service_role',
            'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)',
            'EXECUTE'
          ) AS public_submit,
          has_function_privilege(
            'service_role',
            'public.submit_couple_plan_change_before_budget_integrity(uuid,uuid,bigint,jsonb,text,text)',
            'EXECUTE'
          ) AS private_submit,
          has_function_privilege(
            'service_role',
            'public.assert_couple_plan_budget_progress_patch(jsonb)',
            'EXECUTE'
          ) AS validator
      `);
      expect(privileges.rows[0]).toEqual({
        public_submit: true,
        private_submit: false,
        validator: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});

describe("Amora manual schedule fairness migration", () => {
  it("makes every manual schedule-array mutation high-impact behind the existing write boundary", () => {
    const sql = manualScheduleSql;

    expect(sql.trimStart()).toMatch(/^BEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.couple_plan_change_is_high_impact",
    );
    expect(sql).toMatch(
      /p_old_progress\s*->\s*'__events'[\s\S]+IS DISTINCT FROM[\s\S]+p_new_progress\s*->\s*'__events'/,
    );
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.booking_projection_write_authorizations",
    );
    expect(sql).toContain(
      "CREATE TRIGGER trg_00_authorize_booking_projection",
    );
    expect(sql).toContain(
      "CREATE TRIGGER trg_01_clear_booking_projection_boundary_alias",
    );
    expect(sql).toContain(
      "apply_booking_progress_projection_before_manual_schedule",
    );
    expect(sql).toContain(
      "CREATE TRIGGER trg_capture_amora_shared_schedule_cancel_restore_delta",
    );
    expect(sql).toContain(
      "CREATE TRIGGER trg_record_amora_shared_schedule_cancel_restore_decision",
    );
    expect(sql).toContain("'expected_title'");
    expect(sql).toContain("'expected_date'");
    expect(sql).toContain("AMORA_SHARED_SCHEDULE_HARD_DELETE_DENIED");
    expect(sql).toContain("AMORA_MANUAL_SCHEDULE_CANCEL_ACTOR_MISMATCH");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.amora_manual_schedule_canonical_changes",
    );
    expect(sql).toContain(
      "submit_couple_plan_change_before_manual_schedule_clock",
    );
  });

  it("applies cleanly and is safe to rerun on the same schema", async () => {
    const db = await createDatabase();
    try {
      await db.exec(manualScheduleSql);
      const installed = await db.query<{
        prepare_triggers: number;
        decision_triggers: number;
      }>(`
        SELECT
          count(*) FILTER (
            WHERE tgname = 'trg_00_prepare_amora_manual_plan_change_request'
          )::integer AS prepare_triggers,
          count(*) FILTER (
            WHERE tgname = 'trg_record_amora_manual_plan_change_decision'
          )::integer AS decision_triggers
        FROM pg_trigger
        WHERE tgrelid = 'public.couple_plan_change_requests'::regclass
          AND NOT tgisinternal
      `);
      expect(installed.rows[0]).toEqual({
        prepare_triggers: 1,
        decision_triggers: 1,
      });
      const journeyTriggers = await db.query<{ tgname: string }>(`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'public.wedding_journeys'::regclass
          AND NOT tgisinternal
        ORDER BY tgname
      `);
      const orderedNames = journeyTriggers.rows.map((row) => row.tgname);
      expect(orderedNames).toEqual(expect.arrayContaining([
        "trg_00_authorize_booking_projection",
        "trg_00_enforce_couple_plan_change_write_boundary",
        "trg_01_clear_booking_projection_boundary_alias",
        "trg_advance_wedding_journey_state_revision",
        "trg_capture_amora_shared_schedule_cancel_restore_delta",
        "trg_capture_amora_shared_schedule_delta",
      ]));
      expect(orderedNames.indexOf(
        "trg_00_authorize_booking_projection",
      )).toBeLessThan(orderedNames.indexOf(
        "trg_00_enforce_couple_plan_change_write_boundary",
      ));
      expect(orderedNames.indexOf(
        "trg_00_enforce_couple_plan_change_write_boundary",
      )).toBeLessThan(orderedNames.indexOf(
        "trg_01_clear_booking_projection_boundary_alias",
      ));
      expect(orderedNames.indexOf(
        "trg_01_clear_booking_projection_boundary_alias",
      )).toBeLessThan(orderedNames.indexOf(
        "trg_advance_wedding_journey_state_revision",
      ));
      expect(orderedNames.indexOf(
        "trg_advance_wedding_journey_state_revision",
      )).toBeLessThan(orderedNames.indexOf(
        "trg_capture_amora_shared_schedule_cancel_restore_delta",
      ));
      expect(orderedNames.indexOf(
        "trg_capture_amora_shared_schedule_cancel_restore_delta",
      )).toBeLessThan(orderedNames.indexOf(
        "trg_capture_amora_shared_schedule_delta",
      ));
      const executionTriggers = await db.query<{ tgname: string }>(`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'public.amora_tool_executions'::regclass
          AND NOT tgisinternal
        ORDER BY tgname
      `);
      const executionNames = executionTriggers.rows.map((row) => row.tgname);
      expect(executionNames).toEqual(expect.arrayContaining([
        "trg_00_reject_legacy_schedule_delete_completion",
        "trg_enforce_amora_shared_action_execution",
      ]));
      expect(executionNames.indexOf(
        "trg_00_reject_legacy_schedule_delete_completion",
      )).toBeLessThan(executionNames.indexOf(
        "trg_enforce_amora_shared_action_execution",
      ));
      const privileges = await db.query<{
        service_public_submit: boolean;
        service_private_submit: boolean;
        service_canonicalizer: boolean;
        authenticated_public_submit: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'service_role',
            'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)',
            'EXECUTE'
          ) AS service_public_submit,
          has_function_privilege(
            'service_role',
            'public.submit_couple_plan_change_before_manual_schedule_clock(uuid,uuid,bigint,jsonb,text,text)',
            'EXECUTE'
          ) AS service_private_submit,
          has_function_privilege(
            'service_role',
            'public.amora_manual_schedule_canonical_changes(jsonb,jsonb,uuid,uuid)',
            'EXECUTE'
          ) AS service_canonicalizer,
          has_function_privilege(
            'authenticated',
            'public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text)',
            'EXECUTE'
          ) AS authenticated_public_submit
      `);
      expect(privileges.rows[0]).toEqual({
        service_public_submit: true,
        service_private_submit: false,
        service_canonicalizer: false,
        authenticated_public_submit: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("backfills one honest decision for a pre-migration applied receipt and remains idempotent", async () => {
    const db = await createDatabase({ seedLegacyApplied: true });
    try {
      const first = await db.query<{
        source: string;
        decision_type: string;
        source_ref_id: string;
        chosen_value: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }>(`
        SELECT source, decision_type, source_ref_id::text,
               chosen_value, metadata
        FROM public.decision_nodes
      `);
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]).toMatchObject({
        source: "manual",
        decision_type: "decided",
        chosen_value: {
          expectedRevision: 0,
          appliedRevision: 1,
          requiredCount: 1,
          mutationKind: null,
          before: null,
          after: null,
          legacyReceiptOnly: true,
        },
        metadata: {
          origin: "couple_plan_change_request",
          expectedRevision: 0,
          appliedRevision: 1,
          legacyReceiptOnly: true,
          exactScheduleDeltaUnavailable: false,
        },
      });
      expect(
        (first.rows[0].chosen_value.acceptances as unknown[]),
      ).toHaveLength(1);

      await db.exec(manualScheduleSql);
      expect((await db.query(
        "SELECT id FROM public.decision_nodes",
      )).rows).toHaveLength(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("backfills a legacy applied schedule receipt without inventing unavailable before/after events", async () => {
    const db = await createDatabase({ seedLegacyScheduleApplied: true });
    try {
      const decision = await db.query<{
        source: string;
        decision_type: string;
        chosen_value: Record<string, unknown>;
        metadata: Record<string, unknown>;
        reasoning: string;
      }>(`
        SELECT source, decision_type, chosen_value, metadata, reasoning
        FROM public.decision_nodes
      `);
      expect(decision.rows).toHaveLength(1);
      expect(decision.rows[0]).toMatchObject({
        source: "schedule",
        decision_type: "scheduled",
        chosen_value: {
          expectedRevision: 0,
          appliedRevision: 1,
          mutationKind: null,
          before: null,
          after: null,
          legacyReceiptOnly: true,
          changes: {
            progress_patch: {
              __events: [expect.objectContaining({
                id: "legacy-schedule-event",
                title: "기존 수동 일정",
              })],
            },
          },
        },
        metadata: {
          origin: "couple_plan_change_request",
          legacyReceiptOnly: true,
          exactScheduleDeltaUnavailable: true,
        },
      });
      expect(decision.rows[0].reasoning).toContain(
        "정확한 이전·이후 일정은 보관되지 않았음",
      );
      await db.exec(manualScheduleSql);
      expect((await db.query(
        "SELECT id FROM public.decision_nodes",
      )).rows).toHaveLength(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("requires 2/2 for a linked schedule add and atomically records one schedule decision", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const pending = await submit(db);
      expect(pending).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        isHighImpact: true,
        appliedRevision: null,
      });
      expect(pending.summary).toContain("일정 추가: 드레스 최종 피팅");
      expect(pending.summary).not.toContain("클라이언트가 보낸");
      expect((await db.query(
        "SELECT id FROM public.decision_nodes",
      )).rows).toHaveLength(0);

      const applied = await accept(db, pending.requestId);
      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 2,
        acceptedCount: 2,
        appliedRevision: 1,
        journey: { state_revision: 1 },
      });
      const decisions = await db.query<{
        source: string;
        decision_type: string;
        source_ref_id: string;
        visibility: string;
        chosen_value: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }>(`
        SELECT source, decision_type, source_ref_id::text, visibility,
               chosen_value, metadata
        FROM public.decision_nodes
      `);
      expect(decisions.rows).toHaveLength(1);
      expect(decisions.rows[0]).toMatchObject({
        source: "schedule",
        decision_type: "scheduled",
        source_ref_id: pending.requestId,
        visibility: "shared",
        chosen_value: {
          requestId: pending.requestId,
          expectedRevision: 0,
          appliedRevision: 1,
          requiredCount: 2,
          mutationKind: "add",
          eventId: "event-1",
          before: null,
        },
        metadata: {
          origin: "couple_plan_change_request",
          requestId: pending.requestId,
          expectedRevision: 0,
          appliedRevision: 1,
          requiredCount: 2,
          mutationKind: "add",
          eventId: "event-1",
          previousStatus: "applying",
        },
      });
      expect(
        (decisions.rows[0].chosen_value.acceptances as unknown[]),
      ).toHaveLength(2);
      const replay = await submit(db);
      expect(replay.requestId).toBe(pending.requestId);
      expect((await db.query(
        "SELECT id FROM public.decision_nodes",
      )).rows).toHaveLength(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("identifies an added same-title event by date and an explicit missing time", async () => {
    const existing = event("same-title-existing");
    const added: Record<string, unknown> = event("same-title-added", {
      date: "2027-03-02",
    });
    delete added.time;
    const db = await createDatabase({
      coupleProgress: { __events: [existing] },
    });
    try {
      await setServiceRole(db);
      const pending = await submit(db, {
        events: [existing, added],
      });

      expect(pending).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
      });
      expect(pending.summary).toContain("일정 추가: 드레스 최종 피팅");
      expect(pending.summary).toContain("날짜: 없음 → 2027-03-02");
      expect(pending.summary).toContain("시간: 없음 → 없음");
      expect(pending.summary.length).toBeLessThanOrEqual(240);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("blocks an unapproved direct schedule write and applies a solo 1/1 request through the same ledger", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await expect(db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(progress, '{__events}', $2::jsonb, true)
         WHERE couple_id = $1`,
        [COUPLE_ID, JSON.stringify([event("direct-write")])],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);
      await expect(db.query(
        `SELECT public.amora_manual_schedule_delta(
           '{}'::jsonb, '{}'::jsonb, $1, $2
         )`,
        [BRIDE_ID, GROOM_ID],
      )).rejects.toThrow(/permission denied/i);

      const soloEvent = event("solo-event", {
        assignee: { kind: "member", profileId: SOLO_ID },
      });
      const applied = await submit(db, {
        coupleId: SOLO_COUPLE_ID,
        actorId: SOLO_ID,
        events: [soloEvent],
      });
      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        isHighImpact: true,
        appliedRevision: 1,
      });
      const canonicalSoloEvent = (
        applied.journey?.progress.__events as Array<Record<string, unknown>>
      )[0];
      const soloCancelled = {
        ...canonicalSoloEvent,
        status: "cancelled",
        cancellation: {
          cancelledAt: "2026-08-02T04:00:00.000Z",
          cancelledByProfileId: SOLO_ID,
          reason: "본인 요청",
        },
        updatedAt: "2026-08-02T04:00:00.000Z",
      };
      const cancelled = await submit(db, {
        coupleId: SOLO_COUPLE_ID,
        actorId: SOLO_ID,
        revision: 1,
        events: [soloCancelled],
      });
      expect(cancelled).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        isHighImpact: true,
        appliedRevision: 2,
      });
      expect(cancelled.summary).toContain("취소 요청자: 예비 신부");
      const decision = await db.query<{
        source: string;
        decision_type: string;
        title: string;
        source_actor_role: string;
        chosen_value: {
          requiredCount: number;
          acceptances: unknown[];
          mutationKind: string;
          after: {
            cancellation?: { cancelledByProfileId?: string };
          };
        };
      }>(`
        SELECT source, decision_type, title, source_actor_role, chosen_value
        FROM public.decision_nodes
        WHERE couple_id = $1
        ORDER BY created_at, id
      `, [SOLO_COUPLE_ID]);
      expect(decision.rows).toHaveLength(2);
      expect(decision.rows[0]).toEqual(expect.objectContaining({
        source: "schedule",
        decision_type: "scheduled",
        chosen_value: expect.objectContaining({
          requiredCount: 1,
          acceptances: [expect.objectContaining({ userId: SOLO_ID })],
        }),
      }));
      expect(decision.rows[1]).toEqual(expect.objectContaining({
        source: "schedule",
        decision_type: "scheduled",
        title: cancelled.summary,
        source_actor_role: "bride",
        chosen_value: expect.objectContaining({
          requiredCount: 1,
          acceptances: [expect.objectContaining({ userId: SOLO_ID })],
          mutationKind: "cancel",
          after: expect.objectContaining({
            cancellation: expect.objectContaining({
              cancelledByProfileId: SOLO_ID,
            }),
          }),
        }),
      }));
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("binds a connected cancellation receipt to the submitting member instead of a forged partner id", async () => {
    const original = event("event-cancel-actor-binding");
    const db = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(db);
      const cancelledBy = (profileId: string) => ({
        ...original,
        status: "cancelled",
        cancellation: {
          cancelledAt: "2026-08-02T04:00:00.000Z",
          cancelledByProfileId: profileId,
          reason: "일정 조정",
        },
        updatedAt: "2026-08-02T04:00:00.000Z",
      });

      await expect(submit(db, {
        actorId: BRIDE_ID,
        events: [cancelledBy(GROOM_ID)],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_CANCEL_ACTOR_MISMATCH/);

      const rejectedCounts = await db.query<{
        requests: number;
        decisions: number;
      }>(`
        SELECT
          (SELECT count(*)::integer
           FROM public.couple_plan_change_requests) AS requests,
          (SELECT count(*)::integer
           FROM public.decision_nodes) AS decisions
      `);
      expect(rejectedCounts.rows[0]).toEqual({ requests: 0, decisions: 0 });

      const validCancellation = cancelledBy(BRIDE_ID);
      const pending = await submit(db, {
        actorId: BRIDE_ID,
        events: [validCancellation],
      });
      expect(pending).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
      });
      expect(pending.summary).toContain("취소 요청자: 예비 신부");
      expect(pending.summary).not.toContain("취소 요청자: 예비 신랑");

      const receipt = await db.query<{
        actor_user_id: string;
        summary: string;
        schedule_mutation_kind: string;
        schedule_after_event: {
          cancellation: { cancelledByProfileId: string };
        };
      }>(`
        SELECT actor_user_id, summary, schedule_mutation_kind,
               schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [pending.requestId]);
      expect(receipt.rows[0]).toMatchObject({
        actor_user_id: BRIDE_ID,
        summary: pending.summary,
        schedule_mutation_kind: "cancel",
        schedule_after_event: {
          cancellation: expect.objectContaining({
            cancelledByProfileId: BRIDE_ID,
          }),
        },
      });

      await accept(db, pending.requestId);
      const decision = await db.query<{
        title: string;
        source_actor_role: string;
        chosen_value: {
          mutationKind: string;
          after: { cancellation: { cancelledByProfileId: string } };
        };
        metadata: {
          mutationKind: string;
          after: { cancellation: { cancelledByProfileId: string } };
        };
      }>(`
        SELECT title, source_actor_role, chosen_value, metadata
        FROM public.decision_nodes
        WHERE source_ref_id = $1
      `, [pending.requestId]);
      expect(decision.rows).toEqual([expect.objectContaining({
        title: pending.summary,
        source_actor_role: "bride",
        chosen_value: expect.objectContaining({
          mutationKind: "cancel",
          after: expect.objectContaining({
            cancellation: expect.objectContaining({
              cancelledByProfileId: BRIDE_ID,
            }),
          }),
        }),
        metadata: expect.objectContaining({
          mutationKind: "cancel",
          after: expect.objectContaining({
            cancellation: expect.objectContaining({
              cancelledByProfileId: BRIDE_ID,
            }),
          }),
        }),
      })]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps the server-derived schedule receipt, digest, and Korean summary immutable while approval is pending", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const pending = await submit(db);
      await expect(db.query(
        `UPDATE public.couple_plan_change_requests
         SET summary = '일정을 몰래 바꿨어요.'
         WHERE id = $1`,
        [pending.requestId],
      )).rejects.toThrow(/AMORA_MANUAL_PLAN_REQUEST_IMMUTABLE/);
      await expect(db.query(
        `UPDATE public.couple_plan_change_requests
         SET schedule_after_event =
           jsonb_set(schedule_after_event, '{title}', '"다른 일정"')
         WHERE id = $1`,
        [pending.requestId],
      )).rejects.toThrow(/AMORA_MANUAL_PLAN_REQUEST_IMMUTABLE/);

      const stored = await db.query<{
        summary: string;
        change_digest: string;
        schedule_mutation_kind: string;
        schedule_event_id: string;
      }>(`
        SELECT summary, change_digest, schedule_mutation_kind,
               schedule_event_id
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [pending.requestId]);
      expect(stored.rows[0]).toMatchObject({
        summary: pending.summary,
        schedule_mutation_kind: "add",
        schedule_event_id: "event-1",
      });
      expect(stored.rows[0].change_digest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("records exact update, soft-cancel, and planned restore deltas without deleting history", async () => {
    const original = event("event-lifecycle");
    const db = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(db);
      const updated = {
        ...original,
        time: "15:30",
        title: "드레스 피팅 시간 확정",
        updatedAt: "2026-08-02T04:00:00.000Z",
      };
      const updatePending = await submit(db, {
        revision: 0,
        events: [updated],
      });
      expect(updatePending).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
      });
      expect(updatePending.summary).toContain("일정 수정: 드레스 최종 피팅");
      expect(updatePending.summary).toContain(
        "날짜: 2027-03-01 → 2027-03-01",
      );
      expect(updatePending.summary).toContain(
        "시간: 14:00 → 15:30",
      );
      expect(updatePending.summary).toContain(
        "제목: 드레스 최종 피팅 → 드레스 피팅 시간 확정",
      );
      const updateReceipt = await db.query<{
        schedule_after_event: Record<string, unknown>;
      }>(`
        SELECT schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [updatePending.requestId]);
      const canonicalUpdated = updateReceipt.rows[0].schedule_after_event;
      await accept(db, updatePending.requestId);

      const longReason = "가".repeat(500);
      const cancelled = {
        ...canonicalUpdated,
        status: "cancelled",
        cancellation: {
          cancelledAt: "2026-08-02T05:00:00.000Z",
          cancelledByProfileId: BRIDE_ID,
          reason: longReason,
        },
        updatedAt: "2026-08-02T05:00:00.000Z",
      };
      const cancelPending = await submit(db, {
        revision: 1,
        events: [cancelled],
      });
      expect(cancelPending.summary).toContain(
        "일정 취소: 드레스 피팅 시간 확정",
      );
      expect(cancelPending.summary).toContain(
        "날짜: 2027-03-01 → 2027-03-01",
      );
      expect(cancelPending.summary).toContain(
        "시간: 15:30 → 15:30",
      );
      expect(cancelPending.summary).toContain("상태: 예정 → 취소");
      expect(cancelPending.summary).toContain("취소 요청자: 예비 신부");
      expect(cancelPending.summary).toMatch(
        /취소 사유: 없음 → 입력됨\(500자, 지문 [a-f0-9]{64}\)$/,
      );
      expect(cancelPending.summary.length).toBeLessThanOrEqual(240);
      const cancelReceipt = await db.query<{
        schedule_after_event: Record<string, unknown>;
      }>(`
        SELECT schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [cancelPending.requestId]);
      const canonicalCancelled = cancelReceipt.rows[0].schedule_after_event;
      await accept(db, cancelPending.requestId);

      const cancelledWithoutReceipt: Record<string, unknown> = {
        ...canonicalCancelled,
      };
      delete cancelledWithoutReceipt.cancellation;
      const restored = {
        ...cancelledWithoutReceipt,
        status: "planned",
        updatedAt: "2026-08-02T06:00:00.000Z",
      };
      const restorePending = await submit(db, {
        revision: 2,
        events: [restored],
      });
      expect(restorePending.summary).toContain(
        "일정 복원: 드레스 피팅 시간 확정",
      );
      expect(restorePending.summary).toContain(
        "날짜: 2027-03-01 → 2027-03-01",
      );
      expect(restorePending.summary).toContain(
        "시간: 15:30 → 15:30",
      );
      expect(restorePending.summary).toContain("상태: 취소 → 예정");
      expect(restorePending.summary).toContain("취소 기록: 있음 → 제거");
      const restoredResult = await accept(db, restorePending.requestId);
      const canonicalRestored = (
        restoredResult.journey?.progress.__events as Array<
          Record<string, unknown>
        >
      )[0];
      expect(restoredResult).toMatchObject({
        status: "applied",
        appliedRevision: 3,
        journey: {
          state_revision: 3,
          progress: { __events: [canonicalRestored] },
        },
      });

      const decisions = await db.query<{
        mutation_kind: string;
        before_event: Record<string, unknown> | null;
        after_event: Record<string, unknown>;
      }>(`
        SELECT chosen_value ->> 'mutationKind' AS mutation_kind,
               chosen_value -> 'before' AS before_event,
               chosen_value -> 'after' AS after_event
        FROM public.decision_nodes
        ORDER BY created_at, id
      `);
      expect(decisions.rows.map((row) => row.mutation_kind)).toEqual([
        "update",
        "cancel",
        "restore",
      ]);
      expect(decisions.rows[1]).toMatchObject({
        before_event: canonicalUpdated,
        after_event: canonicalCancelled,
      });
      expect(decisions.rows[2]).toMatchObject({
        before_event: canonicalCancelled,
        after_event: canonicalRestored,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("canonicalizes a forged future cancellation clock and still permits a present-time restore", async () => {
    const original = event("event-future-clock");
    const forgedFutureAt = "2099-12-31T23:59:59.999Z";
    const db = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(db);
      const forgedCancellation = {
        ...original,
        status: "cancelled",
        cancellation: {
          cancelledAt: forgedFutureAt,
          cancelledByProfileId: BRIDE_ID,
        },
        updatedAt: forgedFutureAt,
      };
      const cancelPending = await submit(db, {
        events: [forgedCancellation],
      });
      expect(cancelPending.status).toBe("pending_partner");

      const storedCancellation = await db.query<{
        changes: Record<string, unknown>;
        change_digest: string;
        summary: string;
        schedule_after_event: Record<string, unknown>;
      }>(`
        SELECT changes,
               change_digest,
               summary,
               schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [cancelPending.requestId]);
      const canonicalCancellation = storedCancellation.rows[0]
        .schedule_after_event;
      const canonicalCancellationAt = canonicalCancellation.updatedAt as string;
      expect(canonicalCancellationAt).not.toBe(forgedFutureAt);
      expect(Date.parse(canonicalCancellationAt)).toBeLessThanOrEqual(
        Date.now() + 60_000,
      );
      expect(canonicalCancellation.cancellation).toMatchObject({
        cancelledAt: canonicalCancellationAt,
        cancelledByProfileId: BRIDE_ID,
      });
      expect(
        (storedCancellation.rows[0].changes.progress_patch as {
          __events: Array<Record<string, unknown>>;
        }).__events[0],
      ).toEqual(canonicalCancellation);
      expect(storedCancellation.rows[0]).toMatchObject({
        summary: cancelPending.summary,
      });
      expect(storedCancellation.rows[0].change_digest).toMatch(
        /^[a-f0-9]{64}$/,
      );

      const cancelledResult = await accept(db, cancelPending.requestId);
      expect(
        (cancelledResult.journey?.progress.__events as Array<
          Record<string, unknown>
        >)[0],
      ).toEqual(canonicalCancellation);

      const presentRestore: Record<string, unknown> = {
        ...canonicalCancellation,
        status: "planned",
        updatedAt: new Date().toISOString(),
      };
      delete presentRestore.cancellation;
      const restorePending = await submit(db, {
        revision: 1,
        events: [presentRestore],
      });
      expect(restorePending).toMatchObject({
        status: "pending_partner",
        requiredCount: 2,
      });
      const restoredResult = await accept(db, restorePending.requestId);
      const restoredEvent = (
        restoredResult.journey?.progress.__events as Array<
          Record<string, unknown>
        >
      )[0];
      expect(restoredEvent.status).toBe("planned");
      expect(restoredEvent).not.toHaveProperty("cancellation");
      expect(Date.parse(restoredEvent.updatedAt as string)).toBeGreaterThan(
        Date.parse(canonicalCancellationAt),
      );
      expect(Date.parse(restoredEvent.updatedAt as string)).toBeLessThanOrEqual(
        Date.now() + 60_000,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("canonicalizes an appended event even when an unchanged legacy event has no audit clocks", async () => {
    const forgedFutureAt = "2099-12-31T23:59:59.999Z";
    const legacyEvent: Record<string, unknown> = event("legacy-without-clock");
    delete legacyEvent.createdAt;
    delete legacyEvent.updatedAt;
    const forgedAppend = event("new-after-legacy", {
      createdAt: forgedFutureAt,
      updatedAt: forgedFutureAt,
    });
    const db = await createDatabase({
      coupleProgress: { __events: [legacyEvent] },
    });
    try {
      await setServiceRole(db);

      const pending = await submit(db, {
        events: [legacyEvent, forgedAppend],
      });

      expect(pending.status).toBe("pending_partner");
      const receipt = await db.query<{
        schedule_after_event: Record<string, unknown>;
      }>(`
        SELECT schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [pending.requestId]);
      const canonicalAppend = receipt.rows[0].schedule_after_event;
      expect(canonicalAppend.id).toBe("new-after-legacy");
      expect(canonicalAppend.createdAt).toBe(canonicalAppend.updatedAt);
      expect(canonicalAppend.createdAt).not.toBe(forgedFutureAt);
      expect(Date.parse(canonicalAppend.createdAt as string)).toBeLessThanOrEqual(
        Date.now() + 60_000,
      );

      const applied = await accept(db, pending.requestId);
      expect(applied.journey?.progress.__events).toEqual([
        legacyEvent,
        canonicalAppend,
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("canonicalizes future add, update, and restore clocks before the partner approves them", async () => {
    const forgedFutureAt = "2099-12-31T23:59:59.999Z";
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const forgedAdd = event("event-server-clock", {
        createdAt: forgedFutureAt,
        updatedAt: forgedFutureAt,
      });
      const addPending = await submit(db, { events: [forgedAdd] });
      const addReceipt = await db.query<{
        schedule_after_event: Record<string, unknown>;
      }>(`
        SELECT schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [addPending.requestId]);
      const canonicalAdded = addReceipt.rows[0].schedule_after_event;
      expect(canonicalAdded.createdAt).toBe(canonicalAdded.updatedAt);
      expect(canonicalAdded.createdAt).not.toBe(forgedFutureAt);
      expect(Date.parse(canonicalAdded.createdAt as string)).toBeLessThanOrEqual(
        Date.now() + 60_000,
      );
      await accept(db, addPending.requestId);

      const forgedUpdate = {
        ...canonicalAdded,
        title: "서버 시각으로 확정한 일정",
        updatedAt: forgedFutureAt,
      };
      const updatePending = await submit(db, {
        revision: 1,
        events: [forgedUpdate],
      });
      const updateReceipt = await db.query<{
        schedule_before_event: Record<string, unknown>;
        schedule_after_event: Record<string, unknown>;
      }>(`
        SELECT schedule_before_event, schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [updatePending.requestId]);
      const canonicalUpdated = updateReceipt.rows[0].schedule_after_event;
      expect(updateReceipt.rows[0].schedule_before_event).toEqual(
        canonicalAdded,
      );
      expect(canonicalUpdated).toMatchObject({
        createdAt: canonicalAdded.createdAt,
        title: "서버 시각으로 확정한 일정",
      });
      expect(canonicalUpdated.updatedAt).not.toBe(forgedFutureAt);
      expect(Date.parse(canonicalUpdated.updatedAt as string)).toBeGreaterThan(
        Date.parse(canonicalAdded.updatedAt as string),
      );
      await accept(db, updatePending.requestId);

      const cancelledAt = new Date().toISOString();
      const cancelled = {
        ...canonicalUpdated,
        status: "cancelled",
        cancellation: {
          cancelledAt,
          cancelledByProfileId: BRIDE_ID,
        },
        updatedAt: cancelledAt,
      };
      const cancelPending = await submit(db, {
        revision: 2,
        events: [cancelled],
      });
      const cancelledResult = await accept(db, cancelPending.requestId);
      const canonicalCancelled = (
        cancelledResult.journey?.progress.__events as Array<
          Record<string, unknown>
        >
      )[0];

      const forgedRestore: Record<string, unknown> = {
        ...canonicalCancelled,
        status: "planned",
        updatedAt: forgedFutureAt,
      };
      delete forgedRestore.cancellation;
      const restorePending = await submit(db, {
        revision: 3,
        events: [forgedRestore],
      });
      const restoreReceipt = await db.query<{
        schedule_before_event: Record<string, unknown>;
        schedule_after_event: Record<string, unknown>;
      }>(`
        SELECT schedule_before_event, schedule_after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [restorePending.requestId]);
      expect(restoreReceipt.rows[0].schedule_before_event).toEqual(
        canonicalCancelled,
      );
      expect(restoreReceipt.rows[0].schedule_after_event.updatedAt)
        .not.toBe(forgedFutureAt);
      expect(restoreReceipt.rows[0].schedule_after_event)
        .not.toHaveProperty("cancellation");
      const restoredResult = await accept(db, restorePending.requestId);
      expect(
        (restoredResult.journey?.progress.__events as Array<
          Record<string, unknown>
        >)[0],
      ).toEqual(restoreReceipt.rows[0].schedule_after_event);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("deduplicates concurrent and lost-response retries by semantic schedule intent", async () => {
    const original = event("event-clock-retry");
    const cancellationWithClock = (timestamp: string) => ({
      ...original,
      status: "cancelled",
      cancellation: {
        cancelledAt: timestamp,
        cancelledByProfileId: BRIDE_ID,
      },
      updatedAt: timestamp,
    });
    const db = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(db);
      const [first, concurrentRetry] = await Promise.all([
        submit(db, {
          events: [cancellationWithClock("2099-12-31T23:59:59.999Z")],
        }),
        submit(db, {
          events: [cancellationWithClock("2098-12-31T23:59:59.999Z")],
        }),
      ]);
      expect(concurrentRetry).toMatchObject({
        requestId: first.requestId,
        status: "pending_partner",
        summary: first.summary,
      });
      const pendingRows = await db.query<{
        request_count: number;
        distinct_digest_count: number;
      }>(`
        SELECT count(*)::integer AS request_count,
               count(DISTINCT change_digest)::integer
                 AS distinct_digest_count
        FROM public.couple_plan_change_requests
        WHERE couple_id = $1
          AND base_revision = 0
      `, [COUPLE_ID]);
      expect(pendingRows.rows[0]).toEqual({
        request_count: 1,
        distinct_digest_count: 1,
      });

      const applied = await accept(db, first.requestId);
      expect(applied.status).toBe("applied");
      const lostResponseRetry = await submit(db, {
        events: [cancellationWithClock("2097-12-31T23:59:59.999Z")],
      });
      expect(lostResponseRetry).toMatchObject({
        requestId: first.requestId,
        status: "applied",
        appliedRevision: 1,
      });
      expect((await db.query(
        "SELECT id FROM public.couple_plan_change_requests",
      )).rows).toHaveLength(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed instead of propagating a legacy event clock beyond the safe server horizon", async () => {
    const poisoned = event("event-legacy-future-clock", {
      updatedAt: "2099-12-31T23:59:59.999Z",
    });
    const db = await createDatabase({
      coupleProgress: { __events: [poisoned] },
    });
    try {
      await setServiceRole(db);
      await expect(submit(db, {
        events: [{
          ...poisoned,
          status: "cancelled",
          cancellation: {
            cancelledAt: "2100-01-01T00:00:00.000Z",
            cancelledByProfileId: BRIDE_ID,
          },
          updatedAt: "2100-01-01T00:00:00.000Z",
        }],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_STORED_CLOCK_UNSAFE/);
      expect((await db.query(
        "SELECT id FROM public.couple_plan_change_requests",
      )).rows).toHaveLength(0);
      const journey = await db.query<{ progress: Record<string, unknown> }>(`
        SELECT progress
        FROM public.wedding_journeys
        WHERE couple_id = $1
      `, [COUPLE_ID]);
      expect(journey.rows[0].progress).toEqual({ __events: [poisoned] });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("accepts maximum-length title and memo through a bounded digest-linked exact summary", async () => {
    const original = event("event-long-copy");
    const db = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(db);
      const updated = {
        ...original,
        title: "나".repeat(500),
        memo: "가".repeat(2000),
        updatedAt: "2026-08-02T04:00:00.000Z",
      };
      const pending = await submit(db, { events: [updated] });
      expect(pending.status).toBe("pending_partner");
      expect(pending.summary.length).toBeLessThanOrEqual(240);
      expect(pending.summary).toContain(
        "날짜: 2027-03-01 → 2027-03-01",
      );
      expect(pending.summary).toContain("시간: 14:00 → 14:00");
      expect(pending.summary).toContain("변경: 제목·메모");
      expect(pending.summary).toMatch(
        /변경 전→후 묶음 지문: [a-f0-9]{64}$/,
      );
      const applied = await accept(db, pending.requestId);
      const canonicalUpdated = (
        applied.journey?.progress.__events as Array<Record<string, unknown>>
      )[0];
      expect(applied.journey?.progress).toMatchObject({
        __events: [canonicalUpdated],
      });
      const decision = await db.query<{
        before_event: Record<string, unknown>;
        after_event: Record<string, unknown>;
      }>(`
        SELECT chosen_value -> 'before' AS before_event,
               chosen_value -> 'after' AS after_event
        FROM public.decision_nodes
      `);
      expect(decision.rows[0]).toEqual({
        before_event: original,
        after_event: canonicalUpdated,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects hard removal, reordering, multi-event changes, duplicate ids, and mixed plan writes", async () => {
    const first = event("event-first");
    const second = event("event-second", {
      date: "2027-03-02",
      title: "두 번째 일정",
    });
    const db = await createDatabase({
      coupleProgress: { __events: [first, second] },
    });
    try {
      await setServiceRole(db);
      const updatedFirst = {
        ...first,
        time: "16:00",
        updatedAt: "2026-08-02T04:00:00.000Z",
      };
      const updatedSecond = {
        ...second,
        time: "17:00",
        updatedAt: "2026-08-02T04:00:00.000Z",
      };

      await expect(submit(db, { events: [first] }))
        .rejects.toThrow(/AMORA_MANUAL_SCHEDULE_HARD_DELETE_DENIED/);
      await expect(submit(db, { events: [second, first] }))
        .rejects.toThrow(/AMORA_MANUAL_SCHEDULE_ORDER_OR_ID_CHANGED/);
      await expect(submit(db, { events: [updatedFirst, updatedSecond] }))
        .rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_UPDATE/);
      await expect(submit(db, {
        events: [first, second, event("event-third"), event("event-fourth")],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_UNSUPPORTED_DELTA/);
      await expect(submit(db, {
        events: [first, second, event("event-first")],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_EVENT_ARRAY/);
      await expect(submit(db, {
        changes: {
          progress_patch: {
            __events: [updatedFirst, second],
            notes: { text: "일정과 무관한 동시 변경" },
          },
        },
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_MIXED_DELTA_DENIED/);
      await expect(submit(db, {
        changes: {
          total_budget: 60_000_000,
          progress_patch: { __events: [updatedFirst, second] },
        },
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_MIXED_DELTA_DENIED/);
      await expect(submit(db, {
        changes: {
          wedding_date: "2027-05-01",
          progress_patch: { __events: [updatedFirst, second] },
        },
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_APPROVAL_REQUIRED/);

      const counts = await db.query<{ requests: number; decisions: number }>(`
        SELECT
          (SELECT count(*)::integer
           FROM public.couple_plan_change_requests) AS requests,
          (SELECT count(*)::integer FROM public.decision_nodes) AS decisions
      `);
      expect(counts.rows[0]).toEqual({ requests: 0, decisions: 0 });

      const pending = await submit(db, {
        events: [updatedFirst, second],
      });
      const applied = await accept(db, pending.requestId);
      const canonicalUpdatedFirst = (
        applied.journey?.progress.__events as Array<Record<string, unknown>>
      )[0];
      expect(applied.journey?.progress).toMatchObject({
        __events: [canonicalUpdatedFirst, second],
      });
      const receipt = await db.query<{
        before_event: Record<string, unknown>;
        after_event: Record<string, unknown>;
      }>(`
        SELECT schedule_before_event AS before_event,
               schedule_after_event AS after_event
        FROM public.couple_plan_change_requests
        WHERE id = $1
      `, [pending.requestId]);
      expect(receipt.rows[0]).toEqual({
        before_event: first,
        after_event: canonicalUpdatedFirst,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("enforces the exact cancellation shape, current-member identities, safe text, and planned-only restore", async () => {
    const original = event("event-cancel-shape");
    const db = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(db);
      const baseCancellation = {
        cancelledAt: "2026-08-02T05:00:00.000Z",
        cancelledByProfileId: BRIDE_ID,
      };
      const cancelled = (cancellation: Record<string, unknown>) => ({
        ...original,
        status: "cancelled",
        cancellation,
        updatedAt: "2026-08-02T05:00:00.000Z",
      });

      await expect(submit(db, {
        events: [{
          ...original,
          status: "cancelled",
          updatedAt: "2026-08-02T05:00:00.000Z",
        }],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_UPDATE/);
      await expect(submit(db, {
        events: [cancelled({ ...baseCancellation, unexpected: true })],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_UPDATE/);
      await expect(submit(db, {
        events: [cancelled({
          ...baseCancellation,
          cancelledByProfileId: SOLO_ID,
        })],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_UPDATE/);
      await expect(submit(db, {
        events: [cancelled({
          ...baseCancellation,
          reason: "통화\n후 취소",
        })],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_UPDATE/);
      await expect(submit(db, {
        events: [cancelled({
          ...baseCancellation,
          reason: "가".repeat(501),
        })],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_UPDATE/);
      await expect(submit(db, {
        events: [{
          ...original,
          assignee: { kind: "member", profileId: SOLO_ID },
          updatedAt: "2026-08-02T05:00:00.000Z",
        }],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_INVALID_UPDATE/);

      const validCancelled = cancelled(baseCancellation);
      const pending = await submit(db, { events: [validCancelled] });
      await accept(db, pending.requestId);
      await expect(submit(db, {
        revision: 1,
        events: [{
          ...original,
          status: "completed",
          updatedAt: "2026-08-02T06:00:00.000Z",
        }],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_CANCEL_STATE_INVALID/);
      const restoreWithoutStatus: Record<string, unknown> = { ...original };
      delete restoreWithoutStatus.status;
      await expect(submit(db, {
        revision: 1,
        events: [{
          ...restoreWithoutStatus,
          updatedAt: "2026-08-02T06:00:00.000Z",
        }],
      })).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_CANCEL_STATE_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("records every applied non-schedule manual request once with its digest, revision, and acceptance", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const options = {
        changes: {
          progress_patch: {
            checklist: { status: "completed", note: "전화 확인" },
          },
        },
        surface: "/dashboard" as const,
        summary: "체크리스트 전화 확인을 완료로 기록했어요.",
      };
      const applied = await submit(db, options);
      expect(applied).toMatchObject({
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        isHighImpact: false,
        appliedRevision: 1,
      });
      const replay = await submit(db, options);
      expect(replay.requestId).toBe(applied.requestId);

      const decisions = await db.query<{
        source: string;
        decision_type: string;
        source_ref_id: string;
        chosen_value: {
          requestId: string;
          changeDigest: string;
          expectedRevision: number;
          appliedRevision: number;
          requiredCount: number;
          acceptances: unknown[];
          mutationKind: null;
          before: null;
          after: null;
        };
      }>(`
        SELECT source, decision_type, source_ref_id::text, chosen_value
        FROM public.decision_nodes
      `);
      expect(decisions.rows).toHaveLength(1);
      expect(decisions.rows[0]).toMatchObject({
        source: "manual",
        decision_type: "decided",
        source_ref_id: applied.requestId,
        chosen_value: {
          requestId: applied.requestId,
          expectedRevision: 0,
          appliedRevision: 1,
          requiredCount: 1,
          acceptances: [expect.objectContaining({ userId: BRIDE_ID })],
          mutationKind: null,
          before: null,
          after: null,
        },
      });
      expect(decisions.rows[0].chosen_value.changeDigest).toMatch(
        /^[a-f0-9]{64}$/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("captures approved shared-action cancellation and restoration as exact atomic receipts", async () => {
    const original = event("shared-state-event");
    const cancelledEvent = {
      ...original,
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T04:00:00.000Z",
        cancelledByProfileId: BRIDE_ID,
        reason: "venue schedule changed",
      },
      updatedAt: "2026-08-02T04:00:00.000Z",
    };
    const restoredEvent = {
      ...original,
      status: "planned",
      updatedAt: "2026-08-02T05:00:00.000Z",
    };
    const db = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(db);
      const cancelInput = {
        event_id: original.id,
        expected_title: original.title,
        expected_date: original.date,
        reason: "venue schedule changed",
      };
      const cancelIdentity = await prepareApprovedSharedScheduleAction(db, {
        toolName: "cancel_schedule_event",
        toolInput: cancelInput,
        journeyRevision: 0,
        requestKey: "chat:test:shared-cancel",
        proposalId: SHARED_PROPOSAL_ID,
        confirmationId: SHARED_CONFIRMATION_ID,
        actionId: SHARED_ACTION_ID,
      });
      const beforeCancelApply = await db.query<{
        status: string;
        revision: number;
        operation_key: string;
        input_digest: string;
      }>(`
        SELECT status, pending_action_journey_revision::integer AS revision,
               operation_key, input_digest
        FROM public.amora_tool_executions
        WHERE request_key = 'chat:test:shared-cancel'
      `);
      expect(beforeCancelApply.rows[0]).toEqual({
        status: "processing",
        revision: 0,
        operation_key: cancelIdentity.operationKey,
        input_digest: cancelIdentity.inputDigest,
      });
      const cancelApplied = await applySharedScheduleStateMutation(db, {
        toolName: "cancel_schedule_event",
        toolInput: cancelInput,
        requestKey: "chat:test:shared-cancel",
        identity: cancelIdentity,
        expectedEvents: [original],
        nextEvents: [cancelledEvent],
        previousEvent: original,
        event: cancelledEvent,
      });
      expect(cancelApplied.rows[0]?.result).toMatchObject({ success: true });
      const afterCancel = await db.query<{
        revision: number;
        events: Array<Record<string, unknown>>;
        execution_status: string;
      }>(
        `SELECT journey.state_revision::integer AS revision,
                journey.progress -> '__events' AS events,
                execution.status AS execution_status
         FROM public.wedding_journeys AS journey
         JOIN public.amora_tool_executions AS execution
           ON execution.couple_id = journey.couple_id
          AND execution.request_key = 'chat:test:shared-cancel'
         WHERE journey.couple_id = $1`,
        [COUPLE_ID],
      );
      expect(afterCancel.rows[0]).toMatchObject({
        revision: 1,
        events: [cancelledEvent],
        execution_status: "completed",
      });

      const restoreInput = {
        event_id: original.id,
        expected_title: original.title,
        expected_date: original.date,
      };
      const restoreIdentity = await prepareApprovedSharedScheduleAction(db, {
        toolName: "restore_schedule_event",
        toolInput: restoreInput,
        journeyRevision: afterCancel.rows[0]?.revision ?? -1,
        requestKey: "chat:test:shared-restore",
        proposalId: "50000000-0000-4000-8000-000000000003",
        confirmationId: "50000000-0000-4000-8000-000000000004",
        actionId: "60000000-0000-4000-8000-000000000002",
      });
      await applySharedScheduleStateMutation(db, {
        toolName: "restore_schedule_event",
        toolInput: restoreInput,
        requestKey: "chat:test:shared-restore",
        identity: restoreIdentity,
        expectedEvents: [cancelledEvent],
        nextEvents: [restoredEvent],
        previousEvent: cancelledEvent,
        event: restoredEvent,
      });

      const receipts = await db.query<{
        tool_name: string;
        mutation_kind: string;
        before_event: Record<string, unknown>;
        after_event: Record<string, unknown>;
        decision_operation: string;
        decision_before: Record<string, unknown>;
        decision_after: Record<string, unknown>;
      }>(`
        SELECT execution.tool_name,
               receipt.mutation_kind,
               receipt.before_event,
               receipt.after_event,
               decision.chosen_value ->> 'operation' AS decision_operation,
               decision.chosen_value -> 'before' AS decision_before,
               decision.chosen_value -> 'after' AS decision_after
        FROM public.amora_tool_executions AS execution
        JOIN public.amora_shared_action_journey_mutation_receipts AS receipt
          ON receipt.couple_id = execution.couple_id
         AND receipt.request_key = execution.request_key
         AND receipt.operation_key = execution.operation_key
        JOIN public.decision_nodes AS decision
          ON decision.id = receipt.decision_node_id
        WHERE execution.request_key IN (
          'chat:test:shared-cancel', 'chat:test:shared-restore'
        )
        ORDER BY receipt.expected_revision
      `);
      expect(receipts.rows).toEqual([
        {
          tool_name: "cancel_schedule_event",
          mutation_kind: "cancel",
          before_event: original,
          after_event: cancelledEvent,
          decision_operation: "cancel",
          decision_before: original,
          decision_after: cancelledEvent,
        },
        {
          tool_name: "restore_schedule_event",
          mutation_kind: "restore",
          before_event: cancelledEvent,
          after_event: restoredEvent,
          decision_operation: "restore",
          decision_before: cancelledEvent,
          decision_after: restoredEvent,
        },
      ]);
      const state = await db.query<{
        revision: number;
        events: Array<Record<string, unknown>>;
        decision_count: number;
      }>(`
        SELECT state_revision::integer AS revision,
               progress -> '__events' AS events,
               (SELECT count(*)::integer
                FROM public.decision_nodes
                WHERE metadata ->> 'origin' = 'amora_shared_action')
                 AS decision_count
        FROM public.wedding_journeys
        WHERE couple_id = $1
      `, [COUPLE_ID]);
      expect(state.rows[0]).toEqual({
        revision: 2,
        events: [restoredEvent],
        decision_count: 2,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects forged shared cancellation actors, stale human targets, and legacy hard deletion atomically", async () => {
    const original = event("shared-adversarial-event");
    const validInput = {
      event_id: original.id,
      expected_title: original.title,
      expected_date: original.date,
      reason: "schedule changed",
    };
    const forgedActorEvent = {
      ...original,
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T04:00:00.000Z",
        cancelledByProfileId: GROOM_ID,
        reason: "schedule changed",
      },
      updatedAt: "2026-08-02T04:00:00.000Z",
    };

    const actorDb = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(actorDb);
      const identity = await prepareApprovedSharedScheduleAction(actorDb, {
        toolName: "cancel_schedule_event",
        toolInput: validInput,
        journeyRevision: 0,
        requestKey: "chat:test:forged-cancel-actor",
        proposalId: "50000000-0000-4000-8000-000000000011",
        confirmationId: "50000000-0000-4000-8000-000000000012",
        actionId: "60000000-0000-4000-8000-000000000011",
      });
      await expect(applySharedScheduleStateMutation(actorDb, {
        toolName: "cancel_schedule_event",
        toolInput: validInput,
        requestKey: "chat:test:forged-cancel-actor",
        identity,
        expectedEvents: [original],
        nextEvents: [forgedActorEvent],
        previousEvent: original,
        event: forgedActorEvent,
      })).rejects.toThrow(/AMORA_SHARED_SCHEDULE_CANCEL_DELTA_INVALID/);
      const rolledBack = await actorDb.query<{
        revision: number;
        events: Array<Record<string, unknown>>;
        execution_status: string;
        receipts: number;
        decisions: number;
      }>(`
        SELECT journey.state_revision::integer AS revision,
               journey.progress -> '__events' AS events,
               execution.status AS execution_status,
               (SELECT count(*)::integer
                FROM public.amora_shared_action_journey_mutation_receipts)
                 AS receipts,
               (SELECT count(*)::integer FROM public.decision_nodes)
                 AS decisions
        FROM public.wedding_journeys AS journey
        JOIN public.amora_tool_executions AS execution
          ON execution.couple_id = journey.couple_id
        WHERE journey.couple_id = $1
      `, [COUPLE_ID]);
      expect(rolledBack.rows[0]).toEqual({
        revision: 0,
        events: [original],
        execution_status: "processing",
        receipts: 0,
        decisions: 0,
      });
    } finally {
      await resetPersona(actorDb).catch(() => undefined);
      await actorDb.close();
    }

    const targetDb = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(targetDb);
      const staleInput = { ...validInput, expected_title: "stale title" };
      const identity = await prepareApprovedSharedScheduleAction(targetDb, {
        toolName: "cancel_schedule_event",
        toolInput: staleInput,
        journeyRevision: 0,
        requestKey: "chat:test:stale-cancel-target",
        proposalId: "50000000-0000-4000-8000-000000000021",
        confirmationId: "50000000-0000-4000-8000-000000000022",
        actionId: "60000000-0000-4000-8000-000000000021",
      });
      const otherwiseValidEvent = {
        ...forgedActorEvent,
        cancellation: {
          ...forgedActorEvent.cancellation,
          cancelledByProfileId: BRIDE_ID,
        },
      };
      await expect(applySharedScheduleStateMutation(targetDb, {
        toolName: "cancel_schedule_event",
        toolInput: staleInput,
        requestKey: "chat:test:stale-cancel-target",
        identity,
        expectedEvents: [original],
        nextEvents: [otherwiseValidEvent],
        previousEvent: original,
        event: otherwiseValidEvent,
      })).rejects.toThrow(/AMORA_SHARED_SCHEDULE_STATE_DELTA_INVALID/);
    } finally {
      await resetPersona(targetDb).catch(() => undefined);
      await targetDb.close();
    }

    const deleteDb = await createDatabase({
      coupleProgress: { __events: [original] },
    });
    try {
      await setServiceRole(deleteDb);
      await expect(prepareApprovedSharedScheduleAction(deleteDb, {
        toolName: "delete_schedule_event",
        toolInput: {
          event_id: original.id,
          expected_title: original.title,
          expected_date: original.date,
        },
        journeyRevision: 0,
        requestKey: "chat:test:legacy-hard-delete",
        proposalId: "50000000-0000-4000-8000-000000000031",
        confirmationId: "50000000-0000-4000-8000-000000000032",
        actionId: "60000000-0000-4000-8000-000000000031",
      })).rejects.toThrow(/AMORA_SHARED_ACTION_BLOCKED/);
      await expect(deleteDb.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(progress, '{__events}', '[]'::jsonb, true)
         WHERE couple_id = $1`,
        [COUPLE_ID],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);
    } finally {
      await resetPersona(deleteDb).catch(() => undefined);
      await deleteDb.close();
    }
  });

  it("keeps the durable booking projection boundary working without reopening direct schedule writes", async () => {
    const db = await createDatabase({
      soloProgress: {
        __events: [event("manual-event", {
          assignee: { kind: "member", profileId: SOLO_ID },
        })],
        studio: { budget: 1_000_000, spent: 100_000 },
      },
    });
    try {
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, SOLO_COUPLE_ID],
      );
      const activeClaim = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          desiredState: "active";
          generation: number;
          claimToken: string;
          booking: {
            quotedAmount: number;
            actualAmount: number | null;
            cancellation: null;
          };
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const activeJob = activeClaim.rows[0]?.job;
      expect(activeJob).toBeDefined();
      expect(activeJob.booking).toMatchObject({
        quotedAmount: 500_000,
        actualAmount: null,
        cancellation: null,
      });
      const active = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, $3, $4::jsonb, $5, $6, $7, $8
         ) AS result`,
        [
          activeJob.coupleId,
          activeJob.bookingId,
          activeJob.desiredState,
          JSON.stringify({
            date: "2027-03-20",
            time: "10:00",
            title: "Hanbang Studio booking",
            categoryKey: "studio",
            status: "planned",
          }),
          "studio",
          0,
          activeJob.generation,
          activeJob.claimToken,
        ],
      );
      expect(active.rows[0]?.result).toMatchObject({
        accepted: true,
        status: "completed",
        budgetUpdated: false,
        scheduleCancelled: false,
        quoteContributionCorrected: false,
      });

      await seedProtectedBookingUpdate(db,
        "UPDATE public.vendor_bookings SET actual_amount = 650000 WHERE id = $1",
        [BOOKING_ID],
      );
      const actualClaim = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          generation: number;
          claimToken: string;
          booking: { actualAmount: number };
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const actualJob = actualClaim.rows[0]?.job;
      expect(actualJob.booking.actualAmount).toBe(650_000);
      const actual = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, 'active', $3::jsonb, 'studio', 650000, $4, $5
         ) AS result`,
        [
          actualJob.coupleId,
          actualJob.bookingId,
          JSON.stringify({
            date: "2027-03-20",
            time: "10:00",
            title: "Hanbang Studio booking",
            categoryKey: "studio",
            status: "planned",
          }),
          actualJob.generation,
          actualJob.claimToken,
        ],
      );
      expect(actual.rows[0]?.result).toMatchObject({
        budgetUpdated: true,
        budgetDelta: 650_000,
        newSpent: 750_000,
      });

      await db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      const cancelClaim = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          desiredState: "cancelled";
          generation: number;
          claimToken: string;
          booking: {
            quotedAmount: number;
            actualAmount: number | null;
            cancellation: {
              cancelledAt: string;
              cancelledByProfileId: string;
              reason: string;
            };
          };
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const cancelJob = cancelClaim.rows[0]?.job;
      expect(cancelJob).toBeDefined();
      expect(cancelJob.booking).toMatchObject({
        quotedAmount: 500_000,
        actualAmount: 650_000,
        cancellation: {
          cancelledByProfileId: SOLO_ID,
          reason: "아모라 내부 예약 기록 취소",
        },
      });
      const cancelled = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, $3, NULL, 'studio', 650000, $4, $5
         ) AS result`,
        [
          cancelJob.coupleId,
          cancelJob.bookingId,
          cancelJob.desiredState,
          cancelJob.generation,
          cancelJob.claimToken,
        ],
      );
      expect(cancelled.rows[0]?.result).toMatchObject({
        accepted: true,
        status: "completed",
        scheduleCancelled: true,
        recordedSpendPreserved: true,
        quoteContributionCorrected: false,
        scheduleRemoved: false,
        budgetReverted: false,
      });
      const projected = await db.query<{
        spent: number;
        event: Record<string, unknown>;
        contribution: Record<string, unknown>;
      }>(
        `SELECT
           (progress -> 'studio' ->> 'spent')::integer AS spent,
           progress -> '__events' -> 1 AS event,
           progress -> '__booking_costs' -> $2 AS contribution
         FROM public.wedding_journeys
         WHERE couple_id = $1`,
        [SOLO_COUPLE_ID, BOOKING_ID],
      );
      expect(projected.rows[0]).toMatchObject({
        spent: 750_000,
        event: {
          id: `evt_booking_${BOOKING_ID}`,
          status: "cancelled",
          cancellation: {
            cancelledByProfileId: SOLO_ID,
          },
        },
        contribution: {
          amount: 650_000,
          basis: "actual",
          quotedAmount: 500_000,
        },
      });

      await expect(db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           progress,
           '{__events}',
           COALESCE(progress -> '__events', '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object(
               'id', 'unapproved-direct-event',
               'date', '2027-04-01',
               'title', 'must stay blocked'
             )),
           true
         )
         WHERE couple_id = $1`,
        [SOLO_COUPLE_ID],
      )).rejects.toThrow(/COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED/);

      await expect(db.query(
        "SELECT * FROM public.booking_projection_write_authorizations",
      )).rejects.toThrow(/permission denied/i);
      await db.query(
        "SELECT set_config('hanbang.booking_projection_authorization_id', $1, false)",
        ["70000000-0000-4000-8000-000000000001"],
      );
      await expect(db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           progress,
           '{__events}',
           jsonb_build_array(jsonb_build_object(
             'id', 'forged-booking-capability',
             'date', '2027-04-02',
             'title', 'must stay blocked'
           )),
           true
         )
         WHERE couple_id = $1`,
        [SOLO_COUPLE_ID],
      )).rejects.toThrow(/BOOKING_PROJECTION_WRITE_NOT_AUTHORIZED/);
      await db.query(
        "SELECT set_config('hanbang.booking_projection_authorization_id', '', false)",
      );

      await expect(db.query(
        `SELECT public.apply_booking_progress_projection_before_manual_schedule(
           $1, $2, 'cancelled', NULL, NULL, 0, $3, $4
         )`,
        [
          SOLO_COUPLE_ID,
          BOOKING_ID,
          cancelJob.generation,
          cancelJob.claimToken,
        ],
      )).rejects.toThrow(/permission denied/i);
      const brokenBookingId = "40000000-0000-4000-8000-000000000002";
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-21', '11:00', 'pending', 400000)`,
        [brokenBookingId, VENDOR_ID, SOLO_COUPLE_ID],
      );
      const brokenClaim = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          generation: number;
          claimToken: string;
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [
        brokenBookingId,
      ]);
      const brokenJob = brokenClaim.rows[0]?.job;
      expect(brokenJob).toBeDefined();
      await expect(db.query(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, 'active', NULL, 'studio', 0, $3, $4
         )`,
        [
          brokenJob.coupleId,
          brokenJob.bookingId,
          brokenJob.generation,
          brokenJob.claimToken,
        ],
      )).rejects.toThrow(/booking_projection_event_required/);
      await resetPersona(db);
      const cleaned = await db.query<{
        authorizations: number;
        authorization_marker: string;
        boundary_marker: string;
      }>(`
        SELECT
          (SELECT count(*)::integer
           FROM public.booking_projection_write_authorizations)
            AS authorizations,
          current_setting(
            'hanbang.booking_projection_authorization_id', true
          ) AS authorization_marker,
          current_setting(
            'hanbang.booking_projection_boundary_authorized', true
          ) AS boundary_marker
      `);
      expect(cleaned.rows[0]).toEqual({
        authorizations: 0,
        authorization_marker: "",
        boundary_marker: "",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("projects explicit actual spend and supports an exact actual-to-zero correction", async () => {
    const db = await createDatabase({
      coupleProgress: {
        studio: { budget: 1_000_000, spent: 100_000 },
      },
    });
    const projectionEvent = {
      id: `evt_booking_${BOOKING_ID}`,
      date: "2027-03-20",
      time: "10:00",
      title: "Hanbang Studio 상담",
      categoryKey: "studio",
      status: "planned",
      createdAt: "2026-08-02T04:00:00.000Z",
      updatedAt: "2026-08-02T04:00:00.000Z",
    };
    try {
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, COUPLE_ID],
      );
      const projectActive = async (
        projectedAmount: number,
        expectedActualAmount: number | null = projectedAmount,
      ) => {
        const claimed = await db.query<{
          job: {
            coupleId: string;
            bookingId: string;
            generation: number;
            claimToken: string;
            booking: { quotedAmount: number; actualAmount: number | null };
          };
        }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
        const job = claimed.rows[0]?.job;
        expect(job.booking.quotedAmount).toBe(500_000);
        expect(job.booking.actualAmount).toBe(expectedActualAmount);
        return db.query<{ result: Record<string, unknown> }>(
          `SELECT public.apply_booking_progress_projection(
             $1, $2, 'active', $3::jsonb, 'studio', $4, $5, $6
           ) AS result`,
          [
            job.coupleId,
            job.bookingId,
            JSON.stringify(projectionEvent),
            projectedAmount,
            job.generation,
            job.claimToken,
          ],
        );
      };

      const created = await projectActive(0, null);
      expect(created.rows[0]?.result).toMatchObject({
        budgetUpdated: false,
        budgetDelta: 0,
      });

      await seedProtectedBookingUpdate(db,
        "UPDATE public.vendor_bookings SET actual_amount = 650000 WHERE id = $1",
        [BOOKING_ID],
      );
      const actual = await projectActive(650_000);
      expect(actual.rows[0]?.result).toMatchObject({
        budgetUpdated: true,
        budgetDelta: 650_000,
        newSpent: 750_000,
      });
      const withActual = await db.query<{
        spent: number;
        contribution: Record<string, unknown>;
      }>(
        `SELECT
           (progress -> 'studio' ->> 'spent')::integer AS spent,
           progress -> '__booking_costs' -> $2 AS contribution
         FROM public.wedding_journeys WHERE couple_id = $1`,
        [COUPLE_ID, BOOKING_ID],
      );
      expect(withActual.rows[0]).toMatchObject({
        spent: 750_000,
        contribution: {
          amount: 650_000,
          basis: "actual",
          quotedAmount: 500_000,
        },
      });

      await seedProtectedBookingUpdate(db,
        "UPDATE public.vendor_bookings SET actual_amount = 0 WHERE id = $1",
        [BOOKING_ID],
      );
      const corrected = await projectActive(0);
      expect(corrected.rows[0]?.result).toMatchObject({
        budgetUpdated: true,
        budgetDelta: -650_000,
        newSpent: 100_000,
      });
      const afterCorrection = await db.query<{
        spent: number;
        contribution: Record<string, unknown>;
      }>(
        `SELECT
           (progress -> 'studio' ->> 'spent')::integer AS spent,
           progress -> '__booking_costs' -> $2 AS contribution
         FROM public.wedding_journeys WHERE couple_id = $1`,
        [COUPLE_ID, BOOKING_ID],
      );
      expect(afterCorrection.rows[0]).toMatchObject({
        spent: 100_000,
        contribution: { amount: 0, basis: "actual" },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("soft-cancels a legacy short-id event without subtracting ambiguous legacy spend", async () => {
    const legacyEvent = {
      id: `evt_booking_${BOOKING_ID.slice(0, 8)}`,
      date: "2027-03-20",
      time: "10:00",
      title: "Hanbang Studio 상담",
      categoryKey: "studio",
      status: "planned",
      createdAt: "2026-08-02T04:00:00.000Z",
      updatedAt: "2026-08-02T04:00:00.000Z",
    };
    const db = await createDatabase({
      soloProgress: {
        __events: [legacyEvent],
        __booking_costs: { [BOOKING_ID]: 500_000 },
        studio: { budget: 1_000_000, spent: 600_000 },
      },
    });
    try {
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, SOLO_COUPLE_ID],
      );
      const firstCancel = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.cancel_booking_atomic($1, $2, $3) AS result",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      const replayCancel = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.cancel_booking_atomic($1, $2, $3) AS result",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      expect(firstCancel.rows[0]?.result).toMatchObject({
        idempotent: false,
        cancelled_by_profile_id: SOLO_ID,
        vendor_cancellation_status: "unconfirmed",
        refund_status: "unknown",
      });
      expect(replayCancel.rows[0]?.result).toMatchObject({
        idempotent: true,
        cancelled_at: firstCancel.rows[0]?.result.cancelled_at,
        cancelled_by_profile_id: SOLO_ID,
      });

      const claimed = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          generation: number;
          claimToken: string;
          booking: { cancellation: { cancelledByProfileId: string } };
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const job = claimed.rows[0]?.job;
      expect(job.booking.cancellation.cancelledByProfileId).toBe(SOLO_ID);
      const applied = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, 'cancelled', NULL, 'studio', 0, $3, $4
         ) AS result`,
        [job.coupleId, job.bookingId, job.generation, job.claimToken],
      );
      expect(applied.rows[0]?.result).toMatchObject({
        scheduleCancelled: true,
        recordedSpendPreserved: false,
        quoteContributionCorrected: false,
        quoteCorrectionAmount: 0,
        needsReview: true,
        scheduleRemoved: false,
        budgetReverted: false,
        newSpent: null,
      });
      const projected = await db.query<{
        spent: number;
        event_count: number;
        event: Record<string, unknown>;
        contribution: Record<string, unknown>;
      }>(
        `SELECT
           (journey.progress -> 'studio' ->> 'spent')::integer AS spent,
           jsonb_array_length(journey.progress -> '__events') AS event_count,
           (
             SELECT item
             FROM jsonb_array_elements(journey.progress -> '__events') AS item
             WHERE item ->> 'id' = $2
           ) AS event,
           journey.progress -> '__booking_costs' -> $3 AS contribution
         FROM public.wedding_journeys AS journey
         WHERE journey.couple_id = $1`,
        [SOLO_COUPLE_ID, legacyEvent.id, BOOKING_ID],
      );
      expect(projected.rows[0]).toMatchObject({
        spent: 600_000,
        event_count: 1,
        event: {
          id: legacyEvent.id,
          status: "cancelled",
          cancellation: { cancelledByProfileId: SOLO_ID },
        },
        contribution: 500_000,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves spend when a legacy booking event has no contribution ledger", async () => {
    const legacyEvent = {
      id: `evt_booking_${BOOKING_ID.slice(0, 8)}`,
      date: "2027-03-20",
      time: "10:00",
      title: "Hanbang Studio 상담",
      categoryKey: "studio",
      status: "planned",
      createdAt: "2026-08-02T04:00:00.000Z",
      updatedAt: "2026-08-02T04:00:00.000Z",
    };
    const db = await createDatabase({
      soloProgress: {
        __events: [legacyEvent],
        studio: { budget: 1_000_000, spent: 600_000 },
      },
    });
    try {
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, SOLO_COUPLE_ID],
      );
      await db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      const claimed = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          generation: number;
          claimToken: string;
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const job = claimed.rows[0]?.job;
      const applied = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, 'cancelled', NULL, 'studio', 0, $3, $4
         ) AS result`,
        [job.coupleId, job.bookingId, job.generation, job.claimToken],
      );
      expect(applied.rows[0]?.result).toMatchObject({
        scheduleCancelled: true,
        quoteContributionCorrected: false,
        quoteCorrectionAmount: 0,
        budgetUpdated: false,
        newSpent: null,
      });
      const journey = await db.query<{ spent: number }>(
        `SELECT (progress -> 'studio' ->> 'spent')::integer AS spent
         FROM public.wedding_journeys WHERE couple_id = $1`,
        [SOLO_COUPLE_ID],
      );
      expect(journey.rows[0]?.spent).toBe(600_000);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("binds cancellation to the issue-time roster and survives a later roster detach", async () => {
    const db = await createDatabase({
      soloProgress: {
        studio: { budget: 1_000_000, spent: 100_000 },
      },
    });
    try {
      await db.query("INSERT INTO auth.users(id) VALUES ($1)", [STALE_PROFILE_ID]);
      await db.query(
        "INSERT INTO public.profiles(id, couple_id, role) VALUES ($1, $2, 'bride')",
        [STALE_PROFILE_ID, COUPLE_ID],
      );
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, SOLO_COUPLE_ID],
      );

      await expect(db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, STALE_PROFILE_ID],
      )).rejects.toThrow(/booking_cancel_actor_not_member/);
      const unchanged = await db.query<{ status: string }>(
        "SELECT status FROM public.vendor_bookings WHERE id = $1",
        [BOOKING_ID],
      );
      expect(unchanged.rows[0]?.status).toBe("pending");

      await db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      await expect(db.query(
        "SELECT * FROM public.booking_cancellation_receipts",
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        `INSERT INTO public.booking_cancellation_receipts (
           booking_id, couple_id, actor_profile_id, cancelled_at,
           issue_bride_id, issue_required_count, roster_fingerprint,
           vendor_id, booking_date, booking_time, quoted_amount, snapshot_digest
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2::uuid, now(), $2::uuid, 1,
           md5(($2::uuid)::text || ':-'), $3::uuid,
           '2027-03-20', '10:00', 0,
           repeat('0', 64)
         )`,
        [COUPLE_ID, BRIDE_ID, VENDOR_ID],
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "UPDATE public.booking_cancellation_receipts SET cancel_reason = 'forged'",
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "DELETE FROM public.booking_cancellation_receipts",
      )).rejects.toThrow(/permission denied/i);
      await db.query(
        "UPDATE public.couples SET bride_id = NULL WHERE id = $1",
        [SOLO_COUPLE_ID],
      );
      const replay = await db.query<{ result: { idempotent: boolean } }>(
        "SELECT public.cancel_booking_atomic($1, $2, $3) AS result",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      expect(replay.rows[0]?.result.idempotent).toBe(true);
      await expect(db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, GROOM_ID],
      )).rejects.toThrow(/booking_cancellation_receipt_mismatch/);

      const claimed = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          generation: number;
          claimToken: string;
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const job = claimed.rows[0]?.job;
      expect(job).toBeDefined();
      const applied = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, 'cancelled', NULL, 'studio', 0, $3, $4
         ) AS result`,
        [job.coupleId, job.bookingId, job.generation, job.claimToken],
      );
      expect(applied.rows[0]?.result).toMatchObject({
        accepted: true,
        scheduleCancelled: true,
        recordedSpendPreserved: false,
      });
      const journey = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [SOLO_COUPLE_ID],
      );
      expect(journey.rows[0]?.progress).toMatchObject({
        __events: [expect.objectContaining({
          status: "cancelled",
          cancellation: expect.objectContaining({
            cancelledByProfileId: SOLO_ID,
          }),
        })],
        studio: { budget: 1_000_000, spent: 100_000 },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects cancelled bookings with a missing or forged cancellation receipt", async () => {
    const db = await createDatabase();
    const activeBookingId = "40000000-0000-4000-8000-000000000099";
    try {
      // Simulate a pre-1600 legacy row that already carried a cancelled status
      // but could not have received the new immutable cancellation receipt.
      // New writes must go through cancel_booking_atomic and are tested below.
      await db.query(
        `ALTER TABLE public.vendor_bookings
         DISABLE TRIGGER trg_authorize_booking_cancellation_transition`,
      );
      await db.query(
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount,
           cancelled_at, cancelled_by_profile_id, cancel_reason
         ) VALUES (
           $1, $2, $3, '2027-03-20', '10:00', 'cancelled', 500000,
           '2026-08-02T04:00:00.000Z', $4, 'legacy cancellation'
         )`,
        [BOOKING_ID, VENDOR_ID, COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        `ALTER TABLE public.vendor_bookings
         ENABLE TRIGGER trg_authorize_booking_cancellation_transition`,
      );
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-21', '11:00', 'pending', 400000)`,
        [activeBookingId, VENDOR_ID, COUPLE_ID],
      );
      const legacyClaim = await db.query<{ job: unknown }>(
        "SELECT public.claim_booking_projection_job($1) AS job",
        [BOOKING_ID],
      );
      expect(legacyClaim.rows[0]?.job).toBeNull();
      const legacyJob = await db.query<{
        status: string;
        last_error_code: string;
      }>(
        `SELECT status, last_error_code
         FROM public.booking_projection_jobs WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(legacyJob.rows[0]).toEqual({
        status: "failed",
        last_error_code: "BOOKING_CANCELLATION_RECEIPT_INVALID",
      });

      await resetPersona(db);
      await db.query(
        `INSERT INTO public.booking_cancellation_receipts (
           booking_id, couple_id, actor_profile_id, cancelled_at,
           issue_bride_id, issue_groom_id, issue_required_count,
           roster_fingerprint, vendor_id, product_id, staff_id,
           booking_date, booking_time, quoted_amount, actual_amount,
           cancel_reason, snapshot_digest
         )
         SELECT
           booking.id, booking.couple_id, booking.cancelled_by_profile_id,
           booking.cancelled_at, $2::uuid, $3::uuid, 2,
           md5(($2::uuid)::text || ':' || ($3::uuid)::text), booking.vendor_id,
           booking.product_id, booking.staff_id, booking.booking_date,
           booking.booking_time, booking.amount, booking.actual_amount,
           booking.cancel_reason, repeat('0', 64)
         FROM public.vendor_bookings AS booking
         WHERE booking.id = $1`,
        [BOOKING_ID, BRIDE_ID, GROOM_ID],
      );
      await db.query(
        `UPDATE public.booking_projection_jobs
         SET status = 'pending', completed_at = NULL, last_error_code = NULL
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      await setServiceRole(db);
      const forgedClaim = await db.query<{ job: unknown }>(
        "SELECT public.claim_booking_projection_job($1) AS job",
        [BOOKING_ID],
      );
      expect(forgedClaim.rows[0]?.job).toBeNull();
      const nextClaim = await db.query<{
        job: { bookingId: string; desiredState: string };
      }>("SELECT public.claim_booking_projection_job() AS job");
      expect(nextClaim.rows[0]?.job).toMatchObject({
        bookingId: activeBookingId,
        desiredState: "active",
      });

      await resetPersona(db);
      await expect(db.query(
        `UPDATE public.booking_cancellation_receipts
         SET snapshot_digest = repeat('1', 64)
         WHERE booking_id = $1`,
        [BOOKING_ID],
      )).rejects.toThrow(/booking_cancellation_receipt_immutable/);
      await db.query(
        "DELETE FROM public.vendor_bookings WHERE id = $1",
        [BOOKING_ID],
      );
      const erased = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.booking_cancellation_receipts WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(erased.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("atomically rejects an outcome-style completion after cancellation", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, SOLO_COUPLE_ID],
      );
      await db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );

      await expect(db.query(
        `UPDATE public.vendor_bookings
         SET status = 'completed', actual_amount = 650000
         WHERE id = $1`,
        [BOOKING_ID],
      )).rejects.toThrow(/booking_protected_write_rpc_required/);
      const unchanged = await db.query<{
        status: string;
        actual_amount: number | null;
        desired_state: string;
      }>(
        `SELECT booking.status, booking.actual_amount, job.desired_state
         FROM public.vendor_bookings AS booking
         JOIN public.booking_projection_jobs AS job
           ON job.booking_id = booking.id
         WHERE booking.id = $1`,
        [BOOKING_ID],
      );
      expect(unchanged.rows[0]).toEqual({
        status: "cancelled",
        actual_amount: null,
        desired_state: "cancelled",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves a canonical earlier schedule cancellation when the booking record is cancelled later", async () => {
    const originalCancellation = {
      cancelledAt: "2026-08-02T03:00:00.000Z",
      cancelledByProfileId: SOLO_ID,
      reason: "일정 화면에서 먼저 취소",
    };
    const existingEvent = {
      id: `evt_booking_${BOOKING_ID}`,
      date: "2027-03-20",
      time: "10:00",
      title: "Hanbang Studio 상담",
      categoryKey: "studio",
      sourceKey: `booking:${BOOKING_ID}`,
      status: "cancelled",
      cancellation: originalCancellation,
      createdAt: "2026-08-02T02:00:00.000Z",
      updatedAt: originalCancellation.cancelledAt,
    };
    const db = await createDatabase({
      soloProgress: {
        __events: [existingEvent],
        studio: { budget: 1_000_000, spent: 100_000 },
      },
    });
    try {
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, SOLO_COUPLE_ID],
      );
      await db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      const claimed = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          generation: number;
          claimToken: string;
          booking: { cancellation: { cancelledByProfileId: string } };
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const job = claimed.rows[0]?.job;
      expect(job.booking.cancellation.cancelledByProfileId).toBe(SOLO_ID);

      const applied = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, 'cancelled', NULL, 'studio', 0, $3, $4
         ) AS result`,
        [job.coupleId, job.bookingId, job.generation, job.claimToken],
      );
      expect(applied.rows[0]?.result).toMatchObject({
        accepted: true,
        scheduleCancelled: false,
        scheduleRemoved: false,
        budgetReverted: false,
      });
      const projected = await db.query<{
        event: { cancellation: Record<string, unknown> };
      }>(
        `SELECT progress -> '__events' -> 0 AS event
         FROM public.wedding_journeys WHERE couple_id = $1`,
        [SOLO_COUPLE_ID],
      );
      expect(projected.rows[0]?.event.cancellation).toEqual(originalCancellation);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("does not downgrade a completed linked schedule event during booking cancellation", async () => {
    const completedEvent = {
      id: `evt_booking_${BOOKING_ID}`,
      date: "2027-03-20",
      time: "10:00",
      title: "Hanbang Studio 상담",
      categoryKey: "studio",
      sourceKey: `booking:${BOOKING_ID}`,
      status: "completed",
      createdAt: "2026-08-02T02:00:00.000Z",
      updatedAt: "2026-08-02T03:00:00.000Z",
    };
    const db = await createDatabase({
      soloProgress: {
        __events: [completedEvent],
        studio: { budget: 1_000_000, spent: 100_000 },
      },
    });
    try {
      await setServiceRole(db);
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, '2027-03-20', '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, SOLO_COUPLE_ID],
      );
      await db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, SOLO_COUPLE_ID, SOLO_ID],
      );
      const claimed = await db.query<{
        job: {
          coupleId: string;
          bookingId: string;
          generation: number;
          claimToken: string;
        };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [BOOKING_ID]);
      const job = claimed.rows[0]?.job;
      const applied = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.apply_booking_progress_projection(
           $1, $2, 'cancelled', NULL, 'studio', 0, $3, $4
         ) AS result`,
        [job.coupleId, job.bookingId, job.generation, job.claimToken],
      );
      expect(applied.rows[0]?.result).toMatchObject({
        accepted: true,
        status: "completed",
        scheduleCancelled: false,
        completedSchedulePreserved: true,
      });
      const projected = await db.query<{
        event: Record<string, unknown>;
        job_status: string;
      }>(
        `SELECT journey.progress -> '__events' -> 0 AS event,
                job.status AS job_status
         FROM public.wedding_journeys AS journey
         JOIN public.booking_projection_jobs AS job
           ON job.couple_id = journey.couple_id
         WHERE journey.couple_id = $1 AND job.booking_id = $2`,
        [SOLO_COUPLE_ID, BOOKING_ID],
      );
      expect(projected.rows[0]?.event).toEqual(completedEvent);
      expect(projected.rows[0]?.job_status).toBe("completed");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("creates a private, capacity-neutral booking intent for a one-person roster", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    const vendorOwnerId = "10000000-0000-4000-8000-000000000020";
    const secondSoloId = "10000000-0000-4000-8000-000000000021";
    const secondCoupleId = "20000000-0000-4000-8000-000000000021";
    const thirdSoloId = "10000000-0000-4000-8000-000000000022";
    const thirdCoupleId = "20000000-0000-4000-8000-000000000022";
    const legacyCapacityBookingId = "40000000-0000-4000-8000-000000000021";
    try {
      await db.query(
        "INSERT INTO auth.users(id) VALUES ($1), ($2), ($3)",
        [vendorOwnerId, secondSoloId, thirdSoloId],
      );
      await db.query(
        `INSERT INTO public.couples(id, bride_id, groom_id)
         VALUES ($1, $2, NULL), ($3, $4, NULL)`,
        [secondCoupleId, secondSoloId, thirdCoupleId, thirdSoloId],
      );
      await db.query(
        `INSERT INTO public.profiles(id, couple_id, role)
         VALUES ($1, $2, 'bride'), ($3, $4, 'bride')`,
        [secondSoloId, secondCoupleId, thirdSoloId, thirdCoupleId],
      );
      await db.query(
        "UPDATE public.vendors SET owner_id = $2 WHERE id = $1",
        [VENDOR_ID, vendorOwnerId],
      );
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;
      expect(bookingId).toMatch(/^[0-9a-f-]{36}$/);
      const state = await db.query<{
        status: string;
        vendor_delivery_status: string;
        intent_created_by_profile_id: string;
        intent_vendor_name_snapshot: string;
        intent_vendor_category_snapshot: string;
        decisions: number;
      }>(
        `SELECT booking.status,
                booking.vendor_delivery_status,
                booking.intent_created_by_profile_id,
                booking.intent_vendor_name_snapshot,
                booking.intent_vendor_category_snapshot,
                (SELECT count(*)::integer
                 FROM public.decision_nodes AS decision
                 WHERE decision.source_ref_id = booking.id
                   AND decision.decision_type = 'considering') AS decisions
         FROM public.vendor_bookings AS booking
         WHERE booking.id = $1`,
        [bookingId],
      );
      expect(state.rows[0]).toEqual({
        status: "pending",
        vendor_delivery_status: "not_sent",
        intent_created_by_profile_id: SOLO_ID,
        intent_vendor_name_snapshot: "Hanbang Studio",
        intent_vendor_category_snapshot: "studio",
        decisions: 1,
      });

      const second = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, secondCoupleId, secondSoloId, bookingDate],
      );
      expect(second.rows[0]?.booking_id).not.toBe(bookingId);

      // A vendor owner must not see or count Amora-only intents.
      await resetPersona(db);
      await db.exec("GRANT SELECT ON public.vendor_bookings TO authenticated");
      await db.exec("SET ROLE authenticated");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', $1, false)",
        [vendorOwnerId],
      );
      const vendorVisible = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.vendor_bookings WHERE id = ANY($1::uuid[])`,
        [[bookingId, second.rows[0]?.booking_id]],
      );
      expect(vendorVisible.rows[0]?.count).toBe(0);
      await resetPersona(db);
      await setServiceRole(db);

      await expect(db.query(
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status,
           amount, intent_created_by_profile_id, vendor_delivery_status
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, '11:00', 'pending', 0, $4, 'not_sent'
         )`,
        [VENDOR_ID, SOLO_COUPLE_ID, bookingDate, SOLO_ID],
      )).rejects.toThrow(/booking_intent_rpc_required/);
      await expect(db.query(
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, '11:00', 'pending', 0
         )`,
        [VENDOR_ID, SOLO_COUPLE_ID, bookingDate],
      )).rejects.toThrow(/booking_external_submit_rpc_unavailable/);
      await expect(db.query(
        "SELECT * FROM public.booking_intent_write_authorizations",
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        `SELECT public.create_booking_atomic(
           $1, $2, $3, '11:00'
         )`,
        [VENDOR_ID, SOLO_COUPLE_ID, bookingDate],
      )).rejects.toThrow(/permission denied|legacy_booking_create_disabled/i);

      for (const statement of [
        "UPDATE public.vendor_bookings SET amount = amount + 1 WHERE id = $1",
        "UPDATE public.vendor_bookings SET status = 'completed', actual_amount = 1 WHERE id = $1",
        "UPDATE public.vendor_bookings SET vendor_delivery_status = 'legacy_unknown' WHERE id = $1",
        "UPDATE public.vendor_bookings SET booking_date = booking_date + 1 WHERE id = $1",
        "UPDATE public.vendor_bookings SET vendor_id = gen_random_uuid() WHERE id = $1",
        "UPDATE public.vendor_bookings SET is_paid = true WHERE id = $1",
      ]) {
        await expect(db.query(statement, [bookingId])).rejects.toThrow(
          /booking_(protected_write_rpc_required|delivery_status_immutable)/,
        );
      }

      // Two internal intents did not consume max_bookings=1. A real legacy
      // booking does, and therefore blocks a third one-person intent.
      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, $4, '10:00', 'pending', 0)`,
        [legacyCapacityBookingId, VENDOR_ID, COUPLE_ID, bookingDate],
      );
      await expect(db.query(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         )`,
        [VENDOR_ID, thirdCoupleId, thirdSoloId, bookingDate],
      )).rejects.toThrow(/slot_full/);

      await db.query(
        `UPDATE public.vendors
         SET name = 'Renamed Vendor', category = 'changed', status = 'rejected'
         WHERE id = $1`,
        [VENDOR_ID],
      );
      const replay = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      expect(replay.rows[0]?.booking_id).toBe(bookingId);
      const claimed = await db.query<{
        job: { booking: { vendorName: string; vendorCategory: string } };
      }>("SELECT public.claim_booking_projection_job($1) AS job", [bookingId]);
      expect(claimed.rows[0]?.job.booking).toMatchObject({
        vendorName: "Hanbang Studio",
        vendorCategory: "studio",
      });

      await db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [bookingId, SOLO_COUPLE_ID, SOLO_ID],
      );
      await expect(db.query(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         )`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      )).rejects.toThrow(/booking_intent_already_cancelled/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("fails every two-person direct booking mutation closed without side effects", async () => {
    const originalProgress = {
      __events: [event("joint-booking-sentinel")],
      studio: { budget: 2_000_000, spent: 321_000 },
    };
    const db = await createDatabase({ coupleProgress: originalProgress });
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      await expect(db.query(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         )`,
        [VENDOR_ID, COUPLE_ID, BRIDE_ID, bookingDate],
      )).rejects.toThrow(/booking_joint_approval_required/);
      const createState = await db.query<{
        bookings: number;
        decisions: number;
        jobs: number;
        progress: Record<string, unknown>;
        state_revision: number;
      }>(
        `SELECT
           (SELECT count(*)::integer FROM public.vendor_bookings) AS bookings,
           (SELECT count(*)::integer FROM public.decision_nodes) AS decisions,
           (SELECT count(*)::integer FROM public.booking_projection_jobs) AS jobs,
           journey.progress,
           journey.state_revision
         FROM public.wedding_journeys AS journey
         WHERE journey.couple_id = $1`,
        [COUPLE_ID],
      );
      expect(createState.rows[0]).toEqual({
        bookings: 0,
        decisions: 0,
        jobs: 0,
        progress: originalProgress,
        state_revision: 0,
      });

      await seedLegacyBooking(db,
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, status, amount
         ) VALUES ($1, $2, $3, $4, '10:00', 'pending', 500000)`,
        [BOOKING_ID, VENDOR_ID, COUPLE_ID, bookingDate],
      );
      const before = await db.query<{
        booking: Record<string, unknown>;
        job: Record<string, unknown>;
        decisions: number;
        progress: Record<string, unknown>;
        state_revision: number;
      }>(
        `SELECT
           jsonb_build_object(
             'status', booking.status,
             'amount', booking.amount,
             'actualAmount', booking.actual_amount,
             'contractedAmount', booking.contracted_amount,
             'cancelledAt', booking.cancelled_at,
             'cancelledBy', booking.cancelled_by_profile_id
           ) AS booking,
           jsonb_build_object(
             'desiredState', job.desired_state,
             'generation', job.generation,
             'status', job.status,
             'attemptCount', job.attempt_count
           ) AS job,
           (SELECT count(*)::integer FROM public.decision_nodes) AS decisions,
           journey.progress,
           journey.state_revision
         FROM public.vendor_bookings AS booking
         JOIN public.booking_projection_jobs AS job ON job.booking_id = booking.id
         JOIN public.wedding_journeys AS journey ON journey.couple_id = booking.couple_id
         WHERE booking.id = $1`,
        [BOOKING_ID],
      );

      await expect(db.query(
        "SELECT public.cancel_booking_atomic($1, $2, $3)",
        [BOOKING_ID, COUPLE_ID, BRIDE_ID],
      )).rejects.toThrow(/booking_joint_approval_required/);
      await expect(db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, 'user report', false
         )`,
        [BOOKING_ID, BRIDE_ID],
      )).rejects.toThrow(/booking_joint_approval_required/);
      await expect(db.query(
        `SELECT public.complete_vendor_booking_outcome(
           $1, $2, 650000, 500000, 5, 'bypass', false
         )`,
        [BOOKING_ID, BRIDE_ID],
      )).rejects.toThrow(/permission denied/i);

      const after = await db.query<{
        booking: Record<string, unknown>;
        job: Record<string, unknown>;
        decisions: number;
        progress: Record<string, unknown>;
        state_revision: number;
      }>(
        `SELECT
           jsonb_build_object(
             'status', booking.status,
             'amount', booking.amount,
             'actualAmount', booking.actual_amount,
             'contractedAmount', booking.contracted_amount,
             'cancelledAt', booking.cancelled_at,
             'cancelledBy', booking.cancelled_by_profile_id
           ) AS booking,
           jsonb_build_object(
             'desiredState', job.desired_state,
             'generation', job.generation,
             'status', job.status,
             'attemptCount', job.attempt_count
           ) AS job,
           (SELECT count(*)::integer FROM public.decision_nodes) AS decisions,
           journey.progress,
           journey.state_revision
         FROM public.vendor_bookings AS booking
         JOIN public.booking_projection_jobs AS job ON job.booking_id = booking.id
         JOIN public.wedding_journeys AS journey ON journey.couple_id = booking.couple_id
         WHERE booking.id = $1`,
        [BOOKING_ID],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);

      await resetPersona(db);
      const capabilities = await db.query<{
        intent_count: number;
        outcome_count: number;
        cancel_count: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
            FROM public.booking_intent_write_authorizations) AS intent_count,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS outcome_count,
           (SELECT count(*)::integer
            FROM public.booking_cancellation_write_authorizations) AS cancel_count`,
      );
      expect(capabilities.rows[0]).toEqual({
        intent_count: 0,
        outcome_count: 0,
        cancel_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("records a one-person outcome as user-reported evidence while retaining intent snapshots", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;
      await db.query(
        `UPDATE public.vendors
         SET name = 'Later Vendor Name', category = 'later_category'
         WHERE id = $1`,
        [VENDOR_ID],
      );

      const completed = await db.query<{
        result: {
          completionEvidence: string;
          vendorDeliveryStatus: string;
          vendorConfirmationStatus: string;
          context: {
            vendorName: string;
            vendorCategory: string;
            productName: string | null;
          };
        };
      }>(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '사용자 완료 기록', false
         ) AS result`,
        [bookingId, SOLO_ID],
      );
      expect(completed.rows[0]?.result).toMatchObject({
        completionEvidence: "user_reported",
        vendorDeliveryStatus: "not_sent",
        vendorConfirmationStatus: "unconfirmed",
        context: {
          vendorName: "Hanbang Studio",
          vendorCategory: "studio",
          productName: null,
        },
      });

      const state = await db.query<{
        status: string;
        actual_amount: number;
        contracted_amount: number;
        completed_decisions: number;
        considering_active: number;
        considering_superseded: number;
        completion_evidence: string;
        vendor_name: string;
        vendor_confirmation_status: string;
        source_actor_role: string;
        user_confirmed_at: string;
        actor_profile_id: string;
        outcome_provenance_version: number;
      }>(
        `SELECT booking.status,
                booking.actual_amount::integer AS actual_amount,
                booking.contracted_amount::integer AS contracted_amount,
                (SELECT count(*)::integer
                 FROM public.decision_nodes AS decision
                 WHERE decision.source_ref_id = booking.id
                   AND decision.decision_type = 'completed') AS completed_decisions,
                (SELECT count(*)::integer
                 FROM public.decision_nodes AS decision
                 WHERE decision.source_ref_id = booking.id
                   AND decision.decision_type = 'considering'
                   AND decision.superseded_at IS NULL) AS considering_active,
                (SELECT count(*)::integer
                 FROM public.decision_nodes AS decision
                 WHERE decision.source_ref_id = booking.id
                   AND decision.decision_type = 'considering'
                   AND decision.superseded_at IS NOT NULL) AS considering_superseded,
                completed.chosen_value ->> 'completion_evidence'
                  AS completion_evidence,
                completed.chosen_value ->> 'vendor_name' AS vendor_name,
                completed.chosen_value ->> 'vendor_confirmation_status'
                  AS vendor_confirmation_status,
                completed.source_actor_role,
                completed.user_confirmed_at::text AS user_confirmed_at,
                completed.metadata ->> 'actor_profile_id' AS actor_profile_id,
                (completed.metadata ->> 'outcome_provenance_version')::integer
                  AS outcome_provenance_version
         FROM public.vendor_bookings AS booking
         JOIN public.decision_nodes AS completed
           ON completed.source_ref_id = booking.id
          AND completed.decision_type = 'completed'
         WHERE booking.id = $1`,
        [bookingId],
      );
      expect(state.rows[0]).toEqual({
        status: "completed",
        actual_amount: 650_000,
        contracted_amount: 500_000,
        completed_decisions: 1,
        considering_active: 0,
        considering_superseded: 1,
        completion_evidence: "user_reported",
        vendor_name: "Hanbang Studio",
        vendor_confirmation_status: "unconfirmed",
        source_actor_role: "bride",
        user_confirmed_at: expect.any(String),
        actor_profile_id: SOLO_ID,
        outcome_provenance_version: 1,
      });
      await expect(db.query(
        "SELECT * FROM public.booking_outcome_write_authorizations",
      )).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("orders created, confirmed, decided, and updated times in a delayed transaction", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;

      await db.exec("BEGIN");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      await db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '지연 트랜잭션', false
         )`,
        [bookingId, SOLO_ID],
      );
      await db.exec("COMMIT");

      const timestamps = await db.query<{
        created_at: number;
        confirmed_at: number;
        decided_at: number;
        updated_at: number;
      }>(
        `SELECT
           extract(epoch FROM decision.created_at)::double precision
             AS created_at,
           extract(epoch FROM decision.user_confirmed_at)::double precision
             AS confirmed_at,
           extract(epoch FROM decision.decided_at)::double precision
             AS decided_at,
           extract(epoch FROM decision.updated_at)::double precision
             AS updated_at
         FROM public.decision_nodes AS decision
         WHERE decision.source = 'vendor_booking'
           AND decision.source_ref_id = $1
           AND decision.decision_type = 'completed'`,
        [bookingId],
      );
      const saved = timestamps.rows[0];
      expect(saved?.created_at).toBeLessThanOrEqual(saved?.confirmed_at ?? 0);
      expect(saved?.confirmed_at).toBe(saved?.decided_at);
      expect(saved?.decided_at).toBeLessThanOrEqual(saved?.updated_at ?? 0);
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves the first actor and confirmation time on an exact outcome retry", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;

      const first = await db.query<{
        result: { decisionId: string };
      }>(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '같은 완료 기록', false
         ) AS result`,
        [bookingId, SOLO_ID],
      );
      const firstState = await db.query<{
        user_confirmed_at: string;
        decided_at: string;
      }>(
        `SELECT
           decision.user_confirmed_at::text AS user_confirmed_at,
           decision.decided_at::text AS decided_at
         FROM public.decision_nodes AS decision
         WHERE decision.id = $1`,
        [first.rows[0]?.result.decisionId],
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));

      const replay = await db.query<{
        result: { decisionId: string };
      }>(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '같은 완료 기록', false
         ) AS result`,
        [bookingId, SOLO_ID],
      );
      const replayState = await db.query<{
        completed_decisions: number;
        user_confirmed_at: string;
        decided_at: string;
        actor_profile_id: string;
        source_actor_role: string;
      }>(
        `SELECT
           count(*)::integer AS completed_decisions,
           min(decision.user_confirmed_at)::text AS user_confirmed_at,
           min(decision.decided_at)::text AS decided_at,
           min(decision.metadata ->> 'actor_profile_id') AS actor_profile_id,
           min(decision.source_actor_role) AS source_actor_role
         FROM public.decision_nodes AS decision
         WHERE decision.source = 'vendor_booking'
           AND decision.source_ref_id = $1
           AND decision.decision_type = 'completed'`,
        [bookingId],
      );

      expect(replay.rows[0]?.result.decisionId)
        .toBe(first.rows[0]?.result.decisionId);
      expect(replayState.rows[0]).toEqual({
        completed_decisions: 1,
        user_confirmed_at: firstState.rows[0]?.user_confirmed_at,
        decided_at: firstState.rows[0]?.decided_at,
        actor_profile_id: SOLO_ID,
        source_actor_role: "bride",
      });

      await resetPersona(db);
      await db.query(
        `UPDATE public.decision_nodes
         SET decided_at = user_confirmed_at - interval '1 second'
         WHERE id = $1`,
        [first.rows[0]?.result.decisionId],
      );
      const invalidBefore = await db.query<{
        booking: Record<string, unknown>;
        decision: Record<string, unknown>;
        authorizations: number;
      }>(
        `SELECT
           to_jsonb(booking) AS booking,
           to_jsonb(decision) AS decision,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS authorizations
         FROM public.vendor_bookings AS booking
         JOIN public.decision_nodes AS decision
           ON decision.source_ref_id = booking.id
          AND decision.decision_type = 'completed'
         WHERE booking.id = $1`,
        [bookingId],
      );
      await setServiceRole(db);
      await expect(db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '같은 완료 기록', false
         )`,
        [bookingId, SOLO_ID],
      )).rejects.toThrow(/booking_outcome_provenance_missing/);
      await resetPersona(db);
      const invalidAfter = await db.query<{
        booking: Record<string, unknown>;
        decision: Record<string, unknown>;
        authorizations: number;
      }>(
        `SELECT
           to_jsonb(booking) AS booking,
           to_jsonb(decision) AS decision,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS authorizations
         FROM public.vendor_bookings AS booking
         JOIN public.decision_nodes AS decision
           ON decision.source_ref_id = booking.id
          AND decision.decision_type = 'completed'
         WHERE booking.id = $1`,
        [bookingId],
      );
      expect(invalidAfter.rows[0]).toEqual(invalidBefore.rows[0]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("treats rating, review, and public visibility as part of the exact payload", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;
      const record = async (
        rating: number,
        review: string,
        sharePublicReview: boolean,
      ) => {
        const completed = await db.query<{
          result: { decisionId: string };
        }>(
          `SELECT public.complete_amora_booking_outcome_atomic(
             $1, $2, 650000, 500000, $3, $4, $5
           ) AS result`,
          [bookingId, SOLO_ID, rating, review, sharePublicReview],
        );
        const decision = await db.query<{ payload_digest: string }>(
          `SELECT metadata ->> 'outcome_payload_digest' AS payload_digest
           FROM public.decision_nodes
           WHERE id = $1`,
          [completed.rows[0]?.result.decisionId],
        );
        return {
          decisionId: completed.rows[0]?.result.decisionId,
          payloadDigest: decision.rows[0]?.payload_digest,
        };
      };

      const original = await record(5, "원본 후기", false);
      const ratingChanged = await record(4, "원본 후기", false);
      const reviewChanged = await record(4, "수정 후기", false);
      const publicChanged = await record(4, "수정 후기", true);

      expect(new Set([
        original.decisionId,
        ratingChanged.decisionId,
        reviewChanged.decisionId,
        publicChanged.decisionId,
      ])).toEqual(new Set([original.decisionId]));
      expect(new Set([
        original.payloadDigest,
        ratingChanged.payloadDigest,
        reviewChanged.payloadDigest,
        publicChanged.payloadDigest,
      ]).size).toBe(4);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps the outcome wrapper service-only and the legacy writer private", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      const acl = await db.query<{
        wrapper_owner: string;
        wrapper_security_definer: boolean;
        wrapper_config_preserved: boolean;
        anon_wrapper: boolean;
        authenticated_wrapper: boolean;
        service_wrapper: boolean;
        anon_legacy: boolean;
        authenticated_legacy: boolean;
        service_legacy: boolean;
      }>(
        `SELECT
           owner.rolname AS wrapper_owner,
           wrapper.prosecdef AS wrapper_security_definer,
           wrapper.proconfig @> ARRAY[
             'search_path=pg_catalog, public',
             'lock_timeout=5s',
             'statement_timeout=20s'
           ]::text[] AS wrapper_config_preserved,
           has_function_privilege(
             'anon', wrapper.oid, 'EXECUTE'
           ) AS anon_wrapper,
           has_function_privilege(
             'authenticated', wrapper.oid, 'EXECUTE'
           ) AS authenticated_wrapper,
           has_function_privilege(
             'service_role', wrapper.oid, 'EXECUTE'
           ) AS service_wrapper,
           has_function_privilege(
             'anon', legacy_writer.oid, 'EXECUTE'
           ) AS anon_legacy,
           has_function_privilege(
             'authenticated', legacy_writer.oid, 'EXECUTE'
           ) AS authenticated_legacy,
           has_function_privilege(
             'service_role', legacy_writer.oid, 'EXECUTE'
           ) AS service_legacy
         FROM pg_catalog.pg_proc AS wrapper
         JOIN pg_catalog.pg_roles AS owner ON owner.oid = wrapper.proowner
         CROSS JOIN pg_catalog.pg_proc AS legacy_writer
         WHERE wrapper.oid = to_regprocedure(
                 'public.complete_amora_booking_outcome_atomic(uuid,uuid,numeric,numeric,integer,text,boolean)'
               )
           AND legacy_writer.oid = to_regprocedure(
                 'public.complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)'
               )`,
      );
      expect(acl.rows[0]).toEqual({
        wrapper_owner: "postgres",
        wrapper_security_definer: true,
        wrapper_config_preserved: true,
        anon_wrapper: false,
        authenticated_wrapper: false,
        service_wrapper: true,
        anon_legacy: false,
        authenticated_legacy: false,
        service_legacy: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects ambiguous or profile-mismatched actor slots without writes", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;

      await resetPersona(db);
      await db.query(
        `UPDATE public.couples
         SET groom_id = $1
         WHERE id = $2`,
        [SOLO_ID, SOLO_COUPLE_ID],
      );
      await setServiceRole(db);
      await expect(db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '중복 슬롯', false
         )`,
        [bookingId, SOLO_ID],
      )).rejects.toThrow(/booking_outcome_actor_binding_invalid/);

      await resetPersona(db);
      await db.query(
        `UPDATE public.couples
         SET groom_id = NULL
         WHERE id = $1`,
        [SOLO_COUPLE_ID],
      );
      await db.query(
        `UPDATE public.profiles
         SET role = 'groom'
         WHERE id = $1`,
        [SOLO_ID],
      );
      await setServiceRole(db);
      await expect(db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '역할 불일치', false
         )`,
        [bookingId, SOLO_ID],
      )).rejects.toThrow(/booking_outcome_actor_binding_invalid/);

      await resetPersona(db);
      const state = await db.query<{
        status: string;
        completed_decisions: number;
        authorizations: number;
      }>(
        `SELECT
           booking.status,
           (SELECT count(*)::integer
            FROM public.decision_nodes AS decision
            WHERE decision.source_ref_id = booking.id
              AND decision.decision_type = 'completed') AS completed_decisions,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS authorizations
         FROM public.vendor_bookings AS booking
         WHERE booking.id = $1`,
        [bookingId],
      );
      expect(state.rows[0]).toEqual({
        status: "pending",
        completed_decisions: 0,
        authorizations: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects an exact retry by a replacement actor without changing outcome state", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;
      await db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '같은 완료 기록', false
         )`,
        [bookingId, SOLO_ID],
      );
      const before = await db.query<{
        booking: Record<string, unknown>;
        decision: Record<string, unknown>;
      }>(
        `SELECT
           jsonb_build_object(
             'status', booking.status,
             'actualAmount', booking.actual_amount,
             'contractedAmount', booking.contracted_amount,
             'updatedAt', booking.updated_at
           ) AS booking,
           jsonb_build_object(
             'id', decision.id,
             'sourceActorRole', decision.source_actor_role,
             'userConfirmedAt', decision.user_confirmed_at,
             'metadata', decision.metadata,
             'updatedAt', decision.updated_at
           ) AS decision
         FROM public.vendor_bookings AS booking
         JOIN public.decision_nodes AS decision
           ON decision.source_ref_id = booking.id
          AND decision.source = 'vendor_booking'
          AND decision.decision_type = 'completed'
         WHERE booking.id = $1`,
        [bookingId],
      );

      await resetPersona(db);
      await db.query(
        "INSERT INTO auth.users(id) VALUES ($1)",
        [REPLACEMENT_SOLO_ID],
      );
      await db.query(
        `INSERT INTO public.profiles(id, couple_id, role)
         VALUES ($1, $2, 'groom')`,
        [REPLACEMENT_SOLO_ID, SOLO_COUPLE_ID],
      );
      await db.query(
        `UPDATE public.couples
         SET bride_id = NULL, groom_id = $1
         WHERE id = $2`,
        [REPLACEMENT_SOLO_ID, SOLO_COUPLE_ID],
      );
      await setServiceRole(db);

      await expect(db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '같은 완료 기록', false
         )`,
        [bookingId, REPLACEMENT_SOLO_ID],
      )).rejects.toThrow(/booking_outcome_replay_actor_mismatch/);

      const after = await db.query<{
        booking: Record<string, unknown>;
        decision: Record<string, unknown>;
      }>(
        `SELECT
           jsonb_build_object(
             'status', booking.status,
             'actualAmount', booking.actual_amount,
             'contractedAmount', booking.contracted_amount,
             'updatedAt', booking.updated_at
           ) AS booking,
           jsonb_build_object(
             'id', decision.id,
             'sourceActorRole', decision.source_actor_role,
             'userConfirmedAt', decision.user_confirmed_at,
             'metadata', decision.metadata,
             'updatedAt', decision.updated_at
           ) AS decision
         FROM public.vendor_bookings AS booking
         JOIN public.decision_nodes AS decision
           ON decision.source_ref_id = booking.id
          AND decision.source = 'vendor_booking'
          AND decision.decision_type = 'completed'
         WHERE booking.id = $1`,
        [bookingId],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      await resetPersona(db);
      const authorizationState = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.booking_outcome_write_authorizations`,
      );
      expect(authorizationState.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("records a changed outcome with the current replacement actor and a new time", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;
      const first = await db.query<{
        result: { decisionId: string };
      }>(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '최초 완료 기록', false
         ) AS result`,
        [bookingId, SOLO_ID],
      );
      const before = await db.query<{
        user_confirmed_at: string;
        decided_at: string;
        payload_digest: string;
      }>(
        `SELECT
           decision.user_confirmed_at::text AS user_confirmed_at,
           decision.decided_at::text AS decided_at,
           decision.metadata ->> 'outcome_payload_digest' AS payload_digest
         FROM public.decision_nodes AS decision
         WHERE decision.id = $1`,
        [first.rows[0]?.result.decisionId],
      );

      await resetPersona(db);
      await db.query(
        "INSERT INTO auth.users(id) VALUES ($1)",
        [REPLACEMENT_SOLO_ID],
      );
      await db.query(
        `INSERT INTO public.profiles(id, couple_id, role)
         VALUES ($1, $2, 'groom')`,
        [REPLACEMENT_SOLO_ID, SOLO_COUPLE_ID],
      );
      await db.query(
        `UPDATE public.couples
         SET bride_id = NULL, groom_id = $1
         WHERE id = $2`,
        [REPLACEMENT_SOLO_ID, SOLO_COUPLE_ID],
      );
      await setServiceRole(db);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));

      const changed = await db.query<{
        result: { decisionId: string };
      }>(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 4, '수정한 완료 기록', true
         ) AS result`,
        [bookingId, REPLACEMENT_SOLO_ID],
      );
      const after = await db.query<{
        source_actor_role: string;
        actor_profile_id: string;
        user_confirmed_at: string;
        decided_at: string;
        payload_digest: string;
        provenance_version: number;
        completed_decisions: number;
      }>(
        `SELECT
           decision.source_actor_role,
           decision.metadata ->> 'actor_profile_id' AS actor_profile_id,
           decision.user_confirmed_at::text AS user_confirmed_at,
           decision.decided_at::text AS decided_at,
           decision.metadata ->> 'outcome_payload_digest' AS payload_digest,
           (decision.metadata ->> 'outcome_provenance_version')::integer
             AS provenance_version,
           (SELECT count(*)::integer
            FROM public.decision_nodes AS counted
            WHERE counted.source_ref_id = $1
              AND counted.source = 'vendor_booking'
              AND counted.decision_type = 'completed') AS completed_decisions
         FROM public.decision_nodes AS decision
         WHERE decision.id = $2`,
        [bookingId, changed.rows[0]?.result.decisionId],
      );

      expect(changed.rows[0]?.result.decisionId)
        .toBe(first.rows[0]?.result.decisionId);
      expect(after.rows[0]).toMatchObject({
        source_actor_role: "groom",
        actor_profile_id: REPLACEMENT_SOLO_ID,
        provenance_version: 1,
        completed_decisions: 1,
      });
      expect(after.rows[0]?.user_confirmed_at)
        .not.toBe(before.rows[0]?.user_confirmed_at);
      expect(after.rows[0]?.decided_at).toBe(after.rows[0]?.user_confirmed_at);
      expect(before.rows[0]?.decided_at).toBe(before.rows[0]?.user_confirmed_at);
      expect(after.rows[0]?.payload_digest)
        .not.toBe(before.rows[0]?.payload_digest);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("does not attribute a provenance-null completed outcome to the current actor", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;
      await db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '과거 완료 기록', false
         )`,
        [bookingId, SOLO_ID],
      );

      await resetPersona(db);
      await db.query(
        `UPDATE public.decision_nodes
         SET source_actor_role = NULL,
             user_confirmed_at = NULL,
             metadata = metadata
               - 'actor_profile_id'
               - 'outcome_provenance_version'
               - 'outcome_payload_digest'
         WHERE source = 'vendor_booking'
           AND source_ref_id = $1
           AND decision_type = 'completed'`,
        [bookingId],
      );
      const before = await db.query<{
        booking: Record<string, unknown>;
        decision: Record<string, unknown>;
        authorizations: number;
      }>(
        `SELECT
           to_jsonb(booking) AS booking,
           to_jsonb(decision) AS decision,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS authorizations
         FROM public.vendor_bookings AS booking
         JOIN public.decision_nodes AS decision
           ON decision.source_ref_id = booking.id
          AND decision.source = 'vendor_booking'
          AND decision.decision_type = 'completed'
         WHERE booking.id = $1`,
        [bookingId],
      );
      await setServiceRole(db);

      await expect(db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 660000, 500000, 4, '수정 시도', true
         )`,
        [bookingId, SOLO_ID],
      )).rejects.toThrow(/booking_outcome_provenance_missing/);

      await resetPersona(db);
      const after = await db.query<{
        booking: Record<string, unknown>;
        decision: Record<string, unknown>;
        authorizations: number;
      }>(
        `SELECT
           to_jsonb(booking) AS booking,
           to_jsonb(decision) AS decision,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS authorizations
         FROM public.vendor_bookings AS booking
         JOIN public.decision_nodes AS decision
           ON decision.source_ref_id = booking.id
          AND decision.source = 'vendor_booking'
          AND decision.decision_type = 'completed'
         WHERE booking.id = $1`,
        [bookingId],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back the booking, decision, projection, and capability when provenance recording fails", async () => {
    const db = await createDatabase();
    const bookingDate = "2099-07-20";
    try {
      await setServiceRole(db);
      await db.query(
        `INSERT INTO public.vendor_timeslots (
           vendor_id, day, hour, available, max_bookings
         ) VALUES (
           $1,
           (((EXTRACT(DOW FROM $2::date)::integer + 6) % 7)::smallint),
           10, true, 1
         )`,
        [VENDOR_ID, bookingDate],
      );
      const created = await db.query<{ booking_id: string }>(
        `SELECT public.create_amora_booking_intent_atomic(
           $1, $2, $3, $4, '10:00'
         ) AS booking_id`,
        [VENDOR_ID, SOLO_COUPLE_ID, SOLO_ID, bookingDate],
      );
      const bookingId = created.rows[0]?.booking_id;

      await resetPersona(db);
      const before = await db.query<{
        booking: Record<string, unknown>;
        projection: Record<string, unknown>;
        decisions: Record<string, unknown>[];
        authorizations: number;
      }>(
        `SELECT
           to_jsonb(booking) AS booking,
           to_jsonb(job) AS projection,
           (SELECT jsonb_agg(to_jsonb(decision) ORDER BY decision.id)
            FROM public.decision_nodes AS decision
            WHERE decision.source_ref_id = booking.id) AS decisions,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS authorizations
         FROM public.vendor_bookings AS booking
         JOIN public.booking_projection_jobs AS job
           ON job.booking_id = booking.id
         WHERE booking.id = $1`,
        [bookingId],
      );
      await db.exec(`
        ALTER TABLE public.decision_nodes
          ADD CONSTRAINT test_reject_booking_outcome_provenance CHECK (
            (metadata ->> 'outcome_provenance_version') IS DISTINCT FROM '1'
          )
      `);
      await setServiceRole(db);

      await expect(db.query(
        `SELECT public.complete_amora_booking_outcome_atomic(
           $1, $2, 650000, 500000, 5, '롤백 확인', false
         )`,
        [bookingId, SOLO_ID],
      )).rejects.toThrow(/test_reject_booking_outcome_provenance/);

      await resetPersona(db);
      const after = await db.query<{
        booking: Record<string, unknown>;
        projection: Record<string, unknown>;
        decisions: Record<string, unknown>[];
        authorizations: number;
      }>(
        `SELECT
           to_jsonb(booking) AS booking,
           to_jsonb(job) AS projection,
           (SELECT jsonb_agg(to_jsonb(decision) ORDER BY decision.id)
            FROM public.decision_nodes AS decision
            WHERE decision.source_ref_id = booking.id) AS decisions,
           (SELECT count(*)::integer
            FROM public.booking_outcome_write_authorizations) AS authorizations
         FROM public.vendor_bookings AS booking
         JOIN public.booking_projection_jobs AS job
           ON job.booking_id = booking.id
         WHERE booking.id = $1`,
        [bookingId],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back the journey, partner acceptance, and applied transition when decision recording fails", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      const pending = await submit(db);
      await resetPersona(db);
      await db.exec(`
        ALTER TABLE public.decision_nodes
          ADD CONSTRAINT test_reject_manual_decision CHECK (
            metadata ->> 'origin' <> 'couple_plan_change_request'
          )
      `);
      await setServiceRole(db);

      await expect(accept(db, pending.requestId))
        .rejects.toThrow(/test_reject_manual_decision/);
      const state = await db.query<{
        state_revision: number;
        progress: Record<string, unknown>;
        request_status: string;
        acceptances: number;
        decisions: number;
      }>(`
        SELECT journey.state_revision,
               journey.progress,
               request.status AS request_status,
               (SELECT count(*)::integer
                FROM public.couple_plan_change_acceptances AS acceptance
                WHERE acceptance.request_id = request.id) AS acceptances,
               (SELECT count(*)::integer
                FROM public.decision_nodes) AS decisions
        FROM public.wedding_journeys AS journey
        JOIN public.couple_plan_change_requests AS request
          ON request.couple_id = journey.couple_id
        WHERE request.id = $1
      `, [pending.requestId]);
      expect(state.rows[0]).toEqual({
        state_revision: 0,
        progress: {},
        request_status: "pending",
        acceptances: 1,
        decisions: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});

/**
 * 2026-08-19. 일정 화면에서 항목을 체크하면서 날짜를 넣으면 저장이 **통째로 실패**했다.
 * 클라이언트가 `__events`(일정)와 카테고리 키(체크)를 한 번의 저장에 같이 실었기 때문이다.
 * 화면은 오류를 모달 뒤에 그려서 아무 말도 안 하는 것처럼 보였다.
 *
 * 여기서 막는 것은 재발이다 — 이 계약이 살아 있는 한 클라이언트는 두 번에 나눠 보내야 한다.
 * 반대로 누군가 "간단하니까" 하고 DB 쪽 검사를 푸는 것도 이 테스트가 잡는다.
 */
describe("일정과 체크리스트를 한 번에 저장할 수 없다", () => {
  it("섞어 보내면 거절하고, 나눠 보내면 둘 다 통과한다", async () => {
    const mixed = await createDatabase();
    await setServiceRole(mixed);
    await expect(
      submit(mixed, {
        surface: "/schedule",
        changes: {
          progress_patch: {
            __events: [event("event-1")],
            venue: {
              category: "venue",
              status: "in_progress",
              checklist: [{ id: "venue_01", label: "원하는 결혼식장 형태 정하기", done: true }],
            },
          },
        },
      }),
    ).rejects.toThrow(/AMORA_MANUAL_SCHEDULE_MIXED_DELTA_DENIED/);

    // 나눠 보내면 각각은 통과한다 — 클라이언트가 택해야 하는 경로다.
    const onlyEvents = await createDatabase();
    await setServiceRole(onlyEvents);
    expect((await submit(onlyEvents, { surface: "/schedule" })).status)
      .toBe("pending_partner");

    const onlyChecklist = await createDatabase();
    await setServiceRole(onlyChecklist);
    expect(
      (await submit(onlyChecklist, {
        surface: "/schedule",
        changes: {
          progress_patch: {
            venue: {
              category: "venue",
              status: "in_progress",
              checklist: [{ id: "venue_01", label: "원하는 결혼식장 형태 정하기", done: true }],
            },
          },
        },
      })).status,
    ).toBe("applied");
  }, 120000);
});
