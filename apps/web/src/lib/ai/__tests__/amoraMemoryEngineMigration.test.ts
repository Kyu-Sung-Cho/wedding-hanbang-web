// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const memoryMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716090000_amora_memory_engine_v2.sql"),
  "utf8",
);
const mediationMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716092000_amora_mediation_confirmation.sql"),
  "utf8",
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const AI_MESSAGE_ID = "20000000-0000-4000-8000-000000000002";
const NEXT_AI_MESSAGE_ID = "20000000-0000-4000-8000-000000000003";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      visibility text NOT NULL DEFAULT 'shared',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      category text,
      decision_type text DEFAULT 'exploring',
      title text,
      chosen_value jsonb,
      options_considered jsonb DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric(3,2) DEFAULT 0.50,
      stage_tag text,
      decided_at timestamptz,
      source text DEFAULT 'chat',
      source_ref_id uuid,
      metadata jsonb DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      user_id uuid,
      summary_type text NOT NULL DEFAULT 'info',
      title text NOT NULL DEFAULT 'summary',
      content text NOT NULL DEFAULT '',
      summary text,
      message_count integer NOT NULL DEFAULT 0,
      from_message_id text,
      visibility text NOT NULL,
      to_message_id text,
      importance integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_couple_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL
    );

    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE FUNCTION public.is_couple_member(p_couple_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.couples
          WHERE id = p_couple_id AND auth.uid() IN (bride_id, groom_id)
        )
      $$;
    CREATE FUNCTION public.can_access_couple_visibility(p_couple_id uuid, p_visibility text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.couples
          WHERE id = p_couple_id
            AND (
              (p_visibility = 'shared' AND auth.uid() IN (bride_id, groom_id))
              OR (p_visibility = 'bride_private' AND auth.uid() = bride_id)
              OR (p_visibility = 'groom_private' AND auth.uid() = groom_id)
            )
        )
      $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid), public.can_access_couple_visibility(uuid, text)
      TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.chat_messages(id, couple_id, sender_type, role, content, visibility) VALUES
      ('${USER_MESSAGE_ID}', '${COUPLE_ID}', 'bride', 'user', '강남 쪽을 선호해요', 'shared'),
      ('${AI_MESSAGE_ID}', '${COUPLE_ID}', 'ai', 'assistant', '두 분의 중재안입니다', 'shared'),
      ('${NEXT_AI_MESSAGE_ID}', '${COUPLE_ID}', 'ai', 'assistant', '다음 응답', 'shared');
  `);
  return db;
}

async function setPersona(db: PGlite, role: "authenticated" | "service_role", userId?: string) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("Amora memory engine v2 migrations", () => {
  it("applies cleanly and keeps write functions service-only", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "authenticated", BRIDE_ID);

      await expect(db.query("SELECT public.claim_amora_memory_job(300)")).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "SELECT public.delete_amora_memory_node($1, 'shared', $2, $3)",
        [COUPLE_ID, USER_MESSAGE_ID, BRIDE_ID],
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "INSERT INTO public.amora_memory_settings(couple_id, visibility) VALUES ($1, 'shared')",
        [COUPLE_ID],
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "INSERT INTO public.amora_memory_consents(couple_id, visibility, user_id) VALUES ($1, 'shared', $2)",
        [COUPLE_ID, BRIDE_ID],
      )).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("claims serially and supersedes a changed semantic memory without duplicates", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `INSERT INTO public.decision_nodes(
          couple_id, category, decision_type, title, chosen_value, source,
          metadata, visibility
        ) VALUES (
          $1, 'preference', 'considering', '무동의 시절 자동 추론',
          '{"value":"과거 값"}'::jsonb, 'chat',
          '{"extracted_by":"legacy"}'::jsonb, 'shared'
        )`,
        [COUPLE_ID],
      );
      await db.query(
        `INSERT INTO public.chat_summaries(
          couple_id, summary_type, title, content, summary, message_count,
          to_message_id, visibility
        ) VALUES ($1, 'info', '과거 요약', '과거 요약', '과거 요약', 1, $2, 'shared')`,
        [COUPLE_ID, AI_MESSAGE_ID],
      );
      await db.query(
        "INSERT INTO public.amora_couple_profiles(couple_id, visibility) VALUES ($1, 'shared')",
        [COUPLE_ID],
      );
      const firstConsent = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true) AS result",
        [COUPLE_ID, BRIDE_ID],
      );
      expect(firstConsent.rows[0]?.result).toMatchObject({
        consented_count: 1,
        required_count: 2,
        enabled: false,
      });
      const secondConsent = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true) AS result",
        [COUPLE_ID, GROOM_ID],
      );
      expect(secondConsent.rows[0]?.result).toMatchObject({
        consented_count: 2,
        required_count: 2,
        enabled: true,
      });
      const historicalState = await db.query<{ nodes: number; summaries: number; profiles: number }>(
        `SELECT
          (SELECT count(*)::integer FROM public.decision_nodes) AS nodes,
          (SELECT count(*)::integer FROM public.chat_summaries) AS summaries,
          (SELECT count(*)::integer FROM public.amora_couple_profiles) AS profiles`,
      );
      expect(historicalState.rows[0]).toEqual({ nodes: 0, summaries: 0, profiles: 0 });
      const activationBoundary = await db.query<{ memory_reset_at: string | null }>(
        `SELECT memory_reset_at::text FROM public.amora_memory_settings
         WHERE couple_id = $1 AND visibility = 'shared'`,
        [COUPLE_ID],
      );
      expect(activationBoundary.rows[0]?.memory_reset_at).toBeTruthy();
      const beforeBoundary = await db.query<{ result: string }>(
        "SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $3) AS result",
        [COUPLE_ID, BRIDE_ID, AI_MESSAGE_ID],
      );
      expect(beforeBoundary.rows[0]?.result).toBe("before_boundary");
      await expect(db.query(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:before_consent', 'venue', '과거 선호', '강남', NULL,
          0.91, 'considering', $2, '{}'::jsonb
        )`,
        [COUPLE_ID, USER_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_SOURCE_INVALID/);
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE couple_id = $1",
        [COUPLE_ID],
      );
      const enqueued = await db.query<{ result: string }>(
        `SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $3) AS result
         UNION ALL
         SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $4) AS result`,
        [COUPLE_ID, BRIDE_ID, AI_MESSAGE_ID, NEXT_AI_MESSAGE_ID],
      );
      expect(enqueued.rows.map((row) => row.result)).toEqual(["queued", "queued"]);

      const firstClaim = await db.query<{ id: string; attempt_count: number }>(
        "SELECT id, attempt_count FROM public.claim_amora_memory_job(300)",
      );
      const blockedClaim = await db.query<{ id: string }>("SELECT id FROM public.claim_amora_memory_job(300)");
      expect(firstClaim.rows).toHaveLength(1);
      expect(firstClaim.rows[0]?.attempt_count).toBe(1);
      expect(blockedClaim.rows).toHaveLength(0);
      await db.query(
        `UPDATE public.amora_memory_jobs
         SET claimed_at = now() - interval '400 seconds'
         WHERE id = $1`,
        [firstClaim.rows[0]?.id],
      );
      await db.query(
        "UPDATE public.amora_memory_jobs SET available_at = now() + interval '1 day' WHERE id <> $1",
        [firstClaim.rows[0]?.id],
      );
      const reclaimed = await db.query<{ id: string; attempt_count: number }>(
        "SELECT id, attempt_count FROM public.claim_amora_memory_job(300)",
      );
      expect(reclaimed.rows[0]).toMatchObject({ id: firstClaim.rows[0]?.id, attempt_count: 2 });
      const staleFinish = await db.query<{ finished: boolean }>(
        "SELECT public.finish_amora_memory_job($1, true, NULL, 1) AS finished",
        [firstClaim.rows[0]?.id],
      );
      expect(staleFinish.rows[0]?.finished).toBe(false);
      const currentFinish = await db.query<{ finished: boolean }>(
        "SELECT public.finish_amora_memory_job($1, true, NULL, 2) AS finished",
        [firstClaim.rows[0]?.id],
      );
      expect(currentFinish.rows[0]?.finished).toBe(true);
      await db.query(
        `UPDATE public.amora_memory_jobs
         SET status = 'processing', attempt_count = 5,
             claimed_at = now() - interval '400 seconds'
         WHERE id <> $1`,
        [firstClaim.rows[0]?.id],
      );
      const afterExhaustion = await db.query<{ id: string }>(
        "SELECT id FROM public.claim_amora_memory_job(300)",
      );
      expect(afterExhaustion.rows).toHaveLength(0);
      const exhausted = await db.query<{ status: string; last_error_code: string }>(
        "SELECT status, last_error_code FROM public.amora_memory_jobs WHERE id <> $1",
        [firstClaim.rows[0]?.id],
      );
      expect(exhausted.rows[0]).toEqual({ status: "failed", last_error_code: "LEASE_EXHAUSTED" });

      const first = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '강남',
          '사용자가 직접 말함', 0.91, 'considering', $2, '{"explicit":true}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );
      const retry = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '강남',
          '다시 확인함', 0.95, 'considering', $2, '{"explicit":true}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );
      const changed = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '성수',
          '사용자가 변경함', 0.96, 'considering', $2, '{"explicit":true}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );

      expect(retry.rows[0]?.id).toBe(first.rows[0]?.id);
      expect(changed.rows[0]?.id).not.toBe(first.rows[0]?.id);
      const nodes = await db.query<{ id: string; active: boolean; superseded_by: string | null }>(
        `SELECT id, superseded_at IS NULL AS active, superseded_by
         FROM public.decision_nodes WHERE memory_key = 'venue:preferred_area' ORDER BY created_at`,
      );
      expect(nodes.rows).toHaveLength(2);
      expect(nodes.rows.filter((row) => row.active)).toHaveLength(1);
      expect(nodes.rows[0]?.superseded_by).toBe(changed.rows[0]?.id);

      const corrected = await db.query<{ id: string }>(
        `SELECT public.update_amora_memory_node(
          $1, 'shared', $2, $3, '직접 고친 선호 지역', '한남'
        ) AS id`,
        [COUPLE_ID, changed.rows[0]?.id, BRIDE_ID],
      );
      const compilerAfterCorrection = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '잠실',
          '새 대화에서 추출함', 0.98, 'considering', $2, '{"explicit":true}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );
      expect(compilerAfterCorrection.rows[0]?.id).toBe(corrected.rows[0]?.id);
      const correctedValue = await db.query<{ value: string; confirmed: boolean }>(
        `SELECT chosen_value ->> 'value' AS value, user_confirmed_at IS NOT NULL AS confirmed
         FROM public.decision_nodes WHERE id = $1`,
        [corrected.rows[0]?.id],
      );
      expect(correctedValue.rows[0]).toEqual({ value: "한남", confirmed: true });

      const deleted = await db.query<{ deleted: boolean }>(
        "SELECT public.delete_amora_memory_node($1, 'shared', $2, $3) AS deleted",
        [COUPLE_ID, corrected.rows[0]?.id, BRIDE_ID],
      );
      expect(deleted.rows[0]?.deleted).toBe(true);
      const compilerAfterDeletion = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '잠실',
          '큐에 남아 있던 결과', 0.98, 'considering', $2, '{"explicit":true}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );
      expect(compilerAfterDeletion.rows[0]?.id).toBe(corrected.rows[0]?.id);
      const activeAfterDeletion = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM public.decision_nodes
         WHERE memory_key = 'venue:preferred_area' AND superseded_at IS NULL`,
      );
      expect(activeAfterDeletion.rows[0]?.count).toBe(0);

      const insertedSummary = await db.query<{ inserted: boolean }>(
        `SELECT public.insert_amora_memory_summary(
          $1, $2, 'shared', '예식장 지역 선호를 확인했다.', 10, NULL, $3
        ) AS inserted`,
        [COUPLE_ID, BRIDE_ID, NEXT_AI_MESSAGE_ID],
      );
      expect(insertedSummary.rows[0]?.inserted).toBe(true);

      await expect(db.query(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'budget:invalid_source', 'budget', '예산', '1000만원', NULL,
          0.91, 'decided', $2, '{}'::jsonb
        )`,
        [COUPLE_ID, AI_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_SOURCE_INVALID/);

      await expect(db.query(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'budget:total', 'budget', '예산', '1000만원', NULL,
          0.79, 'decided', $2, '{}'::jsonb
        )`,
        [COUPLE_ID, USER_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_UPSERT_INVALID/);

      const cleared = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.clear_amora_memory_scope($1, 'shared', $2) AS result",
        [COUPLE_ID, BRIDE_ID],
      );
      expect(cleared.rows[0]?.result).toMatchObject({ cleared: true, deleted_memory_count: 2 });
      const remaining = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes WHERE memory_key IS NOT NULL",
      );
      expect(remaining.rows[0]?.count).toBe(0);
      const setting = await db.query<{ enabled: boolean; memory_reset_at: string | null }>(
        "SELECT enabled, memory_reset_at::text FROM public.amora_memory_settings WHERE couple_id = $1 AND visibility = 'shared'",
        [COUPLE_ID],
      );
      expect(setting.rows[0]?.enabled).toBe(false);
      expect(setting.rows[0]?.memory_reset_at).toBeTruthy();
      const summaries = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.chat_summaries WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(summaries.rows[0]?.count).toBe(0);
      await expect(db.query(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '잠실', NULL,
          0.91, 'considering', $2, '{}'::jsonb
        )`,
        [COUPLE_ID, USER_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_DISABLED/);
      const disabledEnqueue = await db.query<{ result: string }>(
        "SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $3) AS result",
        [COUPLE_ID, BRIDE_ID, NEXT_AI_MESSAGE_ID],
      );
      expect(disabledEnqueue.rows[0]?.result).toBe("disabled");
      await expect(db.query(
        "SELECT public.clear_amora_memory_scope($1, 'shared', $2)",
        [COUPLE_ID, OUTSIDER_ID],
      )).rejects.toThrow(/AMORA_MEMORY_CLEAR_SCOPE_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("upgrades legacy extracted memories so individual edit and delete remain functional", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      const legacy = await db.query<{ id: string }>(
        `INSERT INTO public.decision_nodes(
          couple_id, category, decision_type, title, chosen_value, source,
          source_ref_id, metadata, visibility
        ) VALUES (
          $1, 'venue', 'considering', '예전 기억', '{"value":"강남"}'::jsonb,
          'chat', $2, '{"extracted_by":"legacy"}'::jsonb, 'shared'
        ) RETURNING id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );

      await db.query(
        "SELECT public.update_amora_memory_node($1, 'shared', $2, $3, '직접 고친 기억', '성수')",
        [COUPLE_ID, legacy.rows[0]?.id, BRIDE_ID],
      );
      const upgraded = await db.query<{ memory_key: string; value: string }>(
        `SELECT memory_key, chosen_value ->> 'value' AS value
         FROM public.decision_nodes WHERE id = $1`,
        [legacy.rows[0]?.id],
      );
      expect(upgraded.rows[0]?.memory_key).toMatch(/^legacy:[0-9a-f]{32}$/);
      expect(upgraded.rows[0]?.value).toBe("성수");

      const deleted = await db.query<{ deleted: boolean }>(
        "SELECT public.delete_amora_memory_node($1, 'shared', $2, $3) AS deleted",
        [COUPLE_ID, legacy.rows[0]?.id, BRIDE_ID],
      );
      expect(deleted.rows[0]?.deleted).toBe(true);
      const tombstone = await db.query<{ deleted: boolean; active: boolean }>(
        `SELECT metadata ->> 'user_deleted' = 'true' AS deleted,
                superseded_at IS NULL AS active
         FROM public.decision_nodes WHERE id = $1`,
        [legacy.rows[0]?.id],
      );
      expect(tombstone.rows[0]).toEqual({ deleted: true, active: false });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("requires every linked partner before recording a mediation decision", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const first = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.accept_amora_mediation($1, $2, $3, '예산 합의', '총액 상한을 정한다') AS result",
        [COUPLE_ID, AI_MESSAGE_ID, BRIDE_ID],
      );
      expect(first.rows[0]?.result).toMatchObject({ accepted_count: 1, required_count: 2, completed: false });

      const second = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.accept_amora_mediation($1, $2, $3, '예산 합의', '총액 상한을 정한다') AS result",
        [COUPLE_ID, AI_MESSAGE_ID, GROOM_ID],
      );
      expect(second.rows[0]?.result).toMatchObject({ accepted_count: 2, required_count: 2, completed: true });

      await db.query(
        "SELECT public.accept_amora_mediation($1, $2, $3, '예산 합의', '총액 상한을 정한다')",
        [COUPLE_ID, AI_MESSAGE_ID, GROOM_ID],
      );
      const decisions = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes WHERE category = 'conflict_resolution'",
      );
      expect(decisions.rows[0]?.count).toBe(1);
      await expect(db.query(
        "SELECT public.accept_amora_mediation($1, $2, $3, '예산 합의', '총액 상한을 정한다')",
        [COUPLE_ID, AI_MESSAGE_ID, OUTSIDER_ID],
      )).rejects.toThrow(/AMORA_MEDIATION_SCOPE_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
