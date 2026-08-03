import { describe, expect, it } from "vitest";

import secretPolicyCorpus from "../../../../../packages/shared/src/security/serverSecretPolicy.corpus.json";

import { verifySecretBearerRequest } from "./secretBearer";

const SECRET = "G7mY2qV9xN4sK8dP1fR6wT3cH5jL0uB_zA-EiQo";

type SecretPolicyCase = {
  name: string;
  secret: string;
  accepted: boolean;
};

const SECRET_POLICY_CORPUS = secretPolicyCorpus as SecretPolicyCase[];

function request(authorization?: string) {
  return new Request("https://hanbang.ai/api/cron/example", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("verifySecretBearerRequest", () => {
  it("applies the canonical server-secret corpus", () => {
    for (const policyCase of SECRET_POLICY_CORPUS) {
      expect(
        verifySecretBearerRequest(
          request(`Bearer ${policyCase.secret}`),
          policyCase.secret,
        ),
        policyCase.name,
      ).toBe(policyCase.accepted);
    }
  });

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

  it("rejects malformed Bearer credentials and oversized values", () => {
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
