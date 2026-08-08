// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802220000_amora_memory_enqueue_repair.sql",
);
const migrationSql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const recoveryMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802240000_amora_memory_job_recovery.sql",
);
const recoveryMigrationSql = existsSync(recoveryMigrationPath)
  ? readFileSync(recoveryMigrationPath, "utf8")
  : "";

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";

function messageId(index: number): string {
  return `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function requestKey(index: number): string {
  return `chat:${BRIDE_ID}:40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        current_user::text
      )
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      request_key text NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id),
      visibility text NOT NULL,
      status text NOT NULL,
      message_id uuid REFERENCES public.chat_messages(id),
      completed_at timestamptz,
      PRIMARY KEY (couple_id, request_key)
    );
    CREATE TABLE public.amora_memory_settings (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      visibility text NOT NULL,
      enabled boolean NOT NULL,
      memory_reset_at timestamptz,
      PRIMARY KEY (couple_id, visibility)
    );
    CREATE TABLE public.amora_memory_consents (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      visibility text NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id),
      PRIMARY KEY (couple_id, visibility, user_id)
    );
    CREATE TABLE public.amora_memory_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      user_id uuid REFERENCES auth.users(id),
      visibility text NOT NULL,
      to_message_id uuid NOT NULL REFERENCES public.chat_messages(id),
      status text NOT NULL DEFAULT 'pending',
      attempt_count integer NOT NULL DEFAULT 0,
      continuation_count integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      claimed_at timestamptz,
      completed_at timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (couple_id, visibility, to_message_id)
    );
    CREATE TABLE public.memory_enqueue_audit (
      to_message_id uuid NOT NULL,
      user_id uuid NOT NULL,
      visibility text NOT NULL
    );
    CREATE TABLE public.memory_enqueue_behavior (
      to_message_id uuid PRIMARY KEY,
      forced_result text NOT NULL
    );

    CREATE FUNCTION public.has_current_amora_memory_consent(
      p_couple_id uuid,
      p_visibility text
    ) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
      WITH roster AS (
        SELECT member.user_id, member.private_visibility
        FROM public.couples AS couple
        CROSS JOIN LATERAL (
          VALUES
            (couple.bride_id, 'bride_private'::text),
            (couple.groom_id, 'groom_private'::text)
        ) AS member(user_id, private_visibility)
        WHERE couple.id = p_couple_id
          AND member.user_id IS NOT NULL
          AND (p_visibility = 'shared' OR p_visibility = member.private_visibility)
      )
      SELECT p_visibility IN ('shared', 'bride_private', 'groom_private')
        AND EXISTS (SELECT 1 FROM roster)
        AND (p_visibility <> 'shared' OR (SELECT count(*) FROM roster) = 2)
        AND EXISTS (
          SELECT 1 FROM public.amora_memory_settings AS setting
          WHERE setting.couple_id = p_couple_id
            AND setting.visibility = p_visibility
            AND setting.enabled = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM roster AS member
          WHERE NOT EXISTS (
            SELECT 1 FROM public.amora_memory_consents AS consent
            WHERE consent.couple_id = p_couple_id
              AND consent.visibility = p_visibility
              AND consent.user_id = member.user_id
          )
        )
    $$;

    CREATE FUNCTION public.enqueue_amora_memory_job(
      p_couple_id uuid,
      p_user_id uuid,
      p_visibility text,
      p_to_message_id uuid
    ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE
      v_bride_id uuid;
      v_groom_id uuid;
      v_rows integer;
      v_forced_result text;
    BEGIN
      INSERT INTO public.memory_enqueue_audit(
        to_message_id, user_id, visibility
      ) VALUES (p_to_message_id, p_user_id, p_visibility);
      SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
      FROM public.couples WHERE id = p_couple_id;
      IF p_visibility NOT IN ('shared', 'bride_private', 'groom_private')
         OR (p_user_id IS DISTINCT FROM v_bride_id AND p_user_id IS DISTINCT FROM v_groom_id)
         OR (p_visibility = 'bride_private' AND p_user_id IS DISTINCT FROM v_bride_id)
         OR (p_visibility = 'groom_private' AND p_user_id IS DISTINCT FROM v_groom_id)
         OR NOT EXISTS (
           SELECT 1 FROM public.chat_messages AS message
           WHERE message.id = p_to_message_id
             AND message.couple_id = p_couple_id
             AND message.visibility = p_visibility
             AND message.sender_type = 'ai'
             AND message.role = 'assistant'
         ) THEN
        RAISE EXCEPTION 'AMORA_MEMORY_ENQUEUE_SCOPE_INVALID';
      END IF;
      IF NOT public.has_current_amora_memory_consent(p_couple_id, p_visibility) THEN
        RETURN 'disabled';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.chat_messages AS message
        JOIN public.amora_memory_settings AS setting
          ON setting.couple_id = message.couple_id
         AND setting.visibility = message.visibility
        WHERE message.id = p_to_message_id
          AND setting.enabled = true
          AND setting.memory_reset_at IS NOT NULL
          AND message.created_at > setting.memory_reset_at
      ) THEN
        RETURN 'before_boundary';
      END IF;
      SELECT behavior.forced_result INTO v_forced_result
      FROM public.memory_enqueue_behavior AS behavior
      WHERE behavior.to_message_id = p_to_message_id;
      IF FOUND THEN
        RETURN v_forced_result;
      END IF;
      INSERT INTO public.amora_memory_jobs(
        couple_id, user_id, visibility, to_message_id
      ) VALUES (p_couple_id, p_user_id, p_visibility, p_to_message_id)
      ON CONFLICT (couple_id, visibility, to_message_id) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RETURN CASE WHEN v_rows = 1 THEN 'queued' ELSE 'duplicate' END;
    END
    $$;

    GRANT USAGE ON SCHEMA public, auth TO service_role, authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO service_role, authenticated;
    GRANT EXECUTE ON FUNCTION public.has_current_amora_memory_consent(uuid, text)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.enqueue_amora_memory_job(uuid, uuid, text, uuid)
      TO service_role;

    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.amora_memory_settings(
      couple_id, visibility, enabled, memory_reset_at
    ) VALUES
      ('${COUPLE_ID}', 'shared', true, '2026-08-02T00:00:00Z'),
      ('${COUPLE_ID}', 'bride_private', true, '2026-08-02T00:00:00Z'),
      ('${COUPLE_ID}', 'groom_private', true, '2026-08-02T00:00:00Z');
    INSERT INTO public.amora_memory_consents(couple_id, visibility, user_id) VALUES
      ('${COUPLE_ID}', 'shared', '${BRIDE_ID}'),
      ('${COUPLE_ID}', 'shared', '${GROOM_ID}'),
      ('${COUPLE_ID}', 'bride_private', '${BRIDE_ID}'),
      ('${COUPLE_ID}', 'groom_private', '${GROOM_ID}');
  `);
  await db.exec(migrationSql);
  return db;
}

async function insertAssistant(
  db: PGlite,
  index: number,
  options: {
    scope?: string;
    memoryEligible?: unknown;
    visibility?: "shared" | "bride_private" | "groom_private";
    actorId?: string;
    createdAt?: string;
    claimStatus?: string;
    senderType?: string;
    role?: string;
    target?: string;
    metadataRequestKey?: string;
    memoryEnqueueRequested?: unknown;
  } = {},
) {
  const scope = options.scope ?? "W0_wedding_core";
  const visibility = options.visibility ?? "shared";
  const actorId = options.actorId ?? BRIDE_ID;
  const metadata = JSON.stringify({
    question_scope: scope,
    memory_eligible: options.memoryEligible ?? true,
    client_request_id: options.metadataRequestKey ?? requestKey(index),
    ...(options.memoryEnqueueRequested === undefined
      ? {}
      : { memory_enqueue_requested: options.memoryEnqueueRequested }),
    ...(options.target === undefined ? {} : { target: options.target }),
  });
  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content,
       metadata, visibility, created_at
     ) VALUES ($1, $2, NULL, $3, $4, 'SECRET-MUST-NOT-BE-LOGGED', $5, $6, $7)`,
    [
      messageId(index),
      COUPLE_ID,
      options.senderType ?? "ai",
      options.role ?? "assistant",
      metadata,
      visibility,
      options.createdAt ?? `2026-08-02T00:${String(index).padStart(2, "0")}:00Z`,
    ],
  );
  await db.query(
    `INSERT INTO public.amora_chat_request_claims(
       couple_id, request_key, user_id, visibility, status, message_id,
       completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6,
       CASE WHEN $5 = 'completed' THEN now() ELSE NULL END)`,
    [
      COUPLE_ID,
      requestKey(index),
      actorId,
      visibility,
      options.claimStatus ?? "completed",
      messageId(index),
    ],
  );
}

