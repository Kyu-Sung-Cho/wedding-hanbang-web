// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTERNAL_VENDOR_TOKEN_HEADER,
  verifyInternalVendorRequest,
} from "../internalAuth";

function request(token?: string) {
  return new Request("https://example.test/api/internal/vendors/recommend", {
    headers: token ? { "X-Internal-Token": token } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyInternalVendorRequest", () => {
  it("uses INTERNAL_API_TOKEN as the canonical secret", () => {
    const secret = "i".repeat(32);
    vi.stubEnv("INTERNAL_API_TOKEN", secret);
    delete process.env.VENDOR_INTERNAL_TOKEN;

    expect(verifyInternalVendorRequest(request(secret))).toBe(true);
  });

  it("supports VENDOR_INTERNAL_TOKEN only as a legacy fallback", () => {
    const secret = "v".repeat(32);
    delete process.env.INTERNAL_API_TOKEN;
    vi.stubEnv("VENDOR_INTERNAL_TOKEN", secret);

    expect(INTERNAL_VENDOR_TOKEN_HEADER).toBe("x-internal-token");
    expect(verifyInternalVendorRequest(request(secret))).toBe(true);
    expect(verifyInternalVendorRequest(request(`${secret}x`))).toBe(false);
    expect(verifyInternalVendorRequest(request())).toBe(false);
  });

  it("fails closed when canonical and legacy secrets conflict", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", "i".repeat(32));
    vi.stubEnv("VENDOR_INTERNAL_TOKEN", "v".repeat(32));

    expect(verifyInternalVendorRequest(request("i".repeat(32)))).toBe(false);
    expect(verifyInternalVendorRequest(request("v".repeat(32)))).toBe(false);
  });

  it("fails closed for an absent or weakly configured server secret", () => {
    delete process.env.VENDOR_INTERNAL_TOKEN;
    expect(verifyInternalVendorRequest(request("anything"))).toBe(false);

    vi.stubEnv("VENDOR_INTERNAL_TOKEN", "too-short");
    expect(verifyInternalVendorRequest(request("too-short"))).toBe(false);
  });

  it("rejects oversized input before constant-time comparison", () => {
    vi.stubEnv("VENDOR_INTERNAL_TOKEN", "v".repeat(32));
    expect(verifyInternalVendorRequest(request("x".repeat(513)))).toBe(false);
  });
});
