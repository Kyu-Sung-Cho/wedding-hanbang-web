import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function blockBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

const PRODUCT_DEFINITION =
  "웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께 정리되는 서비스입니다.";

describe("web MVP product direction", () => {
  it("keeps one authoritative Amora-led product definition", () => {
    const productContract = source("../../docs/MVP_PRODUCT_DIRECTION_2026-07-30.md")
      .replace(/\r?\n/g, " ");
    const principles = source("../../PRINCIPLES.md").replace(/\r?\n/g, " ");
    const landing = source("src/app/landing/page.tsx");
    const hero = source("src/components/landing/CelebrationHero.tsx");
    const communityPage = source("src/app/(community)/community/page.tsx");
    const communityLayout = source("src/app/(community)/layout.tsx");
    const communityNav = source("src/components/community/CommunityNav.tsx");
    const priceLayout = source("src/app/price/layout.tsx");
    const community = source("src/components/community/CommunityLandingClient.tsx")
      .replace(/\r?\n\s*/g, " ");

    expect(productContract).toContain(PRODUCT_DEFINITION);
    expect(principles).toContain(PRODUCT_DEFINITION.replace("서비스입니다.", "서비스다."));
    expect(landing).toContain("둘이 함께 쓰는 결혼 준비 AI 아모라");
    expect(hero).toContain("결혼 준비 AI · 아모라");
    expect(communityPage).toContain("웨딩한방 — 결혼 준비를 아모라와 정리하세요");
    expect(community).toContain(PRODUCT_DEFINITION.replace("서비스입니다.", "서비스예요."));
    for (const publicShell of [communityLayout, communityNav, priceLayout]) {
      expect(publicShell).toContain("결혼 준비, 아모라와 정리하세요.");
      expect(publicShell).not.toContain("예비부부의 고민과 경험이 모이는 곳");
      expect(publicShell).not.toContain("AI가 함께하는 가장 든든한 결혼 준비");
    }
  });

  it("shows Amora before supporting evidence and community content", () => {
    const landing = source("src/app/landing/page.tsx");
    const community = source("src/components/community/CommunityLandingClient.tsx");
    const whatWeDoRender = community.indexOf("{showLandingIntro && <WhatWeDo />}");
    const communityMainRender = community.indexOf("{communityMainNode}", whatWeDoRender);

    expect(landing.indexOf("<AmoraSection />")).toBeLessThan(landing.indexOf("<ProofBand"));
    expect(community.indexOf("<AmoraBlock />")).toBeLessThan(community.indexOf("<WhatWeDo />"));
    expect(whatWeDoRender).toBeGreaterThanOrEqual(0);
    expect(communityMainRender).toBeGreaterThan(whatWeDoRender);
    expect(communityMainRender).toBeLessThan(community.indexOf("<DisclosureHero"));
  });

  it("keeps primary navigation focused on Amora, tasks, budget, and community", () => {
    const landing = source("src/app/landing/page.tsx");
    const communityNav = source("src/components/community/CommunityNav.tsx");
    const userMenu = source("src/components/community/UserMenu.tsx");
    const sidebar = source("src/components/app/Sidebar.tsx");
    const topNav = source("src/components/app/TopNav.tsx");

    const landingNav = blockBetween(landing, "const navItems = [", "];");
    const publicNav = blockBetween(communityNav, "const baseNavItems = [", "];");
    const signedInNav = blockBetween(sidebar, "const menuItems:", "];");
    const signedInQuickLinks = blockBetween(topNav, "const quickLinks = [", "];");

    for (const label of ["아모라", "할 일·일정", "예산", "커뮤니티"]) {
      expect(landingNav).toContain(`label: "${label}"`);
      expect(publicNav).toContain(`label: "${label}"`);
      expect(signedInNav).toContain(`label: "${label}"`);
      expect(signedInQuickLinks).toContain(`label: "${label}"`);
    }

    for (const retiredPrimaryPath of [
      "/vendors",
      "/market-prices",
      "/bookings",
      "/money",
      "/favorites",
      "/wedding-code",
    ]) {
      expect(landingNav).not.toContain(retiredPrimaryPath);
      expect(publicNav).not.toContain(retiredPrimaryPath);
      expect(signedInNav).not.toContain(retiredPrimaryPath);
      expect(signedInQuickLinks).not.toContain(retiredPrimaryPath);
      expect(userMenu).not.toContain(`weddingLinkProps("${retiredPrimaryPath}")`);
    }
  });

  it("keeps marketplace and booking tools outside the current Amora registry", () => {
    const tools = source("src/lib/ai/tools.ts");
    const chatRoute = source("src/app/api/chat/route.ts");

    for (const disabledTool of [
      "search_vendors",
      "check_vendor_availability",
      "recommend_vendors",
      "get_vendor_detail",
      "get_available_slots",
      "create_booking",
      "get_my_bookings",
      "cancel_booking",
      "search_nearby_places",
    ]) {
      expect(tools).toMatch(
        new RegExp(`BETA_DISABLED_TOOL_NAMES[\\s\\S]*"${disabledTool}"`),
      );
    }
    expect(chatRoute).not.toContain('from("vendor_bookings")');
    expect(chatRoute).toContain("bookings: []");
  });

  it("does not bring retired money management back through lifecycle prompts", () => {
    const lifecycle = source("src/lib/amora/lifecycle.ts");
    const lounge = source("src/app/(app)/lounge/page.tsx");

    expect(lifecycle).not.toContain('weddingPath("/money")');
    expect(lifecycle).not.toContain("축의금 정리");
    expect(lifecycle).not.toContain("riskScore");
    expect(lifecycle).not.toContain("riskLabel");
    expect(lounge).not.toContain("plan.riskLabel");
    expect(lifecycle).toContain("결혼식 뒤 남은 일을 일정에 모아두세요");
  });

  it("keeps the signed-in guide inside the same MVP promise and claim boundary", () => {
    const guide = source("src/components/app/ServiceGuide.tsx");

    expect(guide).toContain("결혼 준비,");
    expect(guide).toContain("아모라와 정리하세요.");
    expect(guide).toContain("해야 할 일과 날짜 정리");
    expect(guide).toContain("예상 금액과 실제로 쓴 금액");

    for (const staleOrUnsupportedClaim of [
      "24시간 플래너",
      "실시간 동기화",
      "무료로 모든 기능",
      "광고 없음",
      "데이터 보호",
      "업체 탐색",
      "스드메",
    ]) {
      expect(guide).not.toContain(staleOrUnsupportedClaim);
    }
  });

  it("uses plain language across the signed-in setup and planning surfaces", () => {
    const activeSources = [
      source("src/app/(app)/dashboard/page.tsx"),
      source("src/app/(app)/settings/page.tsx"),
      source("src/components/onboarding/WeddingDetails.tsx"),
      source("src/stores/authStore.ts"),
      source("src/constants/notifications.ts"),
      source("src/constants/moments.ts"),
      source("src/lib/ai/amoraPendingAction.ts"),
      source("src/lib/ai/tools.ts"),
      source("../../packages/shared/src/constants/weddingPlanning.ts"),
      source("../../packages/shared/src/constants/weddingPreferences.ts"),
    ].join("\n");

    for (const unexplainedOrStaleTerm of [
      "스드메",
      "예식장",
      "예식일",
      "신랑측",
      "신부측",
      "원본·보정본",
      "드레스 투어",
      "피팅비",
      "가봉",
      "청첩장",
      "본식",
      "보증인원",
      "식순",
      "잔금",
      "사회자",
      "피로연",
      "예물",
      "혼수",
      "답례품",
      "스드메",
      "부케",
      "컨셉",
      "바우처",
      "양가",
      "메이크업 리허설",
    ]) {
      expect(activeSources).not.toContain(unexplainedOrStaleTerm);
    }

    for (const unsupportedPlanningClaim of [
      "결혼식 1년 전",
      "3개월 이상 소요",
      "빨리 예약할수록 저렴",
      "서둘러야 합니다",
      "리허설을 진행하세요",
    ]) {
      expect(activeSources).not.toContain(unsupportedPlanningClaim);
    }

    expect(activeSources).toContain("결혼식 날짜");
    expect(activeSources).toContain("결혼식장");
    expect(activeSources).toContain("사진 촬영·드레스·헤어·메이크업");
  });

  it("presents template timing as a reference order rather than a real deadline", () => {
    const timingSources = [
      source("src/app/(app)/lounge/page.tsx"),
      source("src/components/community/StartHereClient.tsx"),
      source("src/components/app/schedule/ImminentAlerts.tsx"),
      source("src/components/app/schedule/TimelineView.tsx"),
    ].join("\n");

    expect(timingSources).not.toMatch(/권장 마감|마감 계산 전|마감이 계산/);
    expect(timingSources).toContain("기본 확인 시점");
    expect(timingSources).toContain("실제 계약서");
    expect(timingSources).toContain("업체·가족");
  });

  it("never asks Amora to invent budget amounts from preferences or averages", () => {
    const tools = source("src/lib/ai/tools.ts");
    const prompts = source("src/lib/ai/prompts.ts");

    for (const unsupportedBudgetInstruction of [
      "평균 +20~30%",
      "평균 -20~30%",
      "우선순위 1순위라 평균",
      "양보 카테고리라 평균",
    ]) {
      expect(tools).not.toContain(unsupportedBudgetInstruction);
      expect(prompts).not.toContain(unsupportedBudgetInstruction);
    }

    expect(tools).toContain("사용자가 직접 입력하거나 확인한 목표 금액·견적·상한만 사용하세요");
    expect(tools).toContain("우선순위만으로 임의의 비율이나 금액을 만들지 마세요");
  });

  it("keeps an unentered total budget unset across onboarding and budget surfaces", () => {
    const onboardingStore = source("src/stores/onboardingStore.ts");
    const onboardingRoute = source("src/app/api/onboarding/route.ts");
    const authRoute = source("src/app/api/auth/me/route.ts");
    const budgetPage = source("src/components/app/budget/BudgetContent.tsx");
    const dashboardPage = source("src/app/(app)/dashboard/page.tsx");
    const weddingDetails = source("src/components/onboarding/WeddingDetails.tsx");
    const activeBudgetSources = [
      onboardingStore,
      onboardingRoute,
      authRoute,
      budgetPage,
      dashboardPage,
      weddingDetails,
    ].join("\n");

    expect(onboardingStore).toContain("approximateBudget: 0");
    expect(onboardingRoute).toContain("total_budget: 0");
    expect(onboardingRoute).toContain(
      "changes.total_budget = input.totalBudget;",
    );
    expect(onboardingRoute).toContain("isValidWeddingWonAmount");
    expect(onboardingRoute).not.toContain("total_budget: input.totalBudget ?? 0");
    expect(authRoute).toContain("total_budget: 0");
    expect(budgetPage).toContain("journey?.total_budget ?? 0");
    expect(dashboardPage).toContain(
      'const budgetUsageValue = hasTotalBudget ? `${budgetPercent}%` : "미입력"',
    );
    expect(dashboardPage).toContain('"총 예산 미입력"');
    expect(weddingDetails).toContain("아모라가 금액을 대신 정하지 않습니다");

    for (const inventedDefault of [
      "DEFAULT_TOTAL_BUDGET",
      "?? 20000000",
      "?? 20_000_000",
      "approximateBudget: 20000000",
      "total_budget: 20000000",
    ]) {
      expect(activeBudgetSources).not.toContain(inventedDefault);
    }
  });
});
