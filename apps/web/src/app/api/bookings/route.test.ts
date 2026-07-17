// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { processBookingProjectionJob } from "@/lib/bookings/projectionOutbox";
import { POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "booking:test"),
}));
vi.mock("@/lib/memory/record-decision", () => ({ recordDecision: vi.fn() }));
vi.mock("@/lib/bookings/progressSync", () => ({
  syncBookingProgressAfterCreate: vi.fn().mockResolvedValue({
    persisted: false,
    scheduleAdded: false,
    scheduleUpdated: false,
    budgetUpdated: false,
    budgetExceededBy: 0,
    syncedCategoryKey: null,
    error: "projection failed",
  }),
}));
vi.mock("@/lib/bookings/projectionOutbox", () => ({
  processBookingProjectionJob: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const BOOKING_ID = "30000000-0000-4000-8000-000000000001";

function query(result: { data: unknown; error: unknown }) {
  const value = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  return value;
}

describe("POST /api/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 202 and an explicit retry boundary when booking projection is queued", async () => {
    const booking = {
      id: BOOKING_ID,
      vendor_id: VENDOR_ID,
      couple_id: COUPLE_ID,
      booking_date: "2099-07-20",
      booking_time: "10:00",
      amount: 500_000,
      status: "pending",
    };
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return query({ data: { couple_id: COUPLE_ID }, error: null });
        }
        if (table === "vendor_bookings") {
          return query({ data: booking, error: null });
        }
        if (table === "vendors") {
          return query({ data: { name: "Hanbang Studio", category: "studio" }, error: null });
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: BOOKING_ID, error: null }),
      from: vi.fn((table: string) => {
        throw new Error(`unexpected admin table ${table}`);
      }),
    } as never);
    vi.mocked(processBookingProjectionJob).mockResolvedValue({
      bookingId: BOOKING_ID,
      desiredState: "active",
      status: "pending_retry",
      retryable: true,
      attemptCount: 1,
      retryAfterSeconds: 5,
      errorCode: "PROJECTION_APPLY_FAILED",
      sync: {
        persisted: false,
        error: "atomic projection failed",
        nextProgress: {},
        scheduleAdded: false,
        scheduleUpdated: false,
        budgetUpdated: false,
        budgetExceededBy: 0,
        categoryBudgetLimit: 0,
        categoryLabel: "studio",
        syncedEvent: {
          id: `evt_booking_${BOOKING_ID}`,
          date: "2099-07-20",
          title: "10:00 Hanbang Studio",
          createdAt: "2099-07-01T00:00:00.000Z",
          updatedAt: "2099-07-01T00:00:00.000Z",
        },
        syncedCategoryKey: null,
        syncedNewSpent: null,
      },
    });

    const response = await POST(new Request("https://example.test/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vendorId: VENDOR_ID,
        date: "2099-07-20",
        time: "10:00",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({
      bookingAccepted: true,
      fullyApplied: false,
      booking: { id: BOOKING_ID },
      projection: {
        status: "pending_retry",
        retryable: true,
        attemptCount: 1,
        retryAfterSeconds: 5,
        errorCode: "PROJECTION_APPLY_FAILED",
      },
    });
    expect(payload.message).toContain("예약을 다시 만들 필요는 없습니다");
    expect(processBookingProjectionJob).toHaveBeenCalledWith(
      expect.anything(),
      { bookingId: BOOKING_ID },
    );
  });
});
