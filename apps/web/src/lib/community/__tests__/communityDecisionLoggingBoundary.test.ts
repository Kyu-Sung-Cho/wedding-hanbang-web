import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const routeFiles = [
  "route.ts",
  "inbox/route.ts",
  "[threadId]/route.ts",
  "[threadId]/answers/route.ts",
  "[threadId]/applicability/route.ts",
  "[threadId]/resolve/route.ts",
  "[threadId]/outcomes/route.ts",
  "[threadId]/withdraw/route.ts",
  "[threadId]/outcomes/[outcomeId]/publication/route.ts",
];

const adminRouteFiles = [
  "route.ts",
  "[outcomeId]/review/route.ts",
];

describe("DecisionThread logging boundary", () => {
  it.each(routeFiles)("keeps %s exception logs content-free", (routeFile) => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/community/decision-threads", routeFile),
      "utf8",
    );

    expect(source).not.toMatch(
      /console\.(?:error|warn|log)\([^)]*,\s*(?:error|cause|request|body|data)\s*\)/u,
    );
    expect(source).not.toMatch(/console\.(?:error|warn|log)\([^)]*JSON\.stringify/u);
  });

  it.each(adminRouteFiles)("keeps admin %s exception logs content-free", (routeFile) => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/admin/community/decision-outcomes", routeFile),
      "utf8",
    );

    expect(source).not.toMatch(
      /console\.(?:error|warn|log)\([^)]*,\s*(?:error|cause|request|body|data)\s*\)/u,
    );
    expect(source).not.toMatch(/console\.(?:error|warn|log)\([^)]*JSON\.stringify/u);
    expect(source).not.toMatch(/console\.(?:error|warn|log)\([^)]*\{[\s\S]{0,120}(?:code|message)/u);
  });
});
