// @vitest-environment node

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const optimizedHero = resolve(
  appRoot,
  "public/images/amora-hero-bouquet-custom.webp",
);
const bouquetSourceFiles = [
  "src/app/(community)/community/cohort/page.tsx",
  "src/app/(community)/community/cohort/[id]/page.tsx",
];
const celebrationHero = resolve(
  appRoot,
  "public/images/wedding-celebration-hero.webp",
);
const landingSocialCard = resolve(
  appRoot,
  "public/images/landing-social-card.webp",
);

describe("hero image performance budget", () => {
  it("serves the shared bouquet hero as a bounded WebP asset", () => {
    expect(statSync(optimizedHero).size).toBeLessThanOrEqual(350 * 1024);

    for (const sourceFile of bouquetSourceFiles) {
      const source = readFileSync(resolve(appRoot, sourceFile), "utf8");
      expect(source).toContain("/images/amora-hero-bouquet-custom.webp");
      expect(source).not.toContain("/images/amora-hero-bouquet-custom.png");
    }
  });

  it("serves one optimized celebration image within the first-view budget", () => {
    expect(statSync(celebrationHero).size).toBeLessThanOrEqual(180 * 1024);

    const source = readFileSync(
      resolve(appRoot, "src/components/landing/redesign/TransformationHero.tsx"),
      "utf8",
    );
    expect(source).toContain("/images/wedding-celebration-hero.webp");
    expect(source).toContain('sizes="(min-width: 1024px) 58vw, 100vw"');
    expect(source.match(/src="\/images\/wedding-celebration-hero\.webp"/g)).toHaveLength(1);
    expect(source).toContain("lg:min-h-[min(720px,calc(100svh-4rem))]");
    expect(source).not.toContain("radial-gradient");
    expect(source).not.toContain("amora-hero-bouquet-custom");
  });

  it("serves the landing social preview as a production-sized WebP", async () => {
    expect(statSync(landingSocialCard).size).toBeLessThanOrEqual(350 * 1024);

    const metadata = await sharp(landingSocialCard).metadata();
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);

    const source = readFileSync(resolve(appRoot, "src/app/landing/page.tsx"), "utf8");
    expect(source).toContain('url: "/images/landing-social-card.webp"');
    expect(source).toContain('images: ["/images/landing-social-card.webp"]');
  });
});
