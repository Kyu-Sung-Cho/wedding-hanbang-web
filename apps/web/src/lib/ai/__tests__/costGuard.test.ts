import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AMORA_USAGE_LIMITS_ENABLED = "true";
});

import {
  markAmoraProviderStarted,
  reserveAmoraProviderCall,
  reserveAmoraUserTurn,
} from "../costGuard";

const BASE = { coupleId: "c1", isAdmin: false };

function makeAdmin(result: {
  allowed?: boolean;
  reason?: string | null;
  remaining?: number | null;
  providerRemaining?: number | null;
  reused?: boolean;
  error?: boolean;
  throws?: boolean;
}) {
  const rpc = vi.fn(async () => {
    if (result.throws) throw new Error("rpc boom");
    if (result.error) return { data: null, error: { message: "rpc unavailable" } };
    return {
      data: [{
        allowed: result.allowed ?? true,
        reason: result.reason ?? null,
        remaining: result.remaining ?? null,
        provider_remaining: result.providerRemaining ?? null,
        reused: result.reused ?? false,
      }],
      error: null,
    };
  });
  return { admin: { rpc } as never, rpc };
}

describe("split Amora usage reservations", () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.AMORA_COST_GUARD_ENABLED;
    delete process.env.AMORA_COST_GUARD_FAIL_OPEN;
    process.env.AMORA_USAGE_LIMITS_ENABLED = "true";
    delete process.env.AMORA_FREE_MESSAGES_PER_COUPLE;
    delete process.env.AMORA_GLOBAL_DAILY_PROVIDER_CALL_CAP;
    delete process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = ENV;
  });

  it("user turn reserves a provider slot without enforcing a lifetime couple quota", async () => {
    const { admin, rpc } = makeAdmin({ allowed: true, providerRemaining: 19 });
    const result = await reserveAmoraUserTurn(admin, BASE);
    expect(result).toEqual({ allowed: true, providerRemaining: 19 });
    expect(rpc).toHaveBeenCalledWith("reserve_amora_usage", {
      p_couple_id: "c1",
      p_couple_cap: 30,
      p_global_provider_cap: 60,
      p_count_user_turn: false,
    });
  });

  it("hidden Luna and extra Terra calls reserve provider usage only", async () => {
    const { admin, rpc } = makeAdmin({ allowed: true });
    const result = await reserveAmoraProviderCall(admin, BASE);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("reserve_amora_usage", expect.objectContaining({
      p_count_user_turn: false,
    }));
  });

  it("uses the idempotent reservation RPC when request identity is provided", async () => {
    const { admin, rpc } = makeAdmin({
      allowed: true,
      remaining: 29,
      providerRemaining: 58,
      reused: true,
    });
    const result = await reserveAmoraUserTurn(admin, {
      ...BASE,
      reservation: {
        requestKey: "a".repeat(64),
        requestHash: "b".repeat(64),
        providerOrdinal: 0,
      },
    });

    expect(result).toEqual({
      allowed: true,
      remaining: 29,
      providerRemaining: 58,
      reservationReused: true,
    });
    expect(rpc).toHaveBeenCalledWith("reserve_amora_usage_v2", expect.objectContaining({
      p_request_key: "a".repeat(64),
      p_request_hash: "b".repeat(64),
      p_provider_ordinal: 0,
    }));
  });

  it("admins use the same provider breaker without a lifetime quota", async () => {
    const { admin, rpc } = makeAdmin({ allowed: true });
    await reserveAmoraUserTurn(admin, { ...BASE, isAdmin: true });
    expect(rpc).toHaveBeenCalledWith("reserve_amora_usage", expect.objectContaining({
      p_count_user_turn: false,
    }));
  });

  it.each([
    ["global_daily", "global_daily"],
    ["couple_provider_daily", "couple_provider_daily"],
  ])("maps %s denial", async (rpcReason, expectedReason) => {
    const { admin } = makeAdmin({ allowed: false, reason: rpcReason });
    const result = await reserveAmoraUserTurn(admin, BASE);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(expectedReason);
    expect(result.message).toBeTruthy();
  });

  it("marks the exact request ordinal immediately before provider entry", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(markAmoraProviderStarted({ rpc } as never, {
      requestKey: "a".repeat(64),
      requestHash: "b".repeat(64),
      providerOrdinal: 1,
    })).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("mark_amora_provider_started", {
      p_request_key: "a".repeat(64),
      p_request_hash: "b".repeat(64),
      p_provider_ordinal: 1,
    });
  });

  it("treats an impossible legacy lifetime-quota response as a ledger failure", async () => {
    const { admin } = makeAdmin({ allowed: false, reason: "couple_quota" });
    await expect(reserveAmoraUserTurn(admin, BASE)).resolves.toMatchObject({
      allowed: false,
      reason: "guard_unavailable",
    });
  });

  it("fails closed when the atomic ledger is unavailable", async () => {
    const { admin } = makeAdmin({ error: true });
    await expect(reserveAmoraProviderCall(admin, BASE)).resolves.toMatchObject({
      allowed: false,
      reason: "guard_unavailable",
    });
  });

  it("fails closed on unexpected RPC output", async () => {
    const { admin } = makeAdmin({ allowed: false, reason: "invalid_args" });
    await expect(reserveAmoraUserTurn(admin, BASE)).resolves.toMatchObject({
      allowed: false,
      reason: "guard_unavailable",
    });
  });

  it("only an explicit fail-open environment override bypasses DB errors", async () => {
    process.env.AMORA_COST_GUARD_FAIL_OPEN = "true";
    vi.resetModules();
    const costGuardModule = await import("../costGuard");
    const { admin } = makeAdmin({ throws: true });
    await expect(costGuardModule.reserveAmoraProviderCall(admin, BASE)).resolves.toEqual({ allowed: true });
  });

  it("ignores the retired lifetime env and enforces the global ceiling", async () => {
    process.env.AMORA_FREE_MESSAGES_PER_COUPLE = "100";
    process.env.AMORA_GLOBAL_DAILY_PROVIDER_CALL_CAP = "300";
    vi.resetModules();
    const costGuardModule = await import("../costGuard");
    const { admin, rpc } = makeAdmin({ allowed: true });

    await costGuardModule.reserveAmoraUserTurn(admin, BASE);

    expect(rpc).toHaveBeenCalledWith("reserve_amora_usage", {
      p_couple_id: "c1",
      p_couple_cap: 30,
      p_global_provider_cap: 60,
      p_count_user_turn: false,
    });
  });

  it("still permits deployment variables to lower the global provider ceiling", async () => {
    process.env.AMORA_FREE_MESSAGES_PER_COUPLE = "10";
    process.env.AMORA_GLOBAL_DAILY_PROVIDER_CALL_CAP = "20";
    vi.resetModules();
    const costGuardModule = await import("../costGuard");
    const { admin, rpc } = makeAdmin({ allowed: true });

    await costGuardModule.reserveAmoraUserTurn(admin, BASE);

    expect(rpc).toHaveBeenCalledWith("reserve_amora_usage", {
      p_couple_id: "c1",
      p_couple_cap: 30,
      p_global_provider_cap: 20,
      p_count_user_turn: false,
    });
  });

  it("does not let legacy switches disable or fail open an explicitly enabled production ledger", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AMORA_USAGE_LIMITS_ENABLED = "true";
    process.env.AMORA_COST_GUARD_ENABLED = "false";
    process.env.AMORA_COST_GUARD_FAIL_OPEN = "true";
    vi.resetModules();
    const costGuardModule = await import("../costGuard");
    const { admin, rpc } = makeAdmin({ error: true });

    await expect(costGuardModule.reserveAmoraProviderCall(admin, BASE)).resolves.toMatchObject({
      allowed: false,
      reason: "guard_unavailable",
    });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
