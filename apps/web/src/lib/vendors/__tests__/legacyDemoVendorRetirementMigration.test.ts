// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = (file: string) => resolve(
  process.cwd(),
  `../../supabase/migrations/${file}`,
);

const sql = (file: string) => readFileSync(migrationPath(file), "utf8");
const normalizedSha256 = (value: string) => createHash("sha256")
  .update(value.replace(/\r\n/g, "\n"))
  .digest("hex");

const historicalSeedHashes = new Map([
  ["20260514000000_demo_vendor_seed.sql", "fe2a54de32d1d62aef64c8f42df9eebe2d4f5b65afafa25a0d19ed6c3605ae3f"],
  ["20260514010000_demo_vendor_full_set.sql", "1e2514c113e4cd2676fae95d76afda79be5b127b792213ed73a5d4be3f82508d"],
  ["20260514020000_demo_vendor_categories.sql", "94ed81655744b2faa04cb499eeb9a02f96086398703c7443e324fd5148ca1e54"],
]);

const publicationFence = sql("20260718205000_legacy_demo_vendor_retirement.sql");

const createSchema = async (db: PGlite) => {
  await db.exec(`
    CREATE TABLE vendors (
      id uuid PRIMARY KEY,
      owner_id uuid,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      ai_recommend boolean NOT NULL DEFAULT false
    );
  `);
};

describe("legacy demo vendor publication fence", () => {
  it("pins applied historical migrations instead of rewriting migration history", () => {
    for (const [file, hash] of historicalSeedHashes) {
      expect(normalizedSha256(sql(file))).toBe(hash);
    }
  });

  it("contains no mutation and leaves pending, claimed, and unrelated rows untouched", async () => {
    expect(publicationFence).toMatch(/LOCK\s+TABLE\s+public\.vendors\s+IN\s+SHARE\s+ROW\s+EXCLUSIVE\s+MODE/iu);
    expect(publicationFence).not.toMatch(/\b(?:UPDATE|DELETE)\s+(?:FROM\s+)?public\.(?:vendors|vendor_products|vendor_staff)\b/iu);

    const db = new PGlite();
    await createSchema(db);
    await db.exec(`
      INSERT INTO vendors (id, owner_id, name, status, ai_recommend)
      VALUES
        ('22222222-2222-2222-2222-222222222222', NULL, 'legacy pending row', 'pending', true),
        ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'claimed pending row', 'pending', true),
        ('aaaaaaaa-0000-4000-8000-000000000001', NULL, 'unrelated approved row', 'approved', true);
    `);

    const before = await db.query("SELECT * FROM vendors ORDER BY id");
    await db.exec(publicationFence);
    await db.exec(publicationFence);
    const after = await db.query("SELECT * FROM vendors ORDER BY id");

    expect(after.rows).toEqual(before.rows);
  });

  it("aborts atomically when a legacy namespace row is publicly approved", async () => {
    const db = new PGlite();
    await createSchema(db);
    await db.exec(`
      INSERT INTO vendors (id, owner_id, name, status, ai_recommend)
      VALUES
        ('22222222-2222-2222-2222-222222222222', NULL, 'legacy public row', 'approved', true),
        ('aaaaaaaa-0000-4000-8000-000000000001', NULL, 'unrelated row', 'pending', false);
    `);

    await expect(db.exec(publicationFence)).rejects.toThrow(
      "LEGACY_DEMO_VENDOR_PUBLICATION_BLOCKED",
    );
    await db.exec("ROLLBACK");

    const rows = await db.query<{ id: string; name: string; status: string }>(
      "SELECT id::text, name, status FROM vendors ORDER BY id",
    );
    expect(rows.rows).toEqual([
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: "legacy public row",
        status: "approved",
      },
      {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        name: "unrelated row",
        status: "pending",
      },
    ]);
  });
});
