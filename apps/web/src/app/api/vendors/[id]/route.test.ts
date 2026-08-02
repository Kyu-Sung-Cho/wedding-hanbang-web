import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildKstDateWindow: vi.fn(),
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  loadPublicBookingAvailability: vi.fn(),
  rateLimitKey: vi.fn((scope: string) => `${scope}:test-ip`),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
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

function resolvedQuery(rows: unknown[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: result.then.bind(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

describe("GET /api/vendors/:id public availability boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.buildKstDateWindow.mockReturnValue([{ date: "2099-01-05", day: 0 }]);
    mocks.loadPublicBookingAvailability.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns 429 before auth or service-role access when the shared catalog bucket is exhausted", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response("limited", { status: 429 }),
    );
    const request = new Request(`https://hanbang.ai/api/vendors/${VENDOR_ID}`);

    const response = await GET(request, {
      params: Promise.resolve({ id: VENDOR_ID }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(mocks.rateLimitKey).toHaveBeenCalledWith(
      "public-vendor-catalog",
      request,
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "public-vendor-catalog:test-ip",
      { maxRequests: 120, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("returns 503 before auth or service-role access when the durable catalog limiter is unavailable", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );
    const request = new Request(`https://hanbang.ai/api/vendors/${VENDOR_ID}`);

    const response = await GET(request, {
      params: Promise.resolve({ id: VENDOR_ID }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("retains the stricter shared occupancy bucket after the catalog bucket", async () => {
    mocks.checkRateLimitPersistent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response("limited", { status: 429 }));
    const request = new Request(`https://hanbang.ai/api/vendors/${VENDOR_ID}`);

    const response = await GET(request, {
      params: Promise.resolve({ id: VENDOR_ID }),
    });

    expect(response.status).toBe(429);
    expect(mocks.rateLimitKey).toHaveBeenNthCalledWith(
      1,
      "public-vendor-catalog",
      request,
    );
    expect(mocks.rateLimitKey).toHaveBeenNthCalledWith(
      2,
      "public-booking-availability",
      request,
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("preserves the normal public detail response when the limiter allows the request", async () => {
    const vendor = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: VENDOR_ID,
          name: "테스트 업체",
          category: "studio",
          status: "approved",
          is_verified: true,
        },
        error: null,
      }),
    };
    vendor.select.mockReturnValue(vendor);
    vendor.eq.mockReturnValue(vendor);

    const timeslots = resolvedQuery([]);
    const products = resolvedQuery([]);
    const reviews = resolvedQuery([]);
    const from = vi.fn((table: string) => {
      if (table === "vendors") return vendor;
      if (table === "vendor_timeslots") return timeslots;
      if (table === "vendor_products") return products;
      if (table === "vendor_reviews") return reviews;
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.createAdminClient.mockReturnValue({ from });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    const request = new Request(`https://hanbang.ai/api/vendors/${VENDOR_ID}`);

    const response = await GET(request, {
      params: Promise.resolve({ id: VENDOR_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(body.vendor).toMatchObject({
      id: VENDOR_ID,
      name: "테스트 업체",
      timeSlots: [],
      products: [],
      isVerified: true,
    });
    expect(body.reviews).toEqual([]);
    expect(body.isFavorite).toBe(false);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(2);
    expect(mocks.checkRateLimitPersistent).toHaveBeenNthCalledWith(
      1,
      "public-vendor-catalog:test-ip",
      { maxRequests: 120, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenNthCalledWith(
      2,
      "public-booking-availability:test-ip",
      { maxRequests: 30, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.createClientFromRequest).toHaveBeenCalledOnce();
    expect(mocks.loadPublicBookingAvailability).toHaveBeenCalledWith(
      expect.anything(),
      VENDOR_ID,
      { from: "2099-01-05", to: "2099-01-05" },
    );
  });
});
