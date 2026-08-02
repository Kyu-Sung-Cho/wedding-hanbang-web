// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("privacy-sensitive GET response cache fences", () => {
  it.each([
    "src/app/api/community/polls/[pollId]/vote/route.ts",
    "src/app/api/community/posts/[id]/route.ts",
    "src/app/api/community/posts/voted/route.ts",
    "src/app/api/community/profiles/[userId]/route.ts",
    "src/app/api/vendors/[id]/route.ts",
  ])("keeps personalized route private and uncacheable: %s", (path) => {
    const route = source(path);
    expect(route).toContain('"Cache-Control": "private, no-store, max-age=0"');
    expect(route).toContain('Vary: "Cookie, Authorization"');
  });

  it("does not cache staff availability counts", () => {
    expect(source("src/app/api/vendors/[id]/staff/route.ts"))
      .toContain('"Cache-Control": "no-store, max-age=0"');
  });

  it("does not retain a vendor after its public approval is withdrawn", () => {
    expect(source("src/app/api/vendors/route.ts"))
      .toContain('"Cache-Control": "no-store, max-age=0"');
  });
});
