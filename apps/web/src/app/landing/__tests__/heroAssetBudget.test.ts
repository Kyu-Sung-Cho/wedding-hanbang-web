// @vitest-environment node

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const optimizedHero = resolve(
  appRoot,
  "public/images/amora-hero-bouquet-custom.webp",
);
const sourceFiles = [
  "src/app/landing/page.tsx",
  "src/app/(community)/community/cohort/page.tsx",
  "src/app/(community)/community/cohort/[id]/page.tsx",
];

describe("hero image performance budget", () => {
  it("serves the shared bouquet hero as a bounded WebP asset", () => {
    expect(statSync(optimizedHero).size).toBeLessThanOrEqual(350 * 1024);

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(resolve(appRoot, sourceFile), "utf8");
      expect(source).toContain("/images/amora-hero-bouquet-custom.webp");
      expect(source).not.toContain("/images/amora-hero-bouquet-custom.png");
    }
  });
});
