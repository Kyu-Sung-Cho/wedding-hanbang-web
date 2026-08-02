// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802137000_hide_public_post_cohort_room_identifier.sql",
  ),
  "utf8",
);

describe("public post cohort-room identifier fence", () => {
  it("keeps public post content readable without exposing the internal room UUID", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE TABLE public.community_posts (
          id uuid PRIMARY KEY,
          title text NOT NULL,
          cohort_room_id uuid
        );
        GRANT SELECT ON public.community_posts TO anon, authenticated, service_role;
        INSERT INTO public.community_posts(id, title, cohort_room_id)
        VALUES (
          '10000000-0000-4000-8000-000000000001',
          'public title',
          '20000000-0000-4000-8000-000000000002'
        );
      `);
      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        expect((await db.query("SELECT id, title FROM public.community_posts")).rows)
          .toEqual([{
            id: "10000000-0000-4000-8000-000000000001",
            title: "public title",
          }]);
        await expect(db.query(
          "SELECT cohort_room_id FROM public.community_posts",
        )).rejects.toThrow(/permission denied/i);
        await db.exec("RESET ROLE");
      }

      await db.exec("SET ROLE service_role");
      expect((await db.query(
        "SELECT cohort_room_id FROM public.community_posts",
      )).rows).toEqual([{
        cohort_room_id: "20000000-0000-4000-8000-000000000002",
      }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
