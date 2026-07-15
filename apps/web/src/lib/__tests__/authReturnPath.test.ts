import { describe, expect, it } from "vitest";
import {
  authReturnPathFromLocation,
  pathWithAuthReturn,
  sanitizeAuthReturnPath,
} from "@/lib/authReturnPath";

describe("auth return path", () => {
  it("preserves an internal Amora prefill journey", () => {
    const path = "/wedding/chat?prefill=%EC%9D%B4%20%EA%B2%AC%EC%A0%81";
    expect(sanitizeAuthReturnPath(path)).toBe(path);
    expect(pathWithAuthReturn("/login", path)).toBe(`/login?next=${encodeURIComponent(path)}`);
  });

  it("rejects open redirects and authentication loops", () => {
    expect(sanitizeAuthReturnPath("https://evil.example/wedding/chat")).toBeNull();
    expect(sanitizeAuthReturnPath("//evil.example/wedding/chat")).toBeNull();
    expect(sanitizeAuthReturnPath("/api/auth/callback")).toBeNull();
    expect(sanitizeAuthReturnPath("/wedding/onboarding")).toBeNull();
  });

  it("allows only wedding product routes", () => {
    expect(sanitizeAuthReturnPath("/wedding/lounge#today")).toBe("/wedding/lounge#today");
    expect(sanitizeAuthReturnPath("/login")).toBeNull();
  });

  it("preserves a non-sensitive post category through login and onboarding", () => {
    const query = new URLSearchParams({
      category: "is_normal",
    }).toString();
    const returnPath = authReturnPathFromLocation({
      pathname: "/wedding/community/post/write",
      search: `?${query}`,
    });

    expect(returnPath).toBe(`/wedding/community/post/write?${query}`);
    expect(pathWithAuthReturn("/wedding/onboarding?error=profile_unavailable", returnPath)).toBe(
      `/wedding/onboarding?error=profile_unavailable&next=${encodeURIComponent(returnPath!)}`
    );
  });

  it("keeps the current post fragment for a comment login return", () => {
    const returnPath = "/wedding/community/post/post-123#comments";
    expect(pathWithAuthReturn("/login", sanitizeAuthReturnPath(returnPath))).toBe(
      `/login?next=${encodeURIComponent(returnPath)}`
    );
  });
});
