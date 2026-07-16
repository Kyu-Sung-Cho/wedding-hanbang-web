import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAmoraMemoryEnablement } from "@/lib/ai/amoraMemoryQueue";

describe("Amora memory enablement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses current unanimous consent instead of a stale materialized enabled flag", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async (_name: string, args: { p_visibility: string }) => ({
      data: args.p_visibility === "bride_private",
      error: null,
    }));
    const admin = { rpc } as unknown as SupabaseClient;

    const result = await getAmoraMemoryEnablement(
      "10000000-0000-4000-8000-000000000001",
      ["shared", "bride_private"],
      admin,
    );

    expect(result).toMatchObject({ shared: false, bride_private: true });
  });
});
