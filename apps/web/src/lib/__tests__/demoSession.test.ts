import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDemoSessionToken,
  hasSignedDemoSessionFromCookieHeader,
  verifyDemoSessionToken,
} from "@/lib/demoSession";

describe("demo session secret boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_SESSION_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a signed fake-data session without Supabase in local/test", () => {
    const token = createDemoSessionToken();

    expect(token).toBeTypeOf("string");
    expect(verifyDemoSessionToken(token)).toBe(true);
    expect(hasSignedDemoSessionFromCookieHeader(`demo_mode=true; demo_session=${token}`)).toBe(true);
  });

  it("fails closed in production when no signing secret exists", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-must-not-sign-demo-sessions");
    vi.stubEnv("ADMIN_PASSWORD", "admin-secret-must-not-sign-demo-sessions");

    expect(createDemoSessionToken()).toBeNull();
  });

  it("rejects a short dedicated production signing secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_SESSION_SECRET", "too-short");

    expect(createDemoSessionToken()).toBeNull();
  });

  it("uses the dedicated production secret when configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_SESSION_SECRET", "test-only-demo-secret-with-at-least-32-characters");

    const token = createDemoSessionToken();
    expect(token).toBeTypeOf("string");
    expect(verifyDemoSessionToken(token)).toBe(true);
  });
});
