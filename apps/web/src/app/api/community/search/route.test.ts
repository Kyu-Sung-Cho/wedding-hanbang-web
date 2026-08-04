// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET } from "./route";

describe("GET /api/community/search response privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({});
  });

  it("never allows a viewer-specific search response to be shared or cached", async () => {
    const response = await GET(
      new NextRequest("https://hanbang.ai/api/community/search?q="),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(response.headers.get("vary")).toContain("Cookie");
  });
});
