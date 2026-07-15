import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET, POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));

describe("retired cohort price surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("returns a constant 410 before auth, body, or DB for %s", async (_method, handler) => {
    const response = await handler();
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "cohort_rooms_retired" });
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
