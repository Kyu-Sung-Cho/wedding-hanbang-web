// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { ADMIN_STEP_UP_COOKIE, createAdminStepUpToken } from "./adminStepUp";
import { verifyAdmin } from "@/lib/utils/adminAuth";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts" ? [path] : [];
  });
}

describe("admin API step-up boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_PASSWORD", "admin-bootstrap-secret-longer-than-32-characters");
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: ADMIN_ID } },
        }),
      },
    });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { is_admin: true } }),
          })),
        })),
      })),
    });
  });

  it("rejects a valid Supabase administrator until the signed step-up is present", async () => {
    await expect(verifyAdmin(new Request("https://hanbang.ai/api/admin/customers")))
      .resolves.toEqual({ authorized: false });

    const token = createAdminStepUpToken(ADMIN_ID);
    await expect(verifyAdmin(new Request("https://hanbang.ai/api/admin/customers", {
      headers: { cookie: `${ADMIN_STEP_UP_COOKIE}=${token}` },
    }))).resolves.toEqual({ authorized: true, userId: ADMIN_ID });
  });

  it("rejects a cookie bound to a different administrator", async () => {
    const token = createAdminStepUpToken("22222222-2222-4222-8222-222222222222");
    await expect(verifyAdmin(new Request("https://hanbang.ai/api/admin/customers", {
      headers: { cookie: `${ADMIN_STEP_UP_COOKIE}=${token}` },
    }))).resolves.toEqual({ authorized: false });
  });

  it("rejects cookie-authenticated admin mutations without same-origin evidence", async () => {
    const token = createAdminStepUpToken(ADMIN_ID);
    await expect(verifyAdmin(new Request("https://hanbang.ai/api/admin/vendors/target", {
      method: "PATCH",
      headers: { cookie: `${ADMIN_STEP_UP_COOKIE}=${token}` },
    }))).resolves.toEqual({ authorized: false });
  });

  it("accepts a same-origin admin mutation with a valid step-up", async () => {
    const token = createAdminStepUpToken(ADMIN_ID);
    await expect(verifyAdmin(new Request("https://hanbang.ai/api/admin/vendors/target", {
      method: "PATCH",
      headers: {
        cookie: `${ADMIN_STEP_UP_COOKIE}=${token}`,
        origin: "https://hanbang.ai",
        "sec-fetch-site": "same-origin",
      },
    }))).resolves.toEqual({ authorized: true, userId: ADMIN_ID });
  });

  it("routes every protected admin endpoint through the centralized gate", () => {
    const apiRoot = resolve(process.cwd(), "src/app/api/admin");
    const unprotected = routeFiles(apiRoot)
      .filter((file) => relative(apiRoot, file).replaceAll("\\", "/") !== "auth/route.ts")
      .filter((file) => !/\bverifyAdmin\s*\(/u.test(readFileSync(file, "utf8")))
      .map((file) => relative(apiRoot, file).replaceAll("\\", "/"));

    expect(unprotected).toEqual([]);
  });
});
