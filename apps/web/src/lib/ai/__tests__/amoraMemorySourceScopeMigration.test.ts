// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const memoryMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716090000_amora_memory_engine_v2.sql"),
  "utf8",
);
const activeSourceScopeMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260803090000_amora_memory_source_scope_boundary.sql",
);
const sourceScopeCandidatePath = resolve(
  process.cwd(),
  "../../supabase/release-candidates/amora-safety-20260804/wave-a-memory-source-scope/20260803090000_amora_memory_source_scope_boundary.sql",
);

function readSourceScopeMigration() {
  return readFileSync(sourceScopeCandidatePath, "utf8");
}

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

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

    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
  `);
  await db.exec(memoryMigration);
  await db.exec(readSourceScopeMigration());
  await db.exec("SET ROLE service_role");
  await db.query(
    "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
    [COUPLE_ID, BRIDE_ID],
  );
  await db.query(
    "SELECT public.set_amora_memory_consent($1, 'shared', $2, true)",
    [COUPLE_ID, GROOM_ID],
  );
  return db;
}

async function insertSourceAndAssistant(
  db: PGlite,
  input: {
    sourceId: string;
    assistantId: string;
    scope: unknown;
    memoryEligible: unknown;
    linkedSourceId?: string;
    assistantSenderId?: string | null;
  },
) {
  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, visibility, created_at
     ) VALUES ($1, $2, $3, 'bride', 'user', '결혼식 총예산은 3천만원', 'shared', now() + interval '1 minute')`,
    [input.sourceId, COUPLE_ID, BRIDE_ID],
  );
  await db.query(
    `INSERT INTO public.chat_messages(
       id, couple_id, sender_id, sender_type, role, content, metadata, visibility, created_at
     ) VALUES (
       $1, $2, $3, 'ai', 'assistant', '예산 기준을 정리했어요',
       jsonb_build_object(
         'in_reply_to_user_message_id', $4::text,
         'question_scope', $5::jsonb,
         'memory_eligible', $6::jsonb
       ),
       'shared', now() + interval '2 minutes'
     )`,
    [
      input.assistantId,
      COUPLE_ID,
      input.assistantSenderId ?? null,
      input.linkedSourceId ?? input.sourceId,
      JSON.stringify(input.scope),
      JSON.stringify(input.memoryEligible),
    ],
  );
}

async function upsertMemory(db: PGlite, sourceId: string, key: string) {
  return db.query(
    `SELECT public.upsert_amora_memory_node(
       $1, 'shared', $2, 'budget', '총예산', '3천만원', NULL,
       0.91, 'considering', $3, '{"explicit":true}'::jsonb
     )`,
    [COUPLE_ID, key, sourceId],
  );
}

describe("Amora memory source-scope migration", () => {
  it("stages Wave A outside the active Supabase migration directory", () => {
    expect(existsSync(sourceScopeCandidatePath)).toBe(true);
    expect(existsSync(activeSourceScopeMigrationPath)).toBe(false);
  });

  it("declares an atomic, drift-detecting migration contract", () => {
    const sourceScopeMigration = readSourceScopeMigration();
    expect(sourceScopeMigration).toContain("\nBEGIN;\n");
    expect(sourceScopeMigration.trimEnd()).toMatch(/COMMIT;$/);
    expect(sourceScopeMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sourceScopeMigration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(sourceScopeMigration).toContain("to_regprocedure(");
    expect(sourceScopeMigration).toContain("attname = 'metadata'");
    expect(sourceScopeMigration).toContain("AMORA_MEMORY_SOURCE_SCOPE_PRECONDITION_INVALID");
  });

  it("reruns safely, stores only a linked canonical W0/W1 source, and rejects every untrusted provenance", async () => {
    const sourceScopeMigration = readSourceScopeMigration();
    const db = await createDatabase();
    try {
      await db.exec("RESET ROLE");
      await expect(db.exec(sourceScopeMigration)).resolves.toBeDefined();
      await db.exec("SET ROLE service_role");

      const privileges = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(
        `SELECT
           has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute,
           has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute,
           has_function_privilege('service_role', $1, 'EXECUTE') AS service_execute`,
        ["public.upsert_amora_memory_node(uuid,text,text,text,text,text,text,numeric,text,uuid,jsonb)"],
      );
      expect(privileges.rows[0]).toEqual({
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
      });

      const eligibleSource = "30000000-0000-4000-8000-000000000001";
      await insertSourceAndAssistant(db, {
        sourceId: eligibleSource,
        assistantId: "30000000-0000-4000-8000-000000000002",
        scope: "W0_wedding_core",
        memoryEligible: true,
      });
      await expect(upsertMemory(db, eligibleSource, "budget:eligible"))
        .resolves.toBeDefined();

      const rejected = [
        { scope: "W2_high_risk_adjacent", memoryEligible: false },
        { scope: "W3_social_care", memoryEligible: true },
        { scope: "W4_out_of_scope", memoryEligible: true },
        { scope: "W5_safety_override", memoryEligible: true },
        { scope: "W0-wedding-core", memoryEligible: true },
        {
          scope: "W0_wedding_core",
          memoryEligible: true,
          linkedSourceId: "90000000-0000-4000-8000-000000000099",
        },
        {
          scope: "W0_wedding_core",
          memoryEligible: true,
          assistantSenderId: BRIDE_ID,
        },
      ];

      for (const [index, candidate] of rejected.entries()) {
        const suffix = String(index + 10).padStart(12, "0");
        const sourceId = `30000000-0000-4000-8000-${suffix}`;
        const assistantId = `40000000-0000-4000-8000-${suffix}`;
        await insertSourceAndAssistant(db, {
          sourceId,
          assistantId,
          ...candidate,
        });
        await expect(upsertMemory(db, sourceId, `budget:rejected_${index}`))
          .rejects.toThrow(/AMORA_MEMORY_SOURCE_INVALID/);
      }

      const nodes = await db.query<{ memory_key: string }>(
        "SELECT memory_key FROM public.decision_nodes ORDER BY memory_key",
      );
      expect(nodes.rows).toEqual([{ memory_key: "budget:eligible" }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
