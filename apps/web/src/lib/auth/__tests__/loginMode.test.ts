import { describe, expect, it } from "vitest";

import { loginModeFromSearch } from "../loginMode";

describe("loginModeFromSearch", () => {
  it.each([
    ["?mode=signup", "signup"],
    ["?mode=forgot", "forgot"],
    ["?mode=login", "login"],
  ] as const)("accepts the supported mobile fallback mode in %s", (search, expected) => {
    expect(loginModeFromSearch(search)).toBe(expected);
  });

  it.each(["", "?mode=admin", "?mode=signup%00", "?mode=SIGNUP"])(
    "fails closed to login for unsupported input %s",
    (search) => expect(loginModeFromSearch(search)).toBe("login"),
  );
});
