import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/journey", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/journey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it.each([
    { progress: {} },
    { progress_patch: { venue: {} } },
    { progress_remove_keys: ["__events"] },
    { total_budget: 10_000_000, progress: {} },
  ])("rejects broad progress writes before creating an admin client: %o", async (body) => {
    const response = await PATCH(request(body));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("updates only validated scalar fields for the authenticated couple", async () => {
    const journey = {
      id: "journey-1",
      couple_id: "couple-1",
      wedding_date: "2027-05-08",
      total_budget: 50_000_000,
      venue: "서울 예식장",
      progress: { __events: [{ id: "unchanged" }] },
    };
    const profileSingle = vi.fn().mockResolvedValue({ data: { couple_id: "couple-1" }, error: null });
    const journeySingle = vi.fn().mockResolvedValue({ data: journey, error: null });
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({ select: vi.fn(() => ({ single: journeySingle })) })),
    }));
    const from = vi.fn((table: string) => table === "profiles"
      ? { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: profileSingle })) })) }
      : { update });
    vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);

    const response = await PATCH(request({
      wedding_date: "2027-05-08",
      total_budget: 50_000_000,
      venue: " 서울 예식장 ",
    }));

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      wedding_date: "2027-05-08",
      total_budget: 50_000_000,
      venue: "서울 예식장",
    });
    expect(await response.json()).toEqual({ journey });
  });
});
