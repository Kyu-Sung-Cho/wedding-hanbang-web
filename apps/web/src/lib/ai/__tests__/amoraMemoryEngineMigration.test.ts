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
const memoryBudgetDeferralMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716098000_amora_memory_budget_deferral.sql"),
  "utf8",
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const AI_MESSAGE_ID = "20000000-0000-4000-8000-000000000002";
const NEXT_AI_MESSAGE_ID = "20000000-0000-4000-8000-000000000003";
const AFTER_TARGET_AI_MESSAGE_ID = "20000000-0000-4000-8000-000000000004";
const GROOM_USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000005";

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
      sender_id uuid REFERENCES auth.users(id),
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
      summary_type text NOT NULL DEFAULT 'info'
        CHECK (summary_type IN ('decision', 'preference', 'budget', 'schedule', 'concern', 'info', 'progress')),
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
    INSERT INTO public.chat_messages(id, couple_id, sender_id, sender_type, role, content, visibility) VALUES
      ('${USER_MESSAGE_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', '강남 쪽을 선호해요', 'shared'),
      ('${AI_MESSAGE_ID}', '${COUPLE_ID}', NULL, 'ai', 'assistant', '두 분의 중재안입니다', 'shared'),
      ('${NEXT_AI_MESSAGE_ID}', '${COUPLE_ID}', NULL, 'ai', 'assistant', '다음 응답', 'shared');
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

type MediationBinding = {
  version: string;
  roster: string;
};

async function getMediationBinding(db: PGlite, messageId = AI_MESSAGE_ID): Promise<MediationBinding> {
  const binding = await db.query<MediationBinding>(
    `SELECT metadata #>> '{mediation,proposalVersion}' AS version,
            metadata #>> '{mediation,rosterFingerprint}' AS roster
     FROM public.chat_messages
     WHERE id = $1`,
    [messageId],
  );
  const current = binding.rows[0];
  if (!current?.version || !current.roster) {
    throw new Error("Mediation proposal binding is missing");
  }
  return current;
}

async function acceptMediation(
  db: PGlite,
  userId: string,
  title: string,
  resolution: string,
  binding?: MediationBinding,
) {
  const expected = binding ?? await getMediationBinding(db);
  return db.query<{ result: Record<string, unknown> }>(
    "SELECT public.accept_amora_mediation($1, $2, $3, $4, $5, $6, $7) AS result",
    [COUPLE_ID, AI_MESSAGE_ID, userId, title, resolution, expected.version, expected.roster],
  );
}

