import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803113000_harden_ai_interactions_log_acl.sql",
  ),
  "utf8",
);

async function createExposedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SEQUENCE public.ai_interactions_log_probe_seq;
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      user_id uuid,
      couple_id uuid,
      session_id text,
      message_id uuid,
      interaction_type text,
      specialist_type text,
      user_input text,
      ai_output text,
      tool_name text,
      tool_input jsonb,
      tool_output jsonb,
      latency_ms integer,
      success boolean DEFAULT true,
      error_message text,
      model text,
      tokens_input integer,
      tokens_output integer,
      cost_usd numeric(10, 6),
      metadata jsonb DEFAULT '{}'::jsonb,
      amora_request_key text,
      amora_call_index integer,
      amora_call_source text,
      amora_call_phase text,
      amora_claim_token uuid,
      amora_cost_status text,
      amora_reserved_cost_microusd bigint NOT NULL DEFAULT 0,
      amora_actual_cost_microusd bigint,
      amora_global_counter_key text,
      amora_cost_couple_id uuid,
      amora_receipt_updated_at timestamptz,
      sequence_probe bigint NOT NULL DEFAULT nextval(
        'public.ai_interactions_log_probe_seq'::regclass
      )
    );
    ALTER SEQUENCE public.ai_interactions_log_probe_seq
      OWNED BY public.ai_interactions_log.sequence_probe;

    ALTER TABLE public.ai_interactions_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY leaked_authenticated_select
      ON public.ai_interactions_log
      FOR SELECT TO authenticated
      USING (true);
    CREATE POLICY leaked_anon_insert
      ON public.ai_interactions_log
      FOR INSERT TO anon
      WITH CHECK (true);
    CREATE POLICY leaked_public_all
      ON public.ai_interactions_log
      FOR ALL TO PUBLIC
      USING (true)
      WITH CHECK (true);
    CREATE POLICY legacy_service_all
      ON public.ai_interactions_log
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);

    GRANT ALL PRIVILEGES ON TABLE public.ai_interactions_log
      TO PUBLIC, anon, authenticated, service_role;
    GRANT SELECT (user_input), INSERT (ai_output), UPDATE (metadata),
      REFERENCES (couple_id)
      ON TABLE public.ai_interactions_log
      TO PUBLIC, anon, authenticated, service_role;
    GRANT ALL PRIVILEGES ON SEQUENCE public.ai_interactions_log_probe_seq
      TO PUBLIC, anon, authenticated, service_role;

    INSERT INTO public.ai_interactions_log (
      user_id,
      interaction_type,
      user_input,
      ai_output,
      metadata
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      'chat_turn',
      'sensitive user text',
      'sensitive model text',
      '{"source":"fixture"}'::jsonb
    );
  `);
  return db;
}

describe("ai_interactions_log exact ACL migration", () => {
  let db: PGlite | null = null;

  afterEach(async () => {
    await db?.exec("RESET ROLE").catch(() => undefined);
    await db?.close();
    db = null;
  });

  it("denies client roles, preserves only service reads/inserts, and replays", async () => {
    db = await createExposedDatabase();

    await db.exec(migration);
    await db.exec(migration);

    const rls = await db.query<{
      relforcerowsecurity: boolean;
      relrowsecurity: boolean;
    }>(`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_catalog.pg_class
      WHERE oid = 'public.ai_interactions_log'::regclass
    `);
    expect(rls.rows).toEqual([{
      relforcerowsecurity: true,
      relrowsecurity: true,
    }]);

    for (const role of ["anon", "authenticated"] as const) {
      const acl = await db.query<{
        can_delete: boolean;
        can_insert: boolean;
        can_references: boolean;
        can_select: boolean;
        can_trigger: boolean;
        can_truncate: boolean;
        can_update: boolean;
      }>(`
        SELECT
          has_table_privilege('${role}', 'public.ai_interactions_log', 'SELECT')
            AS can_select,
          has_table_privilege('${role}', 'public.ai_interactions_log', 'INSERT')
            AS can_insert,
          has_table_privilege('${role}', 'public.ai_interactions_log', 'UPDATE')
            AS can_update,
          has_table_privilege('${role}', 'public.ai_interactions_log', 'DELETE')
            AS can_delete,
          has_table_privilege('${role}', 'public.ai_interactions_log', 'TRUNCATE')
            AS can_truncate,
          has_table_privilege('${role}', 'public.ai_interactions_log', 'REFERENCES')
            AS can_references,
          has_table_privilege('${role}', 'public.ai_interactions_log', 'TRIGGER')
            AS can_trigger
      `);
      expect(acl.rows).toEqual([{
        can_delete: false,
        can_insert: false,
        can_references: false,
        can_select: false,
        can_trigger: false,
        can_truncate: false,
        can_update: false,
      }]);

      await db.exec(`SET ROLE ${role}`);
      await expect(
        db.query("SELECT user_input FROM public.ai_interactions_log"),
      ).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`
        INSERT INTO public.ai_interactions_log (interaction_type)
        VALUES ('chat_turn')
      `)).rejects.toThrow(/permission denied/i);
      await db.exec("RESET ROLE");
    }

    const columnLeaks = await db.query<{ leak_count: number }>(`
      SELECT count(*)::integer AS leak_count
      FROM pg_catalog.pg_attribute AS attribute_record
      CROSS JOIN LATERAL unnest(
        COALESCE(attribute_record.attacl, '{}'::aclitem[])
      ) AS raw_acl(acl_item)
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        ARRAY[raw_acl.acl_item]::aclitem[]
      ) AS acl_entry
      WHERE attribute_record.attrelid =
        'public.ai_interactions_log'::regclass
        AND attribute_record.attnum > 0
        AND NOT attribute_record.attisdropped
        AND acl_entry.grantee IN (
          0,
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon'),
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
        )
        AND acl_entry.privilege_type IN (
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        )
    `);
    expect(columnLeaks.rows).toEqual([{ leak_count: 0 }]);

    const serviceAcl = await db.query<{
      can_delete: boolean;
      can_insert: boolean;
      can_references: boolean;
      can_select: boolean;
      can_trigger: boolean;
      can_truncate: boolean;
      can_update: boolean;
    }>(`
      SELECT
        has_table_privilege(
          'service_role', 'public.ai_interactions_log', 'SELECT'
        ) AS can_select,
        has_table_privilege(
          'service_role', 'public.ai_interactions_log', 'INSERT'
        ) AS can_insert,
        has_table_privilege(
          'service_role', 'public.ai_interactions_log', 'UPDATE'
        ) AS can_update,
        has_table_privilege(
          'service_role', 'public.ai_interactions_log', 'DELETE'
        ) AS can_delete,
        has_table_privilege(
          'service_role', 'public.ai_interactions_log', 'TRUNCATE'
        ) AS can_truncate,
        has_table_privilege(
          'service_role', 'public.ai_interactions_log', 'REFERENCES'
        ) AS can_references,
        has_table_privilege(
          'service_role', 'public.ai_interactions_log', 'TRIGGER'
        ) AS can_trigger
    `);
    expect(serviceAcl.rows).toEqual([{
      can_delete: false,
      can_insert: true,
      can_references: false,
      can_select: true,
      can_trigger: false,
      can_truncate: false,
      can_update: false,
    }]);

    const sequenceAcl = await db.query<{
      anon_usage: boolean;
      authenticated_usage: boolean;
      service_select: boolean;
      service_update: boolean;
      service_usage: boolean;
    }>(`
      SELECT
        has_sequence_privilege(
          'anon', 'public.ai_interactions_log_probe_seq', 'USAGE'
        ) AS anon_usage,
        has_sequence_privilege(
          'authenticated', 'public.ai_interactions_log_probe_seq', 'USAGE'
        ) AS authenticated_usage,
        has_sequence_privilege(
          'service_role', 'public.ai_interactions_log_probe_seq', 'USAGE'
        ) AS service_usage,
        has_sequence_privilege(
          'service_role', 'public.ai_interactions_log_probe_seq', 'SELECT'
        ) AS service_select,
        has_sequence_privilege(
          'service_role', 'public.ai_interactions_log_probe_seq', 'UPDATE'
        ) AS service_update
    `);
    expect(sequenceAcl.rows).toEqual([{
      anon_usage: false,
      authenticated_usage: false,
      service_select: false,
      service_update: false,
      service_usage: true,
    }]);

    const policies = await db.query<{
      policy_command: string;
      policy_name: string;
      policy_role: string;
    }>(`
      SELECT
        policy_record.polname AS policy_name,
        policy_record.polcmd AS policy_command,
        CASE
          WHEN policy_role.oid = 0 THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(policy_role.oid)
        END AS policy_role
      FROM pg_catalog.pg_policy AS policy_record
      CROSS JOIN LATERAL unnest(policy_record.polroles) AS policy_role(oid)
      WHERE policy_record.polrelid =
        'public.ai_interactions_log'::regclass
      ORDER BY policy_record.polname, policy_role.oid
    `);
    expect(policies.rows).toEqual([
      {
        policy_command: "a",
        policy_name: "ai_interactions_log_service_insert",
        policy_role: "service_role",
      },
      {
        policy_command: "r",
        policy_name: "ai_interactions_log_service_select",
        policy_role: "service_role",
      },
    ]);

    await db.exec("SET ROLE service_role");
    const inserted = await db.query<{ sequence_probe: bigint }>(`
      INSERT INTO public.ai_interactions_log (
        interaction_type,
        user_input,
        ai_output
      ) VALUES (
        'chat_turn',
        NULL,
        NULL
      )
      RETURNING sequence_probe
    `);
    expect(inserted.rows).toHaveLength(1);
    expect((await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM public.ai_interactions_log
    `)).rows).toEqual([{ count: 2 }]);
    await expect(db.exec(`
      UPDATE public.ai_interactions_log SET metadata = '{}'::jsonb
    `)).rejects.toThrow(/permission denied/i);
    await expect(db.exec(`
      DELETE FROM public.ai_interactions_log
    `)).rejects.toThrow(/permission denied/i);
  }, 30_000);

  it("fails closed when a required API role is absent", async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    `);

    await expect(db.exec(migration)).rejects.toThrow(
      /AI_LOG_ACL_ROLE_MISSING: authenticated/i,
    );
  });

  it("fails closed when the ledger table is absent", async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    `);

    await expect(db.exec(migration)).rejects.toThrow(
      /AI_LOG_ACL_TABLE_MISSING/i,
    );
  });

  it("fails closed when a required sensitive column is absent", async () => {
    db = await createExposedDatabase();
    await db.exec(`
      ALTER TABLE public.ai_interactions_log DROP COLUMN user_input;
    `);

    await expect(db.exec(migration)).rejects.toThrow(
      /AI_LOG_ACL_COLUMN_MISSING_OR_WRONG_TYPE: user_input/i,
    );
  });

  it("fails closed instead of silently preserving an unreviewed column grantee", async () => {
    db = await createExposedDatabase();
    await db.exec(`
      CREATE ROLE legacy_ai_log_reader NOLOGIN;
      GRANT SELECT (user_input)
        ON TABLE public.ai_interactions_log
        TO legacy_ai_log_reader;
    `);

    await expect(db.exec(migration)).rejects.toThrow(
      /AI_LOG_ACL_COLUMN_PRIVILEGE_REMAINS: legacy_ai_log_reader user_input SELECT/i,
    );
  });
});
