// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const baseUploadMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716108000_community_upload_service_fence.sql",
  ),
  "utf8",
);
const unlinkMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803104000_unlink_new_community_media_paths.sql",
  ),
  "utf8",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const PUBLIC_OBJECT_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";
const JOB_ID = "66666666-6666-4666-8666-666666666666";
const CLAIM_ID = "77777777-7777-4777-8777-777777777777";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users (id) VALUES ('${USER_ID}'), ('${OTHER_USER_ID}');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  `);
  await db.exec(baseUploadMigration);
  await db.exec(`
    ALTER TABLE public.community_upload_sessions
      ADD COLUMN content_sha256 text,
      ADD COLUMN attached_table text,
      ADD COLUMN attached_id uuid,
      ADD COLUMN attached_at timestamptz,
      ADD COLUMN final_deleted_at timestamptz,
      ADD COLUMN attachment_cleanup_token uuid;

    CREATE TABLE public.account_deletion_jobs (
      id uuid PRIMARY KEY,
      user_id uuid,
      reason text,
      status text NOT NULL,
      ready_after timestamptz,
      quarantine_count integer NOT NULL DEFAULT 0,
      claim_token uuid,
      claimed_at timestamptz,
      storage_verified_at timestamptz,
      auth_deleted_at timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz
    );
    CREATE TABLE public.account_deletion_media_manifest (
      job_id uuid NOT NULL REFERENCES public.account_deletion_jobs(id) ON DELETE CASCADE,
      bucket text NOT NULL,
      path text NOT NULL,
      source text NOT NULL,
      not_before timestamptz NOT NULL,
      cleaned_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (job_id, bucket, path),
      CONSTRAINT account_deletion_media_path_shape CHECK (
        (
          bucket = 'chat-image'
          AND char_length(path) BETWEEN 111 AND 512
          AND path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(jpeg|jpg|png|gif|webp)$'
        )
        OR (
          bucket <> 'chat-image'
          AND char_length(path) BETWEEN 38 AND 512
          AND path ~ '^[0-9a-f-]{36}/[^/\\\\[:cntrl:]]+$'
          AND split_part(path, '/', 2) NOT IN ('.', '..')
        )
      )
    );
    REVOKE ALL ON TABLE public.account_deletion_jobs,
      public.account_deletion_media_manifest FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_jobs,
      public.account_deletion_media_manifest TO service_role;
  `);
  await db.exec(unlinkMigration);
  return db;
}

async function insertCompletedV2Session(
  db: PGlite,
  finalObjectId = PUBLIC_OBJECT_ID,
  uploadId = UPLOAD_ID,
) {
  await db.exec(`
    INSERT INTO public.community_upload_sessions (
      id, user_id, staging_path, final_bucket, final_path,
      declared_mime_type, declared_size, status, actual_size,
      actual_mime_type, expires_at, completed_at, staging_deleted_at,
      content_sha256
    ) VALUES (
      '${uploadId}', '${USER_ID}', '${USER_ID}/${uploadId}.png',
      'community-images', 'v2/${finalObjectId}.png', 'image/png', 1234,
      'completed', 1234, 'image/png', clock_timestamp() + interval '1 hour',
      clock_timestamp(), clock_timestamp(), repeat('a', 64)
    );
  `);
}

describe("unlinkable community media path migration", () => {
  it("accepts only a separate v2 object UUID with MIME-matched extension", async () => {
    const db = await createDatabase();
    try {
      await insertCompletedV2Session(db);
      await expect(insertCompletedV2Session(
        db,
        "88888888-8888-4888-8888-888888888888",
        "88888888-8888-4888-8888-888888888888",
      )).rejects.toThrow(
        /community_upload_sessions_final_path_shape/i,
      );
      await expect(insertCompletedV2Session(
        db,
        USER_ID,
        "99999999-9999-4999-8999-999999999999",
      )).rejects.toThrow(
        /community_upload_sessions_final_path_shape/i,
      );
      await expect(db.exec(`
        INSERT INTO public.community_upload_sessions (
          id, user_id, staging_path, final_bucket, final_path,
          declared_mime_type, declared_size, expires_at
        ) VALUES (
          '88888888-8888-4888-8888-888888888888', '${USER_ID}',
          '${USER_ID}/88888888-8888-4888-8888-888888888888.png',
          'community-images',
          'v2/99999999-9999-4999-8999-999999999999.jpg',
          'image/png', 10, clock_timestamp() + interval '1 hour'
        )
      `)).rejects.toThrow(/community_upload_sessions_final_path_shape/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("binds public v2 URLs to the exact private owner session", async () => {
    const db = await createDatabase();
    try {
      await insertCompletedV2Session(db);
      const url = `https://example.invalid/storage/v1/object/public/community-images/v2/${PUBLIC_OBJECT_ID}.png`;

      await expect(db.query(
        "SELECT public.reconcile_community_upload_target('community_posts', $1, $2, $3)",
        [TARGET_ID, OTHER_USER_ID, url],
      )).rejects.toThrow(/UPLOAD_SESSION_NOT_ATTACHABLE/);

      await db.query(
        "SELECT public.reconcile_community_upload_target('community_posts', $1, $2, $3)",
        [TARGET_ID, USER_ID, url],
      );
      const attached = await db.query<{ attached_table: string; attached_id: string }>(`
        SELECT attached_table, attached_id::text
          FROM public.community_upload_sessions
         WHERE id = '${UPLOAD_ID}'
      `);
      expect(attached.rows).toEqual([{
        attached_table: "community_posts",
        attached_id: TARGET_ID,
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("admits v2 deletion rows only through exact session-final proof", async () => {
    const db = await createDatabase();
    try {
      await insertCompletedV2Session(db);
      await db.exec(`
        INSERT INTO public.account_deletion_jobs (
          id, user_id, reason, status, claim_token, claimed_at
        ) VALUES (
          '${JOB_ID}', '${USER_ID}', 'privacy', 'inventorying',
          '${CLAIM_ID}', clock_timestamp()
        );
      `);

      const result = await db.query<{ status: string }>(`
        SELECT status
          FROM public.replace_account_deletion_media_manifest(
            '${JOB_ID}',
            '${CLAIM_ID}',
            jsonb_build_array(jsonb_build_object(
              'bucket', 'community-images',
              'path', 'v2/${PUBLIC_OBJECT_ID}.png',
              'source', 'session_final',
              'not_before', (clock_timestamp() + interval '2 hours')::text
            ))
          )
      `);
      expect(result.rows).toEqual([{ status: "inventory_ready" }]);

      const manifest = await db.query<{ path: string; source: string }>(`
        SELECT path, source
          FROM public.account_deletion_media_manifest
         WHERE job_id = '${JOB_ID}'
      `);
      expect(manifest.rows).toEqual([{
        path: `v2/${PUBLIC_OBJECT_ID}.png`,
        source: "session_final",
      }]);

      await expect(db.exec(`
        INSERT INTO public.account_deletion_media_manifest (
          job_id, bucket, path, source, not_before
        ) VALUES (
          '${JOB_ID}', 'community-images',
          'v2/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
          'legacy_prefix', clock_timestamp()
        )
      `)).rejects.toThrow(/account_deletion_media_path_shape/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("is replay-safe and keeps attachment/deletion proof functions private", async () => {
    const db = await createDatabase();
    try {
      await db.exec(unlinkMigration);
      const privileges = await db.query<{
        reconcile_authenticated: boolean;
        deletion_authenticated: boolean;
        deletion_service: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'authenticated',
            'public.reconcile_community_upload_target(text,uuid,uuid,text)',
            'EXECUTE'
          ) AS reconcile_authenticated,
          has_function_privilege(
            'authenticated',
            'public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
            'EXECUTE'
          ) AS deletion_authenticated,
          has_function_privilege(
            'service_role',
            'public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
            'EXECUTE'
          ) AS deletion_service
      `);
      expect(privileges.rows[0]).toEqual({
        reconcile_authenticated: false,
        deletion_authenticated: false,
        deletion_service: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
