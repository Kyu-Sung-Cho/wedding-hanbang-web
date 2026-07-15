import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("public trust copy", () => {
  it("does not advertise disabled vendor catalog or cohort rooms as beta features", () => {
    const publicCopy = [
      "apps/web/src/components/customer-landing/CustomerSolutions.tsx",
      "apps/web/src/components/customer-landing/CustomerFeatures.tsx",
      "apps/web/src/components/landing/CompareToHumanPlanner.tsx",
      "apps/web/src/app/(community)/community/about/page.tsx",
      "apps/web/src/components/app/ServiceGuide.tsx",
      "apps/web/src/components/app/ServiceDashboardTutorial.tsx",
      "apps/web/src/components/community/CommunityGuide.tsx",
      "apps/web/src/components/community/CommunityTutorial.tsx",
    ].map(read).join("\n");

    for (const retiredPromise of [
      "조건 기반 업체 탐색",
      "업체 운영정보 확인",
      "업체 포트폴리오 탐색",
      "업체 탐색은 후보를 좁힐 때",
      "동기방에서 함께 준비",
      "같은 시기 결혼하는 동기방",
      "예시 동기방",
    ]) {
      expect(publicCopy, retiredPromise).not.toContain(retiredPromise);
    }
  });

  it("keeps official survey scope while removing promotional price anchors", () => {
    const research = read("apps/web/src/components/landing/OfficialPriceResearch.tsx");
    const painPoints = read("apps/web/src/components/customer-landing/CustomerPainPoints.tsx");

    expect(research).toContain("한국소비자원 참가격의 공개 조사 자료");
    expect(research).toContain("적정가로 제시하거나");
    expect(research).toContain("포함 범위와 추가 조건은 업체 원문과 계약서로 확인");
    expect(research).not.toMatch(/₩|20,910,000|35,990,000|2,091만원|3,599만원/);

    expect(painPoints).toContain("포함 항목·추가 조건을 계약 전에 확인");
    expect(painPoints).toContain("업체 원문과 계약서에서 빠진 항목을 하나씩 확인");
    expect(painPoints).not.toMatch(/\+174만원|174만원|346만원|신혼부부 995쌍/);
  });

  it("describes the account as open only when public launch mode is explicitly full", () => {
    const launchAwareCopy = [
      "apps/web/src/app/demo/page.tsx",
      "apps/web/src/components/customer-landing/CustomerHero.tsx",
      "apps/web/src/components/customer-landing/CustomerFeatures.tsx",
      "apps/web/src/components/customer-landing/CustomerHowItWorks.tsx",
      "apps/web/src/components/customer-landing/CustomerTestimonials.tsx",
      "apps/web/src/components/customer-landing/CustomerCTA.tsx",
    ];

    for (const source of launchAwareCopy) {
      expect(read(source), source).not.toContain('=== "coming_soon"');
      expect(read(source), source).toContain('!== "full"');
    }
  });

  it("labels illustrative landing scenarios so they cannot be mistaken for customer evidence", () => {
    const solutions = read("apps/web/src/components/customer-landing/CustomerSolutions.tsx");
    const scenarios = read("apps/web/src/components/customer-landing/CustomerTestimonials.tsx");

    expect(solutions).toContain("화면 예시 · 실제 견적이나 추천 결과가 아닙니다");
    expect(scenarios).toContain("활용 예시이며 실제 고객 후기나 효과 보장이 아닙니다");
  });
});
