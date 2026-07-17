// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const projectionMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716102000_booking_projection_outbox.sql",
  ),
  "utf8",
);
const outcomeMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716109000_booking_outcome_atomic.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "10000000-0000-4000-8000-000000000002";
const CUSTOMER_ID = "11000000-0000-4000-8000-000000000001";
const OTHER_CUSTOMER_ID = "11000000-0000-4000-8000-000000000002";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "21000000-0000-4000-8000-000000000001";
const BOOKING_ID = "30000000-0000-4000-8000-000000000001";

async function createDatabase({ seedDuplicates = false } = {}) {
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

    CREATE TABLE public.couples (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id)
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text,
      category text
    );
    CREATE TABLE public.vendor_products (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      name text
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      product_id uuid REFERENCES public.vendor_products(id),
      staff_id uuid,
      booking_date date NOT NULL,
      booking_time time NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      amount numeric,
      contracted_amount numeric,
      actual_amount numeric,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      product_id uuid REFERENCES public.vendor_products(id),
      booking_id uuid REFERENCES public.vendor_bookings(id) ON DELETE SET NULL,
      customer_id uuid,
      rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
      content text,
      is_visible boolean DEFAULT true,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id),
      category text,
      decision_type text,
      title text,
      chosen_value jsonb,
      reasoning text,
      confidence numeric(3,2),
      decided_at timestamptz,
      source text,
      source_ref_id uuid,
      metadata jsonb DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      superseded_at timestamptz,
      superseded_by uuid REFERENCES public.decision_nodes(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.couples (id) VALUES ('${COUPLE_ID}'), ('${OTHER_COUPLE_ID}');
    INSERT INTO public.profiles (id, couple_id) VALUES
      ('${CUSTOMER_ID}', '${COUPLE_ID}'),
      ('${OTHER_CUSTOMER_ID}', '${OTHER_COUPLE_ID}');
    INSERT INTO public.vendors (id, name, category)
    VALUES ('${VENDOR_ID}', 'Hanbang Studio', 'studio');
    INSERT INTO public.vendor_products (id, vendor_id, name)
    VALUES ('${PRODUCT_ID}', '${VENDOR_ID}', 'Portrait Package');
    INSERT INTO public.vendor_bookings (
      id, vendor_id, couple_id, product_id, booking_date, booking_time,
      status, amount
    ) VALUES (
      '${BOOKING_ID}', '${VENDOR_ID}', '${COUPLE_ID}', '${PRODUCT_ID}',
      '2099-07-20', '10:00', 'confirmed', 500000
    );
    ${seedDuplicates ? `
      INSERT INTO public.vendor_reviews (
        id, vendor_id, product_id, booking_id, customer_id, rating, content,
        is_visible, created_at, updated_at
      ) VALUES
        (
          '40000000-0000-4000-8000-000000000001', '${VENDOR_ID}', '${PRODUCT_ID}',
          '${BOOKING_ID}', '${CUSTOMER_ID}', 2, 'Older review', true,
          '2099-06-01T00:00:00Z', '2099-06-01T00:00:00Z'
        ),
        (
          '40000000-0000-4000-8000-000000000002', '${VENDOR_ID}', '${PRODUCT_ID}',
          '${BOOKING_ID}', '${CUSTOMER_ID}', 4, 'Newer review', true,
          '2099-06-02T00:00:00Z', '2099-06-02T00:00:00Z'
        );
      INSERT INTO public.decision_nodes (
        id, couple_id, category, decision_type, title, chosen_value, source,
        source_ref_id, metadata, created_at, updated_at
      ) VALUES
        (
          '50000000-0000-4000-8000-000000000001', '${COUPLE_ID}', 'studio',
          'completed', 'Older decision', '{}', 'vendor_booking', '${BOOKING_ID}',
          '{}', '2099-06-01T00:00:00Z', '2099-06-01T00:00:00Z'
        ),
        (
          '50000000-0000-4000-8000-000000000002', '${COUPLE_ID}', 'studio',
          'completed', 'Newer decision', '{}', 'vendor_booking', '${BOOKING_ID}',
          '{}', '2099-06-02T00:00:00Z', '2099-06-02T00:00:00Z'
        );
    ` : ""}
    INSERT INTO public.wedding_journeys (couple_id, progress) VALUES
      ('${COUPLE_ID}', '{"studio":{"budget":1000000,"spent":100000}}'::jsonb),
      ('${OTHER_COUPLE_ID}', '{}'::jsonb);

    BEGIN;
    ${projectionMigration}
    ${outcomeMigration}
    COMMIT;
  `);
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

async function completeOutcome(db: PGlite, customerId = CUSTOMER_ID) {
  return db.query<{ result: Record<string, unknown> }>(
    `SELECT public.complete_vendor_booking_outcome(
       $1, $2, 650000, 500000, 4, 'Helpful consultation', false
     ) AS result`,
    [BOOKING_ID, customerId],
  );
}

describe("atomic booking outcome migration", () => {
  it("atomically converges booking, review, durable decision, and projection intent across retries", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");

      const first = await completeOutcome(db);
      expect(first.rows[0]?.result).toMatchObject({
        accepted: true,
        coupleId: COUPLE_ID,
        booking: {
          id: BOOKING_ID,
          status: "completed",
          amount: 500000,
          contractedAmount: 500000,
          actualAmount: 650000,
        },
        review: {
          rating: 4,
          content: "Helpful consultation",
          isVisible: false,
        },
        baselineAmount: 500000,
        extraAmount: 150000,
        context: {
          vendorId: VENDOR_ID,
          vendorName: "Hanbang Studio",
          vendorCategory: "studio",
          productId: PRODUCT_ID,
          productName: "Portrait Package",
        },
      });

      const retried = await completeOutcome(db);
      expect(retried.rows[0]?.result).toEqual(first.rows[0]?.result);

      const counts = await db.query<{
        reviews: number;
        decisions: number;
        generation: number;
        projection_status: string;
      }>(
        `SELECT
           (SELECT count(*)::integer FROM public.vendor_reviews) AS reviews,
           (SELECT count(*)::integer FROM public.decision_nodes
             WHERE source = 'vendor_booking' AND decision_type = 'completed') AS decisions,
           generation::integer,
           status AS projection_status
         FROM public.booking_projection_jobs
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(counts.rows[0]).toEqual({
        reviews: 1,
        decisions: 1,
        generation: 2,
        projection_status: "pending",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps a cleared contract amount retry-stable by falling back to the quote", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await db.query(
        `SELECT public.complete_vendor_booking_outcome(
           $1, $2, 600000, 450000, 4, NULL, false
         )`,
        [BOOKING_ID, CUSTOMER_ID],
      );

      const clearContract = () => db.query<{ result: Record<string, unknown> }>(
        `SELECT public.complete_vendor_booking_outcome(
           $1, $2, 650000, NULL, 4, NULL, false
         ) AS result`,
        [BOOKING_ID, CUSTOMER_ID],
      );
      const first = await clearContract();
      const retry = await clearContract();

      expect(first.rows[0]?.result).toMatchObject({
        booking: { contractedAmount: null, actualAmount: 650000 },
        baselineAmount: 500000,
        extraAmount: 150000,
      });
      expect(retry.rows[0]?.result).toEqual(first.rows[0]?.result);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rolls back booking, review, and projection intent when the durable decision cannot commit", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.reject_booking_decision()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced_decision_failure';
        END
        $$;
        CREATE TRIGGER reject_booking_decision
        BEFORE INSERT OR UPDATE ON public.decision_nodes
        FOR EACH ROW EXECUTE FUNCTION public.reject_booking_decision();
      `);
      await setPersona(db, "service_role");

      await expect(completeOutcome(db)).rejects.toThrow("forced_decision_failure");

      const state = await db.query<{
        status: string;
        actual_amount: number | null;
        reviews: number;
        decisions: number;
        generation: number;
      }>(
        `SELECT
           booking.status,
           booking.actual_amount::integer,
           (SELECT count(*)::integer FROM public.vendor_reviews) AS reviews,
           (SELECT count(*)::integer FROM public.decision_nodes) AS decisions,
           job.generation::integer
         FROM public.vendor_bookings AS booking
         JOIN public.booking_projection_jobs AS job ON job.booking_id = booking.id
         WHERE booking.id = $1`,
        [BOOKING_ID],
      );
      expect(state.rows[0]).toEqual({
        status: "confirmed",
        actual_amount: null,
        reviews: 0,
        decisions: 0,
        generation: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the RPC service-only and rejects a customer outside the booking couple", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated");
      await expect(completeOutcome(db)).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(completeOutcome(db, OTHER_CUSTOMER_ID)).rejects.toThrow(
        "booking_outcome_not_found",
      );

      const booking = await db.query<{ status: string; actual_amount: number | null }>(
        `SELECT status, actual_amount::integer
         FROM public.vendor_bookings WHERE id = $1`,
        [BOOKING_ID],
      );
      expect(booking.rows[0]).toEqual({
        status: "confirmed",
        actual_amount: null,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("retires pre-existing duplicate identities without deleting their content", async () => {
    const db = await createDatabase({ seedDuplicates: true });
    try {
      await setPersona(db, "service_role");
      const reviews = await db.query<{
        id: string;
        booking_id: string | null;
        content: string;
        is_visible: boolean;
      }>(
        `SELECT id, booking_id, content, is_visible
         FROM public.vendor_reviews ORDER BY id`,
      );
      expect(reviews.rows).toEqual([
        {
          id: "40000000-0000-4000-8000-000000000001",
          booking_id: null,
          content: "Older review",
          is_visible: false,
        },
        {
          id: "40000000-0000-4000-8000-000000000002",
          booking_id: BOOKING_ID,
          content: "Newer review",
          is_visible: true,
        },
      ]);

      const decisions = await db.query<{
        id: string;
        source_ref_id: string | null;
        title: string;
        superseded_by: string | null;
      }>(
        `SELECT id, source_ref_id, title, superseded_by
         FROM public.decision_nodes ORDER BY id`,
      );
      expect(decisions.rows).toEqual([
        {
          id: "50000000-0000-4000-8000-000000000001",
          source_ref_id: null,
          title: "Older decision",
          superseded_by: "50000000-0000-4000-8000-000000000002",
        },
        {
          id: "50000000-0000-4000-8000-000000000002",
          source_ref_id: BOOKING_ID,
          title: "Newer decision",
          superseded_by: null,
        },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
