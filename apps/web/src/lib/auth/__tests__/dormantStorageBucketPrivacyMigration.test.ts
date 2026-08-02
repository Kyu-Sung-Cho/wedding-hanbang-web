// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802143000_close_empty_dormant_storage_buckets.sql",
  ),
  "utf8",
);

const TARGET_BUCKETS = [
  "cohort-images",
  "invitation-photos",
  "user_photos",
] as const;

async function createDatabase(options?: {
  presentBuckets?: readonly (typeof TARGET_BUCKETS)[number][];
  objectBucket?: (typeof TARGET_BUCKETS)[number];
}) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      public boolean NOT NULL DEFAULT false
    );
    CREATE TABLE storage.objects (
      id text PRIMARY KEY,
      bucket_id text NOT NULL REFERENCES storage.buckets(id),
      name text NOT NULL
    );
  `);

  const presentBuckets = options?.presentBuckets ?? TARGET_BUCKETS;
  for (const bucket of TARGET_BUCKETS) {
    if (!presentBuckets.includes(bucket)) continue;
    await db.query(
      "INSERT INTO storage.buckets (id, public) VALUES ($1, true)",
      [bucket],
    );
  }
  if (options?.objectBucket) {
    await db.query(
      "INSERT INTO storage.objects (id, bucket_id, name) VALUES ('object-1', $1, 'legacy.jpg')",
      [options.objectBucket],
    );
  }
  return db;
}

async function bucketState(db: PGlite) {
  const result = await db.query<{ id: string; public: boolean }>(`
    SELECT id, public
    FROM storage.buckets
    ORDER BY id
  `);
  return result.rows;
}

describe("empty dormant Storage bucket privacy migration", () => {
  it("makes all three empty buckets private and is idempotent", async () => {
    const db = await createDatabase();
    try {
      await expect(db.exec(migration)).resolves.toBeDefined();
      await expect(db.exec(migration)).resolves.toBeDefined();
      expect(await bucketState(db)).toEqual([
        { id: "cohort-images", public: false },
        { id: "invitation-photos", public: false },
        { id: "user_photos", public: false },
      ]);
    } finally {
      await db.close();
    }
  });

  it("accepts the exact tracked fresh-bootstrap subset without creating a dormant bucket", async () => {
    const db = await createDatabase({
      presentBuckets: ["cohort-images", "invitation-photos"],
    });
    try {
      await expect(db.exec(migration)).resolves.toBeDefined();
      await expect(db.exec(migration)).resolves.toBeDefined();
      expect(await bucketState(db)).toEqual([
        { id: "cohort-images", public: false },
        { id: "invitation-photos", public: false },
      ]);
    } finally {
      await db.close();
    }
  });

  it("treats an entirely absent dormant bucket set as already private", async () => {
    const db = await createDatabase({ presentBuckets: [] });
    try {
      await expect(db.exec(migration)).resolves.toBeDefined();
      expect(await bucketState(db)).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("fails transactionally when any target bucket contains an object", async () => {
    const db = await createDatabase({ objectBucket: "cohort-images" });
    try {
      await expect(db.exec(migration)).rejects.toThrow(
        /DORMANT_STORAGE_PRIVACY_FENCE_BUCKET_NOT_EMPTY/,
      );
      await db.exec("ROLLBACK").catch(() => undefined);
      expect(await bucketState(db)).toEqual([
        { id: "cohort-images", public: true },
        { id: "invitation-photos", public: true },
        { id: "user_photos", public: true },
      ]);
    } finally {
      await db.close();
    }
  });

  it("locks target bucket rows and changes only bucket visibility", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toMatch(/ORDER BY bucket\.id\s+FOR UPDATE/i);
    expect(migration).toContain("DORMANT_STORAGE_PRIVACY_FENCE_BUCKET_NOT_EMPTY");
    expect(migration).not.toContain("DORMANT_STORAGE_PRIVACY_FENCE_BUCKET_SET_DRIFT");
    expect(migration).toMatch(
      /UPDATE\s+storage\.buckets\s+SET\s+public\s*=\s*FALSE\s+WHERE\s+id\s+IN\s*\(\s*'cohort-images'\s*,\s*'invitation-photos'\s*,\s*'user_photos'\s*\)/i,
    );
    expect(migration).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+storage\.objects\b/i,
    );
  });
});
