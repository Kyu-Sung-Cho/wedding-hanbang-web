// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714163000_atomic_chat_clear_request.sql"
  ),
  "utf8"
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_CREATED_AT = "2026-07-14T01:02:03.000Z";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid,
      role text,
      shared_chat_cleared_at timestamptz
    );

    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid,
      sender_id uuid,
      sender_type text,
      role text,
      content text NOT NULL,
      metadata jsonb,
      created_at timestamptz,
      visibility text
    );

    INSERT INTO public.couples (id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');

    INSERT INTO public.profiles (id, couple_id, role)
    VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom');

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
  `);

  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  return db;
}

async function insertRequest(
  db: PGlite,
  {
    id = REQUEST_ID,
    requestedByRole = "bride",
  }: { id?: string; requestedByRole?: "bride" | "groom" | null } = {}
) {
  const metadata = {
    clearRequest: {
      type: "shared",
      requestedBy: BRIDE_ID,
      ...(requestedByRole ? { requestedByRole } : {}),
      requestedAt: REQUEST_CREATED_AT,
      status: "pending",
    },
  };

  await db.query(
    `INSERT INTO public.chat_messages (
       id, couple_id, sender_id, sender_type, role, content, metadata, created_at, visibility
     ) VALUES ($1, $2, $3, 'bride', 'user', 'clear request', $4::jsonb, $5, 'shared')`,
    [id, COUPLE_ID, BRIDE_ID, JSON.stringify(metadata), REQUEST_CREATED_AT]
  );
}

async function setAuthenticated(db: PGlite, userId: string) {
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("atomic shared-chat clear request migration", () => {
  it("accepts once, advances both cursors, allows an exact retry, and rejects a conflicting response", async () => {
    const db = await createDatabase();
    try {
      await insertRequest(db);

      const acl = await db.query<{
        authenticated: boolean;
        anon: boolean;
        service_role: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'authenticated',
            'public.resolve_shared_chat_clear_request(uuid,text)',
            'EXECUTE'
          ) AS authenticated,
          has_function_privilege(
            'anon',
            'public.resolve_shared_chat_clear_request(uuid,text)',
            'EXECUTE'
          ) AS anon,
          has_function_privilege(
            'service_role',
            'public.resolve_shared_chat_clear_request(uuid,text)',
            'EXECUTE'
          ) AS service_role
      `);
      expect(acl.rows[0]).toEqual({ authenticated: true, anon: false, service_role: false });

      await setAuthenticated(db, GROOM_ID);
      const accepted = await db.query<{
        resolution_status: string;
        cleared_at: string;
        idempotent: boolean;
      }>("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'accept')", [
        REQUEST_ID,
      ]);
      expect(accepted.rows[0].resolution_status).toBe("accepted");
      expect(accepted.rows[0].cleared_at).toBeTruthy();
      expect(accepted.rows[0].idempotent).toBe(false);

      await resetPersona(db);
      const state = await db.query<{
        status: string;
        responded_by: string;
        resolution_version: string;
        distinct_cursors: number;
        cleared_members: number;
      }>(`
        SELECT
          message.metadata #>> '{clearRequest,status}' AS status,
          message.metadata #>> '{clearRequest,respondedBy}' AS responded_by,
          message.metadata #>> '{clearRequest,resolutionVersion}' AS resolution_version,
          count(DISTINCT profile.shared_chat_cleared_at)::integer AS distinct_cursors,
          count(profile.shared_chat_cleared_at)::integer AS cleared_members
        FROM public.chat_messages AS message
        CROSS JOIN public.profiles AS profile
        WHERE message.id = '${REQUEST_ID}'
        GROUP BY message.metadata
      `);
      expect(state.rows[0]).toEqual({
        status: "accepted",
        responded_by: GROOM_ID,
        resolution_version: "1",
        distinct_cursors: 1,
        cleared_members: 2,
      });

      await setAuthenticated(db, GROOM_ID);
      const retry = await db.query<{ idempotent: boolean }>(
        "SELECT idempotent FROM public.resolve_shared_chat_clear_request($1, 'accept')",
        [REQUEST_ID]
      );
      expect(retry.rows[0].idempotent).toBe(true);
      await expect(
        db.query("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'decline')", [
          REQUEST_ID,
        ])
      ).rejects.toThrow(/CHAT_CLEAR_RESPONSE_CONFLICT/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("declines without moving cursors and makes accept-vs-decline conflict-safe", async () => {
    const db = await createDatabase();
    try {
      await insertRequest(db);
      await setAuthenticated(db, GROOM_ID);

      const declined = await db.query<{
        resolution_status: string;
        cleared_at: string | null;
        idempotent: boolean;
      }>("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'decline')", [
        REQUEST_ID,
      ]);
      expect(declined.rows[0]).toEqual({
        resolution_status: "declined",
        cleared_at: null,
        idempotent: false,
      });

      const retry = await db.query<{ idempotent: boolean }>(
        "SELECT idempotent FROM public.resolve_shared_chat_clear_request($1, 'decline')",
        [REQUEST_ID]
      );
      expect(retry.rows[0].idempotent).toBe(true);
      await expect(
        db.query("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'accept')", [
          REQUEST_ID,
        ])
      ).rejects.toThrow(/CHAT_CLEAR_RESPONSE_CONFLICT/);

      await resetPersona(db);
      const cursors = await db.query<{ count: number }>(
        "SELECT count(shared_chat_cleared_at)::integer AS count FROM public.profiles"
      );
      expect(cursors.rows[0].count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects the requester, outsiders, and requests without an explicit role", async () => {
    const db = await createDatabase();
    try {
      await insertRequest(db);

      await setAuthenticated(db, BRIDE_ID);
      await expect(
        db.query("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'accept')", [
          REQUEST_ID,
        ])
      ).rejects.toThrow(/CHAT_CLEAR_PARTNER_ONLY/);

      await resetPersona(db);
      await setAuthenticated(db, OUTSIDER_ID);
      await expect(
        db.query("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'accept')", [
          REQUEST_ID,
        ])
      ).rejects.toThrow(/CHAT_CLEAR_PARTNER_ONLY/);

      await resetPersona(db);
      await db.query(
        "UPDATE public.chat_messages SET metadata = metadata #- '{clearRequest,requestedByRole}' WHERE id = $1",
        [REQUEST_ID]
      );
      await setAuthenticated(db, GROOM_ID);
      await expect(
        db.query("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'accept')", [
          REQUEST_ID,
        ])
      ).rejects.toThrow(/CHAT_CLEAR_REQUESTER_ROLE_REQUIRED/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls the metadata response back when either profile cursor update fails", async () => {
    const db = await createDatabase();
    try {
      await insertRequest(db);
      await db.exec(`
        CREATE FUNCTION public.fail_groom_cursor_update()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.id = '${GROOM_ID}' THEN
            RAISE EXCEPTION 'PROFILE_CURSOR_WRITE_BLOCKED';
          END IF;
          RETURN NEW;
        END;
        $$;

        CREATE TRIGGER fail_groom_cursor_update
        BEFORE UPDATE OF shared_chat_cleared_at ON public.profiles
        FOR EACH ROW EXECUTE FUNCTION public.fail_groom_cursor_update();
      `);

      await setAuthenticated(db, GROOM_ID);
      await expect(
        db.query("SELECT * FROM public.resolve_shared_chat_clear_request($1, 'accept')", [
          REQUEST_ID,
        ])
      ).rejects.toThrow(/PROFILE_CURSOR_WRITE_BLOCKED/);

      await resetPersona(db);
      const rolledBack = await db.query<{ status: string; cleared_members: number }>(`
        SELECT
          message.metadata #>> '{clearRequest,status}' AS status,
          (SELECT count(shared_chat_cleared_at)::integer FROM public.profiles) AS cleared_members
        FROM public.chat_messages AS message
        WHERE message.id = '${REQUEST_ID}'
      `);
      expect(rolledBack.rows[0]).toEqual({ status: "pending", cleared_members: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
