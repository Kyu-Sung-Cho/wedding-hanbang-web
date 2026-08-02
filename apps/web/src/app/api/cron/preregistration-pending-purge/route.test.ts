import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  verifySecretBearerRequest: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/secretBearer", () => ({
  verifySecretBearerRequest: mocks.verifySecretBearerRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

describe("preregistration pending purge operation switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "secure-cron-secret");
    vi.stubEnv("PREREGISTRATION_PENDING_PURGE_ENABLED", "false");
    mocks.verifySecretBearerRequest.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ data: 4, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("rejects unauthenticated invocations", async () => {
    mocks.verifySecretBearerRequest.mockReturnValue(false);
    const response = await GET(new Request("https://hanbang.ai/api/cron/preregistration-pending-purge"));
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("stays fail-closed until the exact operation flag is enabled", async () => {
    const response = await GET(new Request("https://hanbang.ai/api/cron/preregistration-pending-purge"));
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: false,
      status: "disabled",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("purges only the bounded expired-intent batch through the service RPC", async () => {
    vi.stubEnv("PREREGISTRATION_PENDING_PURGE_ENABLED", "true");
    const response = await GET(new Request("https://hanbang.ai/api/cron/preregistration-pending-purge"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: true,
      status: "completed",
      purged: 4,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("purge_expired_preregistration_intents", {
      p_limit: 1000,
    });
  });

  it("fails closed on an out-of-contract provider result", async () => {
    vi.stubEnv("PREREGISTRATION_PENDING_PURGE_ENABLED", "true");
    mocks.rpc.mockResolvedValue({ data: 1001, error: null });
    const response = await GET(new Request("https://hanbang.ai/api/cron/preregistration-pending-purge"));
    expect(response.status).toBe(500);
  });

  it("pins a bounded recurring production schedule", () => {
    const config = JSON.parse(readFileSync(
      resolve(process.cwd(), "vercel.json"),
      "utf8",
    )) as { crons: Array<{ path: string; schedule: string }> };
    expect(config.crons.find((entry) =>
      entry.path === "/api/cron/preregistration-pending-purge"
    )).toEqual({
      path: "/api/cron/preregistration-pending-purge",
      schedule: "*/15 * * * *",
    });
  });
});