type RepairResult = {
  scanned: number;
  queued: number;
  duplicate: number;
  skipped: number;
  failed: number;
};

async function repair(db: PGlite, limit: number): Promise<RepairResult> {
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  const result = await db.query<{ result: RepairResult }>(
    "SELECT public.repair_missing_amora_memory_jobs($1)::jsonb AS result",
    [limit],
  );
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false)",
  );
  await db.exec("RESET ROLE");
  const value = result.rows[0]?.result;
  if (!value) throw new Error("missing repair result");
  return value;
}

async function hasRepairCandidate(
  db: PGlite,
  input: {
    userId?: string;
    visibility?: "shared" | "bride_private" | "groom_private";
    toMessageId: string;
  },
): Promise<boolean> {
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  const result = await db.query<{ confirmed: boolean }>(
    `SELECT public.has_amora_memory_enqueue_repair_candidate(
       $1, $2, $3, $4
     ) AS confirmed`,
    [
      COUPLE_ID,
      input.userId ?? BRIDE_ID,
      input.visibility ?? "shared",
      input.toMessageId,
    ],
  );
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false)",
  );
  await db.exec("RESET ROLE");
  return result.rows[0]?.confirmed === true;
}

async function enqueue(
  db: PGlite,
  input: {
    userId?: string;
    visibility?: "shared" | "bride_private" | "groom_private";
    toMessageId: string;
  },
): Promise<string> {
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  const result = await db.query<{ result: string }>(
    `SELECT public.enqueue_amora_memory_job($1, $2, $3, $4) AS result`,
    [
      COUPLE_ID,
      input.userId ?? BRIDE_ID,
      input.visibility ?? "shared",
      input.toMessageId,
    ],
  );
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false)",
  );
  await db.exec("RESET ROLE");
  const value = result.rows[0]?.result;
  if (!value) throw new Error("missing enqueue result");
  return value;
}

async function hasActiveJob(
  db: PGlite,
  input: {
    userId?: string;
    visibility?: "shared" | "bride_private" | "groom_private";
    toMessageId: string;
  },
): Promise<boolean> {
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
  );
  const result = await db.query<{ confirmed: boolean }>(
    `SELECT public.has_active_amora_memory_job($1, $2, $3, $4)
       AS confirmed`,
    [
      COUPLE_ID,
      input.userId ?? BRIDE_ID,
      input.visibility ?? "shared",
      input.toMessageId,
    ],
  );
  await db.query(
    "SELECT set_config('request.jwt.claim.role', '', false)",
  );
  await db.exec("RESET ROLE");
  return result.rows[0]?.confirmed === true;
}

