import { afterEach, describe, expect, it, vi } from "vitest";
import { seedGate } from "@/lib/utils/adminAuth";

describe("seedGate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks production even when a stale ALLOW_SEED override is present", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_SEED", "true");

    const response = seedGate();

    expect(response?.status).toBe(403);
  });

  it("allows explicit local development tooling to reach the authenticated route", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "preview");

    expect(seedGate()).toBeNull();
  });
});
