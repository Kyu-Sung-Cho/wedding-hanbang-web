// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const foundationMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260801100000_amora_conversation_segments.sql",
);
const dualWriteMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802120000_amora_conversation_segment_dual_write.sql",
);
const rosterRepairMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802210000_amora_conversation_segment_roster_repair.sql",
);
const foundationMigrationSql = readFileSync(foundationMigrationPath, "utf8");
const dualWriteMigrationSql = readFileSync(dualWriteMigrationPath, "utf8");
const rosterRepairMigrationSql = existsSync(rosterRepairMigrationPath)
  ? readFileSync(rosterRepairMigrationPath, "utf8")
  : "";

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const NEW_COUPLE_ID = "20000000-0000-4000-8000-000000000003";
const NEW_BRIDE_ID = "10000000-0000-4000-8000-000000000004";
const NEW_GROOM_ID = "10000000-0000-4000-8000-000000000005";
const REPLACEMENT_BRIDE_ID = "10000000-0000-4000-8000-000000000006";

const SHARED_MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const BRIDE_MESSAGE_ID = "40000000-0000-4000-8000-000000000002";
const GROOM_MESSAGE_ID = "40000000-0000-4000-8000-000000000003";
const START_OPERATION_ID = "30000000-0000-4000-8000-000000000001";
const SECOND_OPERATION_ID = "30000000-0000-4000-8000-000000000002";

