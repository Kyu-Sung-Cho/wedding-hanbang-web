// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716099000_wedding_journey_singleton.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE public.couples (id uuid PRIMARY KEY);
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id),
      progress jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    INSERT INTO public.couples (id) VALUES ('${COUPLE_ID}');
  `);
  return db;
}

async function applyMigration(db: PGlite) {
  await db.exec(migration);
}

describe("wedding journey singleton migration", () => {
  it("adds the one-journey-per-couple invariant and is idempotent", async () => {
    const db = await createDatabase();
    try {
      await applyMigration(db);
      await applyMigration(db);
      await db.query(
        "INSERT INTO public.wedding_journeys (couple_id) VALUES ($1)",
        [COUPLE_ID],
      );
      await expect(db.query(
        "INSERT INTO public.wedding_journeys (couple_id) VALUES ($1)",
        [COUPLE_ID],
      )).rejects.toThrow(/unique|duplicate/i);

      const column = await db.query<{ is_nullable: string }>(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'wedding_journeys'
          AND column_name = 'couple_id'
      `);
      expect(column.rows[0]?.is_nullable).toBe("NO");
    } finally {
      await db.close();
    }
  });

  it("fails closed when duplicate journeys require an explicit data repair", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.wedding_journeys (couple_id)
        VALUES ('${COUPLE_ID}'), ('${COUPLE_ID}');
      `);
      await expect(applyMigration(db)).rejects.toThrow(
        /WEDDING_JOURNEY_DUPLICATE_BACKFILL_REQUIRED/,
      );
    } finally {
      await db.close();
    }
  });

  it("fails closed instead of silently deleting an orphan journey", async () => {
    const db = await createDatabase();
    try {
      await db.exec("INSERT INTO public.wedding_journeys (couple_id) VALUES (NULL)");
      await expect(applyMigration(db)).rejects.toThrow(
        /WEDDING_JOURNEY_ORPHAN_BACKFILL_REQUIRED/,
      );
    } finally {
      await db.close();
    }
  });
});
