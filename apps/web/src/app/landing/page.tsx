import type { Metadata } from "next";

import AvailableNowSection from "@/components/landing/redesign/AvailableNowSection";
import ClosingAction from "@/components/landing/redesign/ClosingAction";
import ConfirmSection from "@/components/landing/redesign/ConfirmSection";
import LandingFooter from "@/components/landing/redesign/LandingFooter";
import LandingHeader from "@/components/landing/redesign/LandingHeader";
import AmoraNoteSection from "@/components/landing/redesign/AmoraNoteSection";
import LandingBloomLayer from "@/components/landing/redesign/LandingBloomLayer";
import BoundariesSection from "@/components/landing/redesign/BoundariesSection";
import CommunitySection from "@/components/landing/redesign/CommunitySection";
import NoSideSection from "@/components/landing/redesign/NoSideSection";
import OneRoomSection from "@/components/landing/redesign/OneRoomSection";
import PrivateLaneSection from "@/components/landing/redesign/PrivateLaneSection";
import ScenesSection from "@/components/landing/redesign/ScenesSection";
import TransformationHero from "@/components/landing/redesign/TransformationHero";

export const revalidate = 86_400;

/**
 * 제목은 두 가지를 동시에 진다. 앞은 이 페이지가 파는 약속이고, 뒤는 검색 결과에서
 * 우리를 구분해 주는 것이다.
 *
 * 2026-08-27 에 바꿨다. 이전 제목은 "공시된 가격·위약금 원문" 을 차별점으로 걸었는데,
 * 그건 한국소비자원 참가격이라 **공개 자료**다. 누구나 볼 수 있는 것을 우리 차별점으로
 * 걸 수 없다. 우리만 할 수 있는 것은 **두 사람의 대화를 한 덩어리로 읽는 것**이다
 * (`api/chat/route.ts:1889` — couple_id 로 읽고 sender_id 필터가 없다).
 *
 * 루트 폴백과 **같은 문자열**이어야 한다. 여기를 고치면 `src/app/page.tsx` 의
 * title 도 같이 고친다. 두 곳이 검사한다:
 *
 *   `components/community/__tests__/landingFunnelInstrumentation.test.ts`  ← 정본
 *   `__tests__/landingTitleParity.test.ts`                                 ← canonical·sitemap 까지
 *
 * (2026-08-27에 앞의 것을 "저장소에 없다"고 잘못 판단해 뒤의 것을 새로 만들었다.
 * 파일 **내용**만 grep 했는데 그 파일은 자기 이름을 안 들고 있었다 — 파일 이름도
 * 같이 찾아야 한다. 둘 다 남긴 이유는 추출 방식이 달라 서로의 사각지대를 덮기 때문이다.)
 */
export function generateMetadata(): Metadata {
  // 상수를 이 함수 **안에** 둔다. 밖으로 빼면
  // `components/community/__tests__/landingFunnelInstrumentation.test.ts` 의 추출기
  // (`generateMetadata … const title = "…"`)가 못 읽어 제목을 빈 문자열로 보고,
  // 루트 폴백과의 동일성 검사가 조용히 무의미해진다. 실제로 그렇게 됐었다.
  // 2026-09-03 시안으로 후크가 바뀌면서 같이 옮겼다. 제목은 히어로 테이프 이름표와
  // 같은 말이다 — 검색 결과에서 보는 한 줄과 첫 화면 맨 위 한 줄이 어긋나지 않게.
  const title = "웨딩한방 | 둘이 하는 결혼 준비, 아모라와";
  const description =
    "예산, 하객, 부모님 의견. 둘이 갈리는 것부터 아모라와 하나씩 정해요. "
    + "확인한 것만 예산·할 일·일정에 남고, 바뀌면 파트너에게 알림이 가요. "
    + "비슷한 시기에 결혼하는 사람들의 기록도 함께 봐요.";

  return {
    title,
    description,
    alternates: { canonical: "/landing" },
    // openGraph.images / twitter.images 를 여기 적지 않는다. 같은 폴더의
    // `opengraph-image.tsx` 가 파일 규약으로 카드를 만들고, 여기서 images 를
    // 명시하면 그 규약이 덮인다.
    openGraph: {
      title: title,
      description: description,
      url: "/landing",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: title,
      description: description,
    },
  };
}

/**
 * 랜딩 — 결혼 준비 노트.
 *
 * ## 섹션 순서 = 제품 계약의 축 순서
 *
 *   히어로     우리 둘이 뭘 원하는지부터 (2026-09-03 시안)
 *   ①  아모라   대화 한 토막을 노트에 적어 보여 준다      ← 제품의 중심
 *   ②  확인     확인한 것만 예산·할 일·일정에 남는다      ← 그 대화가 어디로 가나
 *   ③  커뮤니티 같은 분기에 결혼하는 사람들의 기록        ← 계약의 둘째 축
 *   ④  지금 되는 것  견적·스무장면·공시가·예절            ← 로그인 없이 만질 것
 *   ⑤  경계     하지 않는 것 넷                           ← 업체 편이 아니라는 증거
 *   마무리     첫 화면과 같은 행동을 부른다
 *
 * ①②③ 이 CLAUDE.md 제품 계약의 세 축이고 ④ 는 부가 도구다. 공시 가격·위약금은
 * 한때 ③ 자리에 전용 섹션으로 있었는데, 파운더가 "메인 기능을 소개해야지" 로
 * 바로잡아 ④ 안의 카드 한 장으로 내렸다.
 */
