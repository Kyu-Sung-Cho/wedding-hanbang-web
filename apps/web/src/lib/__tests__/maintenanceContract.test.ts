import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

const TEST_TURNSTILE_SECRET = [
  "0x4AAAAAAADDDDDDDD",
  "EEEEEEEEEEEEEEEE",
].join("");

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
const originalTurnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const originalTurnstileSecretKey = process.env.TURNSTILE_SECRET_KEY;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const originalCoupleCourtEnabled = process.env.COUPLE_COURT_ENABLED;
const originalCoupleCourtAiEnabled = process.env.COUPLE_COURT_AI_ENABLED;
const originalCoupleCourtPublicEnabled = process.env.COUPLE_COURT_PUBLIC_ENABLED;
const originalCoupleCourtMockEnabled = process.env.COUPLE_COURT_MOCK_ENABLED;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalOpenAiPrimaryModel = process.env.OPENAI_AMORA_PRIMARY_MODEL;
const originalOpenAiPrimaryReasoning = process.env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT;

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
  if (originalTurnstileSiteKey === undefined) {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  } else {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
  }
  if (originalTurnstileSecretKey === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = originalTurnstileSecretKey;
  }
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
  for (const [name, original] of [
    ["COUPLE_COURT_ENABLED", originalCoupleCourtEnabled],
    ["COUPLE_COURT_AI_ENABLED", originalCoupleCourtAiEnabled],
    ["COUPLE_COURT_PUBLIC_ENABLED", originalCoupleCourtPublicEnabled],
    ["COUPLE_COURT_MOCK_ENABLED", originalCoupleCourtMockEnabled],
    ["OPENAI_API_KEY", originalOpenAiApiKey],
    ["OPENAI_AMORA_PRIMARY_MODEL", originalOpenAiPrimaryModel],
    ["OPENAI_AMORA_PRIMARY_REASONING_EFFORT", originalOpenAiPrimaryReasoning],
  ] as const) {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
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
    expect(healthSource).toContain("turnstileCredentialsConfigured:");
    expect(healthSource).toContain("turnstileCanonicalHostnameConfigured:");
    expect(healthSource).toContain("turnstileConfigured:");
    expect(healthSource).toContain("deployment: configuredDeploymentCommit()");
    expect(healthSource).toContain("researchCohortApplicationsEnabled:");
    expect(healthSource).toContain("accountDeletionCronEnabled:");
    expect(healthSource).toContain("coupleCourtEnabled:");
    expect(healthSource).toContain("coupleCourtAiEnabled:");
    expect(healthSource).toContain("coupleCourtPublicEnabled:");
    expect(healthSource).toContain("coupleCourtMockEnabled:");
    expect(healthSource).toContain("coupleCourtProviderConfigured:");
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

  it("reports only whether both Turnstile credentials meet the strict boundary", async () => {
    const { GET } = await import(
      "../../app/api/health/maintenance/route"
    );
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const missing = (await (await GET()).json()) as Record<string, unknown>;
    expect(missing.turnstileCredentialsConfigured).toBe(false);
    expect(missing.turnstileCanonicalHostnameConfigured).toBe(false);
    expect(missing.turnstileConfigured).toBe(false);
    expect(missing).not.toHaveProperty("turnstileSiteKey");
    expect(missing).not.toHaveProperty("turnstileSecretKey");

    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY =
      "0x4AAAAAAABBBBBBBBCCCCCCCC";
    process.env.TURNSTILE_SECRET_KEY = TEST_TURNSTILE_SECRET;
    process.env.NEXT_PUBLIC_SITE_URL = "https://hanbang.ai";
    const configured = (await (await GET()).json()) as Record<string, unknown>;
    expect(configured.turnstileCredentialsConfigured).toBe(true);
    expect(configured.turnstileCanonicalHostnameConfigured).toBe(true);
    expect(configured.turnstileConfigured).toBe(true);
    expect(configured).not.toHaveProperty("turnstileSiteKey");
    expect(configured).not.toHaveProperty("turnstileSecretKey");

    process.env.NEXT_PUBLIC_SITE_URL = "https://untrusted.example";
    const wrongHostname = (await (await GET()).json()) as Record<string, unknown>;
    expect(wrongHostname.turnstileCredentialsConfigured).toBe(true);
    expect(wrongHostname.turnstileCanonicalHostnameConfigured).toBe(false);
    expect(wrongHostname.turnstileConfigured).toBe(false);
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

  it("reports exact raw Couple Court release switches without provider secrets", async () => {
    const { GET } = await import(
      "../../app/api/health/maintenance/route"
    );
    for (const name of [
      "COUPLE_COURT_ENABLED",
      "COUPLE_COURT_AI_ENABLED",
      "COUPLE_COURT_PUBLIC_ENABLED",
      "COUPLE_COURT_MOCK_ENABLED",
    ] as const) {
      delete process.env[name];
    }
    process.env.OPENAI_API_KEY = "invalid";
    const missing = (await (await GET()).json()) as Record<string, unknown>;
    expect(missing).toMatchObject({
      coupleCourtEnabled: false,
      coupleCourtAiEnabled: false,
      coupleCourtPublicEnabled: false,
      coupleCourtMockEnabled: false,
      coupleCourtProviderConfigured: false,
    });

    process.env.OPENAI_API_KEY = ["sk", "test-only-openai-key-1234567890"].join("-");
    process.env.OPENAI_AMORA_PRIMARY_MODEL = "gpt-5.6-terra";
    process.env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT = "none";
    process.env.COUPLE_COURT_ENABLED = "TRUE";
    process.env.COUPLE_COURT_AI_ENABLED = "false";
    process.env.COUPLE_COURT_PUBLIC_ENABLED = "true";
    process.env.COUPLE_COURT_MOCK_ENABLED = "true";
    const configured = (await (await GET()).json()) as Record<string, unknown>;
    expect(configured).toMatchObject({
      coupleCourtEnabled: false,
      coupleCourtAiEnabled: false,
      coupleCourtPublicEnabled: true,
      coupleCourtMockEnabled: true,
      coupleCourtProviderConfigured: true,
    });
    expect(configured).not.toHaveProperty("openAiApiKey");
    expect(configured).not.toHaveProperty("openAiModel");
    expect(configured).not.toHaveProperty("coupleCourtProviderSecret");
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
