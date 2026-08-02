import { describe, expect, it } from "vitest";

import { verifySecretBearerRequest } from "./secretBearer";

const SECRET = "G7mY2qV9xN4sK8dP1fR6wT3cH5jL0uB_zA-EiQo";

function request(authorization?: string) {
  return new Request("https://hanbang.ai/api/cron/example", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("verifySecretBearerRequest", () => {
  it("accepts only the exact configured Bearer credential", () => {
    expect(verifySecretBearerRequest(request(`Bearer ${SECRET}`), SECRET)).toBe(true);
    expect(verifySecretBearerRequest(request(`Bearer ${SECRET}x`), SECRET)).toBe(false);
    expect(verifySecretBearerRequest(request(), SECRET)).toBe(false);
  });

  it("fails closed for weak or missing configured secrets", () => {
    expect(verifySecretBearerRequest(request("Bearer short"), "short")).toBe(false);
    expect(
      verifySecretBearerRequest(request(`Bearer ${"a".repeat(32)}`), "a".repeat(32)),
    ).toBe(false);
    expect(verifySecretBearerRequest(request(`Bearer ${SECRET}`), undefined)).toBe(false);
  });

  it("rejects values outside the canonical base64url grammar and oversized values", () => {
    const specialCharacterSecret = "StrongMachineSecret_0123456789abcdef!";
    expect(verifySecretBearerRequest(request(`Basic ${SECRET}`), SECRET)).toBe(false);
    expect(
      verifySecretBearerRequest(
        request(`Bearer ${specialCharacterSecret}`),
        specialCharacterSecret,
      ),
    ).toBe(false);
    expect(verifySecretBearerRequest(request(`Bearer ${"a".repeat(513)}`), SECRET)).toBe(false);
  });
});
