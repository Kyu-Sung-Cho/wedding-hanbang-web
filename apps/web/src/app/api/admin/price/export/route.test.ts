// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  loadExport: vi.fn(),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("@/lib/admin/priceUploadExport", () => ({
  loadCurrentPublishedPriceExport: mocks.loadExport,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.rateLimit,
  rateLimitKey: vi.fn((prefix: string) => `${prefix}:test`),
}));

import { GET } from "./route";

describe("GET /api/admin/price/export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-admin requests before reading price data", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await GET(new Request("https://example.test/api/admin/price/export"));

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.loadExport).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("downloads the current published projection as JSON", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    const client = { service: true };
    mocks.getServiceClient.mockReturnValue(client);
    mocks.loadExport.mockResolvedValue({
      schema_version: 1,
      generated_at: "2026-07-18T12:00:00.000Z",
      snapshots: [{ id: "snapshot-1", published: true, is_current: true }],
      prices: [{ id: "price-1", options: [] }],
      agency_packages: [],
    });

    const response = await GET(new Request("https://example.test/api/admin/price/export"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition"))
      .toBe('attachment; filename="wedding-hanbang-current-prices.json"');
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      snapshots: [{ published: true, is_current: true }],
      prices: [{ id: "price-1", options: [] }],
    });
    expect(mocks.loadExport).toHaveBeenCalledWith(client);
  });

  it("stops a limited export before loading the high-volume projection", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));

    const response = await GET(new Request("https://example.test/api/admin/price/export"));

    expect(response.status).toBe(429);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.loadExport).not.toHaveBeenCalled();
  });
});
