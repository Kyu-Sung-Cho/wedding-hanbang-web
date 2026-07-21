import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET, POST } from "./route";

describe("admin automatic validation bulk approval", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails closed before any service access for a non-admin count request", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("reports zero eligible rows when immutable extraction provenance is unavailable", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      eligible_count: 0,
      can_execute: false,
      batch_limit: 25,
      blocked_code: "VALIDATION_PROVENANCE_NOT_PERSISTED",
      blocked_reason: expect.any(String),
    });
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects execution with a bounded empty result instead of guessing eligibility", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });

    const response = await POST(new Request(
      "https://hanbang.ai/api/admin/price/bulk-approval",
      { method: "POST" },
    ));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      eligible_count: 0,
      approved_count: 0,
      conflict_count: 0,
      failed_count: 0,
      batch_limit: 25,
      results: [],
      blocked_code: "VALIDATION_PROVENANCE_NOT_PERSISTED",
    });
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

});
