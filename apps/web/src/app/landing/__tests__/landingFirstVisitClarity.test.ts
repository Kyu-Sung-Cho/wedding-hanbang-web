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
    // 산출물을 개수로만 말하지 않는다. 이전 문구("지금 볼 세 가지가 나와요")는
    // 그 셋이 무엇인지 랜딩 어디에도 없어서 입력은 분명한데 출력이 빈칸이었다.
    expect(content).toContain("지금 알아볼 준비 3가지");
    expect(content, "산출물을 개수로만 말하면 처음 온 사람은 뭘 받는지 모른다")
      .not.toMatch(/지금 볼 세 가지가 나와요/u);
    expect(content, "첫 행동과 아모라를 잇는 문장이 사라졌다").toMatch(
      /body:\s*"[^"]*아모라[^"]*"/u,
    );
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
