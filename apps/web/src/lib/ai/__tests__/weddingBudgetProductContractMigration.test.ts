// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718210000_wedding_budget_product_contract.sql",
  ),
  "utf8",
);

describe("wedding budget product contract migration", () => {
  it("cleans corrupt legacy values and enforces the 10억원 ceiling", async () => {
    const db = await PGlite.create();
    await db.exec(`
      CREATE TABLE public.wedding_journeys (
        id uuid PRIMARY KEY,
        total_budget bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO public.wedding_journeys (id, total_budget) VALUES
        ('10000000-0000-4000-8000-000000000001', -1),
        ('10000000-0000-4000-8000-000000000002', 500000000000),
        ('10000000-0000-4000-8000-000000000003', 1000000000);
    `);

    await db.exec(migration);

    const result = await db.query<{ id: string; total_budget: string }>(`
      SELECT id::text, total_budget::text
      FROM public.wedding_journeys
      ORDER BY id
    `);
    expect(result.rows).toEqual([
      { id: "10000000-0000-4000-8000-000000000001", total_budget: "0" },
      { id: "10000000-0000-4000-8000-000000000002", total_budget: "0" },
      { id: "10000000-0000-4000-8000-000000000003", total_budget: "1000000000" },
    ]);

    await expect(db.exec(`
      UPDATE public.wedding_journeys
      SET total_budget = 1000000001
      WHERE id = '10000000-0000-4000-8000-000000000003';
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE public.wedding_journeys
      SET total_budget = -1
      WHERE id = '10000000-0000-4000-8000-000000000003';
    `)).rejects.toThrow();

    await db.close();
  });
});
