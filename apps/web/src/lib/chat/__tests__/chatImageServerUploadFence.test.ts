// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const operationRoot = resolve(repoRoot, "supabase/platform-operations/storage");
const applyOperation = readFileSync(
  resolve(operationRoot, "20260802159000_chat_image_server_upload_fence_apply.sql"),
  "utf8",
);
const verifyOperation = readFileSync(
  resolve(operationRoot, "20260802159000_chat_image_server_upload_fence_verify.sql"),
  "utf8",
);
const rollbackOperation = readFileSync(
  resolve(operationRoot, "20260802159000_chat_image_server_upload_fence_rollback.sql"),
  "utf8",
);
const rollbackVerifyOperation = readFileSync(
  resolve(operationRoot, "20260802159000_chat_image_server_upload_fence_rollback_verify.sql"),
  "utf8",
);
const inventoryOperation = readFileSync(
  resolve(operationRoot, "20260802159000_chat_image_server_upload_fence_inventory.sql"),
  "utf8",
);
const releaseCheck = readFileSync(
  resolve(
    repoRoot,
    "supabase/release-checks/amora-engine-v2-chat-image-server-upload-post-push.sql",
  ),
  "utf8",
);
const operationRunbook = readFileSync(
  resolve(
    repoRoot,
    "docs/operations/CHAT_IMAGE_SERVER_UPLOAD_FENCE_2026-08-03.md",
  ),
  "utf8",
);
const amoraManifestSource = readFileSync(
  resolve(repoRoot, "supabase/release-manifests/amora-engine-v2-20260716.json"),
  "utf8",
);
const amoraManifest = JSON.parse(amoraManifestSource) as {
  postPushChecks: Array<{
    id: string;
    file: string;
    sha256: string;
    expectedEvidence: Record<string, number>;
  }>;
  manualPlatformOperations: Array<{
    id: string;
    verificationCheckId: string;
    file: string;
    sha256: string;
  }>;
  rollbackArtifacts: Array<{
    forOperationId: string;
    file: string;
    sha256: string;
  }>;
  requiredDocuments: Array<{ file: string; sha256: string }>;
};
const vendorManifest = JSON.parse(readFileSync(
  resolve(repoRoot, "supabase/release-manifests/vendor-disclosure-v2-20260718.json"),
  "utf8",
)) as {
  predecessorManifest: { file: string; sha256: string };
  expandMigrations: Array<{ file: string; sha256: string }>;
};

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const EXISTING_SERVER_PATH =
  `${COUPLE_ID}/${USER_ID}/33333333-3333-4333-8333-333333333333.jpeg`;
const EXISTING_LEGACY_PATH = `${COUPLE_ID}/legacy.jpeg`;

function canonicalSha256(value: string): string {
  return createHash("sha256")
    .update(value.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

async function createDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE supabase_storage_admin NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text $$;

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

    CREATE FUNCTION public.is_current_couple_path_member(couple_id_text text)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT couple_id_text <> '' $$;
    CREATE FUNCTION public.account_deletion_storage_writes_allowed()
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.production_storage_writes_allowed()
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL UNIQUE,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

    GRANT USAGE ON SCHEMA auth, storage TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), storage.foldername(text),
      public.is_current_couple_path_member(text),
      public.account_deletion_storage_writes_allowed(),
      public.production_storage_writes_allowed()
      TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects
      TO authenticated, service_role;

    INSERT INTO storage.buckets (
      id, name, public, file_size_limit, allowed_mime_types
    ) VALUES (
      'chat-image', 'chat-image', false, 3 * 1024 * 1024,
      ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    );
    INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
      ('chat-image', '${EXISTING_SERVER_PATH}',
        '{"mimetype":"image/jpeg","size":"1024"}'::jsonb),
      ('chat-image', '${EXISTING_LEGACY_PATH}',
        '{"mimetype":"image/jpeg","size":"2048"}'::jsonb);

    CREATE POLICY "chat-image own uploader folder write generated_9"
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
  return db;
}

