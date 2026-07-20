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

async function createJourneysDb() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY,
      total_budget bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  return db;
}

describe("wedding budget product contract migration", () => {
  it("refuses legacy outliers without changing a single stored budget", async () => {
    const db = await createJourneysDb();
    await db.exec(`
      INSERT INTO public.wedding_journeys (id, total_budget) VALUES
        ('10000000-0000-4000-8000-000000000001', -1),
        ('10000000-0000-4000-8000-000000000002', 500000000000),
        ('10000000-0000-4000-8000-000000000003', 1000000000);
    `);

    await expect(db.exec(migration)).rejects.toThrow("WEDDING_BUDGET_OUTLIER_REVIEW_REQUIRED");
    await db.exec("ROLLBACK");

    const result = await db.query<{ id: string; total_budget: string }>(`
      SELECT id::text, total_budget::text
      FROM public.wedding_journeys
      ORDER BY id
    `);
    expect(result.rows).toEqual([
      { id: "10000000-0000-4000-8000-000000000001", total_budget: "-1" },
      { id: "10000000-0000-4000-8000-000000000002", total_budget: "500000000000" },
      { id: "10000000-0000-4000-8000-000000000003", total_budget: "1000000000" },
    ]);

    await db.close();
  });

  it("adds and validates the product ceiling when every existing value is valid", async () => {
    const db = await createJourneysDb();
    await db.exec(`
      INSERT INTO public.wedding_journeys (id, total_budget) VALUES
        ('10000000-0000-4000-8000-000000000001', 0),
        ('10000000-0000-4000-8000-000000000002', 1000000000);
    `);

    await db.exec(migration);

    await expect(db.exec(`
      UPDATE public.wedding_journeys
      SET total_budget = 1000000001
      WHERE id = '10000000-0000-4000-8000-000000000002';
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE public.wedding_journeys
      SET total_budget = -1
      WHERE id = '10000000-0000-4000-8000-000000000001';
    `)).rejects.toThrow();

    await db.close();
  });

  it("uses bounded locks and never rewrites customer data", () => {
    expect(migration).toMatch(/SET LOCAL lock_timeout\s*=\s*'5s'/i);
    expect(migration).toMatch(/SET LOCAL statement_timeout\s*=\s*'30s'/i);
    expect(migration).toContain("WEDDING_BUDGET_OUTLIER_REVIEW_REQUIRED");
    expect(migration).toMatch(/ADD CONSTRAINT[\s\S]+NOT VALID/i);
    expect(migration).toMatch(/VALIDATE CONSTRAINT wedding_journeys_total_budget_product_range/i);
    expect(migration).not.toMatch(/\bUPDATE\s+public\.wedding_journeys\b/i);
    expect(migration).not.toMatch(/LOCK TABLE\s+public\.wedding_journeys/i);
  });
});
