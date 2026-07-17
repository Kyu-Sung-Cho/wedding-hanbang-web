import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { processBookingProjectionJob } from "../projectionOutbox";

const BOOKING_ID = "30000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "40000000-0000-4000-8000-000000000001";

function createQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function activeClaim() {
  return {
    bookingId: BOOKING_ID,
    coupleId: COUPLE_ID,
    desiredState: "active",
    generation: 1,
    attemptCount: 1,
    claimToken: CLAIM_TOKEN,
    booking: {
      date: "2099-07-20",
      time: "10:00",
      amount: 500_000,
      status: "pending",
      vendorId: VENDOR_ID,
      productId: null,
      staffId: null,
      vendorName: "Hanbang Studio",
      vendorCategory: "studio",
    },
  };
}

describe("booking projection outbox processor", () => {
  it("claims, atomically projects, and acknowledges a create job", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_booking_projection_job") {
        return { data: activeClaim(), error: null };
      }
      if (name === "apply_booking_progress_projection") {
        expect(args).toMatchObject({
          p_couple_id: COUPLE_ID,
          p_booking_id: BOOKING_ID,
          p_desired_state: "active",
          p_category_key: "studio",
          p_amount: 500_000,
          p_generation: 1,
          p_claim_token: CLAIM_TOKEN,
        });
        expect(args.p_event).toMatchObject({
          id: `evt_booking_${BOOKING_ID}`,
          sourceKey: `booking:${BOOKING_ID}`,
          date: "2099-07-20",
        });
        expect(args).not.toHaveProperty("p_patch");
        return {
          data: {
            accepted: true,
            status: "completed",
            progress: {
              __events: [args.p_event],
              __booking_costs: { [BOOKING_ID]: 500_000 },
              studio: { budget: 1_000_000, spent: 600_000 },
            },
            event: args.p_event,
            scheduleAdded: true,
            scheduleUpdated: false,
            scheduleRemoved: false,
            budgetUpdated: true,
            budgetReverted: false,
            budgetDelta: 500_000,
            budgetExceededBy: 0,
            categoryBudgetLimit: 1_000_000,
            categoryKey: "studio",
            newSpent: 600_000,
            revertedAmount: 0,
            removedEventId: null,
          },
          error: null,
        };
      }
      if (name === "finish_booking_projection_job") {
        throw new Error("successful apply must acknowledge atomically");
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const client = {
      rpc,
      from: vi.fn((table: string) => {
        expect(table).toBe("vendors");
        return createQuery({
          data: { id: VENDOR_ID, name: "Hanbang Studio", category: "studio" },
          error: null,
        });
      }),
    } as unknown as SupabaseClient;

    const result = await processBookingProjectionJob(client, { bookingId: BOOKING_ID });

    expect(result).toMatchObject({
      bookingId: BOOKING_ID,
      desiredState: "active",
      status: "completed",
      retryable: false,
      attemptCount: 1,
      sync: {
        persisted: true,
        scheduleAdded: true,
        budgetUpdated: true,
        syncedNewSpent: 600_000,
      },
    });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "finish_booking_projection_job",
    );
  });

  it("marks projection failure pending instead of reporting full success", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_booking_projection_job") {
        return { data: activeClaim(), error: null };
      }
      if (name === "apply_booking_progress_projection") {
        return { data: null, error: { message: "atomic projection failed" } };
      }
      if (name === "finish_booking_projection_job") {
        expect(args).toMatchObject({
          p_succeeded: false,
          p_error_code: "PROJECTION_APPLY_FAILED",
        });
        return {
          data: {
            accepted: true,
            status: "pending",
            retryable: true,
            attemptCount: 1,
            retryAfterSeconds: 5,
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const client = {
      rpc,
      from: vi.fn(() => createQuery({
        data: { id: VENDOR_ID, name: "Hanbang Studio", category: "studio" },
        error: null,
      })),
    } as unknown as SupabaseClient;

    const result = await processBookingProjectionJob(client, { bookingId: BOOKING_ID });

    expect(result).toMatchObject({
      bookingId: BOOKING_ID,
      status: "pending_retry",
      retryable: true,
      attemptCount: 1,
      retryAfterSeconds: 5,
      errorCode: "PROJECTION_APPLY_FAILED",
      sync: { persisted: false },
    });
  });

  it("reports a newer cancellation generation as pending retry", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_booking_projection_job") {
        return { data: activeClaim(), error: null };
      }
      if (name === "apply_booking_progress_projection") {
        return {
          data: { accepted: false, reason: "superseded", status: "pending" },
          error: null,
        };
      }
      if (name === "finish_booking_projection_job") {
        throw new Error("superseded apply already released its lease");
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const client = {
      rpc,
      from: vi.fn(() => createQuery({
        data: { id: VENDOR_ID, name: "Hanbang Studio", category: "studio" },
        error: null,
      })),
    } as unknown as SupabaseClient;

    const result = await processBookingProjectionJob(client, { bookingId: BOOKING_ID });

    expect(result).toMatchObject({
      status: "pending_retry",
      retryable: true,
      errorCode: "PROJECTION_SUPERSEDED",
    });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "finish_booking_projection_job",
    );
  });
});
