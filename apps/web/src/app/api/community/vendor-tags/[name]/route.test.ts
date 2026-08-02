import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/http/publicServiceReadRateLimit", () => ({
  checkPublicServiceReadRateLimit: vi.fn().mockResolvedValue(null),
}));

import { COMMUNITY_VENDOR_TAG_PUBLIC_SELECT } from "@/lib/community/vendorTagPublicFields";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  fallbackCommunityAuthor: vi.fn((userId: string) => ({
    user_id: userId,
    nickname: "fallback",
    avatar_url: null,
    rank: "seed",
    wedding_year: null,
    wedding_month: null,
    role: null,
  })),
  getCommunityAuthorMap: vi.fn(),
  buildKstDateWindow: vi.fn(),
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

vi.mock("@/lib/community/authorProfiles", () => ({
  fallbackCommunityAuthor: mocks.fallbackCommunityAuthor,
  getCommunityAuthorMap: mocks.getCommunityAuthorMap,
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

function fluentSingle(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function postQuery(rows: unknown[]) {
  const query = {
    select: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  query.select.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

function fluentList(rows: unknown[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: result.then.bind(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

describe("GET /api/community/vendor-tags/[name]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.getCommunityAuthorMap.mockResolvedValue({});
    mocks.buildKstDateWindow.mockReturnValue([{ date: "2099-01-05", day: 0 }]);
    mocks.loadPublicBookingAvailability.mockResolvedValue([]);
  });

  it("returns 429 before service-role access when the shared IP bucket is exhausted", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response("limited", { status: 429 }),
    );
    const request = new Request(
      "https://hanbang.ai/api/community/vendor-tags/test",
    );

    const response = await GET(request as never, {
      params: Promise.resolve({ name: encodeURIComponent("테스트업체") }),
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

  it("rejects malformed path encoding before rate-limit or service-role work", async () => {
    const response = await GET(
      new Request("https://hanbang.ai/api/community/vendor-tags/test") as never,
      { params: Promise.resolve({ name: "%E0%A4%A" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns unknown names before any wildcard post-content scan", async () => {
    const tag = fluentSingle(null);
    const exactVendor = fluentSingle(null);
    const from = vi.fn((table: string) => {
      if (table === "community_vendor_tags") return tag;
      if (table === "vendors") return exactVendor;
      throw new Error(`unexpected expensive table access: ${table}`);
    });
    mocks.createAdminClient.mockReturnValue({ from });

    const response = await GET(
      new Request("https://hanbang.ai/api/community/vendor-tags/unknown") as never,
      { params: Promise.resolve({ name: "arbitrary-unknown-term" }) },
    );

    expect(response.status).toBe(404);
    expect(from).not.toHaveBeenCalledWith("community_posts");
    expect(exactVendor.ilike).not.toHaveBeenCalled();
  });

  it("allowlists tag fields and excludes moderation-pending posts twice", async () => {
    const tag = fluentSingle({
      id: "tag-1",
      vendor_name: "테스트업체",
      mention_count: 1,
    });
    const posts = postQuery([
      {
        id: "public-post",
        author_id: "public-author",
        visibility: "public",
        under_review: false,
      },
      {
        id: "pending-post",
        author_id: "pending-author",
        visibility: "public",
        under_review: true,
      },
    ]);
    const exactVendor = fluentSingle(null);
    const fuzzyVendor = fluentSingle(null);
    const from = vi.fn((table: string) => {
      if (table === "community_vendor_tags") return tag;
      if (table === "community_posts") return posts;
      if (table === "vendors") {
        return from.mock.calls.filter(([name]) => name === "vendors").length === 1
          ? exactVendor
          : fuzzyVendor;
      }
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.createAdminClient.mockReturnValue({ from });

    const response = await GET(
      new Request("https://hanbang.ai/api/community/vendor-tags/test") as never,
      { params: Promise.resolve({ name: encodeURIComponent("테스트업체") }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(tag.select).toHaveBeenCalledWith(COMMUNITY_VENDOR_TAG_PUBLIC_SELECT);
    expect(posts.eq).toHaveBeenCalledWith("visibility", "public");
    expect(posts.eq).toHaveBeenCalledWith("under_review", false);
    expect(body.posts.map((post: { id: string }) => post.id)).toEqual(["public-post"]);
    expect(mocks.getCommunityAuthorMap).toHaveBeenCalledWith(
      expect.anything(),
      ["public-author"],
    );
  });

  it("returns only derived slot availability, never raw capacity or occupancy", async () => {
    const tag = fluentSingle(null);
    const posts = postQuery([]);
    const exactVendor = fluentSingle({
      id: "11111111-1111-4111-8111-111111111111",
      name: "테스트업체",
      category: "studio",
    });
    const products = fluentList([]);
    const staff = fluentList([{
      id: "22222222-2222-4222-8222-222222222222",
      name: "담당자",
      role: "촬영",
      description: null,
      sort_order: 1,
    }]);
    const vendorSlots = fluentList([{
      day: 0,
      hour: 10,
      max_bookings: 2,
    }]);
    const staffSlots = fluentList([{
      staff_id: "22222222-2222-4222-8222-222222222222",
      day: 0,
      hour: 10,
      max_bookings: 3,
    }]);
    mocks.loadPublicBookingAvailability.mockResolvedValue([{
      date: "2099-01-05",
      time: "10:00",
      productId: null,
      staffId: "22222222-2222-4222-8222-222222222222",
      bookedCount: 2,
    }]);

    const from = vi.fn((table: string) => {
      if (table === "community_vendor_tags") return tag;
      if (table === "community_posts") return posts;
      if (table === "vendors") return exactVendor;
      if (table === "vendor_products") return products;
      if (table === "vendor_staff") return staff;
      if (table === "vendor_timeslots") return vendorSlots;
      if (table === "staff_timeslots") return staffSlots;
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.createAdminClient.mockReturnValue({ from });

    const response = await GET(
      new Request("https://hanbang.ai/api/community/vendor-tags/test") as never,
      { params: Promise.resolve({ name: encodeURIComponent("테스트업체") }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.vendorSlots).toEqual([{ day: 0, hour: 10, available: false }]);
    expect(body.staffSlots).toEqual({
      "22222222-2222-4222-8222-222222222222": [
        { day: 0, hour: 10, available: true },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/max_bookings|current_bookings|bookedCount/);
  });
});
