import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "onboarding:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const COUPLE_ID = "223e4567-e89b-42d3-a456-426614174000";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID, email: "user@example.com", user_metadata: {} } },
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it("stores zero when the couple has not decided a budget", async () => {
    const profileQuery = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
    };
    const admin = {
      from: vi.fn(() => profileQuery),
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, couple_id: COUPLE_ID, invite_code: "WH-A1B2C3D4E5F6" },
        error: null,
      }),
    };
    vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);

    const response = await POST(request({
      role: "bride",
      coupleAction: "create",
      weddingDate: null,
      venue: null,
      progress: {},
    }));

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("create_amora_couple_safely", expect.objectContaining({
      p_total_budget: 0,
    }));
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "onboarding:test",
      { maxRequests: 10, windowMs: 10 * 60 * 1000 },
      USER_ID,
    );
  });

  it.each([
    ["malformed couple id", { success: true, couple_id: "couple-1", invite_code: "WH-A1B2C3D4E5F6" }],
    ["malformed invite code", { success: true, couple_id: COUPLE_ID, invite_code: "not-a-code" }],
  ])("rejects a successful create RPC with a %s", async (_name, data) => {
    const profileQuery = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
    };
    const admin = {
      from: vi.fn(() => profileQuery),
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    };
    vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);

    const response = await POST(request({
      role: "bride",
      coupleAction: "create",
      progress: {},
    }));

    expect(response.status).toBe(500);
  });

  it("rejects a successful join RPC with a malformed couple id", async () => {
    const profileQuery = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
    };
    const admin = {
      from: vi.fn(() => profileQuery),
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, couple_id: "couple-1" },
        error: null,
      }),
    };
    vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);

    const response = await POST(request({
      role: "groom",
      coupleAction: "join",
      partnerInviteCode: "WH-A1B2C3D4E5F6",
      progress: {},
    }));

    expect(response.status).toBe(500);
  });

  it.each([
    ["invalid wedding date", { weddingDate: "2026-02-30", totalBudget: 0 }],
    ["invalid optional date", { weddingDate: null, sanggyeonryeDate: "not-a-date", totalBudget: 0 }],
    ["invalid budget string", { weddingDate: null, totalBudget: "30000000" }],
    ["negative budget", { weddingDate: null, totalBudget: -1 }],
  ])("rejects supplied %s instead of silently storing an undecided value", async (_name, invalid) => {
    const response = await POST(request({
      role: "bride",
      coupleAction: "create",
      venue: null,
      progress: {},
      ...invalid,
    }));

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });
});
