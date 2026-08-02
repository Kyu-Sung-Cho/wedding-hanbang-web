import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("onboarding return journey boundary", () => {
  it("uses the same safe destination for already-complete, submitted and invite-modal exits", () => {
    const onboarding = source("src/app/(auth)/onboarding/page.tsx");
    const safeAssignments = onboarding.match(
      /window\.location\.href = getAuthRedirectPath\(/g,
    ) ?? [];
    const safeReplacements = onboarding.match(
      /window\.location\.replace\(getAuthRedirectPath\(/g,
    ) ?? [];

    expect(safeAssignments).toHaveLength(2);
    expect(safeReplacements).toHaveLength(1);
    expect(onboarding).not.toContain('window.location.href = "/wedding/lounge"');
  });

  it("keeps the requested destination when login must finish onboarding first", () => {
    const login = source("src/app/(auth)/login/page.tsx");

    expect(login).toContain("getPostLoginRedirectPath(");
    expect(login).not.toContain('window.location.href = "/wedding/onboarding"');
  });
});
