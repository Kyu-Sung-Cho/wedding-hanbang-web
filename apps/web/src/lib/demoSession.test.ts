import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDemoSessionToken,
  hasSignedDemoSessionFromCookieHeader,
  verifyDemoSessionToken,
} from "./demoSession";

describe("demo session signing secret", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("fails closed when the signing secret is shorter than 32 bytes", () => {
    vi.stubEnv("DEMO_SESSION_SECRET", "a".repeat(31));

    expect(createDemoSessionToken()).toBeNull();
  });

  it("fails closed when the signing secret contains only whitespace", () => {
    vi.stubEnv("DEMO_SESSION_SECRET", " ".repeat(32));

    expect(createDemoSessionToken()).toBeNull();
  });

  it("keeps the existing token and cookie contract with a 32-byte secret", () => {
    vi.stubEnv("DEMO_SESSION_SECRET", "0123456789abcdef0123456789abcdef");
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_060_000);
    const existingToken =
      "1800000000000.cHeXqE70FFbAKcuwHASHDdGqK2tV2aoE3ftaxmRFh88";

    expect(createDemoSessionToken(1_800_000_000_000)).toBe(existingToken);
    expect(verifyDemoSessionToken(existingToken)).toBe(true);
    expect(
      hasSignedDemoSessionFromCookieHeader(
        `demo_mode=true; demo_session=${existingToken}`,
      ),
    ).toBe(true);
  });

  it("measures the minimum in UTF-8 bytes rather than characters", () => {
    vi.stubEnv("DEMO_SESSION_SECRET", "가".repeat(11));

    expect(createDemoSessionToken()).not.toBeNull();
  });
});
