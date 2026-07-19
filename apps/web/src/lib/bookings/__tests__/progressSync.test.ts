import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  buildBookingCancelledProgressPatch,
  buildBookingCreatedProgressPatch,
  buildBookingOutcomeProgressPatch,
  syncBookingProgressAfterCancel,
  syncBookingProgressAfterCreate,
} from "../progressSync";

const booking = {
  id: "11111111-2222-4333-8444-555555555555",
  date: "2026-10-03",
  time: "12:00",
  amount: 1_500_000,
};

const vendor = {
  id: "vendor_1",
  name: "B드레스",
  category: "dress",
};
const projectionClaim = {
  generation: 1,
  claimToken: "40000000-0000-4000-8000-000000000001",
};

describe("booking progress sync", () => {
  it("예약 생성 동기화 RPC가 실패하면 오래된 전체 progress로 덮어쓰지 않는다", async () => {
    const journeyQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { progress: { dress: { status: "in_progress", spent: 200_000 } } },
        error: null,
      }),
    };
    journeyQuery.select.mockReturnValue(journeyQuery);
    journeyQuery.eq.mockReturnValue(journeyQuery);
    const vendorQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: vendor, error: null }),
    };
    vendorQuery.select.mockReturnValue(vendorQuery);
    vendorQuery.eq.mockReturnValue(vendorQuery);
    const fallbackUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const from = vi.fn((table: string) => {
      if (table === "vendors") return vendorQuery;
      if (from.mock.calls.filter(([name]) => name === "wedding_journeys").length === 1) {
        return journeyQuery;
      }
      return { update: fallbackUpdate };
    });
    const client = {
      from,
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "XX000", message: "atomic patch failed" },
      }),
    } as unknown as SupabaseClient;

    const result = await syncBookingProgressAfterCreate(client, {
      coupleId: "00000000-0000-4000-8000-000000000001",
      booking,
      vendorId: vendor.id,
      projectionClaim,
    });

    expect(result).toMatchObject({ persisted: false, error: "atomic patch failed" });
    expect(client.rpc).toHaveBeenCalledWith(
      "apply_booking_progress_projection",
      expect.objectContaining({
        p_booking_id: booking.id,
        p_desired_state: "active",
        p_generation: projectionClaim.generation,
        p_claim_token: projectionClaim.claimToken,
      }),
    );
    expect(fallbackUpdate).not.toHaveBeenCalled();
  });

  it("예약 취소 동기화 RPC가 실패하면 오래된 전체 progress로 덮어쓰지 않는다", async () => {
    const journeyQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: {
          progress: {
            __events: [{
              id: `evt_booking_${booking.id}`,
              sourceKey: `booking:${booking.id}`,
              date: booking.date,
              title: "상담",
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            }],
            __booking_costs: { [booking.id]: booking.amount },
            dress: { spent: booking.amount },
          },
        },
        error: null,
      }),
    };
    journeyQuery.select.mockReturnValue(journeyQuery);
    journeyQuery.eq.mockReturnValue(journeyQuery);
    const fallbackUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const from = vi.fn(() => (
      from.mock.calls.length === 1 ? journeyQuery : { update: fallbackUpdate }
    ));
    const client = {
      from,
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "XX000", message: "atomic cancel patch failed" },
      }),
    } as unknown as SupabaseClient;

    const result = await syncBookingProgressAfterCancel(client, {
      coupleId: "00000000-0000-4000-8000-000000000001",
      booking: { id: booking.id, amount: booking.amount },
      vendor,
      projectionClaim,
    });

    expect(result).toMatchObject({
      persisted: false,
      error: "atomic cancel patch failed",
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "apply_booking_progress_projection",
      expect.objectContaining({
        p_booking_id: booking.id,
        p_desired_state: "cancelled",
        p_generation: projectionClaim.generation,
        p_claim_token: projectionClaim.claimToken,
      }),
    );
    expect(fallbackUpdate).not.toHaveBeenCalled();
  });

  it("adds a booking event and increments the matching category spent", () => {
    const result = buildBookingCreatedProgressPatch({
      progress: {
        dress: {
          status: "in_progress",
          label: "드레스",
          budget: 1_000_000,
          spent: 200_000,
        },
      },
      booking,
      vendor,
      productName: "럭셔리 수입 오리지널",
    });

    expect(result.scheduleAdded).toBe(true);
    expect(result.budgetUpdated).toBe(true);
    expect(result.syncedCategoryKey).toBe("dress");
    expect(result.syncedNewSpent).toBe(1_700_000);
    expect(result.budgetExceededBy).toBe(700_000);
    expect(result.syncedEvent.id).toBe(`evt_booking_${booking.id}`);
    expect(result.syncedEvent.sourceKey).toBe(`booking:${booking.id}`);
    expect(result.syncedEvent.title).toContain("B드레스");
    expect(result.syncedEvent.memo).toBe("예약 자동 등록 · 150만원");
    expect(result.syncedEvent.memo).not.toContain(booking.id.slice(0, 8));
    expect(result.patch).toHaveProperty("__events");
    expect(result.patch.__booking_costs).toMatchObject({
      [booking.id]: { amount: booking.amount, categoryKey: "dress" },
    });
    expect(result.patch).toHaveProperty("dress");
  });

  it("keeps a non-whole 만원 booking amount exact in the user-visible memo", () => {
    const result = buildBookingCreatedProgressPatch({
      progress: {},
      booking: { ...booking, amount: 15_000 },
      vendor,
    });

    expect(result.syncedEvent.memo).toBe("예약 자동 등록 · 15,000원");
    expect(result.syncedEvent.memo).not.toContain(booking.id.slice(0, 8));
  });

  it("updates an existing booking event without charging the budget twice", () => {
    const existingEvent = {
      id: "evt_booking_11111111",
      date: "2026-10-03",
      title: "old",
      sourceKey: `booking:${booking.id}`,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };

    const result = buildBookingCreatedProgressPatch({
      progress: {
        __events: [existingEvent],
        dress: {
          status: "in_progress",
          label: "드레스",
          budget: 2_000_000,
          spent: 1_500_000,
        },
      },
      booking: { ...booking, time: "13:00" },
      vendor,
    });

    expect(result.scheduleAdded).toBe(false);
    expect(result.scheduleUpdated).toBe(true);
    expect(result.budgetUpdated).toBe(false);
    expect(result.syncedNewSpent).toBeNull();
    expect(result.nextProgress.dress).toMatchObject({ spent: 1_500_000 });
    expect(result.syncedEvent.title).toContain("13:00");
    expect(result.syncedEvent.createdAt).toBe(existingEvent.createdAt);
  });

  it("still creates a schedule event when a vendor category is missing", () => {
    const result = buildBookingCreatedProgressPatch({
      progress: {},
      booking,
      vendor: { ...vendor, category: null },
    });

    expect(result.scheduleAdded).toBe(true);
    expect(result.budgetUpdated).toBe(false);
    expect(result.syncedCategoryKey).toBeNull();
  });

  it("adjusts category spent by only the outcome delta for synced bookings", () => {
    const result = buildBookingOutcomeProgressPatch({
      progress: {
        __events: [{
          id: `evt_booking_${booking.id}`,
          date: booking.date,
          title: "B드레스 상담",
          sourceKey: `booking:${booking.id}`,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }],
        dress: {
          label: "드레스",
          budget: 2_800_000,
          spent: 1_500_000,
        },
      },
      booking: {
        id: booking.id,
        amount: 1_500_000,
        previousActualAmount: null,
        actualAmount: 1_900_000,
      },
      vendor,
    });

    expect(result.budgetUpdated).toBe(true);
    expect(result.budgetDelta).toBe(400_000);
    expect(result.previousContribution).toBe(1_500_000);
    expect(result.syncedNewSpent).toBe(1_900_000);
    expect(result.budgetExceededBy).toBe(0);
    expect(result.patch.dress).toMatchObject({ spent: 1_900_000 });
    expect(result.patch.__booking_costs).toMatchObject({
      [booking.id]: { amount: 1_900_000, categoryKey: "dress" },
    });
  });

  it("uses stored booking cost contribution when an outcome is edited later", () => {
    const result = buildBookingOutcomeProgressPatch({
      progress: {
        __booking_costs: { [booking.id]: 1_900_000 },
        dress: {
          label: "드레스",
          budget: 2_000_000,
          spent: 1_900_000,
        },
      },
      booking: {
        id: booking.id,
        amount: 1_500_000,
        previousActualAmount: 1_900_000,
        actualAmount: 2_200_000,
      },
      vendor,
    });

    expect(result.budgetUpdated).toBe(true);
    expect(result.budgetDelta).toBe(300_000);
    expect(result.previousContribution).toBe(1_900_000);
    expect(result.syncedNewSpent).toBe(2_200_000);
    expect(result.budgetExceededBy).toBe(200_000);
    expect(result.patch.dress).toMatchObject({ spent: 2_200_000 });
  });

  it("adds the full actual amount when an older booking was never synced", () => {
    const result = buildBookingOutcomeProgressPatch({
      progress: {
        dress: {
          label: "드레스",
          budget: 2_000_000,
          spent: 0,
        },
      },
      booking: {
        id: booking.id,
        amount: 1_500_000,
        previousActualAmount: null,
        actualAmount: 1_900_000,
      },
      vendor,
    });

    expect(result.previousContribution).toBe(0);
    expect(result.budgetDelta).toBe(1_900_000);
    expect(result.syncedNewSpent).toBe(1_900_000);
  });

  it("subtracts the previous booking contribution when actual amount is zero", () => {
    const result = buildBookingOutcomeProgressPatch({
      progress: {
        __events: [{
          id: `evt_booking_${booking.id}`,
          date: booking.date,
          title: "B드레스 상담",
          sourceKey: `booking:${booking.id}`,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }],
        dress: {
          label: "드레스",
          budget: 2_000_000,
          spent: 1_500_000,
        },
      },
      booking: {
        id: booking.id,
        amount: 1_500_000,
        previousActualAmount: null,
        actualAmount: 0,
      },
      vendor,
    });

    expect(result.budgetUpdated).toBe(true);
    expect(result.previousContribution).toBe(1_500_000);
    expect(result.budgetDelta).toBe(-1_500_000);
    expect(result.syncedNewSpent).toBe(0);
    expect(result.patch.dress).toMatchObject({ spent: 0 });
    expect(result.patch.__booking_costs).toMatchObject({
      [booking.id]: { amount: 0, categoryKey: "dress" },
    });
  });

  it("removes full-id booking events and subtracts stored actual cost on cancellation", () => {
    const result = buildBookingCancelledProgressPatch({
      progress: {
        __booking_costs: { [booking.id]: 1_900_000 },
        __events: [{
          id: `evt_booking_${booking.id}`,
          date: booking.date,
          title: "B드레스 상담",
          sourceKey: `booking:${booking.id}`,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }],
        dress: {
          label: "드레스",
          budget: 2_800_000,
          spent: 1_900_000,
        },
      },
      booking: {
        id: booking.id,
        amount: 1_500_000,
      },
      vendor,
    });

    expect(result.scheduleRemoved).toBe(true);
    expect(result.budgetReverted).toBe(true);
    expect(result.revertedAmount).toBe(1_900_000);
    expect(result.syncedEventIdRemoved).toBe(`evt_booking_${booking.id}`);
    expect(result.syncedNewSpent).toBe(0);
    expect(result.patch.__events).toEqual([]);
    expect(result.patch.dress).toMatchObject({ spent: 0 });
    expect(result.patch.__booking_costs).toEqual({});
  });

  it("still removes legacy short-id booking events on cancellation", () => {
    const result = buildBookingCancelledProgressPatch({
      progress: {
        __events: [{
          id: "evt_booking_11111111",
          date: booking.date,
          title: "B드레스 상담",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }],
        dress: {
          label: "드레스",
          budget: 2_800_000,
          spent: 1_500_000,
        },
      },
      booking: {
        id: booking.id,
        amount: 1_500_000,
      },
      vendor,
    });

    expect(result.scheduleRemoved).toBe(true);
    expect(result.budgetReverted).toBe(true);
    expect(result.revertedAmount).toBe(1_500_000);
    expect(result.syncedEventIdRemoved).toBe("evt_booking_11111111");
    expect(result.syncedNewSpent).toBe(0);
  });
});
