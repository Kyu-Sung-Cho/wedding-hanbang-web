import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("onboarding joined handoff redirect", () => {
  it("marks only a successful invite join for the dashboard handoff", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(auth)/onboarding/page.tsx"),
      "utf8",
    );

    expect(source).toContain('store.coupleAction === "join"');
    expect(source).toContain("buildJoinedDashboardRedirect()");
    expect(source).toContain('requestedPath !== "/wedding/lounge"');
    expect(source).toContain("return window.location.search");
    expect(source).not.toContain("localStorage");
  });
});