describe("Amora memory enqueue repair migration", () => {
  it("uses an ID-only atomic outbox and a bounded service-only SKIP LOCKED drain", () => {
    expect(migrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(migrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.repair_missing_amora_memory_jobs",
    );
    expect(migrationSql).toContain(
      "CREATE TABLE public.amora_memory_enqueue_repair_candidates",
    );
    expect(migrationSql).toContain("capture_amora_memory_enqueue_repair_candidate");
    expect(migrationSql).toContain("acknowledge_amora_memory_enqueue_repair_candidate");
    expect(migrationSql).toContain("FOR UPDATE NOWAIT");
    expect(migrationSql).toContain("EXCEPTION WHEN lock_not_available THEN");
    expect(migrationSql).toContain("public.enqueue_amora_memory_job(");
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.has_amora_memory_enqueue_repair_candidate",
    );
    expect(migrationSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(migrationSql).toContain("ORDER BY repair.created_at");
    expect(migrationSql).toContain("LIMIT p_limit");
    expect(migrationSql).toContain("TO service_role");
    expect(migrationSql).toContain("FROM PUBLIC, anon, authenticated");
    expect(migrationSql).not.toMatch(/message\.content|SELECT[^;]*\bcontent\b/i);
    expect(migrationSql).not.toContain("amora_memory_repair_candidate_idx");
    expect(migrationSql).not.toMatch(/ALTER TABLE public\.(?:decision_nodes|ai_interactions_log)/i);
  });

  it("captures only exact W0/W1 rows transactionally and drains the outbox oldest-first", async () => {
    const db = await createDatabase();
    try {
      await insertAssistant(db, 1, { scope: "W0_wedding_core" });
      await insertAssistant(db, 2, {
        scope: "W1_wedding_adjacent",
        visibility: "bride_private",
      });
      await insertAssistant(db, 3, { scope: "W2_high_risk_adjacent" });
      await insertAssistant(db, 4, { scope: "W3_social_care" });
      await insertAssistant(db, 5, { scope: "W4_out_of_scope" });
      await insertAssistant(db, 6, { scope: "W5_safety_override" });
      await insertAssistant(db, 7, { memoryEligible: "true" });
      await insertAssistant(db, 8, { memoryEligible: false });
      await insertAssistant(db, 15, {
        metadataRequestKey: "chat:mismatched-request-key",
      });
      await insertAssistant(db, 16, { target: "partner" });

      const captured = await db.query<{ to_message_id: string }>(
        `SELECT to_message_id::text
           FROM public.amora_memory_enqueue_repair_candidates
          ORDER BY created_at, to_message_id`,
      );
      expect(captured.rows.map((row) => row.to_message_id)).toEqual([
        messageId(1),
        messageId(2),
      ]);

      // The request path normally enqueues immediately after the atomic chat
      // commit and the acknowledgement trigger removes its candidate. Disable
      // that trigger here to model its deliberate NOWAIT lock miss: the cron
      // must later drain the retained candidate as an idempotent duplicate.
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs DISABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id
         ) VALUES ($1, $2, 'shared', $3)`,
        [COUPLE_ID, BRIDE_ID, messageId(1)],
      );
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs ENABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );

      expect(await repair(db, 1)).toMatchObject({
        scanned: 1,
        duplicate: 1,
        failed: 0,
      });
      expect(await repair(db, 1)).toMatchObject({
        scanned: 1,
        queued: 1,
        failed: 0,
      });
      expect(await repair(db, 10)).toEqual({
        scanned: 0,
        queued: 0,
        duplicate: 0,
        skipped: 0,
        failed: 0,
      });

      const jobs = await db.query<{ to_message_id: string }>(
        "SELECT to_message_id::text FROM public.amora_memory_jobs ORDER BY to_message_id",
      );
      expect(jobs.rows.map((row) => row.to_message_id)).toEqual([
        messageId(1),
        messageId(2),
      ]);
      const calls = await db.query<{ to_message_id: string }>(
        "SELECT to_message_id::text FROM public.memory_enqueue_audit ORDER BY to_message_id",
      );
      expect(calls.rows.map((row) => row.to_message_id)).toEqual([
        messageId(1),
        messageId(2),
      ]);
    } finally {
      await db.close();
    }
  });

  it("creates and rolls back the repair candidate in the same claim-completion transaction", async () => {
    const db = await createDatabase();
    try {
      await insertAssistant(db, 18, { claimStatus: "processing" });
      await db.exec("BEGIN");
      await db.query(
        `UPDATE public.amora_chat_request_claims
            SET status = 'completed', completed_at = now()
          WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ID, requestKey(18)],
      );
      const inside = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates`,
      );
      expect(inside.rows[0]?.count).toBe(1);
      await db.exec("ROLLBACK");

      const rolledBack = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates`,
      );
      expect(rolledBack.rows[0]?.count).toBe(0);

      await db.query(
        `UPDATE public.amora_chat_request_claims
            SET status = 'completed', completed_at = now()
          WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ID, requestKey(18)],
      );
      const committed = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates`,
      );
      expect(committed.rows[0]?.count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("confirms only the exact durable candidate, completed claim, and eligible AI message binding", async () => {
    const db = await createDatabase();
    try {
      await insertAssistant(db, 22);
      await insertAssistant(db, 23, { scope: "W2_high_risk_adjacent" });

      await expect(hasRepairCandidate(db, {
        toMessageId: messageId(22),
      })).resolves.toBe(true);
      await expect(hasRepairCandidate(db, {
        userId: GROOM_ID,
        toMessageId: messageId(22),
      })).resolves.toBe(false);
      await expect(hasRepairCandidate(db, {
        visibility: "bride_private",
        toMessageId: messageId(22),
      })).resolves.toBe(false);
      await expect(hasRepairCandidate(db, {
        toMessageId: messageId(23),
      })).resolves.toBe(false);

      await db.query(
        `UPDATE public.amora_chat_request_claims
            SET status = 'failed'
          WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ID, requestKey(22)],
      );
      await expect(hasRepairCandidate(db, {
        toMessageId: messageId(22),
      })).resolves.toBe(false);
    } finally {
      await db.close();
    }
  });

  it("nonblocking-acknowledges a normal immediate job and suppresses legacy preexisting jobs", async () => {
    const db = await createDatabase();
    try {
      await insertAssistant(db, 20);
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id
         ) VALUES ($1, $2, 'shared', $3)`,
        [COUPLE_ID, BRIDE_ID, messageId(20)],
      );
      const acknowledged = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates`,
      );
      expect(acknowledged.rows[0]?.count).toBe(0);
      await expect(hasRepairCandidate(db, {
        toMessageId: messageId(20),
      })).resolves.toBe(true);

      await db.query(
        `INSERT INTO public.chat_messages(
           id, couple_id, sender_id, sender_type, role, content,
           metadata, visibility, created_at
         ) VALUES (
           $1, $2, NULL, 'ai', 'assistant', 'not selected by repair',
           $3, 'shared', '2026-08-02T00:21:00Z'
         )`,
        [
          messageId(21),
          COUPLE_ID,
          JSON.stringify({
            question_scope: "W0_wedding_core",
            memory_eligible: true,
            client_request_id: requestKey(21),
          }),
        ],
      );
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id
         ) VALUES ($1, $2, 'shared', $3)`,
        [COUPLE_ID, BRIDE_ID, messageId(21)],
      );
      await db.query(
        `INSERT INTO public.amora_chat_request_claims(
           couple_id, request_key, user_id, visibility, status, message_id,
           completed_at
         ) VALUES ($1, $2, $3, 'shared', 'completed', $4, now())`,
        [COUPLE_ID, requestKey(21), BRIDE_ID, messageId(21)],
      );
      const suppressed = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates`,
      );
      expect(suppressed.rows[0]?.count).toBe(0);
      await expect(hasRepairCandidate(db, {
        toMessageId: messageId(21),
      })).resolves.toBe(true);
    } finally {
      await db.close();
    }
  });

  it("preserves an unknown enqueue result with backoff instead of guessing it is terminal", async () => {
    const db = await createDatabase();
    try {
      await insertAssistant(db, 19);
      await db.query(
        `INSERT INTO public.memory_enqueue_behavior(to_message_id, forced_result)
         VALUES ($1, 'future_status')`,
        [messageId(19)],
      );

      expect(await repair(db, 20)).toEqual({
        scanned: 1,
        queued: 0,
        duplicate: 0,
        skipped: 0,
        failed: 1,
      });
      const retained = await db.query<{
        attempt_count: number;
        last_error_code: string;
        delayed: boolean;
      }>(
        `SELECT attempt_count, last_error_code, available_at > now() AS delayed
           FROM public.amora_memory_enqueue_repair_candidates
          WHERE to_message_id = $1`,
        [messageId(19)],
      );
      expect(retained.rows[0]).toEqual({
        attempt_count: 1,
        last_error_code: "ENQUEUE_UNKNOWN_RESULT",
        delayed: true,
      });
    } finally {
      await db.close();
    }
  });

  it("revalidates privacy/source state, drains terminal skips, and preserves failures with backoff", async () => {
    const db = await createDatabase();
    try {
      await insertAssistant(db, 9, { actorId: OUTSIDER_ID });
      await insertAssistant(db, 10, { claimStatus: "failed" });
      await insertAssistant(db, 11, { senderType: "bride", role: "user" });
      await insertAssistant(db, 12, {
        createdAt: "2026-08-02T00:00:00Z",
      });
      await insertAssistant(db, 13, {
        visibility: "groom_private",
        actorId: BRIDE_ID,
      });
      await db.query(
        `DELETE FROM public.amora_memory_consents
          WHERE couple_id = $1 AND visibility = 'bride_private'`,
        [COUPLE_ID],
      );
      await insertAssistant(db, 14, { visibility: "bride_private" });
      await insertAssistant(db, 17);
      await db.query(
        `UPDATE public.amora_chat_request_claims
            SET status = 'failed'
          WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ID, requestKey(17)],
      );

      expect(await repair(db, 20)).toEqual({
        scanned: 5,
        queued: 0,
        duplicate: 0,
        skipped: 2,
        failed: 3,
      });
      const calls = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.memory_enqueue_audit",
      );
      expect(calls.rows[0]?.count).toBe(2);

      const retained = await db.query<{
        to_message_id: string;
        attempt_count: number;
        last_error_code: string;
        delayed: boolean;
      }>(
        `SELECT
           to_message_id::text,
           attempt_count,
           last_error_code,
           available_at > now() AS delayed
         FROM public.amora_memory_enqueue_repair_candidates
         ORDER BY to_message_id`,
      );
      expect(retained.rows).toEqual([
        {
          to_message_id: messageId(9),
          attempt_count: 1,
          last_error_code: "ENQUEUE_EXCEPTION",
          delayed: true,
        },
        {
          to_message_id: messageId(13),
          attempt_count: 1,
          last_error_code: "ENQUEUE_EXCEPTION",
          delayed: true,
        },
        {
          to_message_id: messageId(17),
          attempt_count: 1,
          last_error_code: "SOURCE_REVALIDATION_FAILED",
          delayed: true,
        },
      ]);
      expect(await repair(db, 20)).toEqual({
        scanned: 0,
        queued: 0,
        duplicate: 0,
        skipped: 0,
        failed: 0,
      });
    } finally {
      await db.close();
    }
  });

  it("rejects callers outside service_role and invalid unbounded limits", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE authenticated");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
      );
      await expect(db.query(
        "SELECT public.repair_missing_amora_memory_jobs(20)",
      )).rejects.toThrow();
      await expect(db.query(
        `SELECT public.has_amora_memory_enqueue_repair_candidate(
          '${COUPLE_ID}', '${BRIDE_ID}', 'shared', '${messageId(1)}'
        )`,
      )).rejects.toThrow();
      await db.query(
        "SELECT set_config('request.jwt.claim.role', '', false)",
      );
      await db.exec("RESET ROLE");
      await db.exec("SET ROLE service_role");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
      );
      await expect(db.query(
        "SELECT public.repair_missing_amora_memory_jobs(101)",
      )).rejects.toThrow(/AMORA_MEMORY_REPAIR_LIMIT_INVALID/);
      await db.query(
        "SELECT set_config('request.jwt.claim.role', '', false)",
      );
      await db.exec("RESET ROLE");
    } finally {
      await db.close();
    }
  });
});

