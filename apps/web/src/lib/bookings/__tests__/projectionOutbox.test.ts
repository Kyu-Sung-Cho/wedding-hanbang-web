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
      quotedAmount: 500_000,
      actualAmount: null,
      cancellation: null,
      status: "pending",
      vendorId: VENDOR_ID,
      productId: null,
      staffId: null,
      vendorName: "Hanbang Studio",
      vendorCategory: "studio",
    },
  };
}

function cancelledClaim() {
  return {
    ...activeClaim(),
    desiredState: "cancelled",
    booking: {
      ...activeClaim().booking,
      actualAmount: 650_000,
      cancellation: {
        cancelledAt: "2026-08-02T12:30:00.000Z",
        cancelledByProfileId: "70000000-0000-4000-8000-000000000001",
        reason: "예약 취소",
      },
      status: "cancelled",
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
          p_amount: 0,
          p_generation: 1,
          p_claim_token: CLAIM_TOKEN,
        });
        expect(args.p_event).toMatchObject({
          id: `evt_booking_${BOOKING_ID}`,
          sourceKey: `booking:${BOOKING_ID}`,
          date: "2099-07-20",
          memo: "아모라 내부 방문·상담 후보 견적 · 50만원 · 결제·지출 기록 아님 · 업체 전달·확정 미확인",
        });
        expect(args).not.toHaveProperty("p_patch");
        return {
          data: {
            accepted: true,
            status: "completed",
            progress: {
              __events: [args.p_event],
              __booking_costs: {
                [BOOKING_ID]: {
                  amount: 0,
                  categoryKey: "studio",
                  basis: "none",
                  quotedAmount: 500_000,
                },
              },
              studio: { budget: 1_000_000, spent: 100_000 },
            },
            event: args.p_event,
            scheduleAdded: true,
            scheduleUpdated: false,
            scheduleCancelled: false,
            completedSchedulePreserved: false,
            terminalSchedulePreserved: false,
            needsReview: false,
            reviewReason: null,
            recordedSpendPreserved: false,
            quoteContributionCorrected: false,
            quoteCorrectionAmount: 0,
            scheduleRemoved: false,
            budgetUpdated: false,
            budgetReverted: false,
            budgetDelta: 0,
            budgetExceededBy: 0,
            categoryBudgetLimit: 1_000_000,
            categoryKey: "studio",
            newSpent: null,
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
        budgetUpdated: false,
        syncedNewSpent: null,
      },
    });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "finish_booking_projection_job",
    );
  });

  it("soft-cancels the stable schedule event while preserving explicit actual spend", async () => {
    const claim = cancelledClaim();
    const cancelledEvent = {
      id: `evt_booking_${BOOKING_ID}`,
      sourceKey: `booking:${BOOKING_ID}`,
      date: "2099-07-20",
      title: "10:00 Hanbang Studio 상담",
      status: "cancelled",
      cancellation: claim.booking.cancellation,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: claim.booking.cancellation.cancelledAt,
    };
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_booking_projection_job") {
        return { data: claim, error: null };
      }
      if (name === "apply_booking_progress_projection") {
        expect(args).toMatchObject({
          p_booking_id: BOOKING_ID,
          p_desired_state: "cancelled",
          p_event: null,
          p_amount: 650_000,
        });
        return {
          data: {
            accepted: true,
            status: "completed",
            progress: {
              __events: [cancelledEvent],
              __booking_costs: {
                [BOOKING_ID]: {
                  amount: 650_000,
                  categoryKey: "studio",
                  basis: "actual",
                  quotedAmount: 500_000,
                },
              },
              studio: { budget: 1_000_000, spent: 750_000 },
            },
            event: cancelledEvent,
            scheduleAdded: false,
            scheduleUpdated: false,
            scheduleCancelled: true,
            recordedSpendPreserved: true,
            quoteContributionCorrected: false,
            quoteCorrectionAmount: 0,
            scheduleRemoved: false,
            budgetUpdated: false,
            budgetReverted: false,
            budgetDelta: 0,
            budgetExceededBy: 0,
            categoryBudgetLimit: 1_000_000,
            categoryKey: "studio",
            newSpent: null,
            revertedAmount: 0,
            removedEventId: null,
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const client = {
      rpc,
      from: vi.fn(() => createQuery({ data: null, error: null })),
    } as unknown as SupabaseClient;

    const result = await processBookingProjectionJob(client, { bookingId: BOOKING_ID });

    expect(result).toMatchObject({
      status: "completed",
      sync: {
        persisted: true,
        scheduleCancelled: true,
        recordedSpendPreserved: true,
        quoteContributionCorrected: false,
        quoteCorrectionAmount: 0,
        scheduleRemoved: false,
        budgetReverted: false,
        syncedEventId: `evt_booking_${BOOKING_ID}`,
      },
    });
  });

  it("uses only an explicit actual amount as the active spend contribution", async () => {
    const claim = {
      ...activeClaim(),
      booking: { ...activeClaim().booking, actualAmount: 650_000 },
    };
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_booking_projection_job") {
        return { data: claim, error: null };
      }
      if (name === "apply_booking_progress_projection") {
        expect(args).toMatchObject({
          p_booking_id: BOOKING_ID,
          p_desired_state: "active",
          p_amount: 650_000,
        });
        return {
          data: {
            accepted: true,
            status: "completed",
            progress: {
              __events: [args.p_event],
              __booking_costs: {
                [BOOKING_ID]: {
                  amount: 650_000,
                  categoryKey: "studio",
                  basis: "actual",
                  quotedAmount: 500_000,
                },
              },
              studio: { budget: 1_000_000, spent: 750_000 },
            },
            event: args.p_event,
            scheduleAdded: false,
            scheduleUpdated: true,
            scheduleCancelled: false,
            recordedSpendPreserved: false,
            quoteContributionCorrected: false,
            quoteCorrectionAmount: 0,
            scheduleRemoved: false,
            budgetUpdated: true,
            budgetReverted: false,
            budgetDelta: 650_000,
            budgetExceededBy: 0,
            categoryBudgetLimit: 1_000_000,
            categoryKey: "studio",
            newSpent: 750_000,
            revertedAmount: 0,
            removedEventId: null,
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
      status: "completed",
      sync: {
        persisted: true,
        budgetUpdated: true,
        syncedCategoryKey: "studio",
        syncedNewSpent: 750_000,
      },
    });
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
