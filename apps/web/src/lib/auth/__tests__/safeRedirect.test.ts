import { describe, expect, it } from "vitest";

import {
  buildOnboardingRedirectPath,
  buildOAuthCallbackUrl,
  getAuthRedirectPath,
  getPostLoginRedirectPath,
  getSameOriginRedirectPath,
} from "@/lib/auth/safeRedirect";

describe("post-login redirect", () => {
  it("returns the requested same-origin path with its query and fragment intact", () => {
    expect(
      getAuthRedirectPath(
        "?redirect=%2Fprice%2Fwishlist%3Fcategory%3Dstudio%23saved",
        "https://hanbang.ai",
      ),
    ).toBe("/price/wishlist?category=studio#saved");
  });

  it.each([
    "?redirect=%2Fprice%2F%252F%252Fattacker.example",
    "?redirect=%2Fprice%2F%25252F%25252Fattacker.example",
    "?redirect=%2Fprice%2Fwishlist%00",
    "?redirect=%2Fsafe%2F%252e%252e%2F%2Fattacker.example",
    "?redirect=%2F.%2F%2Fattacker.example",
  ])("fails closed for encoded path separators or control bytes: %s", (search) => {
    expect(getAuthRedirectPath(search, "https://hanbang.ai")).toBe("/wedding/lounge");
  });

  it("carries a valid requested path through the OAuth callback URL", () => {
    expect(
      buildOAuthCallbackUrl("?redirect=%2Fprice%2Fwishlist", "https://hanbang.ai"),
    ).toBe(
      "https://hanbang.ai/api/auth/callback?redirect=%2Fprice%2Fwishlist",
    );
  });

  it.each([
    "?redirect=https%3A%2F%2Fattacker.example%2Fsteal",
    "?redirect=%2F%2Fattacker.example%2Fsteal",
    "?redirect=%2F%5Cattacker.example%2Fsteal",
    "?redirect=javascript%3Aalert%281%29",
    "?redirect=%2Fwedding%2Fonboarding",
    "?redirect=%2Fapi%2Fauth%2Fdelete",
    "?redirect=%2Fadmin%2Fprice",
    "?redirect=%2F_next%2Fstatic%2Fasset.js",
    "?redirect=%2Fauth%2Fmobile-callback",
    "?redirect=%2Flogin%2Fretry",
  ])("does not carry an unsafe or looping destination into OAuth: %s", (search) => {
    expect(buildOAuthCallbackUrl(search, "https://hanbang.ai")).toBe(
      "https://hanbang.ai/api/auth/callback",
    );
  });

  it("carries a valid destination through the onboarding-first step", () => {
    expect(
      buildOnboardingRedirectPath(
        "?redirect=%2Fprice%2Fwishlist",
        "https://hanbang.ai",
      ),
    ).toBe("/wedding/onboarding?redirect=%2Fprice%2Fwishlist");
  });

  it("keeps the opaque start-here handoff inside the chat destination", () => {
    const chatPath = "/wedding/chat?startHereHandoff=0f75ca2a-94c1-4d9c-83e3-a45981c98673";
    const search = `?${new URLSearchParams({ redirect: chatPath })}`;

    expect(buildOAuthCallbackUrl(search, "https://hanbang.ai")).toBe(
      `https://hanbang.ai/api/auth/callback?redirect=${encodeURIComponent(chatPath)}`,
    );
    expect(buildOnboardingRedirectPath(search, "https://hanbang.ai")).toBe(
      `/wedding/onboarding?redirect=${encodeURIComponent(chatPath)}`,
    );
    expect(getAuthRedirectPath(search, "https://hanbang.ai")).toBe(chatPath);
  });

  it("keeps onboarding first and then returns to the requested destination", () => {
    const search = "?redirect=%2Fprice%2Fwishlist";
    expect(getPostLoginRedirectPath(search, "https://hanbang.ai", false)).toBe(
      "/wedding/onboarding?redirect=%2Fprice%2Fwishlist",
    );
    expect(getPostLoginRedirectPath(search, "https://hanbang.ai", true)).toBe(
      "/price/wishlist",
    );
  });

  it.each([
    "",
    "?redirect=https%3A%2F%2Fattacker.example%2Fsteal",
    "?redirect=%2Fprice%2F%25252F%25252Fattacker.example",
    "?redirect=%2Fsafe%2F%252e%252e%2F%2Fattacker.example",
    "?redirect=%2Fwedding%2Fonboarding",
  ])("does not propagate an unsafe or looping destination into onboarding: %s", (search) => {
    expect(buildOnboardingRedirectPath(search, "https://hanbang.ai")).toBe(
      "/wedding/onboarding",
    );
  });
});

describe("same-origin password reset redirect", () => {
  it("rejects a protocol-relative external destination", () => {
    expect(
      getSameOriginRedirectPath("//attacker.example/sign-in", "https://hanbang.ai"),
    ).toBe("/login");
  });
});
