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
import BlockedReasonsSection from "@/components/landing/redesign/BlockedReasonsSection";
import PhotoBandSection from "@/components/landing/redesign/PhotoBandSection";
import TransformationHero from "@/components/landing/redesign/TransformationHero";

export const revalidate = 86_400;


export function generateMetadata(): Metadata {
  // 상수를 이 함수 **안에** 둔다. 밖으로 빼면
  // `components/community/__tests__/landingFunnelInstrumentation.test.ts` 의 추출기
  // (`generateMetadata … const title = "…"`)가 못 읽어 제목을 빈 문자열로 보고,
  // 루트 폴백과의 동일성 검사가 조용히 무의미해진다. 실제로 그렇게 됐었다.
  // 2026-09-03 시안으로 후크가 바뀌면서 같이 옮겼다. 제목은 히어로 테이프 이름표와
  // 같은 말이다 — 검색 결과에서 보는 한 줄과 첫 화면 맨 위 한 줄이 어긋나지 않게.
  const title = "웨딩한방 | 결혼 준비 동반자, 아모라";
  const description =
    "결혼 준비 AI 아모라와 예산부터 준비 순서까지 이야기해요. 직접 확인한 내용은 예산·할 일·일정에 남길 수 있어요. "
    + "파트너를 연결하면 함께 쓰는 계획의 변경 알림을 받고, 비슷한 시기에 결혼하는 사람들의 기록도 볼 수 있어요.";

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
    <div className="landing-root relative min-h-screen bg-[var(--color-paper-sheet)] text-[var(--color-paper-ink)]">
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
        {/* 팀 HTML 순서: 준비 고민 → 대화 → 의견 차이 → 확인한 기록. */}
        <TransformationHero />
        <BlockedReasonsSection />
        <AmoraNoteSection />
        <NoSideSection />
        <ConfirmSection />
        <AvailableNowSection />
        <CommunitySection />
        <PhotoBandSection />
        <BoundariesSection />
        <ClosingAction />
      </main>
      <LandingFooter />
    </div>
  );
}
