// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("landing first visit clarity", () => {
  it("states what the product does before the emotional line", () => {
    const content = source("src/components/landing/redesign/landingContent.ts");
    const hero = source("src/components/landing/redesign/TransformationHero.tsx");

    expect(content).toContain("둘이 말하면, 결혼 준비가 정리돼요.");
    expect(content).toContain("우리 얘기가, 우리 결혼 준비가 되는 순간.");
    expect(hero.indexOf("둘이 말하면,")).toBeLessThan(
      hero.indexOf("landingContent.hero.emotionalLine"),
    );
  });

  it("mirrors the scattered preparation problem before showing the outcome", () => {
    const landing = source("src/app/landing/page.tsx");
    const problem = source("src/components/landing/redesign/ProblemMirrorSection.tsx");

    expect(problem).toContain("카톡에는 날짜,");
    expect(problem).toContain("메모장에는 예산,");
    expect(problem).toContain("머릿속에는 해야 할 일.");
    expect(problem).toContain("landingContent.problem.answer");
    expect(landing.indexOf("<ProblemMirrorSection />")).toBeGreaterThan(
      landing.indexOf("<TransformationHero />"),
    );
    expect(landing.indexOf("<ProblemMirrorSection />")).toBeLessThan(
      landing.indexOf("<PreparationResult />"),
    );
  });
});
