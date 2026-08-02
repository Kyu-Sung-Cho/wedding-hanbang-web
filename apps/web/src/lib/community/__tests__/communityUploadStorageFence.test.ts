// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260716108000_community_upload_service_fence.sql"
  ),
  "utf8"
);
const guestbookPrivacyMigration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260802134000_close_dormant_guestbook_public_surface.sql"
  ),
  "utf8"
);
const dormantStoragePrivacyMigration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260802143000_close_empty_dormant_storage_buckets.sql"
  ),
  "utf8"
);
const chatImageBucketLimitsMigration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260802157000_harden_chat_image_bucket_upload_limits.sql"
  ),
  "utf8"
);

const CURRENT_DIRECT_WRITE_POLICIES = [
  "community-images own folder write",
  "community-images own folder update",
  "community-images own folder delete",
  "community-videos own folder write",
  "community-videos own folder update",
  "community-videos own folder delete",
];
const platformOperationRoot = resolve(repoRoot, "supabase/platform-operations/storage");
const applyOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_apply.sql"),
  "utf8"
);
const rollbackOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_rollback.sql"),
  "utf8"
);
const rollbackVerifyOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_rollback_verify.sql"),
  "utf8"
);
const emergencyRollbackOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_emergency_rollback.sql"),
  "utf8"
);
const emergencyRollbackVerifyOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_emergency_rollback_verify.sql"),
  "utf8"
);
const freezeRecoveryOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_storage_global_write_freeze_rollback.sql"),
  "utf8"
);
const inventoryOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_inventory.sql"),
  "utf8"
);
const verifyOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_verify.sql"),
  "utf8"
);
const freezeOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_storage_global_write_freeze_apply.sql"),
  "utf8"
);
const freezeVerifyOperation = readFileSync(
  resolve(platformOperationRoot, "20260716108000_storage_global_write_freeze_verify.sql"),
  "utf8"
);
const preReleaseCheck = readFileSync(
  resolve(repoRoot, "supabase/release-checks/amora-engine-v2-20260716-pre.sql"),
  "utf8"
);
const postReleaseCheck = readFileSync(
  resolve(repoRoot, "supabase/release-checks/amora-engine-v2-20260716-post.sql"),
  "utf8"
);
const storageFreezeReleaseCheck = readFileSync(
  resolve(repoRoot, "supabase/release-checks/amora-engine-v2-storage-freeze-pre.sql"),
  "utf8"
);
const storageFinalReleaseCheck = readFileSync(
  resolve(repoRoot, "supabase/release-checks/amora-engine-v2-storage-final-post-push.sql"),
  "utf8"
);

function operationBody(sql: string) {
  return sql
    .replace(/^\s*BEGIN(?:\s+TRANSACTION\s+READ\s+ONLY)?\s*;/im, "")
    .replace(/\bCOMMIT\s*;\s*$/i, "");
}

function taggedDoBlock(sql: string, tag: string) {
  const opening = `DO $${tag}$`;
  const closing = `$${tag}$;`;
  const start = sql.indexOf(opening);
  const end = sql.indexOf(closing, start + opening.length);
  if (start < 0 || end < 0) throw new Error(`missing tagged DO block: ${tag}`);
  return sql.slice(start, end + closing.length);
}

function guestbookBucketPrivacyTransition(sql: string) {
  const statement = sql.match(
    /UPDATE\s+storage\.buckets\s+SET\s+public\s*=\s*FALSE\s+WHERE\s+id\s+IN\s*\(\s*'guestbook-images'\s*,\s*'guestbook-uploads'\s*\)\s*;/i
  );
  if (!statement) throw new Error("missing guestbook bucket privacy transition");
  return statement[0];
}

const guestbookBucketPrivacyOperation = guestbookBucketPrivacyTransition(
  guestbookPrivacyMigration
);

function dormantStorageBucketPrivacyTransition(sql: string) {
  const statement = sql.match(
    /UPDATE\s+storage\.buckets\s+SET\s+public\s*=\s*FALSE\s+WHERE\s+id\s+IN\s*\(\s*'cohort-images'\s*,\s*'invitation-photos'\s*,\s*'user_photos'\s*\)\s*;/i
  );
  if (!statement) throw new Error("missing dormant Storage bucket privacy transition");
  return statement[0];
}

const dormantStorageBucketPrivacyOperation = dormantStorageBucketPrivacyTransition(
  dormantStoragePrivacyMigration
);

