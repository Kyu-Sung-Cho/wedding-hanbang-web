import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeMobileAuthReturnPath } from "@hanbang/shared";

const repoRoot = resolve(process.cwd(), "../..");

function mobileSource(path: string) {
  return readFileSync(resolve(repoRoot, "apps/mobile", path), "utf8");
}

function webSource(path: string) {
  return readFileSync(resolve(repoRoot, "apps/web", path), "utf8");
}

describe("mobile auth reliability contract", () => {
  it("allows only explicitly supported local post-login destinations", () => {
    expect(sanitizeMobileAuthReturnPath("/community/post/write")).toBe("/community/post/write");
    expect(sanitizeMobileAuthReturnPath("/community/quick-review")).toBe("/community/quick-review");
    expect(sanitizeMobileAuthReturnPath("/community/my-posts")).toBe("/community/my-posts");
    expect(sanitizeMobileAuthReturnPath("/community/my-bookmarks")).toBe("/community/my-bookmarks");

    expect(sanitizeMobileAuthReturnPath("https://evil.example/community/post/write")).toBeNull();
    expect(sanitizeMobileAuthReturnPath("//evil.example/community/post/write")).toBeNull();
    expect(sanitizeMobileAuthReturnPath("/community/post/attacker-controlled")).toBeNull();
    expect(sanitizeMobileAuthReturnPath("/(auth)/login")).toBeNull();
  });

  it("never maps a mobile profile query error to onboarding or login", () => {
    const source = mobileSource("app/index.tsx");

    expect(source).toContain("profileError");
    expect(source).toContain('setStatus("error")');
    expect(source).toContain("consumePendingMobileAuthReturnPath");
    expect(source).not.toMatch(/catch\s*\{\s*setDest\("login"\)/);
  });

  it("keeps a root session lookup failure distinct from signed-out state", () => {
    const source = mobileSource("app/_layout.tsx");

    expect(source).toContain("session load failed");
    expect(source).toContain('setAuthStatus("error")');
    expect(source).toContain('event === "INITIAL_SESSION"');
    expect(source).not.toMatch(
      /catch\([^)]*\)\s*=>\s*\{[\s\S]*?setAuthStatus\("signed-out"\)/,
    );
  });

  it("guards protected community intents before their screens render", () => {
    const source = mobileSource("app/community/_layout.tsx");

    expect(source).toContain("sanitizeMobileAuthReturnPath");
    expect(source).toContain("savePendingMobileAuthReturnPath");
    expect(source).toContain('<Redirect href="/(auth)/login"');
  });

  it("does not turn a session storage error during an API call into logout", () => {
    const source = mobileSource("src/lib/api.ts");
    const errorCheck = source.indexOf("if (sessionError)");
    const missingTokenCheck = source.indexOf("if (!token)");

    expect(errorCheck).toBeGreaterThan(-1);
    expect(missingTokenCheck).toBeGreaterThan(errorCheck);
  });

  it("does not retain text drafts after the unsupported mobile writers are retired", () => {
    const postSource = mobileSource("app/community/post/write.tsx");
    const reviewSource = mobileSource("app/community/quick-review.tsx");

    expect(postSource).toContain('<Redirect href="/(tabs)/community"');
    expect(reviewSource).toContain('<Redirect href="/community/post/write"');
    expect(`${postSource}\n${reviewSource}`).not.toMatch(
      /AsyncStorage|saveCommunityPostDraft|saveQuickReviewDraft/,
    );
    expect(
      existsSync(resolve(repoRoot, "apps/mobile/src/lib/communityDrafts.ts")),
    ).toBe(false);
  });
});

describe("web auth initialization reliability contract", () => {
  it("renders a blocking retry state for typed initialization errors", () => {
    const source = webSource("src/app/(app)/AppClientLayout.tsx");

    expect(source).toContain("initError");
    expect(source).toContain("retryAuthentication");
    expect(source).toContain('initialize({ force: true })');
    expect(source).toContain('role="alert"');
  });
});
