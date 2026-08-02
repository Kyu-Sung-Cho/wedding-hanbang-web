// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802135000_close_hidden_poll_result_bypass.sql",
  ),
  "utf8",
);

async function expectDenied(db: PGlite, sql: string) {
  await expect(db.query(sql)).rejects.toThrow(/permission denied/i);
}

describe("hidden poll result database fence", () => {
  it("keeps metadata readable but denies result counters to anon and authenticated roles", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE TABLE public.community_polls (
          id uuid PRIMARY KEY,
          post_id uuid NOT NULL,
          question text NOT NULL,
          allow_multiple boolean NOT NULL DEFAULT false,
          is_anonymous boolean NOT NULL DEFAULT false,
          hide_results_until_voted boolean NOT NULL DEFAULT false,
          closes_at timestamptz,
          total_voters integer NOT NULL DEFAULT 0,
          total_votes integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.community_poll_options (
          id uuid PRIMARY KEY,
          poll_id uuid NOT NULL REFERENCES public.community_polls(id),
          position integer NOT NULL,
          label text NOT NULL,
          image_url text,
          vote_count integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        GRANT SELECT ON public.community_polls, public.community_poll_options
          TO anon, authenticated, service_role;
        INSERT INTO public.community_polls(
          id, post_id, question, hide_results_until_voted,
          total_voters, total_votes
        ) VALUES (
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000002',
          'secret until voted', true, 7, 7
        );
        INSERT INTO public.community_poll_options(
          id, poll_id, position, label, vote_count
        ) VALUES (
          '30000000-0000-4000-8000-000000000003',
          '10000000-0000-4000-8000-000000000001', 0, 'A', 7
        );
      `);
      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        expect((await db.query("SELECT id, question FROM public.community_polls")).rows)
          .toHaveLength(1);
        expect((await db.query("SELECT id, label FROM public.community_poll_options")).rows)
          .toHaveLength(1);
        await expectDenied(db, "SELECT total_voters FROM public.community_polls");
        await expectDenied(db, "SELECT total_votes FROM public.community_polls");
        await expectDenied(db, "SELECT vote_count FROM public.community_poll_options");
        await db.exec("RESET ROLE");
      }

      await db.exec("SET ROLE service_role");
      expect((await db.query("SELECT total_voters, total_votes FROM public.community_polls")).rows)
        .toEqual([{ total_voters: 7, total_votes: 7 }]);
      expect((await db.query("SELECT vote_count FROM public.community_poll_options")).rows)
        .toEqual([{ vote_count: 7 }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
