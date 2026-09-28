// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), cleanup: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.client }));
vi.mock("@/lib/providers/mediaCleanup", () => ({ cleanupProviderMedia: mocks.cleanup }));
vi.mock("@/utils/log", () => ({ log: { error: mocks.log } }));
import { GET } from "./route";
const request = (token = "test-secret") => new Request("https://hanbang.ai/api/cron/provider-media-cleanup", { headers: { authorization: `Bearer ${token}` } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "test-secret"); mocks.client.mockReturnValue({}); mocks.cleanup.mockResolvedValue({ claimed: 2, cleaned: 2, retired: 0, pending: 0 }); });
afterEach(() => vi.unstubAllEnvs());
describe("provider cleanup cron", () => {
  it("requires the configured secret before constructing any service client", async () => {
    expect((await GET(request("wrong"))).status).toBe(401); expect(mocks.client).not.toHaveBeenCalled();
    vi.stubEnv("CRON_SECRET", ""); expect((await GET(request())).status).toBe(401); expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("runs with bounded service requests and no-store responses", async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.client).toHaveBeenCalledWith({ requestTimeoutMs: 20_000 }); expect((await response.json()).cleaned).toBe(2);
  });
  it("reports incomplete cleanup for retry without leaking object paths", async () => {
    mocks.cleanup.mockResolvedValue({ claimed: 2, cleaned: 1, retired: 0, pending: 1 });
    expect((await GET(request())).status).toBe(503); expect(mocks.log).toHaveBeenCalledWith("provider-media/cleanup", new Error("PROVIDER_CLEANUP_RETRY_REQUIRED"));
  });
  it("redacts infrastructure errors while leaving the durable lease retryable", async () => {
    mocks.cleanup.mockRejectedValue(new Error("private/user/path"));
    const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private/user/path");
    expect(mocks.log).toHaveBeenCalledWith("provider-media/cleanup", new Error("PROVIDER_CLEANUP_UNAVAILABLE"));
  });
  it("adds one recurring cleanup without removing existing schedules", () => {
    const config: { crons: { path: string; schedule: string }[] } = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));
    expect(config.crons.filter((entry) => entry.path === "/api/cron/provider-media-cleanup")).toEqual([{ path: "/api/cron/provider-media-cleanup", schedule: "*/15 * * * *" }]);
    expect(config.crons.map((entry) => entry.path)).toEqual(expect.arrayContaining(["/api/cron/community-upload-cleanup", "/api/cron/account-deletion"]));
  });
});
