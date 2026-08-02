import { describe, expect, it } from "vitest";

import { safeErrorDiagnostic } from "../safeErrorDiagnostic";

describe("safeErrorDiagnostic", () => {
  it("keeps only allowlisted diagnostic metadata", () => {
    const diagnostic = safeErrorDiagnostic({
      name: "AuthApiError",
      code: "email_exists",
      status: 422,
      message: "person@example.com already exists",
      details: "010-1234-5678",
      hint: "resident id 900101-1234567",
      request: { email: "person@example.com" },
    });

    expect(diagnostic).toEqual({
      name: "AuthApiError",
      code: "email_exists",
      status: 422,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("person@example.com");
    expect(JSON.stringify(diagnostic)).not.toContain("010-1234-5678");
    expect(JSON.stringify(diagnostic)).not.toContain("900101-1234567");
  });

  it("replaces attacker-controlled diagnostic fields with fixed fallbacks", () => {
    expect(safeErrorDiagnostic({
      name: "Error person@example.com",
      code: "bad code with input",
      status: 999,
    })).toEqual({
      name: "UnknownError",
      code: "unknown",
      status: null,
    });
  });

  it("does not accept token-shaped secrets as diagnostic names or codes", () => {
    const marker = ["sk", "ant", "secret-token-marker"].join("-");
    const diagnostic = safeErrorDiagnostic({ name: marker, code: marker });

    expect(diagnostic).toEqual({
      name: "UnknownError",
      code: "unknown",
      status: null,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(marker);
  });
});
