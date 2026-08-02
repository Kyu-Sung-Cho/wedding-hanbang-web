// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

describe("production CSP fence", () => {
  it("allows unsafe-eval only for the local development runtime", () => {
    expect(nextConfig).toContain(
      'process.env.NODE_ENV === "development" ? " \'unsafe-eval\'" : ""',
    );
    expect(nextConfig).not.toMatch(/script-src[^\n]*'unsafe-inline' 'unsafe-eval'/);
  });

  it("pins Supabase network and image access to the configured project", () => {
    expect(nextConfig).toContain("configuredSupabaseEndpoint");
    expect(nextConfig).toContain("hostname: supabaseEndpoint.hostname");
    expect(nextConfig).not.toContain('hostname: "**.supabase.co"');
    expect(nextConfig).not.toContain('hostname: "**.supabase.in"');
    expect(nextConfig).not.toContain("https://*.supabase.co");
    expect(nextConfig).not.toContain("https://*.supabase.in");
    expect(nextConfig).not.toContain("wss://*.supabase.co");
    expect(nextConfig).not.toContain("wss://*.supabase.in");
  });

  it("does not retain unused third-party avatar image origins", () => {
    expect(nextConfig).not.toContain("api.dicebear.com");
  });

  it("opens third-party telemetry connections only to exact configured processors", () => {
    expect(nextConfig).toContain("configuredSentryBrowserOrigin");
    expect(nextConfig).toContain('process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "true"');
    expect(nextConfig).toContain('"https://us.i.posthog.com"');
    expect(nextConfig).not.toContain("https://*.posthog.com");
    expect(nextConfig).not.toContain("https://*.ingest.sentry.io");
    expect(nextConfig).not.toContain("https://*.ingest.us.sentry.io");
    expect(nextConfig).not.toMatch(/script-src[^\n]*posthog/iu);
  });

  it("disables the retired browser XSS auditor instead of enabling block mode", () => {
    expect(nextConfig).toContain('{ key: "X-XSS-Protection", value: "0" }');
    expect(nextConfig).not.toContain('value: "1; mode=block"');
  });
});
