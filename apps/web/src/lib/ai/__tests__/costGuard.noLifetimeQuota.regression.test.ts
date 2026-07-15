import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AMORA_USAGE_LIMITS_ENABLED = "true";
});

import {
  checkAmoraCostGuard,
  reserveAmoraUserTurn,
} from "../costGuard";

const COUPLE = { coupleId: "couple-1", isAdmin: false };

function rpcResult(row: Record<string, unknown>) {
  return { data: [row], error: null };
}

describe("Amora paid-credit quota policy regression", () => {
  it("does not let the legacy lifetime couple count block a new user turn", async () => {
    const rpc = vi.fn(async (_name: string, params: { p_count_user_turn?: boolean }) => {
      // This simulates an account that exhausted the old 30-turn beta counter.
      // The supported policy must stop asking the ledger to enforce that legacy
      // lifetime count while still reserving the provider call atomically.
      return params.p_count_user_turn
        ? rpcResult({ allowed: false, reason: "couple_quota" })
        : rpcResult({ allowed: true, remaining: null, provider_remaining: 9 });
    });
    const admin = { rpc } as never;

    await expect(checkAmoraCostGuard(admin, COUPLE)).resolves.toMatchObject({
      allowed: true,
      providerRemaining: 9,
    });
    await expect(reserveAmoraUserTurn(admin, COUPLE)).resolves.toMatchObject({
      allowed: true,
      providerRemaining: 9,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, params]) => params.p_count_user_turn)).toEqual([false, false]);
  });

  it.each([
    ["couple_provider_daily", "오늘 이 커플의 아모라 이용량"],
    ["global_daily", "오늘 아모라 이용량"],
  ])("keeps %s provider-cost denial terminal", async (reason, messageFragment) => {
    const rpc = vi.fn(async () => rpcResult({ allowed: false, reason }));
    const admin = { rpc } as never;

    await expect(checkAmoraCostGuard(admin, COUPLE)).resolves.toMatchObject({
      allowed: false,
      reason,
      message: expect.stringContaining(messageFragment),
    });
    await expect(reserveAmoraUserTurn(admin, COUPLE)).resolves.toMatchObject({
      allowed: false,
      reason,
      message: expect.stringContaining(messageFragment),
    });
  });

  it("keeps a quota-ledger outage fail-closed", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { name: "PostgrestError", code: "ledger_unavailable" },
    }));
    const admin = { rpc } as never;

    await expect(checkAmoraCostGuard(admin, COUPLE)).resolves.toMatchObject({
      allowed: false,
      reason: "guard_unavailable",
    });
    await expect(reserveAmoraUserTurn(admin, COUPLE)).resolves.toMatchObject({
      allowed: false,
      reason: "guard_unavailable",
    });
  });
});
