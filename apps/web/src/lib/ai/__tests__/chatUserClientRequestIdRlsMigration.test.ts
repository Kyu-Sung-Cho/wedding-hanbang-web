// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260801090000_amora_chat_delivery_safety.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const SOLO_PARTNER_ID = "10000000-0000-4000-8000-000000000004";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

async function createDatabase(applyMigration = true) {
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
      groom_id uuid REFERENCES auth.users(id),
      membership_sealed_at timestamptz
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id),
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
      SELECT EXISTS (
        SELECT 1
          FROM public.profiles AS profile
          JOIN public.couples AS couple ON couple.id = profile.couple_id
         WHERE profile.id = auth.uid()
           AND profile.couple_id = p_couple_id
           AND (
             (profile.role = 'bride' AND couple.bride_id = profile.id)
             OR (profile.role = 'groom' AND couple.groom_id = profile.id)
           )
           AND (
             p_visibility = 'shared'
             OR (profile.role = 'bride' AND p_visibility = 'bride_private')
             OR (profile.role = 'groom' AND p_visibility = 'groom_private')
           )
      )
    $$;
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL,
      sender_role text,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      stage_tag text,
      specialist_type text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX chat_messages_client_request_id_unique
      ON public.chat_messages (couple_id, (metadata->>'client_request_id'))
      WHERE metadata->>'client_request_id' IS NOT NULL;
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.can_access_couple_visibility(uuid, text)
      TO authenticated, service_role;
    GRANT INSERT, SELECT ON public.chat_messages TO authenticated;
    GRANT ALL ON public.chat_messages TO service_role;
    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}'),
      ('${SOLO_PARTNER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id, membership_sealed_at) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}', now()),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', NULL, NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${OTHER_COUPLE_ID}', 'bride');
    INSERT INTO public.chat_messages(
      couple_id, sender_id, sender_type, role, content, metadata, visibility
    ) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user',
       'provable legacy partner row', '{"target":"partner"}', 'shared'),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', 'bride', 'user',
       'ambiguous legacy partner row', '{"target":"partner"}', 'shared');
  `);
  if (applyMigration) await db.exec(migrationSql);
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

async function insertUserMessage(
  db: PGlite,
  options: {
    metadata?: unknown;
    visibility?: "shared" | "bride_private" | "groom_private";
    senderId?: string;
    senderType?: "bride" | "groom";
    coupleId?: string;
    content?: string;
  } = {},
) {
  return db.query(
    `INSERT INTO public.chat_messages(
       couple_id, sender_id, sender_type, role, content, metadata, visibility
     ) VALUES ($1, $2, $3, 'user', $4, $5::jsonb, $6)`,
    [
      options.coupleId ?? COUPLE_ID,
      options.senderId ?? BRIDE_ID,
      options.senderType ?? "bride",
      options.content ?? "safe user message",
      JSON.stringify(options.metadata ?? {}),
      options.visibility ?? "shared",
    ],
  );
}

describe("Amora authenticated chat request-id RLS migration", () => {
  it("allows a service-only deny metadata CAS under the actual current UPDATE triggers without changing scope or mediation rows", async () => {
    const db = await createDatabase();
    try {
      const segmentSql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260802120000_amora_conversation_segment_dual_write.sql"), "utf8");
      const mediationSql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260906223557_amora_mediation_response_choices.sql"), "utf8");
      const scopeFunction = segmentSql.match(/CREATE OR REPLACE FUNCTION public\.prevent_amora_conversation_scope_rewrite\(\)[\s\S]*?\$function\$;/)?.[0];
      const scopeTrigger = segmentSql.match(/CREATE TRIGGER trg_zz_guard_amora_message_segment_scope[\s\S]*?\(\);/)?.[0];
      const mediationFunction = mediationSql.match(/CREATE FUNCTION public\.clean_amora_mediation_responses\(\)[\s\S]*?\$function\$;/)?.[0];
      const mediationTrigger = mediationSql.match(/CREATE TRIGGER trg_clean_amora_mediation_responses AFTER UPDATE OF couple_id[\s\S]*?\(\);/)?.[0];
      if (!scopeFunction || !scopeTrigger || !mediationFunction || !mediationTrigger) throw new Error("Current trigger source missing");
      await db.exec(`ALTER TABLE public.chat_messages ADD COLUMN segment_id uuid;
        CREATE TABLE public.amora_mediation_responses(message_id uuid, couple_id uuid, proposal_version integer, roster_fingerprint text);`);
      await setAuthenticated(db, BRIDE_ID);
      await expect(insertUserMessage(db, { metadata: { amora_memory_policy: { effect: "deny" } } })).rejects.toThrow(/row-level security/i);
      await insertUserMessage(db, { metadata: { client_request_id: REQUEST_ID } });
      await expect(db.exec("UPDATE public.chat_messages SET metadata='{}'::jsonb")).rejects.toThrow(/permission denied/i);
      await resetPersona(db);
      // INSERT segment 할당은 기존 별도 회귀가 검증한다. 이 fixture의 기존 row는 테스트 전에 정본 scope를 고정한다.
      await db.query("UPDATE public.chat_messages SET segment_id=$1 WHERE metadata->>'client_request_id'=$2", [REQUEST_ID, REQUEST_ID]);
      await db.exec(`${scopeFunction} ${scopeTrigger} ${mediationFunction} ${mediationTrigger}`);
      await db.query("INSERT INTO public.amora_mediation_responses VALUES($1,$2,1,'unrelated')", [OUTSIDER_ID, OTHER_COUPLE_ID]);
      await db.exec("SET ROLE service_role");
      const oldMetadata = { client_request_id: REQUEST_ID };
      const policy = { version: 1, scope: "conversation", effect: "deny", actorId: BRIDE_ID,
        segmentId: REQUEST_ID, sourceUserMessageId: REQUEST_ID, sourceTextSha256: "a".repeat(64) };
      const first = await db.query(`UPDATE public.chat_messages SET metadata=$1::jsonb
        WHERE couple_id=$2 AND sender_id=$3 AND visibility='shared' AND segment_id=$4 AND metadata=$5::jsonb RETURNING metadata`,
      [JSON.stringify({ ...oldMetadata, amora_memory_policy: policy }), COUPLE_ID, BRIDE_ID, REQUEST_ID, JSON.stringify(oldMetadata)]);
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]).toEqual({ metadata: { ...oldMetadata, amora_memory_policy: policy } });
      const stale = await db.query("UPDATE public.chat_messages SET metadata='{}'::jsonb WHERE metadata=$1::jsonb RETURNING id", [JSON.stringify(oldMetadata)]);
      expect(stale.rows).toHaveLength(0);
      await expect(db.query("UPDATE public.chat_messages SET segment_id=$1 WHERE metadata ? 'amora_memory_policy'", [OUTSIDER_ID])).rejects.toThrow("AMORA_SEGMENT_MESSAGE_SCOPE_IMMUTABLE");
      await resetPersona(db);
      expect((await db.query("SELECT message_id FROM public.amora_mediation_responses")).rows).toEqual([{ message_id: OUTSIDER_ID }]);
    } finally { await resetPersona(db).catch(() => undefined); await db.close(); }
  });

  it("is bounded, additive, and keeps the previous strict policy contract", () => {
    expect(migrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(migrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(migrationSql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migrationSql).toContain("SET LOCAL statement_timeout = '60s'");
    expect(migrationSql).toContain(
      "LOCK TABLE public.chat_messages IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(migrationSql).toMatch(
      /FUNCTION public\.enforce_chat_partner_recipient\(\)[\s\S]*LANGUAGE plpgsql[\s\S]*VOLATILE[\s\S]*FOR SHARE/,
    );
    expect(migrationSql).toContain("CREATE TRIGGER trg_enforce_chat_partner_recipient");
    expect(migrationSql).toMatch(
      /metadata - ARRAY\[[\s\S]*'target'[\s\S]*'imagePaths'[\s\S]*'confirmed_amora_action_id'[\s\S]*'client_request_id'[\s\S]*'partner_recipient_id'[\s\S]*\]::text\[\] = '\{\}'::jsonb/,
    );
    expect(migrationSql).toMatch(
      /NOT metadata \? 'client_request_id'[\s\S]*jsonb_typeof\(metadata -> 'client_request_id'\) = 'string'[\s\S]*\^\[0-9a-f\]/i,
    );
    expect(migrationSql).toContain("sender_id = auth.uid()");
    expect(migrationSql).toContain("public.can_access_couple_visibility(couple_id, visibility)");
    expect(migrationSql).toContain("CREATE POLICY chat_select_with_privacy");
    expect(migrationSql).toContain("confirmed_amora_action_id");
    expect(migrationSql).toContain("jsonb_array_length(metadata -> 'imagePaths') <= 5");
    expect(migrationSql).toContain("CHAT_USER_CLIENT_REQUEST_ID_POLICY_INVALID");
    expect(migrationSql).toContain("CHAT_USER_CLIENT_REQUEST_ID_INDEX_INVALID");
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it("allows legacy and valid UUID request metadata across safe delivery modes", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      await expect(insertUserMessage(db)).resolves.toBeDefined();
      await expect(insertUserMessage(db, {
        metadata: { client_request_id: REQUEST_ID },
        visibility: "bride_private",
      })).resolves.toBeDefined();
      await expect(insertUserMessage(db, {
        metadata: {
          client_request_id: "30000000-0000-4000-8000-000000000002",
          target: "partner",
          partner_recipient_id: GROOM_ID,
        },
      })).resolves.toBeDefined();
      await expect(insertUserMessage(db, {
        metadata: {
          client_request_id: "30000000-0000-4000-8000-000000000005",
          target: "partner",
        },
      })).resolves.toBeDefined();
      const autoPinned = await db.query<{ partner_recipient_id: string | null }>(`
        SELECT metadata ->> 'partner_recipient_id' AS partner_recipient_id
        FROM public.chat_messages
        WHERE metadata ->> 'client_request_id' =
          '30000000-0000-4000-8000-000000000005'
      `);
      expect(autoPinned.rows).toEqual([{ partner_recipient_id: GROOM_ID }]);
      await expect(insertUserMessage(db, {
        metadata: {
          client_request_id: "30000000-0000-4000-8000-000000000003",
          imagePaths: [
            `${COUPLE_ID}/${BRIDE_ID}/40000000-0000-4000-8000-000000000001.webp`,
          ],
        },
      })).resolves.toBeDefined();
      await expect(insertUserMessage(db, {
        metadata: {
          client_request_id: "30000000-0000-4000-8000-000000000004",
          confirmed_amora_action_id: "50000000-0000-4000-8000-000000000001",
        },
      })).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("backfills only legacy rows proven by a sealed complete roster", async () => {
    const db = await createDatabase();
    try {
      const result = await db.query<{
        content: string;
        partner_recipient_id: string | null;
      }>(`
        SELECT content, metadata ->> 'partner_recipient_id' AS partner_recipient_id
        FROM public.chat_messages
        WHERE content IN ('provable legacy partner row', 'ambiguous legacy partner row')
        ORDER BY content
      `);
      expect(result.rows).toEqual([
        {
          content: "ambiguous legacy partner row",
          partner_recipient_id: null,
        },
        {
          content: "provable legacy partner row",
          partner_recipient_id: GROOM_ID,
        },
      ]);
    } finally {
      await db.close();
    }
  });

  it("installs a private volatile row-lock trigger as the atomic boundary", async () => {
    const db = await createDatabase();
    try {
      const result = await db.query<{
        enabled: string;
        owner_name: string;
        prosecdef: boolean;
        provolatile: string;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT trigger_record.tgenabled AS enabled,
               pg_get_userbyid(procedure_record.proowner) AS owner_name,
               procedure_record.prosecdef,
               procedure_record.provolatile,
               has_function_privilege(
                 'authenticated',
                 'public.enforce_chat_partner_recipient()',
                 'EXECUTE'
               ) AS authenticated_execute,
               has_function_privilege(
                 'service_role',
                 'public.enforce_chat_partner_recipient()',
                 'EXECUTE'
               ) AS service_execute
        FROM pg_catalog.pg_trigger AS trigger_record
        JOIN pg_catalog.pg_proc AS procedure_record
          ON procedure_record.oid = trigger_record.tgfoid
        WHERE trigger_record.tgrelid = 'public.chat_messages'::regclass
          AND trigger_record.tgname = 'trg_enforce_chat_partner_recipient'
          AND NOT trigger_record.tgisinternal
      `);
      expect(result.rows).toEqual([{
        enabled: "O",
        owner_name: "postgres",
        prosecdef: true,
        provolatile: "v",
        authenticated_execute: false,
        service_execute: false,
      }]);
    } finally {
      await db.close();
    }
  });

  it("requires both couple members only for authenticated partner delivery", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, OUTSIDER_ID);

      await expect(insertUserMessage(db, {
        coupleId: OTHER_COUPLE_ID,
        senderId: OUTSIDER_ID,
        metadata: {
          target: "partner",
          client_request_id: "30000000-0000-4000-8000-000000000010",
          partner_recipient_id: SOLO_PARTNER_ID,
        },
      })).rejects.toThrow(/CHAT_PARTNER_DELIVERY_NOT_ALLOWED|row-level security/i);

      await expect(insertUserMessage(db, {
        coupleId: OTHER_COUPLE_ID,
        senderId: OUTSIDER_ID,
        metadata: {
          client_request_id: "30000000-0000-4000-8000-000000000011",
        },
      })).resolves.toBeDefined();
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES ($1, $2, 'bride', 'user', 'AI message without metadata', NULL, 'shared')`,
        [OTHER_COUPLE_ID, OUTSIDER_ID],
      )).resolves.toBeDefined();
      await expect(insertUserMessage(db, {
        coupleId: OTHER_COUPLE_ID,
        senderId: OUTSIDER_ID,
        metadata: {
          confirmed_amora_action_id: "50000000-0000-4000-8000-000000000010",
        },
      })).resolves.toBeDefined();

      await resetPersona(db);
      await db.exec("SET ROLE service_role");
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES ($1, NULL, 'amora', 'assistant', 'service AI response', NULL, 'shared')`,
        [OTHER_COUPLE_ID],
      )).resolves.toBeDefined();

      await resetPersona(db);
      await db.query(
        "UPDATE public.couples SET groom_id = $1 WHERE id = $2",
        [SOLO_PARTNER_ID, OTHER_COUPLE_ID],
      );
      await setAuthenticated(db, OUTSIDER_ID);
      await expect(insertUserMessage(db, {
        coupleId: OTHER_COUPLE_ID,
        senderId: OUTSIDER_ID,
        metadata: {
          target: "partner",
          client_request_id: "30000000-0000-4000-8000-000000000012",
          partner_recipient_id: SOLO_PARTNER_ID,
        },
      })).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("pins upgraded partner delivery while retaining the additive legacy write path", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      await expect(insertUserMessage(db, {
        metadata: {
          target: "partner",
          client_request_id: "30000000-0000-4000-8000-000000000020",
        },
      })).resolves.toBeDefined();
      await expect(insertUserMessage(db, {
        metadata: {
          target: "partner",
          partner_recipient_id: OUTSIDER_ID,
          client_request_id: "30000000-0000-4000-8000-000000000021",
        },
      })).rejects.toThrow(/CHAT_PARTNER_DELIVERY_NOT_ALLOWED|row-level security/i);
      await expect(insertUserMessage(db, {
        metadata: {
          target: "partner",
          partner_recipient_id: GROOM_ID,
          client_request_id: "30000000-0000-4000-8000-000000000022",
        },
      })).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("limits pinned partner rows to their sender and exact recipient after roster replacement", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      await insertUserMessage(db, {
        content: "pinned for original groom",
        metadata: {
          target: "partner",
          partner_recipient_id: GROOM_ID,
          client_request_id: "30000000-0000-4000-8000-000000000023",
        },
      });

      await resetPersona(db);
      await db.query(
        "UPDATE public.couples SET bride_id = NULL WHERE id = $1",
        [OTHER_COUPLE_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = NULL WHERE id = $1",
        [GROOM_ID],
      );
      await db.query(
        "UPDATE public.profiles SET couple_id = $1, role = 'groom' WHERE id = $2",
        [COUPLE_ID, OUTSIDER_ID],
      );
      await db.query(
        "UPDATE public.couples SET groom_id = $1 WHERE id = $2",
        [OUTSIDER_ID, COUPLE_ID],
      );

      await setAuthenticated(db, OUTSIDER_ID);
      const outsiderRows = await db.query<{ content: string }>(
        "SELECT content FROM public.chat_messages WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(outsiderRows.rows).toEqual([]);

      await resetPersona(db);
      await setAuthenticated(db, BRIDE_ID);
      const senderRows = await db.query<{ content: string }>(
        "SELECT content FROM public.chat_messages WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(senderRows.rows.map((row) => row.content)).toContain("pinned for original groom");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects malformed, service-reserved, unknown, and mismatched metadata", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      for (const clientRequestId of [
        "",
        "moment:forged-service-key",
        "not-a-uuid",
        null,
        42,
        {},
      ]) {
        await expect(insertUserMessage(db, {
          metadata: { client_request_id: clientRequestId },
        })).rejects.toThrow(/row-level security/i);
      }
      await expect(insertUserMessage(db, {
        metadata: { client_request_id: REQUEST_ID, unexpected: true },
      })).rejects.toThrow(/row-level security/i);
      await expect(insertUserMessage(db, {
        metadata: {
          client_request_id: "30000000-0000-4000-8000-000000000030",
          partner_recipient_id: GROOM_ID,
        },
      })).rejects.toThrow(/row-level security/i);
      await expect(insertUserMessage(db, {
        metadata: {
          client_request_id: "30000000-0000-4000-8000-000000000031",
          target: "partner",
          partner_recipient_id: GROOM_ID,
        },
        visibility: "bride_private",
      })).rejects.toThrow(/row-level security/i);
      await expect(insertUserMessage(db, {
        metadata: {
          client_request_id: REQUEST_ID,
          confirmed_amora_action_id: "50000000-0000-4000-8000-000000000001",
          target: "partner",
        },
      })).rejects.toThrow(/row-level security/i);
      await expect(insertUserMessage(db, {
        metadata: { client_request_id: REQUEST_ID },
        senderId: GROOM_ID,
        senderType: "groom",
      })).rejects.toThrow(/row-level security/i);
      await expect(insertUserMessage(db, {
        metadata: { client_request_id: REQUEST_ID },
        visibility: "groom_private",
      })).rejects.toThrow(/row-level security/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("enforces one request id per couple", async () => {
    const db = await createDatabase();
    try {
      await setAuthenticated(db, BRIDE_ID);
      await insertUserMessage(db, {
        metadata: { client_request_id: REQUEST_ID },
      });
      await expect(insertUserMessage(db, {
        metadata: { client_request_id: REQUEST_ID },
      })).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back when another permissive authenticated insert policy exists", async () => {
    const db = await createDatabase(false);
    try {
      await db.exec(`
        CREATE POLICY unsafe_extra_insert ON public.chat_messages
          FOR INSERT TO authenticated WITH CHECK (true)
      `);
      await expect(db.exec(migrationSql)).rejects.toThrow(
        /CHAT_USER_CLIENT_REQUEST_ID_POLICY_INVALID/,
      );
    } finally {
      await db.close();
    }
  });
});
