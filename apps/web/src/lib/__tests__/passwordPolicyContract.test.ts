import { describe, expect, it } from "vitest";
import { isStrongPassword } from "@hanbang/shared";

describe("shared password policy", () => {
  it("accepts the signup policy", () => {
    expect(isStrongPassword("Wedding1!" )).toBe(true);
  });

  it.each(["123456", "password1!", "PASSWORD1!", "Password!", "Pass1!"])(
    "rejects weak password %s",
    (password) => expect(isStrongPassword(password)).toBe(false)
  );
});
