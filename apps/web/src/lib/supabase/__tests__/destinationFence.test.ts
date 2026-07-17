import { describe, expect, it } from "vitest";

import {
  SupabaseDestinationError,
  verifySupabaseServiceDestination,
} from "../destinationFence";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";
const URL = `https://${PROJECT_REF}.supabase.co`;

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    url: URL,
    serviceRoleKey: jwt({
      iss: "supabase",
      ref: PROJECT_REF,
      role: "service_role",
      aud: "authenticated",
    }),
    expectedUrl: URL,
    expectedProjectRef: PROJECT_REF,
    productionProjectRef: OTHER_REF,
    access: "runtime" as const,
    ...overrides,
  };
}

describe("verifySupabaseServiceDestination", () => {
  it("accepts only an exact canonical URL/ref pair and matching service-role JWT claims", () => {
    expect(verifySupabaseServiceDestination(validInput())).toMatchObject({
      url: URL,
      projectRef: PROJECT_REF,
      keyKind: "jwt",
    });
  });

  it.each([
    ["missing expected URL", { expectedUrl: undefined }, "EXPECTED_URL_MISSING"],
    ["missing expected ref", { expectedProjectRef: undefined }, "EXPECTED_REF_INVALID"],
    ["URL allowlist mismatch", { expectedUrl: `https://${OTHER_REF}.supabase.co` }, "URL_MISMATCH"],
    ["URL/ref mismatch", { expectedProjectRef: OTHER_REF }, "URL_REF_MISMATCH"],
    ["URL with a path", { url: `${URL}/rest/v1` }, "URL_INVALID"],
    ["URL with a query", { url: `${URL}?target=${OTHER_REF}` }, "URL_INVALID"],
    ["non-TLS URL", { url: `http://${PROJECT_REF}.supabase.co` }, "URL_INVALID"],
    ["JWT project mismatch", { serviceRoleKey: jwt({ iss: "supabase", ref: OTHER_REF, role: "service_role" }) }, "JWT_REF_MISMATCH"],
    ["JWT role mismatch", { serviceRoleKey: jwt({ iss: "supabase", ref: PROJECT_REF, role: "authenticated" }) }, "JWT_ROLE_MISMATCH"],
    ["JWT issuer mismatch", { serviceRoleKey: jwt({ iss: "attacker", ref: PROJECT_REF, role: "service_role" }) }, "JWT_ISS_MISMATCH"],
    ["JWT audience mismatch", { serviceRoleKey: jwt({ iss: "supabase", ref: PROJECT_REF, role: "service_role", aud: "anon" }) }, "JWT_AUD_MISMATCH"],
  ])("fails closed for %s", (_label, overrides, code) => {
    expect(() => verifySupabaseServiceDestination(validInput(overrides))).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("accepts a structurally valid opaque Supabase secret while retaining URL/ref pinning", () => {
    expect(verifySupabaseServiceDestination(validInput({
      serviceRoleKey: `sb_secret_${"a".repeat(40)}`,
    }))).toMatchObject({ keyKind: "opaque" });
  });

  it("requires an exact, project-scoped opt-in for production runtime writes", () => {
    const productionInput = validInput({ productionProjectRef: PROJECT_REF });
    expect(() => verifySupabaseServiceDestination(productionInput)).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_WRITE_CONFIRMATION_REQUIRED" }),
    );

    expect(verifySupabaseServiceDestination({
      ...productionInput,
      productionWriteConfirmation: `RUNTIME_WRITE:${PROJECT_REF}`,
    })).toMatchObject({ projectRef: PROJECT_REF });
  });

  it("does not require write opt-in for an explicitly read-only production client", () => {
    expect(verifySupabaseServiceDestination(validInput({
      productionProjectRef: PROJECT_REF,
      access: "read",
    }))).toMatchObject({ projectRef: PROJECT_REF });
  });

  it("never includes the service-role secret in an error", () => {
    const secret = "do-not-print-this-service-role-secret";
    let caught: unknown;
    try {
      verifySupabaseServiceDestination(validInput({ serviceRoleKey: secret }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SupabaseDestinationError);
    expect(String(caught)).not.toContain(secret);
  });
});