describe("chat-image server-owned upload Storage fence", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createDatabase();
  }, 30_000);

  afterEach(async () => {
    await db.exec("RESET ROLE").catch(() => undefined);
    await db.close();
  });

  it("removes only the reviewed direct policy without deleting legacy objects", async () => {
    const before = await db.query<{ name: string }>(`
      SELECT name FROM storage.objects WHERE bucket_id = 'chat-image' ORDER BY name
    `);
    await expect(db.exec(applyOperation)).resolves.toBeDefined();
    const after = await db.query<{ name: string }>(`
      SELECT name FROM storage.objects WHERE bucket_id = 'chat-image' ORDER BY name
    `);
    const policies = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    `);

    expect(after.rows).toEqual(before.rows);
    expect(policies.rows).toEqual([{ count: 0 }]);
    await expect(db.exec(verifyOperation)).resolves.toBeDefined();
  });

  it("denies authenticated INSERT/UPDATE while service_role keeps the server path writable", async () => {
    await db.exec(applyOperation);
    const clientPath = `${COUPLE_ID}/${USER_ID}/44444444-4444-4444-8444-444444444444.jpeg`;
    await db.exec(`
      SET ROLE authenticated;
      SET "request.jwt.claim.sub" = '${USER_ID}';
    `);
    await expect(db.exec(`
      INSERT INTO storage.objects (bucket_id, name)
      VALUES ('chat-image', '${clientPath}')
    `)).rejects.toThrow(/row-level security policy/i);
    const clientUpdate = await db.query<{ name: string }>(`
      UPDATE storage.objects SET metadata = '{"client":true}'::jsonb
      WHERE name = '${EXISTING_SERVER_PATH}' RETURNING name
    `);
    expect(clientUpdate.rows).toEqual([]);

    await db.exec("RESET ROLE; SET ROLE service_role;");
    await expect(db.exec(`
      INSERT INTO storage.objects (bucket_id, name)
      VALUES ('chat-image', '${clientPath}');
      UPDATE storage.objects SET metadata = '{"server":true}'::jsonb
      WHERE name = '${clientPath}';
    `)).resolves.toBeDefined();
    const serviceRead = await db.query<{ metadata: { server?: boolean } }>(`
      SELECT metadata FROM storage.objects WHERE name = '${clientPath}'
    `);
    expect(serviceRead.rows).toEqual([{ metadata: { server: true } }]);
  });

  it("also contracts the exact four-read global-freeze prestate directly to zero", async () => {
    await db.exec(`
      DROP POLICY "chat-image own uploader folder write generated_9"
        ON storage.objects;
      CREATE POLICY "Anyone can view chat image"
        ON storage.objects AS PERMISSIVE FOR SELECT TO public
        USING (bucket_id = 'chat-image');
      CREATE POLICY "Anyone can view chat images"
        ON storage.objects AS PERMISSIVE FOR SELECT TO public
        USING (bucket_id = 'chat-images');
      CREATE POLICY "공개: 업체 이미지 조회"
        ON storage.objects AS PERMISSIVE FOR SELECT TO public
        USING (bucket_id = 'vendor-images');
      CREATE POLICY "서비스: 사업자등록증 조회"
        ON storage.objects AS PERMISSIVE FOR SELECT TO public
        USING (bucket_id = 'vendor-licenses' AND auth.role() = 'service_role');
    `);

    await expect(db.exec(applyOperation)).resolves.toBeDefined();
    const policies = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    `);
    expect(policies.rows).toEqual([{ count: 0 }]);
  });

  it("fails closed on an unknown policy instead of dropping unreviewed access", async () => {
    await db.exec(`
      CREATE POLICY unexpected_chat_read ON storage.objects
        FOR SELECT TO authenticated USING (bucket_id = 'chat-image')
    `);
    await expect(db.exec(applyOperation)).rejects.toThrow(
      /CHAT_IMAGE_SERVER_UPLOAD_FENCE_POLICY_DRIFT/,
    );
    await db.exec("ROLLBACK");
    const policies = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    `);
    expect(policies.rows).toEqual([{ count: 2 }]);
  });

  it("keeps rollback fail-closed and never recreates authenticated privileges", async () => {
    await db.exec(applyOperation);
    await expect(db.exec(rollbackOperation)).resolves.toBeDefined();
    await expect(db.exec(rollbackVerifyOperation)).resolves.toBeDefined();
    expect(rollbackOperation).not.toMatch(/CREATE\s+POLICY/i);
    expect(rollbackOperation).toContain("NO PRIVILEGE RESTORATION");
  });

  it("keeps inventory read-only and hashes object paths", () => {
    expect(inventoryOperation).toMatch(/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
    expect(inventoryOperation).toContain("object_path_sha256");
    expect(inventoryOperation).not.toMatch(
      /^\s*(?:DROP|CREATE|ALTER|INSERT|UPDATE|DELETE)\s+/im,
    );
    expect(releaseCheck).toMatch(/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
    expect(releaseCheck).toContain("production_storage_writes_allowed");
    expect(releaseCheck).toContain("storage_bucket_count");
    expect(releaseCheck).toContain("authenticated_storage_mutation_policy_count");
  });

  it("pins the application upload to the service-role client and removes browser Storage upload", () => {
    const route = readFileSync(
      resolve(repoRoot, "apps/web/src/app/api/chat/route.ts"),
      "utf8",
    );
    const admin = readFileSync(
      resolve(repoRoot, "apps/web/src/lib/supabase/admin.ts"),
      "utf8",
    );
    const chatStore = readFileSync(
      resolve(repoRoot, "apps/web/src/stores/chatStore.ts"),
      "utf8",
    );

    expect(route).toMatch(/const admin = getServiceClient\(\)/);
    expect(route).toMatch(/admin\.storage\.from\("chat-image"\)/);
    expect(admin).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(chatStore).not.toMatch(/storage\.from\(["']chat-image["']\)/);
  });

  it("uses stable canonical hashes for release pinning", () => {
    for (const sql of [
      applyOperation,
      verifyOperation,
      rollbackOperation,
      rollbackVerifyOperation,
      inventoryOperation,
      releaseCheck,
    ]) {
      expect(canonicalSha256(sql)).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("pins apply, verification, fail-closed rollback, runbook, and successor chain", () => {
    const operationId = "chat-image-server-upload-finalize-20260802159000";
    const verificationId = "chat-image-server-upload-final-verify-20260802159000";
    const operation = amoraManifest.manualPlatformOperations.find(
      (entry) => entry.id === operationId,
    );
    const verification = amoraManifest.postPushChecks.find(
      (entry) => entry.id === verificationId,
    );
    const rollback = amoraManifest.rollbackArtifacts.find(
      (entry) => entry.forOperationId === operationId,
    );
    const runbook = amoraManifest.requiredDocuments.find(
      (entry) => entry.file
        === "docs/operations/CHAT_IMAGE_SERVER_UPLOAD_FENCE_2026-08-03.md",
    );

    expect(operation).toEqual({
      id: operationId,
      phase: "post-push-pre-deploy",
      verificationCheckId: verificationId,
      file: "supabase/platform-operations/storage/20260802159000_chat_image_server_upload_fence_apply.sql",
      sha256: canonicalSha256(applyOperation),
    });
    expect(verification).toEqual({
      id: verificationId,
      type: "read-only-sql",
      file: "supabase/release-checks/amora-engine-v2-chat-image-server-upload-post-push.sql",
      sha256: canonicalSha256(releaseCheck),
      expectedEvidence: {
        chat_image_server_upload_fence_verified_count: 1,
        storage_policy_count: 0,
        authenticated_storage_mutation_policy_count: 0,
        storage_bucket_count: 11,
        storage_object_count: 49,
        storage_staging_object_count: 0,
        production_storage_fence_closed_count: 1,
      },
    });
    expect(rollback).toMatchObject({
      forOperationId: operationId,
      file: "supabase/platform-operations/storage/20260802159000_chat_image_server_upload_fence_rollback.sql",
      sha256: canonicalSha256(rollbackOperation),
    });
    expect(runbook).toEqual({
      file: "docs/operations/CHAT_IMAGE_SERVER_UPLOAD_FENCE_2026-08-03.md",
      sha256: canonicalSha256(operationRunbook),
    });
    expect(vendorManifest.predecessorManifest).toEqual({
      file: "supabase/release-manifests/amora-engine-v2-20260716.json",
      sha256: canonicalSha256(amoraManifestSource),
    });
    expect(vendorManifest.expandMigrations.at(-1)?.file).toBe(
      "20260803113000_harden_ai_interactions_log_acl.sql",
    );
  });
});
