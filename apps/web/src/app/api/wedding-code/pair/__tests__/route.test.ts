import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "wc-pair:test"),
}));

const RESPONSE_ID = "123e4567-e89b-42d3-a456-426614174000";
const COUPLE_TOKEN = "223e4567-e89b-42d3-a456-426614174000";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/wedding-code/pair", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mockAdmin(options: {
  existingCount?: number;
  updated?: { id: string } | null;
  updateError?: { message: string } | null;
}) {
  const countQuery = {
    select: vi.fn(() => countQuery),
    eq: vi.fn(() => Promise.resolve({ count: options.existingCount ?? 0, error: null })),
  };
  const updateQuery = {
    update: vi.fn(() => updateQuery),
    eq: vi.fn(() => updateQuery),
    is: vi.fn(() => updateQuery),
    select: vi.fn(() => updateQuery),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: options.updated === undefined ? { id: RESPONSE_ID } : options.updated,
        error: options.updateError ?? null,
      })
    ),
  };
  const admin = {
    from: vi
      .fn()
      .mockReturnValueOnce(countQuery)
      .mockReturnValueOnce(updateQuery),
  };
  vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);
  return { admin, countQuery, updateQuery };
}

describe("/api/wedding-code/pair POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects oversized requests before rate limiting or Supabase access", async () => {
    const response = await POST(request({}, { "content-length": "4097" }));
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toContain("너무 큽니다");
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before Supabase access", async () => {
    const response = await POST(request({ response_id: "bad", couple_token: COUPLE_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("잘못된 요청");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a token that already has two responses", async () => {
    const { updateQuery } = mockAdmin({ existingCount: 2 });

    const response = await POST(request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("이미 두 분");
    expect(updateQuery.update).not.toHaveBeenCalled();
  });

  it("links a response that does not already have a couple token", async () => {
    const { updateQuery } = mockAdmin({ existingCount: 1 });

    const response = await POST(request({ response_id: RESPONSE_ID, couple_token: COUPLE_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(updateQuery.update).toHaveBeenCalledWith({ couple_token: COUPLE_TOKEN });
    expect(updateQuery.eq).toHaveBeenCalledWith("id", RESPONSE_ID);
    expect(updateQuery.is).toHaveBeenCalledWith("couple_token", null);
  });
});
