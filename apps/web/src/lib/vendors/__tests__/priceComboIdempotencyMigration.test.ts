// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718204000_price_combo_idempotency.sql"
  ),
  "utf8"
);

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = "20000000-0000-4000-8000-000000000001";
const REQUEST_HASH = "a".repeat(64);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');

    CREATE TABLE public.combos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      name text NOT NULL DEFAULT '내 조합',
      selections jsonb NOT NULL DEFAULT '{}'::jsonb,
      total_krw integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.combos (user_id, selections, total_krw)
    VALUES ('${USER_A}', '{"studio": null}'::jsonb, 0);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.combos
      TO authenticated, service_role;
  `);
  await db.exec(migration);
  return db;
}

describe("combo save idempotency migration", () => {
  it("backfills legacy rows and enforces the UUID/hash contract", async () => {
    const db = await createDatabase();
    try {
      const contract = await db.query<{
        invalid_rows: number;
        key_nullable: boolean;
        hash_nullable: boolean;
      }>(`
        SELECT
          count(*) FILTER (
            WHERE idempotency_key IS NULL
              OR request_hash !~ '^[a-f0-9]{64}$'
          )::integer AS invalid_rows,
          bool_or(column_name = 'idempotency_key' AND is_nullable = 'YES')
            AS key_nullable,
          bool_or(column_name = 'request_hash' AND is_nullable = 'YES')
            AS hash_nullable
        FROM public.combos
        CROSS JOIN information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'combos'
          AND column_name IN ('idempotency_key', 'request_hash')
      `);
      expect(contract.rows).toEqual([{
        hash_nullable: false,
        invalid_rows: 0,
        key_nullable: false,
      }]);
    } finally {
      await db.close();
    }
  });

  it("permits one key per user and rejects a concurrent duplicate", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.combos (
          user_id, name, selections, total_krw, idempotency_key, request_hash
        ) VALUES (
          '${USER_A}', '첫 저장', '{"studio": null}'::jsonb, 0,
          '${IDEMPOTENCY_KEY}', '${REQUEST_HASH}'
        )
      `);
      await expect(db.exec(`
        INSERT INTO public.combos (
          user_id, name, selections, total_krw, idempotency_key, request_hash
        ) VALUES (
          '${USER_A}', '중복 저장', '{"studio": null}'::jsonb, 0,
          '${IDEMPOTENCY_KEY}', '${REQUEST_HASH}'
        )
      `)).rejects.toThrow(/combos_user_idempotency_unique/iu);
      await db.exec(`
        INSERT INTO public.combos (
          user_id, name, selections, total_krw, idempotency_key, request_hash
        ) VALUES (
          '${USER_B}', '다른 사용자', '{"studio": null}'::jsonb, 0,
          '${IDEMPOTENCY_KEY}', '${REQUEST_HASH}'
        )
      `);
    } finally {
      await db.close();
    }
  });

  it("is replay-safe and retains the authenticated table grants", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      const catalog = await db.query<{
        unique_index_count: number;
        authenticated_can_insert: boolean;
        authenticated_can_select: boolean;
      }>(`
        SELECT
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'combos'
              AND indexname = 'combos_user_idempotency_unique'
          ) AS unique_index_count,
          has_table_privilege('authenticated', 'public.combos', 'INSERT')
            AS authenticated_can_insert,
          has_table_privilege('authenticated', 'public.combos', 'SELECT')
            AS authenticated_can_select
      `);
      expect(catalog.rows).toEqual([{
        authenticated_can_insert: true,
        authenticated_can_select: true,
        unique_index_count: 1,
      }]);
    } finally {
      await db.close();
    }
  });
});
