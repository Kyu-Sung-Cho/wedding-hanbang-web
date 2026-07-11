import { describe, expect, it } from "vitest";
import { pathWithAuthReturn, sanitizeAuthReturnPath } from "@/lib/authReturnPath";

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
});
