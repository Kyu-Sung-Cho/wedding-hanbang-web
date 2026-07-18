// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718201000_admin_json_evidence.sql",
  ),
  "utf8",
);

async function baseline() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    INSERT INTO storage.buckets (
      id, name, public, file_size_limit, allowed_mime_types
    ) VALUES (
      'disclosure-raw', 'disclosure-raw', false, 52428800,
      ARRAY['application/pdf', 'image/png']::text[]
    );
    CREATE FUNCTION public.disclosure_object_keys_are_safe(text[])
    RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
  `);
  return db;
}

describe("admin JSON evidence migration", () => {
  it("allows only content-addressed JSON keys and adds its exact MIME type", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      const result = await db.query<{
        json_ok: boolean;
        traversal_rejected: boolean;
        executable_rejected: boolean;
        mime_ok: boolean;
        is_private: boolean;
      }>(`
        SELECT
          public.disclosure_object_keys_are_safe(
            ARRAY[repeat('a', 64) || '.json']::text[]
          ) AS json_ok,
          NOT public.disclosure_object_keys_are_safe(
            ARRAY['../' || repeat('a', 64) || '.json']::text[]
          ) AS traversal_rejected,
          NOT public.disclosure_object_keys_are_safe(
            ARRAY[repeat('a', 64) || '.js']::text[]
          ) AS executable_rejected,
          'application/json' = ANY(allowed_mime_types) AS mime_ok,
          public = false AS is_private
        FROM storage.buckets
        WHERE id = 'disclosure-raw'
      `);
      expect(result.rows).toEqual([{
        json_ok: true,
        traversal_rejected: true,
        executable_rejected: true,
        mime_ok: true,
        is_private: true,
      }]);
    } finally {
      await db.close();
    }
  });

  it("does not grant the validator to browser roles", async () => {
    const db = await baseline();
    try {
      await db.exec(migration);
      const result = await db.query<{ anon_exec: boolean; auth_exec: boolean }>(`
        SELECT
          has_function_privilege(
            'anon', 'public.disclosure_object_keys_are_safe(text[])', 'EXECUTE'
          ) AS anon_exec,
          has_function_privilege(
            'authenticated', 'public.disclosure_object_keys_are_safe(text[])', 'EXECUTE'
          ) AS auth_exec
      `);
      expect(result.rows[0]).toEqual({ anon_exec: false, auth_exec: false });
    } finally {
      await db.close();
    }
  });
});
