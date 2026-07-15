import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

describe("POST /api/community/cohort/auto-assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed before authentication or membership writes after cohort retirement", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "cohort_rooms_retired" });
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });
});
