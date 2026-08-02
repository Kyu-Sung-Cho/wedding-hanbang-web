// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803105000_rate_limit_direct_chat_message_inserts.sql",
  ),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";

describe("direct authenticated chat insert rate migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;

      CREATE SCHEMA auth;
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto SCHEMA extensions;
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.role()
      RETURNS text
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
      $$;

      CREATE TABLE public.chat_messages (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        sender_id uuid,
        role text NOT NULL,
        content text NOT NULL DEFAULT 'message',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.rate_limit_buckets (
        key text PRIMARY KEY,
        count integer NOT NULL DEFAULT 0,
        reset_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rate_limit_buckets_service_role_all
        ON public.rate_limit_buckets FOR ALL TO service_role
        USING (true) WITH CHECK (true);
      GRANT ALL ON public.rate_limit_buckets TO service_role;

      GRANT USAGE ON SCHEMA auth, extensions, public TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;
    `);
    await db.exec(migration);
  });

  afterEach(async () => {
    await db.close();
  });

  async function authenticate(userId: string, role = "authenticated") {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  }

  it("survives message deletion and blocks the thirty-first direct insert", async () => {
    await authenticate(USER_ID);
    for (let index = 0; index < 30; index += 1) {
      await db.exec(`
        INSERT INTO public.chat_messages(sender_id, role)
        VALUES ('${USER_ID}', 'user')
      `);
    }

    await db.exec("DELETE FROM public.chat_messages");
    await expect(db.exec(`
      INSERT INTO public.chat_messages(sender_id, role)
      VALUES ('${USER_ID}', 'user')
    `)).rejects.toThrow(/direct_chat_rate_limit_exceeded/u);

    const buckets = await db.query<{ key: string; count: number }>(`
      SELECT key, count FROM public.rate_limit_buckets ORDER BY key
    `);
    expect(buckets.rows).toHaveLength(2);
    expect(buckets.rows.map((row) => row.count)).toEqual([30, 30]);
    expect(buckets.rows.every((row) => !row.key.includes(USER_ID))).toBe(true);
    expect(buckets.rows.every((row) => /uuid-sha256:[0-9a-f]{64}$/u.test(row.key)))
      .toBe(true);
  });

  it("isolates users and rejects direct identity or role forgery", async () => {
    await authenticate(USER_ID);
    await expect(db.exec(`
      INSERT INTO public.chat_messages(sender_id, role)
      VALUES ('${OTHER_USER_ID}', 'user')
    `)).rejects.toThrow(/direct_chat_insert_actor_invalid/u);
    await expect(db.exec(`
      INSERT INTO public.chat_messages(sender_id, role)
      VALUES ('${USER_ID}', 'assistant')
    `)).rejects.toThrow(/direct_chat_insert_actor_invalid/u);

    await authenticate(OTHER_USER_ID);
    await expect(db.exec(`
      INSERT INTO public.chat_messages(sender_id, role)
      VALUES ('${OTHER_USER_ID}', 'user')
    `)).resolves.toBeDefined();
    expect((await db.query("SELECT * FROM public.rate_limit_buckets")).rows)
      .toHaveLength(2);
  });

  it("enforces the daily ceiling atomically without consuming the minute bucket", async () => {
    await authenticate(USER_ID);
    await db.exec(`
      INSERT INTO public.chat_messages(sender_id, role)
      VALUES ('${USER_ID}', 'user')
    `);
    await db.exec(`
      UPDATE public.rate_limit_buckets
      SET count = CASE
        WHEN key LIKE 'chat:direct:day:%' THEN 500
        ELSE 0
      END
    `);

    await expect(db.exec(`
      INSERT INTO public.chat_messages(sender_id, role)
      VALUES ('${USER_ID}', 'user')
    `)).rejects.toThrow(/direct_chat_rate_limit_exceeded/u);

    const buckets = await db.query<{ key: string; count: number }>(`
      SELECT key, count FROM public.rate_limit_buckets ORDER BY key
    `);
    expect(buckets.rows.find((row) => row.key.includes(":day:"))?.count).toBe(500);
    expect(buckets.rows.find((row) => row.key.includes(":minute:"))?.count).toBe(0);
  });

  it("does not charge server-owned inserts", async () => {
    await authenticate(USER_ID, "service_role");
    for (let index = 0; index < 35; index += 1) {
      await db.exec(`
        INSERT INTO public.chat_messages(sender_id, role)
        VALUES ('${USER_ID}', 'assistant')
      `);
    }
    expect((await db.query("SELECT * FROM public.rate_limit_buckets")).rows)
      .toHaveLength(0);
  });

  it("keeps bucket state and both trigger helpers inaccessible to application roles", async () => {
    const acl = await db.query<{
      anon_table: boolean;
      authenticated_table: boolean;
      consume_anon: boolean;
      consume_authenticated: boolean;
      consume_service: boolean;
      guard_anon: boolean;
      guard_authenticated: boolean;
      guard_service: boolean;
      force_rls: boolean;
    }>(`
      SELECT
        has_table_privilege('anon', 'public.rate_limit_buckets', 'SELECT') AS anon_table,
        has_table_privilege('authenticated', 'public.rate_limit_buckets', 'SELECT') AS authenticated_table,
        has_function_privilege('anon', 'public.consume_direct_chat_message_rate_limit(text,integer,integer)', 'EXECUTE') AS consume_anon,
        has_function_privilege('authenticated', 'public.consume_direct_chat_message_rate_limit(text,integer,integer)', 'EXECUTE') AS consume_authenticated,
        has_function_privilege('service_role', 'public.consume_direct_chat_message_rate_limit(text,integer,integer)', 'EXECUTE') AS consume_service,
        has_function_privilege('anon', 'public.guard_direct_chat_message_insert_rate()', 'EXECUTE') AS guard_anon,
        has_function_privilege('authenticated', 'public.guard_direct_chat_message_insert_rate()', 'EXECUTE') AS guard_authenticated,
        has_function_privilege('service_role', 'public.guard_direct_chat_message_insert_rate()', 'EXECUTE') AS guard_service,
        (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.rate_limit_buckets'::regclass) AS force_rls
    `);
    expect(acl.rows).toEqual([{
      anon_table: false,
      authenticated_table: false,
      consume_anon: false,
      consume_authenticated: false,
      consume_service: false,
      guard_anon: false,
      guard_authenticated: false,
      guard_service: false,
      force_rls: true,
    }]);
  });
});
