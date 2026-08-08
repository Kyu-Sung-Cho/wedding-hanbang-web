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

import { PATCH } from "./route";

describe("PATCH /api/admin/price/dedupe/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an explicit entity kind before opening the service client", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000001";
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: "00000000-0000-4000-8000-000000000003",
    });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/price/dedupe/${candidateId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "different", preserved_vendor_id: null }),
      },
    ), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("delegates a merge decision to the atomic dedupe RPC", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000001";
    const preservedId = "00000000-0000-4000-8000-000000000002";
    const actorId = "00000000-0000-4000-8000-000000000003";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/dedupe/${candidateId}?kind=vendor`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "same", preserved_vendor_id: preservedId }),
    }), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("decide_vendor_dedupe_candidate", {
      p_candidate_id: candidateId,
      p_decision: "same",
      p_preserved_vendor_id: preservedId,
      p_decided_by: actorId,
    });
  });

  it("delegates an explicit agency merge decision to the agency RPC", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000101";
    const preservedId = "00000000-0000-4000-8000-000000000102";
    const actorId = "00000000-0000-4000-8000-000000000103";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/price/dedupe/${candidateId}?kind=agency`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "same", preserved_agency_id: preservedId }),
      },
    ), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("decide_agency_dedupe_candidate", {
      p_candidate_id: candidateId,
      p_decision: "same",
      p_preserved_agency_id: preservedId,
      p_decided_by: actorId,
    });
  });

  it("does not accept a vendor preservation field for an agency decision", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000101";
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: "00000000-0000-4000-8000-000000000103",
    });
    const rpc = vi.fn();
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/price/dedupe/${candidateId}?kind=agency`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "same",
          preserved_vendor_id: "00000000-0000-4000-8000-000000000102",
        }),
      },
    ), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
