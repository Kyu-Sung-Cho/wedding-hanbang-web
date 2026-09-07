// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { buildAmoraInitialGreetingRequestKey } from "@/lib/ai/amoraInitialGreetingKey";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714164000_harden_amora_tool_idempotency.sql"
  ),
  "utf8"
);
const retryFenceMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716096000_amora_tool_retry_fence.sql"
  ),
  "utf8"
);

const COUPLE_ONE = "10000000-0000-4000-8000-000000000001";
const COUPLE_TWO = "10000000-0000-4000-8000-000000000002";
const COUPLE_THREE = "10000000-0000-4000-8000-000000000003";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const BOOKING_DATE = "2099-07-20";
const REQUEST_KEY = `chat:${USER_ID}:00000000-0000-4000-8000-000000000099`;
const PARTNER_REQUEST_KEY = `chat:${PARTNER_ID}:00000000-0000-4000-8000-000000000100`;
const OPERATION_KEY = "a".repeat(64);
const INPUT_DIGEST = "b".repeat(64);
const PENDING_ACTION_ID = "40000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "50000000-0000-4000-8000-000000000001";
const PARTNER_MESSAGE_ID = "50000000-0000-4000-8000-000000000002";

async function createDatabase({ duplicate = false } = {}) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      role text NOT NULL
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      status text NOT NULL
    );
    CREATE TABLE public.vendor_products (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      is_active boolean NOT NULL DEFAULT true,
      price numeric,
      discount_price numeric
    );
    CREATE TABLE public.vendor_staff (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id)
    );
    CREATE TABLE public.vendor_timeslots (
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      day integer NOT NULL,
      hour integer NOT NULL,
      available boolean NOT NULL DEFAULT true,
      max_bookings integer NOT NULL,
      PRIMARY KEY (vendor_id, day, hour)
    );
    CREATE TABLE public.product_timeslots (
      product_id uuid NOT NULL REFERENCES public.vendor_products(id),
      day integer NOT NULL,
      hour integer NOT NULL,
      available boolean NOT NULL DEFAULT true,
      max_bookings integer NOT NULL,
      PRIMARY KEY (product_id, day, hour)
    );
    CREATE TABLE public.staff_timeslots (
      staff_id uuid NOT NULL REFERENCES public.vendor_staff(id),
      day integer NOT NULL,
      hour integer NOT NULL,
      available boolean NOT NULL DEFAULT true,
      max_bookings integer NOT NULL,
      PRIMARY KEY (staff_id, day, hour)
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      product_id uuid REFERENCES public.vendor_products(id),
      staff_id uuid REFERENCES public.vendor_staff(id),
      booking_date date NOT NULL,
      booking_time time NOT NULL,
      booking_type text,
      bride_name text,
      groom_name text,
      contact_phone text,
      status text NOT NULL DEFAULT 'pending',
      amount numeric,
      is_paid boolean,
      memo text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      total_budget numeric NOT NULL DEFAULT 0,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_chat_request_claims (
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      request_key text NOT NULL,
      user_id uuid NOT NULL,
      visibility text NOT NULL,
      status text NOT NULL DEFAULT 'processing',
      message_id uuid,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      failed_at timestamptz,
      failure_code text,
      attempt_count integer NOT NULL DEFAULT 1,
      PRIMARY KEY (couple_id, request_key)
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.couples (id) VALUES
      ('${COUPLE_ONE}'), ('${COUPLE_TWO}'), ('${COUPLE_THREE}');
    INSERT INTO public.profiles (id, couple_id, role) VALUES
      ('${USER_ID}', '${COUPLE_ONE}', 'bride'),
      ('${PARTNER_ID}', '${COUPLE_ONE}', 'groom');
    INSERT INTO public.chat_messages (
      id, couple_id, sender_id, sender_type, role, content, metadata,
      visibility, created_at
    ) VALUES
      ('${USER_MESSAGE_ID}', '${COUPLE_ONE}', '${USER_ID}', 'bride', 'user',
       'apply it', '{}'::jsonb, 'shared', '2026-07-17T00:00:00.000Z');
    INSERT INTO public.wedding_journeys (couple_id, total_budget, progress)
    VALUES
      ('${COUPLE_ONE}', 10000000, '{"__events":[{"id":"keep-me"}],"venue":{"spent":1000}}'),
      ('${COUPLE_TWO}', 10000000, '{}'),
      ('${COUPLE_THREE}', 10000000, '{}');
    INSERT INTO public.vendors (id, status) VALUES ('${VENDOR_ID}', 'approved');
    INSERT INTO public.vendor_products (id, vendor_id, price, discount_price)
    VALUES ('${PRODUCT_ID}', '${VENDOR_ID}', 120000, 90000);
    INSERT INTO public.vendor_timeslots (vendor_id, day, hour, max_bookings)
    VALUES (
      '${VENDOR_ID}',
      (extract(dow from date '${BOOKING_DATE}')::integer + 6) % 7,
      10,
      2
    );
  `);

  if (duplicate) {
    await db.exec(`
      INSERT INTO public.vendor_bookings (
        vendor_id, couple_id, booking_date, booking_time, booking_type,
        status, amount, is_paid
      ) VALUES
        ('${VENDOR_ID}', '${COUPLE_ONE}', '${BOOKING_DATE}', '10:00', 'consultation', 'pending', 0, false),
        ('${VENDOR_ID}', '${COUPLE_ONE}', '${BOOKING_DATE}', '10:00', 'consultation', 'confirmed', 0, false);
    `);
  }

  return db;
}

async function applyToolMigrations(db: PGlite) {
  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  await db.exec(retryFenceMigration);
}

async function setPersona(db: PGlite, role: "authenticated" | "service_role") {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function insertPartnerSharedMessage(db: PGlite) {
  await db.query(
    `INSERT INTO public.chat_messages (
       id, couple_id, sender_id, sender_type, role, content, metadata,
       visibility, created_at
     ) VALUES (
       $1, $2, $3, 'groom', 'user', 'partner confirmation', '{}'::jsonb,
       'shared', '2026-07-17T00:01:00.000Z'
     )`,
    [PARTNER_MESSAGE_ID, COUPLE_ONE, PARTNER_ID],
  );
}

async function createBooking(
  db: PGlite,
  coupleId: string,
  productId: string | null = null,
  callerAmount = 0
) {
  return db.query<{ booking_id: string }>(
    `SELECT public.create_booking_atomic(
       $1, $2, $3, $4, $5, NULL, 'consultation', '', '', '', $6, ''
     ) AS booking_id`,
    [VENDOR_ID, coupleId, BOOKING_DATE, "10:00", productId, callerAmount]
  );
}

describe("Amora mutating-tool idempotency migration", () => {
  it("refuses to install the linearization fence without an immediate chat parent FK", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await db.exec(
        "ALTER TABLE public.chat_messages DROP CONSTRAINT chat_messages_couple_id_fkey",
      );

      await expect(
        db.exec(retryFenceMigration),
      ).rejects.toThrow(/AMORA_TOOL_FRESHNESS_CHAT_COUPLE_FK_REQUIRED/);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("binds a normal chat request claim to its exact durable user message", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");

      const claim = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, USER_ID, "shared", USER_MESSAGE_ID],
      );
      expect(claim.rows[0]?.result).toMatchObject({
        action: "acquired",
        attempt_count: 1,
        reclaimed: false,
      });

      const bound = await db.query<{ user_message_id: string | null }>(
        `SELECT user_message_id
         FROM public.amora_chat_request_claims
         WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ONE, REQUEST_KEY],
      );
      expect(bound.rows[0]?.user_message_id).toBe(USER_MESSAGE_ID);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("returns a safe conflict without poisoning the ledger for an invalid user row", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      const claim = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5) AS result",
        [
          COUPLE_ONE,
          REQUEST_KEY,
          USER_ID,
          "shared",
          "50000000-0000-4000-8000-000000000099",
        ],
      );
      expect(claim.rows[0]?.result).toEqual({ action: "conflict" });

      const persisted = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.amora_chat_request_claims",
      );
      expect(persisted.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the legacy chat-claim overload but cannot mutate without a binding", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      const legacyClaim = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4) AS result",
        [COUPLE_ONE, REQUEST_KEY, USER_ID, "shared"],
      );
      expect(legacyClaim.rows[0]?.result).toMatchObject({ action: "acquired" });

      const toolClaim = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          REQUEST_KEY,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(toolClaim.rows[0]?.result).toEqual({ action: "stale_context" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("accepts reset greeting lifecycle keys with independent durable claims", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      const firstKey = buildAmoraInitialGreetingRequestKey({
        actorId: USER_ID, coupleId: COUPLE_ONE, visibility: "shared",
        resetAt: "2026-07-15T01:00:00.000Z",
      });
      const nextKey = buildAmoraInitialGreetingRequestKey({
        actorId: USER_ID, coupleId: COUPLE_ONE, visibility: "shared",
        resetAt: "2026-07-16T01:00:00.000Z",
      });
      for (const key of [`greeting:${USER_ID}`, firstKey, nextKey]) {
        const claim = await db.query<{ result: Record<string, unknown> }>(
          "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5) AS result",
          [COUPLE_ONE, key, USER_ID, "shared", null],
        );
        expect(claim.rows[0]?.result).toMatchObject({ action: "acquired" });
      }
      const retry = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, firstKey, USER_ID, "shared", null],
      );
      expect(retry.rows[0]?.result).toMatchObject({ action: "in_progress" });
      await expect(db.query(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5)",
        [COUPLE_ONE, `greeting:${USER_ID}:reset`, USER_ID, "shared", null],
      )).rejects.toThrow(/AMORA_CHAT_CLAIM_INVALID_INPUT/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("never lets a system claim borrow a normal-chat user-message binding", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");

      await expect(db.query(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5)",
        [
          COUPLE_ONE,
          `lifecycle:${"a".repeat(64)}`,
          USER_ID,
          "shared",
          USER_MESSAGE_ID,
        ],
      )).rejects.toThrow(/AMORA_CHAT_CLAIM_INVALID_INPUT/);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a new mutation when newer shared Amora context exists", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5)",
        [COUPLE_ONE, REQUEST_KEY, USER_ID, "shared", USER_MESSAGE_ID],
      );
      await db.query(
        `INSERT INTO public.chat_messages (
           id, couple_id, sender_id, sender_type, role, content, metadata,
           visibility, created_at
         ) VALUES (
           $1, $2, NULL, 'ai', 'assistant', 'newer context', '{}'::jsonb,
           'shared', '2026-07-17T00:01:00.000Z'
         )`,
        ["50000000-0000-4000-8000-000000000003", COUPLE_ONE],
      );

      const result = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          REQUEST_KEY,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(result.rows[0]?.result).toEqual({ action: "stale_context" });

      const persisted = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.amora_tool_executions",
      );
      expect(persisted.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects a new mutation when the partner added newer shared context", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5)",
        [COUPLE_ONE, REQUEST_KEY, USER_ID, "shared", USER_MESSAGE_ID],
      );
      await insertPartnerSharedMessage(db);

      const result = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          REQUEST_KEY,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(result.rows[0]?.result).toEqual({ action: "stale_context" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not invalidate a bound mutation for a newer direct-partner row", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await db.query(
        "SELECT public.claim_amora_chat_request($1,$2,$3,$4,$5)",
        [COUPLE_ONE, REQUEST_KEY, USER_ID, "shared", USER_MESSAGE_ID],
      );
      await db.query(
        `INSERT INTO public.chat_messages (
           id, couple_id, sender_id, sender_type, role, content, metadata,
           visibility, created_at
         ) VALUES (
           $1, $2, $3, 'groom', 'user', 'partner only',
           '{"target":"partner"}'::jsonb, 'shared',
           '2026-07-17T00:01:00.000Z'
         )`,
        [PARTNER_MESSAGE_ID, COUPLE_ONE, PARTNER_ID],
      );

      const result = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          REQUEST_KEY,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(result.rows[0]?.result).toEqual({ action: "acquired" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("persists the canonical active product price instead of caller-supplied amount", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const created = await createBooking(db, COUPLE_ONE, PRODUCT_ID, 1);
      const persisted = await db.query<{ amount: number }>(
        "SELECT amount::integer AS amount FROM public.vendor_bookings WHERE id = $1",
        [created.rows[0]?.booking_id]
      );
      expect(persisted.rows[0]?.amount).toBe(90000);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("returns one booking for an exact retry and blocks a conflicting same-couple slot", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const first = await createBooking(db, COUPLE_ONE);
      const retry = await createBooking(db, COUPLE_ONE);
      expect(retry.rows[0]?.booking_id).toBe(first.rows[0]?.booking_id);

      await expect(createBooking(db, COUPLE_ONE, PRODUCT_ID)).rejects.toThrow(
        /duplicate_couple_slot/
      );

      const count = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.vendor_bookings
        WHERE couple_id = '${COUPLE_ONE}'
          AND status IS DISTINCT FROM 'cancelled'
      `);
      expect(count.rows[0]?.count).toBe(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps capacity atomic across couples while preventing duplicate couple consumption", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      await createBooking(db, COUPLE_ONE);
      await createBooking(db, COUPLE_TWO);
      await expect(createBooking(db, COUPLE_THREE)).rejects.toThrow(/slot_full/);

      const count = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.vendor_bookings
        WHERE vendor_id = '${VENDOR_ID}'
          AND booking_date = '${BOOKING_DATE}'
          AND booking_time = '10:00'
          AND status IS DISTINCT FROM 'cancelled'
      `);
      expect(count.rows[0]?.count).toBe(2);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("cancels exactly once and returns the same terminal row so reconciliation can repair", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await setPersona(db, "service_role");
      const created = await createBooking(db, COUPLE_ONE);
      const bookingId = created.rows[0]?.booking_id;

      const first = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.cancel_booking_atomic($1, $2) AS result",
        [bookingId, COUPLE_ONE]
      );
      const retry = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.cancel_booking_atomic($1, $2) AS result",
        [bookingId, COUPLE_ONE]
      );

      expect(first.rows[0]?.result).toMatchObject({
        id: bookingId,
        status: "cancelled",
        idempotent: false,
      });
      expect(retry.rows[0]?.result).toMatchObject({
        id: bookingId,
        status: "cancelled",
        idempotent: true,
      });

      const replacement = await createBooking(db, COUPLE_ONE);
      expect(replacement.rows[0]?.booking_id).not.toBe(bookingId);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the tool ledger service-only, replays completion, and never reclaims uncertainty", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);

      await setPersona(db, "authenticated");
      await expect(
        db.query(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5)",
          [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST]
        )
      ).rejects.toThrow();
      await expect(db.query("SELECT * FROM public.amora_tool_executions")).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      const acquired = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST]
      );
      expect(acquired.rows[0]?.result).toEqual({ action: "acquired" });

      const inProgress = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST]
      );
      expect(inProgress.rows[0]?.result).toEqual({ action: "in_progress" });

      const persisted = {
        toolName: "update_budget",
        toolOutput: { total_budget: 10_000_000 },
        success: true,
        displayMessage: "updated",
      };
      const completed = await db.query<{ result: boolean }>(
        "SELECT public.complete_amora_tool_execution($1,$2,$3,$4::jsonb) AS result",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, JSON.stringify(persisted)]
      );
      expect(completed.rows[0]?.result).toBe(true);

      const replay = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST]
      );
      expect(replay.rows[0]?.result).toEqual({ action: "completed", result: persisted });

      const uncertainOperation = "c".repeat(64);
      await db.query(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5)",
        [COUPLE_ONE, REQUEST_KEY, uncertainOperation, "add_schedule_event", INPUT_DIGEST]
      );
      await db.query(
        "SELECT public.mark_amora_tool_execution_uncertain($1,$2,$3,$4)",
        [COUPLE_ONE, REQUEST_KEY, uncertainOperation, "PROCESS_EXIT"]
      );
      const uncertain = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, uncertainOperation, "add_schedule_event", INPUT_DIGEST]
      );
      expect(uncertain.rows[0]?.result).toEqual({ action: "uncertain" });

      const crashedOperation = "d".repeat(64);
      await db.query(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5)",
        [COUPLE_ONE, REQUEST_KEY, crashedOperation, "update_venue", INPUT_DIGEST]
      );
      await db.query(
        "UPDATE public.amora_tool_executions SET claimed_at = now() - interval '7 minutes' WHERE couple_id = $1 AND request_key = $2 AND operation_key = $3",
        [COUPLE_ONE, REQUEST_KEY, crashedOperation]
      );
      const expired = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, crashedOperation, "update_venue", INPUT_DIGEST]
      );
      expect(expired.rows[0]?.result).toEqual({ action: "uncertain" });
      const expiredRow = await db.query<{ status: string; failure_code: string }>(
        "SELECT status, failure_code FROM public.amora_tool_executions WHERE couple_id = $1 AND request_key = $2 AND operation_key = $3",
        [COUPLE_ONE, REQUEST_KEY, crashedOperation]
      );
      expect(expiredRow.rows[0]).toEqual({
        status: "uncertain",
        failure_code: "PROCESSING_LEASE_EXPIRED",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("applies total budget and category patches atomically while preserving unrelated progress", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      const applied = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT public.apply_budget_plan_atomic($1,$2,$3::jsonb) AS progress",
        [
          COUPLE_ONE,
          25_000_000,
          JSON.stringify({ venue: { budget: 15_000_000 }, reserve: { budget: 10_000_000 } }),
        ]
      );
      expect(applied.rows[0]?.progress).toMatchObject({
        __events: [{ id: "keep-me" }],
        venue: { budget: 15_000_000 },
        reserve: { budget: 10_000_000 },
      });

      const stored = await db.query<{ total_budget: number; progress: Record<string, unknown> }>(
        "SELECT total_budget::integer, progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ONE]
      );
      expect(stored.rows[0]).toMatchObject({
        total_budget: 25_000_000,
        progress: {
          __events: [{ id: "keep-me" }],
          venue: { budget: 15_000_000 },
          reserve: { budget: 10_000_000 },
        },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("binds new mutations to attempt one and only replays exact work after reclaim", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await db.query(
        `INSERT INTO public.amora_chat_request_claims (
           couple_id, request_key, user_id, visibility, status, attempt_count,
           user_message_id
         ) VALUES ($1, $2, $3, 'shared', 'processing', 1, $4)`,
        [COUPLE_ONE, REQUEST_KEY, USER_ID, USER_MESSAGE_ID],
      );

      const acquired = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST],
      );
      expect(acquired.rows[0]?.result).toEqual({ action: "acquired" });

      const persisted = {
        toolName: "update_budget",
        toolOutput: { total_budget: 10_000_000 },
        success: true,
        displayMessage: "updated",
      };
      await db.query(
        "SELECT public.complete_amora_tool_execution($1,$2,$3,$4::jsonb)",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, JSON.stringify(persisted)],
      );
      await db.query(
        `UPDATE public.amora_chat_request_claims
         SET attempt_count = 2, status = 'processing', claimed_at = now()
         WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ONE, REQUEST_KEY],
      );

      const stale = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6) AS result",
        [COUPLE_ONE, REQUEST_KEY, "c".repeat(64), "update_venue", "d".repeat(64), 1],
      );
      expect(stale.rows[0]?.result).toEqual({ action: "stale_attempt" });

      const replay = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6) AS result",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST, 2],
      );
      expect(replay.rows[0]?.result).toEqual({ action: "completed", result: persisted });

      const changedArguments = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6) AS result",
        [COUPLE_ONE, REQUEST_KEY, "c".repeat(64), "update_budget", "d".repeat(64), 2],
      );
      expect(changedArguments.rows[0]?.result).toEqual({
        action: "retry_new_operation_blocked",
      });

      const rollingReplay = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST],
      );
      expect(rollingReplay.rows[0]?.result).toEqual({
        action: "completed",
        result: persisted,
      });

      const rollingNewOperation = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5) AS result",
        [COUPLE_ONE, REQUEST_KEY, "e".repeat(64), "update_venue", "f".repeat(64)],
      );
      expect(rollingNewOperation.rows[0]?.result).toEqual({
        action: "retry_new_operation_blocked",
      });

      const count = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.amora_tool_executions
         WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ONE, REQUEST_KEY],
      );
      expect(count.rows[0]?.count).toBe(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("allows only one partner request to acquire the same pending action", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await insertPartnerSharedMessage(db);
      await db.query(
        `INSERT INTO public.amora_chat_request_claims (
           couple_id, request_key, user_id, visibility, status, attempt_count,
           user_message_id
         ) VALUES
           ($1, $2, $3, 'shared', 'processing', 1, $6),
           ($1, $4, $5, 'shared', 'processing', 1, $7)`,
        [
          COUPLE_ONE,
          REQUEST_KEY,
          USER_ID,
          PARTNER_REQUEST_KEY,
          PARTNER_ID,
          USER_MESSAGE_ID,
          PARTNER_MESSAGE_ID,
        ],
      );

      // The latest partner message linearizes first. The older exact replay
      // then observes the couple-wide pending-action claim as in progress.
      const [partner, first] = await Promise.all([
        db.query<{ result: Record<string, unknown> }>(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
          [
            COUPLE_ONE,
            PARTNER_REQUEST_KEY,
            OPERATION_KEY,
            "update_budget",
            INPUT_DIGEST,
            1,
            PENDING_ACTION_ID,
          ],
        ),
        db.query<{ result: Record<string, unknown> }>(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
          [
            COUPLE_ONE,
            REQUEST_KEY,
            OPERATION_KEY,
            "update_budget",
            INPUT_DIGEST,
            1,
            PENDING_ACTION_ID,
          ],
        ),
      ]);

      expect(
        [first.rows[0]?.result.action, partner.rows[0]?.result.action].sort(),
      ).toEqual(["acquired", "in_progress"]);
      const rows = await db.query<{ count: number; request_key: string }>(
        `SELECT count(*) OVER ()::integer AS count, request_key
         FROM public.amora_tool_executions
         WHERE couple_id = $1 AND pending_action_id = $2`,
        [COUPLE_ONE, PENDING_ACTION_ID],
      );
      expect(rows.rows[0]?.count).toBe(1);

      const ownerRequestKey = rows.rows[0]!.request_key;
      const replayRequestKey = ownerRequestKey === REQUEST_KEY
        ? PARTNER_REQUEST_KEY
        : REQUEST_KEY;
      const persisted = {
        toolName: "update_budget",
        toolOutput: { total_budget: 10_000_000 },
        success: true,
        displayMessage: "updated",
      };

      const nonOwnerCompletion = await db.query<{ result: boolean }>(
        "SELECT public.complete_amora_tool_execution($1,$2,$3,$4::jsonb) AS result",
        [COUPLE_ONE, replayRequestKey, OPERATION_KEY, JSON.stringify(persisted)],
      );
      expect(nonOwnerCompletion.rows[0]?.result).toBe(false);
      const nonOwnerUncertain = await db.query<{ result: boolean }>(
        "SELECT public.mark_amora_tool_execution_uncertain($1,$2,$3,$4) AS result",
        [COUPLE_ONE, replayRequestKey, OPERATION_KEY, "NON_OWNER"],
      );
      expect(nonOwnerUncertain.rows[0]?.result).toBe(false);

      const ownerCompletion = await db.query<{ result: boolean }>(
        "SELECT public.complete_amora_tool_execution($1,$2,$3,$4::jsonb) AS result",
        [COUPLE_ONE, ownerRequestKey, OPERATION_KEY, JSON.stringify(persisted)],
      );
      expect(ownerCompletion.rows[0]?.result).toBe(true);

      const completedReplay = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          replayRequestKey,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(completedReplay.rows[0]?.result).toEqual({
        action: "completed",
        result: persisted,
      });

      const changedIntent = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          replayRequestKey,
          "c".repeat(64),
          "update_venue",
          "d".repeat(64),
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(changedIntent.rows[0]?.result).toEqual({ action: "conflict" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps concurrent legacy null-action exact replays request-scoped", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await db.query(
        `INSERT INTO public.amora_chat_request_claims (
           couple_id, request_key, user_id, visibility, status, attempt_count,
           user_message_id
         ) VALUES ($1, $2, $3, 'shared', 'processing', 1, $4)`,
        [COUPLE_ONE, REQUEST_KEY, USER_ID, USER_MESSAGE_ID],
      );

      const claims = await Promise.all([
        db.query<{ result: Record<string, unknown> }>(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6) AS result",
          [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST, 1],
        ),
        db.query<{ result: Record<string, unknown> }>(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6) AS result",
          [COUPLE_ONE, REQUEST_KEY, OPERATION_KEY, "update_budget", INPUT_DIGEST, 1],
        ),
      ]);

      expect(claims.map((claim) => claim.rows[0]?.result.action).sort()).toEqual([
        "acquired",
        "in_progress",
      ]);
      const rows = await db.query<{ count: number; all_null: boolean }>(
        `SELECT count(*)::integer AS count,
                bool_and(pending_action_id IS NULL) AS all_null
         FROM public.amora_tool_executions
         WHERE couple_id = $1 AND request_key = $2`,
        [COUPLE_ONE, REQUEST_KEY],
      );
      expect(rows.rows[0]).toEqual({ count: 1, all_null: true });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically conflicts concurrent partner claims with different pending-action intent", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await insertPartnerSharedMessage(db);
      await db.query(
        `INSERT INTO public.amora_chat_request_claims (
           couple_id, request_key, user_id, visibility, status, attempt_count,
           user_message_id
         ) VALUES
           ($1, $2, $3, 'shared', 'processing', 1, $6),
           ($1, $4, $5, 'shared', 'processing', 1, $7)`,
        [
          COUPLE_ONE,
          REQUEST_KEY,
          USER_ID,
          PARTNER_REQUEST_KEY,
          PARTNER_ID,
          USER_MESSAGE_ID,
          PARTNER_MESSAGE_ID,
        ],
      );

      const claims = await Promise.all([
        db.query<{ result: Record<string, unknown> }>(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
          [
            COUPLE_ONE,
            PARTNER_REQUEST_KEY,
            "c".repeat(64),
            "update_venue",
            "d".repeat(64),
            1,
            PENDING_ACTION_ID,
          ],
        ),
        db.query<{ result: Record<string, unknown> }>(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
          [
            COUPLE_ONE,
            REQUEST_KEY,
            OPERATION_KEY,
            "update_budget",
            INPUT_DIGEST,
            1,
            PENDING_ACTION_ID,
          ],
        ),
      ]);

      expect(claims.map((claim) => claim.rows[0]?.result.action).sort()).toEqual([
        "acquired",
        "conflict",
      ]);
      const rows = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.amora_tool_executions
         WHERE couple_id = $1 AND pending_action_id = $2`,
        [COUPLE_ONE, PENDING_ACTION_ID],
      );
      expect(rows.rows[0]?.count).toBe(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not let an unauthorized or stale request poison a pending action", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await setPersona(db, "service_role");
      await insertPartnerSharedMessage(db);
      await db.query(
        `INSERT INTO public.amora_chat_request_claims (
           couple_id, request_key, user_id, visibility, status, attempt_count,
           user_message_id
         ) VALUES
           ($1, $2, $3, 'shared', 'processing', 2, $6),
           ($1, $4, $5, 'shared', 'processing', 1, $7)`,
        [
          COUPLE_ONE,
          REQUEST_KEY,
          USER_ID,
          PARTNER_REQUEST_KEY,
          PARTNER_ID,
          USER_MESSAGE_ID,
          PARTNER_MESSAGE_ID,
        ],
      );

      await resetPersona(db);
      await setPersona(db, "authenticated");
      await expect(
        db.query(
          "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7)",
          [
            COUPLE_ONE,
            REQUEST_KEY,
            OPERATION_KEY,
            "update_budget",
            INPUT_DIGEST,
            2,
            PENDING_ACTION_ID,
          ],
        ),
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      const stale = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          REQUEST_KEY,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(stale.rows[0]?.result).toEqual({ action: "stale_attempt" });

      const valid = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          PARTNER_REQUEST_KEY,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          1,
          PENDING_ACTION_ID,
        ],
      );
      expect(valid.rows[0]?.result).toEqual({ action: "acquired" });

      const rows = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.amora_tool_executions
         WHERE couple_id = $1 AND pending_action_id = $2`,
        [COUPLE_ONE, PENDING_ACTION_ID],
      );
      expect(rows.rows[0]?.count).toBe(1);

      const marked = await db.query<{ result: boolean }>(
        "SELECT public.mark_amora_tool_execution_uncertain($1,$2,$3,$4) AS result",
        [COUPLE_ONE, PARTNER_REQUEST_KEY, OPERATION_KEY, "OWNER_ABORTED"],
      );
      expect(marked.rows[0]?.result).toBe(true);
      const uncertainReplay = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_tool_execution($1,$2,$3,$4,$5,$6,$7) AS result",
        [
          COUPLE_ONE,
          REQUEST_KEY,
          OPERATION_KEY,
          "update_budget",
          INPUT_DIGEST,
          2,
          PENDING_ACTION_ID,
        ],
      );
      expect(uncertainReplay.rows[0]?.result).toEqual({ action: "uncertain" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps all rolling-deploy claim identities after an idempotent reapply", async () => {
    const db = await createDatabase();
    try {
      await applyToolMigrations(db);
      await db.exec(retryFenceMigration);

      const identities = await db.query<{
        chat_four_args: boolean;
        chat_five_args: boolean;
        five_args: boolean;
        six_args: boolean;
        seven_args: boolean;
      }>(`
        SELECT
          to_regprocedure(
            'public.claim_amora_chat_request(uuid,text,uuid,text)'
          ) IS NOT NULL AS chat_four_args,
          to_regprocedure(
            'public.claim_amora_chat_request(uuid,text,uuid,text,uuid)'
          ) IS NOT NULL AS chat_five_args,
          to_regprocedure(
            'public.claim_amora_tool_execution(uuid,text,text,text,text)'
          ) IS NOT NULL AS five_args,
          to_regprocedure(
            'public.claim_amora_tool_execution(uuid,text,text,text,text,integer)'
          ) IS NOT NULL AS six_args,
          to_regprocedure(
            'public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)'
          ) IS NOT NULL AS seven_args
      `);
      expect(identities.rows[0]).toEqual({
        chat_four_args: true,
        chat_five_args: true,
        five_args: true,
        six_args: true,
        seven_args: true,
      });

      const index = await db.query<{ unique: boolean; partial: boolean }>(`
        SELECT index_state.indisunique AS unique,
               index_state.indpred IS NOT NULL AS partial
        FROM pg_catalog.pg_index AS index_state
        WHERE index_state.indexrelid =
          'public.amora_tool_executions_one_pending_action_per_couple'::regclass
      `);
      expect(index.rows[0]).toEqual({ unique: true, partial: true });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("refuses to choose among legacy active duplicate bookings", async () => {
    const db = await createDatabase({ duplicate: true });
    try {
      await expect(db.exec(`BEGIN;\n${migration}\nCOMMIT;`)).rejects.toThrow(
        /ACTIVE_COUPLE_BOOKING_DUPLICATES_REQUIRE_REVIEW/
      );
      await db.exec("ROLLBACK").catch(() => undefined);

      const index = await db.query<{ exists: boolean }>(`
        SELECT to_regclass('public.vendor_bookings_one_active_couple_vendor_slot') IS NOT NULL AS exists
      `);
      expect(index.rows[0]?.exists).toBe(false);
    } finally {
      await db.close();
    }
  }, 30_000);
});
