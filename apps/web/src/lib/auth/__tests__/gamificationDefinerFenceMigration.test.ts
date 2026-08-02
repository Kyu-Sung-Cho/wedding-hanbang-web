// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802136000_close_legacy_gamification_definer_surface.sql",
  ),
  "utf8",
);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      post_count integer NOT NULL DEFAULT 0,
      rank text NOT NULL DEFAULT 'sprout'
    );
    CREATE TABLE public.community_xp_log (
      user_id uuid NOT NULL,
      xp integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE FUNCTION public.community_weekly_leaderboard(p_limit integer DEFAULT 5)
    RETURNS TABLE(user_id uuid, weekly_xp bigint)
    LANGUAGE sql
    SECURITY DEFINER
    AS $$
      SELECT log.user_id, sum(log.xp)::bigint
      FROM public.community_xp_log AS log
      GROUP BY log.user_id
      LIMIT p_limit
    $$;

    CREATE FUNCTION public.community_recalc_rank()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      NEW.rank := CASE WHEN NEW.post_count >= 5 THEN 'preparing' ELSE 'sprout' END;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER trg_recalc_rank
      BEFORE INSERT OR UPDATE OF post_count ON public.community_profiles
      FOR EACH ROW EXECUTE FUNCTION public.community_recalc_rank();

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT ON public.community_xp_log TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.community_profiles
      TO authenticated, service_role;

    INSERT INTO public.community_xp_log (user_id, xp)
    VALUES ('00000000-0000-4000-8000-000000000001', 20);
  `);
  return db;
}

describe("legacy gamification definer fence migration", () => {
  it("blocks anonymous and authenticated direct execution", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        await expect(
          db.query("SELECT * FROM public.community_weekly_leaderboard(5)"),
        ).rejects.toThrow(/permission denied/i);
        await db.exec("RESET ROLE");
      }
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps service execution and database-trigger behavior working", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      const leaderboard = await db.query<{ weekly_xp: bigint }>(
        "SELECT weekly_xp FROM public.community_weekly_leaderboard(5)",
      );
      expect(Number(leaderboard.rows[0]?.weekly_xp)).toBe(20);
      await db.exec("RESET ROLE");

      await db.exec("SET ROLE authenticated");
      await db.exec(`
        INSERT INTO public.community_profiles (user_id, post_count)
        VALUES ('00000000-0000-4000-8000-000000000002', 5)
      `);
      await db.exec("RESET ROLE");
      const profile = await db.query<{ rank: string }>(`
        SELECT rank FROM public.community_profiles
        WHERE user_id = '00000000-0000-4000-8000-000000000002'
      `);
      expect(profile.rows[0]?.rank).toBe("preparing");
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is transactional and verifies effective client privileges", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("has_function_privilege");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
  });
});
