import { beforeEach, describe, expect, it, vi } from "vitest";

interface TestSentryOptions {
  beforeBreadcrumb?: (breadcrumb: Record<string, unknown>) => Record<string, unknown>;
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown>;
  beforeSendTransaction?: (event: Record<string, unknown>) => Record<string, unknown>;
  sendDefaultPii?: boolean;
}

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  init: vi.fn<(options: TestSentryOptions) => void>(),
}));

vi.mock("@sentry/nextjs", () => mocks);

describe("browser Sentry privacy boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.invalid/1");
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: (callback: () => void) => callback(),
    });
  });

  it("clears the browser URL and filters events, breadcrumbs, and transactions", async () => {
    const accessToken = "browser-access-marker";
    const refreshToken = "browser-refresh-marker";
    window.history.replaceState(
      {},
      "",
      `/reset-password?redirect=%2Flogin#access_token=${accessToken}&refresh_token=${refreshToken}&type=recovery`,
    );

    await import("./instrumentation-client");
    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce());

    expect(window.location.href).not.toContain(accessToken);
    expect(window.location.href).not.toContain(refreshToken);
    expect(window.location.search).toBe("?redirect=%2Flogin");

    const options = mocks.init.mock.calls[0][0];
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");
    expect(options.beforeSendTransaction).toBeTypeOf("function");
    expect(options.sendDefaultPii).toBe(false);

    const event = options.beforeSend?.({
      request: { url: `https://hanbang.ai/#access_token=${accessToken}` },
    });
    const breadcrumb = options.beforeBreadcrumb?.({
      data: { url: `https://hanbang.ai/?code=${refreshToken}` },
    });
    const transaction = options.beforeSendTransaction?.({
      transaction: `/reset-password?code=${accessToken}`,
    });

    expect(JSON.stringify({ event, breadcrumb, transaction })).not.toContain(accessToken);
    expect(JSON.stringify({ event, breadcrumb, transaction })).not.toContain(refreshToken);
  });
});
