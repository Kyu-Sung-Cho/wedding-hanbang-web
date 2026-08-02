import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => mocks);

describe("privacy-safe logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("never forwards a raw provider error or message to Sentry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { log } = await import("./log");
    const privateMarker = "private-wedding-plan bride@example.com";

    log.error("provider request failed", {
      name: "PostgrestError",
      code: "23505",
      status: 409,
      message: privateMarker,
      details: { requestBody: privateMarker },
    });

    expect(mocks.captureException).toHaveBeenCalledOnce();
    const [captured, context] = mocks.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("OPERATIONAL_FAILURE");
    expect(JSON.stringify({ captured, context })).not.toContain(privateMarker);
    expect(context).toEqual({
      tags: {
        "error.name": "PostgrestError",
        "error.code": "23505",
        "error.status": "409",
      },
    });
  });

  it("does not print a raw error object in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { log } = await import("./log");
    const privateMarker = "private-form-value";

    log.error("provider request failed", {
      code: "provider_failed",
      message: privateMarker,
      body: { note: privateMarker },
    });

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateMarker);
    expect(errorSpy).toHaveBeenCalledWith(
      "provider request failed",
      { name: "UnknownError", code: "unknown", status: null },
    );
  });
});
