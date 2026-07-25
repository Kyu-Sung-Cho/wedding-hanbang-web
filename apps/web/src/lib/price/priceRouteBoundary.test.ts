import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PRICE_CATEGORIES } from "./catalog";

const webRoot = process.cwd();
const srcRoot = resolve(webRoot, "src");

// /price 아래에서 카테고리가 아닌 실제 라우트. app/price 디렉토리와 일치하는지는 아래 테스트가 지킨다.
const NON_CATEGORY_PRICE_ROUTES = ["vendor", "vendor-id", "wishlist"];

const VALID_PRICE_SEGMENTS = new Set<string>([...PRICE_CATEGORIES, ...NON_CATEGORY_PRICE_ROUTES]);

// 따옴표·백틱 바로 뒤에서 시작하는 절대 경로만 본다. "/api/admin/price/..."는 "/api"로
// 시작해 걸리지 않고, `/price/${category}`처럼 값이 동적인 링크는 세그먼트가 잡히지 않는다.
const HARDCODED_PRICE_HREF = /["'`]\/price\/([a-z0-9-]+)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [fullPath];
  });
}

describe("hardcoded /price link boundary", () => {
  it("keeps every hardcoded /price/<segment> link on a route that exists", () => {
    // /price/[category]는 dynamicParams=false다 — 카탈로그에 없는 슬러그는 리다이렉트 없이 즉시 404다.
    const deadLinks = sourceFiles(srcRoot).flatMap((file) => (
      [...readFileSync(file, "utf8").matchAll(HARDCODED_PRICE_HREF)]
        .map(([, segment]) => segment)
        .filter((segment) => !VALID_PRICE_SEGMENTS.has(segment))
        .map((segment) => `${relative(webRoot, file)}: /price/${segment}`)
    ));

    expect(deadLinks).toEqual([]);
  });

  it("keeps the non-category allowlist in sync with the shipped price routes", () => {
    const shippedRoutes = readdirSync(resolve(srcRoot, "app/price"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
      .map((entry) => entry.name);

    expect(shippedRoutes.sort()).toEqual([...NON_CATEGORY_PRICE_ROUTES].sort());
  });

  it("derives the landing market snapshot from the price catalog", () => {
    const landing = readFileSync(
      resolve(srcRoot, "components/community/CommunityLandingClient.tsx"),
      "utf8",
    );

    expect(landing).toContain("MARKET_SNAPSHOT_ICONS: Record<PriceCategory, LucideIcon>");
    expect(landing).toContain("href={`/price/${category}`}");
    expect(landing).toContain("PRICE_CATEGORY_LABELS[category]");
  });
});
