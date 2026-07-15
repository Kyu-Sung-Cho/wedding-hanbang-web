// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Amora memory navigation", () => {
  it("uses the wedding alias contract in both directions", () => {
    const settings = readFileSync(
      resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
      "utf8",
    );
    const memory = readFileSync(
      resolve(process.cwd(), "src/app/(app)/settings/amora-memory/page.tsx"),
      "utf8",
    );

    expect(settings).toContain('weddingLinkProps("/settings/amora-memory")');
    expect(memory).toContain('weddingLinkProps("/settings")');
  });
});
