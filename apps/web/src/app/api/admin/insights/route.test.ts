import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.rateLimit,
  rateLimitKey: vi.fn((prefix: string) => `${prefix}:test`),
}));

import { GET } from "./route";

describe("GET /api/admin/insights", () => {
  beforeEach(() => vi.clearAllMocks());

  it("limits analytics scans before creating the service client", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.rateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    const response = await GET(new Request("https://hanbang.ai/api/admin/insights"));

    expect(response.status).toBe(429);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });
});
