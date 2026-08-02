// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve(process.cwd(), "src/app/api/community/profile/route.ts"),
  "utf8",
);
const getBody = route.match(/export async function GET[\s\S]*?\n}\n\nexport async function POST/)?.[0] ?? "";

describe("community profile read-only fence", () => {
  it("keeps lazy profile creation out of GET", () => {
    expect(getBody).not.toContain("createCommunityProfile(");
    expect(getBody).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("requires trusted mutation metadata before POST or PATCH", () => {
    expect(route.match(/isTrustedMutationRequest\(req\)/g)).toHaveLength(2);
  });
});