describe("Amora memory engine v2 migrations", () => {
  it("preserves the deployed chat summary type contract", () => {
    expect(memoryMigration).not.toMatch(/DROP\s+CONSTRAINT[\s\S]{0,300}summary_type/i);
    expect(memoryMigration).not.toMatch(/summary_type\s*=\s*'cursor'/i);
  });

  it("applies cleanly and keeps write functions service-only", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "authenticated", BRIDE_ID);

      await expect(db.query("SELECT public.claim_amora_memory_job(300)")).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "SELECT public.defer_amora_memory_job($1, 1, 3600, 'GLOBAL_BUDGET')",
        [USER_MESSAGE_ID],
      )).rejects.toThrow(/permission denied/i);
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

  it("defers a budget-blocked job without consuming an execution attempt", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\n${memoryBudgetDeferralMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id,
           status, attempt_count, claimed_at, available_at
         ) VALUES ($1, $2, 'shared', $3, 'processing', 1, now(), now())
         RETURNING id`,
        [COUPLE_ID, BRIDE_ID, AI_MESSAGE_ID],
      );
      const jobId = inserted.rows[0]?.id;

      const stale = await db.query<{ deferred: boolean }>(
        "SELECT public.defer_amora_memory_job($1, 2, 3600, 'GLOBAL_BUDGET') AS deferred",
        [jobId],
      );
      expect(stale.rows[0]?.deferred).toBe(false);

      const deferred = await db.query<{ deferred: boolean }>(
        "SELECT public.defer_amora_memory_job($1, 1, 3600, 'GLOBAL_BUDGET') AS deferred",
        [jobId],
      );
      expect(deferred.rows[0]?.deferred).toBe(true);
      const state = await db.query<{
        status: string;
        attempt_count: number;
        last_error_code: string;
        claimed_at: string | null;
        delay_seconds: number;
      }>(
        `SELECT status, attempt_count, last_error_code, claimed_at,
                extract(epoch FROM (available_at - now()))::integer AS delay_seconds
         FROM public.amora_memory_jobs WHERE id = $1`,
        [jobId],
      );
      expect(state.rows[0]).toMatchObject({
        status: "pending",
        attempt_count: 0,
        last_error_code: "GLOBAL_BUDGET",
        claimed_at: null,
      });
      expect(state.rows[0]?.delay_seconds).toBeGreaterThanOrEqual(3_590);
      expect(state.rows[0]?.delay_seconds).toBeLessThanOrEqual(3_600);

      await expect(db.query(
        "SELECT public.defer_amora_memory_job($1, 0, 30, 'GLOBAL_BUDGET')",
        [jobId],
      )).rejects.toThrow(/AMORA_MEMORY_JOB_DEFER_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("locks the couple roster before every member-authorized memory scope lock", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      const definitions = await db.query<{ proname: string; prosrc: string }>(`
        SELECT procedure.proname, procedure.prosrc
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'enqueue_amora_memory_job',
            'update_amora_memory_node',
            'delete_amora_memory_node',
            'set_amora_memory_consent',
            'clear_amora_memory_scope'
          )
      `);

      expect(definitions.rows).toHaveLength(5);
      for (const definition of definitions.rows) {
        const rosterLock = definition.prosrc.indexOf("FOR SHARE");
        const scopeLock = definition.prosrc.indexOf("pg_advisory_xact_lock");
        expect(rosterLock, `${definition.proname} must lock the couples row`).toBeGreaterThan(-1);
        expect(scopeLock, `${definition.proname} must lock the memory scope`).toBeGreaterThan(-1);
        expect(rosterLock, `${definition.proname} lock order`).toBeLessThan(scopeLock);
      }
    } finally {
      await db.close();
    }
  }, 30_000);

  it("uses one deadlock-safe lock order for every mediation proposal mutation", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      const definitions = await db.query<{ proname: string; prosrc: string }>(`
        SELECT procedure.proname, procedure.prosrc
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'bind_amora_mediation_proposal',
            'accept_amora_mediation',
            'revoke_amora_mediation_acceptance'
          )
      `);

      expect(definitions.rows).toHaveLength(3);
      for (const definition of definitions.rows.filter(
        ({ proname }) => proname !== "bind_amora_mediation_proposal",
      )) {
        const proposalRead = definition.prosrc.indexOf("FROM public.chat_messages AS message");
        const proposalLock = definition.prosrc.indexOf("FOR SHARE", proposalRead);
        const advisoryLock = definition.prosrc.indexOf("pg_advisory_xact_lock", proposalLock);
        const rosterLock = definition.prosrc.indexOf("FROM public.couples AS couple", advisoryLock);
        const acceptanceMutation = definition.prosrc.indexOf(
          "DELETE FROM public.amora_mediation_acceptances",
          proposalRead,
        );
        expect(proposalRead, `${definition.proname} must read the canonical proposal`).toBeGreaterThan(-1);
        expect(proposalLock, `${definition.proname} must lock the proposal row`).toBeGreaterThan(proposalRead);
        expect(advisoryLock, `${definition.proname} must lock the proposal scope`).toBeGreaterThan(proposalLock);
        expect(rosterLock, `${definition.proname} must lock the couple roster`).toBeGreaterThan(advisoryLock);
        expect(acceptanceMutation, `${definition.proname} must mutate acceptance rows`).toBeGreaterThan(-1);
        expect(rosterLock, `${definition.proname} mutation lock order`).toBeLessThan(acceptanceMutation);
      }

      const binder = definitions.rows.find(({ proname }) => proname === "bind_amora_mediation_proposal");
      expect(binder).toBeDefined();
      const updateBranch = binder?.prosrc.indexOf("IF TG_OP = 'UPDATE' THEN") ?? -1;
      const binderAdvisory = binder?.prosrc.indexOf("pg_advisory_xact_lock", updateBranch) ?? -1;
      const binderRoster = binder?.prosrc.indexOf("FROM public.couples AS couple", binderAdvisory) ?? -1;
      const decisionRead = binder?.prosrc.indexOf("FROM public.decision_nodes AS node", binderAdvisory) ?? -1;
      const pendingDelete = binder?.prosrc.indexOf(
        "DELETE FROM public.amora_mediation_acceptances",
        binderAdvisory,
      ) ?? -1;
      expect(updateBranch).toBeGreaterThan(-1);
      expect(binderAdvisory).toBeGreaterThan(updateBranch);
      expect(binderRoster).toBeGreaterThan(binderAdvisory);
      expect(decisionRead).toBeGreaterThan(binderRoster);
      expect(pendingDelete).toBeGreaterThan(decisionRead);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("removes the unreleased five-argument mediation acceptance path on retry", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.accept_amora_mediation(uuid, uuid, uuid, text, text)
        RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
        GRANT EXECUTE ON FUNCTION public.accept_amora_mediation(uuid, uuid, uuid, text, text)
          TO service_role;
        BEGIN;
        ${mediationMigration}
        COMMIT;
      `);
      const signatures = await db.query<{ legacy: string | null; strict: string | null }>(`
        SELECT
          to_regprocedure('public.accept_amora_mediation(uuid,uuid,uuid,text,text)')::text AS legacy,
          to_regprocedure('public.accept_amora_mediation(uuid,uuid,uuid,text,text,uuid,text)')::text AS strict
      `);
      expect(signatures.rows[0]?.legacy).toBeNull();
      expect(signatures.rows[0]?.strict).toContain("accept_amora_mediation");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("does not recreate memory settings after the final member deletes an empty couple", async () => {
    const db = await createDatabase();
    const emptyCoupleId = "10000000-0000-4000-8000-000000000099";
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await db.query(
        "INSERT INTO public.couples(id, bride_id, groom_id) VALUES ($1, $2, NULL)",
        [emptyCoupleId, BRIDE_ID],
      );
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.test_delete_empty_couple()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.bride_id IS NULL AND NEW.groom_id IS NULL THEN
            DELETE FROM public.couples WHERE id = NEW.id;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER trg_delete_empty_couple_after_membership_change
          AFTER UPDATE OF bride_id, groom_id ON public.couples
          FOR EACH ROW
          WHEN (NEW.bride_id IS NULL AND NEW.groom_id IS NULL)
          EXECUTE FUNCTION public.test_delete_empty_couple();
      `);
      await setPersona(db, "service_role");

      await db.query(
        "UPDATE public.couples SET bride_id = NULL WHERE id = $1",
        [emptyCoupleId],
      );
      const state = await db.query<{ couples: number; settings: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.couples WHERE id = $1) AS couples,
          (SELECT count(*)::integer FROM public.amora_memory_settings WHERE couple_id = $1) AS settings
      `, [emptyCoupleId]);
      expect(state.rows[0]).toEqual({ couples: 0, settings: 0 });
    } finally {
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

      const jobIds = await db.query<{ id: string; to_message_id: string; status: string }>(
        `SELECT id, to_message_id, status
         FROM public.amora_memory_jobs
         WHERE couple_id = $1
         ORDER BY to_message_id`,
        [COUPLE_ID],
      );
      const targetedJob = jobIds.rows.find((job) => job.to_message_id === NEXT_AI_MESSAGE_ID);
      const untouchedJob = jobIds.rows.find((job) => job.to_message_id === AI_MESSAGE_ID);
      expect(targetedJob?.id).toBeTruthy();
      expect(untouchedJob?.id).toBeTruthy();
      const targetedClaim = await db.query<{ id: string; attempt_count: number }>(
        "SELECT id, attempt_count FROM public.claim_amora_memory_job(300, $1)",
        [targetedJob?.id],
      );
      expect(targetedClaim.rows).toEqual([{ id: targetedJob?.id, attempt_count: 1 }]);
      const untouched = await db.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM public.amora_memory_jobs WHERE id = $1",
        [untouchedJob?.id],
      );
      expect(untouched.rows[0]).toEqual({ status: "pending", attempt_count: 0 });
      await db.query(
        "SELECT public.finish_amora_memory_job($1, true, NULL, 1)",
        [targetedJob?.id],
      );

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
      const correctedValue = await db.query<{
        value: string;
        confirmed: boolean;
        decision_type: string;
        confidence: number;
        metadata: string;
      }>(
        `SELECT chosen_value ->> 'value' AS value,
                user_confirmed_at IS NOT NULL AS confirmed,
                decision_type,
                confidence::float AS confidence,
                metadata::text
         FROM public.decision_nodes WHERE id = $1`,
        [corrected.rows[0]?.id],
      );
      expect(correctedValue.rows[0]).toMatchObject({
        value: "한남",
        confirmed: false,
        decision_type: "considering",
        confidence: 0.8,
      });
      expect(correctedValue.rows[0]?.metadata).toContain('"user_corrected": true');
      expect(correctedValue.rows[0]?.metadata).not.toContain(BRIDE_ID);

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

  it("stops shared-memory processing when a newly linked partner has not consented", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query("UPDATE public.couples SET groom_id = NULL WHERE id = $1", [COUPLE_ID]);

      const soloConsent = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true) AS result",
        [COUPLE_ID, BRIDE_ID],
      );
      expect(soloConsent.rows[0]?.result).toMatchObject({ required_count: 2, enabled: false });

      await db.query("UPDATE public.couples SET groom_id = $2 WHERE id = $1", [COUPLE_ID, GROOM_ID]);
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      const enqueue = await db.query<{ result: string }>(
        "SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $3) AS result",
        [COUPLE_ID, BRIDE_ID, AI_MESSAGE_ID],
      );

      expect(enqueue.rows[0]?.result).toBe("disabled");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects an automatic shared-memory write after the member roster changes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query("UPDATE public.couples SET groom_id = NULL WHERE id = $1", [COUPLE_ID]);
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE id = $1",
        [USER_MESSAGE_ID],
      );
      await db.query("UPDATE public.couples SET groom_id = $2 WHERE id = $1", [COUPLE_ID, GROOM_ID]);

      await expect(db.query(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:without_partner_consent', 'venue', '선호 지역', '강남',
          '사용자가 직접 말함', 0.91, 'considering', $2, '{"explicit":true}'::jsonb
        )`,
        [COUPLE_ID, USER_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_DISABLED/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a source message whose sender is not a current member of the couple", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );
      await db.query(
        `UPDATE public.chat_messages
         SET sender_id = $2, sender_type = 'bride', created_at = now() + interval '1 second'
         WHERE id = $1`,
        [USER_MESSAGE_ID, OUTSIDER_ID],
      );

      await expect(db.query(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:outsider_source', 'venue', '선호 지역', '강남',
          '현재 멤버가 아닌 발화', 0.91, 'considering', $2, '{"explicit":true}'::jsonb
        )`,
        [COUPLE_ID, USER_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_SOURCE_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("erases role-private derived memory before a different partner can occupy that slot", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'groom_private', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );
      await db.query(
        `UPDATE public.chat_messages
         SET sender_id = $2, sender_type = 'groom', visibility = 'groom_private',
             created_at = now() + interval '1 second'
         WHERE id = $1`,
        [USER_MESSAGE_ID, GROOM_ID],
      );
      await db.query(
        `SELECT public.upsert_amora_memory_node(
          $1, 'groom_private', 'family:private_context', 'family', '개인 가족 맥락',
          '이전 파트너의 비공개 정보', '사용자가 개인 상담에서 직접 말함', 0.92,
          'considering', $2, '{"explicit":true}'::jsonb
        )`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );

      await db.query("UPDATE public.couples SET groom_id = $2 WHERE id = $1", [COUPLE_ID, OUTSIDER_ID]);

      const privateState = await db.query<{ memories: number; consents: number; enabled: boolean }>(
        `SELECT
          (SELECT count(*)::integer FROM public.decision_nodes
           WHERE couple_id = $1 AND visibility = 'groom_private' AND memory_key IS NOT NULL) AS memories,
          (SELECT count(*)::integer FROM public.amora_memory_consents
           WHERE couple_id = $1 AND visibility = 'groom_private') AS consents,
          COALESCE((SELECT enabled FROM public.amora_memory_settings
           WHERE couple_id = $1 AND visibility = 'groom_private'), false) AS enabled`,
        [COUPLE_ID],
      );
      expect(privateState.rows[0]).toEqual({ memories: 0, consents: 0, enabled: false });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("purges pre-consent derived data on first activation even after an earlier opt-out", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `INSERT INTO public.decision_nodes(
          couple_id, category, decision_type, title, chosen_value, source, metadata, visibility
        ) VALUES (
          $1, 'preference', 'considering', '동의 전 추론', '{"value":"과거 값"}'::jsonb,
          'chat', '{"extracted_by":"legacy"}'::jsonb, 'shared'
        )`,
        [COUPLE_ID],
      );

      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, false)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );

      const legacyRows = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes WHERE title = '동의 전 추론'",
      );
      expect(legacyRows.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("scrubs deleted memory content and actor identifiers while retaining only a tombstone key", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE id = $1",
        [USER_MESSAGE_ID],
      );
      const inserted = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:deletion_test', 'venue', '삭제 전 비밀 제목',
          '삭제 전 비밀 내용', '삭제 전 비밀 근거', 0.92, 'considering', $2,
          '{"explicit":true}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );

      await db.query(
        "SELECT public.delete_amora_memory_node($1, 'shared', $2, $3)",
        [COUPLE_ID, inserted.rows[0]?.id, BRIDE_ID],
      );
      const tombstone = await db.query<{
        memory_key: string;
        title: string;
        value: string | null;
        reasoning: string | null;
        source_message_id: string | null;
        metadata: string;
      }>(
        `SELECT memory_key, title, chosen_value ->> 'value' AS value, reasoning,
                source_message_id::text, metadata::text
         FROM public.decision_nodes WHERE id = $1`,
        [inserted.rows[0]?.id],
      );

      expect(tombstone.rows[0]).toMatchObject({
        memory_key: "venue:deletion_test",
        title: "삭제된 기억",
        value: null,
        reasoning: null,
        source_message_id: null,
      });
      expect(tombstone.rows[0]?.metadata).toContain('"user_deleted": true');
      expect(tombstone.rows[0]?.metadata).not.toContain(BRIDE_ID);
      expect(JSON.stringify(tombstone.rows[0])).not.toContain("삭제 전 비밀");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps each partner's same-key memory separate and blocks cross-actor correction", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE couple_id = $1",
        [COUPLE_ID],
      );
      await db.query(
        `INSERT INTO public.chat_messages(
          id, couple_id, sender_id, sender_type, role, content, visibility, created_at
        ) VALUES ($1, $2, $3, 'groom', 'user', '나는 성수를 선호해', 'shared', now() + interval '2 seconds')`,
        [GROOM_USER_MESSAGE_ID, COUPLE_ID, GROOM_ID],
      );

      const brideFirst = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '강남',
          '신부가 직접 말함', 0.91, 'considering', $2, '{}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );
      const groom = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '성수',
          '신랑이 직접 말함', 0.92, 'considering', $2, '{}'::jsonb
        ) AS id`,
        [COUPLE_ID, GROOM_USER_MESSAGE_ID],
      );
      const brideCorrection = await db.query<{ id: string }>(
        `SELECT public.upsert_amora_memory_node(
          $1, 'shared', 'venue:preferred_area', 'venue', '선호 지역', '송파',
          '신부가 선호를 바꿈', 0.95, 'considering', $2, '{}'::jsonb
        ) AS id`,
        [COUPLE_ID, USER_MESSAGE_ID],
      );

      expect(groom.rows[0]?.id).not.toBe(brideFirst.rows[0]?.id);
      expect(brideCorrection.rows[0]?.id).not.toBe(brideFirst.rows[0]?.id);
      const active = await db.query<{
        source_actor_role: string;
        value: string;
      }>(
        `SELECT source_actor_role, chosen_value ->> 'value' AS value
         FROM public.decision_nodes
         WHERE couple_id = $1
           AND memory_key = 'venue:preferred_area'
           AND superseded_at IS NULL
         ORDER BY source_actor_role`,
        [COUPLE_ID],
      );
      expect(active.rows).toEqual([
        { source_actor_role: "bride", value: "송파" },
        { source_actor_role: "groom", value: "성수" },
      ]);

      await expect(db.query(
        "SELECT public.update_amora_memory_node($1, 'shared', $2, $3, '상대가 고친 기억', '잠실')",
        [COUPLE_ID, brideCorrection.rows[0]?.id, GROOM_ID],
      )).rejects.toThrow(/AMORA_MEMORY_UPDATE_ACTOR_INVALID/);
      await db.query(
        "SELECT public.update_amora_memory_node($1, 'shared', $2, $3, '직접 고친 기억', '잠실')",
        [COUPLE_ID, brideCorrection.rows[0]?.id, BRIDE_ID],
      );
      const corrected = await db.query<{ metadata: string }>(
        "SELECT metadata::text FROM public.decision_nodes WHERE id = $1",
        [brideCorrection.rows[0]?.id],
      );
      expect(corrected.rows[0]?.metadata).toContain('"user_corrected": true');
      expect(corrected.rows[0]?.metadata).toContain('"corrected_actor_role": "bride"');

      const partnerDeleted = await db.query<{ deleted: boolean }>(
        "SELECT public.delete_amora_memory_node($1, 'shared', $2, $3) AS deleted",
        [COUPLE_ID, brideCorrection.rows[0]?.id, GROOM_ID],
      );
      expect(partnerDeleted.rows[0]?.deleted).toBe(true);
      const groomStillActive = await db.query<{ actors: string[] }>(
        `SELECT array_agg(source_actor_role ORDER BY source_actor_role) AS actors
         FROM public.decision_nodes
         WHERE couple_id = $1
           AND memory_key = 'venue:preferred_area'
           AND superseded_at IS NULL`,
        [COUPLE_ID],
      );
      expect(groomStillActive.rows[0]?.actors).toEqual(["groom"]);

      const privateMemory = await db.query<{ id: string }>(
        `INSERT INTO public.decision_nodes(
          couple_id, category, decision_type, title, chosen_value, source,
          memory_key, source_actor_role, visibility, metadata
        ) VALUES (
          $1, 'style', 'considering', '개인 선호', '{"value":"차분함"}'::jsonb,
          'chat', 'style:private_mood', 'bride', 'bride_private', '{}'::jsonb
        ) RETURNING id`,
        [COUPLE_ID],
      );
      await expect(db.query(
        "SELECT public.delete_amora_memory_node($1, 'bride_private', $2, $3)",
        [COUPLE_ID, privateMemory.rows[0]?.id, GROOM_ID],
      )).rejects.toThrow(/AMORA_MEMORY_DELETE_SCOPE_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("commits a compiled memory bundle, summary, and job completion in one database transaction", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE couple_id = $1",
        [COUPLE_ID],
      );
      await db.query(
        "SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $3)",
        [COUPLE_ID, BRIDE_ID, AI_MESSAGE_ID],
      );
      const claimed = await db.query<{ id: string; attempt_count: number }>(
        "SELECT id, attempt_count FROM public.claim_amora_memory_job(300)",
      );
      const memories = JSON.stringify([
        {
          memory_key: "venue:bundle_area",
          category: "venue",
          title: "선호 지역",
          value: "강남",
          reasoning: "사용자가 직접 말함",
          confidence: 0.92,
          decision_type: "considering",
          source_message_id: USER_MESSAGE_ID,
          metadata: { explicit: true },
        },
        {
          memory_key: "style:bundle_mood",
          category: "style",
          title: "예식 분위기",
          value: "차분한 분위기",
          reasoning: null,
          confidence: 0.9,
          decision_type: "considering",
          source_message_id: USER_MESSAGE_ID,
          metadata: { explicit: true },
        },
      ]);

      const committed = await db.query<{ committed: boolean }>(
        `SELECT public.commit_amora_memory_job(
          $1, $2, $3::jsonb, '선호 지역과 분위기를 확인했다.', 2, NULL, $4
        ) AS committed`,
        [claimed.rows[0]?.id, claimed.rows[0]?.attempt_count, memories, AI_MESSAGE_ID],
      );
      expect(committed.rows[0]?.committed).toBe(true);

      const state = await db.query<{ memories: number; summaries: number; status: string }>(
        `SELECT
          (SELECT count(*)::integer FROM public.decision_nodes WHERE memory_key IS NOT NULL) AS memories,
          (SELECT count(*)::integer FROM public.chat_summaries) AS summaries,
          (SELECT status FROM public.amora_memory_jobs WHERE id = $1) AS status`,
        [claimed.rows[0]?.id],
      );
      expect(state.rows[0]).toEqual({ memories: 2, summaries: 1, status: "completed" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically advances a partial cursor and reclaims the same job until its original target is complete", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE couple_id = $1",
        [COUPLE_ID],
      );
      await db.query(
        `INSERT INTO public.chat_messages(
          id, couple_id, sender_type, role, content, visibility, created_at
        ) VALUES ($1, $2, 'ai', 'assistant', '원 target 뒤 메시지', 'shared', now() + interval '2 seconds')`,
        [AFTER_TARGET_AI_MESSAGE_ID, COUPLE_ID],
      );
      await db.query(
        "SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $3)",
        [COUPLE_ID, BRIDE_ID, NEXT_AI_MESSAGE_ID],
      );

      const firstClaim = await db.query<{
        id: string;
        attempt_count: number;
        continuation_count: number;
      }>(
        "SELECT id, attempt_count, continuation_count FROM public.claim_amora_memory_job(300)",
      );
      const jobId = firstClaim.rows[0]?.id;
      expect(firstClaim.rows[0]).toMatchObject({ attempt_count: 1, continuation_count: 0 });

      await expect(db.query(
        `SELECT public.commit_amora_memory_job(
          $1, $2, '[]'::jsonb, '원 target을 넘긴 배치', 4, NULL, $3
        )`,
        [jobId, firstClaim.rows[0]?.attempt_count, AFTER_TARGET_AI_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_PREFIX_INVALID/);

      await expect(db.query(
        `SELECT public.commit_amora_memory_job(
          $1, $2, '[]'::jsonb, '건너뛴 배치', 1, NULL, $3
        )`,
        [jobId, firstClaim.rows[0]?.attempt_count, AI_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_BATCH_COUNT_INVALID/);

      const partial = await db.query<{ committed: boolean }>(
        `SELECT public.commit_amora_memory_job(
          $1, $2, '[]'::jsonb, '첫 번째 연속 배치', 2, NULL, $3
        ) AS committed`,
        [jobId, firstClaim.rows[0]?.attempt_count, AI_MESSAGE_ID],
      );
      expect(partial.rows[0]?.committed).toBe(true);

      const continued = await db.query<{
        status: string;
        attempt_count: number;
        continuation_count: number;
        summary_type: string;
        to_message_id: string;
        cursor: string;
      }>(
        `SELECT job.status, job.attempt_count, job.continuation_count,
                summary.summary_type,
                job.to_message_id::text,
                summary.to_message_id AS cursor
         FROM public.amora_memory_jobs AS job
         JOIN public.chat_summaries AS summary
           ON summary.couple_id = job.couple_id
          AND summary.visibility = job.visibility
         WHERE job.id = $1`,
        [jobId],
      );
      expect(continued.rows[0]).toEqual({
        status: "pending",
        attempt_count: 0,
        continuation_count: 1,
        summary_type: "info",
        to_message_id: NEXT_AI_MESSAGE_ID,
        cursor: AI_MESSAGE_ID,
      });

      const secondClaim = await db.query<{
        id: string;
        attempt_count: number;
        continuation_count: number;
      }>(
        "SELECT id, attempt_count, continuation_count FROM public.claim_amora_memory_job(300)",
      );
      expect(secondClaim.rows[0]).toEqual({
        id: jobId,
        attempt_count: 1,
        continuation_count: 1,
      });

      await expect(db.query(
        `SELECT public.commit_amora_memory_job(
          $1, $2, '[]'::jsonb, '이전 커서를 생략한 배치', 1, NULL, $3
        )`,
        [jobId, secondClaim.rows[0]?.attempt_count, NEXT_AI_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_CURSOR_INVALID/);

      const final = await db.query<{ committed: boolean }>(
        `SELECT public.commit_amora_memory_job(
          $1, $2, '[]'::jsonb, '마지막 연속 배치', 1, $3, $4
        ) AS committed`,
        [jobId, secondClaim.rows[0]?.attempt_count, AI_MESSAGE_ID, NEXT_AI_MESSAGE_ID],
      );
      expect(final.rows[0]?.committed).toBe(true);
      const completed = await db.query<{
        status: string;
        summaries: number;
        cursor_summaries: number;
      }>(
        `SELECT status,
                (SELECT count(*)::integer FROM public.chat_summaries
                 WHERE couple_id = $2 AND visibility = 'shared') AS summaries,
                (SELECT count(*)::integer FROM public.chat_summaries
                 WHERE couple_id = $2 AND visibility = 'shared'
                   AND summary = '[AMORA_MEMORY_CURSOR_ONLY]') AS cursor_summaries
         FROM public.amora_memory_jobs WHERE id = $1`,
        [jobId, COUPLE_ID],
      );
      expect(completed.rows[0]).toEqual({
        status: "completed",
        summaries: 2,
        cursor_summaries: 2,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed instead of creating an unbounded continuation loop", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, BRIDE_ID],
      );
      await db.query(
        "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
        [COUPLE_ID, GROOM_ID],
      );
      await db.query(
        "UPDATE public.chat_messages SET created_at = now() + interval '1 second' WHERE couple_id = $1",
        [COUPLE_ID],
      );
      await db.query(
        "SELECT public.enqueue_amora_memory_job($1, $2, 'shared', $3)",
        [COUPLE_ID, BRIDE_ID, NEXT_AI_MESSAGE_ID],
      );
      await db.query(
        "UPDATE public.amora_memory_jobs SET continuation_count = 4 WHERE couple_id = $1",
        [COUPLE_ID],
      );
      const claimed = await db.query<{ id: string; attempt_count: number }>(
        "SELECT id, attempt_count FROM public.claim_amora_memory_job(300)",
      );

      await expect(db.query(
        `SELECT public.commit_amora_memory_job(
          $1, $2, '[]'::jsonb, '제한을 넘는 부분 배치', 2, NULL, $3
        )`,
        [claimed.rows[0]?.id, claimed.rows[0]?.attempt_count, AI_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEMORY_CONTINUATION_LIMIT/);

      const state = await db.query<{ status: string; summaries: number }>(
        `SELECT status,
                (SELECT count(*)::integer FROM public.chat_summaries
                 WHERE couple_id = $2 AND visibility = 'shared') AS summaries
         FROM public.amora_memory_jobs WHERE id = $1`,
        [claimed.rows[0]?.id, COUPLE_ID],
      );
      expect(state.rows[0]).toEqual({ status: "processing", summaries: 0 });
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
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"총액 상한을 정한다"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );

      const binding = await getMediationBinding(db);
      await expect(acceptMediation(
        db,
        BRIDE_ID,
        "잘못된 구성",
        "총액 상한을 정한다",
        { ...binding, roster: "00000000000000000000000000000000" },
      )).rejects.toThrow(/AMORA_MEDIATION_PROPOSAL_CHANGED/);
      const first = await acceptMediation(db, BRIDE_ID, "예산 합의", "총액 상한을 정한다", binding);
      expect(first.rows[0]?.result).toMatchObject({ accepted_count: 1, required_count: 2, completed: false });

      const second = await acceptMediation(db, GROOM_ID, "예산 합의", "총액 상한을 정한다");
      expect(second.rows[0]?.result).toMatchObject({ accepted_count: 2, required_count: 2, completed: true });

      await acceptMediation(db, GROOM_ID, "예산 합의", "총액 상한을 정한다");
      const decisions = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes WHERE category = 'conflict_resolution'",
      );
      expect(decisions.rows[0]?.count).toBe(1);
      await expect(
        acceptMediation(db, OUTSIDER_ID, "예산 합의", "총액 상한을 정한다"),
      ).rejects.toThrow(/AMORA_MEDIATION_SCOPE_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects mediation text that is not the exact proposal stored on the AI message", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"총액 상한을 함께 정한다"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );

      await expect(
        acceptMediation(db, BRIDE_ID, "임의 제목", "서버가 전달한 다른 합의안"),
      ).rejects.toThrow(/AMORA_MEDIATION_PROPOSAL_INVALID/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not combine acceptances made for different versions of a mediation proposal", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"첫 번째 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "첫 번째", "첫 번째 선택안");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"수정된 두 번째 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );

      const second = await acceptMediation(db, GROOM_ID, "두 번째", "수정된 두 번째 선택안");
      expect(second.rows[0]?.result).toMatchObject({
        accepted_count: 1,
        required_count: 2,
        completed: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("never reactivates an acceptance when proposal text changes away and back", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"처음 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const firstBinding = await getMediationBinding(db);
      expect(firstBinding.version).toMatch(/^[0-9a-f-]{36}$/);
      expect(firstBinding.roster).toMatch(/^[a-f0-9]{32}$/);

      await acceptMediation(db, BRIDE_ID, "처음", "처음 선택안", firstBinding);
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"중간 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const middleVersion = await db.query<{ version: string }>(
        "SELECT metadata #>> '{mediation,proposalVersion}' AS version FROM public.chat_messages WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"처음 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const revertedVersion = await db.query<{ version: string }>(
        "SELECT metadata #>> '{mediation,proposalVersion}' AS version FROM public.chat_messages WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      expect(middleVersion.rows[0]?.version).not.toBe(firstBinding.version);
      expect(revertedVersion.rows[0]?.version).not.toBe(firstBinding.version);
      expect(revertedVersion.rows[0]?.version).not.toBe(middleVersion.rows[0]?.version);
      const invalidated = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.amora_mediation_acceptances WHERE message_id = $1",
        [AI_MESSAGE_ID],
      );
      expect(invalidated.rows[0]?.count).toBe(0);

      await expect(
        acceptMediation(db, GROOM_ID, "오래된 화면", "처음 선택안", firstBinding),
      ).rejects.toThrow(/AMORA_MEDIATION_PROPOSAL_CHANGED/);
      const acceptance = await acceptMediation(db, GROOM_ID, "다시 처음", "처음 선택안");
      expect(acceptance.rows[0]?.result).toMatchObject({
        accepted_count: 1,
        required_count: 2,
        completed: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps only the current proposal version when acceptance follows a revision", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"수정 전 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "수정 전", "수정 전 선택안");

      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"수정 후 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const accepted = await acceptMediation(db, GROOM_ID, "수정 후", "수정 후 선택안");
      expect(accepted.rows[0]?.result).toMatchObject({
        accepted_count: 1,
        required_count: 2,
        completed: false,
      });

      const currentRows = await db.query<{
        user_id: string;
        acceptance_version: string;
        message_version: string;
        proposal_resolution: string;
      }>(
        `SELECT acceptance.user_id,
                acceptance.proposal_version::text AS acceptance_version,
                message.metadata #>> '{mediation,proposalVersion}' AS message_version,
                acceptance.proposal_resolution
         FROM public.amora_mediation_acceptances AS acceptance
         JOIN public.chat_messages AS message ON message.id = acceptance.message_id
         WHERE acceptance.message_id = $1`,
        [AI_MESSAGE_ID],
      );
      expect(currentRows.rows).toHaveLength(1);
      expect(currentRows.rows[0]).toMatchObject({
        user_id: GROOM_ID,
        proposal_resolution: "수정 후 선택안",
      });
      expect(currentRows.rows[0]?.acceptance_version).toBe(currentRows.rows[0]?.message_version);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("creates a new consent version when any mediation card field changes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"같은 선택안","empathy":"처음 공감","data":{"budget":100}}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const first = await db.query<{ version: string }>(
        "SELECT metadata #>> '{mediation,proposalVersion}' AS version FROM public.chat_messages WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "같은 선택안", "같은 선택안");

      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"같은 선택안","empathy":"수정된 공감","data":{"budget":100}}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const revised = await db.query<{ version: string; count: number }>(
        `SELECT message.metadata #>> '{mediation,proposalVersion}' AS version,
                count(acceptance.user_id)::integer AS count
         FROM public.chat_messages AS message
         LEFT JOIN public.amora_mediation_acceptances AS acceptance
           ON acceptance.message_id = message.id
         WHERE message.id = $1
         GROUP BY message.id`,
        [AI_MESSAGE_ID],
      );
      expect(revised.rows[0]?.version).not.toBe(first.rows[0]?.version);
      expect(revised.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("clears pending consent on valid-to-invalid transitions and protects completed proposals", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"공유 중재안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "공유 중재안", "공유 중재안");

      await db.query(
        "UPDATE public.chat_messages SET visibility = 'bride_private' WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      const cleared = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.amora_mediation_acceptances WHERE message_id = $1",
        [AI_MESSAGE_ID],
      );
      expect(cleared.rows[0]?.count).toBe(0);

      await db.query(
        "UPDATE public.chat_messages SET visibility = 'shared' WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "공유 중재안", "공유 중재안");
      await acceptMediation(db, GROOM_ID, "공유 중재안", "공유 중재안");
      await expect(db.query(
        "UPDATE public.chat_messages SET visibility = 'groom_private' WHERE id = $1",
        [AI_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_MEDIATION_ALREADY_COMPLETED/);
      const protectedMessage = await db.query<{ visibility: string }>(
        "SELECT visibility FROM public.chat_messages WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      expect(protectedMessage.rows[0]?.visibility).toBe("shared");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a mediation proposal created for a previous couple roster", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${memoryMigration}\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"현재 두 사람의 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "선택안", "현재 두 사람의 선택안");

      await db.query("UPDATE public.couples SET groom_id = $2 WHERE id = $1", [COUPLE_ID, OUTSIDER_ID]);
      await expect(
        acceptMediation(db, OUTSIDER_ID, "선택안", "현재 두 사람의 선택안"),
      ).rejects.toThrow(/AMORA_MEDIATION_PROPOSAL_CHANGED/);

      const staleRows = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.amora_mediation_acceptances WHERE message_id = $1",
        [AI_MESSAGE_ID],
      );
      expect(staleRows.rows[0]?.count).toBe(0);

      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"새 구성원이 함께 검토할 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const replacementAcceptance = await acceptMediation(
        db,
        OUTSIDER_ID,
        "새 선택안",
        "새 구성원이 함께 검토할 선택안",
      );

      expect(replacementAcceptance.rows[0]?.result).toMatchObject({
        accepted_count: 1,
        required_count: 2,
        completed: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("revokes every pending acceptance owned by the user after a proposal revision", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"철회 전 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "철회 전", "철회 전 선택안");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"철회 시점의 새 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      const currentRoster = await db.query<{ roster: string }>(
        "SELECT metadata #>> '{mediation,rosterFingerprint}' AS roster FROM public.chat_messages WHERE id = $1",
        [AI_MESSAGE_ID],
      );
      await db.query(
        `INSERT INTO public.amora_mediation_acceptances(
           couple_id, message_id, user_id, proposal_resolution,
           proposal_version, proposal_roster_fingerprint
         ) VALUES ($1, $2, $3, '철회 전 선택안', $4, $5)`,
        [
          COUPLE_ID,
          AI_MESSAGE_ID,
          BRIDE_ID,
          "00000000-0000-4000-8000-000000000099",
          currentRoster.rows[0]?.roster,
        ],
      );

      const revoked = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.revoke_amora_mediation_acceptance($1, $2, $3) AS result",
        [COUPLE_ID, AI_MESSAGE_ID, BRIDE_ID],
      );
      expect(revoked.rows[0]?.result).toMatchObject({
        revoked: true,
        accepted_count: 0,
        required_count: 2,
        completed: false,
      });
      const remaining = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.amora_mediation_acceptances
         WHERE message_id = $1 AND user_id = $2`,
        [AI_MESSAGE_ID, BRIDE_ID],
      );
      expect(remaining.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("lets one partner revoke a pending mediation acceptance but never a completed decision", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"함께 검토할 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );
      await acceptMediation(db, BRIDE_ID, "선택안", "함께 검토할 선택안");

      const revoked = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.revoke_amora_mediation_acceptance($1, $2, $3) AS result",
        [COUPLE_ID, AI_MESSAGE_ID, BRIDE_ID],
      );
      expect(revoked.rows[0]?.result).toMatchObject({
        revoked: true,
        accepted_count: 0,
        required_count: 2,
        completed: false,
      });

      await acceptMediation(db, BRIDE_ID, "선택안", "함께 검토할 선택안");
      await acceptMediation(db, GROOM_ID, "선택안", "함께 검토할 선택안");
      await expect(db.query(
        "SELECT public.revoke_amora_mediation_acceptance($1, $2, $3)",
        [COUPLE_ID, AI_MESSAGE_ID, BRIDE_ID],
      )).rejects.toThrow(/AMORA_MEDIATION_ALREADY_COMPLETED/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not turn a solo mediation click into a shared decision", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${mediationMigration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      await db.query(
        "UPDATE public.couples SET groom_id = NULL WHERE id = $1",
        [COUPLE_ID],
      );
      await db.query(
        `UPDATE public.chat_messages
         SET metadata = '{"mediation":{"resolution":"둘이 연결된 뒤 확인할 선택안"}}'::jsonb
         WHERE id = $1`,
        [AI_MESSAGE_ID],
      );

      await expect(
        acceptMediation(db, BRIDE_ID, "선택안", "둘이 연결된 뒤 확인할 선택안"),
      ).rejects.toThrow(/AMORA_MEDIATION_PARTNER_REQUIRED/);
      const decisions = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes WHERE category = 'conflict_resolution'",
      );
      expect(decisions.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
