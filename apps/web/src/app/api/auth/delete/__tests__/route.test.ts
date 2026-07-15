import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

describe("/api/auth/delete DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([undefined, "false", "true"])(
    "stays unavailable before authentication or queue access when the worker flag is %s",
    async (workerFlag) => {
      if (workerFlag === undefined) delete process.env.ACCOUNT_DELETION_CRON_ENABLED;
      else process.env.ACCOUNT_DELETION_CRON_ENABLED = workerFlag;

      const response = await DELETE();

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        accepted: false,
        code: "ACCOUNT_DELETION_UNAVAILABLE",
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(createClientFromRequest).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );
});
