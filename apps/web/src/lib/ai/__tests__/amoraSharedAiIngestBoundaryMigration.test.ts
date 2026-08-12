// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const deliveryMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260801090000_amora_chat_delivery_safety.sql",
  ),
  "utf8",
);
const activeBoundaryMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260812090000_amora_server_only_chat_ingest.sql",
);
const providerMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260811230000_amora_provider_egress_grant.sql",
);
const boundaryCandidatePath = resolve(
  process.cwd(),
  "../../supabase/release-candidates/amora-safety-20260804/wave-b-fleet-gated-shared-ingest-rls/20260803100000_amora_shared_ai_ingest_boundary.sql",
);
const mobileChatPath = resolve(process.cwd(), "../mobile/app/(tabs)/chat.tsx");
const webChatStorePath = resolve(process.cwd(), "src/stores/chatStore.ts");
const previewIntegrationPath = resolve(
  process.cwd(),
  "scripts/amora-preview-integration.mjs",
);

function readBoundaryMigrationSql() {
  return readFileSync(activeBoundaryMigrationPath, "utf8");
}

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

async function createDatabase(applyBoundary = true) {
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
    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}');
    INSERT INTO public.couples(
      id, bride_id, groom_id, membership_sealed_at
    ) VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}', now());
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom');
  `);
  await db.exec(deliveryMigrationSql);
  if (applyBoundary) await db.exec(readBoundaryMigrationSql());
  return db;
}

async function asRole(db: PGlite, role: "authenticated" | "service_role", userId?: string) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
    userId ?? "",
  ]);
}

async function resetRole(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

async function insertMessage(
  db: PGlite,
  options: {
    metadata?: unknown;
    visibility?: "shared" | "bride_private";
    requestId?: string;
  } = {},
) {
  const metadata = {
    ...(options.metadata && typeof options.metadata === "object"
      ? options.metadata
      : {}),
    ...(options.requestId ? { client_request_id: options.requestId } : {}),
  };
  return db.query(
    `INSERT INTO public.chat_messages(
       couple_id, sender_id, sender_type, role, content, metadata, visibility
     ) VALUES ($1, $2, 'bride', 'user', '안전한 준비 질문', $3::jsonb, $4)
     RETURNING id, metadata`,
    [
      COUPLE_ID,
      BRIDE_ID,
      JSON.stringify(metadata),
      options.visibility ?? "shared",
    ],
  );
}

describe("Amora server-only user-message ingest RLS boundary", () => {
  it("promotes reviewed Wave B after the provider grant as a new additive migration", () => {
    expect(existsSync(boundaryCandidatePath)).toBe(true);
    expect(existsSync(providerMigrationPath)).toBe(true);
    expect(existsSync(activeBoundaryMigrationPath)).toBe(true);
    expect(activeBoundaryMigrationPath).toContain("20260812090000");
    expect(activeBoundaryMigrationPath.localeCompare(providerMigrationPath)).toBeGreaterThan(0);
  });

  it("keeps supported clients and synthetic fixtures behind API or service ingest", () => {
    const mobileChatSource = readFileSync(mobileChatPath, "utf8");
    const webChatStoreSource = readFileSync(webChatStorePath, "utf8");
    const previewIntegrationSource = readFileSync(previewIntegrationPath, "utf8");
    const directChatInsert =
      /\.from\(\s*["']chat_messages["']\s*\)[\s\S]{0,500}?\.(?:insert|upsert)\s*\(/u;

    expect(mobileChatSource).toContain(
      "fetch(`${API_BASE}/api/chat/messages`",
    );
    expect(mobileChatSource).toContain("target: draft.target");
    expect(mobileChatSource).not.toMatch(directChatInsert);

    expect(webChatStoreSource).toContain('fetch("/api/chat/messages"');
    expect(webChatStoreSource).toMatch(/body:\s*JSON\.stringify\([\s\S]{0,500}?target,/u);
    expect(webChatStoreSource).not.toMatch(directChatInsert);

    expect(previewIntegrationSource).not.toMatch(
      /\b(?:bride|groom|user)\.client\.from\(["']chat_messages["']\)\.insert\(/u,
    );
    expect(previewIntegrationSource).toMatch(
      /\badmin\.from\(["']chat_messages["']\)\.insert\(/u,
    );
  });

  it("is bounded, additive, rerunnable, and removes every authenticated INSERT path", async () => {
    const boundaryMigrationSql = readBoundaryMigrationSql();
    expect(boundaryMigrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(boundaryMigrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(boundaryMigrationSql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(boundaryMigrationSql).toContain("SET LOCAL statement_timeout = '60s'");
    expect(boundaryMigrationSql).toContain(
      "LOCK TABLE public.chat_messages IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(boundaryMigrationSql).not.toContain(
      "CREATE POLICY chat_messages_insert_own_user",
    );
    expect(boundaryMigrationSql).toContain("has_any_column_privilege");
    expect(boundaryMigrationSql).toContain(
      "AMORA_SHARED_AI_INGEST_BOUNDARY_INVALID",
    );
    expect(boundaryMigrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);

    const db = await createDatabase();
    try {
      await expect(db.exec(boundaryMigrationSql)).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("leaves RLS on with no client INSERT grant or policy and one service writer", async () => {
    const db = await createDatabase();
    try {
      const state = await db.query<{
        rls_enabled: boolean;
        authenticated_table_insert: boolean;
        authenticated_column_insert: boolean;
        anon_table_insert: boolean;
        anon_column_insert: boolean;
        service_table_insert: boolean;
        client_insert_policy_count: number;
      }>(`
        SELECT
          relation.relrowsecurity AS rls_enabled,
          has_table_privilege(
            'authenticated', 'public.chat_messages', 'INSERT'
          ) AS authenticated_table_insert,
          has_any_column_privilege(
            'authenticated', 'public.chat_messages', 'INSERT'
          ) AS authenticated_column_insert,
          has_table_privilege(
            'anon', 'public.chat_messages', 'INSERT'
          ) AS anon_table_insert,
          has_any_column_privilege(
            'anon', 'public.chat_messages', 'INSERT'
          ) AS anon_column_insert,
          has_table_privilege(
            'service_role', 'public.chat_messages', 'INSERT'
          ) AS service_table_insert,
          (
            SELECT count(*)::integer
              FROM pg_catalog.pg_policies
             WHERE schemaname = 'public'
               AND tablename = 'chat_messages'
               AND cmd IN ('ALL', 'INSERT')
               AND roles && ARRAY[
                 'public'::name,
                 'anon'::name,
                 'authenticated'::name
               ]
          ) AS client_insert_policy_count
        FROM pg_catalog.pg_class AS relation
        WHERE relation.oid = 'public.chat_messages'::regclass
      `);

      expect(state.rows).toEqual([{
        rls_enabled: true,
        authenticated_table_insert: false,
        authenticated_column_insert: false,
        anon_table_insert: false,
        anon_column_insert: false,
        service_table_insert: true,
        client_insert_policy_count: 0,
      }]);
    } finally {
      await db.close();
    }
  });

  it.each([
    ["empty metadata", {}],
    ["explicit AI target", { target: "ai" }],
    ["request id", { client_request_id: REQUEST_ID }],
    [
      "confirmed action",
      {
        confirmed_amora_action_id:
          "50000000-0000-4000-8000-000000000001",
      },
    ],
  ])("rejects authenticated shared AI direct INSERT: %s", async (_label, metadata) => {
    const db = await createDatabase();
    try {
      await asRole(db, "authenticated", BRIDE_ID);
      await expect(insertMessage(db, { metadata })).rejects.toThrow();
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("blocks private and partner direct writes while service ingest can write both", async () => {
    const db = await createDatabase();
    try {
      await asRole(db, "authenticated", BRIDE_ID);
      await expect(
        insertMessage(db, { visibility: "bride_private", requestId: REQUEST_ID }),
      ).rejects.toThrow();
      await expect(insertMessage(db, {
        metadata: {
          target: "partner",
          client_request_id: "30000000-0000-4000-8000-000000000002",
        },
      })).rejects.toThrow();

      await resetRole(db);
      await asRole(db, "service_role");
      await expect(
        insertMessage(db, {
          metadata: {
            client_request_id: "30000000-0000-4000-8000-000000000003",
          },
        }),
      ).resolves.toBeDefined();
      await expect(insertMessage(db, {
        metadata: {
          target: "partner",
          client_request_id: "30000000-0000-4000-8000-000000000004",
        },
      })).resolves.toBeDefined();
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("preserves request-id uniqueness and leaves SELECT privacy unchanged", async () => {
    const db = await createDatabase(false);
    try {
      const before = await db.query<{ qual: string }>(`
        SELECT qual
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'chat_messages'
          AND policyname = 'chat_select_with_privacy'
      `);
      await db.exec(readBoundaryMigrationSql());
      const after = await db.query<{ qual: string }>(`
        SELECT qual
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'chat_messages'
          AND policyname = 'chat_select_with_privacy'
      `);
      expect(after.rows).toEqual(before.rows);

      await asRole(db, "service_role");
      await insertMessage(db, { requestId: REQUEST_ID });
      await expect(insertMessage(db, { requestId: REQUEST_ID })).rejects.toThrow();
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back when another permissive authenticated INSERT policy exists", async () => {
    const db = await createDatabase(false);
    try {
      await db.exec(`
        CREATE POLICY unsafe_extra_insert ON public.chat_messages
          FOR INSERT TO authenticated WITH CHECK (true)
      `);
      await expect(db.exec(readBoundaryMigrationSql())).rejects.toThrow(
        /AMORA_SHARED_AI_INGEST_PRECONDITION_INVALID/,
      );
      await db.exec("ROLLBACK").catch(() => undefined);
      const policies = await db.query<{ policyname: string }>(`
        SELECT policyname
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'chat_messages'
          AND cmd = 'INSERT'
        ORDER BY policyname
      `);
      expect(policies.rows.map((row) => row.policyname)).toEqual([
        "chat_messages_insert_own_user",
        "unsafe_extra_insert",
      ]);
    } finally {
      await db.close();
    }
  });
});
