// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802142000_close_live_only_fitting_definer_surface.sql",
  ),
  "utf8",
);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.fitting_requests (
      id uuid PRIMARY KEY,
      expires_at timestamptz NOT NULL,
      is_saved boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.fitting_usage (
      couple_id uuid NOT NULL,
      period_start date NOT NULL,
      free_used integer NOT NULL DEFAULT 0,
      PRIMARY KEY (couple_id, period_start)
    );

    CREATE FUNCTION public.cleanup_expired_fittings()
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      DELETE FROM public.fitting_requests
      WHERE expires_at < now() AND is_saved = false;
    END;
    $$;

    CREATE FUNCTION public.increment_fitting_usage(
      p_couple_id uuid,
      p_period_start date
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      UPDATE public.fitting_usage
      SET free_used = free_used + 1
      WHERE couple_id = p_couple_id
        AND period_start = p_period_start;
    END;
    $$;

    GRANT EXECUTE ON FUNCTION public.cleanup_expired_fittings()
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.increment_fitting_usage(uuid, date)
      TO anon, authenticated, service_role;

    INSERT INTO public.fitting_requests (id, expires_at, is_saved) VALUES
      ('10000000-0000-4000-8000-000000000001', now() - interval '1 day', false),
      ('10000000-0000-4000-8000-000000000002', now() - interval '1 day', true),
      ('10000000-0000-4000-8000-000000000003', now() + interval '1 day', false);
    INSERT INTO public.fitting_usage (couple_id, period_start, free_used)
    VALUES ('20000000-0000-4000-8000-000000000001', DATE '2026-08-01', 1);
  `);
  return db;
}

describe("hosted-only fitting definer fence migration", () => {
  it("blocks anonymous and authenticated mutation through owner-privileged functions", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        await expect(
          db.query("SELECT public.cleanup_expired_fittings()"),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.query(`
            SELECT public.increment_fitting_usage(
              '20000000-0000-4000-8000-000000000001',
              DATE '2026-08-01'
            )
          `),
        ).rejects.toThrow(/permission denied/i);
        await db.exec("RESET ROLE");
      }
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("preserves service maintenance behavior and replays safely", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      await db.query("SELECT public.cleanup_expired_fittings()");
      await db.query(`
        SELECT public.increment_fitting_usage(
          '20000000-0000-4000-8000-000000000001',
          DATE '2026-08-01'
        )
      `);
      await db.exec("RESET ROLE");

      expect((await db.query<{ id: string }>(`
        SELECT id::text AS id FROM public.fitting_requests ORDER BY id
      `)).rows).toEqual([
        { id: "10000000-0000-4000-8000-000000000002" },
        { id: "10000000-0000-4000-8000-000000000003" },
      ]);
      expect((await db.query<{ free_used: number }>(`
        SELECT free_used FROM public.fitting_usage
      `)).rows).toEqual([{ free_used: 2 }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is transactional and safe when hosted-only functions are absent", async () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("has_function_privilege");

    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      `);
      await db.exec(migration);
      await db.exec(migration);
    } finally {
      await db.close();
    }
  }, 30_000);
});
