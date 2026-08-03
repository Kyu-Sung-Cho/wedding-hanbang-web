import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureRequestError: vi.fn(),
  init: vi.fn(),
  verifyServiceDestination: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureRequestError: mocks.captureRequestError,
  init: mocks.init,
}));
vi.mock("@/lib/supabase/destinationFence", () => ({
  verifyRuntimeSupabaseServiceDestination: mocks.verifyServiceDestination,
}));

describe("server instrumentation Preview isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "inherited-service-role-fixture");
    vi.stubEnv("SENTRY_DSN", "https://public@o123.ingest.sentry.io/1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not validate inherited service credentials or initialize/send telemetry in stub mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    const { onRequestError, register } = await import("./instrumentation");

    await register();
    onRequestError(new Error("fixture"), {} as never, {} as never);

    expect(mocks.verifyServiceDestination).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.captureRequestError).not.toHaveBeenCalled();
  });

  it("keeps the non-stub service destination startup fence", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "false");
    const { register } = await import("./instrumentation");

    await register();

    expect(mocks.verifyServiceDestination).toHaveBeenCalledOnce();
    expect(mocks.init).toHaveBeenCalledOnce();
  });
});
