import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  rpc: vi.fn(),
  runtimeEnabled: vi.fn(),
  repair: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdmin,
}));

vi.mock("@/lib/ai/amoraMemoryQueue", () => ({
  getAmoraMemoryEnablement: vi.fn(),
  isAuxiliaryMemoryRuntimeEnabled: mocks.runtimeEnabled,
}));

vi.mock("@/lib/ai/amoraMemoryRepair", () => ({
  repairMissingAmoraMemoryJobs: mocks.repair,
}));

import { GET } from "./route";

function request(secret = "cron-secret") {
  return new NextRequest("http://localhost/api/cron/amora-memory", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("/api/cron/amora-memory enqueue repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    mocks.runtimeEnabled.mockReturnValue(true);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_amora_memory_job") {
        return { data: [], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.rpc });
    mocks.repair.mockResolvedValue({
      status: "repaired",
      scanned: 2,
      queued: 1,
      duplicate: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("repairs a bounded missing-job page before claiming the existing queue", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      enabled: true,
      repairScanned: 2,
      repairQueued: 1,
      repairDuplicate: 1,
      repairSkipped: 0,
      repairFailed: 0,
      repairUnavailable: false,
      claimed: 0,
    });
    expect(mocks.repair).toHaveBeenCalledWith(
      expect.anything(),
      20,
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_memory_job",
      { p_lease_seconds: 300 },
    );
    expect(mocks.repair.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("continues the pre-existing claim loop when repair is unavailable", async () => {
    mocks.repair.mockResolvedValueOnce({ status: "unavailable" });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      repairUnavailable: true,
      repairScanned: 0,
      repairQueued: 0,
      repairFailed: 0,
      claimed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_memory_job",
      { p_lease_seconds: 300 },
    );
  });

  it("continues the pre-existing claim loop when a repair candidate is retained after failure", async () => {
    mocks.repair.mockResolvedValueOnce({
      status: "repaired",
      scanned: 1,
      queued: 0,
      duplicate: 0,
      skipped: 0,
      failed: 1,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      repairScanned: 1,
      repairFailed: 1,
      repairUnavailable: false,
      claimed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_memory_job",
      { p_lease_seconds: 300 },
    );
  });

  it("does not scan or claim while the auxiliary-memory kill switch is off", async () => {
    mocks.runtimeEnabled.mockReturnValue(false);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: false,
      claimed: 0,
    });
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid cron secret before repair", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
