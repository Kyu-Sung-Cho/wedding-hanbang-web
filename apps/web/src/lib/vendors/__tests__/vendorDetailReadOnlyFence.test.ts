// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve(process.cwd(), "src/app/api/vendors/[id]/route.ts"),
  "utf8",
);

describe("vendor detail GET read-only fence", () => {
  it("does not create a vendor view as a GET side effect", () => {
    expect(route).not.toMatch(/from\(["']vendor_views["']\)[\s\S]*?insert\(/);
  });
});
