import { describe, expect, it } from "vitest";
import {
  buildBookingCreatedProgressPatch,
  buildBookingOutcomeProgressPatch,
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

describe("booking progress sync", () => {
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
    expect(result.patch).toHaveProperty("__events");
    expect(result.patch).toHaveProperty("dress");
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
    expect(result.patch.__booking_costs).toMatchObject({ [booking.id]: 1_900_000 });
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
    expect(result.patch.__booking_costs).toMatchObject({ [booking.id]: 0 });
  });
});
