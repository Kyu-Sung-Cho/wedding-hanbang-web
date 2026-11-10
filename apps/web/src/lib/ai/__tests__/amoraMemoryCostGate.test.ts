import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reserve: vi.fn() }));

vi.mock("@/lib/ai/costGuard", () => ({
  reserveAmoraTurn: mocks.reserve,
}));

import {
  AmoraMemoryBudgetDeferredError,
  assertAmoraMemoryProviderBudget,
  createAmoraMemoryProviderBudgetGate,
  deferAmoraMemoryJobForBudget,
} from "@/lib/ai/amoraMemoryCostGate";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const JOB_ID = "20000000-0000-4000-8000-000000000001";

describe("Amora memory provider cost gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reserves exactly one Luna call from the background budget", async () => {
    const admin = { rpc: vi.fn() };
    mocks.reserve.mockResolvedValue({ allowed: true });

    await expect(assertAmoraMemoryProviderBudget(admin as never, COUPLE_ID))
      .resolves.toBeUndefined();
    expect(mocks.reserve).toHaveBeenCalledWith(admin, {
      coupleId: COUPLE_ID,
      isAdmin: false,
      quotaScope: "background",
      maxCostMicrousd: 17_680,
    });
  });

  it("turns a closed or unavailable budget into a typed pre-generation deferral", async () => {
    const admin = { rpc: vi.fn() };
    mocks.reserve.mockResolvedValue({ allowed: false, reason: "global_budget" });

    await expect(assertAmoraMemoryProviderBudget(admin as never, COUPLE_ID))
      .rejects.toEqual(expect.objectContaining({
        name: "AmoraMemoryBudgetDeferredError",
        reason: "global_budget",
      }));
    expect(await mocks.reserve.mock.results[0]?.value).toEqual({
      allowed: false,
      reason: "global_budget",
    });
  });

  // The cron puts the budget check in front of both provider gates (token
  // counting and generation). One compile is one paid call, so the two gates
  // must share one reservation instead of taking two turns from the global day.
  it("reserves once per compile even when both provider gates ask", async () => {
    const admin = { rpc: vi.fn() };
    mocks.reserve.mockResolvedValue({ allowed: true });
    const reserveOnce = createAmoraMemoryProviderBudgetGate(admin as never, COUPLE_ID);

    await expect(reserveOnce()).resolves.toBeUndefined();
    await expect(reserveOnce()).resolves.toBeUndefined();

    expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });

  it("gives every compile its own reservation", async () => {
    const admin = { rpc: vi.fn() };
    mocks.reserve.mockResolvedValue({ allowed: true });

    await createAmoraMemoryProviderBudgetGate(admin as never, COUPLE_ID)();
    await createAmoraMemoryProviderBudgetGate(admin as never, COUPLE_ID)();

    expect(mocks.reserve).toHaveBeenCalledTimes(2);
  });

  it("does not reserve again after the first gate was denied", async () => {
    const admin = { rpc: vi.fn() };
    mocks.reserve.mockResolvedValue({ allowed: false, reason: "global_budget" });
    const reserveOnce = createAmoraMemoryProviderBudgetGate(admin as never, COUPLE_ID);
    const deferred = expect.objectContaining({
      name: "AmoraMemoryBudgetDeferredError",
      reason: "global_budget",
    });

    await expect(reserveOnce()).rejects.toEqual(deferred);
    await expect(reserveOnce()).rejects.toEqual(deferred);

    expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });

  it("releases the exact claimed attempt without consuming it", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const admin = { rpc };

    await deferAmoraMemoryJobForBudget(admin as never, {
      jobId: JOB_ID,
      attemptCount: 3,
      reason: "global_budget",
    });

    expect(rpc).toHaveBeenCalledWith("defer_amora_memory_job", {
      p_job_id: JOB_ID,
      p_attempt_count: 3,
      p_defer_seconds: 3_600,
      p_reason_code: "GLOBAL_BUDGET",
    });
  });

  it("fails closed when the lease release is stale or unavailable", async () => {
    const stale = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) };
    const unavailable = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "down" } }),
    };

    await expect(deferAmoraMemoryJobForBudget(stale as never, {
      jobId: JOB_ID,
      attemptCount: 1,
      reason: "global_budget",
    })).rejects.toThrow(/MEMORY_BUDGET_DEFER_FAILED/);
    await expect(deferAmoraMemoryJobForBudget(unavailable as never, {
      jobId: JOB_ID,
      attemptCount: 1,
      reason: "guard_unavailable",
    })).rejects.toThrow(/MEMORY_BUDGET_DEFER_FAILED/);
  });

  it("exposes only the expected denial reasons", () => {
    expect(new AmoraMemoryBudgetDeferredError(undefined).reason).toBe("guard_unavailable");
  });
});
