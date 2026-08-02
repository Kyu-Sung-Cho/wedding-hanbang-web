// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const storageSagaMigration = readFileSync(
  resolve(repoRoot, "supabase/migrations/20260716113000_account_deletion_storage_saga.sql"),
  "utf8",
);
const privatePurgeMigration = readFileSync(
  resolve(repoRoot, "supabase/migrations/20260802131000_account_deletion_private_data_purge.sql"),
  "utf8",
);

const BRIDE_ID = "11111111-1111-4111-8111-111111111111";
const GROOM_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const ORPHAN_COUPLE_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_ID = "66666666-6666-4666-8666-666666666666";
const LEGAL_ID = "77777777-7777-4777-8777-777777777777";
const LEGACY_DELETED_ID = "88888888-7777-4777-8777-777777777777";
const PERSONA_ADMIN_ID = "99999999-7777-4777-8777-777777777777";
const DRAFT_ADMIN_ID = "aaaaaaaa-7777-4777-8777-777777777777";
const RECEIPT_ADMIN_ID = "bbbbbbbb-7777-4777-8777-777777777777";
const GUESTBOOK_OWNER_ID = "cccccccc-7777-4777-8777-777777777777";

async function database(options: { applyPrivatePurgeMigration?: boolean } = {}) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        current_user
      )
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;

    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL,
      owner uuid,
      owner_id text
    );
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      groom_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
      role text
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      owner_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.guestbooks (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
    );
    CREATE TABLE public.vendor_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
      viewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.account_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      email text,
      reason text DEFAULT 'unknown',
      deleted_at timestamptz DEFAULT clock_timestamp()
    );
    CREATE TABLE public.customer_survey_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      q23_contact text,
      user_agent text
    );
    CREATE TABLE public.b2b_survey_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_agent text
    );
    CREATE TABLE public.community_upload_sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      staging_path text NOT NULL,
      final_bucket text NOT NULL,
      final_path text NOT NULL,
      expires_at timestamptz NOT NULL
    );
  `);
  await db.exec(storageSagaMigration);
  await db.exec(`
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      visibility text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      reasoning text
    );
    CREATE TABLE public.decision_edges (
      id uuid PRIMARY KEY,
      from_node_id uuid REFERENCES public.decision_nodes(id) ON DELETE CASCADE,
      to_node_id uuid REFERENCES public.decision_nodes(id) ON DELETE CASCADE
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      summary text
    );
    CREATE TABLE public.amora_couple_profiles (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      persona_summary text,
      PRIMARY KEY (couple_id, visibility)
    );
    CREATE TABLE public.amora_memory_settings (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      PRIMARY KEY (couple_id, visibility)
    );
    CREATE TABLE public.amora_memory_consents (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      PRIMARY KEY (couple_id, visibility, user_id)
    );
    CREATE TABLE public.amora_memory_jobs (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      visibility text NOT NULL
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      request_key text NOT NULL,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_turn_requests (
      request_key text PRIMARY KEY,
      couple_id uuid NOT NULL
    );
    CREATE TABLE public.amora_tool_executions (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      request_key text NOT NULL,
      operation_key text NOT NULL,
      result jsonb,
      PRIMARY KEY (couple_id, request_key, operation_key)
    );
    CREATE TABLE public.amora_conflict_check_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      message_digest text NOT NULL,
      requester_user_id uuid NOT NULL,
      PRIMARY KEY (couple_id, message_digest)
    );
    GRANT INSERT ON public.amora_conflict_check_claims TO service_role;
    CREATE TABLE public.amora_care_jobs (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      roster_member_ids uuid[] NOT NULL,
      status text NOT NULL,
      content text NOT NULL,
      email_subject text,
      email_html text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      lease_token uuid,
      lease_expires_at timestamptz,
      chat_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
      last_error text,
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT INSERT ON public.amora_care_jobs TO service_role;
    CREATE TABLE public.amora_care_deliveries (
      id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES public.amora_care_jobs(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      status text NOT NULL,
      recipient_email text,
      recipient_name text,
      last_error text,
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      session_id text,
      message_id uuid,
      user_input text,
      ai_output text,
      tool_input jsonb,
      tool_output jsonb,
      error_message text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      amora_request_key text,
      amora_claim_token uuid,
      amora_global_counter_key text,
      amora_cost_couple_id uuid,
      tokens_input integer,
      tokens_output integer,
      cost_usd numeric
    );
    CREATE TABLE public.amora_quote_checks (
      id uuid PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      couple_id uuid,
      vendor_name text,
      memo text,
      analysis jsonb
    );
    CREATE TABLE public.customer_events (
      id uuid PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      couple_id uuid,
      session_id text,
      metadata jsonb
    );
    CREATE TABLE public.search_logs (
      id uuid PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      query text NOT NULL
    );
    GRANT INSERT ON public.search_logs TO authenticated;
    CREATE TABLE public.chat_feedback (
      id uuid PRIMARY KEY,
      user_id uuid,
      couple_id uuid,
      correction text,
      message_content text
    );
    GRANT INSERT ON public.chat_feedback TO service_role;
    CREATE TABLE public.preregistrations (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      name text
    );
    CREATE TABLE public.events (
      id uuid PRIMARY KEY,
      anon_id text NOT NULL,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      session_id text,
      context jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE FUNCTION public.reject_event_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'EVENTS_ARE_APPEND_ONLY' USING ERRCODE = '42501';
    END $$;
    CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON public.events
      FOR EACH ROW EXECUTE FUNCTION public.reject_event_mutation();

    CREATE TABLE public.vendor_alias_proposals (
      id uuid PRIMARY KEY,
      reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT
    );
    CREATE TABLE public.vendor_disclosure_bulk_approval_audits (
      id uuid PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT
    );
    CREATE TABLE public.official_review_events (
      id uuid PRIMARY KEY,
      actor_id uuid NOT NULL
    );
    CREATE TABLE public.price_upload_confirmations (
      id uuid PRIMARY KEY,
      created_by uuid NOT NULL,
      resolved_by uuid
    );
    CREATE TABLE public.price_upload_confirmation_events (
      id uuid PRIMARY KEY,
      actor_id uuid NOT NULL
    );
    CREATE TABLE public.vendor_enrichment_private (
      id uuid PRIMARY KEY,
      enriched_by uuid
    );
    CREATE TABLE public.vendor_dedupe_candidates (
      id uuid PRIMARY KEY,
      decided_by uuid
    );
    CREATE TABLE public.agency_dedupe_candidates (
      id uuid PRIMARY KEY,
      decided_by uuid
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      reviewed_by uuid
    );
    CREATE TABLE public.official_agency_packages (
      id uuid PRIMARY KEY,
      reviewed_by uuid
    );
    CREATE TABLE public.service_actor_rows (
      id uuid PRIMARY KEY,
      user_id uuid,
      resolved_by uuid,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    GRANT INSERT ON public.service_actor_rows TO service_role;
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
      receipt_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
    );
    CREATE TABLE public.contracts (
      id uuid PRIMARY KEY,
      booking_id uuid NOT NULL REFERENCES public.vendor_bookings(id),
      customer_id uuid NOT NULL
    );
    CREATE TABLE public.payments (
      id uuid PRIMARY KEY,
      contract_id uuid NOT NULL REFERENCES public.contracts(id),
      customer_id uuid NOT NULL
    );
    CREATE TABLE public.vendor_reviews (
      id uuid PRIMARY KEY,
      customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      content text,
      images text[]
    );
    CREATE TABLE public.community_agent_personas (
      id uuid PRIMARY KEY,
      created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      backing_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
    );
    CREATE TABLE public.community_agent_content_drafts (
      id uuid PRIMARY KEY,
      created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      posted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
    );

    INSERT INTO auth.users(id, email) VALUES
      ('${BRIDE_ID}', 'Bride@Example.com'),
      ('${GROOM_ID}', 'groom@example.com'),
      ('${ADMIN_ID}', 'admin@example.com'),
      ('${LEGAL_ID}', 'legal@example.com');
    INSERT INTO public.couples(id, bride_id, groom_id)
    VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${ORPHAN_COUPLE_ID}', NULL, '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${ADMIN_ID}', NULL, NULL),
      ('${LEGAL_ID}', NULL, NULL);

    INSERT INTO public.customer_survey_responses(q23_contact, user_agent)
    VALUES ('010-1234-5678', 'legacy-agent');
    INSERT INTO public.b2b_survey_responses(user_agent)
    VALUES ('legacy-b2b-agent');
    INSERT INTO public.amora_care_jobs(
      id, couple_id, roster_member_ids, status, content, email_subject,
      email_html, metadata
    ) VALUES (
      '55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${ORPHAN_COUPLE_ID}',
      ARRAY['${BRIDE_ID}'::uuid, '${GROOM_ID}'::uuid], 'pending',
      'historical orphan private context', 'orphan subject',
      '<p>orphan body</p>', '{"recipient":"departed"}'
    );
    INSERT INTO public.amora_care_deliveries(
      id, job_id, user_id, status, recipient_email, recipient_name
    ) VALUES (
      '55555555-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', 'pending',
      'departed@example.com', 'Departed'
    );
  `);
  if (options.applyPrivatePurgeMigration !== false) {
    await db.exec(privatePurgeMigration);
  }
  return db;
}

describe("account deletion private-data purge migration", () => {
  it("globally removes persisted sender display names and blocks reintroduction", async () => {
    const db = await database({ applyPrivatePurgeMigration: false });
    try {
      await db.exec(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, visibility, content, metadata
        ) VALUES (
          'aaaaaaaa-9999-4999-8999-999999999999', '${COUPLE_ID}', NULL,
          'shared', 'historical assistant reply',
          '{"senderName":"Bride","safe":"kept"}'::jsonb
        )
      `);

      await db.exec(privatePurgeMigration);

      expect((await db.query(`
        SELECT metadata FROM public.chat_messages
        WHERE id = 'aaaaaaaa-9999-4999-8999-999999999999'
      `)).rows).toEqual([{ metadata: { safe: "kept" } }]);
      await expect(db.exec(`
        UPDATE public.chat_messages
        SET metadata = '{"senderName":"reintroduced"}'::jsonb
        WHERE id = 'aaaaaaaa-9999-4999-8999-999999999999'
      `)).rejects.toThrow(/chat_messages_metadata_no_sender_name/i);
    } finally {
      await db.close();
    }
  });

  it("fails closed when a legacy deletion ledger still points to an active Auth account", async () => {
    const db = await database({ applyPrivatePurgeMigration: false });
    try {
      await db.exec(`
        INSERT INTO public.account_deletions(user_id, email, reason)
        VALUES ('${BRIDE_ID}', 'legacy-active@example.com', 'privacy')
      `);

      await expect(db.exec(privatePurgeMigration))
        .rejects.toThrow(/ACCOUNT_DELETION_LEGACY_ACTIVE_AUTH_USER/);
      await db.exec("ROLLBACK");

      expect((await db.query(`
        SELECT user_id, email FROM public.account_deletions
      `)).rows).toEqual([{
        user_id: BRIDE_ID,
        email: "legacy-active@example.com",
      }]);
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  });

  it("retains an unresolved deleted identity as a recovery key instead of guessing at its purge", async () => {
    const db = await database({ applyPrivatePurgeMigration: false });
    try {
      await db.exec(`
        INSERT INTO public.account_deletions(user_id, email, reason)
        VALUES ('${LEGACY_DELETED_ID}', 'legacy-deleted@example.com', 'privacy')
      `);

      await expect(db.exec(privatePurgeMigration))
        .rejects.toThrow(/ACCOUNT_DELETION_LEGACY_IDENTITY_UNRECONCILED/);
      await db.exec("ROLLBACK");

      expect((await db.query(`
        SELECT user_id, email FROM public.account_deletions
      `)).rows).toEqual([{
        user_id: LEGACY_DELETED_ID,
        email: "legacy-deleted@example.com",
      }]);
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  });

  it("purges the actor scope before Auth deletion, redacts ledgers, and repeats on retry", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO public.chat_messages(id, couple_id, sender_id, visibility, content, metadata) VALUES
          ('aaaaaaaa-0000-4000-8000-000000000001', '${COUPLE_ID}', '${BRIDE_ID}', 'bride_private', 'private prompt', '{}'),
          ('aaaaaaaa-0000-4000-8000-000000000002', '${COUPLE_ID}', NULL, 'bride_private', 'private ai reply', '{}'),
          ('aaaaaaaa-0000-4000-8000-000000000003', '${COUPLE_ID}', '${GROOM_ID}', 'groom_private', 'groom secret', '{}'),
          ('aaaaaaaa-0000-4000-8000-000000000004', '${COUPLE_ID}', '${BRIDE_ID}', 'shared', 'shared history',
            '{"imagePaths":["${COUPLE_ID}/${BRIDE_ID}/private.webp"],"imageUrls":["https://storage.test/private.webp"]}'),
          ('aaaaaaaa-0000-4000-8000-000000000005', '${COUPLE_ID}', '${BRIDE_ID}', 'shared', 'clear request',
            '{"clearRequest":{"type":"shared","requestedBy":"${BRIDE_ID}","requestedByRole":"bride","requestedAt":"2026-08-01T00:00:00Z","status":"pending"}}'),
          ('aaaaaaaa-0000-4000-8000-000000000006', '${COUPLE_ID}', NULL, 'shared', 'assistant reply',
            '{"client_request_id":"chat:${BRIDE_ID}:99999999-0000-4000-8000-000000000000","client_visible_request_id":"chat:${BRIDE_ID}:88888888-0000-4000-8000-000000000000"}');
        INSERT INTO public.decision_nodes(id, couple_id, visibility, reasoning) VALUES
          ('bbbbbbbb-0000-4000-8000-000000000001', '${COUPLE_ID}', 'bride_private', 'private decision'),
          ('bbbbbbbb-0000-4000-8000-000000000002', '${COUPLE_ID}', 'shared', 'shared decision');
        INSERT INTO public.chat_summaries(id, couple_id, user_id, visibility, summary) VALUES
          ('cccccccc-0000-4000-8000-000000000001', '${COUPLE_ID}', '${BRIDE_ID}', 'bride_private', 'private summary'),
          ('cccccccc-0000-4000-8000-000000000002', '${COUPLE_ID}', '${GROOM_ID}', 'groom_private', 'groom summary');
        INSERT INTO public.amora_couple_profiles(couple_id, visibility, persona_summary) VALUES
          ('${COUPLE_ID}', 'bride_private', 'private profile'),
          ('${COUPLE_ID}', 'groom_private', 'groom profile');
        INSERT INTO public.amora_memory_settings(couple_id, visibility) VALUES
          ('${COUPLE_ID}', 'bride_private'), ('${COUPLE_ID}', 'groom_private');
        INSERT INTO public.amora_memory_consents(couple_id, visibility, user_id) VALUES
          ('${COUPLE_ID}', 'bride_private', '${BRIDE_ID}'),
          ('${COUPLE_ID}', 'groom_private', '${GROOM_ID}');
        INSERT INTO public.amora_memory_jobs(id, couple_id, user_id, visibility) VALUES
          ('dddddddd-0000-4000-8000-000000000001', '${COUPLE_ID}', '${BRIDE_ID}', 'bride_private'),
          ('dddddddd-0000-4000-8000-000000000002', '${COUPLE_ID}', '${GROOM_ID}', 'groom_private');
        INSERT INTO public.amora_chat_request_claims(couple_id, request_key, user_id, visibility) VALUES
          ('${COUPLE_ID}', 'chat:${BRIDE_ID}:private', '${BRIDE_ID}', 'bride_private'),
          ('${COUPLE_ID}', 'chat:${BRIDE_ID}:shared', '${BRIDE_ID}', 'shared'),
          ('${COUPLE_ID}', 'chat:${GROOM_ID}:private', '${GROOM_ID}', 'groom_private');
        INSERT INTO public.amora_turn_requests(request_key, couple_id) VALUES
          ('chat:${BRIDE_ID}:turn', '${COUPLE_ID}'),
          ('chat:${GROOM_ID}:turn', '${COUPLE_ID}');
        INSERT INTO public.amora_tool_executions(
          couple_id, request_key, operation_key, result
        ) VALUES
          ('${COUPLE_ID}', 'chat:${BRIDE_ID}:tool', repeat('a', 64), '{"private":true}'),
          ('${COUPLE_ID}', 'chat:${GROOM_ID}:tool', repeat('b', 64), '{"safe":true}');
        INSERT INTO public.amora_conflict_check_claims(couple_id, message_digest, requester_user_id) VALUES
          ('${COUPLE_ID}', repeat('a', 64), '${BRIDE_ID}'),
          ('${COUPLE_ID}', repeat('b', 64), '${GROOM_ID}');
        INSERT INTO public.amora_care_jobs(
          id, couple_id, roster_member_ids, status, content, email_subject, email_html, metadata
        ) VALUES (
          'eeeeeeee-0000-4000-8000-000000000001', '${COUPLE_ID}',
          ARRAY['${BRIDE_ID}'::uuid, '${GROOM_ID}'::uuid], 'pending',
          'copied private context', 'subject', '<p>body</p>', '{"name":"bride"}'
        );
        INSERT INTO public.amora_care_deliveries(
          id, job_id, user_id, status, recipient_email, recipient_name
        ) VALUES
          ('eeeeeeee-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001', '${BRIDE_ID}', 'pending', 'bride@example.com', 'Bride'),
          ('eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000001', '${GROOM_ID}', 'pending', 'groom@example.com', 'Groom');
        INSERT INTO public.ai_interactions_log(
          id, user_id, couple_id, session_id, user_input, ai_output, tool_input,
          tool_output, error_message, metadata, amora_request_key,
          amora_claim_token, amora_global_counter_key, amora_cost_couple_id,
          tokens_input, tokens_output, cost_usd
        ) VALUES (
          'ffffffff-0000-4000-8000-000000000001', '${BRIDE_ID}', '${COUPLE_ID}',
          'private-session', 'raw prompt', 'raw response', '{"secret":1}',
          '{"secret":2}', 'raw error', '{"private":true}',
          'chat:${BRIDE_ID}:turn', '${CLAIM_ID}', 'global:${COUPLE_ID}', '${COUPLE_ID}',
          10, 20, 0.12
        );
        INSERT INTO public.ai_interactions_log(
          id, user_id, couple_id, metadata, tokens_input, tokens_output, cost_usd
        ) VALUES (
          'ffffffff-0000-4000-8000-000000000002', '${GROOM_ID}', '${COUPLE_ID}',
          '{"action":"hide","target_type":"post","target_id":"77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa","target_author_id":"${BRIDE_ID}","target_title":"private title","reason":"private reason"}',
          0, 0, 0
        );
        INSERT INTO public.amora_quote_checks(id, user_id, couple_id, vendor_name, memo, analysis)
        VALUES ('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', '${COUPLE_ID}', 'Vendor', 'private memo', '{"raw":true}');
        INSERT INTO public.customer_events(id, user_id, couple_id, session_id, metadata)
        VALUES ('22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', '${COUPLE_ID}', 'session-a', '{"raw":true}');
        INSERT INTO public.vendors(id, owner_id)
        VALUES ('22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${GROOM_ID}');
        INSERT INTO public.vendor_views(id, vendor_id, viewer_id, created_at)
        VALUES (
          '22222222-cccc-4ccc-8ccc-cccccccccccc',
          '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${BRIDE_ID}',
          '2026-08-01T12:34:56Z'
        );
        INSERT INTO public.search_logs(id, user_id, query)
        VALUES ('33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', 'private query');
        INSERT INTO public.chat_feedback(id, user_id, couple_id, correction, message_content)
        VALUES ('44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', '${COUPLE_ID}', 'private correction', 'copied message');
        INSERT INTO public.events(id, anon_id, user_id, session_id, context)
        VALUES
          ('55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'anon-a', '${BRIDE_ID}', 'session-a', '{"raw":true}'),
          ('55555555-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'anon-b', '${GROOM_ID}', 'session-b', '{}');
        INSERT INTO public.preregistrations(id, email, name)
        VALUES ('66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ' bride@example.com ', 'Bride');
        INSERT INTO public.account_deletion_jobs(
          user_id, reason, status, claim_token, claimed_at
        ) VALUES ('${BRIDE_ID}', 'privacy', 'deleting', '${CLAIM_ID}', clock_timestamp());
      `);

      await db.exec(`
        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);
      const job = await db.query<{ id: string }>(`
        SELECT id FROM public.account_deletion_jobs WHERE user_id = '${BRIDE_ID}'
      `);
      const jobId = job.rows[0].id;
      const prepared = await db.query<{ prepared: boolean }>(`
        SELECT public.prepare_account_deletion_auth_delete(
          '${jobId}', '${CLAIM_ID}'
        ) AS prepared
      `);
      expect(prepared.rows).toEqual([{ prepared: true }]);
      await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);");

      const messages = await db.query<{ visibility: string; content: string }>(`
        SELECT visibility, content FROM public.chat_messages
        WHERE id IN (
          'aaaaaaaa-0000-4000-8000-000000000003',
          'aaaaaaaa-0000-4000-8000-000000000004'
        )
        ORDER BY content
      `);
      expect(messages.rows).toEqual([
        { visibility: "groom_private", content: "groom secret" },
        { visibility: "shared", content: "shared history" },
      ]);
      expect((await db.query("SELECT * FROM public.amora_quote_checks")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM public.customer_events")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM public.vendor_views")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM public.search_logs")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM public.chat_feedback")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM public.preregistrations")).rows).toEqual([]);
      expect((await db.query<{ user_id: string }>("SELECT user_id FROM public.events")).rows)
        .toEqual([{ user_id: GROOM_ID }]);
      expect((await db.query(`
        SELECT sender_id, metadata FROM public.chat_messages
        WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004'
      `)).rows).toEqual([{ sender_id: null, metadata: {} }]);
      expect((await db.query(`
        SELECT sender_id, metadata FROM public.chat_messages
        WHERE id = 'aaaaaaaa-0000-4000-8000-000000000005'
      `)).rows).toEqual([{
        sender_id: null,
        metadata: {
          clearRequest: { type: "shared", status: "declined", privacyRedacted: true },
        },
      }]);
      expect((await db.query(`
        SELECT metadata FROM public.chat_messages
        WHERE id = 'aaaaaaaa-0000-4000-8000-000000000006'
      `)).rows).toEqual([{ metadata: {} }]);
      expect((await db.query<{ request_key: string }>(`
        SELECT request_key FROM public.amora_tool_executions
      `)).rows).toEqual([{ request_key: `chat:${GROOM_ID}:tool` }]);

      const aiLog = await db.query<Record<string, unknown>>(`
        SELECT user_id, couple_id, session_id, user_input, ai_output, tool_input,
          tool_output, error_message, metadata, amora_request_key,
          amora_claim_token, amora_global_counter_key, amora_cost_couple_id,
          tokens_input, tokens_output, cost_usd
        FROM public.ai_interactions_log
        WHERE id = 'ffffffff-0000-4000-8000-000000000001'
      `);
      expect(aiLog.rows).toEqual([expect.objectContaining({
        user_id: null,
        couple_id: null,
        session_id: null,
        user_input: null,
        ai_output: null,
        tool_input: null,
        tool_output: null,
        error_message: null,
        metadata: { privacy_redacted: true },
        amora_request_key: null,
        amora_claim_token: null,
        amora_global_counter_key: null,
        amora_cost_couple_id: null,
        tokens_input: 10,
        tokens_output: 20,
      })]);
      expect((await db.query(`
        SELECT user_id, metadata FROM public.ai_interactions_log
        WHERE id = 'ffffffff-0000-4000-8000-000000000002'
      `)).rows).toEqual([{
        user_id: GROOM_ID,
        metadata: {
          action: "hide",
          target_type: "post",
          target_privacy_redacted: true,
        },
      }]);

      const care = await db.query(`
        SELECT status, roster_member_ids, content, email_subject, email_html,
          metadata, chat_message_id
        FROM public.amora_care_jobs
        WHERE couple_id = '${COUPLE_ID}'
      `);
      expect(care.rows).toEqual([{
        status: "cancelled",
        roster_member_ids: [GROOM_ID],
        content: "[redacted]",
        email_subject: null,
        email_html: null,
        metadata: {},
        chat_message_id: null,
      }]);

      // Even if an internal service path bypasses the user DML fence between
      // Auth attempts, the next prepare call repeats every raw-data purge.
      await db.exec(`
        SELECT set_config('hanbang.account_deletion_cleanup', 'on', true);
        INSERT INTO public.search_logs(id, user_id, query)
        VALUES ('77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', 'retry leak');
        INSERT INTO public.amora_quote_checks(id, user_id, couple_id, memo)
        VALUES ('88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', '${COUPLE_ID}', 'retry leak');
        SELECT set_config('hanbang.account_deletion_cleanup', 'off', true);
      `);
      await db.exec(`
        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);
      const retried = await db.query<{ prepared: boolean }>(`
        SELECT public.prepare_account_deletion_auth_delete(
          '${jobId}', '${CLAIM_ID}'
        ) AS prepared
      `);
      expect(retried.rows).toEqual([{ prepared: true }]);
      await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);");
      expect((await db.query("SELECT * FROM public.search_logs")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM public.amora_quote_checks")).rows).toEqual([]);

      await db.exec(`
        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);
      await expect(db.exec(`
        INSERT INTO public.chat_feedback(id, user_id, couple_id, correction)
        VALUES ('99999999-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${BRIDE_ID}', '${COUPLE_ID}', 'late service write')
      `)).rejects.toThrow(/ACCOUNT_DELETION_MUTATION_BLOCKED/);
      await expect(db.exec(`
        INSERT INTO public.amora_conflict_check_claims(
          couple_id, message_digest, requester_user_id
        ) VALUES ('${COUPLE_ID}', repeat('d', 64), '${BRIDE_ID}')
      `)).rejects.toThrow(/ACCOUNT_DELETION_MUTATION_BLOCKED/);
      await expect(db.exec(`
        INSERT INTO public.amora_care_jobs(
          id, couple_id, roster_member_ids, status, content, metadata
        ) VALUES (
          '99999999-eeee-4eee-8eee-eeeeeeeeeeee', '${COUPLE_ID}',
          ARRAY['${GROOM_ID}'::uuid, '${BRIDE_ID}'::uuid], 'pending',
          'late copied private context', '{"private":true}'
        )
      `)).rejects.toThrow(/ACCOUNT_DELETION_MUTATION_BLOCKED/);
      await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);");

      await expect(db.exec(`
        DELETE FROM public.events
        WHERE user_id = '${GROOM_ID}'
      `)).rejects.toThrow(/EVENTS_ARE_APPEND_ONLY/);

      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '${BRIDE_ID}', false);
        SELECT set_config('request.jwt.claim.role', 'authenticated', false);
        SET ROLE authenticated;
      `);
      await expect(db.exec(`
        INSERT INTO public.search_logs(id, user_id, query)
        VALUES ('99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BRIDE_ID}', 'blocked')
      `)).rejects.toThrow(/ACCOUNT_DELETION_MUTATION_BLOCKED/);
      await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);");

      await db.exec(`DELETE FROM auth.users WHERE id = '${BRIDE_ID}'`);
      await db.exec(`
        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);
      const finalized = await db.query<{ finalized: boolean }>(`
        SELECT public.finalize_account_deletion_job(
          '${jobId}', '${CLAIM_ID}'
        ) AS finalized
      `);
      expect(finalized.rows).toEqual([{ finalized: true }]);
      await db.exec("RESET ROLE;");

      expect((await db.query(`
        SELECT status, user_id, deletion_couple_id, deletion_actor_role,
          private_data_purged_at IS NOT NULL AS purged
        FROM public.account_deletion_jobs WHERE id = '${jobId}'
      `)).rows).toEqual([{
        status: "completed",
        user_id: null,
        deletion_couple_id: null,
        deletion_actor_role: null,
        purged: true,
      }]);

      // Requests authenticated before finalization must not recreate data after
      // the deletion job drops its direct user identifier.
      await expect(db.exec(`
        INSERT INTO public.chat_feedback(id, user_id, couple_id, correction)
        VALUES ('99999999-cccc-4ccc-8ccc-cccccccccccc', '${BRIDE_ID}', '${COUPLE_ID}', 'post-finalize service write')
      `)).rejects.toThrow(/ACCOUNT_ACTOR_NOT_ACTIVE/);

      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '${BRIDE_ID}', false);
        SELECT set_config('request.jwt.claim.role', 'authenticated', false);
        SET ROLE authenticated;
      `);
      await expect(db.exec(`
        INSERT INTO public.search_logs(id, user_id, query)
        VALUES ('99999999-dddd-4ddd-8ddd-dddddddddddd', '${BRIDE_ID}', 'post-finalize authenticated write')
      `)).rejects.toThrow(/ACCOUNT_ACTOR_NOT_ACTIVE/);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("enforces a de-identified ledger and purges a private scope on roster departure", async () => {
    const db = await database();
    try {
      expect((await db.query("SELECT user_id, email FROM public.account_deletions")).rows)
        .toEqual([]);
      expect((await db.query("SELECT q23_contact, user_agent FROM public.customer_survey_responses")).rows)
        .toEqual([{ q23_contact: null, user_agent: null }]);
      expect((await db.query("SELECT user_agent FROM public.b2b_survey_responses")).rows)
        .toEqual([{ user_agent: null }]);
      await expect(db.exec(`
        UPDATE public.b2b_survey_responses SET user_agent = 'reintroduced'
      `)).rejects.toThrow(/b2b_survey_responses_user_agent_null/i);

      await db.exec(`
        INSERT INTO public.chat_messages(id, couple_id, sender_id, visibility, content)
        VALUES
          ('aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${COUPLE_ID}', NULL, 'bride_private', 'orphan risk'),
          ('aaaaaaaa-cccc-4ccc-8ccc-cccccccccccc', '${COUPLE_ID}', '${GROOM_ID}', 'shared', 'shared');
        INSERT INTO public.amora_turn_requests(request_key, couple_id)
        VALUES ('chat:${BRIDE_ID}:after-reset', '${COUPLE_ID}');
        INSERT INTO public.amora_conflict_check_claims(couple_id, message_digest, requester_user_id)
        VALUES ('${COUPLE_ID}', repeat('c', 64), '${BRIDE_ID}');
        UPDATE public.couples SET bride_id = NULL WHERE id = '${COUPLE_ID}';
      `);

      expect((await db.query<{ content: string }>(`
        SELECT content FROM public.chat_messages ORDER BY content
      `)).rows).toEqual([{ content: "shared" }]);
      expect((await db.query("SELECT * FROM public.amora_turn_requests")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM public.amora_conflict_check_claims")).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("routes administrator and legal-retention records to review before deletion", async () => {
    const db = await database();
    try {
      const adminClaim = "88888888-8888-4888-8888-888888888888";
      const legalClaim = "99999999-9999-4999-8999-999999999999";
      await db.exec(`
        INSERT INTO public.vendor_alias_proposals(id, reviewed_by)
        VALUES ('aaaaaaaa-dddd-4ddd-8ddd-dddddddddddd', '${ADMIN_ID}');
        INSERT INTO public.vendor_bookings(id, couple_id)
        VALUES ('bbbbbbbb-dddd-4ddd-8ddd-dddddddddddd', '${COUPLE_ID}');
        INSERT INTO public.contracts(id, booking_id, customer_id)
        VALUES (
          'cccccccc-dddd-4ddd-8ddd-dddddddddddd',
          'bbbbbbbb-dddd-4ddd-8ddd-dddddddddddd',
          '${LEGAL_ID}'
        );
        INSERT INTO public.payments(id, contract_id, customer_id)
        VALUES (
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'cccccccc-dddd-4ddd-8ddd-dddddddddddd',
          '${LEGAL_ID}'
        );
        INSERT INTO public.account_deletion_jobs(
          user_id, reason, status, claim_token, claimed_at
        ) VALUES
          ('${ADMIN_ID}', 'privacy', 'deleting', '${adminClaim}', clock_timestamp()),
          ('${LEGAL_ID}', 'privacy', 'deleting', '${legalClaim}', clock_timestamp());

        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);
      const jobs = await db.query<{ id: string; user_id: string }>(`
        SELECT id, user_id FROM public.account_deletion_jobs
        WHERE user_id IN ('${ADMIN_ID}', '${LEGAL_ID}')
        ORDER BY user_id
      `);
      const adminJob = jobs.rows.find((row) => row.user_id === ADMIN_ID)!;
      const legalJob = jobs.rows.find((row) => row.user_id === LEGAL_ID)!;

      await expect(db.query(`
        SELECT public.preflight_account_deletion_retention(
          '${adminJob.id}', '${adminClaim}'
        ) AS state
      `)).resolves.toMatchObject({ rows: [{ state: "manual_review" }] });
      await expect(db.query(`
        SELECT public.preflight_account_deletion_retention(
          '${legalJob.id}', '${legalClaim}'
        ) AS state
      `)).resolves.toMatchObject({ rows: [{ state: "manual_review" }] });
      await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);");

      expect((await db.query(`
        SELECT user_id, status, claim_token, last_error_code
        FROM public.account_deletion_jobs
        WHERE user_id IN ('${ADMIN_ID}', '${LEGAL_ID}')
        ORDER BY user_id
      `)).rows).toEqual([
        {
          user_id: ADMIN_ID,
          status: "manual_review",
          claim_token: null,
          last_error_code: "administrator_audit_retention_review",
        },
        {
          user_id: LEGAL_ID,
          status: "manual_review",
          claim_token: null,
          last_error_code: "public_or_legal_retention_review",
        },
      ]);
      expect((await db.query(`
        SELECT id FROM auth.users
        WHERE id IN ('${ADMIN_ID}', '${LEGAL_ID}')
      `)).rows).toHaveLength(2);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("retains agent attribution and receipt-verification audit actors for review", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO auth.users(id, email) VALUES
          ('${PERSONA_ADMIN_ID}', 'persona-admin@example.com'),
          ('${DRAFT_ADMIN_ID}', 'draft-admin@example.com'),
          ('${RECEIPT_ADMIN_ID}', 'receipt-admin@example.com');
        INSERT INTO public.profiles(id, couple_id, role) VALUES
          ('${PERSONA_ADMIN_ID}', NULL, NULL),
          ('${DRAFT_ADMIN_ID}', NULL, NULL),
          ('${RECEIPT_ADMIN_ID}', NULL, NULL);
        INSERT INTO public.community_agent_personas(id, created_by, backing_user_id)
        VALUES (
          'cccccccc-7777-4777-8777-777777777777',
          '${PERSONA_ADMIN_ID}', '${PERSONA_ADMIN_ID}'
        );
        INSERT INTO public.community_agent_content_drafts(id, created_by, posted_by)
        VALUES (
          'dddddddd-7777-4777-8777-777777777777',
          '${DRAFT_ADMIN_ID}', '${DRAFT_ADMIN_ID}'
        );
        INSERT INTO public.vendor_bookings(id, couple_id, receipt_verified_by)
        VALUES (
          'eeeeeeee-7777-4777-8777-777777777777',
          NULL, '${RECEIPT_ADMIN_ID}'
        );
      `);

      expect((await db.query<{ block_code: string }>(`
        SELECT public.account_deletion_retention_block_code(
          '${PERSONA_ADMIN_ID}'
        ) AS block_code
        UNION ALL
        SELECT public.account_deletion_retention_block_code(
          '${DRAFT_ADMIN_ID}'
        )
        UNION ALL
        SELECT public.account_deletion_retention_block_code(
          '${RECEIPT_ADMIN_ID}'
        )
      `)).rows).toEqual([
        { block_code: "administrator_audit_retention_review" },
        { block_code: "administrator_audit_retention_review" },
        { block_code: "administrator_audit_retention_review" },
      ]);
    } finally {
      await db.close();
    }
  });

  it("holds legacy guestbook owners for exact media review before Auth deletion", async () => {
    const db = await database();
    const claimId = "dddddddd-7777-4777-8777-777777777777";
    try {
      await db.exec(`
        INSERT INTO auth.users(id, email)
        VALUES ('${GUESTBOOK_OWNER_ID}', 'guestbook-owner@example.com');
        INSERT INTO public.profiles(id, couple_id, role)
        VALUES ('${GUESTBOOK_OWNER_ID}', NULL, NULL);
        INSERT INTO public.guestbooks(id, owner_id)
        VALUES (
          'eeeeeeee-7777-4777-8777-777777777777',
          '${GUESTBOOK_OWNER_ID}'
        );
        INSERT INTO public.account_deletion_jobs(
          user_id, reason, status, claim_token, claimed_at
        ) VALUES (
          '${GUESTBOOK_OWNER_ID}', 'privacy', 'deleting',
          '${claimId}', clock_timestamp()
        );
        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);

      const job = await db.query<{ id: string }>(`
        SELECT id FROM public.account_deletion_jobs
        WHERE user_id = '${GUESTBOOK_OWNER_ID}'
      `);
      await expect(db.query(`
        SELECT public.preflight_account_deletion_retention(
          '${job.rows[0].id}', '${claimId}'
        ) AS state
      `)).resolves.toMatchObject({ rows: [{ state: "manual_review" }] });
      await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);");

      expect((await db.query(`
        SELECT status, claim_token, last_error_code
        FROM public.account_deletion_jobs
        WHERE user_id = '${GUESTBOOK_OWNER_ID}'
      `)).rows).toEqual([{
        status: "manual_review",
        claim_token: null,
        last_error_code: "guestbook_media_manual_review_required",
      }]);
      expect((await db.query(`
        SELECT id FROM auth.users WHERE id = '${GUESTBOOK_OWNER_ID}'
      `)).rows).toHaveLength(1);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("checkpoints exact owner- or sender-proven legacy chat objects service-only", async () => {
    const db = await database();
    try {
      const firstPath = `${COUPLE_ID}/1700000000000-abc12.webp`;
      const secondPath = `${COUPLE_ID}/${BRIDE_ID}/22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
      const referencedPath = `${COUPLE_ID}/1700000000001-def34.webp`;
      const referencedJobId = "dddddddd-8888-4888-8888-888888888888";
      const referencedClaimId = "eeeeeeee-8888-4888-8888-888888888888";
      await db.exec(`
        INSERT INTO storage.objects(bucket_id, name, owner, owner_id) VALUES
          ('chat-image', '${firstPath}', '${BRIDE_ID}', NULL),
          ('chat-image', '${secondPath}', NULL, '${BRIDE_ID}'),
          ('chat-image', '${referencedPath}', NULL, NULL),
          ('community-images', '${BRIDE_ID}/ignored.webp', '${BRIDE_ID}', NULL);
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, visibility, content, metadata
        ) VALUES (
          'ffffffff-8888-4888-8888-888888888888', '${COUPLE_ID}',
          '${GROOM_ID}', 'shared', 'legacy image',
          jsonb_build_object('imagePaths', jsonb_build_array('${referencedPath}'))
        );
        INSERT INTO public.account_deletion_jobs(
          id, user_id, reason, status, claim_token, claimed_at
        ) VALUES
          (
            'cccccccc-8888-4888-8888-888888888888', '${BRIDE_ID}',
            'privacy', 'deleting', '${CLAIM_ID}', clock_timestamp()
          ),
          (
            '${referencedJobId}', '${GROOM_ID}', 'privacy', 'deleting',
            '${referencedClaimId}', clock_timestamp()
          );
        SET ROLE service_role;
      `);

      const firstPage = (await db.query<{ path: string }>(`
        SELECT * FROM public.list_account_deletion_owned_chat_objects(
          '${BRIDE_ID}', NULL, 1
        )
      `)).rows;
      expect(firstPage).toHaveLength(1);
      const secondPage = (await db.query<{ path: string }>(`
        SELECT * FROM public.list_account_deletion_owned_chat_objects(
          '${BRIDE_ID}', '${firstPage[0].path}', 100
        )
      `)).rows;
      expect([...firstPage, ...secondPage].map((row) => row.path).sort())
        .toEqual([firstPath, secondPath].sort());

      expect((await db.query<{ marked: boolean }>(`
        SELECT public.mark_account_deletion_legacy_chat_manual_review(
          'cccccccc-8888-4888-8888-888888888888', '${CLAIM_ID}',
          ARRAY['${firstPath}']::text[],
          'chat_legacy_owner_manual_review_required'
        ) AS marked
      `)).rows).toEqual([{ marked: true }]);
      expect((await db.query(`
        SELECT bucket, path, source
        FROM public.account_deletion_media_manifest
        WHERE job_id = 'cccccccc-8888-4888-8888-888888888888'
      `)).rows).toEqual([{
        bucket: "chat-image",
        path: firstPath,
        source: "quarantine",
      }]);
      expect((await db.query(`
        SELECT status, claim_token, last_error_code
        FROM public.account_deletion_jobs
        WHERE id = 'cccccccc-8888-4888-8888-888888888888'
      `)).rows).toEqual([{
        status: "manual_review",
        claim_token: null,
        last_error_code: "chat_legacy_owner_manual_review_required",
      }]);

      expect((await db.query<{ marked: boolean }>(`
        SELECT public.mark_account_deletion_legacy_chat_manual_review(
          '${referencedJobId}', '${referencedClaimId}',
          ARRAY['${referencedPath}']::text[],
          'chat_legacy_attachment_manual_review_required'
        ) AS marked
      `)).rows).toEqual([{ marked: true }]);
      expect((await db.query(`
        SELECT bucket, path, source
        FROM public.account_deletion_media_manifest
        WHERE job_id = '${referencedJobId}'
      `)).rows).toEqual([{
        bucket: "chat-image",
        path: referencedPath,
        source: "quarantine",
      }]);
      expect((await db.query(`
        SELECT status, claim_token, last_error_code
        FROM public.account_deletion_jobs
        WHERE id = '${referencedJobId}'
      `)).rows).toEqual([{
        status: "manual_review",
        claim_token: null,
        last_error_code: "chat_legacy_attachment_manual_review_required",
      }]);

      await db.exec("RESET ROLE; SET ROLE authenticated;");
      await expect(db.query(`
        SELECT * FROM public.list_account_deletion_owned_chat_objects(
          '${BRIDE_ID}', NULL, 100
        )
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.query(`
        SELECT public.mark_account_deletion_legacy_chat_manual_review(
          '${referencedJobId}', '${referencedClaimId}',
          ARRAY['${referencedPath}']::text[],
          'chat_legacy_attachment_manual_review_required'
        )
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("keeps the service-only deletion control plane operable behind the global DML fence", async () => {
    const db = await database();
    try {
      const userId = "aaaaaaaa-1111-4111-8111-111111111111";
      const claimId = "bbbbbbbb-1111-4111-8111-111111111111";
      await db.exec(`
        INSERT INTO auth.users(id, email) VALUES ('${userId}', 'control@example.com');
        SET ROLE service_role;
        SELECT set_config('request.jwt.claim.role', 'service_role', false);
      `);
      const begun = await db.query<{ id: string }>(`
        SELECT id FROM public.begin_account_deletion_job('${userId}', 'privacy')
      `);
      expect(begun.rows).toHaveLength(1);
      const jobId = begun.rows[0].id;
      const claimed = await db.query<{ claim_token: string }>(`
        SELECT claim_token FROM public.claim_account_deletion_job(
          '${jobId}', '${claimId}', clock_timestamp() - interval '15 minutes'
        )
      `);
      expect(claimed.rows).toEqual([{ claim_token: claimId }]);
      const released = await db.query<{ released: boolean }>(`
        SELECT public.release_account_deletion_job(
          '${jobId}', '${claimId}', 'storage_cleanup_pending'
        ) AS released
      `);
      expect(released.rows).toEqual([{ released: true }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });
});
