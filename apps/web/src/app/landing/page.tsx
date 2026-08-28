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
  const title = "웨딩한방 | 결혼 준비 노트, 같이 정리해요";
  const description =
    "어디에 뭘 적어뒀는지 헷갈릴 때가 있잖아요. 결혼 준비의 고민을 아모라와 이야기하고, "
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
 *   히어로     결혼 준비 노트, 같이 정리해요
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
    // 기준으로 붙어 스크롤해도 따라다닌다. `overflow-hidden` 은 여백 밖으로 나간
    // 가지가 가로 스크롤을 만들지 않게 한다.
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-paper-sheet)] text-[var(--color-paper-ink)]">
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
        {/* 순서는 **제품 계약의 축 순서**다(CLAUDE.md).
            "고민을 아모라와 이야기하고(②) → 확인한 것만 예산·할 일·일정에 남기고
            바뀐 내용을 서로에게 알리고(③) → 비슷한 시기 사람들의 기록을 함께 보며(④)".
            그다음이 부가 도구(⑤ 견적·스무장면·공시가·예절), 경계(⑥), 마무리(⑦).

            공시 가격·위약금은 **부가 기능이라 ⑤ 안의 카드 한 장**이다. 한때 이 자리에
            전용 섹션으로 앞세웠는데, 파운더가 "메인 기능을 소개해야지" 로 바로잡았다. */}
        <TransformationHero />
        <AmoraNoteSection />
        <ConfirmSection />
        <CommunitySection />
        <AvailableNowSection />
        <BoundariesSection />
        <ClosingAction />
      </main>
      <LandingFooter />
    </div>
  );
}
