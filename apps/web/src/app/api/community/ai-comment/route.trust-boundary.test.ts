import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  createOpenAIResponseWithAudit: vi.fn(),
  reserveAmoraTurn: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/ai/auditedOpenAI", () => ({
  createOpenAIResponseWithAudit: mocks.createOpenAIResponseWithAudit,
}));

vi.mock("@/lib/ai/costGuard", () => ({
  reserveAmoraTurn: mocks.reserveAmoraTurn,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "trust-boundary-test"),
}));

import { POST } from "./route";

describe("community AI comment mutation trust boundary", () => {
  it("rejects cross-site input before admin auth, parsing, cost reservation, database access, or provider generation", async () => {
    const request = new NextRequest("https://hanbang.ai/api/community/ai-comment", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: "not-json",
    });
    const jsonSpy = vi.spyOn(request, "json");

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.reserveAmoraTurn).not.toHaveBeenCalled();
    expect(mocks.createOpenAIResponseWithAudit).not.toHaveBeenCalled();
  });
});