async function createDatabase(
  options: {
    applyDualWrite?: boolean;
    applyRosterRepair?: boolean;
  } = {},
) {
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
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL CHECK (sender_type IN ('bride', 'groom', 'ai')),
      role text NOT NULL CHECK (role IN ('user', 'assistant')),
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared'
        CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id),
      summary text,
      message_count integer NOT NULL DEFAULT 0,
      from_message_id text,
      to_message_id text,
      visibility text NOT NULL DEFAULT 'shared'
        CHECK (visibility IN ('shared', 'bride_private', 'groom_private')),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY chat_messages_select_scope
      ON public.chat_messages FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility));
    CREATE POLICY chat_messages_insert_own_user
      ON public.chat_messages FOR INSERT TO authenticated
      WITH CHECK (
        sender_id = auth.uid()
        AND role = 'user'
        AND sender_type IN ('bride', 'groom')
        AND public.can_access_couple_visibility(couple_id, visibility)
        AND EXISTS (
          SELECT 1
            FROM public.couples AS couple
           WHERE couple.id = chat_messages.couple_id
             AND (
               (
                 sender_type = 'bride'
                 AND couple.bride_id = auth.uid()
                 AND visibility IN ('shared', 'bride_private')
               )
               OR (
                 sender_type = 'groom'
                 AND couple.groom_id = auth.uid()
                 AND visibility IN ('shared', 'groom_private')
               )
             )
        )
      );

    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.can_access_couple_visibility(uuid, text)
      TO authenticated, service_role;
    GRANT SELECT ON public.couples TO authenticated;
    GRANT SELECT ON public.chat_messages TO authenticated;
    GRANT INSERT (
      couple_id, sender_id, sender_type, role, content, metadata, visibility
    ) ON public.chat_messages TO authenticated;
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

    INSERT INTO public.chat_messages(
      id, couple_id, sender_id, sender_type, role, content, visibility, created_at
    ) VALUES
      ('${SHARED_MESSAGE_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'shared legacy', 'shared', '2026-07-01T00:00:00Z'),
      ('${BRIDE_MESSAGE_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'bride legacy', 'bride_private', '2026-07-01T00:01:00Z'),
      ('${GROOM_MESSAGE_ID}', '${COUPLE_ID}', '${GROOM_ID}', 'groom', 'user', 'groom legacy', 'groom_private', '2026-07-01T00:02:00Z');

    INSERT INTO public.chat_summaries(
      couple_id, user_id, summary, message_count,
      from_message_id, to_message_id, visibility, created_at
    ) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', 'shared summary', 1, NULL, '${SHARED_MESSAGE_ID}', 'shared', '2026-07-01T00:03:00Z'),
      ('${COUPLE_ID}', '${BRIDE_ID}', 'bride summary', 1, NULL, '${BRIDE_MESSAGE_ID}', 'bride_private', '2026-07-01T00:04:00Z'),
      ('${COUPLE_ID}', '${GROOM_ID}', 'groom summary', 1, NULL, '${GROOM_MESSAGE_ID}', 'groom_private', '2026-07-01T00:05:00Z');
  `);

  await db.exec(foundationMigrationSql);
  if (options.applyDualWrite !== false) {
    await db.exec(dualWriteMigrationSql);
  }
  if (options.applyRosterRepair && rosterRepairMigrationSql) {
    await db.exec(rosterRepairMigrationSql);
  }
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

async function setDatabaseOwnerActor(db: PGlite, userId: string) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub', $1, false)",
    [userId],
  );
}

async function startSegment(
  db: PGlite,
  options: {
    visibility?: "shared" | "bride_private" | "groom_private";
    expectedSegmentId: string;
    operationKey?: string;
  },
) {
  return db.query<{
    segment_id: string;
    previous_segment_id: string | null;
    segment_status: "active" | "closed";
    current_active_segment_id: string | null;
    replayed: boolean;
  }>(
    `SELECT segment_id, previous_segment_id, segment_status,
            current_active_segment_id, replayed
       FROM public.start_amora_conversation_segment(
         $1::uuid, $2::text, $3::uuid, $4::uuid, 'user_started'
       )`,
    [
      COUPLE_ID,
      options.visibility ?? "shared",
      options.expectedSegmentId,
      options.operationKey ?? START_OPERATION_ID,
    ],
  );
}

describe("Amora conversation segment dual-write migration", () => {
  it("is transactional, storage-only, and leaves canonical decisions and AI logs untouched", () => {
    expect(dualWriteMigrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(dualWriteMigrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(dualWriteMigrationSql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(dualWriteMigrationSql).toContain(
      "LOCK TABLE public.couples, public.conversation_segments",
    );
    expect(dualWriteMigrationSql).toContain(
      "CREATE TRIGGER trg_zz_assign_amora_conversation_message_segment",
    );
    expect(dualWriteMigrationSql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.start_amora_conversation_segment",
    );
    expect(dualWriteMigrationSql).not.toMatch(
      /ALTER TABLE public\.(?:ai_interactions_log|decision_nodes)/i,
    );
    expect(dualWriteMigrationSql).not.toContain(
      "AMORA_CONVERSATION_SEGMENT_READ_ENABLED",
    );
    expect(dualWriteMigrationSql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
  });

  it("keeps the roster-repair follow-up transactional and outside the permanent roster fence", () => {
    expect(rosterRepairMigrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(rosterRepairMigrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(rosterRepairMigrationSql).toContain(
      "LOCK TABLE public.couples, public.conversation_segments",
    );
    expect(rosterRepairMigrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.ensure_amora_initial_conversation_segments()",
    );
    expect(rosterRepairMigrationSql).toContain(
      "previous_segment_id, created_at",
    );
    expect(rosterRepairMigrationSql).not.toMatch(
      /ALTER TABLE public\.couples/i,
    );
    expect(rosterRepairMigrationSql).not.toMatch(
      /ALTER TABLE public\.(?:ai_interactions_log|decision_nodes)/i,
    );
    expect(rosterRepairMigrationSql).not.toMatch(
      /\bDROP\s+(?:TABLE|COLUMN|POLICY|TRIGGER)\b/i,
    );
  });

  it("creates every current lane and backfills legacy messages and summaries into that exact lane", async () => {
    const db = await createDatabase();
    try {
      const segments = await db.query<{
        visibility: string;
        owner_user_id: string | null;
        status: string;
        start_reason: string;
      }>(
        `SELECT visibility, owner_user_id, status, start_reason
           FROM public.conversation_segments
          WHERE couple_id = $1
          ORDER BY visibility`,
        [COUPLE_ID],
      );
      expect(segments.rows).toEqual([
        {
          visibility: "bride_private",
          owner_user_id: BRIDE_ID,
          status: "active",
          start_reason: "migration",
        },
        {
          visibility: "groom_private",
          owner_user_id: GROOM_ID,
          status: "active",
          start_reason: "migration",
        },
        {
          visibility: "shared",
          owner_user_id: null,
          status: "active",
          start_reason: "migration",
        },
      ]);

      const messages = await db.query<{
        visibility: string;
        segment_visibility: string;
        owner_user_id: string | null;
      }>(
        `SELECT message.visibility,
                segment.visibility AS segment_visibility,
                segment.owner_user_id
           FROM public.chat_messages AS message
           JOIN public.conversation_segments AS segment
             ON segment.id = message.segment_id
          WHERE message.couple_id = $1
          ORDER BY message.visibility`,
        [COUPLE_ID],
      );
      expect(messages.rows).toEqual([
        {
          visibility: "bride_private",
          segment_visibility: "bride_private",
          owner_user_id: BRIDE_ID,
        },
        {
          visibility: "groom_private",
          segment_visibility: "groom_private",
          owner_user_id: GROOM_ID,
        },
        {
          visibility: "shared",
          segment_visibility: "shared",
          owner_user_id: null,
        },
      ]);

      const summaryCount = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM public.chat_summaries AS summary
           JOIN public.chat_messages AS terminal_message
             ON terminal_message.id::text = summary.to_message_id
          WHERE summary.segment_id = terminal_message.segment_id`,
      );
      expect(summaryCount.rows[0].count).toBe(3);

      const nullLinks = await db.query<{ count: number }>(
        `SELECT
           (SELECT count(*) FROM public.chat_messages WHERE segment_id IS NULL)
           +
           (SELECT count(*) FROM public.chat_summaries WHERE segment_id IS NULL)
           AS count`,
      );
      expect(Number(nullLinks.rows[0].count)).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("server-assigns the current lane segment when a mixed-version user omits segment_id", async () => {
    const db = await createDatabase();
    try {
      const active = await db.query<{ id: string }>(
        `SELECT id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'shared'
            AND status = 'active'`,
        [COUPLE_ID],
      );

      await setAuthenticated(db, BRIDE_ID);
      const inserted = await db.query<{ id: string; segment_id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'new shared message', '{}'::jsonb, 'shared')
         RETURNING id, segment_id`,
        [COUPLE_ID, BRIDE_ID],
      );

      expect(inserted.rows).toEqual([
        expect.objectContaining({ segment_id: active.rows[0].id }),
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps a delayed AI reply with its source user message when a new segment wins first", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      const userMessage = await db.query<{ id: string; segment_id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'question before boundary', '{}'::jsonb, 'shared')
         RETURNING id, segment_id`,
        [COUPLE_ID, BRIDE_ID],
      );
      const oldSegmentId = userMessage.rows[0].segment_id;

      await setDatabaseOwnerActor(db, BRIDE_ID);
      const next = await startSegment(db, {
        expectedSegmentId: oldSegmentId,
      });
      expect(next.rows[0]).toMatchObject({
        previous_segment_id: oldSegmentId,
        replayed: false,
      });

      await resetPersona(db);
      const aiReply = await db.query<{ segment_id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata,
           visibility, segment_id
         ) VALUES (
           $1, NULL, 'ai', 'assistant', 'delayed answer',
           jsonb_build_object('in_reply_to_user_message_id', $2::text),
           'shared', $3
         )
         RETURNING segment_id`,
        [COUPLE_ID, userMessage.rows[0].id, next.rows[0].segment_id],
      );

      expect(aiReply.rows).toEqual([{ segment_id: oldSegmentId }]);

      const active = await db.query<{ id: string }>(
        `SELECT id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'shared'
            AND status = 'active'`,
        [COUPLE_ID],
      );
      expect(active.rows).toEqual([{ id: next.rows[0].segment_id }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("binds a summary to its terminal message and rejects a range crossing segment boundaries", async () => {
    const db = await createDatabase();
    try {
      const oldMessage = await db.query<{ segment_id: string }>(
        "SELECT segment_id FROM public.chat_messages WHERE id = $1",
        [SHARED_MESSAGE_ID],
      );

      await setDatabaseOwnerActor(db, BRIDE_ID);
      const next = await startSegment(db, {
        expectedSegmentId: oldMessage.rows[0].segment_id,
      });
      await setAuthenticated(db, BRIDE_ID);
      const newMessage = await db.query<{ id: string; segment_id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'question in next segment', 'shared')
         RETURNING id, segment_id`,
        [COUPLE_ID, BRIDE_ID],
      );
      expect(newMessage.rows[0].segment_id).toBe(next.rows[0].segment_id);

      await resetPersona(db);
      await expect(db.query(
        `INSERT INTO public.chat_summaries(
           couple_id, user_id, summary, message_count,
           from_message_id, to_message_id, visibility, segment_id
         ) VALUES ($1, $2, 'crossing summary', 2, $3, $4, 'shared', $5)`,
        [
          COUPLE_ID,
          BRIDE_ID,
          SHARED_MESSAGE_ID,
          newMessage.rows[0].id,
          next.rows[0].segment_id,
        ],
      )).rejects.toThrow(/AMORA_SEGMENT_SUMMARY_BOUNDARY_INVALID/);

      const summary = await db.query<{ segment_id: string }>(
        `INSERT INTO public.chat_summaries(
           couple_id, user_id, summary, message_count,
           from_message_id, to_message_id, visibility, segment_id
         ) VALUES ($1, $2, 'old segment summary', 1, NULL, $3, 'shared', $4)
         RETURNING segment_id`,
        [
          COUPLE_ID,
          BRIDE_ID,
          SHARED_MESSAGE_ID,
          next.rows[0].segment_id,
        ],
      );
      expect(summary.rows).toEqual([
        { segment_id: oldMessage.rows[0].segment_id },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps message and summary scope assignments immutable after insert", async () => {
    const db = await createDatabase();
    try {
      const oldSegment = await db.query<{ segment_id: string }>(
        "SELECT segment_id FROM public.chat_messages WHERE id = $1",
        [SHARED_MESSAGE_ID],
      );
      const oldSummary = await db.query<{ id: string }>(
        `SELECT id FROM public.chat_summaries
          WHERE to_message_id = $1`,
        [SHARED_MESSAGE_ID],
      );

      await setDatabaseOwnerActor(db, BRIDE_ID);
      const next = await startSegment(db, {
        expectedSegmentId: oldSegment.rows[0].segment_id,
      });
      await resetPersona(db);

      await expect(db.query(
        `UPDATE public.chat_messages
            SET segment_id = $1
          WHERE id = $2`,
        [next.rows[0].segment_id, SHARED_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_SEGMENT_MESSAGE_SCOPE_IMMUTABLE/);

      await expect(db.query(
        `UPDATE public.chat_summaries
            SET segment_id = $1
          WHERE id = $2`,
        [next.rows[0].segment_id, oldSummary.rows[0].id],
      )).rejects.toThrow(/AMORA_SEGMENT_SUMMARY_SCOPE_IMMUTABLE/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps client writes inside RLS and rejects cross-lane or partner-only AI reply sources", async () => {
    const db = await createDatabase();
    try {
      const groomPrivate = await db.query<{ id: string }>(
        `SELECT id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'groom_private'
            AND status = 'active'`,
        [COUPLE_ID],
      );

      await setAuthenticated(db, BRIDE_ID);
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content,
           metadata, visibility, segment_id
         ) VALUES ($1, $2, 'bride', 'user', 'forced segment',
           '{}'::jsonb, 'shared', $3)`,
        [COUPLE_ID, BRIDE_ID, groomPrivate.rows[0].id],
      )).rejects.toThrow(/permission denied/i);

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'wrong private lane', 'groom_private')`,
        [COUPLE_ID, BRIDE_ID],
      )).rejects.toThrow(
        /AMORA_SEGMENT_MESSAGE_ACTOR_INVALID|row-level security/i,
      );

      const partnerOnly = await db.query<{ id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'bride', 'user', 'for my partner only',
           '{"target":"partner"}'::jsonb, 'shared'
         ) RETURNING id`,
        [COUPLE_ID, BRIDE_ID],
      );

      await resetPersona(db);
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, NULL, 'ai', 'assistant', 'must not answer partner-only text',
           jsonb_build_object('in_reply_to_user_message_id', $2::text), 'shared'
         )`,
        [COUPLE_ID, partnerOnly.rows[0].id],
      )).rejects.toThrow(/AMORA_SEGMENT_REPLY_SCOPE_INVALID/);

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, NULL, 'ai', 'assistant', 'wrong lane answer',
           jsonb_build_object('in_reply_to_user_message_id', $2::text),
           'bride_private'
         )`,
        [COUPLE_ID, SHARED_MESSAGE_ID],
      )).rejects.toThrow(/AMORA_SEGMENT_REPLY_SCOPE_INVALID/);

      await setAuthenticated(db, OUTSIDER_ID);
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'outsider write', 'shared')`,
        [COUPLE_ID, OUTSIDER_ID],
      )).rejects.toThrow(
        /AMORA_SEGMENT_MESSAGE_ACTOR_INVALID|row-level security/i,
      );

      const hiddenSegments = await db.query(
        "SELECT id FROM public.conversation_segments WHERE couple_id = $1",
        [COUPLE_ID],
      );
      const hiddenMessages = await db.query(
        "SELECT id FROM public.chat_messages WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(hiddenSegments.rows).toEqual([]);
      expect(hiddenMessages.rows).toEqual([]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("creates initial lanes for couples and partners added after the migration", async () => {
    const db = await createDatabase({ applyRosterRepair: true });
    try {
      await db.query(
        "INSERT INTO auth.users(id) VALUES ($1), ($2)",
        [NEW_BRIDE_ID, NEW_GROOM_ID],
      );
      await db.query(
        "INSERT INTO public.couples(id, bride_id, groom_id) VALUES ($1, $2, NULL)",
        [NEW_COUPLE_ID, NEW_BRIDE_ID],
      );
      await db.query(
        `INSERT INTO public.profiles(id, couple_id, role)
         VALUES ($1, $2, 'bride'), ($3, $2, 'groom')`,
        [NEW_BRIDE_ID, NEW_COUPLE_ID, NEW_GROOM_ID],
      );

      const beforePartner = await db.query<{ visibility: string }>(
        `SELECT visibility
           FROM public.conversation_segments
          WHERE couple_id = $1
          ORDER BY visibility`,
        [NEW_COUPLE_ID],
      );
      expect(beforePartner.rows.map((row) => row.visibility)).toEqual([
        "bride_private",
        "shared",
      ]);

      await db.query(
        "UPDATE public.couples SET groom_id = $1 WHERE id = $2",
        [NEW_GROOM_ID, NEW_COUPLE_ID],
      );
      const afterPartner = await db.query<{
        visibility: string;
        owner_user_id: string | null;
      }>(
        `SELECT visibility, owner_user_id
           FROM public.conversation_segments
          WHERE couple_id = $1
          ORDER BY visibility`,
        [NEW_COUPLE_ID],
      );
      expect(afterPartner.rows).toEqual([
        { visibility: "bride_private", owner_user_id: NEW_BRIDE_ID },
        { visibility: "groom_private", owner_user_id: NEW_GROOM_ID },
        { visibility: "shared", owner_user_id: null },
      ]);
    } finally {
      await db.close();
    }
  });

  it("rotates a private lane during an explicit database-owner roster repair without moving prior history", async () => {
    const db = await createDatabase({ applyRosterRepair: true });
    try {
      const before = await db.query<{ id: string }>(
        `SELECT id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'bride_private'
            AND owner_user_id = $2
            AND status = 'active'`,
        [COUPLE_ID, BRIDE_ID],
      );
      expect(before.rows).toHaveLength(1);

      await db.query(
        "INSERT INTO auth.users(id) VALUES ($1)",
        [REPLACEMENT_BRIDE_ID],
      );
      await db.query(
        `INSERT INTO public.profiles(id, couple_id, role)
         VALUES ($1, NULL, 'bride')`,
        [REPLACEMENT_BRIDE_ID],
      );

      // Public roster replacement remains blocked by the roster-epoch fence.
      // These owner-level writes model only an allowed operational repair.
      await db.query(
        "UPDATE public.couples SET bride_id = NULL WHERE id = $1",
        [COUPLE_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = NULL WHERE id = $1",
        [BRIDE_ID],
      );
      await db.query(
        "UPDATE public.couples SET bride_id = $1 WHERE id = $2",
        [REPLACEMENT_BRIDE_ID, COUPLE_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = $1 WHERE id = $2",
        [COUPLE_ID, REPLACEMENT_BRIDE_ID],
      );

      await setAuthenticated(db, REPLACEMENT_BRIDE_ID);
      const userMessage = await db.query<{
        id: string;
        segment_id: string;
      }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'replacement owner', 'bride_private')
         RETURNING id, segment_id`,
        [COUPLE_ID, REPLACEMENT_BRIDE_ID],
      );

      await resetPersona(db);
      const aiReply = await db.query<{ segment_id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata,
           visibility
         ) VALUES (
           $1, NULL, 'ai', 'assistant', 'repair reply',
           jsonb_build_object('in_reply_to_user_message_id', $2::text),
           'bride_private'
         )
         RETURNING segment_id`,
        [COUPLE_ID, userMessage.rows[0].id],
      );

      const history = await db.query<{
        id: string;
        owner_user_id: string;
        status: string;
        previous_segment_id: string | null;
      }>(
        `SELECT id, owner_user_id, status, previous_segment_id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'bride_private'
          ORDER BY started_at, id`,
        [COUPLE_ID],
      );
      expect(history.rows).toHaveLength(2);
      expect(history.rows[0]).toMatchObject({
        id: before.rows[0].id,
        owner_user_id: BRIDE_ID,
        status: "closed",
        previous_segment_id: null,
      });
      expect(history.rows[1]).toMatchObject({
        owner_user_id: REPLACEMENT_BRIDE_ID,
        status: "active",
        previous_segment_id: before.rows[0].id,
      });
      expect(userMessage.rows[0].segment_id).toBe(history.rows[1].id);
      expect(aiReply.rows[0].segment_id).toBe(history.rows[1].id);

      const priorMessage = await db.query<{ segment_id: string }>(
        "SELECT segment_id FROM public.chat_messages WHERE id = $1",
        [BRIDE_MESSAGE_ID],
      );
      expect(priorMessage.rows).toEqual([{ segment_id: before.rows[0].id }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("reconciles a stale active private owner left before the follow-up and is rerunnable", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        "INSERT INTO auth.users(id) VALUES ($1)",
        [REPLACEMENT_BRIDE_ID],
      );
      await db.query(
        `INSERT INTO public.profiles(id, couple_id, role)
         VALUES ($1, $2, 'bride')`,
        [REPLACEMENT_BRIDE_ID, COUPLE_ID],
      );
      await db.query(
        "UPDATE public.couples SET bride_id = $1 WHERE id = $2",
        [REPLACEMENT_BRIDE_ID, COUPLE_ID],
      );

      const stale = await db.query<{
        owner_user_id: string;
        status: string;
      }>(
        `SELECT owner_user_id, status
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'bride_private'
            AND status = 'active'`,
        [COUPLE_ID],
      );
      expect(stale.rows).toEqual([{
        owner_user_id: BRIDE_ID,
        status: "active",
      }]);

      await expect(db.exec(rosterRepairMigrationSql)).resolves.toBeDefined();
      const repaired = await db.query<{
        id: string;
        owner_user_id: string;
        status: string;
        previous_segment_id: string | null;
      }>(
        `SELECT id, owner_user_id, status, previous_segment_id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'bride_private'
          ORDER BY started_at, id`,
        [COUPLE_ID],
      );
      expect(repaired.rows).toHaveLength(2);
      expect(repaired.rows[0]).toMatchObject({
        owner_user_id: BRIDE_ID,
        status: "closed",
      });
      expect(repaired.rows[1]).toEqual({
        id: expect.any(String),
        owner_user_id: REPLACEMENT_BRIDE_ID,
        status: "active",
        previous_segment_id: repaired.rows[0].id,
      });

      const beforeReplay = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.conversation_segments",
      );
      await expect(db.exec(rosterRepairMigrationSql)).resolves.toBeDefined();
      const afterReplay = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.conversation_segments",
      );
      expect(afterReplay.rows).toEqual(beforeReplay.rows);
    } finally {
      await db.close();
    }
  });

  it("fails closed instead of guessing when legacy rows share a lane with multiple pre-existing segments", async () => {
    const db = await createDatabase({ applyDualWrite: false });
    try {
      await setAuthenticated(db, BRIDE_ID);
      const initial = await db.query<{ segment_id: string }>(
        `SELECT segment_id
           FROM public.start_amora_conversation_segment(
             $1::uuid, 'shared', NULL, $2::uuid, 'initial'
           )`,
        [COUPLE_ID, START_OPERATION_ID],
      );
      await startSegment(db, {
        expectedSegmentId: initial.rows[0].segment_id,
        operationKey: SECOND_OPERATION_ID,
      });
      await resetPersona(db);

      await expect(db.exec(dualWriteMigrationSql)).rejects.toThrow(
        /AMORA_SEGMENT_BACKFILL_AMBIGUOUS/,
      );
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps direct segment transitions disabled while provider reads still use the legacy context", async () => {
    const db = await createDatabase();
    try {
      const active = await db.query<{ id: string }>(
        `SELECT id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'shared'
            AND status = 'active'`,
        [COUPLE_ID],
      );
      await setAuthenticated(db, BRIDE_ID);

      await expect(startSegment(db, {
        expectedSegmentId: active.rows[0].id,
        operationKey: SECOND_OPERATION_ID,
      })).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves idempotent transition receipts and rejects a stale competing boundary", async () => {
    const db = await createDatabase();
    try {
      const active = await db.query<{ id: string }>(
        `SELECT id
           FROM public.conversation_segments
          WHERE couple_id = $1
            AND visibility = 'shared'
            AND status = 'active'`,
        [COUPLE_ID],
      );
      await setDatabaseOwnerActor(db, BRIDE_ID);

      const first = await startSegment(db, {
        expectedSegmentId: active.rows[0].id,
        operationKey: START_OPERATION_ID,
      });
      const replay = await startSegment(db, {
        expectedSegmentId: active.rows[0].id,
        operationKey: START_OPERATION_ID,
      });
      expect(replay.rows).toEqual([
        { ...first.rows[0], replayed: true },
      ]);

      await expect(startSegment(db, {
        expectedSegmentId: active.rows[0].id,
        operationKey: SECOND_OPERATION_ID,
      })).rejects.toThrow(/AMORA_SEGMENT_STALE_EXPECTED/);

      await resetPersona(db);
      const history = await db.query<{
        total: number;
        active_count: number;
      }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'active')::int AS active_count
           FROM public.conversation_segments
          WHERE couple_id = $1 AND visibility = 'shared'`,
        [COUPLE_ID],
      );
      expect(history.rows).toEqual([{ total: 2, active_count: 1 }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a pre-linked summary whose terminal message belongs to another segment", async () => {
    const db = await createDatabase({ applyDualWrite: false });
    try {
      await setAuthenticated(db, BRIDE_ID);
      const initial = await db.query<{ segment_id: string }>(
        `SELECT segment_id
           FROM public.start_amora_conversation_segment(
             $1::uuid, 'shared', NULL, $2::uuid, 'initial'
           )`,
        [COUPLE_ID, START_OPERATION_ID],
      );
      const next = await startSegment(db, {
        expectedSegmentId: initial.rows[0].segment_id,
        operationKey: SECOND_OPERATION_ID,
      });
      await resetPersona(db);

      await db.query(
        "UPDATE public.chat_messages SET segment_id = $1 WHERE id = $2",
        [initial.rows[0].segment_id, SHARED_MESSAGE_ID],
      );
      await db.query(
        `UPDATE public.chat_summaries
            SET segment_id = $1
          WHERE to_message_id = $2`,
        [next.rows[0].segment_id, SHARED_MESSAGE_ID],
      );

      await expect(db.exec(dualWriteMigrationSql)).rejects.toThrow(
        /AMORA_SEGMENT_SUMMARY_BACKFILL_INVALID/,
      );
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects service writes that forge a user role or an AI sender identity", async () => {
    const db = await createDatabase();
    try {
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'forged private owner', 'bride_private')`,
        [COUPLE_ID, GROOM_ID],
      )).rejects.toThrow(/AMORA_SEGMENT_MESSAGE_ACTOR_INVALID/);

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, visibility
         ) VALUES ($1, $2, 'ai', 'assistant', 'forged AI identity', 'shared')`,
        [COUPLE_ID, BRIDE_ID],
      )).rejects.toThrow(/AMORA_SEGMENT_MESSAGE_ACTOR_INVALID/);
    } finally {
      await db.close();
    }
  });

  it("can be rehearsed twice without duplicating segments or bind triggers", async () => {
    const db = await createDatabase();
    try {
      const before = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.conversation_segments",
      );
      await expect(db.exec(dualWriteMigrationSql)).resolves.toBeDefined();
      const after = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.conversation_segments",
      );
      expect(after.rows).toEqual(before.rows);

      const triggers = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM pg_catalog.pg_trigger
          WHERE NOT tgisinternal
            AND tgname IN (
              'trg_zz_assign_amora_conversation_message_segment',
              'trg_zz_assign_amora_conversation_summary_segment'
            )`,
      );
      expect(triggers.rows).toEqual([{ count: 2 }]);
    } finally {
      await db.close();
    }
  });
});
