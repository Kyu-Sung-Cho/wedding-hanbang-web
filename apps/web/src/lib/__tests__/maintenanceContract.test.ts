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
const originalMaintenanceMode = process.env.MAINTENANCE_MODE;
const originalLaunchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE;
const originalAccountDeletionCronEnabled = process.env.ACCOUNT_DELETION_CRON_ENABLED;
const originalResearchCohortApplicationsEnabled =
  process.env.RESEARCH_COHORT_APPLICATIONS_ENABLED;
const originalVercelGitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;

afterEach(() => {
  if (originalRateLimitKeySecret === undefined) {
    delete process.env.RATE_LIMIT_KEY_SECRET;
  } else {
    process.env.RATE_LIMIT_KEY_SECRET = originalRateLimitKeySecret;
  }
  if (originalMaintenanceMode === undefined) {
    delete process.env.MAINTENANCE_MODE;
  } else {
    process.env.MAINTENANCE_MODE = originalMaintenanceMode;
  }
  if (originalLaunchMode === undefined) {
    delete process.env.NEXT_PUBLIC_LAUNCH_MODE;
  } else {
    process.env.NEXT_PUBLIC_LAUNCH_MODE = originalLaunchMode;
  }
  if (originalAccountDeletionCronEnabled === undefined) {
    delete process.env.ACCOUNT_DELETION_CRON_ENABLED;
  } else {
    process.env.ACCOUNT_DELETION_CRON_ENABLED = originalAccountDeletionCronEnabled;
  }
  if (originalResearchCohortApplicationsEnabled === undefined) {
    delete process.env.RESEARCH_COHORT_APPLICATIONS_ENABLED;
  } else {
    process.env.RESEARCH_COHORT_APPLICATIONS_ENABLED =
      originalResearchCohortApplicationsEnabled;
  }
  if (originalVercelGitCommitSha === undefined) {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  } else {
    process.env.VERCEL_GIT_COMMIT_SHA = originalVercelGitCommitSha;
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

  it("keeps signed app-association proofs directly reachable during maintenance", async () => {
    const { proxy } = await import("../../proxy");
    process.env.MAINTENANCE_MODE = "true";

    for (const path of [
      "/apple-app-site-association",
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ]) {
      const response = await proxy(new NextRequest(`https://hanbang.ai${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("enforces coming-soon mode on the server while keeping only explicit public paths", async () => {
    const { proxy } = await import("../../proxy");
    delete process.env.MAINTENANCE_MODE;
    process.env.NEXT_PUBLIC_LAUNCH_MODE = "coming_soon";

    for (const path of [
      "/demo",
      "/beta",
      "/beta/verify",
      "/privacy",
      "/api/preregister",
      "/api/preregister/verify",
      "/api/health/maintenance",
      "/apple-app-site-association",
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ]) {
      const response = await proxy(new NextRequest(`https://hanbang.ai${path}`));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-middleware-rewrite"), path).toBeNull();
    }

    const pageResponse = await proxy(
      new NextRequest("https://hanbang.ai/login?mode=signup&next=/wedding/chat")
    );
    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe("https://hanbang.ai/demo");
    expect(pageResponse.headers.get("cache-control")).toBe("no-store, max-age=0");

    const campaignResponse = await proxy(
      new NextRequest(
        "https://hanbang.ai/wedding/chat?utm_source=kakao&utm_campaign=summer&next=/admin"
      )
    );
    expect(campaignResponse.headers.get("location")).toBe(
      "https://hanbang.ai/demo?utm_source=kakao&utm_campaign=summer"
    );

    const apiResponse = await proxy(
      new NextRequest("https://hanbang.ai/api/auth/signup", { method: "POST" })
    );
    expect(apiResponse.status).toBe(503);
    expect(apiResponse.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(apiResponse.headers.get("retry-after")).toBe("3600");
    await expect(apiResponse.json()).resolves.toMatchObject({
      code: "SERVICE_NOT_LAUNCHED",
      retryAfterSeconds: 3600,
    });
  });

  it("keeps maintenance mode authoritative when both release gates are enabled", async () => {
    const { proxy } = await import("../../proxy");
    process.env.MAINTENANCE_MODE = "true";
    process.env.NEXT_PUBLIC_LAUNCH_MODE = "coming_soon";

    const response = await proxy(new NextRequest("https://hanbang.ai/demo"));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/maintenance");
  });

  it("binds the live maintenance proof to the configured Supabase project", () => {
    expect(healthSource).toContain('supabaseProjectRef: configuredSupabaseProjectRef()');
    expect(healthSource).toContain('maintenanceStartedAt: process.env.MAINTENANCE_STARTED_AT_UTC');
    expect(healthSource).toContain("rateLimitKeySecretConfigured:");
    expect(healthSource).toContain("deployment: configuredDeploymentCommit()");
    expect(healthSource).toContain("researchCohortApplicationsEnabled:");
    expect(healthSource).toContain("accountDeletionCronEnabled:");
    expect(healthSource).toContain(
      "hasStrongRateLimitKeySecretConfig()"
    );
    expect(healthSource).not.toContain("rateLimitKeySecret:");
    expect(healthSource).toContain('/^([a-z0-9]{20})\\.supabase\\.co$/');
    expect(healthSource).toContain('"Cache-Control": "no-store, max-age=0"');
    expect(webEnvExample).toContain("MAINTENANCE_MODE=false");
    expect(webEnvExample).toContain("MAINTENANCE_STARTED_AT_UTC=");
  });

  it("reports only whether the deployed rate-limit secret meets the strict boundary", async () => {
    const { GET } = await import(
      "../../app/api/health/maintenance/route"
    );
    process.env.RATE_LIMIT_KEY_SECRET = "  too-short  ";
    const missing = (await (await GET()).json()) as Record<string, unknown>;
    expect(missing.rateLimitKeySecretConfigured).toBe(false);
    expect(missing).not.toHaveProperty("rateLimitKeySecret");

    process.env.RATE_LIMIT_KEY_SECRET = "R7vY0M5sK8qN2bF9xW4cL6jH1pT3dG5zA9uE";
    const configured = (await (await GET()).json()) as Record<string, unknown>;
    expect(configured.rateLimitKeySecretConfigured).toBe(true);
    expect(configured).not.toHaveProperty("rateLimitKeySecret");
  });

  it("reports only the account-deletion cron switch state", async () => {
    const { GET } = await import(
      "../../app/api/health/maintenance/route"
    );
    process.env.ACCOUNT_DELETION_CRON_ENABLED = "false";
    const disabled = (await (await GET()).json()) as Record<string, unknown>;
    expect(disabled.accountDeletionCronEnabled).toBe(false);

    process.env.ACCOUNT_DELETION_CRON_ENABLED = "TRUE";
    const invalid = (await (await GET()).json()) as Record<string, unknown>;
    expect(invalid.accountDeletionCronEnabled).toBe(false);

    process.env.ACCOUNT_DELETION_CRON_ENABLED = "true";
    const enabled = (await (await GET()).json()) as Record<string, unknown>;
    expect(enabled.accountDeletionCronEnabled).toBe(true);
    expect(enabled).not.toHaveProperty("accountDeletionCronSecret");
  });

  it("reports the full deployment commit and research-intake switch without secrets", async () => {
    const { GET } = await import(
      "../../app/api/health/maintenance/route"
    );
    process.env.VERCEL_GIT_COMMIT_SHA = "A".repeat(40);
    process.env.RESEARCH_COHORT_APPLICATIONS_ENABLED = "false";
    const closed = (await (await GET()).json()) as Record<string, unknown>;
    expect(closed.deployment).toBe("a".repeat(40));
    expect(closed.researchCohortApplicationsEnabled).toBe(false);

    process.env.VERCEL_GIT_COMMIT_SHA = "not-a-commit";
    process.env.RESEARCH_COHORT_APPLICATIONS_ENABLED = "true";
    const open = (await (await GET()).json()) as Record<string, unknown>;
    expect(open.deployment).toBeNull();
    expect(open.researchCohortApplicationsEnabled).toBe(true);
    expect(open).not.toHaveProperty("researchEmailVerificationSecret");
  });
});
