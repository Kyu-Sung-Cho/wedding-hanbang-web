// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const activeMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260804100000_amora_chat_attachment_upload_sessions.sql",
);
const candidateMigrationPath = resolve(
  process.cwd(),
  "../../supabase/release-candidates/amora-safety-20260804/wave-c-chat-attachment-lifecycle/20260804100000_amora_chat_attachment_upload_sessions.sql",
);
const storageCandidatePath = resolve(
  process.cwd(),
  "../../supabase/release-candidates/amora-safety-20260804/wave-c-chat-attachment-lifecycle/platform-storage/20260804101000_chat_attachment_signed_upload_storage_contract.sql",
);

function readCandidateSql() {
  return readFileSync(candidateMigrationPath, "utf8");
}

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const SESSION_ID = "40000000-0000-4000-8000-000000000001";
const CLAIM_ID = "50000000-0000-4000-8000-000000000001";
const RESERVATION_ID = "51000000-0000-4000-8000-000000000001";
const PATH = `${COUPLE_ID}/${BRIDE_ID}/60000000-0000-5000-8000-000000000001.png`;
const BINDING_HMAC = "a".repeat(64);
const STORAGE_CONTRACT_EVIDENCE = "c".repeat(64);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE UNIQUE INDEX chat_messages_client_request_id_unique
      ON public.chat_messages (couple_id, (metadata->>'client_request_id'))
      WHERE metadata->>'client_request_id' IS NOT NULL;
    CREATE TABLE public.account_deletion_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      status text NOT NULL
    );
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', NULL, NULL);
  `);
  await db.exec(readCandidateSql());
  return db;
}

async function setServiceRole(db: PGlite) {
  await db.exec("SET ROLE service_role");
}

function uploadItems(overrides: Record<string, unknown> = {}) {
  return [{
    sessionId: SESSION_ID,
    attachmentIndex: 0,
    mediaType: "image/png",
    byteLength: 128,
    bindingHmac: BINDING_HMAC,
    bindingKeyVersion: 1,
    path: PATH,
    ...overrides,
  }];
}

async function beginSessions(
  db: PGlite,
  items: unknown = uploadItems(),
  userId = BRIDE_ID,
) {
  return db.query<{
    id: string;
    final_path: string;
    status: string;
  }>(
    `SELECT id, final_path, status
       FROM public.begin_chat_attachment_upload_sessions($1, $2, $3, $4::jsonb)`,
    [COUPLE_ID, userId, REQUEST_ID, JSON.stringify(items)],
  );
}

async function reserveUploadToken(
  db: PGlite,
  reservationId = RESERVATION_ID,
) {
  return db.query<{
    token_generation: number;
    token_reservation_id: string;
    has_bounded_signing_window: boolean;
    has_exact_token_ttl: boolean;
  }>(
    `SELECT token_generation, token_reservation_id,
            token_signing_deadline > token_reserved_at
              AND token_signing_deadline <= clock_timestamp() + interval '2 minutes'
              AS has_bounded_signing_window,
            token_not_after = token_signing_deadline + interval '2 hours'
              AS has_exact_token_ttl
       FROM public.reserve_chat_attachment_upload_token($1, $2, $3, 7200)`,
    [SESSION_ID, BRIDE_ID, reservationId],
  );
}

async function confirmUploadToken(
  db: PGlite,
  reservationId = RESERVATION_ID,
  generation = 1,
) {
  return db.query<{ confirmed: boolean }>(
    `SELECT public.confirm_chat_attachment_upload_token(
       $1, $2, $3, $4, clock_timestamp() + interval '2 hours'
     ) AS confirmed`,
    [SESSION_ID, BRIDE_ID, reservationId, generation],
  );
}

async function activateSignedOnlyStorage(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    `UPDATE public.chat_attachment_runtime_state
        SET storage_write_contract = 'signed_only',
            storage_contract_evidence_sha256 = $1,
            storage_contract_activated_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE singleton`,
    [STORAGE_CONTRACT_EVIDENCE],
  );
  await setServiceRole(db);
}

describe("Amora chat attachment upload-session migration candidate", () => {
  it("stages the disabled-by-default lifecycle outside active migrations", () => {
    expect(existsSync(candidateMigrationPath)).toBe(true);
    expect(existsSync(activeMigrationPath)).toBe(false);
    expect(readCandidateSql()).toContain("'disabled'");
  });

  it("stages a separate hosted Storage contraction to signed uploads only", () => {
    expect(existsSync(storageCandidatePath)).toBe(true);
    const storageSql = readFileSync(storageCandidatePath, "utf8");
    expect(storageSql).toContain("PLATFORM OPERATION / RELEASE CANDIDATE ONLY");
    expect(storageSql).toContain("CHAT_ATTACHMENT_SIGNED_UPLOAD_PRECONDITION_INVALID");
    expect(storageSql).toContain("CHAT_ATTACHMENT_SIGNED_UPLOAD_POSTCONDITION_INVALID");
    expect(storageSql).toContain("DROP POLICY");
    expect(storageSql).toContain("storage_write_contract = 'signed_only'");
    expect(storageSql).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("creates a service-only ledger without persisting a raw content digest", async () => {
    const db = await createDatabase();
    try {
      const columns = await db.query<{ column_name: string }>(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'chat_attachment_upload_sessions'
         ORDER BY ordinal_position
      `);
      const names = columns.rows.map((row) => row.column_name);
      expect(names).toContain("binding_hmac");
      expect(names).toContain("token_generation");
      expect(names).toContain("token_not_after");
      expect(names).not.toContain("content_sha256");
      expect(names).not.toContain("sha256");

      const privileges = await db.query<{
        anon_select: boolean;
        authenticated_select: boolean;
        service_select: boolean;
      }>(`
        SELECT
          has_table_privilege('anon', 'public.chat_attachment_upload_sessions', 'SELECT')
            AS anon_select,
          has_table_privilege('authenticated', 'public.chat_attachment_upload_sessions', 'SELECT')
            AS authenticated_select,
          has_table_privilege('service_role', 'public.chat_attachment_upload_sessions', 'SELECT')
            AS service_select
      `);
      expect(privileges.rows[0]).toEqual({
        anon_select: false,
        authenticated_select: false,
        service_select: true,
      });
      const runtimeGate = await db.query<{
        storage_write_contract: string;
        service_can_update_contract: boolean;
      }>(`
        SELECT state.storage_write_contract,
               has_column_privilege(
                 'service_role',
                 'public.chat_attachment_runtime_state',
                 'storage_write_contract',
                 'UPDATE'
               ) AS service_can_update_contract
          FROM public.chat_attachment_runtime_state AS state
         WHERE state.singleton
      `);
      expect(runtimeGate.rows).toEqual([{
        storage_write_contract: "legacy_mutable",
        service_can_update_contract: false,
      }]);

      const binder = await db.query<{ prosrc: string }>(`
        SELECT procedure.prosrc
          FROM pg_catalog.pg_proc AS procedure
         WHERE procedure.oid =
           'public.bind_chat_attachment_uploads_on_message()'::regprocedure
      `);
      const ownerLock = binder.rows[0].prosrc.indexOf("pg_advisory_xact_lock");
      const firstSessionCount = binder.rows[0].prosrc.indexOf(
        "SELECT count(*) INTO v_matched_count",
      );
      expect(ownerLock).toBeGreaterThanOrEqual(0);
      expect(firstSessionCount).toBeGreaterThan(ownerLock);

      const serviceFunctions = [
        "public.begin_chat_attachment_upload_sessions(uuid,uuid,uuid,jsonb)",
        "public.reserve_chat_attachment_upload_token(uuid,uuid,uuid,integer)",
        "public.confirm_chat_attachment_upload_token(uuid,uuid,uuid,integer,timestamp with time zone)",
        "public.claim_chat_attachment_upload_session(uuid,uuid,uuid,timestamp with time zone)",
        "public.finalize_chat_attachment_upload_verification(uuid,uuid,uuid,bigint,text,text,boolean,text)",
        "public.claim_chat_attachment_cleanup_sessions(uuid,timestamp with time zone,timestamp with time zone,integer)",
        "public.finalize_chat_attachment_cleanup(uuid,uuid,boolean)",
      ];
      for (const signature of serviceFunctions) {
        const functionPrivileges = await db.query<{
          anon_execute: boolean;
          authenticated_execute: boolean;
          service_execute: boolean;
        }>(`
          SELECT
            has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute,
            has_function_privilege('authenticated', $1, 'EXECUTE')
              AS authenticated_execute,
            has_function_privilege('service_role', $1, 'EXECUTE')
              AS service_execute
        `, [signature]);
        expect(functionPrivileges.rows[0]).toEqual({
          anon_execute: false,
          authenticated_execute: false,
          service_execute: true,
        });
      }
    } finally {
      await db.close();
    }
  });

  it("stays disabled until explicitly shadowed and creates an exact idempotent batch", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await expect(beginSessions(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_UPLOAD_DISABLED/,
      );

      await db.exec(`
        UPDATE public.chat_attachment_runtime_state
           SET mode = 'shadow', updated_at = clock_timestamp()
         WHERE singleton
      `);
      const created = await beginSessions(db);
      expect(created.rows).toEqual([{
        id: SESSION_ID,
        final_path: PATH,
        status: "issued",
      }]);

      const retried = await beginSessions(db);
      expect(retried.rows).toEqual(created.rows);

      await expect(beginSessions(db, uploadItems({
        sessionId: "40000000-0000-4000-8000-000000000099",
      }))).rejects.toThrow(/CHAT_ATTACHMENT_IDEMPOTENCY_CONFLICT/);

      await expect(beginSessions(db, [
        ...uploadItems(),
        {
          sessionId: "40000000-0000-4000-8000-000000000002",
          attachmentIndex: 1,
          mediaType: "image/jpeg",
          byteLength: 128,
          bindingHmac: "b".repeat(64),
          bindingKeyVersion: 1,
          path: `${COUPLE_ID}/${BRIDE_ID}/60000000-0000-5000-8000-000000000002.jpg`,
        },
      ])).rejects.toThrow(/CHAT_ATTACHMENT_IDEMPOTENCY_CONFLICT/);

      await expect(beginSessions(db, uploadItems({
        bindingHmac: "b".repeat(64),
      }))).rejects.toThrow(/CHAT_ATTACHMENT_IDEMPOTENCY_CONFLICT/);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("durably reserves each signed-token generation before issuance and drains the latest", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'shadow'
         WHERE singleton
      `);
      await beginSessions(db);

      await db.query(
        `INSERT INTO public.account_deletion_jobs(user_id, status)
         VALUES ($1, 'inventorying')`,
        [BRIDE_ID],
      );
      await expect(reserveUploadToken(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING/,
      );
      await db.query(
        "DELETE FROM public.account_deletion_jobs WHERE user_id = $1",
        [BRIDE_ID],
      );

      await expect(db.query(
        `SELECT * FROM public.claim_chat_attachment_upload_session(
           $1, $2, $3, clock_timestamp() - interval '5 minutes'
         )`,
        [SESSION_ID, BRIDE_ID, CLAIM_ID],
      )).rejects.toThrow(/CHAT_ATTACHMENT_TOKEN_NOT_RESERVED/);

      const reserved = await reserveUploadToken(db);
      expect(reserved.rows).toEqual([{
        token_generation: 1,
        token_reservation_id: RESERVATION_ID,
        has_bounded_signing_window: true,
        has_exact_token_ttl: true,
      }]);
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'disabled'
         WHERE singleton
      `);
      await expect(reserveUploadToken(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_UPLOAD_DISABLED/,
      );
      await expect(confirmUploadToken(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_UPLOAD_DISABLED/,
      );
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'shadow'
         WHERE singleton
      `);
      await expect(db.query(
        `SELECT * FROM public.claim_chat_attachment_upload_session(
           $1, $2, $3, clock_timestamp() - interval '5 minutes'
         )`,
        [SESSION_ID, BRIDE_ID, CLAIM_ID],
      )).rejects.toThrow(/CHAT_ATTACHMENT_TOKEN_NOT_CONFIRMED/);
      await expect(db.query(
        `SELECT public.confirm_chat_attachment_upload_token(
           $1, $2, $3, 1, clock_timestamp() + interval '3 hours'
         )`,
        [SESSION_ID, BRIDE_ID, RESERVATION_ID],
      )).rejects.toThrow(/CHAT_ATTACHMENT_TOKEN_CONFIRMATION_OUT_OF_BOUNDS/);
      expect((await confirmUploadToken(db)).rows).toEqual([{ confirmed: true }]);
      expect((await reserveUploadToken(db)).rows).toEqual(reserved.rows);
      await expect(reserveUploadToken(
        db,
        "51000000-0000-4000-8000-000000000002",
      )).rejects.toThrow(/CHAT_ATTACHMENT_TOKEN_RESERVATION_ACTIVE/);

      await db.exec(`
        UPDATE public.chat_attachment_upload_sessions
           SET token_reserved_at = clock_timestamp() - interval '3 minutes',
               token_signing_deadline = clock_timestamp() - interval '1 minute',
               token_not_after = clock_timestamp() + interval '119 minutes',
               token_confirmed_at = NULL,
               token_observed_not_after = NULL
         WHERE id = '${SESSION_ID}'
      `);
      await expect(confirmUploadToken(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_TOKEN_CONFIRMATION_OUT_OF_BOUNDS/,
      );
      const secondReservation = "51000000-0000-4000-8000-000000000003";
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'disabled'
         WHERE singleton
      `);
      await expect(reserveUploadToken(db, secondReservation)).rejects.toThrow(
        /CHAT_ATTACHMENT_UPLOAD_DISABLED/,
      );
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'shadow'
         WHERE singleton
      `);
      const reissued = await reserveUploadToken(db, secondReservation);
      expect(reissued.rows).toEqual([{
        token_generation: 2,
        token_reservation_id: secondReservation,
        has_bounded_signing_window: true,
        has_exact_token_ttl: true,
      }]);
      await expect(confirmUploadToken(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_TOKEN_CONFIRMATION_STALE/,
      );
      expect((await confirmUploadToken(
        db,
        secondReservation,
        2,
      )).rows).toEqual([{ confirmed: true }]);

      await db.exec(`
        UPDATE public.chat_attachment_upload_sessions
           SET created_at = clock_timestamp() - interval '5 hours',
               expires_at = clock_timestamp() - interval '3 hours',
               updated_at = clock_timestamp() - interval '3 hours'
         WHERE id = '${SESSION_ID}'
      `);
      await expect(db.query(
        `SELECT * FROM public.claim_chat_attachment_cleanup_sessions(
           $1,
           clock_timestamp() - interval '24 hours',
           clock_timestamp() - interval '15 minutes',
           25
         )`,
        ["70000000-0000-4000-8000-000000000009"],
      )).rejects.toThrow(
        /CHAT_ATTACHMENT_CLEANUP_REQUIRES_SIGNED_ONLY_STORAGE/,
      );
      await expect(db.exec(`
        UPDATE public.chat_attachment_runtime_state
           SET storage_write_contract = 'signed_only'
         WHERE singleton
      `)).rejects.toThrow(/permission denied/i);
      await activateSignedOnlyStorage(db);

      const beforeDrain = await db.query(
        `SELECT * FROM public.claim_chat_attachment_cleanup_sessions(
           $1,
           clock_timestamp() - interval '24 hours',
           clock_timestamp() - interval '15 minutes',
           25
         )`,
        ["70000000-0000-4000-8000-000000000010"],
      );
      expect(beforeDrain.rows).toEqual([]);

      await db.exec(`
        UPDATE public.chat_attachment_upload_sessions
           SET token_reserved_at = clock_timestamp() - interval '4 hours',
               token_signing_deadline = clock_timestamp() - interval '3 hours',
               token_not_after = clock_timestamp() - interval '1 hour',
               token_confirmed_at = NULL,
               token_observed_not_after = NULL
         WHERE id = '${SESSION_ID}'
      `);
      const cleanupToken = "70000000-0000-4000-8000-000000000011";
      const afterDrain = await db.query<{ cleanup_claim_token: string }>(
        `SELECT cleanup_claim_token
           FROM public.claim_chat_attachment_cleanup_sessions(
             $1,
             clock_timestamp() - interval '24 hours',
             clock_timestamp() - interval '15 minutes',
             25
           )`,
        [cleanupToken],
      );
      expect(afterDrain.rows).toEqual([{ cleanup_claim_token: cleanupToken }]);
      await expect(reserveUploadToken(
        db,
        "51000000-0000-4000-8000-000000000004",
      )).rejects.toThrow(/CHAT_ATTACHMENT_TOKEN_NOT_SIGNABLE/);

      await db.exec("RESET ROLE");
      await expect(db.exec(`
        UPDATE public.chat_attachment_runtime_state
           SET storage_write_contract = 'legacy_mutable',
               storage_contract_evidence_sha256 = NULL,
               storage_contract_activated_at = NULL
         WHERE singleton
      `)).rejects.toThrow(/CHAT_ATTACHMENT_STORAGE_CONTRACT_IMMUTABLE/);
      await setServiceRole(db);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("leases verification and checkpoints only an exact HMAC/size/MIME binding", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'shadow'
         WHERE singleton
      `);
      await beginSessions(db);
      await reserveUploadToken(db);

      await db.query(
        `INSERT INTO public.account_deletion_jobs(user_id, status)
         VALUES ($1, 'inventorying')`,
        [BRIDE_ID],
      );
      await expect(confirmUploadToken(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING/,
      );
      await expect(db.query(
        `SELECT status, verification_claim_token
           FROM public.claim_chat_attachment_upload_session(
             $1, $2, $3, clock_timestamp() - interval '5 minutes'
           )`,
        [SESSION_ID, BRIDE_ID, CLAIM_ID],
      )).rejects.toThrow(/CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING/);
      await db.query(
        "DELETE FROM public.account_deletion_jobs WHERE user_id = $1",
        [BRIDE_ID],
      );
      await confirmUploadToken(db);
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'disabled'
         WHERE singleton
      `);

      const claimed = await db.query<{ status: string; verification_claim_token: string }>(
        `SELECT status, verification_claim_token
           FROM public.claim_chat_attachment_upload_session(
             $1, $2, $3, clock_timestamp() - interval '5 minutes'
           )`,
        [SESSION_ID, BRIDE_ID, CLAIM_ID],
      );
      expect(claimed.rows).toEqual([{
        status: "verifying",
        verification_claim_token: CLAIM_ID,
      }]);

      await db.query(
        `INSERT INTO public.account_deletion_jobs(user_id, status)
         VALUES ($1, 'inventorying')`,
        [BRIDE_ID],
      );
      await expect(db.query(
        `SELECT public.finalize_chat_attachment_upload_verification(
           $1, $2, $3, $4, $5, $6, $7, $8
         ) AS completed`,
        [
          SESSION_ID,
          BRIDE_ID,
          CLAIM_ID,
          128,
          "image/png",
          BINDING_HMAC,
          true,
          null,
        ],
      )).rejects.toThrow(/CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING/);
      await db.query(
        "DELETE FROM public.account_deletion_jobs WHERE user_id = $1",
        [BRIDE_ID],
      );

      const finalized = await db.query<{ completed: boolean }>(
        `SELECT public.finalize_chat_attachment_upload_verification(
           $1, $2, $3, $4, $5, $6, $7, $8
         ) AS completed`,
        [
          SESSION_ID,
          BRIDE_ID,
          CLAIM_ID,
          128,
          "image/png",
          BINDING_HMAC,
          true,
          null,
        ],
      );
      expect(finalized.rows).toEqual([{ completed: true }]);
      const stored = await db.query<{
        status: string;
        actual_size: number;
        actual_mime_type: string;
        binding_hmac: string;
      }>(`
        SELECT status, actual_size, actual_mime_type, binding_hmac
          FROM public.chat_attachment_upload_sessions
         WHERE id = '${SESSION_ID}'
      `);
      expect(stored.rows).toEqual([{
        status: "verified",
        actual_size: 128,
        actual_mime_type: "image/png",
        binding_hmac: BINDING_HMAC,
      }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("binds in the message transaction and leases only detached, unreferenced orphans", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'enforced'
         WHERE singleton
      `);
      await activateSignedOnlyStorage(db);
      await beginSessions(db);
      await reserveUploadToken(db);
      await confirmUploadToken(db);
      await db.query(
        `SELECT * FROM public.claim_chat_attachment_upload_session(
           $1, $2, $3, clock_timestamp() - interval '5 minutes'
         )`,
        [SESSION_ID, BRIDE_ID, CLAIM_ID],
      );
      await db.query(
        `SELECT public.finalize_chat_attachment_upload_verification(
           $1, $2, $3, 128, 'image/png', $4, true, NULL
         )`,
        [SESSION_ID, BRIDE_ID, CLAIM_ID, BINDING_HMAC],
      );
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'disabled'
         WHERE singleton
      `);

      await db.query(
        `INSERT INTO public.account_deletion_jobs(user_id, status)
         VALUES ($1, 'inventorying')`,
        [BRIDE_ID],
      );
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'bride', 'user', '삭제 중 늦은 첨부',
           jsonb_build_object(
             'client_request_id', $3::text,
             'imagePaths', jsonb_build_array($4::text)
           ),
           'shared'
         )`,
        [COUPLE_ID, BRIDE_ID, REQUEST_ID, PATH],
      )).rejects.toThrow(/CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING/);
      await db.query(
        "DELETE FROM public.account_deletion_jobs WHERE user_id = $1",
        [BRIDE_ID],
      );

      const message = await db.query<{ id: string }>(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'bride', 'user', '첨부 이미지 질문',
           jsonb_build_object(
             'client_request_id', $3::text,
             'imagePaths', jsonb_build_array($4::text)
           ),
           'shared'
         ) RETURNING id`,
        [COUPLE_ID, BRIDE_ID, REQUEST_ID, PATH],
      );
      const attached = await db.query<{ status: string; attached_message_id: string }>(`
        SELECT status, attached_message_id
          FROM public.chat_attachment_upload_sessions
         WHERE id = '${SESSION_ID}'
      `);
      expect(attached.rows).toEqual([{
        status: "attached",
        attached_message_id: message.rows[0].id,
      }]);

      const whileAttached = await db.query(
        `SELECT * FROM public.claim_chat_attachment_cleanup_sessions(
           $1,
           clock_timestamp() - interval '1 second',
           clock_timestamp() - interval '15 minutes',
           25
         )`,
        ["70000000-0000-4000-8000-000000000001"],
      );
      expect(whileAttached.rows).toEqual([]);

      await db.query("DELETE FROM public.chat_messages WHERE id = $1", [message.rows[0].id]);
      await db.exec(`
        UPDATE public.chat_attachment_upload_sessions
           SET created_at = clock_timestamp() - interval '27 hours',
               expires_at = clock_timestamp() - interval '25 hours',
               token_reserved_at = clock_timestamp() - interval '27 hours',
               token_signing_deadline = clock_timestamp() - interval '26 hours 55 minutes',
               token_not_after = clock_timestamp() - interval '24 hours 55 minutes',
               token_confirmed_at = clock_timestamp() - interval '26 hours 54 minutes',
               token_observed_not_after = clock_timestamp() - interval '24 hours 56 minutes',
               updated_at = clock_timestamp() - interval '23 hours',
               detached_at = clock_timestamp() - interval '23 hours'
         WHERE id = '${SESSION_ID}'
      `);
      const beforeRecoveryGrace = await db.query(
        `SELECT * FROM public.claim_chat_attachment_cleanup_sessions(
           $1,
           clock_timestamp(),
           clock_timestamp() - interval '15 minutes',
           25
         )`,
        ["70000000-0000-4000-8000-000000000012"],
      );
      expect(beforeRecoveryGrace.rows).toEqual([]);

      await db.exec(`
        UPDATE public.chat_attachment_upload_sessions
           SET updated_at = clock_timestamp() - interval '25 hours',
               detached_at = clock_timestamp() - interval '25 hours'
         WHERE id = '${SESSION_ID}'
      `);
      const cleanupClaim = "70000000-0000-4000-8000-000000000002";
      const claimed = await db.query<{ cleanup_claim_token: string }>(
        `SELECT cleanup_claim_token
           FROM public.claim_chat_attachment_cleanup_sessions(
             $1,
             clock_timestamp(),
             clock_timestamp() - interval '15 minutes',
             25
           )`,
        [cleanupClaim],
      );
      expect(claimed.rows).toEqual([{ cleanup_claim_token: cleanupClaim }]);

      await db.exec(`
        UPDATE public.chat_attachment_upload_sessions
           SET cleanup_started_at = clock_timestamp() - interval '16 minutes'
         WHERE id = '${SESSION_ID}'
      `);
      const reclaimedToken = "70000000-0000-4000-8000-000000000003";
      const reclaimed = await db.query<{ cleanup_claim_token: string }>(
        `SELECT cleanup_claim_token
           FROM public.claim_chat_attachment_cleanup_sessions(
             $1,
             clock_timestamp() - interval '24 hours',
             clock_timestamp() - interval '15 minutes',
             25
           )`,
        [reclaimedToken],
      );
      expect(reclaimed.rows).toEqual([{ cleanup_claim_token: reclaimedToken }]);

      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'disabled'
         WHERE singleton
      `);

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'bride', 'user', '늦은 재시도',
           jsonb_build_object(
             'client_request_id', $3::text,
             'imagePaths', jsonb_build_array($4::text)
           ),
           'shared'
         )`,
        [COUPLE_ID, BRIDE_ID, REQUEST_ID, PATH],
      )).rejects.toThrow(/CHAT_ATTACHMENT_CLEANUP_IN_PROGRESS/);

      const finalized = await db.query<{ deleted: boolean }>(
        `SELECT public.finalize_chat_attachment_cleanup($1, $2, true) AS deleted`,
        [SESSION_ID, reclaimedToken],
      );
      expect(finalized.rows).toEqual([{ deleted: true }]);
      const receipt = await db.query<{ outcome: string }>(`
        SELECT outcome FROM public.chat_attachment_cleanup_receipts
         WHERE session_id = '${SESSION_ID}'
      `);
      expect(receipt.rows).toEqual([{ outcome: "deleted" }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects foreign/deleting owners and rolls back an over-limit batch atomically", async () => {
    const db = await createDatabase();
    try {
      await setServiceRole(db);
      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'shadow'
         WHERE singleton
      `);
      const secondPath = `${COUPLE_ID}/${BRIDE_ID}/60000000-0000-5000-8000-000000000002.jpg`;
      await expect(beginSessions(db, [
        ...uploadItems({ byteLength: 6 * 1024 * 1024 }),
        {
          sessionId: "40000000-0000-4000-8000-000000000002",
          attachmentIndex: 1,
          mediaType: "image/jpeg",
          byteLength: 5 * 1024 * 1024,
          bindingHmac: "b".repeat(64),
          bindingKeyVersion: 1,
          path: secondPath,
        },
      ])).rejects.toThrow(/CHAT_ATTACHMENT_BATCH_TOO_LARGE/);
      const afterOversize = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.chat_attachment_upload_sessions",
      );
      expect(afterOversize.rows).toEqual([{ count: 0 }]);

      await expect(beginSessions(db, uploadItems(), OUTSIDER_ID)).rejects.toThrow(
        /CHAT_ATTACHMENT_SCOPE_DENIED/,
      );
      await db.query(
        `INSERT INTO public.account_deletion_jobs(user_id, status)
         VALUES ($1, 'inventorying')`,
        [BRIDE_ID],
      );
      await expect(beginSessions(db)).rejects.toThrow(
        /CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING/,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("preserves legacy rows while disabled, but enforced mode rejects unsessioned paths", async () => {
    const db = await createDatabase();
    const legacyPath = `${COUPLE_ID}/${BRIDE_ID}/60000000-0000-5000-8000-000000000099.png`;
    try {
      await setServiceRole(db);
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'bride', 'user', '기존 클라이언트 메시지',
           jsonb_build_object(
             'client_request_id', $3::text,
             'imagePaths', jsonb_build_array($4::text)
           ),
           'shared'
         )`,
        [
          COUPLE_ID,
          BRIDE_ID,
          "30000000-0000-4000-8000-000000000099",
          legacyPath,
        ],
      )).resolves.toBeDefined();

      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'bride', 'user', '요청 ID가 없던 레거시 이미지',
           jsonb_build_object('imagePaths', jsonb_build_array($3::text)),
           'shared'
         )`,
        [
          COUPLE_ID,
          BRIDE_ID,
          `${COUPLE_ID}/${BRIDE_ID}/60000000-0000-5000-8000-000000000097.png`,
        ],
      )).resolves.toBeDefined();

      await db.exec(`
        UPDATE public.chat_attachment_runtime_state SET mode = 'enforced'
         WHERE singleton
      `);
      await expect(db.query(
        `INSERT INTO public.chat_messages(
           couple_id, sender_id, sender_type, role, content, metadata, visibility
         ) VALUES (
           $1, $2, 'bride', 'user', '세션 없는 새 메시지',
           jsonb_build_object(
             'client_request_id', $3::text,
             'imagePaths', jsonb_build_array($4::text)
           ),
           'shared'
         )`,
        [
          COUPLE_ID,
          BRIDE_ID,
          "30000000-0000-4000-8000-000000000098",
          `${COUPLE_ID}/${BRIDE_ID}/60000000-0000-5000-8000-000000000098.png`,
        ],
      )).rejects.toThrow(/CHAT_ATTACHMENT_SESSION_REQUIRED/);

      await db.exec("RESET ROLE");
      await expect(db.exec(readCandidateSql())).resolves.toBeDefined();
      await setServiceRole(db);
      const state = await db.query<{ mode: string }>(
        "SELECT mode FROM public.chat_attachment_runtime_state WHERE singleton",
      );
      expect(state.rows).toEqual([{ mode: "enforced" }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });
});
