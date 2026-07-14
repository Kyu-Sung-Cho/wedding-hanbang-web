import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientFromRequestSpy, createAdminClientSpy } = vi.hoisted(() => ({
  createClientFromRequestSpy: vi.fn(),
  createAdminClientSpy: vi.fn(() => {
    throw new Error("CROSS_COUPLE_API_CANARY_91b23e");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: createClientFromRequestSpy,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createAdminClientSpy,
}));

import { GET } from "../route";

describe("GET /api/chat/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientFromRequestSpy.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-requesting-feedback" } },
        }),
      },
    });
  });

  it("returns a structured empty result without reading another couple's feedback", async () => {
    const response = await GET(new Request("http://localhost/api/chat/feedback"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual({ lessons: [], learningEnabled: false });
    expect(JSON.stringify(body)).not.toContain("CROSS_COUPLE_API_CANARY_91b23e");
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });
});
