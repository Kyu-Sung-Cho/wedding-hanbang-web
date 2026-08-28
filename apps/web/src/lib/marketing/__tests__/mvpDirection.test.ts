import { describe, expect, it } from "vitest";

import { landingContent } from "@/components/landing/redesign/landingContent";
import { BETA_DISABLED_TOOL_NAMES, BETA_SAFE_TOOLS } from "@/lib/ai/tools";

import {
  contentBlock,
  everyLandingComponent,
  rendered,
  renderedSections,
  source,
  stripComments,
} from "../../../app/landing/__tests__/landingSource";

/**
 * ## 2026-08-27 적대적 검증에서 이 파일로 빠져나간 것들
 *
 * - **주석이 코드 대신 대답했다.** 이 파일은 자기 `source()`로 원문을 읽고
 *   `toContain`으로 물었다. 그래서 카피를 지우고 줄 끝 주석으로 남기면 통과했고,
 *   `{/* <ScenesSection /> *␣/}`로 섹션을 통째로 꺼도 순서 검사가 통과했다.
 *   → 이제 `landingSource`의 `rendered()`·`renderedSections()`를 쓴다.
 * - **자리를 안 봤다.** 필수 문장을 `landingContent.ts` 아무 데서나 찾아서,
 *   히어로의 문장을 `footer.tagline`으로 옮겨도 통과했다.
 *   → `contentBlock()`으로 그 문장이 있어야 할 블록에서 찾는다.
 * - **정규식이 잔존 참조에 속았다.** `BETA_DISABLED_TOOL_NAMES[\s\S]*"create_booking"`는
 *   그 이름이 **파일 어디에든** 있으면 통과한다(주석·다른 배열 포함).
 *   → 소스 텍스트가 아니라 실제 집합(`.has()`)을 본다.
 * - **OG 카드가 정본을 안 읽어도 통과했다.** 제목을 하드코딩하고
 *   `landingContent.hero.title`을 `alt` 문자열에만 남기면 잔존 참조가 대신 답했다.
 *   → 렌더 경로에서 정본을 읽는지 + 정본 문장이 카드에 글자로 박혀 있지 않은지 함께 본다.
 */

const LANDING_REDESIGN_DIR = "src/components/landing/redesign";

/**
 * 랜딩 본문이 실제로 그리는 섹션 id 전부.
 *
 * 헤더 내비는 본문 앵커만 가리키는데, 본문에 없는 앵커를 가리키면 눌러도 아무 일이
 * 일어나지 않는다 — `LandingHeader.tsx` 주석이 "실제로 있었다"고 적어 둔 사고다.
 * 목록을 손으로 적으면 섹션이 사라져도 모르므로 디렉터리를 통째로 읽고,
 * **주석은 벗기고** 센다 — `{/* <Section id="scenes"> *␣/}` 로 꺼 놓은 섹션이
 * 살아 있는 앵커로 세어지면 이 검사가 정확히 막으려던 사고를 통과시킨다.
 */
