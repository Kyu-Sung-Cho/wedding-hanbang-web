import { describe, expect, it } from "vitest";
import {
  getSignupSiteOrigin,
  normalizeSignupConfirmationLink,
} from "./signupConfirmationLink";

describe("signup confirmation link boundary", () => {
  it.each([
    ["https://hanbang.ai", "https://hanbang.ai"],
    ["https://www.hanbang.ai/", "https://www.hanbang.ai"],
  ])("accepts an approved production site origin", (raw, expected) => {
    expect(getSignupSiteOrigin(raw, true)).toBe(expected);
  });

  it.each([
    undefined,
    "https://attacker.example",
    "http://hanbang.ai",
    "https://hanbang.ai/path",
    "https://user:pass@hanbang.ai",
  ])("fails closed on an unapproved production site origin", (raw) => {
    expect(getSignupSiteOrigin(raw, true)).toBeNull();
  });

  it("allows a local-only HTTP origin outside production", () => {
    expect(getSignupSiteOrigin("http://localhost:3000", false)).toBe(
      "http://localhost:3000",
    );
  });

  it("accepts only the exact project verify URL and callback", () => {
    const callback = "https://hanbang.ai/api/auth/callback";
    const action = new URL("/auth/v1/verify", "https://project.supabase.co");
    action.searchParams.set("type", "signup");
    action.searchParams.set("token", "hashed_token-1234");
    action.searchParams.set("redirect_to", callback);

    expect(normalizeSignupConfirmationLink(
      action.toString(),
      "https://project.supabase.co",
      callback,
    )).toBe(action.toString());
  });

  it.each([
    "https://attacker.example/auth/v1/verify?type=signup&token=hashed_token-1234&redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
    "https://project.supabase.co/auth/v1/other?type=signup&token=hashed_token-1234&redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
    "https://project.supabase.co/auth/v1/verify?type=recovery&token=hashed_token-1234&redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
    "https://project.supabase.co/auth/v1/verify?type=signup&token=bad%22onclick%3Dalert%281%29&redirect_to=https%3A%2F%2Fhanbang.ai%2Fapi%2Fauth%2Fcallback",
    "https://project.supabase.co/auth/v1/verify?type=signup&token=hashed_token-1234&redirect_to=https%3A%2F%2Fattacker.example%2Fcallback",
  ])("rejects a provider link outside the exact contract", (actionLink) => {
    expect(normalizeSignupConfirmationLink(
      actionLink,
      "https://project.supabase.co",
      "https://hanbang.ai/api/auth/callback",
    )).toBeNull();
  });
});
