import { describe, expect, it } from "vitest";

import {
  REPOSITORY_PRODUCTION_PROJECT_REFS,
  SupabaseDestinationError,
  verifySupabaseServiceDestination,
} from "../destinationFence";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";
const URL = `https://${PROJECT_REF}.supabase.co`;
const PRODUCTION_REF = REPOSITORY_PRODUCTION_PROJECT_REFS[0]!;
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;

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

  // 이 fence의 "여기가 운영인가" 판정이 SUPABASE_PRODUCTION_PROJECT_REF 하나에만
  // 걸려 있었다. 그 값은 목적지를 정하는 env가 함께 정하므로, 로컬 모양의 env가
  // 운영 ref를 잘못 적어두면 목적지는 진짜 운영인데 fence는 "운영이 아니다"로
  // 읽고 확인 문자열 없이 service-role 쓰기를 통과시켰다.
  describe("repository-pinned production identity", () => {
    function productionDestinationInput(overrides: Record<string, unknown> = {}) {
      return validInput({
        url: PRODUCTION_URL,
        expectedUrl: PRODUCTION_URL,
        expectedProjectRef: PRODUCTION_REF,
        serviceRoleKey: jwt({
          iss: "supabase",
          ref: PRODUCTION_REF,
          role: "service_role",
          aud: "authenticated",
        }),
        // 목적지는 운영이지만, env는 운영을 다른 프로젝트라고 주장한다.
        productionProjectRef: OTHER_REF,
        ...overrides,
      });
    }

    it("refuses an unconfirmed write when env misstates which project is production", () => {
      expect(() => verifySupabaseServiceDestination(productionDestinationInput())).toThrowError(
        expect.objectContaining({ code: "PRODUCTION_WRITE_CONFIRMATION_REQUIRED" }),
      );

      expect(() => verifySupabaseServiceDestination(productionDestinationInput({
        access: "operator-write",
      }))).toThrowError(
        expect.objectContaining({ code: "PRODUCTION_WRITE_CONFIRMATION_REQUIRED" }),
      );
    });

    it("accepts the pinned production destination once the scoped confirmation is present", () => {
      expect(verifySupabaseServiceDestination(productionDestinationInput({
        productionWriteConfirmation: `RUNTIME_WRITE:${PRODUCTION_REF}`,
      }))).toMatchObject({ projectRef: PRODUCTION_REF, url: PRODUCTION_URL });
    });

    it("still allows an explicitly read-only client against the pinned production project", () => {
      expect(verifySupabaseServiceDestination(productionDestinationInput({
        access: "read",
      }))).toMatchObject({ projectRef: PRODUCTION_REF });
    });

    it("keeps non-production destinations free of the production confirmation", () => {
      expect(verifySupabaseServiceDestination(validInput())).toMatchObject({
        projectRef: PROJECT_REF,
      });
    });
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
