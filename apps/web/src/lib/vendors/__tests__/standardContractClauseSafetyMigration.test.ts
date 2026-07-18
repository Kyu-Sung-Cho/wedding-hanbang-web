// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = (file: string) => readFileSync(
  resolve(process.cwd(), `../../supabase/migrations/${file}`),
  "utf8",
);

const historicalSeed = migration("20260424000001_contract_clauses_seed.sql");
const safetyMigration = migration("20260718206000_unverified_contract_clause_safety_fence.sql");

const SEEDED_CODES = [
  "CANCEL_PRE_90D",
  "CANCEL_30_90D",
  "CANCEL_WITHIN_30D",
  "REFUND_VENDOR_FAULT",
  "DELIVERY_DATE_CHANGE",
  "SERVICE_CHANGE_SCOPE",
  "DAMAGE_ORIGINAL_LOSS",
  "DAMAGE_QUALITY_DISPUTE",
  "TIP_EXTRA_SHOOTING",
  "TIP_EXTRA_DRESS",
];

describe("unverified standard contract clause safety fence", () => {
  it("pins the applied historical legal seed instead of rewriting migration history", () => {
    const hash = createHash("sha256")
      .update(historicalSeed.replace(/\r\n/g, "\n"))
      .digest("hex");

    expect(hash).toBe("07ec4796cbf29b26fcda50b3f134b01338e03c275d74b883362d09f8df5f8296");
  });

  it("deactivates only the exact draft codes unless legal review was explicitly recorded", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE standard_contract_clauses (
        clause_code text PRIMARY KEY,
        is_active boolean NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO standard_contract_clauses (clause_code, is_active, metadata)
      VALUES
        ('CANCEL_PRE_90D', true, '{}'),
        ('TIP_EXTRA_DRESS', true, '{"legal_review_approved":true}'),
        ('UNRELATED_APPROVED_CLAUSE', true, '{}');
    `);

    await db.exec(safetyMigration);
    await db.exec(safetyMigration);

    const rows = await db.query<{ clause_code: string; is_active: boolean; status: string | null }>(`
      SELECT clause_code, is_active, metadata->>'safety_status' AS status
      FROM standard_contract_clauses
      ORDER BY clause_code
    `);

    expect(rows.rows).toEqual([
      { clause_code: "CANCEL_PRE_90D", is_active: false, status: "legal_review_required" },
      { clause_code: "TIP_EXTRA_DRESS", is_active: true, status: null },
      { clause_code: "UNRELATED_APPROVED_CLAUSE", is_active: true, status: null },
    ]);
    for (const code of SEEDED_CODES) expect(safetyMigration).toContain(`'${code}'`);
  });
});
