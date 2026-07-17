import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const ACTIVE_PUBLIC_SOURCES = [
  "src/app/layout.tsx",
  "src/app/landing/page.tsx",
  "src/app/demo/page.tsx",
  "src/app/beta/page.tsx",
  "src/app/beta/BetaForm.tsx",
  "src/components/customer-landing/CustomerNav.tsx",
  "src/components/landing/CompareToHumanPlanner.tsx",
  "src/components/landing/ForBetaCouples.tsx",
  "src/components/landing/Footer.tsx",
  "src/app/(community)/community/quote-check/layout.tsx",
  "src/components/app/market-prices/MarketPricesClient.tsx",
  "src/components/app/market-prices/MarketPriceSeoContent.tsx",
].map(source);

describe("public marketing claim boundary", () => {
  it("does not publish unshipped features, invented evidence, or unapproved benefit promises", () => {
    const published = ACTIVE_PUBLIC_SOURCES.join("\n");

    for (const forbiddenClaim of [
      "AI 드레스 가상 피팅",
      "웨딩 플래너 없이도 완벽",
      "24시간 365일",
      "200~500만원",
      "아모라웨딩홀 후기 67건",
      "10% 이상 답변을 고정",
      "검증된 준비 가이드",
      "Contract Diff 무료 Premium",
      "종료 후 6개월 무료",
      "아모라 풀 기능",
      "완전 무료",
      "스드메 추가금 평균",
      "가격 정보 어려움",
      "추가비용 경험률",
      "서울 평균 총 비용",
      "비수기 절약액",
      "비수기 결혼 시 평균 절약 금액",
      "성수기와 비수기의 가격 차이는 약 400~500만원",
      "2026년 1월 기준 중위 가격",
    ]) {
      expect(published).not.toContain(forbiddenClaim);
    }
  });

  it("labels the demo as a non-indexed preview instead of presenting fictional proof", () => {
    const demo = source("src/app/demo/page.tsx");

    expect(demo).toContain("현재 개발·검증 중");
    expect(demo).toContain("실사용 통계나 고객 후기가 아니라");
    expect(demo).toContain("robots: { index: false, follow: false }");
    expect(demo).not.toContain("CustomerTestimonials");
    expect(demo).not.toContain("CustomerStats");
  });

  it("states that AI changes require confirmation and keeps policy links real", () => {
    const landing = source("src/app/landing/page.tsx");

    expect(landing).toContain("사용자가 승인한 내용만 반영");
    expect(landing).toContain('{ label: "이용약관", href: "/terms" }');
    expect(landing).toContain('{ label: "개인정보처리방침", href: "/privacy" }');
    expect(landing).toContain('{ label: "AI 서비스 정책", href: "/ai-policy" }');
  });
});
