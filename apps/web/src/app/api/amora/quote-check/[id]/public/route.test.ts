import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

describe("GET /api/amora/quote-check/[id]/public retirement", () => {
  it("returns 410 without reading stored quote data", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(body.error).toContain("종료");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
