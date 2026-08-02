// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTERNAL_VENDOR_TOKEN_HEADER,
  verifyInternalVendorRequest,
} from "../internalAuth";

const CANONICAL_SECRET = "P8qJ3mV7rT2xK9cN4sL6wY1dF5gB0uA_zE-HoQi";
const LEGACY_SECRET = "V4nR8kD2yM7pQ1sT6wX3cF9hJ5uL0aB_zG-EiNo";

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
    vi.stubEnv("INTERNAL_API_TOKEN", CANONICAL_SECRET);
    delete process.env.VENDOR_INTERNAL_TOKEN;

    expect(verifyInternalVendorRequest(request(CANONICAL_SECRET))).toBe(true);
  });

  it("supports VENDOR_INTERNAL_TOKEN only as a legacy fallback", () => {
    delete process.env.INTERNAL_API_TOKEN;
    vi.stubEnv("VENDOR_INTERNAL_TOKEN", LEGACY_SECRET);

    expect(INTERNAL_VENDOR_TOKEN_HEADER).toBe("x-internal-token");
    expect(verifyInternalVendorRequest(request(LEGACY_SECRET))).toBe(true);
    expect(verifyInternalVendorRequest(request(`${LEGACY_SECRET}x`))).toBe(false);
    expect(verifyInternalVendorRequest(request())).toBe(false);
  });

  it("fails closed when canonical and legacy secrets conflict", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", CANONICAL_SECRET);
    vi.stubEnv("VENDOR_INTERNAL_TOKEN", LEGACY_SECRET);

    expect(verifyInternalVendorRequest(request(CANONICAL_SECRET))).toBe(false);
    expect(verifyInternalVendorRequest(request(LEGACY_SECRET))).toBe(false);
  });

  it("fails closed for absent, weak, repeated, or non-base64url secrets", () => {
    delete process.env.VENDOR_INTERNAL_TOKEN;
    expect(verifyInternalVendorRequest(request("anything"))).toBe(false);

    vi.stubEnv("VENDOR_INTERNAL_TOKEN", "too-short");
    expect(verifyInternalVendorRequest(request("too-short"))).toBe(false);

    vi.stubEnv("VENDOR_INTERNAL_TOKEN", "v".repeat(32));
    expect(verifyInternalVendorRequest(request("v".repeat(32)))).toBe(false);

    const specialCharacterSecret = "StrongMachineSecret_0123456789abcdef!";
    vi.stubEnv("VENDOR_INTERNAL_TOKEN", specialCharacterSecret);
    expect(verifyInternalVendorRequest(request(specialCharacterSecret))).toBe(false);
  });

  it("rejects oversized input before constant-time comparison", () => {
    vi.stubEnv("VENDOR_INTERNAL_TOKEN", LEGACY_SECRET);
    expect(verifyInternalVendorRequest(request("x".repeat(513)))).toBe(false);
  });
});
