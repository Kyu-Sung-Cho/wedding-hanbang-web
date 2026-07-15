import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("onboarding checklist trust boundary", () => {
  it("does not turn optional preparation templates into required onboarding work", () => {
    const page = read("src/app/(auth)/onboarding/page.tsx");
    const types = read("src/types/onboarding.types.ts");

    expect(page).not.toContain("ProgressChecklist");
    expect(page).not.toContain("progressChecklist");
    expect(types).not.toContain("준비 현황");
    expect(types).not.toContain("PROGRESS_CHECKLIST_ITEMS");
    expect(page).not.toContain("costInWon");
    expect(page).not.toContain("budget: costInWon");
  });

  it("keeps optional family ceremonies out of the core onboarding form", () => {
    const page = read("src/app/(auth)/onboarding/page.tsx");
    const details = read("src/components/onboarding/WeddingDetails.tsx");

    expect(page).not.toContain("sanggyeonryeDate");
    expect(details).not.toContain("상견례 날짜");
    expect(details).not.toContain("sanggyeonrye");
  });
});
