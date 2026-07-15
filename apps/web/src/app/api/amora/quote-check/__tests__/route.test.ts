import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

function quoteRequest(extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/amora/quote-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 300,
      includedItemIds: [],
      saveToAccount: true,
      ...extra,
    }),
  });
}

describe("/api/amora/quote-check POST retirement contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns one constant disabled response before auth, body parsing, analysis, or DB access", async () => {
    const request = quoteRequest();
    const jsonSpy = vi.spyOn(request, "json");
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "견적 체크 기능은 현재 신규 제공하지 않습니다.",
      code: "quote_check_retired",
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
