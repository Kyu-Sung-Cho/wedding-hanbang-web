import { describe, expect, it } from "vitest";

import { parseAuthorizationHeader } from "./bearerAuthorization";
import { isTrustedMutationRequest } from "./trustedMutation";

function request(headers: HeadersInit = {}) {
  return new Request("https://hanbang.example/api/favorites", {
    method: "POST",
    headers,
  });
}

describe("strict mutation authorization", () => {
  it("parses the HTTP Bearer scheme consistently regardless of scheme case", () => {
    expect(parseAuthorizationHeader("bearer abc.def-123_xyz")).toEqual({
      kind: "bearer",
      token: "abc.def-123_xyz",
    });
    expect(parseAuthorizationHeader("Bearer  abc.def")).toEqual({ kind: "invalid" });
    expect(parseAuthorizationHeader("Basic abc.def")).toEqual({ kind: "invalid" });
    expect(parseAuthorizationHeader(null)).toEqual({ kind: "absent" });
  });

  it("accepts a non-ambient Bearer credential and leaves validation to Supabase", () => {
    expect(isTrustedMutationRequest(request({
      authorization: "bearer abc.def-123_xyz",
      "sec-fetch-site": "cross-site",
    }))).toBe(true);
  });

  it("never falls back to same-origin cookie trust when Authorization is malformed", () => {
    for (const authorization of ["Basic attacker", "Bearer", "Bearer  token", "Bearer token extra"]) {
      expect(isTrustedMutationRequest(request({
        authorization,
        origin: "https://hanbang.example",
        "sec-fetch-site": "same-origin",
        cookie: "sb-session=ambient-cookie",
      }))).toBe(false);
    }
  });

  it("keeps same-origin metadata mandatory for cookie-only mutations", () => {
    expect(isTrustedMutationRequest(request({
      origin: "https://hanbang.example",
      "sec-fetch-site": "same-origin",
    }))).toBe(true);
    expect(isTrustedMutationRequest(request({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }))).toBe(false);
  });
});
