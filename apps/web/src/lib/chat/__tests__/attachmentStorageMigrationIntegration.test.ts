// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const expandMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/platform-operations/storage/20260714162000_chat_attachment_expand.sql"
  ),
  "utf8"
);
const contractMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/platform-operations/storage/20260714167000_chat_attachment_contract.sql"
  ),
  "utf8"
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;

    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE FUNCTION storage.foldername(object_name text)
    RETURNS text[]
    LANGUAGE sql
    IMMUTABLE
    AS $$
      SELECT CASE
        WHEN cardinality(string_to_array(object_name, '/')) <= 1 THEN ARRAY[]::text[]
        ELSE (string_to_array(object_name, '/'))[
          1:cardinality(string_to_array(object_name, '/')) - 1
        ]
      END
    $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid
    );

    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      public boolean NOT NULL DEFAULT false
    );

    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL UNIQUE,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE POLICY profiles_self_select
      ON public.profiles FOR SELECT TO authenticated
      USING (id = auth.uid());

    -- Test-only read policy lets SQL locate rows so UPDATE/DELETE policy behavior
    -- can be asserted independently from the private bucket's signed-read path.
    CREATE POLICY storage_test_visible
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'chat-image');

    GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), storage.foldername(text) TO authenticated;
    GRANT SELECT ON public.profiles TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

    INSERT INTO public.profiles (id, couple_id)
    VALUES
      ('${USER_ID}', '${COUPLE_ID}'),
      ('${PARTNER_ID}', '${COUPLE_ID}');
    INSERT INTO storage.buckets (id, public) VALUES ('chat-image', true);
  `);
  await db.exec(`BEGIN;\n${expandMigration}\nCOMMIT;`);
  await db.exec(`BEGIN;\n${contractMigration}\nCOMMIT;`);
  return db;
}

describe("chat attachment storage migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createDatabase();
    await db.exec(`
      SET ROLE authenticated;
      SET "request.jwt.claim.sub" = '${USER_ID}';
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it("makes the bucket private only after the uploader-bound policy exists", async () => {
    await db.exec("RESET ROLE");
    const bucket = await db.query<{ public: boolean }>(
      "SELECT public FROM storage.buckets WHERE id = 'chat-image'"
    );
    expect(bucket.rows[0]?.public).toBe(false);
  });

  it("allows only the caller's new uploader folder and rejects legacy, partner, and traversal writes", async () => {
    const ownPath = `${COUPLE_ID}/${USER_ID}/44444444-4444-4444-8444-444444444444.png`;
    await expect(db.exec(`
      INSERT INTO storage.objects (bucket_id, name)
      VALUES ('chat-image', '${ownPath}');
    `)).resolves.toBeDefined();

    const rejectedPaths = [
      `${COUPLE_ID}/${PARTNER_ID}/partner.png`,
      `${COUPLE_ID}/legacy.png`,
      `${COUPLE_ID}/${USER_ID}/../partner/secret.png`,
      `${COUPLE_ID}/${USER_ID}/%2e%2e%2fsecret.png`,
      `${COUPLE_ID}/${USER_ID}/unsafe name.png`,
    ];
    for (const path of rejectedPaths) {
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${path}');
      `)).rejects.toThrow(/row-level security policy/i);
    }
  });

  it("prevents authenticated updates and deletes of partner and legacy objects", async () => {
    const ownPath = `${COUPLE_ID}/${USER_ID}/own.png`;
    const partnerPath = `${COUPLE_ID}/${PARTNER_ID}/partner.png`;
    const legacyPath = `${COUPLE_ID}/legacy.png`;

    await db.exec(`
      RESET ROLE;
      INSERT INTO storage.objects (bucket_id, name)
      VALUES
        ('chat-image', '${ownPath}'),
        ('chat-image', '${partnerPath}'),
        ('chat-image', '${legacyPath}');
      SET ROLE authenticated;
      SET "request.jwt.claim.sub" = '${USER_ID}';
    `);

    const ownUpdate = await db.query<{ name: string }>(`
      UPDATE storage.objects SET metadata = '{"updated":true}'
      WHERE name = '${ownPath}' RETURNING name;
    `);
    const forbiddenUpdate = await db.query<{ name: string }>(`
      UPDATE storage.objects SET metadata = '{"updated":true}'
      WHERE name IN ('${partnerPath}', '${legacyPath}') RETURNING name;
    `);
    const forbiddenDelete = await db.query<{ name: string }>(`
      DELETE FROM storage.objects
      WHERE name IN ('${partnerPath}', '${legacyPath}') RETURNING name;
    `);

    expect(ownUpdate.rows).toEqual([{ name: ownPath }]);
    expect(forbiddenUpdate.rows).toEqual([]);
    expect(forbiddenDelete.rows).toEqual([]);
  });
});
