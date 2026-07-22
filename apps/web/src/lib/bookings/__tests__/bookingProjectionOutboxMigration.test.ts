// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716102000_booking_projection_outbox.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const BOOKING_ID = "30000000-0000-4000-8000-000000000001";

async function createDatabase({ existingBooking = false } = {}) {
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
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text,
      category text
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      product_id uuid,
      staff_id uuid,
      booking_date date NOT NULL,
      booking_time time NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      amount numeric,
      actual_amount numeric,
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

    INSERT INTO public.couples (id) VALUES ('${COUPLE_ID}');
    INSERT INTO public.vendors (id, name, category)
    VALUES ('${VENDOR_ID}', 'Hanbang Studio', 'studio');
    INSERT INTO public.wedding_journeys (couple_id, progress)
    VALUES (
      '${COUPLE_ID}',
      '{
        "__events": [{
          "id": "manual-event",
          "date": "2099-07-01",
          "title": "Keep this schedule"
        }],
        "studio": {"budget": 1000000, "spent": 100000}
      }'::jsonb
    );

    ${existingBooking ? `
      INSERT INTO public.vendor_bookings (
        id, vendor_id, couple_id, booking_date, booking_time, status, amount
      ) VALUES (
        '${BOOKING_ID}', '${VENDOR_ID}', '${COUPLE_ID}',
        '2099-07-20', '10:00', 'pending', 500000
      );
    ` : ""}

  `);
  await db.exec(migration);
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

async function insertBooking(db: PGlite, bookingId = BOOKING_ID) {
  await db.query(
    `INSERT INTO public.vendor_bookings (
       id, vendor_id, couple_id, booking_date, booking_time, status, amount
     ) VALUES ($1, $2, $3, '2099-07-20', '10:00', 'pending', 500000)`,
    [bookingId, VENDOR_ID, COUPLE_ID],
  );
}

async function claimProjection(db: PGlite, bookingId = BOOKING_ID) {
  const claimed = await db.query<{ job: Record<string, unknown> }>(
    "SELECT public.claim_booking_projection_job($1) AS job",
    [bookingId],
  );
  const job = claimed.rows[0]?.job;
  if (!job) throw new Error("projection job was not claimable");
  return job;
}

async function applyProjection(
  db: PGlite,
  job: Record<string, unknown>,
  input: {
    desiredState: "active" | "cancelled";
    event: Record<string, unknown> | null;
    categoryKey: string | null;
    amount: number;
  },
) {
  return db.query<{ result: Record<string, unknown> }>(
    `SELECT public.apply_booking_progress_projection(
       $1, $2, $3, $4::jsonb, $5, $6, $7, $8
     ) AS result`,
    [
      job.coupleId,
      job.bookingId,
      input.desiredState,
      input.event ? JSON.stringify(input.event) : null,
      input.categoryKey,
      input.amount,
      job.generation,
      job.claimToken,
    ],
  );
}

describe("booking projection outbox migration", () => {
  it("backfills a durable repair job for bookings created before the migration", async () => {
    const db = await createDatabase({ existingBooking: true });
    try {
      await setPersona(db, "service_role");
      const job = await db.query<{
        desired_state: string;
        generation: number;
        status: string;
      }>(
        `SELECT desired_state, generation::integer, status
         FROM public.booking_projection_jobs
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(job.rows[0]).toEqual({
        desired_state: "active",
        generation: 1,
        status: "pending",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("records create and cancel projection intent in the booking transaction and keeps it service-only", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);

      const created = await db.query<{
        desired_state: string;
        generation: number;
        status: string;
      }>(
        `SELECT desired_state, generation::integer, status
         FROM public.booking_projection_jobs
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(created.rows[0]).toEqual({
        desired_state: "active",
        generation: 1,
        status: "pending",
      });

      await db.query(
        "UPDATE public.vendor_bookings SET status = 'cancelled' WHERE id = $1",
        [BOOKING_ID],
      );
      const cancelled = await db.query<{
        desired_state: string;
        generation: number;
        status: string;
        count: number;
      }>(
        `SELECT desired_state, generation::integer, status,
                count(*) OVER ()::integer AS count
         FROM public.booking_projection_jobs
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(cancelled.rows[0]).toEqual({
        desired_state: "cancelled",
        generation: 2,
        status: "pending",
        count: 1,
      });

      await resetPersona(db);
      await setPersona(db, "authenticated");
      await expect(
        db.query("SELECT * FROM public.booking_projection_jobs"),
      ).rejects.toThrow();
      await expect(
        db.query("SELECT public.claim_booking_projection_job($1)", [BOOKING_ID]),
      ).rejects.toThrow();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fences a stale create projection when cancellation arrives during processing", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);

      const firstJob = await claimProjection(db);
      expect(firstJob).toMatchObject({
        bookingId: BOOKING_ID,
        desiredState: "active",
        generation: 1,
        attemptCount: 1,
      });

      await db.query(
        "UPDATE public.vendor_bookings SET status = 'cancelled' WHERE id = $1",
        [BOOKING_ID],
      );
      const whileProcessing = await db.query<{
        desired_state: string;
        generation: number;
        status: string;
      }>(
        `SELECT desired_state, generation::integer, status
         FROM public.booking_projection_jobs
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(whileProcessing.rows[0]).toEqual({
        desired_state: "cancelled",
        generation: 2,
        status: "processing",
      });

      const staleApply = await applyProjection(db, firstJob, {
        desiredState: "active",
        event: {
          id: `evt_booking_${BOOKING_ID}`,
          sourceKey: `booking:${BOOKING_ID}`,
          date: "2099-07-20",
          title: "stale active booking",
          categoryKey: "studio",
          createdAt: "2099-07-01T00:00:00.000Z",
          updatedAt: "2099-07-01T00:00:00.000Z",
        },
        categoryKey: "studio",
        amount: 500_000,
      });
      expect(staleApply.rows[0]?.result).toEqual({
        accepted: false,
        reason: "superseded",
        status: "pending",
      });
      const untouched = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(untouched.rows[0]?.progress).toMatchObject({
        __events: [{ id: "manual-event" }],
        studio: { spent: 100_000 },
      });
      expect(untouched.rows[0]?.progress).not.toHaveProperty("__booking_costs");

      const cancellationClaim = await db.query<{ job: Record<string, unknown> }>(
        "SELECT public.claim_booking_projection_job($1) AS job",
        [BOOKING_ID],
      );
      expect(cancellationClaim.rows[0]?.job).toMatchObject({
        bookingId: BOOKING_ID,
        desiredState: "cancelled",
        generation: 2,
        attemptCount: 1,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("merges and removes only the booking event under the journey row lock", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);

      const event = {
        id: `evt_booking_${BOOKING_ID}`,
        sourceKey: `booking:${BOOKING_ID}`,
        date: "2099-07-20",
        title: "10:00 Hanbang Studio 상담",
        categoryKey: "studio",
        createdAt: "2099-07-01T00:00:00.000Z",
        updatedAt: "2099-07-01T00:00:00.000Z",
      };
      const firstJob = await claimProjection(db);
      const first = await applyProjection(db, firstJob, {
        desiredState: "active",
        event,
        categoryKey: "studio",
        amount: 500_000,
      });
      expect(first.rows[0]?.result).toMatchObject({
        accepted: true,
        status: "completed",
        scheduleAdded: true,
        scheduleUpdated: false,
        budgetUpdated: true,
        categoryKey: "studio",
        newSpent: 600000,
      });

      // This simulates an unrelated schedule write after the first projection.
      // A retry receives no __events snapshot, so it must retain that write.
      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           progress,
           '{__events}',
           (progress -> '__events') || $2::jsonb
         )
         WHERE couple_id = $1`,
        [
          COUPLE_ID,
          JSON.stringify([{ id: "later-manual-event", title: "Added later" }]),
        ],
      );

      // Simulate a later repair attempt for the same desired generation.
      await db.query(
        `UPDATE public.booking_projection_jobs
         SET status = 'pending', available_at = now(), completed_at = NULL
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );

      const retryJob = await claimProjection(db);
      const retry = await applyProjection(db, retryJob, {
        desiredState: "active",
        event: { ...event, title: "Updated title" },
        categoryKey: "studio",
        amount: 500_000,
      });
      expect(retry.rows[0]?.result).toMatchObject({
        scheduleAdded: false,
        scheduleUpdated: true,
        budgetUpdated: false,
      });

      const afterRetry = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(afterRetry.rows[0]?.progress).toMatchObject({
        studio: { budget: 1_000_000, spent: 600_000 },
        __booking_costs: {
          [BOOKING_ID]: { amount: 500_000, categoryKey: "studio" },
        },
      });
      expect((afterRetry.rows[0]?.progress.__events as Array<{ id: string }>).map(({ id }) => id))
        .toEqual(["manual-event", "later-manual-event", `evt_booking_${BOOKING_ID}`]);

      await db.query(
        "UPDATE public.vendor_bookings SET status = 'cancelled' WHERE id = $1",
        [BOOKING_ID],
      );
      const cancelJob = await claimProjection(db);
      const cancelled = await applyProjection(db, cancelJob, {
        desiredState: "cancelled",
        event: null,
        categoryKey: "studio",
        amount: 500_000,
      });
      expect(cancelled.rows[0]?.result).toMatchObject({
        scheduleRemoved: true,
        budgetReverted: true,
        revertedAmount: 500000,
        newSpent: 100000,
      });

      const afterCancel = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(afterCancel.rows[0]?.progress).toMatchObject({
        studio: { budget: 1_000_000, spent: 100_000 },
        __booking_costs: {},
      });
      expect((afterCancel.rows[0]?.progress.__events as Array<{ id: string }>).map(({ id }) => id))
        .toEqual(["manual-event", "later-manual-event"]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("durably reprojects a completed booking from the canonical actual amount", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);

      const event = {
        id: `evt_booking_${BOOKING_ID}`,
        sourceKey: `booking:${BOOKING_ID}`,
        date: "2099-07-20",
        title: "10:00 Hanbang Studio 상담",
        categoryKey: "studio",
        createdAt: "2099-07-01T00:00:00.000Z",
        updatedAt: "2099-07-01T00:00:00.000Z",
      };
      const createJob = await claimProjection(db);
      await applyProjection(db, createJob, {
        desiredState: "active",
        event,
        categoryKey: "studio",
        amount: 500_000,
      });

      // Simulate another booking projection committing after the outcome
      // handler's old read point. The actual-amount projection must merge from
      // the locked DB row and preserve this unrelated ledger entry.
      const otherBookingId = "30000000-0000-4000-8000-000000000002";
      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           jsonb_set(
             progress,
             ARRAY['__booking_costs', $2],
             '{"amount":200000,"categoryKey":"dress"}'::jsonb,
             true
           ),
           '{dress}',
           '{"budget":500000,"spent":200000}'::jsonb,
           true
         )
         WHERE couple_id = $1`,
        [COUPLE_ID, otherBookingId],
      );

      // The booking mutation and generation bump must be one transaction. A
      // crash before the HTTP handler's immediate worker call still leaves the
      // actual amount as durable pending work.
      await db.query(
        `UPDATE public.vendor_bookings
         SET status = 'completed', actual_amount = 650000
         WHERE id = $1`,
        [BOOKING_ID],
      );
      const queued = await db.query<{
        desired_state: string;
        generation: number;
        status: string;
      }>(
        `SELECT desired_state, generation::integer, status
         FROM public.booking_projection_jobs
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(queued.rows[0]).toEqual({
        desired_state: "active",
        generation: 2,
        status: "pending",
      });

      const outcomeJob = await claimProjection(db);
      expect(outcomeJob).toMatchObject({
        desiredState: "active",
        generation: 2,
        booking: { amount: 650000, status: "completed" },
      });
      const applied = await applyProjection(db, outcomeJob, {
        desiredState: "active",
        event: { ...event, updatedAt: "2099-07-02T00:00:00.000Z" },
        categoryKey: "studio",
        amount: 650_000,
      });
      expect(applied.rows[0]?.result).toMatchObject({
        accepted: true,
        status: "completed",
        budgetDelta: 150000,
        newSpent: 750000,
      });

      const journey = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(journey.rows[0]?.progress).toMatchObject({
        studio: { spent: 750000 },
        __booking_costs: {
          [BOOKING_ID]: { amount: 650000, categoryKey: "studio" },
          [otherBookingId]: { amount: 200000, categoryKey: "dress" },
        },
        dress: { spent: 200000 },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("adopts the quoted amount as a legacy projection's prior contribution before applying a lower actual amount", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);

      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = '{
           "__events": [{
             "id": "evt_booking_${BOOKING_ID.slice(0, 8)}",
             "sourceKey": "booking:${BOOKING_ID}",
             "date": "2099-07-20",
             "title": "Legacy quoted booking",
             "categoryKey": "studio",
             "createdAt": "2099-07-01T00:00:00.000Z",
             "updatedAt": "2099-07-01T00:00:00.000Z"
           }],
           "studio": {"budget": 1000000, "spent": 600000}
         }'::jsonb
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      await db.query(
        `UPDATE public.vendor_bookings
         SET status = 'completed', actual_amount = 300000
         WHERE id = $1`,
        [BOOKING_ID],
      );

      const outcomeJob = await claimProjection(db);
      const applied = await applyProjection(db, outcomeJob, {
        desiredState: "active",
        event: {
          id: `evt_booking_${BOOKING_ID}`,
          sourceKey: `booking:${BOOKING_ID}`,
          date: "2099-07-20",
          title: "Completed legacy booking",
          categoryKey: "studio",
          createdAt: "2099-07-01T00:00:00.000Z",
          updatedAt: "2099-07-02T00:00:00.000Z",
        },
        categoryKey: "studio",
        amount: 300_000,
      });
      expect(applied.rows[0]?.result).toMatchObject({
        accepted: true,
        budgetDelta: -200_000,
        newSpent: 400_000,
      });

      const stored = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(stored.rows[0]?.progress).toMatchObject({
        studio: { budget: 1_000_000, spent: 400_000 },
        __booking_costs: {
          [BOOKING_ID]: { amount: 300_000, categoryKey: "studio" },
        },
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("applies a higher legacy actual amount once, then retries and cancellation without ghost spend", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);

      const legacyEvent = {
        id: `evt_booking_${BOOKING_ID.slice(0, 8)}`,
        sourceKey: `booking:${BOOKING_ID}`,
        date: "2099-07-20",
        title: "Legacy quoted booking",
        categoryKey: "studio",
        createdAt: "2099-07-01T00:00:00.000Z",
        updatedAt: "2099-07-01T00:00:00.000Z",
      };
      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_build_object(
           '__events', jsonb_build_array($2::jsonb),
           'studio', '{"budget":1000000,"spent":600000}'::jsonb
         )
         WHERE couple_id = $1`,
        [COUPLE_ID, JSON.stringify(legacyEvent)],
      );
      await db.query(
        `UPDATE public.vendor_bookings
         SET status = 'completed', actual_amount = 650000
         WHERE id = $1`,
        [BOOKING_ID],
      );

      const currentEvent = {
        ...legacyEvent,
        id: `evt_booking_${BOOKING_ID}`,
        title: "Completed legacy booking",
        updatedAt: "2099-07-02T00:00:00.000Z",
      };
      const outcomeJob = await claimProjection(db);
      const applied = await applyProjection(db, outcomeJob, {
        desiredState: "active",
        event: currentEvent,
        categoryKey: "studio",
        amount: 650_000,
      });
      expect(applied.rows[0]?.result).toMatchObject({
        budgetDelta: 150_000,
        newSpent: 750_000,
      });

      await db.query(
        `UPDATE public.booking_projection_jobs
         SET status = 'pending', available_at = now(), completed_at = NULL
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      const retryJob = await claimProjection(db);
      const retried = await applyProjection(db, retryJob, {
        desiredState: "active",
        event: currentEvent,
        categoryKey: "studio",
        amount: 650_000,
      });
      expect(retried.rows[0]?.result).toMatchObject({
        budgetDelta: 0,
        budgetUpdated: false,
        newSpent: null,
      });

      await db.query(
        "UPDATE public.vendor_bookings SET status = 'cancelled' WHERE id = $1",
        [BOOKING_ID],
      );
      const cancelJob = await claimProjection(db);
      const cancelled = await applyProjection(db, cancelJob, {
        desiredState: "cancelled",
        event: null,
        categoryKey: "studio",
        amount: 650_000,
      });
      expect(cancelled.rows[0]?.result).toMatchObject({
        budgetReverted: true,
        revertedAmount: 650_000,
        newSpent: 100_000,
      });

      const stored = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(stored.rows[0]?.progress).toMatchObject({
        studio: { budget: 1_000_000, spent: 100_000 },
        __booking_costs: {},
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("surfaces retry exhaustion and supports an explicit service-only replay boundary", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);
      const claimed = await db.query<{ job: Record<string, unknown> }>(
        "SELECT public.claim_booking_projection_job($1) AS job",
        [BOOKING_ID],
      );
      const job = claimed.rows[0]?.job;
      const failed = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.finish_booking_projection_job(
           $1, $2, $3, false, 'PROJECTION_APPLY_FAILED', 1
         ) AS result`,
        [BOOKING_ID, job?.generation, job?.claimToken],
      );
      expect(failed.rows[0]?.result).toEqual({
        accepted: true,
        status: "failed",
        retryable: false,
        attemptCount: 1,
      });

      const stats = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.get_booking_projection_queue_stats() AS result",
      );
      expect(stats.rows[0]?.result).toMatchObject({
        pending: 0,
        processing: 0,
        failed: 1,
      });

      const replayed = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.retry_booking_projection_job($1) AS result",
        [BOOKING_ID],
      );
      expect(replayed.rows[0]?.result).toEqual({
        replayed: true,
        status: "pending",
      });

      await resetPersona(db);
      await setPersona(db, "authenticated");
      await expect(
        db.query("SELECT public.retry_booking_projection_job($1)", [BOOKING_ID]),
      ).rejects.toThrow();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not subtract a booking that was never charged because its category was unknown", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);
      const event = {
        id: `evt_booking_${BOOKING_ID}`,
        sourceKey: `booking:${BOOKING_ID}`,
        date: "2099-07-20",
        title: "10:00 Uncategorized consultation",
        createdAt: "2099-07-01T00:00:00.000Z",
        updatedAt: "2099-07-01T00:00:00.000Z",
      };
      const activeJob = await claimProjection(db);
      await applyProjection(db, activeJob, {
        desiredState: "active",
        event,
        categoryKey: null,
        amount: 500_000,
      });

      await db.query(
        "UPDATE public.vendor_bookings SET status = 'cancelled' WHERE id = $1",
        [BOOKING_ID],
      );
      const cancelJob = await claimProjection(db);
      const cancelled = await applyProjection(db, cancelJob, {
        desiredState: "cancelled",
        event: null,
        categoryKey: "studio",
        amount: 500_000,
      });
      expect(cancelled.rows[0]?.result).toMatchObject({
        scheduleRemoved: true,
        budgetReverted: false,
        revertedAmount: 0,
        newSpent: null,
      });

      const stored = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(stored.rows[0]?.progress).toMatchObject({
        studio: { budget: 1_000_000, spent: 100_000 },
        __booking_costs: {},
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("uses the structured cost ledger to move spent when the booking event is missing", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await insertBooking(db);
      const studioEvent = {
        id: `evt_booking_${BOOKING_ID}`,
        sourceKey: `booking:${BOOKING_ID}`,
        date: "2099-07-20",
        title: "10:00 Hanbang Studio",
        categoryKey: "studio",
        createdAt: "2099-07-01T00:00:00.000Z",
        updatedAt: "2099-07-01T00:00:00.000Z",
      };
      const firstJob = await claimProjection(db);
      await applyProjection(db, firstJob, {
        desiredState: "active",
        event: studioEvent,
        categoryKey: "studio",
        amount: 500_000,
      });

      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           jsonb_set(progress, '{__events}', '[{"id":"manual-event"}]'::jsonb),
           '{dress}',
           '{"budget":1000000,"spent":50000}'::jsonb
         )
         WHERE couple_id = $1`,
        [COUPLE_ID],
      );
      await db.query(
        `UPDATE public.booking_projection_jobs
         SET status = 'pending', available_at = now(), completed_at = NULL
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );

      const repairJob = await claimProjection(db);
      const repaired = await applyProjection(db, repairJob, {
        desiredState: "active",
        event: { ...studioEvent, title: "10:00 New Dress Vendor", categoryKey: "dress" },
        categoryKey: "dress",
        amount: 500_000,
      });
      expect(repaired.rows[0]?.result).toMatchObject({
        accepted: true,
        status: "completed",
        scheduleAdded: true,
        budgetUpdated: true,
        categoryKey: "dress",
        newSpent: 550_000,
      });

      const stored = await db.query<{ progress: Record<string, unknown> }>(
        "SELECT progress FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(stored.rows[0]?.progress).toMatchObject({
        studio: { budget: 1_000_000, spent: 100_000 },
        dress: { budget: 1_000_000, spent: 550_000 },
        __booking_costs: {
          [BOOKING_ID]: { amount: 500_000, categoryKey: "dress" },
        },
      });
      expect((stored.rows[0]?.progress.__events as Array<{ id: string }>).map(({ id }) => id))
        .toEqual(["manual-event", `evt_booking_${BOOKING_ID}`]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