describe("Amora terminal memory job recovery migration", () => {
  it("replaces duplicate guessing with a service-only active-job proof and bounded recovery drain", () => {
    expect(recoveryMigrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(recoveryMigrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(recoveryMigrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.has_active_amora_memory_job",
    );
    expect(recoveryMigrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.enqueue_amora_memory_job",
    );
    expect(recoveryMigrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.repair_missing_amora_memory_jobs",
    );
    expect(recoveryMigrationSql).toContain("FOR KEY SHARE OF claim, message");
    expect(recoveryMigrationSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(recoveryMigrationSql).toContain("'DUPLICATE_NOT_ACTIVE'");
    expect(recoveryMigrationSql).toContain("memory_enqueue_requested");
    expect(recoveryMigrationSql).not.toMatch(/message\.content|SELECT[^;]*\bcontent\b/i);
  });

  it("captures only durable runtime-and-consent enqueue intent and never backfills an off turn", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 39, { memoryEnqueueRequested: false });
      await insertAssistant(db, 40);
      await insertAssistant(db, 41, { memoryEnqueueRequested: true });
      await insertAssistant(db, 49, { memoryEnqueueRequested: "true" });
      await insertAssistant(db, 50, {
        scope: "W2_high_risk_adjacent",
        memoryEnqueueRequested: true,
      });

      const candidates = await db.query<{ to_message_id: string }>(
        `SELECT to_message_id::text
           FROM public.amora_memory_enqueue_repair_candidates
          ORDER BY to_message_id`,
      );
      expect(candidates.rows.map((row) => row.to_message_id)).toEqual([
        messageId(41),
      ]);
      await expect(enqueue(db, { toMessageId: messageId(39) }))
        .resolves.toBe("not_requested");
      await expect(enqueue(db, { toMessageId: messageId(40) }))
        .resolves.toBe("not_requested");
      await expect(enqueue(db, { toMessageId: messageId(49) }))
        .resolves.toBe("not_requested");
      await expect(enqueue(db, { toMessageId: messageId(41) }))
        .resolves.toBe("queued");
    } finally {
      await db.close();
    }
  });

  it("drains pre-migration flag-off backlog but preserves a legacy candidate backed by a job", async () => {
    const db = await createDatabase();
    try {
      // 22000 captured both rows before durable runtime intent existed.
      await insertAssistant(db, 46);
      await insertAssistant(db, 47);
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs DISABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status
         ) VALUES ($1, $2, 'shared', $3, 'pending')`,
        [COUPLE_ID, BRIDE_ID, messageId(47)],
      );
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs ENABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );

      await db.exec(recoveryMigrationSql);

      const candidates = await db.query<{ to_message_id: string }>(
        `SELECT to_message_id::text
           FROM public.amora_memory_enqueue_repair_candidates
          ORDER BY to_message_id`,
      );
      expect(candidates.rows.map((row) => row.to_message_id)).toEqual([
        messageId(47),
      ]);
      const deadLetter = await db.query<{
        to_message_id: string;
        terminal_reason_code: string;
      }>(
        `SELECT to_message_id::text, terminal_reason_code
           FROM public.amora_memory_enqueue_repair_dead_letters`,
      );
      expect(deadLetter.rows).toEqual([{
        to_message_id: messageId(46),
        terminal_reason_code: "ENQUEUE_INTENT_UNCONFIRMED",
      }]);

      await expect(repair(db, 1)).resolves.toMatchObject({
        scanned: 1,
        duplicate: 1,
        failed: 0,
      });
    } finally {
      await db.close();
    }
  });

  it("dead-letters irreversible source and roster poison candidates with ID-only audit", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 42, { memoryEnqueueRequested: true });
      await db.query(
        `UPDATE public.chat_messages
            SET metadata = jsonb_set(metadata, '{memory_eligible}', 'false')
          WHERE id = $1`,
        [messageId(42)],
      );
      await expect(repair(db, 1)).resolves.toMatchObject({
        scanned: 1,
        failed: 1,
      });

      await insertAssistant(db, 43, { memoryEnqueueRequested: true });
      await db.query(
        `UPDATE public.couples SET bride_id = $2 WHERE id = $1`,
        [COUPLE_ID, OUTSIDER_ID],
      );
      await expect(repair(db, 1)).resolves.toMatchObject({
        scanned: 1,
        failed: 1,
      });

      const candidates = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates
          WHERE to_message_id IN ($1, $2)`,
        [messageId(42), messageId(43)],
      );
      expect(candidates.rows[0]?.count).toBe(0);
      const deadLetters = await db.query<{
        to_message_id: string;
        terminal_reason_code: string;
      }>(
        `SELECT to_message_id::text, terminal_reason_code
           FROM public.amora_memory_enqueue_repair_dead_letters
          WHERE to_message_id IN ($1, $2)
          ORDER BY to_message_id`,
        [messageId(42), messageId(43)],
      );
      expect(deadLetters.rows).toEqual([
        {
          to_message_id: messageId(42),
          terminal_reason_code: "SOURCE_REVALIDATION_FAILED",
        },
        {
          to_message_id: messageId(43),
          terminal_reason_code: "SCOPE_REVALIDATION_FAILED",
        },
      ]);
      const columns = await db.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'amora_memory_enqueue_repair_dead_letters'`,
      );
      expect(columns.rows.map((row) => row.column_name)).not.toContain("content");
    } finally {
      await db.close();
    }
  });

  it("preserves the source-invalid reason when a poison candidate has a failed legacy job", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 48, { memoryEnqueueRequested: true });
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs DISABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status,
           attempt_count, continuation_count, completed_at,
           last_error_code
         ) VALUES (
           $1, $2, 'shared', $3, 'failed', 5, 4, now(),
           'LEASE_EXHAUSTED'
         )`,
        [COUPLE_ID, BRIDE_ID, messageId(48)],
      );
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs ENABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );
      await db.query(
        `UPDATE public.chat_messages
            SET metadata = jsonb_set(metadata, '{memory_eligible}', 'false')
          WHERE id = $1`,
        [messageId(48)],
      );

      await expect(repair(db, 1)).resolves.toMatchObject({
        scanned: 1,
        failed: 1,
      });
      const deadLetter = await db.query<{ terminal_reason_code: string }>(
        `SELECT terminal_reason_code
           FROM public.amora_memory_enqueue_repair_dead_letters
          WHERE to_message_id = $1`,
        [messageId(48)],
      );
      expect(deadLetter.rows[0]).toEqual({
        terminal_reason_code: "SOURCE_REVALIDATION_FAILED",
      });
    } finally {
      await db.close();
    }
  });

  it("requeues one exact failed legacy job with clean worker state and stays idempotent", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 31);
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status,
           attempt_count, continuation_count, available_at, claimed_at,
           completed_at, last_error_code
         ) VALUES (
           $1, $2, 'shared', $3, 'failed', 5, 4,
           '2026-08-03T00:00:00Z', '2026-08-02T00:31:30Z',
           '2026-08-02T00:32:00Z', 'LEASE_EXHAUSTED'
         )`,
        [COUPLE_ID, BRIDE_ID, messageId(31)],
      );

      await expect(enqueue(db, { toMessageId: messageId(31) }))
        .resolves.toBe("requeued");
      const recovered = await db.query<{
        status: string;
        attempt_count: number;
        continuation_count: number;
        available: boolean;
        claimed_at: string | null;
        completed_at: string | null;
        last_error_code: string | null;
      }>(
        `SELECT status, attempt_count, continuation_count,
                available_at <= now() AS available,
                claimed_at::text, completed_at::text, last_error_code
           FROM public.amora_memory_jobs
          WHERE couple_id = $1 AND visibility = 'shared'
            AND to_message_id = $2`,
        [COUPLE_ID, messageId(31)],
      );
      expect(recovered.rows[0]).toEqual({
        status: "pending",
        attempt_count: 0,
        continuation_count: 0,
        available: true,
        claimed_at: null,
        completed_at: null,
        last_error_code: null,
      });

      await expect(enqueue(db, { toMessageId: messageId(31) }))
        .resolves.toBe("duplicate");
      await expect(hasActiveJob(db, { toMessageId: messageId(31) }))
        .resolves.toBe(true);
    } finally {
      await db.close();
    }
  });

  it("never revives a failed job after current consent is withdrawn or its source crosses reset", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 32);
      await insertAssistant(db, 33);
      for (const index of [32, 33]) {
        await db.query(
          `INSERT INTO public.amora_memory_jobs(
             couple_id, user_id, visibility, to_message_id, status,
             attempt_count, continuation_count, completed_at,
             last_error_code
           ) VALUES (
             $1, $2, 'shared', $3, 'failed', 5, 4, now(),
             'LEASE_EXHAUSTED'
           )`,
          [COUPLE_ID, BRIDE_ID, messageId(index)],
        );
      }

      await db.query(
        `UPDATE public.amora_memory_settings
            SET enabled = false
          WHERE couple_id = $1 AND visibility = 'shared'`,
        [COUPLE_ID],
      );
      await expect(enqueue(db, { toMessageId: messageId(32) }))
        .resolves.toBe("disabled");

      await db.query(
        `UPDATE public.amora_memory_settings
            SET enabled = true,
                memory_reset_at = '2026-08-02T00:34:00Z'
          WHERE couple_id = $1 AND visibility = 'shared'`,
        [COUPLE_ID],
      );
      await expect(enqueue(db, { toMessageId: messageId(33) }))
        .resolves.toBe("before_boundary");

      const terminal = await db.query<{
        to_message_id: string;
        status: string;
        attempt_count: number;
        continuation_count: number;
        last_error_code: string;
      }>(
        `SELECT to_message_id::text, status, attempt_count,
                continuation_count, last_error_code
           FROM public.amora_memory_jobs
          WHERE to_message_id IN ($1, $2)
          ORDER BY to_message_id`,
        [messageId(32), messageId(33)],
      );
      expect(terminal.rows).toEqual([
        {
          to_message_id: messageId(32),
          status: "failed",
          attempt_count: 5,
          continuation_count: 4,
          last_error_code: "LEASE_EXHAUSTED",
        },
        {
          to_message_id: messageId(33),
          status: "failed",
          attempt_count: 5,
          continuation_count: 4,
          last_error_code: "LEASE_EXHAUSTED",
        },
      ]);
    } finally {
      await db.close();
    }
  });

  it("dead-letters a failed row whose exact completed AI source no longer validates", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 34);
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status,
           attempt_count, continuation_count, claimed_at, completed_at,
           last_error_code
         ) VALUES (
           $1, $2, 'shared', $3, 'failed', 5, 4, now(), now(),
           'LEASE_EXHAUSTED'
         )`,
        [COUPLE_ID, BRIDE_ID, messageId(34)],
      );
      await db.query(
        `UPDATE public.chat_messages
            SET metadata = jsonb_set(metadata, '{memory_eligible}', 'false')
          WHERE id = $1`,
        [messageId(34)],
      );

      await expect(enqueue(db, { toMessageId: messageId(34) }))
        .resolves.toBe("dead_letter");
      const deadLetter = await db.query<{
        status: string;
        attempt_count: number;
        continuation_count: number;
        claimed_at: string | null;
        last_error_code: string;
      }>(
        `SELECT status, attempt_count, continuation_count,
                claimed_at::text, last_error_code
           FROM public.amora_memory_jobs
          WHERE to_message_id = $1`,
        [messageId(34)],
      );
      expect(deadLetter.rows[0]).toEqual({
        status: "failed",
        attempt_count: 5,
        continuation_count: 4,
        claimed_at: null,
        last_error_code: "SOURCE_REVALIDATION_FAILED",
      });
      await expect(hasActiveJob(db, { toMessageId: messageId(34) }))
        .resolves.toBe(false);
    } finally {
      await db.close();
    }
  });

  it("keeps cancelled jobs terminal and rejects a stale or wrong private actor", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 35);
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status,
           attempt_count, continuation_count, completed_at
         ) VALUES (
           $1, $2, 'shared', $3, 'cancelled', 2, 1, now()
         )`,
        [COUPLE_ID, BRIDE_ID, messageId(35)],
      );

      await expect(enqueue(db, { toMessageId: messageId(35) }))
        .resolves.toBe("dead_letter");
      const cancelled = await db.query<{
        status: string;
        attempt_count: number;
        continuation_count: number;
        last_error_code: string;
      }>(
        `SELECT status, attempt_count, continuation_count, last_error_code
           FROM public.amora_memory_jobs
          WHERE to_message_id = $1`,
        [messageId(35)],
      );
      expect(cancelled.rows[0]).toEqual({
        status: "cancelled",
        attempt_count: 2,
        continuation_count: 1,
        last_error_code: "CANCELLED_TERMINAL",
      });

      await expect(enqueue(db, {
        userId: GROOM_ID,
        visibility: "bride_private",
        toMessageId: messageId(35),
      })).rejects.toThrow(/AMORA_MEMORY_ENQUEUE_SCOPE_INVALID/);

      await db.query(
        `UPDATE public.couples SET bride_id = $2 WHERE id = $1`,
        [COUPLE_ID, OUTSIDER_ID],
      );
      await expect(enqueue(db, { toMessageId: messageId(35) }))
        .rejects.toThrow(/AMORA_MEMORY_ENQUEUE_SCOPE_INVALID/);
    } finally {
      await db.close();
    }
  });

  it("lets the bounded repair drain atomically requeue an exact failed job", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 36, { memoryEnqueueRequested: true });
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs DISABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status,
           attempt_count, continuation_count, completed_at,
           last_error_code
         ) VALUES (
           $1, $2, 'shared', $3, 'failed', 5, 4, now(),
           'LEASE_EXHAUSTED'
         )`,
        [COUPLE_ID, BRIDE_ID, messageId(36)],
      );
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs ENABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );

      await expect(repair(db, 1)).resolves.toEqual({
        scanned: 1,
        queued: 1,
        duplicate: 0,
        skipped: 0,
        failed: 0,
      });
      const recovered = await db.query<{
        status: string;
        attempt_count: number;
        continuation_count: number;
        claimed_at: string | null;
        completed_at: string | null;
        last_error_code: string | null;
      }>(
        `SELECT status, attempt_count, continuation_count,
                claimed_at::text, completed_at::text, last_error_code
           FROM public.amora_memory_jobs
          WHERE to_message_id = $1`,
        [messageId(36)],
      );
      expect(recovered.rows[0]).toEqual({
        status: "pending",
        attempt_count: 0,
        continuation_count: 0,
        claimed_at: null,
        completed_at: null,
        last_error_code: null,
      });
      const candidates = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates
          WHERE to_message_id = $1`,
        [messageId(36)],
      );
      expect(candidates.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("dead-letters a candidate when duplicate has no exact active job proof", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 37, { memoryEnqueueRequested: true });
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs DISABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status,
           attempt_count, continuation_count, completed_at,
           last_error_code
         ) VALUES (
           $1, $2, 'shared', $3, 'failed', 5, 4, now(),
           'LEASE_EXHAUSTED'
         )`,
        [COUPLE_ID, BRIDE_ID, messageId(37)],
      );
      await db.exec(
        "ALTER TABLE public.amora_memory_jobs ENABLE TRIGGER "
          + "trg_acknowledge_amora_memory_enqueue_repair_candidate",
      );
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.enqueue_amora_memory_job(
          p_couple_id uuid,
          p_user_id uuid,
          p_visibility text,
          p_to_message_id uuid
        ) RETURNS text LANGUAGE sql SECURITY DEFINER
        SET search_path = pg_catalog, public AS $$
          SELECT 'duplicate'::text
        $$;
      `);

      await expect(repair(db, 1)).resolves.toEqual({
        scanned: 1,
        queued: 0,
        duplicate: 0,
        skipped: 0,
        failed: 1,
      });
      const retained = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates
          WHERE to_message_id = $1`,
        [messageId(37)],
      );
      expect(retained.rows[0]?.count).toBe(0);
      const deadLetter = await db.query<{ terminal_reason_code: string }>(
        `SELECT terminal_reason_code
           FROM public.amora_memory_enqueue_repair_dead_letters
          WHERE to_message_id = $1`,
        [messageId(37)],
      );
      expect(deadLetter.rows[0]).toEqual({
        terminal_reason_code: "DUPLICATE_NOT_ACTIVE",
      });
    } finally {
      await db.close();
    }
  });

  it("retries only transient lock failures with bounded backoff", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 44, { memoryEnqueueRequested: true });
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.enqueue_amora_memory_job(
          p_couple_id uuid,
          p_user_id uuid,
          p_visibility text,
          p_to_message_id uuid
        ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, public AS $$
        BEGIN
          RAISE EXCEPTION 'simulated lock timeout' USING ERRCODE = '55P03';
        END
        $$;
      `);

      await expect(repair(db, 1)).resolves.toMatchObject({
        scanned: 1,
        failed: 1,
      });
      const candidate = await db.query<{
        attempt_count: number;
        last_error_code: string;
        delayed: boolean;
      }>(
        `SELECT attempt_count, last_error_code,
                available_at > now() AS delayed
           FROM public.amora_memory_enqueue_repair_candidates
          WHERE to_message_id = $1`,
        [messageId(44)],
      );
      expect(candidate.rows[0]).toEqual({
        attempt_count: 1,
        last_error_code: "ENQUEUE_LOCK_RETRY",
        delayed: true,
      });
      const deadLetter = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_dead_letters
          WHERE to_message_id = $1`,
        [messageId(44)],
      );
      expect(deadLetter.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("terminally audits an unexpected permanent enqueue error instead of poisoning the outbox", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 45, { memoryEnqueueRequested: true });
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.enqueue_amora_memory_job(
          p_couple_id uuid,
          p_user_id uuid,
          p_visibility text,
          p_to_message_id uuid
        ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, public AS $$
        BEGIN
          RAISE EXCEPTION 'simulated permanent constraint'
            USING ERRCODE = '23514';
        END
        $$;
      `);

      await expect(repair(db, 1)).resolves.toMatchObject({
        scanned: 1,
        failed: 1,
      });
      const candidate = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM public.amora_memory_enqueue_repair_candidates
          WHERE to_message_id = $1`,
        [messageId(45)],
      );
      expect(candidate.rows[0]?.count).toBe(0);
      const deadLetter = await db.query<{ terminal_reason_code: string }>(
        `SELECT terminal_reason_code
           FROM public.amora_memory_enqueue_repair_dead_letters
          WHERE to_message_id = $1`,
        [messageId(45)],
      );
      expect(deadLetter.rows[0]).toEqual({
        terminal_reason_code: "ENQUEUE_PERMANENT_ERROR",
      });
    } finally {
      await db.close();
    }
  });

  it("proves only an exact structurally active or completed job to service role", async () => {
    const db = await createDatabase();
    try {
      await db.exec(recoveryMigrationSql);
      await insertAssistant(db, 38);
      await db.query(
        `INSERT INTO public.amora_memory_jobs(
           couple_id, user_id, visibility, to_message_id, status,
           attempt_count, continuation_count, completed_at
         ) VALUES (
           $1, $2, 'shared', $3, 'completed', 1, 0, now()
         )`,
        [COUPLE_ID, BRIDE_ID, messageId(38)],
      );

      await expect(hasActiveJob(db, { toMessageId: messageId(38) }))
        .resolves.toBe(true);
      await expect(hasActiveJob(db, {
        userId: GROOM_ID,
        toMessageId: messageId(38),
      })).resolves.toBe(false);

      await db.query(
        `UPDATE public.amora_memory_jobs
            SET status = 'processing', claimed_at = NULL,
                completed_at = NULL, attempt_count = 1
          WHERE to_message_id = $1`,
        [messageId(38)],
      );
      await expect(hasActiveJob(db, { toMessageId: messageId(38) }))
        .resolves.toBe(false);

      await db.exec("SET ROLE authenticated");
      await db.query(
        "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
      );
      await expect(db.query(
        `SELECT public.has_active_amora_memory_job($1, $2, 'shared', $3)`,
        [COUPLE_ID, BRIDE_ID, messageId(38)],
      )).rejects.toThrow();
      await db.query(
        "SELECT set_config('request.jwt.claim.role', '', false)",
      );
      await db.exec("RESET ROLE");
    } finally {
      await db.close();
    }
  });
});
