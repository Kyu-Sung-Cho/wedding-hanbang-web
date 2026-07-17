import { describe, expect, it } from "vitest";

import { getSameOriginRedirectPath } from "@/lib/auth/safeRedirect";

describe("same-origin password reset redirect", () => {
  it("rejects a protocol-relative external destination", () => {
    expect(
      getSameOriginRedirectPath("//attacker.example/sign-in", "https://hanbang.ai"),
    ).toBe("/login");
  });
});