function landingSectionIds(): Set<string> {
  const ids = new Set<string>();
  for (const [, componentSource] of everyLandingComponent()) {
    for (const match of componentSource.matchAll(/\bid="([a-z][a-z-]*)"/gu)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function blockBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);

  // -1 이면 `slice(-1)`이 마지막 한 글자를 주고 `length > 0`류 가드는 영원히 참이 된다.
  // 그래서 자르기 전에 경계를 먼저 확인한다.
  expect(startIndex, `블록 시작 "${start}"을 찾지 못했다`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `블록 끝 "${end}"을 찾지 못했다`).toBeGreaterThan(startIndex);
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
    const hero = rendered(`${LANDING_REDESIGN_DIR}/TransformationHero.tsx`);
    const communityPage = rendered("src/app/(community)/community/page.tsx");
    const communityLayout = rendered("src/app/(community)/layout.tsx");
    const communityNav = rendered("src/components/community/CommunityNav.tsx");
    const priceLayout = rendered("src/app/price/layout.tsx");
    const community = stripComments(
      source("src/components/community/CommunityLandingClient.tsx"),
    ).replace(/\r?\n\s*/g, " ");

    expect(productContract).toContain(PRODUCT_DEFINITION);
    expect(principles).toContain(PRODUCT_DEFINITION.replace("서비스입니다.", "서비스다."));

    // 2026-08-27 랜딩 개편에서 히어로의 `eyebrow`("웨딩한방 · 둘이 함께 관리하는
    // 결혼 준비 공간")와 `aiRole`("아모라 · 대화를 정리하는 AI") 필드가 없어졌다.
    // 첫 화면 후크가 도구 설명에서 "둘이 어디서 갈리는지"로 바뀌었기 때문이다.
    // 두 문자열이 지키던 것은 **랜딩이 제품과 아모라를 무엇이라고 부르는지를
    // 카피 정본 한 곳에서 정한다**는 것이므로, 같은 일을 하는 새 문장으로 옮긴다.
    // 조건을 느슨하게 하지 않는다 — 셋 다 글자 그대로, **있어야 할 블록에서** 대조한다.
    // (파일 전체에서 찾으면 그 문장을 푸터 태그라인으로 옮겨도 통과한다.)
    // 2026-08-28: 문장이 바뀌었다. 옛 문장은 제품이 아니라 기능 하나를 말했다.
    // 지키는 것은 같다 — 랜딩이 제품을 무엇이라고 부르는지 정본 한 곳에서 정한다.
    expect(contentBlock("hero", "scenes"), "제품 소개 문장이 히어로 밖으로 나갔다")
      .toContain("웨딩한방은 둘이 그 기준을 맞춰 가는 곳이고, 정한 것만 남겨요");
    // 아모라를 소개하는 자리에서 AI라는 것을 먼저 말한다(옛 `aiRole`이 지던 몫).
    expect(contentBlock("noSide", "oneRoom"), "AI 고지가 아모라 소개 자리에 없다")
      .toContain("아모라 답변은 AI가 만든 내용이에요");
    // 도구 세 이름은 "확인한 것만 남는다"를 말하는 자리에서 불린다.
    expect(contentBlock("confirm", "notForVendors")).toContain("예산·할 일·일정");

    // 히어로가 카피를 자기 안에 하드코딩하지 않고 정본에서 읽는다.
    expect(hero).toContain("const { hero } = landingContent;");
    expect(hero).toContain("{hero.body}");

    // 공유 카드도 같은 정본을 읽는다. 카드는 링크를 받은 사람에게 **제품의 첫 화면**이라
    // 여기가 갈리면 H1과 다른 말을 하는 제품이 된다.
    //
    // ⚠️ `toContain("landingContent.hero.title")` 하나로는 못 막는다. 카드가 제목을
    // 하드코딩하고 그 참조를 `alt` 문자열에만 남기면 잔존 참조가 대신 답한다
    // (2026-08-27 적대적 검증에서 실제로 통과한 변형). 그래서 ① 그리는 경로에서
    // 정본을 읽고 ② 정본 문장이 카드 소스에 글자로 박혀 있지 않은지 둘 다 본다.
    const ogCard = rendered("src/app/landing/opengraph-image.tsx");
    expect(ogCard, "공유 카드가 H1 정본을 읽지 않는다")
      .toContain("landingContent.hero.title.split(");
    expect(ogCard, "공유 카드가 본문 정본을 읽지 않는다")
      .toContain("landingContent.hero.body.split(");
    for (const line of landingContent.hero.title.split("\n")) {
      expect(ogCard, `공유 카드가 H1을 하드코딩했다: "${line}"`).not.toContain(line);
    }
    expect(ogCard, "공유 카드가 히어로 본문을 하드코딩했다")
      .not.toContain(landingContent.hero.body.split(". ")[0]);

    expect(communityPage).toContain("웨딩한방 — 결혼 준비를 아모라와 정리하세요");
    expect(community).toContain(PRODUCT_DEFINITION.replace("서비스입니다.", "서비스예요."));
    for (const publicShell of [communityLayout, communityNav, priceLayout]) {
      expect(publicShell).toContain(PRODUCT_TAGLINE);
      expect(publicShell).not.toContain("예비부부의 고민과 경험이 모이는 곳");
      expect(publicShell).not.toContain("AI가 함께하는 가장 든든한 결혼 준비");
    }
  });

  it("lets the community deliver people-first value before Amora turns it into a plan", () => {
    const community = stripComments(
      source("src/components/community/CommunityLandingClient.tsx"),
    );
    const searchHubRender = community.indexOf("{searchHubNode}");
    const communityMainRender = community.indexOf("{communityMainNode}", searchHubRender);
    const amoraRender = community.indexOf("{showLandingIntro && <AmoraBlock />}");
    const whatWeDoRender = community.indexOf("{showLandingIntro && <WhatWeDo />}");

    // 랜딩 쪽 몫은 **사람이 먼저 만질 것이 신뢰·면책 설명보다 앞에 온다**는 것이다.
    // 개편 전에는 `<PreparationResult />`가 `<TrustEvidenceSection` 앞이었는데 둘 다
    // 2026-08-27에 삭제됐다. 같은 자리를 지금은 ScenesSection(로그인 없이 바로 만지는
    // 장면 하나)과 NotForVendorsSection(업체 편이 아니라는 설명, id="trust")이 잇는다.
    //
    // ⚠️ `page.tsx` 원문에 `indexOf`를 걸던 옛 형태는 **주석 처리한 섹션을 살아 있는
    // 것으로 셌다**. `renderedSections()`는 주석을 벗긴 뒤 `<main>` 안에서 실제로
    // 그려지는 컴포넌트만 순서대로 준다.
    const sections = renderedSections();
    const at = (name: string) => sections.indexOf(name);

    expect(at("ScenesSection"), "장면 섹션이 렌더되지 않는다").toBeGreaterThanOrEqual(0);
    expect(at("NotForVendorsSection"), "신뢰 설명이 장면보다 앞에 온다")
      .toBeGreaterThan(at("ScenesSection"));

    // `landing/page.tsx` 주석이 "④를 ③ 앞으로 옮기지 마라"고 못 박은 순서다.
    // ③이 "두 사람 대화가 한 덩어리"라고 말한 직후에 사람들은 "그럼 내가 쓴 게 다
    // 가나"를 걱정하고, 그 걱정을 ④(나만 보는 자리)가 받지 않으면 ③이 불안으로 끝난다.
    expect(at("OneRoomSection"), "한 방 섹션이 렌더되지 않는다").toBeGreaterThanOrEqual(0);
    expect(at("PrivateLaneSection"), "나만 보는 자리가 한 방 설명보다 앞에 온다")
      .toBeGreaterThan(at("OneRoomSection"));

    expect(community).toContain('data-community-home-order="search-first"');
    expect(searchHubRender).toBeGreaterThanOrEqual(0);
    expect(communityMainRender).toBeGreaterThan(searchHubRender);
    expect(amoraRender).toBeGreaterThan(communityMainRender);
    expect(whatWeDoRender).toBeGreaterThanOrEqual(0);
    expect(whatWeDoRender).toBeGreaterThan(amoraRender);
    expect(whatWeDoRender).toBeLessThan(community.indexOf("<DisclosureHero"));
  });

  it("keeps landing story anchors distinct from the Amora product navigation", () => {
    const landingHeader = rendered(`${LANDING_REDESIGN_DIR}/LandingHeader.tsx`);
    const landingFooter = rendered(`${LANDING_REDESIGN_DIR}/LandingFooter.tsx`);
    const communityNav = stripComments(source("src/components/community/CommunityNav.tsx"));
    const userMenu = source("src/components/community/UserMenu.tsx");
    const sidebar = stripComments(source("src/components/app/Sidebar.tsx"));
    const topNav = stripComments(source("src/components/app/TopNav.tsx"));

    // 2026-08-27 개편으로 내비·푸터 링크 정본이 컴포넌트에서 `landingContent.ts`로
    // 옮겨 갔다(`headerNav` · `footerLinks`). 읽는 곳을 옮기되, 컴포넌트가 그 정본을
    // 실제로 쓰는지도 함께 본다 — 정본만 고치고 컴포넌트가 자기 목록을 따로 들면
    // 이 검사가 화면과 무관해진다.
    const landingNav = contentBlock("headerNav");
    const landingProductLinks = contentBlock("footerLinks", "headerAuth");
    expect(landingHeader).toContain("headerNav");
    expect(landingFooter).toContain("footerLinks");
    // 목록을 읽기만 하고 목적지를 손으로 적으면(`href="#"`) 아래 라벨·앵커 검사가
    // 전부 통과하면서 눌러도 아무 데도 가지 않는다.
    expect(landingHeader, "헤더가 카피의 href를 쓰지 않는다").toContain("href={item.href}");
    expect(landingFooter, "푸터가 카피의 href를 쓰지 않는다").toContain("href={item.href}");
    const publicNav = blockBetween(communityNav, "const baseNavItems = [", "];");
    const signedInNav = blockBetween(sidebar, "const menuItems:", "];");
    const signedInQuickLinks = blockBetween(topNav, "const quickLinks = [", "];");

    // 랜딩 내비 항목은 개편으로 전부 바뀌었다(#how-it-works·#privacy·#trust·
    // #start-conditions → #scenes·#noside·#confirm·#now). 이름이 바뀐 것이지
    // 성격이 바뀐 게 아니다 — 여전히 본문 이야기 앵커이고, 제품 라우트가 아니다.
    const sectionIds = landingSectionIds();
    for (const [label, href] of [
      ["갈린 자리 보기", "#scenes"],
      // 2026-08-28: 섹션 제목이 부정문에서 바뀌면서 내비 라벨도 따라갔다.
      ["둘의 조건 나란히", "#noside"],
      ["확인한 것만", "#confirm"],
      ["지금 되는 것", "#now"],
    ]) {
      expect(landingNav).toContain(`label: "${label}", href: "${href}"`);
      // 개편 전에는 본문에 없는 앵커를 가리키는 항목이 실제로 있었다(눌러도 아무
      // 일이 없다). 라벨만 대조하면 그 상태가 그대로 통과하므로 목적지도 본다.
      expect(sectionIds, `${href}를 받는 섹션이 본문에 없다`).toContain(href.slice(1));
    }

    // 푸터는 링크를 **로그인 없이 / 계정 베타 / 정책** 셋으로 나눈다. 옛 구조는
    // 항목마다 `note: "로그인 필요"`를 달았고, 지금은 묶음 이름이 그 경계를 말한다.
    // 어느 쪽이든 지키는 것은 같다 — 미로그인 방문자가 예고 없이 로그인 화면에
    // 도착하지 않는다. 그래서 묶음 이름과 배선을 함께 고정한다.
    const landingOpenLinks = blockBetween(landingProductLinks, "  open: [", "  ],");
    const landingBetaLinks = blockBetween(landingProductLinks, "  beta: [", "  ],");
    expect(landingFooter).toContain('{ label: "로그인 없이", items: footerLinks.open }');
    expect(landingFooter).toContain('{ label: "계정 베타", items: footerLinks.beta }');
    // 계정이 필요한 목적지에서 예산·할 일·일정을 계속 이름으로 부른다.
    // (옛 푸터는 "할 일·일정"과 "예산"을 따로 걸었고 지금은 한 줄로 합쳤다.)
    //
    // ⚠️ `label: "아모라 채팅"`을 요구하던 단언은 여기서 없앴다. 지킬 대상이
    // 없어졌다 — 개편된 푸터에는 아모라로 가는 링크가 아예 없고, 계정 베타 묶음
    // 두 줄이 모두 `/login`으로 간다. 이름을 살려 두면 카피에 없는 링크를
    // 요구하는 셈이라 조용히 통과시킬 방법이 없다. 아모라 진입점을 푸터에
    // 되살릴지는 제품 결정이므로 여기서 대신 정하지 않고, 보고서에 남긴다.
    expect(landingBetaLinks).toContain('label: "예산·할 일·일정"');
    // 이 두 줄은 커뮤니티를 랜딩 안쪽 설명 띠(#community-bridge)로 보내고 "운영 공개
    // 전"이라고 달아 두는 상태를 고정했다. 그건 사실이 아니었다 — 커뮤니티는 이미
    // 열려 있고 로그인 없이 읽힌다(hanbang.ai/community 200 확인). 열려 있는 것을
    // 닫혔다고 말하면 들어올 사람을 돌려보낸다. 실제 화면으로 보내는 쪽이 맞다.
    // `weddingPath()`가 돌려주는 값이 곧 `/wedding`이라 목적지는 그대로다.
    expect(landingOpenLinks).toContain('label: "커뮤니티", href: "/wedding"');
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

    // `/wedding-code`가 이 목록에 있었다. 2026-08-27 파운더 결정으로 랜딩의 후크가
    // 스무 장면(웨딩코드)이 되면서 **랜딩에서는 더 이상 물러난 경로가 아니다** —
    // 헤더 CTA·푸터 "로그인 없이" 묶음·마무리 CTA가 모두 여기로 보낸다.
    // 로그인 후 제품 내비게이션에서는 그대로 빠져 있어야 하므로, 목록을 둘로 나눈다.
    const retiredEverywhere = [
      "/vendors",
      "/market-prices",
      "/bookings",
      "/money",
      "/favorites",
    ];
    for (const retiredPrimaryPath of [...retiredEverywhere, "/wedding-code"]) {
      expect(publicNav).not.toContain(retiredPrimaryPath);
      expect(signedInNav).not.toContain(retiredPrimaryPath);
      expect(signedInQuickLinks).not.toContain(retiredPrimaryPath);
      expect(userMenu).not.toContain(`weddingLinkProps("${retiredPrimaryPath}")`);
    }

    // 랜딩 표면은 웨딩코드만 예외로 두고 나머지는 그대로 막는다. 업체·예약·축의금은
    // 제품 계약이 "현재 핵심 흐름보다 먼저 확장하지 않는다"고 못 박은 축이라,
    // 랜딩이 먼저 그 문을 열어 주면 안 된다.
    for (const retiredPrimaryPath of retiredEverywhere) {
      expect(landingNav).not.toContain(retiredPrimaryPath);
      expect(landingProductLinks).not.toContain(retiredPrimaryPath);
    }
  });

  it("keeps marketplace and booking tools outside the current Amora registry", () => {
    const chatRoute = rendered("src/app/api/chat/route.ts");

    // ⚠️ 옛 형태는 `new RegExp("BETA_DISABLED_TOOL_NAMES[\\s\\S]*\"create_booking\"")`였다.
    // 그건 그 이름이 **파일 어디에든** 한 번 나오면 통과한다 — 배열에서 빼고 주석에
    // "예전엔 create_booking 도 여기 있었다"고 적어 두기만 해도 초록이었다.
    // 소스 텍스트가 아니라 실제 집합을 본다(이 파일이 `search_nearby_places`에
    // 대해 이미 하던 방식이다).
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
      expect(
        BETA_DISABLED_TOOL_NAMES.has(disabledTool),
        `${disabledTool}가 베타 차단 목록에서 빠졌다`,
      ).toBe(true);
      expect(
        BETA_SAFE_TOOLS.map((tool) => tool.name),
        `${disabledTool}가 아모라에게 열렸다`,
      ).not.toContain(disabledTool);
    }
    expect(chatRoute).not.toContain('from("vendor_bookings")');
    expect(chatRoute).toContain("bookings: []");

    // `search_nearby_places` 는 2026-08-22 파운더 결정으로 열렸다. 같은 목록에
    // 있었지만 **업체를 찾아주는 도구가 아니다** — 웨딩업체 질의를
    // `wedding_vendor_query_blocked` 로 막고 네이버 결과에서도 웨딩업체를 걸러낸다.
    // 남는 것은 상견례 식당 같은 일반 장소뿐이고 예약·결제 경로가 없다.
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
    // 있어야 하는 문장은 주석을 벗기고 본다 — 지우고 주석으로 남기면 통과했다.
    expect(rendered("src/lib/amora/lifecycle.ts"))
      .toContain("결혼식 뒤 남은 일을 일정에 모아두세요");
  });

  it("keeps the signed-in guide inside the same MVP promise and claim boundary", () => {
    const guide = rendered("src/components/app/ServiceGuide.tsx");

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
      expect(source("src/components/app/ServiceGuide.tsx"))
        .not.toContain(staleOrUnsupportedClaim);
    }
  });

  it("uses plain language across the signed-in setup and planning surfaces", () => {
    const PLAIN_LANGUAGE_PATHS = [
      "src/app/(app)/dashboard/page.tsx",
      "src/app/(app)/settings/page.tsx",
      "src/components/onboarding/WeddingDetails.tsx",
      "src/stores/authStore.ts",
      "src/constants/notifications.ts",
      "src/constants/moments.ts",
      "src/lib/ai/amoraPendingAction.ts",
      "src/lib/ai/tools.ts",
      "../../packages/shared/src/constants/weddingPlanning.ts",
      "../../packages/shared/src/constants/weddingPreferences.ts",
    ];
    // 금지어는 원문에서 본다(주석에 남은 옛 용어도 되살아날 재료다).
    const rawSources = PLAIN_LANGUAGE_PATHS.map(source).join("\n");
    // 있어야 하는 말은 주석을 벗기고 본다.
    const shippedSources = PLAIN_LANGUAGE_PATHS.map(rendered).join("\n");

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
      "부케",
      "컨셉",
      "바우처",
      "양가",
      "메이크업 리허설",
    ]) {
      expect(rawSources).not.toContain(unexplainedOrStaleTerm);
    }

    for (const unsupportedPlanningClaim of [
      "결혼식 1년 전",
      "3개월 이상 소요",
      "빨리 예약할수록 저렴",
      "서둘러야 합니다",
      "리허설을 진행하세요",
    ]) {
      expect(rawSources).not.toContain(unsupportedPlanningClaim);
    }

    expect(shippedSources).toContain("결혼식 날짜");
    expect(shippedSources).toContain("결혼식장");
    expect(shippedSources).toContain("사진 촬영·드레스·헤어·메이크업");
  });

  it("presents template timing as a reference order rather than a real deadline", () => {
    const TIMING_PATHS = [
      "src/app/(app)/lounge/page.tsx",
      "src/components/community/StartHereClient.tsx",
      "src/components/app/schedule/ImminentAlerts.tsx",
      "src/components/app/schedule/TimelineView.tsx",
    ];
    const rawTiming = TIMING_PATHS.map(source).join("\n");
    const shippedTiming = TIMING_PATHS.map(rendered).join("\n");

    // 어형·표기를 하나만 막으면 "권장마감"·"마감을 계산"으로 그대로 돌아온다.
    // 템플릿 순서를 진짜 마감으로 말하는 어떤 표기도 막는다.
    expect(rawTiming).not.toMatch(/권장\s*마감|마감\s*(계산|을 계산|이 계산|계산이)/u);
    expect(shippedTiming).toContain("기본 확인 시점");
    expect(shippedTiming).toContain("실제 계약서");
    expect(shippedTiming).toContain("업체·가족");
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

    // 지시문은 모델에게 실제로 나가는 것만 유효하다 — 주석에 적힌 규칙은 프롬프트에
    // 실리지 않는다. 그래서 주석을 벗기고 본다.
    const shippedTools = rendered("src/lib/ai/tools.ts");
    expect(shippedTools).toContain("사용자가 직접 입력하거나 확인한 목표 금액·견적·상한만 사용하세요");
    expect(shippedTools).toContain("우선순위만으로 임의의 비율이나 금액을 만들지 마세요");
  });

  it("keeps an unentered total budget unset across onboarding and budget surfaces", () => {
    const BUDGET_PATHS = [
      "src/stores/onboardingStore.ts",
      "src/app/api/onboarding/route.ts",
      "src/app/api/auth/me/route.ts",
      "src/components/app/budget/BudgetContent.tsx",
      "src/app/(app)/dashboard/page.tsx",
      "src/components/onboarding/WeddingDetails.tsx",
    ];
    const onboardingStore = rendered(BUDGET_PATHS[0]);
    const onboardingRoute = rendered(BUDGET_PATHS[1]);
    const authRoute = rendered(BUDGET_PATHS[2]);
    const budgetPage = rendered(BUDGET_PATHS[3]);
    const dashboardPage = rendered(BUDGET_PATHS[4]);
    const weddingDetails = rendered(BUDGET_PATHS[5]);
    const rawBudgetSources = BUDGET_PATHS.map(source).join("\n");

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
      expect(rawBudgetSources).not.toContain(inventedDefault);
    }
  });
});
