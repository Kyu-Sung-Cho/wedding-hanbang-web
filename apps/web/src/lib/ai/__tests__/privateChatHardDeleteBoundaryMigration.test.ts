// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731173000_private_chat_hard_delete_boundary.sql",
  ),
  "utf8",
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "10000000-0000-4000-8000-000000000002";
const BRIDE_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const SHARED_MESSAGE_ID = "20000000-0000-4000-8000-000000000002";
const GROOM_MESSAGE_ID = "20000000-0000-4000-8000-000000000003";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid,
      role text,
      private_chat_cleared_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      sender_id uuid,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      visibility text NOT NULL,
      summary text
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      visibility text NOT NULL,
      source text,
      source_message_id uuid,
      memory_key text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.amora_couple_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      visibility text NOT NULL
    );
    CREATE TABLE public.amora_memory_settings (
      couple_id uuid NOT NULL,
      visibility text NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      enabled_by uuid,
      enabled_at timestamptz,
      memory_reset_at timestamptz,
      legacy_purged_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (couple_id, visibility)
    );
    CREATE TABLE public.amora_memory_consents (
      couple_id uuid NOT NULL,
      visibility text NOT NULL,
      user_id uuid NOT NULL,
      PRIMARY KEY (couple_id, visibility, user_id)
    );
    CREATE TABLE public.amora_memory_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      visibility text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL,
      request_key text NOT NULL,
      user_id uuid NOT NULL,
      visibility text NOT NULL,
      tool_round_journal jsonb NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_tool_executions (
      couple_id uuid NOT NULL,
      request_key text NOT NULL,
      operation_key text NOT NULL,
      result jsonb,
      PRIMARY KEY (couple_id, request_key, operation_key)
    );
    CREATE TABLE public.amora_saved_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      saved_by uuid NOT NULL,
      message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
      content text NOT NULL
    );

    INSERT INTO public.couples (id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', NULL);
    INSERT INTO public.profiles (id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${OTHER_COUPLE_ID}', 'bride');

    INSERT INTO public.chat_messages (
      id, couple_id, sender_id, sender_type, role, content, visibility
    ) VALUES
      ('${BRIDE_MESSAGE_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'bride secret', 'bride_private'),
      ('${SHARED_MESSAGE_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'shared sentinel', 'shared'),
      ('${GROOM_MESSAGE_ID}', '${COUPLE_ID}', '${GROOM_ID}', 'groom', 'user', 'groom sentinel', 'groom_private');

    INSERT INTO public.chat_summaries (couple_id, visibility, summary) VALUES
      ('${COUPLE_ID}', 'bride_private', 'bride derived'),
      ('${COUPLE_ID}', 'shared', 'shared sentinel'),
      ('${COUPLE_ID}', 'groom_private', 'groom sentinel');

    INSERT INTO public.decision_nodes (
      couple_id, visibility, source, source_message_id, memory_key, metadata
    ) VALUES
      ('${COUPLE_ID}', 'bride_private', 'chat', '${BRIDE_MESSAGE_ID}', 'style:bride', '{"extracted_by":"test"}'),
      ('${COUPLE_ID}', 'bride_private', 'manual', NULL, NULL, '{}'),
      ('${COUPLE_ID}', 'shared', 'chat', '${SHARED_MESSAGE_ID}', 'style:shared', '{"extracted_by":"test"}'),
      ('${COUPLE_ID}', 'groom_private', 'chat', '${GROOM_MESSAGE_ID}', 'style:groom', '{"extracted_by":"test"}');

    INSERT INTO public.amora_couple_profiles (couple_id, visibility) VALUES
      ('${COUPLE_ID}', 'bride_private'),
      ('${COUPLE_ID}', 'shared'),
      ('${COUPLE_ID}', 'groom_private');

    INSERT INTO public.amora_memory_settings (
      couple_id, visibility, enabled, enabled_by, enabled_at, memory_reset_at
    ) VALUES
      ('${COUPLE_ID}', 'bride_private', true, '${BRIDE_ID}', now(), now() - interval '1 day'),
      ('${COUPLE_ID}', 'shared', true, '${BRIDE_ID}', now(), now() - interval '1 day'),
      ('${COUPLE_ID}', 'groom_private', true, '${GROOM_ID}', now(), now() - interval '1 day');
    INSERT INTO public.amora_memory_consents (couple_id, visibility, user_id) VALUES
      ('${COUPLE_ID}', 'bride_private', '${BRIDE_ID}'),
      ('${COUPLE_ID}', 'shared', '${BRIDE_ID}'),
      ('${COUPLE_ID}', 'groom_private', '${GROOM_ID}');
    INSERT INTO public.amora_memory_jobs (couple_id, visibility, status) VALUES
      ('${COUPLE_ID}', 'bride_private', 'pending'),
      ('${COUPLE_ID}', 'bride_private', 'failed'),
      ('${COUPLE_ID}', 'shared', 'pending'),
      ('${COUPLE_ID}', 'groom_private', 'processing');

    INSERT INTO public.amora_chat_request_claims (
      couple_id, request_key, user_id, visibility, tool_round_journal
    ) VALUES
      ('${COUPLE_ID}', 'bride-private-request', '${BRIDE_ID}', 'bride_private', '[{"private":"checkpoint"}]'),
      ('${COUPLE_ID}', 'shared-request', '${BRIDE_ID}', 'shared', '[]'),
      ('${COUPLE_ID}', 'groom-private-request', '${GROOM_ID}', 'groom_private', '[]');
    INSERT INTO public.amora_tool_executions (
      couple_id, request_key, operation_key, result
    ) VALUES
      ('${COUPLE_ID}', 'bride-private-request', 'bride-operation', '{"private":"result"}'),
      ('${COUPLE_ID}', 'shared-request', 'shared-operation', '{"sentinel":true}'),
      ('${COUPLE_ID}', 'groom-private-request', 'groom-operation', '{"sentinel":true}');

    INSERT INTO public.amora_saved_notes (
      couple_id, saved_by, message_id, content
    ) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${BRIDE_MESSAGE_ID}', 'copied bride secret'),
      ('${COUPLE_ID}', '${BRIDE_ID}', '${SHARED_MESSAGE_ID}', 'shared note sentinel');

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);

  await db.exec(migration);
  return db;
}

async function setAuthenticated(db: PGlite, userId: string) {
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("private chat hard-delete boundary migration", () => {
  it("atomically erases only the caller-private raw and derived scope and retries safely", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      const deleted = await db.query<{
        result: {
          success: boolean;
          visibility: string;
          deleted_messages: number;
          deleted_memory_jobs: number;
          deleted_request_claims: number;
          deleted_tool_executions: number;
          deleted_saved_notes: number;
        };
      }>(
        "SELECT public.hard_delete_current_user_private_chat($1) AS result",
        [COUPLE_ID],
      );
      expect(deleted.rows[0]?.result).toMatchObject({
        success: true,
        visibility: "bride_private",
        deleted_messages: 1,
        deleted_memory_jobs: 2,
        deleted_request_claims: 1,
        deleted_tool_executions: 1,
        deleted_saved_notes: 1,
      });

      await resetPersona(db);
      const state = await db.query<{
        bride_messages: number;
        shared_messages: number;
        groom_messages: number;
        bride_summaries: number;
        bride_derived_decisions: number;
        bride_manual_decisions: number;
        bride_profiles: number;
        bride_jobs: number;
        bride_claims: number;
        bride_consents: number;
        shared_claims: number;
        groom_claims: number;
        shared_tools: number;
        groom_tools: number;
        notes: number;
        memory_enabled: boolean;
        roster_unchanged: boolean;
        profile_unchanged: boolean;
        cursor_set: boolean;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE visibility = 'bride_private') AS bride_messages,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE visibility = 'shared') AS shared_messages,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE visibility = 'groom_private') AS groom_messages,
          (SELECT count(*)::integer FROM public.chat_summaries
            WHERE visibility = 'bride_private') AS bride_summaries,
          (SELECT count(*)::integer FROM public.decision_nodes
            WHERE visibility = 'bride_private' AND source = 'chat') AS bride_derived_decisions,
          (SELECT count(*)::integer FROM public.decision_nodes
            WHERE visibility = 'bride_private' AND source = 'manual') AS bride_manual_decisions,
          (SELECT count(*)::integer FROM public.amora_couple_profiles
            WHERE visibility = 'bride_private') AS bride_profiles,
          (SELECT count(*)::integer FROM public.amora_memory_jobs
            WHERE visibility = 'bride_private') AS bride_jobs,
          (SELECT count(*)::integer FROM public.amora_chat_request_claims
            WHERE visibility = 'bride_private') AS bride_claims,
          (SELECT count(*)::integer FROM public.amora_memory_consents
            WHERE visibility = 'bride_private') AS bride_consents,
          (SELECT count(*)::integer FROM public.amora_chat_request_claims
            WHERE visibility = 'shared') AS shared_claims,
          (SELECT count(*)::integer FROM public.amora_chat_request_claims
            WHERE visibility = 'groom_private') AS groom_claims,
          (SELECT count(*)::integer FROM public.amora_tool_executions
            WHERE request_key = 'shared-request') AS shared_tools,
          (SELECT count(*)::integer FROM public.amora_tool_executions
            WHERE request_key = 'groom-private-request') AS groom_tools,
          (SELECT count(*)::integer FROM public.amora_saved_notes) AS notes,
          (SELECT enabled FROM public.amora_memory_settings
            WHERE couple_id = '${COUPLE_ID}' AND visibility = 'bride_private') AS memory_enabled,
          EXISTS (
            SELECT 1 FROM public.couples
            WHERE id = '${COUPLE_ID}'
              AND bride_id = '${BRIDE_ID}' AND groom_id = '${GROOM_ID}'
          ) AS roster_unchanged,
          EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = '${BRIDE_ID}'
              AND couple_id = '${COUPLE_ID}' AND role = 'bride'
          ) AS profile_unchanged,
          EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = '${BRIDE_ID}' AND private_chat_cleared_at IS NOT NULL
          ) AS cursor_set
      `);
      expect(state.rows[0]).toEqual({
        bride_messages: 0,
        shared_messages: 1,
        groom_messages: 1,
        bride_summaries: 0,
        bride_derived_decisions: 0,
        bride_manual_decisions: 1,
        bride_profiles: 0,
        bride_jobs: 0,
        bride_claims: 0,
        bride_consents: 0,
        shared_claims: 1,
        groom_claims: 1,
        shared_tools: 1,
        groom_tools: 1,
        notes: 1,
        memory_enabled: false,
        roster_unchanged: true,
        profile_unchanged: true,
        cursor_set: true,
      });

      await setAuthenticated(db, BRIDE_ID);
      const retry = await db.query<{
        result: { success: boolean; deleted_messages: number };
      }>(
        "SELECT public.hard_delete_current_user_private_chat($1) AS result",
        [COUPLE_ID],
      );
      expect(retry.rows[0]?.result).toMatchObject({
        success: true,
        deleted_messages: 0,
      });

      await resetPersona(db);
      const sentinels = await db.query<{ shared: number; groom: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE visibility = 'shared') AS shared,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE visibility = 'groom_private') AS groom
      `);
      expect(sentinels.rows[0]).toEqual({ shared: 1, groom: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("derives role from auth.uid, rejects foreign or inconsistent membership, and exposes no direct DML", async () => {
    const db = await createDatabase();
    try {
      const acl = await db.query<{
        authenticated_execute: boolean;
        anon_execute: boolean;
        service_execute: boolean;
        authenticated_table_select: boolean;
        authenticated_table_delete: boolean;
        rls_forced: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'authenticated',
            'public.hard_delete_current_user_private_chat(uuid)',
            'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'anon',
            'public.hard_delete_current_user_private_chat(uuid)',
            'EXECUTE'
          ) AS anon_execute,
          has_function_privilege(
            'service_role',
            'public.hard_delete_current_user_private_chat(uuid)',
            'EXECUTE'
          ) AS service_execute,
          has_table_privilege(
            'authenticated',
            'public.amora_private_chat_delete_boundaries',
            'SELECT'
          ) AS authenticated_table_select,
          has_table_privilege(
            'authenticated',
            'public.amora_private_chat_delete_boundaries',
            'DELETE'
          ) AS authenticated_table_delete,
          (
            SELECT relforcerowsecurity
            FROM pg_class
            WHERE oid = 'public.amora_private_chat_delete_boundaries'::regclass
          ) AS rls_forced
      `);
      expect(acl.rows[0]).toEqual({
        authenticated_execute: true,
        anon_execute: false,
        service_execute: false,
        authenticated_table_select: false,
        authenticated_table_delete: false,
        rls_forced: true,
      });

      await setAuthenticated(db, OUTSIDER_ID);
      await expect(
        db.query(
          "SELECT public.hard_delete_current_user_private_chat($1)",
          [COUPLE_ID],
        ),
      ).rejects.toThrow(/PRIVATE_CHAT_HARD_DELETE_SCOPE_DENIED/);

      await resetPersona(db);
      await db.query(
        "UPDATE public.profiles SET role = 'groom' WHERE id = $1",
        [BRIDE_ID],
      );
      await setAuthenticated(db, BRIDE_ID);
      await expect(
        db.query(
          "SELECT public.hard_delete_current_user_private_chat($1)",
          [COUPLE_ID],
        ),
      ).rejects.toThrow(/PRIVATE_CHAT_HARD_DELETE_SCOPE_DENIED/);

      await resetPersona(db);
      const targetStillPresent = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.chat_messages
         WHERE id = $1`,
        [BRIDE_MESSAGE_ID],
      );
      expect(targetStillPresent.rows[0]?.count).toBe(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls every deletion and epoch write back when the final cursor postcondition fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.fail_private_cursor_update()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.private_chat_cleared_at IS DISTINCT FROM OLD.private_chat_cleared_at THEN
            RAISE EXCEPTION 'PRIVATE_CURSOR_WRITE_BLOCKED';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER fail_private_cursor_update
        BEFORE UPDATE OF private_chat_cleared_at ON public.profiles
        FOR EACH ROW EXECUTE FUNCTION public.fail_private_cursor_update();
      `);

      await setAuthenticated(db, BRIDE_ID);
      await expect(
        db.query(
          "SELECT public.hard_delete_current_user_private_chat($1)",
          [COUPLE_ID],
        ),
      ).rejects.toThrow(/PRIVATE_CURSOR_WRITE_BLOCKED/);

      await resetPersona(db);
      const rolledBack = await db.query<{
        messages: number;
        summaries: number;
        decisions: number;
        profiles: number;
        jobs: number;
        claims: number;
        consents: number;
        notes: number;
        boundaries: number;
        memory_enabled: boolean;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE visibility = 'bride_private') AS messages,
          (SELECT count(*)::integer FROM public.chat_summaries
            WHERE visibility = 'bride_private') AS summaries,
          (SELECT count(*)::integer FROM public.decision_nodes
            WHERE visibility = 'bride_private' AND source = 'chat') AS decisions,
          (SELECT count(*)::integer FROM public.amora_couple_profiles
            WHERE visibility = 'bride_private') AS profiles,
          (SELECT count(*)::integer FROM public.amora_memory_jobs
            WHERE visibility = 'bride_private') AS jobs,
          (SELECT count(*)::integer FROM public.amora_chat_request_claims
            WHERE visibility = 'bride_private') AS claims,
          (SELECT count(*)::integer FROM public.amora_memory_consents
            WHERE visibility = 'bride_private') AS consents,
          (SELECT count(*)::integer FROM public.amora_saved_notes
            WHERE message_id = '${BRIDE_MESSAGE_ID}') AS notes,
          (SELECT count(*)::integer
            FROM public.amora_private_chat_delete_boundaries) AS boundaries,
          (SELECT enabled FROM public.amora_memory_settings
            WHERE couple_id = '${COUPLE_ID}'
              AND visibility = 'bride_private') AS memory_enabled
      `);
      expect(rolledBack.rows[0]).toEqual({
        messages: 1,
        summaries: 1,
        decisions: 1,
        profiles: 1,
        jobs: 2,
        claims: 1,
        consents: 1,
        notes: 1,
        boundaries: 0,
        memory_enabled: true,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fences stale raw writes and blocks private derived context until memory is explicitly re-enabled", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      await db.query(
        "SELECT public.hard_delete_current_user_private_chat($1)",
        [COUPLE_ID],
      );
      await resetPersona(db);

      await expect(db.exec(`
        INSERT INTO public.chat_summaries (couple_id, visibility, summary)
        VALUES ('${COUPLE_ID}', 'bride_private', 'stale summary')
      `)).rejects.toThrow(/PRIVATE_CHAT_DELETE_BOUNDARY_DERIVED_WRITE_BLOCKED/);
      await expect(db.exec(`
        INSERT INTO public.decision_nodes (
          couple_id, visibility, source, metadata
        ) VALUES (
          '${COUPLE_ID}', 'bride_private', 'chat', '{"extracted_by":"stale"}'
        )
      `)).rejects.toThrow(/PRIVATE_CHAT_DELETE_BOUNDARY_DERIVED_WRITE_BLOCKED/);
      await expect(db.exec(`
        INSERT INTO public.amora_couple_profiles (couple_id, visibility)
        VALUES ('${COUPLE_ID}', 'bride_private')
      `)).rejects.toThrow(/PRIVATE_CHAT_DELETE_BOUNDARY_DERIVED_WRITE_BLOCKED/);

      // Simulate a writer transaction whose start is older than the committed
      // boundary. The same trigger is what serializes a real in-flight writer.
      await db.exec(`
        UPDATE public.amora_private_chat_delete_boundaries
        SET deleted_at = clock_timestamp() + interval '1 minute'
        WHERE couple_id = '${COUPLE_ID}' AND visibility = 'bride_private'
      `);
      await expect(db.exec(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, visibility
        ) VALUES (
          '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user',
          'stale raw write', 'bride_private'
        )
      `)).rejects.toThrow(/PRIVATE_CHAT_DELETE_BOUNDARY_STALE_WRITE/);

      await db.exec(`
        UPDATE public.amora_private_chat_delete_boundaries
        SET deleted_at = clock_timestamp() - interval '1 minute'
        WHERE couple_id = '${COUPLE_ID}' AND visibility = 'bride_private';
        UPDATE public.amora_memory_settings
        SET enabled = true,
            enabled_by = '${BRIDE_ID}',
            enabled_at = clock_timestamp(),
            memory_reset_at = clock_timestamp()
        WHERE couple_id = '${COUPLE_ID}' AND visibility = 'bride_private';
      `);
      await db.exec(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, visibility
        ) VALUES (
          '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user',
          'new conversation', 'bride_private'
        );
        INSERT INTO public.chat_summaries (couple_id, visibility, summary)
        VALUES ('${COUPLE_ID}', 'bride_private', 'new opted-in summary');
      `);

      const newRows = await db.query<{ messages: number; summaries: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE visibility = 'bride_private') AS messages,
          (SELECT count(*)::integer FROM public.chat_summaries
            WHERE visibility = 'bride_private') AS summaries
      `);
      expect(newRows.rows[0]).toEqual({ messages: 1, summaries: 1 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
