import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildShareablePageUrl } from "./shareUrl";

describe("buildShareablePageUrl", () => {
  it("shares only the same-origin path", () => {
    expect(buildShareablePageUrl(
      "https://hanbang.ai/community/post/123?email=bride@example.com&token=private#state=private",
      "https://hanbang.ai",
    )).toBe("https://hanbang.ai/community/post/123");
  });

  it("rejects a different origin or credentials", () => {
    expect(buildShareablePageUrl(
      "https://evil.example/community/post/123?token=private",
      "https://hanbang.ai",
    )).toBeNull();
    expect(buildShareablePageUrl(
      "https://user:password@hanbang.ai/community/post/123",
      "https://hanbang.ai",
    )).toBeNull();
  });

  it("keeps current-location sharing behind the canonicalizer", () => {
    const sources = [
      readFileSync(resolve(process.cwd(), "src/components/price/PriceExplorer.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/app/(community)/community/post/[id]/page.tsx"), "utf8"),
    ];

    for (const source of sources) {
      expect(source).toContain(
        "buildShareablePageUrl(window.location.href, window.location.origin)",
      );
      expect(source).not.toContain("const url = window.location.href");
      expect(source).not.toMatch(/url:\s*window\.location\.href/u);
    }
  });
});
