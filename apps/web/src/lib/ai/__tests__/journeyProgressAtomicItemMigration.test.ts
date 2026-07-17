// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716100000_journey_progress_atomic_item_patch.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

describe("journey progress atomic item patch migration", () => {
  it("pins the security-definer search path to trusted schemas", () => {
    expect(migration).toMatch(/set\s+search_path\s*=\s*pg_catalog,\s*public/i);
  });

  it("merges status into the latest category object and exposes the RPC only to service_role", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        CREATE TABLE public.wedding_journeys (
          couple_id uuid PRIMARY KEY,
          progress jsonb,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ${migration}
        INSERT INTO public.wedding_journeys (couple_id, progress)
        VALUES (
          '${COUPLE_ID}',
          '{
            "venue": {
              "category": "venue",
              "status": "not_started",
              "budget": 20000000,
              "spent": 3000000,
              "checklist": [{"id":"contract","completed":false}],
              "memo": "채광 좋은 홀 우선"
            }
          }'::jsonb
        );
      `);

      await db.exec("SET ROLE authenticated");
      await expect(
        db.query(`
          SELECT public.apply_journey_progress_item_patch(
            '${COUPLE_ID}'::uuid,
            'venue',
            '{"status":"in_progress"}'::jsonb
          )
        `),
      ).rejects.toThrow();
      await db.exec("RESET ROLE; SET ROLE service_role");

      const result = await db.query<{ item: Record<string, unknown> }>(`
        SELECT public.apply_journey_progress_item_patch(
          '${COUPLE_ID}'::uuid,
          'venue',
          '{"category":"venue","status":"in_progress"}'::jsonb
        ) AS item
      `);

      expect(result.rows[0]?.item).toEqual({
        category: "venue",
        status: "in_progress",
        budget: 20_000_000,
        spent: 3_000_000,
        checklist: [{ id: "contract", completed: false }],
        memo: "채광 좋은 홀 우선",
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
