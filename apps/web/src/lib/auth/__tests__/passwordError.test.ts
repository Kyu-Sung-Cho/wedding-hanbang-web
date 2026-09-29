import { describe, expect, it } from "vitest";
import { getPasswordErrorMessage } from "@hanbang/shared";

const PWNED = "유출된 적이 있는 비밀번호는 사용할 수 없어요. 다른 사이트에서 쓰지 않는 새 비밀번호를 입력해 주세요.";
const WEAK = "보안 기준에 맞지 않는 비밀번호예요. 더 길고 추측하기 어려운 새 비밀번호를 입력해 주세요.";

describe("비밀번호의 안전한 공유 오류 안내", () => {
  it("같은 비밀번호 코드는 오류명보다 우선하며 원문 없이 다른 비밀번호를 안내한다", () => {
    const error = { code: "same_password", name: "AuthWeakPasswordError", reasons: ["pwned"], message: "민감한 원문" };
    expect(getPasswordErrorMessage(error)).toBe("지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.");
  });
  it("유출 사유를 코드로 식별하고 서버 원문을 버린다", () => {
    const error = Object.assign(new Error("민감한 provider detail token=secret"), {
      name: "AuthWeakPasswordError", code: "weak_password", reasons: ["length", "pwned"],
    });
    expect(getPasswordErrorMessage(error)).toBe(PWNED);
  });

  it.each([undefined, null, [], ["length"], ["characters"], ["unknown-sensitive-reason"], "pwned", { pwned: true }].map((reasons) => ({ reasons })))(
    "구조화된 pwned 배열이 없는 사유 %j에는 강도 안내만 한다",
    ({ reasons }) => {
      expect(getPasswordErrorMessage({ code: "weak_password", reasons, message: "민감한 원문" })).toBe(WEAK);
    },
  );

  it("코드가 없는 이전 SDK 오류명도 처리한다", () => {
    expect(getPasswordErrorMessage({ name: "AuthWeakPasswordError", reasons: ["pwned"] })).toBe(PWNED);
  });

  it.each([null, undefined, 0, "weak_password", new Error("weak password"), {}, { reasons: ["pwned"] },
    { name: "AuthWeakPasswordError", code: "email_exists", reasons: ["pwned"] },
    { name: "AuthWeakPasswordError", code: "", reasons: ["pwned"] },
  ])("다른 오류 %j를 약한 비밀번호 오류로 바꾸지 않는다", (value) => {
    expect(getPasswordErrorMessage(value)).toBeNull();
  });

  it("성공 로그인에 함께 온 경고를 실패로 분류하지 않는다", () => {
    const result = { data: { session: { access_token: "synthetic" }, weakPassword: { reasons: ["pwned"], message: "weak" } }, error: null };
    expect(getPasswordErrorMessage(result)).toBeNull();
    expect(getPasswordErrorMessage(result.data.weakPassword)).toBeNull();
  });
});
