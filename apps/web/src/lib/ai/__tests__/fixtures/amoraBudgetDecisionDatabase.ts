import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
export const USER_ID = "20000000-0000-4000-8000-000000000001";
export const PARTNER_ID = "20000000-0000-4000-8000-000000000002";
export const OUTSIDER_ID = "20000000-0000-4000-8000-000000000003";
export const OTHER_COUPLE_ID = "10000000-0000-4000-8000-000000000002";
export const BUDGET_MIGRATION = "20260910160514_amora_shared_budget_decision_receipts.sql";

export function migration(name: string) {
  return readFileSync(resolve(process.cwd(), "../../supabase/migrations", name), "utf8");
}
function exactFunction(sql: string, name: string) {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public." + name + "(");
  const end = sql.indexOf("$function$;", start);
  if (start < 0 || end < 0) throw new Error("Required production function missing: " + name);
  return sql.slice(start, end + "$function$;".length);
}

/** Real dispatcher + approval/roster/receipt functions. Only unrelated schemas are minimal fixtures. */
export async function createBudgetDecisionDatabase(includeBudgetMigration = true) {
  const db = await PGlite.create();
  await db.exec(`

    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.couples (id uuid PRIMARY KEY, bride_id uuid REFERENCES auth.users(id), groom_id uuid REFERENCES auth.users(id));
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
      sender_role text,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      stage_tag text,
      specialist_type text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      total_budget bigint NOT NULL DEFAULT 0,
      wedding_date date,
      venue text,
      progress jsonb DEFAULT '{}'::jsonb,
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

    CREATE SCHEMA extensions;
    -- PostgreSQL's built-in SHA-256 preserves the production digest bytes.
    -- Only the pgcrypto wrapper is supplied for this PGlite build.
    CREATE FUNCTION extensions.digest(value bytea, algorithm text)
    RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE WHEN algorithm = 'sha256' THEN sha256(value) ELSE NULL END
    $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
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

    ALTER TABLE public.decision_nodes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY decision_select ON public.decision_nodes FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility));
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT ON public.decision_nodes TO authenticated;
    INSERT INTO auth.users(id) VALUES ('${USER_ID}'), ('${PARTNER_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO couples(id,bride_id,groom_id) VALUES ('${COUPLE_ID}','${USER_ID}','${PARTNER_ID}'),
      ('${OTHER_COUPLE_ID}','${OUTSIDER_ID}',NULL);
    INSERT INTO profiles(id,couple_id,role) VALUES ('${USER_ID}','${COUPLE_ID}','bride'),
      ('${PARTNER_ID}','${COUPLE_ID}','groom'), ('${OUTSIDER_ID}','${OTHER_COUPLE_ID}','bride');
    INSERT INTO wedding_journeys(couple_id) VALUES ('${COUPLE_ID}'), ('${OTHER_COUPLE_ID}');
  `);
  for (const name of [
    "20260704120000_create_amora_turn_reserve_rpc.sql",
    "20260716097000_amora_atomic_cost_budget.sql",
    "20260716110000_amora_crash_recovery_atomicity.sql",
    "20260716112000_amora_atomic_mutation_coverage.sql",
    "20260730102000_amora_shared_action_approval_and_notifications.sql",
    "20260802100000_amora_shared_schedule_decision_receipts.sql",
    "20260802170000_amora_shared_action_roster_binding.sql",
  ]) await db.exec(migration(name));
  const notificationPolicy = migration("20260823120000_couple_approval_becomes_notification.sql");
  await db.exec(exactFunction(notificationPolicy, "amora_shared_action_policy"));
  await db.exec(exactFunction(notificationPolicy, "amora_shared_action_context_pre_roster_binding"));
  for (const name of [
    "20260824150000_amora_custom_category_label_match.sql",
    "20260827090000_move_card_can_name_what_it_moves.sql",
    "20260906130734_amora_budget_plan_preserves_existing_allocations.sql",
    "20260907085111_amora_budget_plan_named_allocations.sql",
  ]) {
    const sql = migration(name);
    if (sql.trim()) await db.exec(sql);
  }
  if (includeBudgetMigration) await db.exec(migration(BUDGET_MIGRATION));
  await db.exec("SET ROLE service_role");
  await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
  return db;
}
