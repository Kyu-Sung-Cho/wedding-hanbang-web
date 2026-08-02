import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = [
  "src/app/api/admin/price/auto-approve/route.ts",
  "src/app/api/admin/price/demand/route.ts",
  "src/app/api/price/vendor-options/route.ts",
] as const;

const LOGIN_PAGES = [
  "src/app/(auth)/login/page.tsx",
  "src/app/demo/login/page.tsx",
] as const;

describe("provider error privacy contracts", () => {
  it.each(ROUTES)("does not copy a provider message into a thrown Error: %s", (route) => {
    const source = readFileSync(resolve(process.cwd(), route), "utf8");

    expect(source).not.toMatch(/throw new Error\([^\r\n;]*\b\w*[Ee]rror\.message/u);
  });

  it.each(LOGIN_PAGES)("does not render provider callback text directly: %s", (page) => {
    const source = readFileSync(resolve(process.cwd(), page), "utf8");

    expect(source).toContain("consumePendingLoginError()");
    expect(source).not.toMatch(/\.get\(["']error_description["']\)/u);
    expect(source).not.toMatch(/setError\([^\r\n;]*\b(?:oauthError|signInError)\.message/u);
  });
});
