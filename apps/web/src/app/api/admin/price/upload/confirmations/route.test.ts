// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));
vi.mock("@/lib/admin/priceUploadConfirmations", () => ({
  listPendingPriceUploadConfirmations: mocks.list,
}));

import { GET } from "./route";

describe("GET /api/admin/price/upload/confirmations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-admin before constructing the service client", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });
    const response = await GET(new Request("https://example.test/api/admin/price/upload/confirmations"));
    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("returns the safe pending queue with private no-store caching", async () => {
    const client = { service: true };
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.getServiceClient.mockReturnValue(client);
    mocks.list.mockResolvedValue([{
      confirmation_id: "confirmation-1",
      category: "studio",
      regionCode: "seoul_gangnam3",
      candidates: [{
        vendorId: "vendor-1",
        category: "studio",
        regionCode: "seoul_gangnam3",
      }],
    }]);
    const response = await GET(new Request("https://example.test/api/admin/price/upload/confirmations"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      confirmations: [{
        confirmation_id: "confirmation-1",
        category: "studio",
        regionCode: "seoul_gangnam3",
        candidates: [{
          vendorId: "vendor-1",
          category: "studio",
          regionCode: "seoul_gangnam3",
        }],
      }],
    });
    expect(JSON.stringify(payload)).not.toContain("source_object_key");
    expect(mocks.list).toHaveBeenCalledWith(client);
  });
});
