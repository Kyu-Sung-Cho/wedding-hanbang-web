import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ browser: true })),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

import { createClient } from "./client";
import { createPublicClient } from "./public";

describe("browser Supabase Preview containment", () => {
  beforeEach(() => {
    mocks.createBrowserClient.mockClear();
    vi.unstubAllEnvs();
  });

  it("does not construct a browser client in stub mode even with live-looking config", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://slrtobkksjmxgzatjyqb.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "accidental-production-anon-key");

    expect(() => createClient()).toThrow(
      "Supabase clients are disabled in Preview stub mode",
    );
    expect(mocks.createBrowserClient).not.toHaveBeenCalled();
  });

  it("blocks the stateless public client at the same boundary", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://slrtobkksjmxgzatjyqb.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "accidental-production-anon-key");

    expect(() => createPublicClient()).toThrow(
      "Supabase clients are disabled in Preview stub mode",
    );
  });
});
