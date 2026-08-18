// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const sendGateMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260807090000_amora_mediation_send_gate.sql"),
  "utf8",
);
const boundaryMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260818140000_amora_mediation_private_draft_boundary.sql"),
  "utf8",
);

const COUPLE = "10000000-0000-4000-8000-000000000001";
const OTHER_COUPLE = "10000000-0000-4000-8000-000000000002";
const BRIDE = "00000000-0000-4000-8000-000000000001";
const GROOM = "00000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid,
      sender_type text,
      role text,
      content text NOT NULL,
      metadata jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.acceptance_calls (message_id uuid, user_id uuid);
    CREATE FUNCTION public.accept_amora_mediation(
      p_couple_id uuid, p_message_id uuid, p_user_id uuid, p_title text,
      p_resolution text, p_expected_proposal_version uuid,
      p_expected_roster_fingerprint text
    ) RETURNS jsonb LANGUAGE plpgsql AS $stub$
    BEGIN
      INSERT INTO public.acceptance_calls VALUES (p_message_id, p_user_id);
      RETURN jsonb_build_object('accepted', true);
    END $stub$;

    INSERT INTO public.couples (id, bride_id, groom_id) VALUES
      ('${COUPLE}', '${BRIDE}', '${GROOM}'),
      ('${OTHER_COUPLE}', NULL, NULL);
  `);
  await db.exec(sendGateMigration);
  await db.exec(`
    CREATE FUNCTION public.test_bind_mediation_proposal()
    RETURNS trigger LANGUAGE plpgsql AS $bind$
    DECLARE
      v_bride uuid;
      v_groom uuid;
    BEGIN
      IF NEW.sender_type = 'ai'
         AND NEW.role = 'assistant'
         AND NEW.visibility = 'shared'
         AND jsonb_typeof(NEW.metadata -> 'mediation') = 'object' THEN
        SELECT bride_id, groom_id INTO v_bride, v_groom
          FROM public.couples WHERE id = NEW.couple_id;
        NEW.metadata := jsonb_set(
          NEW.metadata,
          '{mediation}',
          (NEW.metadata -> 'mediation') || jsonb_build_object(
            'proposalVersion', gen_random_uuid()::text,
            'rosterFingerprint', md5(COALESCE(v_bride::text, '-') || ':' || COALESCE(v_groom::text, '-'))
          ),
          true
        );
      END IF;
      RETURN NEW;
    END $bind$;
    CREATE TRIGGER trg_test_bind_mediation_proposal
      BEFORE INSERT OR UPDATE OF metadata, visibility ON public.chat_messages
      FOR EACH ROW EXECUTE FUNCTION public.test_bind_mediation_proposal();
  `);
  await db.exec(boundaryMigration);
  return db;
}

function mediationJson(resolution = "서로 가능한 상한을 하나씩 확인해요.") {
  return JSON.stringify({
    empathy: "요청자가 답답함을 느꼈다고 전했어요.",
    translation: "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
    data: "상대방의 생각은 아직 확인되지 않았어요.",
    resolution,
    origin: "user_requested",
    evidenceScope: "requester_summary_only",
    schemaVersion: 2,
  }).replaceAll("'", "''");
}

async function insertDraft(db: PGlite) {
  const result = await db.query<{ id: string }>(`
    INSERT INTO public.chat_messages (
      couple_id, sender_type, role, content, metadata, visibility
    ) VALUES (
      '${COUPLE}', 'ai', 'assistant', 'private outer prose',
      jsonb_build_object(
        'question_scope', 'W1_wedding_adjacent',
        'memory_eligible', false,
        'mediation_draft_state', 'draft',
        'mediation_draft_sendable', true,
        'mediation_draft_roster_fingerprint', md5('${BRIDE}:${GROOM}'),
        'mediation', '${mediationJson()}'::jsonb
      ),
      'bride_private'
    ) RETURNING id;
  `);
  return result.rows[0].id;
}

describe("mediation private-draft boundary", () => {
  it("permits the canonical share RPC path and rejects a direct shared insert", async () => {
    const db = await createDatabase();
    const draftId = await insertDraft(db);

    const result = await db.query<{ value: { shared_message_id: string } }>(`
      SELECT public.share_amora_mediation_draft(
        '${draftId}', '${BRIDE}', true
      ) AS value;
    `);
    const sharedId = result.rows[0].value.shared_message_id;
    const rows = await db.query<{ metadata: Record<string, unknown>; content: string }>(`
      SELECT metadata, content FROM public.chat_messages WHERE id = '${sharedId}';
    `);

    expect(rows.rows[0].content).toBe("요청하신 분이 초안을 읽고 이 카드를 보냈어요.");
    expect(rows.rows[0].metadata.mediation_source_draft_id).toBe(draftId);
    expect(rows.rows[0].metadata.mediation_share_origin).toBe("requester_sent");
    expect((rows.rows[0].metadata.mediation as Record<string, unknown>).proposalVersion).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    await db.close();
  });

  it("rejects a direct shared mediation insert before it becomes visible", async () => {
    const db = await createDatabase();

    await expect(db.query(`
      INSERT INTO public.chat_messages (
        couple_id, sender_type, role, content, metadata, visibility
      ) VALUES (
        '${COUPLE}', 'ai', 'assistant', 'direct shared mediation',
        jsonb_build_object(
          'question_scope', 'W1_wedding_adjacent',
          'memory_eligible', false,
          'mediation', '${mediationJson()}'::jsonb
        ),
        'shared'
      );
    `)).rejects.toThrow(/AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED/);

    const count = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM public.chat_messages;
    `);
    expect(count.rows[0].count).toBe(0);
    await db.close();
  });

  it("rejects a foreign or content-mismatched source draft", async () => {
    const db = await createDatabase();
    const draftId = await insertDraft(db);

    await expect(db.query(`
      INSERT INTO public.chat_messages (
        couple_id, sender_type, role, content, metadata, visibility
      ) VALUES (
        '${OTHER_COUPLE}', 'ai', 'assistant', '요청하신 분이 초안을 읽고 이 카드를 보냈어요.',
        jsonb_build_object(
          'mediation_source_draft_id', '${draftId}',
          'mediation_share_origin', 'requester_sent',
          'question_scope', 'W1_wedding_adjacent',
          'memory_eligible', false,
          'mediation', '${mediationJson()}'::jsonb
        ),
        'shared'
      );
    `)).rejects.toThrow(/AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED/);

    await expect(db.query(`
      INSERT INTO public.chat_messages (
        couple_id, sender_type, role, content, metadata, visibility
      ) VALUES (
        '${COUPLE}', 'ai', 'assistant', '요청하신 분이 초안을 읽고 이 카드를 보냈어요.',
        jsonb_build_object(
          'mediation_source_draft_id', '${draftId}',
          'mediation_share_origin', 'requester_sent',
          'question_scope', 'W1_wedding_adjacent',
          'memory_eligible', false,
          'mediation', '${mediationJson("서로 다른 내용을 보냅니다.")}'::jsonb
        ),
        'shared'
      );
    `)).rejects.toThrow(/AMORA_MEDIATION_PRIVATE_DRAFT_REQUIRED/);
    await db.close();
  });

  it("does not affect ordinary shared chat messages", async () => {
    const db = await createDatabase();
    await db.query(`
      INSERT INTO public.chat_messages (
        couple_id, sender_type, role, content, metadata, visibility
      ) VALUES ('${COUPLE}', 'ai', 'assistant', 'ordinary', '{}'::jsonb, 'shared');
    `);
    const count = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM public.chat_messages;
    `);
    expect(count.rows[0].count).toBe(1);
    await db.close();
  });
});
