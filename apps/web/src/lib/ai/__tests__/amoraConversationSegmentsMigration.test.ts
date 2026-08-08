// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260801100000_amora_conversation_segments.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const FIRST_OPERATION_ID = "30000000-0000-4000-8000-000000000001";
const SECOND_OPERATION_ID = "30000000-0000-4000-8000-000000000002";

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
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
      role text
    );
    CREATE FUNCTION public.can_access_couple_visibility(
      p_couple_id uuid,
      p_visibility text
    )
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT p_visibility IN ('shared', 'bride_private', 'groom_private')
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS profile
            JOIN public.couples AS couple ON couple.id = profile.couple_id
           WHERE profile.id = auth.uid()
             AND profile.couple_id = p_couple_id
             AND (
               (
                 profile.role = 'bride'
                 AND couple.bride_id = profile.id
                 AND p_visibility IN ('shared', 'bride_private')
               )
               OR (
                 profile.role = 'groom'
                 AND couple.groom_id = profile.id
                 AND p_visibility IN ('shared', 'groom_private')
               )
             )
        )
    $$;
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL DEFAULT 'shared',
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL DEFAULT 'shared',
      summary text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE
    );
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY chat_messages_insert_existing_client
      ON public.chat_messages FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.couples AS couple
          WHERE couple.id = chat_messages.couple_id
            AND auth.uid() IN (couple.bride_id, couple.groom_id)
        )
      );
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.can_access_couple_visibility(uuid, text)
      TO authenticated, service_role;
    GRANT SELECT ON public.couples TO authenticated;
    GRANT INSERT, SELECT ON public.chat_messages TO authenticated;
    GRANT ALL ON public.chat_messages, public.chat_summaries TO service_role;
    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${OTHER_COUPLE_ID}', 'bride');
    INSERT INTO public.chat_messages(couple_id, visibility, content)
    VALUES ('${COUPLE_ID}', 'shared', 'legacy message');
    INSERT INTO public.chat_summaries(couple_id, visibility, summary)
    VALUES ('${COUPLE_ID}', 'shared', 'legacy summary');
  `);
  await db.exec(migrationSql);
  return db;
}

async function setAuthenticated(db: PGlite, userId: string) {
  await db.exec("SET ROLE authenticated");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub', $1, false)",
    [userId],
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub', '', false)",
  );
}

async function startSegment(
  db: PGlite,
  options: {
    coupleId?: string;
    visibility?: "shared" | "bride_private" | "groom_private";
    expectedSegmentId?: string | null;
    operationKey?: string;
    startReason?: "initial" | "user_started" | "safe_compaction";
  } = {},
) {
  return db.query<{
    segment_id: string;
    previous_segment_id: string | null;
    started_at: string;
    segment_status: "active" | "closed";
    current_active_segment_id: string | null;
    replayed: boolean;
  }>(
    `SELECT * FROM public.start_amora_conversation_segment(
       $1::uuid, $2::text, $3::uuid, $4::uuid, $5::text
     )`,
    [
      options.coupleId ?? COUPLE_ID,
      options.visibility ?? "shared",
      options.expectedSegmentId ?? null,
      options.operationKey ?? FIRST_OPERATION_ID,
      options.startReason ?? "user_started",
    ],
  );
}

describe("Amora conversation segment migration", () => {
  it("adds only nullable segment links so mixed-version clients keep working", async () => {
    expect(migrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(migrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(migrationSql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migrationSql).toContain("SET LOCAL statement_timeout = '60s'");
    expect(migrationSql).toContain(
      "LOCK TABLE public.chat_messages, public.chat_summaries",
    );
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(migrationSql).not.toMatch(
      /ALTER TABLE public\.(?:ai_interactions_log|decision_nodes)/i,
    );

    const db = await createDatabase();
    try {
      const legacyMessages = await db.query<{ segment_id: string | null }>(
        "SELECT segment_id FROM public.chat_messages",
      );
      const legacySummaries = await db.query<{ segment_id: string | null }>(
        "SELECT segment_id FROM public.chat_summaries",
      );
      expect(legacyMessages.rows).toEqual([{ segment_id: null }]);
      expect(legacySummaries.rows).toEqual([{ segment_id: null }]);

      await db.exec("SET ROLE authenticated");
      await db.query(
        "SELECT set_config('request.jwt.claim.sub', $1, false)",
        [BRIDE_ID],
      );
      await expect(db.query(
        `INSERT INTO public.chat_messages(couple_id, visibility, content)
         VALUES ($1, 'shared', 'mixed client message')`,
        [COUPLE_ID],
      )).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("binds private ownership to the current couple role and allows one active scope", async () => {
    const db = await createDatabase();
    try {
      await expect(db.query(
        `INSERT INTO public.conversation_segments(
           couple_id, visibility, owner_user_id, started_by, start_reason
         ) VALUES ($1, 'bride_private', $2, $3, 'initial')`,
        [COUPLE_ID, GROOM_ID, BRIDE_ID],
      )).rejects.toThrow(/AMORA_SEGMENT_OWNER_ROLE_MISMATCH/);

      await expect(db.query(
        `INSERT INTO public.conversation_segments(
           couple_id, visibility, owner_user_id, started_by, start_reason
         ) VALUES ($1, 'bride_private', $2, $2, 'initial')`,
        [COUPLE_ID, BRIDE_ID],
      )).resolves.toBeDefined();

      await expect(db.query(
        `INSERT INTO public.conversation_segments(
           couple_id, visibility, owner_user_id, started_by, start_reason
         ) VALUES ($1, 'bride_private', $2, $2, 'user_started')`,
        [COUPLE_ID, BRIDE_ID],
      )).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await db.close();
    }
  });

  it("atomically starts a segment and replays the same operation receipt", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      const first = await startSegment(db, { startReason: "initial" });
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]).toMatchObject({
        previous_segment_id: null,
        segment_status: "active",
        replayed: false,
      });
      expect(first.rows[0].current_active_segment_id).toBe(
        first.rows[0].segment_id,
      );

      const replay = await startSegment(db, { startReason: "initial" });
      expect(replay.rows).toEqual([
        {
          ...first.rows[0],
          replayed: true,
        },
      ]);

      await resetPersona(db);
      const active = await db.query<{
        id: string;
        status: string;
      }>(
        `SELECT id, status FROM public.conversation_segments
         WHERE couple_id = $1 AND visibility = 'shared'`,
        [COUPLE_ID],
      );
      expect(active.rows).toEqual([
        { id: first.rows[0].segment_id, status: "active" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("fails closed on a stale expected segment and closes only the exact predecessor", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      const first = await startSegment(db, { startReason: "initial" });
      const firstId = first.rows[0].segment_id;

      await expect(startSegment(db, {
        operationKey: SECOND_OPERATION_ID,
        expectedSegmentId: null,
      })).rejects.toThrow(/AMORA_SEGMENT_STALE_EXPECTED/);

      await resetPersona(db);
      await setAuthenticated(db, GROOM_ID);
      const next = await startSegment(db, {
        operationKey: SECOND_OPERATION_ID,
        expectedSegmentId: firstId,
      });
      expect(next.rows[0]).toMatchObject({
        previous_segment_id: firstId,
        segment_status: "active",
        replayed: false,
      });
      expect(next.rows[0].current_active_segment_id).toBe(
        next.rows[0].segment_id,
      );

      await resetPersona(db);
      await setAuthenticated(db, BRIDE_ID);
      const oldReceipt = await startSegment(db, {
        operationKey: FIRST_OPERATION_ID,
        expectedSegmentId: null,
        startReason: "initial",
      });
      expect(oldReceipt.rows[0]).toMatchObject({
        segment_id: firstId,
        previous_segment_id: null,
        segment_status: "closed",
        current_active_segment_id: next.rows[0].segment_id,
        replayed: true,
      });

      await resetPersona(db);
      const history = await db.query<{
        id: string;
        status: string;
        closed_at: string | null;
      }>(
        `SELECT id, status, closed_at
           FROM public.conversation_segments
          WHERE couple_id = $1 AND visibility = 'shared'
          ORDER BY started_at, id`,
        [COUPLE_ID],
      );
      expect(history.rows).toHaveLength(2);
      expect(history.rows.find((row) => row.id === firstId)).toMatchObject({
        status: "closed",
      });
      expect(
        history.rows.find((row) => row.id === firstId)?.closed_at,
      ).not.toBeNull();
      expect(
        history.rows.find((row) => row.id === next.rows[0].segment_id),
      ).toMatchObject({ status: "active", closed_at: null });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("exposes shared and own-private history only and denies direct mutations", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      await startSegment(db, { startReason: "initial" });
      await startSegment(db, {
        visibility: "bride_private",
        operationKey: "30000000-0000-4000-8000-000000000010",
        startReason: "initial",
      });

      await resetPersona(db);
      await setAuthenticated(db, GROOM_ID);
      await startSegment(db, {
        visibility: "groom_private",
        operationKey: "30000000-0000-4000-8000-000000000011",
        startReason: "initial",
      });

      await resetPersona(db);
      await setAuthenticated(db, BRIDE_ID);
      const brideRows = await db.query<{ visibility: string }>(
        `SELECT visibility FROM public.conversation_segments
         WHERE couple_id = $1 ORDER BY visibility`,
        [COUPLE_ID],
      );
      expect(brideRows.rows.map((row) => row.visibility)).toEqual([
        "bride_private",
        "shared",
      ]);

      await expect(db.query(
        `INSERT INTO public.conversation_segments(
           couple_id, visibility, owner_user_id, started_by, start_reason
         ) VALUES ($1, 'shared', NULL, $2, 'user_started')`,
        [COUPLE_ID, BRIDE_ID],
      )).rejects.toThrow(/permission denied|row-level security/i);

      await resetPersona(db);
      await setAuthenticated(db, GROOM_ID);
      const groomRows = await db.query<{ visibility: string }>(
        `SELECT visibility FROM public.conversation_segments
         WHERE couple_id = $1 ORDER BY visibility`,
        [COUPLE_ID],
      );
      expect(groomRows.rows.map((row) => row.visibility)).toEqual([
        "groom_private",
        "shared",
      ]);

      await resetPersona(db);
      await setAuthenticated(db, OUTSIDER_ID);
      const outsiderRows = await db.query(
        `SELECT id FROM public.conversation_segments
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      expect(outsiderRows.rows).toEqual([]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects message and summary links that cross couple or visibility scope", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      const started = await startSegment(db, { startReason: "initial" });
      const segmentId = started.rows[0].segment_id;
      await resetPersona(db);

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, visibility, content, segment_id
         ) VALUES ($1, 'shared', 'scoped message', $2)`,
        [COUPLE_ID, segmentId],
      )).resolves.toBeDefined();

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, visibility, content, segment_id
         ) VALUES ($1, 'bride_private', 'wrong lane', $2)`,
        [COUPLE_ID, segmentId],
      )).rejects.toThrow(/foreign key/i);

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, visibility, content, segment_id
         ) VALUES ($1, 'shared', 'wrong couple', $2)`,
        [OTHER_COUPLE_ID, segmentId],
      )).rejects.toThrow(/foreign key/i);

      await expect(db.query(
        `INSERT INTO public.chat_summaries(
           couple_id, visibility, summary, segment_id
         ) VALUES ($1, 'bride_private', 'wrong summary lane', $2)`,
        [COUPLE_ID, segmentId],
      )).rejects.toThrow(/foreign key/i);

      await expect(db.query(
        `INSERT INTO public.chat_summaries(
           couple_id, visibility, summary, segment_id
         ) VALUES (NULL, 'shared', 'missing scope', $1)`,
        [segmentId],
      )).rejects.toThrow(/check constraint/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("revalidates current membership, private role, and operation scope", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      await expect(startSegment(db, {
        visibility: "groom_private",
        startReason: "initial",
      })).rejects.toThrow(/AMORA_SEGMENT_MEMBERSHIP_REQUIRED|AMORA_SEGMENT_PRIVATE_SCOPE_FORBIDDEN/);

      const shared = await startSegment(db, { startReason: "initial" });
      await expect(startSegment(db, {
        visibility: "bride_private",
        operationKey: FIRST_OPERATION_ID,
        startReason: "initial",
      })).rejects.toThrow(/AMORA_SEGMENT_OPERATION_SCOPE_MISMATCH/);

      await resetPersona(db);
      await setAuthenticated(db, GROOM_ID);
      await expect(startSegment(db, {
        expectedSegmentId: shared.rows[0].segment_id,
        operationKey: FIRST_OPERATION_ID,
        startReason: "initial",
      })).rejects.toThrow(/AMORA_SEGMENT_OPERATION_SCOPE_MISMATCH/);

      await resetPersona(db);
      await setAuthenticated(db, OUTSIDER_ID);
      await expect(startSegment(db, {
        coupleId: COUPLE_ID,
        operationKey: "30000000-0000-4000-8000-000000000020",
      })).rejects.toThrow(/AMORA_SEGMENT_MEMBERSHIP_REQUIRED/);

      await resetPersona(db);
      await db.query(
        "UPDATE public.profiles SET role = 'groom' WHERE id = $1",
        [BRIDE_ID],
      );
      await setAuthenticated(db, BRIDE_ID);
      await expect(startSegment(db, {
        expectedSegmentId: shared.rows[0].segment_id,
        operationKey: "30000000-0000-4000-8000-000000000021",
      })).rejects.toThrow(/AMORA_SEGMENT_MEMBERSHIP_REQUIRED/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves the existing couple-delete cascade with linked segment rows", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      const started = await startSegment(db, { startReason: "initial" });
      const segmentId = started.rows[0].segment_id;
      await resetPersona(db);

      await db.query(
        `INSERT INTO public.chat_messages(
           couple_id, visibility, content, segment_id
         ) VALUES ($1, 'shared', 'linked before deletion', $2)`,
        [COUPLE_ID, segmentId],
      );
      await db.query(
        `INSERT INTO public.chat_summaries(
           couple_id, visibility, summary, segment_id
         ) VALUES ($1, 'shared', 'linked summary', $2)`,
        [COUPLE_ID, segmentId],
      );
      await db.query(
        "INSERT INTO public.decision_nodes(couple_id) VALUES ($1)",
        [COUPLE_ID],
      );

      await expect(db.query(
        "DELETE FROM public.couples WHERE id = $1",
        [COUPLE_ID],
      )).resolves.toBeDefined();

      for (const table of [
        "conversation_segments",
        "chat_messages",
        "chat_summaries",
        "decision_nodes",
      ]) {
        const remaining = await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.${table}`,
        );
        expect(remaining.rows[0].count).toBe(0);
      }
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});
