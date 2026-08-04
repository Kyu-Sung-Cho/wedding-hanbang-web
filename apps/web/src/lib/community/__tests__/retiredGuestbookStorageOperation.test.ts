// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const operationRoot = resolve(
  process.cwd(),
  "../../supabase/platform-operations/storage",
);
const inventoryPath = resolve(
  operationRoot,
  "20260804120000_retired_guestbook_storage_inventory.sql",
);
const verifyPath = resolve(
  operationRoot,
  "20260804120000_retired_guestbook_storage_verify.sql",
);
const applyScriptPath = resolve(
  process.cwd(),
  "../../scripts/retire-guestbook-storage-buckets.mjs",
);

function operationBody(sql: string) {
  return sql
    .replace(/^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/imu, "")
    .replace(/\bCOMMIT\s*;\s*$/iu, "");
}

describe("retired guestbook hosted Storage operation", () => {
  it("provides separate read-only inventory and fail-closed verification", () => {
    expect(existsSync(inventoryPath)).toBe(true);
    expect(existsSync(verifyPath)).toBe(true);

    const inventory = readFileSync(inventoryPath, "utf8");
    const verify = readFileSync(verifyPath, "utf8");

    expect(inventory).toMatch(/BEGIN TRANSACTION READ ONLY/iu);
    expect(verify).toMatch(/BEGIN TRANSACTION READ ONLY/iu);
    expect(inventory).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/imu);
    expect(verify).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/imu);
    expect(verify).toContain("RETIRED_GUESTBOOK_STORAGE_VERIFY_FAILED");
    expect(inventory).toContain("READY_TO_PRIVATIZE");
    expect(inventory).toContain("ALREADY_PRIVATE");
    expect(verify).toContain("guestbook-images");
    expect(verify).toContain("guestbook-uploads");
  });

  it("uses the supported destination-fenced Storage API for the bucket change", () => {
    expect(existsSync(applyScriptPath)).toBe(true);
    const source = readFileSync(applyScriptPath, "utf8");
    expect(source).toContain("verifySupabaseServiceDestinationFromEnv");
    expect(source).toContain('access: "operator-write"');
    expect(source).toContain("storage.updateBucket");
    expect(source).toContain("--apply");
    expect(source).toContain("RETIRED_GUESTBOOK_BUCKETS_PRIVATE");
    expect(source).not.toMatch(/\.from\(["']storage\.buckets["']\)/u);
  });

  it("passes only for private retained buckets and the exact no-read policy manifest", async () => {
    const verify = readFileSync(verifyPath, "utf8");
    const db = await PGlite.create({ extensions: { pgcrypto } });
    try {
      await db.exec(`
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE supabase_storage_admin NOLOGIN;
        CREATE SCHEMA auth;
        CREATE SCHEMA storage;
        CREATE SCHEMA extensions;
        CREATE EXTENSION pgcrypto SCHEMA extensions;

        CREATE FUNCTION auth.uid()
        RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
        CREATE FUNCTION storage.foldername(object_name text)
        RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
          SELECT CASE
            WHEN cardinality(string_to_array(object_name, '/')) <= 1
              THEN ARRAY[]::text[]
            ELSE (string_to_array(object_name, '/'))[
              1:cardinality(string_to_array(object_name, '/')) - 1
            ]
          END
        $$;
        CREATE FUNCTION public.is_current_couple_path_member(text)
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
        CREATE FUNCTION public.account_deletion_storage_writes_allowed()
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
        CREATE FUNCTION public.production_storage_writes_allowed()
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

        CREATE TABLE storage.buckets (
          id text PRIMARY KEY,
          name text NOT NULL,
          public boolean NOT NULL
        );
        CREATE TABLE storage.objects (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          bucket_id text NOT NULL,
          name text NOT NULL
        );
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

        INSERT INTO storage.buckets(id, name, public) VALUES
          ('guestbook-images', 'guestbook-images', false),
          ('guestbook-uploads', 'guestbook-uploads', false);
        INSERT INTO storage.objects(bucket_id, name) VALUES
          ('guestbook-images', 'retained-one.jpg'),
          ('guestbook-uploads', 'retained-two.jpg');

        CREATE POLICY "chat-image own uploader folder write fixture"
          ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
          WITH CHECK (
            bucket_id = 'chat-image'
            AND array_length(storage.foldername(name), 1) = 2
            AND (storage.foldername(name))[1] ~
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND public.is_current_couple_path_member(
              (storage.foldername(name))[1]
            )
            AND (storage.foldername(name))[2] = auth.uid()::text
            AND split_part(name, '/', 3) ~
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpeg|jpg|png|gif|webp)$'
            AND public.account_deletion_storage_writes_allowed()
            AND (SELECT public.production_storage_writes_allowed())
          );
      `);

      await expect(db.exec(operationBody(verify))).resolves.toBeDefined();

      await db.exec("UPDATE storage.buckets SET public = true WHERE id = 'guestbook-uploads'");
      await expect(db.exec(operationBody(verify))).rejects.toThrow(
        /RETIRED_GUESTBOOK_STORAGE_VERIFY_FAILED: bucket contract/iu,
      );
      await db.exec("UPDATE storage.buckets SET public = false WHERE id = 'guestbook-uploads'");

      await db.exec(`CREATE POLICY "unexpected read"
        ON storage.objects FOR SELECT TO authenticated USING (true)`);
      await expect(db.exec(operationBody(verify))).rejects.toThrow(
        /RETIRED_GUESTBOOK_STORAGE_VERIFY_FAILED: policy manifest/iu,
      );
    } finally {
      await db.close();
    }
  });
});
