import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BETA_DISABLED_TOOL_NAMES, BETA_SAFE_TOOLS } from "@/lib/ai/tools";

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

// 2026-08-08 파운더 결정으로 도구 중심 정의를 동반자 정의가 승계했다.
// 2026-08-23 파운더 결정으로 "두 사람이 확인한 것만" 이 "확인한 것만 … 바뀐 내용을
// 서로에게 알리는" 으로 바뀌었다. 두 사람 승인을 없애고 알림으로 대체했기 때문이다.
// 코드만 바꾸고 이 문장을 두면 랜딩 화면이 없는 기능을 판다 — 그래서 이 테스트가 있다.
// 정본: docs/PRODUCT_CONTRACT_PARTNER_2026-08-08.md
// 세 변형(입니다/다/예요)을 한 상수에서 파생시키는 구조는 유지한다 — 이것이
// 정의가 표면마다 갈라지는 것을 막는 유일한 장치다.
const PRODUCT_DEFINITION =
  "웨딩한방은 결혼 준비의 고민을 아모라와 처음부터 끝까지 이야기하고, 비슷한 시기에 준비하는 사람들의 기록을 함께 보며, 확인한 것만 예산·체크리스트·일정에 남기고 바뀐 내용을 서로에게 알리는 서비스입니다.";
const PRODUCT_TAGLINE = "결혼 준비, 아모라와 처음부터 끝까지.";

