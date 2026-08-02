import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { POST } from "./route";

describe("POST /api/admin/enrich/:id/assign", () => {
  beforeEach(() => vi.clearAllMocks());

  it("assigns through the transactional service-only RPC", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000001";
    const actorId = "00000000-0000-4000-8000-000000000002";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await POST(
      new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}/assign`, { method: "POST" }),
      { params: Promise.resolve({ id: vendorId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("assign_vendor_enrichment", {
      p_vendor_id: vendorId,
      p_actor_id: actorId,
    });
  });
});
