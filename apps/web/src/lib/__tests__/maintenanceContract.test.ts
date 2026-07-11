import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const proxySource = readFileSync(
  resolve(repoRoot, "apps/web/src/proxy.ts"),
  "utf8"
);
const healthSource = readFileSync(
  resolve(repoRoot, "apps/web/src/app/api/health/maintenance/route.ts"),
  "utf8"
);
const webEnvExample = readFileSync(
  resolve(repoRoot, "apps/web/.env.example"),
  "utf8"
);
const webSettingsSource = readFileSync(
  resolve(repoRoot, "apps/web/src/app/(app)/settings/page.tsx"),
  "utf8"
);
const mobileSettingsSource = readFileSync(
  resolve(repoRoot, "apps/mobile/app/settings/index.tsx"),
  "utf8"
);
const originalRateLimitKeySecret = process.env.RATE_LIMIT_KEY_SECRET;

afterEach(() => {
  if (originalRateLimitKeySecret === undefined) {
    delete process.env.RATE_LIMIT_KEY_SECRET;
  } else {
    process.env.RATE_LIMIT_KEY_SECRET = originalRateLimitKeySecret;
  }
});

describe("maintenance release contract", () => {
  it("canonicalizes www to the apex domain before serving content", async () => {
    const { proxy } = await import("../../proxy");
    const response = await proxy(
      new NextRequest("https://www.hanbang.ai/wedding?source=www")
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding?source=www"
    );
  });

  it("fails writes and pages closed while leaving only the health proof reachable", () => {
    expect(proxySource).toContain('process.env.MAINTENANCE_MODE === "true"');
    expect(proxySource).toContain('pathname === "/api/health/maintenance"');
    expect(proxySource).toContain('status: 503');
    expect(proxySource).toContain('"Retry-After": "60"');
    expect(proxySource).toContain('url.pathname = "/maintenance"');
    expect(proxySource).toContain('code: "SERVICE_MAINTENANCE"');
    expect(proxySource).toContain("서비스 점검 중이에요. 잠시 후 다시 시도해 주세요.");
  });

  it("keeps maintenance fonts reachable and exposes a localized API message", () => {
    expect(proxySource).toContain("fonts/");
    expect(proxySource).toContain("woff2?");
    expect(proxySource).toContain("ttf|otf|eot");
    expect(webSettingsSource).toContain('typeof data.message === "string"');
    expect(mobileSettingsSource).toContain('typeof body.message === "string"');
    expect(webSettingsSource).toContain("apiResponseMessage(data");
    expect(mobileSettingsSource).toContain("apiErrorMessage(body");
  });

  it("binds the live maintenance proof to the configured Supabase project", () => {
    expect(healthSource).toContain('supabaseProjectRef: configuredSupabaseProjectRef()');
    expect(healthSource).toContain('maintenanceStartedAt: process.env.MAINTENANCE_STARTED_AT_UTC');
    expect(healthSource).toContain("rateLimitKeySecretConfigured:");
    expect(healthSource).toContain(
      "(process.env.RATE_LIMIT_KEY_SECRET?.trim().length ?? 0) >= 32"
    );
    expect(healthSource).not.toContain("rateLimitKeySecret:");
    expect(healthSource).toContain('/^([a-z0-9]{20})\\.supabase\\.co$/');
    expect(healthSource).toContain('"Cache-Control": "no-store, max-age=0"');
    expect(webEnvExample).toContain("MAINTENANCE_MODE=false");
    expect(webEnvExample).toContain("MAINTENANCE_STARTED_AT_UTC=");
  });

  it("reports only whether the deployed rate-limit secret meets the minimum", async () => {
    const { GET } = await import(
      "../../app/api/health/maintenance/route"
    );
    process.env.RATE_LIMIT_KEY_SECRET = "  too-short  ";
    const missing = (await (await GET()).json()) as Record<string, unknown>;
    expect(missing.rateLimitKeySecretConfigured).toBe(false);
    expect(missing).not.toHaveProperty("rateLimitKeySecret");

    process.env.RATE_LIMIT_KEY_SECRET = `  ${"s".repeat(32)}  `;
    const configured = (await (await GET()).json()) as Record<string, unknown>;
    expect(configured.rateLimitKeySecretConfigured).toBe(true);
    expect(configured).not.toHaveProperty("rateLimitKeySecret");
  });
});
