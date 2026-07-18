// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HIDDEN_COSTS } from "../hiddenCosts";

describe("contract-checklist provenance boundary", () => {
  it("keeps real price and usage statistics out of runtime checklist data", () => {
    for (const item of HIDDEN_COSTS) {
      expect(item).not.toHaveProperty("nationalPrice");
      expect(item).not.toHaveProperty("seoulPrice");
      expect(item).not.toHaveProperty("usageRate");
    }
  });

  it("does not leave retired price, usage, or estimate fields in the source module", () => {
    const source = readFileSync(resolve(process.cwd(), "src/constants/hiddenCosts.ts"), "utf8");

    expect(source).not.toContain("nationalPrice");
    expect(source).not.toContain("seoulPrice");
    expect(source).not.toContain("usageRate");
    expect(source).not.toContain("estimatedHiddenCost");
    expect(source).not.toContain("estimatedTotal");
  });
});
