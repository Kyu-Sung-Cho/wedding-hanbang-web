// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_STEP_UP_COOKIE,
  ADMIN_STEP_UP_MAX_AGE_SECONDS,
  createAdminStepUpToken,
  hasAdminStepUp,
  verifyAdminStepUpToken,
} from "./adminStepUp";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const NONCE = "abcdefghijklmnopqrstuv";

describe("admin step-up token", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "admin-bootstrap-secret-longer-than-32-characters");
  });

  it("binds a signed token to one admin for exactly fifteen minutes", () => {
    const token = createAdminStepUpToken(ADMIN_ID, NOW, NONCE);
    expect(token).toBeTypeOf("string");
    expect(verifyAdminStepUpToken(token, ADMIN_ID, NOW)).toBe(true);
    expect(verifyAdminStepUpToken(token, OTHER_ID, NOW)).toBe(false);
    expect(verifyAdminStepUpToken(
      token,
      ADMIN_ID,
      NOW + ADMIN_STEP_UP_MAX_AGE_SECONDS * 1000,
    )).toBe(false);
  });

  it("rejects tampering, malformed identities, weak secrets, and future tokens", () => {
    const token = createAdminStepUpToken(ADMIN_ID, NOW, NONCE)!;
    expect(verifyAdminStepUpToken(`${token.slice(0, -1)}A`, ADMIN_ID, NOW)).toBe(false);
    expect(createAdminStepUpToken("admin-1", NOW, NONCE)).toBeNull();

    vi.stubEnv("ADMIN_PASSWORD", "too-short");
    expect(createAdminStepUpToken(ADMIN_ID, NOW, NONCE)).toBeNull();
    expect(verifyAdminStepUpToken(token, ADMIN_ID, NOW)).toBe(false);

    vi.stubEnv("ADMIN_PASSWORD", "admin-bootstrap-secret-longer-than-32-characters");
    const future = createAdminStepUpToken(ADMIN_ID, NOW + 31_000, NONCE);
    expect(verifyAdminStepUpToken(future, ADMIN_ID, NOW)).toBe(false);
  });

  it("reads only the exact HttpOnly cookie name", () => {
    const token = createAdminStepUpToken(ADMIN_ID, NOW, NONCE)!;
    expect(hasAdminStepUp(
      `unrelated=value; ${ADMIN_STEP_UP_COOKIE}=${token}`,
      ADMIN_ID,
      NOW,
    )).toBe(true);
    expect(hasAdminStepUp(`wrong=${token}`, ADMIN_ID, NOW)).toBe(false);
  });
});
