// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718180000_disclosure_storage_privacy_fence.sql",
  ),
  "utf8",
);

type ClientRole = "anon" | "authenticated";

async function baseline() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE supabase_storage_admin NOLOGIN;
    GRANT supabase_storage_admin TO postgres;

    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL
    );

    INSERT INTO storage.buckets (id, name, public)
    VALUES
      ('disclosure-raw', 'disclosure-raw', true),
      ('disclosure-preview', 'disclosure-preview', true),
      ('community-images', 'community-images', true);
    INSERT INTO storage.objects (id, bucket_id, name)
    VALUES
      ('10000000-0000-4000-8000-000000000001', 'disclosure-raw', 'raw.pdf'),
      ('10000000-0000-4000-8000-000000000002', 'disclosure-preview', 'preview.txt'),
      ('10000000-0000-4000-8000-000000000003', 'community-images', 'public.png');

    ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
    ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
    ALTER SCHEMA storage OWNER TO supabase_storage_admin;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects
      TO anon, authenticated, service_role;

    SET ROLE supabase_storage_admin;
    CREATE POLICY malicious_legacy_select
      ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC
      USING (true);
    CREATE POLICY malicious_legacy_insert
      ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC
      WITH CHECK (true);
    CREATE POLICY malicious_legacy_update
      ON storage.objects AS PERMISSIVE FOR UPDATE TO PUBLIC
      USING (true) WITH CHECK (true);
    CREATE POLICY malicious_legacy_delete
      ON storage.objects AS PERMISSIVE FOR DELETE TO PUBLIC
      USING (true);
    RESET ROLE;
  `);
  return db;
}

async function setRole(db: PGlite, role: ClientRole | "service_role") {
  await db.exec(`SET ROLE ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("RESET ROLE");
}

