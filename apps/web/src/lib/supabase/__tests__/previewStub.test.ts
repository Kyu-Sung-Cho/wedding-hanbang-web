import { afterEach, describe, expect, it, vi } from "vitest";

import { isPreviewStubMode } from "@/lib/previewStub";

describe("isPreviewStubMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables the stub only when it is explicit and public Supabase config is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(isPreviewStubMode()).toBe(true);
  });

  it("keeps missing configuration fail-fast when the preview stub flag is not enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(isPreviewStubMode()).toBe(false);
  });

  it("keeps the explicit stub fence even when public Supabase config is present", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preview.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preview-public-key");

    expect(isPreviewStubMode()).toBe(true);
  });
});
