// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

describe("API rate-limit durability boundary", () => {
  it("does not use the instance-local limiter in route handlers", () => {
    const apiRoot = resolve(process.cwd(), "src/app/api");
    const offenders = routeFiles(apiRoot)
      .filter((file) => /\bcheckRateLimit\s*\(/u.test(readFileSync(file, "utf8")))
      .map((file) => relative(apiRoot, file).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });
});