export default function LandingPage() {
  return (
    // `relative` 는 꽃 레이어(`LandingBloomLayer`)의 기준점이다. 빼면 꽃이 화면
    // 기준으로 붙어 스크롤해도 따라다닌다.
    //
    // ⚠️ 여기 `overflow-hidden` 이 있었다. 여백 밖으로 나간 가지가 가로 스크롤을
    // 만들지 않게 하려던 것인데, **조상의 overflow 는 `position: sticky` 를 깬다.**
    // 그래서 헤더가 `sticky top-0 z-50` 인데도 안 붙었다 — 2026-08-29 실측에서
    // 2,500px 스크롤 뒤 헤더 top 이 -2500 이었다(7,400px 짜리 화면에서 내비가
    // 통째로 사라진다). 자르는 일은 `LandingBloomLayer` 가 자기 상자에서 이미
    // 한다(정본 시안도 `.bq-layer { overflow: hidden }` 으로 레이어에만 걸었고
    // 래퍼에는 없다). 여기에 다시 넣지 마라 — 헤더가 조용히 죽는다.
    <div className="relative min-h-screen bg-[var(--color-paper-sheet)] text-[var(--color-paper-ink)]">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-[6px] bg-[var(--color-paper-card)] px-5 py-3 text-[14px] font-semibold text-[var(--color-paper-ink)] shadow-raised transition-transform duration-200 motion-reduce:transition-none focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[var(--color-paper-pen)] focus:ring-offset-2"
      >
        본문 바로가기
      </a>
      {/* 여백의 꽃. 페이지 전체에 걸친다 — 시안 배치 그대로. */}
      <LandingBloomLayer />
      <LandingHeader />
      <main id="main-content" tabIndex={-1}>
        {/* 순서는 **방문자가 하는 질문의 순서**다.
            운영 랜딩(`hanbang.ai/landing`)이 이 구조였고, 2026-08-29 시안 개편에서
            섹션 넷(`scenes`·`noside`·`oneroom`·`private`)을 잃으면서 본문이 운영의
            58%(2,144자 / 3,700자)로 줄었다. 파운더가 "운영과 비슷해야 한다"고
            지적해 되살렸다. 각 섹션의 눈썹이 **실제로 하는 질문**인 이유가 이것이다.

            보여준다 → 반론에 답한다 → 걱정에 답한다 → 무엇이 남는지 → 어디서 찾는지

            ① 히어로            무엇인지
            ② 아모라 노트       아모라가 답하는 모습 (설명 대신 장면)
            ③ 확인한 것만       "그럼 아모라가 내 계획을 바꾸나?"   ← ② 직후여야 한다
            ④ 장면 하나         스무 장면이 어떻게 생겼는지
            ⑤ 편을 안 든다      "ChatGPT 로 되잖아요?"
            ⑥ 한 덩어리 대화    "우리 둘한테 뭐가 달라지냐면"
            ⑦ 나만 보는 자리    "그럼 내가 쓴 게 다 가나요?"       ← ⑥ 직후여야 한다
            ⑧ 커뮤니티          비슷한 시기 사람들의 기록 (제품 계약 둘째 축)
            ⑨ 지금 되는 것      가입 없이 오늘 할 수 있는 것
            ⑩ 안 하는 것        "이거 광고 아닌가요?"
            ⑪ 마무리

            ⚠️ **인접 규칙이 둘 있고 둘 다 같은 이유다** — 어떤 섹션은 읽고 나면
            곧바로 걱정이 생기고, 다음 섹션이 그 걱정을 받지 않으면 앞 섹션이
            불안으로 끝난다.
              ② → ③  아모라가 답하는 걸 보면 "내 예산을 마음대로 바꾸나"를 걱정한다
              ⑥ → ⑦  "두 사람 대화가 한 덩어리"를 읽으면 "내가 쓴 게 다 가나"를 걱정한다
            사이에 다른 섹션을 끼우지 마라. `landingFirstVisitClarity.test.ts` 와
            `mvpDirection.test.ts` 가 각각 하나씩 고정한다.

            공시 가격·위약금은 **부가 기능이라 ⑨ 안의 카드 한 장**이다. 한때 전용
            섹션으로 앞세웠는데, 파운더가 "메인 기능을 소개해야지" 로 바로잡았다. */}
        <TransformationHero />
        <AmoraNoteSection />
        <ConfirmSection />
        <ScenesSection />
        <NoSideSection />
        <OneRoomSection />
        <PrivateLaneSection />
        <CommunitySection />
        <AvailableNowSection />
        <BoundariesSection />
        <ClosingAction />
      </main>
      <LandingFooter />
    </div>
  );
}
