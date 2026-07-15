import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("retired quote-check interaction regression", () => {
  it("contains no selectable checklist controls or submission request", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(community)/community/quote-check/page.tsx"),
      "utf8"
    );

    expect(source).toContain("PublicBetaUnavailable");
    expect(source).not.toContain("aria-pressed");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("includedItemIds");
  });
});
