import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { metadata as loginMetadata } from "@/app/(auth)/login/layout";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

describe("public journey contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps protected-route returns on the existing sanitized auth boundary", () => {
    const layout = readSource("src/app/(app)/layout.tsx");
    const middleware = readSource("src/lib/supabase/middleware.ts");

    expect(layout).toContain("sanitizeAuthReturnPath");
    expect(layout).toContain("pathWithAuthReturn");
    expect(layout).toContain("AUTH_RETURN_PATH_HEADER");
    expect(layout).not.toContain('redirect("/login")');
    expect(middleware).toContain("authReturnPathFromLocation(request.nextUrl)");
    expect(middleware).toContain("requestHeaders.set(AUTH_RETURN_PATH_HEADER, returnPath)");
    expect(middleware).toContain("requestHeaders.delete(AUTH_RETURN_PATH_HEADER)");
  });

  it("separates account creation from the no-account example app", () => {
    const login = readSource("src/app/(auth)/login/page.tsx");
    const demoLauncher = readSource("src/app/demo/login/page.tsx");
    const demoStartRoute = readSource("src/app/api/demo/start/route.ts");
    const landing = [
      "src/components/customer-landing/CustomerNav.tsx",
      "src/components/customer-landing/CustomerHero.tsx",
      "src/components/customer-landing/CustomerHowItWorks.tsx",
      "src/components/customer-landing/CustomerCTA.tsx",
    ].map(readSource).join("\n");

    expect(login).toContain('href="/demo/login"');
    expect(login).not.toContain('fetch("/api/demo/start"');
    expect(login).toContain("initial={false}");
    expect(demoLauncher).toContain('action="/api/demo/start"');
    expect(demoLauncher).toContain('method="post"');
    expect(demoLauncher).not.toContain('fetch("/api/demo/start"');
    expect(demoStartRoute).toContain('sameOriginRedirect("/wedding/lounge")');
    expect(demoStartRoute).toContain('headers: { Location: location }');
    expect(demoStartRoute).not.toContain("new URL(");
    expect(demoLauncher).not.toContain("INTERNAL DEV");
    expect(landing).toContain('"/demo/login"');
    expect(landing).toContain('"/login?mode=signup"');
    expect(landing).toContain("베타 계정 만들기");
  });

  it("supports mobile keyboards and password managers on the auth form", () => {
    const login = readSource("src/app/(auth)/login/page.tsx");

    expect(login).toContain('name="email"');
    expect(login).toContain('inputMode="email"');
    expect(login).toContain('autoComplete="email"');
    expect(login).toContain('name="password"');
    expect(login).toContain('"current-password"');
    expect(login).toContain('"new-password"');
  });

  it("uses server community feed data only as a one-time mount seed", () => {
    const community = readSource("src/components/community/CommunityLandingClient.tsx");

    expect(community).toContain("const [initialFeedAvailable, setInitialFeedAvailable] = useState(true)");
    expect(community).toContain("initialFeedAvailable &&");
    expect(community).toContain("setInitialFeedAvailable(false)");
    expect(community.indexOf("setInitialFeedAvailable(false)")).toBeLessThan(
      community.indexOf("hydrateInitialFeed(readyInitialFeed)"),
    );
  });

  it("does not present a failed community fetch as a genuine empty community", () => {
    const community = readSource("src/components/community/CommunityLandingClient.tsx");

    expect(community).toContain(
      "posts.length === 0 ? (\n        errorMessage ? null : isSearching ? ("
    );
    expect(community.indexOf("errorMessage ? null : isSearching")).toBeLessThan(
      community.indexOf("<EmptyFeedStarter />")
    );
  });

  it("keeps primary community actions comfortable on touch screens", () => {
    const community = readSource("src/components/community/CommunityLandingClient.tsx");
    const communityNav = readSource("src/components/community/CommunityNav.tsx");
    const communityLayout = readSource("src/app/(community)/layout.tsx");
    const globals = readSource("src/app/globals.css");

    expect(community).toContain(
      'aria-label="검색"\n            className="absolute right-1 top-1/2 inline-flex h-11 w-11'
    );
    expect(community).toContain("inline-flex min-h-11 items-center px-2");
    expect(communityNav).toContain("inline-flex min-h-11 shrink-0 items-center");
    expect(communityLayout).toContain("inline-flex h-11 w-11 items-center");
    expect(communityLayout).toContain("inline-flex min-h-11 items-center text-[13px]");
    expect(globals).toMatch(
      /button:not\(\.no-min-tap\)[\s\S]*?min-height:\s*44px/
    );
    expect(globals).not.toContain("min-height: 40px");
  });

  it("keeps auth consent and Amora panel controls touch-sized on mobile", () => {
    const login = readSource("src/app/(auth)/login/page.tsx");
    const chatPanel = readSource("src/components/app/chat/ChatSidePanel.tsx");
    const aiNotice = readSource("src/components/common/AiNoticeFooter.tsx");
    const community = readSource("src/components/community/CommunityLandingClient.tsx");

    expect(login).toContain(
      '<Link href="/wedding" className="inline-flex min-h-11 items-center justify-center">'
    );
    expect(login).toContain(
      'href="/terms" className="inline-flex min-h-11 items-center px-2'
    );
    expect(login).toContain(
      'href="/privacy" className="inline-flex min-h-11 items-center px-2'
    );
    expect(chatPanel.match(/className="w-11 h-11 flex items-center justify-center/g))
      .toHaveLength(2);
    expect(chatPanel).toContain(
      'href="/ai-policy" className="inline-flex min-h-11 items-center px-2'
    );
    expect(chatPanel).toContain("useAccessibleDialog({ isOpen, onClose })");
    expect(chatPanel).toContain("ref={dialogRef}");
    expect(chatPanel).toContain("data-dialog-initial-focus");
    expect(chatPanel).toContain('aria-label="파일 첨부"');
    expect(aiNotice).toContain("inline-flex min-h-11 items-center px-2");
    expect(community).toContain(
      'className="mt-4 flex min-h-11 items-center justify-between rounded-full bg-[#36534E]'
    );
  });

  it("boots a server-verified example session without initializing Supabase first", () => {
    const serverLayout = readSource("src/app/(app)/layout.tsx");
    const clientLayout = readSource("src/app/(app)/AppClientLayout.tsx");

    expect(serverLayout).toContain("<AppClientLayout initialDemo={Boolean(isDemo)}>");
    expect(clientLayout).toContain("initialDemo: boolean");
    expect(clientLayout).toContain("useAuthSessionSync(!initialDemo && !isDemo)");
    expect(clientLayout).toContain("initialize({ verifiedDemo: initialDemo })");
  });

  it("names the self-service beta separately from the selected research cohort", () => {
    const publicBeta = [
      "src/components/customer-landing/CustomerHero.tsx",
      "src/components/customer-landing/CustomerCTA.tsx",
      "src/components/customer-landing/CustomerFeatures.tsx",
    ].map(readSource).join("\n");
    const cohort = [
      "src/app/beta/page.tsx",
      "src/app/beta/BetaForm.tsx",
      "src/components/landing/ForBetaCouples.tsx",
      "src/constants/beta.ts",
    ].map(readSource).join("\n");

    expect(publicBeta).toContain("베타 계정");
    expect(publicBeta).not.toContain("공개 베타");
    expect(cohort).toContain("사용자 연구 코호트");
    expect(cohort).toContain("2026년 7~12월 결혼 예정 또는 예식일 미정");
    expect(cohort).not.toContain("정식 출시 일정 안내");
  });

  it("keeps public positioning within the current beta contract", () => {
    const metadata = [
      "src/app/layout.tsx",
      "src/app/demo/page.tsx",
    ].map(readSource).join("\n");
    const landing = [
      "src/components/customer-landing/CustomerComparison.tsx",
      "src/components/customer-landing/CustomerFeatures.tsx",
      "src/components/customer-landing/CustomerLogoShowcase.tsx",
      "src/components/customer-landing/CustomerPainPoints.tsx",
      "src/components/customer-landing/CustomerSolutions.tsx",
    ].map(readSource).join("\n");
    const guide = readSource("src/components/app/ServiceGuide.tsx");

    expect(metadata).toContain("AI와 함께 정리하는 결혼 준비");
    expect(metadata).not.toContain("AI가 이끄는 새로운 결혼 준비");
    expect(landing).not.toContain("커플 실시간 연동");
    expect(landing).not.toContain("완전히 다른 경험");
    expect(landing).not.toContain("지칠 수밖에 없을까요");
    expect(landing).toContain("한국소비자원 조사에서는 조사 업체 중 가격을 공개한 비율이 36.1%");
    expect(guide).toContain("현재 별도 이용료 없음");
    expect(guide).toContain("AI 답변 확인 필요");
    expect(guide).toContain("업체 연결 미제공");
    expect(guide).not.toContain('label: "무료"');
    expect(guide).not.toContain('label: "광고 없음"');
    expect(guide).not.toContain('label: "데이터 보호"');
  });

  it("labels guide examples and never presents synthetic activity as proof", () => {
    const communityGuide = readSource("src/components/community/CommunityGuide.tsx");
    const vendorCommunityPage = readSource("src/app/(community)/community/vendor/[name]/page.tsx");

    expect(communityGuide).toContain("화면 예시 · 실제 후기나 가격이 아닙니다");
    expect(communityGuide).not.toContain("가을의신부");
    expect(communityGuide).not.toContain("248명 활동 중");
    expect(communityGuide).not.toContain("광고는 표시하고, 추천에서 제외");

    expect(vendorCommunityPage).toContain('<PublicBetaUnavailable feature="vendor" />');
    expect(vendorCommunityPage).not.toMatch(/NoBookingFallback|BookingSection|fetch\(|supabase|vendor_products|실시간 슬롯|잔여 2/);
  });

  it("physically retires unverified vendor discovery and synthetic seeds", () => {
    const vendorListFiles = [
      "src/app/(app)/vendors/page.tsx",
      "src/app/(app)/vendors/favorites/page.tsx",
    ];
    const vendorLists = vendorListFiles.map(readSource).join("\n");
    const seedSources = [
      "src/app/api/admin/seed-vendors/route.ts",
      "src/app/api/admin/seed-venues/route.ts",
      "src/app/api/admin/seed-makeup/route.ts",
      "src/app/api/admin/seed-studios/route.ts",
    ].map(readSource).join("\n");

    for (const vendorListFile of vendorListFiles) {
      expect(readSource(vendorListFile), vendorListFile).toContain('<PublicBetaUnavailable feature="vendor" />');
    }
    expect(vendorLists).not.toMatch(/fetch\(|supabase|운영시간|예약 가능|rating|price_min/);
    expect(seedSources.match(/synthetic_vendor_seed_retired/g)).toHaveLength(4);
    expect(seedSources.match(/"Cache-Control": "private, no-store, max-age=0"/g)).toHaveLength(4);
    expect(seedSources).not.toMatch(
      /verifyAdmin|getServiceClient|seedGate|vendor_products|vendor_timeslots|priceMin|priceMax|최고|최저가|평점 1위|인기 1위|추천 1위|단독홀 보장|시술 보장/,
    );
  });

  it("keeps proactive moment advice free of unsupported prices and universal customs", () => {
    const moments = readSource("src/constants/moments.ts");

    expect(moments).toContain("피팅 비용·결제수단과 취소 조건 사전 확인");
    expect(moments).toContain("목적지별 유효기간 요건 확인");
    expect(moments).not.toMatch(/10~20만원|샵당 3~5만원|1인 5만원|10명 중 8명|국룰|부부싸움 1순위|호구 잡힐 일 없어/);
  });

  it("keeps planning guidance source-honest when prices vary", () => {
    const checklists = readSource("src/constants/checklists.ts");
    const onboarding = readSource(
      "src/components/onboarding/WeddingStylePreferences.tsx",
    );
    const communityDetail = readSource("src/app/(community)/community/post/[id]/page.tsx");
    const communityProjection = readSource("src/lib/community/postSelect.ts");
    const serviceGuide = readSource("src/components/app/ServiceGuide.tsx");
    const serviceCta = readSource("src/components/community/ServiceCTA.tsx");

    expect(checklists).toContain("여러 날짜의 총액과 취소·변경 조건, 여권·비자·보험의 최신 공식 안내를 직접 확인하세요");
    expect(checklists).toContain("총액·설치비·보증·반품 조건을 함께 비교하세요");
    expect(checklists).not.toContain("항공권은 빨리 예약할수록 저렴합니다");
    expect(checklists).not.toContain("수백만원을 아낄 수 있습니다");
    expect(onboarding).toContain("예산을 어떻게 운영하고 싶나요?");
    expect(communityDetail).not.toMatch(/AiCommentBox|post\.ai_comment|가격 판정/);
    expect(communityProjection).not.toMatch(/ai_comment|price_data|cost_data/);
    expect(serviceGuide).toContain("공식 조사 자료의 지역·시점·포함 항목 확인");
    expect(serviceGuide).not.toContain("내 견적이 평균과 얼마나 다른지 확인");
    expect(serviceCta).toContain("계획 금액·서명한 계약 총액·실제 납부액을 구분해 기록합니다");
    expect(serviceCta).not.toContain("견적가와 예상 추가금을 한 곳에서 관리합니다");
  });

  it("keeps lounge plan, signed-contract, and payment records separate", () => {
    const lounge = readSource("src/app/(app)/lounge/page.tsx");

    expect(lounge).toContain("getFinancialRecords(progress)");
    expect(lounge).toContain("계획 예산");
    expect(lounge).toContain("서명한 계약 총액");
    expect(lounge).toContain("누적 납부액");
    expect(lounge).toContain("예산 기록");
    expect(lounge).not.toMatch(/spentBudget|budgetPercent|budgetWidth|getSpent\(|남은 예산|초과 금액|만원\} 사용/);
    expect(lounge).not.toContain("item.spent ?? item.cost");
  });

  it("does not present failed active lounge requests as genuine empty states", () => {
    const lounge = readSource("src/app/(app)/lounge/page.tsx");

    expect(lounge).toContain("setSavedError(true)");
    expect(lounge).toContain("저장한 글을 불러오지 못했어요.");
    expect(lounge).toContain("다시 불러오기");
    expect(lounge).not.toMatch(/ActionsLoadError|actionsLoadError|\/api\/amora\/actions|할 일 다시 불러오기/);
    expect(lounge).not.toMatch(/CohortState|cohortState|\/api\/community\/cohort|동기방 소식|이번 주 요약 일부/);
  });

  it("keeps current principles and design documentation on the actual service boundary", () => {
    const repoDocument = (relativePath: string) =>
      readFileSync(join(process.cwd(), "../..", relativePath), "utf8");
    const principles = repoDocument("PRINCIPLES.md");
    const design = repoDocument("DESIGN.md");

    expect(principles).toContain("현재 업체 연결·예약·결제 기능은 제공하지 않는다");
    expect(principles).toContain("법률·개인정보·안전 요건은 다른 원칙과 교환할 수 없는 출시 조건");
    expect(principles).not.toContain("최고이자 유일한");
    expect(principles).not.toContain("베타 50쌍 평균 추가금");
    expect(design).toContain("Vendor connection, reservation, and payment are currently disabled");
    expect(design).not.toContain("vendor marketplace");
    expect(design).not.toContain("Any AI call must be logged");
  });

  it("marks superseded strategy and demo documents as historical", () => {
    const repoDocument = (relativePath: string) =>
      readFileSync(join(process.cwd(), "../..", relativePath), "utf8");
    const historicalDocuments = [
      "docs/DEMO_SCRIPT_90s.md",
      "docs/HANBANG_POSITIONING_2026.md",
      "docs/MOBILE_APP_MASTERPLAN_2026-06-30.md",
      "docs/TEAM_HANDOFF_2026-06-15_AMORA_BOOKING_SECURITY.md",
      "docs/VENDOR_SUPPLY_PLAYBOOK.md",
      "docs/WINWINWIN_MODEL_VERDICT_2026-06-10.md",
    ];

    historicalDocuments.forEach((documentPath) => {
      const document = repoDocument(documentPath);
      expect(document).toContain("> [!WARNING]");
      expect(document).toContain("WEDDINGHANBANG_SERVICE_DOC.md");
    });
  });

  it("noindexes login while publishing stable public-page sitemap dates", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(loginMetadata.robots).toMatchObject({ index: false, follow: false });

    const pages = await sitemap();
    const urls = pages.map((page) => page.url);
    expect(urls).toEqual(expect.arrayContaining([
      "https://hanbang.ai/demo",
      "https://hanbang.ai/about",
      "https://hanbang.ai/beta",
    ]));
    expect(urls).not.toContain("https://hanbang.ai/login");

    const staticDates = pages.map((page) => page.lastModified);
    expect(staticDates.every((date) => date instanceof Date)).toBe(true);
    expect(staticDates.every((date) => (date as Date).toISOString() === "2026-07-11T00:00:00.000Z")).toBe(true);

    const rules = robots().rules;
    const ruleList = Array.isArray(rules) ? rules : [rules];
    const disallow = ruleList.flatMap((rule) => {
      if (!rule.disallow) return [];
      return Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
    });
    expect(disallow).not.toContain("/demo");
  });

  it("publishes only launch-safe pages while coming-soon mode is active", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "coming_soon");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const urls = (await sitemap()).map((page) => page.url);
    expect(urls).toEqual([
      "https://hanbang.ai/demo",
      "https://hanbang.ai/about",
      "https://hanbang.ai/beta",
    ]);

    const rules = robots().rules;
    const ruleList = Array.isArray(rules) ? rules : [rules];
    expect(ruleList).toEqual([
      expect.objectContaining({
        userAgent: "*",
        disallow: expect.arrayContaining(["/", "/beta/verify"]),
        allow: expect.arrayContaining(["/demo", "/beta", "/privacy"]),
      }),
    ]);
  });

  it("keeps coming-soon footer links inside the server allowlist", () => {
    const footer = readSource("src/components/landing/Footer.tsx");
    expect(footer).toContain("COMING_SOON_LINKS");
    for (const destination of ["/demo", "/beta", "/about", "/support"]) {
      expect(footer).toContain(`href: "${destination}"`);
    }
    expect(footer).toContain("아직 로그인·앱 기능은 제공하지 않습니다");
  });

  it("does not send coming-soon visitors into the gated example app", () => {
    const howItWorks = readSource("src/components/customer-landing/CustomerHowItWorks.tsx");
    const features = readSource("src/components/customer-landing/CustomerFeatures.tsx");
    const scenarios = readSource("src/components/customer-landing/CustomerTestimonials.tsx");
    const betaForm = readSource("src/app/beta/BetaForm.tsx");
    const comingSoonCtas = [
      "src/components/customer-landing/CustomerNav.tsx",
      "src/components/customer-landing/CustomerHero.tsx",
      "src/components/customer-landing/CustomerCTA.tsx",
      "src/components/customer-landing/CustomerHowItWorks.tsx",
    ].map(readSource).join("\n");

    expect(howItWorks).toContain('isComingSoon ? "/beta" : "/demo/login"');
    expect(howItWorks).toContain("현재 계정·앱 기능은 열려 있지 않습니다. 아래는 구현된 4단계 흐름입니다.");
    expect(features).toContain("현재 계정·앱 기능은 열려 있지 않으며, 아래는 구현 범위 설명입니다.");
    expect(scenarios).toContain("현재 계정·앱 기능은 열려 있지 않습니다. 아래는 구현된 활용 예시입니다.");
    expect(comingSoonCtas).toContain("사용자 연구");
    expect(comingSoonCtas).toContain('/beta#cta');
    expect(comingSoonCtas).toContain("6주 사용자 연구");
    expect(comingSoonCtas).not.toContain("베타 소식 신청");
    expect(betaForm).toContain('COMING_SOON ? "/demo" : weddingPath()');
    expect(betaForm).toContain("서비스 소개로 돌아가기");
  });
});
