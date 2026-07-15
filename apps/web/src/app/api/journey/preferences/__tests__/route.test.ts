import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/journey/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/journey/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it("patches only validated preference fields", async () => {
    const progress = {
      __preferences: { weddingStyle: "natural", priorities: ["venue", "housing"] },
      __events: [{ id: "unchanged" }],
    };
    const rpc = vi.fn().mockResolvedValue({
      data: { progress, preferences: progress.__preferences },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({ data: { couple_id: "couple-1" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await PATCH(request({
      weddingStyle: "natural",
      priorities: ["venue", "housing"],
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("patch_journey_preferences", {
      p_couple_id: "couple-1",
      p_patch: { weddingStyle: "natural", priorities: ["venue", "housing"] },
    });
  });

  it.each([
    {},
    { __events: [] },
    { progress: {} },
    { weddingStyle: "luxury" },
    { priorities: ["venue", "venue"] },
    { priorities: ["unknown"] },
    { budgetTendency: 1 },
    { guestCount: "300to400" },
    { coupleId: "other", weddingStyle: "minimal" },
  ])("rejects broad or invalid preference data: %o", async (body) => {
    const response = await PATCH(request(body));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed if progress and returned preferences disagree", async () => {
    const single = vi.fn().mockResolvedValue({ data: { couple_id: "couple-1" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          progress: { __preferences: { weddingStyle: "classic" } },
          preferences: { weddingStyle: "minimal" },
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await PATCH(request({ weddingStyle: "minimal" }));
    expect(response.status).toBe(500);
  });
});
