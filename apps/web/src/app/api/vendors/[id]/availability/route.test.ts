import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  rateLimitKey: vi.fn(() => "public-booking-availability:test-ip"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";

function fakeAdmin(options: {
  bookingError?: boolean;
  approved?: boolean;
  scheduleError?: boolean;
} = {}) {
  const calls: Array<{ table: string; select: string }> = [];
  const bookingRows = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      booking_date: "2099-07-20",
      booking_time: "10:00:00",
      product_id: "22222222-2222-4222-8222-222222222222",
      staff_id: null,
      couple_id: "private-couple-a",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      booking_date: "2099-07-20",
      booking_time: "10:00:00",
      product_id: "22222222-2222-4222-8222-222222222222",
      staff_id: null,
      couple_id: "private-couple-b",
    },
  ];
  return {
    calls,
    client: {
      from(table: string) {
        if (table === "vendors") {
          const query = {
            select(columns: string) {
              calls.push({ table, select: columns });
              return query;
            },
            eq() {
              return query;
            },
            maybeSingle: vi.fn().mockResolvedValue({
              data: options.approved === false ? null : { id: VENDOR_ID },
              error: null,
            }),
          };
          return query;
        }
        if (table === "vendor_bookings") {
          const query = {
            select(columns: string) {
              calls.push({ table, select: columns });
              return query;
            },
            eq() {
              return query;
            },
            gte() {
              return query;
            },
            lte() {
              return query;
            },
            or() {
              return query;
            },
            order() {
              return query;
            },
            range(from: number, to: number) {
              return Promise.resolve(options.bookingError
                ? { data: null, error: { message: "database unavailable" } }
                : { data: bookingRows.slice(from, to + 1), error: null });
            },
          };
          return query;
        }
        if (table === "vendor_timeslots") {
          const query = {
            select(columns: string) {
              calls.push({ table, select: columns });
              return query;
            },
            eq() {
              return Promise.resolve(options.scheduleError
                ? { data: null, error: { message: "schedule unavailable" } }
                : {
                    data: [
                      { day: 0, hour: 10, available: true, max_bookings: 2 },
                      { day: 0, hour: 11, available: true, max_bookings: 1 },
                    ],
                    error: null,
                  });
            },
          };
          return query;
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
  };
}

describe("GET /api/vendors/:id/availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns 429 before creating a service-role client when the shared IP bucket is exhausted", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response("limited", { status: 429 }),
    );
    const request = new Request(
      `http://localhost/api/vendors/${VENDOR_ID}/availability?from=2099-07-20&to=2099-07-20`,
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
  });

  it("returns only derived availability without capacity, occupancy, or resource identifiers", async () => {
    const admin = fakeAdmin();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await GET(
      new Request(
        `http://localhost/api/vendors/${VENDOR_ID}/availability?from=2099-07-20&to=2099-07-20`,
      ),
      { params: Promise.resolve({ id: VENDOR_ID }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      from: "2099-07-20",
      to: "2099-07-20",
      timezone: "Asia/Seoul",
      slots: [
        { date: "2099-07-20", time: "10:00", available: false },
        { date: "2099-07-20", time: "11:00", available: true },
      ],
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(admin.calls).toContainEqual({ table: "vendors", select: "id" });
    expect(admin.calls).toContainEqual({
      table: "vendor_bookings",
      select: "id,booking_date,booking_time,product_id,staff_id",
    });
    expect(admin.calls).toContainEqual({
      table: "vendor_timeslots",
      select: "day,hour,available,max_bookings",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-couple|aaaaaaaa-aaaa|bbbbbbbb-bbbb|bookedCount|staffId|productId|max_bookings/,
    );
  });

  it("fails closed with 503 instead of reporting zero occupancy when aggregation fails", async () => {
    const admin = fakeAdmin({ bookingError: true });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await GET(
      new Request(
        `http://localhost/api/vendors/${VENDOR_ID}/availability?from=2099-07-20&to=2099-07-20`,
      ),
      { params: Promise.resolve({ id: VENDOR_ID }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "예약 가능 시간을 확인할 수 없습니다.",
      code: "BOOKING_AVAILABILITY_UNAVAILABLE",
    });
  });

  it("does not reveal occupancy for an unapproved vendor", async () => {
    const admin = fakeAdmin({ approved: false });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await GET(
      new Request(
        `http://localhost/api/vendors/${VENDOR_ID}/availability?from=2099-07-20&to=2099-07-20`,
      ),
      { params: Promise.resolve({ id: VENDOR_ID }) },
    );

    expect(response.status).toBe(404);
    expect(admin.calls.some(({ table }) => table === "vendor_bookings")).toBe(false);
    expect(admin.calls.some(({ table }) => table === "vendor_timeslots")).toBe(false);
  });

  it("fails closed instead of advertising slots when the internal schedule cannot be loaded", async () => {
    const admin = fakeAdmin({ scheduleError: true });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await GET(
      new Request(
        `http://localhost/api/vendors/${VENDOR_ID}/availability?from=2099-07-20&to=2099-07-20`,
      ),
      { params: Promise.resolve({ id: VENDOR_ID }) },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });
});
