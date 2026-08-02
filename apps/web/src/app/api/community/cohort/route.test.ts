// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  isTrustedMutationRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: mocks.isTrustedMutationRequest,
}));

import { POST } from "./route";

describe("POST /api/community/cohort trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an untrusted browser mutation before authentication or service access", async () => {
    mocks.isTrustedMutationRequest.mockReturnValue(false);

    const response = await POST(new Request(
      "https://hanbang.ai/api/community/cohort",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year: 2027, month: 6 }),
      },
    ) as Parameters<typeof POST>[0]);

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });
});
