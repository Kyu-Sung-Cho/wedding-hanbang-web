import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildKstDateWindow: vi.fn(),
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  loadPublicBookingAvailability: vi.fn(),
  rateLimitKey: vi.fn(() => "public-booking-availability:test-ip"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

vi.mock("@/lib/vendors/bookingAvailability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendors/bookingAvailability")>();
  return {
    ...actual,
    buildKstDateWindow: mocks.buildKstDateWindow,
    loadPublicBookingAvailability: mocks.loadPublicBookingAvailability,
  };
});

import { GET } from "./route";

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";

function resolvedQuery(rows: unknown[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    then: result.then.bind(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

describe("GET /api/vendors/:id/staff public availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.buildKstDateWindow.mockReturnValue([{ date: "2099-01-05", day: 0 }]);
    mocks.loadPublicBookingAvailability.mockResolvedValue([{
      date: "2099-01-05",
      time: "10:00",
      productId: null,
      staffId: STAFF_ID,
      bookedCount: 2,
    }]);
  });

  it("returns 429 before service-role access when the shared IP bucket is exhausted", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response("limited", { status: 429 }),
    );
    const request = new Request(
      `https://hanbang.ai/api/vendors/${VENDOR_ID}/staff`,
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: VENDOR_ID }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.rateLimitKey).toHaveBeenCalledWith(
      "public-booking-availability",
      request,
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "public-booking-availability:test-ip",
      { maxRequests: 30, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.loadPublicBookingAvailability).not.toHaveBeenCalled();
  });

  it("returns a boolean availability state without capacity or exact occupancy", async () => {
    const vendor = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: { id: VENDOR_ID }, error: null }),
    };
    vendor.select.mockReturnValue(vendor);
    vendor.eq.mockReturnValue(vendor);

    const staff = resolvedQuery([{
      id: STAFF_ID,
      name: "담당자",
      role: "촬영",
      description: null,
    }]);
    const timeslots = resolvedQuery([{
      staff_id: STAFF_ID,
      day: 0,
      hour: 10,
      max_bookings: 2,
    }]);
    const from = vi.fn((table: string) => {
      if (table === "vendors") return vendor;
      if (table === "vendor_staff") return staff;
      if (table === "staff_timeslots") return timeslots;
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.createAdminClient.mockReturnValue({ from });

    const response = await GET(new Request(`https://hanbang.ai/api/vendors/${VENDOR_ID}/staff`), {
      params: Promise.resolve({ id: VENDOR_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(body.staff[0].timeSlots).toEqual([
      { day: 0, hour: 10, available: false },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/maxBookings|max_bookings|currentBookings|bookedCount/);
  });

  it("rejects a malformed vendor id before service-role access", async () => {
    const response = await GET(new Request("https://hanbang.ai/api/vendors/not-a-uuid/staff"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
