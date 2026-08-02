import { describe, expect, it } from "vitest";

import { userFacingSignInError } from "./userFacingAuthError";

describe("userFacingSignInError", () => {
  it("maps reviewed Auth failures to fixed user copy", () => {
    expect(userFacingSignInError("Invalid login credentials"))
      .toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
    expect(userFacingSignInError("Email not confirmed"))
      .toBe("이메일 인증이 완료되지 않았습니다.");
    expect(userFacingSignInError("Too many requests: retry after 60 seconds"))
      .toBe("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
  });

  it("never renders an unknown provider message verbatim", () => {
    const privateMarker = "failure for bride@example.com token=oauth-secret";
    const result = userFacingSignInError(privateMarker, "관리자 로그인에 실패했습니다.");

    expect(result).toBe("관리자 로그인에 실패했습니다.");
    expect(result).not.toContain(privateMarker);
    expect(result).not.toContain("bride@example.com");
  });
});
