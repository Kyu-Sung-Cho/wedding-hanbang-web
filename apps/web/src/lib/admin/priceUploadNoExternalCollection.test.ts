// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");

describe("manual-only disclosure ingestion boundary", () => {
  it("does not ship the prohibited price.go.kr automatic collection command", () => {
    expect(existsSync(resolve(process.cwd(), "scripts/update-market-prices.mjs"))).toBe(false);
    const packageJson = JSON.parse(readFileSync(
      resolve(process.cwd(), "package.json"),
      "utf8",
    )) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["update:market-prices"]).toBeUndefined();

    const projectGuide = readFileSync(resolve(repositoryRoot, "CLAUDE.md"), "utf8");
    expect(projectGuide).not.toMatch(/price\.go\.kr\s+AJAX/iu);
    expect(projectGuide).not.toContain("update:market-prices");
  });

  it("does not ship legacy admin APIs with realistic vendor names and invented prices", () => {
    for (const route of [
      "src/app/api/admin/seed-vendors/route.ts",
      "src/app/api/admin/seed-venues/route.ts",
      "src/app/api/admin/seed-studios/route.ts",
      "src/app/api/admin/seed-makeup/route.ts",
    ]) {
      expect(existsSync(resolve(process.cwd(), route)), route).toBe(false);
    }
  });

  it("does not ship a generated source file containing real price figures", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/constants/marketPricesData.generated.ts")),
      "official price figures must enter through the reviewed disclosure pipeline, not source code",
    ).toBe(false);
  });
});
