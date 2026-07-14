// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationsPath = resolve(process.cwd(), "../../supabase/migrations");
const creator = readFileSync(
  resolve(migrationsPath, "20260705160000_wedding_code_responses.sql"),
  "utf8"
);
const coupleToken = readFileSync(
  resolve(migrationsPath, "20260706100000_wc_couple_token.sql"),
  "utf8"
);
const retirement = readFileSync(
  resolve(migrationsPath, "20260714104000_disable_wedding_code_collection.sql"),
  "utf8"
);

async function createSupabaseLikeDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  return db;
}

async function applyMigration(db: PGlite, sql: string) {
  await db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
}

async function expectQueryRejected(db: PGlite, sql: string) {
  await expect(db.exec(sql)).rejects.toThrow();
}

async function supportsMaintainPrivilege(db: PGlite): Promise<boolean> {
  const version = await db.query<{ version_num: string }>(
    "SELECT current_setting('server_version_num') AS version_num"
  );

  return Number(version.rows[0]?.version_num) >= 170_000;
}

describe("WeddingCode collection retirement migration in PostgreSQL", () => {
  it(
    "accepts the production state where the table and RPCs are already absent",
    async () => {
      const db = await createSupabaseLikeDatabase();
      try {
        await applyMigration(db, retirement);

        const table = await db.query<{ table_name: string | null }>(
          "SELECT to_regclass('public.wedding_code_responses')::TEXT AS table_name"
        );
        const functions = await db.query<{ function_count: number }>(`
          SELECT count(*)::INT AS function_count
          FROM pg_proc AS procedure_row
          JOIN pg_namespace AS namespace_row
            ON namespace_row.oid = procedure_row.pronamespace
          WHERE namespace_row.nspname = 'public'
            AND procedure_row.proname IN (
              'insert_wedding_code_response',
              'pair_wedding_code_response'
            )
        `);

        expect(table.rows[0]?.table_name).toBeNull();
        expect(functions.rows[0]?.function_count).toBe(0);
      } finally {
        await db.close();
      }
    },
    30_000
  );

  it(
    "keeps the complete pending migration chain fail-closed from table creation onward",
    async () => {
      const db = await createSupabaseLikeDatabase();
      try {
        await applyMigration(db, creator);
        await applyMigration(db, coupleToken);

        await db.exec("SET ROLE service_role;");
        await expectQueryRejected(
          db,
          "INSERT INTO public.wedding_code_responses (participant_stage, answering_mode, quote_status, parent_involvement, answers) VALUES ('planning', 'solo', 'none', 'none', '{}'::jsonb);"
        );
        await db.exec("RESET ROLE;");

        await expectQueryRejected(
          db,
          "INSERT INTO public.wedding_code_responses (participant_stage, answering_mode, quote_status, parent_involvement, answers) VALUES ('planning', 'solo', 'none', 'none', '{}'::jsonb);"
        );

        await applyMigration(db, retirement);

        const contract = await db.query<{
          policy_count: number;
          function_count: number;
          constraint_validated: boolean;
        }>(`
          SELECT
            (SELECT count(*)::INT FROM pg_policy WHERE polrelid = 'public.wedding_code_responses'::regclass) AS policy_count,
            (
              SELECT count(*)::INT
              FROM pg_proc AS procedure_row
              JOIN pg_namespace AS namespace_row
                ON namespace_row.oid = procedure_row.pronamespace
              WHERE namespace_row.nspname = 'public'
                AND procedure_row.proname IN (
                  'insert_wedding_code_response',
                  'pair_wedding_code_response'
                )
            ) AS function_count,
            (
              SELECT convalidated
              FROM pg_constraint
              WHERE conrelid = 'public.wedding_code_responses'::regclass
                AND conname = 'wedding_code_collection_retired'
            ) AS constraint_validated
        `);

        expect(contract.rows[0]).toEqual({
          policy_count: 0,
          function_count: 0,
          constraint_validated: false,
        });
      } finally {
        await db.close();
      }
    },
    30_000
  );

  it(
    "preserves historical rows while removing legacy ACL, policy, RPC, insert, and update paths",
    async () => {
      const db = await createSupabaseLikeDatabase();
      try {
        await db.exec(`
          CREATE TABLE public.wedding_code_responses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            marker TEXT NOT NULL
          );
          ALTER TABLE public.wedding_code_responses ENABLE ROW LEVEL SECURITY;
          GRANT ALL ON public.wedding_code_responses
            TO PUBLIC, anon, authenticated, service_role;
          CREATE POLICY wc_responses_service_only
            ON public.wedding_code_responses
            FOR ALL TO service_role USING (true) WITH CHECK (true);
          INSERT INTO public.wedding_code_responses (marker) VALUES ('preserve-me');

          CREATE FUNCTION public.insert_wedding_code_response(TEXT)
          RETURNS UUID LANGUAGE SQL
          AS 'SELECT gen_random_uuid()';
          CREATE FUNCTION public.insert_wedding_code_response(INTEGER)
          RETURNS UUID LANGUAGE SQL
          AS 'SELECT gen_random_uuid()';
          CREATE FUNCTION public.pair_wedding_code_response(UUID, UUID)
          RETURNS VOID LANGUAGE SQL AS 'SELECT';
          CREATE FUNCTION public.pair_wedding_code_response(TEXT)
          RETURNS VOID LANGUAGE SQL AS 'SELECT';
          GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
        `);

        const supportsMaintain = await supportsMaintainPrivilege(db);
        if (supportsMaintain) {
          const publicBefore = await db.query<{
            public_maintain_grants: number;
          }>(`
            SELECT count(*)::INT AS public_maintain_grants
            FROM pg_class AS class_row
            CROSS JOIN LATERAL aclexplode(
              coalesce(class_row.relacl, acldefault('r', class_row.relowner))
            ) AS acl_row
            WHERE class_row.oid = 'public.wedding_code_responses'::regclass
              AND acl_row.grantee = 0
              AND acl_row.privilege_type = 'MAINTAIN'
          `);
          expect(publicBefore.rows[0]?.public_maintain_grants).toBe(1);

          for (const role of ["anon", "authenticated", "service_role"]) {
            const before = await db.query<{ has_maintain: boolean }>(
              `SELECT has_table_privilege($1, 'public.wedding_code_responses', 'MAINTAIN') AS has_maintain`,
              [role]
            );
            expect(before.rows[0]?.has_maintain).toBe(true);
          }
        }

        await applyMigration(db, retirement);

        const preserved = await db.query<{ marker: string }>(
          "SELECT marker FROM public.wedding_code_responses"
        );
        expect(preserved.rows).toEqual([{ marker: "preserve-me" }]);

        await db.exec("SET ROLE service_role;");
        await expectQueryRejected(
          db,
          "SELECT marker FROM public.wedding_code_responses;"
        );
        await expectQueryRejected(
          db,
          "INSERT INTO public.wedding_code_responses (marker) VALUES ('blocked');"
        );
        await expectQueryRejected(
          db,
          "UPDATE public.wedding_code_responses SET marker = 'blocked';"
        );
        await db.exec("RESET ROLE;");

        await expectQueryRejected(
          db,
          "INSERT INTO public.wedding_code_responses (marker) VALUES ('blocked-owner');"
        );
        await expectQueryRejected(
          db,
          "UPDATE public.wedding_code_responses SET marker = 'blocked-owner';"
        );

        if (supportsMaintain) {
          for (const role of ["anon", "authenticated", "service_role"]) {
            const after = await db.query<{ has_maintain: boolean }>(
              `SELECT has_table_privilege($1, 'public.wedding_code_responses', 'MAINTAIN') AS has_maintain`,
              [role]
            );
            expect(after.rows[0]?.has_maintain).toBe(false);
          }

          const publicAcl = await db.query<{ public_maintain_grants: number }>(`
            SELECT count(*)::INT AS public_maintain_grants
            FROM pg_class AS class_row
            CROSS JOIN LATERAL aclexplode(
              coalesce(class_row.relacl, acldefault('r', class_row.relowner))
            ) AS acl_row
            WHERE class_row.oid = 'public.wedding_code_responses'::regclass
              AND acl_row.grantee = 0
              AND acl_row.privilege_type = 'MAINTAIN'
          `);
          expect(publicAcl.rows[0]?.public_maintain_grants).toBe(0);
        }

        const postCheck = await db.query<{
          row_count: number;
          policy_count: number;
          function_count: number;
        }>(`
          SELECT
            (SELECT count(*)::INT FROM public.wedding_code_responses) AS row_count,
            (SELECT count(*)::INT FROM pg_policy WHERE polrelid = 'public.wedding_code_responses'::regclass) AS policy_count,
            (
              SELECT count(*)::INT
              FROM pg_proc AS procedure_row
              JOIN pg_namespace AS namespace_row
                ON namespace_row.oid = procedure_row.pronamespace
              WHERE namespace_row.nspname = 'public'
                AND procedure_row.proname IN (
                  'insert_wedding_code_response',
                  'pair_wedding_code_response'
                )
            ) AS function_count
        `);

        expect(postCheck.rows[0]).toEqual({
          row_count: 1,
          policy_count: 0,
          function_count: 0,
        });
      } finally {
        await db.close();
      }
    },
    30_000
  );
});
