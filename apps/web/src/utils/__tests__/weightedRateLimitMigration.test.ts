// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260718208000_atomic_weighted_rate_limit.sql",
);

describe("atomic weighted rate-limit migration", () => {
  it("charges a whole batch under one row lock and rejects overflow without partial debit", async () => {
    const migration = readFileSync(migrationPath, "utf8");
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE TABLE public.rate_limit_buckets (
          key text PRIMARY KEY,
          count integer NOT NULL DEFAULT 0,
          reset_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
        BEGIN;
        ${migration}
        COMMIT;
        SET ROLE service_role;
      `);
      const key = `events:vendor:hmac-sha256:${"a".repeat(64)}`;

      const first = await db.query<{ allowed: boolean }>(
        "SELECT allowed FROM public.check_rate_limit_cost($1, 60, 60000, 20)",
        [key],
      );
      const second = await db.query<{ allowed: boolean }>(
        "SELECT allowed FROM public.check_rate_limit_cost($1, 60, 60000, 40)",
        [key],
      );
      const overflow = await db.query<{ allowed: boolean }>(
        "SELECT allowed FROM public.check_rate_limit_cost($1, 60, 60000, 1)",
        [key],
      );
      await db.exec("RESET ROLE");
      const count = await db.query<{ count: number }>(
        "SELECT count FROM public.rate_limit_buckets WHERE key = $1",
        [key],
      );

      expect(first.rows).toEqual([{ allowed: true }]);
      expect(second.rows).toEqual([{ allowed: true }]);
      expect(overflow.rows).toEqual([{ allowed: false }]);
      expect(count.rows).toEqual([{ count: 60 }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps weighted charging service-only and bounds release/runtime locks", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(migration).toMatch(/SET statement_timeout = '10s'/);
    expect(migration).toMatch(/FOR UPDATE;/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_rate_limit_cost\(TEXT, INTEGER, INTEGER, INTEGER\)[\s\S]*FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.check_rate_limit_cost\(TEXT, INTEGER, INTEGER, INTEGER\)[\s\S]*TO service_role;/,
    );
  });
});
