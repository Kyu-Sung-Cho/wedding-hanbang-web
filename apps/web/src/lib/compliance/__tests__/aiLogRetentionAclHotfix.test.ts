import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const applySql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
  ),
  "utf8",
);

describe("AI-log retention exact-ACL forward fix", () => {
  let db: PGlite | null = null;

  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it("removes untrusted execution while preserving service-role execution", async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE ROLE legacy_retention_operator;
      CREATE TABLE public.ai_interactions_log(id integer PRIMARY KEY, user_input text);
      CREATE OR REPLACE FUNCTION public.redact_old_ai_interactions(
        p_retention interval DEFAULT interval '90 days'
      )
      RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $function$
      BEGIN
        UPDATE public.ai_interactions_log SET user_input = NULL;
        RETURN 0;
      END
      $function$;
      ALTER FUNCTION public.redact_old_ai_interactions(interval) OWNER TO postgres;
      REVOKE ALL ON FUNCTION public.redact_old_ai_interactions(interval) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
        TO anon, authenticated, service_role, legacy_retention_operator;
    `);

    await db.exec(applySql);

    const result = await db.query<{
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_role_execute: boolean;
      public_execute: boolean;
      legacy_execute: boolean;
      execute_grantees: string[] | null;
    }>(`
      SELECT
        has_function_privilege(
          'anon', 'public.redact_old_ai_interactions(interval)', 'EXECUTE'
        ) AS anon_execute,
        has_function_privilege(
          'authenticated', 'public.redact_old_ai_interactions(interval)', 'EXECUTE'
        ) AS authenticated_execute,
        has_function_privilege(
          'service_role', 'public.redact_old_ai_interactions(interval)', 'EXECUTE'
        ) AS service_role_execute,
        EXISTS (
          SELECT 1
          FROM pg_proc AS procedure_record
          CROSS JOIN LATERAL aclexplode(COALESCE(
            procedure_record.proacl,
            acldefault('f', procedure_record.proowner)
          )) AS acl_entry
          WHERE procedure_record.oid =
            'public.redact_old_ai_interactions(interval)'::regprocedure
            AND acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
        ) AS public_execute,
        has_function_privilege(
          'legacy_retention_operator',
          'public.redact_old_ai_interactions(interval)',
          'EXECUTE'
        ) AS legacy_execute,
        (
          SELECT array_agg(
            DISTINCT pg_get_userbyid(acl_entry.grantee)
            ORDER BY pg_get_userbyid(acl_entry.grantee)
          )
          FROM pg_proc AS procedure_record
          CROSS JOIN LATERAL aclexplode(COALESCE(
            procedure_record.proacl,
            acldefault('f', procedure_record.proowner)
          )) AS acl_entry
          WHERE procedure_record.oid =
            'public.redact_old_ai_interactions(interval)'::regprocedure
            AND acl_entry.privilege_type = 'EXECUTE'
        ) AS execute_grantees
    `);

    expect(result.rows).toEqual([{
      anon_execute: false,
      authenticated_execute: false,
      service_role_execute: true,
      public_execute: false,
      legacy_execute: false,
      execute_grantees: ["postgres", "service_role"],
    }]);
  }, 15_000);

  it("fails closed when the expected production function is absent", async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");

    await expect(db.exec(applySql)).rejects.toThrow(
      /AI_LOG_RETENTION_EXACT_ACL_PRECONDITION_FAILED/,
    );
  });
});