describe("disclosure storage privacy fence migration", () => {
  it("overrides malicious permissive policies for disclosure evidence without regressing other buckets", async () => {
    const db = await baseline();
    try {
      for (const role of ["anon", "authenticated"] as const) {
        await setRole(db, role);
        try {
          const exposedBefore = await db.query<{ bucket_id: string }>(`
            SELECT bucket_id
            FROM storage.objects
            ORDER BY bucket_id
          `);
          expect(exposedBefore.rows).toHaveLength(3);
        } finally {
          await resetRole(db);
        }
      }

      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        await setRole(db, role);
        try {
          const visible = await db.query<{ bucket_id: string; name: string }>(`
            SELECT bucket_id, name
            FROM storage.objects
            ORDER BY bucket_id, name
          `);
          expect(visible.rows).toEqual([
            { bucket_id: "community-images", name: "public.png" },
          ]);

          for (const bucketId of [
            "disclosure-raw",
            "disclosure-preview",
          ] as const) {
            await expect(db.exec(`
              INSERT INTO storage.objects (bucket_id, name)
              VALUES ('${bucketId}', 'client-write')
            `)).rejects.toThrow(/row-level security/iu);

            const updatedEvidence = await db.query<{ name: string }>(`
              UPDATE storage.objects
              SET name = 'tampered'
              WHERE bucket_id = '${bucketId}'
              RETURNING name
            `);
            expect(updatedEvidence.rows).toEqual([]);

            await expect(db.exec(`
              UPDATE storage.objects
              SET bucket_id = '${bucketId}'
              WHERE bucket_id = 'community-images'
            `)).rejects.toThrow(/row-level security/iu);

            const deletedEvidence = await db.query<{ name: string }>(`
              DELETE FROM storage.objects
              WHERE bucket_id = '${bucketId}'
              RETURNING name
            `);
            expect(deletedEvidence.rows).toEqual([]);
          }

          const insertedOther = await db.query<{ name: string }>(`
            INSERT INTO storage.objects (bucket_id, name)
            VALUES ('community-images', '${role}-other.png')
            RETURNING name
          `);
          expect(insertedOther.rows).toEqual([{ name: `${role}-other.png` }]);

          const updatedOther = await db.query<{ name: string }>(`
            UPDATE storage.objects
            SET name = '${role}-updated.png'
            WHERE bucket_id = 'community-images'
              AND name = '${role}-other.png'
            RETURNING name
          `);
          expect(updatedOther.rows).toEqual([{ name: `${role}-updated.png` }]);

          const deletedOther = await db.query<{ name: string }>(`
            DELETE FROM storage.objects
            WHERE bucket_id = 'community-images'
              AND name = '${role}-updated.png'
            RETURNING name
          `);
          expect(deletedOther.rows).toEqual([{ name: `${role}-updated.png` }]);
        } finally {
          await resetRole(db);
        }
      }

      const legacyPolicies = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname LIKE 'malicious_legacy_%'
      `);
      expect(legacyPolicies.rows).toEqual([{ count: 4 }]);
    } finally {
      await db.close();
    }
  });

  it("is replay-safe, preserves Storage ownership, and leaves service-role evidence operations usable", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      await db.exec(migration);

      const buckets = await db.query<{ id: string; public: boolean }>(`
        SELECT id, public
        FROM storage.buckets
        WHERE id IN ('disclosure-raw', 'disclosure-preview')
        ORDER BY id
      `);
      expect(buckets.rows).toEqual([
        { id: "disclosure-preview", public: false },
        { id: "disclosure-raw", public: false },
      ]);

      const policySummary = await db.query<{
        policy_count: number;
        restrictive_count: number;
        select_count: number;
        insert_count: number;
        update_count: number;
        delete_count: number;
        scoped_count: number;
      }>(`
        SELECT
          count(*)::int AS policy_count,
          count(*) FILTER (WHERE permissive = 'RESTRICTIVE')::int
            AS restrictive_count,
          count(*) FILTER (WHERE cmd = 'SELECT')::int AS select_count,
          count(*) FILTER (WHERE cmd = 'INSERT')::int AS insert_count,
          count(*) FILTER (WHERE cmd = 'UPDATE')::int AS update_count,
          count(*) FILTER (WHERE cmd = 'DELETE')::int AS delete_count,
          count(*) FILTER (
            WHERE roles @> ARRAY['anon'::name, 'authenticated'::name]
              AND roles <@ ARRAY['anon'::name, 'authenticated'::name]
          )::int AS scoped_count
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname LIKE 'disclosure_evidence_client_%_fence'
      `);
      expect(policySummary.rows).toEqual([{
        policy_count: 4,
        restrictive_count: 4,
        select_count: 1,
        insert_count: 1,
        update_count: 1,
        delete_count: 1,
        scoped_count: 4,
      }]);

      const storageTable = await db.query<{
        owner: string;
        rls_enabled: boolean;
      }>(`
        SELECT
          pg_get_userbyid(storage_object.relowner) AS owner,
          storage_object.relrowsecurity AS rls_enabled
        FROM pg_class AS storage_object
        JOIN pg_namespace AS storage_namespace
          ON storage_namespace.oid = storage_object.relnamespace
        WHERE storage_namespace.nspname = 'storage'
          AND storage_object.relname = 'objects'
      `);
      expect(storageTable.rows).toEqual([{
        owner: "supabase_storage_admin",
        rls_enabled: true,
      }]);

      await setRole(db, "service_role");
      try {
        const evidenceBefore = await db.query<{ bucket_id: string }>(`
          SELECT bucket_id
          FROM storage.objects
          WHERE bucket_id IN ('disclosure-raw', 'disclosure-preview')
          ORDER BY bucket_id
        `);
        expect(evidenceBefore.rows).toEqual([
          { bucket_id: "disclosure-preview" },
          { bucket_id: "disclosure-raw" },
        ]);

        const inserted = await db.query<{ name: string }>(`
          INSERT INTO storage.objects (bucket_id, name)
          VALUES ('disclosure-preview', 'service-created.txt')
          RETURNING name
        `);
        expect(inserted.rows).toEqual([{ name: "service-created.txt" }]);

        const updated = await db.query<{ name: string }>(`
          UPDATE storage.objects
          SET name = 'service-updated.txt'
          WHERE bucket_id = 'disclosure-preview'
            AND name = 'service-created.txt'
          RETURNING name
        `);
        expect(updated.rows).toEqual([{ name: "service-updated.txt" }]);

        const deleted = await db.query<{ name: string }>(`
          DELETE FROM storage.objects
          WHERE bucket_id = 'disclosure-preview'
            AND name = 'service-updated.txt'
          RETURNING name
        `);
        expect(deleted.rows).toEqual([{ name: "service-updated.txt" }]);
      } finally {
        await resetRole(db);
      }
    } finally {
      await db.close();
    }
  });
});
