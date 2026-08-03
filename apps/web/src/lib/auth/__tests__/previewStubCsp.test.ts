import { afterEach, describe, expect, it, vi } from "vitest";

function setPreviewStubEnvironment() {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@o123.ingest.sentry.io/1");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_inherited_fixture");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "inherited-site-key");
}

describe("Preview stub CSP isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows only same-origin browser connections even with inherited provider env", async () => {
    setPreviewStubEnvironment();
    vi.resetModules();
    const { default: config } = await import("../../../../next.config");
    const headers = await config.headers?.();
    const globalHeaders = headers?.find((entry) => entry.source === "/(.*)");
    const csp = globalHeaders?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toBeTypeOf("string");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain("supabase.co");
    expect(csp).not.toContain("posthog.com");
    expect(csp).not.toContain("sentry.io");
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(csp).not.toContain("pstatic.net");
    expect(csp).not.toContain("https://hanbang.ai");
  });
});
