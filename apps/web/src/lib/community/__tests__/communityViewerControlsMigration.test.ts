// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260804180000_community_viewer_controls.sql",
  ),
  "utf8",
);

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const USER_C = "10000000-0000-4000-8000-000000000003";
const ADMIN_ID = "10000000-0000-4000-8000-000000000004";
const POST_A = "20000000-0000-4000-8000-000000000001";
const POST_B = "20000000-0000-4000-8000-000000000002";
const POST_C = "20000000-0000-4000-8000-000000000003";
const COMMENT_B = "30000000-0000-4000-8000-000000000001";
const COHORT_MESSAGE_B = "40000000-0000-4000-8000-000000000001";
const POLL_B = "50000000-0000-4000-8000-000000000001";
const QUESTION_ID = "60000000-0000-4000-8000-000000000001";
const SLOT_ID = "70000000-0000-4000-8000-000000000001";
const REQUEST_ID = "80000000-0000-4000-8000-000000000001";

async function setRequestIdentity(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId?: string,
) {
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ""],
  );
}

async function createBaseline(db: PGlite) {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;

    CREATE OR REPLACE FUNCTION public.community_request_is_service()
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT COALESCE(auth.role(), '') = 'service_role'
    $$;

    CREATE TABLE public.community_runtime_controls (
      control_id boolean PRIMARY KEY DEFAULT true,
      mode text NOT NULL DEFAULT 'normal'
    );
    INSERT INTO public.community_runtime_controls(control_id, mode)
    VALUES (true, 'normal');
    CREATE OR REPLACE FUNCTION public.community_runtime_mode()
    RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT mode FROM public.community_runtime_controls WHERE control_id
    $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      avatar_url text,
      badge text,
      rank text NOT NULL DEFAULT 'sprout',
      is_suspended boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_agent_personas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      backing_user_id uuid UNIQUE
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL,
      parent_id uuid,
      author_id uuid NOT NULL,
      content text NOT NULL DEFAULT 'answer'
    );
    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY,
      author_id uuid NOT NULL,
      reply_to uuid,
      content text NOT NULL DEFAULT 'message'
    );
    CREATE TABLE public.community_reply_notifications (
      id uuid PRIMARY KEY,
      recipient_id uuid NOT NULL,
      actor_id uuid NOT NULL,
      read_at timestamptz
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
      comment_id uuid,
      vote_type smallint NOT NULL DEFAULT 1
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

    CREATE TABLE public.responder_capacity_slots (
      id uuid PRIMARY KEY,
      responder_id uuid NOT NULL,
      consumed_request_id uuid,
      opt_in_status text NOT NULL DEFAULT 'active',
      eligibility_status text NOT NULL DEFAULT 'verified_human_experience',
      has_conflict boolean NOT NULL DEFAULT false,
      available_from timestamptz NOT NULL DEFAULT (now() - interval '1 hour'),
      available_until timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_responder_questions (
      id uuid PRIMARY KEY,
      topic text NOT NULL,
      experience_scope text NOT NULL,
      intake_status text NOT NULL DEFAULT 'private_waitlist',
      created_by_operator uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_responder_requests (
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL,
      capacity_slot_id uuid NOT NULL,
      responder_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'requested',
      requested_role text NOT NULL DEFAULT 'primary',
      responder_origin text NOT NULL DEFAULT 'member',
      supply_lane text NOT NULL DEFAULT 'peer_member',
      expiry_idempotency_key uuid,
      expiry_reason_code text,
      commercial_relationship_at_request text NOT NULL DEFAULT 'none',
      conflict_at_request boolean NOT NULL DEFAULT false,
      response_commercial_relationship text,
      response_has_conflict boolean,
      created_by_operator uuid,
      expired_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_responder_supply_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL,
      question_id uuid,
      request_id uuid,
      capacity_slot_id uuid,
      actor_type text NOT NULL,
      actor_id uuid,
      actor_erased_at timestamptz,
      operation_idempotency_key uuid NOT NULL,
      previous_status text,
      new_status text,
      reason_code text,
      commercial_relationship text,
      has_conflict boolean,
      CONSTRAINT community_responder_supply_events_actor
        CHECK (
          actor_type IN ('responder', 'operator')
          AND (
            (actor_id IS NOT NULL AND actor_erased_at IS NULL)
            OR (actor_id IS NULL AND actor_erased_at IS NOT NULL)
          )
        )
    );

    CREATE OR REPLACE FUNCTION public.community_assert_responder_operator(
      p_operator_id uuid
    ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      IF NOT public.community_request_is_service()
        OR NOT EXISTS (
          SELECT 1 FROM public.profiles AS profile
          WHERE profile.id = p_operator_id AND profile.is_admin
        ) THEN
        RAISE EXCEPTION 'verified operator required' USING ERRCODE = '42501';
      END IF;
    END
    $$;
    CREATE OR REPLACE FUNCTION public.community_assert_responder_runtime_normal()
    RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE OR REPLACE FUNCTION public.community_lock_responder_identity(
      p_responder_id uuid
    ) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
    CREATE OR REPLACE FUNCTION public.community_write_responder_supply_event(
      p_event_type text,
      p_question_id uuid,
      p_request_id uuid,
      p_capacity_slot_id uuid,
      p_actor_type text,
      p_actor_id uuid,
      p_operation_idempotency_key uuid,
      p_previous_status text,
      p_new_status text,
      p_reason_code text,
      p_commercial_relationship text,
      p_has_conflict boolean
    ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      INSERT INTO public.community_responder_supply_events (
        event_type,
        question_id,
        request_id,
        capacity_slot_id,
        actor_type,
        actor_id,
        operation_idempotency_key,
        previous_status,
        new_status,
        reason_code,
        commercial_relationship,
        has_conflict
      ) VALUES (
        p_event_type,
        p_question_id,
        p_request_id,
        p_capacity_slot_id,
        p_actor_type,
        p_actor_id,
        p_operation_idempotency_key,
        p_previous_status,
        p_new_status,
        p_reason_code,
        p_commercial_relationship,
        p_has_conflict
      );
    END
    $$;
    CREATE OR REPLACE FUNCTION public.community_create_responder_request(
      p_question_id uuid,
      p_capacity_slot_id uuid,
      p_requested_role text,
      p_topic text,
      p_experience_scope text,
      p_expires_at timestamptz,
      p_operator_id uuid,
      p_idempotency_key uuid
    ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
      SELECT '{}'::jsonb
    $$;
    CREATE OR REPLACE FUNCTION public.community_respond_responder_request(
      p_responder_id uuid,
      p_request_id uuid,
      p_decision text,
      p_commercial_relationship text,
      p_has_conflict boolean,
      p_decline_reason_code text,
      p_idempotency_key uuid
    ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
      SELECT '{}'::jsonb
    $$;

    CREATE VIEW public.community_responder_question_supply AS
    SELECT
      question.id AS question_id,
      question.topic,
      question.experience_scope,
      question.intake_status,
      0::integer AS issued_request_count,
      0::integer AS historical_accept_count,
      0::integer AS confirmed_slot_count,
      0::integer AS peer_member_confirmed_slot_count,
      0::integer AS industry_professional_confirmed_slot_count,
      0::integer AS primary_confirmed_count,
      0::integer AS backup_confirmed_count,
      0::integer AS peer_member_primary_confirmed_count,
      0::integer AS peer_member_backup_confirmed_count,
      0::integer AS industry_professional_primary_confirmed_count,
      0::integer AS industry_professional_backup_confirmed_count,
      'private_waitlist'::text AS question_state
    FROM public.community_responder_questions AS question;

    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cohort_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.community_reply_notifications ENABLE ROW LEVEL SECURITY;

    CREATE POLICY baseline_posts_select ON public.community_posts
      FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY baseline_comments_select ON public.community_comments
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY baseline_cohort_messages_select ON public.cohort_messages
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY baseline_notifications_select
      ON public.community_reply_notifications
      FOR SELECT TO authenticated USING (recipient_id = auth.uid());
    CREATE POLICY baseline_notifications_update
      ON public.community_reply_notifications
      FOR UPDATE TO authenticated
      USING (recipient_id = auth.uid())
      WITH CHECK (recipient_id = auth.uid());

    GRANT SELECT ON public.community_posts TO anon, authenticated;
    GRANT SELECT ON public.community_comments TO authenticated;
    GRANT SELECT ON public.cohort_messages TO authenticated;
    GRANT SELECT, UPDATE(read_at)
      ON public.community_reply_notifications TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO auth.users(id) VALUES
      ('${USER_A}'), ('${USER_B}'), ('${USER_C}'), ('${ADMIN_ID}');
    INSERT INTO public.profiles(id, is_admin) VALUES ('${ADMIN_ID}', true);
    INSERT INTO public.community_profiles(user_id, nickname) VALUES
      ('${USER_A}', 'A'), ('${USER_B}', 'B'), ('${USER_C}', 'C');
    INSERT INTO public.community_posts(id, author_id) VALUES
      ('${POST_A}', '${USER_A}'),
      ('${POST_B}', '${USER_B}'),
      ('${POST_C}', '${USER_C}');
    INSERT INTO public.community_comments(id, post_id, author_id) VALUES
      ('${COMMENT_B}', '${POST_B}', '${USER_B}');
    INSERT INTO public.cohort_messages(id, author_id) VALUES
      ('${COHORT_MESSAGE_B}', '${USER_B}');
    INSERT INTO public.community_reply_notifications(
      id, recipient_id, actor_id
    ) VALUES (
      '90000000-0000-4000-8000-000000000001', '${USER_A}', '${USER_B}'
    );
    INSERT INTO public.community_polls(id, post_id)
    VALUES ('${POLL_B}', '${POST_B}');
  `);
}

async function setBlock(
  db: PGlite,
  actorId: string,
  targetId: string,
  blocked: boolean,
) {
  await setRequestIdentity(db, "service_role");
  await db.exec("SET ROLE service_role");
  const result = await db.query<{
    result: { blocked: boolean; changed: boolean; blocked_user_id: string };
  }>(`
    SELECT public.community_set_user_block(
      '${actorId}',
      '${targetId}',
      ${blocked ? "true" : "false"},
      ${blocked ? "'safety'" : "NULL"}
    ) AS result
  `);
  await db.exec("RESET ROLE");
  return result.rows[0]!.result;
}

describe("community viewer controls migration", () => {
  it("allows only a readable author-deleted parent ID and keeps blocking authoritative", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      const baseMigration = readFileSync(resolve(repoRoot, "supabase/migrations/20260325000000_community.sql"), "utf8");
      const releaseMigration = readFileSync(resolve(repoRoot, "supabase/migrations/20260731180000_community_release_trust_boundary.sql"), "utf8");
      const basePolicy = baseMigration.match(/CREATE POLICY "cc_select"[\s\S]*?;/u)?.[0];
      const reviewPolicy = releaseMigration.match(/CREATE POLICY community_comments_release_review_visibility[\s\S]*?;/u)?.[0];
      expect(basePolicy).toBeTruthy();
      expect(reviewPolicy).toBeTruthy();
      await db.exec(`
        ALTER TABLE public.community_comments
          ADD COLUMN is_deleted boolean NOT NULL DEFAULT false,
          ADD COLUMN author_deleted_at timestamptz;
        DROP POLICY baseline_comments_select ON public.community_comments;
        ${basePolicy}
        ${reviewPolicy}
        UPDATE public.community_posts SET author_id = '${USER_C}'
        WHERE id = '${POST_B}';
        UPDATE public.community_comments
        SET is_deleted = true, author_deleted_at = now()
        WHERE id = '${COMMENT_B}';
      `);
      const readDeletedParent = () => db.query<{ id: string }>(`
        SELECT id FROM public.community_comments
        WHERE id = '${COMMENT_B}' AND parent_id IS NULL
          AND is_deleted IS TRUE AND author_deleted_at IS NOT NULL
      `);
      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      expect((await readDeletedParent()).rows).toEqual([{ id: COMMENT_B }]);
      await db.exec("RESET ROLE");
      await setBlock(db, USER_A, USER_B, true);
      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      expect((await readDeletedParent()).rows).toEqual([]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps pair visibility service-only while authenticated RLS filters without a callable oracle", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await setBlock(db, USER_A, USER_B, true);

      const privileges = await db.query<{
        anon_can_execute: boolean;
        authenticated_can_execute: boolean;
        service_can_execute: boolean;
        legacy_probe: string | null;
      }>(`
        SELECT
          has_function_privilege(
            'anon',
            'public.community_viewer_can_see(uuid,uuid)',
            'EXECUTE'
          ) AS anon_can_execute,
          has_function_privilege(
            'authenticated',
            'public.community_viewer_can_see(uuid,uuid)',
            'EXECUTE'
          ) AS authenticated_can_execute,
          has_function_privilege(
            'service_role',
            'public.community_viewer_can_see(uuid,uuid)',
            'EXECUTE'
          ) AS service_can_execute,
          to_regprocedure(
            'public.community_viewer_can_see(uuid)'
          )::text AS legacy_probe
      `);
      expect(privileges.rows).toEqual([{
        anon_can_execute: false,
        authenticated_can_execute: false,
        service_can_execute: true,
        legacy_probe: null,
      }]);

      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      const visiblePosts = await db.query<{ id: string }>(`
        SELECT id FROM public.community_posts ORDER BY id
      `);
      expect(visiblePosts.rows.map((row) => row.id)).toEqual([POST_A, POST_C]);
      await expect(db.query(`
        SELECT public.community_viewer_can_see('${USER_A}', '${USER_B}')
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.query(`
        SELECT public.community_viewer_can_see('${USER_A}', '${USER_C}')
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      const serviceDecision = await db.query<{
        blocked_pair_visible: boolean;
        unrelated_pair_visible: boolean;
      }>(`
        SELECT
          public.community_viewer_can_see(
            '${USER_A}', '${USER_B}'
          ) AS blocked_pair_visible,
          public.community_viewer_can_see(
            '${USER_A}', '${USER_C}'
          ) AS unrelated_pair_visible
      `);
      expect(serviceDecision.rows).toEqual([{
        blocked_pair_visible: false,
        unrelated_pair_visible: true,
      }]);
      await db.exec("RESET ROLE");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("filters every authenticated read model without changing logged-out publication", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);

      const first = await setBlock(db, USER_A, USER_B, true);
      expect(first).toMatchObject({
        blocked: true,
        changed: true,
        blocked_user_id: USER_B,
      });

      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      const posts = await db.query<{ id: string }>(`
        SELECT id FROM public.community_posts ORDER BY id
      `);
      const comments = await db.query<{ id: string }>(`
        SELECT id FROM public.community_comments ORDER BY id
      `);
      const messages = await db.query<{ id: string }>(`
        SELECT id FROM public.cohort_messages ORDER BY id
      `);
      const notifications = await db.query<{ id: string }>(`
        SELECT id FROM public.community_reply_notifications ORDER BY id
      `);
      const profiles = await db.query<{ user_id: string }>(`
        SELECT user_id FROM public.community_public_profiles ORDER BY user_id
      `);
      const ownControls = await db.query<{ blocked_user_id: string }>(`
        SELECT blocked_user_id FROM public.community_viewer_controls
      `);
      expect(posts.rows.map((row) => row.id)).toEqual([POST_A, POST_C]);
      expect(comments.rows).toEqual([]);
      expect(messages.rows).toEqual([]);
      expect(notifications.rows).toEqual([]);
      expect(profiles.rows.map((row) => row.user_id)).toEqual([USER_A, USER_C]);
      expect(ownControls.rows).toEqual([{ blocked_user_id: USER_B }]);
      await expect(db.query(`
        SELECT community_private.users_are_blocked(
          '${USER_A}', '${USER_B}'
        )
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");

      await setRequestIdentity(db, "authenticated", USER_B);
      await db.exec("SET ROLE authenticated");
      const targetControls = await db.query<{ blocked_user_id: string }>(`
        SELECT blocked_user_id FROM public.community_viewer_controls
      `);
      expect(targetControls.rows).toEqual([]);
      await db.exec("RESET ROLE");

      await setRequestIdentity(db, "anon");
      await db.exec("SET ROLE anon");
      const anonymousPosts = await db.query<{ id: string }>(`
        SELECT id FROM public.community_posts ORDER BY id
      `);
      const anonymousProfiles = await db.query<{ user_id: string }>(`
        SELECT user_id FROM public.community_public_profiles ORDER BY user_id
      `);
      expect(anonymousPosts.rows.map((row) => row.id)).toEqual([
        POST_A,
        POST_B,
        POST_C,
      ]);
      expect(anonymousProfiles.rows.map((row) => row.user_id)).toEqual([
        USER_A,
        USER_B,
        USER_C,
      ]);
      await db.exec("RESET ROLE");

      const replay = await setBlock(db, USER_A, USER_B, true);
      expect(replay.changed).toBe(false);
      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      const eventCount = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM public.community_viewer_control_events
      `);
      expect(eventCount.rows).toEqual([{ count: 1 }]);
      await db.exec("RESET ROLE");

      const unblocked = await setBlock(db, USER_A, USER_B, false);
      expect(unblocked).toMatchObject({ blocked: false, changed: true });
      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      const restoredPosts = await db.query<{ id: string }>(`
        SELECT id FROM public.community_posts ORDER BY id
      `);
      const nonResurrectedNotifications = await db.query<{ id: string }>(`
        SELECT id FROM public.community_reply_notifications ORDER BY id
      `);
      expect(restoredPosts.rows.map((row) => row.id)).toEqual([
        POST_A,
        POST_B,
        POST_C,
      ]);
      expect(nonResurrectedNotifications.rows).toEqual([]);
      await db.exec("RESET ROLE");

      await db.exec(`
        INSERT INTO public.community_reply_notifications(
          id, recipient_id, actor_id
        ) VALUES (
          '90000000-0000-4000-8000-000000000002', '${USER_A}', '${USER_B}'
        )
      `);
      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      const futureNotifications = await db.query<{ id: string }>(`
        SELECT id FROM public.community_reply_notifications ORDER BY id
      `);
      expect(futureNotifications.rows).toEqual([{
        id: "90000000-0000-4000-8000-000000000002",
      }]);
      await db.exec("RESET ROLE");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("binds block mutations to an explicit service actor and tombstones retained UUID events", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);

      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      await expect(db.query(`
        SELECT public.community_set_user_block(
          '${USER_A}', '${USER_B}', true, 'safety'
        )
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");

      const blocked = await setBlock(db, USER_A, USER_B, true);
      expect(blocked).toMatchObject({ blocked: true, changed: true });

      const functionBoundary = await db.query<{
        legacy_block: string | null;
        exact_probe: string | null;
      }>(`
        SELECT
          to_regprocedure(
            'public.community_set_user_block(uuid,boolean,text)'
          )::text AS legacy_block,
          to_regprocedure(
            'public.community_service_users_are_blocked(uuid,uuid)'
          )::text AS exact_probe
      `);
      expect(functionBoundary.rows).toEqual([{
        legacy_block: null,
        exact_probe: null,
      }]);

      const beforeErase = await db.query<{
        id: string;
        id_type: string;
      }>(`
        SELECT id::text AS id, pg_typeof(id)::text AS id_type
        FROM public.community_viewer_control_events
      `);
      expect(beforeErase.rows).toHaveLength(1);
      expect(beforeErase.rows[0]?.id_type).toBe("uuid");

      await db.exec(`DELETE FROM auth.users WHERE id = '${USER_B}'`);
      const targetErased = await db.query<{
        id: string;
        blocker_user_id: string | null;
        blocked_user_id: string | null;
        blocker_erased: boolean;
        blocked_erased: boolean;
      }>(`
        SELECT
          id::text AS id,
          blocker_user_id,
          blocked_user_id,
          blocker_erased_at IS NOT NULL AS blocker_erased,
          blocked_erased_at IS NOT NULL AS blocked_erased
        FROM public.community_viewer_control_events
      `);
      expect(targetErased.rows).toEqual([{
        id: beforeErase.rows[0]!.id,
        blocker_user_id: USER_A,
        blocked_user_id: null,
        blocker_erased: false,
        blocked_erased: true,
      }]);

      await db.exec(`DELETE FROM auth.users WHERE id = '${USER_A}'`);
      const bothErased = await db.query<{
        id: string;
        blocker_user_id: string | null;
        blocked_user_id: string | null;
        blocker_erased: boolean;
        blocked_erased: boolean;
      }>(`
        SELECT
          id::text AS id,
          blocker_user_id,
          blocked_user_id,
          blocker_erased_at IS NOT NULL AS blocker_erased,
          blocked_erased_at IS NOT NULL AS blocked_erased
        FROM public.community_viewer_control_events
      `);
      expect(bothErased.rows).toEqual([{
        id: beforeErase.rows[0]!.id,
        blocker_user_id: null,
        blocked_user_id: null,
        blocker_erased: true,
        blocked_erased: true,
      }]);

      await expect(db.exec(`
        UPDATE public.community_viewer_control_events
        SET metadata = '{"tampered":true}'::jsonb
      `)).rejects.toThrow(/append-only/iu);
      await expect(db.exec(`
        DELETE FROM public.community_viewer_control_events
      `)).rejects.toThrow(/append-only/iu);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("blocks new replies, notifications, cohort replies, and engagement symmetrically", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await setBlock(db, USER_A, USER_B, true);

      await expect(db.exec(`
        INSERT INTO public.community_comments(id, post_id, author_id)
        VALUES (
          '30000000-0000-4000-8000-000000000010',
          '${POST_B}',
          '${USER_A}'
        )
      `)).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);
      await expect(db.exec(`
        INSERT INTO public.community_reply_notifications(
          id, recipient_id, actor_id
        ) VALUES (
          '90000000-0000-4000-8000-000000000010',
          '${USER_A}',
          '${USER_B}'
        )
      `)).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);
      await expect(db.exec(`
        INSERT INTO public.cohort_messages(
          id, author_id, reply_to
        ) VALUES (
          '40000000-0000-4000-8000-000000000010',
          '${USER_A}',
          '${COHORT_MESSAGE_B}'
        )
      `)).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);
      await expect(db.exec(`
        INSERT INTO public.community_bookmarks(user_id, post_id)
        VALUES ('${USER_A}', '${POST_B}')
      `)).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);
      await expect(db.exec(`
        INSERT INTO public.community_votes(user_id, post_id)
        VALUES ('${USER_A}', '${POST_B}')
      `)).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);
      await expect(db.exec(`
        INSERT INTO public.community_poll_votes(user_id, poll_id)
        VALUES ('${USER_A}', '${POLL_B}')
      `)).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);

      const sourceState = await db.query<{
        visibility: string;
        under_review: boolean;
      }>(`
        SELECT visibility, under_review
        FROM public.community_posts
        WHERE id = '${POST_B}'
      `);
      expect(sourceState.rows).toEqual([{
        visibility: "public",
        under_review: false,
      }]);

      await setBlock(db, USER_A, USER_B, false);
      await expect(db.exec(`
        INSERT INTO public.community_comments(id, post_id, author_id)
        VALUES (
          '30000000-0000-4000-8000-000000000011',
          '${POST_B}',
          '${USER_A}'
        )
      `)).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("preserves the runtime-disabled public profile gate after replacing the view", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);
      await db.exec(`
        UPDATE public.community_runtime_controls
        SET mode = 'disabled'
        WHERE control_id
      `);

      await setRequestIdentity(db, "anon");
      await db.exec("SET ROLE anon");
      const anonymousProfiles = await db.query<{ user_id: string }>(`
        SELECT user_id FROM public.community_public_profiles ORDER BY user_id
      `);
      expect(anonymousProfiles.rows).toEqual([]);
      await db.exec("RESET ROLE");

      await setRequestIdentity(db, "authenticated", USER_A);
      await db.exec("SET ROLE authenticated");
      const authenticatedProfiles = await db.query<{ user_id: string }>(`
        SELECT user_id FROM public.community_public_profiles ORDER BY user_id
      `);
      expect(authenticatedProfiles.rows).toEqual([]);
      await db.exec("RESET ROLE");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("requires requester binding and expires open responder work without resurrecting it", async () => {
    const db = await PGlite.create();
    try {
      await createBaseline(db);
      await db.exec(migration);

      await setRequestIdentity(db, "service_role");
      await db.exec("SET ROLE service_role");
      await expect(db.query(`
        SELECT public.community_bind_responder_question_requester(
          '${QUESTION_ID}',
          '${USER_A}',
          'contract_extra_cost',
          'extra_charge',
          '${ADMIN_ID}',
          'a0000000-0000-4000-8000-000000000001'
        ) AS result
      `)).rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE");

      await db.exec(`
        INSERT INTO public.community_responder_questions(
          id,
          topic,
          experience_scope,
          created_by_operator,
          requester_id,
          requester_bound_at,
          requester_binding_idempotency_key
        ) VALUES (
          '${QUESTION_ID}',
          'contract_extra_cost',
          'extra_charge',
          '${ADMIN_ID}',
          '${USER_A}',
          now(),
          'a0000000-0000-4000-8000-000000000001'
        );
        INSERT INTO public.responder_capacity_slots(id, responder_id)
        VALUES ('${SLOT_ID}', '${USER_B}');
        INSERT INTO public.community_responder_requests(
          id, question_id, capacity_slot_id, responder_id, status
        ) VALUES (
          '${REQUEST_ID}', '${QUESTION_ID}', '${SLOT_ID}', '${USER_B}',
          'accepted'
        );
        UPDATE public.responder_capacity_slots
        SET consumed_request_id = '${REQUEST_ID}'
        WHERE id = '${SLOT_ID}';
      `);

      await setBlock(db, USER_A, USER_B, true);
      const expired = await db.query<{
        status: string;
        expiry_reason_code: string;
        consumed_request_id: string | null;
        supply_event_count: number;
      }>(`
        SELECT
          request.status,
          request.expiry_reason_code,
          slot.consumed_request_id,
          (
            SELECT count(*)::int
            FROM public.community_responder_supply_events AS event
            WHERE event.request_id = request.id
              AND event.event_type = 'request_expired'
              AND event.actor_type = 'requester'
              AND event.actor_id = '${USER_A}'::uuid
              AND event.operation_idempotency_key
                = request.expiry_idempotency_key
              AND event.previous_status = 'accepted'
              AND event.new_status = 'expired'
              AND event.reason_code = 'requester_unavailable'
          ) AS supply_event_count
        FROM public.community_responder_requests AS request
        JOIN public.responder_capacity_slots AS slot
          ON slot.id = request.capacity_slot_id
        WHERE request.id = '${REQUEST_ID}'
      `);
      expect(expired.rows).toEqual([{
        status: "expired",
        expiry_reason_code: "requester_unavailable",
        consumed_request_id: REQUEST_ID,
        supply_event_count: 1,
      }]);

      await expect(db.exec(`
        INSERT INTO public.community_responder_requests(
          id, question_id, capacity_slot_id, responder_id
        ) VALUES (
          '80000000-0000-4000-8000-000000000002',
          '${QUESTION_ID}',
          '${SLOT_ID}',
          '${USER_B}'
        )
      `)).rejects.toThrow(/COMMUNITY_INTERACTION_BLOCKED/iu);

      await setBlock(db, USER_A, USER_B, false);
      const stillExpired = await db.query<{ status: string }>(`
        SELECT status FROM public.community_responder_requests
        WHERE id = '${REQUEST_ID}'
      `);
      expect(stillExpired.rows).toEqual([{ status: "expired" }]);

      await db.exec(`
        INSERT INTO public.community_responder_questions(
          id, topic, experience_scope, created_by_operator
        ) VALUES (
          '60000000-0000-4000-8000-000000000002',
          'contract_extra_cost',
          'contract_terms',
          '${ADMIN_ID}'
        )
      `);
      await expect(db.exec(`
        INSERT INTO public.community_responder_requests(
          id, question_id, capacity_slot_id, responder_id
        ) VALUES (
          '80000000-0000-4000-8000-000000000003',
          '60000000-0000-4000-8000-000000000002',
          '${SLOT_ID}',
          '${USER_B}'
        )
      `)).rejects.toThrow(/requester binding required/iu);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the block contract explicit and private", () => {
    expect(migration).toContain("CREATE TABLE public.community_viewer_controls");
    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS community_private");
    expect(migration).toMatch(/AS RESTRICTIVE[\s\S]*FOR SELECT TO authenticated/);
    expect(migration).toContain("COMMUNITY_INTERACTION_BLOCKED");
    expect(migration).toContain("requester binding required");
    expect(migration).toContain(
      "public.community_runtime_mode() <> 'disabled'",
    );
    expect(migration).toContain("REVOKE ALL ON SCHEMA community_private FROM PUBLIC");
    expect(migration).not.toContain(
      "CREATE OR REPLACE FUNCTION public.users_are_blocked",
    );
    expect(migration).not.toContain(
      "CREATE OR REPLACE FUNCTION public.community_service_users_are_blocked",
    );
  });
});
