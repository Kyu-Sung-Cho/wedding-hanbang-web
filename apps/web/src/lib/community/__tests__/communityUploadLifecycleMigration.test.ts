// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const serviceFence = readFileSync(
  resolve(repoRoot, "supabase/migrations/20260716108000_community_upload_service_fence.sql"),
  "utf8",
);
const lifecycle = readFileSync(
  resolve(repoRoot, "supabase/migrations/20260716111000_community_upload_attachment_lifecycle.sql"),
  "utf8",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `${USER_ID}/${UPLOAD_ID}.png`;
const URL = `https://project.supabase.co/storage/v1/object/public/community-images/${PATH}`;

async function database() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      public boolean NOT NULL,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL
    );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES auth.users(id),
      content text NOT NULL DEFAULT '',
      images text[] NOT NULL DEFAULT '{}',
      slides jsonb
    );
    CREATE TABLE public.community_polls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE
    );
    CREATE TABLE public.community_poll_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
      image_url text
    );
    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL REFERENCES auth.users(id),
      content text NOT NULL,
      images text[] NOT NULL DEFAULT '{}',
      is_deleted boolean NOT NULL DEFAULT false
    );
    INSERT INTO auth.users(id) VALUES ('${USER_ID}'), ('${OTHER_ID}');
    INSERT INTO storage.buckets(id, public, file_size_limit, allowed_mime_types) VALUES
      ('community-images', true, 10 * 1024 * 1024,
        ARRAY['image/jpeg','image/png','image/gif','image/webp']),
      ('community-videos', true, 50 * 1024 * 1024,
        ARRAY['video/mp4','video/quicktime','video/webm']),
      ('community-media-staging', false, 6 * 1024 * 1024,
        ARRAY['image/jpeg','image/png','image/gif','image/webp']);
  `);
  await db.exec(serviceFence);
  await db.exec(lifecycle);
  return db;
}

async function insertCompletedSession(db: PGlite, overrides = "") {
  await db.exec(`
    INSERT INTO public.community_upload_sessions (
      id, user_id, staging_path, final_bucket, final_path,
      declared_mime_type, declared_size, status, actual_size,
      actual_mime_type, content_sha256, sanitized_at, completed_at,
      staging_deleted_at, token_cleanup_at, created_at, updated_at, expires_at ${overrides ? ", " + overrides.split("=")[0] : ""}
    ) VALUES (
      '${UPLOAD_ID}', '${USER_ID}', '${PATH}', 'community-images', '${PATH}',
      'image/png', 1234, 'completed', 91, 'image/png', repeat('a', 64),
      clock_timestamp() - interval '28 hours', clock_timestamp() - interval '28 hours',
      clock_timestamp() - interval '28 hours', clock_timestamp() - interval '26 hours',
      clock_timestamp() - interval '29 hours', clock_timestamp() - interval '26 hours',
      clock_timestamp() - interval '27 hours'
      ${overrides ? ", " + overrides.split("=")[1] : ""}
    );
  `);
}

describe("community upload attachment lifecycle migration", () => {
  it("preflights incompatible completed rows and validates new checks separately", () => {
    expect(lifecycle).toContain("COMMUNITY_UPLOAD_COMPLETED_BACKFILL_REQUIRED");
    expect(lifecycle).toContain("COMMUNITY_UPLOAD_SESSIONS_NOT_QUIESCENT");
    for (const constraint of [
      "community_upload_sessions_completion_state",
      "community_upload_sessions_attachment_state",
      "community_upload_sessions_cleanup_claim_state",
    ]) {
      expect(lifecycle).toMatch(new RegExp(
        `ADD CONSTRAINT ${constraint}[\\s\\S]*?NOT VALID`,
      ));
      expect(lifecycle).toContain(
        `VALIDATE CONSTRAINT ${constraint}`,
      );
    }
  });

  it("atomically binds a completed owner upload when a post is created and detaches on delete", async () => {
    const db = await database();
    try {
      await insertCompletedSession(db);
      await db.exec(`
        INSERT INTO public.community_posts(id, author_id, content, images)
        VALUES ('${POST_ID}', '${USER_ID}', 'hello', ARRAY['${URL}']);
      `);
      const attached = await db.query<{
        attached_table: string;
        attached_id: string;
        attached_at: string;
      }>(`
        SELECT attached_table, attached_id, attached_at::text
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(attached.rows).toEqual([expect.objectContaining({
        attached_table: "community_posts",
        attached_id: POST_ID,
        attached_at: expect.any(String),
      })]);

      await db.exec(`DELETE FROM public.community_posts WHERE id = '${POST_ID}';`);
      const detached = await db.query(`
        SELECT attached_table, attached_id, attached_at
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(detached.rows).toEqual([{
        attached_table: null,
        attached_id: null,
        attached_at: null,
      }]);
    } finally {
      await db.close();
    }
  });

  it("fails the post transaction for a missing, unfinished, or cleanup-claimed upload", async () => {
    const db = await database();
    try {
      await expect(db.exec(`
        INSERT INTO public.community_posts(id, author_id, content, images)
        VALUES ('${POST_ID}', '${USER_ID}', 'hello', ARRAY['${URL}']);
      `)).rejects.toThrow(/UPLOAD_SESSION_NOT_ATTACHABLE/);

      await insertCompletedSession(db);
      await db.exec(`
        UPDATE public.community_upload_sessions
        SET attachment_cleanup_token = '${CLAIM_ID}',
            attachment_cleanup_started_at = clock_timestamp()
        WHERE id = '${UPLOAD_ID}';
      `);
      await expect(db.exec(`
        INSERT INTO public.community_posts(id, author_id, content, images)
        VALUES ('${POST_ID}', '${USER_ID}', 'hello', ARRAY['${URL}']);
      `)).rejects.toThrow(/UPLOAD_CLEANUP_IN_PROGRESS/);
      const posts = await db.query("SELECT id FROM public.community_posts");
      expect(posts.rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("rejects a managed community image owned by someone other than the consumer author", async () => {
    const db = await database();
    const otherUploadId = "88888888-8888-4888-8888-888888888888";
    const otherPath = `${OTHER_ID}/${otherUploadId}.png`;
    const otherUrl = `https://project.supabase.co/storage/v1/object/public/community-images/${otherPath}`;
    try {
      await db.exec(`
        INSERT INTO public.community_upload_sessions (
          id, user_id, staging_path, final_bucket, final_path,
          declared_mime_type, declared_size, status, actual_size,
          actual_mime_type, content_sha256, sanitized_at, completed_at,
          staging_deleted_at, token_cleanup_at, created_at, expires_at
        ) VALUES (
          '${otherUploadId}', '${OTHER_ID}', '${otherPath}', 'community-images', '${otherPath}',
          'image/png', 1234, 'completed', 91, 'image/png', repeat('b', 64),
          clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp(),
          clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 hour'
        );
      `);

      await expect(db.exec(`
        INSERT INTO public.community_posts(id, author_id, content, images)
        VALUES ('${POST_ID}', '${USER_ID}', 'hello', ARRAY['${otherUrl}']);
      `)).rejects.toThrow(/UPLOAD_OWNER_MISMATCH/);
      const posts = await db.query("SELECT id FROM public.community_posts");
      expect(posts.rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("binds poll-option media to its post and detaches it when the poll is deleted", async () => {
    const db = await database();
    const pollId = "66666666-6666-4666-8666-666666666666";
    try {
      await insertCompletedSession(db);
      await db.exec(`
        INSERT INTO public.community_posts(id, author_id, content)
        VALUES ('${POST_ID}', '${USER_ID}', 'poll');
        INSERT INTO public.community_polls(id, post_id)
        VALUES ('${pollId}', '${POST_ID}');
        INSERT INTO public.community_poll_options(poll_id, image_url)
        VALUES ('${pollId}', '${URL}');
      `);
      const attached = await db.query(`
        SELECT attached_table, attached_id
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(attached.rows).toEqual([{
        attached_table: "community_posts",
        attached_id: POST_ID,
      }]);

      await db.exec(`DELETE FROM public.community_polls WHERE id = '${pollId}';`);
      const detached = await db.query(`
        SELECT attached_table, attached_id
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(detached.rows).toEqual([{
        attached_table: null,
        attached_id: null,
      }]);
    } finally {
      await db.close();
    }
  });

  it("detaches cohort media on soft delete even if the image column is retained", async () => {
    const db = await database();
    const messageId = "77777777-7777-4777-8777-777777777777";
    try {
      await insertCompletedSession(db);
      await db.exec(`
        INSERT INTO public.cohort_messages(id, author_id, content, images)
        VALUES ('${messageId}', '${USER_ID}', 'hello', ARRAY['${URL}']);
      `);
      const attached = await db.query(`
        SELECT attached_table, attached_id
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(attached.rows).toEqual([{
        attached_table: "cohort_messages",
        attached_id: messageId,
      }]);

      await db.exec(`
        UPDATE public.cohort_messages SET is_deleted = true
        WHERE id = '${messageId}';
      `);
      const detached = await db.query(`
        SELECT attached_table, attached_id
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(detached.rows).toEqual([{
        attached_table: null,
        attached_id: null,
      }]);
    } finally {
      await db.close();
    }
  });

  it("detaches cohort media on hard delete without reading an absent NEW row", async () => {
    const db = await database();
    const messageId = "99999999-9999-4999-8999-999999999999";
    try {
      await insertCompletedSession(db);
      await db.exec(`
        INSERT INTO public.cohort_messages(id, author_id, content, images)
        VALUES ('${messageId}', '${USER_ID}', 'hello', ARRAY['${URL}']);
        DELETE FROM public.cohort_messages WHERE id = '${messageId}';
      `);
      const detached = await db.query(`
        SELECT attached_table, attached_id, attached_at
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(detached.rows).toEqual([{
        attached_table: null,
        attached_id: null,
        attached_at: null,
      }]);
    } finally {
      await db.close();
    }
  });

  it("gives a newly detached old upload a fresh 24-hour recovery window", async () => {
    const db = await database();
    try {
      await insertCompletedSession(db);
      await db.exec(`
        INSERT INTO public.community_posts(id, author_id, content, images)
        VALUES ('${POST_ID}', '${USER_ID}', 'hello', ARRAY['${URL}']);
        DELETE FROM public.community_posts WHERE id = '${POST_ID}';
        SET ROLE service_role;
      `);
      const claimed = await db.query(`
        SELECT id
        FROM public.claim_unattached_community_upload_sessions(
          '${CLAIM_ID}',
          clock_timestamp() - interval '24 hours',
          clock_timestamp() - interval '15 minutes',
          10
        )
      `);
      expect(claimed.rows).toEqual([]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("claims only old completed-unattached assets after exact token cleanup and finalizes deletion by claim", async () => {
    const db = await database();
    try {
      await insertCompletedSession(db);
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT * FROM public.claim_unattached_community_upload_sessions(
          '${CLAIM_ID}', clock_timestamp(), clock_timestamp(), NULL
        )
      `)).rejects.toThrow(/UPLOAD_CLEANUP_LIMIT_INVALID/);
      const claimed = await db.query<{ id: string; attachment_cleanup_token: string }>(`
        SELECT id, attachment_cleanup_token
        FROM public.claim_unattached_community_upload_sessions(
          '${CLAIM_ID}',
          clock_timestamp() - interval '24 hours',
          clock_timestamp() - interval '15 minutes',
          10
        )
      `);
      expect(claimed.rows).toEqual([{
        id: UPLOAD_ID,
        attachment_cleanup_token: CLAIM_ID,
      }]);

      const finalized = await db.query<{ finalized: boolean }>(`
        SELECT public.finalize_unattached_community_upload_cleanup(
          '${UPLOAD_ID}', '${CLAIM_ID}'
        ) AS finalized
      `);
      expect(finalized.rows).toEqual([{ finalized: true }]);
      const row = await db.query(`
        SELECT status, rejection_code, final_deleted_at IS NOT NULL AS deleted,
               attachment_cleanup_token
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(row.rows).toEqual([{
        status: "expired",
        rejection_code: "unattached_cleanup",
        deleted: true,
        attachment_cleanup_token: null,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("reclaims a failed cleanup lease after 15 minutes without adding another 24-hour delay", async () => {
    const db = await database();
    const staleClaim = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    try {
      await insertCompletedSession(db);
      await db.exec(`
        UPDATE public.community_upload_sessions
        SET attachment_cleanup_token = '${staleClaim}',
            attachment_cleanup_started_at = clock_timestamp() - interval '16 minutes',
            updated_at = clock_timestamp()
        WHERE id = '${UPLOAD_ID}';
        SET ROLE service_role;
      `);
      const claimed = await db.query<{ id: string; attachment_cleanup_token: string }>(`
        SELECT id, attachment_cleanup_token
        FROM public.claim_unattached_community_upload_sessions(
          '${CLAIM_ID}',
          clock_timestamp() - interval '24 hours',
          clock_timestamp() - interval '15 minutes',
          10
        )
      `);
      expect(claimed.rows).toEqual([{
        id: UPLOAD_ID,
        attachment_cleanup_token: CLAIM_ID,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("checkpoints a completed session only for its exact staging path after token grace", async () => {
    const db = await database();
    try {
      await insertCompletedSession(db);
      await db.exec(`
        UPDATE public.community_upload_sessions
        SET token_cleanup_at = NULL
        WHERE id = '${UPLOAD_ID}';
        SET ROLE service_role;
      `);

      const wrongPath = await db.query<{ checkpointed: boolean }>(`
        SELECT public.checkpoint_community_upload_token_cleanup(
          '${UPLOAD_ID}', '${USER_ID}/99999999-9999-4999-8999-999999999999.png'
        ) AS checkpointed
      `);
      expect(wrongPath.rows).toEqual([{ checkpointed: false }]);

      const exactPath = await db.query<{ checkpointed: boolean }>(`
        SELECT public.checkpoint_community_upload_token_cleanup(
          '${UPLOAD_ID}', '${PATH}'
        ) AS checkpointed
      `);
      expect(exactPath.rows).toEqual([{ checkpointed: true }]);
      const row = await db.query(`
        SELECT status, token_cleanup_at IS NOT NULL AS token_cleaned,
               staging_deleted_at IS NOT NULL AS staging_deleted
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(row.rows).toEqual([{
        status: "completed",
        token_cleaned: true,
        staging_deleted: true,
      }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("leases a token-cleaned terminal session so a crash-published final cannot leak", async () => {
    const db = await database();
    try {
      await insertCompletedSession(db);
      await db.exec(`
        UPDATE public.community_upload_sessions
        SET status = 'expired',
            rejection_code = 'expired_cleanup',
            rejected_at = clock_timestamp(),
            completed_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = '${UPLOAD_ID}';
        SET ROLE service_role;
      `);
      const claimed = await db.query<{ id: string; status: string }>(`
        SELECT id, status
        FROM public.claim_unattached_community_upload_sessions(
          '${CLAIM_ID}',
          clock_timestamp() - interval '10 years',
          clock_timestamp() - interval '15 minutes',
          10
        )
      `);
      expect(claimed.rows).toEqual([{ id: UPLOAD_ID, status: "expired" }]);

      const finalized = await db.query<{ finalized: boolean }>(`
        SELECT public.finalize_unattached_community_upload_cleanup(
          '${UPLOAD_ID}', '${CLAIM_ID}'
        ) AS finalized
      `);
      expect(finalized.rows).toEqual([{ finalized: true }]);
      const row = await db.query(`
        SELECT status, final_deleted_at IS NOT NULL AS deleted
        FROM public.community_upload_sessions WHERE id = '${UPLOAD_ID}'
      `);
      expect(row.rows).toEqual([{ status: "expired", deleted: true }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });
});
