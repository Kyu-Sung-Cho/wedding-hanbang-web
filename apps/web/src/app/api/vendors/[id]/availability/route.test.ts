import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";

function fakeAdmin(options: { bookingError?: boolean; approved?: boolean } = {}) {
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
        throw new Error(`unexpected table: ${table}`);
      },
    },
  };
}

describe("GET /api/vendors/:id/availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("uses the service boundary to count all customers without returning raw identifiers", async () => {
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
      counts: [{
        date: "2099-07-20",
        time: "10:00",
        productId: "22222222-2222-4222-8222-222222222222",
        staffId: null,
        bookedCount: 2,
      }],
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(admin.calls).toContainEqual({ table: "vendors", select: "id" });
    expect(admin.calls).toContainEqual({
      table: "vendor_bookings",
      select: "id,booking_date,booking_time,product_id,staff_id",
    });
    expect(JSON.stringify(payload)).not.toMatch(/private-couple|aaaaaaaa-aaaa|bbbbbbbb-bbbb/);
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
  });
});
