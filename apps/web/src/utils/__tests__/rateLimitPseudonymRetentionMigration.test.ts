// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260716115000_rate_limit_pseudonym_retention.sql",
);

describe("rate-limit pseudonym retention migration", () => {
  it("bounds release locks, the one-time purge, and per-request garbage collection", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(migration).toMatch(/SET LOCAL statement_timeout = '30s';/);
    expect(migration).toMatch(/IF v_expired_count > 1000 THEN/);
    expect(migration).toMatch(/LIMIT 128/);
    expect(migration).not.toMatch(/ACCESS EXCLUSIVE/i);
  });

  it("purges expired legacy identifiers while preserving active windows", async () => {
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
        INSERT INTO public.rate_limit_buckets(key, count, reset_at) VALUES
          ('chat:00000000-0000-4000-8000-000000000001', 1, now() - interval '1 minute'),
          ('signup:203.0.113.10', 1, now() + interval '10 minutes');
        BEGIN;
        ${migration}
        COMMIT;
      `);

      const afterMigration = await db.query<{ key: string }>(
        "SELECT key FROM public.rate_limit_buckets ORDER BY key",
      );
      expect(afterMigration.rows).toEqual([{ key: "signup:203.0.113.10" }]);

      await db.exec(`
        INSERT INTO public.rate_limit_buckets(key, count, reset_at)
        VALUES ('forgot:00000000-0000-4000-8000-000000000002', 1, now() - interval '1 minute');
        SET ROLE service_role;
      `);
      const key = `chat:hmac-sha256:${"a".repeat(64)}`;
      const allowed = await db.query<{ allowed: boolean }>(
        "SELECT allowed FROM public.check_rate_limit($1, 3, 60000)",
        [key],
      );
      expect(allowed.rows[0]?.allowed).toBe(true);

      for (const invalidKey of [
        "chat:raw-user-id",
        `chat:sha256:${"b".repeat(64)}`,
        `CHAT:hmac-sha256:${"c".repeat(64)}`,
        `chat:hmac-sha256:${"d".repeat(63)}`,
      ]) {
        const rejected = await db.query<{ allowed: boolean }>(
          "SELECT allowed FROM public.check_rate_limit($1, 3, 60000)",
          [invalidKey],
        );
        expect(rejected.rows).toEqual([{ allowed: false }]);
      }
      await db.exec("RESET ROLE");

      const afterCall = await db.query<{ key: string }>(
        "SELECT key FROM public.rate_limit_buckets ORDER BY key",
      );
      expect(afterCall.rows).toEqual([
        { key },
        { key: "signup:203.0.113.10" },
      ]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the RPC service-only", async () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_rate_limit\(TEXT, INTEGER, INTEGER\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.check_rate_limit\(TEXT, INTEGER, INTEGER\) TO service_role;/,
    );
  });
});
