import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET, POST } from "../route";

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("/api/money retired collection boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("returns a fixed 410 for %s before auth, body, or database access", async (method, handler) => {
    const response = await handler();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: "congratulatory_money_retired",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
