import { describe, expect, it } from "vitest";
import {
  buildPasswordRecoveryLink,
  escapeHtmlAttribute,
  getConfiguredSiteOrigin,
} from "./passwordRecoveryLink";

describe("password recovery link boundary", () => {
  it.each([
    ["https://hanbang.ai", "https://hanbang.ai"],
    ["https://www.hanbang.ai/", "https://www.hanbang.ai"],
    ["http://localhost:3000", "http://localhost:3000"],
  ])("accepts a canonical configured origin", (value, expected) => {
    expect(getConfiguredSiteOrigin(value)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "http://hanbang.ai",
    "https://user:pass@hanbang.ai",
    "https://hanbang.ai/path",
    "https://hanbang.ai/?next=evil",
    "javascript:alert(1)",
  ])("rejects an unsafe configured site URL", (value) => {
    expect(getConfiguredSiteOrigin(value)).toBeNull();
  });

  it("builds a first-party token_hash link and allowlists the post-reset path", () => {
    expect(buildPasswordRecoveryLink(
      "https://hanbang.ai",
      "hash+/=marker",
      "/admin/login",
    )).toBe(
      "https://hanbang.ai/reset-password?redirect=%2Fadmin%2Flogin#token_hash=hash%2B%2F%3Dmarker&type=recovery",
    );

    expect(buildPasswordRecoveryLink(
      "https://hanbang.ai",
      "marker",
      "//attacker.example",
    )).toBe("https://hanbang.ai/reset-password#token_hash=marker&type=recovery");
  });

  it("rejects absent and unreasonably large recovery material", () => {
    expect(buildPasswordRecoveryLink("https://hanbang.ai", "   ")).toBeNull();
    expect(buildPasswordRecoveryLink("https://hanbang.ai", "a".repeat(2049))).toBeNull();
  });

  it("escapes links before interpolating them into HTML attributes and text", () => {
    expect(escapeHtmlAttribute('https://hanbang.ai/reset?a=1&b="<x>"')).toBe(
      "https://hanbang.ai/reset?a=1&amp;b=&quot;&lt;x&gt;&quot;",
    );
  });
});
