import { describe, expect, it } from "vitest";
import { sanitizeServerConsoleArguments } from "@/lib/logging/serverConsolePrivacy";

describe("server console privacy boundary", () => {
  it("never forwards free-text exception, PostgREST, or user payload fields", () => {
    const sentinel = "victim@example.com SECRET_POST_BODY";
    const output = sanitizeServerConsoleArguments("error", [
      `Create post failed for ${sentinel}`,
      {
        name: "PostgrestError",
        code: "23514",
        status: 400,
        message: sentinel,
        details: `Failing row contains (${sentinel})`,
        hint: sentinel,
      },
      new Error(sentinel),
    ]).join(" ");

    expect(output).not.toContain(sentinel);
    expect(output).not.toContain("SECRET_POST_BODY");
    expect(output).not.toContain("Failing row contains");
    expect(output).toContain("SERVER_DIAGNOSTIC");
    expect(output).toContain("code_sqlstate_class_23");
    expect(output).toContain("status_400");
  });

  it("accepts only an exact source-controlled event label", () => {
    expect(sanitizeServerConsoleArguments("warn", [
      "AUTH_SIGNUP_DELIVERY_FAILED_COMPENSATED",
    ])).toEqual([
      "SERVER_WARNING",
      "AUTH_SIGNUP_DELIVERY_FAILED_COMPENSATED",
      "no_structured_code",
    ]);

    expect(sanitizeServerConsoleArguments("warn", [
      "AUTH_SIGNUP_DELIVERY_FAILED_COMPENSATED private@example.com",
    ])).toEqual([
      "SERVER_WARNING",
      "SERVER_DIAGNOSTIC",
      "no_structured_code",
    ]);
  });

  it("keeps only the fixed orphan-remediation schema", () => {
    const incidentId = "018f47a6-23d4-7bc1-9eef-6c9e87654321";
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const output = sanitizeServerConsoleArguments("error", [
      "AUTH_SIGNUP_COMPENSATION_FAILED",
      {
        incidentId,
        userId,
        reason: "email_delivery_failed",
        severity: "critical",
        email: "private@example.com",
        detail: "SECRET_POST_BODY",
        code: "private-code-SECRET_POST_BODY",
      },
    ]);

    expect(output).toContain(`incident_id:${incidentId}`);
    expect(output).toContain(`user_id:${userId}`);
    expect(output).toContain("reason:email_delivery_failed");
    expect(output).toContain("severity:critical");
    expect(output.join(" ")).not.toContain("private@example.com");
    expect(output.join(" ")).not.toContain("SECRET_POST_BODY");
  });

  it("does not retain malformed remediation identifiers or arbitrary codes", () => {
    const output = sanitizeServerConsoleArguments("error", [
      "AUTH_SIGNUP_COMPENSATION_FAILED",
      {
        incidentId: "incident-private@example.com",
        userId: "SECRET_POST_BODY",
        reason: "private_reason",
        severity: "private_severity",
        name: "SECRET_POST_BODY",
        code: "SECRET_POST_BODY",
      },
    ]).join(" ");

    expect(output).not.toContain("private@example.com");
    expect(output).not.toContain("SECRET_POST_BODY");
    expect(output).toContain("name_other");
    expect(output).toContain("code_other");
  });
});
