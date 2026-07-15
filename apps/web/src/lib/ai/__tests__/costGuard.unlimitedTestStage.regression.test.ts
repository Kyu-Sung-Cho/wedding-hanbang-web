import { afterEach, describe, expect, it, vi } from "vitest";

const ENV = process.env;

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = ENV;
  vi.resetModules();
});

describe("Amora unlimited test-stage policy", () => {
  it("meters provider attempts without calling or enforcing a usage-cap RPC by default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AMORA_USAGE_LIMITS_ENABLED;
    vi.resetModules();

    const { checkAmoraCostGuard, markAmoraProviderStarted, reserveAmoraUserTurn } =
      await import("../costGuard");
    const rpc = vi.fn(async (name: string) => {
      if (name === "reserve_amora_usage_unlimited_v1") {
        return {
          data: [{ allowed: true, reason: null, reused: false }],
          error: null,
        };
      }
      if (name === "mark_amora_provider_started") {
        return { data: true, error: null };
      }
      return {
        data: [{ allowed: false, reason: "global_daily" }],
        error: null,
      };
    });
    const admin = { rpc } as never;
    const identity = {
      requestKey: "a".repeat(64),
      requestHash: "b".repeat(64),
      providerOrdinal: 0 as const,
    };

    await expect(checkAmoraCostGuard(admin, { coupleId: "c1", isAdmin: false }))
      .resolves.toEqual({ allowed: true });
    await expect(reserveAmoraUserTurn(admin, {
      coupleId: "c1",
      isAdmin: false,
      reservation: identity,
    })).resolves.toEqual({ allowed: true });
    await expect(markAmoraProviderStarted(admin, identity)).resolves.toBeUndefined();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "reserve_amora_usage_unlimited_v1",
      "mark_amora_provider_started",
    ]);
  });

  it("keeps the durable limiter available only through an explicit future opt-in", async () => {
    vi.stubEnv("AMORA_USAGE_LIMITS_ENABLED", "true");
    vi.resetModules();

    const { reserveAmoraUserTurn } = await import("../costGuard");
    const rpc = vi.fn(async () => ({
      data: [{ allowed: false, reason: "couple_provider_daily" }],
      error: null,
    }));

    await expect(reserveAmoraUserTurn({ rpc } as never, {
      coupleId: "c1",
      isAdmin: false,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "couple_provider_daily",
    });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
