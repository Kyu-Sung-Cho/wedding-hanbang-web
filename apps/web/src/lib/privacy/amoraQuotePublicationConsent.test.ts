// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802133000_amora_quote_publication_consent.sql",
);

describe("Amora quote publication consent migration", () => {
  it("keeps legacy and newly inserted quote checks private by default", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE TABLE public.amora_quote_checks (
          id uuid PRIMARY KEY,
          user_id uuid,
          analysis jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        INSERT INTO public.amora_quote_checks(id, user_id)
        VALUES (
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000002'
        );
      `);

      await db.exec(readFileSync(migrationPath, "utf8"));
      await db.exec(`
        INSERT INTO public.amora_quote_checks(id, user_id)
        VALUES (
          '10000000-0000-4000-8000-000000000003',
          '20000000-0000-4000-8000-000000000002'
        );
      `);

      expect((await db.query(`
        SELECT id, published_at
        FROM public.amora_quote_checks
        ORDER BY id
      `)).rows).toEqual([
        {
          id: "10000000-0000-4000-8000-000000000001",
          published_at: null,
        },
        {
          id: "10000000-0000-4000-8000-000000000003",
          published_at: null,
        },
      ]);

      expect((await db.query(`
        SELECT is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'amora_quote_checks'
          AND column_name = 'published_at'
      `)).rows).toEqual([{ is_nullable: "YES", column_default: null }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("pins both public readers to explicit publication and revocation-safe caching", () => {
    const apiSource = readFileSync(
      resolve(process.cwd(), "src/app/api/amora/quote-check/[id]/public/route.ts"),
      "utf8",
    );
    const pageSource = readFileSync(
      resolve(process.cwd(), "src/app/quote/[id]/page.tsx"),
      "utf8",
    );

    for (const source of [apiSource, pageSource]) {
      expect(source).toMatch(/\.not\("published_at", "is", null\)/);
      expect(source).toContain('export const dynamic = "force-dynamic"');
    }
    expect(apiSource).toContain('"Cache-Control": "no-store, max-age=0"');
    expect(pageSource).toContain("export const revalidate = 0");
  });
});
