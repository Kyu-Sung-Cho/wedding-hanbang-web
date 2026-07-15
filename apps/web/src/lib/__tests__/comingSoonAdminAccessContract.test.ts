import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSession: vi.fn(async (request: NextRequest) => new Response(null, {
    status: 204,
    headers: { "x-admin-session-path": request.nextUrl.pathname },
  })),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: mocks.updateSession,
}));

import { proxy } from "../../proxy";

const repoRoot = resolve(process.cwd(), "../..");
const proxySource = readFileSync(resolve(repoRoot, "apps/web/src/proxy.ts"), "utf8");
const adminPageSource = readFileSync(
  resolve(repoRoot, "apps/web/src/app/(admin)/admin/page.tsx"),
  "utf8"
);
const adminApiRoot = resolve(repoRoot, "apps/web/src/app/api/admin");

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}
const originalMaintenanceMode = process.env.MAINTENANCE_MODE;
const originalLaunchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE;

afterEach(() => {
  vi.clearAllMocks();
  if (originalMaintenanceMode === undefined) delete process.env.MAINTENANCE_MODE;
  else process.env.MAINTENANCE_MODE = originalMaintenanceMode;
  if (originalLaunchMode === undefined) delete process.env.NEXT_PUBLIC_LAUNCH_MODE;
  else process.env.NEXT_PUBLIC_LAUNCH_MODE = originalLaunchMode;
  vi.unstubAllEnvs();
});

describe("coming-soon protected administrator access", () => {
  it.each([
    ["missing", undefined],
    ["blank", ""],
    ["wrong case", "FULL"],
    ["unknown", "public"],
  ])("fails production API access closed when launch mode is %s", async (_label, mode) => {
    delete process.env.MAINTENANCE_MODE;
    if (mode === undefined) delete process.env.NEXT_PUBLIC_LAUNCH_MODE;
    else process.env.NEXT_PUBLIC_LAUNCH_MODE = mode;
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(new NextRequest("https://hanbang.ai/api/auth/signup", {
      method: "POST",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SERVICE_NOT_LAUNCHED",
    });
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });

  it("opens the application in production only for the explicit full mode", async () => {
    delete process.env.MAINTENANCE_MODE;
    process.env.NEXT_PUBLIC_LAUNCH_MODE = "full";
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(new NextRequest("https://hanbang.ai/api/auth/signup", {
      method: "POST",
    }));

    expect(response.status).toBe(204);
    expect(mocks.updateSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    "/admin/login",
    "/admin",
    "/admin/reports",
    "/api/admin/auth",
    "/api/admin/registrations",
  ])("routes %s through the existing session boundary", async (path) => {
    delete process.env.MAINTENANCE_MODE;
    process.env.NEXT_PUBLIC_LAUNCH_MODE = "coming_soon";

    const response = await proxy(new NextRequest(`https://hanbang.ai${path}`));

    expect(response.status).toBe(204);
    expect(response.headers.get("x-admin-session-path")).toBe(path);
    expect(mocks.updateSession).toHaveBeenCalledTimes(1);
  });

  it("does not turn administrator paths into public launch allowlist entries", () => {
    const publicAllowlist = proxySource.slice(
      proxySource.indexOf("const COMING_SOON_PUBLIC_PATHS"),
      proxySource.indexOf("function isComingSoonProtectedAdminPath")
    );

    expect(publicAllowlist).not.toContain('"/admin"');
    expect(publicAllowlist).not.toContain('"/api/admin"');
    expect(proxySource).toContain("return await updateSession(request)");
  });

  it("keeps every exposed administrator API behind its route-level authorization", () => {
    for (const path of routeFiles(adminApiRoot)) {
      const source = readFileSync(path, "utf8");
      if (path === resolve(adminApiRoot, "auth", "route.ts")) {
        expect(source).toContain("checkRateLimitPersistentStrict");
        expect(source).toContain("isInitialAdminSetupEnabled()");
        expect(source).toContain('process.env.NODE_ENV !== "production"');
      } else if (
        /synthetic_vendor_seed_retired|VENDOR_ADMIN_MUTATION_RETIRED|ADMIN_BOOKING_HISTORY_RETIRED/.test(source)
      ) {
        expect(source, path).toContain("status: 410");
        expect(source, path).toContain('"Cache-Control": "private, no-store, max-age=0"');
        expect(source, path).toMatch(/export (?:async )?function (?:GET|POST|PUT|PATCH)\(/);
        expect(source, path).not.toMatch(
          /verifyAdmin|createClient|SUPABASE_SERVICE_ROLE_KEY|request\.json|\.from\(/,
        );
      } else {
        expect(source, path).toContain("verifyAdmin(");
      }
    }
  });

  it("keeps maintenance mode authoritative over administrator access", async () => {
    process.env.MAINTENANCE_MODE = "true";
    process.env.NEXT_PUBLIC_LAUNCH_MODE = "coming_soon";

    const response = await proxy(new NextRequest("https://hanbang.ai/api/admin/registrations"));

    expect(response.status).toBe(503);
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });

  it("keeps research-review fields and receipt state visible to administrators", () => {
    for (const contract of [
      "사용자 연구 신청 목록",
      "wedding_date",
      "message",
      "privacy_policy_version",
      "expires_at",
      "receipt_email_status",
      "receipt_email_attempted_at",
    ]) {
      expect(adminPageSource).toContain(contract);
    }
  });
});
