import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET } from "./route";

function request(query = "") {
  return new NextRequest(
    `https://hanbang.ai/api/admin/community/health${query}`,
  );
}

describe("GET /api/admin/community/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("requires an authenticated administrator", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("uses a 30-day default and returns the aggregate without caching it", async () => {
    const health = {
      window_days: 30,
      public_non_review_post_count: 18,
      human_reply_within_24h_rate: 0.5,
    };
    const rpc = vi.fn().mockResolvedValue({ data: health, error: null });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ health });
    expect(rpc).toHaveBeenCalledWith("community_operational_health", {
      p_window_days: 30,
    });
  });

  it("accepts the inclusive window boundaries", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { window_days: 7 }, error: null })
      .mockResolvedValueOnce({ data: { window_days: 7 }, error: null })
      .mockResolvedValueOnce({ data: { window_days: 90 }, error: null });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const minimum = await GET(request("?windowDays=7"));
    const maximum = await GET(request("?windowDays=90"));

    expect(minimum.status).toBe(200);
    expect(maximum.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(1, "community_operational_health", {
      p_window_days: 7,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "community_operational_health", {
      p_window_days: 90,
    });
  });

  it.each([
    "?windowDays=6",
    "?windowDays=91",
    "?windowDays=30.5",
    "?windowDays=abc",
    "?windowDays=30&windowDays=31",
  ])("rejects an invalid window before opening the service client: %s", async (query) => {
    const response = await GET(request(query));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("COMMUNITY_OPERATIONAL_HEALTH_INVALID_WINDOW");
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("fails closed when the aggregate schema is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find community_operational_health",
      },
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await GET(request("?windowDays=14"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe(
      "COMMUNITY_OPERATIONAL_HEALTH_SCHEMA_UNAVAILABLE",
    );
  });

  it("rejects null or scalar RPC results", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("COMMUNITY_OPERATIONAL_HEALTH_INVALID_RESULT");
  });
});
