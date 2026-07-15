// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714164000_harden_amora_tool_idempotency.sql"
  ),
  "utf8"
);

const COUPLE_ONE = "10000000-0000-4000-8000-000000000001";
const COUPLE_TWO = "10000000-0000-4000-8000-000000000002";
const COUPLE_THREE = "10000000-0000-4000-8000-000000000003";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const BOOKING_DATE = "2099-07-20";
const REQUEST_KEY = `chat:${USER_ID}:00000000-0000-4000-8000-000000000099`;
const OPERATION_KEY = "a".repeat(64);
const INPUT_DIGEST = "b".repeat(64);

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

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.couples (id) VALUES
      ('${COUPLE_ONE}'), ('${COUPLE_TWO}'), ('${COUPLE_THREE}');
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

async function setPersona(db: PGlite, role: "authenticated" | "service_role") {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
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
