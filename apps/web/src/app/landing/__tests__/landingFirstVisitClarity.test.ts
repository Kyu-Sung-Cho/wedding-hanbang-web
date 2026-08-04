// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("landing first visit clarity", () => {
  it("states what the product does and connects the first action to Amora", () => {
    const content = source("src/components/landing/redesign/landingContent.ts");
    const hero = source("src/components/landing/redesign/TransformationHero.tsx");

    expect(content).toContain("둘이 말하면, 결혼 준비가 정리돼요.");
    expect(content).toContain("날짜를 넣으면 지금 볼 세 가지가 나와요");
    expect(content).toContain("이어서 예산·할 일·일정을 아모라에게 말해보세요");
    expect(content).toContain("계정 베타에서는 한 번에 한 가지 변경을 제안하고");
    expect(hero.indexOf("둘이 말하면,")).toBeLessThan(
      hero.indexOf("landingContent.hero.body"),
    );
    expect(hero).not.toContain("landingContent.hero.emotionalLine");
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