describe("web MVP product direction", () => {
  it("keeps one authoritative Amora-led product definition", () => {
    const productContract = source("../../docs/PRODUCT_CONTRACT_PARTNER_2026-08-08.md")
      .replace(/\r?\n/g, " ");
    const principles = source("../../PRINCIPLES.md").replace(/\r?\n/g, " ");
    const hero = source("src/components/landing/redesign/TransformationHero.tsx");
    const landingContent = source("src/components/landing/redesign/landingContent.ts");
    const communityPage = source("src/app/(community)/community/page.tsx");
    const communityLayout = source("src/app/(community)/layout.tsx");
    const communityNav = source("src/components/community/CommunityNav.tsx");
    const priceLayout = source("src/app/price/layout.tsx");
    const community = source("src/components/community/CommunityLandingClient.tsx")
      .replace(/\r?\n\s*/g, " ");

    expect(productContract).toContain(PRODUCT_DEFINITION);
    expect(principles).toContain(PRODUCT_DEFINITION.replace("서비스입니다.", "서비스다."));
    expect(landingContent).toContain("웨딩한방 · 둘이 함께 관리하는 결혼 준비 공간");
    expect(landingContent).toContain("아모라 · 대화를 정리하는 AI");
    expect(landingContent).toContain("예산·할 일·일정");
    expect(hero).toContain("landingContent.hero.eyebrow");
    expect(communityPage).toContain("웨딩한방 — 결혼 준비를 아모라와 정리하세요");
    expect(community).toContain(PRODUCT_DEFINITION.replace("서비스입니다.", "서비스예요."));
    for (const publicShell of [communityLayout, communityNav, priceLayout]) {
      expect(publicShell).toContain(PRODUCT_TAGLINE);
      expect(publicShell).not.toContain("예비부부의 고민과 경험이 모이는 곳");
      expect(publicShell).not.toContain("AI가 함께하는 가장 든든한 결혼 준비");
    }
  });

  it("lets the community deliver people-first value before Amora turns it into a plan", () => {
    const landing = source("src/app/landing/page.tsx");
    const community = source("src/components/community/CommunityLandingClient.tsx");
    const searchHubRender = community.indexOf("{searchHubNode}");
    const communityMainRender = community.indexOf("{communityMainNode}", searchHubRender);
    const amoraRender = community.indexOf("{showLandingIntro && <AmoraBlock />}");
    const whatWeDoRender = community.indexOf("{showLandingIntro && <WhatWeDo />}");

    expect(landing.indexOf("<PreparationResult />")).toBeLessThan(
      landing.indexOf("<TrustEvidenceSection"),
    );
    expect(community).toContain('data-community-home-order="search-first"');
    expect(searchHubRender).toBeGreaterThanOrEqual(0);
    expect(communityMainRender).toBeGreaterThan(searchHubRender);
    expect(amoraRender).toBeGreaterThan(communityMainRender);
    expect(whatWeDoRender).toBeGreaterThanOrEqual(0);
    expect(whatWeDoRender).toBeGreaterThan(amoraRender);
    expect(whatWeDoRender).toBeLessThan(community.indexOf("<DisclosureHero"));
  });

  it("keeps landing story anchors distinct from the Amora product navigation", () => {
    const landingHeader = source("src/components/landing/redesign/LandingHeader.tsx");
    const landingFooter = source("src/components/landing/redesign/LandingFooter.tsx");
    const communityNav = source("src/components/community/CommunityNav.tsx");
    const userMenu = source("src/components/community/UserMenu.tsx");
    const sidebar = source("src/components/app/Sidebar.tsx");
    const topNav = source("src/components/app/TopNav.tsx");

    const landingNav = blockBetween(landingHeader, "const navItems = [", "] as const;");
    const landingProductLinks = blockBetween(
      landingFooter,
      "const serviceLinks = [",
      "] as const;",
    );
    const publicNav = blockBetween(communityNav, "const baseNavItems = [", "];");
    const signedInNav = blockBetween(sidebar, "const menuItems:", "];");
    const signedInQuickLinks = blockBetween(topNav, "const quickLinks = [", "];");

    for (const [label, href] of [
      ["어떻게 정리되나요", "#how-it-works"],
      ["함께·나만 보기", "#privacy"],
      ["신뢰 기준", "#trust"],
      ["시작 조건·비용", "#start-conditions"],
    ]) {
      expect(landingNav).toContain(`label: "${label}", href: "${href}"`);
    }

    expect(landingProductLinks).toContain('label: "아모라 채팅"');
    for (const label of ["할 일·일정", "예산"]) {
      expect(landingProductLinks).toContain(`label: "${label}"`);
    }
    // 이 두 줄은 커뮤니티를 랜딩 안쪽 설명 띠(#community-bridge)로 보내고 "운영 공개
    // 전"이라고 달아 두는 상태를 고정했다. 그건 사실이 아니었다 — 커뮤니티는 이미
    // 열려 있고 로그인 없이 읽힌다(hanbang.ai/community 200 확인). 열려 있는 것을
    // 닫혔다고 말하면 들어올 사람을 돌려보낸다. 실제 화면으로 보내는 쪽이 맞다.
    expect(landingProductLinks).toContain(
      'label: "커뮤니티", href: weddingPath(), note: "로그인 없이"',
    );
    expect(landingProductLinks).not.toContain('href: "#community-bridge"');

    for (const label of ["아모라", "예산", "커뮤니티"]) {
      expect(publicNav).toContain(`label: "${label}"`);
      expect(signedInNav).toContain(`label: "${label}"`);
      expect(signedInQuickLinks).toContain(`label: "${label}"`);
    }

    // 공개 내비게이션은 처음 보는 사람에게 준비 흐름을 한 덩어리로 설명하지만,
    // 로그인 후 실행 화면에서는 체크리스트와 일정을 서로 다른 목적지로 제공한다.
    expect(publicNav).toContain('label: "할 일·일정"');
    expect(signedInNav).toContain('label: "웨딩 체크리스트"');
    expect(signedInNav).toContain('label: "일정"');
    expect(signedInQuickLinks).toContain('label: "체크리스트"');
    expect(signedInQuickLinks).toContain('label: "일정"');

    for (const retiredPrimaryPath of [
      "/vendors",
      "/market-prices",
      "/bookings",
      "/money",
      "/favorites",
      "/wedding-code",
    ]) {
      expect(landingNav).not.toContain(retiredPrimaryPath);
      expect(landingProductLinks).not.toContain(retiredPrimaryPath);
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
    ]) {
      expect(tools).toMatch(
        new RegExp(`BETA_DISABLED_TOOL_NAMES[\\s\\S]*"${disabledTool}"`),
      );
    }
    expect(chatRoute).not.toContain('from("vendor_bookings")');
    expect(chatRoute).toContain("bookings: []");

    // `search_nearby_places` 는 2026-08-22 파운더 결정으로 열렸다. 같은 목록에
    // 있었지만 **업체를 찾아주는 도구가 아니다** — 웨딩업체 질의를
    // `wedding_vendor_query_blocked` 로 막고 네이버 결과에서도 웨딩업체를 걸러낸다.
    // 남는 것은 상견례 식당 같은 일반 장소뿐이고 예약·결제 경로가 없다.
    //
    // 여기서는 소스 텍스트가 아니라 **실제 집합**을 본다. 이 파일의 다른 검사처럼
    // 정규식으로 보면 근거를 적은 주석에 이름이 들어 있다는 이유로 통과해 버린다.
    expect(BETA_DISABLED_TOOL_NAMES.has("search_nearby_places")).toBe(false);
    expect(BETA_SAFE_TOOLS.map((tool) => tool.name)).toContain("search_nearby_places");
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
    expect(guide).toContain("아모라와 처음부터 끝까지.");
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
