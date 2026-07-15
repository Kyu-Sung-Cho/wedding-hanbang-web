import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "couple:link:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";

function request() {
  return new NextRequest("http://localhost/api/couple/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "WH-A1B2C3D4E5F6" }),
  });
}

function profileQuery() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: { role: "groom", couple_id: null },
      error: null,
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("POST /api/couple/link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
  });

  it("does not claim success for a malformed successful RPC result", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn(() => profileQuery()),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, couple_id: "couple-1" },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "couple:link:test",
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      USER_ID,
    );
  });
});