async function createStorageDb() {
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
    CREATE TABLE public.account_deletion_jobs (user_id uuid, status text);
    CREATE FUNCTION public.account_deletion_storage_writes_allowed()
    RETURNS boolean
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '5s'
    SET statement_timeout = '10s'
    AS $storage_write_fence$
    DECLARE
      v_user_id uuid := auth.uid();
    BEGIN
      IF v_user_id IS NULL THEN RETURN false; END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text, 0)
      );
      RETURN NOT EXISTS (
        SELECT 1 FROM public.account_deletion_jobs AS job
        WHERE job.user_id = v_user_id AND job.status <> 'completed'
      );
    END;
    $storage_write_fence$;
    REVOKE ALL ON FUNCTION public.account_deletion_storage_writes_allowed()
      FROM PUBLIC, anon, service_role;
    GRANT EXECUTE ON FUNCTION public.account_deletion_storage_writes_allowed()
      TO authenticated;

    CREATE FUNCTION public.production_storage_writes_allowed()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $production_storage_write_fence$
      SELECT NOT (
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger AS trigger_record
          WHERE trigger_record.tgname = 'trg_production_write_fence_20260717'
            AND NOT trigger_record.tgisinternal
        )
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_event_trigger AS event_trigger_record
          WHERE event_trigger_record.evtname = 'evt_production_write_fence_20260717'
        )
        OR pg_catalog.to_regprocedure(
          'public.production_write_fence_guard_20260717()'
        ) IS NOT NULL
        OR pg_catalog.to_regprocedure(
          'public.production_write_fence_attach_20260717()'
        ) IS NOT NULL
      )
    $production_storage_write_fence$;
    REVOKE ALL ON FUNCTION public.production_storage_writes_allowed()
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.production_storage_writes_allowed()
      TO authenticated;

    CREATE FUNCTION public.production_write_fence_guard_20260717()
    RETURNS trigger LANGUAGE plpgsql AS $fence$ BEGIN RETURN NULL; END $fence$;

    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid,
      role text
    );
    CREATE FUNCTION public.is_current_couple_path_member(p_couple_id_text text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    SET statement_timeout = '5s'
    AS $current_couple_path_member$
      SELECT p_couple_id_text IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.profiles AS profile
          JOIN public.couples AS couple ON couple.id = profile.couple_id
          WHERE profile.id = auth.uid()
            AND couple.id::text = lower(btrim(p_couple_id_text))
            AND (
              (profile.role = 'bride' AND couple.bride_id = profile.id)
              OR (profile.role = 'groom' AND couple.groom_id = profile.id)
            )
        );
    $current_couple_path_member$;
    REVOKE ALL ON FUNCTION public.is_current_couple_path_member(text)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.is_current_couple_path_member(text)
      TO authenticated, service_role;
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
      name text NOT NULL UNIQUE
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES
      ('chat-image', 'chat-image', false, NULL, NULL),
      ('cohort-images', 'cohort-images', true, NULL, NULL),
      ('community-images', 'community-images', true, 10 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
      ('community-videos', 'community-videos', true, 50 * 1024 * 1024,
        ARRAY['video/mp4', 'video/quicktime', 'video/webm']),
      ('community-media-staging', 'community-media-staging', false, 6 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
      ('guestbook-images', 'guestbook-images', true, NULL, NULL),
      ('guestbook-uploads', 'guestbook-uploads', true, 5 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
      ('invitation-photos', 'invitation-photos', true, 10 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
      ('user_photos', 'user_photos', true, NULL, NULL),
      ('vendor-images', 'vendor-images', true, 5 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/webp']),
      ('vendor-licenses', 'vendor-licenses', false, 10 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'application/pdf']);

    GRANT USAGE ON SCHEMA auth, storage TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), storage.foldername(text)
      TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects
      TO authenticated, service_role;
  `);

  await db.exec(`
    CREATE POLICY "chat-image own uploader folder write pf46ue_0"
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
    INSERT INTO storage.objects (bucket_id, name)
    SELECT 'chat-image', 'production-chat-' || value::text
    FROM generate_series(1, 6) AS value;
    INSERT INTO storage.objects (bucket_id, name)
    SELECT 'community-images', 'production-community-' || value::text
    FROM generate_series(1, 43) AS value;
  `);
  return db;
}

async function applyPostMigrationBucketPrivacy(
  db: Awaited<ReturnType<typeof createStorageDb>>
) {
  await db.exec(guestbookBucketPrivacyOperation);
  await db.exec(dormantStorageBucketPrivacyOperation);
  await db.exec(chatImageBucketLimitsMigration);
}

async function expectPrivatePostMigrationBuckets(
  db: Awaited<ReturnType<typeof createStorageDb>>
) {
  const buckets = await db.query<{ id: string; public: boolean }>(`
    SELECT id, public
    FROM storage.buckets
    WHERE id IN (
      'cohort-images',
      'guestbook-images',
      'guestbook-uploads',
      'invitation-photos',
      'user_photos'
    )
    ORDER BY id
  `);
  expect(buckets.rows).toEqual([
    { id: "cohort-images", public: false },
    { id: "guestbook-images", public: false },
    { id: "guestbook-uploads", public: false },
    { id: "invitation-photos", public: false },
    { id: "user_photos", public: false },
  ]);
}

describe("community upload storage release fence", () => {
  it("creates only app-owned session state and has no hosted Storage prerequisite", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.community_upload_sessions");
    expect(migration).toContain("claim_community_upload_session");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toMatch(/REVOKE ALL ON TABLE[\s\S]*FROM authenticated/i);
    expect(migration).not.toMatch(/^\s*DROP\s+POLICY/im);
    expect(migration).not.toMatch(/^\s*CREATE\s+POLICY/im);
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?storage\./im);
    const executable = migration.replace(/^\s*--.*$/gm, "");
    expect(executable).not.toMatch(/\bpg_policies\b/i);
    expect(executable).not.toMatch(/\bstorage\.(?:objects|buckets)\b/i);
    expect(executable).not.toMatch(/\bsupabase_storage_admin\b/i);
    expect(migration).toContain("interval '2 hours 5 minutes'");
  });

  it("pins the private chat-image bucket to the reviewed size and MIME contract", async () => {
    expect(chatImageBucketLimitsMigration).toMatch(
      /UPDATE\s+storage\.buckets[\s\S]*file_size_limit\s*=\s*3\s*\*\s*1024\s*\*\s*1024/i
    );
    expect(chatImageBucketLimitsMigration).toContain(
      "ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]"
    );
    expect(chatImageBucketLimitsMigration).not.toMatch(
      /\bstorage\.objects\b|\b(?:CREATE|DROP|ALTER)\s+POLICY\b/i
    );

    const db = await createStorageDb();
    try {
      await expect(db.exec(chatImageBucketLimitsMigration)).resolves.toBeDefined();
      await expect(db.exec(chatImageBucketLimitsMigration)).resolves.toBeDefined();

      const contract = await db.query<{
        id: string;
        name: string;
        public: boolean;
        fileSizeLimit: string;
        allowedMimeTypes: string[];
        objectCount: string;
      }>(`
        SELECT bucket.id, bucket.name, bucket.public,
          bucket.file_size_limit::text AS "fileSizeLimit",
          bucket.allowed_mime_types AS "allowedMimeTypes",
          count(storage_object.id)::text AS "objectCount"
        FROM storage.buckets AS bucket
        LEFT JOIN storage.objects AS storage_object
          ON storage_object.bucket_id = bucket.id
        WHERE bucket.id = 'chat-image'
        GROUP BY bucket.id, bucket.name, bucket.public,
          bucket.file_size_limit, bucket.allowed_mime_types
      `);
      expect(contract.rows).toEqual([{
        id: "chat-image",
        name: "chat-image",
        public: false,
        fileSizeLimit: String(3 * 1024 * 1024),
        allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
        objectCount: "6",
      }]);

      const driftCases = [
        {
          mutation: "UPDATE storage.buckets SET public = TRUE WHERE id = 'chat-image'",
          error: /CHAT_IMAGE_BUCKET_LIMIT_FENCE_IDENTITY_OR_PRIVACY_DRIFT/,
        },
        {
          mutation: `UPDATE storage.buckets
            SET file_size_limit = 1024 * 1024
            WHERE id = 'chat-image'`,
          error: /CHAT_IMAGE_BUCKET_LIMIT_FENCE_PRESTATE_DRIFT/,
        },
        {
          mutation: `UPDATE storage.buckets
            SET allowed_mime_types = ARRAY['image/jpeg']
            WHERE id = 'chat-image'`,
          error: /CHAT_IMAGE_BUCKET_LIMIT_FENCE_PRESTATE_DRIFT/,
        },
        {
          mutation: "UPDATE storage.buckets SET name = 'renamed' WHERE id = 'chat-image'",
          error: /CHAT_IMAGE_BUCKET_LIMIT_FENCE_IDENTITY_OR_PRIVACY_DRIFT/,
        },
        {
          mutation: "DELETE FROM storage.buckets WHERE id = 'chat-image'",
          error: /CHAT_IMAGE_BUCKET_LIMIT_FENCE_BUCKET_MISSING/,
        },
      ];

      for (const testCase of driftCases) {
        await db.exec("BEGIN");
        await db.exec(testCase.mutation);
        await expect(
          db.exec(operationBody(chatImageBucketLimitsMigration))
        ).rejects.toThrow(testCase.error);
        await db.exec("ROLLBACK");
      }
    } finally {
      await db.close();
    }
  });

  it("accepts the exact fresh-bootstrap chat-image state and rejects nearby drift", async () => {
    const db = await createStorageDb();
    try {
      await db.exec(`
        UPDATE storage.buckets
        SET file_size_limit = 10 * 1024 * 1024,
            allowed_mime_types =
              ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        WHERE id = 'chat-image';
      `);

      await expect(db.exec(chatImageBucketLimitsMigration)).resolves.toBeDefined();
      const contract = await db.query<{
        fileSizeLimit: string;
        allowedMimeTypes: string[];
      }>(`
        SELECT file_size_limit::text AS "fileSizeLimit",
          allowed_mime_types AS "allowedMimeTypes"
        FROM storage.buckets
        WHERE id = 'chat-image'
      `);
      expect(contract.rows).toEqual([{
        fileSizeLimit: String(3 * 1024 * 1024),
        allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      }]);

      await db.exec("BEGIN");
      await db.exec(`
        UPDATE storage.buckets
        SET file_size_limit = 10 * 1024 * 1024,
            allowed_mime_types =
              ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
        WHERE id = 'chat-image';
      `);
      await expect(
        db.exec(operationBody(chatImageBucketLimitsMigration))
      ).rejects.toThrow(/CHAT_IMAGE_BUCKET_LIMIT_FENCE_PRESTATE_DRIFT/);
      await db.exec("ROLLBACK");
    } finally {
      await db.close();
    }
  });

  it("executes the exact 19 -> frozen four -> final one -> fail-closed zero -> final one policy sequence", async () => {
    const db = await createStorageDb();
    try {
      await db.exec(emergencyRollbackOperation);
      await expect(db.exec(inventoryOperation)).resolves.toBeDefined();
      await db.exec(`
        DELETE FROM storage.buckets WHERE id = 'community-media-staging';
      `);
      await db.exec(freezeOperation);
      await expect(db.exec(freezeVerifyOperation)).resolves.toBeDefined();
      await expect(db.exec(storageFreezeReleaseCheck)).resolves.toBeDefined();
      await expect(db.exec(taggedDoBlock(preReleaseCheck, "pre_storage_1080")))
        .resolves.toBeDefined();
      await applyPostMigrationBucketPrivacy(db);
      await db.exec(`
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
          'community-media-staging', 'community-media-staging', false,
          6 * 1024 * 1024,
          ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        );
      `);
      await db.exec(applyOperation);
      await expect(db.exec(verifyOperation)).resolves.toBeDefined();
      await expect(db.exec(storageFinalReleaseCheck)).resolves.toBeDefined();
      await expect(db.exec(taggedDoBlock(postReleaseCheck, "post_storage_1080")))
        .resolves.toBeDefined();
      await expect(db.exec(migration)).resolves.toBeDefined();

      await db.exec(rollbackOperation);
      await expect(db.exec(rollbackVerifyOperation)).resolves.toBeDefined();
      await expectPrivatePostMigrationBuckets(db);
      const rolledBackPolicies = await db.query<{ policy_count: string }>(`
        SELECT count(*)::text AS policy_count
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
      `);
      expect(rolledBackPolicies.rows).toEqual([{ policy_count: "0" }]);
      await db.exec(applyOperation);
      await expect(db.exec(verifyOperation)).resolves.toBeDefined();

      const policies = await db.query<{
        policyname: string;
        permissive: string;
        roles: string[];
        cmd: string;
      }>(`
        SELECT policyname, permissive, roles, cmd
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
      `);
      expect(policies.rows).toEqual([{
        policyname: "chat-image own uploader folder write pf46ue_0",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        cmd: "INSERT",
      }]);
    } finally {
      await db.close();
    }
  });

  it("rejects final owner, RLS, helper, command, role, expression, extra-policy, and staging drift", async () => {
    const db = await createStorageDb();
    try {
      await db.exec(emergencyRollbackOperation);
      await db.exec(freezeOperation);
      await applyPostMigrationBucketPrivacy(db);
      await db.exec(applyOperation);

      const cases = [
        {
          mutation: "ALTER TABLE storage.objects OWNER TO CURRENT_USER",
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: relation contract/,
        },
        {
          mutation: "ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY",
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: relation contract/,
        },
        {
          mutation: "ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY",
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: relation contract/,
        },
        {
          mutation: `
            DROP POLICY "chat-image own uploader folder write pf46ue_0" ON storage.objects;
            CREATE POLICY "chat-image own uploader folder write pf46ue_0"
              ON storage.objects FOR SELECT TO authenticated USING (true)
          `,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: policy manifest/,
        },
        {
          mutation: `
            DROP POLICY "chat-image own uploader folder write pf46ue_0" ON storage.objects;
            CREATE POLICY "chat-image own uploader folder write pf46ue_0"
              ON storage.objects FOR INSERT TO public WITH CHECK (true)
          `,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: policy manifest/,
        },
        {
          mutation: `
            DROP POLICY "chat-image own uploader folder write pf46ue_0" ON storage.objects;
            CREATE POLICY "chat-image own uploader folder write pf46ue_0"
              ON storage.objects FOR INSERT TO authenticated WITH CHECK (true)
          `,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: policy manifest/,
        },
        {
          mutation: `CREATE POLICY "unexpected broad write"
            ON storage.objects FOR INSERT TO authenticated WITH CHECK (true)`,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: policy manifest/,
        },
        {
          mutation: `GRANT EXECUTE ON FUNCTION
            public.account_deletion_storage_writes_allowed() TO anon`,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: deletion fence/,
        },
        {
          mutation: `GRANT EXECUTE ON FUNCTION
            public.production_storage_writes_allowed() TO anon`,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: production fence/,
        },
        {
          mutation: `GRANT EXECUTE ON FUNCTION
            public.is_current_couple_path_member(text) TO anon`,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: membership fence/,
        },
        {
          mutation: "DROP FUNCTION public.production_write_fence_guard_20260717()",
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: production fence/,
        },
        {
          mutation: `INSERT INTO storage.objects (bucket_id, name)
            VALUES ('community-media-staging', 'fixture/nonzero.png')`,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: bucket contract/,
        },
        {
          mutation: `UPDATE storage.buckets
            SET file_size_limit = NULL
            WHERE id = 'chat-image'`,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: bucket contract/,
        },
        {
          mutation: `UPDATE storage.buckets
            SET allowed_mime_types = ARRAY['image/jpeg', 'text/html']
            WHERE id = 'chat-image'`,
          error: /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: bucket contract/,
        },
      ];

      for (const testCase of cases) {
        await db.exec("BEGIN");
        await db.exec(testCase.mutation);
        await expect(db.exec(operationBody(verifyOperation))).rejects.toThrow(testCase.error);
        await db.exec("ROLLBACK");
      }
    } finally {
      await db.close();
    }
  });

  it("treats generated policy-name suffixes as metadata while rejecting a duplicate semantic policy", async () => {
    const db = await createStorageDb();
    try {
      await db.exec(emergencyRollbackOperation);
      await db.exec(freezeOperation);
      await applyPostMigrationBucketPrivacy(db);
      await db.exec(applyOperation);
      await db.exec(`
        ALTER POLICY "chat-image own uploader folder write pf46ue_0"
          ON storage.objects
          RENAME TO "chat-image own uploader folder write regenerated_7";
      `);

      await expect(db.exec(verifyOperation)).resolves.toBeDefined();
      await expect(db.exec(storageFinalReleaseCheck)).resolves.toBeDefined();

      await db.exec("BEGIN");
      await db.exec(`
        CREATE POLICY "chat-image own uploader folder write duplicate_8"
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
      await expect(db.exec(operationBody(verifyOperation))).rejects.toThrow(
        /COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED: policy manifest/
      );
      await db.exec("ROLLBACK");

      await db.exec(rollbackOperation);
      await expect(db.exec(rollbackVerifyOperation)).resolves.toBeDefined();

      await db.exec(applyOperation);
      await db.exec(`
        ALTER POLICY "chat-image own uploader folder write pf46ue_0"
          ON storage.objects
          RENAME TO "chat-image own uploader folder write emergency_9";
      `);
      await db.exec(emergencyRollbackOperation);
      await expect(db.exec(emergencyRollbackVerifyOperation)).resolves.toBeDefined();
      await expectPrivatePostMigrationBuckets(db);
    } finally {
      await db.close();
    }
  });

  it("fails the pre-backup freeze closed on prestate, relation, policy, bucket, and object-count drift", async () => {
    const db = await createStorageDb();
    try {
      await db.exec(emergencyRollbackOperation);
      await db.exec("BEGIN");
      await db.exec(`DROP POLICY "community-images own folder write" ON storage.objects`);
      await expect(db.exec(operationBody(freezeOperation)))
        .rejects.toThrow(/STORAGE_FREEZE_PRECONDITION_POLICY_DRIFT/);
      await db.exec("ROLLBACK");

      await db.exec(`DELETE FROM storage.buckets WHERE id = 'community-media-staging'`);
      await db.exec(freezeRecoveryOperation);
      await expect(db.exec(freezeVerifyOperation)).resolves.toBeDefined();

      // Phase-1 safe recovery does not touch buckets. The pre-backup verifier
      // runs only after staging has been removed/confirmed absent.

      const cases = [
        {
          mutation: "ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY",
          error: /STORAGE_FREEZE_VERIFY_RELATION_INVALID/,
        },
        {
          mutation: `CREATE POLICY "unexpected frozen write"
            ON storage.objects FOR INSERT TO authenticated WITH CHECK (true)`,
          error: /STORAGE_FREEZE_VERIFY_POLICY_MANIFEST_INVALID/,
        },
        {
          mutation: `INSERT INTO storage.buckets
            (id, name, public, file_size_limit, allowed_mime_types)
            VALUES ('unexpected', 'unexpected', false, NULL, NULL)`,
          error: /STORAGE_FREEZE_VERIFY_BUCKET_OR_OBJECT_DRIFT/,
        },
        {
          mutation: `DELETE FROM storage.objects
            WHERE id = (SELECT id FROM storage.objects WHERE bucket_id = 'chat-image' LIMIT 1)`,
          error: /STORAGE_FREEZE_VERIFY_BUCKET_OR_OBJECT_DRIFT/,
        },
      ];

      for (const testCase of cases) {
        await db.exec("BEGIN");
        await db.exec(testCase.mutation);
        await expect(db.exec(operationBody(freezeVerifyOperation)))
          .rejects.toThrow(testCase.error);
        await db.exec("ROLLBACK");
      }
    } finally {
      await db.close();
    }
  });

  it("pins the PGlite canonical hash for the sole deletion-aware chat INSERT policy", async () => {
    const db = await createStorageDb();
    try {
      const hashes = await db.query<{ policyname: string; expression_sha256: string }>(`
        SELECT policyname,
          encode(extensions.digest(
            lower(regexp_replace(
              coalesce(qual, '') || E'\\n' || coalesce(with_check, ''),
              E'\\\\s+', '', 'g'
            )), 'sha256'
          ), 'hex') AS expression_sha256
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
        ORDER BY policyname
      `);
      expect(hashes.rows).toEqual([
        {
          policyname: "chat-image own uploader folder write pf46ue_0",
          expression_sha256: "7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482",
        },
      ]);

      const helperHashes = await db.query<{ signature: string; body_sha256: string }>(`
        SELECT oid::regprocedure::text AS signature,
          encode(extensions.digest(
            lower(regexp_replace(prosrc, E'\\\\s+', '', 'g')),
            'sha256'
          ), 'hex') AS body_sha256
        FROM pg_proc
        WHERE oid IN (
          'public.account_deletion_storage_writes_allowed()'::regprocedure,
          'public.production_storage_writes_allowed()'::regprocedure,
          'public.is_current_couple_path_member(text)'::regprocedure
        )
        ORDER BY signature
      `);
      expect(helperHashes.rows).toEqual([
        {
          signature: "account_deletion_storage_writes_allowed()",
          body_sha256: "0b785a6700c258851930b44d1502a2c595de5e7e3d19e10183dfe2d25c454930",
        },
        {
          signature: "is_current_couple_path_member(text)",
          body_sha256: "72019e8324f0d8e014f06fbdb6e4dfb4dffa80254a58c421b11631d85dff4e5e",
        },
        {
          signature: "production_storage_writes_allowed()",
          body_sha256: "2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316",
        },
      ]);
    } finally {
      await db.close();
    }
  });

  it("claims only the owner's issued session and cannot steal a live finalization lease", async () => {
    const db = await createStorageDb();
    const userId = "11111111-1111-4111-8111-111111111111";
    const otherUserId = "22222222-2222-4222-8222-222222222222";
    const uploadId = "33333333-3333-4333-8333-333333333333";
    const firstClaim = "44444444-4444-4444-8444-444444444444";
    const secondClaim = "55555555-5555-4555-8555-555555555555";
    try {
      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('${userId}'), ('${otherUserId}');
      `);
      await db.exec(migration);
      await db.exec(`
        INSERT INTO public.community_upload_sessions (
          id, user_id, staging_path, final_bucket, final_path,
          declared_mime_type, declared_size, expires_at
        ) VALUES (
          '${uploadId}', '${userId}', '${userId}/${uploadId}.png',
          'community-images', '${userId}/${uploadId}.png', 'image/png', 1234,
          clock_timestamp() + interval '2 hours'
        );
      `);
      await expect(db.exec(`
        INSERT INTO public.community_upload_sessions (
          id, user_id, staging_path, final_bucket, final_path,
          declared_mime_type, declared_size, expires_at
        ) VALUES (
          '66666666-6666-4666-8666-666666666666', '${userId}',
          '${otherUserId}/66666666-6666-4666-8666-666666666666.png',
          'community-images',
          '${otherUserId}/66666666-6666-4666-8666-666666666666.png',
          'image/png', 1234, clock_timestamp() + interval '2 hours'
        );
      `)).rejects.toThrow(/community_upload_sessions_owner_path/);

      await db.exec("SET ROLE authenticated;");
      await expect(db.query(
        "SELECT id FROM public.community_upload_sessions"
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(`
        SELECT * FROM public.claim_community_upload_session(
          '${uploadId}', '${userId}', '${firstClaim}', clock_timestamp() - interval '2 minutes'
        )
      `)).rejects.toThrow(/permission denied/i);
      await db.exec("RESET ROLE; SET ROLE service_role;");

      const wrongOwner = await db.query(`
        SELECT * FROM public.claim_community_upload_session(
          '${uploadId}', '${otherUserId}', '${firstClaim}', clock_timestamp() - interval '2 minutes'
        )
      `);
      expect(wrongOwner.rows).toEqual([]);

      const first = await db.query<{ status: string; claim_token: string; finalization_attempts: number }>(`
        SELECT status, claim_token, finalization_attempts
        FROM public.claim_community_upload_session(
          '${uploadId}', '${userId}', '${firstClaim}', clock_timestamp() - interval '2 minutes'
        )
      `);
      expect(first.rows).toEqual([{
        status: "finalizing",
        claim_token: firstClaim,
        finalization_attempts: 1,
      }]);

      const live = await db.query<{ claim_token: string; finalization_attempts: number }>(`
        SELECT claim_token, finalization_attempts
        FROM public.claim_community_upload_session(
          '${uploadId}', '${userId}', '${secondClaim}', clock_timestamp() - interval '2 minutes'
        )
      `);
      expect(live.rows).toEqual([{ claim_token: firstClaim, finalization_attempts: 1 }]);

      await db.exec(`
        UPDATE public.community_upload_sessions
        SET finalize_started_at = clock_timestamp() - interval '3 minutes'
        WHERE id = '${uploadId}';
      `);
      const reclaimed = await db.query<{ claim_token: string; finalization_attempts: number }>(`
        SELECT claim_token, finalization_attempts
        FROM public.claim_community_upload_session(
          '${uploadId}', '${userId}', '${secondClaim}', clock_timestamp() - interval '2 minutes'
        )
      `);
      expect(reclaimed.rows).toEqual([{ claim_token: secondClaim, finalization_attempts: 2 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("keeps inventory, pre-backup freeze, finalization, and emergency rollback as explicit operations", () => {
    const inventory = readFileSync(
      resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_inventory.sql"),
      "utf8"
    );
    const apply = readFileSync(
      resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_apply.sql"),
      "utf8"
    );
    const verify = readFileSync(
      resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_verify.sql"),
      "utf8"
    );
    const rollback = readFileSync(
      resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_rollback.sql"),
      "utf8"
    );
    const rollbackVerify = readFileSync(
      resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_rollback_verify.sql"),
      "utf8"
    );
    const freezeApply = readFileSync(
      resolve(platformOperationRoot, "20260716108000_storage_global_write_freeze_apply.sql"),
      "utf8"
    );
    const freezeVerify = readFileSync(
      resolve(platformOperationRoot, "20260716108000_storage_global_write_freeze_verify.sql"),
      "utf8"
    );
    const freezeRecovery = readFileSync(
      resolve(platformOperationRoot, "20260716108000_storage_global_write_freeze_rollback.sql"),
      "utf8"
    );
    const emergencyRollback = readFileSync(
      resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_emergency_rollback.sql"),
      "utf8"
    );
    const emergencyRollbackVerify = readFileSync(
      resolve(platformOperationRoot, "20260716108000_community_upload_service_fence_emergency_rollback_verify.sql"),
      "utf8"
    );
    const freezeReleaseCheck = readFileSync(
      resolve(repoRoot, "supabase/release-checks/amora-engine-v2-storage-freeze-pre.sql"),
      "utf8"
    );
    const finalReleaseCheck = readFileSync(
      resolve(repoRoot, "supabase/release-checks/amora-engine-v2-storage-final-post-push.sql"),
      "utf8"
    );
    expect(inventory).toMatch(/FROM\s+(?:pg_catalog\.)?pg_policies/i);
    expect(inventory).toMatch(/(?:FROM|JOIN)\s+storage\.buckets/i);
    expect(inventory).toContain("community-media-staging");
    expect(inventory).toContain("EXACT_PRE_POLICY_CONTRACT");
    expect(inventory).not.toMatch(/policyname\s+ILIKE\s+'community-/i);
    expect(inventory).not.toMatch(/^\s*(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE)\s+/im);

    for (const policy of CURRENT_DIRECT_WRITE_POLICIES) {
      expect(freezeApply).toContain(`DROP POLICY IF EXISTS "${policy}"`);
      expect(emergencyRollback).toContain(`CREATE POLICY "${policy}"`);
      expect(rollback).not.toContain(`CREATE POLICY "${policy}"`);
    }
    expect(freezeApply).toContain("STORAGE_FREEZE_PRECONDITION_POLICY_DRIFT");
    expect(freezeApply).not.toMatch(/^\s*CREATE\s+POLICY/im);
    expect(freezeVerify).toMatch(/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
    expect(freezeVerify).toContain("STORAGE_FREEZE_VERIFY_POLICY_MANIFEST_INVALID");
    expect(freezeVerify).toContain("storage_write_frozen");
    expect(freezeVerify).not.toMatch(/^\s*(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE)\s+/im);
    expect(freezeReleaseCheck).toMatch(/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
    expect(freezeReleaseCheck).toMatch(/true\s+AS\s+verified/i);
    expect(freezeReleaseCheck).toContain("storage_mutation_policy_count");
    expect(freezeRecovery).toContain("STORAGE_FREEZE_SAFE_RECOVERY_FAILED");
    expect(freezeRecovery).not.toMatch(/FOR\s+(?:INSERT|UPDATE|DELETE)/i);

    const privacyContractBuckets = [
      "cohort-images",
      "guestbook-images",
      "guestbook-uploads",
      "invitation-photos",
      "user_photos",
    ];
    for (const sql of [inventory, freezeVerify, freezeReleaseCheck, preReleaseCheck]) {
      for (const bucket of privacyContractBuckets) {
        expect(sql).toMatch(new RegExp(`\\('${bucket}',\\s*true\\b`, "i"));
      }
    }
    for (const sql of [
      apply,
      verify,
      rollbackVerify,
      emergencyRollbackVerify,
      finalReleaseCheck,
      postReleaseCheck,
    ]) {
      for (const bucket of privacyContractBuckets) {
        expect(sql).toMatch(new RegExp(`\\('${bucket}',\\s*false\\b`, "i"));
      }
    }
    expect(guestbookPrivacyMigration).toContain(guestbookBucketPrivacyOperation);
    expect(dormantStoragePrivacyMigration).toContain(
      dormantStorageBucketPrivacyOperation
    );
    for (const rollbackSql of [rollback, emergencyRollback]) {
      expect(rollbackSql.replace(/^\s*--.*$/gm, "")).not.toMatch(
        /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+storage\.buckets\b/i
      );
    }

    expect(apply).toContain("COMMUNITY_UPLOAD_PLATFORM_POLICY_REMOVAL_INCOMPLETE");
    expect(apply).toContain("community-media-staging");
    expect(apply).toContain("account_deletion_storage_writes_allowed");
    expect(apply).toContain("production_storage_writes_allowed");
    expect(apply).toContain("is_current_couple_path_member");
    expect(apply).toContain("0b785a6700c258851930b44d1502a2c595de5e7e3d19e10183dfe2d25c454930");
    expect(apply).toContain("2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316");
    expect(apply).toContain("72019e8324f0d8e014f06fbdb6e4dfb4dffa80254a58c421b11631d85dff4e5e");
    expect(apply).toContain("7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482");
    expect(apply).not.toMatch(/^\s*UPDATE\s+storage\.buckets/im);

    expect(verify).toContain("COMMUNITY_UPLOAD_PLATFORM_VERIFY_FAILED");
    expect(verify).toContain("community-media-staging");
    expect(verify).toContain("7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482");
    expect(verify).not.toMatch(/^\s*(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE)\s+/im);
    expect(finalReleaseCheck).toMatch(/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
    expect(finalReleaseCheck).toMatch(/true\s+AS\s+verified/i);
    expect(finalReleaseCheck).toContain("storage_insert_policy_count");
    expect(finalReleaseCheck).toContain("production_storage_fence_closed_count");

    expect(rollback).not.toMatch(/^\s*CREATE\s+POLICY/im);
    expect(rollback).not.toMatch(/FOR\s+(?:INSERT|UPDATE|DELETE)/i);
    expect(rollback).toContain("STORAGE_FINAL_SAFE_ROLLBACK_FAILED_CLOSED");
    expect(rollbackVerify).toMatch(/^\s*--[\s\S]*BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
    expect(rollbackVerify).toContain("STORAGE_FINAL_SAFE_ROLLBACK_VERIFY_POLICY_INVALID");
    expect(emergencyRollback).toMatch(/EMERGENCY[\s\S]*cost-control bypass/i);
    expect(emergencyRollbackVerify).toContain("STORAGE_ROLLBACK_VERIFY_POLICY_MANIFEST_INVALID");
  });

  it("permits only the strict uploader layout, blocks deletion intake and retired buckets, and preserves service writes", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const otherUserId = "22222222-2222-4222-8222-222222222222";
    const coupleId = "33333333-3333-4333-8333-333333333333";
    const db = await createStorageDb();

    try {
      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('${userId}'), ('${otherUserId}');
        INSERT INTO public.couples (id, bride_id, groom_id)
        VALUES ('${coupleId}', '${userId}', '${otherUserId}');
        INSERT INTO public.profiles (id, couple_id, role)
        VALUES
          ('${userId}', '${coupleId}', 'bride'),
          ('${otherUserId}', '${coupleId}', 'groom');
        GRANT SELECT ON public.profiles TO authenticated;
      `);
      await applyPostMigrationBucketPrivacy(db);
      await db.exec(rollbackOperation);
      await expect(db.exec(rollbackVerifyOperation)).resolves.toBeDefined();
      await db.exec(applyOperation);
      await expect(db.exec(verifyOperation)).resolves.toBeDefined();

      await db.exec(`
        SET ROLE authenticated;
        SET "request.jwt.claim.sub" = '${userId}';
        SET "request.jwt.claim.role" = 'authenticated';
      `);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/legacy.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/${userId}/44444444-4444-4444-8444-444444444444.png');
      `)).rejects.toThrow(/row-level security policy/i);

      await db.exec(`
        RESET ROLE;
        DROP FUNCTION public.production_write_fence_guard_20260717();
        SET ROLE authenticated;
        SET "request.jwt.claim.sub" = '${userId}';
        SET "request.jwt.claim.role" = 'authenticated';
      `);
      const released = await db.query<{ allowed: boolean }>(`
        SELECT public.production_storage_writes_allowed() AS allowed
      `);
      expect(released.rows).toEqual([{ allowed: true }]);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/${userId}/44444444-4444-4444-8444-444444444444.png');
      `)).resolves.toBeDefined();
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/${userId}/not-a-uuid.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', ' ${coupleId}/${userId}/55555555-5555-4555-8555-555555555555.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/${otherUserId}/partner.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/.hidden');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('community-images', '${userId}/blocked.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('vendor-images', '${userId}/blocked.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('vendor-images', 'logos/10000000-0000-4000-8000-000000000001.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('vendor-licenses', '${userId}/business-license.pdf');
      `)).rejects.toThrow(/row-level security policy/i);

      await db.exec(`
        RESET ROLE;
        UPDATE public.couples
        SET bride_id = NULL
        WHERE id = '${coupleId}';
        SET ROLE authenticated;
        SET "request.jwt.claim.sub" = '${userId}';
        SET "request.jwt.claim.role" = 'authenticated';
      `);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/${userId}/66666666-6666-4666-8666-666666666666.png');
      `)).rejects.toThrow(/row-level security policy/i);

      await db.exec("RESET ROLE;");
      await db.exec(`
        UPDATE public.couples
        SET bride_id = '${userId}'
        WHERE id = '${coupleId}';
        INSERT INTO public.account_deletion_jobs (user_id, status)
        VALUES ('${userId}', 'inventorying');
        SET ROLE authenticated;
        SET "request.jwt.claim.sub" = '${userId}';
        SET "request.jwt.claim.role" = 'authenticated';
      `);
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('chat-image', '${coupleId}/${userId}/55555555-5555-4555-8555-555555555555.png');
      `)).rejects.toThrow(/row-level security policy/i);
      await db.exec("RESET ROLE; SET ROLE service_role;");
      await expect(db.exec(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('community-images', '${userId}/service.png');
      `)).resolves.toBeDefined();
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("documents release order, full-byte sanitation, lifecycle cleanup, and rollback risk", () => {
    const runbook = readFileSync(
      resolve(repoRoot, "docs/operations/COMMUNITY_UPLOAD_SERVICE_FENCE.md"),
      "utf8"
    );

    expect(runbook).toMatch(/Exact inventory[\s\S]*Freeze all Storage writes[\s\S]*Verify the frozen four-policy manifest[\s\S]*Drain signed upload tokens[\s\S]*Backup verification and separate hosted restore[\s\S]*Apply all 27 migrations[\s\S]*Create staging and finalize Storage[\s\S]*Hosted-clone canary[\s\S]*Deploy clients and cron with both fences closed[\s\S]*Keep the Storage write fence closed pending quota\/sanitation work/i);
    expect(runbook).toMatch(/2 hours 10 minutes[\s\S]*twice at least five minutes apart/i);
    expect(runbook).toMatch(/Current gate:\s*NO-GO/i);
    expect(runbook).toMatch(/INSERT \.\.\. RETURNING \*/i);
    expect(runbook).toContain("supabase_storage_admin");
    expect(runbook).toMatch(/20 attempts \/ 10 minutes/);
    expect(runbook).toMatch(/50[\s\S]*24 hours/);
    expect(runbook).toMatch(/rollback[\s\S]*(bypass|risk)/i);
    expect(runbook).toMatch(/phase-2 rollback[\s\S]*zero policies[\s\S]*public reads remain removed/i);
    expect(runbook).toMatch(/206[\s\S]*Content-Range/);
    expect(runbook).toMatch(/fully downloads[\s\S]*SHA-256/i);
    expect(runbook).toMatch(/EXIF[\s\S]*polyglot/i);
    expect(runbook).toMatch(/two-hour[\s\S]*token_cleanup_at/i);
    expect(runbook).toMatch(/unattached[\s\S]*24 hours/i);
    expect(runbook).toMatch(/video uploads are deliberately disabled/i);
    expect(runbook).toMatch(/authenticated Storage negative probes/i);
    expect(runbook).toContain("https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions");
  });
});
