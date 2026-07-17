import { describe, expect, it } from "vitest";

import { buildMobileOAuthAppCallbackUrl } from "@hanbang/shared/utils";

describe("mobile OAuth PKCE callback", () => {
  it("returns to the app with only the one-time authorization code", () => {
    const callbackUrl = buildMobileOAuthAppCallbackUrl(
      "https://hanbang.ai/auth/mobile-callback?code=one-time-code",
    );

    expect(callbackUrl).toBe("hanbang://auth/callback?code=one-time-code");
    expect(callbackUrl).not.toContain("access_token");
    expect(callbackUrl).not.toContain("refresh_token");
  });

  it("rejects legacy callbacks that contain reusable session tokens", () => {
    expect(() =>
      buildMobileOAuthAppCallbackUrl(
        "https://hanbang.ai/auth/mobile-callback#access_token=access&refresh_token=refresh",
      ),
    ).toThrow("OAuth session tokens must not be transported in callback URLs");
  });
});
