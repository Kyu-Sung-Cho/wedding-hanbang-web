// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260716116000_ai_log_retention_contract.sql",
);
const releasePostPath = resolve(
  process.cwd(),
  "../../supabase/release-checks/amora-engine-v2-20260716-post.sql",
);

function extractNamedDoBlock(sql: string, label: string): string {
  const marker = `$${label}$`;
  const start = sql.indexOf(`DO ${marker}`);
  const end = sql.indexOf(`${marker};`, start + marker.length);
  if (start < 0 || end < 0) {
    throw new Error(`missing release-post block: ${label}`);
  }
  return sql.slice(start, end + marker.length + 1);
}

const retentionReleasePost = extractNamedDoBlock(
  readFileSync(releasePostPath, "utf8"),
  "post_ai_retention_1160",
);

async function createHotfixedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE unreviewed_retention_operator;

    CREATE TABLE public.ai_interactions_log (
      id integer PRIMARY KEY,
      created_at timestamptz NOT NULL,
      user_input text,
      ai_output text,
      tool_input jsonb,
      tool_output jsonb,
      error_message text,
      metadata jsonb
    );

    CREATE OR REPLACE FUNCTION public.redact_old_ai_interactions(
      p_retention interval DEFAULT interval '90 days'
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $legacy$
    DECLARE
      v_count integer;
    BEGIN
      UPDATE public.ai_interactions_log
         SET user_input = '[legacy_redacted]'
       WHERE created_at < now() - p_retention;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RETURN v_count;
    END;
    $legacy$;

    ALTER FUNCTION public.redact_old_ai_interactions(interval) OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.redact_old_ai_interactions(interval)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
      TO unreviewed_retention_operator;

    INSERT INTO public.ai_interactions_log (
      id,
      created_at,
      user_input,
      ai_output,
      tool_input,
      tool_output,
      metadata
    ) VALUES
      (
        1,
        now() - interval '120 days',
        'old-user-input',
        'old-ai-output',
        '{"secret":"tool-input"}',
        '{"secret":"tool-output"}',
        '{"source":"fixture"}'
      ),
      (
        2,
        now() - interval '30 days',
        'recent-user-input',
        'recent-ai-output',
        '{"recent":"tool-input"}',
        '{"recent":"tool-output"}',
        '{"source":"recent-fixture"}'
      );
  `);
  return db;
}

describe("AI-log retention migration contract", () => {
  let db: PGlite | null = null;

  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it("does not run the destructive retention function during migration", async () => {
    db = await createHotfixedDatabase();

    await db.exec(readFileSync(migrationPath, "utf8"));

    const result = await db.query<{
      user_input: string;
      ai_output: string;
      tool_input: { secret: string };
      tool_output: { secret: string };
      metadata: { source: string };
    }>(`
      SELECT user_input, ai_output, tool_input, tool_output, metadata
        FROM public.ai_interactions_log
       WHERE id = 1
    `);

    expect(result.rows).toEqual([{
      user_input: "old-user-input",
      ai_output: "old-ai-output",
      tool_input: { secret: "tool-input" },
      tool_output: { secret: "tool-output" },
      metadata: { source: "fixture" },
    }]);
  });

  it("changes no row for arbitrary or negative intervals and redacts only the exact 90-day window", async () => {
    db = await createHotfixedDatabase();
    await db.exec(readFileSync(migrationPath, "utf8"));
    await db.exec("SET ROLE service_role;");

    for (const rejectedInterval of [
      "-1 day",
      "89 days 23 hours",
      "3 months",
    ]) {
      await expect(
        db.query(
          "SELECT public.redact_old_ai_interactions($1::interval)",
          [rejectedInterval],
        ),
      ).rejects.toThrow(/exactly 90 days/i);
    }

    await db.exec("RESET ROLE;");
    const unchanged = await db.query<{
      id: number;
      user_input: string;
      ai_output: string;
    }>(`
      SELECT id, user_input, ai_output
        FROM public.ai_interactions_log
       ORDER BY id
    `);
    expect(unchanged.rows).toEqual([
      { id: 1, user_input: "old-user-input", ai_output: "old-ai-output" },
      { id: 2, user_input: "recent-user-input", ai_output: "recent-ai-output" },
    ]);

    await db.exec("SET ROLE service_role;");
    const execution = await db.query<{ redacted: number }>(`
      SELECT public.redact_old_ai_interactions(interval '90 days') AS redacted
    `);
    expect(execution.rows).toEqual([{ redacted: 1 }]);

    await db.exec("RESET ROLE;");
    const result = await db.query<{
      id: number;
      user_input: string;
      ai_output: string;
      tool_input: unknown;
      tool_output: unknown;
      retention_policy: string | null;
    }>(`
      SELECT
        id,
        user_input,
        ai_output,
        tool_input,
        tool_output,
        metadata->>'retention_policy' AS retention_policy
      FROM public.ai_interactions_log
      ORDER BY id
    `);
    expect(result.rows).toEqual([
      {
        id: 1,
        user_input: "[redacted_after_retention]",
        ai_output: "[redacted_after_retention]",
        tool_input: null,
        tool_output: null,
        retention_policy: "raw_payload_90d",
      },
      {
        id: 2,
        user_input: "recent-user-input",
        ai_output: "recent-ai-output",
        tool_input: { recent: "tool-input" },
        tool_output: { recent: "tool-output" },
        retention_policy: null,
      },
    ]);
  });

  it("removes free-form metadata and error text while retaining only bounded cost evidence", async () => {
    db = await createHotfixedDatabase();
    await db.exec(readFileSync(migrationPath, "utf8"));
    await db.exec(`
      INSERT INTO public.ai_interactions_log (
        id, created_at, user_input, ai_output, tool_input, tool_output,
        error_message, metadata
      ) VALUES (
        7,
        now() - interval '120 days',
        'private prompt',
        'private response',
        '{"secret":"tool-input"}',
        '{"secret":"tool-output"}',
        'customer phone 010-1234-5678',
        '{
          "target_title":"private post title",
          "reason":"free-form moderator note",
          "source":"bypass-writer",
          "ledger_status":"settled",
          "provider_attempted":true,
          "usage_status":"complete",
          "unknown_paid_attempt":false,
          "cache_creation_input_tokens":120,
          "cache_read_input_tokens":80
        }'::jsonb
      );
      SET ROLE service_role;
      SELECT public.redact_old_ai_interactions(interval '90 days');
      RESET ROLE;
    `);

    const result = await db.query<{
      error_message: string;
      metadata: Record<string, unknown>;
    }>(`
      SELECT error_message, metadata
      FROM public.ai_interactions_log
      WHERE id = 7
    `);

    expect(result.rows[0]?.error_message).toBe("[redacted_after_retention]");
    expect(result.rows[0]?.metadata).toMatchObject({
      ledger_status: "settled",
      provider_attempted: true,
      usage_status: "complete",
      unknown_paid_attempt: false,
      cache_creation_input_tokens: 120,
      cache_read_input_tokens: 80,
      retention_policy: "raw_payload_90d",
    });
    expect(result.rows[0]?.metadata).not.toHaveProperty("target_title");
    expect(result.rows[0]?.metadata).not.toHaveProperty("reason");
    expect(result.rows[0]?.metadata).not.toHaveProperty("source");
  });

  it("repairs premarked rows that contain null or invalid allowlisted values", async () => {
    db = await createHotfixedDatabase();
    await db.exec(readFileSync(migrationPath, "utf8"));
    await db.exec(`
      INSERT INTO public.ai_interactions_log (
        id, created_at, user_input, ai_output, tool_input, tool_output,
        error_message, metadata
      ) VALUES (
        8,
        now() - interval '120 days',
        '[redacted_after_retention]',
        '[redacted_after_retention]',
        NULL,
        NULL,
        NULL,
        '{
          "ledger_status":null,
          "retention_policy":"raw_payload_90d",
          "retention_redacted_at":"2020-01-01T00:00:00Z"
        }'::jsonb
      ), (
        9,
        now() - interval '120 days',
        '[redacted_after_retention]',
        '[redacted_after_retention]',
        NULL,
        NULL,
        NULL,
        '{
          "ledger_status":"unexpected",
          "provider_attempted":"true",
          "usage_status":"partial",
          "unknown_paid_attempt":"false",
          "cache_creation_input_tokens":-1,
          "cache_read_input_tokens":1000000001,
          "retention_policy":"raw_payload_90d",
          "retention_redacted_at":"2020-01-01T00:00:00Z"
        }'::jsonb
      ), (
        10,
        now() - interval '120 days',
        '[redacted_after_retention]',
        '[redacted_after_retention]',
        NULL,
        NULL,
        NULL,
        '{
          "retention_policy":"raw_payload_90d",
          "retention_redacted_at":{"private_note":"must not survive"}
        }'::jsonb
      );
      SET ROLE service_role;
    `);

    const execution = await db.query<{ redacted: number }>(`
      SELECT public.redact_old_ai_interactions(interval '90 days') AS redacted
    `);
    expect(execution.rows).toEqual([{ redacted: 4 }]);
    await db.exec("RESET ROLE;");

    const result = await db.query<{ metadata: Record<string, unknown> }>(`
      SELECT metadata FROM public.ai_interactions_log WHERE id IN (8, 9, 10)
      ORDER BY id
    `);
    for (const row of result.rows) {
      expect(Object.keys(row.metadata).sort()).toEqual([
        "retention_policy",
        "retention_redacted_at",
      ]);
    }
  });

  it("discards malformed metadata containers and writes one idempotent object marker", async () => {
    db = await createHotfixedDatabase();
    await db.exec(readFileSync(migrationPath, "utf8"));
    await db.exec(`
      INSERT INTO public.ai_interactions_log (
        id, created_at, user_input, ai_output, tool_input, tool_output, metadata
      ) VALUES
        (3, now() - interval '120 days', 'array-user', 'array-ai',
          '{"secret":"array-tool"}', NULL, '["malformed-secret"]'::jsonb),
        (4, now() - interval '120 days', 'scalar-user', 'scalar-ai',
          NULL, '{"secret":"scalar-tool"}', '"malformed-secret"'::jsonb),
        (5, now() - interval '120 days', 'null-user', 'null-ai',
          NULL, NULL, NULL),
        (6, now() - interval '120 days', 'premarked-user', 'premarked-ai',
          '{"secret":"premarked-tool-input"}',
          '{"secret":"premarked-tool-output"}',
          '{"source":"premarked-fixture","retention_policy":"raw_payload_90d",
            "retention_redacted_at":"2020-01-01T00:00:00Z"}'::jsonb);
      SET ROLE service_role;
    `);

    const first = await db.query<{ redacted: number }>(`
      SELECT public.redact_old_ai_interactions(interval '90 days') AS redacted
    `);
    expect(first.rows).toEqual([{ redacted: 5 }]);

    await db.exec("RESET ROLE;");
    const afterFirst = await db.query<{
      id: number;
      user_input: string;
      ai_output: string;
      tool_input: unknown;
      tool_output: unknown;
      metadata_type: string;
      metadata: Record<string, unknown>;
    }>(`
      SELECT id, user_input, ai_output, tool_input, tool_output,
        jsonb_typeof(metadata) AS metadata_type, metadata
      FROM public.ai_interactions_log
      WHERE id IN (3, 4, 5, 6)
      ORDER BY id
    `);
    for (const row of afterFirst.rows) {
      expect(row).toMatchObject({
        user_input: "[redacted_after_retention]",
        ai_output: "[redacted_after_retention]",
        tool_input: null,
        tool_output: null,
        metadata_type: "object",
        metadata: { retention_policy: "raw_payload_90d" },
      });
      expect(Object.keys(row.metadata).sort()).toEqual([
        "retention_policy",
        "retention_redacted_at",
      ]);
    }

    await db.exec("SET ROLE service_role;");
    const second = await db.query<{ redacted: number }>(`
      SELECT public.redact_old_ai_interactions(interval '90 days') AS redacted
    `);
    expect(second.rows).toEqual([{ redacted: 0 }]);
    await db.exec("RESET ROLE;");

    const afterSecond = await db.query<{ id: number; metadata: Record<string, unknown> }>(`
      SELECT id, metadata
      FROM public.ai_interactions_log
      WHERE id IN (3, 4, 5, 6)
      ORDER BY id
    `);
    expect(afterSecond.rows).toEqual(afterFirst.rows.map(({ id, metadata }) => ({
      id,
      metadata,
    })));
  });

  it("restores the empty-search-path owner and service-only execution contract", async () => {
    db = await createHotfixedDatabase();
    await db.exec(`
      GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
        TO PUBLIC, anon, authenticated;
    `);

    await db.exec(readFileSync(migrationPath, "utf8"));

    const contract = await db.query<{
      security_definer: boolean;
      owner_name: string;
      runtime_config: string[] | null;
      function_definition: string;
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_execute: boolean;
      public_execute: boolean;
      unreviewed_execute: boolean;
      execute_grantees: string[] | null;
    }>(`
      SELECT
        procedure_record.prosecdef AS security_definer,
        pg_get_userbyid(procedure_record.proowner) AS owner_name,
        procedure_record.proconfig AS runtime_config,
        pg_get_functiondef(procedure_record.oid) AS function_definition,
        has_function_privilege(
          'anon', procedure_record.oid, 'EXECUTE'
        ) AS anon_execute,
        has_function_privilege(
          'authenticated', procedure_record.oid, 'EXECUTE'
        ) AS authenticated_execute,
        has_function_privilege(
          'service_role', procedure_record.oid, 'EXECUTE'
        ) AS service_execute,
        EXISTS (
          SELECT 1
            FROM aclexplode(COALESCE(
              procedure_record.proacl,
              acldefault('f', procedure_record.proowner)
            )) AS acl_entry
           WHERE acl_entry.grantee = 0
             AND acl_entry.privilege_type = 'EXECUTE'
        ) AS public_execute,
        has_function_privilege(
          'unreviewed_retention_operator', procedure_record.oid, 'EXECUTE'
        ) AS unreviewed_execute,
        (
          SELECT array_agg(
            DISTINCT pg_get_userbyid(acl_entry.grantee)
            ORDER BY pg_get_userbyid(acl_entry.grantee)
          )
          FROM aclexplode(COALESCE(
            procedure_record.proacl,
            acldefault('f', procedure_record.proowner)
          )) AS acl_entry
          WHERE acl_entry.privilege_type = 'EXECUTE'
        ) AS execute_grantees
      FROM pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'public.redact_old_ai_interactions(interval)'::regprocedure
    `);

    expect(contract.rows).toHaveLength(1);
    expect(contract.rows[0]).toMatchObject({
      security_definer: true,
      owner_name: "postgres",
      runtime_config: ['search_path=""'],
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
      public_execute: false,
      unreviewed_execute: false,
      execute_grantees: ["postgres", "service_role"],
    });
    expect(contract.rows[0]?.function_definition).toMatch(
      /UPDATE\s+public\.ai_interactions_log/i,
    );

    await db.exec("SET ROLE anon;");
    await expect(
      db.query("SELECT public.redact_old_ai_interactions(interval '90 days')"),
    ).rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE; SET ROLE authenticated;");
    await expect(
      db.query("SELECT public.redact_old_ai_interactions(interval '90 days')"),
    ).rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE;");
  });

  it("passes the exact release postcondition and rejects a false completed marker", async () => {
    db = await createHotfixedDatabase();
    await db.exec(readFileSync(migrationPath, "utf8"));
    await db.exec("SET ROLE service_role;");
    await db.query("SELECT public.redact_old_ai_interactions(interval '90 days')");
    await db.exec("RESET ROLE;");

    await db.exec(retentionReleasePost);

    await db.exec(`
      GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
        TO unreviewed_retention_operator;
    `);
    await expect(db.exec(retentionReleasePost)).rejects.toThrow(
      /POST_1160_CONTRACT_INVALID/,
    );
    await db.exec(`
      REVOKE ALL PRIVILEGES ON FUNCTION public.redact_old_ai_interactions(interval)
        FROM unreviewed_retention_operator;
    `);

    await db.exec(`
      UPDATE public.ai_interactions_log
      SET metadata = metadata || '{"source":"raw-admin-note"}'::jsonb
      WHERE id = 1
    `);
    await expect(db.exec(retentionReleasePost)).rejects.toThrow(
      /POST_1160_CONTRACT_INVALID/,
    );
    await db.exec(`
      UPDATE public.ai_interactions_log
      SET metadata = metadata - 'source',
          error_message = 'raw-provider-error'
      WHERE id = 1
    `);
    await expect(db.exec(retentionReleasePost)).rejects.toThrow(
      /POST_1160_CONTRACT_INVALID/,
    );
    await db.exec(`
      UPDATE public.ai_interactions_log
      SET error_message = '[redacted_after_retention]'
      WHERE id = 1
    `);
    await db.exec(retentionReleasePost);

    await db.exec(`
      UPDATE public.ai_interactions_log
      SET user_input = 'raw-input-restored'
      WHERE id = 1
    `);
    await expect(db.exec(retentionReleasePost)).rejects.toThrow(
      /POST_1160_CONTRACT_INVALID/,
    );
  });
});
