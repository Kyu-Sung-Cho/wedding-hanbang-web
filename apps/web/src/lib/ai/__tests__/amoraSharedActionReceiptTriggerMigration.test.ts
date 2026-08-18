// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260818160000_amora_shared_action_receipt_trigger.sql",
);

const USER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_ID = "30000000-0000-4000-8000-000000000001";
const CONFIRMATION_ID = "30000000-0000-4000-8000-000000000002";
const ACTION_ID = "40000000-0000-4000-8000-000000000001";

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
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      role text NOT NULL
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      sender_id uuid,
      sender_type text NOT NULL,
      sender_role text,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      stage_tag text,
      specialist_type text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.amora_shared_action_application_claims (
      couple_id uuid NOT NULL,
      source_message_id uuid NOT NULL,
      action_id uuid NOT NULL,
      claimed_by_user_id uuid NOT NULL,
      proposal_digest text NOT NULL,
      roster_fingerprint text NOT NULL,
      confirmation_message_id uuid,
      lease_expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
      PRIMARY KEY (couple_id, source_message_id, action_id)
    );
    CREATE TABLE public.amora_shared_action_acceptances (
      couple_id uuid NOT NULL,
      source_message_id uuid NOT NULL,
      action_id uuid NOT NULL,
      user_id uuid NOT NULL,
      proposal_digest text NOT NULL,
      roster_fingerprint text NOT NULL,
      revoked_at timestamptz
    );
    CREATE FUNCTION public.amora_shared_action_context(
      p_action_id uuid,
      p_couple_id uuid,
      p_source_message_id uuid,
      p_user_id uuid,
      p_context_mode text,
      p_confirmation_message_id uuid
    ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      SELECT jsonb_build_object(
        'policy', 'single',
        'proposalDigest', repeat('c', 64),
        'rosterFingerprint', repeat('d', 32),
        'requiredCount', 1
      )
    $$;
    CREATE FUNCTION public.bind_amora_shared_action_application()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public
    SET lock_timeout = '5s'
    SET statement_timeout = '15s' AS $$
    BEGIN
      IF jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) <> 'object'
         OR NOT (COALESCE(NEW.metadata, '{}'::jsonb) ? 'confirmed_amora_action_id') THEN
        RETURN NEW;
      END IF;
      IF NEW.sender_id IS NULL OR NEW.sender_type NOT IN ('bride', 'groom')
         OR NEW.role IS DISTINCT FROM 'user' OR NEW.visibility IS DISTINCT FROM 'shared' THEN
        RAISE EXCEPTION 'AMORA_SHARED_ACTION_CONFIRMATION_INVALID'
          USING ERRCODE = '22023';
      END IF;
      RETURN NEW;
    END
    $$;
    REVOKE ALL ON FUNCTION public.bind_amora_shared_action_application()
      FROM PUBLIC, anon, authenticated, service_role;
    CREATE TRIGGER trg_bind_amora_shared_action_application
      BEFORE INSERT ON public.chat_messages
      FOR EACH ROW EXECUTE FUNCTION public.bind_amora_shared_action_application();
    GRANT USAGE ON SCHEMA public, auth TO service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO public.couples(id, bride_id) VALUES ('${COUPLE_ID}', '${USER_ID}');
    INSERT INTO public.profiles(id, couple_id, role)
    VALUES ('${USER_ID}', '${COUPLE_ID}', 'bride');
  `);
  return db;
}

async function setServiceRole(db: PGlite) {
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
}

function canonicalReceiptMetadata(origin:
  | "server_authoritative_first_use_action_application"
  | "server_authoritative_provider_backed_add_action_application") {
  return {
    client_request_id: `chat:${USER_ID}:50000000-0000-4000-8000-000000000001`,
    client_visible_request_id: `chat:${USER_ID}:50000000-0000-4000-8000-000000000002`,
    in_reply_to_user_message_id: CONFIRMATION_ID,
    confirmed_amora_action_id: ACTION_ID,
    question_scope: "W0_wedding_core",
    memory_eligible: false,
    memory_enqueue_requested: false,
    amora_wedding_context_revision: 7,
    ...(origin === "server_authoritative_first_use_action_application"
      ? { amora_first_use_promotion_id: "60000000-0000-4000-8000-000000000001" }
      : { source_amora_action_message_id: SOURCE_ID }),
    toolResults: [{
      toolName: "add_amora_action",
      toolInput: { title: "예식장 계약서 확인" },
      toolOutput: { action: { id: "act_receipt_test", status: "open" } },
      success: true,
      displayMessage: "행동에 추가했어요.",
    }],
    toolsUsed: ["add_amora_action"],
    persistence_terminal_source: "server_mutation_receipts",
    response_origin: origin,
    provider_call_count: 0,
  };
}

async function insertAssistantReceipt(db: PGlite, metadata: Record<string, unknown>) {
  return db.query(`
    INSERT INTO public.chat_messages(
      id, couple_id, sender_id, sender_type, sender_role, role,
      content, metadata, visibility, stage_tag, specialist_type
    ) VALUES (
      gen_random_uuid(), $1::uuid, NULL, 'ai', NULL, 'assistant',
      '행동에 추가했어요.', $2::jsonb, 'shared', NULL, 'general'
    )
  `, [COUPLE_ID, JSON.stringify(metadata)]);
}

describe("Amora shared-action receipt trigger successor", () => {
  it("reproduces the hosted failure before the successor exists", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await expect(insertAssistantReceipt(
        db,
        canonicalReceiptMetadata(
          "server_authoritative_provider_backed_add_action_application",
        ),
      )).rejects.toThrow(/AMORA_SHARED_ACTION_CONFIRMATION_INVALID/);
    } finally {
      await db.close();
    }
  });

  it("allows only canonical server application receipts and preserves user binding", async () => {
    expect(existsSync(migrationPath)).toBe(true);
    const db = await createDatabase();
    try {
      await db.exec(readFileSync(migrationPath, "utf8"));
      await setServiceRole(db);

      await insertAssistantReceipt(
        db,
        canonicalReceiptMetadata(
          "server_authoritative_provider_backed_add_action_application",
        ),
      );
      await insertAssistantReceipt(
        db,
        canonicalReceiptMetadata(
          "server_authoritative_first_use_action_application",
        ),
      );
      await expect(insertAssistantReceipt(db, {
        ...canonicalReceiptMetadata(
          "server_authoritative_provider_backed_add_action_application",
        ),
        provider_call_count: 1,
      })).rejects.toThrow(/AMORA_SHARED_ACTION_CONFIRMATION_INVALID/);

      await db.query(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, role, content, metadata, visibility
        ) VALUES (
          $1::uuid, $2::uuid, NULL, 'ai', 'assistant', '제안',
          jsonb_build_object(
            'pending_amora_action', jsonb_build_object('actionId', $3::uuid)
          ), 'shared'
        )
      `, [SOURCE_ID, COUPLE_ID, ACTION_ID]);
      await db.query(`
        INSERT INTO public.amora_shared_action_application_claims(
          couple_id, source_message_id, action_id, claimed_by_user_id,
          proposal_digest, roster_fingerprint
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, repeat('c', 64), repeat('d', 32)
        )
      `, [COUPLE_ID, SOURCE_ID, ACTION_ID, USER_ID]);
      await db.query(`
        INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, sender_role, role,
          content, metadata, visibility
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 'bride', NULL, 'user',
          '좋아요. 제안한 변경을 적용해 주세요.',
          jsonb_build_object('confirmed_amora_action_id', $4::uuid), 'shared'
        )
      `, [CONFIRMATION_ID, COUPLE_ID, USER_ID, ACTION_ID]);
      const bound = await db.query<{ confirmation_message_id: string }>(`
        SELECT confirmation_message_id
        FROM public.amora_shared_action_application_claims
        WHERE couple_id = $1::uuid AND action_id = $2::uuid
      `, [COUPLE_ID, ACTION_ID]);
      expect(bound.rows[0]?.confirmation_message_id).toBe(CONFIRMATION_ID);
    } finally {
      await db.close();
    }
  });
});
