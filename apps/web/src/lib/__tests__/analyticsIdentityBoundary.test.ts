import { beforeEach, describe, expect, it, vi } from "vitest";
import { THIRD_PARTY_ANALYTICS_CONSENT_KEY } from "@/lib/analyticsPrivacy";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

describe("analytics account boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
    window.localStorage.setItem(THIRD_PARTY_ANALYTICS_CONSENT_KEY, "granted");
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: (callback: () => void) => callback(),
    });
  });

  it("drops account A's queued event and rotates the memory id before B captures", async () => {
    const { useAuthStore } = await import("@/stores/authStore");
    useAuthStore.setState({
      user: { id: "account-a", email: "a@example.test" },
    });
    const { captureEvent } = await import("@/lib/analytics");

    captureEvent("account_a_private_action");
    useAuthStore.setState({
      user: { id: "account-b", email: "b@example.test" },
    });

    await vi.waitFor(() => expect(posthog.reset).toHaveBeenCalledOnce());
    expect(posthog.capture).not.toHaveBeenCalled();

    captureEvent("account_b_action", { surface: "dashboard" });
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledWith(
      "account_b_action",
      { surface: "dashboard" },
    ));
  });
});
