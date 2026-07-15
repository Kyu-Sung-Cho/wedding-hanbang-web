import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "profile:update:user-1"),
}));

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockAdmin(onUpdate?: (value: unknown) => void) {
  const query = {
    update: vi.fn((value: unknown) => {
      onUpdate?.(value);
      return query;
    }),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(async () => ({
      data: {
        id: "user-1",
        name: "계정 이름",
        role: null,
        couple_id: null,
        onboarding_completed: false,
        onboarding_step: 0,
        phone: null,
      },
      error: null,
    })),
  };
  const admin = { from: vi.fn(() => query) };
  vi.mocked(createClient).mockReturnValue(admin as never);
  return admin;
}

describe("/api/profile PATCH privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
      },
    } as never);
  });

  it("updates only the account profile and never reads or writes community_profiles", async () => {
    let update: unknown;
    const admin = mockAdmin((value) => {
      update = value;
    });

    const response = await PATCH(request({ name: "계정 이름" }));

    expect(response.status).toBe(200);
    expect(update).toEqual({ name: "계정 이름" });
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(JSON.stringify(await response.json())).not.toContain("communityProfileSynced");
  });

  it("rejects the retired cross-profile sync input instead of silently copying a name", async () => {
    const response = await PATCH(
      request({ name: "실명일 수 있는 이름", sync_community_nickname: true }),
    );

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("별도로 관리"),
    });
  });

  it("rejects collecting a new phone number while every phone use is disabled", async () => {
    const response = await PATCH(request({ phone: "010-1234-5678" }));

    expect(response.status).toBe(409);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("still lets a user erase a previously stored phone number", async () => {
    let update: unknown;
    mockAdmin((value) => {
      update = value;
    });

    const response = await PATCH(request({ phone: "" }));

    expect(response.status).toBe(200);
    expect(update).toMatchObject({ phone: null, phone_care_consented_at: null });
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "profile:update:user-1",
      { maxRequests: 30, windowMs: 60 * 1000 },
      "user-1",
    );
  });
});
