import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("signup consent boundary", () => {
  it("requires exact policy versions and never accepts marketing consent", () => {
    const login = read("src/app/(auth)/login/page.tsx");
    const route = read("src/app/api/auth/signup/route.ts");

    for (const source of [login, route]) {
      expect(source).toContain("SIGNUP_TERMS_VERSION");
      expect(source).toContain("SIGNUP_PRIVACY_VERSION");
    }
    expect(route).toContain("signup_consent_version_mismatch");
    expect(route).toContain("marketing_consent_not_collected");
    expect(route).toContain("marketing_agreed: false");
    expect(route).not.toContain("marketingAgreed === true");
  });
});
