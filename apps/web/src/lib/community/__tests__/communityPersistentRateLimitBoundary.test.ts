// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...routeFiles(path));
      continue;
    }
    if (entry.name === "route.ts" && extname(entry.name) === ".ts") {
      files.push(path);
    }
  }
  return files;
}

describe("community distributed rate-limit boundary", () => {
  it("never relies on process-local buckets in community API routes", () => {
    const root = resolve(process.cwd(), "src/app/api/community");
    const localLimiterCall = /\bcheckRateLimit\s*\(/u;

    for (const file of routeFiles(root)) {
      expect(
        readFileSync(file, "utf8"),
        `process-local rate limit remains in ${file}`,
      ).not.toMatch(localLimiterCall);
    }
  });

  it("uses the fail-closed shared limiter on every bounded community route", () => {
    const boundedRoutes = [
      "posts/route.ts",
      "comments/route.ts",
      "polls/[pollId]/vote/route.ts",
      "posts/[id]/vote/route.ts",
      "comments/[id]/vote/route.ts",
      "posts/[id]/bookmark/route.ts",
      "posts/[id]/view/route.ts",
      "profile/route.ts",
      "search/route.ts",
      "cohort/[id]/messages/route.ts",
      "cohort/[id]/members/[userId]/report/route.ts",
      "wedding-court/[caseId]/vote/route.ts",
    ];

    for (const route of boundedRoutes) {
      const source = readFileSync(
        resolve(process.cwd(), "src/app/api/community", route),
        "utf8",
      );
      expect(source, route).toContain("checkRateLimitPersistent");
      expect(source, route).toMatch(/await\s+checkRateLimitPersistent\s*\(/u);
      expect(source, route).not.toContain("failClosed: false");
    }
  });
});
